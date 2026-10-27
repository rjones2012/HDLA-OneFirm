-- ═══════════════════════════════════════════════════════════════
-- HDLA Marketing Supabase Tables
-- Run this in your Supabase SQL Editor
-- ═══════════════════════════════════════════════════════════════

-- Clients (source of truth after migration from Marketing.xlsx)
CREATE TABLE IF NOT EXISTS marketing_clients (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  sector TEXT DEFAULT '',
  office TEXT DEFAULT '',
  tier INTEGER DEFAULT 3,
  relationship_score NUMERIC DEFAULT 5,
  relationship_override NUMERIC,
  touchpoint_value INTEGER DEFAULT 5,
  partners JSONB DEFAULT '[]',
  strategic BOOLEAN DEFAULT false,
  markets JSONB DEFAULT '[]',
  contacts JSONB DEFAULT '[]',
  notes TEXT DEFAULT '',
  office_location TEXT DEFAULT '',
  office_state TEXT DEFAULT '',
  account_class TEXT DEFAULT '',
  marketing_objective TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Touchpoints (meetings, calls, lunches, etc.)
CREATE TABLE IF NOT EXISTS marketing_touchpoints (
  id TEXT PRIMARY KEY,
  client_id TEXT REFERENCES marketing_clients(id) ON DELETE CASCADE,
  type TEXT DEFAULT '',
  partner TEXT DEFAULT '',
  date TEXT DEFAULT '',
  status TEXT DEFAULT 'planned',
  rating INTEGER,
  notes TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Proposals (pipeline tracking)
CREATE TABLE IF NOT EXISTS marketing_proposals (
  id TEXT PRIMARY KEY,
  client_id TEXT REFERENCES marketing_clients(id) ON DELETE CASCADE,
  project_name TEXT DEFAULT '',
  fee NUMERIC DEFAULT 0,
  probability TEXT DEFAULT 'M',
  status TEXT DEFAULT 'Tracking',
  partner TEXT DEFAULT '',
  pm TEXT DEFAULT '',
  due_date TEXT DEFAULT '',
  submitted_date TEXT DEFAULT '',
  needs JSONB DEFAULT '[]',
  tasks JSONB DEFAULT '[]',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Events (conferences, groundbreakings, awards)
CREATE TABLE IF NOT EXISTS marketing_events (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT DEFAULT '',
  date TEXT DEFAULT '',
  location TEXT DEFAULT '',
  needs JSONB DEFAULT '[]',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Relationship score change log
CREATE TABLE IF NOT EXISTS marketing_rel_log (
  id SERIAL PRIMARY KEY,
  client_id TEXT REFERENCES marketing_clients(id) ON DELETE CASCADE,
  date TEXT DEFAULT '',
  old_score NUMERIC,
  new_score NUMERIC,
  reason TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable RLS (optional - skip if using service role key)
-- ALTER TABLE marketing_clients ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE marketing_touchpoints ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE marketing_proposals ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE marketing_events ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE marketing_rel_log ENABLE ROW LEVEL SECURITY;

-- Index for fast client lookups
CREATE INDEX IF NOT EXISTS idx_touchpoints_client ON marketing_touchpoints(client_id);
CREATE INDEX IF NOT EXISTS idx_proposals_client ON marketing_proposals(client_id);
CREATE INDEX IF NOT EXISTS idx_rel_log_client ON marketing_rel_log(client_id);
