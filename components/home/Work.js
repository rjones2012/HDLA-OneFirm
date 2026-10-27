'use client';
// Work panels on the home: a principal's team week, a staff member's projects, a partner's aging and pipeline.
import { Panel, Pill, Link, Empty, fmt$, fmtDate, todayKey } from '../shell/ui';

const weekLabel = d => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
const inWeek = (dateStr, monday) => { if (!dateStr) return false; const d = new Date(dateStr.split('T')[0]); const end = new Date(monday); end.setDate(end.getDate() + 6); end.setHours(23, 59, 59, 999); return d >= monday && d <= end; };
const chipClass = m => m.completed ? 'chip-done' : m.type === 'deadline' ? 'chip-deadline' : m.type === 'hardCheckIn' ? 'chip-hard' : 'chip-soft';
const Chip = ({ m }) => <span className={'inline-block text-[11px] font-bold px-1.5 py-[2px] rounded-[2px] leading-none mr-1.5 mb-1 ' + chipClass(m)}>{fmtDate(m.date)} · {m.description}</span>;

async function tickTask(projectId, t, completed) {
  await fetch('/api/projects', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ setTaskCompleted: { projectId, taskId: t.id, staff: t.staff, task: t.task, week: t.week, completed } }) });
}

export function TeamWeek({ projects, monday, reload }) {
  const label = weekLabel(monday);
  const rows = projects.map(p => {
    const tasks = (p.tasks || []).filter(t => t.week === label);
    const milestones = (p.milestones || []).filter(m => inWeek(m.date, monday));
    const planned = tasks.reduce((s, t) => s + (Number(t.hours) || 0), 0);
    return { p, tasks, milestones, planned };
  }).sort((a, b) => (b.milestones.length + b.tasks.length) - (a.milestones.length + a.tasks.length) || a.p.projectName.localeCompare(b.p.projectName));
  return (
    <Panel title="This week on my team" meta={<Link href="/workplan">Principal view →</Link>}>
      {rows.length === 0 ? <Empty>No projects list you as principal.</Empty> : (
        <table className="of-table w-full">
          <thead><tr><th>Project</th><th>Phase</th><th>This week</th><th className="text-right">Planned</th></tr></thead>
          <tbody>
            {rows.map(({ p, tasks, milestones, planned }) => (
              <tr key={p.id}>
                <td><a href={`/workplan/project/${p.id}`} className="font-bold">{p.projectName}</a><div className="text-xs text-muted">{p.projectNum}{p.partnerNeeds ? ' · ' + p.partnerNeeds : ''}</div></td>
                <td>{p.phase ? <Pill kind="phase">{p.phase}</Pill> : <span className="text-muted">—</span>}</td>
                <td>
                  {milestones.map(m => <Chip key={m.id} m={m} />)}
                  {tasks.length ? <div className="text-[13px]">{tasks.map(t => <label key={t.id} className="inline-flex items-center gap-1.5 mr-3 cursor-pointer"><input type="checkbox" className="w-4 h-4" checked={!!t.completed} onChange={async e => { await tickTask(p.id, t, e.target.checked); reload(); }} /><span className={t.completed ? 'line-through text-done' : ''}>{t.staff} · {t.task}{t.hours ? ` · ${t.hours}h` : ''}</span></label>)}</div> : (!milestones.length && <span className="text-muted text-[13px]">No tasks</span>)}
                </td>
                <td className="text-right">{planned ? `${planned}h` : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <div className="flex gap-4 items-center px-5 py-3 border-t border-hair text-xs text-muted flex-wrap">
        <span><span className="inline-block w-2.5 h-2.5 bg-ink align-middle mr-1.5" />Deadline</span>
        <span><span className="inline-block w-2.5 h-2.5 bg-accent align-middle mr-1.5" />Hard check-in</span>
        <span><span className="inline-block w-2.5 h-2.5 border border-accent align-middle mr-1.5" />Soft check-in</span>
      </div>
    </Panel>
  );
}

export function MyProjects({ projects, initials, monday, reload }) {
  const label = weekLabel(monday);
  const rows = projects.map(p => ({ p, tasks: (p.tasks || []).filter(t => t.week === label && t.staff === initials), milestones: (p.milestones || []).filter(m => inWeek(m.date, monday)) }));
  return (
    <Panel title="My projects this week" meta={<Link href="/workplan">Work Plan →</Link>}>
      {rows.length === 0 ? <Empty>No projects list you yet.</Empty> : (
        <div className="flex flex-col">
          {rows.map(({ p, tasks, milestones }) => (
            <div key={p.id} className="px-5 py-3 border-b border-hair last:border-0">
              <div className="flex items-center gap-2 flex-wrap"><a href={`/workplan/project/${p.id}`} className="font-bold text-sm">{p.projectName}</a>{p.phase && <Pill kind="phase">{p.phase}</Pill>}<span className="text-xs text-muted">{p.principal ? `Principal ${p.principal}` : ''}</span></div>
              <div className="mt-1">{milestones.map(m => <Chip key={m.id} m={m} />)}</div>
              {tasks.length > 0 && <div className="mt-1 flex flex-col gap-0.5">{tasks.map(t => <label key={t.id} className="flex items-center gap-2 text-[13px] cursor-pointer"><input type="checkbox" className="w-4 h-4" checked={!!t.completed} onChange={async e => { await tickTask(p.id, t, e.target.checked); reload(); }} /><span className={t.completed ? 'line-through text-done' : ''}>{t.task}{t.hours ? ` · ${t.hours}h` : ''}</span></label>)}</div>}
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
}

export function TeamHours({ people, team }) {
  const rows = people.filter(p => team.includes(p.initials)).sort((a, b) => a.initials.localeCompare(b.initials));
  return (
    <Panel title="Team · last week" meta="Time · hours logged and status">
      {rows.length === 0 ? <Empty>No team hours to show.</Empty> : (
        <div className="flex flex-col">
          {rows.map(p => (
            <div key={p.user_id} className="grid grid-cols-[44px_minmax(0,1fr)_auto_auto] gap-3 items-center px-5 py-2.5 border-b border-hair last:border-0">
              <b className="font-bold">{p.initials}</b>
              <div className="h-2 bg-hair rounded-sm overflow-hidden"><div className="h-full bg-ink" style={{ width: Math.min(100, (p.hours / 40) * 100) + '%' }} /></div>
              <span className={'text-xs ' + (p.hours === 0 ? 'text-status-red font-bold' : 'text-muted')}>{p.hours ? `${p.hours}h` : 'none logged'}</span>
              <Pill kind={p.status === 'approved' ? 'solid' : p.status === 'returned' ? 'red' : 'outline'}>{p.status}</Pill>
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
}

export function AgingPanel({ aging, initials }) {
  const rows = aging?.rows || [];
  const firm = aging?.firm;
  const cell = (v, warn) => <td className={'text-right ' + (warn && v > 0 ? 'text-status-red font-bold' : '')}>{v > 0 ? fmt$(v) : '—'}</td>;
  return (
    <Panel title="A/R aging by partner" meta={<span>QuickBooks{aging?.pulledAt ? ` · pulled ${new Date(aging.pulledAt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}` : ''}</span>}>
      {!aging || rows.length === 0 ? <Empty>{aging ? 'No open invoices.' : 'Aging arrives from QuickBooks once it is connected (Admin → QuickBooks), or from a monthly upload.'}</Empty> : (
        <table className="of-table w-full">
          <thead><tr><th>Partner</th><th className="text-right">Current</th><th className="text-right">1–30</th><th className="text-right">31–60</th><th className="text-right">61–90</th><th className="text-right">90+</th><th className="text-right">Total</th></tr></thead>
          <tbody>
            {rows.map(r => <tr key={r.partner} className={r.partner === initials ? 'of-mine' : ''}><td className="font-bold">{r.partner}</td>{cell(r.current)}{cell(r.d1)}{cell(r.d31)}{cell(r.d61, true)}{cell(r.d90, true)}<td className="text-right font-bold">{fmt$(r.total)}</td></tr>)}
            {firm && <tr className="of-total"><td>Firm</td>{cell(firm.current)}{cell(firm.d1)}{cell(firm.d31)}{cell(firm.d61)}{cell(firm.d90)}<td className="text-right">{fmt$(firm.total)}</td></tr>}
          </tbody>
        </table>
      )}
      <div className="px-5 py-3 text-xs text-muted border-t border-hair">Invoice → project number → partner from Master Data. <Link href="/exec">Client and invoice detail in Exec →</Link></div>
    </Panel>
  );
}

export function PipelineWeek({ d }) {
  const byProb = {};
  d.proposals.filter(p => p.status === 'Submitted').forEach(p => { byProb[p.probability] = (byProb[p.probability] || 0) + (Number(p.fee) || 0); });
  const cells = [['New leads', d.newLeadsWeek], ['Submitted', d.submittedWeek], ['Awarded', d.awardedWeek, true], ['Open leads', d.leads.length]];
  return (
    <Panel title="Pipeline this week" meta={<Link href="/marketing">Marketing →</Link>}>
      <div className="grid grid-cols-4">
        {cells.map(([l, v, accent], i) => <div key={l} className={'px-5 py-4 flex flex-col gap-1 ' + (i < 3 ? 'border-r border-hair' : '')}><div className={'font-flecha text-[26px] leading-none ' + (accent && v ? 'text-accent' : '')}>{v}</div><div className="text-xs text-muted">{l}</div></div>)}
      </div>
      <div className="px-5 py-3 border-t border-hair text-[13px]">H <b className="font-bold">{fmt$(byProb.H || 0)}</b> · M <b className="font-bold">{fmt$(byProb.M || 0)}</b> · L <b className="font-bold">{fmt$(byProb.L || 0)}</b> · XL {fmt$(byProb.XL || 0)} <span className="text-xs text-muted">· Submitted only</span></div>
    </Panel>
  );
}

export function GoingQuiet({ rows, onTouchpoint }) {
  return (
    <Panel title="Going quiet" meta="My clients · 60+ days since a touchpoint">
      {rows.length === 0 ? <Empty>None of your clients have gone quiet.</Empty> : (
        <div className="flex flex-col">
          {rows.map(({ c, days, pipe }) => (
            <div key={c.id} className="flex justify-between items-center px-5 py-2.5 border-b border-hair last:border-0 gap-3">
              <div className="min-w-0"><span className="text-sm">{c.name}</span> <span className="text-xs text-muted">· T{c.tier}{c.strategic ? ' · Strategic' : ''}{pipe ? ` · ${fmt$(pipe)} pipeline` : ''} · {days} days</span></div>
              <button type="button" onClick={() => onTouchpoint(c)} className="text-[13px] font-bold text-accent whitespace-nowrap">+ Touchpoint</button>
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
}
