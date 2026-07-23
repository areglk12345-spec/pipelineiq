create extension if not exists pgcrypto;

create type user_role as enum ('sales', 'manager', 'executive', 'itadmin', 'superadmin');

create table users (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  email text not null unique,
  password_hash text not null,
  role user_role not null,
  perms jsonb not null default '{"addDeal":false,"editDeal":false,"delDeal":false,"addUser":false,"grantAdmin":false}',
  two_fa_enabled boolean not null default false,
  two_fa_secret text,
  failed_login_count int not null default 0,
  locked_until timestamptz,
  password_changed_at timestamptz not null default now(),
  must_change_password boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table password_history (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  password_hash text not null,
  created_at timestamptz not null default now()
);

create table login_audit (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references users(id) on delete set null,
  email_attempted text not null,
  success boolean not null,
  ip text,
  created_at timestamptz not null default now()
);

create index login_audit_user_id_idx on login_audit(user_id);
create index password_history_user_id_idx on password_history(user_id);
