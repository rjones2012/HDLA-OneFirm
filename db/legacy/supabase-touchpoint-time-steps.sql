-- ═══════════════════════════════════════════════════════════════
-- HDLA Hub — ONE file to run: leads, teams, multiple next steps, and Time → touchpoint links
-- Additive only. Safe to run more than once. Run in the Supabase SQL Editor.
-- It includes everything in supabase-marketing-leads.sql and supabase-marketing-leads-teams.sql,
-- so if you have not run those yet, you only need this one.
-- The app keeps working if this has not been run; the new fields just won't save until it has.
-- ═══════════════════════════════════════════════════════════════

-- Leads (a lead is a marketing_proposals row with status Lead)
ALTER TABLE marketing_proposals ADD COLUMN IF NOT EXISTS next_step TEXT DEFAULT '';
ALTER TABLE marketing_proposals ADD COLUMN IF NOT EXISTS next_step_date TEXT DEFAULT '';
ALTER TABLE marketing_proposals ADD COLUMN IF NOT EXISTS lead_since TEXT DEFAULT '';
ALTER TABLE marketing_proposals ADD COLUMN IF NOT EXISTS dead_reason TEXT DEFAULT '';
ALTER TABLE marketing_proposals ADD COLUMN IF NOT EXISTS source_touchpoint_id TEXT DEFAULT '';
ALTER TABLE marketing_proposals ADD COLUMN IF NOT EXISTS contact_ids JSONB DEFAULT '[]';
ALTER TABLE marketing_touchpoints ADD COLUMN IF NOT EXISTS contact_ids JSONB DEFAULT '[]';
ALTER TABLE marketing_touchpoints ADD COLUMN IF NOT EXISTS contact_names JSONB DEFAULT '[]';
ALTER TABLE marketing_touchpoints ADD COLUMN IF NOT EXISTS lead_ids JSONB DEFAULT '[]';

-- Teams: more than one client on a lead or proposal
ALTER TABLE marketing_proposals ADD COLUMN IF NOT EXISTS other_client_ids JSONB DEFAULT '[]';

-- NEW: several next steps per lead/proposal: [{id, text, date, done, doneAt}]
-- (the earliest open step is still mirrored into next_step / next_step_date)
ALTER TABLE marketing_proposals ADD COLUMN IF NOT EXISTS next_steps JSONB DEFAULT '[]';

-- NEW: a touchpoint logged from a Time entry remembers which entry (and the hours at the time)
ALTER TABLE marketing_touchpoints ADD COLUMN IF NOT EXISTS time_entry_id TEXT DEFAULT '';
ALTER TABLE marketing_touchpoints ADD COLUMN IF NOT EXISTS time_hours NUMERIC DEFAULT 0;

-- NEW: a Time entry remembers the touchpoint it was logged as
ALTER TABLE time_entries ADD COLUMN IF NOT EXISTS touchpoint_id TEXT;

-- Optional: rename the old "Tracking" status to "Lead" (cosmetic; the app treats both the same)
-- UPDATE marketing_proposals SET status = 'Lead' WHERE status = 'Tracking';
