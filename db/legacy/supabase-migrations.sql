-- Run these in Supabase SQL editor before deploying

-- Weekly planner: add promoted events persistence
ALTER TABLE weekly_planner ADD COLUMN IF NOT EXISTS promoted_events jsonb DEFAULT '[]'::jsonb;
ALTER TABLE weekly_planner ADD COLUMN IF NOT EXISTS completed_promoted jsonb DEFAULT '[]'::jsonb;

-- Marketing proposals: add new fields
ALTER TABLE marketing_proposals ADD COLUMN IF NOT EXISTS proposal_type text DEFAULT 'Proposal';
ALTER TABLE marketing_proposals ADD COLUMN IF NOT EXISTS review_partners jsonb DEFAULT '[]'::jsonb;
ALTER TABLE marketing_proposals ADD COLUMN IF NOT EXISTS review_notes text DEFAULT '';

-- Marketing events: add new fields
ALTER TABLE marketing_events ADD COLUMN IF NOT EXISTS end_date text DEFAULT '';
ALTER TABLE marketing_events ADD COLUMN IF NOT EXISTS attendees jsonb DEFAULT '[]'::jsonb;
ALTER TABLE marketing_events ADD COLUMN IF NOT EXISTS tasks jsonb DEFAULT '[]'::jsonb;

-- Projects: add review completion tracking
ALTER TABLE projects ADD COLUMN IF NOT EXISTS review_completed_by jsonb DEFAULT '{}'::jsonb;

-- Assigned tasks: cross-person task assignment
CREATE TABLE IF NOT EXISTS assigned_tasks (
  id TEXT PRIMARY KEY,
  description TEXT NOT NULL DEFAULT '',
  assigned_by TEXT NOT NULL,
  assigned_to TEXT NOT NULL,
  project_num TEXT DEFAULT '',
  project_name TEXT DEFAULT '',
  due_date TEXT DEFAULT '',
  done BOOLEAN DEFAULT false,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_assigned_tasks_to ON assigned_tasks(assigned_to);
CREATE INDEX IF NOT EXISTS idx_assigned_tasks_by ON assigned_tasks(assigned_by);
