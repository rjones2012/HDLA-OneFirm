'use client';
// Events — the list, plus the old Work Plan tab as "Calendar grid" (milestone/task grid + Horizon),
// and the Monthly / Annual calendars.
import { useMemo, useState } from 'react';
import { Panel, Link, Select, Empty, Pill as UiPill } from '../shell/ui';
import { fmtDate, Pill } from '../marketing-shared';
import { getMarketingColumns } from './helpers';
import { MarketingWorkPlan, HorizonView, MonthCal, AnnualCal } from './grids';
import { SubTabs, Caption, MilestoneChip } from './bits';

export function EventsTab({m}) {
  const {clients,touchpoints,proposals,events,loadedAt,setModal}=m;
  const [sub,setSub]=useState("list");
  const [gridView,setGridView]=useState("grid");
  const [numWeeks,setNumWeeks]=useState(8);
  const weeks=useMemo(()=>getMarketingColumns(numWeeks),[numWeeks]);
  const sorted=[...events].sort((a,b)=>new Date(a.date)-new Date(b.date));
  const upcoming=sorted.filter(e=>new Date(e.date)>new Date());
  const openEvt=e=>setModal({type:"editEvt",data:e});
  const openProp=p=>setModal({type:"editProp",data:p});

  return <div className="space-y-4">
    <div className="flex items-center justify-between gap-3 flex-wrap">
      <SubTabs value={sub} onChange={setSub} tabs={[{id:"list",label:"List",count:events.length},{id:"grid",label:"Calendar grid"},{id:"monthly",label:"Monthly"},{id:"annual",label:"Annual"}]} />
      <div className="flex items-center gap-3 flex-wrap">
        {sub==="grid"&&<>
          <SubTabs value={gridView} onChange={setGridView} tabs={[{id:"grid",label:"Work plan"},{id:"horizon",label:"Horizon"}]} />
          {gridView==="grid"&&<Select value={numWeeks} onChange={e=>setNumWeeks(parseInt(e.target.value))}><option value={1}>1 week</option><option value={2}>2 weeks</option><option value={4}>4 weeks</option><option value={8}>8 weeks</option><option value={16}>16 weeks</option></Select>}
          <Link onClick={()=>setModal({type:"prop"})}>+ Proposal</Link>
        </>}
        <Link onClick={()=>setModal({type:"evt"})}>+ Event</Link>
      </div>
    </div>

    {sub==="list"&&<Panel title="Events" meta={`${upcoming.length} upcoming · Supabase · loaded ${loadedAt}`}>
      {sorted.length===0&&<Empty>No events yet.</Empty>}
      {sorted.map(e=>{
        const daysUntil=Math.ceil((new Date(e.date)-new Date())/864e5);
        return <div key={e.id} className="px-5 py-3 border-b border-hair cursor-pointer hover:bg-ground" onClick={()=>openEvt(e)}>
          <div className="flex justify-between items-start gap-3 mb-0.5"><span className="font-flecha text-sm">{e.name}</span><div className="flex gap-2 items-center shrink-0"><Pill color="blue">{e.type}</Pill>{daysUntil>0&&<span className={"text-xs font-bold "+(daysUntil<=14?"text-status-amber":"text-muted")}>{daysUntil}d</span>}{daysUntil<=0&&<UiPill kind="done">past</UiPill>}</div></div>
          <div className="text-xs text-muted">{fmtDate(e.date)}{e.endDate&&e.endDate!==e.date?` – ${fmtDate(e.endDate)}`:""}{e.location?` · ${e.location}`:""}</div>
          {(e.attendees||[]).length>0&&<div className="text-xs text-muted mt-0.5">Attendees: <span className="font-bold text-ink">{e.attendees.join(", ")}</span></div>}
          {(e.needs||[]).length>0&&<div className="mt-1.5 space-y-0.5">{(e.needs||[]).map(n=><div key={n.id} className="flex gap-1.5 items-center text-xs"><input type="checkbox" checked={!!n.done} readOnly className="w-3.5 h-3.5 pointer-events-none" /><span className={n.done?"line-through text-done":""}>{n.desc}</span>{n.owner&&<span className="text-muted">({n.owner})</span>}</div>)}</div>}
        </div>;
      })}
    </Panel>}

    {sub==="grid"&&gridView==="grid"&&<>
      <Caption className="flex gap-4 flex-wrap items-center">
        <span className="flex items-center gap-1.5"><MilestoneChip type="deadline">Deadline</MilestoneChip></span>
        <span className="flex items-center gap-1.5"><MilestoneChip type="hardCheckIn">Hard</MilestoneChip> check-in / event</span>
        <span className="flex items-center gap-1.5"><MilestoneChip type="softCheckIn">Soft</MilestoneChip> check-in</span>
        <span className="ml-auto">Click a name to edit · click a cell to add milestones and tasks</span>
      </Caption>
      <MarketingWorkPlan proposals={proposals} events={events} clients={clients} weeks={weeks} onClickItem={(item,type)=>type==='proposal'?openProp(item):openEvt(item)} onCellClick={(item,type,week)=>setModal({type:"cell",data:{item,itemType:type,week}})} />
    </>}
    {sub==="grid"&&gridView==="horizon"&&<HorizonView proposals={proposals} events={events} clients={clients} onClickProposal={p=>{const {_type,_name,...rest}=p; if(_type==='event'){const {probability,...evt}=rest; openEvt(events.find(e=>e.id===evt.id)||evt);} else openProp(proposals.find(x=>x.id===rest.id)||rest);}} />}
    {sub==="monthly"&&<MonthCal events={events} proposals={proposals} touchpoints={touchpoints} clients={clients} onClickEvent={openEvt} onClickProposal={openProp} />}
    {sub==="annual"&&<AnnualCal events={events} proposals={proposals} touchpoints={touchpoints} clients={clients} onClickEvent={openEvt} onClickProposal={openProp} />}
  </div>;
}
