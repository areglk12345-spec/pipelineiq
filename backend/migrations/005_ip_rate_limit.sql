-- Postgres-backed IP rate limiting for POST /auth/login — replaces an
-- in-memory limiter, which doesn't work on serverless (Vercel functions
-- don't persist state between invocations, so an in-memory counter resets
-- constantly and effectively does nothing).
create table ip_login_attempts (
  ip text primary key,
  count int not null default 0,
  window_start timestamptz not null default now()
);
