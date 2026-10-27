'use client';
const qp = (k, d) => { try { return new URLSearchParams(window.location.search).get(k) || d; } catch { return d; } };
import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useAuth } from '../../lib/auth';
import { supabase } from '../../lib/supabase';
import { Shell } from '../../components/shell/Shell';
import { Panel, Button, Link, Pill, Tabs, Input, Select, Empty, Modal, Label } from '../../components/shell/ui';

/* ═══════════════════════════════════════════════════════════════════
   ONEFIRM — Billing
   Monthly invoices from Master Data (fees, previously billed) × Projections (% complete).
   Ellie drafts and edits; partners approve; PDF renders server-side.
   Views: Month · Invoice editor · Reconcile · Clients
   Roles: partner · operations · office
   ═══════════════════════════════════════════════════════════════════ */

// Invoice status → ONE pill. draft/review outline, approved/sent solid ink, void done, returned red outline.
const STATUS = {
  draft:    { label: 'Draft',     kind: 'outline' },
  review:   { label: 'In Review', kind: 'outline' },
  returned: { label: 'Returned',  kind: 'red' },
  approved: { label: 'Approved',  kind: 'solid' },
  sent:     { label: 'Sent',      kind: 'solid' },
  void:     { label: 'Void',      kind: 'done' },
};
const KINDS = [['phase', 'Phase'], ['hourly', 'Hourly'], ['consultant', 'Consultant'], ['consultant_section', 'Consultant (section)'], ['expense', 'Expense'], ['reimbursable', 'Reimbursable'], ['header', 'Header']];
const MODE_LABEL = { fold: 'Folded into a phase', row: 'Own row in the table', section: 'Consultant section below' };

const fmt$ = n => (n == null || isNaN(n)) ? '—' : '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtPct = n => (n == null || isNaN(n)) ? '—' : `${Math.round(Number(n))}%`;   // shown to the nearest whole number; calculations keep the exact value
const fmtH = n => { const v = Number(n) || 0; return v === 0 ? '0' : (Number.isInteger(v) ? String(v) : v.toFixed(1)); };
const monthLabel = p => { const [y, m] = p.split('-').map(Number); return new Date(y, m - 1, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' }); };
const shiftPeriod = (p, d) => { const [y, m] = p.split('-').map(Number); const dt = new Date(y, m - 1 + d, 1); return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}`; };
const prevPeriod = () => shiftPeriod(`${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}`, -1);
const fmtStamp = iso => { if (!iso) return ''; const d = new Date(iso); return isNaN(d) ? '' : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }); };

// Token handling: explicit Bearer on JSON calls (authFetch also covers them); the PDF opens in a new tab so the token rides in the query string.
async function token() { try { const { data } = await supabase.auth.getSession(); return data?.session?.access_token || ''; } catch { return ''; } }
async function getJSON(url) { const t = await token(); const r = await fetch(url, { headers: t ? { Authorization: `Bearer ${t}` } : {} }); const d = await r.json(); if (!r.ok || d.error) throw new Error(d.error || 'Request failed'); return d; }
async function post(payload) { const t = await token(); const r = await fetch('/api/billing', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(t ? { Authorization: `Bearer ${t}` } : {}) }, body: JSON.stringify(payload) }); const d = await r.json(); if (!r.ok || d.error) throw new Error(d.error || 'Request failed'); return d; }
async function openPdf(id, download) { const t = await token(); window.open(`/api/billing/pdf?id=${id}&token=${encodeURIComponent(t)}${download ? '&download=1' : ''}`, '_blank'); }

const Badge = ({ status }) => { const c = STATUS[status] || STATUS.draft; return <Pill kind={c.kind}>{c.label}</Pill>; };
// of-table header cell; alignment/width inline because .of-table thead th outranks utility classes
const Th = ({ children, right, w }) => <th style={{ textAlign: right ? 'right' : 'left', width: w || undefined }}>{children}</th>;
const Loading = ({ children }) => <div className="py-16 text-center text-muted animate-pulse">{children}</div>;
const Note = ({ children }) => <p className="text-xs text-muted">{children}</p>;

// Inline editable number/text — commits on blur or Enter
function Cell({ value, onCommit, type = 'text', format, right, disabled, className = '', placeholder }) {
  const [v, setV] = useState(value ?? '');
  const [focus, setFocus] = useState(false);
  useEffect(() => { setV(value ?? ''); }, [value]);
  const commit = () => { setFocus(false); if (String(v) !== String(value ?? '')) onCommit(type === 'number' ? (v === '' ? null : Number(v)) : v); };
  const display = !focus && format && v !== '' && v != null ? (format === 'money' ? fmt$(v) : format === 'pct' ? fmtPct(v) : v) : v;
  return <input type={focus || !format ? type : 'text'} step={type === 'number' ? '0.01' : undefined} value={display} disabled={disabled} placeholder={placeholder}
    onFocus={() => setFocus(true)} onChange={e => setV(e.target.value)} onBlur={commit} onKeyDown={e => { if (e.key === 'Enter') e.target.blur(); if (e.key === 'Escape') { setV(value ?? ''); e.target.blur(); } }}
    className={`w-full bg-transparent border border-transparent hover:border-rule focus:border-ink focus:bg-white rounded-[3px] px-1.5 py-0.5 text-[13px] outline-none disabled:text-muted ${right ? 'text-right' : ''} ${className}`} />;
}

// ═══ MONTH VIEW — pipeline for Ellie, approvals for partners ═════
// Flags: blocking = red outline, soft (warn) = amber outline, info = ink outline in muted tone.
const FLAG_CLS = { block: 'border-status-red text-status-red', warn: 'border-status-amber text-status-amber', info: 'border-rule text-muted' };
const Flag = ({ f }) => <span className={'inline-block text-[11px] leading-none px-2 py-[3px] rounded-[2px] border whitespace-nowrap ' + (FLAG_CLS[f.severity] || FLAG_CLS.info)}>{f.label}</span>;
const delta = (now, last) => { if (last == null) return null; if (last === 0) return now > 0 ? '+new' : null; const d = (now - last) / last * 100; return `${d >= 0 ? '+' : ''}${Math.round(d)}%`; };

function MonthView({ period, onOpen, isPartner, profile }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState('');
  const [bucket, setBucket] = useState(isPartner ? 'review' : 'attention');
  const [principal, setPrincipal] = useState('all');
  const [signer, setSigner] = useState('all');
  const [sel, setSel] = useState(new Set());
  const [showCandidates, setShowCandidates] = useState(false);
  const [mineOnly, setMineOnly] = useState(true);   // partners: In review shows my invoices unless toggled
  const load = useCallback(() => { setLoading(true); getJSON(`/api/billing?view=month&period=${period}`).then(d => { setData(d); setLoading(false); setSel(new Set()); }).catch(e => { setMsg(e.message); setLoading(false); }); }, [period]);
  useEffect(() => { load(); }, [load]);
  const flash = t => { setMsg(t); setTimeout(() => setMsg(''), 4000); };

  const all = data?.invoices || [];
  const candidates = data?.candidates || [];
  const attention = i => ['draft', 'returned'].includes(i.status) && (i.flags || []).some(f => f.severity !== 'info');
  const cleanDraft = i => i.status === 'draft' && !(i.flags || []).some(f => f.severity !== 'info');
  const flagged = i => (i.flags || []).length > 0;

  // Buckets
  const buckets = useMemo(() => ({
    notstarted: candidates.filter(c => c.has_projection && c.projected_due > 0),
    attention: all.filter(attention),
    draft: all.filter(i => i.status === 'draft'),
    review: all.filter(i => i.status === 'review'),
    returned: all.filter(i => i.status === 'returned'),
    approved: all.filter(i => i.status === 'approved'),
    sent: all.filter(i => i.status === 'sent'),
    all: all.filter(i => i.status !== 'void'),
  }), [all, candidates]);
  const sum = list => list.reduce((a, i) => a + (Number(i.total_due ?? i.projected_due) || 0), 0);

  const principals = useMemo(() => { const m = {}; all.forEach(i => { const k = i.principal_initials || i.principal_name || '—'; m[k] = i.principal_name || k; }); return Object.entries(m).sort((a, b) => a[1].localeCompare(b[1])); }, [all]);
  const signers = data?.signers || {};

  const rows = useMemo(() => {
    let list = buckets[bucket] || [];
    if (principal !== 'all') list = list.filter(i => (i.principal_initials || i.principal_name || '—') === principal);
    const effSigner = signer === 'all' && isPartner && bucket === 'review' && mineOnly ? profile?.initials : signer;
    if (effSigner && effSigner !== 'all') list = list.filter(i => i.signer_initials === effSigner);
    return [...list].sort((a, b) => (flagged(b) - flagged(a)) || (Number(b.total_due) - Number(a.total_due)));
  }, [buckets, bucket, principal, signer, mineOnly, isPartner, profile]);
  const grouped = useMemo(() => { const g = {}; rows.forEach(i => { const k = i.principal_name || i.principal_initials || '—'; (g[k] = g[k] || []).push(i); }); return Object.entries(g).sort((a, b) => a[0].localeCompare(b[0])); }, [rows]);

  const toggle = id => setSel(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const selectAll = () => setSel(new Set(rows.map(i => i.id)));
  const bulk = async (ids, status, label) => {
    if (!ids.length) return;
    if (!confirm(`${label} ${ids.length} invoice${ids.length === 1 ? '' : 's'}?`)) return;
    setBusy(label);
    try { const d = await post({ action: 'setStatusBulk', ids, status }); const failed = d.results.filter(r => !r.ok); flash(`${d.done} done${failed.length ? `, ${failed.length} skipped: ${failed[0].error}` : ''}`); load(); } catch (e) { flash(e.message); }
    setBusy('');
  };
  const generate = async () => { setBusy('gen'); try { const d = await post({ action: 'generateDrafts', period }); flash(`${d.created} draft${d.created === 1 ? '' : 's'} created`); load(); } catch (e) { flash(e.message); } setBusy(''); };
  const addOne = async num => { setBusy(num); try { await post({ action: 'createDraft', period, project_num: num }); load(); } catch (e) { flash(e.message); } setBusy(''); };
  const del = async ids => { if (!confirm(`Delete ${ids.length} draft${ids.length === 1 ? '' : 's'}?`)) return; setBusy('del'); try { for (const id of ids) await post({ action: 'deleteInvoice', id }); load(); } catch (e) { flash(e.message); } setBusy(''); };

  const selRows = rows.filter(i => sel.has(i.id));
  const myReviewClean = all.filter(i => i.status === 'review' && i.signer_initials === profile?.initials && !flagged(i));
  const myReviewAll = all.filter(i => i.status === 'review' && i.signer_initials === profile?.initials);

  // Status bucket: a flat stat button, active = ink border
  const Card = ({ id, label, list, red, amber, sub }) => {
    const on = bucket === id;
    return (
      <button type="button" onClick={() => { setBucket(id); setSel(new Set()); }} className={`flex-1 min-w-[120px] text-left bg-white border rounded px-4 py-3 ${on ? 'border-ink' : 'border-rule hover:border-muted'}`}>
        <div className="flex items-baseline justify-between gap-2"><span className={`font-flecha text-[26px] leading-none ${list.length && red ? 'text-status-red' : list.length && amber ? 'text-status-amber' : list.length ? 'text-ink' : 'text-done'}`}>{list.length}</span><span className="text-[11px] text-muted">{fmt$(sum(list)).replace('.00', '')}</span></div>
        <div className={`text-xs mt-1.5 ${on ? 'font-bold' : 'font-normal'}`}>{label}</div>
        {sub && <div className="text-[11px] text-muted mt-0.5 truncate">{sub}</div>}
      </button>
    );
  };
  const reviewByPartner = useMemo(() => { const m = {}; buckets.review.forEach(i => { m[i.signer_initials || '?'] = (m[i.signer_initials || '?'] || 0) + 1; }); return Object.entries(m).map(([k, n]) => `${k} ${n}`).join(' · '); }, [buckets.review]);

  const notProjected = candidates.filter(c => !(c.has_projection && c.projected_due > 0));

  return (
    <div className="space-y-4">
      {/* Summary + primary actions */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3 text-xs text-muted">
          <span>{buckets.all.length} invoices · {fmt$(sum(buckets.all))}{buckets.sent.length ? ` · ${fmt$(sum(buckets.sent))} sent` : ''}</span>
          {msg && <span className="text-status-red font-bold">{msg}</span>}
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {isPartner && myReviewAll.length > 0 && (
            <Button variant="secondary" onClick={() => bulk(myReviewClean.map(i => i.id), 'approved', 'Approve')} disabled={!!busy || !myReviewClean.length}>Approve all unflagged ({myReviewClean.length})</Button>
          )}
          {!isPartner && (
            <>
              <Button variant="secondary" onClick={() => bulk(buckets.draft.filter(cleanDraft).map(i => i.id), 'review', 'Send to review')} disabled={!!busy || !buckets.draft.filter(cleanDraft).length}>Send clean drafts to review ({buckets.draft.filter(cleanDraft).length})</Button>
              <Button variant="secondary" onClick={() => bulk(buckets.approved.map(i => i.id), 'sent', 'Mark sent')} disabled={!!busy || !buckets.approved.length}>Mark all approved as sent ({buckets.approved.length})</Button>
            </>
          )}
          <Button onClick={generate} disabled={!!busy}>{busy === 'gen' ? 'Working…' : 'Generate drafts'}</Button>
        </div>
      </div>

      {/* Pipeline buckets */}
      <div className="flex gap-2 flex-wrap">
        <Card id="notstarted" label="Not started" list={buckets.notstarted} sub="projected, no invoice yet" />
        <Card id="attention" label="Needs attention" list={buckets.attention} red sub="missing info or comments" />
        <Card id="draft" label="Draft" list={buckets.draft} />
        <Card id="review" label="In review" list={buckets.review} amber sub={reviewByPartner || 'waiting on partners'} />
        <Card id="returned" label="Returned" list={buckets.returned} red />
        <Card id="approved" label="Ready to send" list={buckets.approved} />
        <Card id="sent" label="Sent" list={buckets.sent} />
        <Card id="all" label="All" list={buckets.all} />
      </div>

      {/* Filters + selection bar */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2 text-xs">
          <Select value={principal} onChange={e => setPrincipal(e.target.value)} className="h-8"><option value="all">All principals</option>{principals.map(([k, n]) => <option key={k} value={k}>{n}</option>)}</Select>
          <Select value={signer} onChange={e => setSigner(e.target.value)} className="h-8"><option value="all">All signers</option>{Object.keys(signers).map(k => <option key={k} value={k}>{k === profile?.initials ? `${k} (me)` : k}</option>)}</Select>
          {isPartner && bucket === 'review' && signer === 'all' && <label className="flex items-center gap-1.5 text-muted"><input type="checkbox" checked={mineOnly} onChange={e => setMineOnly(e.target.checked)} /> only mine</label>}
          <span className="text-muted">{rows.length} shown</span>
        </div>
        {sel.size > 0 && bucket !== 'notstarted' && (
          <div className="flex items-center gap-3 text-xs bg-white border border-ink rounded px-3 py-1.5">
            <span className="font-bold">{sel.size} selected · {fmt$(sum(selRows))}</span>
            {isPartner && selRows.every(i => i.status === 'review') && <Link onClick={() => bulk([...sel], 'approved', 'Approve')}>Approve</Link>}
            {isPartner && selRows.every(i => i.status === 'review') && <button type="button" onClick={() => { const n = prompt('Return all selected with note:'); if (n == null) return; (async () => { setBusy('ret'); for (const id of sel) { try { await post({ action: 'setStatus', id, status: 'returned', note: n }); } catch {} } load(); setBusy(''); })(); }} className="text-[13px] font-bold text-status-red">Return</button>}
            {selRows.every(i => ['draft', 'returned'].includes(i.status)) && <Link onClick={() => bulk([...sel], 'review', 'Send to review')}>To review</Link>}
            {selRows.every(i => i.status === 'approved') && <Link onClick={() => bulk([...sel], 'sent', 'Mark sent')}>Mark sent</Link>}
            {selRows.every(i => ['draft', 'returned', 'review'].includes(i.status)) && <button type="button" onClick={() => del([...sel])} className="text-[13px] font-bold text-status-red">Delete</button>}
            <button type="button" onClick={() => setSel(new Set())} className="text-muted ml-1" aria-label="Clear selection">✕</button>
          </div>
        )}
      </div>

      {loading ? <Loading>Loading {monthLabel(period)}…</Loading> : bucket === 'notstarted' ? (
        <Panel>
          <div className="overflow-x-auto">
            <table className="of-table w-full border-collapse">
              <thead><tr><Th>Project</Th><Th>Client</Th><Th>PM</Th><Th right>Projected this month</Th><Th right>{buckets.notstarted.length > 0 && <button type="button" onClick={async () => { if (!confirm(`Create drafts for ${buckets.notstarted.length} projects?`)) return; setBusy('gen'); try { const d = await post({ action: 'generateDrafts', period, project_nums: buckets.notstarted.map(c => c.project_num) }); flash(`${d.created} created`); load(); } catch (e) { flash(e.message); } setBusy(''); }} disabled={!!busy} className="text-white font-bold hover:underline disabled:opacity-40">Create all ({buckets.notstarted.length})</button>}</Th></tr></thead>
              <tbody>
                {buckets.notstarted.map(c => (
                  <tr key={c.project_num} className="hover:bg-ground">
                    <td>{c.project_num} {c.project_name}{c.status === 'PR' && <Pill className="ml-2">PR</Pill>}</td>
                    <td className="text-muted">{c.client}</td>
                    <td className="text-muted">{c.pm}</td>
                    <td className="text-right text-status-amber font-bold">{fmt$(c.projected_due)}</td>
                    <td className="text-right"><Link onClick={() => addOne(c.project_num)}>Create draft</Link></td>
                  </tr>
                ))}
                {buckets.notstarted.length === 0 && <tr><td colSpan={5}><Empty>Every projected project has an invoice this month</Empty></td></tr>}
              </tbody>
            </table>
          </div>
          <div className="px-5 py-2.5 border-t border-hair text-xs text-muted"><button type="button" onClick={() => setShowCandidates(v => !v)} className="hover:text-ink">{showCandidates ? 'Hide' : 'Show'} open projects with no projection this month ({notProjected.length})</button></div>
          {showCandidates && <table className="w-full text-xs"><tbody>{notProjected.map(c => <tr key={c.project_num} className="border-t border-hair"><td className="px-5 py-1.5">{c.project_num} {c.project_name}</td><td className="px-3 py-1.5 text-muted">{c.client}</td><td className="px-3 py-1.5 text-muted">{c.pm}</td><td className="px-5 py-1.5 text-right"><Link onClick={() => addOne(c.project_num)} className="!text-xs">Create draft</Link></td></tr>)}</tbody></table>}
        </Panel>
      ) : (
        <Panel>
          <div className="overflow-x-auto">
            <table className="of-table w-full border-collapse">
              <thead><tr>
                <th style={{ width: 36 }}><input type="checkbox" checked={rows.length > 0 && sel.size === rows.length} onChange={e => e.target.checked ? selectAll() : setSel(new Set())} /></th>
                <Th>Invoice</Th><Th>Bill to</Th><Th w={60}>Signs</Th><Th right>Total due</Th><Th right w={80}>vs last</Th><Th>Flags</Th><Th>Status</Th><Th right></Th>
              </tr></thead>
              <tbody>
                {grouped.map(([pname, list]) => (
                  <React.Fragment key={pname}>
                    {principal === 'all' && <tr className="bg-ground"><td colSpan={9} className="!py-1.5 text-xs font-bold">{pname} <span className="font-normal text-muted">· {list.length} · {fmt$(sum(list))}</span></td></tr>}
                    {list.map(inv => (
                      <tr key={inv.id} className={`hover:bg-ground ${sel.has(inv.id) ? 'bg-accent-tint' : ''}`}>
                        <td><input type="checkbox" checked={sel.has(inv.id)} onChange={() => toggle(inv.id)} /></td>
                        <td className="cursor-pointer" onClick={() => onOpen(inv.id)}>
                          <div>{inv.project_num_display || inv.project_num} {inv.project_name}</div>
                          <div className="text-[11px] text-muted font-mono">{inv.invoice_number || 'no number yet'}</div>
                        </td>
                        <td className="text-muted">{inv.bill_to?.company || inv.client_name || <span className="text-status-red font-bold">missing</span>}</td>
                        <td className="font-bold">{inv.signer_initials}</td>
                        <td className="text-right font-bold">{fmt$(inv.total_due)}</td>
                        <td className="text-right text-xs text-muted">{delta(Number(inv.total_due), inv.last_month_total) || '—'}</td>
                        <td><div className="flex flex-wrap gap-1">{(inv.flags || []).map(f => <Flag key={f.code} f={f} />)}</div></td>
                        <td><Badge status={inv.status} /></td>
                        <td className="text-right whitespace-nowrap">
                          <span className="inline-flex items-center gap-3">
                            <Link onClick={() => onOpen(inv.id)}>{isPartner && inv.status === 'review' ? 'Mark up' : 'Open'}</Link>
                            <Link onClick={() => openPdf(inv.id)}>PDF</Link>
                            {isPartner && inv.status === 'review' && <Link onClick={() => bulk([inv.id], 'approved', 'Approve')}>Approve</Link>}
                            {!isPartner && ['draft', 'returned'].includes(inv.status) && <Link onClick={() => bulk([inv.id], 'review', 'Send to review')}>To review</Link>}
                            {!isPartner && inv.status === 'approved' && <Link onClick={() => bulk([inv.id], 'sent', 'Mark sent')}>Mark sent</Link>}
                            {['draft', 'returned', 'review'].includes(inv.status) && <button type="button" onClick={() => del([inv.id])} title="Delete this draft" className="text-[13px] font-bold text-status-red">Delete</button>}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </React.Fragment>
                ))}
                {rows.length === 0 && <tr><td colSpan={9}><Empty>{all.length === 0 ? 'No invoices yet — Generate drafts pulls every open project with a projected % for this month' : bucket === 'attention' ? 'Nothing needs attention' : bucket === 'review' && isPartner ? 'Nothing waiting on you' : 'Nothing here'}</Empty></td></tr>}
              </tbody>
            </table>
          </div>
        </Panel>
      )}
      <Note>{isPartner ? 'Flagged invoices sort to the top. Approve unflagged ones in bulk; open a flagged one to mark it up or edit. Approving assigns the invoice number.' : 'Work the Needs attention bucket first, then send clean drafts to review. Returned invoices carry the partner\'s comments. After sending, update Previously Billed in Master Data; Reconcile catches misses.'}</Note>
    </div>
  );
}

// ═══ INVOICE EDITOR ═══════════════════════════════════════════════
// Pick a billing address from the unified client record (Marketing's client + its billing_addresses)
function BillToPicker({ projectNum, clientName, onPick }) {
  const [open, setOpen] = useState(false);
  const [list, setList] = useState(null);
  const [q, setQ] = useState('');
  useEffect(() => { if (open && !list) getJSON('/api/billing?view=clients').then(d => setList(d.unified || [])).catch(() => setList([])); }, [open, list]);
  useEffect(() => { if (open) setQ(clientName || ''); }, [open, clientName]);
  const norm = x => String(x || '').toLowerCase();
  const hits = (list || []).filter(c => c.billing_addresses.length && (!q || norm(c.name).includes(norm(q)) || c.aliases.some(a => norm(a).includes(norm(q))))).slice(0, 12);
  return (
    <div className="mt-2">
      <button type="button" className="text-xs font-bold text-accent" onClick={() => setOpen(o => !o)}>{open ? 'Close' : 'Pick from client record'}</button>
      {open && (
        <div className="mt-2 border border-rule rounded bg-white">
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search clients…" className="w-full text-xs px-2 py-1.5 border-b border-hair outline-none" />
          <div className="max-h-56 overflow-y-auto">
            {!list ? <div className="text-xs text-muted p-2">Loading…</div> : hits.length === 0 ? <div className="text-xs text-muted p-2">No client with a billing address matches. Add one under Clients.</div> : hits.map(c => (
              <div key={c.id} className="border-b border-hair last:border-0">
                <div className="px-2 pt-1.5 text-xs font-bold">{c.name}</div>
                {c.billing_addresses.map(a => <button type="button" key={a.id} onClick={() => { onPick(c, a); setOpen(false); }} className="block w-full text-left px-2 py-1.5 text-xs hover:bg-accent-tint"><span className="font-bold">{a.label || a.company || 'Address'}</span>{a.is_default ? ' · default' : ''}<div className="text-muted">{[a.attn, a.company, a.address1, a.city_state_zip].filter(Boolean).join(' · ')}</div></button>)}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
const Eyebrow = ({ children, className = '' }) => <div className={'text-[11px] tracking-[0.08em] uppercase text-muted ' + className}>{children}</div>;
const Sub = ({ children, className = '', ...rest }) => <div className={'text-[11px] px-1.5 ' + className} {...rest}>{children}</div>;
const X = ({ onClick, title }) => <button type="button" onClick={onClick} title={title} className="text-done hover:text-status-red px-1" aria-label="Remove">×</button>;

function InvoiceEditor({ id, onBack, isPartner, profile }) {
  const [d, setD] = useState(null);
  const [msg, setMsg] = useState('');
  const [saveClient, setSaveClient] = useState(true);
  const [readOnly, setReadOnly] = useState(isPartner);   // partners mark up; Ellie edits
  const [commentFor, setCommentFor] = useState(null);     // { line_id, line_label } or 'general'
  const [commentText, setCommentText] = useState('');
  const [showResolved, setShowResolved] = useState(false);
  const load = useCallback(() => getJSON(`/api/billing?view=invoice&id=${id}`).then(setD).catch(e => setMsg(e.message)), [id]);
  useEffect(() => { load(); }, [load]);
  const flash = t => { setMsg(t); setTimeout(() => setMsg(''), 4000); };
  if (!d) return <Loading>Loading invoice…</Loading>;

  const inv = d.invoice; const lines = d.lines; const locked = ['approved', 'sent', 'void'].includes(inv.status); const sent = inv.status === 'sent';
  const editable = !locked && !readOnly;
  const comments = d.comments || [];
  const openComments = comments.filter(c => !c.resolved && c.kind === 'comment');
  const lineComments = lid => comments.filter(c => c.line_id === lid && c.kind === 'comment');
  const submitComment = async () => { if (!commentText.trim()) return; try { await post({ action: 'addComment', invoice_id: id, line_id: commentFor?.line_id || null, line_label: commentFor?.line_label || null, body: commentText }); setCommentText(''); setCommentFor(null); load(); } catch (e) { flash(e.message); } };
  const resolve = async (c, resolved) => { try { await post({ action: 'resolveComment', id: c.id, resolved }); load(); } catch (e) { flash(e.message); } };
  const setStatus = async (status, note) => { try { await post({ action: 'setStatus', id, status, note }); load(); } catch (e) { flash(e.message); } };
  const returnWithComments = async () => { const n = openComments.length ? `${openComments.length} revision${openComments.length === 1 ? '' : 's'} requested` : prompt('Return with note:'); if (n == null) return; await setStatus('returned', n); };
  const patchInv = async (patch, opts = {}) => { try { await post({ action: 'updateInvoice', id, patch, saveClient: saveClient && opts.client, saveSettings: opts.settings }); load(); } catch (e) { flash(e.message); } };
  const patchLine = async (lid, patch) => { try { await post({ action: 'updateLine', id: lid, patch }); load(); } catch (e) { flash(e.message); } };
  const addLine = async kind => { const description = kind === 'header' ? 'Section' : kind === 'hourly' ? 'Hourly Services' : kind === 'expense' ? 'Consultant' : kind === 'reimbursable' ? 'Expense' : 'Add Service'; try { await post({ action: 'addLine', invoice_id: id, line: { kind, description, contract_amount: kind === 'phase' ? 0 : null, pct: kind === 'phase' ? 0 : null, previous: 0, hourly_detail: kind === 'hourly' ? [] : null } }); load(); } catch (e) { flash(e.message); } };
  const removeLine = async l => { if (!confirm(`Remove "${l.description}"?`)) return; try { await post({ action: 'removeLine', id: l.id }); load(); } catch (e) { flash(e.message); } };
  const setRepeat = async (l, repeat) => { try { await post({ action: 'setRepeat', id: l.id, repeat }); load(); } catch (e) { flash(e.message); } };
  const regen = async () => { if (!confirm('Rebuild lines from Master Data and Projections? Lines you edited are kept.')) return; try { await post({ action: 'regenerate', id }); load(); } catch (e) { flash(e.message); } };
  const bt = inv.bill_to || {};
  const setBT = (k, v) => patchInv({ bill_to: { ...bt, [k]: v } }, { client: true });
  const refs = inv.reference_lines || [];
  const setRef = (i, k, v) => { const n = refs.map((r, j) => j === i ? { ...r, [k]: v } : r); patchInv({ reference_lines: n }, { settings: true }); };
  const hoursFor = l => { const k = l.source?.key || `${inv.project_name}||${l.phase || ''}`; return { m: d.hours?.month?.[k], t: d.hours?.toDate?.[k] }; };
  const feeLines = lines.filter(l => ['phase', 'hourly', 'consultant', 'consultant_section', 'header'].includes(l.kind));
  const consultants = d.consultants || []; const setup = d.consultantSetup || [];
  const mdLines = d.masterData.map(r => ({ key: `${String(r['Project Name'] || '').trim()}||${String(r['Phase'] || '').trim()}`, label: `${r['Project Name']}${r['Phase'] ? ` – ${r['Phase']}` : ''}` }));
  const saveConsultant = async c => { try { await post({ action: 'saveConsultant', consultant: { ...c, project_num: inv.project_num }, invoice_id: locked ? null : id }); load(); } catch (e) { flash(e.message); } };
  const addBill = async (consultant_id, amount, vendor_ref, note) => { try { await post({ action: 'addBill', consultant_id, invoice_id: id, period_month: inv.period_month, amount, vendor_ref, note }); load(); } catch (e) { flash(e.message); } };
  const removeBill = async bid => { try { await post({ action: 'removeBill', id: bid }); load(); } catch (e) { flash(e.message); } };
  const extraLines = lines.filter(l => ['expense', 'reimbursable'].includes(l.kind));
  const totals = { contract: 0, earned: 0, previous: 0, this: 0, remaining: 0 };
  feeLines.filter(l => l.kind !== 'header' && !l.tbd).forEach(l => { totals.contract += Number(l.contract_amount) || 0; totals.earned += Number(l.earned) || 0; totals.previous += Number(l.previous) || 0; totals.this += Number(l.this_invoice) || 0; totals.remaining += Number(l.remaining) || 0; });

  const kindSelect = l => <select value={l.kind} disabled={!editable} onChange={e => patchLine(l.id, { kind: e.target.value })} className="text-[11px] text-muted bg-transparent border-0 p-0 w-full">{KINDS.map(([k, n]) => <option key={k} value={k}>{n}</option>)}</select>;

  return (
    <div className="space-y-4">
      {/* Top bar */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3 flex-wrap">
          <Link onClick={onBack}>← {monthLabel(inv.period_month)}</Link>
          <Badge status={inv.status} />
          {inv.invoice_number && <span className="font-mono text-sm">#{inv.invoice_number}</span>}
          {inv.status === 'returned' && inv.review_note && <span className="text-xs text-status-red">Returned{inv.approved_by ? ` by ${inv.approved_by}` : ''}: “{inv.review_note}”</span>}
          {inv.status === 'approved' && <span className="text-xs text-muted">Approved by {inv.approved_by} · {fmtStamp(inv.approved_at)}</span>}
          {sent && <span className="text-xs text-muted">Sent {fmtStamp(inv.sent_at)}</span>}
          {msg && <span className="text-xs text-status-red font-bold">{msg}</span>}
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Button variant="secondary" className="h-8 px-3" onClick={() => openPdf(id)}>Preview PDF</Button>
          <Button variant="secondary" className="h-8 px-3" onClick={() => openPdf(id, true)}>Download</Button>
          {editable && <Button variant="secondary" className="h-8 px-3" onClick={regen}>Rebuild lines</Button>}
          {['draft', 'returned'].includes(inv.status) && <Button variant="secondary" className="h-8 px-3" onClick={() => setStatus('review')}>Send to review</Button>}
          {!locked && isPartner && <Button variant="secondary" className={'h-8 px-3 ' + (readOnly ? '' : 'bg-accent-tint')} onClick={() => setReadOnly(v => !v)}>{readOnly ? 'Edit numbers' : 'Editing — back to mark-up'}</Button>}
          {inv.status === 'review' && isPartner && <><Button className="h-8 px-3" onClick={() => { if (openComments.length && !confirm(`${openComments.length} open revision request(s). Approve anyway?`)) return; setStatus('approved'); }}>Approve</Button><Button variant="danger" className="h-8 px-3" onClick={returnWithComments}>Return to Ellie{openComments.length ? ` (${openComments.length})` : ''}</Button></>}
          {inv.status === 'review' && !isPartner && <Button variant="secondary" className="h-8 px-3" onClick={() => setStatus('draft')}>Pull back</Button>}
          {inv.status === 'approved' && <Button variant="secondary" className="h-8 px-3" onClick={() => { if (confirm(`Mark ${inv.invoice_number} as sent? This locks it.`)) setStatus('sent'); }}>Mark sent</Button>}
          {inv.status === 'approved' && isPartner && <Button variant="secondary" className="h-8 px-3" onClick={() => setStatus('draft')}>Reopen</Button>}
          {sent && isPartner && <Button variant="danger" className="h-8 px-3" onClick={() => { if (confirm('Void this sent invoice?')) setStatus('void'); }}>Void</Button>}
          {['draft', 'returned', 'review'].includes(inv.status) && <Button variant="danger" className="h-8 px-3" onClick={async () => { if (!confirm('Delete this draft? Consultant setup and bills for the project are kept.')) return; try { await post({ action: 'deleteInvoice', id }); onBack(); } catch (e) { flash(e.message); } }}>Delete draft</Button>}
        </div>
      </div>

      {/* Header block */}
      <div className="grid grid-cols-3 gap-4">
        <div className="bg-white border border-rule rounded p-4 col-span-1">
          <div className="flex items-center justify-between mb-2"><Eyebrow>Bill to</Eyebrow><label className="text-[11px] text-muted flex items-center gap-1"><input type="checkbox" checked={saveClient} onChange={e => setSaveClient(e.target.checked)} /> save to client</label></div>
          <div className="text-xs text-muted mb-1">Client: <Cell value={inv.client_name} disabled={!editable} onCommit={v => patchInv({ client_name: v }, { settings: true })} className="inline w-auto" /></div>
          {[['attn', 'Attention'], ['title', 'Title'], ['company', 'Company'], ['address1', 'Address'], ['address2', 'Address 2'], ['city_state_zip', 'City, State ZIP']].map(([k, ph]) => <Cell key={k} value={bt[k]} placeholder={ph} disabled={!editable} onCommit={v => setBT(k, v)} />)}
          {!bt.company && !bt.attn && <div className="text-xs text-status-amber mt-1">No bill-to on file for this client yet — pick one from the client record, or fill it in once and it&apos;s remembered.</div>}
          {editable && <BillToPicker projectNum={inv.project_num} clientName={inv.client_name} onPick={(c, a) => { patchInv({ bill_to: { attn: a.attn || '', title: a.title || '', company: a.company || c.name, address1: a.address1 || '', address2: a.address2 || '', city_state_zip: a.city_state_zip || '' } }, { client: true }); post({ action: 'setProjectClient', project_num: inv.project_num, clientId: c.id, addressId: a.id }).catch(() => {}); }} />}
        </div>
        <div className="bg-white border border-rule rounded p-4 col-span-1 text-sm">
          <Eyebrow className="mb-2">Project</Eyebrow>
          <div className="grid grid-cols-[120px_1fr] gap-y-1 items-center text-xs">
            <span className="text-muted">HDLA Project #</span><Cell value={inv.project_num_display} disabled={!editable} onCommit={v => patchInv({ project_num_display: v })} />
            <span className="text-muted">HDLA <select value={inv.principal_label} disabled={!editable} onChange={e => patchInv({ principal_label: e.target.value }, { settings: true })} className="bg-transparent border-0 text-xs text-muted p-0"><option>Principal</option><option>Project Manager</option></select></span><Cell value={inv.principal_name} disabled={!editable} onCommit={v => patchInv({ principal_name: v }, { settings: true })} />
            <span className="text-muted">Description</span><Cell value={inv.project_name} disabled={!editable} onCommit={v => patchInv({ project_name: v }, { settings: true })} />
            <span className="text-muted">Services through</span><Cell type="date" value={inv.services_through} disabled={!editable} onCommit={v => patchInv({ services_through: v })} />
            <span className="text-muted">Invoice date</span><Cell type="date" value={inv.invoice_date} disabled={!editable} onCommit={v => patchInv({ invoice_date: v })} />
            {refs.map((r, i) => <React.Fragment key={i}><Cell value={r.label} placeholder="P.O. #" disabled={!editable} onCommit={v => setRef(i, 'label', v)} className="text-muted" /><div className="flex items-center gap-1"><Cell value={r.value} disabled={!editable} onCommit={v => setRef(i, 'value', v)} />{editable && <X onClick={() => patchInv({ reference_lines: refs.filter((_, j) => j !== i) }, { settings: true })} />}</div></React.Fragment>)}
          </div>
          {editable && <Link className="!text-xs mt-2" onClick={() => patchInv({ reference_lines: [...refs, { label: 'P.O. #', value: '' }] }, { settings: true })}>+ reference line (PO, client project #)</Link>}
        </div>
        <div className="bg-white border border-rule rounded p-4 col-span-1 text-sm">
          <Eyebrow className="mb-2">Signer &amp; notes</Eyebrow>
          <div className="flex items-center gap-2 mb-2">
            <Select value={inv.signer_initials || ''} disabled={!editable} onChange={e => patchInv({ signer_initials: e.target.value }, { settings: true })} className="h-8 text-xs">{Object.entries(d.signers).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select>
          </div>
          <Cell value={inv.signer_text} disabled={!editable} onCommit={v => patchInv({ signer_text: v })} className="text-xs" />
          <Eyebrow className="mt-3 text-status-red">Internal note (never prints)</Eyebrow>
          <textarea defaultValue={inv.internal_note || ''} disabled={!editable} onBlur={e => { if (e.target.value !== (inv.internal_note || '')) patchInv({ internal_note: e.target.value }); }} rows={3} className="w-full mt-1 border border-rule rounded-[3px] px-2 py-1 text-xs bg-white resize-none focus:outline-none focus:border-ink" placeholder="Questions for the partner, reminders, what to confirm with the client..." />
        </div>
      </div>

      {/* Lines */}
      <Panel>
        <div className="overflow-x-auto">
          <table className="of-table w-full border-collapse">
            <thead><tr>
              <Th w={30}></Th><Th>Billing phase</Th><Th right w={110}>Contract</Th><Th right w={70}>% to date</Th><Th right w={110}>Earned</Th><Th right w={110}>Previous</Th><Th right w={110}>This invoice</Th><Th right w={110}>Balance</Th>
              <Th right w={130}>Hours (internal)</Th><Th w={60}></Th>
            </tr></thead>
            <tbody>
              {feeLines.map(l => {
                const h = hoursFor(l); const md = l.source?.key ? d.masterData.find(r => `${String(r['Project Name'] || '').trim()}||${String(r['Phase'] || '').trim()}` === l.source.key) : d.masterData.find(r => r['Phase'] === l.phase);
                const projected = l.source?.projected;
                const closed = l.source?.status && !['O', 'PR'].includes(l.source.status);
                const isCons = ['consultant', 'consultant_section'].includes(l.kind);
                const folded = !!l.source?.hdla;
                return (
                  <tr key={l.id} className={`${l.kind === 'header' ? 'bg-ground' : ''} ${l.overridden ? 'bg-accent-tint' : ''} ${closed ? 'opacity-60' : ''}`} title={l.overridden ? 'Edited line — survives Rebuild' : undefined}>
                    <td className="!px-2">{kindSelect(l)}</td>
                    <td className="!px-1"><Cell value={l.description} disabled={!editable} onCommit={v => patchLine(l.id, { description: v })} className={l.kind === 'header' ? 'font-bold' : ''} />{l.kind === 'phase' && !md && <Sub className="text-status-amber">not in Master Data</Sub>}{closed && <Sub className="text-muted">closed in Master Data</Sub>}{l.source?.name && <Sub className="text-done truncate" title="Master Data row">{l.source.name}{l.phase ? ` · ${l.phase}` : ''}</Sub>}{l.source?.belowBilled && <Sub className="text-status-amber">projection ({l.source.projected}%) is below what&apos;s been billed — held at billed, nothing this month</Sub>}{l.source?.mdPrev != null && Number(l.source.mdPrev) !== Number(l.source.prev) && <Sub className="text-status-amber">previous uses prior-month projection ({fmt$(l.source.prev)}); Master Data says {fmt$(l.source.mdPrev)}</Sub>}{folded && <Sub className="text-muted">HDLA {fmt$(l.source.hdla.contract)} @ {fmtPct(l.source.hdla.pct)} → {fmt$(l.source.hdla.this)} · consultants {fmt$((l.source.consultants || []).reduce((a, c) => a + (c.this_invoice || 0), 0))} this month</Sub>}{isCons && <Sub className="text-muted">consultant · {l.kind === 'consultant_section' ? 'prints in section' : 'prints in table'} · amounts from bills</Sub>}{l.kind === 'phase' && editable && <label className="text-[11px] text-muted px-1.5 flex items-center gap-1"><input type="checkbox" checked={!!l.tbd} onChange={e => patchLine(l.id, { tbd: e.target.checked })} className="scale-75" /> TBD</label>}{l.kind === 'header' && (editable || l.repeat_key) && <label className="text-[11px] text-muted px-1.5 flex items-center gap-1"><input type="checkbox" checked={!!l.repeat_key} disabled={!editable} onChange={e => setRepeat(l, e.target.checked)} className="scale-75" /> repeat monthly</label>}</td>
                    {l.kind === 'header' ? <td colSpan={6} /> : l.tbd ? <><td className="text-right text-xs text-muted">TBD</td><td colSpan={5} /></> : (
                      <>
                        <td className="!px-1">{l.kind === 'hourly' ? <span className="block text-right text-xs text-muted pr-2">HOURLY</span> : (isCons || folded) ? <div className="text-right text-[13px] pr-1.5">{fmt$(l.contract_amount)}</div> : <Cell type="number" format="money" right value={l.contract_amount} disabled={!editable} onCommit={v => patchLine(l.id, { contract_amount: v })} />}</td>
                        <td className="!px-1">{l.kind === 'hourly' ? '' : isCons ? <div className="text-right text-xs text-muted pr-1.5">{fmtPct(l.pct)}</div> : folded ? <div><Cell type="number" format="pct" right value={l.source.hdla.pct} disabled={!editable} onCommit={v => patchLine(l.id, { pct: v })} /><Sub className="text-muted text-right">HDLA % · prints {fmtPct(l.pct)}</Sub>{projected != null && Number(projected) !== Number(l.source.hdla.pct) && <Sub className="text-status-amber text-right">proj {projected}%</Sub>}</div> : <div><Cell type="number" format="pct" right value={l.pct} disabled={!editable} onCommit={v => patchLine(l.id, { pct: v })} />{projected != null && Number(projected) !== Number(l.pct) && <Sub className="text-status-amber text-right">proj {projected}%</Sub>}{projected == null && l.kind === 'phase' && <Sub className="text-done text-right">no projection</Sub>}</div>}</td>
                        <td className="text-right text-muted">{fmt$(l.earned)}</td>
                        <td className="!px-1">{(isCons || folded) ? <div className="text-right text-[13px] pr-1.5">{fmt$(l.previous)}</div> : <Cell type="number" format="money" right value={l.previous} disabled={!editable} onCommit={v => patchLine(l.id, { previous: v })} />}</td>
                        <td className="!px-1">{isCons ? <div className="text-right text-[13px] font-bold pr-1.5">{fmt$(l.this_invoice)}</div> : <Cell type="number" format="money" right value={l.this_invoice} disabled={!editable} onCommit={v => patchLine(l.id, { this_invoice: v })} className="font-bold" />}</td>
                        <td className="text-right text-muted">{l.kind === 'hourly' ? '' : fmt$(l.remaining)}</td>
                      </>
                    )}
                    <td className="text-right text-[11px] text-muted whitespace-nowrap">{l.kind !== 'header' && (h.t ? <>{fmtH(h.m?.hours)} / {fmtH(h.t.hours)} hrs<div className="text-[10px] text-done">{fmt$(h.t.value)} value{l.contract_amount ? ` · ${Math.round(h.t.value / Number(l.contract_amount) * 100)}% of fee` : ''}</div></> : <span className="text-done">—</span>)}</td>
                    <td className="!px-1 text-right whitespace-nowrap">
                      {l.kind !== 'header' && <button type="button" onClick={() => { setCommentFor({ line_id: l.id, line_label: l.description }); setCommentText(''); }} title="Request a revision on this line" className={`text-xs mr-1 ${lineComments(l.id).some(c => !c.resolved) ? 'text-accent font-bold' : 'text-done hover:text-accent'}`}>✎{lineComments(l.id).filter(c => !c.resolved).length || ''}</button>}
                      {editable && <X onClick={() => removeLine(l)} />}
                    </td>
                  </tr>
                );
              })}
              <tr className="of-total">
                <td /><td className="text-xs text-muted">{extraLines.length ? 'SUB-TOTAL FEE' : ''}</td>
                <td className="text-right">{fmt$(totals.contract)}</td><td /><td className="text-right">{fmt$(totals.earned)}</td><td className="text-right">{fmt$(totals.previous)}</td><td className="text-right">{fmt$(totals.this)}</td><td className="text-right">{fmt$(totals.remaining)}</td><td /><td />
              </tr>
            </tbody>
          </table>
        </div>

        {/* Hourly detail */}
        {feeLines.filter(l => l.kind === 'hourly').map(l => (
          <div key={l.id} className="border-t border-rule px-5 py-3 bg-ground">
            <Eyebrow className="mb-1">Hourly breakdown · {l.description} <span className="normal-case tracking-normal text-done">(prints on the invoice; pulled from time entries this month at the fee-chart rate)</span></Eyebrow>
            <table className="text-xs w-[480px]">
              <tbody>
                {(l.hourly_detail || []).map((r, i) => (
                  <tr key={i}><td className="py-0.5 w-56"><Cell value={r.name} disabled={!editable} onCommit={v => patchLine(l.id, { hourly_detail: l.hourly_detail.map((x, j) => j === i ? { ...x, name: v } : x) })} /></td>
                    <td className="py-0.5 w-20"><Cell type="number" right value={r.hours} disabled={!editable} onCommit={v => patchLine(l.id, { hourly_detail: l.hourly_detail.map((x, j) => j === i ? { ...x, hours: v } : x) })} /></td>
                    <td className="py-0.5 w-24"><Cell type="number" format="money" right value={r.rate} disabled={!editable} onCommit={v => patchLine(l.id, { hourly_detail: l.hourly_detail.map((x, j) => j === i ? { ...x, rate: v } : x) })} /></td>
                    <td className="py-0.5 w-24 text-right text-muted">{fmt$((Number(r.hours) || 0) * (Number(r.rate) || 0))}</td>
                    <td className="py-0.5 w-6 text-right">{editable && <X onClick={() => patchLine(l.id, { hourly_detail: l.hourly_detail.filter((_, j) => j !== i) })} />}</td></tr>
                ))}
              </tbody>
            </table>
            {editable && <Link className="!text-xs mt-1" onClick={() => patchLine(l.id, { hourly_detail: [...(l.hourly_detail || []), { name: '', hours: 0, rate: 0 }] })}>+ person</Link>}
          </div>
        ))}

        {/* Consultants: setup once per project, bills entered monthly */}
        <ConsultantsPanel setup={setup} consultants={consultants} mdLines={mdLines} editable={editable} period={inv.period_month} onSave={saveConsultant} onAddBill={addBill} onRemoveBill={removeBill} />

        {/* Expenses / reimbursables */}
        {extraLines.length > 0 && (
          <div className="border-t border-rule overflow-x-auto">
            <table className="of-table w-full border-collapse">
              <thead><tr><Th w={30}></Th><Th>Expense / reimbursable</Th><Th right w={80}>Qty</Th><Th w={80}>Unit</Th><Th right w={100}>Rate</Th><Th right w={110}>Amount</Th><Th w={30}></Th></tr></thead>
              <tbody>
                {extraLines.map(l => (
                  <tr key={l.id}>
                    <td className="!px-2">{kindSelect(l)}</td>
                    <td className="!px-1"><Cell value={l.description} disabled={!editable} onCommit={v => patchLine(l.id, { description: v })} />{(editable || l.repeat_key) && <label className="text-[11px] text-muted px-1.5 flex items-center gap-1"><input type="checkbox" checked={!!l.repeat_key} disabled={!editable} onChange={e => setRepeat(l, e.target.checked)} className="scale-75" /> repeat monthly</label>}</td>
                    <td className="!px-1"><Cell type="number" right value={l.qty} disabled={!editable} onCommit={v => patchLine(l.id, { qty: v })} /></td>
                    <td className="!px-1"><Cell value={l.unit} disabled={!editable} onCommit={v => patchLine(l.id, { unit: v })} /></td>
                    <td className="!px-1"><Cell type="number" format="money" right value={l.rate} disabled={!editable} onCommit={v => patchLine(l.id, { rate: v })} /></td>
                    <td className="!px-1"><Cell type="number" format="money" right value={l.this_invoice} disabled={!editable} onCommit={v => patchLine(l.id, { this_invoice: v })} className="font-bold" /></td>
                    <td className="!px-1 text-right">{editable && <X onClick={() => removeLine(l)} />}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="flex items-center justify-between gap-4 flex-wrap px-5 py-3 border-t border-ink bg-ground">
          <div className="flex items-center gap-3 text-xs flex-wrap">
            {editable && <>
              <span className="text-muted">Add:</span>
              {KINDS.map(([k, n]) => <Link key={k} className="!text-xs" onClick={() => addLine(k)}>{n}</Link>)}
            </>}
          </div>
          <div className="text-sm"><span className="text-muted mr-3 text-[11px] tracking-[0.08em] uppercase">Total due this invoice</span><span className="font-flecha text-xl">{fmt$(inv.total_due)}</span></div>
        </div>
      </Panel>
      {(() => { const hidden = Object.entries(d.settings?.line_overrides || {}).filter(([, o]) => o.hidden).map(([ph]) => ph); return hidden.length > 0 && (
        <div className="text-xs text-muted px-1">Hidden on this project: {hidden.map(ph => <span key={ph} className="inline-flex items-center gap-1 mr-3">{ph.replace('||', ' · ').replace(/ · $/, '')}{editable && <Link className="!text-xs" onClick={async () => { try { await post({ action: 'restorePhase', invoice_id: id, phase: ph }); await post({ action: 'regenerate', id }); load(); } catch (e) { flash(e.message); } }}>restore</Link>}</span>)}</div>
      ); })()}
      {(() => { const s = d.settings || {}; const nOv = Object.keys(s.line_overrides || {}).length; const nRep = (s.recurring_lines || []).length; const hasName = !!s.project_name; return (nOv + nRep > 0 || hasName) && (
        <div className="text-xs text-muted px-1 flex items-center gap-3">
          <span>Saved for this project:{hasName ? ' header name' : ''}{nOv ? `${hasName ? ' ·' : ''} ${nOv} line edit${nOv === 1 ? '' : 's'}` : ''}{nRep ? `${hasName || nOv ? ' ·' : ''} ${nRep} repeating line${nRep === 1 ? '' : 's'}` : ''}</span>
          {editable && <Link className="!text-xs" onClick={async () => { if (!confirm('Clear everything saved for this project: header name, line wording, hidden lines and repeating lines? Bill-to, signer and PO lines are kept. This invoice stays as it is until you rebuild its lines.')) return; try { await post({ action: 'resetProject', project_num: inv.project_num }); flash('Saved edits cleared. Use Rebuild lines to refresh this invoice.'); load(); } catch (e) { flash(e.message); } }}>Reset to Master Data</Link>}
        </div>
      ); })()}

      {/* Revisions & comments */}
      <Panel title="Revisions & comments" meta={openComments.length > 0 ? <span className="text-accent font-bold">{openComments.length} open</span> : null} action={<>
        <label className="text-[11px] text-muted flex items-center gap-1"><input type="checkbox" checked={showResolved} onChange={e => setShowResolved(e.target.checked)} /> show resolved &amp; history</label>
        <Link className="!text-xs" onClick={() => { setCommentFor('general'); setCommentText(''); }}>+ comment</Link>
      </>}>
        {commentFor && (
          <div className="px-5 py-3 bg-ground border-b border-rule">
            <div className="text-xs mb-1">{commentFor === 'general' ? 'Comment on this invoice' : <>Revision on <span className="font-bold">{commentFor.line_label}</span></>}</div>
            <div className="flex items-start gap-2">
              <textarea autoFocus value={commentText} onChange={e => setCommentText(e.target.value)} rows={2} onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submitComment(); if (e.key === 'Escape') setCommentFor(null); }} placeholder={commentFor === 'general' ? 'e.g. Hold this one until the client signs the amendment' : 'e.g. CA should be 65%, not 70 — we have not done the site walk yet'} className="flex-1 border border-rule rounded-[3px] px-3 py-2 text-[13px] bg-white resize-none focus:outline-none focus:border-ink" />
              <div className="flex flex-col gap-1"><Button variant="secondary" className="h-8 px-3" onClick={submitComment}>Add</Button><button type="button" onClick={() => setCommentFor(null)} className="text-xs text-muted">Cancel</button></div>
            </div>
          </div>
        )}
        <div className="divide-y divide-hair">
          {comments.filter(c => showResolved || (!c.resolved && c.kind === 'comment')).map(c => (
            <div key={c.id} className={`px-5 py-2.5 flex items-start gap-3 ${c.kind === 'status' ? 'bg-ground' : c.resolved ? 'opacity-50' : ''}`}>
              <div className="w-8 h-8 rounded-full bg-hair flex items-center justify-center text-[10px] font-bold flex-shrink-0">{c.author_initials}</div>
              <div className="flex-1 min-w-0">
                <div className="text-xs text-muted">{c.author_initials} · {fmtStamp(c.created_at)}{c.line_label && <span className="ml-2 text-accent">on {c.line_label}</span>}{c.resolved && c.kind === 'comment' && <span className="ml-2">resolved by {c.resolved_by}</span>}</div>
                <div className={`text-sm ${c.kind === 'status' ? 'text-muted italic' : ''} ${c.resolved && c.kind === 'comment' ? 'line-through text-done' : ''}`}>{c.body}</div>
              </div>
              {c.kind === 'comment' && (c.resolved
                ? <button type="button" onClick={() => resolve(c, false)} className="text-xs text-muted hover:text-ink">reopen</button>
                : <Button variant="secondary" className="h-7 px-2.5 text-xs" onClick={() => resolve(c, true)}>Resolve</Button>)}
            </div>
          ))}
          {comments.filter(c => showResolved || (!c.resolved && c.kind === 'comment')).length === 0 && <Empty>No open revisions. Partners: click ✎ on any line to request a change without editing it.</Empty>}
        </div>
      </Panel>
      <Note>{readOnly ? 'Mark-up mode: numbers are locked; use ✎ on a line or + comment to request changes, then Return to Ellie. Switch to Edit numbers if you need to change something yourself.' : 'Edit any number directly. Changing % recomputes earned, this invoice, and balance; changing this invoice recomputes %. Edited lines are tinted and survive Rebuild. Renaming or removing a Master Data phase is remembered for this project and applies to next month\'s draft.'} The Hours (internal) column never prints. Approving assigns the invoice number.</Note>
    </div>
  );
}

// ═══ CONSULTANTS PANEL ═══════════════════════════════════════════
function ConsultantsPanel({ setup, consultants, mdLines, editable, period, onSave, onAddBill, onRemoveBill }) {
  const [open, setOpen] = useState(setup.length > 0);
  const [form, setForm] = useState(null);   // { id?, name, contract_amount, mode, phase_key }
  const [bill, setBill] = useState({});      // consultant_id -> { amount, vendor_ref, note }
  const byId = {}; consultants.forEach(c => { byId[c.id] = c; });
  const startNew = () => setForm({ name: '', contract_amount: '', mode: 'fold', phase_key: mdLines[0]?.key || '' });
  const submit = async () => { if (!form.name.trim()) return; await onSave({ ...form, contract_amount: Number(form.contract_amount) || 0, phase_key: form.mode === 'section' ? (form.phase_key || null) : form.phase_key }); setForm(null); };
  const inp = 'h-8 border border-rule rounded-[3px] px-2 text-xs bg-white w-full';
  return (
    <div className="border-t border-rule bg-ground">
      <div className="flex items-center justify-between px-5 py-2">
        <button type="button" onClick={() => setOpen(v => !v)} className="text-[11px] font-bold tracking-[0.08em] uppercase text-ink">{open ? '▾' : '▸'} Consultants on this project {setup.length ? `· ${setup.filter(c => c.active).length}` : ''}</button>
        {editable && !form && <Link className="!text-xs" onClick={startNew}>+ add consultant</Link>}
      </div>
      {open && (
        <div className="px-5 pb-3 space-y-3">
          {form && (
            <div className="bg-white border border-ink rounded p-3 grid grid-cols-[1fr_140px_200px_1fr_auto] gap-2 items-end text-xs">
              <div><Eyebrow className="mb-0.5">Consultant</Eyebrow><input autoFocus value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="Featherstone Estimating" className={inp} /></div>
              <div><Eyebrow className="mb-0.5">Contract $</Eyebrow><input type="number" value={form.contract_amount} onChange={e => setForm({ ...form, contract_amount: e.target.value })} className={inp + ' text-right'} /></div>
              <div><Eyebrow className="mb-0.5">Prints as</Eyebrow><select value={form.mode} onChange={e => setForm({ ...form, mode: e.target.value })} className={inp}>{Object.entries(MODE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
              <div><Eyebrow className="mb-0.5">{form.mode === 'fold' ? 'Fold into phase' : 'Place after phase (optional)'}</Eyebrow><select value={form.phase_key || ''} onChange={e => setForm({ ...form, phase_key: e.target.value })} className={inp}><option value="">—</option>{mdLines.map(m => <option key={m.key} value={m.key}>{m.label}</option>)}</select></div>
              <div className="flex gap-2 items-center"><Button variant="secondary" className="h-8 px-3" onClick={submit}>{form.id ? 'Save' : 'Add'}</Button><button type="button" onClick={() => setForm(null)} className="text-xs text-muted">Cancel</button></div>
            </div>
          )}
          {setup.filter(c => c.active).map(c => {
            const live = byId[c.id] || { prev: 0, this_invoice: 0, bills: [] };
            const b = bill[c.id] || { amount: '', vendor_ref: '', note: '' };
            const phaseLabel = mdLines.find(m => m.key === c.phase_key)?.label;
            const addBill = () => { if (Number(b.amount) > 0) { onAddBill(c.id, Number(b.amount), b.vendor_ref, b.note); setBill({ ...bill, [c.id]: { amount: '', vendor_ref: '', note: '' } }); } };
            return (
              <div key={c.id} className="bg-white border border-rule rounded p-3">
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <div className="text-sm">{c.name} <span className="text-xs text-muted ml-2">{fmt$(c.contract_amount)} · {MODE_LABEL[c.mode]}{phaseLabel ? ` · ${phaseLabel}` : ''}</span></div>
                  <div className="text-xs text-muted">billed to date {fmt$(live.prev)} · this month <span className="font-bold text-ink">{fmt$(live.this_invoice)}</span> · remaining {fmt$((Number(c.contract_amount) || 0) - live.prev - live.this_invoice)}
                    {editable && <Link className="!text-xs ml-3" onClick={() => setForm({ id: c.id, name: c.name, contract_amount: c.contract_amount, mode: c.mode, phase_key: c.phase_key || '' })}>edit</Link>}
                    {editable && <button type="button" onClick={() => { if (confirm(`Retire ${c.name} from this project? Past bills are kept.`)) onSave({ ...c, active: false }); }} className="ml-2 text-done hover:text-status-red">retire</button>}
                  </div>
                </div>
                <div className="mt-2 flex flex-wrap gap-2 items-center text-xs">
                  {live.bills.map(x => <span key={x.id} className="inline-flex items-center gap-1 border border-rule rounded-[2px] px-2 py-0.5">{fmt$(x.amount)}{x.vendor_ref ? ` · #${x.vendor_ref}` : ''}{x.note ? ` · ${x.note}` : ''}{editable && <X onClick={() => onRemoveBill(x.id)} />}</span>)}
                  {live.bills.length === 0 && <span className="text-done italic">no bills entered for {monthLabel(period)}</span>}
                  {editable && (
                    <span className="inline-flex items-center gap-1 ml-auto">
                      <input type="number" placeholder="amount" value={b.amount} onChange={e => setBill({ ...bill, [c.id]: { ...b, amount: e.target.value } })} onKeyDown={e => { if (e.key === 'Enter') addBill(); }} className={inp + ' !w-24 text-right'} />
                      <input placeholder="their inv #" value={b.vendor_ref} onChange={e => setBill({ ...bill, [c.id]: { ...b, vendor_ref: e.target.value } })} className={inp + ' !w-24'} />
                      <input placeholder="note" value={b.note} onChange={e => setBill({ ...bill, [c.id]: { ...b, note: e.target.value } })} className={inp + ' !w-32'} />
                      <Button variant="secondary" className="h-8 px-3" onClick={addBill}>Add bill</Button>
                    </span>
                  )}
                </div>
              </div>
            );
          })}
          {setup.filter(c => c.active).length === 0 && !form && <div className="text-xs text-muted italic">None yet. Set a consultant up once — contract amount and how it prints — and it comes back every month. Enter their bills here as they arrive; previous billed carries from sent invoices.{!editable && ' Switch to Edit numbers to add one.'}</div>}
        </div>
      )}
    </div>
  );
}

// ═══ RECONCILE ════════════════════════════════════════════════════
function ReconcileView() {
  const [rows, setRows] = useState(null);
  useEffect(() => { getJSON('/api/billing?view=reconcile').then(d => setRows(d.rows || [])).catch(() => setRows([])); }, []);
  if (!rows) return <Loading>Comparing…</Loading>;
  const gaps = rows.filter(r => Math.abs(r.md_prev_billed - r.hub_billed) > 0.01);
  const sorted = [...rows].sort((a, b) => Math.abs(b.md_prev_billed - b.hub_billed) - Math.abs(a.md_prev_billed - a.hub_billed));
  return (
    <div className="space-y-3">
      <Panel title="Reconcile" meta={<span>Hub sent invoices vs Master Data Previously Billed · {rows.length} phases · <span className={gaps.length ? 'text-status-amber font-bold' : ''}>{gaps.length} differ</span></span>}>
        <div className="overflow-x-auto">
          <table className="of-table w-full border-collapse">
            <thead><tr><Th>Project / phase</Th><Th right>Fee</Th><Th right>Sent via Hub</Th><Th right>Master Data prev. billed</Th><Th right>Difference</Th><Th>Invoices</Th></tr></thead>
            <tbody>
              {sorted.map(r => { const diff = r.md_prev_billed - r.hub_billed; const off = Math.abs(diff) > 0.01; return (
                <tr key={`${r.project_num}||${r.phase}`}>
                  <td><div>{r.project_num} {r.project_name}</div><div className="text-xs text-muted">{r.phase}</div></td>
                  <td className="text-right text-xs text-muted">{fmt$(r.fee)}</td>
                  <td className="text-right">{fmt$(r.hub_billed)}</td>
                  <td className="text-right">{fmt$(r.md_prev_billed)}</td>
                  <td className={`text-right font-bold ${off ? 'text-status-amber' : 'text-done'}`}>{off ? fmt$(diff) : '✓'}</td>
                  <td className="text-xs text-muted font-mono">{r.invoices.join(', ')}</td>
                </tr>
              ); })}
              {rows.length === 0 && <tr><td colSpan={6}><Empty>Nothing sent through the Hub yet</Empty></td></tr>}
            </tbody>
          </table>
        </div>
      </Panel>
      <Note>Master Data Previously Billed should include everything sent through the Hub plus whatever was billed before the Hub. A difference isn&apos;t necessarily wrong for phases with pre-Hub history; it should be stable month to month once you&apos;re caught up.</Note>
    </div>
  );
}

// ═══ CLIENTS ══════════════════════════════════════════════════════
// One client record (Marketing's) carries the billing addresses; the legacy address book stays until merged.
function ClientsView() {
  const [data, setData] = useState(null);
  const [q, setQ] = useState('');
  const [merge, setMerge] = useState(null);
  const [editing, setEditing] = useState(null); // { clientId, address }
  const load = useCallback(() => getJSON('/api/billing?view=clients').then(d => setData({ clients: d.clients || [], unified: d.unified || [] })).catch(() => setData({ clients: [], unified: [] })), []);
  useEffect(() => { load(); }, [load]);
  const save = async (c, k, v) => { try { await post({ action: 'saveClient', client: { ...c, [k]: v } }); load(); } catch (e) { alert(e.message); } };
  const runMerge = async () => { try { const r = await post({ action: 'mergeClients' }); setMerge(r); load(); } catch (e) { alert(e.message); } };
  const saveAddress = async () => { try { await post({ action: 'saveBillingAddress', clientId: editing.clientId, address: editing.address }); setEditing(null); load(); } catch (e) { alert(e.message); } };
  if (!data) return <Loading>Loading clients…</Loading>;
  const { clients, unified } = data;
  const withAddr = unified.filter(c => c.billing_addresses.length);
  const shownU = unified.filter(c => !q || `${c.name} ${c.aliases.join(' ')} ${c.billing_addresses.map(a => a.attn + ' ' + a.company).join(' ')}`.toLowerCase().includes(q.toLowerCase())).filter(c => q || c.billing_addresses.length);
  const shownL = clients.filter(c => !q || `${c.name} ${c.company} ${c.attn}`.toLowerCase().includes(q.toLowerCase()));
  const unmerged = clients.filter(c => !c.matched_client_id || !unified.find(u => u.id === c.matched_client_id)?.billing_addresses.length);
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 flex-wrap"><Input value={q} onChange={e => setQ(e.target.value)} placeholder="Search clients…" className="w-72" /><span className="text-xs text-muted">{withAddr.length} clients with billing addresses · {unmerged.length} legacy bill-tos not yet on a client record</span>{unmerged.length > 0 && <Button variant="secondary" className="h-8 px-3" onClick={runMerge}>Merge legacy bill-tos into client records</Button>}</div>
      {merge && <div className="text-xs bg-ground border border-rule rounded px-3 py-2">Merged {merge.matched?.length || 0} by name.{merge.unmatched?.length ? ` Not matched (no client with that name in Marketing — add an alias or create the client there, then merge again): ${merge.unmatched.join(', ')}` : ''}</div>}
      <Panel title="Clients · billing addresses" meta={<span>Marketing client record · pick these on an invoice</span>}>
        {shownU.length === 0 ? <Empty>{q ? 'No clients match.' : 'No billing addresses on client records yet. Merge the legacy bill-tos, or add an address on a client.'}</Empty> : (
          <div className="flex flex-col">
            {shownU.map(c => (
              <div key={c.id} className="px-5 py-3 border-b border-hair last:border-0">
                <div className="flex items-center justify-between gap-3"><div className="font-bold text-sm">{c.name} <span className="text-xs text-muted font-normal">{c.office ? '· ' + c.office : ''}{c.aliases.length ? ' · also "' + c.aliases.join('", "') + '"' : ''}</span></div><button type="button" className="text-xs font-bold text-accent" onClick={() => setEditing({ clientId: c.id, address: { label: '', attn: '', title: '', company: c.name, address1: '', address2: '', city_state_zip: '', email: '', is_default: !c.billing_addresses.length } })}>+ Address</button></div>
                {c.billing_addresses.map(a => (
                  <div key={a.id} className="grid grid-cols-[minmax(0,1fr)_auto] gap-3 items-start text-xs mt-1.5 pl-3 border-l-2 border-hair">
                    <div><span className="font-bold">{a.label || a.company || 'Address'}</span>{a.is_default && <Pill kind="outline" className="ml-2">default</Pill>}<div className="text-muted">{[a.attn && (a.attn + (a.title ? ', ' + a.title : '')), a.company, a.address1, a.address2, a.city_state_zip, a.email].filter(Boolean).join(' · ')}</div></div>
                    <div className="flex gap-3"><button type="button" className="text-accent font-bold" onClick={() => setEditing({ clientId: c.id, address: { ...a } })}>Edit</button><button type="button" className="text-muted hover:text-status-red" onClick={async () => { if (!confirm('Remove this address?')) return; await post({ action: 'removeBillingAddress', clientId: c.id, addressId: a.id }); load(); }}>Remove</button></div>
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}
      </Panel>
      <Panel title="Legacy bill-to address book" meta={<span>{clients.length} saved from invoices · edits save on blur · goes away once merged</span>}>
        <div className="overflow-x-auto">
          <table className="of-table w-full border-collapse">
            <thead><tr><Th>Client (Master Data)</Th><Th>On record</Th><Th>Attention</Th><Th>Title</Th><Th>Company</Th><Th>Address</Th><Th>Address 2</Th><Th>City, State ZIP</Th><Th>Email</Th></tr></thead>
            <tbody>
              {shownL.map(c => (
                <tr key={c.id}>
                  <td className="text-xs">{c.name}</td>
                  <td className="text-xs">{c.matched_client_id ? <Pill kind="outline">matched</Pill> : <span className="text-status-amber font-bold">no client</span>}</td>
                  {['attn', 'title', 'company', 'address1', 'address2', 'city_state_zip', 'email'].map(k => <td key={k} className="!px-1"><Cell value={c[k]} onCommit={v => save(c, k, v)} className="text-xs" /></td>)}
                </tr>
              ))}
              {shownL.length === 0 && <tr><td colSpan={9}><Empty>Clients appear here the first time a bill-to is saved on an invoice</Empty></td></tr>}
            </tbody>
          </table>
        </div>
      </Panel>
      {editing && (
        <Modal title="Billing address" onClose={() => setEditing(null)}>
          <div className="grid grid-cols-2 gap-3 text-sm">
            {[['label', 'Label (e.g. Accounts Payable)'], ['attn', 'Attention'], ['title', 'Title'], ['company', 'Company'], ['address1', 'Address'], ['address2', 'Address 2'], ['city_state_zip', 'City, State ZIP'], ['email', 'Email']].map(([k, ph]) => <div key={k} className={k === 'address1' || k === 'label' ? 'col-span-2' : ''}><Label>{ph}</Label><Input value={editing.address[k] || ''} onChange={e => setEditing(ed => ({ ...ed, address: { ...ed.address, [k]: e.target.value } }))} className="w-full" /></div>)}
            <label className="col-span-2 flex items-center gap-2 text-xs"><input type="checkbox" checked={!!editing.address.is_default} onChange={e => setEditing(ed => ({ ...ed, address: { ...ed.address, is_default: e.target.checked } }))} /> Default address for this client</label>
          </div>
          <Button onClick={saveAddress}>Save address</Button>
        </Modal>
      )}
    </div>
  );
}

// ═══ PAGE ═════════════════════════════════════════════════════════
class BillingErrorBoundary extends React.Component {
  constructor(props) { super(props); this.state = { hasError: false, error: null }; }
  static getDerivedStateFromError(error) { return { hasError: true, error }; }
  render() {
    if (this.state.hasError) return (
      <Panel title="Billing error" pad>
        <pre className="text-xs text-status-red bg-ground rounded p-3 mb-4 text-left overflow-auto max-h-40">{this.state.error?.message || 'Unknown error'}</pre>
        <Button variant="secondary" onClick={() => { this.setState({ hasError: false, error: null }); window.location.reload(); }}>Reload page</Button>
      </Panel>
    );
    return this.props.children;
  }
}

const VIEWS = [{ id: 'month', label: 'Month' }, { id: 'reconcile', label: 'Reconcile' }, { id: 'clients', label: 'Clients' }];

export default function BillingPage() {
  const { profile } = useAuth();
  const isPartner = profile?.role === 'partner';
  const [view, setView] = useState(() => qp('view', 'month'));
  const [period, setPeriod] = useState(prevPeriod());
  const [openId, setOpenId] = useState(() => qp('invoice', null));

  // Month navigation lives in the page header; only meaningful on the Month view.
  const monthNav = view === 'month' && !openId && (
    <div className="inline-flex items-center border border-ink rounded-[3px] overflow-hidden bg-white h-10">
      <button type="button" onClick={() => setPeriod(shiftPeriod(period, -1))} className="px-3 h-full text-sm hover:bg-ground" aria-label="Previous month">←</button>
      <button type="button" onClick={() => setPeriod(prevPeriod())} title="Back to last month" className={`px-3 h-full text-[13px] border-x border-ink ${period === prevPeriod() ? 'font-bold' : 'font-normal'}`}>{monthLabel(period)}</button>
      <button type="button" onClick={() => setPeriod(shiftPeriod(period, 1))} className="px-3 h-full text-sm hover:bg-ground" aria-label="Next month">→</button>
    </div>
  );

  return (
    <Shell module="billing" eyebrow={`Billing · ${monthLabel(period)}`} title="Billing" actions={monthNav || null}>
      <Tabs tabs={VIEWS} value={openId ? null : view} onChange={id => { setView(id); setOpenId(null); }} />
      <BillingErrorBoundary>
        {!profile ? <Loading>Loading billing…</Loading>
          : openId ? <InvoiceEditor key={openId} id={openId} onBack={() => setOpenId(null)} isPartner={isPartner} profile={profile} />
          : view === 'month' ? <MonthView period={period} onOpen={setOpenId} isPartner={isPartner} profile={profile} />
          : view === 'reconcile' ? <ReconcileView />
          : <ClientsView />}
      </BillingErrorBoundary>
    </Shell>
  );
}
