import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requirePermission } from '../auth/middleware';
import { getSettings, updateSettings } from './settings';

export const securityRouter = Router();
securityRouter.use(requireAuth);

securityRouter.get('/', requirePermission('addUser'), async (_req, res) => {
  res.json({ settings: await getSettings() });
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
