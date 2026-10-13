# Phase log

## Approved decisions (2026-10-12)

The owner approved the architecture with the recommended defaults:

| # | Decision | Value |
|---|---|---|
| 1 | Architecture | Single Next.js modular monolith, Prisma, Better Auth, Supabase + Vercel |
| 2 | Phase order | Kitchen display before customer ordering; minimal delivery pulled into Phases 3–5 |
| 3 | Stock deduction point | When the order enters PREPARING (setting, changeable) |
| 4 | Negative stock | Allowed, with alerts (setting) |
| 5 | Dine-in | Off at launch (setting); table management later |
| 6 | Online payment | Cash on delivery / pay at pickup at launch; gateway later |
| 7 | Customer login | E-mail + password at launch; phone OTP in Release 2 |
| 8 | Tax | Configurable per payment method; **off until the owner confirms rates with a tax advisor** |
| 9 | Language | English at launch |
| 10 | Hosting accounts | Created in the business's name |
| 11 | Local database | Embedded PostgreSQL (`npm run db`), because Docker is not installed |

---

## Phase 1 — Foundation ✅ (2026-10-12)

### Delivered

- **Project:** Next.js 16.4 (Cache Components on), TypeScript strict, Tailwind 4, shadcn/ui (Radix, Nova preset) with a warm brand theme and dark mode, ESLint client/server boundary, Prettier, GitHub Actions CI.
- **Database:** Prisma 7 multi-file schema, 2 migrations, local embedded PostgreSQL 17, idempotent seed.
  - Tables: `branches`, `pos_terminals`, `settings`, `business_hours`, `business_hour_exceptions`, `number_sequences`, `files`, `users`, `sessions`, `accounts`, `verifications`, `rate_limits`, `roles`, `permissions`, `role_permissions`, `user_roles`, `audit_logs`, `outbox_events`.
  - Hand-written SQL: append-only trigger on `audit_logs`, reusable `app_block_delete()` for later financial tables, case-insensitive unique e-mail, `NULLS NOT DISTINCT` uniques for global settings and role grants, `app_enable_rls()` lockdown applied to every table.
- **Authentication:** Better Auth with database sessions (12 h), httpOnly SameSite=Lax cookies (Secure in production), scrypt hashing, public sign-up disabled, database-backed rate limiting (5 sign-ins per minute), disabled accounts blocked from creating sessions, last-login tracking.
- **RBAC:** 54 permissions across 20 modules seeded from one catalog, 5 system roles matching the approved matrix, custom roles, permission matrix editor, `authorize()` in every service function, Owner role locked to all permissions, last-owner protection.
- **Business settings:** 9 typed sections validated by Zod (profile, finance/tax, ordering, delivery, POS & cash, inventory, receipt, numbering, loyalty) plus weekly opening hours with past-midnight support and logo upload (local disk in development, Supabase Storage in production; PNG/JPG/WebP with content sniffing, no SVG).
- **Audit log:** written in the same transaction as each change, only changed fields recorded, secrets redacted, viewer with filters, keyset pagination and before/after comparison.
- **Admin layout:** collapsible sidebar filtered by permission, user menu with dark mode and sign-out, setup checklist dashboard, guarded placeholder screens for POS, kitchen and rider so role routing works now.
- **Users:** list/search, create, edit roles and status, reset password, set/clear POS PIN. Role changes and disabling end the user's sessions immediately.
- **Public home page:** temporary storefront reading name, contact and hours from settings.
- **Security headers:** CSP, frame-ancestors none, nosniff, referrer policy, permissions policy, HSTS in production.

### Verification

| Check | Result |
|---|---|
| `npm run typecheck` | Pass |
| `npm run lint` | Pass, 0 warnings |
| Unit tests | 23 passed |
| Integration tests (real PostgreSQL) | 27 passed |
| End-to-end (desktop, mobile, tablet) | 22 passed |
| Browser console errors on Phase 1 screens | None (asserted by E2E) |
| `npm run build` | Pass |
| Seed re-run | Idempotent |
| Migration drift check | None |

### Bugs found and fixed during the phase

- `timeAgo` showed "1 min ago" for 30 seconds (rounding); now floors.
- Forms accepted typing before React hydrated, which concatenated old and new values on save (caught by E2E). Forms now stay disabled until hydrated.
- Role matrix checkboxes were misaligned with their column headers.

### Notes and deviations

- **Business-day cutoff** lives in the `ordering` settings (per-branch capable) instead of a column on `branches`.
- **Staff need an e-mail** to sign in (Better Auth requirement). Staff without e-mail can use a made-up address such as `ali@staff.local`. PIN sign-in on shared POS terminals arrives with the POS in Phase 3; PINs can already be set.
- **Employees** (HR profile, national ID, salary) are a separate table in Phase 7, linked to users.
- **`E2E_DISABLE_RATE_LIMIT`** turns off sign-in rate limiting for automated tests only and is ignored on Vercel production.
- Prisma blocks `migrate reset` when run by an AI agent without the owner's consent. Schema changes are therefore applied as normal forward migrations.

---

## Phase 2 — Menu ✅ (2026-10-12)

### Delivered

- **Tables:** `categories`, `products`, `product_variants`, `addon_groups`, `addons`, `product_addon_groups`, `product_removable_options` (migration `menu`, RLS on, case-insensitive unique active category names).
- **Products:** list with search, category and status filters (on sale / out of stock / hidden) and an inline in-stock switch; full editor with sizes (each with its own full price and cost, one default), add-on groups, removable ingredients ("No onions"), photo upload, deal type, prep time, POS / online / featured visibility, live food-cost %, archive.
- **Categories:** create, edit, image, hide, reorder, archive (blocked while products remain).
- **Add-on groups:** options with price, cost and stock switch; min/max selection rules ("Required · pick 1" for deal drinks).
- **Catalog read model** (`getCatalog("POS" | "ONLINE")`) shared by the POS and the customer site.
- **Rules:** archive instead of delete for products, variants, add-ons and categories; auto SKU (e.g. `CW-001`) and slugs; separate `product.price.change` audit entries with before/after prices; users without `menu.price.change` can edit details but not prices; cashier and kitchen can only toggle stock.
- **Demo data:** 6 categories, 21 products, 7 add-on groups (`SEED_DEMO_DATA=true`, skipped when a menu exists).

### Verification

| Check | Result |
|---|---|
| Typecheck, lint | Pass |
| Unit + integration | 61 passed (11 new menu tests) |
| End-to-end | 27 passed (5 new menu tests; menu screens added to the console-error check) |
| Build | Pass |

### Bugs found and fixed

- With sizes, the hidden single-price field still had to be filled, so saving failed silently. The single price is now required only without sizes, and any blocked save shows a message.
- Typing letters into a price crashed the editor (live food-cost calculation). It now ignores invalid input.

---

## Phase 3 — POS & Orders ✅ (2026-10-12)

### Delivered

- **Tables** (migration `orders_pos`): `customers`, `customer_addresses`, `delivery_zones`, `orders`, `order_items`, `order_item_addons`, `order_item_removals`, `order_status_history`, `order_discounts`, `payments`, `refunds`, `deliveries`, `held_orders`, `cash_shifts`, `cash_transactions`, `throttles`. Delete-blocking triggers on every financial table, one open shift per till, refund ≤ paid check, positive amounts.
- **Order core:** shared pricing engine (discount → service charge → tax by payment method, inclusive or exclusive → delivery → cash rounding), server re-pricing from the live menu, required-choice and size validation, daily order numbers using the business-day cutoff (`261012-0042`, display `#42`), idempotent creation (double taps and retries never duplicate), optimistic locking against stale screens, status machine with per-status permissions, cost snapshots for profit reporting, outbox events for Phase 4 realtime.
- **Payments & money:** cash with tendered/change, card, online (manual reference), optional split payments, pay-later for phone and delivery orders, refunds (partial/full, cash leaves the drawer), cancellation that refunds automatically, customer totals kept in step.
- **Manager approval:** discounts above the cashier limit, cancellations and refunds by cashiers need a manager PIN; PINs are unique and attempts are throttled; approvals are stored in the audit log.
- **POS:** full-screen touch layout, category tabs, search (`/` shortcut), one-tap add, options dialog, cart persisted on the device, takeaway / delivery / dine-in, phone-order toggle, customer search by phone with saved addresses and delivery areas, discounts, hold/resume, payment screen with quick-tender buttons and keypad, success screen with big order number and change, auto-printed receipt and kitchen ticket, live orders panel (next step, take payment, reprint, cancel), cash shift open / pay-in / pay-out / close with note counting, PIN user switch and idle lock.
- **Printing:** 80 mm / 58 mm receipt and kitchen ticket views (browser printing; renderer-neutral receipt model for ESC/POS later).
- **Admin:** orders list with filters and pagination, order detail with timeline, payments, refunds and actions; cash shift history, reconciliation and approval; customers list, profile, order history, favourites, block flag; delivery areas.
- **Demo data:** 4 delivery areas and 8 customers with addresses.

### Verification

| Check | Result |
|---|---|
| Typecheck, lint | Pass |
| Unit + integration | 89 passed (17 new order/shift tests, 11 new pricing tests) |
| End-to-end | 35 passed (8 new POS tests) |
| Build | Pass |

### Bugs found and fixed

- GET API routes were prerendered at build time and the error wrapper hid Next.js's bail-out signal; API handlers now always run per request.
- Closing a shift removed the result screen before the cashier could read the shortage.
- Shift summary ran parallel queries on a single transaction connection.
- The POS "All" tab mixed categories.

### Notes

- Tax uses the cash rate unless every payment is card/online; pay-later orders are taxed at the cash rate.
- Prisma 7 logs a `pg` deprecation warning for nested creates inside transactions. It comes from Prisma's engine, is harmless on `pg` 8 (pinned), and must be rechecked before moving to `pg` 9.

---

## Phase 4 — Kitchen display, live updates & riders ✅ (2026-10-12)

### Delivered

- **Live updates:** authenticated Server-Sent Events stream (`/api/v1/events`) fed by the transactional outbox; branch-filtered, IDs and statuses only; resumes with `Last-Event-ID`; each connection ends after ~4.5 min to suit serverless limits and reconnects automatically. Screens fall back to polling (5 s when offline). No external realtime service is needed; Supabase Realtime can be added later behind the same events.
- **Kitchen display (`/kitchen`):** New / Preparing / Ready columns, large tickets with removals in red and notes highlighted, live waiting timer, amber warning at 75 % of expected prep time and red pulsing when late, one-tap Accept / Start / Ready with stale-screen protection, optional chime for new orders, full-screen mode, out-of-stock panel.
- **Order-ready board (`/display`):** customer-facing TV with Preparing and Ready numbers.
- **Riders:** assign / change / remove from the POS orders panel and the admin order page; rider app (`/rider`) shows only the rider's own deliveries with call, WhatsApp and map buttons, amount to collect, Picked up → Delivered, and problem reporting with a reason.
- **Rider cash:** POS "Rider cash" sheet lists delivered cash-on-delivery orders per rider; receiving it records cash payments and a rider-settlement entry in the till's shift.
- **POS** refreshes its orders panel and menu availability live.
- **Security:** the generic status change no longer accepts the rider permission; riders can only update deliveries assigned to them.

### Verification

| Check | Result |
|---|---|
| Typecheck, lint | Pass |
| Unit + integration | 96 passed (7 new kitchen/delivery/event tests) |
| End-to-end | 36 passed (new two-screen live test: POS → kitchen → board → rider → cash settlement) |
| Build | Pass |

### Bugs found and fixed

- A rider could have completed someone else's delivery through the generic status endpoint.
- The kitchen out-of-stock panel used an endpoint kitchen staff are not allowed to call.

---

## Phase 5 — Customer website & installable app ✅ (2026-10-12)

### Delivered

- **Storefront** (mobile-first, richer motion): home with live open/closed status, hero, customer favourites and categories; menu with sticky category tabs that follow scrolling, search, product cards, options dialog, deep links (`/menu?item=slug`), favourites heart for signed-in customers; cart persisted on the device; sticky mobile cart bar; contact page with call, WhatsApp, directions and hours.
- **Checkout:** delivery or pick-up, guest or signed-in, saved addresses, delivery areas with live charge / minimum / free-above, server quote identical to the final total, cash on delivery or pay at pickup, idempotent placement, PWA vs website source detection.
- **Ordering rules:** opening hours with past-midnight and holiday exceptions, online on/off switch, POS "Pause online orders (30 min)" / "Resume", area minimum, blocked-customer refusal, per-IP throttles (checkout 8 / 10 min, quotes, tracking, registration).
- **Restaurant side:** online orders arrive as New (or auto-accepted per settings) with a POS chime and toast; staff accept them from the orders panel.
- **Tracking:** private link per order (`/order/<token>`), status timeline, ETA, rider first name, totals; no phone or address exposed; refreshes every 10 s until final.
- **Accounts:** register, sign in, password reset by e-mail (Resend when `RESEND_API_KEY` is set, otherwise logged in development), profile, order history with "Order again", saved addresses, favourites. Staff and customer accounts are kept apart.
- **Privacy rule:** registering with a phone number that already has phone orders links the CRM record, but the account shows only orders and addresses from after registration until phone verification (Phase 9).
- **Installable app:** web manifest, icons generated from the business name, service worker (network-first pages with offline page, cache-first build assets, never caches API data).
- **Tables:** `customer_favorites`; `customers.linked_at`, `customers.phone_verified_at`.
- **Caching:** public menu and business info cached with tags `menu` / `settings`, refreshed immediately on change.

### Verification

| Check | Result |
|---|---|
| Typecheck, lint | Pass |
| Unit + integration | 111 passed (15 new: opening hours, checkout, tracking privacy, throttling, accounts) |
| End-to-end | 42 passed (guest order → POS accept → tracking update; register → order → history → reorder; storefront on phone and tablet) |
| Build | Pass |

### Bugs found and fixed

- The test pipeline built the app before re-seeding, so the cached menu referenced deleted products; the test database is now prepared before the build.
- The "who am I" endpoint answered visitors with 401, which browsers log as an error; it now returns an empty result.

---

## Phase 6 — Inventory ✅ (2026-10-12)

### Delivered

- **Tables** (migration `inventory`): `ingredients`, `ingredient_units`, `ingredient_stock`, `inventory_transactions` (append-only ledger), `recipes` (exactly one target: product, size or add-on), `recipe_items`, `stock_counts`, `stock_count_items`, `wastage`, `suppliers`, `supplier_ingredients`, `purchases`, `purchase_items`, `supplier_payments`; removable options link to an ingredient.
- **Units:** stock in base units (g, ml, pieces) with kg / litre / dozen built in and per-ingredient purchase units (box = 50 pcs, tin = 16 l …).
- **Automatic deduction:** when an order reaches the configured stage (default Preparing; Accepted or Completed selectable), the size recipe (or base recipe) × quantity plus add-on recipes are deducted, skipping ingredients of removed options ("No onions"). Never deducted twice. Orders cancelled after deduction create wastage records (reason "Cancelled order") instead of returning food to stock. Negative stock is allowed and flagged low; a low-stock event is emitted when crossing the minimum.
- **Costing:** weighted average cost per ingredient; purchase discounts/tax spread into landed cost; recipe cost rolls into product, size and add-on cost, which every order line snapshots for profit reporting; food-cost % shown per item.
- **Screens:** Ingredients & stock (value, low-stock count, quick adjust), ingredient page with editable details and full movement ledger, stock counts (count sheet, live variance, post), recipe overview and editor (base / sizes / add-ons / removable links) with live cost, wastage log with totals by reason and a quick record dialog (ingredient or finished item), suppliers with outstanding balances and history, purchases (draft → receive → pay; duplicate invoice check; due dates and overdue badges), supplier payments by bank, cheque, card, cash, or cash from the till (recorded in that shift).
- **Roles:** Owner/Manager manage everything; Cashier and Kitchen view stock and record wastage; Riders have no access.
- **Demo data:** 38 ingredients, 5 suppliers, 34 recipes covering the whole demo menu, add-on recipes, removable links, 4 received purchases (some unpaid).

### Verification

| Check | Result |
|---|---|
| Typecheck, lint | Pass |
| Unit + integration | 122 passed (11 new: the exact 10-burger deduction, removals and add-ons, deduction point, cancellation wastage, negative stock, cost roll-up, pack purchases and average cost, supplier balance and till payment, stock count variance, wastage permissions, ledger immutability) |
| End-to-end | 47 passed (5 new: receive purchase, pay invoice, edit recipe, kitchen wastage, stock count) |
| Build | Pass |

### Notes

- `prisma migrate dev` hung in this non-interactive shell after applying; migrations are applied with `prisma migrate deploy` from now on (same result, no prompts).
- Refund "restock" is stored but does not return ingredients (food served cannot be restocked); corrections use stock adjustments.

---

## Phase 7 — Business management ✅ (2026-10-12)

### Delivered

- **Tables** (migration `people_expenses`): `expense_categories`, `expenses`, `work_shifts`, `employees`, `attendance`, `employee_advances`, `payroll_runs`, `payslips`, `payslip_lines`. Payroll settings section added (daily-rate basis ÷30 / ÷26 / calendar days, unrecorded days paid or unpaid, one day deducted per N lates, overtime multiplier and minimum, standard shift hours).
- **Expenses:** every payout except supplier invoices is an expense (`EXP-00001`). Cash from the till needs an open shift (the cashier's own unless they manage expenses) and enough cash; it writes a drawer movement, so shift closing already accounts for it. Void (reason required) puts till cash back while the shift is open; till amounts cannot be edited. Receipts (photo or PDF, 5 MB, content-checked) are stored privately and served only to the manager or the person who recorded it. Categories editable; *Salaries* and *Salary advances* are reserved for payroll. Cashiers can record a bill from the POS shift screen.
- **Employees:** code `EMP-001`, optional link to a staff login, shift, weekly day off, pay type (monthly / daily / hourly), overtime rate. CNIC and bank account are AES-256-GCM encrypted (`DATA_ENCRYPTION_KEY`), visible only with `employees.sensitive`; every decrypted view is audited, and audit entries never contain the values.
- **Attendance:** daily sheet (status, check-in/out, late, worked and overtime minutes, shifts past midnight, "mark the rest present"), monthly summary with days missing an entry, and a self-service time clock (server time, once per day) reachable from the admin menu, the kitchen display and the rider app. A `source` column (manual / self / biometric / import) is ready for a fingerprint device later.
- **Advances:** paid out as an expense; recovered from payroll per instalment, oldest first, never below zero net pay; cancellable while nothing is recovered.
- **Payroll:** draft run for a month or custom period → automatic payslips (basic or pro-rated, absences, unpaid leave, half days, late rule, overtime, advances) → manual bonus / fine lines (kept on recalculation) → approval (owner) with version check → pay per employee or all at once by bank, cash or till. Paying creates a *Salaries* expense and marks advance recovery. Approved payslips and the attendance they cover are frozen by database triggers. Printable A5 salary slip.

### Accounting note
Cash basis: an advance is an expense when paid, and the salary expense is the net paid, so total staff cost = advances + salaries paid, with no double counting.

### Verification

| Check | Result |
|---|---|
| Typecheck, lint | Pass |
| Unit + integration | 146 passed (24 new: payslip rules for monthly, daily, hourly, pro-rating, lates, overtime, advances; attendance across midnight; expense till rules, voiding, cashier scope; CNIC encryption and masking; self check-in; payroll approval, freezing at DB level, payment and advance recovery) |
| End-to-end | 52 passed (5 new: receipt upload and private access, new employee + late arrival, full payroll cycle with slip, kitchen self check-in, cashier restrictions) |
| Build, migration drift | Pass, no drift |

### Fixed during the phase
- Method labels imported from a client module into a server page rendered empty; moved to `src/lib/expenses.ts`.

---

## Phase 8 — Reports & dashboard ✅ (2026-10-12)

### Delivered

- **19 reports** at `/admin/reports`, each with date presets (today, yesterday, this/last week, month, 30 days, year) and custom ranges up to a year:
  - *Sales:* daily sales, product sales (with estimated margin), category sales, sales by hour, payment methods (net of refunds), order sources, discounts (who gave / approved), refunds, cashier performance (incl. cash short/over), top customers (new and repeat).
  - *Money:* estimated profit, expenses by category, purchases and supplier balances, payroll.
  - *Stock:* stock valuation, low stock, wastage, ingredient usage.
  - *People:* attendance.
- **Definitions:** a sale is an accepted, non-cancelled order dated by its business day; refunds are shown separately; profit = sales − tax − refunds − recipe food cost − wastage − expenses (salaries and advances included when paid). Labelled as an estimate, with notes when items have no recipe cost.
- **Exports:** Excel (.xlsx, built in-house: frozen header, money format, totals row), CSV (UTF-8 with BOM, spreadsheet-formula injection neutralised), and an A4 print layout for "Save as PDF". Every export is audited.
- **Permissions:** operational reports for managers; profit and payroll require `reports.financial` (owner by default); enforced on pages, exports and print views.
- **Dashboard:** today's net sales vs the same day last week, orders (online share), average order and food cost %, expenses; 14-day chart; live order counts; cash in open tills; staff present; "needs attention" (orders waiting, low stock, overdue supplier invoices, shift differences, payroll to approve/pay); best sellers; the set-up checklist shows only while unfinished. The old roadmap card is gone.
- **Charts** are plain CSS/SVG (no chart library downloaded to phones).
- **Demo data:** eight weeks of past orders (`SEED_DEMO_SALES`, on by default with demo data, off in the end-to-end database).

### Verification

| Check | Result |
|---|---|
| Typecheck, lint | Pass |
| Unit + integration | 151 passed (5 new: sales totals with discounts/refunds/cancellations, products/payments/discounts/refunds/cashiers agree with orders, profit arithmetic, every report runs, permission split, CSV injection and xlsx) |
| End-to-end | 55 passed (3 new: report navigation and exports, profit + print, manager/cashier restrictions incl. export API) |
| Build | Pass |

---

## Phase 9 — Advanced features ✅ (2026-10-12)

### Delivered

- **Coupons** (`/admin/coupons`): % off (with optional cap), Rs off, or free delivery; minimum order; start/end; total and per-customer limits (by account or phone, so guests cannot reuse them); first-order-only; online / counter / both. Validated on the server for quotes and orders, never trusted from the browser; uses counted atomically (the last use cannot be taken twice); cancelling an order gives the use back. Cannot be combined with a staff discount. Coupon-code guessing is throttled.
- **Loyalty points**: earned on completed orders (items after discounts), redeemed as a discount at the POS (for a chosen customer) or online (signed-in account with a **verified phone**), capped by the "max % of order" setting; cancellations return used points and take back earned ones; refunds take back points in proportion; points expire FIFO via the scheduled job. Append-only ledger enforced by a database trigger; balance never negative. Staff can adjust with a reason (audited). Shown on the customer page and the customer's account.
- **Notifications**: bell with unread count in the admin header and a full page. Generated from the event outbox: new online orders, online orders not accepted in time (urgent), large refunds, shift cash differences, low stock, supplier payments due / overdue. Each alert goes to staff holding the relevant permission, once (dedupe keys). Urgent alerts can also be e-mailed / sent by SMS or WhatsApp ("Alerts & messages" settings).
- **Channel adapters**: e-mail (Resend), SMS (generic HTTP gateway) and WhatsApp Cloud API, configured by environment variables; every message is logged in `outbound_messages`; without a provider, messages are recorded as skipped. Optional customer updates (accepted, ready for pickup, on the way) with a tracking link.
- **Scheduled jobs**: `/api/cron/jobs` (protected by `CRON_SECRET`, `vercel.json` runs it every 5 minutes): event dispatch, unaccepted-order alerts, overdue invoices, point expiry, OTP clean-up. Staff screens also trigger it (at most every 5 s), so alerts work without a cron on the free plan.
- **Phone verification (OTP)**: 6-digit code by SMS/WhatsApp, stored as an HMAC, 10-minute expiry, 5 attempts, throttled per phone and IP. Verifying unlocks full order history and online use of points. In development without a provider the code is shown on screen.
- **Offline POS**: when the connection drops, cash sales are saved on the till (with their request id) and sent automatically when it returns; the server's idempotency key prevents duplicates, and the sale keeps its real business day (accepted up to 48 h late). Header shows Offline / "N to sync" with retry and discard. Card payments, coupons and points require a connection.
- **Deliveries board** (`/admin/deliveries`): needs a rider / assigned / on the road / delivered, with rider assignment, cash to collect, late orders outlined, auto-refresh, and cash held by riders.
- Split payment already existed (Phase 3). A card/online payment gateway was not added: it needs a merchant account (see Phase 10 list).

### Verification

| Check | Result |
|---|---|
| Typecheck, lint | Pass |
| Unit + integration | 165 passed (14 new: coupon maths, limits, dates, channels, per-customer and first-order rules, free delivery, cancellation; loyalty earn/redeem/cap/return/claw-back/expiry and ledger immutability; notification routing and dedupe, urgent alerts, shift difference alert; OTP verify/attempts/throttle; points need a verified phone; offline sync idempotency and age limit) |
| End-to-end | 59 passed (4 new: coupon at online checkout, alert bell, POS offline sale synced on reconnect, deliveries/notifications pages) |
| Build, migration drift | Pass, no drift |

### Fixed during the phase
- Background jobs were throttled for 20 s per server, so an alert could wait for the next poll; reduced to 5 s (claiming events is a single query).

---

## Phase 10 — QA & production readiness ✅ (2026-10-12)

### Security review
Full write-up: [SECURITY.md](SECURITY.md). Fixed: two service functions without permission checks (work-shift list, till list) and one unused unguarded helper; MySQL driver pulled in by the auth library pinned to a patched version; shadcn CLI moved to dev dependencies; production now refuses to start with missing/example secrets, a missing or reused encryption key, a non-https site URL or local file storage on Vercel. Verified: no unsafe raw SQL, no user HTML rendering, no secret values in the browser bundle, every API route authenticated except health, menu, store status, session check and token-based tracking. Accepted: CSP `'unsafe-inline'` (needed by Next.js without per-request nonces) and a build-time-only Prisma CLI advisory.

### Performance

| Measurement | Result |
|---|---|
| 19 reports over one year, 21,523 orders / 43,010 items | 4–122 ms each (sales 122 ms, products 102 ms) |
| Dashboard on the same data | 157 ms |
| 100 POS orders submitted at the same moment | 100 succeeded, 100 unique order numbers, all done in 2.0 s |
| Customer menu, mobile profile, cold load | 354 KB transferred (146 KB JavaScript), loaded in 1.9 s locally |
| POS reload (signed in) | 0.9 s, 39 KB transferred |

### Production preparation
- `npm run vercel-build`: migrations on production deployments only (previews never touch the live database), then build.
- `vercel.json`: scheduled jobs every 5 minutes (daily on the Hobby plan).
- `.github/workflows/backup.yml`: nightly `pg_dump`, test-restore into a throwaway database with row-count checks, AES-256 encryption, 30-day private artifact. CI gained the encryption key and cron secret it now needs.
- [RUNBOOK.md](RUNBOOK.md): accounts to open, first deployment step by step, releases and rollback, backups and restore, incident playbook (offline counter, failed sync, site down, staff leaving, key exposure), routine checks.
- `.env.example` documents every provider variable; unused Upstash variables removed.

### Verification

| Check | Result |
|---|---|
| Typecheck, lint | Pass |
| Unit + integration | 165 passed |
| End-to-end (desktop, mobile, tablet) | 59 passed |
| Build | Pass |
| Migrations | 8 applied, no drift |

### Not done here (needs the owner's accounts or decisions)
- Creating the Vercel, Supabase, GitHub, domain, e-mail, SMS and WhatsApp accounts and entering their keys (see RUNBOOK §1–2).
- First production deployment, seeding the owner account, DNS.
- The backup workflow has not run yet: it needs the production database URL and passphrase as GitHub secrets. The local machine has no `pg_dump`, so the restore drill runs in that workflow.
- Tax rates: left off until confirmed with a tax adviser.
- Card / online payment gateway: needs a merchant account.
