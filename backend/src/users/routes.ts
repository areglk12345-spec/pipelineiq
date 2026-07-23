import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../db';
import { requireAuth, requirePermission } from '../auth/middleware';
import { hashPassword, verifyPassword, policyErrors, recordPasswordHistory, wasRecentlyUsed } from '../auth/password';
import { generateSecret, otpAuthUrl, encryptSecret, verifyToken as verifyTotp } from '../auth/totp';

export const usersRouter = Router();
usersRouter.use(requireAuth);

const ROLES = ['sales', 'manager', 'executive', 'itadmin', 'superadmin'] as const;
const ADMIN_ROLES = new Set(['itadmin', 'superadmin']);

const permsSchema = z.object({
  addDeal: z.boolean(),
  editDeal: z.boolean(),
  delDeal: z.boolean(),
  addUser: z.boolean(),
  grantAdmin: z.boolean(),
});

function canAssignRole(actor: { role: string; perms: Record<string, boolean> }, role: string): boolean {
  if (!ADMIN_ROLES.has(role)) return true;
  return actor.role === 'superadmin' || !!actor.perms.grantAdmin;
}

// Any authenticated user — used to populate deal team-assignment dropdowns
// (CRM/Sales/Turnkey/MA pickers). Deliberately excludes perms/2FA/lockout
// fields that GET / (admin-only) exposes.
usersRouter.get('/directory', async (_req, res) => {
  const { rows } = await pool.query('select id, name, role from users order by name asc');
  res.json({ users: rows });
});

usersRouter.get('/', requirePermission('addUser'), async (_req, res) => {
  const { rows } = await pool.query(
    `select id, name, email, role, perms, two_fa_enabled, must_change_password, created_at
     from users order by created_at asc`
  );
  res.json({ users: rows });
});

const createUserSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  role: z.enum(ROLES),
  perms: permsSchema,
  password: z.string(),
  mustChangePassword: z.boolean().default(false),
});

usersRouter.post('/', requirePermission('addUser'), async (req, res) => {
  const parsed = createUserSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const { name, email, role, perms, password, mustChangePassword } = parsed.data;

  if (!canAssignRole(req.user!, role)) return res.status(403).json({ error: 'forbidden: cannot assign admin role' });

  const policyIssues = await policyErrors(password);
  if (policyIssues.length > 0) return res.status(400).json({ error: 'password policy', details: policyIssues });

  const passwordHash = await hashPassword(password);
  try {
    const { rows } = await pool.query(
      `insert into users (name, email, password_hash, role, perms, must_change_password)
       values ($1, $2, $3, $4, $5, $6)
       returning id, name, email, role, perms, two_fa_enabled, must_change_password, created_at`,
      [name, email, passwordHash, role, perms, mustChangePassword]
    );
    await recordPasswordHistory(rows[0].id, passwordHash);
    res.status(201).json({ user: rows[0] });
  } catch (err: any) {
    if (err.code === '23505') return res.status(409).json({ error: 'email already in use' });
    throw err;
  }
});

const updateUserSchema = z.object({
  name: z.string().min(1).optional(),
  role: z.enum(ROLES).optional(),
  perms: permsSchema.optional(),
});

usersRouter.patch('/:id', requirePermission('addUser'), async (req, res) => {
  const parsed = updateUserSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const { name, role, perms } = parsed.data;

  if (role && !canAssignRole(req.user!, role)) {
    return res.status(403).json({ error: 'forbidden: cannot assign admin role' });
  }

  const { rows } = await pool.query(
    `update users set
       name = coalesce($1, name),
       role = coalesce($2, role),
       perms = coalesce($3, perms),
       updated_at = now()
     where id = $4
     returning id, name, email, role, perms, two_fa_enabled, must_change_password, created_at`,
    [name ?? null, role ?? null, perms ?? null, req.params.id]
  );
  if (rows.length === 0) return res.status(404).json({ error: 'not found' });
  res.json({ user: rows[0] });
});

usersRouter.delete('/:id', requirePermission('addUser'), async (req, res) => {
  if (req.params.id === req.user!.id) return res.status(400).json({ error: 'cannot delete your own account' });
  const { rowCount } = await pool.query('delete from users where id = $1', [req.params.id]);
  if (rowCount === 0) return res.status(404).json({ error: 'not found' });
  res.status(204).end();
});

const resetPasswordSchema = z.object({
  password: z.string(),
  mode: z.enum(['direct', 'temporary']),
});

usersRouter.post('/:id/reset-password', requirePermission('addUser'), async (req, res) => {
  const parsed = resetPasswordSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const { password, mode } = parsed.data;

  const policyIssues = await policyErrors(password);
  if (policyIssues.length > 0) return res.status(400).json({ error: 'password policy', details: policyIssues });

  if (await wasRecentlyUsed(req.params.id, password)) {
    return res.status(400).json({ error: 'password reused', details: ['ห้ามใช้รหัสผ่านซ้ำ 5 ครั้งล่าสุด'] });
  }

  const passwordHash = await hashPassword(password);
  const { rowCount } = await pool.query(
    `update users set password_hash = $1, must_change_password = $2,
       password_changed_at = now(), failed_login_count = 0, locked_until = null,
       updated_at = now()
     where id = $3`,
    [passwordHash, mode === 'temporary', req.params.id]
  );
  if (rowCount === 0) return res.status(404).json({ error: 'not found' });
  await recordPasswordHistory(req.params.id, passwordHash);
  res.json({ ok: true });
});

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(1),
});

// Self-service password change — the only way must_change_password ever
// actually gets cleared (the admin reset-password endpoint above sets it,
// but only this endpoint, driven by the user themselves, unsets it).
usersRouter.post('/me/change-password', async (req, res) => {
  const parsed = changePasswordSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'invalid request' });
  const { currentPassword, newPassword } = parsed.data;

  const { rows } = await pool.query('select password_hash from users where id = $1', [req.user!.id]);
  if (rows.length === 0 || !(await verifyPassword(currentPassword, rows[0].password_hash))) {
    return res.status(401).json({ error: 'current password is incorrect' });
  }

  const policyIssues = await policyErrors(newPassword);
  if (policyIssues.length > 0) return res.status(400).json({ error: 'password policy', details: policyIssues });

  if (await wasRecentlyUsed(req.user!.id, newPassword)) {
    return res.status(400).json({ error: 'password reused', details: ['ห้ามใช้รหัสผ่านซ้ำกับที่เคยใช้ล่าสุด'] });
  }

  const passwordHash = await hashPassword(newPassword);
  await pool.query(
    `update users set password_hash = $1, must_change_password = false,
       password_changed_at = now(), failed_login_count = 0, locked_until = null,
       updated_at = now()
     where id = $2`,
    [passwordHash, req.user!.id]
  );
  await recordPasswordHistory(req.user!.id, passwordHash);
  res.json({ ok: true });
});

// Self-service 2FA enrollment: any authenticated user can start enrollment for themselves.
usersRouter.post('/me/2fa/enroll', async (req, res) => {
  const secret = generateSecret();
  await pool.query('update users set two_fa_secret = $1 where id = $2', [encryptSecret(secret), req.user!.id]);
  res.json({ secret, otpauth: otpAuthUrl(req.user!.email, secret) });
});

const confirm2faSchema = z.object({ code: z.string().min(6).max(6) });

usersRouter.post('/me/2fa/confirm', async (req, res) => {
  const parsed = confirm2faSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'invalid request' });

  const { rows } = await pool.query('select two_fa_secret from users where id = $1', [req.user!.id]);
  const secret = rows[0]?.two_fa_secret;
  if (!secret || !verifyTotp(parsed.data.code, secret)) {
    return res.status(400).json({ error: 'invalid code' });
  }
  await pool.query('update users set two_fa_enabled = true where id = $1', [req.user!.id]);
  res.json({ ok: true });
});

// Admin-forced disable (e.g. lost device) — matches the mock's IT Admin reset flows.
usersRouter.post('/:id/2fa/disable', requirePermission('addUser'), async (req, res) => {
  const { rowCount } = await pool.query(
    'update users set two_fa_enabled = false, two_fa_secret = null where id = $1',
    [req.params.id]
  );
  if (rowCount === 0) return res.status(404).json({ error: 'not found' });
  res.json({ ok: true });
});

// Self-registration approval queue (POST /auth/register creates these).
// Same permission as the existing "add employee" flow — approving a
// registration request is account creation either way.
usersRouter.get('/registration-requests', requirePermission('addUser'), async (_req, res) => {
  const { rows } = await pool.query(
    `select id, first_name_th, last_name_th, email, created_at
     from registration_requests where status = 'pending' order by created_at asc`
  );
  res.json({ requests: rows });
});

// Default role/perms for an approved self-registration mirror the existing
// admin "add employee" flow (frontend/index.html submitNewEmp) — every
// self-registered account starts as a plain sales rep; IT Admin can change
// role/perms afterward via the normal PATCH /users/:id.
const DEFAULT_REGISTERED_PERMS = { addDeal: true, editDeal: false, delDeal: false, addUser: false, grantAdmin: false };

usersRouter.post('/registration-requests/:id/approve', requirePermission('addUser'), async (req, res) => {
  const { rows } = await pool.query(
    `select * from registration_requests where id = $1 and status = 'pending'`,
    [req.params.id]
  );
  const request = rows[0];
  if (!request) return res.status(404).json({ error: 'not found or already resolved' });

  try {
    const { rows: created } = await pool.query(
      `insert into users (name, email, password_hash, role, perms, must_change_password)
       values ($1, $2, $3, 'sales', $4, false)
       returning id`,
      [`${request.first_name_th} ${request.last_name_th}`, request.email, request.password_hash, DEFAULT_REGISTERED_PERMS]
    );
    await pool.query(
      `update registration_requests set status = 'approved', resolved_at = now(), resolved_by = $1, resulting_user_id = $2 where id = $3`,
      [req.user!.id, created[0].id, request.id]
    );
    res.json({ ok: true, userId: created[0].id });
  } catch (err: any) {
    if (err.code === '23505') return res.status(409).json({ error: 'an account with this email was created in the meantime' });
    throw err;
  }
});

usersRouter.post('/registration-requests/:id/reject', requirePermission('addUser'), async (req, res) => {
  const { rowCount } = await pool.query(
    `update registration_requests set status = 'rejected', resolved_at = now(), resolved_by = $1
     where id = $2 and status = 'pending'`,
    [req.user!.id, req.params.id]
  );
  if (rowCount === 0) return res.status(404).json({ error: 'not found or already resolved' });
  res.json({ ok: true });
});
