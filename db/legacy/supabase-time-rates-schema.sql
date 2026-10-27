ALTER TABLE staff_profiles ADD COLUMN IF NOT EXISTS rate_title TEXT;

CREATE TABLE IF NOT EXISTS time_accounts (
  code TEXT PRIMARY KEY,
  group_name TEXT NOT NULL,
  name TEXT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order INTEGER NOT NULL DEFAULT 0
);

INSERT INTO time_accounts (code, group_name, name, sort_order) VALUES
  ('100', 'General', 'General', 100),
  ('111', 'Continuing Ed', 'Lunch & Learn', 111),
  ('112', 'Continuing Ed', 'Conference', 112),
  ('113', 'Continuing Ed', 'Industry Event', 113),
  ('121', 'Business Dev', 'Meeting', 121),
  ('122', 'Business Dev', 'Industry Event', 122),
  ('123', 'Business Dev', 'Conference', 123),
  ('124', 'Business Dev', 'Awards', 124),
  ('125', 'Business Dev', 'Photography', 125),
  ('126', 'Business Dev', 'Publications / Content', 126),
  ('127', 'Business Dev', 'Speaking', 127),
  ('131', 'Pursuits', 'RFP/Q', 131),
  ('132', 'Pursuits', 'Proposals', 132),
  ('133', 'Pursuits', 'Contract Negotiation', 133),
  ('140', 'Strategic Planning', 'Strategic Planning', 140),
  ('151', 'Systematic Excellence', 'Culture', 151),
  ('152', 'Systematic Excellence', 'Technical', 152),
  ('153', 'Systematic Excellence', 'Operations', 153),
  ('154', 'Systematic Excellence', 'Training', 154),
  ('161', 'Firm Event', 'Retreat', 161),
  ('162', 'Firm Event', 'Culture', 162),
  ('171', 'Time Off', 'PTO', 171),
  ('172', 'Time Off', 'Holiday', 172),
  ('182', 'Travel', 'Travel Time - Intraoffice', 182)
ON CONFLICT (code) DO UPDATE SET group_name = EXCLUDED.group_name, name = EXCLUDED.name, sort_order = EXCLUDED.sort_order;

CREATE TABLE IF NOT EXISTS rate_schedules (
  effective_year INTEGER PRIMARY KEY,
  label TEXT NOT NULL,
  partner NUMERIC(8,2) NOT NULL,
  principal NUMERIC(8,2) NOT NULL,
  project_manager NUMERIC(8,2) NOT NULL,
  senior_project_designer NUMERIC(8,2) NOT NULL,
  project_designer NUMERIC(8,2) NOT NULL,
  office_manager NUMERIC(8,2) NOT NULL,
  notes TEXT
);

INSERT INTO rate_schedules (effective_year, label, partner, principal, project_manager, senior_project_designer, project_designer, office_manager, notes) VALUES
  (2022, '2022 HDLA Fee Chart', 190, 135, 115, 115, 95, 50, 'Principal = Sr. Landscape Architect. PM and SPD = Landscape Architect. PD = LA Intern. OM = Clerical.'),
  (2023, '2023 HDLA Fee Chart', 195, 145, 125, 125, 95, 50, 'Principal = Sr. Landscape Architect. PM and SPD = Landscape Architect. PD = LA Intern. OM = Clerical.'),
  (2024, '2024 HDLA Fee Chart', 195, 165, 135, 115, 95, 50, 'Principal = Senior Associates.'),
  (2025, '2025 HDLA Fee Chart', 195, 165, 135, 115, 95, 50, NULL),
  (2026, '2026 HDLA Fee Chart', 195, 165, 135, 115, 95, 50, 'Current. Matches Accounting Employee_Info export.')
ON CONFLICT (effective_year) DO UPDATE SET label = EXCLUDED.label, partner = EXCLUDED.partner, principal = EXCLUDED.principal, project_manager = EXCLUDED.project_manager, senior_project_designer = EXCLUDED.senior_project_designer, project_designer = EXCLUDED.project_designer, office_manager = EXCLUDED.office_manager, notes = EXCLUDED.notes;

CREATE TABLE IF NOT EXISTS project_rate_overrides (
  project_num TEXT PRIMARY KEY,
  schedule_year INTEGER NOT NULL REFERENCES rate_schedules(effective_year),
  note TEXT,
  set_by TEXT,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE time_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE rate_schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_rate_overrides ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS time_accounts_read ON time_accounts;
CREATE POLICY time_accounts_read ON time_accounts FOR SELECT USING (auth.role() = 'authenticated');
DROP POLICY IF EXISTS rate_schedules_read ON rate_schedules;
CREATE POLICY rate_schedules_read ON rate_schedules FOR SELECT USING (auth.role() = 'authenticated');
DROP POLICY IF EXISTS project_rate_overrides_read ON project_rate_overrides;
CREATE POLICY project_rate_overrides_read ON project_rate_overrides FOR SELECT USING (auth.role() = 'authenticated');

UPDATE staff_profiles SET rate_title = 'Partner' WHERE initials IN ('RJ', 'CB', 'TJ', 'MB');
UPDATE staff_profiles SET rate_title = 'Principal' WHERE initials IN ('RW', 'AB', 'MM', 'HD', 'CM');
UPDATE staff_profiles SET rate_title = 'Project Manager' WHERE initials IN ('Mac', 'TS', 'YR');
UPDATE staff_profiles SET rate_title = 'Senior Project Designer' WHERE initials IN ('WB', 'CH', 'RC', 'Map');
UPDATE staff_profiles SET rate_title = 'Project Designer' WHERE initials IN ('EC', 'JY', 'TU', 'ME', 'SA', 'JD', 'AM', 'AR', 'JK', 'GA', 'JF', 'SH', 'KR');
UPDATE staff_profiles SET rate_title = 'CDAM' WHERE initials IN ('SI');
UPDATE staff_profiles SET rate_title = 'Marketing Manager' WHERE initials IN ('SD');
UPDATE staff_profiles SET rate_title = 'Marketing Coordinator' WHERE initials IN ('Aim');
UPDATE staff_profiles SET rate_title = 'Office Manager' WHERE initials IN ('EP');
