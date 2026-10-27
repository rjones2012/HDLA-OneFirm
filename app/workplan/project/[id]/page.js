'use client';
// Work Plan · project page: Master Data header, schedule/Gantt, tasks, notes, links, milestones, billing.
import { useEffect, useMemo, useState } from 'react';
import { useAuth, isLeadershipRole, isFinanceRole } from '../../../../lib/auth';
import { Shell } from '../../../../components/shell/Shell';
import { Panel, Button, Link, Pill, Empty, Input, Select, Textarea, Label, Modal, fmt$, fmtDate, todayKey } from '../../../../components/shell/ui';
import { PHASE_NAMES } from '../../../../lib/phaseNames';
import { Gantt } from '../../../../components/workplan/Gantt';

const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const PHASES = ['MP', 'CO', 'SD', 'DD', 'CD', 'CA'];
const phaseLabel = p => PHASE_NAMES?.[p] || p;
const weekLabel = d => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
const getMonday = (date = new Date()) => { const d = new Date(date); const day = d.getDay(); d.setDate(d.getDate() - day + (day === 0 ? -6 : 1)); d.setHours(0, 0, 0, 0); return d; };
const chipClass = m => m.completed ? 'chip-done' : m.type === 'deadline' ? 'chip-deadline' : m.type === 'hardCheckIn' ? 'chip-hard' : 'chip-soft';
const LINK_KINDS = [['sharepoint', 'SharePoint folder'], ['bluebeam', 'Bluebeam session'], ['file', 'File'], ['other', 'Other']];

export default function ProjectPage({ params }) {
  const { user, profile } = useAuth();
  const id = params?.id;
  const [d, setD] = useState(null);
  const [err, setErr] = useState('');
  const [modal, setModal] = useState(null);
  const me = profile?.initials || '';
  const leadership = isLeadershipRole(profile?.role), finance = isFinanceRole(profile?.role);
  const load = () => fetch(`/api/project-page?id=${encodeURIComponent(id)}`).then(r => r.json()).then(x => x.error ? setErr(x.error) : setD(x)).catch(e => setErr(e.message));
  useEffect(() => { if (user && id) load(); }, [user, id]); // eslint-disable-line react-hooks/exhaustive-deps
  const post = body => fetch('/api/project-page', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(() => load());
  const postProject = body => fetch('/api/projects', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(() => load());

  const md = useMemo(() => {
    const rows = d?.masterData || [];
    const fee = rows.reduce((s, r) => s + (Number(r['Fee']) || 0), 0), billed = rows.reduce((s, r) => s + (Number(r['Previously Billed']) || 0), 0), remaining = rows.reduce((s, r) => s + (Number(r['Fee Remaining']) || 0), 0);
    const first = rows[0] || {};
    return { rows, fee, billed, remaining, client: first['Client'] || '', office: first['Location'] || '', partner: first['Partner'] || '', pm: first['PM'] || '', status: first['Status'] || '' };
  }, [d]);
  const p = d?.project;
  const planned = useMemo(() => (p?.tasks || []).reduce((s, t) => s + (Number(t.hours) || 0), 0), [p]);
  const openAr = (d?.ar || []).reduce((s, i) => s + (Number(i.balance) || 0), 0);
  const weeks = useMemo(() => { const m = getMonday(); return [0, 1, 2].map(i => { const w = new Date(m); w.setDate(w.getDate() + i * 7); return { label: weekLabel(w), date: w }; }); }, []);

  const saveSchedule = schedule => post({ projectId: id, schedule });
  const saveLinks = links => post({ projectId: id, links });

  return (
    <Shell module="workplan" eyebrow={p ? `${p.projectNum || ''} · ${md.client || '—'} · ${md.office || '—'}` : 'Work Plan'} title={p?.projectName || 'Project'}
      subtitle={p && <span className="flex gap-2 items-center flex-wrap text-[13px]">{p.phase && <Pill kind="solid">{p.phase}</Pill>}<span>Partner <b className="font-bold text-ink">{(p.partnersInCharge || []).join(', ') || md.partner || '—'}</b></span><span>·</span><span>Principal <b className="font-bold text-ink">{p.principal || '—'}</b></span><span>·</span><span>PM <b className="font-bold text-ink">{md.pm || '—'}</b></span><span>·</span><span>Team <b className="font-bold text-ink">{(p.teamMembers || []).join(', ') || '—'}</b></span><span>·</span><span>Health <b className="font-bold text-ink">{p.internalHealth || '—'}</b> internal · <b className="font-bold text-ink">{p.externalHealth || '—'}</b> external</span></span>}
      actions={p && <>
        <Button onClick={() => setModal({ type: 'note' })}>+ Note</Button>
        <Button variant="secondary" onClick={() => setModal({ type: 'link' })}>+ Link</Button>
        <Button variant="secondary" onClick={() => setModal({ type: 'schedule' })}>Edit schedule</Button>
        {leadership && <Button variant="secondary" onClick={() => setModal({ type: 'flag' })}>Flag for partner review</Button>}
      </>}>
      <div className="flex gap-1 items-center text-[13px] text-muted mb-5 flex-wrap"><a href="/workplan" className="text-muted hover:text-accent">Work Plan</a><span>/</span>{p?.principal && <><a href={`/workplan?principal=${p.principal}`} className="text-muted hover:text-accent">{p.principal}&apos;s team</a><span>/</span></>}<span className="text-ink">{p?.projectName || ''}</span></div>
      {err && <div className="text-status-red text-sm mb-4">{err}</div>}
      {!d ? <div className="text-muted animate-pulse">Loading project…</div> : (
        <div className="flex flex-col gap-6">
          <section className="bg-white border border-rule rounded px-7 py-5 grid grid-cols-6">
            {[['Fee', fmt$(md.fee)], ['Previously billed', fmt$(md.billed)], ['Remaining', fmt$(md.remaining)], ['Planned (tasks)', fmt$(0) === fmt$(planned) ? '—' : `${planned}h`, planned && md.remaining && planned > md.remaining ? 'red' : ''], ['Hours logged', `${Object.values(d.hoursByPhase || {}).reduce((s, h) => s + h, 0).toFixed(1)}h`], ['Open A/R', leadership ? fmt$(openAr) : '—']].map(([l, v, red], i) => (
              <div key={l} className={'flex flex-col gap-0.5 ' + (i < 5 ? 'border-r border-hair pr-4 ' : '') + (i > 0 ? 'pl-4' : '')}><span className="text-[11px] tracking-[0.06em] uppercase text-muted">{l}</span><span className={'font-flecha text-xl ' + (red ? 'text-status-red' : '')}>{v}</span>{l === 'Open A/R' && d.ar.length > 0 && <span className="text-[11px] text-muted">{d.ar.map(i => `${i.doc_number || 'inv'} · ${i.days_past_due}d`).join(', ')}</span>}</div>
            ))}
            <div className="col-span-6 pt-3 mt-3 border-t border-hair text-xs text-muted">Master Data{md.status ? ` · status ${md.status}` : ''} · {md.rows.length} line{md.rows.length === 1 ? '' : 's'}{md.rows.length ? ': ' + md.rows.map(r => `${r['Phase'] || '—'} ${fmt$(r['Fee'])}`).join(' · ') : ' — no Master Data line matches this project number'} · read-only</div>
          </section>

          <Panel title="Schedule" meta={<><span>Dated phases solid · seeded dashed · milestones as diamonds</span><Link onClick={() => setModal({ type: 'schedule' })}>Edit dates</Link></>}>
            <Gantt schedule={p.schedule || []} milestones={p.milestones || []} phase={p.phase} />
            <div className="px-5 py-3 text-xs text-muted border-t border-hair">Dates set here are the project&apos;s schedule of record for the weekly grid and capacity. The phase legend is Master Data&apos;s.</div>
          </Panel>

          <div className="grid grid-cols-[minmax(0,7fr)_minmax(0,5fr)] gap-6">
            <div className="flex flex-col gap-6">
              <Panel title="Tasks" meta={<Link href="/workplan">Open in grid →</Link>}>
                <div className="grid grid-cols-3">
                  {weeks.map((w, i) => { const tasks = (p.tasks || []).filter(t => t.week === w.label); const ms = (p.milestones || []).filter(m => { if (!m.date) return false; const x = new Date(m.date.split('T')[0]); const e = new Date(w.date); e.setDate(e.getDate() + 6); e.setHours(23, 59, 59); return x >= w.date && x <= e; }); const hrs = tasks.reduce((s, t) => s + (Number(t.hours) || 0), 0); return (
                    <div key={w.label} className={'px-5 py-3.5 flex flex-col gap-2 ' + (i < 2 ? 'border-r border-hair' : '')}>
                      <div className="text-xs font-bold">{w.label}{i === 0 && <span className="text-muted font-normal"> · this week</span>}</div>
                      {ms.map(m => <span key={m.id} className={'inline-block self-start text-[11px] font-bold px-1.5 py-[2px] rounded-[2px] ' + chipClass(m)}>{fmtDate(m.date)} · {m.description}</span>)}
                      {tasks.map(t => <label key={t.id} className="flex gap-2 items-start text-[13px] cursor-pointer"><input type="checkbox" className="w-4 h-4 mt-0.5" checked={!!t.completed} onChange={e => postProject({ setTaskCompleted: { projectId: p.id, taskId: t.id, staff: t.staff, task: t.task, week: t.week, completed: e.target.checked } })} /><span className={t.completed ? 'line-through text-done' : ''}>{t.staff} · {t.task}{t.hours ? ` · ${t.hours}h` : ''}</span></label>)}
                      {!tasks.length && !ms.length && <span className="text-xs text-muted">—</span>}
                      {hrs > 0 && <div className="text-xs text-muted">{hrs}h planned</div>}
                    </div>); })}
                </div>
              </Panel>

              <Panel title="Notes" meta="Newest first · pinned stay on top">
                <NoteComposer projectId={id} me={me} onSaved={load} />
                {d.notes.length === 0 ? <Empty>No notes yet.</Empty> : (
                  <div className="flex flex-col">
                    {d.notes.map(n => (
                      <div key={n.id} className={'px-5 py-3.5 border-t border-hair flex flex-col gap-1 ' + (n.pinned ? 'bg-accent-tint' : '')}>
                        <div className="text-xs text-muted flex gap-2 items-center flex-wrap"><b className="font-bold text-ink">{n.author}</b><span>· {new Date(n.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</span>{n.kind !== 'note' && <Pill kind="outline">{n.kind}</Pill>}<span className="ml-auto flex gap-3"><button type="button" className="hover:text-accent" onClick={() => post({ note: { ...n, projectId: n.project_id, pinned: !n.pinned } })}>{n.pinned ? 'Unpin' : 'Pin'}</button>{(n.author === me || leadership) && <button type="button" className="hover:text-status-red" onClick={() => { if (confirm('Delete this note?')) post({ deleteNote: n.id }); }}>Delete</button>}</span></div>
                        <div className="text-[13px] whitespace-pre-wrap">{n.body}</div>
                      </div>
                    ))}
                  </div>
                )}
              </Panel>
            </div>

            <div className="flex flex-col gap-6">
              <Panel title="Links" meta={<Link onClick={() => setModal({ type: 'link' })}>+ Add</Link>}>
                {(p.links || []).length === 0 ? <Empty>No links yet — SharePoint folder, Bluebeam sessions, the contract.</Empty> : (
                  <div className="flex flex-col">
                    {(p.links || []).map(l => (
                      <div key={l.id} className="grid grid-cols-[minmax(0,1fr)_auto_auto] gap-3 items-center px-5 py-3 border-b border-hair last:border-0">
                        <a href={l.url} target="_blank" rel="noreferrer" className="text-[13px] hover:text-accent truncate"><span className="text-[11px] uppercase tracking-[0.04em] text-muted mr-2">{(LINK_KINDS.find(k => k[0] === l.kind) || ['', 'Link'])[1]}</span>{l.label || l.url}</a>
                        <span className="text-[11px] text-muted whitespace-nowrap">{l.note || ''}{l.addedBy ? ` · ${l.addedBy}` : ''}</span>
                        <button type="button" className="text-xs text-muted hover:text-status-red" onClick={() => saveLinks((p.links || []).filter(x => x.id !== l.id))} aria-label="Remove link">✕</button>
                      </div>
                    ))}
                  </div>
                )}
              </Panel>

              {finance && (
                <Panel title="Billing" meta="Hub invoices · QuickBooks balance">
                  {d.invoices.length === 0 && d.ar.length === 0 ? <Empty>No invoices for this project yet.</Empty> : (
                    <table className="of-table w-full">
                      <thead><tr><th>Invoice</th><th>Month</th><th className="text-right">Amount</th><th>Status</th></tr></thead>
                      <tbody>
                        {d.invoices.map(i => { const ar = d.ar.find(a => a.doc_number && a.doc_number === i.invoice_number); return (
                          <tr key={i.id}><td><a href={`/billing?invoice=${i.id}`} className="hover:text-accent">{i.invoice_number || 'Draft'}</a></td><td>{i.period_month}</td><td className="text-right">{fmt$(i.total_due)}</td><td>{ar ? <Pill kind={ar.days_past_due > 30 ? 'red' : 'outline'}>Open · {ar.days_past_due}d</Pill> : <Pill kind={i.status === 'sent' ? 'solid' : i.status === 'voided' ? 'done' : 'outline'}>{i.status}</Pill>}</td></tr>); })}
                        {d.ar.filter(a => !d.invoices.some(i => i.invoice_number === a.doc_number)).map(a => <tr key={a.id}><td>{a.doc_number || 'QB invoice'}</td><td>{(a.txn_date || '').slice(0, 7)}</td><td className="text-right">{fmt$(a.balance)}</td><td><Pill kind={a.days_past_due > 30 ? 'red' : 'outline'}>Open · {a.days_past_due}d</Pill></td></tr>)}
                      </tbody>
                    </table>
                  )}
                  {d.ap.length > 0 && <div className="px-5 py-3 border-t border-hair text-xs text-muted">Sub bills open: {d.ap.map(b => <b key={b.id} className="font-bold text-ink">{b.vendor} · {fmt$(b.balance)}{b.days_past_due ? ` · ${b.days_past_due}d` : ''}</b>).reduce((acc, x, i) => (i ? [...acc, ', ', x] : [x]), [])}</div>}
                </Panel>
              )}

              <Panel title="Milestones" meta={<Link href="/workplan">+ Add in grid</Link>}>
                {(p.milestones || []).length === 0 ? <Empty>No milestones.</Empty> : (
                  <div className="flex flex-col">
                    {[...(p.milestones || [])].sort((a, b) => (a.date || '').localeCompare(b.date || '')).map(m => (
                      <label key={m.id} className="grid grid-cols-[18px_56px_minmax(0,1fr)] gap-2.5 items-center px-5 py-2.5 border-b border-hair last:border-0 cursor-pointer">
                        <input type="checkbox" className="w-4 h-4" checked={!!m.completed} onChange={e => postProject({ project: { ...p, milestones: (p.milestones || []).map(x => x.id === m.id ? { ...x, completed: e.target.checked } : x) } })} />
                        <span className="text-xs text-muted">{fmtDate(m.date)}</span>
                        <span className={'text-[13px] ' + (m.completed ? 'line-through text-done' : '')}><span className={'inline-block w-2 h-2 mr-2 align-middle ' + (m.type === 'deadline' ? 'bg-ink' : m.type === 'hardCheckIn' ? 'bg-accent' : 'border border-accent')} />{m.description}</span>
                      </label>
                    ))}
                  </div>
                )}
              </Panel>
            </div>
          </div>
        </div>
      )}

      {modal?.type === 'note' && <NoteModal projectId={id} me={me} onClose={() => setModal(null)} onSaved={load} />}
      {modal?.type === 'link' && <LinkModal onClose={() => setModal(null)} onSave={l => { saveLinks([...(p.links || []), { ...l, id: uid(), addedBy: me, addedAt: todayKey() }]); setModal(null); }} />}
      {modal?.type === 'schedule' && <ScheduleModal schedule={p.schedule || []} currentPhase={p.phase} onClose={() => setModal(null)} onSave={s => { saveSchedule(s); setModal(null); }} />}
      {modal?.type === 'flag' && <FlagModal project={p} onClose={() => setModal(null)} onSave={needs => { postProject({ updateFields: { projectId: p.id, fields: { needsReview: needs } } }); setModal(null); }} />}
    </Shell>
  );
}

function NoteComposer({ projectId, me, onSaved }) {
  const [body, setBody] = useState(''); const [kind, setKind] = useState('note'); const [busy, setBusy] = useState(false);
  const save = async () => { if (!body.trim()) return; setBusy(true); await fetch('/api/project-page', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ note: { id: uid(), projectId, author: me, body: body.trim(), kind } }) }); setBody(''); setBusy(false); onSaved(); };
  return (
    <div className="px-5 py-3.5 flex flex-col gap-2">
      <Textarea rows={2} value={body} onChange={e => setBody(e.target.value)} placeholder="Decision, call summary, client ask…" className="w-full" onKeyDown={e => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') save(); }} />
      <div className="flex gap-2 items-center"><Select value={kind} onChange={e => setKind(e.target.value)} className="h-8"><option value="note">Note</option><option value="decision">Decision</option><option value="call">Call</option><option value="review">Review</option></Select><Button onClick={save} disabled={busy || !body.trim()} className="h-8 px-3">Add note</Button><span className="text-xs text-muted">⌘↵</span></div>
    </div>
  );
}
function NoteModal({ projectId, me, onClose, onSaved }) { return <Modal title="New note" onClose={onClose}><NoteComposer projectId={projectId} me={me} onSaved={() => { onSaved(); onClose(); }} /></Modal>; }

function LinkModal({ onClose, onSave }) {
  const [l, setL] = useState({ kind: 'sharepoint', label: '', url: '', note: '' });
  return (
    <Modal title="Add a link" onClose={onClose}>
      <div className="grid grid-cols-2 gap-3">
        <div><Label>Type</Label><Select value={l.kind} onChange={e => setL({ ...l, kind: e.target.value })} className="w-full">{LINK_KINDS.map(([k, n]) => <option key={k} value={k}>{n}</option>)}</Select></div>
        <div><Label>Label</Label><Input value={l.label} onChange={e => setL({ ...l, label: e.target.value })} placeholder="DD set · session 2" className="w-full" /></div>
        <div className="col-span-2"><Label>URL</Label><Input value={l.url} onChange={e => setL({ ...l, url: e.target.value })} placeholder="https://…" className="w-full" /></div>
        <div className="col-span-2"><Label>Note (optional)</Label><Input value={l.note} onChange={e => setL({ ...l, note: e.target.value })} placeholder="active · closed · contract" className="w-full" /></div>
      </div>
      <Button onClick={() => l.url && onSave(l)} disabled={!l.url}>Save link</Button>
    </Modal>
  );
}

function ScheduleModal({ schedule, currentPhase, onClose, onSave }) {
  const [rows, setRows] = useState(() => schedule.length ? schedule : PHASES.map(ph => ({ id: uid(), phase: ph, label: phaseLabel(ph), start: '', end: '', seeded: true })));
  const set = (id, patch) => setRows(rs => rs.map(r => r.id === id ? { ...r, ...patch, seeded: !(patch.start ?? r.start) || !(patch.end ?? r.end) } : r));
  return (
    <Modal title="Project schedule" onClose={onClose} wide>
      <div className="text-xs text-muted">Phases with both dates draw as solid bars; phases without dates stay dashed (seeded). Add a custom row for permitting, client review, or anything outside the standard phases.</div>
      <table className="of-table w-full"><thead><tr><th>Phase</th><th>Label</th><th>Start</th><th>End</th><th></th></tr></thead>
        <tbody>{rows.map(r => <tr key={r.id} className={r.phase === currentPhase ? 'of-mine' : ''}>
          <td><Input value={r.phase} onChange={e => set(r.id, { phase: e.target.value.toUpperCase().slice(0, 6) })} className="w-20 h-8" /></td>
          <td><Input value={r.label} onChange={e => set(r.id, { label: e.target.value })} className="w-full h-8" /></td>
          <td><Input type="date" value={r.start || ''} onChange={e => set(r.id, { start: e.target.value })} className="h-8" /></td>
          <td><Input type="date" value={r.end || ''} onChange={e => set(r.id, { end: e.target.value })} className="h-8" /></td>
          <td><button type="button" className="text-xs text-muted hover:text-status-red" onClick={() => setRows(rs => rs.filter(x => x.id !== r.id))}>✕</button></td>
        </tr>)}</tbody></table>
      <div className="flex justify-between items-center"><Link onClick={() => setRows(rs => [...rs, { id: uid(), phase: '', label: '', start: '', end: '', seeded: true }])}>+ Add a row</Link><Button onClick={() => onSave(rows.filter(r => r.phase || r.label))}>Save schedule</Button></div>
    </Modal>
  );
}

function FlagModal({ project, onClose, onSave }) {
  const partners = ['RJ', 'CB', 'MB', 'TJ'];
  const [sel, setSel] = useState(project.needsReview || []);
  return (
    <Modal title="Flag for partner review" onClose={onClose}>
      <div className="flex gap-2 flex-wrap">{partners.map(p => <label key={p} className={'px-3 h-9 inline-flex items-center gap-2 border rounded-[3px] cursor-pointer text-sm ' + (sel.includes(p) ? 'bg-ink text-white border-ink' : 'border-rule')}><input type="checkbox" className="hidden" checked={sel.includes(p)} onChange={e => setSel(s => e.target.checked ? [...s, p] : s.filter(x => x !== p))} />{p}</label>)}</div>
      <div className="text-xs text-muted">Flagged partners see this project under "Needs you" until they tick it reviewed; flags clear the following Friday.</div>
      <Button onClick={() => onSave(sel)}>Save</Button>
    </Modal>
  );
}
