# Food ERP — POS, Kitchen, Online Ordering & Back Office

One system for a restaurant: POS, kitchen display, customer ordering, menu, inventory, purchasing, staff, payroll and reporting.
Architecture and roadmap: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). Phase log: [docs/PHASES.md](docs/PHASES.md).

**Stack:** Next.js 16 (App Router, TypeScript), Tailwind CSS 4 + shadcn/ui, PostgreSQL + Prisma 7, Better Auth, Zod, Vitest, Playwright.

---

## 1. Requirements

- Node.js 22.12 or newer (24 recommended)
- Git
- VS Code with the ESLint, Prettier, Prisma and Tailwind CSS extensions (recommended)

No Docker or PostgreSQL installation is needed for local development. The project runs its own PostgreSQL server from `node_modules` (`embedded-postgres`). If you already have PostgreSQL installed, point the URLs in `.env` at it instead.

## 2. First-time setup

```bash
npm install                 # installs dependencies and generates the Prisma client
cp .env.example .env        # then edit .env (see below)
```

In `.env`, set at least:

| Variable | What to put |
|---|---|
| `BETTER_AUTH_SECRET` | A long random string: `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"` |
| `DATA_ENCRYPTION_KEY` | Another long random string |
| `SEED_OWNER_EMAIL` / `SEED_OWNER_PASSWORD` | Your own Owner login |

Never commit `.env`. Only variables starting with `NEXT_PUBLIC_` reach the browser, and none of them may be secret.

## 3. Daily development

Open **two terminals** in VS Code.

**Terminal 1 — database** (keep it running):

```bash
npm run db
```

**Terminal 2 — app:**

```bash
npm run db:migrate          # apply migrations (first time and after pulling changes)
npm run db:seed             # roles, permissions, settings, Owner and demo staff (safe to re-run)
npm run dev                 # http://localhost:3000
```

Staff sign in at <http://localhost:3000/staff/login>.

Demo accounts (when `SEED_DEMO_USERS=true`), password from `SEED_DEMO_PASSWORD`:

| Role | E-mail | POS PIN |
|---|---|---|
| Owner | your `SEED_OWNER_EMAIL` | 1234 |
| Manager | manager@demo.local | 2222 |
| Cashier | cashier@demo.local | 3333 |
| Kitchen | kitchen@demo.local | 4444 |
| Rider | rider@demo.local | 5555 |

## 4. Commands

| Command | Purpose |
|---|---|
| `npm run dev` | Development server |
| `npm run build` / `npm start` | Production build / serve it |
| `npm run typecheck` | Generate route types and run TypeScript |
| `npm run lint` | ESLint (includes the client/server import boundary) |
| `npm test` | Unit + integration tests (integration uses the `food_erp_test` database) |
| `npm run test:unit` / `npm run test:integration` | One suite only |
| `npm run test:e2e` | Playwright end-to-end tests (builds the app, wipes and seeds `food_erp_test`) |
| `npm run check` | typecheck + lint + tests |
| `npm run db` | Start the local PostgreSQL server |
| `npm run db:migrate` | Create/apply migrations in development |
| `npm run db:deploy` | Apply migrations in production/CI |
| `npm run db:seed` | Seed base data (idempotent) |
| `npm run db:studio` | Browse the database |

First E2E run only: `npx playwright install chromium`.

## 5. Project layout

```
prisma/schema/        Prisma models split by module
prisma/migrations/    SQL migrations (including hand-written triggers and RLS lockdown)
prisma/seed/          Idempotent seed
src/app/              Routes: public site, /staff/login, /admin, /pos, /kitchen, /rider, /api
src/server/core/      Auth, RBAC, audit, db, errors, storage, settings plumbing (server-only)
src/server/modules/   Business services + server actions per module
src/lib/              Client-safe shared code: permission catalog, settings registry, money, formatting
src/components/       UI kit (shadcn) and shared components
tests/                unit, integration (real Postgres) and e2e (Playwright)
```

Rules that keep the system safe:

- Every service function starts with `authorize(ctx, "permission.key")`. Hiding a button is never the security check.
- Every sensitive change writes an audit entry in the same database transaction.
- Money is `Decimal` in the database and in code, never JavaScript floating-point numbers.
- `src/lib`, `src/components` and `src/hooks` must not import from `src/server` or Prisma (enforced by ESLint).

## 6. Database migrations

Each migration that adds tables must end with:

```sql
SELECT app_enable_rls();
```

This keeps Row Level Security on for every table, so Supabase's public Data API cannot read data. An integration test fails if any table is missing RLS.

## 7. Production

Vercel (app and scheduled jobs) + Supabase (PostgreSQL and file storage). Step-by-step deployment, environment variables, backups, restore and incident handling: [docs/RUNBOOK.md](docs/RUNBOOK.md). Security review: [docs/SECURITY.md](docs/SECURITY.md).

- `npm run vercel-build` applies migrations for production deployments only, then builds.
- The app refuses to start in production with missing or example secrets, or with local file storage on Vercel.
- `vercel.json` runs functions in Mumbai and `/api/cron/jobs` daily (every 5 minutes is possible on Pro); it is protected by `CRON_SECRET`.
- `.github/workflows/backup.yml` makes a nightly encrypted backup and test-restores it.
