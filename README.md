# HDLA OneFirm

The firm's operating platform: Work Plan, Time, Marketing, Billing, Exec, and a role-based home that says what needs you — on one shell, one visual system, and the same Supabase database the previous Hub used.

## Deploy (first time)
1. **Supabase** — run `db/onefirm.sql` once in the SQL Editor (additive, idempotent). It assumes the old Hub's SQL has already run, including `db/legacy/supabase-next-steps-planner.sql`.
2. **Vercel** — import this repo as a new project. Framework preset Next.js, defaults otherwise. Set every variable in `.env.example` (values from the old Hub's project; new ones for QuickBooks and `CRON_SECRET`). Deploy.
3. **Domain** — add `onefirm.hodgsondouglas.com` under Settings → Domains; set the CNAME at the DNS provider. Set `QBO_REDIRECT_URI` to `https://onefirm.hodgsondouglas.com/api/quickbooks/callback` and register the same URI on the Intuit app.
4. **QuickBooks** — sign in as a partner → Admin → Connect to QuickBooks → approve. The first pull runs immediately; the nightly pull is a Vercel cron (`vercel.json`, needs `CRON_SECRET`).

## Day to day
- Logins, access codes, and all data are shared with the old Hub; both can run at once. Approve invoices and let the Wednesday projection snapshot run on one site only until cutover.
- `docs/BUILD-RULES.md` is the contract for any change: shell, visual system, auth on every route, no secrets in code.
- `db/onefirm.sql` is the only place schema changes go.

## Structure
```
app/               pages: / (home), workplan (+ project/[id]), time, marketing, billing, exec, admin
app/api/           routes — every one verifies the caller (lib/apiAuth)
components/shell/  Shell (nav + page frame) and ui (Panel, Figure, Button, Pill, Table, Tabs…)
components/home/   the role home's panels
components/marketing-shared.js  touchpoint / lead forms and step helpers (shared by Marketing, Time, Home)
lib/               auth, authFetch (token on every /api call), supabase (browser), supabaseAdmin (server), graph (SharePoint/Outlook), masterdata, quickbooks, rates, phaseNames, invoicePdf
db/                onefirm.sql (new schema) and legacy/ (the old Hub's SQL and READMEs, for reference)
```
