'use client';
// Touchpoints — the log, with search, office / partner / type / status / lead filters and the
// next-steps column whose tick boxes update the shared step (planner too) via tickStep.
import { useMemo, useState } from 'react';
import { Panel, Link, Select, Input, Empty, Pill as UiPill } from '../shell/ui';
import { OFFICES, TOUCHPOINT_PEOPLE, TP_TYPES, stepsSummary, fmtDate, todayKey, Pill } from '../marketing-shared';
import { Tick, Who, Caption } from './bits';

export function TouchpointsTab({m}) {
  const {clients,touchpoints,proposals,me,loadedAt,setModal,tickStep}=m;
  const [q,setQ]=useState("");
  const [office,setOffice]=useState("all");
  const [partner,setPartner]=useState("all");
  const [type,setType]=useState("all");
  const [status,setStatus]=useState("all");
  const [lead,setLead]=useState("all");
  const today=todayKey();

  const rows=useMemo(()=>{
    const qq=q.trim().toLowerCase();
    return touchpoints.filter(t=>{
      const c=clients.find(x=>x.id===t.clientId);
      if(partner!=="all"&&t.partner!==partner) return false;
      if(office!=="all"&&c?.office!==office) return false;
      if(type!=="all"&&t.type!==type) return false;
      if(status!=="all"&&t.status!==status) return false;
      if(lead==="with"&&!(t.leadIds||[]).length) return false;
      if(lead==="without"&&(t.leadIds||[]).length) return false;
      if(lead==="steps"&&!stepsSummary(t.nextSteps).open) return false;
      if(lead==="overdue"&&!stepsSummary(t.nextSteps).overdue) return false;
      if(qq){
        const leadNames=(t.leadIds||[]).map(id=>proposals.find(p=>p.id===id)?.projectName||"").join(" ");
        const stepText=(t.nextSteps||[]).map(s=>s.text+" "+(s.assignedTo||"")).join(" ");
        const hay=[c?.name,t.notes,(t.contactNames||[]).join(" "),leadNames,t.partner,t.type,stepText].join(" ").toLowerCase();
        if(!hay.includes(qq)) return false;
      }
      return true;
    }).sort((a,b)=>new Date(b.date)-new Date(a.date));
  },[touchpoints,clients,proposals,q,office,partner,type,status,lead]);
  const anyF=q||partner!=="all"||office!=="all"||type!=="all"||status!=="all"||lead!=="all";

  return <div className="space-y-4">
    <div className="flex items-center justify-between gap-3 flex-wrap">
      <div className="flex flex-wrap gap-1.5 items-center">
        <Input type="text" value={q} onChange={e=>setQ(e.target.value)} placeholder="Search touchpoints…" className="w-56" />
        <Select value={office} onChange={e=>setOffice(e.target.value)}><option value="all">All offices</option>{OFFICES.map(o=><option key={o}>{o}</option>)}</Select>
        <Select value={partner} onChange={e=>setPartner(e.target.value)}><option value="all">All partners</option>{TOUCHPOINT_PEOPLE.map(p=><option key={p}>{p}</option>)}</Select>
        <Select value={type} onChange={e=>setType(e.target.value)}><option value="all">All types</option>{TP_TYPES.map(t=><option key={t}>{t}</option>)}</Select>
        <Select value={status} onChange={e=>setStatus(e.target.value)}><option value="all">All statuses</option><option value="completed">Completed</option><option value="planned">Planned</option></Select>
        <Select value={lead} onChange={e=>setLead(e.target.value)}><option value="all">Lead: any</option><option value="with">Linked to a lead</option><option value="without">No lead</option><option value="steps">Has open next steps</option><option value="overdue">Next step overdue</option></Select>
        {anyF&&<Link onClick={()=>{setQ("");setPartner("all");setOffice("all");setType("all");setStatus("all");setLead("all");}} className="text-xs">Reset</Link>}
      </div>
      <Link onClick={()=>setModal({type:"tp"})}>+ Touchpoint</Link>
    </div>
    <Caption>{rows.length} shown of {touchpoints.length} · tick a next step here and it ticks on the assignee&apos;s planner too</Caption>
    <Panel title="Touchpoint log" meta={`Supabase · loaded ${loadedAt}`}>
      <div className="overflow-x-auto"><table className="of-table w-full border-collapse">
        <thead><tr><th>Date</th><th>Client</th><th>Met with</th><th>Lead</th><th>Next steps</th><th>Type</th><th>Partner</th><th>Status</th><th className="text-right">Rating</th><th>Notes</th></tr></thead>
        <tbody>
          {rows.length===0&&<tr><td colSpan={10}><Empty>No touchpoints match.</Empty></td></tr>}
          {rows.map(t=>{const c=clients.find(x=>x.id===t.clientId);const leadNames=(t.leadIds||[]).map(id=>proposals.find(p=>p.id===id)?.projectName).filter(Boolean);const steps=t.nextSteps||[];const ss=stepsSummary(steps);return <tr key={t.id} className={"cursor-pointer hover:bg-ground "+(t.partner===me?"of-mine":"")} onClick={()=>setModal({type:"editTP",data:t})}>
            <td className="text-xs whitespace-nowrap">{fmtDate(t.date)}</td>
            <td className="font-bold">{c?.name||"?"}</td>
            <td className="text-xs text-muted">{(t.contactNames||[]).join(", ")||"—"}</td>
            <td className="text-xs">{leadNames.length?<div className="flex flex-wrap gap-1">{leadNames.map(n=><Pill key={n} color="statLead">{n}</Pill>)}</div>:<span className="text-done">—</span>}</td>
            <td className="text-xs" data-tp-steps onClick={e=>e.stopPropagation()}>{steps.length===0?<span className="text-done">—</span>:<div className="space-y-1 min-w-[180px]">{steps.map(st=><label key={st.id} className="flex items-start gap-1.5 cursor-pointer" title={st.done?"Done"+(st.doneAt?" "+fmtDate(st.doneAt):""):"Tick when done (updates the planner too)"}><Tick checked={!!st.done} onChange={v=>tickStep("touchpoint",t.id,st.id,v)} /><span className={st.done?"line-through text-done":""}>{st.text||"(no description)"}{st.assignedTo&&<span className="ml-1"><Who>{st.assignedTo}</Who></span>}{st.date&&!st.done&&<span className={st.date<today?" text-status-red font-bold":" text-muted"}> · {fmtDate(st.date)}</span>}</span></label>)}{ss.overdue&&<div className="text-[10px] text-status-red font-bold">overdue</div>}</div>}</td>
            <td className="text-xs whitespace-nowrap">{t.type}{t.timeEntryId&&<span data-from-time title="Logged from a Time entry" className="ml-1.5 text-muted">· Time{t.timeHours?" "+t.timeHours+"h":""}</span>}</td>
            <td className="text-xs">{t.partner}</td>
            <td><UiPill kind={t.status==="planned"?"outline":"solid"}>{t.status}</UiPill></td>
            <td className="text-right">{t.status==="completed"&&t.rating?<span className={"font-bold "+(t.rating<5?"text-status-red":"")}>{t.rating}/10</span>:<span className="text-done">—</span>}</td>
            <td className="text-xs text-muted max-w-[220px] truncate">{t.notes}</td>
          </tr>;})}
        </tbody>
      </table></div>
    </Panel>
  </div>;
}
