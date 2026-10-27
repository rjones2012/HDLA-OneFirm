'use client';
// The one feed that replaces the seven attention lists. Each item names the module it came from.
import { Panel, Pill, Link, Empty, fmt$, fmtDate } from '../shell/ui';
import { STAFF_NAMES } from '../marketing-shared';

function Row({ pill, kind, title, sub, right }) {
  return (
    <div className="grid grid-cols-[92px_minmax(0,1fr)_auto] gap-4 items-center px-5 py-3.5 border-b border-hair last:border-0">
      <Pill kind={kind} className="text-center">{pill}</Pill>
      <div className="flex flex-col gap-0.5"><div className="text-sm font-normal">{title}</div>{sub && <div className="text-xs text-muted">{sub}</div>}</div>
      <div className="text-right">{right}</div>
    </div>
  );
}

export function NeedsYou({ d, role, initials, reload }) {
  const items = [];
  // Billing — partners approve
  if (role === 'partner') d.inReview.forEach(i => items.push(<Row key={'inv' + i.id} pill="Approve" kind="solid" title={<>Invoice {i.invoice_number || 'draft'} · {i.project_name || i.project_num} · <b className="font-bold">{fmt$(i.total_due)}</b></>} sub={`Sent to review${i.updated_at ? ' ' + fmtDate(i.updated_at) : ''} · Billing${(i.flags || []).length ? ' · ' + i.flags.map(f => f.label).join(', ') : ''}`} right={<Link href={`/billing?invoice=${i.id}`}>Open →</Link>} />));
  // Time — approvals waiting
  if (d.waiting.length) items.push(<Row key="appr" pill="Approve" kind="solid" title={<>Timesheets · {d.waiting.map(p => p.initials).join(', ')} · week of {fmtDate(d.lastWeekKey || '')}</>} sub={`${d.waiting.length} submitted and waiting · Time`} right={<Link href="/time?view=approvals">Open approvals →</Link>} />);
  // Work Plan — partner review flags
  d.reviews.forEach(p => items.push(<Row key={'rev' + p.id} pill="Review" kind="outline" title={<>{p.projectName} · flagged for your review{p.principal ? ` by ${p.principal}` : ''}</>} sub={`${p.phase || '—'} phase${p.partnerNeeds ? ' · ' + p.partnerNeeds : ''} · Work Plan`} right={<Link href={`/workplan/project/${p.id}`}>Open →</Link>} />));
  // Next steps overdue
  d.overdue.forEach(t => items.push(<Row key={'od' + t.id} pill="Overdue" kind="red" title={t.description || '(no description)'} sub={`${t.sourceType ? (t.sourceType === 'lead' ? 'Lead' : 'Touchpoint') + ' · ' + (t.sourceLabel || '') + ' · ' : ''}${t.assignedBy && t.assignedBy !== initials ? 'from ' + (STAFF_NAMES[t.assignedBy] || t.assignedBy) + ' · ' : ''}due ${fmtDate(t.dueDate)}`} right={<label className="flex items-center gap-2 text-[13px] cursor-pointer"><input type="checkbox" className="w-[18px] h-[18px]" onChange={async () => { await fetch('/api/assigned-tasks', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ toggleDone: { id: t.id, done: true } }) }); reload(); }} /> Done</label>} />));
  // Marketing — kickoffs, due proposals, planned touchpoints
  d.kickoffs.forEach(p => items.push(<Row key={'ko' + p.id} pill="Kickoff" kind="outline" title={<>{p.projectName} · awarded{p.awardedDate ? ' ' + fmtDate(p.awardedDate) : ''} · {fmt$(p.fee)}</>} sub="Kickoff not done · Marketing" right={<Link href="/marketing?tab=pipeline">Open →</Link>} />));
  d.due.forEach(p => items.push(<Row key={'due' + p.id} pill="Due" kind="amber" title={<>{p.projectName} · {p.status} · due {fmtDate(p.dueDate)}</>} sub={`${p.partner}${p.pm ? ' · PM ' + p.pm : ''} · Marketing`} right={<Link href="/marketing?tab=pipeline">Open →</Link>} />));
  d.plannedTps.forEach(t => items.push(<Row key={'tp' + t.id} pill="Planned" kind="outline" title={<>{t.type} · {(d.clients.find(c => c.id === t.clientId) || {}).name || 'Client'} · {fmtDate(t.date)}</>} sub="Planned touchpoint this week · Marketing" right={<Link href="/marketing?tab=touchpoints">Open →</Link>} />));

  return (
    <Panel title="Needs you" meta={<span>Across every module · {items.length} item{items.length === 1 ? '' : 's'}</span>}>
      {items.length ? <div className="flex flex-col">{items}</div> : <Empty>Nothing is waiting on you right now.</Empty>}
    </Panel>
  );
}
