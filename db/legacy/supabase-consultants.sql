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
