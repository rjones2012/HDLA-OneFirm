# Next steps → Personal Planner, and Leads Generated on the Report

**Run `supabase-next-steps-planner.sql` once** in the Supabase SQL Editor (additive, safe to re-run). It adds four columns to `assigned_tasks` and copies every existing lead next step into that table. Until it runs the app keeps working: lead steps save as before, touchpoint steps and planner sync do not persist, and the Marketing page shows an amber banner saying so.

## What changed

**Report tab**
- New **Leads Generated** column (per person, Firm total, fourth stat tile) and both exports.
- A **Leads generated** list under the table: person → lead → client → the touchpoint that produced it (click to open either). Leads added by hand show "added by hand".
- Attribution: the partner on the source touchpoint; if the lead has no source touchpoint, the lead's partner. Counted in the month of `leadSince` (falls back to created date).

**Touchpoints**
- Every touchpoint now has its own **Next steps from this touchpoint** (violet box) — text, due date, assign to anyone. Independent of leads; kept visually separate from the lead section below it.
- The lead section still adds steps *to the lead*, now with an assignee too.
- Touchpoints tab: new **Next steps** column with tick boxes, plus "Has open next steps" / "Next step overdue" filters. Search also matches step text and assignee.
- Partner on a new touchpoint defaults to whoever is signed in (if they are a partner/principal).

**Leads**
- Lead form steps have an assignee (defaults to the lead's partner). Leads tab "Next step" cell shows the assignee and can be ticked in place.

**Personal Planner**
- "Assigned to You" now includes every next step assigned to you, tagged **Lead** or **Touchpoint** with its context ("Greenway Phase 2 · Metro Parks", "Lunch with Metro Parks · 2026-10-26"), who assigned it, and due date. Works for everyone, not just leadership.
- Ticking it there flips the one shared row — it shows done in the lead form, touchpoint form, Touchpoints tab and Leads tab immediately (and the other way round).
- "Tasks You Assigned" lists steps you assigned to others; Marketing-sourced ones say "via Marketing" instead of a delete ✕ (remove them from the lead/touchpoint). Self-assigned steps appear only under "Assigned to You".
- Fixed: the planner was refreshing tasks from a dead `/api/tasks` route on week change, which could blank the task list.

## How it works
One row per step in `assigned_tasks` (`source_type` = `lead` | `touchpoint`, `source_id`, `client_id`, `source_label`, `position`). `/api/marketing` GET rebuilds each lead's and touchpoint's `nextSteps` from those rows; POST diffs the list it is sent against the rows (upsert kept, delete removed); deleting a lead or touchpoint deletes its rows. The old `next_steps` JSON column is still written as a fallback but is ignored once the SQL has run. `{stepDone:{id,done}}` ticks a single row.

## Known limit
If someone ticks a step on their planner while you have the same lead open in Marketing, and you then save that lead, your (older) copy of the step wins. Reload Marketing before editing a lead that others are working.

## Files
- `supabase-next-steps-planner.sql` (new)
- `app/api/marketing/route.js`
- `app/api/assigned-tasks/route.js`
- `components/marketing-shared.js`
- `app/marketing/[code]/page.js`
- `app/planner/[code]/page.js`
