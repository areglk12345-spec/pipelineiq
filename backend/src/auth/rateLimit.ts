import { Request, Response, NextFunction } from 'express';
import { pool } from '../db';

// Postgres-backed per-IP rate limiter factory. Each call site gets its own
// scope (e.g. 'login', 'register') so they don't share one counter —
// spamming registration shouldn't lock a real user out of logging in from
// the same IP, and vice versa. A single atomic UPSERT avoids the
// read-then-write race a naive select+update would have under concurrent
// requests from the same IP.
//
// This has to be DB-backed rather than in-memory because the deploy target
// is serverless (Vercel functions don't persist state between invocations —
// an in-memory counter would reset constantly and do nothing). Requires
// `app.set('trust proxy', ...)` configured correctly for the real deployment
// topology, or req.ip is always the edge proxy's address and this limiter
// either does nothing or locks out everyone behind it.
export function ipRateLimiter(scope: string, opts: { windowMinutes: number; maxAttempts: number }) {
  return async function (req: Request, res: Response, next: NextFunction) {
    const ip = req.ip || 'unknown';
    const { rows } = await pool.query(
      `insert into ip_rate_limit_attempts (ip, scope, count, window_start)
       values ($1, $2, 1, now())
       on conflict (ip, scope) do update set
         count = case when ip_rate_limit_attempts.window_start < now() - ($3 || ' minutes')::interval
                      then 1 else ip_rate_limit_attempts.count + 1 end,
         window_start = case when ip_rate_limit_attempts.window_start < now() - ($3 || ' minutes')::interval
                              then now() else ip_rate_limit_attempts.window_start end
       returning count`,
      [ip, scope, opts.windowMinutes]
    );

    if (rows[0].count > opts.maxAttempts) {
      return res.status(429).json({ error: 'too many attempts, try again later' });
    }
    next();
  };
}

export const ipLoginRateLimiter = ipRateLimiter('login', { windowMinutes: 15, maxAttempts: 20 });
export const ipRegisterRateLimiter = ipRateLimiter('register', { windowMinutes: 15, maxAttempts: 10 });
