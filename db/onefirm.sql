-- ═══════════════════════════════════════════════════════════════
-- HDLA OneFirm — schema additions. Additive and idempotent: safe to run more than once.
-- Run once in the Supabase SQL Editor (same project the current Hub uses).
-- The old Hub ignores every table and column here, so running it does not disturb it.
-- Everything from the old Hub's SQL files (db/legacy/*.sql) is assumed to have run already;
-- db/legacy/supabase-next-steps-planner.sql in particular (next steps on the planner).
-- ═══════════════════════════════════════════════════════════════

-- ── QuickBooks Online connection (tokens are encrypted by the app with QBO_TOKEN_SECRET) ──
CREATE TABLE IF NOT EXISTS qbo_connections (
  realm_id TEXT PRIMARY KEY,                 -- the QuickBooks company id
  company_name TEXT DEFAULT '',
  environment TEXT DEFAULT 'sandbox',        -- sandbox | production
  access_token_enc TEXT,                     -- encrypted
  refresh_token_enc TEXT,                    -- encrypted
  access_expires_at TIMESTAMPTZ,
  refresh_expires_at TIMESTAMPTZ,
  connected_by TEXT DEFAULT '',              -- initials
  connected_at TIMESTAMPTZ DEFAULT NOW(),
  last_sync_at TIMESTAMPTZ,
  last_sync_status TEXT DEFAULT '',          -- ok | error: message
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── Monthly financials: P&L rows by category (from QuickBooks pull or a manual upload) ──
CREATE TABLE IF NOT EXISTS monthly_financials (
  id TEXT PRIMARY KEY,                       -- `${source}:${realm_id}:${month}:${kind}:${category}:${subcategory}`
  realm_id TEXT DEFAULT '',
  month TEXT NOT NULL,                       -- 'YYYY-MM'
  kind TEXT NOT NULL,                        -- income | cogs | expense | other_income | other_expense
  category TEXT NOT NULL DEFAULT '',         -- top-level account group as QB reports it
  subcategory TEXT DEFAULT '',               -- the account line
  amount NUMERIC NOT NULL DEFAULT 0,
  class TEXT DEFAULT '',                     -- QB class/location if the books carry one (office)
  source TEXT NOT NULL DEFAULT 'qbo',        -- qbo | upload
  pulled_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_monthly_financials_month ON monthly_financials(month);

-- ── A/R: open customer invoices as QuickBooks sees them (replaced on every pull) ──
CREATE TABLE IF NOT EXISTS ar_invoices (
  id TEXT PRIMARY KEY,                       -- `${realm_id}:${qbo_invoice_id}`
  realm_id TEXT DEFAULT '',
  qbo_id TEXT DEFAULT '',
  doc_number TEXT DEFAULT '',                -- QB invoice number (matches Hub numbering when Ellie uses it)
  customer TEXT DEFAULT '',
  project_num TEXT DEFAULT '',               -- parsed from customer:job or memo ("YY-NNNN …")
  partner TEXT DEFAULT '',                   -- resolved from Master Data by project_num at sync time
  txn_date TEXT DEFAULT '',
  due_date TEXT DEFAULT '',
  amount NUMERIC DEFAULT 0,
  balance NUMERIC DEFAULT 0,
  days_past_due INTEGER DEFAULT 0,
  source TEXT NOT NULL DEFAULT 'qbo',
  pulled_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_ar_invoices_partner ON ar_invoices(partner);
CREATE INDEX IF NOT EXISTS idx_ar_invoices_project ON ar_invoices(project_num);

-- ── A/P: open vendor bills (sub-consultants) ──
CREATE TABLE IF NOT EXISTS ap_bills (
  id TEXT PRIMARY KEY,
  realm_id TEXT DEFAULT '',
  qbo_id TEXT DEFAULT '',
  doc_number TEXT DEFAULT '',
  vendor TEXT DEFAULT '',
  project_num TEXT DEFAULT '',
  txn_date TEXT DEFAULT '',
  due_date TEXT DEFAULT '',
  amount NUMERIC DEFAULT 0,
  balance NUMERIC DEFAULT 0,
  days_past_due INTEGER DEFAULT 0,
  source TEXT NOT NULL DEFAULT 'qbo',
  pulled_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── Sync log (what ran, when, how it went) ──
CREATE TABLE IF NOT EXISTS integration_runs (
  id SERIAL PRIMARY KEY,
  integration TEXT NOT NULL,                 -- qbo | backup | masterdata
  started_at TIMESTAMPTZ DEFAULT NOW(),
  finished_at TIMESTAMPTZ,
  status TEXT DEFAULT 'running',             -- running | ok | error
  detail TEXT DEFAULT ''
);

-- ── Work Plan project page: schedule, notes, links ──
-- schedule: [{id, phase:'DD', label:'Design Development', start:'YYYY-MM-DD', end:'YYYY-MM-DD', seeded:bool}]
-- links:    [{id, label, url, kind:'sharepoint'|'bluebeam'|'file'|'other', addedBy, addedAt, note}]
ALTER TABLE projects ADD COLUMN IF NOT EXISTS schedule JSONB DEFAULT '[]';
ALTER TABLE projects ADD COLUMN IF NOT EXISTS links JSONB DEFAULT '[]';

CREATE TABLE IF NOT EXISTS project_notes (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  author TEXT DEFAULT '',                    -- initials
  body TEXT NOT NULL DEFAULT '',
  kind TEXT DEFAULT 'note',                  -- note | decision | call | review | touchpoint
  pinned BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_project_notes_project ON project_notes(project_id, created_at DESC);

-- ── Clients: one record. Billing addresses live on the marketing client; projects point at them. ──
-- billing_addresses: [{id, label, attn, title, company, address1, address2, city_state_zip, email, is_default}]
ALTER TABLE marketing_clients ADD COLUMN IF NOT EXISTS billing_addresses JSONB DEFAULT '[]';
ALTER TABLE marketing_clients ADD COLUMN IF NOT EXISTS aliases JSONB DEFAULT '[]';   -- other spellings (Master Data "Client", QB customer)
ALTER TABLE project_billing_settings ADD COLUMN IF NOT EXISTS client_id TEXT DEFAULT '';
ALTER TABLE project_billing_settings ADD COLUMN IF NOT EXISTS billing_address_id TEXT DEFAULT '';

-- ── Light usage log: which pages get opened (to retire dead features with evidence, not guesses) ──
CREATE TABLE IF NOT EXISTS page_views (
  id SERIAL PRIMARY KEY,
  initials TEXT DEFAULT '',
  module TEXT DEFAULT '',
  tab TEXT DEFAULT '',
  at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_page_views_at ON page_views(at);
