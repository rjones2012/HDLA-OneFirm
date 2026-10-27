import { NextResponse } from 'next/server';
import { supabaseAdmin } from '../../../lib/supabaseAdmin';
import { requireCaller, hasRole, LEADERSHIP } from '../../../lib/apiAuth';

export const dynamic = 'force-dynamic';

// One row per task. Tasks assigned by hand on the planner have no source; next steps on a
// lead or a touchpoint (Marketing) are rows here too, with source_type 'lead' / 'touchpoint'
// (see supabase-next-steps-planner.sql). Ticking a row anywhere ticks it everywhere.
const mapRow = r => ({
  id: r.id, description: r.description, assignedBy: r.assigned_by, assignedTo: r.assigned_to,
  projectNum: r.project_num || '', projectName: r.project_name || '',
  dueDate: r.due_date || '', done: r.done || false, completedAt: r.completed_at || null,
  createdAt: r.created_at,
  sourceType: r.source_type || '', sourceId: r.source_id || '', clientId: r.client_id || '', sourceLabel: r.source_label || '',
});

// GET /api/assigned-tasks?initials=RJ
// Returns tasks assigned TO this person and tasks assigned BY this person to someone else
export async function GET(req) {
  const { caller, error: authError } = await requireCaller(req);
  if (authError) return authError;
  try {
    const { searchParams } = new URL(req.url);
    const initials = searchParams.get('initials');
    if (!initials) return NextResponse.json({ error: 'Missing initials' }, { status: 400 });
    // People see their own tasks; leadership can look at anyone's
    if (initials !== caller.initials && !hasRole(caller, LEADERSHIP)) return NextResponse.json({ error: 'You can only view your own tasks', received: [], sent: [] }, { status: 403 });

    const [receivedRes, sentRes] = await Promise.all([
      supabaseAdmin.from('assigned_tasks').select('*').eq('assigned_to', initials).order('due_date'),
      supabaseAdmin.from('assigned_tasks').select('*').eq('assigned_by', initials).neq('assigned_to', initials).order('due_date'),
    ]);
    if (receivedRes.error) throw receivedRes.error;
    if (sentRes.error) throw sentRes.error;

    return NextResponse.json({
      received: (receivedRes.data || []).map(mapRow),
      sent: (sentRes.data || []).map(mapRow),
    });
  } catch (e) {
    return NextResponse.json({ error: e.message, received: [], sent: [] }, { status: 500 });
  }
}

// POST /api/assigned-tasks — create, update, or delete
export async function POST(req) {
  const { error: authError } = await requireCaller(req);
  if (authError) return authError;
  try {
    const body = await req.json();

    // Create new task (hand-assigned on the planner)
    if (body.create) {
      const t = body.create;
      const row = {
        id: t.id,
        description: t.description || '',
        assigned_by: t.assignedBy,
        assigned_to: t.assignedTo,
        project_num: t.projectNum || '',
        project_name: t.projectName || '',
        due_date: t.dueDate || '',
        done: false,
      };
      const extra = { source_type: t.sourceType || '', source_id: t.sourceId || '', client_id: t.clientId || '', source_label: t.sourceLabel || '' };
      let res = await supabaseAdmin.from('assigned_tasks').insert({ ...row, ...extra }).select().single();
      // before supabase-next-steps-planner.sql has run those columns do not exist: insert without them
      if (res.error && /column|schema cache|PGRST204|42703/i.test(String(res.error.message) + ' ' + String(res.error.code))) {
        res = await supabaseAdmin.from('assigned_tasks').insert(row).select().single();
      }
      if (res.error) throw res.error;
      return NextResponse.json({ task: mapRow(res.data), success: true });
    }

    // Mark complete/incomplete — one row, so it is done everywhere it shows
    if (body.toggleDone) {
      const { id, done } = body.toggleDone;
      const updates = { done };
      if (done) updates.completed_at = new Date().toISOString();
      else updates.completed_at = null;
      const { error } = await supabaseAdmin.from('assigned_tasks').update(updates).eq('id', id);
      if (error) throw error;
      return NextResponse.json({ success: true });
    }

    // Delete
    if (body.deleteTask) {
      const { error } = await supabaseAdmin.from('assigned_tasks').delete().eq('id', body.deleteTask);
      if (error) throw error;
      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ error: 'Unknown payload' }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
