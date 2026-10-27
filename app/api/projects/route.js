import { NextResponse } from 'next/server';
import { supabaseAdmin, dbToProject, projectToDb } from '../../../lib/supabaseAdmin';
import { requireCaller, hasRole, LEADERSHIP, PARTNERS } from '../../../lib/apiAuth';

export const dynamic = 'force-dynamic';

export async function GET(req) {
  const { error: authError } = await requireCaller(req);
  if (authError) return authError;
  try {
    const { data, error } = await supabaseAdmin
      .from('projects').select('*').order('project_name');
    if (error) throw error;
    return NextResponse.json({ projects: (data || []).map(dbToProject) });
  } catch (error) {
    return NextResponse.json({ projects: [], error: error.message }, { status: 500 });
  }
}

// Read project, apply mutation, write back
async function mutateProject(projectId, mutator) {
  const { data: row, error: readErr } = await supabaseAdmin
    .from('projects').select('*').eq('id', projectId).single();
  if (readErr) throw readErr;
  const project = dbToProject(row);
  const updated = mutator(project);
  const dbRow = projectToDb(updated);
  const { error: writeErr } = await supabaseAdmin
    .from('projects').upsert(dbRow, { onConflict: 'id' });
  if (writeErr) throw writeErr;
  return updated;
}

// Task completion: the newest stamp wins, so a stale page saving a whole week can't undo a tick (or a deliberate untick).
// A task's `completionUpdatedAt` is set whenever someone ticks/unticks it (Time tab or Work Plans).
const stampOf = t => Number(t && t.completionUpdatedAt) || 0;
const taskKeys = t => [t.id ? `id:${t.id}` : null, `k:${t.staff}|${t.task}|${t.week}`].filter(Boolean);
function keepNewerCompletion(storedTasks, incoming) {
  const stored = new Map();
  (storedTasks || []).forEach(t => taskKeys(t).forEach(k => stored.set(k, t)));
  return (incoming || []).map(t => {
    const s = taskKeys(t).map(k => stored.get(k)).find(Boolean);
    if (s && stampOf(s) > stampOf(t)) return { ...t, completed: !!s.completed, completionUpdatedAt: s.completionUpdatedAt };
    return t;
  });
}

function isDateInWeek(dateStr, weekKey) {
  if (!dateStr || !weekKey) return false;
  const date = new Date(dateStr + 'T12:00:00');
  const monday = new Date(weekKey + 'T12:00:00');
  const sunday = new Date(monday);
  sunday.setDate(sunday.getDate() + 6);
  return date >= monday && date <= sunday;
}

export async function POST(request) {
  // Any signed-in person may write (staff tick tasks from Time); review marks and deletes are gated below
  const { caller, error: authError } = await requireCaller(request);
  if (authError) return authError;
  try {
    const body = await request.json();
    if ((body.markReview || body.undoReview) && !hasRole(caller, PARTNERS)) return NextResponse.json({ success: false, error: 'Partners only' }, { status: 403 });
    if (body.deleteProjectId && !hasRole(caller, LEADERSHIP)) return NextResponse.json({ success: false, error: 'Not allowed for your role' }, { status: 403 });

    // COMBINED CELL EDIT — tasks + milestones + repeats in one atomic operation
    if (body.saveCellEdit) {
      const { projectId, weekLabel, weekKey, tasks, milestones, repeatTasks } = body.saveCellEdit;
      await mutateProject(projectId, (p) => {
        const otherTasks = (p.tasks || []).filter(t => t.week !== weekLabel);
        const otherMilestones = (p.milestones || []).filter(m => !isDateInWeek(m.date, weekKey));
        const mergedTasks = keepNewerCompletion((p.tasks || []).filter(t => t.week === weekLabel), tasks);
        // Add repeat tasks, skipping duplicates
        let allTasks = [...otherTasks, ...mergedTasks];
        if (repeatTasks && repeatTasks.length > 0) {
          const existingKeys = new Set(allTasks.map(t => `${t.staff}|${t.task}|${t.week}`));
          const newRepeats = repeatTasks.filter(t => !existingKeys.has(`${t.staff}|${t.task}|${t.week}`));
          allTasks = [...allTasks, ...newRepeats];
        }
        return { ...p, tasks: allTasks, milestones: [...otherMilestones, ...(milestones || [])] };
      });
      return NextResponse.json({ success: true });
    }

    // SET TASKS FOR A SPECIFIC WEEK — CellEditor uses this
    if (body.setTasksForWeek) {
      const { projectId, weekLabel, tasks } = body.setTasksForWeek;
      await mutateProject(projectId, (p) => {
        const otherTasks = (p.tasks || []).filter(t => t.week !== weekLabel);
        const mergedTasks = keepNewerCompletion((p.tasks || []).filter(t => t.week === weekLabel), tasks);
        return { ...p, tasks: [...otherTasks, ...mergedTasks] };
      });
      return NextResponse.json({ success: true });
    }

    // SET MILESTONES FOR A SPECIFIC WEEK — CellEditor uses this
    if (body.setMilestonesForWeek) {
      const { projectId, weekKey, milestones } = body.setMilestonesForWeek;
      await mutateProject(projectId, (p) => {
        const otherMilestones = (p.milestones || []).filter(m => !isDateInWeek(m.date, weekKey));
        return { ...p, milestones: [...otherMilestones, ...milestones] };
      });
      return NextResponse.json({ success: true });
    }

    // TICK / UNTICK ONE TASK — Time tab and Work Plans use this; changes only that task's completed flag
    if (body.setTaskCompleted) {
      const { projectId, taskId, staff, task, week, completed } = body.setTaskCompleted;
      let found = false; const stamp = Date.now();
      await mutateProject(projectId, (p) => {
        const tasks = (p.tasks || []).map(t => {
          const match = taskId ? t.id === taskId : (t.staff === staff && t.task === task && t.week === week);
          if (!match) return t;
          found = true;
          return { ...t, completed: !!completed, completionUpdatedAt: stamp };
        });
        return { ...p, tasks };
      });
      if (!found) return NextResponse.json({ success: false, error: 'Task not found — it may have been changed in Work Plans. Refresh and try again.' }, { status: 404 });
      return NextResponse.json({ success: true, completionUpdatedAt: stamp });
    }

    // ADD TASKS TO FUTURE WEEKS — repeat feature
    if (body.addRepeatTasks) {
      const { projectId, tasks } = body.addRepeatTasks;
      await mutateProject(projectId, (p) => {
        const existing = p.tasks || [];
        const existingKeys = new Set(existing.map(t => `${t.staff}|${t.task}|${t.week}`));
        const newTasks = tasks.filter(t => !existingKeys.has(`${t.staff}|${t.task}|${t.week}`));
        return { ...p, tasks: [...existing, ...newTasks] };
      });
      return NextResponse.json({ success: true });
    }

    // UPDATE SCALAR FIELDS — ProjectSettings uses this
    if (body.updateFields) {
      const { projectId, fields } = body.updateFields;
      await mutateProject(projectId, (p) => ({ ...p, ...fields }));
      return NextResponse.json({ success: true });
    }

    // MARK REVIEW COMPLETED
    if (body.markReview) {
      const { projectId, initials, date } = body.markReview;
      await mutateProject(projectId, (p) => ({
        ...p, reviewCompletedBy: { ...(p.reviewCompletedBy || {}), [initials]: date }
      }));
      return NextResponse.json({ success: true });
    }

    // UNDO REVIEW
    if (body.undoReview) {
      const { projectId, initials } = body.undoReview;
      await mutateProject(projectId, (p) => {
        const rcb = { ...(p.reviewCompletedBy || {}) };
        delete rcb[initials];
        return { ...p, reviewCompletedBy: rcb };
      });
      return NextResponse.json({ success: true });
    }

    // FULL PROJECT UPSERT — new project creation + legacy fallback
    if (body.project) {
      const dbRow = projectToDb(body.project);
      const { error } = await supabaseAdmin
        .from('projects').upsert(dbRow, { onConflict: 'id' });
      if (error) throw error;
      return NextResponse.json({ success: true });
    }

    // DELETE PROJECT
    if (body.deleteProjectId) {
      const { error } = await supabaseAdmin
        .from('projects').delete().eq('id', body.deleteProjectId);
      if (error) throw error;
      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ success: false, error: 'Invalid request' }, { status: 400 });
  } catch (error) {
    console.error('POST error:', error.message);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
