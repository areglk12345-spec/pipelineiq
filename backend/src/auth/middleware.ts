import { Request, Response, NextFunction } from 'express';
import { pool } from '../db';
import { verifyToken, SessionPayload } from './jwt';

export interface AuthedUser {
  id: string;
  name: string;
  email: string;
  role: string;
  perms: Record<string, boolean>;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthedUser;
    }
  }
}

export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const token = req.cookies?.session;
  if (!token) return res.status(401).json({ error: 'not authenticated' });

  const payload = verifyToken<SessionPayload>(token);
  if (!payload || payload.typ !== 'session') return res.status(401).json({ error: 'not authenticated' });

  // Re-fetch from DB rather than trusting the token's claims, so a permission
  // change or account deactivation takes effect on the very next request.
  const { rows } = await pool.query(
    'select id, name, email, role, perms from users where id = $1',
    [payload.sub]
  );
  if (rows.length === 0) return res.status(401).json({ error: 'not authenticated' });

  req.user = rows[0];
  next();
}

export function requirePermission(perm: string) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) return res.status(401).json({ error: 'not authenticated' });
    if (req.user.role === 'superadmin' || req.user.perms?.[perm]) return next();
    return res.status(403).json({ error: 'forbidden' });
  };
}
