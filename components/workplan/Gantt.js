'use client';
// Project Gantt: dated phases as solid bars, seeded (undated) phases dashed, milestones as diamonds, today as a pink line.
// Pure SVG, no library; months across the top, one row per phase.
import { useMemo } from 'react';

const DAY = 86400000;
const parse = s => { if (!s) return null; const d = new Date(String(s).slice(0, 10) + 'T00:00:00'); return isNaN(d) ? null : d; };
const monthStart = d => new Date(d.getFullYear(), d.getMonth(), 1);
const addMonths = (d, n) => new Date(d.getFullYear(), d.getMonth() + n, 1);

export function Gantt({ schedule = [], milestones = [], phase }) {
  const model = useMemo(() => {
    const rows = schedule.length ? schedule : [];
    const dates = [...rows.flatMap(r => [parse(r.start), parse(r.end)]), ...milestones.map(m => parse(m.date))].filter(Boolean);
    const today = new Date(); today.setHours(0, 0, 0, 0);
    let start = dates.length ? new Date(Math.min(...dates)) : addMonths(monthStart(today), -1);
    let end = dates.length ? new Date(Math.max(...dates)) : addMonths(monthStart(today), 6);
    start = addMonths(monthStart(start), 0); end = addMonths(monthStart(end), 1);
    if (start > today) start = monthStart(today);
    if (end < addMonths(monthStart(today), 1)) end = addMonths(monthStart(today), 1);
    const months = []; for (let d = start; d < end; d = addMonths(d, 1)) months.push(d);
    const span = end - start;
    const x = d => ((d - start) / span) * 100;
    // seeded rows get a provisional slot after the last dated phase so they still appear in order
    let cursor = rows.reduce((m, r) => { const e = parse(r.end); return e && e > m ? e : m; }, start);
    const bars = rows.map(r => {
      const s = parse(r.start), e = parse(r.end);
      if (s && e && e >= s) return { ...r, x1: x(s), x2: x(e), dated: true, past: e < today };
      const ps = new Date(cursor.getTime() + 7 * DAY), pe = new Date(ps.getTime() + 35 * DAY);
      cursor = pe;
      return { ...r, x1: x(ps), x2: x(Math.min(pe, new Date(end.getTime() - DAY))), dated: false, past: false };
    });
    const ms = milestones.filter(m => parse(m.date)).map(m => ({ ...m, x: x(parse(m.date)) }));
    return { months, bars, ms, todayX: x(today), start, end };
  }, [schedule, milestones]);

  const rowH = 44, headH = 28, labelW = 220, pad = 16;
  const rows = model.bars;
  const height = headH + Math.max(1, rows.length) * rowH + 28;
  const pct = v => `${v}%`;
  const msForRow = r => model.ms.filter(m => !r.dated ? false : m.x >= r.x1 - 0.5 && m.x <= r.x2 + 0.5);
  const unplaced = model.ms.filter(m => !rows.some(r => r.dated && m.x >= r.x1 - 0.5 && m.x <= r.x2 + 0.5));

  if (rows.length === 0 && model.ms.length === 0) return <div className="px-5 py-6 text-sm text-muted italic">No schedule yet. Click Edit schedule to set phase dates; milestones from the grid appear here automatically.</div>;

  return (
    <div className="overflow-x-auto px-5 pt-4 pb-3">
      <div className="min-w-[880px] grid" style={{ gridTemplateColumns: `${labelW}px minmax(0,1fr)` }}>
        <div />
        <div className="relative" style={{ height: headH }}>
          {model.months.map((m, i) => { const l = ((m - model.start) / (model.end - model.start)) * 100; const cur = m.getMonth() === new Date().getMonth() && m.getFullYear() === new Date().getFullYear(); return <div key={i} className={'absolute top-0 text-[11px] ' + (cur ? 'text-ink font-bold' : 'text-muted')} style={{ left: pct(l) }}>{m.toLocaleDateString('en-US', { month: 'short' })}{m.getMonth() === 0 || i === 0 ? ` ${String(m.getFullYear()).slice(2)}` : ''}</div>; })}
          <div className="absolute left-0 right-0 bottom-0 h-px bg-rule" />
        </div>
        {rows.map((r, i) => (
          <div key={r.id || i} className="contents">
            <div className="pr-4 text-[13px] border-b border-hair flex flex-col justify-center" style={{ height: rowH }}>
              <div><b className={'font-bold ' + (r.phase === phase ? 'text-accent' : '')}>{r.phase}</b> <span className="text-muted">{r.label}</span></div>
              <div className="text-[11px] text-muted">{r.dated ? `${fmt(r.start)} – ${fmt(r.end)}${r.past ? ' · done' : r.phase === phase ? ' · current' : ''}` : 'No dates yet'}</div>
            </div>
            <div className="relative border-b border-hair" style={{ height: rowH }}>
              {model.months.map((m, j) => <div key={j} className="absolute top-0 bottom-0 w-px bg-hair" style={{ left: pct(((m - model.start) / (model.end - model.start)) * 100) }} />)}
              <div className={'absolute top-[14px] h-[14px] ' + (r.dated ? (r.past ? 'bg-done' : 'bg-ink') : 'border border-dashed border-ink')} style={{ left: pct(r.x1), width: pct(Math.max(0.8, r.x2 - r.x1)) }} title={`${r.phase} ${r.label}`} />
              {msForRow(r).map(m => <div key={m.id} className={'absolute top-[16px] w-[10px] h-[10px] rotate-45 ' + (m.completed ? 'bg-done' : 'bg-accent')} style={{ left: `calc(${pct(m.x)} - 5px)` }} title={`${fmt(m.date)} · ${m.description}`} role="img" aria-label={`${fmt(m.date)} ${m.description}`} />)}
              {model.todayX >= 0 && model.todayX <= 100 && <div className="absolute top-0 bottom-0 w-px bg-accent" style={{ left: pct(model.todayX) }} aria-hidden="true" />}
            </div>
          </div>
        ))}
        {unplaced.length > 0 && (
          <div className="contents">
            <div className="pr-4 text-[13px] flex items-center" style={{ height: rowH }}><span className="text-muted">Milestones</span></div>
            <div className="relative" style={{ height: rowH }}>
              {unplaced.map(m => <div key={m.id} className={'absolute top-[16px] w-[10px] h-[10px] rotate-45 ' + (m.completed ? 'bg-done' : 'bg-accent')} style={{ left: `calc(${pct(m.x)} - 5px)` }} title={`${fmt(m.date)} · ${m.description}`} role="img" aria-label={`${fmt(m.date)} ${m.description}`} />)}
              {model.todayX >= 0 && model.todayX <= 100 && <div className="absolute top-0 bottom-0 w-px bg-accent" style={{ left: pct(model.todayX) }} aria-hidden="true" />}
            </div>
          </div>
        )}
      </div>
      <div className="flex gap-4 items-center mt-3 text-xs text-muted flex-wrap">
        <span><span className="inline-block w-[18px] h-2 bg-ink align-middle mr-1.5" />Dated phase</span>
        <span><span className="inline-block w-[18px] h-2 bg-done align-middle mr-1.5" />Past</span>
        <span><span className="inline-block w-[18px] h-2 border border-dashed border-ink align-middle mr-1.5" />Seeded, no dates yet</span>
        <span><span className="inline-block w-2.5 h-2.5 bg-accent rotate-45 align-middle mr-2" />Milestone</span>
        <span><span className="inline-block w-px h-3 bg-accent align-middle mr-1.5" />Today</span>
      </div>
    </div>
  );
}

function fmt(s) { const d = parse(s); return d ? d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '—'; }
