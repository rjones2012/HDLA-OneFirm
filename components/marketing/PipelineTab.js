'use client';
// Pipeline — leads, pursuits, submitted proposals, awards, closed items and IDIQ contracts in one
// table. Stage chips are multi-select filters (default Lead + Pursuing). Lead and Pursuing are counted,
// never summed; pipeline dollars count Submitted only. Views: List · Board · By prob · Weekly review.
import { useMemo, useState } from 'react';
import { Panel, Link, Select, Input, Empty, Pill as UiPill } from '../shell/ui';
import { OFFICES, TOUCHPOINT_PEOPLE, isLeadStatus, leadClientIds, normStatus, openSteps, cid, daysBetween, fmtDate, todayKey, QUIET_DAYS, Pill } from '../marketing-shared';
import { PROBS, WEIGHTS, PROPOSAL_TYPES, SECTORS, STAGES, SORTS, AGING_DAYS, fmt$, rowFlags, sortOpps, computeIdiqRollup, monthsUntil, monthYear, csvCell, downloadFile } from './helpers';
import { Chip, SubTabs, Tick, Who, Caption } from './bits';

const FLAGS = [["all","Flag: any"],["any","Flagged only"],["nonext","No next step"],["overdue","Next step overdue"],["quiet","Quiet"],["due","Due soon / past due"],["aging",`Aging ${AGING_DAYS}+`],["needs","Open needs"],["expires","IDIQ expiring"]];

function FlagPills({f}) {
  const out=[];
  if(f.noNext) out.push(<UiPill key="nn" kind="outline">No next step</UiPill>);
  if(f.overdue) out.push(<UiPill key="od" kind="red">Overdue</UiPill>);
  if(f.quiet) out.push(<UiPill key="q" kind="amber">Quiet {f.dSince}d</UiPill>);
  if(f.pastDue) out.push(<UiPill key="pd" kind="red">Past due</UiPill>);
  else if(f.dueSoon) out.push(<UiPill key="ds" kind="amber">Due {f.dueIn}d</UiPill>);
  if(f.aging) out.push(<UiPill key="ag" kind="amber">Aging {f.agingDays}d</UiPill>);
  if(f.needsOpen) out.push(<UiPill key="nd" kind="outline">{f.needsOpen} need{f.needsOpen>1?"s":""}</UiPill>);
  return out.length?<div className="flex flex-wrap gap-1">{out}</div>:<span className="text-done">—</span>;
}
function IdiqPills({iq,r}) {
  const mo=monthsUntil(iq.dateExpired);
  const out=[];
  if(r.expired) out.push(<UiPill key="x" kind="red">Expired</UiPill>);
  else if(mo!=null&&mo<=12) out.push(<UiPill key="e" kind={mo<=6?"amber":"outline"}>Expires {mo} mo</UiPill>);
  if(r.stale) out.push(<UiPill key="s" kind="outline">{r.dSince==null?"Never contacted":`Stale ${r.dSince}d`}</UiPill>);
  return out.length?<div className="flex flex-wrap gap-1">{out}</div>:<span className="text-done">—</span>;
}

export function PipelineTab({m}) {
  const {clients,touchpoints,proposals,idiqs,me,loadedAt,inScope,scopeLabel,setModal,tickStep,pipe}=m;
  const {stages,setStages,type,setType,flag,setFlag,prob,setProb,sector,setSector,sort,setSort,dir,setDir,view,setView,search,setSearch}=pipe;
  const [expandedIdiq,setExpandedIdiq]=useState(null);
  const today=todayKey();
  const nameOf=id=>clients.find(c=>c.id===id)?.name||"";

  // Every opportunity in scope with its flags, before stage/flag filters.
  const base=useMemo(()=>{
    const q=search.trim().toLowerCase();
    return proposals.filter(inScope.prop).map(p=>{
      const c=clients.find(x=>x.id===p.clientId);
      const cls=leadClientIds(p).map(id=>clients.find(x=>x.id===id)).filter(Boolean);
      const names=(p.contactIds||[]).map(id=>cls.flatMap(x=>x.contacts||[]).find(x=>cid(x)===id)?.name).filter(Boolean);
      const f=rowFlags(p,touchpoints);
      const srcTP=p.sourceTouchpointId?touchpoints.find(t=>t.id===p.sourceTouchpointId):null;
      return {kind:"opp",id:p.id,p,c,cls,names,f,srcTP,clientName:c?.name||"",office:p.office||c?.office||"",sector:p.sector||c?.sector||""};
    }).filter(r=>{
      if(type!=="all"&&(r.p.proposalType||"Proposal")!==type) return false;
      if(prob!=="all"&&r.p.probability!==prob) return false;
      if(sector!=="all"&&r.sector!==sector) return false;
      if(q){ const hay=[r.p.projectName,r.cls.map(x=>x.name).join(" "),r.p.notes,r.p.nextStep,openSteps(r.p).map(x=>x.text).join(" "),r.p.partner,r.names.join(" "),r.cls.flatMap(x=>x.contacts||[]).map(x=>x.name).join(" ")].join(" ").toLowerCase(); if(!hay.includes(q)&&(r.p.partner||"").toLowerCase()!==q) return false; }
      return true;
    });
  },[proposals,clients,touchpoints,inScope,type,prob,sector,search]);
  const idiqRows=useMemo(()=>idiqs.map(iq=>{const c=clients.find(x=>x.id===iq.clientId);return {kind:"idiq",id:iq.id,iq,c,r:computeIdiqRollup(iq,proposals,touchpoints),clientName:c?.name||""};}).filter(x=>!x.c||inScope.client(x.c)).sort((a,b)=>a.clientName.localeCompare(b.clientName)),[idiqs,clients,proposals,touchpoints,inScope]);

  const counts=Object.fromEntries(STAGES.map(s=>[s,s==="IDIQ"?idiqRows.length:base.filter(r=>r.f.stage===s).length]));
  const flagHit=r=>{ const f=r.f; switch(flag){ case "any": return f.any; case "nonext": return f.noNext; case "overdue": return f.overdue; case "quiet": return f.quiet; case "due": return f.dueSoon||f.pastDue; case "aging": return f.aging; case "needs": return f.needsOpen>0; case "expires": return false; default: return true; } };
  const idiqHit=x=>{ const mo=monthsUntil(x.iq.dateExpired); switch(flag){ case "any": return x.r.expired||x.r.stale||(mo!=null&&mo<=12); case "expires": return x.r.expired||(mo!=null&&mo<=12); case "quiet": return x.r.stale; case "all": return true; default: return false; } };
  const rows=sortOpps(base.filter(r=>stages.includes(r.f.stage)&&flagHit(r)),sort,dir);
  const shownIdiq=stages.includes("IDIQ")?idiqRows.filter(idiqHit):[];
  const toggleStage=s=>setStages(stages.includes(s)?stages.filter(x=>x!==s):[...stages,s]);

  // Office roll-up (the old Proposals stats bar): Submitted only for dollars.
  const officeKey=p=>OFFICES.includes(p.office)?p.office:"Unassigned";
  const stats=useMemo(()=>{ const b={firm:{open:0,pipeline:0,feeOut:0,awarded:0}};OFFICES.forEach(o=>{b[o]={open:0,pipeline:0,feeOut:0,awarded:0};}); base.forEach(({p})=>{ if(isLeadStatus(p.status)) return; const k=officeKey(p); ["firm",k].forEach(x=>{ if(!b[x]) return; if(!["Awarded","Not Awarded","Declined","Dead"].includes(p.status)) b[x].open++; if(p.status==="Submitted"){b[x].pipeline+=(p.fee||0)*(WEIGHTS[p.probability]||0);b[x].feeOut+=p.fee||0;} if(p.status==="Awarded") b[x].awarded++; }); }); return b; },[base]);

  const exportCsv=()=>{
    const headers=["Project","Client","Office","Type","Fee","Weighted","Probability","Status","Partner","Submitted","Due","Sector","Last touchpoint","Next step","Flags","Notes"];
    const flagText=f=>[f.noNext&&"No next step",f.overdue&&"Overdue",f.quiet&&`Quiet ${f.dSince}d`,f.pastDue&&"Past due",f.dueSoon&&`Due ${f.dueIn}d`,f.aging&&`Aging ${f.agingDays}d`,f.needsOpen&&`${f.needsOpen} needs`].filter(Boolean).join("; ");
    const body=rows.map(({p,f,cls})=>{ const ns=openSteps(p)[0]; return [p.projectName||"",cls.map(x=>x.name).join(" + "),p.office||"",p.proposalType||"Proposal",p.fee||0,Math.round((p.fee||0)*(WEIGHTS[p.probability]||0)),p.probability||"",normStatus(p.status)||"",p.partner||"",p.submittedDate||"",p.dueDate||"",p.sector||"",f.lastTouch||"",ns?`${ns.text}${ns.assignedTo?" ("+ns.assignedTo+")":""}${ns.date?" "+ns.date:""}`:"",flagText(f),(p.notes||"").replace(/\n/g," ")]; });
    const csv=[headers,...body].map(r=>r.map(csvCell).join(",")).join("\n");
    downloadFile(`HDLA_Pipeline_${today}.csv`,"text/csv;charset=utf-8;","﻿"+csv);
  };
  const anyF=search||type!=="all"||flag!=="all"||prob!=="all"||sector!=="all";
  const reset=()=>{setSearch("");setType("all");setFlag("all");setProb("all");setSector("all");setSort("flagged");setDir(1);};

  const openRow=r=>setModal({type:"editProp",data:r.p});
  const NextStep=({p})=>{ const os=openSteps(p); if(!os.length) return <Link onClick={()=>setModal({type:"editProp",data:p,section:"steps"})} className="text-xs">+ Next step</Link>; const f=os[0]; return <div className="flex items-start gap-1.5 min-w-[180px]" onClick={e=>e.stopPropagation()}><Tick checked={false} onChange={()=>tickStep("lead",p.id,f.id,true)} title="Tick when done (updates the planner too)" /><span className="text-xs"><span>{f.text||"(no description)"}</span>{f.assignedTo&&<span className="ml-1"><Who>{f.assignedTo}</Who></span>}{f.date&&<span className={f.date<today?" text-status-red font-bold":" text-muted"}> · {fmtDate(f.date)}</span>}{os.length>1&&<span className="text-muted"> +{os.length-1} more</span>}</span></div>; };
  const LastTouch=({f})=>f.lastTouch?<span className="text-xs whitespace-nowrap">{fmtDate(f.lastTouch)} <span className={f.quiet||(f.dSince!=null&&f.dSince>QUIET_DAYS)?"text-status-red font-bold":"text-muted"}>· {f.dSince}d</span></span>:<span className="text-xs text-muted">none yet</span>;
  const Opp=({r})=><><div className="font-flecha text-sm">{r.p.projectName||"Untitled"}</div><div className="text-xs text-muted flex items-center gap-1.5 flex-wrap mt-0.5"><Pill color="gray">{r.p.proposalType||"Proposal"}</Pill>{r.p.probability&&r.f.stage!=="Lead"&&<Pill color={"prob"+r.p.probability}>{r.p.probability}</Pill>}{r.p.fee>0&&r.f.stage!=="Lead"&&<span className="font-bold text-ink">{fmt$(r.p.fee)}</span>}{r.srcTP&&<span>from touchpoint {fmtDate(r.srcTP.date)}</span>}{r.names.length>0&&<span>{r.names.join(", ")}</span>}</div></>;

  // Weekly review (open leads only; search/type/sector filters apply, stage/flag do not)
  const openLeads=base.filter(r=>r.f.stage==="Lead");
  const newThisWeek=openLeads.filter(r=>{const d0=r.p.leadSince||(r.p.createdAt||"").slice(0,10);return d0&&daysBetween(d0)<=7;});
  const quiet=openLeads.filter(r=>r.f.quiet);
  const nextIssue=openLeads.filter(r=>r.f.overdue||r.f.noNext);
  const Section=({title,items,detail,empty})=><Panel title={title} meta={`${items.length}`}>{items.length===0?<Empty>{empty}</Empty>:items.map(r=><div key={r.p.id} onClick={()=>openRow(r)} data-review-row={r.p.projectName} className={"flex justify-between items-center gap-3 py-2 px-5 text-sm border-b border-hair cursor-pointer hover:bg-ground "+(r.p.partner===me?"bg-accent-tint":"")}><span><b>{r.p.projectName||"Untitled"}</b> <span className="text-muted">· {r.cls.map(x=>x.name).join(", ")||"?"}</span> <span className="text-xs text-muted">· {r.p.partner} · {r.office||"—"}</span></span><span className="text-xs text-muted whitespace-nowrap">{detail(r)}</span></div>)}</Panel>;

  const meta=`Supabase · loaded ${loadedAt}${scopeLabel?` · ${scopeLabel}`:""}`;
  const Stat=({k})=><span className="whitespace-nowrap"><span className="text-muted">{k==="firm"?"Firm":k.slice(0,3).toUpperCase()}</span> <b>{stats[k].open}</b> open · <b>{fmt$(stats[k].pipeline)}</b> weighted · {fmt$(stats[k].feeOut)} out · {stats[k].awarded} won</span>;

  return <div className="space-y-4">
    <div className="flex items-center justify-between gap-3 flex-wrap">
      <div className="flex items-center gap-1.5 flex-wrap">
        {STAGES.map(s=><Chip key={s} on={stages.includes(s)} onClick={()=>toggleStage(s)} count={counts[s]} testId={"stage-"+s}>{s}</Chip>)}
        <Link onClick={()=>setModal({type:"idiq"})} className="ml-2 text-xs">+ IDIQ</Link>
      </div>
      <SubTabs value={view} onChange={setView} tabs={[{id:"list",label:"List"},{id:"board",label:"Board"},{id:"prob",label:"By prob"},{id:"review",label:"Weekly review",testId:"lsub-review"}]} />
    </div>
    <div className="flex items-center justify-between gap-3 flex-wrap">
      <div className="flex items-center gap-1.5 flex-wrap">
        <Input type="text" value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search opportunities, clients, contacts…" className="w-64" />
        <Select value={type} onChange={e=>setType(e.target.value)}><option value="all">All types</option>{PROPOSAL_TYPES.map(t=><option key={t}>{t}</option>)}</Select>
        <Select value={flag} onChange={e=>setFlag(e.target.value)}>{FLAGS.map(([v,l])=><option key={v} value={v}>{l}</option>)}</Select>
        <Select value={prob} onChange={e=>setProb(e.target.value)}><option value="all">Prob: any</option>{PROBS.map(p=><option key={p} value={p}>{p}</option>)}</Select>
        <Select value={sector} onChange={e=>setSector(e.target.value)}><option value="all">All sectors</option>{SECTORS.map(x=><option key={x}>{x}</option>)}</Select>
        <Select value={sort} onChange={e=>setSort(e.target.value)}>{SORTS.map(([v,l])=><option key={v} value={v}>Sort: {l}</option>)}</Select>
        <button type="button" onClick={()=>setDir(dir===1?-1:1)} className="h-[38px] px-2.5 border border-rule rounded-[3px] text-xs text-muted hover:border-ink" title="Reverse sort">{dir===1?"↓":"↑"}</button>
        {anyF&&<Link onClick={reset} className="text-xs">Reset</Link>}
      </div>
      <Link onClick={exportCsv}>Export CSV</Link>
    </div>
    <Caption data-testid="lead-count">{rows.length+shownIdiq.length} shown · Lead and Pursuing are counted, never summed · pipeline $ counts Submitted only · quiet after {QUIET_DAYS} days with no touchpoint</Caption>
    <Caption className="flex gap-4 flex-wrap">{["firm",...OFFICES].map(k=><Stat key={k} k={k} />)}</Caption>

    {view==="list"&&<Panel title="Opportunities" meta={meta}>
      <div className="overflow-x-auto"><table className="of-table w-full border-collapse">
        <thead><tr><th>Opportunity</th><th>Clients / team</th><th>Stage</th><th>Partner · office</th><th>Last touch</th><th>Next step</th><th>Flags</th></tr></thead>
        <tbody>
          {rows.length===0&&shownIdiq.length===0&&<tr><td colSpan={7}><Empty>Nothing matches. Turn on another stage chip, clear the flag filter, or add a lead from + New.</Empty></td></tr>}
          {rows.map(r=><tr key={r.id} data-lead-row={r.p.projectName} className={"cursor-pointer hover:bg-ground "+(r.p.partner===me?"of-mine":"")} onClick={()=>openRow(r)}>
            <td><Opp r={r} /></td>
            <td className="text-xs">{r.cls.length===0?"?":r.cls.map((x,i)=><div key={x.id} className={i===0?"font-bold":"text-muted"}>{x.name}</div>)}</td>
            <td><Pill color={"stat"+normStatus(r.p.status)}>{normStatus(r.p.status)}</Pill></td>
            <td className="text-xs whitespace-nowrap">{r.p.partner}{r.office?` · ${r.office}`:""}</td>
            <td><LastTouch f={r.f} /></td>
            <td data-next-cell><NextStep p={r.p} /></td>
            <td><FlagPills f={r.f} /></td>
          </tr>)}
          {shownIdiq.map(x=>{const ex=expandedIdiq&&expandedIdiq.id===x.iq.id;const bk=ex?expandedIdiq.bucket:null;const list=bk?proposals.filter(p=>p.clientId===x.iq.clientId).filter(p=>bk==="awarded"?p.status==="Awarded":bk==="notAwarded"?p.status==="Not Awarded":true).sort((a,b)=>(b.submittedDate||"").localeCompare(a.submittedDate||"")):[];const mine=(x.c?.partners||[]).includes(me);return <PipelineIdiqRows key={x.id} x={x} ex={ex} bk={bk} list={list} mine={mine} setExpandedIdiq={setExpandedIdiq} setModal={setModal} />;})}
        </tbody>
      </table></div>
    </Panel>}

    {view==="board"&&<div className="grid gap-3" style={{gridTemplateColumns:`repeat(${Math.max(1,stages.filter(s=>s!=="IDIQ").length)},minmax(0,1fr))`}}>
      {stages.filter(s=>s!=="IDIQ").map(s=>{const col=rows.filter(r=>r.f.stage===s);const sumFee=col.reduce((a,r)=>a+(r.p.fee||0),0);const weighted=col.reduce((a,r)=>a+(r.p.fee||0)*(WEIGHTS[r.p.probability]||0),0);return <Panel key={s} title={s} meta={s==="Submitted"?`${col.length} · ${fmt$(sumFee)} out · ${fmt$(weighted)} weighted`:s==="Awarded"?`${col.length} · ${fmt$(sumFee)}`:`${col.length}`}>
        {col.length===0&&<Empty>None</Empty>}
        {col.map(r=><div key={r.id} onClick={()=>openRow(r)} className={"px-4 py-3 border-b border-hair cursor-pointer hover:bg-ground "+(r.p.partner===me?"bg-accent-tint":"")}>
          <Opp r={r} />
          <div className="text-xs text-muted mt-1">{r.cls.map(x=>x.name).join(" + ")||"?"} · {r.p.partner}{r.office?` · ${r.office}`:""}</div>
          <div className="flex items-center justify-between gap-2 mt-1.5"><LastTouch f={r.f} /><FlagPills f={r.f} /></div>
        </div>)}
      </Panel>;})}
      {stages.includes("IDIQ")&&<Caption>IDIQ contracts are listed in the List view.</Caption>}
    </div>}

    {view==="prob"&&<div className="space-y-3">
      <Caption>Submitted proposals only, grouped by probability. Weighted = fee × {PROBS.map(p=>`${p} ${Math.round(WEIGHTS[p]*100)}%`).join(" · ")}.</Caption>
      {PROBS.map(pr=>{const list=base.filter(r=>r.p.status==="Submitted"&&r.p.probability===pr);if(!list.length)return null;const raw=list.reduce((a,r)=>a+(r.p.fee||0),0);return <Panel key={pr} title={`${pr} probability`} meta={`${list.length} proposals · ${fmt$(raw*(WEIGHTS[pr]||0))} weighted · raw ${fmt$(raw)}`}>
        {list.map(r=><div key={r.id} className={"flex justify-between items-center py-2 px-5 text-sm border-b border-hair cursor-pointer hover:bg-ground "+(r.p.partner===me?"bg-accent-tint":"")} onClick={()=>openRow(r)}><span className="font-bold">{r.p.projectName} <span className="font-normal text-muted">· {r.clientName}</span></span><span className="flex items-center gap-2 text-xs">{fmt$(r.p.fee)} <Pill color={"stat"+normStatus(r.p.status)}>{normStatus(r.p.status)}</Pill></span></div>)}
      </Panel>;})}
      {base.every(r=>r.p.status!=="Submitted")&&<Empty>No submitted proposals in scope.</Empty>}
    </div>}

    {view==="review"&&<div className="space-y-3" data-testid="review">
      <Caption>Open leads only. Search, type and sector filters apply; stage and flag filters do not.</Caption>
      <Section title="New this week" items={newThisWeek} detail={r=>"added "+fmtDate(r.p.leadSince||(r.p.createdAt||"").slice(0,10))} empty="No new leads in the last 7 days." />
      <Section title={`Gone quiet (${QUIET_DAYS}+ days)`} items={quiet} detail={r=>(r.f.lastTouch?"last touchpoint "+fmtDate(r.f.lastTouch):"no touchpoint yet")+" · "+r.f.dSince+"d"} empty="Nothing has gone quiet." />
      <Section title="Next step overdue or missing" items={nextIssue} detail={r=>{const od=openSteps(r.p).find(x=>x.date&&x.date<today);return r.f.overdue&&od?"overdue: "+(od.text||"next step")+" ("+fmtDate(od.date)+")":"no next step set";}} empty="Every open lead has a next step." />
    </div>}
  </div>;
}

function PipelineIdiqRows({x,ex,bk,list,mine,setExpandedIdiq,setModal}) {
  const {iq,c,r}=x;
  const Bucket=({k,label,n})=>{const on=ex&&bk===k;return <button type="button" onClick={e=>{e.stopPropagation();setExpandedIdiq(on?null:{id:iq.id,bucket:k});}} className={"text-xs font-bold px-1.5 py-0.5 rounded-[2px] border "+(on?"bg-ink text-white border-ink":"border-rule hover:border-ink")}>{label} {n}</button>;};
  return <>
    <tr className={"cursor-pointer hover:bg-ground "+(mine?"of-mine":"")} onClick={()=>setModal({type:"editIdiq",data:iq})}>
      <td><div className="font-flecha text-sm">IDIQ · {c?.name||"— (no client linked)"}</div><div className="text-xs text-muted mt-0.5">awarded {fmtDate(iq.dateAwarded)} · expires {fmtDate(iq.dateExpired)} · won {fmt$(r.wonFee)}</div></td>
      <td className="text-xs">{c?.name||"?"}{(iq.contacts||[]).filter(k=>(k.name||"").trim()).length>0&&<div className="text-muted">{iq.contacts.filter(k=>(k.name||"").trim()).map(k=>k.name+(k.position?` (${k.position})`:"")).join(", ")}</div>}</td>
      <td><Pill color="blue">IDIQ</Pill></td>
      <td className="text-xs whitespace-nowrap">{(c?.partners||[]).join(", ")||"—"}{c?.office?` · ${c.office}`:""}</td>
      <td className="text-xs whitespace-nowrap">{r.lastDate?<>{fmtDate(r.lastDate)} <span className={r.stale?"text-status-red font-bold":"text-muted"}>· {r.dSince}d</span></>:<span className="text-muted">never</span>}</td>
      <td><div className="flex gap-1 flex-wrap"><Bucket k="all" label="Projects" n={r.proposals} /><Bucket k="awarded" label="Awarded" n={r.awarded} /><Bucket k="notAwarded" label="Not awarded" n={r.notAwarded} /></div></td>
      <td><IdiqPills iq={iq} r={r} /></td>
    </tr>
    {ex&&<tr className="bg-ground"><td colSpan={7} className="!py-2">
      <div className="text-[11px] tracking-[0.08em] uppercase text-muted mb-1">{bk==="awarded"?"Awarded":bk==="notAwarded"?"Not awarded":"All"} projects under this IDIQ ({list.length})</div>
      {list.length===0&&<div className="text-xs text-muted italic">None</div>}
      {list.map(p=><div key={p.id} onClick={()=>setModal({type:"editProp",data:p})} className="flex justify-between items-center py-1 text-sm border-t border-hair cursor-pointer hover:text-accent"><span className="font-bold">{p.projectName||"—"}</span><span className="flex items-center gap-2 text-xs">{fmt$(p.fee)} <Pill color={"stat"+normStatus(p.status)}>{normStatus(p.status)}</Pill></span></div>)}
    </td></tr>}
  </>;
}
