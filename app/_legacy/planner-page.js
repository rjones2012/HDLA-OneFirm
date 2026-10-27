'use client';
import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { supabase } from '../../../lib/supabase';
import { useAuth } from '../../../lib/auth';
import { AuthGate } from '../../../components/AuthGate';
import { ALL_STAFF, STAFF_NAMES } from '../../../components/marketing-shared';

/* ═══════════════════════════════════════════════════════════════════
   HDLA HUB — Personal Planner v3 (restored)
   4-col: Priorities+Notes | Calendar+Meetings | Projects+Milestones | BD+Proposals
   Role-based: sections hide/show per role, layout stays 4-col for everyone
   ═══════════════════════════════════════════════════════════════════ */

const FONT_H = 'Flecha M, Georgia, serif';
const uid = () => Date.now().toString(36) + Math.random().toString(36).substr(2, 9);
const daysBetween = s => { if (!s) return 999; return Math.floor((Date.now() - new Date(s).getTime()) / 864e5); };
const fmtDate = s => { if (!s) return '—'; const p = s.split('T')[0].split('-').map(Number); return new Date(p[0], p[1]-1, p[2]).toLocaleDateString('en-US',{month:'short',day:'numeric'}); };
const fmt$ = n => '$' + Math.round(n || 0).toLocaleString();
const PRINCIPAL_NAMES = { MM:'Mary Miller', AB:'Austen Berry', RW:'Robert Whittemore', HD:'Hank Dalton', CM:'Chris Mantle' };
// Staff list lives in marketing-shared so the touchpoint / lead "assign to" pickers and this page agree.
// Where a task came from (next steps on a lead or touchpoint arrive here as rows in assigned_tasks)
const SOURCE_PILL = { lead: { label: 'Lead', cls: 'bg-purple-100 text-purple-700' }, touchpoint: { label: 'Touchpoint', cls: 'bg-blue-100 text-blue-700' } };
const sourceOf = t => t.sourceType && SOURCE_PILL[t.sourceType] ? { ...SOURCE_PILL[t.sourceType], text: t.sourceLabel || '' } : null;

function getMonday(date) { const d = new Date(date); const day = d.getDay(); d.setDate(d.getDate() - day + (day === 0 ? -6 : 1)); d.setHours(0,0,0,0); return d; }
function getWeekKey(date) { return date.toISOString().split('T')[0]; }
function fmtWeekLabel(date) { return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }); }
function isDateInRange(dateStr, start, end) { if (!dateStr) return false; const d = new Date(dateStr.split('T')[0]); return d >= start && d <= end; }
function getMonthRange(date) { return { start: new Date(date.getFullYear(), date.getMonth(), 1), end: new Date(date.getFullYear(), date.getMonth() + 1, 0, 23, 59, 59) }; }
function fmtMonthLabel(date) { return date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' }); }
function fmtTime(iso) { if (!iso) return ''; const clean = iso.split('.')[0]; const d = new Date(clean); return isNaN(d.getTime()) ? '' : d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true }); }

const TIER_CONFIG = {
  must:   { label: 'Must Do',   color: 'bg-red-50 border-red-200',    dot: 'bg-red-500',   badge: 'bg-red-100 text-red-700' },
  should: { label: 'Should Do', color: 'bg-amber-50 border-amber-200', dot: 'bg-amber-400', badge: 'bg-amber-100 text-amber-700' },
  radar:  { label: 'On Radar',  color: 'bg-gray-50 border-gray-200',  dot: 'bg-gray-400',  badge: 'bg-gray-100 text-gray-600' },
};
const MS_COLORS = {
  deadline:    { bg: 'bg-red-500', text: 'text-white', dot: 'bg-red-500', label: 'DL' },
  hardCheckIn: { bg: 'bg-blue-500', text: 'text-white', dot: 'bg-blue-500', label: 'HC' },
  softCheckIn: { bg: 'bg-pink-100', text: 'text-pink-700', dot: 'bg-pink-400', label: 'SC' },
};

// ─── Shared Components ──────────────────────────────────────────

function EditableCell({ value, onChange, placeholder = '', multiline = false, className = '' }) {
  const [editing, setEditing] = useState(false); const [local, setLocal] = useState(value); const ref = useRef(null);
  useEffect(() => { setLocal(value); }, [value]); useEffect(() => { if (editing && ref.current) ref.current.focus(); }, [editing]);
  const commit = () => { setEditing(false); if (local !== value) onChange(local); };
  if (editing) return multiline
    ? <textarea ref={ref} value={local} onChange={e => setLocal(e.target.value)} onBlur={commit} className={`w-full border border-hdla-green rounded px-2 py-1.5 text-sm resize-none focus:outline-none focus:ring-1 focus:ring-hdla-green bg-white ${className}`} rows={3} />
    : <input ref={ref} value={local} onChange={e => setLocal(e.target.value)} onBlur={commit} onKeyDown={e => e.key === 'Enter' && commit()} className={`w-full border border-hdla-green rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-hdla-green bg-white ${className}`} />;
  return <div onClick={() => setEditing(true)} className={`min-h-[28px] px-2 py-1.5 text-sm rounded cursor-text hover:bg-gray-50 ${!value ? 'text-gray-300 italic' : 'text-gray-800'} ${className}`}>{value || placeholder}</div>;
}

function NotesEditor({ value, onChange, placeholder }) {
  const [local, setLocal] = useState(value || ''); const timerRef = useRef(null);
  useEffect(() => { setLocal(value || ''); }, [value]);
  const handleChange = v => { setLocal(v); clearTimeout(timerRef.current); timerRef.current = setTimeout(() => onChange(v), 600); };
  return <textarea value={local} onChange={e => handleChange(e.target.value)} placeholder={placeholder} className="w-full h-full min-h-[140px] resize-none text-sm text-gray-800 border-0 bg-transparent focus:outline-none focus:ring-0 placeholder-gray-300 leading-relaxed" />;
}

function PriorityItem({ item, onUpdate, onDelete }) {
  const cfg = TIER_CONFIG[item.tier];
  return (
    <div className={`flex items-start gap-2 p-2.5 rounded-lg border ${cfg.color} group`}>
      <input type="checkbox" checked={item.done} onChange={e => onUpdate({ ...item, done: e.target.checked })} className="mt-0.5 rounded cursor-pointer flex-shrink-0" />
      <div className="flex-1 min-w-0"><EditableCell value={item.text} placeholder="Add item..." onChange={v => onUpdate({ ...item, text: v })} className={item.done ? 'line-through text-gray-400' : ''} /></div>
      <button onClick={onDelete} className="opacity-0 group-hover:opacity-100 text-gray-300 hover:text-red-400 text-lg leading-none flex-shrink-0">×</button>
    </div>
  );
}

function MeetingItem({ meeting, onUpdate, onDelete }) {
  return (
    <div className="flex items-start gap-2 p-2.5 rounded-lg border border-gray-200 bg-white group hover:border-gray-300">
      <div className="w-16 flex-shrink-0"><input type="time" value={meeting.time || ''} onChange={e => onUpdate({ ...meeting, time: e.target.value })} className="w-full text-xs border-0 p-0 text-gray-500 bg-transparent focus:outline-none focus:ring-0" /></div>
      <div className="flex-1 min-w-0 space-y-0.5">
        <EditableCell value={meeting.title} placeholder="Meeting title..." onChange={v => onUpdate({ ...meeting, title: v })} className="font-medium text-gray-900" />
        <EditableCell value={meeting.notes || ''} placeholder="Notes..." onChange={v => onUpdate({ ...meeting, notes: v })} className="text-gray-500 text-xs" multiline />
      </div>
      <button onClick={onDelete} className="opacity-0 group-hover:opacity-100 text-gray-300 hover:text-red-400 text-lg leading-none flex-shrink-0 mt-1">×</button>
    </div>
  );
}

function CalendarEvent({ event, promoted, onPromote }) {
  const ts = event.isAllDay ? 'All day' : `${fmtTime(event.start)} – ${fmtTime(event.end)}`;
  const dayStr = event.start ? (() => { const parts = (event.start.split('.')[0]).split('T')[0].split('-').map(Number); if (parts.length < 3) return ''; const d = new Date(parts[0], parts[1]-1, parts[2]); return isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }); })() : '';
  return (
    <div onClick={onPromote} className={`flex items-center gap-2 p-2 rounded-lg border cursor-pointer transition-all ${promoted ? 'border-blue-300 bg-blue-50' : 'border-gray-100 bg-gray-50/50 opacity-50 hover:opacity-80 hover:border-gray-200'}`}>
      <div className={`w-2 h-2 rounded-full flex-shrink-0 ${promoted ? 'bg-blue-500' : 'bg-gray-300'}`} />
      <div className="flex-1 min-w-0">
        <div className={`text-sm truncate ${promoted ? 'text-gray-900 font-medium' : 'text-gray-500'}`}>{event.subject}</div>
        <div className="text-xs text-gray-400">{dayStr}{dayStr ? ' · ' : ''}{ts}{event.location ? ` · ${event.location}` : ''}</div>
      </div>
      {promoted && <span className="text-xs text-blue-600 font-medium flex-shrink-0">✓</span>}
    </div>
  );
}

function MilestonePill({ type, date, description, project, principal, compact }) {
  const mc = MS_COLORS[type] || MS_COLORS.deadline;
  if (compact) return (
    <div className="flex items-center gap-1.5 py-1.5 border-b border-gray-50 last:border-0">
      <span className={`w-2 h-2 rounded-full flex-shrink-0 ${mc.dot}`} />
      <span className="text-xs text-gray-500 w-14 flex-shrink-0">{fmtDate(date)}</span>
      <span className="text-sm text-gray-800 truncate flex-1">{description || '—'}</span>
      <span className="text-xs text-gray-400 truncate max-w-[140px] text-right">{project}</span>
    </div>
  );
  return (
    <div className="flex items-center gap-2.5 py-1.5 border-b border-gray-100 last:border-0">
      <span className={`text-xs px-1.5 py-0.5 rounded font-medium flex-shrink-0 ${mc.bg} ${mc.text}`}>{mc.label}</span>
      <div className="flex-1 min-w-0">
        <div className="text-sm text-gray-800 truncate">{description || '(no description)'}</div>
        <div className="text-xs text-gray-400 truncate">{project} · {PRINCIPAL_NAMES[principal] || principal} · {fmtDate(date)}</div>
      </div>
    </div>
  );
}

function BDItem({ icon, color, label, sub, right }) {
  return (
    <div className="flex items-center gap-2.5 py-2 border-b border-gray-100 last:border-0">
      <span className={`text-sm w-6 text-center flex-shrink-0 ${color}`}>{icon}</span>
      <div className="flex-1 min-w-0"><div className="text-sm text-gray-800">{label}</div>{sub && <div className="text-xs text-gray-400">{sub}</div>}</div>
      {right && <div className="text-xs text-gray-500 flex-shrink-0">{right}</div>}
    </div>
  );
}

// ═══ Touchpoint quick-log (lives on the planner) ══════════════════
const TP_TYPES = ["Lunch","Call","Email","Site Visit","Coffee","Meeting","Other"];
function TouchpointQuickLog({ clients, onLog }) {
  const [search, setSearch] = useState('');
  const [clientId, setClientId] = useState('');
  const [type, setType] = useState('Call');
  const [rating, setRating] = useState(5);
  const sel = (clients || []).find(c => c.id === clientId);
  const matches = search ? (clients || []).filter(c => c.name.toLowerCase().includes(search.toLowerCase())).sort((a, b) => a.name.localeCompare(b.name)).slice(0, 6) : [];
  const submit = () => { if (!clientId) return; onLog({ clientId, type, rating }); setClientId(''); setSearch(''); setRating(5); };
  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-gray-100 bg-hdla-green/5"><div className="w-2.5 h-2.5 rounded-full bg-hdla-green" /><span className="text-sm font-semibold text-gray-700">Log Touchpoint</span></div>
      <div className="px-4 py-2.5 space-y-2 relative">
        {sel ? <div className="text-sm font-medium bg-green-50 px-2 py-1.5 rounded flex justify-between items-center"><span>{sel.name}</span><button onClick={() => { setClientId(''); setSearch(''); }} className="text-xs text-gray-400 hover:text-red-500">✕</button></div>
          : <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search client..." className="border border-gray-200 rounded px-2 py-1.5 text-sm bg-white w-full" />}
        {!sel && matches.length > 0 && <div className="absolute z-10 left-4 right-4 mt-1 bg-white border border-gray-200 rounded shadow max-h-40 overflow-y-auto">{matches.map(c => <div key={c.id} onClick={() => { setClientId(c.id); setSearch(''); }} className="px-2 py-1.5 text-sm cursor-pointer hover:bg-blue-50">{c.name}</div>)}</div>}
        <div className="flex items-center gap-2">
          <select value={type} onChange={e => setType(e.target.value)} className="border border-gray-200 rounded px-2 py-1.5 text-sm bg-white flex-1">{TP_TYPES.map(t => <option key={t}>{t}</option>)}</select>
          <select value={rating} onChange={e => setRating(parseInt(e.target.value))} className="border border-gray-200 rounded px-2 py-1.5 text-sm bg-white" title="How did it go? (1-10)">{[1,2,3,4,5,6,7,8,9,10].map(v => <option key={v} value={v}>{v}/10</option>)}</select>
          <button onClick={submit} disabled={!clientId} className={"px-3 py-1.5 rounded text-sm font-medium flex-shrink-0 " + (clientId ? "bg-hdla-green text-white" : "bg-gray-100 text-gray-400 cursor-not-allowed")}>Log</button>
        </div>
        <div className="text-xs text-gray-400">Logs a completed touchpoint dated today, credited to you.</div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// MAIN PLANNER — same layout as v3 that was "dialed"
// ═══════════════════════════════════════════════════════════════════

const TP_RATING_LABELS = {1:'Poor',2:'Weak',3:'Below Avg',4:'Fair',5:'Neutral',6:'Decent',7:'Good',8:'Strong',9:'Very Strong',10:'Exceptional'};
const TP_PEOPLE = ["RJ","CB","MB","TJ","AB","RW","CM","HD","MM"];
function TouchpointFormModal({ clients, defaultPartner, onSave, onClose }) {
  const [clientId, setClientId] = useState('');
  const [search, setSearch] = useState('');
  const [type, setType] = useState('Call');
  const [partner, setPartner] = useState(defaultPartner || 'RJ');
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
  const [status, setStatus] = useState('completed');
  const [rating, setRating] = useState(5);
  const [notes, setNotes] = useState('');
  const sel = (clients || []).find(c => c.id === clientId);
  const matches = search ? (clients || []).filter(c => c.name.toLowerCase().includes(search.toLowerCase())).sort((a, b) => a.name.localeCompare(b.name)).slice(0, 8) : [];
  const inp = "border border-gray-200 rounded px-2 py-1.5 text-sm bg-white w-full";
  const save = () => { if (!clientId) return; onSave({ clientId, type, partner, date, status, rating, notes }); onClose(); };
  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl w-[440px] max-w-full max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100"><span className="font-bold text-gray-900" style={{ fontFamily: FONT_H }}>Log Touchpoint</span><button onClick={onClose} className="text-gray-400 hover:text-gray-700">&times;</button></div>
        <div className="p-4 space-y-3">
          <div className="relative">
            <label className="block text-xs font-medium text-gray-500 mb-1">Client</label>
            {sel ? <div className="text-sm font-medium bg-green-50 px-2 py-1.5 rounded flex justify-between items-center"><span>{sel.name}</span><button onClick={() => { setClientId(''); setSearch(''); }} className="text-xs text-gray-400 hover:text-red-500">&times;</button></div>
              : <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search client..." className={inp} autoFocus />}
            {!sel && matches.length > 0 && <div className="absolute z-10 left-0 right-0 mt-1 bg-white border border-gray-200 rounded shadow max-h-44 overflow-y-auto">{matches.map(c => <div key={c.id} onClick={() => { setClientId(c.id); setSearch(''); }} className="px-2 py-1.5 text-sm cursor-pointer hover:bg-blue-50">{c.name}</div>)}</div>}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className="block text-xs font-medium text-gray-500 mb-1">Type</label><select value={type} onChange={e => setType(e.target.value)} className={inp}>{TP_TYPES.map(t => <option key={t}>{t}</option>)}</select></div>
            <div><label className="block text-xs font-medium text-gray-500 mb-1">Partner</label><select value={partner} onChange={e => setPartner(e.target.value)} className={inp}>{TP_PEOPLE.map(p => <option key={p}>{p}</option>)}</select></div>
            <div><label className="block text-xs font-medium text-gray-500 mb-1">Date</label><input type="date" value={date} onChange={e => setDate(e.target.value)} className={inp} /></div>
            <div><label className="block text-xs font-medium text-gray-500 mb-1">Status</label><select value={status} onChange={e => setStatus(e.target.value)} className={inp}><option value="completed">Completed</option><option value="planned">Planned</option></select></div>
          </div>
          {status === 'completed' && <div><label className="block text-xs font-medium text-gray-500 mb-1">How did it go? ({rating}/10 &middot; {TP_RATING_LABELS[rating]})</label><div className="grid grid-cols-10 gap-1">{[1,2,3,4,5,6,7,8,9,10].map(v => <button key={v} onClick={() => setRating(v)} className={"py-1 rounded text-xs font-bold border " + (rating === v ? "border-hdla-green bg-green-50 text-green-700" : "border-gray-200 text-gray-400 hover:border-gray-300")}>{v}</button>)}</div></div>}
          <div><label className="block text-xs font-medium text-gray-500 mb-1">Notes</label><textarea value={notes} onChange={e => setNotes(e.target.value)} rows={3} className="border border-gray-200 rounded px-2 py-1.5 text-sm bg-white w-full resize-none" placeholder="What was discussed..." /></div>
          <div className="flex justify-end gap-2 pt-1"><button onClick={onClose} className="px-3 py-1.5 text-sm text-gray-500 hover:text-gray-700">Cancel</button><button onClick={save} disabled={!clientId} className={"px-4 py-1.5 rounded text-sm font-medium " + (clientId ? "bg-hdla-green text-white" : "bg-gray-100 text-gray-400 cursor-not-allowed")}>Log Touchpoint</button></div>
        </div>
      </div>
    </div>
  );
}

function PlannerApp({ user, profile, projects, marketing, onUpdateProject, assignedTasks, setAssignedTasks, setMarketing }) {
  const [weekOffset, setWeekOffset] = useState(0);
  const [monthOffset, setMonthOffset] = useState(0);
  const [activeView, setActiveView] = useState('week');
  const [entry, setEntry] = useState(null);
  const [saving, setSaving] = useState(false);
  const [lastSaved, setLastSaved] = useState(null);
  const [calEvents, setCalEvents] = useState([]);
  const [calLoading, setCalLoading] = useState(false);
  const [promotedKeys, setPromotedKeys] = useState(new Set());
  const [calOpen, setCalOpen] = useState(false);
  const [completedKeys, setCompletedKeys] = useState(new Set());
  const [dismissedPulse, setDismissedPulse] = useState(new Set());
  const [milestoneSortBy, setMilestoneSortBy] = useState('date');
  const [showAssignModal, setShowAssignModal] = useState(false);
  const saveTimer = useRef(null);
  // Normalize key: trim trailing zeros and fractional seconds for stable matching across API calls
  const normalizeTime = (t) => { if (!t) return ''; return t.replace(/\.?\d*$/, '').replace(/T(\d{2}):(\d{2}):(\d{2}).*/, 'T$1:$2:$3'); };
  const eventKey = (e) => `${e.subject}|${normalizeTime(e.start)}`;

  const myInitials = profile?.initials || '';
  const myRole = profile?.role || 'staff';
  const isPartner = myRole === 'partner';
  const isLeadership = ['partner', 'operations', 'office', 'marketing', 'principal'].includes(myRole);
  const showReview = isPartner; // only partners get review checkboxes
  const showKickoff = isPartner || myRole === 'operations' || myRole === 'office' || myRole === 'principal';

  // ─── Week computation ───────────────────────────────────────────
  const monday = getMonday(new Date()); monday.setDate(monday.getDate() + weekOffset * 7);
  const weekKey = getWeekKey(monday);
  const weekEndDate = new Date(monday); weekEndDate.setDate(weekEndDate.getDate() + 6); weekEndDate.setHours(23, 59, 59, 999);
  const weekFri = new Date(monday); weekFri.setDate(weekFri.getDate() + 4);
  const weekLabel = `${fmtWeekLabel(monday)} – ${fmtWeekLabel(weekFri)}`;
  const monthDate = new Date(); monthDate.setMonth(monthDate.getMonth() + monthOffset);
  const { start: monthStart, end: monthEnd } = getMonthRange(monthDate);

  // ─── My Projects ────────────────────────────────────────────────
  const myProjects = useMemo(() => (projects || []).filter(p =>
    p.principal === myInitials || (p.partnersInCharge || []).includes(myInitials) || (p.tasks || []).some(t => t.staff === myInitials)
  ), [projects, myInitials]);

  // ─── Milestones ─────────────────────────────────────────────────
  const getMilestones = (start, end) => {
    const items = [];
    myProjects.forEach(p => { (p.milestones || []).forEach(m => {
      if (m.date && isDateInRange(m.date, start, end)) items.push({ project: p.projectName, projectNum: p.projectNum, principal: p.principal, type: m.type || 'deadline', date: m.date, description: m.description || '' });
    }); });
    return items;
  };
  const sortMilestones = items => {
    if (milestoneSortBy === 'type') { const o = { deadline: 0, hardCheckIn: 1, softCheckIn: 2 }; return [...items].sort((a, b) => (o[a.type] ?? 9) - (o[b.type] ?? 9) || new Date(a.date) - new Date(b.date)); }
    if (milestoneSortBy === 'team') return [...items].sort((a, b) => (a.principal || '').localeCompare(b.principal || '') || new Date(a.date) - new Date(b.date));
    return [...items].sort((a, b) => new Date(a.date) - new Date(b.date));
  };
  const weekMilestones = useMemo(() => sortMilestones(getMilestones(monday, weekEndDate)), [myProjects, weekKey, milestoneSortBy]);
  const monthMilestones = useMemo(() => sortMilestones(getMilestones(monthStart, monthEnd)), [myProjects, monthOffset, milestoneSortBy]);

  // ─── Project Pulse ──────────────────────────────────────────────
  const pulse = useMemo(() => {
    const items = []; const seen = new Set();
    myProjects.forEach(p => {
      if (showReview && (p.needsReview || []).includes(myInitials)) { items.push({ type: 'review', projectId: p.id, label: p.projectName, sub: p.partnerNeeds || 'Needs your review', principal: p.principal, badge: 'Review', badgeColor: 'bg-red-100 text-red-700' }); seen.add(p.id); }
      if ((p.internalHealth === 'Poor' || p.externalHealth === 'Poor') && !seen.has(p.id)) { items.push({ type: 'health', projectId: p.id, label: p.projectName, sub: `${p.internalHealth === 'Poor' ? 'Internal' : 'External'}: Poor`, principal: p.principal, badge: 'Poor', badgeColor: 'bg-red-100 text-red-700' }); seen.add(p.id); }
      if ((p.internalHealth === 'Watch' || p.externalHealth === 'Watch') && p.internalHealth !== 'Poor' && p.externalHealth !== 'Poor' && !seen.has(p.id)) { items.push({ type: 'watch', projectId: p.id, label: p.projectName, sub: 'Health: Watch', principal: p.principal, badge: 'Watch', badgeColor: 'bg-amber-100 text-amber-700' }); }
    });
    // Proposal review flags from marketing
    if (isPartner && marketing) {
      (marketing.proposals || []).filter(p => !['Awarded','Not Awarded','Declined'].includes(p.status) && (p.reviewPartners || []).includes(myInitials)).forEach(p => {
        items.push({ type: 'review', projectId: `prop-${p.id}`, label: `${p.proposalType||'Proposal'}: ${p.projectName}`, sub: p.reviewNotes || 'Needs partner review', principal: p.partner || '', badge: 'Review', badgeColor: 'bg-blue-100 text-blue-700' });
      });
    }
    return items.sort((a, b) => ({ review: 0, health: 1, watch: 2 }[a.type] ?? 9) - ({ review: 0, health: 1, watch: 2 }[b.type] ?? 9));
  }, [myProjects, myInitials, showReview, marketing, isPartner]);

  // ─── Kickoffs ───────────────────────────────────────────────────
  const kickoffs = useMemo(() => {
    if (!marketing) return [];
    return (marketing.proposals || []).filter(p => p.status === 'Awarded' && !p.kickoffDone).filter(p => {
      if (myRole === 'operations' || myRole === 'office') return true;
      if (isPartner && p.partner === myInitials) return true;
      if (myRole === 'principal' && p.pm === myInitials) return true;
      return false;
    });
  }, [marketing, myInitials, myRole]);

  const markReviewed = async (projectId) => {
    const p = projects.find(x => x.id === projectId); if (!p) return;
    const rcb = { ...(p.reviewCompletedBy || {}), [myInitials]: new Date().toISOString().split('T')[0] };
    const updated = { ...p, reviewCompletedBy: rcb };
    try { 
      await fetch('/api/projects', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ project: { id: p.id, reviewCompletedBy: rcb, needsReview: p.needsReview, projectNum: p.projectNum, projectName: p.projectName, principal: p.principal, phase: p.phase, milestones: p.milestones, tasks: p.tasks, partnersInCharge: p.partnersInCharge, teamMembers: p.teamMembers, partnerNeeds: p.partnerNeeds, internalHealth: p.internalHealth, externalHealth: p.externalHealth, needs: p.needs } }) }); 
      if (onUpdateProject) onUpdateProject(updated); 
    } catch (e) { console.error(e); }
  };
  const undoReview = async (projectId) => {
    const p = projects.find(x => x.id === projectId); if (!p) return;
    const rcb = { ...(p.reviewCompletedBy || {}) }; delete rcb[myInitials];
    const updated = { ...p, reviewCompletedBy: rcb };
    try { 
      await fetch('/api/projects', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ project: { id: p.id, reviewCompletedBy: rcb, needsReview: p.needsReview, projectNum: p.projectNum, projectName: p.projectName, principal: p.principal, phase: p.phase, milestones: p.milestones, tasks: p.tasks, partnersInCharge: p.partnersInCharge, teamMembers: p.teamMembers, partnerNeeds: p.partnerNeeds, internalHealth: p.internalHealth, externalHealth: p.externalHealth, needs: p.needs } }) }); 
      if (onUpdateProject) onUpdateProject(updated); 
    } catch (e) { console.error(e); }
  };

  const markKickoffDone = async (proposal) => {
    const updated = { ...proposal, kickoffDone: true };
    try { await fetch('/api/marketing', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ proposal: updated }) }); } catch (e) { console.error(e); }
  };

  // ─── My Proposals (open ones I lead or PM; roll off when awarded/not-awarded) ───
  const myProposals = useMemo(() => {
    if (!marketing) return [];
    return (marketing.proposals || [])
      .filter(p => !['Awarded', 'Not Awarded', 'Declined'].includes(p.status) && (p.partner === myInitials || p.pm === myInitials))
      .sort((a, b) => (a.dueDate || '9999').localeCompare(b.dueDate || '9999'));
  }, [marketing, myInitials]);

  const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

  const logTouchpoint = async (data) => {
    const tp = { id: newId(), clientId: data.clientId, type: data.type || 'Call', partner: data.partner || myInitials, date: data.date || new Date().toISOString().split('T')[0], status: data.status || 'completed', rating: data.status === 'planned' ? null : (data.rating || 5), notes: data.notes || '' };
    if (setMarketing) setMarketing(m => ({ ...(m || {}), touchpoints: [...((m && m.touchpoints) || []), tp] }));
    try { await fetch('/api/marketing', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ touchpoint: tp }) }); } catch (e) { console.error(e); }
  };

  const addPriorityClient = async (clientId) => {
    if (!clientId) return;
    const pos = ((marketing && marketing.priority) || []).reduce((m, x) => Math.max(m, x.position || 0), 0) + 1;
    const item = { id: newId(), clientId, owner: myInitials, note: '', done: false, position: pos };
    if (setMarketing) setMarketing(m => ({ ...(m || {}), priority: [...((m && m.priority) || []), item] }));
    try { await fetch('/api/marketing', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ priority: item }) }); } catch (e) { console.error(e); }
  };
  const togglePriorityDone = async (item) => {
    const upd = { ...item, done: !item.done };
    if (setMarketing) setMarketing(m => ({ ...(m || {}), priority: ((m && m.priority) || []).map(x => x.id === item.id ? upd : x) }));
    try { await fetch('/api/marketing', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ priority: upd }) }); } catch (e) { console.error(e); }
  };
  const [prioritySearch, setPrioritySearch] = useState('');
  const [showTP, setShowTP] = useState(false);

  // ─── BD Reminders ───────────────────────────────────────────────
  const bdReminders = useMemo(() => {
    if (!marketing) return { weekTPs: [], weekProposals: [], monthProposals: [], proposalNeeds: [], eventNeeds: [], coldClients: [], clients: [] };
    const { clients, touchpoints, proposals, events } = marketing;
    const plannedTPs = touchpoints.filter(t => t.status === 'planned' && (t.partner === myInitials || (isPartner && !t.partner)));
    const weekTPs = plannedTPs.filter(t => isDateInRange(t.date, monday, weekEndDate));
    const openProposals = proposals.filter(p => !['Awarded', 'Not Awarded', 'Declined'].includes(p.status));
    const weekProposals = openProposals.filter(p => p.dueDate && isDateInRange(p.dueDate, monday, weekEndDate));
    const monthProposals = openProposals.filter(p => p.dueDate && isDateInRange(p.dueDate, monthStart, monthEnd));
    const proposalNeeds = openProposals.flatMap(p => (p.needs || []).filter(n => !n.done).map(n => ({ ...n, proposalName: p.projectName })));
    const eventNeeds = events.filter(e => new Date(e.date) > new Date()).flatMap(e => (e.needs || []).filter(n => !n.done).map(n => ({ ...n, eventName: e.name, date: e.date })));
    // Cold: Tier 1/2 or Strategic only. No 999d — only if they have logged activity and it's stale
    const coldClients = clients.filter(c => (c.tier <= 2 || c.strategic) && (c.partners || []).includes(myInitials)).map(c => {
      const comp = touchpoints.filter(t => t.clientId === c.id && t.status === 'completed').sort((a, b) => new Date(b.date) - new Date(a.date));
      const lastDate = comp[0]?.date; const days = lastDate ? daysBetween(lastDate) : null;
      const hasPlanned = touchpoints.some(t => t.clientId === c.id && t.status === 'planned');
      return { ...c, lastDate, days, hasPlanned };
    }).filter(c => c.days !== null && c.days > 60 && !c.hasPlanned).sort((a, b) => b.days - a.days);
    return { weekTPs, weekProposals, monthProposals, proposalNeeds, eventNeeds, coldClients, clients };
  }, [marketing, myInitials, isPartner, weekKey, monthOffset]);

  // ─── Calendar pull ──────────────────────────────────────────────
  useEffect(() => {
    if (!myInitials) return; setCalLoading(true); setCalEvents([]);
    const endDate = new Date(monday); endDate.setDate(endDate.getDate() + 6);
    fetch(`/api/calendar?initials=${myInitials}&start=${weekKey}&end=${getWeekKey(endDate)}`)
      .then(r => r.json()).then(d => { setCalEvents(d.events || []); setCalLoading(false); })
      .catch(() => { setCalEvents([]); setCalLoading(false); });
    // Refresh assigned tasks (hand-assigned + next steps from leads and touchpoints) when the week changes
    fetch(`/api/assigned-tasks?initials=${myInitials}`)
      .then(r => r.json()).then(d => { if (!d.error) setAssignedTasks({ received: d.received || [], sent: d.sent || [] }); })
      .catch(() => {});
  }, [weekKey, myInitials]);
  
  const togglePromote = (event) => { 
    if (!entry) return;
    const key = eventKey(event);
    const newP = new Set(promotedKeys); newP.has(key) ? newP.delete(key) : newP.add(key);
    const newC = new Set(completedKeys); newC.delete(key);
    setPromotedKeys(newP);
    setCompletedKeys(newC);
    const u = { ...entry, promoted_events: [...newP], completed_promoted: [...newC] };
    setEntry(u);
    // Save immediately — don't debounce promoted events
    fetch('/api/planner', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(u) }).catch(() => {});
  };
  const toggleCompletedPromoted = (event) => { 
    if (!entry) return;
    const key = eventKey(event);
    const newC = new Set(completedKeys); newC.has(key) ? newC.delete(key) : newC.add(key);
    setCompletedKeys(newC);
    const u = { ...entry, promoted_events: [...promotedKeys], completed_promoted: [...newC] };
    setEntry(u);
    // Save immediately — don't debounce promoted events
    fetch('/api/planner', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(u) }).catch(() => {});
  };
  const toggleDismissPulse = (key) => { setDismissedPulse(prev => { const n = new Set(prev); n.has(key) ? n.delete(key) : n.add(key); return n; }); };

  // ─── Planner CRUD ───────────────────────────────────────────────
  useEffect(() => {
    setEntry(null); setPromotedKeys(new Set()); setCompletedKeys(new Set());
    fetch(`/api/planner?user_id=${user.id}&week_key=${weekKey}`).then(r => r.json())
      .then(({ entry: e, carriedPriorities }) => {
        if (e) {
          setEntry(e);
          // Normalize stored keys to match current eventKey format
          const normKey = (k) => { const parts = k.split('|'); if (parts.length < 2) return k; return parts[0] + '|' + normalizeTime(parts.slice(1).join('|')); };
          setPromotedKeys(new Set((e.promoted_events || []).map(normKey)));
          setCompletedKeys(new Set((e.completed_promoted || []).map(normKey)));
        } else {
          // New week — carry over uncompleted priorities from last week
          const carried = carriedPriorities || [];
          setEntry({ user_id: user.id, week_key: weekKey, focus_notes: '', meetings: [], priorities: carried, reflections: '', promoted_events: [], completed_promoted: [] });
        }
      })
      .catch(() => setEntry({ user_id: user.id, week_key: weekKey, focus_notes: '', meetings: [], priorities: [], reflections: '', promoted_events: [], completed_promoted: [] }));
  }, [weekKey, user.id]);

  const autoSave = useCallback((updated) => {
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      setSaving(true);
      try { await fetch('/api/planner', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(updated) }); setLastSaved(new Date()); } catch (e) { console.error(e); }
      setSaving(false);
    }, 800);
  }, []);

  // Refs to track latest promoted state so debounced saves never overwrite with stale data
  const promotedRef = useRef(promotedKeys);
  const completedRef = useRef(completedKeys);
  promotedRef.current = promotedKeys;
  completedRef.current = completedKeys;

  const update = patch => { const u = { ...entry, ...patch, promoted_events: [...promotedRef.current], completed_promoted: [...completedRef.current] }; setEntry(u); autoSave(u); };
  const addPriority = tier => update({ priorities: [...(entry.priorities || []), { id: uid(), text: '', done: false, tier }] });
  const updatePriority = (id, patch) => update({ priorities: (entry.priorities || []).map(p => p.id === id ? { ...p, ...patch } : p) });
  const deletePriority = id => update({ priorities: (entry.priorities || []).filter(p => p.id !== id) });
  const addMeeting = () => update({ meetings: [...(entry.meetings || []), { id: uid(), title: '', time: '', notes: '' }] });
  const updateMeeting = (id, patch) => update({ meetings: (entry.meetings || []).map(m => m.id === id ? { ...m, ...patch } : m) });
  const deleteMeeting = id => update({ meetings: (entry.meetings || []).filter(m => m.id !== id) });
  const handleSignOut = async () => { await supabase.auth.signOut(); window.location.reload(); };

  // ─── Assigned Tasks CRUD ────────────────────────────────────────
  const createAssignedTask = async (task) => {
    try {
      await fetch('/api/assigned-tasks', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ create: task }) });
      setAssignedTasks(prev => ({ received: prev.received, sent: [...prev.sent, task] }));
    } catch (e) { console.error(e); }
  };
  const toggleTaskDone = async (task) => {
    const newDone = !task.done;
    try {
      await fetch('/api/assigned-tasks', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ toggleDone: { id: task.id, done: newDone } }) });
      setAssignedTasks(prev => ({
        received: prev.received.map(t => t.id === task.id ? { ...t, done: newDone } : t),
        sent: prev.sent.map(t => t.id === task.id ? { ...t, done: newDone } : t),
      }));
      // A next step from a lead or touchpoint is the same row Marketing shows: keep the local copy in step
      // so a later save from this page (e.g. kickoff done) does not send the old done-state back.
      if (task.sourceType && setMarketing) {
        const today = new Date().toISOString().split('T')[0];
        const patch = s => s.id === task.id ? { ...s, done: newDone, doneAt: newDone ? today : '' } : s;
        setMarketing(m => {
          if (!m) return m;
          return {
            ...m,
            proposals: (m.proposals || []).map(p => p.id === task.sourceId ? { ...p, nextSteps: (p.nextSteps || []).map(patch) } : p),
            touchpoints: (m.touchpoints || []).map(t => t.id === task.sourceId ? { ...t, nextSteps: (t.nextSteps || []).map(patch) } : t),
          };
        });
      }
    } catch (e) { console.error(e); }
  };
  const deleteAssignedTask = async (id) => {
    try {
      await fetch('/api/assigned-tasks', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ deleteTask: id }) });
      setAssignedTasks(prev => ({ received: prev.received.filter(t => t.id !== id), sent: prev.sent.filter(t => t.id !== id) }));
    } catch (e) { console.error(e); }
  };
  const receivedOpen = (assignedTasks?.received || []).filter(t => !t.done);
  const receivedDone = (assignedTasks?.received || []).filter(t => t.done);
  const sentOpen = (assignedTasks?.sent || []).filter(t => !t.done);
  const sentDone = (assignedTasks?.sent || []).filter(t => t.done);

  // ─── Export for Claude ──────────────────────────────────────────
  const exportForClaude = () => {
    const today = new Date().toISOString().split('T')[0];
    const p = entry?.priorities || []; const m = entry?.meetings || [];
    let md = `# ${profile?.display_name || myInitials} — Week of ${weekLabel}\n*Exported ${today}*\n\n`;
    ['must', 'should', 'radar'].forEach(tier => { const items = p.filter(x => x.tier === tier); if (!items.length) return; md += `## ${TIER_CONFIG[tier].label}\n`; items.forEach(i => md += `- [${i.done ? 'x' : ' '}] ${i.text || '(empty)'}\n`); md += '\n'; });
    const allMtg = [...m.map(x => ({ time: x.time || '', title: x.title || '', notes: x.notes || '' })), ...calEvents.filter(e => promotedKeys.has(eventKey(e))).map(e => ({ time: fmtTime(e.start), title: e.subject, notes: e.location || '' }))].sort((a, b) => (a.time || '').localeCompare(b.time || ''));
    if (allMtg.length) { md += `## Meetings\n`; allMtg.forEach(x => md += `- ${x.time || '??:??'} — ${x.title}${x.notes ? ` — ${x.notes}` : ''}\n`); md += '\n'; }
    if (pulse.length) { md += `## Projects Needing Attention\n`; pulse.forEach(x => md += `- **${x.label}** (${PRINCIPAL_NAMES[x.principal] || x.principal}) — ${x.sub} [${x.badge}]\n`); md += '\n'; }
    if (kickoffs.length) { md += `## Kickoffs Needed\n`; kickoffs.forEach(k => md += `- **${k.projectName}** — Awarded ${fmtDate(k.awardedDate)} · ${fmt$(k.fee)} · Partner: ${k.partner}\n`); md += '\n'; }
    if (weekMilestones.length) { md += `## Milestones This Week\n`; weekMilestones.forEach(x => { const t = x.type === 'deadline' ? '🔴 Deadline' : x.type === 'hardCheckIn' ? '🔵 Hard Check-in' : '🩷 Soft'; md += `- ${fmtDate(x.date)}: ${t} — ${x.description} (${x.project}, ${PRINCIPAL_NAMES[x.principal] || x.principal})\n`; }); md += '\n'; }
    const hasBD = (bdReminders.weekTPs?.length || 0) + (bdReminders.weekProposals?.length || 0) + (bdReminders.proposalNeeds?.length || 0) + (bdReminders.coldClients?.length || 0);
    if (hasBD) { md += `## BD Actions\n`; (bdReminders.weekTPs || []).forEach(t => { const c = (bdReminders.clients || []).find(x => x.id === t.clientId); md += `- Touchpoint: ${t.type} with ${c?.name || 'Client'} (${fmtDate(t.date)})\n`; }); (bdReminders.weekProposals || []).forEach(x => md += `- Proposal due: ${x.projectName} — ${fmt$(x.fee)} (${fmtDate(x.dueDate)})\n`); (bdReminders.proposalNeeds || []).forEach(n => md += `- Proposal need: ${n.text} (${n.proposalName})\n`); (bdReminders.coldClients || []).forEach(c => md += `- Going cold: ${c.name} — ${c.days}d (T${c.tier}${c.strategic ? ', S' : ''})\n`); md += '\n'; }
    if (receivedOpen.length) { md += `## Assigned to Me\n`; receivedOpen.forEach(t => { const src = sourceOf(t); md += `- ${t.description}${src ? ` — ${src.label}: ${src.text}` : ''}${t.assignedBy && t.assignedBy !== myInitials ? ` (from ${t.assignedBy})` : ''}${t.dueDate ? ` · due ${fmtDate(t.dueDate)}` : ''}\n`; }); md += '\n'; }
    if (entry?.focus_notes) md += `## Focus & Notes\n${entry.focus_notes}\n\n`;
    if (entry?.reflections) md += `## Reflections\n${entry.reflections}\n\n`;
    const blob = new Blob([md], { type: 'text/markdown' }); const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = `${myInitials}-planner-${weekKey}.md`; document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
  };

  if (!entry) return <div className="min-h-screen bg-gray-50 flex items-center justify-center"><div className="animate-pulse text-gray-400">Loading your planner...</div></div>;
  const sortedMeetings = (entry.meetings || []).sort((a, b) => (a.time || '').localeCompare(b.time || ''));
  const MilestoneSort = () => <select value={milestoneSortBy} onChange={e => setMilestoneSortBy(e.target.value)} className="text-xs border border-gray-200 rounded px-1.5 py-0.5 bg-white text-gray-500"><option value="date">By Date</option><option value="type">By Type</option><option value="team">By Team</option></select>;

  // ═══ RENDER — EXACT v3 LAYOUT ═════════════════════════════════

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 sticky top-0 z-30">
        <div className="max-w-[1500px] mx-auto px-5 py-3 flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-gray-900" style={{ fontFamily: FONT_H }}>{profile?.display_name || myInitials || 'My Planner'}</h1>
            <p className="text-xs text-gray-400">{activeView === 'week' ? `Week of ${weekLabel}` : fmtMonthLabel(monthDate)}</p>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex border border-gray-200 rounded-lg overflow-hidden">
              <button onClick={() => setActiveView('week')} className={`px-3 py-1.5 text-xs font-semibold ${activeView === 'week' ? 'bg-gray-900 text-white' : 'text-gray-500 hover:bg-gray-50'}`}>Week</button>
              <button onClick={() => setActiveView('month')} className={`px-3 py-1.5 text-xs font-semibold ${activeView === 'month' ? 'bg-gray-900 text-white' : 'text-gray-500 hover:bg-gray-50'}`}>Month</button>
            </div>
            {activeView === 'week' ? (
              <div className="flex items-center gap-1 border border-gray-200 rounded-lg overflow-hidden">
                <button onClick={() => setWeekOffset(w => w - 1)} className="px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50">←</button>
                <button onClick={() => setWeekOffset(0)} className={`px-3 py-1.5 text-sm font-medium ${weekOffset === 0 ? 'bg-hdla-green text-white' : 'text-gray-600 hover:bg-gray-50'}`}>This Week</button>
                <button onClick={() => setWeekOffset(w => w + 1)} className="px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50">→</button>
              </div>
            ) : (
              <div className="flex items-center gap-1 border border-gray-200 rounded-lg overflow-hidden">
                <button onClick={() => setMonthOffset(m => m - 1)} className="px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50">←</button>
                <button onClick={() => setMonthOffset(0)} className={`px-3 py-1.5 text-sm font-medium ${monthOffset === 0 ? 'bg-hdla-green text-white' : 'text-gray-600 hover:bg-gray-50'}`}>This Month</button>
                <button onClick={() => setMonthOffset(m => m + 1)} className="px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50">→</button>
              </div>
            )}
            {activeView === 'week' && <button onClick={exportForClaude} className="px-3 py-1.5 bg-gray-700 text-white rounded text-xs font-semibold hover:bg-gray-800">Export for Claude</button>}
            {isLeadership && <button onClick={() => setShowAssignModal(true)} className="px-3 py-1.5 bg-violet-600 text-white rounded text-xs font-semibold hover:bg-violet-700">+ Assign Task</button>}
            <div className="text-xs text-gray-400">{saving ? 'Saving...' : lastSaved ? `Saved ${lastSaved.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}` : ''}</div>
            <a href="/" className="text-xs text-gray-400 hover:text-gray-600">← Hub</a>
            <button onClick={handleSignOut} className="text-xs text-gray-400 hover:text-gray-600 border border-gray-200 rounded px-2 py-1">Sign Out</button>
          </div>
        </div>
      </div>

      {/* ═══ WEEKLY VIEW ═══ */}
      {activeView === 'week' && (
        <div className="max-w-[1500px] mx-auto px-5 py-4">
          <div className="grid grid-cols-12 gap-4">

            {/* ── COL 1: Priorities + Notes (3 cols) ── */}
            <div className="col-span-3 space-y-3">
              {['must', 'should', 'radar'].map(tier => {
                const cfg = TIER_CONFIG[tier]; const allItems = (entry.priorities || []).filter(p => p.tier === tier); const items = allItems.filter(p => !p.done);
                return (
                  <div key={tier} className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                    <div className={`flex items-center justify-between px-4 py-2.5 border-b ${cfg.color}`}>
                      <div className="flex items-center gap-2"><div className={`w-2.5 h-2.5 rounded-full ${cfg.dot}`} /><span className="text-sm font-semibold text-gray-700">{cfg.label}</span>{allItems.length > 0 && <span className={`text-xs px-1.5 py-0.5 rounded-full font-medium ${cfg.badge}`}>{allItems.filter(i => i.done).length}/{allItems.length}</span>}</div>
                      <button onClick={() => addPriority(tier)} className="text-xs text-gray-400 hover:text-hdla-green font-medium">+ Add</button>
                    </div>
                    <div className="p-2 space-y-1">
                      {items.length === 0 && <div className="text-xs text-gray-300 italic px-2 py-1.5">{tier === 'must' ? 'Non-negotiables this week' : tier === 'should' ? 'Important but not critical' : 'Keeping an eye on'}</div>}
                      {items.map(item => <PriorityItem key={item.id} item={item} onUpdate={patch => updatePriority(item.id, patch)} onDelete={() => deletePriority(item.id)} />)}
                    </div>
                  </div>
                );
              })}
              {/* Completed items — collapsed section */}
              {(() => {
                const completedItems = (entry.priorities || []).filter(p => p.done);
                if (completedItems.length === 0) return null;
                return (
                  <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                    <div className="flex items-center justify-between px-4 py-2.5 border-b border-gray-100 bg-gray-50">
                      <div className="flex items-center gap-2"><div className="w-2.5 h-2.5 rounded-full bg-green-500" /><span className="text-sm font-semibold text-gray-700">Completed</span><span className="text-xs px-1.5 py-0.5 rounded-full font-medium bg-green-100 text-green-700">{completedItems.length}</span></div>
                    </div>
                    <div className="p-2 space-y-1">
                      {completedItems.map(item => <PriorityItem key={item.id} item={item} onUpdate={patch => updatePriority(item.id, patch)} onDelete={() => deletePriority(item.id)} />)}
                    </div>
                  </div>
                );
              })()}
              <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                <div className="flex items-center gap-2 px-4 py-2.5 border-b border-gray-100 bg-green-50"><div className="w-2.5 h-2.5 rounded-full bg-hdla-green" /><span className="text-sm font-semibold text-gray-700">Focus & Notes</span></div>
                <div className="p-3"><NotesEditor value={entry.focus_notes} onChange={v => update({ focus_notes: v })} placeholder={`What matters most this week?\nKey decisions, people to connect with...`} /></div>
              </div>
              <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                <div className="flex items-center gap-2 px-4 py-2.5 border-b border-gray-100 bg-purple-50"><div className="w-2.5 h-2.5 rounded-full bg-purple-500" /><span className="text-sm font-semibold text-gray-700">Reflections</span></div>
                <div className="p-3"><NotesEditor value={entry.reflections} onChange={v => update({ reflections: v })} placeholder={`What moved forward?\nWhat's stuck?\nWhat carries over to next week?`} /></div>
              </div>
              {isLeadership && (
                <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                  <div className="flex items-center gap-2 px-4 py-2.5 border-b border-gray-100 bg-amber-50"><div className="w-2.5 h-2.5 rounded-full bg-amber-500" /><span className="text-sm font-semibold text-gray-700">Priority Clients</span>{((marketing?.priority) || []).filter(p => p.owner === myInitials && !p.done).length > 0 && <span className="text-xs px-1.5 py-0.5 rounded-full font-medium bg-amber-100 text-amber-700">{((marketing?.priority) || []).filter(p => p.owner === myInitials && !p.done).length}</span>}</div>
                  <div className="p-2 space-y-1 relative">
                    <input value={prioritySearch} onChange={e => setPrioritySearch(e.target.value)} placeholder="Add a client..." className="border border-gray-200 rounded px-2 py-1.5 text-sm bg-white w-full" />
                    {prioritySearch && (() => { const ms = (marketing?.clients || []).filter(c => c.name.toLowerCase().includes(prioritySearch.toLowerCase())).sort((a, b) => a.name.localeCompare(b.name)).slice(0, 6); return ms.length > 0 ? <div className="absolute z-10 left-2 right-2 mt-1 bg-white border border-gray-200 rounded shadow max-h-40 overflow-y-auto">{ms.map(c => <div key={c.id} onClick={() => { addPriorityClient(c.id); setPrioritySearch(''); }} className="px-2 py-1.5 text-sm cursor-pointer hover:bg-blue-50">{c.name}</div>)}</div> : null; })()}
                    {((marketing?.priority) || []).filter(p => p.owner === myInitials).sort((a, b) => (a.position || 0) - (b.position || 0)).map(p => { const c = (marketing?.clients || []).find(x => x.id === p.clientId); return (
                      <div key={p.id} className={"flex items-center gap-2 py-1 " + (p.done ? 'opacity-50' : '')}>
                        <input type="checkbox" checked={!!p.done} onChange={() => togglePriorityDone(p)} className="rounded flex-shrink-0" />
                        <div className="flex-1 min-w-0"><div className={"text-sm text-gray-800 truncate " + (p.done ? 'line-through' : '')}>{c?.name || '—'}</div>{p.note && <div className="text-xs text-gray-400 truncate">{p.note}</div>}</div>
                      </div>
                    ); })}
                    {((marketing?.priority) || []).filter(p => p.owner === myInitials).length === 0 && <div className="text-xs text-gray-300 italic px-2 py-1">Your priority clients show here</div>}
                  </div>
                </div>
              )}
            </div>

            {/* ── COL 2: Calendar + Meetings (3 cols) ── */}
            <div className="col-span-3 space-y-3">
              {/* Promoted Meetings — always visible */}
              {promotedKeys.size > 0 && (
                <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                  <div className="flex items-center gap-2 px-4 py-2.5 border-b border-gray-100 bg-blue-50">
                    <div className="w-2.5 h-2.5 rounded-full bg-blue-500" /><span className="text-sm font-semibold text-gray-700">Priority Meetings</span><span className="text-xs px-1.5 py-0.5 rounded-full font-medium bg-blue-100 text-blue-700">{[...promotedKeys].filter(k => !completedKeys.has(k)).length}</span>
                  </div>
                  <div className="p-2 space-y-1">
                    {(() => {
                      // Build promoted items from keys, enriched with calEvent data when available
                      const calByKey = {};
                      calEvents.forEach(e => { calByKey[eventKey(e)] = e; });
                      return [...promotedKeys].sort().map(key => {
                        const calEvt = calByKey[key];
                        const done = completedKeys.has(key);
                        // Parse subject and time from the key itself as fallback
                        const pipeIdx = key.indexOf('|');
                        const keySubject = pipeIdx > -1 ? key.slice(0, pipeIdx) : key;
                        const keyTime = pipeIdx > -1 ? key.slice(pipeIdx + 1) : '';
                        const subject = calEvt?.subject || keySubject;
                        const ts = calEvt ? (calEvt.isAllDay ? 'All day' : `${fmtTime(calEvt.start)} – ${fmtTime(calEvt.end)}`) : (keyTime ? fmtTime(keyTime) : '');
                        const dayStr = (() => { const raw = calEvt?.start || keyTime; if (!raw) return ''; const datePart = raw.split('T')[0].split('-').map(Number); if (datePart.length < 3) return ''; const d = new Date(datePart[0], datePart[1]-1, datePart[2]); return isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }); })();
                        const location = calEvt?.location || '';
                        const evtForToggle = calEvt || { subject: keySubject, start: keyTime };
                        return (
                          <div key={key} className={`flex items-center gap-2 p-2 rounded-lg border ${done ? 'border-gray-100 bg-gray-50' : 'border-blue-200 bg-blue-50/50'}`}>
                            <input type="checkbox" checked={done} onChange={() => toggleCompletedPromoted(evtForToggle)} className="rounded border-gray-300 text-blue-600 focus:ring-blue-500 flex-shrink-0 cursor-pointer" />
                            <div className="flex-1 min-w-0">
                              <div className={`text-sm truncate ${done ? 'line-through text-gray-400' : 'text-gray-900 font-medium'}`}>{subject}</div>
                              <div className={`text-xs ${done ? 'text-gray-300' : 'text-gray-500'}`}>{dayStr}{dayStr ? ' · ' : ''}{ts}{location ? ` · ${location}` : ''}</div>
                            </div>
                            <button onClick={() => togglePromote(evtForToggle)} className="text-xs text-gray-400 hover:text-red-500 flex-shrink-0" title="Demote">✕</button>
                          </div>
                        );
                      });
                    })()}
                  </div>
                </div>
              )}

              {/* Calendar Drawer — collapsible */}
              <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                <button onClick={() => setCalOpen(!calOpen)} className="flex items-center justify-between w-full px-4 py-2.5 border-b border-gray-100 bg-indigo-50 hover:bg-indigo-100 transition-colors">
                  <div className="flex items-center gap-2">
                    <div className="w-2.5 h-2.5 rounded-full bg-indigo-500" /><span className="text-sm font-semibold text-gray-700">Calendar</span>
                    {calEvents.length > 0 && <span className="text-xs px-1.5 py-0.5 rounded-full font-medium bg-indigo-100 text-indigo-700">{calEvents.length}</span>}
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-gray-400">Tap events to promote</span>
                    <span className={`text-gray-400 text-xs transition-transform ${calOpen ? 'rotate-180' : ''}`}>▼</span>
                  </div>
                </button>
                {calOpen && (
                  <div className="p-2 space-y-1 max-h-[400px] overflow-y-auto">
                    {calLoading && <div className="text-xs text-gray-300 italic px-2 py-2">Loading calendar...</div>}
                    {!calLoading && calEvents.length === 0 && <div className="text-xs text-gray-300 italic px-2 py-2">No calendar events this week</div>}
                    {calEvents.map(e => <CalendarEvent key={e.id} event={e} promoted={promotedKeys.has(eventKey(e))} onPromote={() => togglePromote(e)} />)}
                  </div>
                )}
              </div>
              <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                <div className="flex items-center justify-between px-4 py-2.5 border-b border-gray-100 bg-blue-50">
                  <div className="flex items-center gap-2"><div className="w-2.5 h-2.5 rounded-full bg-blue-500" /><span className="text-sm font-semibold text-gray-700">Manual Meetings</span>{sortedMeetings.length > 0 && <span className="text-xs px-1.5 py-0.5 rounded-full font-medium bg-blue-100 text-blue-700">{sortedMeetings.length}</span>}</div>
                  <button onClick={addMeeting} className="text-xs text-gray-400 hover:text-blue-600 font-medium">+ Add</button>
                </div>
                <div className="p-2 space-y-1.5">
                  {sortedMeetings.length === 0 && <div className="text-xs text-gray-300 italic px-2 py-2">Add meetings not in Outlook</div>}
                  {sortedMeetings.map(m => <MeetingItem key={m.id} meeting={m} onUpdate={patch => updateMeeting(m.id, patch)} onDelete={() => deleteMeeting(m.id)} />)}
                </div>
              </div>
              {isLeadership && (
                <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                  <button onClick={() => setShowTP(true)} className="flex items-center gap-2 w-full px-4 py-2.5 bg-hdla-green/5 hover:bg-hdla-green/10 transition-colors"><div className="w-2.5 h-2.5 rounded-full bg-hdla-green" /><span className="text-sm font-semibold text-gray-700">+ Log Touchpoint</span></button>
                </div>
              )}
            </div>

            {/* ── COL 3: Projects + Milestones (3 cols) ── */}
            <div className="col-span-3 space-y-3">
              {/* Kickoffs — visible to partner, principal, CM/EP */}
              {showKickoff && kickoffs.length > 0 && (
                <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                  <div className="flex items-center gap-2 px-4 py-2.5 border-b border-gray-100 bg-orange-50"><div className="w-2.5 h-2.5 rounded-full bg-orange-500" /><span className="text-sm font-semibold text-gray-700">Kickoff Needed</span><span className="text-xs px-1.5 py-0.5 rounded-full font-medium bg-orange-100 text-orange-700">{kickoffs.length}</span></div>
                  <div className="px-4 py-2">{kickoffs.map(k => (
                    <div key={k.id} className="flex items-center gap-2 py-1.5 border-b border-gray-100 last:border-0">
                      <input type="checkbox" onChange={() => markKickoffDone(k)} className="rounded border-gray-300 text-hdla-green focus:ring-green-500 flex-shrink-0 cursor-pointer" title="Mark kickoff done" />
                      <div className="flex-1 min-w-0"><div className="text-sm text-gray-800 truncate">{k.projectName}</div><div className="text-xs text-gray-400">{k.partner} · {PRINCIPAL_NAMES[k.pm] || k.pm || ''} · {fmt$(k.fee)}</div></div>
                    </div>
                  ))}</div>
                </div>
              )}

              {/* Assigned Tasks — received */}
              {(receivedOpen.length > 0 || receivedDone.length > 0) && (
                <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                  <div className="flex items-center gap-2 px-4 py-2.5 border-b border-gray-100 bg-violet-50">
                    <div className="w-2.5 h-2.5 rounded-full bg-violet-500" />
                    <span className="text-sm font-semibold text-gray-700">Assigned to You</span>
                    {receivedOpen.length > 0 && <span className="text-xs px-1.5 py-0.5 rounded-full font-medium bg-violet-100 text-violet-700">{receivedOpen.length}</span>}
                  </div>
                  <div className="px-4 py-2">
                    {receivedOpen.map(t => { const src = sourceOf(t); return (
                      <div key={t.id} className="flex items-center gap-2 py-1.5 border-b border-gray-100 last:border-0" data-task-source={t.sourceType || 'manual'}>
                        <input type="checkbox" checked={false} onChange={() => toggleTaskDone(t)} className="rounded border-gray-300 text-violet-600 focus:ring-violet-500 flex-shrink-0 cursor-pointer" title={src ? 'Done here = done in Marketing too' : 'Mark done'} />
                        <div className="flex-1 min-w-0">
                          <div className="text-sm text-gray-800">{t.description || <span className="italic text-gray-400">(no description)</span>}</div>
                          <div className="text-xs text-gray-400 flex items-center gap-1 flex-wrap">
                            {src && <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${src.cls}`}>{src.label}</span>}
                            {src && src.text && <span className="text-gray-500">{src.text} ·</span>}
                            {!src && t.projectName ? <span>{t.projectName} ·</span> : null}
                            <span>{t.assignedBy === myInitials ? 'Self-assigned' : `From ${STAFF_NAMES[t.assignedBy] || t.assignedBy}`}{t.dueDate ? ` · Due ${fmtDate(t.dueDate)}` : ''}</span>
                          </div>
                        </div>
                        {t.dueDate && (() => { const d = Math.ceil((new Date(t.dueDate) - new Date()) / 864e5); return d <= 2 ? <span className="text-xs font-bold text-red-500 flex-shrink-0">{d <= 0 ? 'Overdue' : `${d}d`}</span> : d <= 7 ? <span className="text-xs font-medium text-amber-500 flex-shrink-0">{d}d</span> : null; })()}
                      </div>
                    ); })}
                    {receivedDone.length > 0 && <div className="text-xs text-gray-400 mt-2 mb-1 font-medium">Completed</div>}
                    {receivedDone.slice(0, 3).map(t => (
                      <div key={t.id} className="flex items-center gap-2 py-1 opacity-50">
                        <input type="checkbox" checked={true} onChange={() => toggleTaskDone(t)} className="rounded border-gray-300 text-violet-600 focus:ring-violet-500 flex-shrink-0 cursor-pointer" />
                        <div className="text-sm text-gray-400 line-through truncate flex-1">{t.description}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Assigned Tasks — sent (leadership only) */}
              {isLeadership && sentOpen.length > 0 && (
                <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                  <div className="flex items-center gap-2 px-4 py-2.5 border-b border-gray-100 bg-indigo-50">
                    <div className="w-2.5 h-2.5 rounded-full bg-indigo-500" />
                    <span className="text-sm font-semibold text-gray-700">Tasks You Assigned</span>
                    <span className="text-xs px-1.5 py-0.5 rounded-full font-medium bg-indigo-100 text-indigo-700">{sentOpen.length}</span>
                  </div>
                  <div className="px-4 py-2">
                    {sentOpen.map(t => { const src = sourceOf(t); return (
                      <div key={t.id} className="flex items-center gap-2 py-1.5 border-b border-gray-100 last:border-0" data-task-source={t.sourceType || 'manual'}>
                        <span className={`w-2 h-2 rounded-full flex-shrink-0 ${t.done ? 'bg-green-500' : 'bg-gray-300'}`} />
                        <div className="flex-1 min-w-0">
                          <div className="text-sm text-gray-800">{t.description || <span className="italic text-gray-400">(no description)</span>}</div>
                          <div className="text-xs text-gray-400 flex items-center gap-1 flex-wrap">
                            {src && <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${src.cls}`}>{src.label}</span>}
                            {src && src.text && <span className="text-gray-500">{src.text} ·</span>}
                            <span>To {STAFF_NAMES[t.assignedTo] || t.assignedTo}{!src && t.projectName ? ` · ${t.projectName}` : ''}{t.dueDate ? ` · Due ${fmtDate(t.dueDate)}` : ''}</span>
                          </div>
                        </div>
                        {src ? <span className="text-[10px] text-gray-300 flex-shrink-0" title="Remove it from the lead or touchpoint in Marketing">via Marketing</span> : <button onClick={() => deleteAssignedTask(t.id)} className="text-xs text-gray-300 hover:text-red-500 flex-shrink-0">✕</button>}
                      </div>
                    ); })}
                  </div>
                </div>
              )}

              {/* Pulse — vertical list with review checkboxes for partners */}
              <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                <div className="flex items-center gap-2 px-4 py-2.5 border-b border-gray-100 bg-red-50"><div className="w-2.5 h-2.5 rounded-full bg-red-500" /><span className="text-sm font-semibold text-gray-700">Needs Your Attention</span>{pulse.filter(p => { if (p.type === 'review') { const proj = projects.find(x => x.id === p.projectId); return !(proj?.reviewCompletedBy || {})[myInitials]; } return !dismissedPulse.has(p.projectId + p.type); }).length > 0 && <span className="text-xs px-1.5 py-0.5 rounded-full font-medium bg-red-100 text-red-700">{pulse.filter(p => { if (p.type === 'review') { const proj = projects.find(x => x.id === p.projectId); return !(proj?.reviewCompletedBy || {})[myInitials]; } return !dismissedPulse.has(p.projectId + p.type); }).length}</span>}</div>
                <div className="px-4 py-2">
                  {pulse.length === 0 && <div className="text-xs text-gray-300 italic py-2">All clear</div>}
                  {pulse.map((p, i) => {
                    const isReview = p.type === 'review';
                    const proj = isReview ? projects.find(x => x.id === p.projectId) : null;
                    const isReviewDone = isReview && (proj?.reviewCompletedBy || {})[myInitials];
                    const isDismissed = isReview ? isReviewDone : dismissedPulse.has(p.projectId + p.type);
                    return (
                    <div key={i} className="flex items-center gap-2 py-1.5 border-b border-gray-100 last:border-0">
                      <input type="checkbox" checked={!!isDismissed} onChange={() => { if (isReview) { if (isReviewDone) { undoReview(p.projectId); } else { markReviewed(p.projectId); } } else { toggleDismissPulse(p.projectId + p.type); } }} className="rounded border-gray-300 text-hdla-green focus:ring-green-500 flex-shrink-0 cursor-pointer" title={isDismissed ? 'Undo' : 'Mark done'} />
                      <div className={`flex-1 min-w-0 ${isDismissed ? 'opacity-50' : ''}`}><div className={`text-sm text-gray-800 truncate ${isDismissed ? 'line-through' : ''}`}>{p.label}</div><div className={`text-xs text-gray-400 truncate ${isDismissed ? 'line-through' : ''}`}>{PRINCIPAL_NAMES[p.principal] || p.principal} · {p.sub}</div></div>
                      <span className={`text-xs px-1.5 py-0.5 rounded font-semibold flex-shrink-0 ${isDismissed ? 'opacity-30' : ''} ${p.badgeColor}`}>{isDismissed ? '✓ Done' : p.badge}</span>
                    </div>
                    );
                  })}
                </div>
              </div>

              {/* Milestones — sortable */}
              <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                <div className="flex items-center justify-between px-4 py-2.5 border-b border-gray-100 bg-gray-50">
                  <div className="flex items-center gap-2"><div className="w-2.5 h-2.5 rounded-full bg-gray-500" /><span className="text-sm font-semibold text-gray-700">Milestones This Week</span>{weekMilestones.length > 0 && <span className="text-xs px-1.5 py-0.5 rounded-full font-medium bg-gray-100 text-gray-600">{weekMilestones.length}</span>}</div>
                  <MilestoneSort />
                </div>
                <div className="px-4 py-2 max-h-[350px] overflow-y-auto">
                  {weekMilestones.length === 0 ? <div className="text-xs text-gray-300 italic py-2">No milestones this week</div> : weekMilestones.map((m, i) => <MilestonePill key={i} {...m} />)}
                </div>
              </div>
            </div>

            {/* ── COL 4: BD + Proposals (3 cols) — hidden for non-leadership ── */}
            <div className="col-span-3 space-y-3">
              {isLeadership ? (<>
                {/* My Proposals — open ones I lead or PM (item 3) */}
                <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                  <div className="flex items-center gap-2 px-4 py-2.5 border-b border-gray-100 bg-blue-50"><div className="w-2.5 h-2.5 rounded-full bg-blue-500" /><span className="text-sm font-semibold text-gray-700">My Proposals</span>{myProposals.length > 0 && <span className="text-xs px-1.5 py-0.5 rounded-full font-medium bg-blue-100 text-blue-700">{myProposals.length}</span>}</div>
                  <div className="px-4 py-1">
                    {myProposals.length === 0 && <div className="text-xs text-gray-300 italic py-2">No open proposals</div>}
                    {myProposals.map(p => { const c = (marketing?.clients || []).find(x => x.id === p.clientId); const role = p.partner === myInitials ? 'Lead' : 'PM'; return (
                      <div key={p.id} className="flex items-center gap-2 py-1.5 border-b border-gray-100 last:border-0">
                        <div className="flex-1 min-w-0"><div className="text-sm text-gray-800 truncate">{p.projectName}</div><div className="text-xs text-gray-400 truncate">{c?.name || ''} · {p.status}{p.dueDate ? ` · Due ${fmtDate(p.dueDate)}` : ''}</div></div>
                        <span className="text-xs px-1.5 py-0.5 rounded font-medium bg-gray-100 text-gray-600 flex-shrink-0">{role}</span>
                      </div>
                    ); })}
                  </div>
                </div>
                {/* BD This Week */}
                <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                  <div className="flex items-center gap-2 px-4 py-2.5 border-b border-gray-100 bg-hdla-green/5"><div className="w-2.5 h-2.5 rounded-full bg-hdla-green" /><span className="text-sm font-semibold text-gray-700">BD This Week</span></div>
                  <div className="px-4 py-1">
                    {/* Planned touchpoints this week */}
                    {(bdReminders.weekTPs || []).map((t, i) => { const c = (bdReminders.clients || []).find(x => x.id === t.clientId); return <BDItem key={`tp-${i}`} icon="📅" color="text-blue-500" label={`${t.type} — ${c?.name || 'Client'}`} sub={fmtDate(t.date)} right={t.partner} />; })}
                    {/* Events I'm attending this week */}
                    {(() => { const myEvents = (marketing?.events || []).filter(e => { const eStart = new Date(e.date); const eEnd = e.endDate ? new Date(e.endDate) : eStart; return (e.attendees || []).includes(myInitials) && eStart <= weekEndDate && eEnd >= monday; }); return myEvents.map((e, i) => <BDItem key={`evt-${i}`} icon="🎤" color="text-green-500" label={e.name} sub={`${fmtDate(e.date)}${e.endDate && e.endDate !== e.date ? ` – ${fmtDate(e.endDate)}` : ''} · ${e.location || ''}`} />); })()}
                    {/* Proposal milestones this week (my proposals only) */}
                    {(() => { const myProps = (marketing?.proposals || []).filter(p => p.partner === myInitials && !['Awarded','Not Awarded','Declined'].includes(p.status)); const milestones = myProps.flatMap(p => (p.tasks || []).filter(t => t.type && t.date && isDateInRange(t.date, monday, weekEndDate)).map(t => ({ ...t, proposalName: p.projectName }))); return milestones.map((m, i) => <BDItem key={`pm-${i}`} icon={m.type === 'deadline' ? '🔴' : m.type === 'hardCheckIn' ? '🔵' : '🩷'} color="text-amber-600" label={m.desc || m.type} sub={m.proposalName} />); })()}
                    {!bdReminders.weekTPs?.length && <div className="text-xs text-gray-300 italic py-2">No BD actions this week</div>}
                  </div>
                </div>
                {/* Proposals Due */}
                <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                  <div className="flex items-center gap-2 px-4 py-2.5 border-b border-gray-100 bg-amber-50"><div className="w-2.5 h-2.5 rounded-full bg-amber-500" /><span className="text-sm font-semibold text-gray-700">Proposals Due</span>{(bdReminders.weekProposals?.length || 0) > 0 && <span className="text-xs px-1.5 py-0.5 rounded-full font-medium bg-amber-100 text-amber-700">{bdReminders.weekProposals.length}</span>}</div>
                  <div className="px-4 py-1">
                    {(!bdReminders.weekProposals || bdReminders.weekProposals.length === 0) && <div className="text-xs text-gray-300 italic py-2">None due this week</div>}
                    {(bdReminders.weekProposals || []).map((p, i) => <div key={i} className="flex items-center gap-2 py-1.5 border-b border-gray-100 last:border-0"><span className={`text-xs px-1.5 py-0.5 rounded font-bold ${p.probability === 'H' ? 'bg-green-100 text-green-800' : p.probability === 'M' ? 'bg-yellow-100 text-yellow-800' : 'bg-red-100 text-red-800'}`}>{p.probability}</span><div className="flex-1 min-w-0"><div className="text-sm text-gray-800 truncate">{p.projectName}</div><div className="text-xs text-gray-400">{fmtDate(p.dueDate)} · {fmt$(p.fee)}</div></div></div>)}
                  </div>
                </div>
                {/* Going Cold */}
                {bdReminders.coldClients?.length > 0 && (
                  <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                    <div className="flex items-center gap-2 px-4 py-2.5 border-b border-gray-100 bg-red-50"><div className="w-2.5 h-2.5 rounded-full bg-red-400" /><span className="text-sm font-semibold text-gray-700">Going Cold</span><span className="text-xs px-1.5 py-0.5 rounded-full font-medium bg-red-100 text-red-700">{bdReminders.coldClients.length}</span></div>
                    <div className="px-4 py-1">{bdReminders.coldClients.map((c, i) => <div key={i} className="flex items-center justify-between py-1.5 border-b border-gray-100 last:border-0"><div className="min-w-0"><div className="text-sm text-gray-800">{c.name}</div><div className="text-xs text-gray-400">T{c.tier}{c.strategic ? ' · S' : ''} · Last: {c.lastDate ? fmtDate(c.lastDate) : '—'}</div></div><span className="text-sm font-bold text-red-500 flex-shrink-0">{c.days}d</span></div>)}</div>
                  </div>
                )}
              </>) : (
                /* Non-leadership: show a simpler col 4 with just milestones overflow or notes */
                <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                  <div className="flex items-center gap-2 px-4 py-2.5 border-b border-gray-100 bg-gray-50"><div className="w-2.5 h-2.5 rounded-full bg-gray-400" /><span className="text-sm font-semibold text-gray-700">My Tasks</span></div>
                  <div className="px-4 py-2">
                    {myProjects.length === 0 ? <div className="text-xs text-gray-300 italic py-2">No assigned projects</div> :
                      myProjects.slice(0, 8).map((p, i) => <div key={i} className="py-1.5 border-b border-gray-100 last:border-0"><div className="text-sm text-gray-800">{p.projectName}</div><div className="text-xs text-gray-400">{p.phase} · {PRINCIPAL_NAMES[p.principal] || p.principal}</div></div>)
                    }
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ═══ MONTHLY VIEW ═══ */}
      {activeView === 'month' && (
        <div className="max-w-[1200px] mx-auto px-5 py-4">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
              <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 bg-gray-50"><div className="flex items-center gap-2"><span className="text-sm font-bold text-gray-700" style={{ fontFamily: FONT_H }}>Project Milestones</span><span className="text-xs px-1.5 py-0.5 rounded-full font-medium bg-gray-100 text-gray-600">{monthMilestones.length}</span></div><MilestoneSort /></div>
              <div className="p-4 max-h-[600px] overflow-y-auto">
                {monthMilestones.length === 0 ? <div className="text-sm text-gray-300 italic py-4 text-center">No milestones this month</div> : (() => {
                  let lastWeek = '';
                  return monthMilestones.map((m, i) => {
                    const gk = milestoneSortBy === 'team' ? (PRINCIPAL_NAMES[m.principal] || m.principal) : milestoneSortBy === 'type' ? (MS_COLORS[m.type]?.label || m.type) : fmtWeekLabel(getMonday(new Date(m.date)));
                    const sh = gk !== lastWeek; lastWeek = gk;
                    return <div key={i}>{sh && <div className="text-xs font-bold text-gray-500 uppercase tracking-wide pt-3 pb-1 border-b border-gray-100 mb-1">{milestoneSortBy === 'date' ? `Week of ${gk}` : gk}</div>}<MilestonePill {...m} compact /></div>;
                  });
                })()}
              </div>
            </div>
            <div className="space-y-4">
              {isLeadership && (<div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                <div className="flex items-center gap-2 px-4 py-3 border-b border-gray-100 bg-amber-50"><span className="text-sm font-bold text-gray-700" style={{ fontFamily: FONT_H }}>Proposals Due</span><span className="text-xs px-1.5 py-0.5 rounded-full font-medium bg-amber-100 text-amber-700">{bdReminders.monthProposals?.length || 0}</span></div>
                <div className="p-4">{(!bdReminders.monthProposals || bdReminders.monthProposals.length === 0) ? <div className="text-sm text-gray-300 italic py-4 text-center">No proposals due this month</div> : bdReminders.monthProposals.map((p, i) => <div key={i} className="flex items-center gap-3 py-2 border-b border-gray-100 last:border-0"><span className={`text-xs px-1.5 py-0.5 rounded font-bold ${p.probability === 'H' ? 'bg-green-100 text-green-800' : p.probability === 'M' ? 'bg-yellow-100 text-yellow-800' : 'bg-red-100 text-red-800'}`}>{p.probability}</span><div className="flex-1 min-w-0"><div className="text-sm font-medium text-gray-800 truncate">{p.projectName}</div><div className="text-xs text-gray-400">Due {fmtDate(p.dueDate)} · {fmt$(p.fee)}</div></div></div>)}</div>
              </div>)}
              {isLeadership && bdReminders.coldClients?.length > 0 && (<div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                <div className="flex items-center gap-2 px-4 py-3 border-b border-gray-100 bg-red-50"><span className="text-sm font-bold text-gray-700" style={{ fontFamily: FONT_H }}>Clients Going Cold</span><span className="text-xs px-1.5 py-0.5 rounded-full font-medium bg-red-100 text-red-700">{bdReminders.coldClients.length}</span></div>
                <div className="p-4 space-y-1">{bdReminders.coldClients.map((c, i) => <div key={i} className="flex items-center justify-between py-2 border-b border-gray-100 last:border-0"><div><div className="text-sm font-medium text-gray-800">{c.name}</div><div className="text-xs text-gray-400">Last: {c.lastDate ? fmtDate(c.lastDate) : 'Never'} · Tier {c.tier}</div></div><span className="text-sm font-bold text-red-500">{c.days}d</span></div>)}</div>
              </div>)}
              {showKickoff && kickoffs.length > 0 && (<div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                <div className="flex items-center gap-2 px-4 py-3 border-b border-gray-100 bg-orange-50"><span className="text-sm font-bold text-gray-700" style={{ fontFamily: FONT_H }}>Kickoffs Needed</span><span className="text-xs px-1.5 py-0.5 rounded-full font-medium bg-orange-100 text-orange-700">{kickoffs.length}</span></div>
                <div className="p-4">{kickoffs.map(k => <div key={k.id} className="flex items-center gap-2 py-2 border-b border-gray-100 last:border-0"><input type="checkbox" onChange={() => markKickoffDone(k)} className="rounded border-gray-300 text-hdla-green focus:ring-green-500 cursor-pointer" /><div className="flex-1"><div className="text-sm font-medium text-gray-800">{k.projectName}</div><div className="text-xs text-gray-400">{k.partner} · {fmt$(k.fee)} · Awarded {fmtDate(k.awardedDate)}</div></div></div>)}</div>
              </div>)}
            </div>
          </div>
        </div>
      )}

      {/* ═══ ASSIGN TASK MODAL ═══ */}
      {showAssignModal && (() => {
        const AssignModal = () => {
          const [assignTo, setAssignTo] = useState('');
          const [desc, setDesc] = useState('');
          const [dueDate, setDueDate] = useState('');
          const [projName, setProjName] = useState('');
          const [projSearch, setProjSearch] = useState('');
          const [submitting, setSubmitting] = useState(false);
          
          const allProjects = (projects || []).filter(p => p.projectName);
          const filteredProjects = projSearch ? allProjects.filter(p => p.projectName.toLowerCase().includes(projSearch.toLowerCase()) || (p.projectNum || '').includes(projSearch)).slice(0, 8) : [];
          
          const handleSubmit = async () => {
            if (!assignTo || !desc) return;
            setSubmitting(true);
            await createAssignedTask({
              id: uid(),
              description: desc,
              assignedBy: myInitials,
              assignedTo: assignTo,
              projectNum: '',
              projectName: projName,
              dueDate: dueDate,
            });
            setSubmitting(false);
            setShowAssignModal(false);
          };
          
          return (
            <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50" onClick={() => setShowAssignModal(false)}>
              <div className="bg-white rounded-xl shadow-xl w-[440px] max-h-[90vh] overflow-auto" onClick={e => e.stopPropagation()}>
                <div className="sticky top-0 bg-white border-b px-5 py-3 flex justify-between items-center z-10">
                  <div className="font-bold text-gray-900" style={{ fontFamily: FONT_H }}>Assign Task</div>
                  <button onClick={handleSubmit} disabled={!assignTo || !desc || submitting} className="bg-violet-600 text-white px-4 py-1.5 rounded text-sm font-medium disabled:bg-gray-300 disabled:cursor-not-allowed">{submitting ? 'Saving...' : 'Assign'}</button>
                </div>
                <div className="p-5 space-y-4">
                  <div>
                    <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Assign To</label>
                    <select value={assignTo} onChange={e => setAssignTo(e.target.value)} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white">
                      <option value="">Select person...</option>
                      {ALL_STAFF.map(s => <option key={s} value={s}>{s} — {STAFF_NAMES[s] || s}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Task Description</label>
                    <textarea value={desc} onChange={e => setDesc(e.target.value)} placeholder="What needs to be done..." className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm resize-none h-20 focus:outline-none focus:ring-2 focus:ring-violet-400" autoFocus />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Due Date</label>
                    <input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white" />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Project (optional)</label>
                    <input type="text" value={projSearch} onChange={e => { setProjSearch(e.target.value); if (!e.target.value) setProjName(''); }} placeholder="Search projects..." className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" />
                    {projName && !projSearch && <div className="text-sm font-medium text-gray-800 bg-green-50 px-3 py-2 rounded-lg mt-1 flex justify-between items-center"><span>{projName}</span><button onClick={() => { setProjName(''); setProjSearch(''); }} className="text-xs text-gray-400 hover:text-red-500">✕</button></div>}
                    {projSearch && filteredProjects.length > 0 && <div className="max-h-[120px] overflow-y-auto border border-gray-200 rounded-lg mt-1">{filteredProjects.map(p => <div key={p.id} onClick={() => { setProjName(p.projectName); setProjSearch(''); }} className="px-3 py-1.5 text-sm cursor-pointer hover:bg-blue-50">{p.projectName} <span className="text-gray-400">{p.projectNum}</span></div>)}</div>}
                  </div>
                </div>
              </div>
            </div>
          );
        };
        return <AssignModal />;
      })()}
      {showTP && <TouchpointFormModal clients={marketing?.clients || []} defaultPartner={myInitials} onSave={logTouchpoint} onClose={() => setShowTP(false)} />}
    </div>
  );
}

// ═══ ROOT ═══════════════════════════════════════════════════════

function PlannerPageInner() {
  const { user, profile } = useAuth();
  const [projects, setProjects] = useState([]);
  const [marketing, setMarketing] = useState(null);
  const [assignedTasks, setAssignedTasks] = useState({ received: [], sent: [] });
  useEffect(() => {
    if (!user) return;
    fetch('/api/projects').then(r => r.json()).then(d => setProjects(d.projects || [])).catch(() => {});
    const role = profile?.role || 'staff';
    if (['partner', 'operations', 'office', 'marketing', 'principal'].includes(role)) { fetch('/api/marketing').then(r => r.json()).then(d => setMarketing(d)).catch(() => {}); }
    const initials = profile?.initials || '';
    if (initials) fetch(`/api/assigned-tasks?initials=${initials}`).then(r => r.json()).then(d => setAssignedTasks({ received: d.received || [], sent: d.sent || [] })).catch(() => {});
  }, [user, profile]);
  const handleUpdate = u => setProjects(p => p.map(x => x.id === u.id ? u : x));
  // Guard: don't render PlannerApp until user AND profile are loaded
  if (!user || !profile) return <div className="min-h-screen bg-gray-50 flex items-center justify-center"><div className="animate-pulse text-gray-400">Loading your planner...</div></div>;
  return <PlannerApp user={user} profile={profile} projects={projects} marketing={marketing} onUpdateProject={handleUpdate} assignedTasks={assignedTasks} setAssignedTasks={setAssignedTasks} setMarketing={setMarketing} />;
}

class PlannerErrorBoundary extends React.Component {
  constructor(props) { super(props); this.state = { hasError: false, error: null }; }
  static getDerivedStateFromError(error) { return { hasError: true, error }; }
  render() {
    if (this.state.hasError) return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="bg-white rounded-2xl shadow-lg border border-gray-200 p-8 w-[480px] text-center">
          <h1 className="text-xl font-bold text-gray-900 mb-2" style={{ fontFamily: 'Flecha M, Georgia, serif' }}>Planner Error</h1>
          <p className="text-sm text-gray-500 mb-3">Something went wrong loading your planner.</p>
          <pre className="text-xs text-red-600 bg-red-50 rounded p-3 mb-4 text-left overflow-auto max-h-40">{this.state.error?.message || 'Unknown error'}</pre>
          <button onClick={() => { this.setState({ hasError: false, error: null }); window.location.reload(); }} className="px-4 py-2 bg-hdla-green text-white rounded text-sm font-medium">Reload Page</button>
        </div>
      </div>
    );
    return this.props.children;
  }
}

export default function PlannerPage() {
  return <AuthGate moduleId="planner"><PlannerErrorBoundary><PlannerPageInner /></PlannerErrorBoundary></AuthGate>;
}
