import jwt, { SignOptions } from 'jsonwebtoken';

if (!process.env.JWT_SECRET) {
  throw new Error('JWT_SECRET is not set');
}
const SECRET: string = process.env.JWT_SECRET;

const EXPIRES_IN = (process.env.JWT_EXPIRES_IN || '30m') as SignOptions['expiresIn'];

export interface SessionPayload {
  sub: string; // user id
  typ: 'session';
}

export interface PendingTwoFaPayload {
  sub: string;
  typ: 'pending_2fa';
}

export function signSession(userId: string): string {
  const payload: SessionPayload = { sub: userId, typ: 'session' };
  return jwt.sign(payload, SECRET, { expiresIn: EXPIRES_IN });
}

export function signPendingTwoFa(userId: string): string {
  const payload: PendingTwoFaPayload = { sub: userId, typ: 'pending_2fa' };
  return jwt.sign(payload, SECRET, { expiresIn: '5m' });
}

export function verifyToken<T extends { typ: string }>(token: string): T | null {
  try {
    return jwt.verify(token, SECRET) as unknown as T;
  } catch {
    return null;
  }
}
