-- HDLA Hub — set 2026 hourly rates to match the Accounting Employee_Info export.
-- Safe to run on the live database; updates one row. Run once.
UPDATE rate_schedules
SET partner = 195, principal = 165, project_manager = 135,
    senior_project_designer = 115, project_designer = 95, office_manager = 50,
    notes = 'Current. Matches Accounting Employee_Info export.'
WHERE effective_year = 2026;
