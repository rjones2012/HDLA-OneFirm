-- ═══════════════════════════════════════════════════════════════
-- HDLA Marketing — Leads
-- Additive only. Safe to run more than once. Run in Supabase SQL Editor.
-- The app keeps working if this has not been run yet; the new
-- fields simply won't save until it has.
-- ═══════════════════════════════════════════════════════════════

-- A lead is a row in marketing_proposals whose status is Lead or Pursuing.
ALTER TABLE marketing_proposals ADD COLUMN IF NOT EXISTS next_step TEXT DEFAULT '';
ALTER TABLE marketing_proposals ADD COLUMN IF NOT EXISTS next_step_date TEXT DEFAULT '';
ALTER TABLE marketing_proposals ADD COLUMN IF NOT EXISTS lead_since TEXT DEFAULT '';
ALTER TABLE marketing_proposals ADD COLUMN IF NOT EXISTS dead_reason TEXT DEFAULT '';
ALTER TABLE marketing_proposals ADD COLUMN IF NOT EXISTS source_touchpoint_id TEXT DEFAULT '';
ALTER TABLE marketing_proposals ADD COLUMN IF NOT EXISTS contact_ids JSONB DEFAULT '[]';

-- Touchpoints can name who was met and which lead(s) were discussed.
ALTER TABLE marketing_touchpoints ADD COLUMN IF NOT EXISTS contact_ids JSONB DEFAULT '[]';
ALTER TABLE marketing_touchpoints ADD COLUMN IF NOT EXISTS contact_names JSONB DEFAULT '[]';
ALTER TABLE marketing_touchpoints ADD COLUMN IF NOT EXISTS lead_ids JSONB DEFAULT '[]';

-- Optional: rename the old "Tracking" status to "Lead".
-- The app treats both the same, so this is cosmetic and can wait.
-- UPDATE marketing_proposals SET status = 'Lead' WHERE status = 'Tracking';
