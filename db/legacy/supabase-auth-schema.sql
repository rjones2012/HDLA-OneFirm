-- ═══════════════════════════════════════════════════════════════════
-- HDLA Hub Auth Schema v2 — Role-Based Access Control
-- Run this in Supabase SQL Editor AFTER enabling Supabase Auth
-- ═══════════════════════════════════════════════════════════════════

-- Staff profiles: maps Supabase auth user → HDLA identity + role
CREATE TABLE IF NOT EXISTS staff_profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  initials TEXT NOT NULL,
  display_name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'staff',
  office TEXT DEFAULT 'Nashville',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- RLS: users can only read their own profile
ALTER TABLE staff_profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users read own profile" ON staff_profiles;
CREATE POLICY "Users read own profile" ON staff_profiles
  FOR SELECT USING (auth.uid() = id);

-- Weekly planner entries
CREATE TABLE IF NOT EXISTS weekly_planner (
  id TEXT PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  week_key TEXT NOT NULL,
  focus_notes TEXT DEFAULT '',
  meetings JSONB DEFAULT '[]',
  priorities JSONB DEFAULT '[]',
  reflections TEXT DEFAULT '',
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, week_key)
);

ALTER TABLE weekly_planner ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users manage own planner" ON weekly_planner;
CREATE POLICY "Users manage own planner" ON weekly_planner
  FOR ALL USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_weekly_planner_user_week
  ON weekly_planner(user_id, week_key);

-- ═══════════════════════════════════════════════════════════════════
-- ROLE DEFINITIONS & ACCESS MATRIX
-- ═══════════════════════════════════════════════════════════════════
-- partner:    Work Plan + Marketing + Executive + Planner (RJ, CB, TJ, MB)
-- operations: Work Plan + Marketing + Executive + Planner (CM)
-- office:     Work Plan + Marketing + Executive + Planner (EP)
-- marketing:  Work Plan + Marketing + Planner (SD)
-- principal:  Work Plan + Planner (MM, AB, RW, HD)
-- staff:      Work Plan + Planner (everyone else)
-- ═══════════════════════════════════════════════════════════════════

-- ═══════════════════════════════════════════════════════════════════
-- SETUP:
-- 1. Supabase Dashboard → Auth → Settings: enable email auth,
--    disable email confirmation, set site URL
-- 2. Run this SQL
-- 3. Create users via Auth Dashboard → "Add user"
-- 4. Insert profile for each (replace UUID with actual user ID):
--
-- INSERT INTO staff_profiles (id, initials, display_name, role, office) VALUES
--   ('<uuid>', 'RJ', 'Richie Jones', 'partner', 'Nashville'),
--   ('<uuid>', 'CB', 'Chris Barkley', 'partner', 'Nashville'),
--   ('<uuid>', 'TJ', 'TJ Eliason', 'partner', 'Nashville'),
--   ('<uuid>', 'MB', 'Michael Black', 'partner', 'Nashville'),
--   ('<uuid>', 'CM', 'Chris Mantle', 'operations', 'Nashville'),
--   ('<uuid>', 'EP', 'Ellie Peebles', 'office', 'Nashville'),
--   ('<uuid>', 'SD', 'Sarah DuBose', 'marketing', 'Nashville'),
--   ('<uuid>', 'MM', 'Mary Miller', 'principal', 'Nashville'),
--   ('<uuid>', 'AB', 'Austen Berry', 'principal', 'Nashville'),
--   ('<uuid>', 'RW', 'Robert Whittemore', 'principal', 'Nashville'),
--   ('<uuid>', 'HD', 'Hank Dalton', 'principal', 'Dallas'),
--   ('<uuid>', 'SI', 'Sam Irwin', 'staff', 'Nashville');
-- ═══════════════════════════════════════════════════════════════════
