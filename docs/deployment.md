# Deployment

Production runs on **Vercel** (API and web) and **Supabase** (Postgres and file storage).

| Piece | Where | URL / ID |
|---|---|---|
| API (Fastify + tRPC) | Vercel project `timepeace-api`, root `apps/api`, region iad1 | https://timepeace-api.vercel.app |
| Web (Next.js) | Vercel project `timepeace-web`, root `apps/web` | https://timepeace-web.vercel.app |
| Postgres 17 | Supabase project `timepeace` (us-east-1) | ref `eoazrsmonczibngewwyk` |
| Receipts, exports | Supabase Storage, private bucket `timepeace` | |
| iOS app | Built locally with `expo run:ios`, `EXPO_PUBLIC_API_URL=https://timepeace-api.vercel.app` | |

Vercel Authentication protects **preview** deployments only; production domains are public (the app has its own login).

## How the API is built

`apps/api/vercel.json` runs `pnpm run build:vercel` (`scripts/build-vercel.mjs`), which writes Vercel's [Build Output API](https://vercel.com/docs/build-output-api) to `apps/api/.vercel/output`:

1. **esbuild** bundles `src/vercel.ts` (a handler that boots Fastify once per instance) with our workspace packages compiled in, including the generated Prisma client. npm packages stay external. `NODE_ENV` is baked in as `production`, so the checks in `src/env.ts` always run.
2. **@vercel/nft** traces the `node_modules` files the bundle loads (Prisma runtime, pg, pdfkit fonts, …), and they are copied next to it (~15 MB).
3. All routes go to that single function.

To check a build locally: `pnpm --filter @timepeace/api build:vercel`, then run `.vercel/output/functions/index.func/apps/api/dist/index.mjs` behind a plain `http.createServer` from inside that folder, so only traced files are available.

**Limits:** Vercel Functions cap request and response bodies at ~4.5 MB. Uploads are capped by `MAX_UPLOAD_BYTES` (4 MB in production; larger files get a 413). The CPA package is written to storage and downloaded via a 10-minute signed link (`tax.cpaPackageLink`).

## Environment

API (`timepeace-api`, Production):

| Variable | Notes |
|---|---|
| `DATABASE_URL` | Supabase **transaction pooler** (port 6543). Sensitive. |
| `FIELD_ENCRYPTION_KEY` | 64 hex chars; encrypts vendor TINs. Sensitive. **If lost, stored TINs can't be decrypted. Keep a backup.** |
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | Storage access. The service key is sensitive and server-only. |
| `STORAGE_DRIVER=supabase`, `STORAGE_BUCKET=timepeace` | |
| `MAX_UPLOAD_BYTES=4194304` | |
| `WEB_ORIGIN=https://timepeace-web.vercel.app` | CORS allowlist (comma-separated). The first entry is also the base of invite links unless `APP_URL` is set. |

Web (`timepeace-web`, Production): `NEXT_PUBLIC_API_URL=https://timepeace-api.vercel.app` (baked in at build time).

Local copies of the secrets live in `.env.production` at the repo root (gitignored, mode 600). Never commit it; `.vercelignore` also keeps it out of uploads.

## Database

- **TLS:** Supabase certificates chain to Supabase's own root CA. `poolConfig()` in `packages/db/src/index.ts` verifies them (including the hostname) against the embedded `SUPABASE_ROOT_CA` instead of disabling verification.
- **Data API lockdown:** migration `20261106070000_supabase_lockdown` revokes the `anon` / `authenticated` roles' access to the `public` schema and enables RLS on every table. Timepeace never uses Supabase's REST API. New tables inherit the revoked default privileges; enable RLS on them in their migration as well.
- **Migrations:** run from a trusted machine against the **session pooler** (port 5432):

  ```bash
  set -a; source .env.production; set +a
  DATABASE_URL="$MIGRATE_DATABASE_URL" pnpm --filter @timepeace/db exec prisma migrate deploy
  ```

- **Demo data:** the seed wipes the database. It refuses non-local hosts unless `SEED_ALLOW_REMOTE=1` and a `SEED_PASSWORD` of 12+ characters are set, because the default password is in this public repo. Production currently holds the "Acme Homes" demo, seeded with the password in `.env.production`.

## Deploying

Manual deploys from the CLI, run from the repo root:

```bash
npx vercel login                                   # once
VERCEL_ORG_ID=team_7DXtpHiOMKj0b6BDuujPUo69 VERCEL_PROJECT_ID=prj_qAsQCc8WySnD4SYEUxmmp5QOVGOU npx vercel deploy --prod   # API
VERCEL_ORG_ID=team_7DXtpHiOMKj0b6BDuujPUo69 VERCEL_PROJECT_ID=prj_U4qvFSElSjkIXSXXYvrTUMxvcQQ1 npx vercel deploy --prod   # web
```

Both projects deploy automatically from GitHub (`main` → production, other branches → protected previews). **Apply migrations to Supabase before merging code that needs them.**

Order matters when URLs change: the web build bakes in the API URL, and the API's `WEB_ORIGIN` must list the web URL. Run migrations **before** deploying an API that needs them.


## Adding your company

```bash
set -a; source .env.production; set +a
DATABASE_URL="$MIGRATE_DATABASE_URL" pnpm --filter @timepeace/db create-org -- \
  --name "Your Company" --owner-email you@example.com --owner-name "Your Name" \
  --timezone America/Denver --entity LLC_SINGLE --app-url https://timepeace-web.vercel.app
```

It prints a one-time owner invite link (valid 7 days). Open it, choose your password, then invite everyone else from **Team**. Options: `--pay-period WEEKLY|BIWEEKLY|SEMIMONTHLY`, `--week-starts-on 0-6`, `--overtime FLSA|CA`, `--entity SOLE_PROP|LLC_SINGLE|PARTNERSHIP|S_CORP|C_CORP`.

## Before real (non-demo) use

- **Login throttling:** add per-account and per-IP rate limiting on `auth.login` (strong passwords mitigate this for now).
- **Backups:** turn on Supabase point-in-time recovery (paid add-on) or schedule `pg_dump`.
- **Mobile distribution:** move from local Release builds to EAS Build and TestFlight.
