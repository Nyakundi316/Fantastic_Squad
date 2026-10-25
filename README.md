# FANTASTICZONE

Shop Smart. Save More. Preorders from China at buying price; goods ship together in batches and the batch shipping quote is split transparently across orders once everything is measured.

Next.js 14 (App Router) · TypeScript · Tailwind + shadcn/ui · Prisma + PostgreSQL 15 · TanStack Query · Zod · Vitest · Playwright.

## Run it locally

```bash
cp .env.example .env          # then set AUTH_SECRET (32+ chars)
npm install
npm run db:up                 # Postgres 15 in Docker (dev, test and shadow databases)
npm run db:deploy && npm run db:seed
npm run dev                   # http://localhost:3000
```

Sign in with a phone number. With `SMS_PROVIDER=console` the code is printed in the server log. Seeded accounts:

| Role | Phone |
| --- | --- |
| admin | 0803 000 0001 |
| ops | 0803 000 0002 |
| finance | 0803 000 0003 |
| customer | 0803 000 0004 |
| dropshipper | 0803 000 0005 |

## Scripts

| Command | What it does |
| --- | --- |
| `npm run ci` | typecheck, lint, migration drift check, tests |
| `npm test` / `npm run test:coverage` | Vitest unit + integration (integration uses `TEST_DATABASE_URL`) |
| `npm run e2e` | Playwright: builds must exist (`npm run build`); seeds the DB, starts a fake Paystack and `next start` on :3100 |
| `npm run db:migrate` | create/apply a migration in development |
| `npm run db:check` | fail if `schema.prisma` and migrations disagree |

The allocation algorithm (`src/server/allocation/allocate.ts`) has a 100% coverage threshold; `npm run test:coverage` fails below it.

## How money and shipping work

- Money is `numeric(12,2)` in Postgres, `Prisma.Decimal` in code and 2 dp strings in the API. Weights are integer grams, dimensions integer mm. The client never totals anything it saves.
- Orders join the soonest-closing open batch for their ship method (one batch per method).
- Closing a batch confirms paid orders and cancels unpaid ones. Measurements are entered per unit; every change is in `audit_log`.
- The split is previewed (never stored), then approved once: allocations, v1 shipping invoices, order totals and notifications in one transaction. A second approval is 409. Preview and approval must match (fingerprint), otherwise 409 `preview_stale`.
- Invoices never change except `status`/`paid_at` (a database trigger enforces it). Corrections are new versions that supersede the old one.
- Paystack webhooks are verified (HMAC-SHA512) and idempotent by reference. Without Paystack keys the app falls back to bank transfer + finance marking invoices paid.
- Unpaid orders still travel with their batch but are held at the destination until shipping is paid.

## Notifications

Seven templates (`src/server/notifications/templates.ts`), editable in `/admin/settings`. Rows are queued inside the transaction that triggers them, sent right after commit (2 s budget) and by `/api/cron/notifications` every 5 minutes (Vercel Cron, `CRON_SECRET`). The cron run also queues "due in 3 days" reminders. WhatsApp Cloud API needs Meta-approved templates with the same names; `WHATSAPP_PROVIDER=console` logs instead. Customers can switch off reminder channels in `/account`; essential messages always go out. In-app notifications appear in the header bell.

## Deploying (Vercel + Neon/Supabase)

Set the variables in `.env.example`. `vercel.json` registers the cron (every 5 minutes needs a Pro plan; Hobby allows daily). Run `prisma migrate deploy` against the production database before the first deploy. Sentry and PostHog stay off until their keys are set.

## Known limits

- The API rate limit (100/min per user) is in memory, per server instance. Use Redis for a global limit.
- The product-price invoice for dropshippers' own customers ("resale invoice" in the brief) is not built yet.
- Carrier tracking, multi-currency and automated freight quotes are out of scope for the MVP.
