# Operations runbook

For whoever runs the system day to day: deploying, backups, restoring, and what to do when something goes wrong.

## 1. Accounts the business needs (in the business's name)

| Service | Used for | Plan |
|---|---|---|
| GitHub | Code, automatic tests, nightly backups | Free |
| Vercel | Hosting the app, scheduled jobs | Pro recommended (Hobby runs scheduled jobs once a day only; alerts still work because staff screens trigger them) |
| Supabase | PostgreSQL database and file storage | Pro recommended (daily backups, no pausing) |
| Domain registrar | e.g. `order.yourrestaurant.pk` | — |
| Resend (optional) | Password-reset and alert e-mails | Free tier is enough |
| SMS gateway (optional) | Phone verification codes, urgent alerts | Any local provider with an HTTP API |
| Meta WhatsApp Business (optional) | WhatsApp alerts and customer order updates | Per-message pricing |

Keep every password, key and the **backup passphrase** in a password manager the owner controls.

## 2. First deployment

1. **Supabase:** create a project in the Mumbai (ap-south-1) region. Copy the *Transaction pooler* URL (port 6543) and the *Session* / direct URL (port 5432). In Storage, create a **public** bucket `public-assets` and a **private** bucket `private-docs`.
2. **Vercel:** import the GitHub repository. Set these environment variables for *Production*:

   | Variable | Value |
   |---|---|
   | `DATABASE_URL` | Supabase transaction pooler URL (port 6543) |
   | `DIRECT_URL` | Supabase direct/session URL (used only for migrations) |
   | `BETTER_AUTH_SECRET` | 32+ random bytes, e.g. `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"` |
   | `BETTER_AUTH_URL` | `https://your-domain` |
   | `DATA_ENCRYPTION_KEY` | another 32+ random bytes (**different** from the auth secret) |
   | `CRON_SECRET` | 24+ random characters |
   | `STORAGE_DRIVER` | `supabase` |
   | `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | from Supabase → Project settings → API |
   | optional | `RESEND_API_KEY`, `EMAIL_FROM`, `SMS_*`, `WHATSAPP_*` (see `.env.example`) |

   Do **not** set `SEED_DEMO_USERS` or `SEED_DEMO_DATA` in production.
3. Deploy. The build (`npm run vercel-build`) applies migrations automatically for production deployments only. On the Vercel **Hobby** plan, first change the schedule in `vercel.json` to once a day (`"0 22 * * *"`), because Hobby rejects more frequent cron jobs; alerts still arrive through staff screens.
4. Seed the base data once from your computer, pointing at production (put these in a temporary `.env.production.local`, not in Vercel):
   `DIRECT_URL`, `DATABASE_URL` = the direct URL, `SEED_OWNER_EMAIL`, `SEED_OWNER_PASSWORD`, `SEED_OWNER_NAME`, `SEED_DEMO_USERS=false`, `SEED_DEMO_DATA=false`, then
   `npx dotenv -e .env.production.local -- npm run db:seed`
   It creates roles, permissions, default settings, expense categories and the owner account, and is safe to re-run. Delete the file afterwards.
5. Sign in at `https://your-domain/staff/login`, change the owner password, then work through the dashboard's *Finish setting up* list: business profile and logo, tax (confirm with your tax adviser), opening hours, receipt, delivery areas, menu, staff accounts with PINs, tills.
6. Add your domain in Vercel and point DNS to it. HTTPS is automatic.
7. In GitHub → Settings → Secrets, add `BACKUP_DATABASE_URL` (direct URL) and `BACKUP_PASSPHRASE`, then run the *Database backup* workflow once by hand and check it is green.

## 3. Releasing changes

1. Open a pull request; CI runs type checks, lint, unit, integration and end-to-end tests.
2. Merge to `main`. Vercel deploys; migrations run first. A failed migration stops the deploy and the previous version keeps running.
3. If a release misbehaves, use Vercel → Deployments → *Promote* the previous deployment (instant rollback). Migrations are forward-only: fix forward with a new migration rather than editing an applied one.

## 4. Backups

- **Nightly (GitHub Actions, `backup.yml`):** full `pg_dump` at 03:00 PKT, restored into a temporary database to prove it works, encrypted with `BACKUP_PASSPHRASE`, kept 30 days as a private artifact.
- **Supabase:** daily backups on Pro (7 days); point-in-time recovery is an add-on.
- **Weekly (manual, 2 minutes):** download the latest backup artifact and store it somewhere outside GitHub and Supabase (e.g. the owner's Google Drive). Losing the passphrase means the backups cannot be opened.
- **Files** (logos, menu photos, receipts) live in Supabase Storage; download the `private-docs` bucket monthly if receipts matter for tax.

## 5. Restoring

To a scratch database first, always:

```bash
gpg --decrypt food-erp-YYYYMMDD-HHMM.dump.gpg > restore.dump
createdb restore_check
pg_restore --no-owner --no-acl --exit-on-error -d restore_check restore.dump
psql -d restore_check -c "select count(*) from orders"
```

To replace production (only after the owner agrees, during closed hours):

1. Turn online ordering off (Settings → Ordering) and stop using the POS.
2. In Supabase, restore a daily backup (Database → Backups), **or** restore the dump into the production database with `pg_restore --clean --if-exists --no-owner --no-acl -d "<direct url>" restore.dump`.
3. Run `npx prisma migrate deploy` against it, open the app, check today's orders and the latest audit entries, then reopen ordering.

Keep `DATA_ENCRYPTION_KEY` with the backups: restored CNIC/bank details cannot be read without the same key.

## 6. When something goes wrong

| Situation | What to do |
|---|---|
| Internet down at the counter | Keep the POS screen open and take **cash**. Sales are saved on the till ("Offline · N to sync") and sent automatically when the connection returns. Card payments, coupons and points wait for the connection. Do not clear the browser data on that till. |
| An offline sale shows an error after reconnecting | Open the *Offline* button in the POS header. Read the reason (e.g. shift closed), fix it (open a shift) and press *Retry*, or *Discard* and enter the sale by hand. |
| Online orders not appearing | Check *Settings → Ordering* (paused?), opening hours, and the store status on the website. The dashboard shows waiting orders; urgent alerts fire when one is not accepted in time. |
| Site down | Check `https://your-domain/api/v1/health` (database status), Vercel status and Supabase status pages. Roll back the last deployment if it started after a release. |
| Cash short at closing | The shift shows the difference; the manager reviews it under *Cash shifts* and approves it with a note. Large differences raise an alert. |
| Staff member leaves | Set their user to *disabled* (Users) and their employee profile to *Left*. Their PIN and sessions stop working immediately. |
| Suspected account misuse | Disable the user, check the *Audit log* filtered by that user, change the owner password, and rotate `BETTER_AUTH_SECRET` (signs everyone out). |
| Encryption key exposed | Generate a new key, run a re-encryption job (decrypt with the old key, encrypt with the new) before switching; ask the developer. Never just replace the key: existing CNICs would become unreadable. |

## 7. Routine checks

- Daily: shift closing differences; "Needs attention" on the dashboard.
- Weekly: backup workflow green; download a backup copy; low-stock report; overdue supplier invoices.
- Monthly: payroll; estimated profit report; review users and roles; review the audit log for discounts, refunds and voids.
