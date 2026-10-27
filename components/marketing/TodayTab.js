'use client';
// Today — the action page. Figures that link into the other tabs, "Make the call" (ranked from the
// health engine + lead flags), the Priority list, Stuck counts, the next 14 days, this month by
// person and the latest touchpoints. Nothing here is a new business rule: every number comes from
// computeHealth, leadFlags, calcPipeline, leadsGenerated and computePersonReport.
import { useMemo, useState } from 'react';
import { Panel, Link, Select, Input, Empty, Pill as UiPill } from '../shell/ui';
import { isLeadStatus, leadClientIds, leadFlags, openSteps, stepsSummary, daysBetween, fmtDate, todayKey, normStatus, Pill } from '../marketing-shared';
import { REPORT_PEOPLE, PROBS, WEIGHTS, AGING_DAYS, DUE_SOON_DAYS, fmt$, fmtK, round1, words, monthKey, monthLabel, inMonth, quarterRange, inRange, addDays, monthYear, monthsUntil, calcPipeline, leadsGenerated, computePersonReport } from './helpers';
import { LinkedFigure, Collapse, Expander, DelBtn, Who, Caption } from './bits';

const TIER_W = {1:3,2:2.5,3:1.5,4:1,5:.5};

export function TodayTab({m}) {
  const {clients,touchpoints,proposals,events,idiqs,priority,activeWork,healthMap,me,loadedAt,inScope,scopeLabel,setModal,openTP,addPriority,savePriorityItem,deletePriorityItem,movePriority,goPipeline,setTab}=m;
  const [showAll,setShowAll]=useState(false);
  const [pAddSearch,setPAddSearch]=useState("");
  const [pOwner,setPOwner]=useState(REPORT_PEOPLE.includes(me)?me:"RJ");
  const [pFilterOwner,setPFilterOwner]=useState("all");
  const today=todayKey();
  const thisMonth=monthKey(new Date());
  const q=quarterRange();

  const sc=useMemo(()=>clients.filter(inScope.client),[clients,inScope]);
  const sp=useMemo(()=>proposals.filter(inScope.prop),[proposals,inScope]);
  const st=useMemo(()=>touchpoints.filter(inScope.tp),[touchpoints,inScope]);
  const nameOf=id=>clients.find(c=>c.id===id)?.name||"?";

  // ── Figures ──
  const active=sc.filter(c=>touchpoints.some(t=>t.clientId===c.id&&t.status==="completed"&&t.date&&daysBetween(t.date)<=365));
  const tpQ=st.filter(t=>t.status==="completed"&&inRange(t.date,q));
  const tpM=st.filter(t=>t.status==="completed"&&inMonth(t.date,thisMonth));
  const leads=sp.filter(p=>isLeadStatus(p.status));
  const leadsFromTP=leads.filter(p=>p.sourceTouchpointId);
  const pursuing=sp.filter(p=>p.status==="Pursuing");
  const submitted=sp.filter(p=>p.status==="Submitted");
  const pipe=useMemo(()=>calcPipeline(sp),[sp]);
  const awardedQ=sp.filter(p=>p.status==="Awarded"&&inRange(p.awardedDate,q));
  const sum=list=>list.reduce((s,p)=>s+(p.fee||0),0);
  const genThisMonth=useMemo(()=>{const by={};leadsGenerated(thisMonth,touchpoints,sp).forEach(x=>{const k=x.person||"?";by[k]=(by[k]||0)+1;});return Object.entries(by).sort((a,b)=>b[1]-a[1]);},[touchpoints,sp,thisMonth]);

  // ── Make the call ──
  const calls=useMemo(()=>sc.map(c=>{
    const h=healthMap[c.id]; if(!h) return null;
    const days=h.hasLoggedActivity?h.dSince:null;
    const myLeads=sp.filter(p=>isLeadStatus(p.status)&&leadClientIds(p).includes(c.id));
    const pursuits=sp.filter(p=>(p.status==="Pursuing"||p.status==="Submitted")&&leadClientIds(p).includes(c.id));
    const aging=pursuits.filter(p=>p.status==="Submitted"&&p.submittedDate&&daysBetween(p.submittedDate)>AGING_DAYS).sort((a,b)=>(a.submittedDate||"").localeCompare(b.submittedDate||""))[0];
    const flags=myLeads.map(p=>leadFlags(p,touchpoints));
    const noNext=flags.some(f=>f.noNext), overdue=flags.some(f=>f.overdue);
    const idiq=idiqs.find(i=>i.clientId===c.id);
    const idiqMonths=idiq?monthsUntil(idiq.dateExpired):null;
    const idiqSoon=idiq&&idiqMonths!=null&&idiqMonths<=12;
    const why=[];
    if(aging) why.push(`Submitted proposal aging ${daysBetween(aging.submittedDate)} days at ${aging.probability}`);
    if(noNext) why.push("Lead with no next step");
    if(overdue) why.push("Next step overdue");
    if(idiqSoon) why.push(idiqMonths<0?`IDIQ expired ${monthYear(idiq.dateExpired)}`:`IDIQ expiring ${monthYear(idiq.dateExpired)}`);
    if(h.work.fee>0) why.push(`Active work ${fmtK(h.work.fee)} remaining`);
    if(days==null) why.push("No touchpoint logged"); else if(days>30) why.push(`${days} days quiet`);
    if(myLeads.length) why.push(`${words(myLeads.length)} open lead${myLeads.length>1?"s":""}`);
    if(pursuits.length&&!aging) why.push(`${words(pursuits.length)} in pursuit`);
    if(h.relScore<5) why.push(`Rel ${round1(h.relScore)}`);
    if(h.planned.length) why.push(`${h.planned.length} planned`);
    const hasIssue=!!aging||noNext||overdue||idiqSoon;
    if(!hasIssue&&days!=null&&days<=30) return null; // recently touched and nothing stuck
    const quietF=days==null?2:Math.min(days,365)/45;
    const pipeF=1+myLeads.length*.5+pursuits.length*.75+(h.work.fee>100000?1:h.work.fee>0?.5:0);
    let score=(TIER_W[c.tier]||1)*quietF*pipeF*(c.strategic?1.5:1)+h.touchPriority+(aging?3:0)+(noNext||overdue?3:0)+(idiqSoon?2:0);
    if(h.planned.length) score*=.5;
    return {c,h,days,why:why.slice(0,3).join(" · "),score,mine:(c.partners||[]).includes(me)};
  }).filter(Boolean).sort((a,b)=>b.score-a.score),[sc,sp,touchpoints,idiqs,healthMap,me]);
  const shown=showAll?calls:calls.slice(0,8);

  // ── Stuck ──
  const openSp=sp.filter(p=>!["Awarded","Not Awarded","Declined","Dead"].includes(p.status));
  const leadsNoNext=leads.filter(p=>leadFlags(p,touchpoints).noNext);
  const quietLeads=leads.filter(p=>leadFlags(p,touchpoints).quiet);
  const overdueBy={}; let overdueN=0;
  openSp.forEach(p=>openSteps(p).filter(s=>s.date&&s.date<today).forEach(s=>{overdueN++;const k=s.assignedTo||p.partner||"?";overdueBy[k]=(overdueBy[k]||0)+1;}));
  const agingNoTouch=submitted.filter(p=>p.submittedDate&&daysBetween(p.submittedDate)>AGING_DAYS&&!touchpoints.some(t=>t.status==="completed"&&t.date>=p.submittedDate&&((t.leadIds||[]).includes(p.id)||leadClientIds(p).includes(t.clientId))));
  const propNeeds=openSp.reduce((s,p)=>s+(p.needs||[]).filter(n=>!n.done).length,0);
  const evtNeeds=events.reduce((s,e)=>s+(e.needs||[]).filter(n=>!n.done).length,0);

  // Worth a look (the old Action Board lists)
  const worth={
    tier1Cold:sc.filter(c=>c.tier===1&&healthMap[c.id]?.hasLoggedActivity&&healthMap[c.id].dSince>60&&!healthMap[c.id].planned.length),
    activeNoTouch:sc.filter(c=>(activeWork[c.id]?.fee||0)>50000&&healthMap[c.id]?.hasLoggedActivity&&healthMap[c.id].dSince>90),
    strategicDead:sc.filter(c=>c.strategic&&healthMap[c.id]?.hasLoggedActivity&&healthMap[c.id].dSince>180),
    hProbAging:sp.filter(p=>p.probability==="H"&&p.status==="Submitted"&&p.submittedDate&&daysBetween(p.submittedDate)>60),
  };

  // ── Due (next 14 days) ──
  const horizon=addDays(today,DUE_SOON_DAYS);
  const due=useMemo(()=>{
    const out=[];
    openSp.forEach(p=>{ if(p.dueDate&&p.dueDate>=today&&p.dueDate<=horizon) out.push({date:p.dueDate,kind:"Due",label:p.projectName||"Untitled",sub:leadClientIds(p).map(nameOf).join(" + "),who:p.partner,open:()=>setModal({type:"editProp",data:p})}); });
    events.forEach(e=>{ if(e.date&&e.date>=today&&e.date<=horizon) out.push({date:e.date,kind:"Event",label:e.name,sub:e.location||"",who:(e.attendees||[]).join(","),open:()=>setModal({type:"editEvt",data:e})}); });
    openSp.forEach(p=>openSteps(p).forEach(s=>{ if(s.date&&s.date>=today&&s.date<=horizon) out.push({date:s.date,kind:"Step",label:s.text||"(no description)",sub:p.projectName||"Untitled",who:s.assignedTo||p.partner,open:()=>setModal({type:"editProp",data:p,section:"steps"})}); }));
    st.forEach(t=>(t.nextSteps||[]).filter(s=>!s.done).forEach(s=>{ if(s.date&&s.date>=today&&s.date<=horizon) out.push({date:s.date,kind:"Step",label:s.text||"(no description)",sub:nameOf(t.clientId),who:s.assignedTo||t.partner,open:()=>setModal({type:"editTP",data:t})}); }));
    return out.sort((a,b)=>a.date.localeCompare(b.date));
  },[openSp,events,st,today,horizon]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── This month by person ──
  const rows=REPORT_PEOPLE.map(person=>({person,...computePersonReport(person,thisMonth,touchpoints,proposals)}));
  const firm=rows.reduce((a,r)=>({touchpoints:a.touchpoints+r.touchpoints,leads:a.leads+r.leads,submitted:a.submitted+r.submitted,open:a.open+r.open}),{touchpoints:0,leads:0,submitted:0,open:0});
  const latest=st.filter(t=>t.status==="completed").sort((a,b)=>(b.date||"").localeCompare(a.date||"")).slice(0,6);
  const surfaced=t=>{ const parts=[]; const names=(t.leadIds||[]).map(id=>proposals.find(p=>p.id===id)?.projectName).filter(Boolean); if(names.length) parts.push(names.join(", ")); const born=proposals.filter(p=>p.sourceTouchpointId===t.id).map(p=>p.projectName||"Untitled"); if(born.length) parts.push("new lead: "+born.join(", ")); const ss=stepsSummary(t.nextSteps); if(ss.open) parts.push(`${ss.open} next step${ss.open>1?"s":""}`); return parts.join(" · ")||"—"; };

  // ── Priority list ──
  const pSorted=[...priority].filter(p=>pFilterOwner==="all"||p.owner===pFilterOwner).filter(p=>!inScope.mine||p.owner===me).sort((a,b)=>(a.owner||"").localeCompare(b.owner||"")||(a.position||0)-(b.position||0));
  const pMatches=pAddSearch?clients.filter(c=>c.name.toLowerCase().includes(pAddSearch.toLowerCase())).sort((a,b)=>a.name.localeCompare(b.name)).slice(0,8):[];

  const meta=`Supabase · loaded ${loadedAt}${scopeLabel?` · ${scopeLabel}`:""}`;

  return <div className="space-y-5">
    <div>
      <div className="text-[11px] tracking-[0.08em] uppercase text-muted mb-2">Relationships to work{scopeLabel?` · ${scopeLabel}`:""}</div>
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        <LinkedFigure label="Active clients" value={active.length} sub={`of ${sc.length} · touchpoint in 12 months`} onClick={()=>setTab("clients")} />
        <LinkedFigure label="Touchpoints" value={tpQ.length} sub={`${q.label} · ${tpM.length} this month`} onClick={()=>setTab("touchpoints")} />
        <LinkedFigure label="Leads" value={leads.length} sub={`${leadsFromTP.length} from touchpoints`} onClick={()=>goPipeline({stages:["Lead"]})} />
        <LinkedFigure label="Pursuing" value={pursuing.length} sub={fmt$(sum(pursuing))+" in play"} onClick={()=>goPipeline({stages:["Pursuing"]})} />
        <LinkedFigure label="Submitted" value={submitted.length} sub={`${fmt$(pipe.totalRaw)} out · ${fmt$(pipe.totalWeighted)} weighted`} onClick={()=>goPipeline({stages:["Submitted"]})} />
        <LinkedFigure label="Awarded" value={awardedQ.length} sub={`${q.label} · ${fmt$(sum(awardedQ))}`} accent onClick={()=>goPipeline({stages:["Awarded"]})} />
      </div>
      <Caption className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
        <span>Weighted by probability (Submitted only): {PROBS.map(p=><span key={p} className="ml-1"><b className="text-ink">{p}</b> {fmt$(pipe.buckets[p].weighted)}</span>)}</span>
        <span>Leads generated this month: {genThisMonth.length?genThisMonth.map(([k,n])=>`${k} ${n}`).join(" · "):"none yet"}</span>
      </Caption>
    </div>

    <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] gap-5">
      <div className="space-y-5 min-w-0">
        <Panel title="Make the call" meta={`${calls.length} clients worth a touch · ${meta}`}>
          <div className="overflow-x-auto"><table className="of-table w-full border-collapse">
            <thead><tr><th>Client</th><th>Why now</th><th>Last</th><th>Owner</th><th>Action</th></tr></thead>
            <tbody>
              {shown.length===0&&<tr><td colSpan={5}><Empty>Nothing is waiting on a call. Log touchpoints as they happen and this list fills itself.</Empty></td></tr>}
              {shown.map(({c,h,days,why,mine})=><tr key={c.id} className={mine?"of-mine":""} data-call-row={c.name}>
                <td><button type="button" onClick={()=>setModal({type:"client",data:c})} className="text-left font-flecha text-sm hover:text-accent">{c.name}</button><div className="text-xs text-muted">T{c.tier}{c.strategic?" · Strategic":""}{c.office?` · ${c.office}`:""}</div></td>
                <td className="text-xs">{why||"—"}</td>
                <td className="text-xs whitespace-nowrap">{h.lastDate?<>{fmtDate(h.lastDate)} <span className={days>90?"text-status-red font-bold":"text-muted"}>· {days}d</span></>:<span className="text-muted">never</span>}</td>
                <td className="text-xs">{(c.partners||[]).join(", ")||"—"}</td>
                <td className="whitespace-nowrap"><div className="flex items-center gap-3"><Link onClick={()=>openTP(c.id)}>+ Touchpoint</Link><Select value="" onChange={e=>{if(e.target.value)addPriority(c.id,e.target.value);}} className="h-8 text-xs" title="Add to the Priority list for…"><option value="">Assign…</option>{REPORT_PEOPLE.map(p=><option key={p} value={p}>{p}</option>)}</Select></div></td>
              </tr>)}
            </tbody>
          </table></div>
          {calls.length>8&&<div className="px-5 py-3 border-t border-hair"><Link onClick={()=>setShowAll(!showAll)}>{showAll?"Top 8 only":`All ${calls.length} →`}</Link></div>}
        </Panel>

        <Collapse title="Priority list" meta={`${pSorted.length} client${pSorted.length===1?"":"s"} · shared running list`}>
          <div className="px-5 py-3 border-b border-hair relative">
            <div className="flex items-center gap-2">
              <span className="text-[11px] tracking-[0.08em] uppercase text-muted">Add</span>
              <Select value={pOwner} onChange={e=>setPOwner(e.target.value)} className="w-24">{REPORT_PEOPLE.map(p=><option key={p}>{p}</option>)}</Select>
              <Input value={pAddSearch} onChange={e=>setPAddSearch(e.target.value)} placeholder="Search clients…" className="flex-1" />
              <Select value={pFilterOwner} onChange={e=>setPFilterOwner(e.target.value)} className="w-32"><option value="all">All owners</option>{REPORT_PEOPLE.map(p=><option key={p}>{p}</option>)}</Select>
            </div>
            {pMatches.length>0&&<div className="absolute z-10 left-5 right-5 mt-1 bg-white border border-rule rounded max-h-52 overflow-y-auto">{pMatches.map(c=><div key={c.id} onClick={()=>{addPriority(c.id,pOwner);setPAddSearch("");}} className="px-2.5 py-1.5 text-sm cursor-pointer hover:bg-ground">{c.name} <span className="text-muted">→ {pOwner}</span></div>)}</div>}
          </div>
          {pSorted.length===0&&<Empty>No priority clients yet. Add one above, or use Assign on a row.</Empty>}
          {pSorted.map((p,i)=>{const c=clients.find(x=>x.id===p.clientId);return <div key={p.id} className={"px-5 py-2 flex items-center gap-2 border-b border-hair "+(p.done?"text-done":"")+(p.owner===me?" bg-accent-tint":"")}>
            <input type="checkbox" checked={!!p.done} onChange={()=>savePriorityItem({...p,done:!p.done})} className="w-4 h-4 shrink-0" title="Mark contacted / done" />
            <div className="shrink-0 flex flex-col leading-none">
              <button type="button" onClick={()=>movePriority(p.id,-1)} disabled={i===0} className="text-[10px] text-muted disabled:opacity-30 hover:text-ink" aria-label="Move up">▲</button>
              <button type="button" onClick={()=>movePriority(p.id,1)} disabled={i===pSorted.length-1} className="text-[10px] text-muted disabled:opacity-30 hover:text-ink" aria-label="Move down">▼</button>
            </div>
            <Select value={p.owner||""} onChange={e=>savePriorityItem({...p,owner:e.target.value})} className="w-20 shrink-0 h-8"><option value="">—</option>{REPORT_PEOPLE.map(x=><option key={x}>{x}</option>)}</Select>
            <button type="button" onClick={()=>c&&setModal({type:"client",data:c})} className={"font-flecha text-sm shrink-0 text-left "+(p.done?"line-through":"")}>{c?.name||"—"}</button>
            <Input value={p.note||""} onChange={e=>savePriorityItem({...p,note:e.target.value})} placeholder="Note (optional)…" className="flex-1 h-8" />
            <DelBtn onClick={()=>deletePriorityItem(p.id)} />
          </div>;})}
        </Collapse>
      </div>

      <div className="space-y-5 min-w-0">
        <Panel title="Stuck" meta="Open leads and proposals in scope">
          <table className="of-table w-full border-collapse"><tbody>
            <tr><td><Link onClick={()=>goPipeline({stages:["Lead"],flag:"nonext"})}>Leads with no next step</Link></td><td className="text-right font-bold">{leadsNoNext.length}</td></tr>
            <tr><td><Link onClick={()=>goPipeline({stages:["Lead","Pursuing","Submitted"],flag:"overdue"})}>Next steps overdue</Link>{overdueN>0&&<div className="text-xs text-muted">{Object.entries(overdueBy).sort((a,b)=>b[1]-a[1]).map(([k,n])=>`${k} ${n}`).join(" · ")}</div>}</td><td className={"text-right font-bold "+(overdueN?"text-status-red":"")}>{overdueN}</td></tr>
            <tr><td><Link onClick={()=>goPipeline({stages:["Submitted"],flag:"aging"})}>Submitted {AGING_DAYS}+ days, no touchpoint since</Link></td><td className="text-right font-bold">{agingNoTouch.length}</td></tr>
            <tr><td><Link onClick={()=>goPipeline({stages:["Lead"],flag:"quiet",view:"review"})}>Quiet leads, 30+ days</Link><div className="text-xs text-muted">for the weekly review</div></td><td className="text-right font-bold">{quietLeads.length}</td></tr>
            <tr><td><Link onClick={()=>goPipeline({stages:["Pursuing","Submitted"],flag:"needs"})}>Open proposal needs</Link>{evtNeeds>0&&<div className="text-xs text-muted"><Link onClick={()=>setTab("events")} className="text-xs">{evtNeeds} event need{evtNeeds>1?"s":""}</Link></div>}</td><td className="text-right font-bold">{propNeeds}</td></tr>
          </tbody></table>
        </Panel>

        <Panel title="Worth a look" meta="Health engine">
          {!worth.tier1Cold.length&&!worth.activeNoTouch.length&&!worth.strategicDead.length&&!worth.hProbAging.length&&<Empty>Nothing flagged.</Empty>}
          <Expander title="Tier 1, going cold" count={worth.tier1Cold.length}>{worth.tier1Cold.map(c=><div key={c.id} className="flex justify-between py-1 text-sm cursor-pointer hover:text-accent" onClick={()=>setModal({type:"client",data:c})}><b>{c.name}</b><span className="text-muted text-xs">{healthMap[c.id].dSince||0}d · no upcoming</span></div>)}</Expander>
          <Expander title="Active work, low touch" count={worth.activeNoTouch.length}>{worth.activeNoTouch.map(c=><div key={c.id} className="flex justify-between py-1 text-sm cursor-pointer hover:text-accent" onClick={()=>setModal({type:"client",data:c})}><b>{c.name}</b><span className="text-muted text-xs">{fmt$(activeWork[c.id]?.fee)} · {healthMap[c.id].dSince}d</span></div>)}</Expander>
          <Expander title="Strategic, dead" count={worth.strategicDead.length}>{worth.strategicDead.map(c=><div key={c.id} className="flex justify-between py-1 text-sm cursor-pointer hover:text-accent" onClick={()=>setModal({type:"client",data:c})}><b>{c.name}</b><span className="text-muted text-xs">{healthMap[c.id].dSince===999?"Never":healthMap[c.id].dSince+"d"}</span></div>)}</Expander>
          <Expander title="H probability, aging" count={worth.hProbAging.length}>{worth.hProbAging.map(p=><div key={p.id} className="flex justify-between py-1 text-sm cursor-pointer hover:text-accent" onClick={()=>setModal({type:"editProp",data:p})}><b>{p.projectName}</b><span className="text-muted text-xs">{nameOf(p.clientId)} · {daysBetween(p.submittedDate)}d</span></div>)}</Expander>
        </Panel>

        <Panel title="Due" meta={`Next ${DUE_SOON_DAYS} days · proposals, events, next steps`}>
          {due.length===0?<Empty>Nothing due in the next two weeks.</Empty>:<table className="of-table w-full border-collapse"><tbody>
            {due.map((d,i)=><tr key={i} className={"cursor-pointer hover:bg-ground "+(d.who===me?"of-mine":"")} onClick={d.open}>
              <td className="whitespace-nowrap text-xs">{fmtDate(d.date)}</td>
              <td><UiPill kind={d.kind==="Due"?"solid":"outline"}>{d.kind}</UiPill></td>
              <td><div className="text-sm">{d.label}</div>{d.sub&&<div className="text-xs text-muted">{d.sub}</div>}</td>
              <td className="text-xs text-right">{d.who&&<Who>{d.who}</Who>}</td>
            </tr>)}
          </tbody></table>}
        </Panel>
      </div>
    </div>

    <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
      <Panel title="This month by person" meta={`${monthLabel(thisMonth)} · BD activity`} action={<Link onClick={()=>setTab("reports")}>Full report →</Link>}>
        <div className="overflow-x-auto"><table className="of-table w-full border-collapse">
          <thead><tr><th>Person</th><th className="text-right">Touchpoints</th><th className="text-right">Leads generated</th><th className="text-right">Submitted</th><th className="text-right">Open</th></tr></thead>
          <tbody>
            {rows.map(r=><tr key={r.person} className={r.person===me?"of-mine":""}><td className="font-bold">{r.person}</td>{[r.touchpoints,r.leads,r.submitted,r.open].map((v,i)=><td key={i} className={"text-right "+(v?"":"text-done")}>{v}</td>)}</tr>)}
            <tr className="of-total"><td>Firm</td><td className="text-right">{firm.touchpoints}</td><td className="text-right">{firm.leads}</td><td className="text-right">{firm.submitted}</td><td className="text-right">{firm.open}</td></tr>
          </tbody>
        </table></div>
      </Panel>
      <Panel title="Latest touchpoints" meta="Last 6 completed in scope" action={<Link onClick={()=>setTab("touchpoints")}>All →</Link>}>
        {latest.length===0?<Empty>No touchpoints logged yet.</Empty>:<div className="overflow-x-auto"><table className="of-table w-full border-collapse">
          <thead><tr><th>Date</th><th>Client</th><th>Who</th><th className="text-right">Rating</th><th>Surfaced</th></tr></thead>
          <tbody>{latest.map(t=><tr key={t.id} className={"cursor-pointer hover:bg-ground "+(t.partner===me?"of-mine":"")} onClick={()=>setModal({type:"editTP",data:t})}>
            <td className="whitespace-nowrap text-xs">{fmtDate(t.date)}</td>
            <td className="font-bold">{nameOf(t.clientId)}<div className="text-xs text-muted font-normal">{t.type}{(t.contactNames||[]).length?` · ${t.contactNames.join(", ")}`:""}</div></td>
            <td className="text-xs">{t.partner}</td>
            <td className="text-right font-bold">{t.rating?`${t.rating}/10`:"—"}</td>
            <td className="text-xs">{surfaced(t)}</td>
          </tr>)}</tbody>
        </table></div>}
      </Panel>
    </div>
  </div>;
}
