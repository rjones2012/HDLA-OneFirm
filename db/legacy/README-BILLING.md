# HDLA Hub — Billing module

## Files (new unless noted)
- `supabase-billing-schema.sql` — run once
- `app/api/billing/route.js` — drafts, editing, workflow, clients, reconcile
- `app/api/billing/pdf/route.js` — PDF endpoint
- `app/billing/[code]/page.js` — Billing UI
- `lib/invoicePdf.js` — invoice layout (react-pdf)
- `lib/apiAuth.js`, `lib/rates.js` — shared server helpers
- `public/fonts/Lato-*.ttf` — body font for the PDF (Flecha stays for the Hub UI)
- `package.json` — adds `@react-pdf/renderer` (replaced)
- `next.config.js` — externalizes react-pdf for the server bundle (replaced)
- `app/page.js`, `lib/auth.js` — Billing card + access for partner/operations/office (replaced)
- `app/api/time/route.js`, `app/time/[code]/page.js` — tiny fix: year detection now accepts hyphenated project numbers like 21-2183 (replaced)

## Install
1. Run `supabase-billing-schema.sql` in Supabase SQL Editor.
2. Unzip the repo, `npm install` (pulls react-pdf), push. Preview on Vercel.

## How it works
- **Generate drafts** for a month: every open (Status O) project in Master Data. Each phase becomes a line: contract = Fee, previous = Previously Billed, % = the principal's projection for that month (or previous % if none), earned/this invoice/balance computed. Projects with nothing to bill are skipped; add any project by hand from the list below the table.
- **Hourly phases**: a phase with $0 fee and "hourly" in its name, or one Ellie flags, pulls that month's time entries at the fee-chart rate and prints an Hourly Breakdown. Hours never print anywhere else.
- **Ellie edits** any number inline. % → recomputes earned/this/balance; this invoice → recomputes %. Edited lines are tinted and survive "Rebuild lines". Lines can be Phase, Hourly, Expense, Reimbursable, or Header. TBD lines print "TBD".
- **Bill-to** is remembered per client the first time it's saved; project-level settings (principal label/name, signer, PO/reference lines) are remembered per project.
- **Workflow**: Draft → In Review → Approved (partners only; assigns the invoice number MYYNNN from a per-month sequence) → Sent (locks). Return sends it back with a note. Void for sent invoices (partners).
- **Reconcile**: what the Hub has sent per phase vs Master Data Previously Billed. Ellie keeps updating the spreadsheet after sending, as agreed; this view catches misses.
- **Internal note** on each invoice is red and never prints.
- **Partner review**: partners open Billing to their own queue (invoices they sign, in review). Invoices open in mark-up mode: numbers locked, ✎ on any line requests a revision, + comment for general notes. "Return to Ellie" sends it back with the open requests; Ellie edits, resolves each, resubmits. Every comment and status change stays on the invoice. A partner can switch to "Edit numbers" if they'd rather change something directly.
- **PDF**: Letter, Lato body, HDLA logo, same seven-column layout, signer, remit line. Opens in a tab or downloads.

## Security
All billing reads and writes verify the session server-side and require role office, operations, or partner. Approve/reopen/void are partner-only server-side.

## Known limits
- Invoice number sequence is per month and increments on approval; deleting an approved draft does not reuse its number.
- The projection lookup mirrors Work Plans' id scheme (`project#-phase`, name-suffixed only for duplicate phases).

## Month screen
- **Pipeline cards**: Not started · Needs attention · Draft · In review (per partner) · Returned · Ready to send · Sent · All. Click to filter. Table groups by principal; filters for principal and signer.
- **Ellie** lands on Needs attention. Bulk: "Send clean drafts to review", "Mark all approved as sent", plus checkbox selection for any bucket.
- **Partners** land on their own In review, flagged invoices first. "Approve all unflagged", or select and approve/return. Open flagged ones to mark up.
- **Flags**: No bill-to (blocks), No projection, Hourly with no hours, Open comments, Differs from projection, New bill-to, Large jump vs last month, Zero total.
- **Signer** is the Partner column in Master Data.

## Consultants
Master Data stays HDLA-only. Consultants live in the Hub, per project, set up once in the invoice editor ("Consultants on this project"): name, contract amount, and how it prints — **folded into an HDLA phase** (client sees one line at the combined contract), **its own row** in the table, or a **Consultant section** below with its own subtotal. Each month Ellie enters the bills that came in (amount, their invoice #, note); previous billed carries from the Hub's approved/sent invoices. On a folded line the % Ellie edits is HDLA's; the printed % is derived from the combined earned ÷ combined contract. Run `supabase-consultants.sql` once.

## Hours check
Work Plans → Projections has a read-only blue "Hours %" column: value of logged hours ÷ fee, by project and by line. It reads from the Time module and never touches projections.

## Line identity (both modules)
Master Data reuses a project number across rows that differ by Project Name (e.g. "Ford Park", "Ford Park - Add Service") and the same phase can repeat. Billing and Time both key a line on **project number + project name + phase**. Invoice line text is the same rule for every line: the Project Name exactly as Master Data has it (abbreviations and all), then " – " and the phase spelled out from `lib/phaseNames.js`. Codes with no spelled-out name (LEED, BZA) and any code not in that file print as written. To add or fix a phase name, edit one line in `lib/phaseNames.js`. The invoice header still prints one name per project (the shortest Project Name). Lines Ellie has edited by hand keep her wording. Run `supabase-time-key-fix.sql` once to update the time-tracking unique constraints.

## Previous billed = Master Data
Previous billed on every line is Master Data's Previously Billed, always. Ellie posts what was invoiced to Master Data by hand after each billing run. If last month hasn't been posted yet, the invoice gets a **"Master Data may be behind"** flag (Needs attention): the project's last approved/sent invoice billed more on a line than Master Data's Previously Billed shows, so billing now would repeat last month. Invoices drafted before this rule keep their old baseline until **Rebuild lines**.

## Saved per project (survives into future invoices)
- **Line wording** and **removed lines** (already saved per project).
- **Header project name**: edit it once on an invoice and every later draft for that project uses it.
- **Repeat monthly**: tick it on a manually added expense, reimbursable or header line. The line (wording, quantity, rate, amount) is saved on the project and added to every new draft. Edits to a ticked line update the saved copy; untick to stop it repeating. Deleting a ticked line from one invoice does not stop it repeating. Manual phase lines can't repeat (no Master Data baseline).
- **Reset to Master Data** (bottom of the editor) clears all of the above for the project. Bill-to, signer, principal and PO lines are kept. The open invoice is unchanged until Rebuild lines.
- Percentages, contract amounts and previous billed are never saved this way: they come from projections and Master Data each month.
- Run `supabase-billing-recurring.sql` once (adds the header-name and repeat-monthly columns).

## Percent display
Percentages print and display to the nearest whole number. Amounts are still computed from the exact percentage, so a 45.4% line shows "45%" but its dollars come from 45.4%.
