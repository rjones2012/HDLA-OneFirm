# HDLA Hub — My Time module (v2)

## Files changed in v2
- `supabase-time-rates-schema.sql` — run once (accounts, fee charts, overrides, rate titles seeded)
- `app/api/time/route.js` — replace
- `app/time/[code]/page.js` — replace

`app/page.js` and `lib/auth.js` are unchanged from v1. No new dependencies.

## Install
1. Open `supabase-time-rates-schema.sql` in a text editor (not a preview pane), copy all, run in Supabase → SQL Editor. Idempotent.
2. Drop the two code files in. Push. Preview.

## What v2 adds
- **Internal time accounts** (100–193) from `time_accounts`. Ellie edits them in Rates → Time Accounts.
- **Project rows**: every project offers its Master Data phases plus Travel and General (non-fee).
- **Log Time** is two-step: pick project or account, then phase.
- **Fee charts** 2022–2026 in `rate_schedules`. A project uses the chart for its year (first two digits). PR and non-numeric use current. Overrides in Rates → Project Overrides.
- **Rate titles** on `staff_profiles.rate_title`, seeded for everyone. CDAM=SPD rate, Marketing Manager=SPD, Marketing Coordinator=PD.
- **Firm view**: billed value (hours × chart rate), fee, fee spent %, billed % from Master Data, overhead by group. Partners also see cost and multiplier.
- **Rates view** (partner/ops/office): people & titles, fee charts, overrides, accounts. Cost rates editable by partners only.

## Security
Cost rates and the admin actions are now checked server-side: the page sends the Supabase session token, the API verifies it and reads `staff_profiles.role`. The report endpoint only includes cost when the verified caller is a partner.

Still outstanding from v1 and now more important: `lib/supabase.js` hardcodes the service-role key and is imported by client code, which means the key ships to the browser. Move `SUPABASE_SERVICE_KEY` and the SharePoint secret to Vercel env vars, split `supabaseAdmin` into a server-only file, and rotate both keys.

## Adding a new fee chart
INSERT INTO rate_schedules (effective_year, label, partner, principal, project_manager, senior_project_designer, project_designer, office_manager) VALUES (2027, '2027 HDLA Fee Chart', ...);
The highest year is treated as current.

## Time spent on Projections (Entry tab, read-only)
For principals and partners (roles partner, principal, operations). Reference only; nothing here writes to projections or invoices. The principals' % boxes still drive projected $.
- **Columns:** Project, Fee, the months, Remaining. The Actual % and Hours % columns were removed.
- **Under the project number:** one whole-project line, "Projected $ · Billed $ · Spent $". Projected = the principals' projected fee summed across the months shown. Billed = Master Data's Previously Billed (each phase's fee × billed %, added up). Spent = fee-by-time since **Oct 1, 2026** (`HUB_TIME_START` in `app/api/time/route.js`). Everyone sees Projected and Billed; only principals/partners see Spent.
- **Month columns, project row:** that month's projected $ (green) with spent $ (blue) under it, all phases added. Color only, no labels.
- **Month columns, phase rows** (expand the project): % box, projected $, then a blue line, "hours · $", with that month's logged hours and fee-by-time spent (no labels; the colors match the line under the project number).
- **What counts as time:** every billable hour logged, submitted or not. Fee-by-time = hours × the fee-chart rate for the person's title and the project's year (same rates as Time and Billing). Months before Oct 2026 are blank.
- The old all-time Hours % feed (`/api/time?view=burn`) is no longer used by this page; it now requires a principal/partner sign-in and pages past 1,000 rows.
- To change who sees Spent: `FEE_TIME_ROLES` in `app/api/time/route.js`.



## Ticking Work Plan tasks from the Time tab
- The task boxes in My Time → Work Plan are real checkboxes. One click saves just that task's completed flag (`setTaskCompleted` in `app/api/projects/route.js`); the box updates at once and flips back with a message if the save fails. People only see and tick their own tasks.
- Every tick/untick stamps the task with `completionUpdatedAt`. When Work Plans saves a whole week (`saveCellEdit`, `setTasksForWeek`), the server keeps whichever completed state has the newer stamp for each task, so a stale open page can't undo a tick. The two task checkboxes on Work Plans stamp the same way, so a deliberate untick there still works.
- Anyone with Work Plans open from before this deploy runs the old page until they refresh; an untick or week-save from it can undo a tick once.
- Not changed: `/api/projects` still doesn't check who is calling (same as before).

## Meetings panel on the Time tab
- **Meetings** button (next to Work Plan) opens a panel of the viewed week's Outlook meetings, grouped by day, from the same feed the Planner uses (`/api/calendar`; cancelled and tentative meetings are left out). The calendar is only fetched while the panel is open.
- **Log as time** opens the usual Log time window with the date, hours (meeting length rounded to the nearest quarter hour) and a written note already filled in, e.g. "Meeting: Tucker Ranch design review (Tue 10/6, 9:00–10:30 AM)". The person picks the project or account and phase and clicks Save. Nothing is ever logged automatically.
- A meeting whose title appears in a "Meeting: …" note on that date shows "✓ Logged" and loses its button. This is matched by note text, so there is no new database table; if someone edits the title out of the note, the button comes back.
- All-day and multi-day events have no button (enter hours by hand). On a submitted/approved week the buttons are hidden.
- `/api/calendar` now checks identity when a sign-in token is sent (the Time tab sends one): you can only pull your own calendar. Requests with no token behave as before so the Planner is unchanged. The endpoint still isn't locked down for callers that send no token, and the Microsoft client secret is still hardcoded in that file (see the key-rotation item).

## Logging adds to what's already there
- Every **Log time** save (+ Log Time, Work Plan → Log time, Meetings → Log as time) **adds** to the entry already on that project line and day: hours are summed and the new note goes on its own line under the old one. Two meetings on the same project and phase on the same day are kept as one total with one note line each. The add happens on the server (`mode: 'add'` on `setEntry`, helper `combineEntry`), reading the current entry at save time. A combined total over 24 h on one line and day is refused.
- **Clicking a cell in the grid still replaces** (Edit time / Clear). That is how a mistake or a wrong meeting line gets corrected.
- Log time now requires hours greater than 0 (it used to delete the cell when given 0; use Edit time → Clear for that).
- Before this change a second Log time on the same line and day overwrote the first (hours and note). Entries already overwritten can't be recovered; re-log the missing one.
