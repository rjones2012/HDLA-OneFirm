'use client';
// The personal half of the home: today's calendar, my next steps, weekly priorities, notes and export.
// These carry the old Planner forward on the same weekly_planner table.
import { useEffect, useRef, useState } from 'react';
import { Panel, Pill, Link, Button, Empty, Textarea, fmtDate, todayKey } from '../shell/ui';
import { STAFF_NAMES } from '../marketing-shared';

const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const normalizeTime = t => (t ? t.replace(/\.?\d*$/, '').replace(/T(\d{2}):(\d{2}):(\d{2}).*/, 'T$1:$2:$3') : '');
export const eventKey = e => `${e.subject}|${normalizeTime(e.start)}`;
const fmtTime = iso => { if (!iso) return ''; const d = new Date(iso.split('.')[0]); return isNaN(d) ? '' : d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true }); };

// One copy of the week's planner entry, autosaved. Returned from the page and handed to the panels.
export function usePlanner(loaded, user, weekKey) {
  const [entry, setEntry] = useState(null);
  const timer = useRef(null);
  useEffect(() => {
    if (!loaded || !user) return;
    const base = loaded.entry || { user_id: user.id, week_key: weekKey, focus_notes: '', meetings: [], priorities: loaded.carriedPriorities || [], reflections: '', promoted_events: [], completed_promoted: [] };
    setEntry({ ...base, priorities: base.priorities || [], promoted_events: base.promoted_events || [], completed_promoted: base.completed_promoted || [] });
  }, [loaded, user, weekKey]);
  const update = patch => {
    setEntry(prev => {
      const next = { ...prev, ...patch };
      clearTimeout(timer.current);
      timer.current = setTimeout(() => { fetch('/api/planner', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(next) }).catch(() => {}); }, 600);
      return next;
    });
  };
  return { entry, update };
}

export function TodayPanel({ events, planner }) {
  const { entry, update } = planner;
  const today = todayKey();
  const todays = events.filter(e => (e.start || '').slice(0, 10) === today).sort((a, b) => (a.start || '').localeCompare(b.start || ''));
  const promoted = new Set(entry?.promoted_events || []), done = new Set(entry?.completed_promoted || []);
  const toggle = (e, set, field) => { const k = eventKey(e); const n = new Set(set); n.has(k) ? n.delete(k) : n.add(k); update({ [field]: [...n] }); };
  return (
    <Panel title="Today" meta="Outlook">
      {todays.length === 0 ? <Empty>No meetings today.</Empty> : (
        <div className="flex flex-col">
          {todays.map(e => { const k = eventKey(e); const on = promoted.has(k), fin = done.has(k); return (
            <div key={e.id || k} className="grid grid-cols-[64px_minmax(0,1fr)_auto] gap-3 px-5 py-3 border-b border-hair last:border-0 items-start">
              <span className="text-[13px] text-muted">{e.isAllDay ? 'All day' : fmtTime(e.start)}</span>
              <div>
                <div className={'text-sm ' + (fin ? 'line-through text-done' : '')}>{e.subject}</div>
                <div className="text-xs text-muted">{e.location ? e.location + ' · ' : ''}<Link href="/time">Log as time</Link></div>
              </div>
              <label className="flex items-center gap-1.5 text-[11px] text-muted cursor-pointer" title={on ? 'On my plan — tick when done' : 'Add to my plan'}>
                <input type="checkbox" className="w-4 h-4" checked={on ? fin : false} onChange={() => on ? toggle(e, done, 'completed_promoted') : toggle(e, promoted, 'promoted_events')} />{on ? 'done' : 'plan'}
              </label>
            </div>); })}
        </div>
      )}
    </Panel>
  );
}

export function NextStepsPanel({ steps, initials, reload }) {
  const open = steps.filter(t => !t.done).sort((a, b) => (a.dueDate || '9999').localeCompare(b.dueDate || '9999'));
  const done = steps.filter(t => t.done).slice(0, 3);
  const [showAll, setShowAll] = useState(false);
  const list = showAll ? open : open.slice(0, 5);
  const toggle = async (t, v) => { await fetch('/api/assigned-tasks', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ toggleDone: { id: t.id, done: v } }) }); reload(); };
  const src = t => t.sourceType === 'lead' ? 'Lead' : t.sourceType === 'touchpoint' ? 'Touchpoint' : null;
  return (
    <Panel title="My next steps" meta={<span>{open.length} open</span>}>
      {open.length === 0 && done.length === 0 ? <Empty>Nothing assigned to you.</Empty> : (
        <div className="flex flex-col">
          {list.map(t => (
            <label key={t.id} className="grid grid-cols-[18px_minmax(0,1fr)] gap-3 items-start px-5 py-3 border-b border-hair cursor-pointer">
              <input type="checkbox" className="w-[18px] h-[18px] mt-0.5" checked={false} onChange={() => toggle(t, true)} title={src(t) ? 'Done here = done in Marketing too' : 'Mark done'} />
              <div>
                <div className="text-sm">{t.description || <span className="italic text-muted">(no description)</span>}</div>
                <div className="text-xs text-muted">{src(t) && <span className="text-accent font-bold">{src(t)} · </span>}{t.sourceLabel ? t.sourceLabel + ' · ' : (t.projectName ? t.projectName + ' · ' : '')}{t.assignedBy === initials ? 'self-assigned' : `from ${STAFF_NAMES[t.assignedBy] || t.assignedBy}`}{t.dueDate ? <> · <span className={t.dueDate < todayKey() ? 'text-status-red font-bold' : ''}>due {fmtDate(t.dueDate)}</span></> : ''}</div>
              </div>
            </label>
          ))}
          {open.length > 5 && <button type="button" onClick={() => setShowAll(s => !s)} className="text-left px-5 py-3 text-[13px] font-bold text-accent border-b border-hair">{showAll ? 'Fewer' : `All ${open.length} →`}</button>}
          {done.length > 0 && <div className="px-5 pt-2 text-xs text-muted font-bold">Completed</div>}
          {done.map(t => (
            <label key={t.id} className="grid grid-cols-[18px_minmax(0,1fr)] gap-3 items-center px-5 py-2 opacity-60 cursor-pointer">
              <input type="checkbox" className="w-[18px] h-[18px]" checked onChange={() => toggle(t, false)} />
              <div className="text-sm line-through text-done truncate">{t.description}</div>
            </label>
          ))}
        </div>
      )}
    </Panel>
  );
}

const TIERS = [{ id: 1, label: 'Must do' }, { id: 2, label: 'Should do' }, { id: 3, label: 'Could do' }];
export function PrioritiesPanel({ planner }) {
  const { entry, update } = planner;
  if (!entry) return null;
  const list = entry.priorities || [];
  const setP = (id, patch) => update({ priorities: list.map(p => p.id === id ? { ...p, ...patch } : p) });
  const add = tier => update({ priorities: [...list, { id: uid(), text: '', done: false, tier }] });
  const del = id => update({ priorities: list.filter(p => p.id !== id) });
  return (
    <Panel title="This week" meta="My priorities · carried over if not done">
      <div className="flex flex-col">
        {TIERS.map(t => { const rows = list.filter(p => (p.tier || 1) === t.id); return (
          <div key={t.id} className="px-5 py-3 border-b border-hair last:border-0">
            <div className="flex justify-between items-center mb-1"><span className="text-[11px] tracking-[0.06em] uppercase text-muted">{t.label}</span><button type="button" onClick={() => add(t.id)} className="text-xs font-bold text-accent">+ Add</button></div>
            {rows.length === 0 && <div className="text-xs text-muted italic">—</div>}
            {rows.map(p => (
              <div key={p.id} className="grid grid-cols-[18px_minmax(0,1fr)_auto] gap-2 items-center py-1">
                <input type="checkbox" className="w-[18px] h-[18px]" checked={!!p.done} onChange={e => setP(p.id, { done: e.target.checked })} />
                <input value={p.text} onChange={e => setP(p.id, { text: e.target.value })} placeholder="Priority" className={'text-sm bg-transparent outline-none border-b border-transparent focus:border-rule ' + (p.done ? 'line-through text-done' : '')} />
                <button type="button" onClick={() => del(p.id)} className="text-muted hover:text-status-red text-xs" aria-label="Remove">✕</button>
              </div>
            ))}
          </div>); })}
      </div>
    </Panel>
  );
}

export function WeekNotes({ planner, derived, initials, events, weekKey }) {
  const { entry, update } = planner;
  const [open, setOpen] = useState(false);
  if (!entry) return null;
  const exportMd = () => {
    let md = `# ${STAFF_NAMES[initials] || initials} — Week of ${weekKey}\n\n`;
    const pr = (entry.priorities || []).filter(p => p.text);
    if (pr.length) { md += `## Priorities\n`; TIERS.forEach(t => { const rows = pr.filter(p => (p.tier || 1) === t.id); if (rows.length) { md += `### ${t.label}\n`; rows.forEach(p => md += `- [${p.done ? 'x' : ' '}] ${p.text}\n`); } }); md += '\n'; }
    if (events.length) { md += `## Meetings\n`; events.forEach(e => md += `- ${fmtDate(e.start)} ${fmtTime(e.start)} — ${e.subject}${e.location ? ' — ' + e.location : ''}\n`); md += '\n'; }
    const open = (derived?.openSteps || []);
    if (open.length) { md += `## Next steps assigned to me\n`; open.forEach(t => md += `- ${t.description}${t.sourceLabel ? ' — ' + t.sourceLabel : ''}${t.dueDate ? ' · due ' + fmtDate(t.dueDate) : ''}\n`); md += '\n'; }
    if (derived?.mine?.length) { md += `## My projects\n`; derived.mine.forEach(p => md += `- ${p.projectName} (${p.phase || '—'})\n`); md += '\n'; }
    if (entry.focus_notes) md += `## Focus & notes\n${entry.focus_notes}\n\n`;
    if (entry.reflections) md += `## Reflections\n${entry.reflections}\n\n`;
    const blob = new Blob([md], { type: 'text/markdown' }); const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = `${initials}-week-${weekKey}.md`; document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
  };
  return (
    <Panel title="Notes for the week" meta={<><button type="button" onClick={() => setOpen(o => !o)} className="font-bold text-accent">{open ? 'Hide' : 'Show'}</button><button type="button" onClick={exportMd} className="font-bold text-accent">Export for Claude</button></>}>
      {open && (
        <div className="grid grid-cols-2 gap-5 p-5">
          <div><div className="text-xs text-muted mb-1">Focus & notes</div><Textarea rows={6} value={entry.focus_notes || ''} onChange={e => update({ focus_notes: e.target.value })} className="w-full" placeholder="What this week is about…" /></div>
          <div><div className="text-xs text-muted mb-1">Reflections</div><Textarea rows={6} value={entry.reflections || ''} onChange={e => update({ reflections: e.target.value })} className="w-full" placeholder="What worked, what didn't…" /></div>
        </div>
      )}
    </Panel>
  );
}
