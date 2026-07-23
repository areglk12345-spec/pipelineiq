import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../db';
import { requireAuth, requirePermission } from '../auth/middleware';

export const dealsRouter = Router();
dealsRouter.use(requireAuth);

const STATUSES = ['lead', 'proposal', 'bidding', 'won', 'lost'] as const;

// Fields a sales rep without `editDeal` can propose changes to — mirrors the
// mock's edit-panel draft object exactly.
const DRAFT_FIELDS = ['poc', 'position', 'email', 'phone', 'service', 'competitor', 'other', 'reason', 'value', 'status'] as const;

const DEAL_SELECT = `
  select d.*,
    crm.name as crm_name, sales.name as sales_name, turnkey.name as turnkey_name, ma.name as ma_name,
    coalesce((
      select json_agg(json_build_object('id',l.id,'author',u.name,'time',l.created_at,'text',l.text) order by l.created_at desc)
      from deal_logs l join users u on u.id = l.author_user_id where l.deal_id = d.id
    ), '[]') as logs,
    coalesce((
      select json_agg(json_build_object('id',p.id,'task',p.task,'due',p.due_date,'done',p.done) order by p.created_at asc)
      from deal_plan_items p where p.deal_id = d.id
    ), '[]') as plan
  from deals d
  join users sales on sales.id = d.sales_user_id
  left join users crm on crm.id = d.crm_user_id
  left join users turnkey on turnkey.id = d.turnkey_user_id
  left join users ma on ma.id = d.ma_user_id
`;

function canMutate(user: { role: string }) {
  return user.role !== 'executive';
}

dealsRouter.get('/', async (req, res) => {
  const scoped = req.user!.role === 'sales';
  const { rows } = await pool.query(
    scoped ? `${DEAL_SELECT} where d.sales_user_id = $1 order by d.created_at desc` : `${DEAL_SELECT} order by d.created_at desc`,
    scoped ? [req.user!.id] : []
  );
  res.json({ deals: rows });
});

const createDealSchema = z.object({
  customerId: z.string().uuid(),
  poc: z.string().optional(),
  position: z.string().optional(),
  email: z.string().optional(),
  phone: z.string().optional(),
  project: z.string().min(1),
  service: z.string().optional(),
  value: z.number().nonnegative().default(0),
  torFilename: z.string().optional(),
  competitor: z.string().optional(),
  other: z.string().optional(),
  reason: z.string().optional(),
  status: z.enum(STATUSES).default('lead'),
  crmUserId: z.string().uuid().optional().nullable(),
  salesUserId: z.string().uuid(),
  turnkeyUserId: z.string().uuid().optional().nullable(),
  maUserId: z.string().uuid().optional().nullable(),
});

dealsRouter.post('/', requirePermission('addDeal'), async (req, res) => {
  const parsed = createDealSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const b = parsed.data;

  const { rows: custRows } = await pool.query('select code, name from customers where id = $1', [b.customerId]);
  if (custRows.length === 0) return res.status(400).json({ error: 'customer not found' });
  // company/org_code are denormalized onto the deal (kept in sync with the
  // linked customer at creation time) so existing card/kanban rendering
  // needs no changes — the customer name is authoritative, not client input.
  const { code: orgCode, name: company } = custRows[0];

  const { rows } = await pool.query(
    `insert into deals (org_code, company, customer_id, poc, position, email, phone, project, service, value, tor_filename, competitor, other, reason, status, crm_user_id, sales_user_id, turnkey_user_id, ma_user_id, created_by)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)
     returning id`,
    [orgCode, company, b.customerId, b.poc ?? null, b.position ?? null, b.email ?? null, b.phone ?? null, b.project, b.service ?? null,
     b.value, b.torFilename ?? null, b.competitor ?? null, b.other ?? null, b.reason ?? null, b.status,
     b.crmUserId ?? null, b.salesUserId, b.turnkeyUserId ?? null, b.maUserId ?? null, req.user!.id]
  );
  const { rows: full } = await pool.query(`${DEAL_SELECT} where d.id = $1`, [rows[0].id]);
  res.status(201).json({ deal: full[0] });
});

const draftSchema = z.object({
  poc: z.string().optional(),
  position: z.string().optional(),
  email: z.string().optional(),
  phone: z.string().optional(),
  service: z.string().optional(),
  competitor: z.string().optional(),
  other: z.string().optional(),
  reason: z.string().optional(),
  value: z.union([z.number(), z.string()]).optional(),
  status: z.enum(STATUSES).optional(),
});

async function applyDraft(dealId: string, draft: Record<string, any>) {
  const sets: string[] = [];
  const vals: any[] = [];
  let i = 1;
  for (const key of DRAFT_FIELDS) {
    if (!(key in draft) || draft[key] === undefined) continue;
    const col = key === 'poc' ? 'poc' : key; // all draft keys map 1:1 to column names
    if (key === 'value') {
      const num = parseFloat(String(draft.value).replace(/[^0-9.]/g, ''));
      if (!Number.isNaN(num)) { sets.push(`value = $${i++}`); vals.push(num); }
      continue;
    }
    sets.push(`${col} = $${i++}`);
    vals.push(draft[key]);
  }
  if (sets.length === 0) return;
  sets.push(`updated_at = now()`);
  vals.push(dealId);
  await pool.query(`update deals set ${sets.join(', ')} where id = $${i}`, vals);
}

dealsRouter.patch('/:id', async (req, res) => {
  if (!canMutate(req.user!)) return res.status(403).json({ error: 'forbidden' });
  const parsed = draftSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const { rows } = await pool.query('select id from deals where id = $1', [req.params.id]);
  if (rows.length === 0) return res.status(404).json({ error: 'not found' });

  if (req.user!.role === 'superadmin' || req.user!.perms?.editDeal) {
    await applyDraft(req.params.id, parsed.data);
    await pool.query(
      'insert into deal_logs (deal_id, author_user_id, text) values ($1, $2, $3)',
      [req.params.id, req.user!.id, 'แก้ไขข้อมูลดีล']
    );
    const { rows: full } = await pool.query(`${DEAL_SELECT} where d.id = $1`, [req.params.id]);
    return res.json({ deal: full[0], pending: false });
  }

  await pool.query(
    `insert into deal_approvals (deal_id, type, requested_by, note, draft) values ($1, 'edit', $2, $3, $4)`,
    [req.params.id, req.user!.id, 'คำขอแก้ไขข้อมูลดีล รอหัวหน้าอนุมัติ', JSON.stringify(parsed.data)]
  );
  res.json({ pending: true });
});

dealsRouter.delete('/:id', async (req, res) => {
  if (!canMutate(req.user!)) return res.status(403).json({ error: 'forbidden' });
  const { rows } = await pool.query('select id from deals where id = $1', [req.params.id]);
  if (rows.length === 0) return res.status(404).json({ error: 'not found' });

  if (req.user!.role === 'superadmin' || req.user!.perms?.delDeal) {
    await pool.query('delete from deals where id = $1', [req.params.id]);
    return res.json({ deleted: true, pending: false });
  }

  await pool.query(
    `insert into deal_approvals (deal_id, type, requested_by, note) values ($1, 'delete', $2, $3)`,
    [req.params.id, req.user!.id, 'คำขอลบดีลจากพนักงานขาย รอหัวหน้าอนุมัติ']
  );
  res.json({ pending: true });
});

const noteSchema = z.object({ text: z.string().min(1) });

dealsRouter.post('/:id/notes', async (req, res) => {
  if (!canMutate(req.user!)) return res.status(403).json({ error: 'forbidden' });
  const parsed = noteSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'invalid request' });
  const { rowCount } = await pool.query('select 1 from deals where id = $1', [req.params.id]);
  if (rowCount === 0) return res.status(404).json({ error: 'not found' });
  await pool.query(
    'insert into deal_logs (deal_id, author_user_id, text) values ($1, $2, $3)',
    [req.params.id, req.user!.id, parsed.data.text]
  );
  res.status(201).json({ ok: true });
});

const planItemSchema = z.object({ task: z.string().min(1), due: z.string().optional() });

dealsRouter.post('/:id/plan', async (req, res) => {
  if (!canMutate(req.user!)) return res.status(403).json({ error: 'forbidden' });
  const parsed = planItemSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'invalid request' });
  const { rowCount } = await pool.query('select 1 from deals where id = $1', [req.params.id]);
  if (rowCount === 0) return res.status(404).json({ error: 'not found' });
  await pool.query(
    'insert into deal_plan_items (deal_id, task, due_date) values ($1, $2, $3)',
    [req.params.id, parsed.data.task, parsed.data.due || 'ยังไม่ระบุวันที่']
  );
  res.status(201).json({ ok: true });
});

dealsRouter.patch('/:id/plan/:itemId', async (req, res) => {
  if (!canMutate(req.user!)) return res.status(403).json({ error: 'forbidden' });
  const done = typeof req.body.done === 'boolean' ? req.body.done : undefined;
  if (done === undefined) return res.status(400).json({ error: 'invalid request' });
  const { rowCount } = await pool.query(
    'update deal_plan_items set done = $1 where id = $2 and deal_id = $3',
    [done, req.params.itemId, req.params.id]
  );
  if (rowCount === 0) return res.status(404).json({ error: 'not found' });
  res.json({ ok: true });
});

dealsRouter.delete('/:id/plan/:itemId', async (req, res) => {
  if (!canMutate(req.user!)) return res.status(403).json({ error: 'forbidden' });
  const { rowCount } = await pool.query(
    'delete from deal_plan_items where id = $1 and deal_id = $2',
    [req.params.itemId, req.params.id]
  );
  if (rowCount === 0) return res.status(404).json({ error: 'not found' });
  res.json({ ok: true });
});
