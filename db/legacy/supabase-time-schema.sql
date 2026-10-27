-- ═══════════════════════════════════════════════════════════════════
-- HDLA Hub — Time Tracking Schema
-- Run in Supabase SQL Editor. Additive only: no existing tables change
-- except one new nullable column on staff_profiles.
-- ═══════════════════════════════════════════════════════════════════

-- Cost rate per person (partner-only visibility, used for hours × rate vs fee)
ALTER TABLE staff_profiles ADD COLUMN IF NOT EXISTS cost_rate NUMERIC(8,2);

-- ─── Persistent timesheet rows ─────────────────────────────────────
-- The project/phase rows a person keeps on their sheet week to week.
-- Keyed to Master Data strings; project_name is a snapshot.
CREATE TABLE IF NOT EXISTS time_rows (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  project_num TEXT NOT NULL,
  project_name TEXT NOT NULL DEFAULT '',
  phase TEXT NOT NULL DEFAULT '',
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, project_num, phase)
);

CREATE INDEX IF NOT EXISTS idx_time_rows_user ON time_rows(user_id);

-- ─── Time entries ──────────────────────────────────────────────────
-- One row per person / day / project / phase. Hours 0 = delete.
CREATE TABLE IF NOT EXISTS time_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  initials TEXT NOT NULL DEFAULT '',
  work_date DATE NOT NULL,
  week_key TEXT NOT NULL,                 -- Monday of the week, YYYY-MM-DD
  project_num TEXT NOT NULL,              -- Master Data project # or internal code (OH, MKT, PTO)
  project_name TEXT NOT NULL DEFAULT '',  -- snapshot at entry time
  phase TEXT NOT NULL DEFAULT '',
  hours NUMERIC(5,2) NOT NULL CHECK (hours > 0 AND hours <= 24),
  note TEXT NOT NULL DEFAULT '',
  billable BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, work_date, project_num, phase)
);

CREATE INDEX IF NOT EXISTS idx_time_entries_user_week ON time_entries(user_id, week_key);
CREATE INDEX IF NOT EXISTS idx_time_entries_date ON time_entries(work_date);
CREATE INDEX IF NOT EXISTS idx_time_entries_project ON time_entries(project_num, phase);

-- ─── Weekly status ─────────────────────────────────────────────────
-- Submit / approve happens at the week level, like a paper timesheet.
--   draft     → editable
--   submitted → locked, awaiting approval (user can pull back)
--   approved  → locked
--   returned  → editable again, with a note from the approver
CREATE TABLE IF NOT EXISTS time_weeks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  week_key TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  submitted_at TIMESTAMPTZ,
  approved_by TEXT,                        -- approver initials
  approved_at TIMESTAMPTZ,
  return_note TEXT NOT NULL DEFAULT '',
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, week_key)
);

CREATE INDEX IF NOT EXISTS idx_time_weeks_week ON time_weeks(week_key, status);

-- ─── RLS ───────────────────────────────────────────────────────────
-- API routes use the service role (bypasses RLS), matching the rest of the Hub.
-- These policies cover any direct client access.
ALTER TABLE time_rows ENABLE ROW LEVEL SECURITY;
ALTER TABLE time_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE time_weeks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users manage own time rows" ON time_rows;
CREATE POLICY "Users manage own time rows" ON time_rows FOR ALL USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users manage own time entries" ON time_entries;
CREATE POLICY "Users manage own time entries" ON time_entries FOR ALL USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users read own time weeks" ON time_weeks;
CREATE POLICY "Users read own time weeks" ON time_weeks FOR SELECT USING (auth.uid() = user_id);

-- ─── Optional: set cost rates ──────────────────────────────────────
-- UPDATE staff_profiles SET cost_rate = 85.00 WHERE initials = 'SI';
