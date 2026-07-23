-- Generalize the IP rate limiter to support multiple scopes (login,
-- register, ...) without them sharing one counter — spamming the
-- registration endpoint shouldn't lock a real user out of logging in from
-- the same IP, and vice versa.
drop table ip_login_attempts;

create table ip_rate_limit_attempts (
  ip text not null,
  scope text not null,
  count int not null default 0,
  window_start timestamptz not null default now(),
  primary key (ip, scope)
);
