import { NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { supabaseAdmin } from '../../../lib/supabaseAdmin';
import { requireCaller, FINANCE } from '../../../lib/apiAuth';
import { loadRateContext, buildResolver } from '../../../lib/rates';
import { phaseLabel } from '../../../lib/phaseNames';

export const dynamic = 'force-dynamic';

/* ═══════════════════════════════════════════════════════════════════
   HDLA HUB — Billing API

   GET ?view=month&period=YYYY-MM       invoices for the month + projects with no invoice yet
   GET ?view=invoice&id=                one invoice with lines, hours context, master data rows
   GET ?view=clients                    client address book
   GET ?view=reconcile                  Hub-sent totals vs Master Data Previously Billed

   POST { action }
     generateDrafts { period }                       office | operations | partner
     createDraft { period, project_num }             office | operations | partner
     regenerate { id }                               office | operations | partner  (rebuild non-overridden lines)
     updateInvoice { id, patch, saveClient, saveSettings }
     updateLine { id, patch }
     addLine { invoice_id, line }
     removeLine { id }
     setStatus { id, status, note }                  approve/reopen: partner only
     saveClient { client }
   All actions require a verified session with role office | operations | partner.
   ═══════════════════════════════════════════════════════════════════ */

const SIGNERS = {
  RJ: 'Richie Jones, RLA, LEED AP',
  CB: 'Chris Barkley, RLA, LEED AP',
  TJ: 'TJ Eliason, PLA, LEED AP',
  MB: 'Michael Black, Partner, PLA',
};
const REMIT_TO = '507 Main Street, Nashville, TN 37206';

const r2 = n => Math.round((Number(n) || 0) * 100) / 100;
const isOpen = r => r['Status'] === 'O' || r['Status'] === 'PR';
const lineKey = r => `${String(r['Project Name'] || '').trim()}||${String(r['Phase'] || '').trim()}`;
// Base name = shortest Project Name on the project; extra = what a row adds beyond it
function baseNameOf(rows) { return rows.map(r => String(r['Project Name'] || '').trim()).filter(Boolean).sort((a, b) => a.length - b.length)[0] || ''; }
// Every billing line prints the Project Name exactly as Master Data has it (abbreviations and all), then the phase spelled out
// from lib/phaseNames.js (codes not in the legend print as written). Same rule for every line, whether or not names repeat.
// `base` and `nameCounts` are kept in the signature so callers don't change; they no longer affect the text.
function defaultDescription(row, base, nameCounts = {}) {
  const name = String(row['Project Name'] || '').trim();
  const ph = phaseLabel(row['Phase']);
  if (name && ph) return `${name} – ${ph}`;
  return name || ph || 'Fee';
}
const isHourlyName = s => /hourly/i.test(String(s || ''));

function periodDates(period) {
  const [y, m] = period.split('-').map(Number);
  const last = new Date(y, m, 0);
  const next = new Date(y, m, 1);
  const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return { services_through: iso(last), invoice_date: iso(next) };
}
function shiftPeriodKey(period, delta) { const [y, m] = period.split('-').map(Number); const d = new Date(y, m - 1 + delta, 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; }
// Previous billed for a line is always Master Data's Previously Billed: Master Data is the record of what has actually been billed.
// Ellie posts each billing run to Master Data by hand. If she hasn't posted last month yet, the month screen shows a
// "Master Data may be behind" flag (see the month view) so the same amount isn't billed twice.
// The extra arguments are kept so callers don't change; they no longer affect the result.
function effectivePrev(fee, mdPrev, proj, period) {
  return mdPrev;
}
function invoiceNumber(period, seq) {
  const [y, m] = period.split('-');
  return `${Number(m)}${y.slice(2)}${String(seq).padStart(3, '0')}`;
}

// Server-to-server call to our own masterdata route; it now checks the caller, so the signed-in person's token goes along
async function masterData(req) {
  const origin = new URL(req.url).origin;
  const auth = req.headers.get('authorization') || '';
  const r = await fetch(`${origin}/api/masterdata`, { cache: 'no-store', headers: auth ? { authorization: auth } : {} });
  const d = await r.json();
  return d.data || [];
}

// Projection ids match Work Plans: `${num}-${phase}`, with a name suffix only when the phase repeats
function projectionIds(rows) {
  const count = {};
  rows.forEach(r => { const k = `${r['Project #']}-${r['Phase']}`; count[k] = (count[k] || 0) + 1; });
  return rows.map(r => {
    const base = `${r['Project #']}-${r['Phase']}`;
    const suffix = count[base] > 1 ? `-${(r['Project Name'] || '').replace(/[^a-zA-Z0-9]/g, '').slice(-15)}` : '';
    return base + suffix;
  });
}

// Build phase lines for one project from Master Data + projections (+ time entries for hourly)
async function buildLines({ rows, period, projections, ctx, settings, consultants = [] }) {
  const ids = projectionIds(rows);
  const hourlyPhases = new Set((settings?.hourly_phases || []).map(String));
  const lineOvr = settings?.line_overrides || {};
  const base = baseNameOf(rows);
  const nameCounts = {}; rows.forEach(r => { const k = String(r['Project Name'] || '').trim().toLowerCase(); nameCounts[k] = (nameCounts[k] || 0) + 1; });
  const lines = [];
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const key = lineKey(row);
    const ovr = lineOvr[key] || lineOvr[row['Phase']] || {};
    if (ovr.hidden) continue;
    const fee = Number(row['Fee']) || 0;
    const mdPrev = Number(row['Previously Billed']) || 0;
    const proj = projections[ids[i]];
    const projected = proj?.months?.[period];
    const prev = effectivePrev(fee, mdPrev, proj, period);
    const prevPct = fee > 0 ? prev / fee * 100 : 0;
    const hourly = isOpen(row) && (hourlyPhases.has(row['Phase']) || hourlyPhases.has(key) || (fee === 0 && (isHourlyName(row['Phase']) || isHourlyName(row['Project Name']))));

    if (hourly) {
      const detail = await hourlyDetail(row['Project #'], row['Project Name'], row['Phase'], period, ctx);
      const thisInv = r2(detail.reduce((a, d) => a + d.hours * d.rate, 0));
      lines.push({ sort_order: i, kind: 'hourly', phase: row['Phase'], description: ovr.description || defaultDescription(row, base, nameCounts), contract_amount: fee || null, pct: null,
        earned: r2(prev + thisInv), previous: r2(prev), this_invoice: thisInv, remaining: fee ? r2(fee - prev - thisInv) : null,
        hourly_detail: detail, source: { fee, prev, projected: null, status: row['Status'], key, name: row['Project Name'] } });
      continue;
    }
    let pct = projected != null ? Number(projected) : r2(prevPct);
    let earned = r2(fee * pct / 100);
    let belowBilled = false;
    if (earned < prev - 0.005) { belowBilled = true; pct = r2(prevPct); earned = r2(prev); }
    const line = { sort_order: i, kind: 'phase', phase: row['Phase'], description: ovr.description || defaultDescription(row, base, nameCounts), contract_amount: fee, pct: r2(pct),
      earned, previous: r2(prev), this_invoice: r2(earned - prev), remaining: r2(fee - earned), tbd: fee === 0 && !hourly,
      source: { fee, prev, mdPrev, projected: projected ?? null, prevPct: r2(prevPct), status: row['Status'], key, name: row['Project Name'], belowBilled } };
    const folded = consultants.filter(c => c.mode === 'fold' && c.phase_key === key);
    if (folded.length) {
      line.source.hdla = { contract: fee, pct: r2(pct), prev: r2(prev), earned, this: r2(earned - prev) };
      line.source.consultants = folded.map(c => ({ id: c.id, name: c.name, contract: c.contract, prev: c.prev, this_invoice: c.this_invoice }));
      line.tbd = false;
      foldLine(line);
    }
    lines.push(line);
  }
  // Named consultant rows (in the phase table) and section consultants (below it)
  let n = lines.length;
  consultants.filter(c => c.mode !== 'fold').forEach(c => {
    const earned = r2(c.prev + c.this_invoice);
    const L = { sort_order: n++, kind: c.mode === 'section' ? 'consultant_section' : 'consultant', phase: null, description: c.name, contract_amount: c.contract || null, pct: c.contract ? r2(earned / c.contract * 100) : null,
      earned, previous: r2(c.prev), this_invoice: r2(c.this_invoice), remaining: c.contract ? r2(c.contract - earned) : null, tbd: false, source: { consultant_id: c.id, key: `consultant:${c.id}` } };
    if (c.phase_key) { const idx = lines.findIndex(l => l.source?.key === c.phase_key); if (idx >= 0 && L.kind === 'consultant') { lines.splice(idx + 1, 0, L); return; } }
    lines.push(L);
  });
  lines.forEach((l, i) => { l.sort_order = i; });
  return lines;
}

// Consultants on a project, with previous billed (bills on approved/sent invoices in earlier months) and this month's bills
async function loadConsultants(projectNum, period) {
  const { data: cons } = await supabaseAdmin.from('project_consultants').select('*').eq('project_num', projectNum).eq('active', true).order('sort_order').order('created_at');
  if (!cons?.length) return [];
  const ids = cons.map(c => c.id);
  const { data: bills } = await supabaseAdmin.from('consultant_bills').select('id, consultant_id, invoice_id, period_month, amount, vendor_ref, note').in('consultant_id', ids);
  const invIds = [...new Set((bills || []).map(b => b.invoice_id).filter(Boolean))];
  const invStatus = {};
  if (invIds.length) { const { data: invs } = await supabaseAdmin.from('invoices').select('id, status').in('id', invIds); (invs || []).forEach(i => { invStatus[i.id] = i.status; }); }
  return cons.map(c => {
    const mine = (bills || []).filter(b => b.consultant_id === c.id);
    const prev = r2(mine.filter(b => b.period_month < period && ['approved', 'sent'].includes(invStatus[b.invoice_id])).reduce((a, b) => a + Number(b.amount), 0));
    const thisBills = mine.filter(b => b.period_month === period);
    const thisAmt = r2(thisBills.reduce((a, b) => a + Number(b.amount), 0));
    return { id: c.id, name: c.name, mode: c.mode, phase_key: c.phase_key, contract: Number(c.contract_amount) || 0, prev, this_invoice: thisAmt, bills: thisBills, notes: c.notes };
  });
}

// Folded line: HDLA portion (projection-driven) + consultant portions (bill-driven) print as one row
function foldLine(L) {
  const h = L.source?.hdla; if (!h) return L;
  const cons = L.source?.consultants || [];
  h.earned = r2((h.contract || 0) * (Number(h.pct) || 0) / 100); h.this = r2(h.earned - (h.prev || 0));
  const cContract = cons.reduce((a, c) => a + (c.contract || 0), 0), cPrev = cons.reduce((a, c) => a + (c.prev || 0), 0), cThis = cons.reduce((a, c) => a + (c.this_invoice || 0), 0);
  L.contract_amount = r2((h.contract || 0) + cContract); L.previous = r2((h.prev || 0) + cPrev); L.this_invoice = r2(h.this + cThis);
  L.earned = r2(L.previous + L.this_invoice); L.pct = L.contract_amount > 0 ? r2(L.earned / L.contract_amount * 100) : null; L.remaining = r2(L.contract_amount - L.earned);
  return L;
}

async function hourlyDetail(projectNum, projectName, phase, period, ctx) {
  const { services_through } = periodDates(period);
  const { data: entries } = await supabaseAdmin.from('time_entries').select('user_id, initials, hours')
    .eq('project_num', projectNum).eq('project_name', String(projectName || '').trim()).eq('phase', phase || '').gte('work_date', `${period}-01`).lte('work_date', services_through);
  const resolver = buildResolver(ctx.schedules, ctx.overrides);
  const byUser = {};
  (entries || []).forEach(e => {
    const p = ctx.profiles.find(x => x.id === e.user_id) || {};
    if (!byUser[e.user_id]) byUser[e.user_id] = { name: p.display_name || e.initials, hours: 0, rate: resolver.rateFor(projectNum, p.rate_title) };
    byUser[e.user_id].hours += Number(e.hours) || 0;
  });
  return Object.values(byUser).map(d => ({ ...d, hours: r2(d.hours) }));
}

function totalOf(lines) {
  return r2(lines.filter(l => l.kind !== 'header' && !l.tbd).reduce((a, l) => a + (Number(l.this_invoice) || 0), 0));
}
const FEE_KINDS = ['phase', 'hourly', 'consultant', 'header'];

async function profilesByInitials() {
  const { data } = await supabaseAdmin.from('staff_profiles').select('initials, display_name');
  const m = {}; (data || []).forEach(p => { m[p.initials] = p.display_name; }); return m;
}

// Invoice ids whose baseline (Master Data's Previously Billed) is lower than what the project's last approved/sent invoice
// already billed on the same line. curPrev: { invoiceId: { lineKey: baseline } }, earnedBy: { lastInvoiceId: { lineKey: earned } }
function findBehind(openInvs, lastByProject, earnedBy, curPrev) {
  const out = new Set();
  openInvs.forEach(i => {
    const last = lastByProject[i.project_num]; if (!last) return;
    Object.entries(curPrev[i.id] || {}).forEach(([k, cp]) => { const pe = earnedBy[last.id]?.[k]; if (pe != null && pe > cp + 0.5) out.add(i.id); });
  });
  return out;
}

// ─── Repeat-monthly lines ─────────────────────────────────────────
// Manually added expense / reimbursable / header lines can be ticked "repeat monthly". The tick saves a template on the
// project (project_billing_settings.recurring_lines); every new draft for that project starts with those lines.
// Only lines with no cumulative state can repeat: a manual phase line has no Master Data baseline to carry.
const REPEAT_KINDS = ['expense', 'reimbursable', 'header'];
function templateOf(line, key) {
  return { key, kind: line.kind, description: line.description || '', qty: line.qty ?? null, unit: line.unit ?? null, rate: line.rate ?? null, this_invoice: r2(line.this_invoice) };
}
function appendRecurring(lines, settings) {
  const list = Array.isArray(settings?.recurring_lines) ? settings.recurring_lines : [];
  let n = lines.length;
  list.forEach(t => {
    if (!t?.key || !REPEAT_KINDS.includes(t.kind)) return;
    const amt = r2(t.this_invoice);
    const isHeader = t.kind === 'header';
    lines.push({ sort_order: n++, kind: t.kind, phase: t.description || '', description: t.description || '', contract_amount: null, pct: null,
      earned: isHeader ? null : amt, previous: null, this_invoice: isHeader ? 0 : amt, remaining: null, tbd: false,
      qty: t.qty ?? null, unit: t.unit ?? null, rate: t.rate ?? null, overridden: true, repeat_key: t.key, source: {} });
  });
}
// When a repeating line is edited, keep its saved template in step so the edit carries to future invoices
async function syncRecurring(invoiceId, L) {
  if (!L?.repeat_key) return;
  const { data: invRow } = await supabaseAdmin.from('invoices').select('project_num').eq('id', invoiceId).single();
  if (!invRow) return;
  const { data: st } = await supabaseAdmin.from('project_billing_settings').select('recurring_lines').eq('project_num', invRow.project_num).maybeSingle();
  const list = Array.isArray(st?.recurring_lines) ? st.recurring_lines : [];
  const next = REPEAT_KINDS.includes(L.kind) ? list.map(t => t.key === L.repeat_key ? templateOf(L, L.repeat_key) : t) : list.filter(t => t.key !== L.repeat_key);
  await supabaseAdmin.from('project_billing_settings').upsert({ project_num: invRow.project_num, recurring_lines: next, updated_at: new Date().toISOString() }, { onConflict: 'project_num' });
}

async function draftInvoice({ req, period, projectNum, md, projections, ctx, clients, settingsMap, names, caller, force }) {
  const rows = md.filter(r => String(r['Project #']) === String(projectNum));
  if (!rows.some(isOpen)) return null;
  const settings = settingsMap[projectNum] || {};
  const consultants = await loadConsultants(projectNum, period);
  const lines = await buildLines({ rows, period, projections, ctx, settings, consultants });
  // A project is only drafted when Master Data + projections give something to bill; repeating lines alone don't trigger a draft
  const anyPositive = lines.some(l => l.kind !== 'header' && !l.tbd && Number(l.this_invoice) > 0);
  if (!force && !anyPositive) return null;
  appendRecurring(lines, settings);
  const total = totalOf(lines);

  const first = rows.find(isOpen) || rows[0];
  const clientName = settings.bill_to_client || first['Client'] || '';
  const client = clients[clientName] || {};
  const pm = first['PM'] || first['Partner'] || '';
  const partnerCol = String(first['Partner'] || '').trim();
  const signerInitials = SIGNERS[partnerCol] ? partnerCol : (settings.signer_initials || 'RJ');
  const { invoice_date, services_through } = periodDates(period);

  const inv = {
    period_month: period, invoice_date, services_through,
    project_num: String(projectNum), project_num_display: String(projectNum), project_name: settings.project_name || baseNameOf(rows) || first['Project Name'] || '',
    client_name: clientName,
    principal_label: settings.principal_label || 'Principal',
    principal_name: settings.principal_name || names[pm] || pm,
    principal_initials: pm,
    bill_to: { attn: client.attn || '', title: client.title || '', company: client.company || clientName, address1: client.address1 || '', address2: client.address2 || '', city_state_zip: client.city_state_zip || '' },
    reference_lines: settings.reference_lines || [],
    signer_initials: signerInitials, signer_text: SIGNERS[signerInitials] || '',
    status: 'draft', total_due: total, created_by: caller?.initials || '',
  };
  const { data: created, error } = await supabaseAdmin.from('invoices').insert(inv).select().single();
  if (error) throw error;
  const { error: lerr } = await supabaseAdmin.from('invoice_lines').insert(lines.map(l => ({ ...l, invoice_id: created.id })));
  if (lerr) throw lerr;
  const billIds = consultants.flatMap(c => c.bills.map(b => b.id));
  if (billIds.length) await supabaseAdmin.from('consultant_bills').update({ invoice_id: created.id }).in('id', billIds);
  return created;
}

async function setLineOverride(projectNum, phase, patch) {
  if (!projectNum || !phase) return;
  const { data: st } = await supabaseAdmin.from('project_billing_settings').select('line_overrides').eq('project_num', projectNum).maybeSingle();
  const cur = st?.line_overrides || {};
  const next = { ...cur, [phase]: { ...(cur[phase] || {}), ...patch } };
  if (next[phase].hidden === false) delete next[phase].hidden;
  if (!next[phase].description && !next[phase].hidden) delete next[phase];
  await supabaseAdmin.from('project_billing_settings').upsert({ project_num: projectNum, line_overrides: next, updated_at: new Date().toISOString() }, { onConflict: 'project_num' });
}

async function regenerateInvoice(id, req) {
  const { data: inv } = await supabaseAdmin.from('invoices').select('*').eq('id', id).single();
  if (!inv) return { error: 'Not found', code: 404 };
  if (['approved', 'sent'].includes(inv.status)) return { error: 'Locked', code: 409 };
  const [md, { data: projRows }, ctx, { data: settings }, { data: oldLines }] = await Promise.all([
    masterData(req), supabaseAdmin.from('projections').select('project_id, months'), loadRateContext(),
    supabaseAdmin.from('project_billing_settings').select('*').eq('project_num', inv.project_num).maybeSingle(),
    supabaseAdmin.from('invoice_lines').select('*').eq('invoice_id', id),
  ]);
  const projections = {}; (projRows || []).forEach(p => { projections[p.project_id] = p; });
  const rows = md.filter(r => String(r['Project #']) === inv.project_num);
  const consultants = await loadConsultants(inv.project_num, inv.period_month);
  const fresh = await buildLines({ rows, period: inv.period_month, projections, ctx, settings, consultants });
  const billIds = consultants.flatMap(c => c.bills.map(b => b.id));
  if (billIds.length) await supabaseAdmin.from('consultant_bills').update({ invoice_id: id }).in('id', billIds);
  // Keep Ellie's edited HDLA lines (carry her pct into folded recompute), keep manual extras; rebuild the rest
  const keep = [];
  const carry = {};
  (oldLines || []).forEach(l => {
    if (['expense', 'reimbursable', 'header'].includes(l.kind) || (l.overridden && !l.source?.key)) keep.push(l);
    else if (l.overridden && l.source?.key) carry[l.source.key] = l;
  });
  const toInsert = fresh.map(l => {
    const old = carry[l.source?.key];
    if (old) {
      if (l.source?.hdla) { l.source.hdla.pct = old.source?.hdla?.pct ?? old.pct; foldLine(l); l.overridden = true; l.description = old.description; }
      else { const { id: _i, invoice_id: _v, sort_order: _s, ...rest } = old; Object.assign(l, rest, { source: { ...l.source, projected: l.source.projected } }); }
    }
    return { ...l, invoice_id: id };
  });
  const keepIds = new Set(keep.map(l => l.id));
  const dropIds = (oldLines || []).filter(l => !keepIds.has(l.id)).map(l => l.id);
  if (dropIds.length) await supabaseAdmin.from('invoice_lines').delete().in('id', dropIds);
  if (toInsert.length) await supabaseAdmin.from('invoice_lines').insert(toInsert);
  const total = await recomputeTotal(id);
  return { total };
}

async function transition({ id, status, note, caller, now }) {
  const { data: inv } = await supabaseAdmin.from('invoices').select('*').eq('id', id).single();
  if (!inv) return { error: 'Not found', code: 404 };
  const upd = { status, updated_at: now };
  if (status === 'review') { if (!['draft', 'returned'].includes(inv.status)) return { error: `Cannot send a ${inv.status} invoice to review`, code: 409 }; upd.review_note = null; }
  if (status === 'approved') {
    if (caller.role !== 'partner') return { error: 'Partners approve', code: 403 };
    if (inv.status !== 'review') return { error: `Not in review (${inv.status})`, code: 409 };
    upd.approved_by = caller.initials; upd.approved_at = now; upd.review_note = null;
    if (!inv.invoice_number) {
      const { data: seq } = await supabaseAdmin.from('invoice_sequences').select('last_seq').eq('period_month', inv.period_month).maybeSingle();
      const next = (seq?.last_seq || 0) + 1;
      await supabaseAdmin.from('invoice_sequences').upsert({ period_month: inv.period_month, last_seq: next }, { onConflict: 'period_month' });
      upd.invoice_number = invoiceNumber(inv.period_month, next);
    }
  }
  if (status === 'returned') { if (caller.role !== 'partner') return { error: 'Partners return', code: 403 }; upd.review_note = note || ''; upd.approved_by = caller.initials; upd.approved_at = null; }
  if (status === 'draft') { if (inv.status === 'approved' && caller.role !== 'partner') return { error: 'Partners reopen', code: 403 }; if (inv.status === 'sent') return { error: 'Sent invoices cannot be reopened; void instead', code: 409 }; }
  if (status === 'sent') { if (inv.status !== 'approved') return { error: 'Approve before sending', code: 409 }; upd.sent_at = now; }
  if (status === 'void') { if (inv.status === 'sent' && caller.role !== 'partner') return { error: 'Partners void sent invoices', code: 403 }; }
  const { error } = await supabaseAdmin.from('invoices').update(upd).eq('id', id);
  if (error) return { error: error.message, code: 500 };
  const label = { review: 'Sent to review', returned: 'Returned for revision', approved: 'Approved', sent: 'Marked sent', draft: 'Reopened', void: 'Voided' }[status];
  if (label) await supabaseAdmin.from('invoice_comments').insert({ invoice_id: id, author_initials: caller.initials, author_role: caller.role, body: note ? `${label}: ${note}` : label, kind: 'status', resolved: true });
  return { invoice: { ...inv, ...upd } };
}

async function recomputeTotal(invoiceId) {
  const { data: lines } = await supabaseAdmin.from('invoice_lines').select('*').eq('invoice_id', invoiceId);
  const total = totalOf(lines || []);
  await supabaseAdmin.from('invoices').update({ total_due: total, updated_at: new Date().toISOString() }).eq('id', invoiceId);
  return total;
}

// ─── GET ──────────────────────────────────────────────────────────
export async function GET(req) {
  const { caller, error: authError } = await requireCaller(req, FINANCE);
  if (authError) return authError;
  try {
    const { searchParams } = new URL(req.url);
    const view = searchParams.get('view') || 'month';

    if (view === 'clients') {
      // Legacy bill-to address book plus the unified client record (marketing_clients.billing_addresses).
      const [{ data }, { data: mc }] = await Promise.all([
        supabaseAdmin.from('clients').select('*').order('name'),
        supabaseAdmin.from('marketing_clients').select('id, name, office, billing_addresses, aliases, contacts').order('name'),
      ]);
      const unified = (mc || []).map(c => ({ id: c.id, name: c.name, office: c.office || '', aliases: c.aliases || [], contacts: c.contacts || [], billing_addresses: Array.isArray(c.billing_addresses) ? c.billing_addresses : [] }));
      const norm = s => String(s || '').trim().toLowerCase();
      const byName = {}; unified.forEach(c => { byName[norm(c.name)] = c; (c.aliases || []).forEach(a => { byName[norm(a)] = c; }); });
      const legacy = (data || []).map(c => ({ ...c, matched_client_id: byName[norm(c.name)]?.id || byName[norm(c.company)]?.id || '' }));
      return NextResponse.json({ clients: legacy, unified });
    }

    if (view === 'month') {
      const period = searchParams.get('period');
      if (!period) return NextResponse.json({ error: 'Missing period' }, { status: 400 });
      const [{ data: invoices }, md, { data: projRows }] = await Promise.all([
        supabaseAdmin.from('invoices').select('*').eq('period_month', period).order('project_num'),
        masterData(req),
        supabaseAdmin.from('projections').select('project_id, months'),
      ]);
      const projections = {}; (projRows || []).forEach(p => { projections[p.project_id] = p; });
      const have = new Set((invoices || []).map(i => i.project_num));
      const open = md.filter(isOpen);
      const ids = projectionIds(open);
      const byProject = {};
      open.forEach((r, i) => {
        const num = String(r['Project #']);
        if (have.has(num)) return;
        const fee = Number(r['Fee']) || 0, mdPrev = Number(r['Previously Billed']) || 0;
        const proj = projections[ids[i]];
        const projected = proj?.months?.[period];
        const prev = effectivePrev(fee, mdPrev, proj, period);
        const due = projected != null ? Math.max(0, r2(fee * Number(projected) / 100 - prev)) : 0;
        if (!byProject[num]) byProject[num] = { project_num: num, project_name: baseNameOf(md.filter(x => String(x['Project #']) === num)), client: r['Client'], pm: r['PM'], status: r['Status'], projected_due: 0, has_projection: false };
        byProject[num].projected_due = r2(byProject[num].projected_due + Math.max(0, due));
        if (projected != null) byProject[num].has_projection = true;
      });
      const candidates = Object.values(byProject).sort((a, b) => b.projected_due - a.projected_due);
      const invIds = (invoices || []).map(i => i.id);
      const openCounts = {}; const lineInfo = {}; const curPrev = {};
      if (invIds.length) {
        const [{ data: cm }, { data: ln }] = await Promise.all([
          supabaseAdmin.from('invoice_comments').select('invoice_id, resolved, kind').in('invoice_id', invIds),
          supabaseAdmin.from('invoice_lines').select('invoice_id, kind, pct, source, overridden, this_invoice, hourly_detail, tbd').in('invoice_id', invIds),
        ]);
        (cm || []).forEach(c => { if (!c.resolved && c.kind === 'comment') openCounts[c.invoice_id] = (openCounts[c.invoice_id] || 0) + 1; });
        (ln || []).forEach(l => {
          const li = lineInfo[l.invoice_id] || (lineInfo[l.invoice_id] = { anyProjection: false, override: false, hourlyEmpty: false, lines: 0 });
          if (['phase', 'hourly'].includes(l.kind) && l.source?.key) (curPrev[l.invoice_id] = curPrev[l.invoice_id] || {})[l.source.key] = Number(l.source.prev) || 0;
          if (l.kind === 'header' || l.tbd) return;
          li.lines++;
          if (l.source?.projected != null) li.anyProjection = true;
          if (l.kind === 'phase' && l.source?.projected != null && !l.source?.belowBilled && Math.abs(Number(l.pct) - Number(l.source.projected)) > 0.01) li.override = true;
          if (l.source?.belowBilled) li.belowBilled = true;
          if (l.kind === 'hourly' && !(l.hourly_detail || []).length && Number(l.this_invoice) === 0) li.hourlyEmpty = true;
        });
      }
      // Prior month, for change-vs-last comparison
      const prev = shiftPeriodKey(period, -1);
      const { data: prevInv } = await supabaseAdmin.from('invoices').select('project_num, total_due, status').eq('period_month', prev).in('status', ['approved', 'sent']);
      const prevByProject = {}; (prevInv || []).forEach(p => { prevByProject[p.project_num] = Number(p.total_due) || 0; });
      const { data: newClients } = await supabaseAdmin.from('clients').select('name, updated_at').gte('updated_at', `${period}-01`);
      const newClientNames = new Set((newClients || []).map(c => c.name));

      // "Master Data may be behind": a line's baseline (Master Data's Previously Billed) is lower than what the project's last
      // approved/sent invoice already billed for that line, i.e. last month probably hasn't been posted to Master Data yet.
      const behind = new Set();
      const openInvs = (invoices || []).filter(i => ['draft', 'review', 'returned'].includes(i.status));
      const projNums = [...new Set(openInvs.map(i => i.project_num))];
      if (projNums.length) {
        const { data: past } = await supabaseAdmin.from('invoices').select('id, project_num, period_month').in('project_num', projNums).in('status', ['approved', 'sent']).lt('period_month', period).order('period_month', { ascending: false });
        const lastByProject = {}; (past || []).forEach(p => { if (!lastByProject[p.project_num]) lastByProject[p.project_num] = p; });
        const pastIds = Object.values(lastByProject).map(p => p.id);
        if (pastIds.length) {
          const { data: pl } = await supabaseAdmin.from('invoice_lines').select('invoice_id, kind, source, earned').in('invoice_id', pastIds);
          const earnedBy = {};
          (pl || []).forEach(l => { if (!['phase', 'hourly'].includes(l.kind) || !l.source?.key) return; (earnedBy[l.invoice_id] = earnedBy[l.invoice_id] || {})[l.source.key] = Number(l.source.hdla?.earned ?? l.earned) || 0; });
          findBehind(openInvs, lastByProject, earnedBy, curPrev).forEach(id => behind.add(id));
        }
      }

      const withFlags = (invoices || []).map(i => {
        const li = lineInfo[i.id] || {}; const bt = i.bill_to || {};
        const flags = [];
        if (!bt.company && !bt.attn) flags.push({ code: 'no_bill_to', label: 'No bill-to', severity: 'block' });
        if (!li.anyProjection) flags.push({ code: 'no_projection', label: 'No projection', severity: 'warn' });
        if (li.hourlyEmpty) flags.push({ code: 'hourly_empty', label: 'Hourly, no hours', severity: 'warn' });
        if (li.override) flags.push({ code: 'override', label: 'Differs from projection', severity: 'info' });
        if (li.belowBilled) flags.push({ code: 'below', label: 'Projection below billed', severity: 'warn' });
        if (openCounts[i.id]) flags.push({ code: 'comments', label: `${openCounts[i.id]} open comment${openCounts[i.id] === 1 ? '' : 's'}`, severity: 'warn' });
        if (newClientNames.has(i.client_name)) flags.push({ code: 'new_client', label: 'New bill-to', severity: 'info' });
        if (behind.has(i.id)) flags.push({ code: 'md_behind', label: 'Master Data may be behind', severity: 'warn' });
        const last = prevByProject[i.project_num];
        if (last != null && last > 0 && Number(i.total_due) > last * 2.5 && Number(i.total_due) - last > 5000) flags.push({ code: 'jump', label: 'Large jump vs last month', severity: 'info' });
        if (Number(i.total_due) === 0) flags.push({ code: 'zero', label: 'Zero total', severity: 'warn' });
        return { ...i, open_comments: openCounts[i.id] || 0, flags, last_month_total: last ?? null };
      });
      return NextResponse.json({ period, invoices: withFlags, candidates, signers: SIGNERS, remit_to: REMIT_TO, isPartner: caller.role === 'partner', me: caller.initials });
    }

    if (view === 'invoice') {
      const id = searchParams.get('id');
      const [{ data: inv }, { data: lines }, md] = await Promise.all([
        supabaseAdmin.from('invoices').select('*').eq('id', id).single(),
        supabaseAdmin.from('invoice_lines').select('*').eq('invoice_id', id).order('sort_order'),
        masterData(req),
      ]);
      if (!inv) return NextResponse.json({ error: 'Not found' }, { status: 404 });
      const mdRows = md.filter(r => String(r['Project #']) === inv.project_num);
      // Hours context (internal only): this period and to date, by phase
      const { services_through } = periodDates(inv.period_month);
      const { data: comments } = await supabaseAdmin.from('invoice_comments').select('*').eq('invoice_id', id).order('created_at');
      const [{ data: monthHours }, { data: allHours }, ctx, { data: settings }] = await Promise.all([
        supabaseAdmin.from('time_entries').select('phase, project_name, hours, user_id').eq('project_num', inv.project_num).gte('work_date', `${inv.period_month}-01`).lte('work_date', services_through),
        supabaseAdmin.from('time_entries').select('phase, project_name, hours, user_id').eq('project_num', inv.project_num).lte('work_date', services_through),
        loadRateContext(),
        supabaseAdmin.from('project_billing_settings').select('*').eq('project_num', inv.project_num).maybeSingle(),
      ]);
      const resolver = buildResolver(ctx.schedules, ctx.overrides);
      const profById = {}; ctx.profiles.forEach(p => { profById[p.id] = p; });
      const agg = list => { const m = {}; (list || []).forEach(e => { const k = `${String(e.project_name || '').trim()}||${e.phase || ''}`; if (!m[k]) m[k] = { hours: 0, value: 0 }; const h = Number(e.hours) || 0; m[k].hours += h; m[k].value += h * resolver.rateFor(inv.project_num, profById[e.user_id]?.rate_title); }); return m; };
      const consultants = await loadConsultants(inv.project_num, inv.period_month);
      const { data: allCons } = await supabaseAdmin.from('project_consultants').select('*').eq('project_num', inv.project_num).order('sort_order').order('created_at');
      return NextResponse.json({ invoice: inv, lines: lines || [], comments: comments || [], masterData: mdRows, consultants, consultantSetup: allCons || [], hours: { month: agg(monthHours), toDate: agg(allHours) }, settings: settings || null, signers: SIGNERS, remit_to: REMIT_TO, isPartner: caller.role === 'partner', me: caller.initials });
    }

    if (view === 'reconcile') {
      const [{ data: sent }, md] = await Promise.all([
        supabaseAdmin.from('invoices').select('id, project_num, period_month, sent_at, invoice_number').eq('status', 'sent'),
        masterData(req),
      ]);
      const ids = (sent || []).map(s => s.id);
      let lines = [];
      if (ids.length) { const { data } = await supabaseAdmin.from('invoice_lines').select('invoice_id, phase, kind, this_invoice').in('invoice_id', ids); lines = data || []; }
      const invById = {}; (sent || []).forEach(s => { invById[s.id] = s; });
      const hub = {};
      lines.forEach(l => { if (l.kind === 'header') return; const inv = invById[l.invoice_id]; const k = `${inv.project_num}||${l.phase || ''}`; if (!hub[k]) hub[k] = { project_num: inv.project_num, phase: l.phase || '', hub_billed: 0, first_period: inv.period_month, invoices: new Set() }; hub[k].hub_billed = r2(hub[k].hub_billed + (Number(l.this_invoice) || 0)); if (inv.period_month < hub[k].first_period) hub[k].first_period = inv.period_month; hub[k].invoices.add(inv.invoice_number); });
      const rowsOut = md.filter(r => r['Status'] === 'O').map(r => {
        const k = `${r['Project #']}||${r['Phase'] || ''}`; const h = hub[k];
        return { project_num: String(r['Project #']), project_name: r['Project Name'], phase: r['Phase'], fee: Number(r['Fee']) || 0, md_prev_billed: Number(r['Previously Billed']) || 0, hub_billed: h?.hub_billed || 0, first_period: h?.first_period || null, invoices: h ? [...h.invoices] : [] };
      }).filter(r => r.hub_billed > 0);
      return NextResponse.json({ rows: rowsOut });
    }

    return NextResponse.json({ error: 'Unknown view' }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

// ─── POST ─────────────────────────────────────────────────────────
export async function POST(req) {
  const { caller, error: authError } = await requireCaller(req, FINANCE);
  if (authError) return authError;
  try {
    const body = await req.json();
    const { action } = body;
    const now = new Date().toISOString();

    if (action === 'generateDrafts' || action === 'createDraft') {
      const { period } = body;
      if (!period) return NextResponse.json({ error: 'Missing period' }, { status: 400 });
      const [md, { data: projRows }, ctx, { data: clientRows }, { data: settingsRows }, { data: existing }, names] = await Promise.all([
        masterData(req),
        supabaseAdmin.from('projections').select('project_id, months'),
        loadRateContext(),
        supabaseAdmin.from('clients').select('*'),
        supabaseAdmin.from('project_billing_settings').select('*'),
        supabaseAdmin.from('invoices').select('project_num').eq('period_month', period),
        profilesByInitials(),
      ]);
      const projections = {}; (projRows || []).forEach(p => { projections[p.project_id] = p; });
      const clients = {}; (clientRows || []).forEach(c => { clients[c.name] = c; });
      const settingsMap = {}; (settingsRows || []).forEach(s => { settingsMap[s.project_num] = s; });
      const have = new Set((existing || []).map(i => i.project_num));
      const targets = action === 'createDraft' ? [String(body.project_num)] : Array.isArray(body.project_nums) && body.project_nums.length ? body.project_nums.map(String) : [...new Set(md.filter(isOpen).map(r => String(r['Project #'])))];
      const created = [];
      for (const num of targets) {
        if (have.has(num)) continue;
        const inv = await draftInvoice({ req, period, projectNum: num, md, projections, ctx, clients, settingsMap, names, caller, force: action === 'createDraft' });
        if (inv) created.push(inv);
      }
      return NextResponse.json({ success: true, created: created.length, invoices: created });
    }

    if (action === 'regenerate') {
      const r = await regenerateInvoice(body.id, req);
      if (r.error) return NextResponse.json({ error: r.error }, { status: r.code || 400 });
      return NextResponse.json({ success: true, total: r.total });
    }

    if (action === 'updateInvoice') {
      const { id, patch, saveClient, saveSettings } = body;
      const { data: inv } = await supabaseAdmin.from('invoices').select('*').eq('id', id).single();
      if (!inv) return NextResponse.json({ error: 'Not found' }, { status: 404 });
      if (inv.status === 'sent') return NextResponse.json({ error: 'Sent invoices are locked' }, { status: 409 });
      const allowed = ['invoice_date', 'services_through', 'project_num_display', 'project_name', 'client_name', 'principal_label', 'principal_name', 'bill_to', 'reference_lines', 'signer_initials', 'signer_text', 'internal_note'];
      const upd = {}; allowed.forEach(k => { if (patch[k] !== undefined) upd[k] = patch[k]; });
      if (upd.signer_initials && !patch.signer_text) upd.signer_text = SIGNERS[upd.signer_initials] || inv.signer_text;
      upd.updated_at = now;
      const { error } = await supabaseAdmin.from('invoices').update(upd).eq('id', id);
      if (error) throw error;
      const merged = { ...inv, ...upd };
      if (saveClient && merged.client_name) {
        const bt = merged.bill_to || {};
        await supabaseAdmin.from('clients').upsert({ name: merged.client_name, attn: bt.attn || null, title: bt.title || null, company: bt.company || null, address1: bt.address1 || null, address2: bt.address2 || null, city_state_zip: bt.city_state_zip || null, updated_at: now }, { onConflict: 'name' });
      }
      if (saveSettings) {
        // The header project name is saved only when that field was edited, so nothing else here depends on the new column
        const nameSave = patch.project_name !== undefined ? { project_name: String(merged.project_name || '').trim() || null } : {};
        const { error: serr } = await supabaseAdmin.from('project_billing_settings').upsert({ project_num: inv.project_num, bill_to_client: merged.client_name, principal_label: merged.principal_label, principal_name: merged.principal_name, signer_initials: merged.signer_initials, reference_lines: merged.reference_lines || [], ...nameSave, updated_at: now }, { onConflict: 'project_num' });
        if (serr && /project_name/.test(serr.message || '')) throw new Error('Run supabase-billing-recurring.sql in Supabase first (adds the saved header name column)');
      }
      return NextResponse.json({ success: true });
    }

    if (action === 'updateLine') {
      const { id, patch } = body;
      const { data: line } = await supabaseAdmin.from('invoice_lines').select('*').eq('id', id).single();
      if (!line) return NextResponse.json({ error: 'Not found' }, { status: 404 });
      const { data: inv } = await supabaseAdmin.from('invoices').select('status').eq('id', line.invoice_id).single();
      if (['approved', 'sent'].includes(inv?.status)) return NextResponse.json({ error: 'Locked' }, { status: 409 });
      const L = { ...line, ...patch };
      if (L.source?.hdla && L.kind === 'phase') {
        const h = L.source.hdla; const cThis = (L.source.consultants || []).reduce((a, c) => a + (c.this_invoice || 0), 0);
        if (patch.pct !== undefined) h.pct = Number(patch.pct) || 0;
        else if (patch.this_invoice !== undefined) { h.this = r2(Number(patch.this_invoice) - cThis); h.earned = r2((h.prev || 0) + h.this); h.pct = h.contract ? r2(h.earned / h.contract * 100) : 0; }
        foldLine(L);
      } else
      if (L.kind === 'phase' && !L.tbd) {
        const fee = Number(L.contract_amount) || 0, prev = Number(L.previous) || 0;
        if (patch.this_invoice !== undefined && patch.pct === undefined) { L.earned = r2(prev + Number(patch.this_invoice)); L.pct = fee > 0 ? r2(L.earned / fee * 100) : null; }
        else if (patch.pct !== undefined || patch.contract_amount !== undefined || patch.previous !== undefined) { L.earned = r2(fee * (Number(L.pct) || 0) / 100); L.this_invoice = r2(L.earned - prev); }
        L.remaining = r2(fee - (Number(L.earned) || 0));
      }
      if (L.kind === 'hourly') {
        const detail = L.hourly_detail || [];
        const thisInv = patch.this_invoice !== undefined ? Number(patch.this_invoice) : r2(detail.reduce((a, d) => a + (Number(d.hours) || 0) * (Number(d.rate) || 0), 0));
        L.this_invoice = r2(thisInv); L.earned = r2((Number(L.previous) || 0) + thisInv);
        L.remaining = L.contract_amount ? r2(Number(L.contract_amount) - L.earned) : null;
      }
      if (['consultant', 'consultant_section'].includes(L.kind)) {
        const fee = Number(L.contract_amount) || 0; const prev = Number(L.previous) || 0;
        if (patch.this_invoice !== undefined) { /* manual override of bills total */ }
        L.earned = r2(prev + (Number(L.this_invoice) || 0)); L.pct = fee ? r2(L.earned / fee * 100) : null; L.remaining = fee ? r2(fee - L.earned) : null;
      }
      if (['expense', 'reimbursable'].includes(L.kind)) {
        if (L.qty != null && L.rate != null && patch.this_invoice === undefined) L.this_invoice = r2(Number(L.qty) * Number(L.rate));
        L.earned = L.this_invoice; L.previous = null; L.remaining = null; L.contract_amount = null; L.pct = null;
      }
      const { id: _id, invoice_id, ...rest } = L;
      const { error } = await supabaseAdmin.from('invoice_lines').update({ ...rest, overridden: true, updated_at: now }).eq('id', id);
      if (error) throw error;
      await syncRecurring(line.invoice_id, L);
      if (patch.description !== undefined && line.source?.key) {
        const { data: invRow } = await supabaseAdmin.from('invoices').select('project_num').eq('id', line.invoice_id).single();
        await setLineOverride(invRow?.project_num, line.source.key, { description: patch.description || null });
      }
      const total = await recomputeTotal(line.invoice_id);
      return NextResponse.json({ success: true, total });
    }

    if (action === 'addLine') {
      const { invoice_id, line } = body;
      const { data: inv } = await supabaseAdmin.from('invoices').select('status').eq('id', invoice_id).single();
      if (['approved', 'sent'].includes(inv?.status)) return NextResponse.json({ error: 'Locked' }, { status: 409 });
      const { data: existing } = await supabaseAdmin.from('invoice_lines').select('sort_order').eq('invoice_id', invoice_id).order('sort_order', { ascending: false }).limit(1);
      const sort_order = existing?.[0]?.sort_order != null ? existing[0].sort_order + 1 : 0;
      const L = { invoice_id, sort_order, kind: line.kind || 'phase', phase: line.phase || line.description || '', description: line.description || '', contract_amount: line.contract_amount ?? null, pct: line.pct ?? null, previous: line.previous ?? 0, tbd: !!line.tbd, qty: line.qty ?? null, unit: line.unit ?? null, rate: line.rate ?? null, hourly_detail: line.hourly_detail ?? null, overridden: true };
      if (L.kind === 'phase' && !L.tbd) { const fee = Number(L.contract_amount) || 0; L.earned = r2(fee * (Number(L.pct) || 0) / 100); L.this_invoice = r2(L.earned - (Number(L.previous) || 0)); L.remaining = r2(fee - L.earned); }
      if (['expense', 'reimbursable'].includes(L.kind)) { L.this_invoice = r2(line.this_invoice ?? (Number(L.qty) || 0) * (Number(L.rate) || 0)); L.earned = L.this_invoice; L.previous = null; }
      if (L.kind === 'hourly') { const d = L.hourly_detail || []; L.this_invoice = r2(d.reduce((a, x) => a + (Number(x.hours) || 0) * (Number(x.rate) || 0), 0)); L.earned = r2((Number(L.previous) || 0) + L.this_invoice); }
      const { data, error } = await supabaseAdmin.from('invoice_lines').insert(L).select().single();
      if (error) throw error;
      const total = await recomputeTotal(invoice_id);
      return NextResponse.json({ success: true, line: data, total });
    }

    if (action === 'removeLine') {
      const { data: line } = await supabaseAdmin.from('invoice_lines').select('invoice_id').eq('id', body.id).single();
      if (!line) return NextResponse.json({ error: 'Not found' }, { status: 404 });
      const { data: inv } = await supabaseAdmin.from('invoices').select('status').eq('id', line.invoice_id).single();
      if (['approved', 'sent'].includes(inv?.status)) return NextResponse.json({ error: 'Locked' }, { status: 409 });
      const { data: full } = await supabaseAdmin.from('invoice_lines').select('phase, source').eq('id', body.id).single();
      await supabaseAdmin.from('invoice_lines').delete().eq('id', body.id);
      if (full?.source?.key) {
        const { data: invRow } = await supabaseAdmin.from('invoices').select('project_num').eq('id', line.invoice_id).single();
        await setLineOverride(invRow?.project_num, full.source.key, { hidden: true });
      }
      const total = await recomputeTotal(line.invoice_id);
      return NextResponse.json({ success: true, total });
    }

    if (action === 'restorePhase') {
      const { invoice_id, phase } = body;
      const { data: invRow } = await supabaseAdmin.from('invoices').select('project_num, status').eq('id', invoice_id).single();
      if (!invRow) return NextResponse.json({ error: 'Not found' }, { status: 404 });
      await setLineOverride(invRow.project_num, phase, { hidden: false });
      return NextResponse.json({ success: true });
    }

    if (action === 'reorderLines') {
      const { ids } = body;
      for (let i = 0; i < ids.length; i++) await supabaseAdmin.from('invoice_lines').update({ sort_order: i }).eq('id', ids[i]);
      return NextResponse.json({ success: true });
    }

    if (action === 'setStatusBulk') {
      const { ids, status } = body;
      const results = [];
      for (const id of ids || []) {
        const r = await transition({ id, status, note: null, caller, now });
        results.push({ id, ok: !r.error, error: r.error || null });
      }
      return NextResponse.json({ success: true, results, done: results.filter(r => r.ok).length });
    }

    if (action === 'setStatus') {
      const { id, status, note } = body;
      const r = await transition({ id, status, note, caller, now });
      if (r.error) return NextResponse.json({ error: r.error }, { status: r.code || 400 });
      return NextResponse.json({ success: true, invoice: r.invoice });
    }

    if (action === 'saveConsultant') {
      const { consultant } = body;
      if (!consultant?.project_num || !consultant?.name) return NextResponse.json({ error: 'Name required' }, { status: 400 });
      const rec = { project_num: String(consultant.project_num), name: consultant.name, contract_amount: Number(consultant.contract_amount) || 0, mode: ['fold', 'row', 'section'].includes(consultant.mode) ? consultant.mode : 'fold', phase_key: consultant.phase_key || null, active: consultant.active !== false, notes: consultant.notes || null, sort_order: Number(consultant.sort_order) || 0, updated_at: now };
      const q = consultant.id ? supabaseAdmin.from('project_consultants').update(rec).eq('id', consultant.id) : supabaseAdmin.from('project_consultants').insert(rec);
      const { data, error } = await q.select().single();
      if (error) throw error;
      if (body.invoice_id) { await regenerateInvoice(body.invoice_id, req); }
      return NextResponse.json({ success: true, consultant: data });
    }
    if (action === 'addBill') {
      const { consultant_id, invoice_id, period_month, amount, vendor_ref, note } = body;
      if (!consultant_id || !period_month || !(Number(amount) > 0)) return NextResponse.json({ error: 'Amount required' }, { status: 400 });
      const { data: inv } = invoice_id ? await supabaseAdmin.from('invoices').select('status').eq('id', invoice_id).single() : { data: null };
      if (['approved', 'sent'].includes(inv?.status)) return NextResponse.json({ error: 'Locked' }, { status: 409 });
      const { error } = await supabaseAdmin.from('consultant_bills').insert({ consultant_id, invoice_id: invoice_id || null, period_month, amount: r2(amount), vendor_ref: vendor_ref || null, note: note || null, created_by: caller.initials });
      if (error) throw error;
      if (invoice_id) await regenerateInvoice(invoice_id, req);
      return NextResponse.json({ success: true });
    }
    if (action === 'removeBill') {
      const { data: b } = await supabaseAdmin.from('consultant_bills').select('invoice_id').eq('id', body.id).single();
      if (b?.invoice_id) { const { data: inv } = await supabaseAdmin.from('invoices').select('status').eq('id', b.invoice_id).single(); if (['approved', 'sent'].includes(inv?.status)) return NextResponse.json({ error: 'Locked' }, { status: 409 }); }
      await supabaseAdmin.from('consultant_bills').delete().eq('id', body.id);
      if (b?.invoice_id) await regenerateInvoice(b.invoice_id, req);
      return NextResponse.json({ success: true });
    }

    if (action === 'addComment') {
      const { invoice_id, line_id, line_label, body: text } = body;
      if (!invoice_id || !text?.trim()) return NextResponse.json({ error: 'Empty comment' }, { status: 400 });
      const { data, error } = await supabaseAdmin.from('invoice_comments').insert({ invoice_id, line_id: line_id || null, line_label: line_label || null, author_initials: caller.initials, author_role: caller.role, body: text.trim(), kind: 'comment' }).select().single();
      if (error) throw error;
      return NextResponse.json({ success: true, comment: data });
    }
    if (action === 'resolveComment') {
      const { id, resolved } = body;
      const { error } = await supabaseAdmin.from('invoice_comments').update(resolved === false ? { resolved: false, resolved_by: null, resolved_at: null } : { resolved: true, resolved_by: caller.initials, resolved_at: now }).eq('id', id);
      if (error) throw error;
      return NextResponse.json({ success: true });
    }
    if (action === 'deleteComment') {
      const { data: c } = await supabaseAdmin.from('invoice_comments').select('author_initials').eq('id', body.id).single();
      if (!c || (c.author_initials !== caller.initials && caller.role !== 'partner')) return NextResponse.json({ error: 'Not yours' }, { status: 403 });
      await supabaseAdmin.from('invoice_comments').delete().eq('id', body.id);
      return NextResponse.json({ success: true });
    }

    if (action === 'setRepeat') {
      const { id, repeat } = body;
      const { data: line } = await supabaseAdmin.from('invoice_lines').select('*').eq('id', id).single();
      if (!line) return NextResponse.json({ error: 'Not found' }, { status: 404 });
      const { data: inv } = await supabaseAdmin.from('invoices').select('project_num, status').eq('id', line.invoice_id).single();
      if (['approved', 'sent', 'void'].includes(inv?.status)) return NextResponse.json({ error: 'Locked' }, { status: 409 });
      if (!REPEAT_KINDS.includes(line.kind) || line.source?.key) return NextResponse.json({ error: 'Only manually added expense, reimbursable or header lines can repeat monthly' }, { status: 400 });
      const { data: st } = await supabaseAdmin.from('project_billing_settings').select('recurring_lines').eq('project_num', inv.project_num).maybeSingle();
      const list = Array.isArray(st?.recurring_lines) ? st.recurring_lines : [];
      let key = line.repeat_key || null;
      let next;
      if (repeat) { key = key || randomUUID(); next = [...list.filter(t => t.key !== key), templateOf(line, key)]; }
      else { next = list.filter(t => t.key !== key); key = null; }
      const { error: e1 } = await supabaseAdmin.from('project_billing_settings').upsert({ project_num: inv.project_num, recurring_lines: next, updated_at: now }, { onConflict: 'project_num' });
      if (e1) return NextResponse.json({ error: /recurring_lines/.test(e1.message || '') ? 'Run supabase-billing-recurring.sql in Supabase first (adds the repeat-monthly columns)' : e1.message }, { status: 500 });
      const { error: e2 } = await supabaseAdmin.from('invoice_lines').update({ repeat_key: key }).eq('id', id);
      if (e2) return NextResponse.json({ error: /repeat_key/.test(e2.message || '') ? 'Run supabase-billing-recurring.sql in Supabase first (adds the repeat-monthly columns)' : e2.message }, { status: 500 });
      return NextResponse.json({ success: true, repeat: !!key });
    }

    // Clears what the Hub has remembered for one project: line wording, hidden lines, saved header name, repeating lines.
    // Bill-to, signer, principal and PO/reference lines are kept. Existing invoices are not changed until their lines are rebuilt.
    if (action === 'resetProject') {
      const num = String(body.project_num || '');
      if (!num) return NextResponse.json({ error: 'Missing project' }, { status: 400 });
      const { error: e1 } = await supabaseAdmin.from('project_billing_settings').upsert({ project_num: num, line_overrides: {}, updated_at: now }, { onConflict: 'project_num' });
      if (e1) throw e1;
      // These two columns come from supabase-billing-recurring.sql; if it hasn't been run there is nothing saved in them to clear
      await supabaseAdmin.from('project_billing_settings').update({ project_name: null, recurring_lines: [] }).eq('project_num', num);
      const { data: invs } = await supabaseAdmin.from('invoices').select('id').eq('project_num', num);
      const ids = (invs || []).map(i => i.id);
      if (ids.length) await supabaseAdmin.from('invoice_lines').update({ repeat_key: null }).in('invoice_id', ids).not('repeat_key', 'is', null);
      return NextResponse.json({ success: true });
    }

    // ── Unified clients: billing addresses live on the marketing client ──
    if (action === 'saveBillingAddress') {
      const { clientId, address } = body;
      if (!clientId || !address) return NextResponse.json({ error: 'clientId and address required' }, { status: 400 });
      const { data: c } = await supabaseAdmin.from('marketing_clients').select('billing_addresses').eq('id', clientId).single();
      if (!c) return NextResponse.json({ error: 'Client not found' }, { status: 404 });
      const list = Array.isArray(c.billing_addresses) ? c.billing_addresses : [];
      const id = address.id || (Date.now().toString(36) + Math.random().toString(36).slice(2, 8));
      const next = list.some(a => a.id === id) ? list.map(a => a.id === id ? { ...a, ...address, id } : a) : [...list, { ...address, id }];
      if (address.is_default) next.forEach(a => { a.is_default = a.id === id; });
      const { error } = await supabaseAdmin.from('marketing_clients').update({ billing_addresses: next, updated_at: now }).eq('id', clientId);
      if (error) throw error;
      return NextResponse.json({ success: true, id, billing_addresses: next });
    }
    if (action === 'removeBillingAddress') {
      const { clientId, addressId } = body;
      const { data: c } = await supabaseAdmin.from('marketing_clients').select('billing_addresses').eq('id', clientId).single();
      if (!c) return NextResponse.json({ error: 'Client not found' }, { status: 404 });
      const next = (c.billing_addresses || []).filter(a => a.id !== addressId);
      await supabaseAdmin.from('marketing_clients').update({ billing_addresses: next, updated_at: now }).eq('id', clientId);
      return NextResponse.json({ success: true });
    }
    if (action === 'setProjectClient') {
      // remember which unified client + address a project bills to
      const { project_num, clientId, addressId } = body;
      if (!project_num) return NextResponse.json({ error: 'project_num required' }, { status: 400 });
      const { error } = await supabaseAdmin.from('project_billing_settings').upsert({ project_num, client_id: clientId || '', billing_address_id: addressId || '', updated_at: now }, { onConflict: 'project_num' });
      if (error) throw error;
      return NextResponse.json({ success: true });
    }
    if (action === 'mergeClients') {
      // One-time, reviewable: copy each legacy bill-to into the matching marketing client as a billing address.
      // Returns what matched and what didn't; nothing is deleted. Re-running skips addresses already copied.
      if (caller.role !== 'partner' && caller.role !== 'operations') return NextResponse.json({ error: 'Partners or operations only' }, { status: 403 });
      const [{ data: legacy }, { data: mc }] = await Promise.all([supabaseAdmin.from('clients').select('*'), supabaseAdmin.from('marketing_clients').select('id, name, aliases, billing_addresses')]);
      const norm = s => String(s || '').trim().toLowerCase();
      const byName = {}; (mc || []).forEach(c => { byName[norm(c.name)] = c; (c.aliases || []).forEach(a => { byName[norm(a)] = c; }); });
      const overrides = body.matches || {}; // { legacyName: marketingClientId } from the review step
      const matched = [], unmatched = [];
      for (const l of legacy || []) {
        const target = overrides[l.name] ? (mc || []).find(c => c.id === overrides[l.name]) : (byName[norm(l.name)] || byName[norm(l.company)]);
        if (!target) { unmatched.push(l.name); continue; }
        const list = Array.isArray(target.billing_addresses) ? target.billing_addresses : [];
        const sig = a => norm(`${a.attn}|${a.address1}|${a.city_state_zip}`);
        const addr = { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 8), label: l.name, attn: l.attn || '', title: l.title || '', company: l.company || l.name, address1: l.address1 || '', address2: l.address2 || '', city_state_zip: l.city_state_zip || '', email: l.email || '', is_default: list.length === 0 };
        if (!list.some(a => sig(a) === sig(addr))) { list.push(addr); target.billing_addresses = list; await supabaseAdmin.from('marketing_clients').update({ billing_addresses: list, updated_at: now }).eq('id', target.id); }
        matched.push({ legacy: l.name, client: target.name });
      }
      return NextResponse.json({ success: true, matched, unmatched });
    }

    if (action === 'saveClient') {
      // The clients view decorates each legacy row with matched_client_id (not a column); strip it before writing
      const { matched_client_id: _m, ...c } = body.client || {};
      if (!c.name) return NextResponse.json({ error: 'Name required' }, { status: 400 });
      const { data, error } = await supabaseAdmin.from('clients').upsert({ ...c, updated_at: now }, { onConflict: 'name' }).select().single();
      if (error) throw error;
      return NextResponse.json({ success: true, client: data });
    }

    if (action === 'deleteInvoice') {
      const { data: inv } = await supabaseAdmin.from('invoices').select('status').eq('id', body.id).single();
      if (!inv) return NextResponse.json({ error: 'Not found' }, { status: 404 });
      if (['sent', 'approved'].includes(inv.status)) return NextResponse.json({ error: inv.status === 'sent' ? 'Void it instead' : 'Reopen before deleting' }, { status: 409 });
      await supabaseAdmin.from('invoices').delete().eq('id', body.id);
      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
