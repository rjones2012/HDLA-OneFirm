-- ═══════════════════════════════════════════════════════════════
-- HDLA Marketing — IDIQ Tracker
-- Run this in the Supabase SQL Editor BEFORE deploying the IDIQ feature.
-- Additive only: creates one new table. Touches nothing existing.
-- ═══════════════════════════════════════════════════════════════

-- IDIQ contracts. The agency IS a marketing_clients record, so projects
-- (marketing_proposals) and contact cadence (marketing_touchpoints) roll up
-- automatically by client_id — no data is copied or synced.
CREATE TABLE IF NOT EXISTS marketing_idiqs (
  id           TEXT PRIMARY KEY,
  client_id    TEXT REFERENCES marketing_clients(id) ON DELETE CASCADE,
  date_awarded TEXT DEFAULT '',
  date_expired TEXT DEFAULT '',
  contacts     JSONB DEFAULT '[]',   -- [{ id, name, position }], max 3 enforced in UI
  notes        TEXT DEFAULT '',
  created_at   TIMESTAMPTZ DEFAULT now()
);

-- Fast lookup of an IDIQ by its agency/client
CREATE INDEX IF NOT EXISTS idx_idiq_client ON marketing_idiqs(client_id);
