'use client';
// OneFirm home: one page per person that answers "what needs me" across every module.
// It replaces the Planner (priorities, meetings, notes, export all live here) and the old module list.
import { useMemo, useState, useEffect } from 'react';
import { useAuth } from '../lib/auth';
import { Shell } from '../components/shell/Shell';
import { Figure, Button, fmt$, todayKey } from '../components/shell/ui';
import { useHomeData, ymd } from '../components/home/useHomeData';
import { NeedsYou } from '../components/home/NeedsYou';
import { TodayPanel, NextStepsPanel, PrioritiesPanel, WeekNotes, usePlanner } from '../components/home/Personal';
import { TeamWeek, MyProjects, AgingPanel, PipelineWeek, GoingQuiet, TeamHours } from '../components/home/Work';
import { TouchpointModal, planTouchpointSave, STAFF_NAMES, TOUCHPOINT_PEOPLE } from '../components/marketing-shared';

const greeting = () => { const h = new Date().getHours(); return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'; };
const WEIGHTS = { H: 0.8, M: 0.5, L: 0.2, XL: 0 };

export default function Home() {
  const { user, profile } = useAuth();
  const data = useHomeData(user, profile);
  const { initials, role, leadership, finance, loading, monday, sunday, weekKey } = data;
  const firstName = (profile?.display_name || STAFF_NAMES[initials] || initials || '').split(' ')[0];
  const [tp, setTp] = useState(null); // touchpoint modal draft
  const planner = usePlanner(data.planner, user, weekKey);

  // page view log (fire and forget)
  useEffect(() => { if (user) fetch('/api/page-view', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ module: 'home' }) }).catch(() => {}); }, [user]);

  const derived = useMemo(() => {
    if (loading) return null;
    const today = todayKey();
    const m = data.marketing;
    const projects = data.projects || [];
    const mine = projects.filter(p => p.principal === initials || (p.partnersInCharge || []).includes(initials) || (p.teamMembers || []).includes(initials) || (p.tasks || []).some(t => t.staff === initials));
    const teamProjects = projects.filter(p => p.principal === initials);
    const teamInitials = [...new Set(teamProjects.flatMap(p => [...(p.teamMembers || []), ...(p.tasks || []).map(t => t.staff)]).filter(Boolean))];
    const hours = (data.time?.entries || []).reduce((s, e) => s + (Number(e.hours) || 0), 0);
    const weekStatus = data.time?.week?.status || 'draft';
    const received = (data.tasks?.received || []);
    const openSteps = received.filter(t => !t.done);
    const overdue = openSteps.filter(t => t.dueDate && t.dueDate < today);
    // marketing-derived
    let weighted = 0, submittedCount = 0, leads = [], proposals = [], touchpoints = [], clients = [], quiet = [], due = [], kickoffs = [], plannedTps = [], newLeadsWeek = 0, awardedWeek = 0, submittedWeek = 0, pursuingWeek = 0;
    if (m) {
      proposals = m.proposals || []; touchpoints = m.touchpoints || []; clients = m.clients || [];
      const sub = proposals.filter(p => p.status === 'Submitted');
      submittedCount = sub.length;
      weighted = sub.reduce((s, p) => s + (Number(p.fee) || 0) * (WEIGHTS[p.probability] ?? 0.5), 0);
      leads = proposals.filter(p => p.status === 'Lead' || p.status === 'Tracking');
      const wk = ymd(monday);
      newLeadsWeek = leads.filter(p => (p.leadSince || '') >= wk).length;
      awardedWeek = proposals.filter(p => p.status === 'Awarded' && (p.awardedDate || '') >= wk).length;
      submittedWeek = proposals.filter(p => (p.submittedDate || '') >= wk).length;
      const in7 = ymd(new Date(Date.now() + 7 * 86400000));
      due = proposals.filter(p => !['Awarded', 'Not Awarded', 'Declined', 'Dead'].includes(p.status) && p.dueDate && p.dueDate >= today && p.dueDate <= in7 && (p.partner === initials || p.pm === initials));
      kickoffs = proposals.filter(p => p.status === 'Awarded' && !p.kickoffDone && (p.partner === initials || p.pm === initials));
      plannedTps = touchpoints.filter(t => t.status === 'planned' && t.partner === initials && t.date >= weekKey && t.date <= ymd(sunday));
      // my clients going quiet: last completed touchpoint > 60 days, no planned one
      const myClients = clients.filter(c => (c.partners || []).includes(initials));
      quiet = myClients.map(c => {
        const done = touchpoints.filter(t => t.clientId === c.id && t.status === 'completed').map(t => t.date).sort();
        const last = done[done.length - 1];
        const days = last ? Math.floor((Date.now() - new Date(last).getTime()) / 86400000) : null;
        const planned = touchpoints.some(t => t.clientId === c.id && t.status === 'planned' && t.date >= today);
        const pipe = proposals.filter(p => p.clientId === c.id && p.status === 'Submitted').reduce((s, p) => s + (Number(p.fee) || 0), 0);
        return { c, days, planned, pipe };
      }).filter(x => x.days !== null && x.days > 60 && !x.planned).sort((a, b) => b.days - a.days).slice(0, 6);
    }
    // approvals waiting (last week): partner = everyone submitted; principal = their team
    const submitted = (data.approvals?.people || []).filter(p => p.status === 'submitted');
    const waiting = role === 'principal' ? submitted.filter(p => teamInitials.includes(p.initials)) : submitted;
    // review flags for partners
    const reviews = projects.filter(p => (p.needsReview || []).includes(initials) && !(p.reviewCompletedBy || {})[initials]);
    // invoices awaiting partner approval
    const invoices = data.billing?.invoices || [];
    const inReview = invoices.filter(i => i.status === 'review');
    const monthTotal = invoices.filter(i => !['voided'].includes(i.status)).reduce((s, i) => s + (Number(i.total_due) || 0), 0);
    // aging
    const agingRows = data.aging?.rows || [];
    const myAging = agingRows.find(r => r.partner === initials) || null;
    const pmAging = data.aging?.scope === 'pm' ? data.aging : null;
    return { today, lastWeekKey: data.lastWeekKey, mine, teamProjects, teamInitials, hours, weekStatus, received, openSteps, overdue, weighted, submittedCount, leads, proposals, touchpoints, clients, quiet, due, kickoffs, plannedTps, newLeadsWeek, awardedWeek, submittedWeek, pursuingWeek, waiting, reviews, invoices, inReview, monthTotal, agingRows, myAging, pmAging };
  }, [data, loading, initials, role, monday, sunday, weekKey]);

  const needsCount = derived ? (derived.inReview.length + derived.waiting.length + derived.reviews.length + derived.overdue.length + derived.kickoffs.length + derived.due.length) : 0;

  const saveTouchpoint = async (t0, extra) => {
    const m = data.marketing; if (!m) return;
    const plan = planTouchpointSave(t0, extra, m.clients || [], m.proposals || []);
    const post = body => fetch('/api/marketing', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    for (const c of plan.newClients) await post({ client: c });
    for (const p of plan.props) await post({ proposal: p });
    await post({ touchpoint: plan.touchpoint });
    if (plan.clientUpdate) await post({ client: plan.clientUpdate });
    if (plan.relEntry) await post({ relLog: plan.relEntry });
    data.reload();
  };

  const dateLine = `${new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })} · Week of ${monday.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;
  const subtitle = derived ? <>{needsCount ? <><b className="font-bold text-ink">{needsCount} thing{needsCount === 1 ? '' : 's'}</b> need{needsCount === 1 ? 's' : ''} you. </> : 'Nothing waiting on you. '}Hours this week: <b className="font-bold text-ink">{derived.hours % 1 ? derived.hours.toFixed(2) : derived.hours}</b> of 40{derived.weekStatus !== 'draft' ? ` · ${derived.weekStatus}` : ''}.</> : null;

  return (
    <Shell module="home" eyebrow={dateLine} title={`${greeting()}, ${firstName}`} subtitle={subtitle}
      actions={<>
        {leadership && data.marketing && <Button onClick={() => setTp({ open: true })}>+ Touchpoint</Button>}
        <Button variant="secondary" href="/time">Log time</Button>
      </>}>
      {user && !profile ? (
        <div className="py-10 text-sm text-muted max-w-xl">
          Signed in, but your staff profile didn't load. Reload the page; if it keeps happening, your login isn't linked to a staff profile yet — ask RJ or CM.
        </div>
      ) : loading || !derived ? <div className="text-muted animate-pulse py-10">Gathering your week…</div> : (
        <div className="flex flex-col gap-6">

          {/* Figures */}
          <section className={'grid gap-4 ' + ((role === 'partner' || role === 'principal') ? 'grid-cols-4' : 'grid-cols-3')}>
            {role === 'partner' && <Figure label="My A/R outstanding" value={derived.myAging ? fmt$(derived.myAging.total) : '—'} sub={derived.myAging ? ((derived.myAging.d61 + derived.myAging.d90) > 0 ? `${fmt$(derived.myAging.d61 + derived.myAging.d90)} over 60 days` : 'Nothing over 60 days') : (data.aging ? 'No open invoices on your projects' : 'QuickBooks not connected yet')} red={!!derived.myAging && (derived.myAging.d61 + derived.myAging.d90) > 0} />}
            {role === 'principal' && <Figure label="My A/R outstanding" value={derived.pmAging ? fmt$(derived.pmAging.total) : '—'} sub={derived.pmAging ? `${derived.pmAging.invoices.length} open invoice${derived.pmAging.invoices.length === 1 ? '' : 's'} on my projects` : 'QuickBooks not connected yet'} />}
            {leadership && <Figure label="Weighted pipeline · firm" value={fmt$(derived.weighted)} sub={<>{derived.submittedCount} submitted · {derived.leads.length} leads{derived.newLeadsWeek ? <span className="text-accent font-bold"> · +{derived.newLeadsWeek} this week</span> : null}</>} />}
            {finance && <Figure label={`${new Date().toLocaleDateString('en-US', { month: 'long' })} billing`} value={fmt$(derived.monthTotal)} sub={<>{derived.invoices.length} invoice{derived.invoices.length === 1 ? '' : 's'} · {derived.inReview.length} in review{role === 'partner' && derived.inReview.length ? <b className="font-bold text-ink"> · awaiting you</b> : null}</>} />}
            {!leadership && <Figure label="Hours this week" value={derived.hours % 1 ? derived.hours.toFixed(2) : derived.hours} sub={`of 40 · ${derived.weekStatus}`} red={derived.hours === 0 && new Date().getDay() > 2} />}
            <Figure label="My projects" value={derived.mine.length} sub={role === 'principal' ? `${derived.teamProjects.length} on my team · ${derived.teamInitials.length} people` : 'in the Work Plan'} />
            {!finance && <Figure label="My next steps" value={derived.openSteps.length} sub={derived.overdue.length ? `${derived.overdue.length} overdue` : 'none overdue'} red={derived.overdue.length > 0} />}
          </section>

          <div className="grid grid-cols-[minmax(0,7fr)_minmax(0,4fr)] gap-6">
            <div className="flex flex-col gap-6">
              <NeedsYou d={derived} role={role} initials={initials} reload={data.reload} />
              {role === 'principal' && <TeamWeek projects={derived.teamProjects} monday={monday} reload={data.reload} />}
              {role === 'staff' && <MyProjects projects={derived.mine} initials={initials} monday={monday} reload={data.reload} />}
              {role === 'partner' && <AgingPanel aging={data.aging} initials={initials} />}
            </div>
            <aside className="flex flex-col gap-6">
              <TodayPanel events={data.cal?.events || []} planner={planner} />
              <NextStepsPanel steps={derived.received} initials={initials} reload={data.reload} />
              <PrioritiesPanel planner={planner} />
            </aside>
          </div>

          {leadership && (
            <div className="grid grid-cols-2 gap-6">
              {role === 'principal' ? <TeamHours people={(data.approvals?.people || [])} team={derived.teamInitials} /> : <PipelineWeek d={derived} />}
              <GoingQuiet rows={derived.quiet} onTouchpoint={c => setTp({ open: true, clientId: c.id })} />
            </div>
          )}

          <WeekNotes planner={planner} weekKey={weekKey} derived={derived} initials={initials} events={data.cal?.events || []} />
        </div>
      )}

      {tp?.open && data.marketing && (
        <TouchpointModal clients={data.marketing.clients || []} proposals={data.marketing.proposals || []}
          touchpoint={tp.clientId ? { _draft: true, id: Date.now().toString(36) + Math.random().toString(36).slice(2, 8), clientId: tp.clientId, type: 'Call', partner: TOUCHPOINT_PEOPLE.includes(initials) ? initials : 'RJ', date: todayKey(), status: 'completed', rating: 5, notes: '', contactIds: [], contactNames: [], leadIds: [] } : undefined}
          defaultPartner={TOUCHPOINT_PEOPLE.includes(initials) ? initials : 'RJ'} onSave={saveTouchpoint} onClose={() => setTp(null)} />
      )}
    </Shell>
  );
}
