-- HDLA Hub — billing: saved header name + repeat-monthly lines
-- Additive only (new nullable / defaulted columns). Safe to run on the live database at any time; run it once, before deploying.
-- Nothing in the Hub reads these columns until a header name is edited or a line is ticked "repeat monthly",
-- so the existing billing screens keep working if this is run after the deploy too.

ALTER TABLE project_billing_settings ADD COLUMN IF NOT EXISTS project_name TEXT;
ALTER TABLE project_billing_settings ADD COLUMN IF NOT EXISTS recurring_lines JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE invoice_lines ADD COLUMN IF NOT EXISTS repeat_key TEXT;
