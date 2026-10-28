import { NextResponse } from 'next/server';
import { supabaseAdmin } from '../../../lib/supabaseAdmin';
import { requireCaller, hasRole, LEADERSHIP } from '../../../lib/apiAuth';

export const dynamic = 'force-dynamic';

// Anyone signed in may log a touchpoint (Time → "Log as touchpoint" is open to all staff with BD time)
// and tick a next step. Everything else — events, IDIQ, priority list, deletes of clients/leads — is leadership only.
const STAFF_ACTIONS = ['touchpoint', 'deleteTouchpoint', 'proposal', 'client', 'relLog', 'stepDone'];

// Upsert that keeps working if the leads SQL (supabase-marketing-leads.sql)
// has not been run yet: on a missing-column error, retry without the new fields.
async function upsertCompat(table, row, extraKeys) {
  // Try the full row. If a newer column does not exist yet, drop just that column and retry,
  // so a partly-run migration never blocks saving.
  let cur = { ...row };
  let degraded = false;
  for (let i = 0; i <= extraKeys.length; i++) {
    const res = await supabaseAdmin.from(table).upsert(cur, { onConflict: 'id' });
    if (!res.error) return { error: null, degraded };
    const msg = String(res.error.message || '') + ' ' + String(res.error.code || '');
    if (!/column|schema cache|PGRST204|42703/i.test(msg)) return { error: res.error, degraded };
    const named = (msg.match(/'([a-z_]+)' column/i) || [])[1];
    if (named && named in cur && extraKeys.includes(named)) {
      delete cur[named];
    } else {
      extraKeys.forEach(k => { delete cur[k]; });
    }
    degraded = true;
  }
  return { error: { message: 'Could not save after dropping missing columns' }, degraded };
}
const TP_NEW = ['contact_ids', 'contact_names', 'lead_ids', 'time_entry_id', 'time_hours'];
const PROP_NEW = ['next_step', 'next_step_date', 'lead_since', 'dead_reason', 'source_touchpoint_id', 'contact_ids', 'other_client_ids', 'next_steps'];

// ─── Next steps as rows in assigned_tasks (supabase-next-steps-planner.sql) ───────────────
// Every step on a lead or a touchpoint is one row there, so the planner's "Assigned to You"
// box, the lead form, the touchpoint form and the Touchpoints tab all tick the same row.
// Until that SQL has run, the select below fails on the missing column and the app falls
// back to the JSON steps stored on each proposal (touchpoint steps then do not persist).
const newUid = () => Date.now().toString(36) + Math.random().toString(36).substr(2, 9);
const byDate = (a, b) => { const x = a.date || '9999-99-99', y = b.date || '9999-99-99'; return x < y ? -1 : x > y ? 1 : 0; };
const rowToStep = r => ({
  id: r.id,
  text: r.description || '',
  date: r.due_date || '',
  done: !!r.done,
  doneAt: r.completed_at ? String(r.completed_at).slice(0, 10) : '',
  assignedTo: r.assigned_to || '',
  assignedBy: r.assigned_by || '',
});

async function loadStepRows() {
  const res = await supabaseAdmin.from('assigned_tasks').select('*').in('source_type', ['lead', 'touchpoint']).order('position', { ascending: true }).order('created_at', { ascending: true });
  if (res.error) return { ready: false, bySource: {} };
  const bySource = {};
  (res.data || []).forEach(r => {
    const k = r.source_type + ':' + r.source_id;
    (bySource[k] = bySource[k] || []).push(rowToStep(r));
  });
  return { ready: true, bySource };
}

// Diff the steps sent by the app against the rows for this lead / touchpoint: upsert the ones
// sent, delete the ones removed. Returns ready:false (and does nothing) until the SQL has run.
async function syncSteps(sourceType, sourceId, steps, ctx) {
  const ex = await supabaseAdmin.from('assigned_tasks').select('id,completed_at').eq('source_type', sourceType).eq('source_id', sourceId);
  if (ex.error) return { ready: false };
  const existing = ex.data || [];
  const keep = (Array.isArray(steps) ? steps : []).filter(s => (s.text || '').trim() || s.date);
  const now = new Date().toISOString();
  const rows = keep.map((s, i) => {
    const prev = existing.find(e => e.id === s.id);
    const done = !!s.done;
    let completed = null;
    if (done) completed = prev?.completed_at || (s.doneAt ? new Date(s.doneAt).toISOString() : now);
    return {
      id: s.id || newUid(),
      description: (s.text || '').trim(),
      assigned_by: s.assignedBy || ctx.by || '',
      assigned_to: s.assignedTo || ctx.by || '',
      project_num: '',
      project_name: '',
      due_date: s.date || '',
      done,
      completed_at: completed,
      source_type: sourceType,
      source_id: sourceId,
      client_id: ctx.clientId || '',
      source_label: ctx.label || '',
      position: i + 1,
    };
  });
  if (rows.length) {
    const up = await supabaseAdmin.from('assigned_tasks').upsert(rows, { onConflict: 'id' });
    if (up.error) throw up.error;
  }
  const gone = existing.map(e => e.id).filter(id => !rows.some(r => r.id === id));
  if (gone.length) {
    const del = await supabaseAdmin.from('assigned_tasks').delete().in('id', gone);
    if (del.error) throw del.error;
  }
  return { ready: true };
}

async function deleteSteps(sourceType, sourceId) {
  try { await supabaseAdmin.from('assigned_tasks').delete().eq('source_type', sourceType).eq('source_id', sourceId); } catch (e) { /* column may not exist yet */ }
}

async function clientName(id) {
  if (!id) return '';
  const r = await supabaseAdmin.from('marketing_clients').select('name').eq('id', id).maybeSingle();
  return r.data?.name || '';
}
const leadLabel = (p, cname) => (p.projectName || 'Untitled') + (cname ? ' · ' + cname : '');
const tpLabel = (t, cname) => [t.type || 'Touchpoint', cname ? 'with ' + cname : '', t.date ? '· ' + t.date : ''].filter(Boolean).join(' ');

export async function GET(req) {
  const { caller, error: authError } = await requireCaller(req);
  if (authError) return authError;
  const full = hasRole(caller, LEADERSHIP);
  try {
    const [clientsRes, tpRes, propRes, evtRes, relRes, idiqRes, priorityRes, steps] = await Promise.all([
      supabaseAdmin.from('marketing_clients').select('*').order('name'),
      supabaseAdmin.from('marketing_touchpoints').select('*').order('date', { ascending: false }),
      supabaseAdmin.from('marketing_proposals').select('*').order('created_at', { ascending: false }),
      // non-leadership callers get just what the touchpoint form needs: clients, touchpoints, leads
      full ? supabaseAdmin.from('marketing_events').select('*').order('date') : Promise.resolve({ data: [] }),
      full ? supabaseAdmin.from('marketing_rel_log').select('*').order('date', { ascending: false }) : Promise.resolve({ data: [] }),
      full ? supabaseAdmin.from('marketing_idiqs').select('*').order('created_at', { ascending: false }) : Promise.resolve({ data: [] }),
      full ? supabaseAdmin.from('marketing_priority').select('*').order('position', { ascending: true }) : Promise.resolve({ data: [] }),
      loadStepRows(),
    ]);
    const stepsFor = (type, id) => steps.bySource[type + ':' + id] || [];

    return NextResponse.json({
      stepsReady: steps.ready,
      clients: (clientsRes.data || []).map(r => ({
        id: r.id,
        name: r.name || '',
        sector: r.sector || '',
        office: r.office || 'Nashville',
        markets: r.markets || [],
        partners: r.partners || [],
        tier: r.tier || 3,
        relationshipScore: r.relationship_score || 5,
        relationshipOverride: r.relationship_override,
        touchpointValue: r.touchpoint_value || 5,
        strategic: r.strategic || false,
        contacts: r.contacts || [],
        notes: r.notes || '',
      })),
      touchpoints: (tpRes.data || []).map(r => ({
        id: r.id,
        clientId: r.client_id || '',
        type: r.type || '',
        partner: r.partner || '',
        date: r.date || '',
        status: r.status || 'completed',
        rating: r.rating || 3,
        notes: r.notes || '',
        contactIds: r.contact_ids || [],
        contactNames: r.contact_names || [],
        leadIds: r.lead_ids || [],
        timeEntryId: r.time_entry_id || '',
        timeHours: r.time_hours || 0,
        nextSteps: stepsFor('touchpoint', r.id),
      })),
      proposals: (propRes.data || []).map(r => {
        // rows win once the planner SQL has run; before that, the JSON list on the proposal
        const rowSteps = stepsFor('lead', r.id);
        const nextSteps = steps.ready ? rowSteps : (Array.isArray(r.next_steps) ? r.next_steps : []);
        const first = steps.ready ? nextSteps.filter(s => !s.done).sort(byDate)[0] : null;
        return {
          id: r.id,
          clientId: r.client_id || '',
          projectName: r.project_name || '',
          fee: r.fee || 0,
          probability: r.probability || 'M',
          status: r.status || 'Tracking',
          partner: r.partner || '',
          pm: r.pm || '',
          proposalType: r.proposal_type || 'Proposal',
          office: r.office || '',
          sector: r.sector || '',
          market: r.market || '',
          submarket: r.submarket || '',
          dueDate: r.due_date || '',
          submittedDate: r.submitted_date || '',
          awardedDate: r.awarded_date || '',
          kickoffDone: r.kickoff_done || false,
          notes: r.notes || '',
          needs: r.needs || [],
          tasks: r.tasks || [],
          reviewPartners: r.review_partners || [],
          reviewNotes: r.review_notes || '',
          nextStep: steps.ready ? (first ? first.text : '') : (r.next_step || ''),
          nextStepDate: steps.ready ? (first ? first.date : '') : (r.next_step_date || ''),
          leadSince: r.lead_since || '',
          deadReason: r.dead_reason || '',
          sourceTouchpointId: r.source_touchpoint_id || '',
          contactIds: r.contact_ids || [],
          otherClientIds: r.other_client_ids || [],
          nextSteps,
          createdAt: r.created_at || '',
        };
      }),
      events: (evtRes.data || []).map(r => ({
        id: r.id,
        name: r.name || '',
        type: r.type || '',
        date: r.date || '',
        endDate: r.end_date || '',
        location: r.location || '',
        attendees: r.attendees || [],
        needs: r.needs || [],
        tasks: r.tasks || [],
      })),
      relLog: (relRes.data || []).map(r => ({
        clientId: r.client_id || '',
        date: r.date || '',
        oldScore: r.old_score || 0,
        newScore: r.new_score || 0,
        reason: r.reason || '',
      })),
      idiqs: (idiqRes.data || []).map(r => ({
        id: r.id,
        clientId: r.client_id || '',
        dateAwarded: r.date_awarded || '',
        dateExpired: r.date_expired || '',
        contacts: r.contacts || [],
        notes: r.notes || '',
      })),
      priority: (priorityRes.data || []).map(r => ({
        id: r.id,
        clientId: r.client_id || '',
        owner: r.owner || '',
        note: r.note || '',
        done: r.done || false,
        position: r.position || 0,
      })),
    });
  } catch (error) {
    console.error('Marketing GET error:', error);
    return NextResponse.json({ clients: [], touchpoints: [], proposals: [], events: [], relLog: [], idiqs: [], priority: [], stepsReady: false });
  }
}

export async function POST(request) {
  const { caller, error: authError } = await requireCaller(request);
  if (authError) return authError;
  try {
    const body = await request.json();
    if (!hasRole(caller, LEADERSHIP) && !Object.keys(body || {}).every(k => STAFF_ACTIONS.includes(k))) {
      return NextResponse.json({ error: 'Not allowed for your role' }, { status: 403 });
    }

    // ─── Client upsert ─────────────────────────────
    if (body.client) {
      const c = body.client;
      const { error } = await supabaseAdmin.from('marketing_clients').upsert({
        id: c.id,
        name: c.name || '',
        sector: c.sector || '',
        office: c.office || 'Nashville',
        markets: c.markets || [],
        partners: c.partners || [],
        tier: c.tier || 3,
        relationship_score: c.relationshipScore || 5,
        relationship_override: c.relationshipOverride,
        touchpoint_value: c.touchpointValue || 5,
        strategic: c.strategic || false,
        contacts: c.contacts || [],
        notes: c.notes || '',
        updated_at: new Date().toISOString(),
      }, { onConflict: 'id' });
      if (error) throw error;
      return NextResponse.json({ success: true });
    }

    // ─── Client delete ─────────────────────────────
    if (body.deleteClient) {
      const { error } = await supabaseAdmin.from('marketing_clients').delete().eq('id', body.deleteClient);
      if (error) throw error;
      return NextResponse.json({ success: true });
    }

    // ─── Touchpoint upsert ─────────────────────────
    if (body.touchpoint) {
      const t = body.touchpoint;
      const { error, degraded } = await upsertCompat('marketing_touchpoints', {
        id: t.id,
        client_id: t.clientId || '',
        type: t.type || '',
        partner: t.partner || '',
        date: t.date || '',
        status: t.status || 'completed',
        rating: t.rating || 3,
        notes: t.notes || '',
        contact_ids: t.contactIds || [],
        contact_names: t.contactNames || [],
        lead_ids: t.leadIds || [],
        time_entry_id: t.timeEntryId || '',
        time_hours: t.timeHours || 0,
      }, TP_NEW);
      if (error) throw error;
      // the touchpoint's own next steps → planner rows (only when the app sent the list)
      let stepsReady = true;
      if (Array.isArray(t.nextSteps)) {
        const cname = await clientName(t.clientId);
        const r = await syncSteps('touchpoint', t.id, t.nextSteps, { clientId: t.clientId, label: tpLabel(t, cname), by: t.partner || '' });
        stepsReady = r.ready;
      }
      return NextResponse.json({ success: true, degraded, stepsReady });
    }

    // ─── Proposal upsert ───────────────────────────
    if (body.proposal) {
      const p = body.proposal;
      const { error, degraded } = await upsertCompat('marketing_proposals', {
        id: p.id,
        client_id: p.clientId || '',
        project_name: p.projectName || '',
        fee: p.fee || 0,
        probability: p.probability || 'M',
        status: p.status || 'Lead',
        partner: p.partner || '',
        pm: p.pm || '',
        proposal_type: p.proposalType || 'Proposal',
        office: p.office || '',
        sector: p.sector || '',
        market: p.market || '',
        submarket: p.submarket || '',
        due_date: p.dueDate || '',
        submitted_date: p.submittedDate || '',
        awarded_date: p.awardedDate || '',
        kickoff_done: p.kickoffDone || false,
        notes: p.notes || '',
        needs: p.needs || [],
        tasks: p.tasks || [],
        review_partners: p.reviewPartners || [],
        review_notes: p.reviewNotes || '',
        next_step: p.nextStep || '',
        next_step_date: p.nextStepDate || '',
        lead_since: p.leadSince || '',
        dead_reason: p.deadReason || '',
        source_touchpoint_id: p.sourceTouchpointId || '',
        contact_ids: p.contactIds || [],
        other_client_ids: p.otherClientIds || [],
        next_steps: Array.isArray(p.nextSteps) ? p.nextSteps : [],
      }, PROP_NEW);
      if (error) throw error;
      // the lead's next steps → planner rows (the JSON above stays as a fallback until the SQL runs)
      let stepsReady = true;
      if (Array.isArray(p.nextSteps)) {
        const cname = await clientName(p.clientId);
        const r = await syncSteps('lead', p.id, p.nextSteps, { clientId: p.clientId, label: leadLabel(p, cname), by: p.partner || '' });
        stepsReady = r.ready;
      }
      return NextResponse.json({ success: true, degraded, stepsReady });
    }

    // ─── Proposal delete ───────────────────────────
    if (body.deleteProposal) {
      const { error } = await supabaseAdmin.from('marketing_proposals').delete().eq('id', body.deleteProposal);
      if (error) throw error;
      await deleteSteps('lead', body.deleteProposal);
      return NextResponse.json({ success: true });
    }

    // ─── Touchpoint delete ──────────────────────────
    if (body.deleteTouchpoint) {
      const { error } = await supabaseAdmin.from('marketing_touchpoints').delete().eq('id', body.deleteTouchpoint);
      if (error) throw error;
      await deleteSteps('touchpoint', body.deleteTouchpoint);
      // a time entry that was logged as this touchpoint just loses its tag (best effort; column may not exist yet)
      try { await supabaseAdmin.from('time_entries').update({ touchpoint_id: null }).eq('touchpoint_id', body.deleteTouchpoint); } catch (e) { /* ignore */ }
      return NextResponse.json({ success: true });
    }

    // ─── Event upsert ──────────────────────────────
    if (body.event) {
      const e = body.event;
      const { error } = await supabaseAdmin.from('marketing_events').upsert({
        id: e.id,
        name: e.name || '',
        type: e.type || '',
        date: e.date || '',
        end_date: e.endDate || '',
        location: e.location || '',
        attendees: e.attendees || [],
        needs: e.needs || [],
        tasks: e.tasks || [],
      }, { onConflict: 'id' });
      if (error) throw error;
      return NextResponse.json({ success: true });
    }

    // ─── Event delete ──────────────────────────────
    if (body.deleteEvent) {
      const { error } = await supabaseAdmin.from('marketing_events').delete().eq('id', body.deleteEvent);
      if (error) throw error;
      return NextResponse.json({ success: true });
    }

    // ─── Rel log append ────────────────────────────
    if (body.relLog) {
      const r = body.relLog;
      const { error } = await supabaseAdmin.from('marketing_rel_log').insert({
        client_id: r.clientId || '',
        date: r.date || '',
        old_score: r.oldScore || 0,
        new_score: r.newScore || 0,
        reason: r.reason || '',
      });
      if (error) throw error;
      return NextResponse.json({ success: true });
    }

    // ─── IDIQ upsert ───────────────────────────────
    if (body.idiq) {
      const i = body.idiq;
      const { error } = await supabaseAdmin.from('marketing_idiqs').upsert({
        id: i.id,
        client_id: i.clientId || '',
        date_awarded: i.dateAwarded || '',
        date_expired: i.dateExpired || '',
        contacts: i.contacts || [],
        notes: i.notes || '',
      }, { onConflict: 'id' });
      if (error) throw error;
      return NextResponse.json({ success: true });
    }

    // ─── IDIQ delete ───────────────────────────────
    if (body.deleteIdiq) {
      const { error } = await supabaseAdmin.from('marketing_idiqs').delete().eq('id', body.deleteIdiq);
      if (error) throw error;
      return NextResponse.json({ success: true });
    }

    // ─── Priority list upsert ──────────────────────
    if (body.priority) {
      const p = body.priority;
      const { error } = await supabaseAdmin.from('marketing_priority').upsert({
        id: p.id,
        client_id: p.clientId || '',
        owner: p.owner || '',
        note: p.note || '',
        done: p.done || false,
        position: p.position || 0,
      }, { onConflict: 'id' });
      if (error) throw error;
      return NextResponse.json({ success: true });
    }

    // ─── Priority list delete ──────────────────────
    if (body.deletePriority) {
      const { error } = await supabaseAdmin.from('marketing_priority').delete().eq('id', body.deletePriority);
      if (error) throw error;
      return NextResponse.json({ success: true });
    }

    // ─── Tick / untick one next step (from the Touchpoints tab or Leads tab, without re-saving the whole record) ───
    if (body.stepDone) {
      const { id, done } = body.stepDone;
      const { error } = await supabaseAdmin.from('assigned_tasks').update({ done: !!done, completed_at: done ? new Date().toISOString() : null }).eq('id', id);
      if (error) throw error;
      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ error: 'Unknown payload' }, { status: 400 });
  } catch (error) {
    console.error('Marketing POST error:', error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
