'use client';
const qp = (k, d) => { try { return new URLSearchParams(window.location.search).get(k) || d; } catch { return d; } };
import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useAuth } from '../../lib/auth';
import { supabase } from '../../lib/supabase';
import { Shell } from '../../components/shell/Shell';
import { Panel, Button, Link, Pill, Tabs, Input, Select, Textarea, Label, Empty } from '../../components/shell/ui';
import { TouchpointModal, planTouchpointSave, uid as tpUid } from '../../components/marketing-shared';

/* ═══════════════════════════════════════════════════════════════════
   HDLA OneFirm — Time
   Weekly grid by project/phase + internal time accounts.
   Views: My Time (everyone) · Approvals (principal+) · Firm (partner/ops/office/principal) · Rates (partner/ops/office)
   Data: /api/time · projects from /api/masterdata · Work Plan assignments from /api/projects
   Business rules are unchanged from the Hub's My Time v2; only the chrome moved into the OneFirm shell.
   ═══════════════════════════════════════════════════════════════════ */

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const LEADERSHIP = ['partner', 'operations', 'office'];               // Rates admin
const FIRM_VIEW = ['partner', 'operations', 'office', 'principal'];   // Firm report (cost = partners only, server-enforced)
const APPROVERS = ['partner', 'operations', 'office', 'principal'];
const PROJECT_TASKS = ['Travel', 'General'];   // non-fee rows available on every project

// Week status → one pill. draft / submitted = outline, approved = solid ink, returned = red outline.
const STATUS_CFG = {
  draft:     { label: 'Draft',     kind: 'outline' },
  submitted: { label: 'Submitted', kind: 'outline' },
  approved:  { label: 'Approved',  kind: 'solid' },
  returned:  { label: 'Returned',  kind: 'red' },
};
const StatusPill = ({ status }) => { const c = STATUS_CFG[status] || STATUS_CFG.draft; return <Pill kind={c.kind}>{c.label}</Pill>; };

// ─── Helpers ──────────────────────────────────────────────────────
function getMonday(date) { const d = new Date(date); const day = d.getDay(); d.setDate(d.getDate() - day + (day === 0 ? -6 : 1)); d.setHours(0, 0, 0, 0); return d; }
function getWeekKey(date) { return date.toISOString().split('T')[0]; }
function fmtLocal(d) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }
function weekDates(monday) { return DAYS.map((_, i) => { const d = new Date(monday); d.setDate(monday.getDate() + i); return d; }); }
function fmtShort(d) { return d.toLocaleDateString('en-US', { month: 'numeric', day: 'numeric' }); }
function fmtRange(monday) { const end = new Date(monday); end.setDate(monday.getDate() + 6); return `${monday.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} – ${end.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`; }
function fmtH(n) { const v = Number(n) || 0; return v === 0 ? '' : (Number.isInteger(v) ? String(v) : v.toFixed(2).replace(/0$/, '')); }
function fmt$(n) { return '$' + Math.round(n || 0).toLocaleString(); }
function fmtX(n) { return n == null ? '—' : n.toFixed(2) + 'x'; }
function rowKey(r) { return `${r.project_num}||${r.project_name || ''}||${r.phase || ''}`; }
function fmtStamp(iso) { if (!iso) return ''; const d = new Date(iso); return isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) + ' ' + d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }); }
function fmtClock(d) { return d ? d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }).toLowerCase() : ''; }
function yearFromProjectNum(num) { const m = String(num || '').trim().match(/^(\d{2})-?\d{3,4}$/); return m ? 2000 + parseInt(m[1], 10) : null; }

async function authHeaders() {
  try { const { data } = await supabase.auth.getSession(); const t = data?.session?.access_token; return t ? { Authorization: `Bearer ${t}` } : {}; } catch { return {}; }
}
async function getJSON(url) {
  const r = await fetch(url, { headers: await authHeaders() });
  const d = await r.json();
  if (!r.ok || d.error) throw new Error(d.error || 'Request failed');
  return d;
}
async function post(payload) {
  const r = await fetch('/api/time', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(await authHeaders()) }, body: JSON.stringify(payload) });
  const d = await r.json();
  if (!r.ok || d.error) throw new Error(d.error || 'Request failed');
  return d;
}

// Label for a row given accounts lookup
function extraOf(name, base) { let x = String(name || '').trim(); if (base && x.toLowerCase().startsWith(base.toLowerCase())) x = x.slice(base.length); return x.replace(/^[\s\-–:]+/, '').trim(); }
// Verbatim from Master Data: phase as written; when the row's name differs from the project's base name, show the full name too
function lineTitle(r, base, shared) { const name = String(r.project_name || '').trim(); const ph = String(r.phase || '').trim(); const isShared = shared != null ? shared : (base && name.toLowerCase() === base.toLowerCase()); return isShared ? (ph || name || 'General') : (name || ph || 'General'); }
function rowLabel(r, acctByCode, baseNames) {
  const a = acctByCode[r.project_num];
  if (a) return { title: a.name, sub: a.group_name, internal: true };
  const base = baseNames?.[r.project_num] || r.project_name || '';
  return { title: `${r.project_num} ${base}`.trim(), sub: PROJECT_TASKS.includes(r.phase) ? r.phase : lineTitle(r, base), internal: false };
}

// Every Master Data line (name + phase, exactly as written) per project number, open or pre-contract projects only
function masterLinesByNum(masterData) {
  const out = {};
  (masterData || []).filter(r => r['Status'] === 'O' || r['Status'] === 'PR' || !r['Status']).forEach(r => {
    const num = String(r['Project #']);
    const project_name = String(r['Project Name'] || '').trim();
    const phase = String(r['Phase'] || '').trim();
    if (!out[num]) out[num] = [];
    if (!out[num].some(l => l.project_name === project_name && l.phase === phase)) out[num].push({ project_name, phase });
  });
  return out;
}

// ─── Shared bits of chrome ────────────────────────────────────────
const FieldLabel = ({ children }) => <div className="text-[11px] tracking-[0.08em] uppercase text-muted mb-1">{children}</div>;
// Choice chip (phase pickers, account pickers): outlined ink; selected = solid ink
const Chip = ({ on, muted, children, ...p }) => <button type="button" {...p} className={'px-3 py-1.5 rounded-[3px] text-xs font-bold border ' + (on ? 'bg-ink text-white border-ink' : muted ? 'bg-ground text-muted border-rule hover:border-ink' : 'bg-white text-ink border-rule hover:border-ink')}>{children}</button>;
// Dialog frame used by the Time modals (they carry their own footer, so not the ui Modal)
function Dialog({ title, onClose, width = 'w-[540px]', children, footer }) {
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/30 pt-8 pb-4" onMouseDown={onClose}>
      <div className={`bg-white rounded border border-rule ${width} max-w-[95vw] max-h-full flex flex-col`} onMouseDown={e => e.stopPropagation()}>
        <div className="shrink-0 flex items-center justify-between px-5 py-3 border-b border-ink">
          <h2 className="m-0 text-lg">{title}</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="text-muted hover:text-ink text-xl leading-none">×</button>
        </div>
        <div className="px-5 py-4 space-y-4 overflow-y-auto min-h-0">{children}</div>
        {footer && <div className="shrink-0 flex items-center gap-2 px-5 py-3 border-t border-rule bg-ground">{footer}</div>}
      </div>
    </div>
  );
}
// ui.Input is a plain function component, so fields that need a ref (auto-focus) use a bare <input> with the same classes
const INPUT_CLS = 'h-[38px] border border-rule rounded-[3px] px-2.5 text-[13px] bg-white';
const Loading = ({ children }) => <div className="py-16 text-center text-sm text-muted animate-pulse">{children}</div>;
const Note = ({ children }) => <p className="text-xs text-muted">{children}</p>;

// ═══ Entry modal (Log Time / edit cell / add row) ═════════════════
function EntryModal({ mode, masterData, accounts, existingKeys, initial, onSave, onAddRow, onClose, onTouchpoint }) {
  const [dateStr, setDateStr] = useState(initial?.dateStr || fmtLocal(new Date()));
  const [project, setProject] = useState(initial?.row ? { project_num: initial.row.project_num, project_name: initial.row.project_name, internal: !!accounts.find(a => a.code === initial.row.project_num) } : initial?.prefill ? { project_num: initial.prefill.project_num, project_name: initial.prefill.project_name, internal: false } : null);
  const [phase, setPhase] = useState(initial?.row ? { phase: initial.row.phase, project_name: initial.row.project_name } : null);
  const [q, setQ] = useState('');
  const [hours, setHours] = useState(initial?.entry ? fmtH(initial.entry.hours) : initial?.prefillHours != null ? fmtH(initial.prefillHours) : '');
  const [note, setNote] = useState(initial?.entry?.note || initial?.prefillNote || '');
  const [err, setErr] = useState('');
  const [saving, setSaving] = useState(false);
  const searchRef = useRef(null);
  const hoursRef = useRef(null);
  useEffect(() => { (project && phase != null ? hoursRef : searchRef).current?.focus(); }, [project, phase]);
  useEffect(() => { const h = e => { if (e.key === 'Escape') onClose(); }; document.addEventListener('keydown', h); return () => document.removeEventListener('keydown', h); }, [onClose]);

  const openProjects = useMemo(() => {
    const seen = {};
    masterData.filter(r => r['Status'] === 'O' || r['Status'] === 'PR' || !r['Status']).forEach(r => {
      const num = String(r['Project #']);
      if (!seen[num]) seen[num] = { project_num: num, names: [], client: r['Client'] || '', pm: r['PM'] || '', lines: [] };
      const name = String(r['Project Name'] || '').trim();
      if (name && !seen[num].names.includes(name)) seen[num].names.push(name);
      const key = `${name}||${String(r['Phase'] || '').trim()}`;
      if (!seen[num].lines.some(l => l.key === key)) seen[num].lines.push({ key, project_name: name, phase: String(r['Phase'] || '').trim() });
    });
    return Object.values(seen).map(p => { const base = [...p.names].sort((a, b) => a.length - b.length)[0] || ''; const counts = {}; p.lines.forEach(l => { const k = l.project_name.toLowerCase(); counts[k] = (counts[k] || 0) + 1; }); return { ...p, project_name: base, lines: p.lines.map(l => ({ ...l, title: lineTitle(l, base, counts[l.project_name.toLowerCase()] > 1) })) }; }).sort((a, b) => b.project_num.localeCompare(a.project_num));
  }, [masterData]);

  const matches = useMemo(() => {
    const s = q.trim().toLowerCase();
    const projs = openProjects.filter(p => !s || `${p.project_num} ${p.project_name} ${p.client} ${p.pm}`.toLowerCase().includes(s)).slice(0, 8);
    return { projs };
  }, [q, openProjects]);

  // Non-project codes: always listed, grouped, pinned under the project results (filtered by the search box when something is typed)
  const pinned = useMemo(() => {
    const s = q.trim().toLowerCase();
    const list = accounts.filter(a => a.active !== false).filter(a => !s || `${a.code} ${a.group_name} ${a.name}`.toLowerCase().includes(s));
    const groups = []; const idx = {};
    list.forEach(a => { if (idx[a.group_name] == null) { idx[a.group_name] = groups.length; groups.push({ name: a.group_name, items: [] }); } groups[idx[a.group_name]].items.push(a); });
    const singles = groups.filter(g => g.items.length === 1 && g.items[0].name === g.name).map(g => g.items[0]);
    const multi = groups.filter(g => !(g.items.length === 1 && g.items[0].name === g.name));
    return { singles, multi, any: list.length > 0 };
  }, [q, accounts]);

  const phaseOptions = useMemo(() => {
    if (!project || project.internal) return [];
    const p = openProjects.find(x => x.project_num === project.project_num);
    const fee = p ? p.lines.map(l => ({ phase: l.phase, project_name: l.project_name, title: l.title, fee: true })) : [];
    const tasks = PROJECT_TASKS.map(ph => ({ phase: ph, project_name: project.project_name, title: ph, fee: false }));
    return [...fee, ...tasks].filter(o => mode !== 'row' || !existingKeys?.has(`${project.project_num}||${o.project_name || ''}||${o.phase}`));
  }, [project, openProjects, mode, existingKeys]);

  const pickProject = p => { setProject({ project_num: p.project_num, project_name: p.project_name, internal: false }); setPhase(null); };
  const pickAccount = a => { setProject({ project_num: a.code, project_name: a.name, internal: true }); setPhase(''); };
  const needsNote = project && !project.internal;
  const rowOut = () => ({ project_num: project.project_num, project_name: project.internal ? project.project_name : (phase?.project_name || project.project_name), phase: project.internal ? '' : (phase?.phase || ''), billable: !project.internal });

  const submit = async (thenTouchpoint) => {
    setErr('');
    if (!project) { setErr('Pick a project or account'); return; }
    if (!project.internal && phase == null) { setErr('Pick a phase'); return; }
    if (mode === 'row') { setSaving(true); try { await onAddRow(rowOut()); onClose(); } catch (e) { setErr(e.message); setSaving(false); } return; }
    const h = parseFloat(hours);
    if (isNaN(h) || h < 0 || h > 24) { setErr('Enter hours between 0 and 24'); return; }
    if (mode === 'log' && !(h > 0)) { setErr('Enter hours greater than 0'); return; }
    if (h > 0 && needsNote && !note.trim()) { setErr('A note is required on project time'); return; }
    if (!dateStr) { setErr('Pick a date'); return; }
    setSaving(true);
    try {
      const out = await onSave(rowOut(), dateStr, h, note.trim(), mode === 'log');
      const row = rowOut();
      onClose();
      // "Save and log touchpoint": the time is saved first, then the Marketing touchpoint form opens, filled in
      if (thenTouchpoint === true && h > 0 && onTouchpoint) onTouchpoint(row, dateStr, out?.entry || { hours: h, note: note.trim(), work_date: dateStr });
    } catch (e) { setErr(e.message); setSaving(false); }
  };

  const isBD = !!(project && project.internal && accounts.find(a => a.code === project.project_num)?.group_name === 'Business Dev');
  const title = mode === 'row' ? 'Add row' : mode === 'cell' ? 'Edit time' : 'Log time';
  const locked = mode === 'cell';

  const footer = (
    <>
      <Button onClick={() => submit()} disabled={saving} className="flex-1 justify-center">{saving ? 'Saving...' : mode === 'row' ? 'Add row' : 'Save'}</Button>
      {mode !== 'row' && isBD && onTouchpoint && <Button variant="secondary" data-tp-log="1" onClick={() => submit(true)} disabled={saving}>{initial?.entry?.touchpoint_id ? 'Save and edit touchpoint' : 'Save and log touchpoint'}</Button>}
      {mode === 'cell' && initial?.entry && <Button variant="secondary" onClick={async () => { setSaving(true); try { await onSave(rowOut(), dateStr, 0, ''); onClose(); } catch (e) { setErr(e.message); setSaving(false); } }}>Clear</Button>}
      <button type="button" onClick={onClose} className="px-3 text-[13px] text-muted hover:text-ink">Cancel</button>
    </>
  );

  return (
    <Dialog title={title} onClose={onClose} footer={footer}>
      {/* Project / account */}
      <div>
        <FieldLabel>Project or account</FieldLabel>
        {project ? (
          <div className="flex items-center justify-between border border-rule rounded-[3px] px-3 py-2 bg-ground">
            <div className="min-w-0">
              <div className="text-sm truncate">{project.internal ? project.project_name : `${project.project_num} ${project.project_name}`}</div>
              {project.internal && <div className="text-xs text-muted">{accounts.find(a => a.code === project.project_num)?.group_name}</div>}
            </div>
            {!locked && <Link onClick={() => { setProject(null); setPhase(null); setQ(''); }} className="ml-3 text-xs">Change</Link>}
          </div>
        ) : (
          <div>
            <input ref={searchRef} value={q} onChange={e => setQ(e.target.value)} placeholder="Search project #, name, client, PM — or an account" className={`${INPUT_CLS} w-full`} />
            <div className="mt-1 border border-rule rounded-[3px] overflow-hidden">
              <div className="max-h-44 overflow-y-auto">
                {matches.projs.length > 0 && <div className="px-3 pt-2 pb-1 text-[10px] tracking-[0.08em] text-muted uppercase">Projects</div>}
                {matches.projs.map(p => (
                  <div key={p.project_num} onClick={() => pickProject(p)} className="px-3 py-2 cursor-pointer hover:bg-accent-tint border-b border-hair">
                    <div className="text-sm">{p.project_num} {p.project_name}</div>
                    <div className="text-xs text-muted">{p.client}{p.pm ? ` · PM ${p.pm}` : ''} · {p.lines.length} line{p.lines.length === 1 ? '' : 's'}</div>
                  </div>
                ))}
                {matches.projs.length === 0 && q.trim() && <div className="text-xs text-muted italic px-3 py-3">No project matches</div>}
              </div>
              {pinned.any && (
                <div data-pinned="1" className="border-t-2 border-ink bg-ground px-3 py-2 max-h-52 overflow-y-auto">
                  <div className="text-[10px] tracking-[0.08em] text-muted uppercase mb-1">Non-project time</div>
                  {pinned.singles.length > 0 && <div className="flex flex-wrap gap-1.5 mb-1.5">{pinned.singles.map(a => <Chip key={a.code} data-acct={a.name} title={`Code ${a.code}`} onClick={() => pickAccount(a)}>{a.name}</Chip>)}</div>}
                  {pinned.multi.map(g => (
                    <div key={g.name} className="mb-1.5">
                      <div className="text-[10px] text-muted mb-0.5">{g.name}</div>
                      <div className="flex flex-wrap gap-1.5">{g.items.map(a => <Chip key={a.code} data-acct={`${g.name}|${a.name}`} title={`Code ${a.code}`} onClick={() => pickAccount(a)}>{a.name}</Chip>)}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Phase */}
      {project && !project.internal && (
        <div>
          <FieldLabel>Phase</FieldLabel>
          {locked ? (
            <div className="border border-rule rounded-[3px] px-3 py-2 bg-ground text-sm">{phase ? lineTitle(phase, project.project_name) : '—'}</div>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {phaseOptions.map(o => { const sel = phase && phase.phase === o.phase && (phase.project_name || '') === (o.project_name || ''); return (
                <Chip key={`${o.project_name}||${o.phase}`} on={sel} muted={!o.fee} onClick={() => setPhase({ phase: o.phase, project_name: o.project_name })}
                  title={o.fee ? 'Fee line from Master Data' : 'Non-fee project time'}>{o.title}</Chip>
              ); })}
              {phaseOptions.length === 0 && <span className="text-xs text-muted italic">All phases already on your sheet</span>}
            </div>
          )}
        </div>
      )}

      {mode !== 'row' && (
        <>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <FieldLabel>Date</FieldLabel>
              <Input type="date" value={dateStr} disabled={locked} onChange={e => setDateStr(e.target.value)} className="w-full disabled:bg-ground disabled:text-muted" />
            </div>
            <div>
              <FieldLabel>Hours</FieldLabel>
              <input ref={hoursRef} type="number" step="0.25" min="0" max="24" value={hours} onChange={e => setHours(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') submit(); }} className={`${INPUT_CLS} w-full`} placeholder="0.00" />
            </div>
          </div>
          <div>
            <FieldLabel>Note {needsNote && <span className="text-status-red normal-case tracking-normal">(required)</span>}</FieldLabel>
            <Textarea value={note} onChange={e => setNote(e.target.value)} rows={2}
              onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submit(); }}
              className="w-full resize-none" placeholder="What did you work on?" />
          </div>
        </>
      )}

      {mode !== 'row' && isBD && onTouchpoint && (
        <div data-tp-section="1" className="rounded-[3px] border border-rule bg-ground px-3 py-2 text-xs text-ink">{initial?.entry?.touchpoint_id ? <span data-tp-tag="1">✓ Already logged as a touchpoint in Marketing. "Save and edit touchpoint" opens it.</span> : 'Meeting with a client? "Save and log touchpoint" saves this time, then opens the touchpoint form.'}</div>
      )}

      {err && <div className="text-xs text-status-red font-bold">{err}</div>}
    </Dialog>
  );
}

// ═══ Weekly grid ══════════════════════════════════════════════════
// One row per project (and per non-project group) with the day totals; the phases / codes drop down underneath. Collapsed by default.
function WeekGrid({ rows, entries, dates, locked, readOnly, acctByCode, baseNames, needsPhase, onCellClick, onRemoveRow, onEditPhase }) {
  const [hov, setHov] = useState({ r: null, c: null });   // hovered row key / column index — crosshair so you can see which project + date you're about to hit
  const [open, setOpen] = useState({});                   // group key -> expanded
  const entryMap = useMemo(() => { const m = {}; entries.forEach(e => { m[`${rowKey(e)}||${e.work_date}`] = e; }); return m; }, [entries]);
  const { projectGroups, accountGroups } = useMemo(() => {
    const keys = new Set(rows.map(rowKey));
    const all = [...rows];
    entries.forEach(e => { const k = rowKey(e); if (!keys.has(k)) { keys.add(k); all.push({ project_num: e.project_num, project_name: e.project_name, phase: e.phase, orphan: true }); } });
    const groups = []; const idx = {};
    all.forEach(r => {
      const a = acctByCode[r.project_num];
      const gk = a ? `A|${a.group_name}` : `P|${r.project_num}`;
      if (idx[gk] == null) { idx[gk] = groups.length; groups.push({ key: gk, internal: !!a, name: a ? a.group_name : '', num: r.project_num, rows: [] }); }
      groups[idx[gk]].rows.push(r);
    });
    return { projectGroups: groups.filter(g => !g.internal), accountGroups: groups.filter(g => g.internal) };
  }, [rows, entries, acctByCode]);

  const rowTotal = r => dates.reduce((s, d) => s + (Number(entryMap[`${rowKey(r)}||${fmtLocal(d)}`]?.hours) || 0), 0);
  const groupDay = (g, ds) => g.rows.reduce((s, r) => s + (Number(entryMap[`${rowKey(r)}||${ds}`]?.hours) || 0), 0);
  const groupTotal = g => g.rows.reduce((s, r) => s + rowTotal(r), 0);
  const dayTotal = d => entries.filter(e => e.work_date === fmtLocal(d)).reduce((s, e) => s + (Number(e.hours) || 0), 0);
  const weekTotal = entries.reduce((s, e) => s + (Number(e.hours) || 0), 0);
  const today = fmtLocal(new Date());
  const canEdit = !locked && !readOnly;
  const multi = [...projectGroups, ...accountGroups].filter(g => g.rows.length > 1);
  const allOpen = multi.length > 0 && multi.every(g => open[g.key]);
  const toggleAll = () => { const n = {}; if (!allOpen) multi.forEach(g => { n[g.key] = true; }); setOpen(n); };

  // today = accent tint, hovered column = ground
  const colBg = (ds, i) => ds === today ? 'bg-accent-tint' : hov.c === i ? 'bg-ground' : '';
  const zero = <span className="text-rule">0</span>;

  const cells = (r, k) => dates.map((d, i) => {
    const ds = fmtLocal(d);
    const e = entryMap[`${k}||${ds}`];
    return (
      <td key={i} className={`text-center py-1 px-1 ${colBg(ds, i)}`} onMouseEnter={() => setHov({ r: k, c: i })}>
        <button type="button" disabled={!canEdit} onClick={() => onCellClick && onCellClick(r, ds, e)} title={e?.note || ''}
          className={`w-full h-8 rounded-[3px] text-sm ${e ? 'text-ink font-bold' : 'text-rule'} ${canEdit ? 'hover:bg-hair cursor-pointer' : 'cursor-default'}`}>
          {e ? <span>{fmtH(e.hours)}{e.note && <span className="text-accent ml-0.5">•</span>}{e.touchpoint_id && <span data-tp-badge="1" title="Logged as a touchpoint" className="text-accent ml-0.5 text-[10px] align-top">◆</span>}</span> : (canEdit ? '+' : '')}
        </button>
      </td>
    );
  });
  const pencil = r => (!r.orphan && !r.internal && canEdit && onEditPhase) ? <button type="button" data-edit-phase="1" onClick={() => onEditPhase(r)} title="Change phase" className="opacity-0 group-hover:opacity-100 text-muted hover:text-accent text-xs leading-none">✎</button> : null;
  const removeBtn = r => (!r.orphan && canEdit && onRemoveRow) ? <button type="button" onClick={() => onRemoveRow(r)} title="Remove row (entries are kept)" className="opacity-0 group-hover:opacity-100 text-muted hover:text-status-red text-base leading-none">×</button> : null;

  // A single line (project with one phase, or a code on its own group): flat row exactly as before
  const renderLine = (r, idx, child) => {
    const k = rowKey(r);
    const lbl = rowLabel(r, acctByCode, baseNames);
    const internal = !!acctByCode[r.project_num];
    const rowBg = hov.r === k ? 'bg-ground' : '';
    const np = !internal && needsPhase && needsPhase(r);
    const title = child ? (internal ? lbl.title : (np ? 'No phase' : lineTitle(r, baseNames?.[r.project_num] || r.project_name || ''))) : lbl.title;
    const sub = child ? (PROJECT_TASKS.includes(r.phase) ? 'non-fee' : '') : lbl.sub;
    return (
      <tr key={k} data-line={k} className={`border-b border-hair group ${rowBg}`}>
        <td className={`py-2 align-middle ${child ? 'pl-10 pr-4' : 'px-4'}`} onMouseEnter={() => setHov({ r: k, c: null })}>
          <div className="flex items-center gap-2">
            <div className="min-w-0 flex-1">
              <div className={`truncate ${np ? 'text-status-amber' : child ? 'text-muted' : 'text-ink'}`}>{title}{np && <span className="text-xs ml-2">pick a phase ✎</span>}</div>
              {(sub || r.orphan) && <div className="text-xs text-muted truncate">{sub}{r.orphan ? `${sub ? ' · ' : ''}(row removed)` : ''}</div>}
            </div>
            {pencil({ ...r, internal })}
            {removeBtn(r)}
          </div>
        </td>
        {cells(r, k)}
        <td className="px-3 py-2 text-right font-bold">{fmtH(rowTotal(r)) || zero}</td>
      </tr>
    );
  };

  const renderGroup = (g, state) => {
    if (g.rows.length === 1) { const el = renderLine(g.rows[0], state.i, false); state.i += 1; return el; }
    const isOpen = !!open[g.key];
    const rowBg = hov.r === g.key ? 'bg-ground' : '';
    state.i += 1;
    const base = g.internal ? g.name : `${g.num} ${baseNames?.[g.num] || g.rows[0].project_name || ''}`.trim();
    const out = [
      <tr key={g.key} data-group={g.key} className={`border-b border-hair ${rowBg}`}>
        <td className="px-4 py-2 align-middle cursor-pointer select-none" onClick={() => setOpen(o => ({ ...o, [g.key]: !o[g.key] }))} onMouseEnter={() => setHov({ r: g.key, c: null })}>
          <div className="flex items-center gap-2">
            <span className="text-muted text-xs w-3">{isOpen ? '▾' : '▸'}</span>
            <div className="min-w-0 flex-1">
              <div className="truncate">{base}</div>
              <div className="text-xs text-muted">{g.rows.length} {g.internal ? 'codes' : 'phases'}</div>
            </div>
          </div>
        </td>
        {dates.map((d, i) => {
          const ds = fmtLocal(d); const t = groupDay(g, ds);
          return <td key={i} className={`text-center py-1 px-1 ${colBg(ds, i)}`} onMouseEnter={() => setHov({ r: g.key, c: i })}>
            <button type="button" onClick={() => setOpen(o => ({ ...o, [g.key]: true }))} className={`w-full h-8 rounded-[3px] text-sm ${t ? 'text-ink font-bold' : 'text-rule'} hover:bg-hair`}>{fmtH(t) || ''}</button>
          </td>;
        })}
        <td className="px-3 py-2 text-right font-bold">{fmtH(groupTotal(g)) || zero}</td>
      </tr>,
    ];
    if (isOpen) g.rows.forEach(r => out.push(renderLine(r, 0, true)));
    return out;
  };
  const stateP = { i: 0 }; const stateA = { i: 0 };
  const th = 'sticky top-0 z-20 bg-ink text-white px-2 py-2.5 text-[11px] font-bold uppercase tracking-[0.04em]';

  return (
    // overflow-clip (not hidden) keeps the border without turning the wrapper into a scroll container, so the date header can pin to the page
    <div className="bg-white rounded border border-rule overflow-clip">
      <table className="w-full text-sm border-collapse" onMouseLeave={() => setHov({ r: null, c: null })}>
        <thead>
          <tr>
            <th className={`${th} text-left pl-4 w-[34%]`}>Project / Phase{multi.length > 0 && <button type="button" data-toggle-all="1" onClick={toggleAll} className="ml-3 normal-case font-normal tracking-normal text-white/70 hover:text-white hover:underline">{allOpen ? 'Collapse all' : 'Expand all'}</button>}</th>
            {dates.map((d, i) => {
              const isToday = fmtLocal(d) === today;
              return (
                <th key={i} className={`${th} text-center ${!isToday && hov.c === i ? 'bg-[#2a2a28]' : ''}`}>
                  {isToday
                    ? <span className="inline-block px-2 py-[3px] rounded-[2px] bg-accent text-white">{DAYS[i]} {fmtShort(d)}</span>
                    : <>{DAYS[i]} <span className="font-normal text-white/70">{fmtShort(d)}</span></>}
                </th>
              );
            })}
            <th className={`${th} text-right pr-3`}>Total</th>
          </tr>
        </thead>
        <tbody>
          {projectGroups.map(g => renderGroup(g, stateP))}
          {projectGroups.length === 0 && <tr><td colSpan={9} className="px-4 py-4 text-xs text-muted italic">No project rows yet — use Log Time or Add row</td></tr>}
          {accountGroups.length > 0 && <tr className="bg-ground"><td colSpan={9} className="px-4 py-1 text-[10px] tracking-[0.08em] text-muted uppercase">Internal</td></tr>}
          {accountGroups.map(g => renderGroup(g, stateA))}
        </tbody>
        <tfoot>
          <tr className="border-t-2 border-ink">
            <td className="px-4 py-2.5 text-xs font-bold">Daily total</td>
            {dates.map((d, i) => { const t = dayTotal(d); return <td key={i} className={`text-center py-2.5 text-sm font-bold ${fmtLocal(d) === today ? 'bg-accent-tint' : ''} ${t > 10 ? 'text-status-amber' : ''}`}>{fmtH(t) || zero}</td>; })}
            <td className="px-3 py-2.5 text-right text-sm font-bold font-flecha text-base">{fmtH(weekTotal) || '0'}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

// ═══ Change a row's phase ═════════════════════════════════════════
function PhaseModal({ row, options, existingKeys, onSave, onClose }) {
  const [pick, setPick] = useState(null);
  const [err, setErr] = useState('');
  const [saving, setSaving] = useState(false);
  useEffect(() => { const h = e => { if (e.key === 'Escape') onClose(); }; document.addEventListener('keydown', h); return () => document.removeEventListener('keydown', h); }, [onClose]);
  const merges = pick && existingKeys.has(`${row.project_num}||${pick.project_name || ''}||${pick.phase || ''}`);
  const go = async () => { if (!pick) { setErr('Pick the new phase'); return; } setSaving(true); setErr(''); try { await onSave(row, pick); onClose(); } catch (e) { setErr(e.message); setSaving(false); } };
  return (
    <Dialog title="Change phase" onClose={onClose} width="w-[460px]" footer={<>
      <Button onClick={go} disabled={saving} className="flex-1 justify-center">{saving ? 'Moving...' : 'Change phase'}</Button>
      <button type="button" onClick={onClose} className="px-3 text-[13px] text-muted hover:text-ink">Cancel</button>
    </>}>
      <div className="text-sm"><b>{row.project_num}</b> {row.project_name} <span className="text-muted">· now: {row.phase || 'no phase'}</span></div>
      <div className="flex flex-wrap gap-1.5">
        {options.map(o => { const sel = pick && pick.phase === o.phase && pick.project_name === o.project_name; return (
          <Chip key={`${o.project_name}||${o.phase}`} data-phase-option={o.title} on={sel} onClick={() => setPick(o)}>{o.title}</Chip>
        ); })}
        {options.length === 0 && <span className="text-xs text-muted italic">No other phases found in Master Data</span>}
      </div>
      <Note>Moves the hours you've logged on this line in open weeks. Weeks already submitted or approved keep the phase they were submitted with.{merges ? ' This phase is already on your sheet, so the hours will be added together.' : ''}</Note>
      {err && <div className="text-xs text-status-red font-bold">{err}</div>}
    </Dialog>
  );
}

// ═══ Work Plan panel (collapsible, sits beside the grid) ══════════
const PLAN_OPEN_KEY = 'hdla_time_plan_open';
// Milestone chips follow the system: Deadline = solid ink, Hard check-in = solid accent, Soft check-in = accent outline
const MILESTONE_CHIP = {
  deadline:    { label: 'Deadline', cls: 'chip-deadline' },
  hardCheckIn: { label: 'Hard',     cls: 'chip-hard' },
};
function weekLabelOf(monday) { return monday.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }); }   // same label the Work Plan stores on tasks, e.g. "Oct 5"
function dayLabelOf(dateStr) { const [y, m, d] = String(dateStr).slice(0, 10).split('-').map(Number); return new Date(y, m - 1, d).toLocaleDateString('en-US', { weekday: 'short', month: 'numeric', day: 'numeric' }); }

// My tasks + deadlines for the viewed week, grouped by project
function buildWeekPlan(projects, myInitials, monday, dates) {
  if (!myInitials) return { groups: [], taskCount: 0, plannedHours: 0 };
  const label = weekLabelOf(monday);
  const startStr = fmtLocal(dates[0]);
  const endStr = fmtLocal(dates[dates.length - 1]);
  const groups = [];
  (projects || []).forEach(p => {
    const tasks = (p.tasks || []).filter(t => t.staff === myInitials && t.week === label && t.task);
    const onTeam = (p.teamMembers || []).includes(myInitials) || (p.partnersInCharge || []).includes(myInitials) || p.principal === myInitials;
    const milestones = onTeam ? (p.milestones || []).filter(m => m.date && String(m.date).slice(0, 10) >= startStr && String(m.date).slice(0, 10) <= endStr).sort((a, b) => String(a.date).localeCompare(String(b.date))) : [];
    if (!tasks.length && !milestones.length) return;
    groups.push({ id: p.id || `${p.projectNum}-${p.projectName}`, projectNum: String(p.projectNum || ''), projectName: String(p.projectName || '').trim(), tasks, milestones, planned: tasks.reduce((s, t) => s + (Number(t.hours) || 0), 0) });
  });
  groups.sort((a, b) => b.projectNum.localeCompare(a.projectNum));
  return { groups, taskCount: groups.reduce((s, g) => s + g.tasks.length, 0), plannedHours: groups.reduce((s, g) => s + g.planned, 0) };
}

// Side panel frame shared by Work Plan and Meetings
function SidePanel({ title, sub, onClose, closeTitle, children }) {
  return (
    <aside className="w-full lg:w-80 shrink-0 lg:sticky lg:top-3 lg:max-h-[calc(100vh-24px)] flex flex-col bg-white rounded border border-rule overflow-clip">
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-ink">
        <div>
          <div className="text-[11px] tracking-[0.08em] text-muted uppercase">{title}</div>
          <div className="text-xs text-muted mt-0.5">{sub}</div>
        </div>
        <button type="button" onClick={onClose} title={closeTitle} className="text-muted hover:text-ink text-xl leading-none px-1">×</button>
      </div>
      <div className="overflow-y-auto">{children}</div>
    </aside>
  );
}

function WorkPlanPanel({ plan, entries, weekTotal, canLog, onLog, onClose, isDone, onToggle, pending }) {
  const loggedFor = num => entries.filter(e => String(e.project_num) === num).reduce((s, e) => s + (Number(e.hours) || 0), 0);
  return (
    <SidePanel title="Work Plan · this week" onClose={onClose} closeTitle="Hide Work Plan"
      sub={<>Planned <span className="font-bold text-ink">{fmtH(plan.plannedHours) || '0'}h</span> · Logged <span className="font-bold text-ink">{fmtH(weekTotal) || '0'}h</span></>}>
      {plan.groups.length === 0 && <div className="px-4 py-6 text-xs text-muted italic">Nothing on your Work Plan for this week.</div>}
      {plan.groups.map(g => {
        const logged = loggedFor(g.projectNum);
        return (
          <div key={g.id} className="px-4 py-3 border-b border-hair last:border-b-0">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="text-sm leading-snug">{g.projectNum} {g.projectName}</div>
                <div className="text-[11px] text-muted mt-0.5">{g.planned > 0 ? `Planned ${fmtH(g.planned)}h` : 'No hours planned'}{g.projectNum ? ` · Logged ${fmtH(logged) || '0'}h` : ''}</div>
              </div>
              {canLog && g.projectNum && <Link onClick={() => onLog(g)} className="shrink-0 text-[11px]">Log time</Link>}
            </div>
            {g.milestones.length > 0 && (
              <div className="mt-2 space-y-1">
                {g.milestones.map((m, i) => {
                  const chip = MILESTONE_CHIP[m.type] || { label: 'Soft', cls: 'chip-soft' };
                  return (
                    <div key={i} className="flex items-center gap-2 text-xs">
                      <span className={`inline-block px-1.5 py-[2px] rounded-[2px] text-[10px] font-bold uppercase tracking-[0.04em] leading-none ${chip.cls}`}>{chip.label}</span>
                      <span className="text-muted shrink-0">{dayLabelOf(m.date)}</span>
                      <span className="truncate" title={m.description}>{m.description}</span>
                    </div>
                  );
                })}
              </div>
            )}
            {g.tasks.length > 0 && (
              <ul className="mt-2 space-y-1">
                {g.tasks.map((t, i) => (
                  <li key={t.id || i} className="flex items-start gap-2 text-xs">
                    <button type="button" role="checkbox" aria-checked={isDone(g, t)} disabled={pending(g, t)} onClick={() => onToggle(g, t)} title={isDone(g, t) ? 'Mark not done' : 'Mark done'}
                      className={`mt-0.5 w-4 h-4 shrink-0 rounded-[2px] border flex items-center justify-center text-[10px] leading-none cursor-pointer disabled:opacity-50 ${isDone(g, t) ? 'bg-ink border-ink text-white' : 'border-rule text-transparent hover:border-ink'}`}>✓</button>
                    <span className={`flex-1 ${isDone(g, t) ? 'line-through text-done' : ''}`}>{t.task}</span>
                    {Number(t.hours) > 0 && <span className="text-muted shrink-0">{fmtH(t.hours)}h</span>}
                  </li>
                ))}
              </ul>
            )}
          </div>
        );
      })}
    </SidePanel>
  );
}

// ═══ Meetings panel (Outlook calendar → "Log as time") ═════════════
// Reference list of this week's meetings. Nothing is logged until the person clicks "Log as time", picks the project, and saves.
const pad2 = n => String(n).padStart(2, '0');
function fmt12(h, m) { const ap = h >= 12 ? 'PM' : 'AM'; const hh = h % 12 === 0 ? 12 : h % 12; return `${hh}:${pad2(m)} ${ap}`; }
function parseLocalISO(s) { const m = String(s || '').match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/); return m ? { date: `${m[1]}-${m[2]}-${m[3]}`, h: +m[4], mi: +m[5], utc: Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]) } : null; }
// Calendar events → { key, date, subject, range, hours|null, noteText }; hours is the meeting length to the nearest quarter hour (null for all-day / multi-day)
function meetingsFrom(events) {
  return (events || []).map(e => {
    const a = parseLocalISO(e.start), b = parseLocalISO(e.end);
    if (!a) return null;
    const subject = String(e.subject || '(No subject)').trim();
    const timed = !e.isAllDay && b && b.date === a.date && b.utc > a.utc;
    const hours = timed ? Math.min(24, Math.max(0.25, Math.round(((b.utc - a.utc) / 60000) / 15) / 4)) : null;
    const sameAp = b && (a.h >= 12) === (b.h >= 12);
    const range = e.isAllDay ? 'All day' : (!b ? fmt12(a.h, a.mi) : sameAp ? `${fmt12(a.h, a.mi).replace(/ [AP]M$/, '')}–${fmt12(b.h, b.mi)}` : `${fmt12(a.h, a.mi)}–${fmt12(b.h, b.mi)}`);
    const [yy, mm, dd] = a.date.split('-').map(Number);
    const dayShort = new Date(yy, mm - 1, dd).toLocaleDateString('en-US', { weekday: 'short' });
    const noteText = `Meeting: ${subject} (${dayShort} ${mm}/${dd}, ${range})`;
    return { key: `${e.id || subject}|${e.start}`, date: a.date, start: a.utc, subject, range, hours, noteText, allDay: !!e.isAllDay };
  }).filter(Boolean).sort((x, y) => x.start - y.start);
}

function MeetingsPanel({ state, entries, canLog, onLog, onClose }) {
  const meetings = useMemo(() => meetingsFrom(state.events), [state.events]);
  const isLogged = m => entries.some(e => String(e.work_date).slice(0, 10) === m.date && String(e.note || '').includes(`Meeting: ${m.subject}`));
  const days = []; meetings.forEach(m => { let d = days[days.length - 1]; if (!d || d.date !== m.date) { d = { date: m.date, items: [] }; days.push(d); } d.items.push(m); });
  return (
    <SidePanel title="Meetings · this week" sub="From your Outlook calendar" onClose={onClose} closeTitle="Hide Meetings">
      {state.loading && <div className="px-4 py-6 text-xs text-muted italic animate-pulse">Loading your calendar...</div>}
      {!state.loading && state.error && <div className="px-4 py-6 text-xs text-status-red">{state.error}</div>}
      {!state.loading && !state.error && meetings.length === 0 && <div className="px-4 py-6 text-xs text-muted italic">No meetings on your calendar this week.</div>}
      {days.map(d => (
        <div key={d.date}>
          <div className="px-4 py-1.5 text-[11px] tracking-[0.04em] text-muted uppercase bg-ground">{dayLabelOf(d.date)}</div>
          {d.items.map(m => {
            const logged = isLogged(m);
            return (
              <div key={m.key} className={`px-4 py-2.5 border-b border-hair ${logged ? 'opacity-60' : ''}`}>
                <div className="text-sm leading-snug">{m.subject}</div>
                <div className="text-[11px] text-muted mt-0.5">{m.range}{m.hours ? ` · ${fmtH(m.hours)} h` : ''}</div>
                {logged ? <div className="mt-1.5 text-[11px] text-done">✓ Logged</div>
                  : m.hours ? (canLog ? <Button variant="secondary" onClick={() => onLog(m)} className="mt-1.5 h-7 px-2.5 text-[11px]">Log as time</Button> : <div className="mt-1.5 text-[11px] text-muted">Week is locked</div>)
                    : <div className="mt-1.5 text-[11px] text-muted">{m.allDay ? 'All-day event: enter hours by hand' : 'Runs past one day: enter hours by hand'}</div>}
              </div>
            );
          })}
        </div>
      ))}
    </SidePanel>
  );
}

// ═══ MY TIME ══════════════════════════════════════════════════════
function MyTimeView({ user, profile, weekKey, monday, masterData, projects, accounts, acctByCode, onWeekChange }) {
  const [rows, setRows] = useState([]);
  const [entries, setEntries] = useState([]);
  const [week, setWeek] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadedAt, setLoadedAt] = useState(null);
  const [modal, setModal] = useState(null);
  const [msg, setMsg] = useState('');
  const dates = useMemo(() => weekDates(monday), [monday]);
  const myInitials = profile?.initials || '';
  // Work Plan panel: closed by default, remembered per browser
  const [planOpen, setPlanOpen] = useState(() => { try { return typeof window !== 'undefined' && window.localStorage.getItem(PLAN_OPEN_KEY) === '1'; } catch { return false; } });
  const togglePlan = () => setPlanOpen(o => { const n = !o; try { window.localStorage.setItem(PLAN_OPEN_KEY, n ? '1' : '0'); } catch {} return n; });
  const plan = useMemo(() => buildWeekPlan(projects, myInitials, monday, dates), [projects, myInitials, monday, dates]);
  // Meetings panel: closed by default; the calendar is only fetched while it is open
  const [meetOpen, setMeetOpen] = useState(false);
  const [meet, setMeet] = useState({ loading: false, error: '', events: [] });
  useEffect(() => {
    if (!meetOpen || !myInitials) return;
    let alive = true;
    setMeet({ loading: true, error: '', events: [] });
    (async () => {
      try {
        const r = await fetch(`/api/calendar?initials=${encodeURIComponent(myInitials)}&start=${fmtLocal(dates[0])}&end=${fmtLocal(dates[dates.length - 1])}`, { headers: await authHeaders() });
        const d = await r.json().catch(() => ({}));
        if (!alive) return;
        if (!r.ok || d.error) setMeet({ loading: false, error: d.error ? `Couldn't load your calendar: ${d.error}` : "Couldn't load your calendar.", events: [] });
        else setMeet({ loading: false, error: '', events: d.events || [] });
      } catch { if (alive) setMeet({ loading: false, error: "Couldn't load your calendar.", events: [] }); }
    })();
    return () => { alive = false; };
  }, [meetOpen, myInitials, weekKey]);

  const load = useCallback(() => {
    setLoading(true);
    getJSON(`/api/time?user_id=${user.id}&week_key=${weekKey}`).then(d => {
      setRows(d.rows || []); setEntries(d.entries || []); setWeek(d.week || { status: 'draft' }); setLoadedAt(new Date()); setLoading(false);
    }).catch(e => { setMsg(e.message); setLoading(false); });
  }, [user.id, weekKey]);
  useEffect(() => { load(); }, [load]);

  const status = week?.status || 'draft';
  const locked = ['submitted', 'approved'].includes(status);
  const existingKeys = useMemo(() => new Set(rows.map(rowKey)), [rows]);
  const weekTotal = entries.reduce((s, e) => s + (Number(e.hours) || 0), 0);
  const baseNames = useMemo(() => { const m = {}; (masterData || []).forEach(r => { const n = String(r['Project #']); const nm = String(r['Project Name'] || '').trim(); if (nm && (!m[n] || nm.length < m[n].length)) m[n] = nm; }); return m; }, [masterData]);

  // Master Data is the source of truth for phases: every line of the project, exactly as written there
  const mLines = useMemo(() => masterLinesByNum(masterData), [masterData]);
  // Work Plan projects with no row at all on the sheet yet; "Add them" brings in every Master Data phase for each
  const assigned = useMemo(() => {
    const onSheet = new Set(rows.map(r => String(r.project_num)));
    const seen = new Set();
    const out = [];
    (projects || [])
      .filter(p => (p.teamMembers || []).includes(myInitials) || (p.partnersInCharge || []).includes(myInitials) || p.principal === myInitials)
      .filter(p => p.projectNum)
      .forEach(p => {
        const num = String(p.projectNum);
        if (onSheet.has(num) || seen.has(num)) return;
        seen.add(num);
        const lines = mLines[num];
        if (lines && lines.length) lines.forEach(l => out.push({ project_num: num, project_name: l.project_name, phase: l.phase }));
        else out.push({ project_num: num, project_name: String(p.projectName || '').trim(), phase: p.phase || '' });
      });
    return out;
  }, [projects, myInitials, rows, mLines]);
  const assignedProjects = useMemo(() => new Set(assigned.map(a => a.project_num)).size, [assigned]);
  // A project row with a blank phase that doesn't match any Master Data line (those rows came from the Work Plan)
  const needsPhase = useCallback(r => {
    if (String(r.phase || '').trim() !== '') return false;
    const lines = mLines[String(r.project_num)];
    if (!lines || !lines.length) return false;
    return !lines.some(l => l.phase === '' && l.project_name === String(r.project_name || '').trim());
  }, [mLines]);
  // Phases a row can be moved to: the project's Master Data lines plus the non-fee tasks
  const phaseChoices = useCallback(r => {
    const lines = mLines[String(r.project_num)] || [];
    const base = baseNames[String(r.project_num)] || r.project_name || '';
    const counts = {}; lines.forEach(l => { const k = l.project_name.toLowerCase(); counts[k] = (counts[k] || 0) + 1; });
    const fee = lines.map(l => ({ phase: l.phase, project_name: l.project_name, title: lineTitle(l, base, counts[l.project_name.toLowerCase()] > 1) }));
    const tasks = PROJECT_TASKS.map(ph => ({ phase: ph, project_name: r.project_name || base, title: ph }));
    return [...fee, ...tasks].filter(o => !(String(o.project_name || '') === String(r.project_name || '') && String(o.phase || '') === String(r.phase || '')));
  }, [mLines, baseNames]);

  const flash = t => { setMsg(t); setTimeout(() => setMsg(''), 3000); };
  const [phaseFor, setPhaseFor] = useState(null);
  const cleaned = useRef(false);
  // "Log as touchpoint" (Business Dev time only): opens the Marketing touchpoint form, filled in from the time entry
  const [tpFlow, setTpFlow] = useState(null);     // { row, dateStr, entry, data:{clients,proposals}, touchpoint }
  const mktPost = async body => { const r = await fetch('/api/marketing', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); const d = await r.json().catch(() => ({})); if (!r.ok || d.error) throw new Error(d.error || 'Could not save to Marketing'); return d; };
  const openTouchpoint = async (row, dateStr, entry) => {
    try {
      const r = await fetch('/api/marketing'); const d = await r.json();
      const data = { clients: d.clients || [], proposals: d.proposals || [], touchpoints: d.touchpoints || [] };
      const existing = entry?.touchpoint_id ? data.touchpoints.find(t => t.id === entry.touchpoint_id) : null;
      const draft = { _draft: true, id: tpUid(), clientId: '', type: row.project_name === 'Meeting' ? 'Meeting' : 'Other', partner: myInitials || 'RJ', date: dateStr, status: 'completed', rating: 5, notes: entry?.note || '', contactIds: [], contactNames: [], leadIds: [], timeEntryId: entry?.id || `${user.id}|${dateStr}|${row.project_num}`, timeHours: Number(entry?.hours) || 0 };
      setTpFlow({ row, dateStr, entry, data, touchpoint: existing || draft });
    } catch (e) { flash(e.message || 'Could not open Marketing'); }
  };
  const entryKeyBody = (row, dateStr) => ({ user_id: user.id, work_date: dateStr, project_num: row.project_num, project_name: row.project_name, phase: row.phase || '' });
  const tagEntry = (row, dateStr, tpId) => setEntries(prev => prev.map(e => (rowKey(e) === rowKey(row) && e.work_date === dateStr) ? { ...e, touchpoint_id: tpId || null } : e));
  const saveTouchpointFromTime = async (t, extra) => {
    const f = tpFlow; if (!f) return;
    try {
      const plan = planTouchpointSave(t, extra, f.data.clients, f.data.proposals);
      for (const c of plan.newClients) await mktPost({ client: c });
      for (const p of plan.props) await mktPost({ proposal: p });
      await mktPost({ touchpoint: plan.touchpoint });
      if (plan.clientUpdate) await mktPost({ client: plan.clientUpdate });
      if (plan.relEntry) await mktPost({ relLog: plan.relEntry });
      if (f.entry?.touchpoint_id !== plan.touchpoint.id) {
        await post({ action: 'linkTouchpoint', ...entryKeyBody(f.row, f.dateStr), touchpoint_id: plan.touchpoint.id });
        tagEntry(f.row, f.dateStr, plan.touchpoint.id);
      }
      flash(f.entry?.touchpoint_id ? 'Touchpoint updated' : 'Logged as a touchpoint');
    } catch (e) { flash(e.message || 'Could not save the touchpoint'); }
  };
  const deleteTouchpointFromTime = async id => {
    const f = tpFlow; try { await mktPost({ deleteTouchpoint: id }); if (f) tagEntry(f.row, f.dateStr, null); flash('Touchpoint deleted'); } catch (e) { flash(e.message); }
  };
  // Blank-phase rows with no hours logged are replaced by the project's Master Data phases (rows with hours stay and ask for a phase)
  useEffect(() => {
    if (loading || cleaned.current || !Object.keys(mLines).length) return;
    const items = []; const seen = new Set();
    rows.filter(r => !acctByCode[r.project_num] && needsPhase(r)).forEach(r => { const n = String(r.project_num); if (!seen.has(n)) { seen.add(n); items.push({ project_num: n, lines: mLines[n] }); } });
    cleaned.current = true;
    if (!items.length) return;
    post({ action: 'expandBlankRows', user_id: user.id, items }).then(d => { if (d.rows) setRows(d.rows); }).catch(() => {});
  }, [loading, rows, mLines, needsPhase, acctByCode, user.id]);
  // Tick / untick a Work Plan task from here. Saves just that task's completed flag; the box updates at once and flips back with a message if the save fails.
  const [taskDone, setTaskDone] = useState({});
  const [taskPending, setTaskPending] = useState({});
  const taskKey = (g, t) => `${g.id}|${t.id || `${t.staff}|${t.task}|${t.week}`}`;
  const isDone = (g, t) => { const v = taskDone[taskKey(g, t)]; return v === undefined ? !!t.completed : v; };
  const toggleTask = async (g, t) => {
    const k = taskKey(g, t);
    if (taskPending[k]) return;
    const next = !isDone(g, t);
    setTaskDone(p => ({ ...p, [k]: next })); setTaskPending(p => ({ ...p, [k]: true }));
    try {
      const r = await fetch('/api/projects', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ setTaskCompleted: { projectId: g.id, taskId: t.id || null, staff: t.staff, task: t.task, week: t.week, completed: next } }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || d.success === false) throw new Error(d.error || 'Could not save');
    } catch (e) {
      setTaskDone(p => ({ ...p, [k]: !next })); flash(e.message || 'Could not save that task');
    }
    setTaskPending(p => { const n = { ...p }; delete n[k]; return n; });
  };
  // "Log time" from the Work Plan panel: open the entry window with that project already picked; date = today if it's in the viewed week, else Monday
  const logFromPlan = g => {
    const todayStr = fmtLocal(new Date());
    const inWeek = dates.some(d => fmtLocal(d) === todayStr);
    setModal({ mode: 'log', initial: { prefill: { project_num: g.projectNum, project_name: baseNames[g.projectNum] || g.projectName }, dateStr: inWeek ? todayStr : fmtLocal(dates[0]) } });
  };

  // "Log as time" from the Meetings panel: opens the entry window with date, hours and a written note filled in. Nothing is saved until the person picks the project and clicks Save.
  const logFromMeeting = m => setModal({ mode: 'log', initial: { dateStr: m.date, prefillHours: m.hours, prefillNote: m.noteText } });

  // add = true for Log time (adds to what is already on that line and day); false for editing a cell (replaces)
  const saveEntry = async (row, dateStr, hours, note, add = false) => {
    const targetMonday = getMonday(new Date(dateStr + 'T12:00:00'));
    const targetKey = getWeekKey(targetMonday);
    const saved = await post({ action: 'setEntry', user_id: user.id, initials: myInitials, work_date: dateStr, week_key: targetKey, project_num: row.project_num, project_name: row.project_name, phase: row.phase || '', hours, note, billable: row.billable !== false, ...(add ? { mode: 'add' } : {}) });
    if (!existingKeys.has(rowKey(row))) {
      const d = await post({ action: 'addRow', user_id: user.id, project_num: row.project_num, project_name: row.project_name, phase: row.phase || '' });
      setRows(prev => prev.some(r => rowKey(r) === rowKey(d.row)) ? prev : [...prev, d.row]);
    }
    if (targetKey !== weekKey) { onWeekChange?.(targetMonday); return {}; }
    setEntries(prev => {
      const k = `${rowKey(row)}||${dateStr}`;
      const others = prev.filter(e => `${rowKey(e)}||${e.work_date}` !== k);
      const e = saved?.entry;
      return hours > 0 ? [...others, { id: e?.id, user_id: user.id, work_date: dateStr, week_key: weekKey, project_num: row.project_num, project_name: row.project_name, phase: row.phase || '', hours: e ? Number(e.hours) : hours, note: e ? e.note : note, billable: row.billable !== false, touchpoint_id: e?.touchpoint_id || null }] : others;
    });
    return { entry: saved?.entry };
  };
  const addRow = async r => {
    const d = await post({ action: 'addRow', user_id: user.id, project_num: r.project_num, project_name: r.project_name, phase: r.phase || '' });
    setRows(prev => prev.some(x => rowKey(x) === rowKey(d.row)) ? prev : [...prev, d.row]);
  };
  const addAssigned = async () => {
    try { const d = await post({ action: 'addRows', user_id: user.id, rows: assigned }); setRows(prev => { const keys = new Set(prev.map(rowKey)); return [...prev, ...(d.rows || []).filter(r => !keys.has(rowKey(r)))]; }); } catch (e) { flash(e.message); }
  };
  const changePhase = async (row, dest) => {
    await post({ action: 'changePhase', user_id: user.id, project_num: row.project_num, project_name: row.project_name, phase: row.phase || '', new_project_name: dest.project_name || '', new_phase: dest.phase || '' });
    load();
  };
  const copyLastWeek = async () => {
    try {
      const d = await post({ action: 'copyRows', user_id: user.id, week_key: weekKey });
      if (d.rows) setRows(d.rows);
      flash(d.added > 0 ? `Added ${d.added} row${d.added === 1 ? '' : 's'} from last week` : (d.hadRows ? 'Last week\'s rows are already on your sheet' : 'No time was logged last week'));
    } catch (e) { flash(e.message); }
  };
  const removeRow = async r => {
    const lbl = rowLabel(r, acctByCode, baseNames);
    if (!confirm(`Remove ${lbl.title}${lbl.internal ? '' : ` (${lbl.sub})`} from your sheet? Logged hours are kept.`)) return;
    try { await post({ action: 'removeRow', user_id: user.id, row_id: r.id }); setRows(prev => prev.filter(x => x.id !== r.id)); } catch (e) { flash(e.message); }
  };
  const submit = async () => {
    if (weekTotal === 0 && !confirm('Submit a week with zero hours?')) return;
    try { const d = await post({ action: 'submit', user_id: user.id, week_key: weekKey }); setWeek(d.week); } catch (e) { flash(e.message); }
  };
  const unsubmit = async () => { try { const d = await post({ action: 'unsubmit', user_id: user.id, week_key: weekKey }); setWeek(d.week); } catch (e) { flash(e.message); } };

  if (loading || !week) return <Loading>Loading your time...</Loading>;
  const toggleCls = on => 'h-9 px-3 text-xs ' + (on ? 'bg-ground border-ink' : '');

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3 flex-wrap">
          {!locked && <Button onClick={() => setModal({ mode: 'log' })}>+ Log Time</Button>}
          <StatusPill status={status} />
          {status === 'submitted' && week.submitted_at && <span className="text-xs text-muted">Submitted {fmtStamp(week.submitted_at)}</span>}
          {status === 'approved' && <span className="text-xs text-muted">Approved by {week.approved_by} · {fmtStamp(week.approved_at)}</span>}
          {status === 'returned' && <span className="text-xs text-status-red font-bold">Returned by {week.approved_by}{week.return_note ? `: "${week.return_note}"` : ''} — fix and resubmit</span>}
          {msg && <span className="text-xs text-status-red font-bold">{msg}</span>}
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button type="button" onClick={() => setMeetOpen(o => !o)} aria-pressed={meetOpen} className={`inline-flex items-center h-9 px-3 text-xs font-bold rounded-[3px] border ${meetOpen ? 'bg-ground border-ink text-ink' : 'bg-white border-rule text-ink hover:border-ink'}`}>Meetings</button>
          <button type="button" onClick={togglePlan} aria-pressed={planOpen} className={`inline-flex items-center h-9 px-3 text-xs font-bold rounded-[3px] border ${planOpen ? 'bg-ground border-ink text-ink' : 'bg-white border-rule text-ink hover:border-ink'}`}>Work Plan{plan.taskCount > 0 ? ` (${plan.taskCount})` : ''}</button>
          {!locked && <Button variant="secondary" onClick={submit} className="h-9 px-3 text-xs">Submit Week</Button>}
          {status === 'submitted' && <Button variant="secondary" onClick={unsubmit} className="h-9 px-3 text-xs">Pull Back</Button>}
          {status === 'approved' && <span className="text-xs text-muted">Locked — ask your approver to reopen</span>}
        </div>
      </div>

      <div className="flex flex-col lg:flex-row gap-4 items-start">
        <div className="flex-1 min-w-0 w-full space-y-3">
          {!locked && assigned.length > 0 && (
            <div className="flex items-center justify-between bg-white border border-rule rounded px-4 py-2.5">
              <div className="text-sm">You're on {assignedProjects} Work Plan project{assignedProjects > 1 ? 's' : ''} not on your sheet: <span className="text-muted">{[...new Set(assigned.map(a => a.project_num))].slice(0, 3).join(', ')}{assignedProjects > 3 ? '…' : ''}</span></div>
              <Link onClick={addAssigned} className="text-xs">Add them</Link>
            </div>
          )}

          <WeekGrid rows={rows} entries={entries} dates={dates} locked={locked} acctByCode={acctByCode} baseNames={baseNames} needsPhase={needsPhase}
            onCellClick={(row, dateStr, entry) => setModal({ mode: 'cell', initial: { row, dateStr, entry } })} onRemoveRow={removeRow} onEditPhase={r => setPhaseFor(r)} />

          <div className="flex items-center justify-between gap-4 px-1 flex-wrap">
            {!locked ? <div className="flex items-center gap-4"><Link onClick={() => setModal({ mode: 'row' })}>+ Add row</Link><button type="button" data-copy-rows="1" onClick={copyLastWeek} className="text-[13px] text-muted hover:text-accent hover:underline" title="Adds last week's rows to this sheet. No hours are copied.">Copy last week's rows</button></div> : <span />}
            <span className="text-xs text-muted">Supabase time entries · Master Data phases{loadedAt ? ` · loaded ${fmtClock(loadedAt)}` : ''}</span>
          </div>
          <Note>Log Time adds hours to any project or internal account. Click a cell to edit. Quarter-hour increments. Notes are required on project time. Rows stay on your sheet until you remove them. Click a project to open its phases; the pencil on a phase changes it.</Note>
        </div>
        {meetOpen && <MeetingsPanel state={meet} entries={entries} canLog={!locked} onLog={logFromMeeting} onClose={() => setMeetOpen(false)} />}
        {planOpen && <WorkPlanPanel plan={plan} entries={entries} weekTotal={weekTotal} canLog={!locked} onLog={logFromPlan} onClose={togglePlan} isDone={isDone} onToggle={toggleTask} pending={(g, t) => !!taskPending[taskKey(g, t)]} />}
      </div>

      {phaseFor && <PhaseModal row={phaseFor} options={phaseChoices(phaseFor)} existingKeys={existingKeys} onSave={changePhase} onClose={() => setPhaseFor(null)} />}
      {modal && <EntryModal mode={modal.mode} initial={modal.initial} masterData={masterData} accounts={accounts} existingKeys={existingKeys} onSave={saveEntry} onAddRow={addRow} onTouchpoint={openTouchpoint} onClose={() => setModal(null)} />}
      {tpFlow && <TouchpointModal clients={tpFlow.data.clients} proposals={tpFlow.data.proposals} touchpoint={tpFlow.touchpoint} onSave={saveTouchpointFromTime} onDelete={deleteTouchpointFromTime} onClose={() => setTpFlow(null)} />}
    </div>
  );
}

// ═══ APPROVALS ════════════════════════════════════════════════════
// "My team" = everyone on a Work Plan project where I am the principal or a partner in charge (teamMembers + principal + partners).
function teamOf(projects, me) {
  const s = new Set();
  if (!me) return s;
  (projects || []).forEach(p => {
    if (p.principal === me || (p.partnersInCharge || []).includes(me)) {
      (p.teamMembers || []).forEach(i => i && s.add(i));
      (p.partnersInCharge || []).forEach(i => i && s.add(i));
      if (p.principal) s.add(p.principal);
    }
  });
  return s;
}

function ApprovalsView({ profile, weekKey, monday, acctByCode, projects }) {
  const [people, setPeople] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadedAt, setLoadedAt] = useState(null);
  const [open, setOpen] = useState(null);
  const [detail, setDetail] = useState(null);
  const [officeFilter, setOfficeFilter] = useState('all');
  const [hideEmpty, setHideEmpty] = useState(false);
  const [returnFor, setReturnFor] = useState(null);
  const [returnNote, setReturnNote] = useState('');
  const dates = useMemo(() => weekDates(monday), [monday]);
  // Principals start on their team; everyone else starts firm-wide. The toggle always offers both.
  const [scope, setScope] = useState(profile?.role === 'principal' ? 'team' : 'all');
  const team = useMemo(() => teamOf(projects, profile?.initials), [projects, profile?.initials]);
  const teamKnown = team.size > 0;

  const load = useCallback(() => {
    setLoading(true);
    getJSON(`/api/time?view=approvals&week_key=${weekKey}`).then(d => { setPeople(d.people || []); setLoadedAt(new Date()); setLoading(false); }).catch(() => setLoading(false));
  }, [weekKey]);
  useEffect(() => { load(); setOpen(null); setDetail(null); }, [load]);
  useEffect(() => { if (!open) { setDetail(null); return; } getJSON(`/api/time?view=person&user_id=${open}&week_key=${weekKey}`).then(setDetail).catch(() => setDetail(null)); }, [open, weekKey]);

  const act = async (action, p, extra = {}) => {
    try { await post({ action, user_id: p.user_id, week_key: weekKey, approved_by: profile?.initials || '', ...extra }); load(); setReturnFor(null); setReturnNote(''); } catch (e) { alert(e.message); }
  };

  const offices = useMemo(() => [...new Set(people.map(p => p.office).filter(Boolean))], [people]);
  const shown = people
    .filter(p => scope !== 'team' || team.has(p.initials))
    .filter(p => officeFilter === 'all' || p.office === officeFilter)
    .filter(p => !hideEmpty || p.hours > 0);
  const counts = { submitted: people.filter(p => p.status === 'submitted').length, approved: people.filter(p => p.status === 'approved').length, missing: people.filter(p => p.hours === 0).length };

  if (loading) return <Loading>Loading approvals...</Loading>;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3 text-xs text-muted flex-wrap">
          <span><Pill kind="outline">{counts.submitted}</Pill> awaiting approval</span>
          <span><Pill kind="solid">{counts.approved}</Pill> approved</span>
          <span><Pill kind="outline">{counts.missing}</Pill> no hours</span>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex border border-ink rounded-[3px] overflow-hidden" role="group" aria-label="Who to show">
            <button type="button" onClick={() => setScope('team')} aria-pressed={scope === 'team'} title={teamKnown ? `${team.size} people on your Work Plan projects` : 'No team found on the Work Plan for you'} className={`h-[38px] px-3 text-xs font-bold ${scope === 'team' ? 'bg-ink text-white' : 'bg-white text-ink hover:bg-ground'}`}>My team{teamKnown ? ` (${team.size})` : ''}</button>
            <button type="button" onClick={() => setScope('all')} aria-pressed={scope === 'all'} className={`h-[38px] px-3 text-xs font-bold border-l border-ink ${scope === 'all' ? 'bg-ink text-white' : 'bg-white text-ink hover:bg-ground'}`}>Everyone</button>
          </div>
          {offices.length > 1 && <Select value={officeFilter} onChange={e => setOfficeFilter(e.target.value)}><option value="all">All offices</option>{offices.map(o => <option key={o} value={o}>{o}</option>)}</Select>}
          <label className="text-xs text-muted flex items-center gap-1.5"><input type="checkbox" checked={hideEmpty} onChange={e => setHideEmpty(e.target.checked)} /> Hide zero-hour</label>
        </div>
      </div>

      <Panel title="Timesheets" meta={<span>Supabase time weeks{loadedAt ? ` · loaded ${fmtClock(loadedAt)}` : ''}</span>}>
        <div className="overflow-x-auto">
          <table className="of-table w-full border-collapse">
            <thead><tr>
              <th>Person</th><th>Office</th><th className="text-right">Hours</th><th className="text-right">Project %</th><th>Status</th><th className="text-right">Actions</th>
            </tr></thead>
            <tbody>
              {shown.map(p => {
                const pct = p.hours > 0 ? Math.round(p.billable / p.hours * 100) : 0;
                const isOpen = open === p.user_id;
                const mine = p.initials && p.initials === profile?.initials;
                return (
                  <React.Fragment key={p.user_id}>
                    <tr className={`hover:bg-ground ${mine ? 'of-mine' : ''} ${isOpen ? 'bg-ground' : ''}`}>
                      <td className="cursor-pointer" onClick={() => setOpen(isOpen ? null : p.user_id)}><span>{p.display_name}</span> <span className="text-xs text-muted">{p.initials}</span></td>
                      <td className="text-xs text-muted">{p.office}</td>
                      <td className={`text-right font-bold ${p.hours === 0 ? 'text-rule' : p.hours < 32 ? 'text-status-amber' : ''}`}>{fmtH(p.hours) || '0'}</td>
                      <td className="text-right text-xs text-muted">{p.hours > 0 ? `${pct}%` : '—'}</td>
                      <td><StatusPill status={p.status} />{p.status === 'returned' && p.return_note && <span className="text-xs text-muted ml-2">“{p.return_note}”</span>}</td>
                      <td className="text-right whitespace-nowrap">
                        {p.status === 'submitted' && <>
                          <Button onClick={() => act('approve', p)} className="h-7 px-2.5 text-xs mr-1">Approve</Button>
                          <Button variant="secondary" onClick={() => { setReturnFor(p.user_id); setReturnNote(''); }} className="h-7 px-2.5 text-xs">Return</Button>
                        </>}
                        {p.status === 'approved' && <Link onClick={() => { if (confirm(`Reopen ${p.display_name}'s week?`)) act('reopen', p); }} className="text-xs">Reopen</Link>}
                        {(p.status === 'draft' || p.status === 'returned') && <span className="text-xs text-rule">—</span>}
                      </td>
                    </tr>
                    {returnFor === p.user_id && (
                      <tr><td colSpan={6} className="bg-ground">
                        <div className="flex items-center gap-2">
                          <Input autoFocus value={returnNote} onChange={e => setReturnNote(e.target.value)} placeholder="What needs fixing?" className="flex-1" onKeyDown={e => { if (e.key === 'Enter') act('return', p, { note: returnNote }); if (e.key === 'Escape') setReturnFor(null); }} />
                          <Button variant="danger" onClick={() => act('return', p, { note: returnNote })} className="h-[38px] px-3 text-xs">Return to {p.initials}</Button>
                          <button type="button" onClick={() => setReturnFor(null)} className="text-xs text-muted hover:text-ink">Cancel</button>
                        </div>
                      </td></tr>
                    )}
                    {isOpen && (
                      <tr><td colSpan={6} className="bg-ground !py-3">
                        {detail ? <WeekGrid rows={detail.rows || []} entries={detail.entries || []} dates={dates} locked readOnly acctByCode={acctByCode} /> : <div className="text-xs text-muted animate-pulse py-4 text-center">Loading...</div>}
                      </td></tr>
                    )}
                  </React.Fragment>
                );
              })}
              {shown.length === 0 && <tr><td colSpan={6}><Empty>{scope === 'team' && !teamKnown ? 'No team found — you are not the principal or partner in charge on any Work Plan project. Switch to Everyone.' : 'Nobody matches'}</Empty></td></tr>}
            </tbody>
          </table>
        </div>
      </Panel>
      <Note>Click a name to see their sheet. Hover a cell for the note. Returning a week unlocks it with your note attached. My team = people on Work Plan projects where you are the principal or a partner in charge.</Note>
    </div>
  );
}

// ═══ FIRM REPORT ══════════════════════════════════════════════════
function FirmView({ masterData, config }) {
  const [monthOffset, setMonthOffset] = useState(0);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadedAt, setLoadedAt] = useState(null);
  const [tab, setTab] = useState('projects');
  const isPartner = !!config?.isPartner;

  const range = useMemo(() => {
    const now = new Date(); const first = new Date(now.getFullYear(), now.getMonth() + monthOffset, 1); const last = new Date(now.getFullYear(), now.getMonth() + monthOffset + 1, 0);
    return { start: fmtLocal(first), end: fmtLocal(last), label: first.toLocaleDateString('en-US', { month: 'long', year: 'numeric' }) };
  }, [monthOffset]);

  useEffect(() => { setLoading(true); getJSON(`/api/time?view=report&start=${range.start}&end=${range.end}`).then(d => { setData(d); setLoadedAt(new Date()); setLoading(false); }).catch(() => setLoading(false)); }, [range]);

  const mdMap = useMemo(() => { const m = {}; (masterData || []).forEach(r => { m[`${r['Project #']}||${String(r['Project Name'] || '').trim()}||${r['Phase'] || ''}`] = r; m[`${r['Project #']}||${r['Phase'] || ''}`] = m[`${r['Project #']}||${r['Phase'] || ''}`] || r; }); return m; }, [masterData]);
  const projects = data?.byProject || [];
  const people = data?.byPerson || [];
  const groups = data?.byAccountGroup || [];
  const totals = useMemo(() => {
    const t = { hours: 0, project: 0, billed: 0, cost: 0 };
    people.forEach(p => { t.hours += p.hours; t.project += p.billable_hours; t.billed += p.billed; t.cost += p.cost; });
    return t;
  }, [people]);
  const mult = (billed, cost) => cost > 0 ? billed / cost : null;
  const multCls = m => m == null ? 'text-rule' : m < 2.5 ? 'text-status-amber' : '';
  const R = 'text-right';
  const meta = <span>Supabase time entries · Master Data fees{loadedAt ? ` · loaded ${fmtClock(loadedAt)}` : ''}</span>;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-1">
            <Button variant="secondary" onClick={() => setMonthOffset(m => m - 1)} className="h-9 px-3" title="Previous month">←</Button>
            <Button variant="secondary" onClick={() => setMonthOffset(0)} disabled={monthOffset === 0} className="h-9 px-3">{range.label}</Button>
            <Button variant="secondary" onClick={() => setMonthOffset(m => m + 1)} className="h-9 px-3" title="Next month">→</Button>
          </div>
          <div className="text-xs text-muted">
            {fmtH(totals.hours) || 0} hrs · {totals.hours > 0 ? Math.round(totals.project / totals.hours * 100) : 0}% project · billed value {fmt$(totals.billed)}
            {isPartner && totals.cost > 0 && <> · cost {fmt$(totals.cost)} · <span className={`font-bold ${multCls(mult(totals.billed, totals.cost))}`}>{fmtX(mult(totals.billed, totals.cost))}</span></>}
          </div>
        </div>
      </div>
      <Tabs tabs={[{ id: 'projects', label: 'By Project' }, { id: 'people', label: 'By Person' }, { id: 'overhead', label: 'Overhead' }]} value={tab} onChange={setTab} />

      {loading ? <Loading>Loading report...</Loading> : (
        <Panel title={range.label} meta={meta}>
          <div className="overflow-x-auto">
          {tab === 'projects' && (
            <table className="of-table w-full border-collapse">
              <thead><tr>
                <th>Project / Phase</th><th className={R}>Hours</th><th>People</th><th className={R}>Rates</th><th className={R}>Billed value</th><th className={R}>Fee</th><th className={R}>Fee spent</th><th className={R}>Billed %</th>
                {isPartner && <><th className={R}>Cost</th><th className={R}>Mult</th></>}
              </tr></thead>
              <tbody>
                {projects.filter(p => p.billable).map(p => {
                  const md = mdMap[`${p.project_num}||${p.phase || ''}`];
                  const fee = md ? Number(md['Fee']) || 0 : 0;
                  const prevBilled = md ? Number(md['Previously Billed']) || 0 : 0;
                  const nonFee = PROJECT_TASKS.includes(p.phase);
                  const spentPct = fee > 0 ? p.billed / fee * 100 : null;
                  const billedPct = fee > 0 ? prevBilled / fee * 100 : null;
                  const m = mult(p.billed, p.cost);
                  return (
                    <tr key={`${p.project_num}||${p.phase}`}>
                      <td><div>{p.project_num} {p.project_name}</div><div className="text-xs text-muted">{p.phase || '—'}{nonFee ? ' · non-fee' : ''}{!md && !nonFee && <span className="text-status-amber ml-1">· not in Master Data</span>}</div></td>
                      <td className={`${R} font-bold`}>{fmtH(p.hours)}</td>
                      <td className="text-xs text-muted">{Object.entries(p.people).sort((a, b) => b[1] - a[1]).map(([i, h]) => `${i} ${fmtH(h)}`).join(' · ')}</td>
                      <td className={`${R} text-xs text-muted`}>{p.schedule_year || '—'}</td>
                      <td className={R}>{fmt$(p.billed)}</td>
                      <td className={`${R} text-xs text-muted`}>{fee ? fmt$(fee) : '—'}</td>
                      <td className={`${R} text-xs font-bold ${spentPct == null ? 'text-rule' : spentPct > 100 ? 'text-status-red' : spentPct > 80 ? 'text-status-amber' : 'text-muted'}`}>{spentPct == null ? '—' : `${Math.round(spentPct)}%`}</td>
                      <td className={`${R} text-xs text-muted`}>{billedPct == null ? '—' : `${Math.round(billedPct)}%`}</td>
                      {isPartner && <>
                        <td className={`${R} text-xs`}>{p.cost ? fmt$(p.cost) : '—'}</td>
                        <td className={`${R} text-xs font-bold ${multCls(m)}`}>{fmtX(m)}</td>
                      </>}
                    </tr>
                  );
                })}
                {projects.filter(p => p.billable).length === 0 && <tr><td colSpan={isPartner ? 10 : 8}><Empty>No project hours in {range.label}</Empty></td></tr>}
              </tbody>
            </table>
          )}
          {tab === 'people' && (
            <table className="of-table w-full border-collapse">
              <thead><tr>
                <th>Person</th><th>Title</th><th className={R}>Hours</th><th className={R}>Project hrs</th><th className={R}>Utilization</th><th className={R}>Billed value</th>
                {isPartner && <><th className={R}>Cost</th><th className={R}>Mult</th></>}
              </tr></thead>
              <tbody>
                {people.map(p => { const u = p.hours > 0 ? p.billable_hours / p.hours * 100 : 0; const m = mult(p.billed, p.cost); return (
                  <tr key={p.initials}>
                    <td>{p.display_name} <span className="text-xs text-muted">{p.initials}</span></td>
                    <td className="text-xs text-muted">{p.rate_title || <span className="text-status-amber">no title</span>}</td>
                    <td className={`${R} font-bold`}>{fmtH(p.hours)}</td>
                    <td className={R}>{fmtH(p.billable_hours) || '0'}</td>
                    <td className={`${R} text-xs font-bold ${u < 60 ? 'text-status-amber' : 'text-muted'}`}>{Math.round(u)}%</td>
                    <td className={R}>{fmt$(p.billed)}</td>
                    {isPartner && <>
                      <td className={`${R} text-xs`}>{p.cost ? fmt$(p.cost) : '—'}</td>
                      <td className={`${R} text-xs font-bold ${multCls(m)}`}>{fmtX(m)}</td>
                    </>}
                  </tr>
                ); })}
                {people.length === 0 && <tr><td colSpan={isPartner ? 8 : 6}><Empty>No hours logged in {range.label}</Empty></td></tr>}
              </tbody>
            </table>
          )}
          {tab === 'overhead' && (
            <table className="of-table w-full border-collapse">
              <thead><tr><th>Group</th><th className={R}>Hours</th><th className={R}>% of all hours</th>{isPartner && <th className={R}>Cost</th>}</tr></thead>
              <tbody>
                {groups.map(g => (
                  <tr key={g.group}>
                    <td>{g.group}</td>
                    <td className={`${R} font-bold`}>{fmtH(g.hours)}</td>
                    <td className={`${R} text-xs text-muted`}>{totals.hours > 0 ? Math.round(g.hours / totals.hours * 100) : 0}%</td>
                    {isPartner && <td className={`${R} text-xs`}>{g.cost ? fmt$(g.cost) : '—'}</td>}
                  </tr>
                ))}
                {projects.filter(p => !p.billable).length > 0 && <tr className="bg-ground"><td colSpan={isPartner ? 4 : 3} className="!py-1 text-[10px] tracking-[0.08em] text-muted uppercase">By account</td></tr>}
                {projects.filter(p => !p.billable).map(p => (
                  <tr key={p.project_num}>
                    <td className="text-xs">{p.project_name} <span className="text-muted">{p.project_num}</span></td>
                    <td className={R}>{fmtH(p.hours)}</td>
                    <td className={`${R} text-xs text-muted`}>{Object.entries(p.people).sort((a, b) => b[1] - a[1]).map(([i, h]) => `${i} ${fmtH(h)}`).join(' · ')}</td>
                    {isPartner && <td className={`${R} text-xs`}>{p.cost ? fmt$(p.cost) : '—'}</td>}
                  </tr>
                ))}
                {groups.length === 0 && <tr><td colSpan={isPartner ? 4 : 3}><Empty>No internal hours in {range.label}</Empty></td></tr>}
              </tbody>
            </table>
          )}
          </div>
        </Panel>
      )}
      <Note>Billed value = hours × the fee-chart rate for each person's title, using the chart in effect for the project's year (or an override). Fee, Billed % from Master Data. Fee spent = billed value ÷ fee for this month only. {isPartner ? 'Cost = hours × loaded cost rate; blank rates count as $0. Mult = billed value ÷ cost.' : ''}</Note>
    </div>
  );
}

// ═══ RATES ADMIN ══════════════════════════════════════════════════
function RatesView({ profile, masterData, config, onConfigChange }) {
  const [tab, setTab] = useState('people');
  const [msg, setMsg] = useState('');
  const [ovrNum, setOvrNum] = useState('');
  const [ovrYear, setOvrYear] = useState('');
  const [ovrNote, setOvrNote] = useState('');
  const [acct, setAcct] = useState({ code: '', group_name: '', name: '' });
  const role = profile?.role;
  const isPartner = !!config?.isPartner;
  const canTitles = ['partner', 'office'].includes(role);
  const canOverrides = ['partner', 'operations', 'office'].includes(role);
  const schedules = config?.schedules || [];
  const currentYear = schedules.length ? schedules[schedules.length - 1].effective_year : null;
  const flash = t => { setMsg(t); setTimeout(() => setMsg(''), 3000); };

  const projectsByNum = useMemo(() => { const m = {}; (masterData || []).forEach(r => { const n = String(r['Project #']); if (!m[n]) m[n] = r['Project Name']; }); return m; }, [masterData]);
  const autoYear = num => { const y = yearFromProjectNum(num); if (y == null) return currentYear; let pick = null; schedules.forEach(s => { if (s.effective_year <= y) pick = s.effective_year; }); return pick ?? schedules[0]?.effective_year; };

  const setTitle = async (p, rate_title) => { try { await post({ action: 'setTitle', user_id: p.user_id, rate_title }); onConfigChange(); } catch (e) { flash(e.message); } };
  const setCost = async (p, v) => { try { await post({ action: 'setCostRate', user_id: p.user_id, cost_rate: v }); onConfigChange(); } catch (e) { flash(e.message); } };
  const addOverride = async () => {
    if (!ovrNum.trim() || !ovrYear) { flash('Project number and year required'); return; }
    try { await post({ action: 'setOverride', project_num: ovrNum.trim(), schedule_year: Number(ovrYear), note: ovrNote }); setOvrNum(''); setOvrYear(''); setOvrNote(''); onConfigChange(); } catch (e) { flash(e.message); }
  };
  const removeOverride = async num => { if (!confirm(`Remove override for ${num}?`)) return; try { await post({ action: 'removeOverride', project_num: num }); onConfigChange(); } catch (e) { flash(e.message); } };
  const saveAccount = async a => { try { await post({ action: 'saveAccount', ...a }); onConfigChange(); } catch (e) { flash(e.message); } };
  const addAccount = async () => { if (!acct.code || !acct.name) { flash('Code and name required'); return; } await saveAccount({ ...acct, active: true }); setAcct({ code: '', group_name: '', name: '' }); };

  const R = 'text-right';
  const meta = <span>Supabase rate_schedules · staff_profiles · time_accounts</span>;
  const CostInput = ({ p }) => { const [v, setV] = useState(p.cost_rate ?? ''); useEffect(() => { setV(p.cost_rate ?? ''); }, [p.cost_rate]); return <Input type="number" step="0.01" min="0" value={v} onChange={e => setV(e.target.value)} onBlur={() => { if (String(v) !== String(p.cost_rate ?? '')) setCost(p, v); }} className="w-24 h-8 text-xs text-right" placeholder="—" />; };

  return (
    <div className="space-y-3">
      <Tabs tabs={[{ id: 'people', label: 'People & Titles' }, { id: 'schedules', label: 'Fee Charts' }, { id: 'overrides', label: 'Project Overrides' }, { id: 'accounts', label: 'Time Accounts' }]} value={tab} onChange={setTab}
        right={msg ? <span className="text-xs text-status-red font-bold">{msg}</span> : null} />

      {tab === 'people' && (
        <Panel title="People & titles" meta={meta}>
          <div className="overflow-x-auto">
          <table className="of-table w-full border-collapse">
            <thead><tr><th>Person</th><th>Office</th><th>Hub role</th><th>Rate title</th><th className={R}>{currentYear} rate</th>{isPartner && <th className={R}>Loaded cost /hr</th>}</tr></thead>
            <tbody>
              {(config?.people || []).map(p => {
                const s = schedules[schedules.length - 1];
                const col = { 'Partner': 'partner', 'Principal': 'principal', 'Project Manager': 'project_manager', 'Senior Project Designer': 'senior_project_designer', 'Project Designer': 'project_designer', 'Office Manager': 'office_manager', 'CDAM': 'senior_project_designer', 'Marketing Manager': 'senior_project_designer', 'Marketing Coordinator': 'project_designer' }[p.rate_title];
                return (
                  <tr key={p.user_id} className={p.initials === profile?.initials ? 'of-mine' : ''}>
                    <td>{p.display_name} <span className="text-xs text-muted">{p.initials}</span></td>
                    <td className="text-xs text-muted">{p.office}</td>
                    <td className="text-xs text-muted capitalize">{p.role}</td>
                    <td>
                      {canTitles ? (
                        <Select value={p.rate_title || ''} onChange={e => setTitle(p, e.target.value)} className={`h-8 text-xs ${p.rate_title ? '' : 'border-status-amber text-status-amber'}`}>
                          <option value="">— none —</option>
                          {(config?.titles || []).map(t => <option key={t} value={t}>{t}</option>)}
                        </Select>
                      ) : <span className="text-xs">{p.rate_title || '—'}</span>}
                    </td>
                    <td className={`${R} text-xs`}>{s && col ? `$${Number(s[col])}` : '—'}</td>
                    {isPartner && <td className={R}><CostInput p={p} /></td>}
                  </tr>
                );
              })}
            </tbody>
          </table>
          </div>
          <p className="px-5 py-3 text-xs text-muted">CDAM and Marketing Manager bill at the SPD rate, Marketing Coordinator at PD. {isPartner ? 'Loaded cost = (salary + benefits + payroll tax) ÷ 2,080. Partners only; saved on blur.' : ''}</p>
        </Panel>
      )}

      {tab === 'schedules' && (
        <Panel title="Fee charts" meta={meta}>
          <div className="overflow-x-auto">
          <table className="of-table w-full border-collapse">
            <thead><tr><th>Chart</th><th className={R}>Partner</th><th className={R}>Principal</th><th className={R}>PM</th><th className={R}>SPD</th><th className={R}>PD</th><th className={R}>Office Mgr</th><th>Notes</th></tr></thead>
            <tbody>
              {schedules.map(s => (
                <tr key={s.effective_year}>
                  <td>{s.label}{s.effective_year === currentYear && <Pill kind="solid" className="ml-2">Current</Pill>}</td>
                  {['partner', 'principal', 'project_manager', 'senior_project_designer', 'project_designer', 'office_manager'].map(c => <td key={c} className={R}>${Number(s[c])}</td>)}
                  <td className="text-xs text-muted">{s.notes || ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
          <p className="px-5 py-3 text-xs text-muted">A project uses the chart for its year (first two digits of the project number). PR and non-numeric projects use the current chart. New charts are added in Supabase → rate_schedules.</p>
        </Panel>
      )}

      {tab === 'overrides' && (
        <div className="space-y-3">
          {canOverrides && (
            <Panel pad>
              <div className="flex items-end gap-3 flex-wrap">
                <div><Label>Project #</Label><Input value={ovrNum} onChange={e => setOvrNum(e.target.value)} placeholder="242424" className="w-32" /></div>
                <div><Label>Use chart</Label><Select value={ovrYear} onChange={e => setOvrYear(e.target.value)}><option value="">—</option>{schedules.map(s => <option key={s.effective_year} value={s.effective_year}>{s.effective_year}</option>)}</Select></div>
                <div className="flex-1 min-w-[200px]"><Label>Why</Label><Input value={ovrNote} onChange={e => setOvrNote(e.target.value)} placeholder="Proposal went out under 2023 rates" className="w-full" /></div>
                <Button onClick={addOverride} className="h-[38px]">Set override</Button>
                {ovrNum.trim() && <div className="w-full text-xs text-muted">{projectsByNum[ovrNum.trim()] ? `${projectsByNum[ovrNum.trim()]} · ` : <span className="text-status-amber">Not in Master Data · </span>}would default to {autoYear(ovrNum.trim())}</div>}
              </div>
            </Panel>
          )}
          <Panel title="Project overrides" meta={meta}>
            <div className="overflow-x-auto">
            <table className="of-table w-full border-collapse">
              <thead><tr><th>Project</th><th className={R}>Default</th><th className={R}>Override</th><th>Why</th><th>Set by</th><th className={R}></th></tr></thead>
              <tbody>
                {(config?.overrides || []).map(o => (
                  <tr key={o.project_num}>
                    <td>{o.project_num} <span className="text-xs text-muted">{projectsByNum[o.project_num] || ''}</span></td>
                    <td className={`${R} text-xs text-muted`}>{autoYear(o.project_num)}</td>
                    <td className={`${R} font-bold`}>{o.schedule_year}</td>
                    <td className="text-xs text-muted">{o.note || ''}</td>
                    <td className="text-xs text-muted">{o.set_by} · {fmtStamp(o.updated_at)}</td>
                    <td className={R}>{canOverrides && <button type="button" onClick={() => removeOverride(o.project_num)} className="text-xs text-muted hover:text-status-red">Remove</button>}</td>
                  </tr>
                ))}
                {(config?.overrides || []).length === 0 && <tr><td colSpan={6}><Empty>No overrides — every project is using its year's chart</Empty></td></tr>}
              </tbody>
            </table>
            </div>
          </Panel>
        </div>
      )}

      {tab === 'accounts' && (
        <div className="space-y-3">
          {canTitles && (
            <Panel pad>
              <div className="flex items-end gap-3 flex-wrap">
                <div><Label>Code</Label><Input value={acct.code} onChange={e => setAcct({ ...acct, code: e.target.value })} placeholder="128" className="w-20" /></div>
                <div><Label>Group</Label><Input value={acct.group_name} onChange={e => setAcct({ ...acct, group_name: e.target.value })} placeholder="Business Dev" list="acct-groups" className="w-44" /><datalist id="acct-groups">{[...new Set((config?.accounts || []).map(a => a.group_name))].map(g => <option key={g} value={g} />)}</datalist></div>
                <div className="flex-1 min-w-[200px]"><Label>Name</Label><Input value={acct.name} onChange={e => setAcct({ ...acct, name: e.target.value })} placeholder="Client Entertainment" className="w-full" /></div>
                <Button onClick={addAccount} className="h-[38px]">Add account</Button>
              </div>
            </Panel>
          )}
          <Panel title="Time accounts" meta={meta}>
            <div className="overflow-x-auto">
            <table className="of-table w-full border-collapse">
              <thead><tr><th>Code</th><th>Group</th><th>Name</th><th className={R}>Active</th></tr></thead>
              <tbody>
                {(config?.accounts || []).map(a => (
                  <tr key={a.code} className={a.active === false ? 'opacity-40' : ''}>
                    <td className="font-mono text-xs">{a.code}</td>
                    <td className="text-xs text-muted">{a.group_name}</td>
                    <td>{a.name}</td>
                    <td className={R}>{canTitles ? <input type="checkbox" checked={a.active !== false} onChange={e => saveAccount({ ...a, active: e.target.checked })} /> : <span className="text-xs text-muted">{a.active === false ? 'no' : 'yes'}</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
            <p className="px-5 py-3 text-xs text-muted">Inactive accounts disappear from the picker but keep their history.</p>
          </Panel>
        </div>
      )}
    </div>
  );
}

// ═══ PAGE ═════════════════════════════════════════════════════════
const VIEW_TITLE = { me: 'My Time', approvals: 'Approvals', firm: 'Firm Hours', rates: 'Rates & Accounts' };

function TimeApp({ user, profile, masterData, projects, config, reloadConfig }) {
  const role = profile?.role || 'staff';
  const canApprove = APPROVERS.includes(role);
  const canFirm = FIRM_VIEW.includes(role);
  const canRates = LEADERSHIP.includes(role);
  const [view, setView] = useState(() => qp('view', 'me'));
  const [weekOffset, setWeekOffset] = useState(0);
  const monday = useMemo(() => { const m = getMonday(new Date()); m.setDate(m.getDate() + weekOffset * 7); return m; }, [weekOffset]);
  const weekKey = getWeekKey(monday);
  const jumpToWeek = target => { const base = getMonday(new Date()); setWeekOffset(Math.round((target - base) / (7 * 86400000))); };
  const accounts = config?.accounts || [];
  const acctByCode = useMemo(() => { const m = {}; accounts.forEach(a => { m[a.code] = a; }); return m; }, [accounts]);
  const weekly = ['me', 'approvals'].includes(view);

  const tabs = [{ id: 'me', label: 'Me' }];
  if (canApprove) tabs.push({ id: 'approvals', label: 'Approvals' });
  if (canFirm) tabs.push({ id: 'firm', label: 'Firm' });
  if (canRates) tabs.push({ id: 'rates', label: 'Rates' });

  const eyebrow = weekly ? `Time · Week of ${fmtRange(monday)}` : `Time · ${profile?.display_name || profile?.initials || ''}`;
  const actions = weekly ? (
    <>
      <Button variant="secondary" onClick={() => setWeekOffset(w => w - 1)} className="h-9 px-3" title="Previous week">←</Button>
      <Button variant="secondary" onClick={() => setWeekOffset(0)} disabled={weekOffset === 0} className="h-9 px-3">This Week</Button>
      <Button variant="secondary" onClick={() => setWeekOffset(w => w + 1)} className="h-9 px-3" title="Next week">→</Button>
    </>
  ) : null;

  return (
    <Shell module="time" eyebrow={eyebrow} title={VIEW_TITLE[view]} actions={actions}>
      {tabs.length > 1 && <Tabs tabs={tabs} value={view} onChange={setView} />}
      {view === 'me' && <MyTimeView key={weekKey} user={user} profile={profile} weekKey={weekKey} monday={monday} masterData={masterData} projects={projects} accounts={accounts} acctByCode={acctByCode} onWeekChange={jumpToWeek} />}
      {view === 'approvals' && canApprove && <ApprovalsView profile={profile} weekKey={weekKey} monday={monday} acctByCode={acctByCode} projects={projects} />}
      {view === 'firm' && canFirm && <FirmView masterData={masterData} config={config} />}
      {view === 'rates' && canRates && <RatesView profile={profile} masterData={masterData} config={config} onConfigChange={reloadConfig} />}
    </Shell>
  );
}

function TimePageInner() {
  const { user, profile } = useAuth();
  const [masterData, setMasterData] = useState([]);
  const [projects, setProjects] = useState([]);
  const [config, setConfig] = useState(null);
  const reloadConfig = useCallback(() => { getJSON('/api/time?view=config').then(setConfig).catch(() => setConfig({ accounts: [], schedules: [], overrides: [], people: [], titles: [] })); }, []);
  useEffect(() => {
    if (!user) return;
    fetch('/api/masterdata').then(r => r.json()).then(d => setMasterData(d.data || [])).catch(() => {});
    fetch('/api/projects').then(r => r.json()).then(d => setProjects(d.projects || [])).catch(() => {});
    reloadConfig();
  }, [user, reloadConfig]);
  // The Shell handles login and role gating; while the page's own data loads we show it inside the shell frame
  if (!user || !profile || !config) return <Shell module="time" eyebrow="Time" title="My Time"><Loading>Loading your time...</Loading></Shell>;
  return <TimeApp user={user} profile={profile} masterData={masterData} projects={projects} config={config} reloadConfig={reloadConfig} />;
}

class TimeErrorBoundary extends React.Component {
  constructor(props) { super(props); this.state = { hasError: false, error: null }; }
  static getDerivedStateFromError(error) { return { hasError: true, error }; }
  render() {
    if (this.state.hasError) return (
      <div className="min-h-screen bg-ground flex items-center justify-center">
        <div className="bg-white rounded border border-rule p-8 w-[480px] text-center">
          <h1 className="text-xl mb-2">Time Error</h1>
          <p className="text-sm text-muted mb-3">Something went wrong loading My Time.</p>
          <pre className="text-xs text-status-red bg-ground rounded p-3 mb-4 text-left overflow-auto max-h-40">{this.state.error?.message || 'Unknown error'}</pre>
          <Button onClick={() => { this.setState({ hasError: false, error: null }); window.location.reload(); }}>Reload Page</Button>
        </div>
      </div>
    );
    return this.props.children;
  }
}

export default function TimePage() {
  return <TimeErrorBoundary><TimePageInner /></TimeErrorBoundary>;
}
