
## Also in this update
**Marketing:** Clients tab search bar (name, contact, partner, market, notes); "+ Client" in the header; the touchpoint search also finds leads/proposals and shows "Which team did you meet with?" chips for multi-client leads; new clients can be created on the fly when adding teams (Quick-add, touchpoint-created leads, proposal window).

**Time (no SQL needed):** one row per project with phases dropping down (collapsed by default), same for non-project codes grouped by name; non-project codes pinned in the Log-time picker; pencil on a phase to change it (open weeks only, hours merge, submitted/approved weeks keep their phase; refuses >24h/day); "Copy last week's rows" (rows only, never hours); projects always show every Master Data phase (blank-phase rows with no hours are replaced automatically; blank rows with hours show "pick a phase").

## Next steps, multi-lead touchpoints, and Time → touchpoint
**Run `supabase-touchpoint-time-steps.sql` once** (it includes the earlier leads and teams SQL, so it is the only file needed). Until it runs, the app still works: the first open next step is saved in the old fields, but extra steps, the hours snapshot and the Time tag will not persist.

- **Next steps:** a lead (or any open proposal) holds a list of steps (text, date, done). The Leads tab shows the earliest open step plus "+N more". "No next step" means no open steps; "Overdue" means any open step is past its date. Tick steps done in the lead form or while logging a touchpoint. Old single next steps appear as the first item automatically.
- **Touchpoint form:** search all active leads, pursuits and submitted proposals (any client) and tick as many as you like. New steps are added to every selected lead. Status changes apply to leads and pursuits only.
- **Several opportunities per touchpoint:** tick "This surfaced a new opportunity", then "+ Add another opportunity" for each extra one. Each has its own title, teams and next steps, becomes its own Lead, and links back to the touchpoint.
- **Time → touchpoint:** in Log time / Edit time, pick a Business Dev code and a "Save and log touchpoint" button appears next to Save. It saves the time, then opens the Marketing touchpoint form filled in (date, note, you as partner). Both sides link: the Time cell shows a ◆ (reopen the entry and the button says "Save and edit touchpoint"), and the Touchpoints tab shows ⏱ and hours (a snapshot from when it was logged). Deleting the touchpoint only clears the tag. Project time never shows the button.
- Shared code lives in `components/marketing-shared.js` (used by both pages).
