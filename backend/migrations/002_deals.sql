create type deal_status as enum ('lead', 'proposal', 'bidding', 'won', 'lost');
create type approval_type as enum ('edit', 'delete');
create type approval_status as enum ('pending', 'approved', 'rejected');

create table deals (
  id uuid primary key default gen_random_uuid(),
  org_code text,
  company text not null,
  poc text,
  position text,
  email text,
  phone text,
  project text not null,
  service text,
  value numeric not null default 0,
  tor_filename text,
  competitor text,
  other text,
  reason text,
  status deal_status not null default 'lead',
  crm_user_id uuid references users(id) on delete set null,
  sales_user_id uuid not null references users(id) on delete restrict,
  turnkey_user_id uuid references users(id) on delete set null,
  ma_user_id uuid references users(id) on delete set null,
  created_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table deal_logs (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid not null references deals(id) on delete cascade,
  author_user_id uuid references users(id) on delete set null,
  text text not null,
  created_at timestamptz not null default now()
);

create table deal_plan_items (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid not null references deals(id) on delete cascade,
  task text not null,
  due_date text,
  done boolean not null default false,
  created_at timestamptz not null default now()
);

create table deal_approvals (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid not null references deals(id) on delete cascade,
  type approval_type not null,
  requested_by uuid references users(id) on delete set null,
  note text,
  draft jsonb,
  status approval_status not null default 'pending',
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid references users(id) on delete set null
);

create index deals_sales_user_id_idx on deals(sales_user_id);
create index deal_logs_deal_id_idx on deal_logs(deal_id);
create index deal_plan_items_deal_id_idx on deal_plan_items(deal_id);
create index deal_approvals_deal_id_idx on deal_approvals(deal_id);
create index deal_approvals_status_idx on deal_approvals(status);
