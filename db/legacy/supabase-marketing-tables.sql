-- HDLA Marketing Tables
-- Run this in Supabase SQL Editor before deploying

-- Clients (migrated from Marketing.xlsx, then managed in dashboard)
CREATE TABLE IF NOT EXISTS marketing_clients (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL DEFAULT '',
  sector TEXT DEFAULT '',
  office TEXT DEFAULT 'Nashville',
  markets JSONB DEFAULT '[]',
  partners JSONB DEFAULT '[]',
  tier INTEGER DEFAULT 3,
  relationship_score NUMERIC(4,2) DEFAULT 5,
  relationship_override NUMERIC(4,2),
  touchpoint_value INTEGER DEFAULT 5,
  strategic BOOLEAN DEFAULT false,
  contacts JSONB DEFAULT '[]',
  notes TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Touchpoints (logged per client interaction)
CREATE TABLE IF NOT EXISTS marketing_touchpoints (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL DEFAULT '',
  type TEXT DEFAULT '',
  partner TEXT DEFAULT '',
  date TEXT DEFAULT '',
  status TEXT DEFAULT 'completed',
  rating INTEGER DEFAULT 3,
  notes TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Proposals (pipeline tracking)
CREATE TABLE IF NOT EXISTS marketing_proposals (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL DEFAULT '',
  project_name TEXT DEFAULT '',
  fee NUMERIC DEFAULT 0,
  probability TEXT DEFAULT 'M',
  status TEXT DEFAULT 'Tracking',
  partner TEXT DEFAULT '',
  pm TEXT DEFAULT '',
  due_date TEXT DEFAULT '',
  submitted_date TEXT DEFAULT '',
  notes TEXT DEFAULT '',
  needs JSONB DEFAULT '[]',
  tasks JSONB DEFAULT '[]',
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Events (conferences, groundbreakings, etc)
CREATE TABLE IF NOT EXISTS marketing_events (
  id TEXT PRIMARY KEY,
  name TEXT DEFAULT '',
  type TEXT DEFAULT '',
  date TEXT DEFAULT '',
  location TEXT DEFAULT '',
  needs JSONB DEFAULT '[]',
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Relationship score change log
CREATE TABLE IF NOT EXISTS marketing_rel_log (
  id SERIAL PRIMARY KEY,
  client_id TEXT NOT NULL DEFAULT '',
  date TEXT DEFAULT '',
  old_score NUMERIC(4,2) DEFAULT 0,
  new_score NUMERIC(4,2) DEFAULT 0,
  reason TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_mkt_tp_client ON marketing_touchpoints(client_id);
CREATE INDEX IF NOT EXISTS idx_mkt_prop_client ON marketing_proposals(client_id);
CREATE INDEX IF NOT EXISTS idx_mkt_rel_client ON marketing_rel_log(client_id);
