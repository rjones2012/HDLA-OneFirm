-- HDLA Marketing — multiple clients (teams) on one lead or proposal
-- Additive only. Safe to re-run. Run after supabase-marketing-leads.sql.
ALTER TABLE marketing_proposals ADD COLUMN IF NOT EXISTS other_client_ids JSONB DEFAULT '[]';
