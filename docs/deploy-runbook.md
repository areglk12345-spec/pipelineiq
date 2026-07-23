# Deploy Runbook — Vercel

`vercel.json` and `api/index.ts` are prepared and committed. The steps below
are the ones only you can do — they need account access / secrets I don't have.

## Architecture note

The backend (`backend/src/server.ts`) runs as a Vercel serverless function
(`api/index.ts` re-exports the Express app — Express apps are valid `(req,
res)` handlers, this is Vercel's documented supported pattern, no adapter
library needed). The frontend (`frontend/`) is served by Vercel's static
hosting directly, same origin, via `vercel.json`'s `outputDirectory` — no
separate frontend deploy, no CORS needed.

The login rate limiter is Postgres-backed (`ip_login_attempts` table,
`backend/src/auth/rateLimit.ts`), not in-memory — serverless functions don't
persist state between invocations, so an in-memory counter would reset
constantly and do nothing.

## 1. Push this repo to GitHub

```
git remote add origin https://github.com/areglk12345-spec/pipelineiq.git
git push -u origin master
```

## 2. Generate fresh production secrets — do not reuse the dev `.env` values

The `JWT_SECRET` and `TOTP_ENCRYPTION_KEY` currently in `backend/.env` were
generated for local development in this session and should be treated as
burned (never copy them into production). Generate new ones:

```
# JWT_SECRET
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

# TOTP_ENCRYPTION_KEY (must be exactly 64 hex chars / 32 bytes)
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Save both somewhere safe (password manager, not chat/email).

## 3. Link and deploy

```
vercel link      # creates/links the Vercel project — confirm the prompts
vercel env add DATABASE_URL production
vercel env add DIRECT_URL production
vercel env add JWT_SECRET production
vercel env add TOTP_ENCRYPTION_KEY production
vercel env add JWT_EXPIRES_IN production   # value: 30m
vercel env add PGSSL production            # value: true
vercel env add NODE_ENV production         # value: production
vercel --prod
```

(Or do the equivalent through the Vercel dashboard — **New Project** →
import the GitHub repo → it reads `vercel.json` automatically → add the same
env vars under **Settings → Environment Variables** before the first deploy.)

`DATABASE_URL` = Supabase transaction pooler string (port 6543,
`?pgbouncer=true`). `DIRECT_URL` = Supabase session pooler string (port
5432), used by `npm run migrate` during the build step. Same shape as
`backend/.env.example`.

## 4. Verify the build actually ran migrations

`vercel.json`'s `buildCommand` runs `npm run migrate` against Supabase on
every deploy (safe to re-run — it tracks what's already applied). Check the
deploy's build log for `migrate.ts` output — confirm it says `done` and
isn't silently skipping `005_ip_rate_limit.sql` because it's pointed at the
wrong database.

## 5. Verify the live deployment

- `https://<your-project>.vercel.app/health` → `{"ok":true}`
- `https://<your-project>.vercel.app/` → the login page loads (frontend,
  served as static files, same origin as the API)
- Log in with a seeded account → confirm the mandatory change-password gate
  still triggers correctly in the real deployment
- Trigger 21 rapid login attempts from one IP → confirm the 21st gets a 429
  (this is the part that would've silently failed with the original
  in-memory limiter — worth actually checking once, not just trusting the code)

## 6. Custom domain (optional)

Vercel dashboard → the project → **Settings → Domains**. TLS is automatic.
No code changes needed — nothing in this app hardcodes an origin.

## Notes / things intentionally left as-is

- **Seeded accounts still have `must_change_password=true`** (except
  `kamonchanok`, changed during testing) — real owners hit the mandatory
  change-password gate on first real login, which is the intended flow.
- **No email service** — password reset is still admin-driven
  (`POST /users/:id/reset-password`) or self-service while already logged in.
  There's no "forgot password" email-link flow.
- **Region**: Vercel picks a default region automatically; change it under
  **Settings → Functions → Region** if latency to Supabase's region matters
  (worth matching your Supabase project's region).
