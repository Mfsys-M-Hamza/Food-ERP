# Security review (Phase 10, 2026-10-12)

Scope: the whole application as delivered in Phases 1–9. Method: code review against the checklist below, automated scans, and the permission and abuse tests in the test suites.

## Controls in place

| Area | How it is handled | Verified by |
|---|---|---|
| Authentication | Better Auth, scrypt password hashes, database sessions in http-only cookies (secure in production, SameSite=Lax), public sign-up disabled for staff, login rate limited in the database. Staff PINs hashed, unique, locked after repeated failures. | `tests/integration/rbac-and-security`, `tests/e2e/auth` |
| Authorisation | Every service function starts with `authorize(ctx, permission)`; pages, server actions, API routes, exports and print views all go through services. Scoped rules on top (own shift, own expenses, assigned deliveries, own notifications). | Scan of all exported service functions (3 gaps found and fixed, see below); RBAC unit/integration/E2E tests |
| Database exposure | Row Level Security enabled on every table (Supabase's public API can read nothing); the app uses a server-side connection only. | Integration test fails if any table lacks RLS |
| SQL injection | Only parameterised Prisma queries and tagged `$queryRaw` templates; no `*Unsafe` raw SQL in application code. | grep scan |
| Cross-site scripting | React escaping; no user content rendered as HTML (the only `dangerouslySetInnerHTML` is a fixed print script). SVG uploads refused. | grep scan |
| CSRF | Server actions check the Origin header; cookies are SameSite=Lax; JSON API mutations need the session cookie, which cross-site requests do not send. | Framework behaviour, E2E |
| Uploads | Type allow-list, size limits, magic-byte check. Expense receipts stored privately and served only to permitted staff through an authorised route. | `tests/e2e/people` (anonymous receipt request refused) |
| Personal data | CNIC and bank account numbers encrypted (AES-256-GCM); visible only with `employees.sensitive`; every decrypted view is audited; audit entries never store the values. Customer phone verification by OTP (codes stored as HMAC, expiring, attempt-limited, throttled). | `tests/integration/people`, `tests/integration/notifications` |
| Money integrity | Decimal arithmetic only; prices recomputed on the server; idempotency keys on orders and payments; append-only ledgers (stock, loyalty, cash, audit) enforced by triggers; approved payroll frozen at database level. | Integration tests |
| Abuse limits | Throttles on checkout, quotes, coupon attempts, OTP requests, login. | Integration tests |
| Exports | CSV formula injection neutralised; every export audited. | `tests/integration/reports` |
| Secrets | Server-only modules (`server-only` + ESLint boundary). Built browser bundle scanned for secret values: none found. Production refuses to start with missing or example secrets, or with local file storage on Vercel. | Bundle scan, `src/server/core/env.ts` |
| Headers | CSP, HSTS (production), X-Frame-Options DENY, nosniff, Referrer-Policy, Permissions-Policy. | `next.config.ts` |
| Scheduled jobs | `/api/cron/jobs` requires `CRON_SECRET` (constant-time comparison). | Code review |

## Findings fixed in this review

1. `workShiftOptions` had no permission check (only shift names and times leaked to any signed-in user). Now requires employee or attendance management.
2. `listTerminals` could be called with a customer session (till names only). Now staff-only.
3. An unused helper without a permission check was removed.
4. Dependency audit: the MySQL driver pulled in by the auth library (never used, the app runs on Postgres) is pinned to a patched version; the shadcn CLI moved to development dependencies.
5. Production environment validation added (see Secrets above).

## Accepted risks and follow-ups

- **CSP allows inline scripts.** Next.js inline bootstrap scripts need `'unsafe-inline'` unless every page is rendered dynamically with a nonce, which would disable static/partial prerendering. React escaping and the absence of HTML rendering of user content keep the XSS surface small. Revisit if third-party scripts are ever added.
- **`deepmerge-ts` advisory (Prisma CLI config loader).** Only reads this project's own config file at build time; no untrusted input. Clears when Prisma updates the dependency.
- **Rate limits are per database**, which is correct for one region; heavy bot traffic should be handled by Vercel's firewall (bot protection / attack mode) rather than the app.
- **Card / online payment gateway** not integrated (needs a merchant account). When added, use the provider's hosted page and verify webhooks by signature; never handle card numbers.
- An external penetration test is recommended before handling online card payments.
