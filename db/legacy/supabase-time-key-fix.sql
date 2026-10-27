ALTER TABLE time_rows DROP CONSTRAINT IF EXISTS time_rows_user_id_project_num_phase_key;
ALTER TABLE time_rows ADD CONSTRAINT time_rows_user_line_key UNIQUE (user_id, project_num, project_name, phase);

ALTER TABLE time_entries DROP CONSTRAINT IF EXISTS time_entries_user_id_work_date_project_num_phase_key;
ALTER TABLE time_entries ADD CONSTRAINT time_entries_user_day_line_key UNIQUE (user_id, work_date, project_num, project_name, phase);

UPDATE time_rows SET project_name = '' WHERE project_name IS NULL;
UPDATE time_entries SET project_name = '' WHERE project_name IS NULL;
ALTER TABLE time_rows ALTER COLUMN project_name SET DEFAULT '';
ALTER TABLE time_entries ALTER COLUMN project_name SET DEFAULT '';
ALTER TABLE time_rows ALTER COLUMN project_name SET NOT NULL;
ALTER TABLE time_entries ALTER COLUMN project_name SET NOT NULL;
