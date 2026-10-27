-- ═══════════════════════════════════════════════════════════════
-- HDLA Marketing — Priority List (for BD Report + Planner)
-- Run this in the Supabase SQL Editor. Safe to re-run.
-- Additive only. The monthly BD report needs no table — it computes
-- live from marketing_touchpoints + marketing_proposals.
-- ═══════════════════════════════════════════════════════════════

-- Shared running priority list of clients to contact / most important.
-- Deliberately separate from client scoring/health — it's just a list.
CREATE TABLE IF NOT EXISTS marketing_priority (
  id         TEXT PRIMARY KEY,
  client_id  TEXT REFERENCES marketing_clients(id) ON DELETE CASCADE,
  owner      TEXT DEFAULT '',     -- partner/principal who owns this priority
  note       TEXT DEFAULT '',
  done       BOOLEAN DEFAULT false,
  position   INTEGER DEFAULT 0,   -- manual sort order (lower = higher priority)
  created_at TIMESTAMPTZ DEFAULT now()
);

-- If the table already existed without an owner column, add it.
ALTER TABLE marketing_priority ADD COLUMN IF NOT EXISTS owner TEXT DEFAULT '';

CREATE INDEX IF NOT EXISTS idx_priority_client ON marketing_priority(client_id);
CREATE INDEX IF NOT EXISTS idx_priority_owner ON marketing_priority(owner);
