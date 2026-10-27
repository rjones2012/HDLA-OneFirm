import { NextResponse } from 'next/server';
import { requireCaller, LEADERSHIP } from '../../../lib/apiAuth';
import { supabaseAdmin, dbToProject, projectToDb } from '../../../lib/supabaseAdmin';
import { loadMasterData } from '../../../lib/masterdata';

export const dynamic = 'force-dynamic';

// GET /api/project-page?id=<project id> → everything the Work Plan project page shows
export async function GET(req) {
  const { caller, error } = await requireCaller(req);
  if (error) return error;
  const { searchParams } = new URL(req.url);
  const id = searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 });
  const { data: row } = await supabaseAdmin.from('projects').select('*').eq('id', id).single();
  if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const project = dbToProject(row);
  const num = project.projectNum;
  const finance = ['partner', 'operations', 'office'].includes(caller.role);
  const leadership = LEADERSHIP.includes(caller.role);
  const [notesRes, md, invRes, arRes, apRes, hoursRes] = await Promise.all([
    supabaseAdmin.from('project_notes').select('*').eq('project_id', id).order('pinned', { ascending: false }).order('created_at', { ascending: false }),
    loadMasterData().catch(() => ({ data: [] })),
    finance && num ? supabaseAdmin.from('invoices').select('id, invoice_number, period_month, status, total_due, sent_at, updated_at').eq('project_num', num).order('period_month', { ascending: false }).limit(12) : Promise.resolve({ data: [] }),
    leadership && num ? supabaseAdmin.from('ar_invoices').select('*').eq('project_num', num).gt('balance', 0) : Promise.resolve({ data: [] }),
    leadership && num ? supabaseAdmin.from('ap_bills').select('*').eq('project_num', num).gt('balance', 0) : Promise.resolve({ data: [] }),
    leadership && num ? supabaseAdmin.from('time_entries').select('hours, phase, work_date').eq('project_num', num) : Promise.resolve({ data: [] }),
  ]);
  const mdRows = (md.data || []).filter(r => r['Project #'] === num);
  const hoursByPhase = {};
  (hoursRes.data || []).forEach(e => { hoursByPhase[e.phase || ''] = (hoursByPhase[e.phase || ''] || 0) + (Number(e.hours) || 0); });
  return NextResponse.json({ project, notes: notesRes.data || [], masterData: mdRows, invoices: invRes.data || [], ar: arRes.data || [], ap: apRes.data || [], hoursByPhase, loadedAt: new Date().toISOString() });
}

// POST — notes, links, schedule
export async function POST(req) {
  const { caller, error } = await requireCaller(req);
  if (error) return error;
  const body = await req.json().catch(() => ({}));
  try {
    if (body.note) {
      const n = body.note;
      const row = { id: n.id, project_id: n.projectId, author: n.author || caller.initials, body: String(n.body || ''), kind: n.kind || 'note', pinned: !!n.pinned, updated_at: new Date().toISOString() };
      const { error: e } = await supabaseAdmin.from('project_notes').upsert(row, { onConflict: 'id' }); if (e) throw e;
      return NextResponse.json({ ok: true });
    }
    if (body.deleteNote) {
      const { data: n } = await supabaseAdmin.from('project_notes').select('author').eq('id', body.deleteNote).single();
      if (n && n.author !== caller.initials && !LEADERSHIP.includes(caller.role)) return NextResponse.json({ error: 'Only the author or leadership can delete a note' }, { status: 403 });
      await supabaseAdmin.from('project_notes').delete().eq('id', body.deleteNote);
      return NextResponse.json({ ok: true });
    }
    if (body.links || body.schedule) {
      const id = body.projectId; if (!id) return NextResponse.json({ error: 'Missing projectId' }, { status: 400 });
      const patch = {};
      if (Array.isArray(body.links)) patch.links = body.links;
      if (Array.isArray(body.schedule)) patch.schedule = body.schedule;
      const { error: e } = await supabaseAdmin.from('projects').update(patch).eq('id', id); if (e) throw e;
      return NextResponse.json({ ok: true });
    }
    return NextResponse.json({ error: 'Unknown payload' }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
