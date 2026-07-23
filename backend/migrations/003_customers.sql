create type contact_kind as enum ('phone', 'email');

create table customers (
  id uuid primary key default gen_random_uuid(),
  code text unique,
  name text not null,
  type text,
  poc text,
  address text,
  map_url text,
  note text,
  created_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table customer_contacts (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references customers(id) on delete cascade,
  kind contact_kind not null,
  value text not null,
  label text,
  created_at timestamptz not null default now()
);

create table customer_caretakers (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references customers(id) on delete cascade,
  user_id uuid references users(id) on delete set null,
  period text,
  current boolean not null default false,
  created_at timestamptz not null default now()
);

alter table deals add column customer_id uuid references customers(id);

create index customer_contacts_customer_id_idx on customer_contacts(customer_id);
create index customer_caretakers_customer_id_idx on customer_caretakers(customer_id);
create index customer_caretakers_current_idx on customer_caretakers(customer_id, current);
create index deals_customer_id_idx on deals(customer_id);
