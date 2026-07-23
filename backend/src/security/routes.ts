import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../db';
import { requireAuth, requirePermission } from '../auth/middleware';
import { getSettings, updateSettings } from './settings';

export const securityRouter = Router();
securityRouter.use(requireAuth);

securityRouter.get('/', requirePermission('addUser'), async (_req, res) => {
  res.json({ settings: await getSettings() });
});

// Real login history — replaces the Security screen's previously-hardcoded
// fake audit log. login_audit is already populated on every login attempt
// (see auth/routes.ts POST /login), this just exposes it.
securityRouter.get('/audit-log', requirePermission('addUser'), async (_req, res) => {
  const { rows } = await pool.query(
    `select la.email_attempted, la.success, la.ip, la.created_at
     from login_audit la
     order by la.created_at desc
     limit 20`
  );
  res.json({ entries: rows });
});

const updateSchema = z.object({
  enforce_2fa_org: z.boolean().optional(),
  enforce_2fa_sales: z.boolean().optional(),
  enforce_2fa_executive: z.boolean().optional(),
  pw_min_length: z.number().int().min(6).max(64).optional(),
  pw_require_complexity: z.boolean().optional(),
  pw_history_count: z.number().int().min(0).max(24).optional(),
  pw_max_age_days: z.number().int().min(1).max(3650).optional(),
  pw_lockout_attempts: z.number().int().min(1).max(20).optional(),
  pw_lockout_minutes: z.number().int().min(1).max(1440).optional(),
  pw_check_hibp: z.boolean().optional(),
}).strict();

securityRouter.patch('/', requirePermission('addUser'), async (req, res) => {
  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const settings = await updateSettings(parsed.data, req.user!.id);
  res.json({ settings });
});
