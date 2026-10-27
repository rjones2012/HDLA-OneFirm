CREATE TABLE IF NOT EXISTS clients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  attn TEXT,
  title TEXT,
  company TEXT,
  address1 TEXT,
  address2 TEXT,
  city_state_zip TEXT,
  email TEXT,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS project_billing_settings (
  project_num TEXT PRIMARY KEY,
  bill_to_client TEXT,
  principal_label TEXT NOT NULL DEFAULT 'Principal',
  principal_name TEXT,
  signer_initials TEXT,
  reference_lines JSONB NOT NULL DEFAULT '[]'::jsonb,
  hourly_phases JSONB NOT NULL DEFAULT '[]'::jsonb,
  notes TEXT,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS invoice_sequences (
  period_month TEXT PRIMARY KEY,
  last_seq INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS invoices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_number TEXT UNIQUE,
  period_month TEXT NOT NULL,
  invoice_date DATE NOT NULL,
  services_through DATE NOT NULL,
  project_num TEXT NOT NULL,
  project_num_display TEXT,
  project_name TEXT,
  client_name TEXT,
  principal_label TEXT NOT NULL DEFAULT 'Principal',
  principal_name TEXT,
  bill_to JSONB NOT NULL DEFAULT '{}'::jsonb,
  reference_lines JSONB NOT NULL DEFAULT '[]'::jsonb,
  signer_initials TEXT,
  signer_text TEXT,
  status TEXT NOT NULL DEFAULT 'draft',
  total_due NUMERIC(12,2) NOT NULL DEFAULT 0,
  internal_note TEXT,
  review_note TEXT,
  created_by TEXT,
  approved_by TEXT,
  approved_at TIMESTAMPTZ,
  sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(project_num, period_month)
);

CREATE INDEX IF NOT EXISTS idx_invoices_period ON invoices(period_month, status);
CREATE INDEX IF NOT EXISTS idx_invoices_project ON invoices(project_num);

CREATE TABLE IF NOT EXISTS invoice_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id UUID NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  kind TEXT NOT NULL DEFAULT 'phase',
  phase TEXT,
  description TEXT NOT NULL,
  contract_amount NUMERIC(12,2),
  pct NUMERIC(7,3),
  earned NUMERIC(12,2),
  previous NUMERIC(12,2),
  this_invoice NUMERIC(12,2),
  remaining NUMERIC(12,2),
  tbd BOOLEAN NOT NULL DEFAULT FALSE,
  hourly_detail JSONB,
  qty NUMERIC(10,2),
  unit TEXT,
  rate NUMERIC(10,2),
  source JSONB,
  overridden BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_invoice_lines_invoice ON invoice_lines(invoice_id, sort_order);

ALTER TABLE clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_billing_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoice_sequences ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoice_lines ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS invoice_comments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id UUID NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  line_id UUID REFERENCES invoice_lines(id) ON DELETE SET NULL,
  line_label TEXT,
  author_initials TEXT NOT NULL,
  author_role TEXT,
  body TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'comment',
  resolved BOOLEAN NOT NULL DEFAULT FALSE,
  resolved_by TEXT,
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_invoice_comments_invoice ON invoice_comments(invoice_id, created_at);
ALTER TABLE invoice_comments ENABLE ROW LEVEL SECURITY;

ALTER TABLE project_billing_settings ADD COLUMN IF NOT EXISTS line_overrides JSONB NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE invoices ADD COLUMN IF NOT EXISTS principal_initials TEXT;

CREATE TABLE IF NOT EXISTS project_consultants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_num TEXT NOT NULL,
  name TEXT NOT NULL,
  contract_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  mode TEXT NOT NULL DEFAULT 'fold',
  phase_key TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_project_consultants_project ON project_consultants(project_num);

CREATE TABLE IF NOT EXISTS consultant_bills (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  consultant_id UUID NOT NULL REFERENCES project_consultants(id) ON DELETE CASCADE,
  invoice_id UUID REFERENCES invoices(id) ON DELETE SET NULL,
  period_month TEXT NOT NULL,
  amount NUMERIC(12,2) NOT NULL,
  vendor_ref TEXT,
  note TEXT,
  created_by TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_consultant_bills_consultant ON consultant_bills(consultant_id, period_month);

ALTER TABLE project_consultants ENABLE ROW LEVEL SECURITY;
ALTER TABLE consultant_bills ENABLE ROW LEVEL SECURITY;
