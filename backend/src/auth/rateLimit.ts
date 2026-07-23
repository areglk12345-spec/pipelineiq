import { Request, Response, NextFunction } from 'express';
import { pool } from '../db';

const WINDOW_MINUTES = 15;
const MAX_ATTEMPTS = 20;

// Postgres-backed per-IP rate limiter for POST /auth/login. Distinct from
// the per-account lockout in the login handler itself — that one stops
// someone hammering a single account, this stops credential stuffing spread
// across many accounts from one source. A single atomic UPSERT avoids the
// read-then-write race a naive select+update would have under concurrent
// requests from the same IP.
//
// This has to be DB-backed rather than in-memory because the deploy target
// is serverless (Vercel functions don't persist state between invocations —
// an in-memory counter would reset constantly and do nothing). Requires
// `app.set('trust proxy', ...)` configured correctly for the real deployment
// topology, or req.ip is always the edge proxy's address and this limiter
// either does nothing or locks out everyone behind it.
export async function ipLoginRateLimiter(req: Request, res: Response, next: NextFunction) {
  const ip = req.ip || 'unknown';
  const { rows } = await pool.query(
    `insert into ip_login_attempts (ip, count, window_start)
     values ($1, 1, now())
     on conflict (ip) do update set
       count = case when ip_login_attempts.window_start < now() - ($2 || ' minutes')::interval
                    then 1 else ip_login_attempts.count + 1 end,
       window_start = case when ip_login_attempts.window_start < now() - ($2 || ' minutes')::interval
                            then now() else ip_login_attempts.window_start end
     returning count`,
    [ip, WINDOW_MINUTES]
  );

  if (rows[0].count > MAX_ATTEMPTS) {
    return res.status(429).json({ error: 'too many login attempts, try again later' });
  }
  next();
}
