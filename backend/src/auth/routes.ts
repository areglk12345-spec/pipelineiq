import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../db';
import { verifyPassword, hashPassword, policyErrors, passwordAgeDays } from './password';
import { generateSecret, otpAuthUrl, encryptSecret, verifyToken as verifyTotp } from './totp';
import { signSession, signPendingTwoFa, verifyToken, PendingTwoFaPayload } from './jwt';
import { requireAuth } from './middleware';
import { getSettings } from '../security/settings';
import { ipLoginRateLimiter, ipRegisterRateLimiter } from './rateLimit';

export const authRouter = Router();

const cookieOpts = {
  httpOnly: true,
  sameSite: 'lax' as const,
  secure: process.env.NODE_ENV === 'production',
  maxAge: 30 * 60 * 1000,
};

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

authRouter.post('/login', ipLoginRateLimiter, async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'invalid request' });
  const { email, password } = parsed.data;
  const ip = req.ip;
  const settings = await getSettings();

  const { rows } = await pool.query(
    `select id, password_hash, role, two_fa_enabled, failed_login_count, locked_until
     from users where email = $1`,
    [email]
  );
  const user = rows[0];

  const fail = async (userId: string | null) => {
    await pool.query(
      'insert into login_audit (user_id, email_attempted, success, ip) values ($1, $2, false, $3)',
      [userId, email, ip]
    );
  };

  if (!user) {
    await fail(null);
    return res.status(401).json({ error: 'invalid credentials' });
  }

  if (user.locked_until && new Date(user.locked_until) > new Date()) {
    await fail(user.id);
    return res.status(423).json({ error: 'account locked, try again later' });
  }

  const valid = await verifyPassword(password, user.password_hash);
  if (!valid) {
    const nextCount = user.failed_login_count + 1;
    const locked = nextCount >= settings.pw_lockout_attempts;
    await pool.query(
      `update users set failed_login_count = $1,
       locked_until = case when $2 then now() + ($3 || ' minutes')::interval else locked_until end
       where id = $4`,
      [locked ? 0 : nextCount, locked, settings.pw_lockout_minutes, user.id]
    );
    await fail(user.id);
    return res.status(401).json({ error: 'invalid credentials' });
  }

  await pool.query(
    'update users set failed_login_count = 0, locked_until = null where id = $1',
    [user.id]
  );
  await pool.query(
    'insert into login_audit (user_id, email_attempted, success, ip) values ($1, $2, true, $3)',
    [user.id, email, ip]
  );

  const required2fa = settings.enforce_2fa_org
    || (user.role === 'sales' && settings.enforce_2fa_sales)
    || (user.role === 'executive' && settings.enforce_2fa_executive);

  if (required2fa && !user.two_fa_enabled) {
    // Policy demands 2FA but this account never enrolled — 2FA enrollment
    // normally requires a session, which we can't issue yet, so a
    // pending-2FA-scoped token gates a one-time mandatory setup instead.
    const tempToken = signPendingTwoFa(user.id);
    return res.json({ needs2faSetup: true, tempToken });
  }

  if (user.two_fa_enabled) {
    const tempToken = signPendingTwoFa(user.id);
    return res.json({ needs2fa: true, tempToken });
  }

  const token = signSession(user.id);
  res.cookie('session', token, cookieOpts);
  return res.json({ needs2fa: false });
});

const registerSchema = z.object({
  firstNameTh: z.string().min(1),
  lastNameTh: z.string().min(1),
  email: z.string().email(),
  password: z.string().min(1),
});

// Public — no auth. Creates a pending request, not a login-capable account;
// an IT Admin/Superadmin has to approve it (POST /users/registration-requests/:id/approve).
authRouter.post('/register', ipRegisterRateLimiter, async (req, res) => {
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'invalid request' });
  const { firstNameTh, lastNameTh, email, password } = parsed.data;

  const policyIssues = await policyErrors(password);
  if (policyIssues.length > 0) return res.status(400).json({ error: 'password policy', details: policyIssues });

  const { rows: existingUser } = await pool.query('select 1 from users where email = $1', [email]);
  if (existingUser.length > 0) return res.status(409).json({ error: 'an account with this email already exists' });

  const { rows: pendingReq } = await pool.query(
    `select 1 from registration_requests where email = $1 and status = 'pending'`,
    [email]
  );
  if (pendingReq.length > 0) return res.status(409).json({ error: 'a request for this email is already pending' });

  const passwordHash = await hashPassword(password);
  await pool.query(
    `insert into registration_requests (first_name_th, last_name_th, email, password_hash)
     values ($1, $2, $3, $4)`,
    [firstNameTh, lastNameTh, email, passwordHash]
  );
  res.status(201).json({ ok: true });
});

const verify2faSchema = z.object({
  tempToken: z.string(),
  code: z.string().min(6).max(6),
});

authRouter.post('/verify-2fa', async (req, res) => {
  const parsed = verify2faSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'invalid request' });
  const { tempToken, code } = parsed.data;

  const payload = verifyToken<PendingTwoFaPayload>(tempToken);
  if (!payload || payload.typ !== 'pending_2fa') return res.status(401).json({ error: 'invalid or expired token' });

  const { rows } = await pool.query('select id, two_fa_secret from users where id = $1', [payload.sub]);
  const user = rows[0];
  if (!user || !user.two_fa_secret) return res.status(401).json({ error: 'invalid or expired token' });

  if (!verifyTotp(code, user.two_fa_secret)) {
    return res.status(401).json({ error: 'invalid code' });
  }

  const token = signSession(user.id);
  res.cookie('session', token, cookieOpts);
  return res.json({ ok: true });
});

const setupStartSchema = z.object({ tempToken: z.string() });

// Mandatory first-time 2FA setup — reachable only with a pending-2FA token
// (issued by /login when policy requires 2FA the account doesn't have yet),
// not a full session, since the account can't log in normally until this
// completes.
authRouter.post('/2fa-setup/start', async (req, res) => {
  const parsed = setupStartSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'invalid request' });

  const payload = verifyToken<PendingTwoFaPayload>(parsed.data.tempToken);
  if (!payload || payload.typ !== 'pending_2fa') return res.status(401).json({ error: 'invalid or expired token' });

  const { rows } = await pool.query('select email from users where id = $1', [payload.sub]);
  if (rows.length === 0) return res.status(401).json({ error: 'invalid or expired token' });

  const secret = generateSecret();
  await pool.query('update users set two_fa_secret = $1 where id = $2', [encryptSecret(secret), payload.sub]);
  res.json({ secret, otpauth: otpAuthUrl(rows[0].email, secret) });
});

const setupConfirmSchema = z.object({ tempToken: z.string(), code: z.string().min(6).max(6) });

authRouter.post('/2fa-setup/confirm', async (req, res) => {
  const parsed = setupConfirmSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'invalid request' });

  const payload = verifyToken<PendingTwoFaPayload>(parsed.data.tempToken);
  if (!payload || payload.typ !== 'pending_2fa') return res.status(401).json({ error: 'invalid or expired token' });

  const { rows } = await pool.query('select two_fa_secret from users where id = $1', [payload.sub]);
  const secret = rows[0]?.two_fa_secret;
  if (!secret || !verifyTotp(parsed.data.code, secret)) {
    return res.status(400).json({ error: 'invalid code' });
  }

  await pool.query('update users set two_fa_enabled = true where id = $1', [payload.sub]);
  const token = signSession(payload.sub);
  res.cookie('session', token, cookieOpts);
  res.json({ ok: true });
});

authRouter.post('/logout', (_req, res) => {
  res.clearCookie('session');
  res.json({ ok: true });
});

authRouter.get('/me', requireAuth, async (req, res) => {
  const { rows } = await pool.query('select password_changed_at, must_change_password from users where id = $1', [req.user!.id]);
  const settings = await getSettings();
  const ageDays = rows[0] ? await passwordAgeDays(rows[0].password_changed_at) : null;
  res.json({ user: {
    ...req.user,
    passwordAgeDays: ageDays,
    passwordMaxAgeDays: settings.pw_max_age_days,
    mustChangePassword: rows[0]?.must_change_password ?? false,
  } });
});
