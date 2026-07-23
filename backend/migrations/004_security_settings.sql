create table security_settings (
  id boolean primary key default true check (id),
  enforce_2fa_org boolean not null default false,
  enforce_2fa_sales boolean not null default false,
  enforce_2fa_executive boolean not null default false,
  pw_min_length int not null default 12,
  pw_require_complexity boolean not null default true,
  pw_history_count int not null default 5,
  pw_max_age_days int not null default 90,
  pw_lockout_attempts int not null default 5,
  pw_lockout_minutes int not null default 15,
  pw_check_hibp boolean not null default false,
  updated_at timestamptz not null default now(),
  updated_by uuid references users(id) on delete set null
);

insert into security_settings (id) values (true);
