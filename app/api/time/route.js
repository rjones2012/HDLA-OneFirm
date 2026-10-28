import { NextResponse } from 'next/server';
import { supabaseAdmin } from '../../../lib/supabaseAdmin';
import { getCaller, hasRole, LEADERSHIP } from '../../../lib/apiAuth';

export const dynamic = 'force-dynamic';

/* ═══════════════════════════════════════════════════════════════════
   HDLA HUB — Time Tracking API v2

   GET  /api/time?user_id=&week_key=              → my week (rows, entries, status)
   GET  /api/time?view=person&user_id=&week_key=   → one person's week (approver drill-in)
   GET  /api/time?view=approvals&week_key=         → every person's week status + totals
   GET  /api/time?view=config                      → accounts, schedules, overrides, people+titles
                                                     (cost_rate only for partners — verified server-side)
   GET  /api/time?view=report&start=&end=          → hours, billed value, cost, multiplier by project/person
                                                     (cost only for partners — verified server-side)

   POST /api/time  { action, ...payload }
     setEntry / addRow / addRows / changePhase / copyRows / expandBlankRows / linkTouchpoint / removeRow / submit / unsubmit / approve / return / reopen  (as v1)
     setOverride    { project_num, schedule_year, note }          partner | operations | office
     removeOverride { project_num }                                partner | operations | office
     setTitle       { user_id, rate_title }                        partner | office
     setCostRate    { user_id, cost_rate }                         partner
     saveAccount    { code, group_name, name, active, sort_order } partner | office

   Auth: client sends  Authorization: Bearer <supabase access token>.
   Role-gated reads/actions verify the token and look up staff_profiles.role.
   ═══════════════════════════════════════════════════════════════════ */

const LOCKED = ['submitted', 'approved'];

// Canonical rate titles → rate_schedules column
const TITLE_COL = {
  'Partner': 'partner',
  'Principal': 'principal',
  'Project Manager': 'project_manager',
  'Senior Project Designer': 'senior_project_designer',
  'Project Designer': 'project_designer',
  'Office Manager': 'office_manager',
  'CDAM': 'senior_project_designer',
  'Marketing Manager': 'senior_project_designer',
  'Marketing Coordinator': 'project_designer',
};
const RATE_TITLES = Object.keys(TITLE_COL);

// ─── Caller verification (lib/apiAuth) ───────────────────────────
function forbidden(msg = 'Not permitted') { return NextResponse.json({ error: msg }, { status: msg === 'Sign in required' ? 401 : 403 }); }

// ─── Rate resolution ─────────────────────────────────────────────
function yearFromProjectNum(num) {
  const m = String(num || '').trim().match(/^(\d{2})-?\d{3,4}$/);
  return m ? 2000 + parseInt(m[1], 10) : null;
}
function buildResolver(schedules, overrides) {
  const years = schedules.map(s => s.effective_year).sort((a, b) => a - b);
  const byYear = {}; schedules.forEach(s => { byYear[s.effective_year] = s; });
  const current = years[years.length - 1];
  const ovr = {}; overrides.forEach(o => { ovr[o.project_num] = o.schedule_year; });
  const scheduleYearFor = projectNum => {
    if (ovr[projectNum] != null) return ovr[projectNum];
    const y = yearFromProjectNum(projectNum);
    if (y == null) return current;
    let pick = null;
    for (const yr of years) { if (yr <= y) pick = yr; }
    return pick ?? years[0];
  };
  const rateFor = (projectNum, rateTitle) => {
    const col = TITLE_COL[rateTitle];
    if (!col) return 0;
    const s = byYear[scheduleYearFor(projectNum)];
    return s ? Number(s[col]) || 0 : 0;
  };
  return { scheduleYearFor, rateFor, current };
}
async function loadRateContext() {
  const [{ data: schedules }, { data: overrides }, { data: profiles }] = await Promise.all([
    supabaseAdmin.from('rate_schedules').select('*').order('effective_year'),
    supabaseAdmin.from('project_rate_overrides').select('*'),
    supabaseAdmin.from('staff_profiles').select('id, initials, display_name, role, office, rate_title, cost_rate'),
  ]);
  return { schedules: schedules || [], overrides: overrides || [], profiles: profiles || [] };
}


// Plan a phase change: each movable entry is added onto whatever already sits on the same day under the new phase.
// existingNewByDate: { 'YYYY-MM-DD': { hours, note } }. Returns { error } or { upserts: [{ id (old), work_date, hours, note }] }.
function planPhaseMove(movable, existingNewByDate) {
  const upserts = [];
  for (const e of movable) {
    const c = combineEntry(existingNewByDate[e.work_date], Number(e.hours) || 0, e.note);
    if (c.hours > 24) return { error: `That would make ${c.hours} hours on ${e.work_date} under the new phase (max 24). Edit that day first.` };
    upserts.push({ id: e.id, work_date: e.work_date, hours: c.hours, note: c.note });
  }
  return { upserts };
}

async function getWeekStatus(userId, weekKey) {
  const { data } = await supabaseAdmin.from('time_weeks').select('*').eq('user_id', userId).eq('week_key', weekKey).maybeSingle();
  return data || { user_id: userId, week_key: weekKey, status: 'draft', return_note: '' };
}
async function upsertWeek(patch) {
  const { data, error } = await supabaseAdmin.from('time_weeks')
    .upsert({ ...patch, updated_at: new Date().toISOString() }, { onConflict: 'user_id,week_key' }).select().single();
  if (error) throw error;
  return data;
}

// Logging adds to what is already on that line and day: hours are summed and the new note goes on its own line under the old one.
// Editing a cell (not an add) still replaces, which is how a mistake gets corrected.
function combineEntry(existing, hours, note) {
  const prevHours = Number(existing && existing.hours) || 0;
  const total = Math.round((prevHours + hours) * 4) / 4;
  const prevNote = String((existing && existing.note) || '').trim();
  const newNote = String(note || '').trim();
  return { hours: total, note: prevNote && newNote ? `${prevNote}\n${newNote}` : (prevNote || newNote) };
}

// ─── Fee-by-time (read-only reference for Projections) ───────────
const HUB_TIME_START = '2026-10-01';                              // Hub time entry began; the month-by-month time figures count nothing earlier
const FEE_TIME_ROLES = ['partner', 'principal', 'operations'];    // principals and partners (CM is a principal, role 'operations')

// PostgREST returns at most 1,000 rows per request, so page through everything
async function fetchAllRows(build) {
  const rows = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await build().order('id').range(from, from + 999);
    if (error) throw error;
    rows.push(...(data || []));
    if (!data || data.length < 1000) break;
  }
  return rows;
}
const addDaysISO = (iso, n) => { const d = new Date(`${iso}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

// Roll counted entries up per Master Data line (project # + name + phase): hours and fee-chart value, in total and by month of the work date
function rollUp(entries, rateFor, profById) {
  const byLine = {}; const byProject = {};
  (entries || []).forEach(e => {
    const h = Number(e.hours) || 0; if (!(h > 0)) return;
    const v = h * rateFor(e.project_num, profById[e.user_id]?.rate_title);
    const k = `${e.project_num}||${String(e.project_name || '').trim()}||${e.phase || ''}`;
    const mk = String(e.work_date || '').slice(0, 7);
    const L = byLine[k] || (byLine[k] = { hours: 0, value: 0, months: {} });
    L.hours += h; L.value += v;
    const M = L.months[mk] || (L.months[mk] = { hours: 0, value: 0 }); M.hours += h; M.value += v;
    const P = byProject[e.project_num] || (byProject[e.project_num] = { hours: 0, value: 0 }); P.hours += h; P.value += v;
  });
  const rnd = n => Math.round(n * 100) / 100;
  Object.values(byLine).forEach(L => { L.hours = rnd(L.hours); L.value = rnd(L.value); Object.values(L.months).forEach(M => { M.hours = rnd(M.hours); M.value = rnd(M.value); }); });
  Object.values(byProject).forEach(P => { P.hours = rnd(P.hours); P.value = rnd(P.value); });
  return { byLine, byProject };
}

// ─── GET ──────────────────────────────────────────────────────────
export async function GET(req) {
  try {
    const caller = await getCaller(req);
    if (!caller) return forbidden('Sign in required');
    const { searchParams } = new URL(req.url);
    const view = searchParams.get('view') || 'me';

    // ── Burn: submitted hours × fee-chart rate per Master Data line (project + name + phase), all time. Principals and partners only. ──
    if (view === 'burn') {
      if (!FEE_TIME_ROLES.includes(caller.role)) return forbidden();
      const [entries, ctx] = await Promise.all([
        fetchAllRows(() => supabaseAdmin.from('time_entries').select('id, user_id, week_key, work_date, project_num, project_name, phase, hours').eq('billable', true)),
        loadRateContext(),
      ]);
      const resolver = buildResolver(ctx.schedules, ctx.overrides);
      const profById = {}; ctx.profiles.forEach(p => { profById[p.id] = p; });
      const { byLine, byProject } = rollUp(entries, resolver.rateFor, profById);
      return NextResponse.json({ byLine, byProject });
    }

    // ── Time by month: the same, by month of the work date, from the Hub's first time-entry day. Principals and partners only. ──
    if (view === 'timevs') {
      if (!FEE_TIME_ROLES.includes(caller.role)) return forbidden();
      const [entries, ctx] = await Promise.all([
        fetchAllRows(() => supabaseAdmin.from('time_entries').select('id, user_id, week_key, work_date, project_num, project_name, phase, hours').eq('billable', true).gte('work_date', HUB_TIME_START)),
        loadRateContext(),
      ]);
      const resolver = buildResolver(ctx.schedules, ctx.overrides);
      const profById = {}; ctx.profiles.forEach(p => { profById[p.id] = p; });
      const { byLine } = rollUp(entries, resolver.rateFor, profById);
      return NextResponse.json({ start: HUB_TIME_START, byLine });
    }

    if (view === 'config') {
      const isPartner = caller.role === 'partner';
      const [{ data: accounts }, ctx] = await Promise.all([
        supabaseAdmin.from('time_accounts').select('*').order('sort_order'),
        loadRateContext(),
      ]);
      const people = ctx.profiles
        .map(p => ({ user_id: p.id, initials: p.initials, display_name: p.display_name, role: p.role, office: p.office, rate_title: p.rate_title || null, ...(isPartner ? { cost_rate: p.cost_rate != null ? Number(p.cost_rate) : null } : {}) }))
        .sort((a, b) => (a.display_name || '').localeCompare(b.display_name || ''));
      return NextResponse.json({ accounts: accounts || [], schedules: ctx.schedules, overrides: ctx.overrides, people, titles: RATE_TITLES, isPartner });
    }

    // ── Entries: every logged hour as a row, for invoicing and audit. Partners, operations, office, principals. ──
    //    ?start&end (work_date, inclusive) &user_id= &project_num= &q= (note / project text)
    if (view === 'entries') {
      if (!hasRole(caller, [...LEADERSHIP])) return forbidden();
      const start = searchParams.get('start'), end = searchParams.get('end');
      if (!start || !end) return NextResponse.json({ error: 'Missing start or end' }, { status: 400 });
      const userId = searchParams.get('user_id') || '';
      const projectNum = searchParams.get('project_num') || '';
      const q = (searchParams.get('q') || '').trim().toLowerCase();
      const [entries, ctx, { data: weeks }, { data: accounts }] = await Promise.all([
        fetchAllRows(() => { let b = supabaseAdmin.from('time_entries').select('id, user_id, initials, work_date, week_key, project_num, project_name, phase, hours, note, billable, updated_at').gte('work_date', start).lte('work_date', end); if (userId) b = b.eq('user_id', userId); if (projectNum) b = b.eq('project_num', projectNum); return b; }),
        loadRateContext(),
        supabaseAdmin.from('time_weeks').select('user_id, week_key, status').gte('week_key', addDaysISO(start, -6)).lte('week_key', end),
        supabaseAdmin.from('time_accounts').select('code, name, group_name'),
      ]);
      const profById = {}; ctx.profiles.forEach(p => { profById[p.id] = p; });
      const wk = {}; (weeks || []).forEach(w => { wk[`${w.user_id}|${w.week_key}`] = w.status; });
      const acct = {}; (accounts || []).forEach(a => { acct[a.code] = a; });
      const rows = entries.map(e => ({
        id: e.id, date: e.work_date, week_key: e.week_key, user_id: e.user_id, initials: e.initials || profById[e.user_id]?.initials || '', person: profById[e.user_id]?.display_name || e.initials || '',
        project_num: e.project_num, project_name: e.project_name || acct[e.project_num]?.name || '', phase: e.phase || '', hours: Number(e.hours) || 0, note: e.note || '', billable: e.billable !== false,
        status: wk[`${e.user_id}|${e.week_key}`] || 'draft', account_group: e.billable === false ? (acct[e.project_num]?.group_name || '') : '',
      })).filter(r => !q || `${r.project_num} ${r.project_name} ${r.phase} ${r.note} ${r.person} ${r.initials}`.toLowerCase().includes(q))
        .sort((a, b) => a.date.localeCompare(b.date) || a.person.localeCompare(b.person) || a.project_num.localeCompare(b.project_num));
      const people = ctx.profiles.map(p => ({ user_id: p.id, initials: p.initials, display_name: p.display_name })).sort((a, b) => (a.display_name || '').localeCompare(b.display_name || ''));
      return NextResponse.json({ start, end, rows, people, total: rows.reduce((s, r) => s + r.hours, 0) });
    }

    if (view === 'report') {
      const start = searchParams.get('start');
      const end = searchParams.get('end');
      if (!start || !end) return NextResponse.json({ error: 'Missing start or end' }, { status: 400 });
      const includeCost = caller.role === 'partner';

      const [{ data: entries, error }, ctx, { data: accounts }] = await Promise.all([
        supabaseAdmin.from('time_entries').select('user_id, initials, work_date, project_num, project_name, phase, hours, billable').gte('work_date', start).lte('work_date', end),
        loadRateContext(),
        supabaseAdmin.from('time_accounts').select('code, group_name, name'),
      ]);
      if (error) throw error;
      const resolver = buildResolver(ctx.schedules, ctx.overrides);
      const profById = {}; ctx.profiles.forEach(p => { profById[p.id] = p; });
      const acctByCode = {}; (accounts || []).forEach(a => { acctByCode[a.code] = a; });

      const byProject = {}; const byPerson = {}; const byAccountGroup = {};
      (entries || []).forEach(e => {
        const h = Number(e.hours) || 0;
        const prof = profById[e.user_id] || {};
        const isProject = e.billable !== false;
        const rate = isProject ? resolver.rateFor(e.project_num, prof.rate_title) : 0;
        const billed = h * rate;
        const cost = includeCost ? h * (Number(prof.cost_rate) || 0) : 0;

        const pk = `${e.project_num}||${e.project_name || ''}||${e.phase || ''}`;
        if (!byProject[pk]) byProject[pk] = { project_num: e.project_num, project_name: e.project_name, phase: e.phase, billable: isProject, hours: 0, billed: 0, cost: 0, schedule_year: isProject ? resolver.scheduleYearFor(e.project_num) : null, people: {} };
        byProject[pk].hours += h; byProject[pk].billed += billed; byProject[pk].cost += cost;
        byProject[pk].people[e.initials] = (byProject[pk].people[e.initials] || 0) + h;

        if (!byPerson[e.initials]) byPerson[e.initials] = { initials: e.initials, user_id: e.user_id, display_name: prof.display_name || e.initials, rate_title: prof.rate_title || null, office: prof.office || '', hours: 0, billable_hours: 0, billed: 0, cost: 0 };
        byPerson[e.initials].hours += h; byPerson[e.initials].billed += billed; byPerson[e.initials].cost += cost;
        if (isProject) byPerson[e.initials].billable_hours += h;

        if (!isProject) {
          const g = acctByCode[e.project_num]?.group_name || 'Other';
          if (!byAccountGroup[g]) byAccountGroup[g] = { group: g, hours: 0, cost: 0 };
          byAccountGroup[g].hours += h; byAccountGroup[g].cost += cost;
        }
      });

      return NextResponse.json({
        start, end, includeCost,
        byProject: Object.values(byProject).sort((a, b) => b.hours - a.hours),
        byPerson: Object.values(byPerson).sort((a, b) => b.hours - a.hours),
        byAccountGroup: Object.values(byAccountGroup).sort((a, b) => b.hours - a.hours),
      });
    }

    if (view === 'approvals') {
      if (!hasRole(caller, LEADERSHIP)) return forbidden();
      const weekKey = searchParams.get('week_key');
      if (!weekKey) return NextResponse.json({ error: 'Missing week_key' }, { status: 400 });
      const [{ data: profiles }, { data: weeks }, { data: entries }] = await Promise.all([
        supabaseAdmin.from('staff_profiles').select('id, initials, display_name, role, office').order('display_name'),
        supabaseAdmin.from('time_weeks').select('*').eq('week_key', weekKey),
        supabaseAdmin.from('time_entries').select('user_id, hours, billable').eq('week_key', weekKey),
      ]);
      const weekByUser = {}; (weeks || []).forEach(w => { weekByUser[w.user_id] = w; });
      const totals = {};
      (entries || []).forEach(e => { if (!totals[e.user_id]) totals[e.user_id] = { hours: 0, billable: 0 }; totals[e.user_id].hours += Number(e.hours) || 0; if (e.billable) totals[e.user_id].billable += Number(e.hours) || 0; });
      const people = (profiles || []).map(p => ({
        user_id: p.id, initials: p.initials, display_name: p.display_name, role: p.role, office: p.office,
        status: weekByUser[p.id]?.status || 'draft', submitted_at: weekByUser[p.id]?.submitted_at || null,
        approved_by: weekByUser[p.id]?.approved_by || null, approved_at: weekByUser[p.id]?.approved_at || null,
        return_note: weekByUser[p.id]?.return_note || '', hours: totals[p.id]?.hours || 0, billable: totals[p.id]?.billable || 0,
      }));
      return NextResponse.json({ week_key: weekKey, people });
    }

    // me / person — your own week, or (leadership only) someone else's
    const requested = searchParams.get('user_id');
    const userId = view === 'person' && requested ? requested : caller.id;
    const weekKey = searchParams.get('week_key');
    if (!weekKey) return NextResponse.json({ error: 'Missing week_key' }, { status: 400 });
    if (userId !== caller.id && !hasRole(caller, LEADERSHIP)) return forbidden('You can only view your own week');
    const [{ data: rows, error: rowsErr }, { data: entries, error: entErr }, week] = await Promise.all([
      supabaseAdmin.from('time_rows').select('*').eq('user_id', userId).order('sort_order').order('created_at'),
      supabaseAdmin.from('time_entries').select('*').eq('user_id', userId).eq('week_key', weekKey),
      getWeekStatus(userId, weekKey),
    ]);
    if (rowsErr) throw rowsErr;
    if (entErr) throw entErr;
    return NextResponse.json({ rows: rows || [], entries: entries || [], week });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

// ─── POST ─────────────────────────────────────────────────────────
const SELF_ACTIONS = ['setEntry', 'addRow', 'addRows', 'changePhase', 'copyRows', 'expandBlankRows', 'linkTouchpoint', 'removeRow', 'submit', 'unsubmit'];
const APPROVER_ACTIONS = ['approve', 'return', 'reopen'];

export async function POST(req) {
  try {
    const caller = await getCaller(req);
    if (!caller) return forbidden('Sign in required');
    const body = await req.json();
    const { action } = body;

    // Your own sheet only: whatever user_id the page sent, the row belongs to the signed-in person
    if (SELF_ACTIONS.includes(action)) { body.user_id = caller.id; if (action === 'setEntry') body.initials = caller.initials; }
    // Approvals act on someone else's week: leadership only, and the approver is the signed-in person
    if (APPROVER_ACTIONS.includes(action)) { if (!hasRole(caller, LEADERSHIP)) return forbidden(); body.approved_by = caller.initials; }

    if (action === 'setEntry') {
      const { user_id, initials, work_date, week_key, project_num, project_name, phase, note, billable } = body;
      const hours = Number(body.hours) || 0;
      if (!user_id || !work_date || !week_key || !project_num) return NextResponse.json({ error: 'Missing fields' }, { status: 400 });
      const week = await getWeekStatus(user_id, week_key);
      if (LOCKED.includes(week.status)) return NextResponse.json({ error: `Week is ${week.status} and locked` }, { status: 409 });
      if (hours <= 0) {
        const { error } = await supabaseAdmin.from('time_entries').delete().eq('user_id', user_id).eq('work_date', work_date).eq('project_num', project_num).eq('project_name', project_name || '').eq('phase', phase || '');
        if (error) throw error;
        return NextResponse.json({ success: true, deleted: true });
      }
      let outHours = Math.round(hours * 4) / 4; let outNote = note || '';
      if (body.mode === 'add') {
        const { data: existing, error: readErr } = await supabaseAdmin.from('time_entries').select('hours, note').eq('user_id', user_id).eq('work_date', work_date).eq('project_num', project_num).eq('project_name', project_name || '').eq('phase', phase || '').maybeSingle();
        if (readErr) throw readErr;
        const c = combineEntry(existing, hours, note);
        if (c.hours > 24) return NextResponse.json({ error: `That would make ${c.hours} hours on this line for one day (max 24). Edit the cell instead.` }, { status: 400 });
        outHours = c.hours; outNote = c.note;
      }
      const { data, error } = await supabaseAdmin.from('time_entries').upsert({
        user_id, initials: initials || '', work_date, week_key, project_num, project_name: project_name || '', phase: phase || '',
        hours: outHours, note: outNote, billable: billable !== false, updated_at: new Date().toISOString(),
      }, { onConflict: 'user_id,work_date,project_num,project_name,phase' }).select().single();
      if (error) throw error;
      return NextResponse.json({ success: true, entry: data });
    }

    if (action === 'addRow') {
      const { user_id, project_num, project_name, phase } = body;
      if (!user_id || !project_num) return NextResponse.json({ error: 'Missing fields' }, { status: 400 });
      const { data: existing } = await supabaseAdmin.from('time_rows').select('sort_order').eq('user_id', user_id).order('sort_order', { ascending: false }).limit(1);
      const sort_order = existing?.[0]?.sort_order != null ? existing[0].sort_order + 1 : 0;
      const { data, error } = await supabaseAdmin.from('time_rows').upsert({ user_id, project_num, project_name: project_name || '', phase: phase || '', sort_order }, { onConflict: 'user_id,project_num,project_name,phase' }).select().single();
      if (error) throw error;
      return NextResponse.json({ success: true, row: data });
    }

    if (action === 'addRows') {
      const { user_id, rows } = body;
      if (!user_id || !Array.isArray(rows)) return NextResponse.json({ error: 'Missing fields' }, { status: 400 });
      const payload = rows.map((r, i) => ({ user_id, project_num: r.project_num, project_name: r.project_name || '', phase: r.phase || '', sort_order: i }));
      const { data, error } = await supabaseAdmin.from('time_rows').upsert(payload, { onConflict: 'user_id,project_num,project_name,phase' }).select();
      if (error) throw error;
      return NextResponse.json({ success: true, rows: data });
    }

    // Move a row's logged hours to a different phase of the same project (open weeks only; submitted/approved weeks keep what was submitted)
    if (action === 'changePhase') {
      const { user_id, project_num } = body;
      const project_name = body.project_name || '', phase = body.phase || '';
      const new_name = body.new_project_name || '', new_phase = body.new_phase || '';
      if (!user_id || !project_num) return NextResponse.json({ error: 'Missing fields' }, { status: 400 });
      if (project_name === new_name && phase === new_phase) return NextResponse.json({ success: true, moved: 0, kept: 0 });
      const { data: oldEntries, error: oeErr } = await supabaseAdmin.from('time_entries').select('*').eq('user_id', user_id).eq('project_num', project_num).eq('project_name', project_name).eq('phase', phase);
      if (oeErr) throw oeErr;
      const weekKeys = [...new Set((oldEntries || []).map(e => e.week_key))];
      let lockedKeys = new Set();
      if (weekKeys.length) {
        const { data: wk, error: wErr } = await supabaseAdmin.from('time_weeks').select('week_key, status').eq('user_id', user_id).in('week_key', weekKeys);
        if (wErr) throw wErr;
        lockedKeys = new Set((wk || []).filter(w => LOCKED.includes(w.status)).map(w => w.week_key));
      }
      const movable = (oldEntries || []).filter(e => !lockedKeys.has(e.week_key));
      const kept = (oldEntries || []).length - movable.length;
      if (movable.length) {
        const dates = movable.map(e => e.work_date);
        const { data: ex, error: exErr } = await supabaseAdmin.from('time_entries').select('work_date, hours, note').eq('user_id', user_id).eq('project_num', project_num).eq('project_name', new_name).eq('phase', new_phase).in('work_date', dates);
        if (exErr) throw exErr;
        const byDate = {}; (ex || []).forEach(x => { byDate[x.work_date] = x; });
        const plan = planPhaseMove(movable, byDate);
        if (plan.error) return NextResponse.json({ error: plan.error }, { status: 400 });
        const byId = {}; movable.forEach(e => { byId[e.id] = e; });
        const payload = plan.upserts.map(u => { const e = byId[u.id]; return { user_id, initials: e.initials || '', work_date: e.work_date, week_key: e.week_key, project_num, project_name: new_name, phase: new_phase, hours: u.hours, note: u.note, billable: e.billable !== false, updated_at: new Date().toISOString() }; });
        const { error: upErr } = await supabaseAdmin.from('time_entries').upsert(payload, { onConflict: 'user_id,work_date,project_num,project_name,phase' });
        if (upErr) throw upErr;
        const { error: delErr } = await supabaseAdmin.from('time_entries').delete().in('id', movable.map(e => e.id));
        if (delErr) throw delErr;
      }
      // the sheet row follows the change (keeps its position)
      const { data: oldRow } = await supabaseAdmin.from('time_rows').select('id, sort_order').eq('user_id', user_id).eq('project_num', project_num).eq('project_name', project_name).eq('phase', phase).maybeSingle();
      const { data: row, error: rowErr } = await supabaseAdmin.from('time_rows').upsert({ user_id, project_num, project_name: new_name, phase: new_phase, sort_order: oldRow ? oldRow.sort_order : 0 }, { onConflict: 'user_id,project_num,project_name,phase' }).select().single();
      if (rowErr) throw rowErr;
      if (oldRow) { const { error: dErr } = await supabaseAdmin.from('time_rows').delete().eq('id', oldRow.id); if (dErr) throw dErr; }
      return NextResponse.json({ success: true, row, moved: movable.length, kept });
    }

    // Add last week's rows (no hours) to this person's sheet; rows already there are left alone
    if (action === 'copyRows') {
      const { user_id, week_key } = body;
      if (!user_id || !week_key) return NextResponse.json({ error: 'Missing fields' }, { status: 400 });
      const prev = addDaysISO(week_key, -7);
      const [{ data: prevEntries, error: pErr }, { data: have, error: hErr }] = await Promise.all([
        supabaseAdmin.from('time_entries').select('project_num, project_name, phase').eq('user_id', user_id).eq('week_key', prev),
        supabaseAdmin.from('time_rows').select('*').eq('user_id', user_id),
      ]);
      if (pErr) throw pErr; if (hErr) throw hErr;
      const keyOf = r => `${r.project_num}||${r.project_name || ''}||${r.phase || ''}`;
      const haveKeys = new Set((have || []).map(keyOf));
      const seen = new Set(); const missing = [];
      (prevEntries || []).forEach(e => { const k = keyOf(e); if (!seen.has(k)) { seen.add(k); if (!haveKeys.has(k)) missing.push({ project_num: e.project_num, project_name: e.project_name || '', phase: e.phase || '' }); } });
      if (missing.length) {
        let next = ((have || []).reduce((m, r) => Math.max(m, r.sort_order || 0), -1)) + 1;
        const payload = missing.map(r => ({ user_id, ...r, sort_order: next++ }));
        const { error } = await supabaseAdmin.from('time_rows').upsert(payload, { onConflict: 'user_id,project_num,project_name,phase' });
        if (error) throw error;
      }
      const { data: rows, error: rErr } = await supabaseAdmin.from('time_rows').select('*').eq('user_id', user_id).order('sort_order').order('created_at');
      if (rErr) throw rErr;
      return NextResponse.json({ success: true, rows: rows || [], added: missing.length, hadRows: seen.size > 0 });
    }

    // Blank-phase project rows (they came from the Work Plan) with no hours logged are replaced by the project's Master Data phases
    if (action === 'expandBlankRows') {
      const { user_id, items } = body;
      if (!user_id || !Array.isArray(items)) return NextResponse.json({ error: 'Missing fields' }, { status: 400 });
      for (const it of items) {
        const num = String(it.project_num || '');
        const lines = Array.isArray(it.lines) ? it.lines : [];
        if (!num || !lines.length) continue;
        const { data: blanks, error: bErr } = await supabaseAdmin.from('time_rows').select('*').eq('user_id', user_id).eq('project_num', num).eq('phase', '');
        if (bErr) throw bErr;
        for (const b of (blanks || [])) {
          if (lines.some(l => (l.phase || '') === '' && (l.project_name || '') === (b.project_name || ''))) continue;   // matches a real Master Data line
          const { count, error: cErr } = await supabaseAdmin.from('time_entries').select('id', { count: 'exact', head: true }).eq('user_id', user_id).eq('project_num', num).eq('project_name', b.project_name || '').eq('phase', '');
          if (cErr) throw cErr;
          if ((count || 0) > 0) continue;   // hours logged against it: keep, the sheet asks for a phase
          const { error: dErr } = await supabaseAdmin.from('time_rows').delete().eq('id', b.id);
          if (dErr) throw dErr;
          const payload = lines.map(l => ({ user_id, project_num: num, project_name: l.project_name || '', phase: l.phase || '', sort_order: b.sort_order || 0 }));
          const { error: uErr } = await supabaseAdmin.from('time_rows').upsert(payload, { onConflict: 'user_id,project_num,project_name,phase' });
          if (uErr) throw uErr;
        }
      }
      const { data: rows, error: rErr } = await supabaseAdmin.from('time_rows').select('*').eq('user_id', user_id).order('sort_order').order('created_at');
      if (rErr) throw rErr;
      return NextResponse.json({ success: true, rows: rows || [] });
    }

    // Tag a time entry as logged to a Marketing touchpoint (or clear the tag with touchpoint_id = '').
    // Allowed on submitted weeks too: it does not change hours.
    if (action === 'linkTouchpoint') {
      const { user_id, work_date, project_num, project_name, phase } = body;
      if (!user_id || !work_date || !project_num) return NextResponse.json({ error: 'Missing fields' }, { status: 400 });
      const tp = body.touchpoint_id ? String(body.touchpoint_id) : null;
      const { data, error } = await supabaseAdmin.from('time_entries').update({ touchpoint_id: tp }).eq('user_id', user_id).eq('work_date', work_date).eq('project_num', project_num).eq('project_name', project_name || '').eq('phase', phase || '').select();
      if (error) {
        if (/touchpoint_id|column|schema cache|PGRST204|42703/i.test(String(error.message || '') + String(error.code || ''))) return NextResponse.json({ error: 'The touchpoint link column is missing. Run supabase-touchpoint-time-steps.sql in Supabase.', needsSql: true }, { status: 500 });
        throw error;
      }
      if (!data || !data.length) return NextResponse.json({ error: 'No time entry found for that day and line' }, { status: 404 });
      return NextResponse.json({ success: true, entry: data[0] });
    }

    if (action === 'removeRow') {
      const { user_id, row_id } = body;
      const { error } = await supabaseAdmin.from('time_rows').delete().eq('id', row_id).eq('user_id', user_id);
      if (error) throw error;
      return NextResponse.json({ success: true });
    }

    if (action === 'submit') {
      const { user_id, week_key } = body;
      return NextResponse.json({ success: true, week: await upsertWeek({ user_id, week_key, status: 'submitted', submitted_at: new Date().toISOString(), return_note: '' }) });
    }
    if (action === 'unsubmit') {
      const { user_id, week_key } = body;
      const current = await getWeekStatus(user_id, week_key);
      if (current.status === 'approved') return NextResponse.json({ error: 'Approved weeks cannot be reopened by the user' }, { status: 409 });
      return NextResponse.json({ success: true, week: await upsertWeek({ user_id, week_key, status: 'draft', submitted_at: null }) });
    }
    if (action === 'approve') {
      const { user_id, week_key, approved_by } = body;
      return NextResponse.json({ success: true, week: await upsertWeek({ user_id, week_key, status: 'approved', approved_by: approved_by || '', approved_at: new Date().toISOString(), return_note: '' }) });
    }
    if (action === 'return') {
      const { user_id, week_key, approved_by, note } = body;
      return NextResponse.json({ success: true, week: await upsertWeek({ user_id, week_key, status: 'returned', approved_by: approved_by || '', approved_at: null, submitted_at: null, return_note: note || '' }) });
    }
    if (action === 'reopen') {
      const { user_id, week_key } = body;
      return NextResponse.json({ success: true, week: await upsertWeek({ user_id, week_key, status: 'draft', approved_by: null, approved_at: null, submitted_at: null }) });
    }

    // ── Role-gated admin actions ──
    if (['setOverride', 'removeOverride', 'setTitle', 'setCostRate', 'saveAccount'].includes(action)) {
      if (action === 'setOverride') {
        if (!['partner', 'operations', 'office'].includes(caller.role)) return forbidden();
        const { project_num, schedule_year, note } = body;
        if (!project_num || !schedule_year) return NextResponse.json({ error: 'Missing fields' }, { status: 400 });
        const { data, error } = await supabaseAdmin.from('project_rate_overrides').upsert({ project_num: String(project_num).trim(), schedule_year: Number(schedule_year), note: note || null, set_by: caller.initials, updated_at: new Date().toISOString() }, { onConflict: 'project_num' }).select().single();
        if (error) throw error;
        return NextResponse.json({ success: true, override: data });
      }
      if (action === 'removeOverride') {
        if (!['partner', 'operations', 'office'].includes(caller.role)) return forbidden();
        const { error } = await supabaseAdmin.from('project_rate_overrides').delete().eq('project_num', body.project_num);
        if (error) throw error;
        return NextResponse.json({ success: true });
      }
      if (action === 'setTitle') {
        if (!['partner', 'office'].includes(caller.role)) return forbidden();
        const { user_id, rate_title } = body;
        if (rate_title && !RATE_TITLES.includes(rate_title)) return NextResponse.json({ error: 'Unknown title' }, { status: 400 });
        const { error } = await supabaseAdmin.from('staff_profiles').update({ rate_title: rate_title || null }).eq('id', user_id);
        if (error) throw error;
        return NextResponse.json({ success: true });
      }
      if (action === 'setCostRate') {
        if (caller.role !== 'partner') return forbidden('Partners only');
        const { user_id, cost_rate } = body;
        const val = cost_rate === '' || cost_rate == null ? null : Number(cost_rate);
        if (val != null && (isNaN(val) || val < 0)) return NextResponse.json({ error: 'Bad rate' }, { status: 400 });
        const { error } = await supabaseAdmin.from('staff_profiles').update({ cost_rate: val }).eq('id', user_id);
        if (error) throw error;
        return NextResponse.json({ success: true });
      }
      if (action === 'saveAccount') {
        if (!['partner', 'office'].includes(caller.role)) return forbidden();
        const { code, group_name, name, active, sort_order } = body;
        if (!code || !name) return NextResponse.json({ error: 'Missing fields' }, { status: 400 });
        const { data, error } = await supabaseAdmin.from('time_accounts').upsert({ code: String(code).trim(), group_name: group_name || 'Other', name, active: active !== false, sort_order: Number(sort_order) || Number(code) || 0 }, { onConflict: 'code' }).select().single();
        if (error) throw error;
        return NextResponse.json({ success: true, account: data });
      }
    }

    return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
