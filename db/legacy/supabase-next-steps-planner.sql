-- ═══════════════════════════════════════════════════════════════
-- HDLA Hub — Next steps on the Personal Planner
-- Additive only. Safe to run more than once. Run in the Supabase SQL Editor.
--
-- Every next step (on a lead OR on a touchpoint) becomes a row in assigned_tasks,
-- the same table the planner's "Assigned to You" box already reads. One row, one
-- checkbox: ticking it on the planner, in the lead form, in the touchpoint form or
-- on the Touchpoints tab all update the same row.
--
-- Until this runs the app still works: lead steps keep saving to the old JSON
-- column and touchpoint steps / planner sync simply won't persist.
-- ═══════════════════════════════════════════════════════════════

-- 1. Where a task came from (blank for tasks assigned by hand on the planner)
ALTER TABLE assigned_tasks ADD COLUMN IF NOT EXISTS source_type TEXT DEFAULT '';   -- '', 'lead', 'touchpoint'
ALTER TABLE assigned_tasks ADD COLUMN IF NOT EXISTS source_id TEXT DEFAULT '';     -- marketing_proposals.id or marketing_touchpoints.id
ALTER TABLE assigned_tasks ADD COLUMN IF NOT EXISTS client_id TEXT DEFAULT '';     -- marketing_clients.id
ALTER TABLE assigned_tasks ADD COLUMN IF NOT EXISTS source_label TEXT DEFAULT '';  -- e.g. "Greenway Phase 2 · Metro Parks" (so the planner needs no lookup)
ALTER TABLE assigned_tasks ADD COLUMN IF NOT EXISTS position INTEGER DEFAULT 0;    -- order within its lead / touchpoint

CREATE INDEX IF NOT EXISTS idx_assigned_tasks_source ON assigned_tasks(source_type, source_id);

-- 2. One-time copy of existing lead next steps (JSON on marketing_proposals) into rows.
--    ON CONFLICT DO NOTHING makes this safe to re-run; steps already copied are skipped.
INSERT INTO assigned_tasks (id, description, assigned_by, assigned_to, project_num, project_name, due_date, done, completed_at,
                            source_type, source_id, client_id, source_label, position)
SELECT
  COALESCE(NULLIF(s.step->>'id',''), p.id || '-' || s.ord),
  COALESCE(s.step->>'text',''),
  COALESCE(NULLIF(p.partner,''),'RJ'),
  COALESCE(NULLIF(s.step->>'assignedTo',''), NULLIF(p.partner,''), 'RJ'),
  '', '',
  COALESCE(s.step->>'date',''),
  COALESCE((s.step->>'done')::boolean,false),
  CASE WHEN COALESCE((s.step->>'done')::boolean,false) THEN COALESCE(NULLIF(s.step->>'doneAt','')::timestamptz, NOW()) ELSE NULL END,
  'lead', p.id, COALESCE(p.client_id,''),
  COALESCE(NULLIF(p.project_name,''),'Untitled') || COALESCE(' · ' || NULLIF(c.name,''), ''),
  s.ord
FROM marketing_proposals p
LEFT JOIN marketing_clients c ON c.id = p.client_id
CROSS JOIN LATERAL jsonb_array_elements(COALESCE(p.next_steps,'[]'::jsonb)) WITH ORDINALITY AS s(step, ord)
WHERE jsonb_typeof(COALESCE(p.next_steps,'[]'::jsonb)) = 'array'
  AND (COALESCE(s.step->>'text','') <> '' OR COALESCE(s.step->>'date','') <> '')
ON CONFLICT (id) DO NOTHING;

-- 3. Leads that only ever had the old single next_step field (no JSON list) get one row too.
INSERT INTO assigned_tasks (id, description, assigned_by, assigned_to, project_num, project_name, due_date, done, completed_at,
                            source_type, source_id, client_id, source_label, position)
SELECT
  'legacy-' || p.id,
  COALESCE(p.next_step,''),
  COALESCE(NULLIF(p.partner,''),'RJ'),
  COALESCE(NULLIF(p.partner,''),'RJ'),
  '', '',
  COALESCE(p.next_step_date,''),
  false, NULL,
  'lead', p.id, COALESCE(p.client_id,''),
  COALESCE(NULLIF(p.project_name,''),'Untitled') || COALESCE(' · ' || NULLIF(c.name,''), ''),
  1
FROM marketing_proposals p
LEFT JOIN marketing_clients c ON c.id = p.client_id
WHERE (COALESCE(p.next_step,'') <> '' OR COALESCE(p.next_step_date,'') <> '')
  AND jsonb_array_length(COALESCE(p.next_steps,'[]'::jsonb)) = 0
  AND NOT EXISTS (SELECT 1 FROM assigned_tasks a WHERE a.source_type='lead' AND a.source_id=p.id)
ON CONFLICT (id) DO NOTHING;
