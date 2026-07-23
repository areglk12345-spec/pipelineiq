import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../db';
import { requireAuth, requirePermission } from '../auth/middleware';

export const customersRouter = Router();
customersRouter.use(requireAuth);

const CUSTOMER_SELECT = `
  select c.*,
    coalesce((
      select json_agg(json_build_object('kind',k.kind,'value',k.value,'label',k.label))
      from customer_contacts k where k.customer_id = c.id
    ), '[]') as contacts,
    coalesce((
      select json_agg(json_build_object('name',u.name,'userId',u.id,'period',ct.period,'current',ct.current) order by ct.created_at asc)
      from customer_caretakers ct join users u on u.id = ct.user_id where ct.customer_id = c.id
    ), '[]') as caretakers,
    coalesce((
      select json_agg(json_build_object('name',d.project,'year',extract(year from d.created_at)::text,'status',d.status) order by d.created_at desc)
      from deals d where d.customer_id = c.id
    ), '[]') as projects
  from customers c
`;

customersRouter.get('/', async (_req, res) => {
  const { rows } = await pool.query(`${CUSTOMER_SELECT} order by c.created_at asc`);
  res.json({ customers: rows });
});

customersRouter.get('/search', async (req, res) => {
  const q = String(req.query.q || '').trim();
  const { rows } = await pool.query(
    `select id, code, name from customers where name ilike $1 or code ilike $1 order by name asc limit 10`,
    [`%${q}%`]
  );
  res.json({ customers: rows });
});

const createCustomerSchema = z.object({
  code: z.string().optional(),
  name: z.string().min(1),
  type: z.string().optional(),
  poc: z.string().optional(),
  address: z.string().optional(),
  mapUrl: z.string().optional(),
  note: z.string().optional(),
  phone: z.string().optional(),
  email: z.string().optional(),
  caretakerUserId: z.string().uuid().optional().nullable(),
});

async function insertContact(customerId: string, kind: 'phone' | 'email', value?: string) {
  if (!value) return;
  await pool.query(
    'insert into customer_contacts (customer_id, kind, value) values ($1, $2, $3)',
    [customerId, kind, value]
  );
}

async function setCaretaker(customerId: string, userId: string | null | undefined) {
  if (!userId) return;
  await pool.query('update customer_caretakers set current = false where customer_id = $1 and current = true', [customerId]);
  await pool.query(
    'insert into customer_caretakers (customer_id, user_id, period, current) values ($1, $2, $3, true)',
    [customerId, userId, 'ปัจจุบัน']
  );
}

customersRouter.post('/', requirePermission('addDeal'), async (req, res) => {
  const parsed = createCustomerSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const b = parsed.data;

  try {
    const { rows } = await pool.query(
      `insert into customers (code, name, type, poc, address, map_url, note, created_by)
       values ($1,$2,$3,$4,$5,$6,$7,$8) returning id`,
      [b.code ?? null, b.name, b.type ?? null, b.poc ?? null, b.address ?? null, b.mapUrl ?? null, b.note ?? null, req.user!.id]
    );
    const customerId = rows[0].id;
    await insertContact(customerId, 'phone', b.phone);
    await insertContact(customerId, 'email', b.email);
    await setCaretaker(customerId, b.caretakerUserId);

    const { rows: full } = await pool.query(`${CUSTOMER_SELECT} where c.id = $1`, [customerId]);
    res.status(201).json({ customer: full[0] });
  } catch (err: any) {
    if (err.code === '23505') return res.status(409).json({ error: 'customer code already in use' });
    throw err;
  }
});

const updateCustomerSchema = createCustomerSchema.partial().extend({ name: z.string().min(1).optional() });

customersRouter.patch('/:id', requirePermission('addDeal'), async (req, res) => {
  const parsed = updateCustomerSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const b = parsed.data;

  const { rowCount } = await pool.query(
    `update customers set
       code = coalesce($1, code), name = coalesce($2, name), type = coalesce($3, type),
       poc = coalesce($4, poc), address = coalesce($5, address), map_url = coalesce($6, map_url),
       note = coalesce($7, note), updated_at = now()
     where id = $8`,
    [b.code ?? null, b.name ?? null, b.type ?? null, b.poc ?? null, b.address ?? null, b.mapUrl ?? null, b.note ?? null, req.params.id]
  );
  if (rowCount === 0) return res.status(404).json({ error: 'not found' });

  if (b.phone !== undefined) {
    await pool.query('delete from customer_contacts where customer_id = $1 and kind = $2', [req.params.id, 'phone']);
    await insertContact(req.params.id, 'phone', b.phone);
  }
  if (b.email !== undefined) {
    await pool.query('delete from customer_contacts where customer_id = $1 and kind = $2', [req.params.id, 'email']);
    await insertContact(req.params.id, 'email', b.email);
  }
  if (b.caretakerUserId !== undefined) {
    await setCaretaker(req.params.id, b.caretakerUserId);
  }

  const { rows: full } = await pool.query(`${CUSTOMER_SELECT} where c.id = $1`, [req.params.id]);
  res.json({ customer: full[0] });
});
