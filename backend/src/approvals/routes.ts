import { Router } from 'express';
import { pool } from '../db';
import { requireAuth } from '../auth/middleware';

export const approvalsRouter = Router();
approvalsRouter.use(requireAuth);

function canReview(user: { role: string; perms: Record<string, boolean> }) {
  return user.role === 'superadmin' || !!user.perms?.editDeal || !!user.perms?.delDeal;
}

const APPROVAL_SELECT = `
  select a.id, a.type, a.note, a.draft, a.status, a.created_at, a.deal_id,
    u.name as requester, d.company, d.project
  from deal_approvals a
  join users u on u.id = a.requested_by
  left join deals d on d.id = a.deal_id
`;

approvalsRouter.get('/', async (req, res) => {
  if (!canReview(req.user!)) return res.status(403).json({ error: 'forbidden' });
  const { rows } = await pool.query(`${APPROVAL_SELECT} where a.status = 'pending' order by a.created_at desc`);
  res.json({ approvals: rows });
});

const DRAFT_FIELDS = ['poc', 'position', 'email', 'phone', 'service', 'competitor', 'other', 'reason', 'value', 'status'] as const;

async function applyDraft(dealId: string, draft: Record<string, any>) {
  const sets: string[] = [];
  const vals: any[] = [];
  let i = 1;
  for (const key of DRAFT_FIELDS) {
    if (!(key in draft) || draft[key] === undefined) continue;
    if (key === 'value') {
      const num = parseFloat(String(draft.value).replace(/[^0-9.]/g, ''));
      if (!Number.isNaN(num)) { sets.push(`value = $${i++}`); vals.push(num); }
      continue;
    }
    sets.push(`${key} = $${i++}`);
    vals.push(draft[key]);
  }
  if (sets.length === 0) return;
  sets.push(`updated_at = now()`);
  vals.push(dealId);
  await pool.query(`update deals set ${sets.join(', ')} where id = $${i}`, vals);
}

async function loadApproval(id: string) {
  const { rows } = await pool.query('select * from deal_approvals where id = $1', [id]);
  return rows[0];
}

approvalsRouter.post('/:id/approve', async (req, res) => {
  const approval = await loadApproval(req.params.id);
  if (!approval) return res.status(404).json({ error: 'not found' });
  if (approval.status !== 'pending') return res.status(409).json({ error: 'already resolved' });

  const requiredPerm = approval.type === 'delete' ? 'delDeal' : 'editDeal';
  if (req.user!.role !== 'superadmin' && !req.user!.perms?.[requiredPerm]) {
    return res.status(403).json({ error: 'forbidden' });
  }

  if (approval.type === 'delete') {
    await pool.query('delete from deals where id = $1', [approval.deal_id]);
  } else {
    await applyDraft(approval.deal_id, approval.draft || {});
    await pool.query(
      'insert into deal_logs (deal_id, author_user_id, text) values ($1, $2, $3)',
      [approval.deal_id, req.user!.id, 'อนุมัติคำขอแก้ไขข้อมูลดีล']
    );
  }

  await pool.query(
    `update deal_approvals set status = 'approved', resolved_at = now(), resolved_by = $1 where id = $2`,
    [req.user!.id, approval.id]
  );
  res.json({ ok: true });
});

approvalsRouter.post('/:id/reject', async (req, res) => {
  const approval = await loadApproval(req.params.id);
  if (!approval) return res.status(404).json({ error: 'not found' });
  if (approval.status !== 'pending') return res.status(409).json({ error: 'already resolved' });

  const requiredPerm = approval.type === 'delete' ? 'delDeal' : 'editDeal';
  if (req.user!.role !== 'superadmin' && !req.user!.perms?.[requiredPerm]) {
    return res.status(403).json({ error: 'forbidden' });
  }

  await pool.query(
    `update deal_approvals set status = 'rejected', resolved_at = now(), resolved_by = $1 where id = $2`,
    [req.user!.id, approval.id]
  );
  res.json({ ok: true });
});
