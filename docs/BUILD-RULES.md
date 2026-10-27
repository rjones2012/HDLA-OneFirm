# OneFirm build rules

Read before touching any page or route.

## What this is
The HDLA Hub, rebuilt on one shell with one visual system, on the SAME Supabase database and SharePoint Master Data.
Every interaction people use today must keep working exactly as it does. We change chrome, navigation, and add features; we do not change business rules.

## Routes
- Pages live at `/`, `/workplan`, `/time`, `/marketing`, `/billing`, `/exec`, `/admin`. No `[code]` segment.
- The old Planner page is gone; the role-based home at `/` replaces it (`app/page.js`).

## Shell and components
```js
import { Shell } from '../../components/shell/Shell';
import { Panel, Figure, Button, Link, Pill, Table, Tabs, Input, Select, Textarea, Label, Checkbox, Empty, Modal, fmt$, fmtDate } from '../../components/shell/ui';

export default function Page() {
  return <Shell module="billing" eyebrow="Billing · October 2026" title="Billing" actions={<Button>+ Draft</Button>}>…</Shell>;
}
```
- `Shell` handles login, role gating (via `lib/auth.js` MODULES / ACCESS_MATRIX), nav, page header. Do not wrap in `AuthGate` any more; do not render your own `← Hub` link, page title block, or sign-out.
- Module tabs inside a page use `Tabs`. Panels use `Panel` (black rule under the title; `meta` says where the numbers come from and when).
- Tables: `Table` or a plain `<table className="of-table">` — black header, hairline rows, `tr.of-total` for totals, `tr.of-mine` for the signed-in person's row.

## Visual system (non-negotiable)
- Type: Flecha M for h1/h2/h3 and big figures (`font-flecha`), Lato for everything else. Body weight 300, labels 400, emphasis/buttons 700.
- Colors: ink `#141414`, muted `#5C5C58`, rule `#E3E3E0`, hair `#EDEDEB`, ground `#F7F7F5`, accent `#E00087`, accent-tint `#FDF2F8`, red `#B42318` (overdue/blocked only), amber `#8A6D00` (watch/due soon only), done `#8A8A86`.
- Tailwind names: `text-ink bg-ink text-muted border-rule border-hair bg-ground text-accent bg-accent bg-accent-tint text-status-red text-status-amber text-done`.
- ONE primary button per screen (`Button` primary = black). Secondary = white with black border. Link actions = pink bold text.
- No shadows, no gradients, no emoji icons (inline stroke SVG only), 4px radius max, no colored card backgrounds except accent-tint for "mine".
- Milestones: Deadline = solid ink chip (`chip-deadline` / `Pill kind="deadline"`), Hard check-in = solid accent (`chip-hard`), Soft check-in = accent outline (`chip-soft`), done = `chip-done`. Replace every old red/blue/pink milestone class with these.
- Statuses (Lead, Pursuing, Submitted, draft, review…) are ONE outlined ink pill with the word in it — never a color per status. Awarded = accent solid. Dead/closed = `done`.
- The old `bg-hdla-green`, `text-hdla-green`, `blue-*`, `purple-*`, `violet-*`, `pink-*`, `green-*` Tailwind classes are aliased in `tailwind.config.js` to the new palette, so a ported page is already roughly right; still replace them where you touch the markup, and fix anything that reads wrong (e.g. a green "approved" that should be an outlined pill).
- Every panel that shows numbers states the source and freshness in its `meta` (e.g. "Master Data · loaded 9:14 am", "QuickBooks · pulled 6:00 am").

## Auth contract for API routes
- Browser pages call `fetch('/api/…')` as before. `lib/authFetch.js` adds the Supabase Bearer token to every same-origin `/api` request automatically, so pages need no changes.
- Every route must verify the caller:
```js
import { requireCaller, LEADERSHIP, FINANCE, PARTNERS, isCron } from '../../../lib/apiAuth';
export async function GET(req) {
  const { caller, error } = await requireCaller(req);           // any signed-in user
  if (error) return error;
  …
}
export async function POST(req) {
  const { caller, error } = await requireCaller(req, FINANCE);  // partner / operations / office
  if (error) return error;
```
- Per-user data (time entries, planner) must use `caller.id` / `caller.initials`, never a `user_id` from the body, unless the caller is leadership acting on someone else's week (approvals).
- Cron routes accept `isCron(req)` OR a caller with the right role.
- Service-role Supabase: `import { supabaseAdmin } from '../../../lib/supabaseAdmin'` (server-only). Never import it from a page.
- Microsoft Graph: `import { graphToken, getDrive, downloadFile, uploadFile, graphFetch } from '../../../lib/graph'`.
- NO hardcoded secrets or fallbacks anywhere. Read from `process.env`; `.env.example` lists every name.

## Data
- Supabase tables are unchanged. New tables/columns are in `db/onefirm.sql` (additive, idempotent). Add to that file; never edit tables in place.
- Master Data is read-only and sacred: Hub invoice lines must match its project name + phase exactly (`lib/phaseNames.js`).
- Keep `components/marketing-shared.js` as the single source for touchpoint/lead forms and step helpers.
