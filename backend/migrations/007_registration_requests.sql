create type registration_status as enum ('pending', 'approved', 'rejected');

create table registration_requests (
  id uuid primary key default gen_random_uuid(),
  first_name_th text not null,
  last_name_th text not null,
  email text not null,
  password_hash text not null,
  status registration_status not null default 'pending',
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid references users(id) on delete set null,
  resulting_user_id uuid references users(id) on delete set null
);

-- No unique constraint on email alone — a rejected request shouldn't
-- permanently block that address from registering again. Uniqueness among
-- *pending* requests is enforced at the application layer (checked in the
-- same request that also checks against the users table).
create index registration_requests_email_idx on registration_requests(email);
create index registration_requests_status_idx on registration_requests(status);
