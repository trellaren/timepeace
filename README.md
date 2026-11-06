# timepeace

Project management, time tracking, job costing and payroll/tax handoff for small construction companies.

- **Managers (web):** create projects from templates, break them into phases and tasks, set budgets by cost code, assign crews, approve hours and expenses, and see where each job makes or loses money.
- **Workers (iOS/Android):** clock in and out (that's what they're paid for, including time between tasks), see today's tasks, start/stop/switch task timers, mark tasks done, flag *needs materials* or *blocked*, snap receipts, and submit their week. All of it works offline on the job site.
- **HR (web):** export approved hours and reimbursements to the payroll provider as CSV/PDF, then mark them paid.
- **Owners and accountants:** portfolio P&L, estimate accuracy by trade, and margin by project type, plus a tax center: deductions by Schedule C / 1120-S line, a 1099-NEC tracker with W-9s, a mileage log, a quarterly estimated-tax worksheet, and a one-click year-end package for the CPA. (It organizes records; it doesn't file or give tax advice.)

Design docs live in [`docs/`](docs):

| Doc | Covers |
|---|---|
| [architecture](docs/architecture.md) | Stack, offline sync, auth |
| [data model](docs/data-model.md) | Entities and relationships |
| [workflows](docs/workflows.md) | Step-by-step flows for each role |
| [screens](docs/screens.md) | Web and mobile screen inventory |
| [finance & tax](docs/finance-and-tax.md) | Job-cost, overtime and tax formulas |
| [roadmap](docs/roadmap.md) | Phases, open risks and decisions |

## Stack

TypeScript everywhere in a pnpm + Turborepo monorepo:

| Path | What |
|---|---|
| `apps/api` | Fastify + tRPC v11, Prisma 7 / PostgreSQL |
| `apps/web` | Next.js 16, Tailwind 4, TanStack Query |
| `apps/mobile` | Expo SDK 58, Expo Router, SQLite offline outbox |
| `packages/shared` | Domain logic: overtime, job cost, shifts, pay periods, tax map, 1099 and estimated-tax rules, zod schemas |
| `packages/db` | Prisma schema, migrations, demo seed |
| `packages/api-client` | Typed tRPC client shared by web and mobile |

## Getting started

Requires Node 22+, pnpm 10, and PostgreSQL. You can run Postgres with Docker (`docker compose up -d`) or use any local Postgres.

```bash
cp .env.example .env            # set DATABASE_URL if not using docker compose
pnpm install                    # also generates the Prisma client
pnpm db:migrate                 # apply migrations
pnpm db:seed                    # demo company "Acme Homes" (wipes existing rows in that database)
pnpm dev                        # API on :4000, web on :3000
pnpm mobile                     # Expo dev server: press i (iOS simulator) / a (Android) or scan with Expo Go
```

Demo logins all use the password `timepeace`:

| Login | Role |
|---|---|
| `owner@acme.test` | owner (everything) |
| `manager@acme.test` | manager |
| `hr@acme.test` | HR / payroll |
| `accountant@acme.test` | accountant (finance read-only; tax center) |
| `jake@acme.test`, `luis@`, `sam@`, `dana@`, `tyler@` | W-2 workers (mobile) |
| `rosa@acme.test` | 1099 electrician |

On a physical phone, set `EXPO_PUBLIC_API_URL` to your computer's LAN address, e.g. `http://192.168.1.20:4000`.

## Tests

```bash
pnpm --filter @timepeace/shared test     # domain unit tests (overtime, job cost, shifts, 1099, estimates, DST…)
pnpm --filter @timepeace/mobile test     # offline outbox flush logic

# API integration tests need a disposable database whose name ends in _test
TEST_DATABASE_URL=postgresql://…/timepeace_test pnpm --filter @timepeace/api test

# Browser end-to-end (starts API + web; DB name must end in _test or _e2e)
E2E_DATABASE_URL=postgresql://…/timepeace_e2e pnpm --filter @timepeace/web test:e2e

pnpm typecheck
```

## License

GPL-3.0. See [`LICENSE`](LICENSE) and the App Store note in [`docs/roadmap.md`](docs/roadmap.md).
