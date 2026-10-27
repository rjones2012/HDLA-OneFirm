'use client';
// Calendar views for proposals + events: the milestone/task grid (daily or weekly columns), the
// horizon dot chart, the monthly calendar and the annual overview. Same data rules as before;
// milestone colours now follow the system chips (deadline = ink, hard = accent, soft = accent outline).
import { useState, useMemo } from 'react';
import { Select, Empty } from '../shell/ui';
import { CLOSED_STATUSES, isLeadStatus, fmtDate, Pill } from '../marketing-shared';
import { MONTHS, fmt$, fmtShort, getWeeksArray, dateIsDay, dateInWeek } from './helpers';
import { MilestoneChip, Dot } from './bits';

// ─── Unified work-plan grid (proposals + events) ─────────────────
export function MarketingWorkPlan({proposals,events,clients,weeks,onClickItem,onCellClick}) {
  const active = proposals.filter(p => !CLOSED_STATUSES.includes(p.status) && !isLeadStatus(p.status));
  const activeEvents = events.filter(e => e.date);
  const isDaily = weeks.length > 0 && weeks[0].isDaily;
  const isScrollable = weeks.length > (isDaily ? 6 : 5);
  const colWidth = isDaily ? (isScrollable ? 100 : undefined) : (isScrollable ? 120 : undefined);
  const colStyle = isScrollable ? {width:`${colWidth}px`} : {};
  const colCls = isScrollable ? " flex-shrink-0" : " flex-1";

  const renderRow = (item, type) => {
    const isProposal = type === 'proposal';
    const c = isProposal ? clients.find(x => x.id === item.clientId) : null;
    const needsDone = (item.needs || []).filter(n => n.done).length;
    const needsTotal = (item.needs || []).length;
    const tasks = item.tasks || [];
    return (
      <div key={`${type}-${item.id}`} className="border-t border-rule">
        {isProposal && needsTotal > 0 && needsDone < needsTotal && <div className="flex border-b border-hair text-xs"><div className="w-80 flex-shrink-0 px-3 py-1 border-r border-rule text-status-amber font-bold truncate sticky left-0 bg-white z-10">{needsDone}/{needsTotal} needs done</div><div className="flex-1 px-2 py-1 text-status-amber truncate">{(item.needs || []).filter(n => !n.done).map(n => n.desc).join(" · ")}</div></div>}
        <div className="flex hover:bg-ground/60">
          <div className="w-80 flex-shrink-0 px-3 py-2 border-r border-rule cursor-pointer bg-white sticky left-0 z-10" onClick={() => onClickItem(item, type)}>
            <div className="font-flecha text-sm">{isProposal ? (item.projectName || "Unnamed") : (item.name || "Unnamed event")}</div>
            {isProposal ? <><div className="text-xs text-muted flex items-center gap-2 flex-wrap mt-0.5"><span>{c?.name || "—"}</span><Pill color={"prob" + item.probability}>{item.probability}</Pill><Pill color={"stat" + item.status}>{item.status}</Pill>{item.proposalType && item.proposalType !== 'Proposal' && <Pill color="gray">{item.proposalType}</Pill>}</div>
            <div className="text-xs mt-1 font-bold">{fmt$(item.fee)} <span className="font-normal text-muted">· {item.partner}</span></div></> :
            <div className="text-xs text-muted flex items-center gap-2 mt-0.5"><Pill color="blue">{item.type}</Pill><span>{fmtDate(item.date)}{item.endDate && item.endDate !== item.date ? ` – ${fmtDate(item.endDate)}` : ''}</span>{(item.attendees || []).length > 0 && <span>{item.attendees.join(",")}</span>}</div>}
          </div>
          {weeks.map(col => {
            const milestones = isDaily ? tasks.filter(t => t.type && dateIsDay(t.date, col.key)) : tasks.filter(t => t.type && dateInWeek(t.date, col.key));
            const autoDue = isProposal && item.dueDate && (isDaily ? dateIsDay(item.dueDate, col.key) : dateInWeek(item.dueDate, col.key)) && !milestones.some(m => m.type === 'deadline');
            const colTasks = tasks.filter(t => !t.type && (t.week === col.label || t.weekLabel === col.label || (t.date && (isDaily ? dateIsDay(t.date, col.key) : dateInWeek(t.date, col.key)))));
            const isEventCol = !isProposal && (isDaily ? dateIsDay(item.date, col.key) || (item.endDate && dateIsDay(item.endDate, col.key)) : dateInWeek(item.date, col.key) || (item.endDate && dateInWeek(item.endDate, col.key)));
            const totalHours = colTasks.reduce((s, t) => s + (t.hours || 0), 0);
            return (
              <div key={col.key} className={"p-1 border-r border-hair last:border-r-0 cursor-pointer hover:bg-accent-tint/60 overflow-hidden flex flex-col gap-0.5 " + (col.isPast ? "bg-ground " : "") + colCls} style={{...colStyle, minHeight: isDaily ? "60px" : "70px"}} onClick={() => onCellClick(item, type, col)}>
                {isEventCol && !isProposal && <MilestoneChip type="hardCheckIn">{item.name}</MilestoneChip>}
                {autoDue && <MilestoneChip type="deadline">{isDaily ? "Due" : fmtShort(item.dueDate) + " Due"}</MilestoneChip>}
                {milestones.map((m, i) => <MilestoneChip key={i} type={m.type} done={m.done}>{isDaily ? m.desc : fmtShort(m.date || "") + " " + m.desc}</MilestoneChip>)}
                {colTasks.slice(0, 2).map((t, i) => <div key={i} className="text-xs text-muted truncate"><span className="font-bold text-ink">{t.staff}</span>: {t.desc}</div>)}
                {colTasks.length > 2 && <div className="text-xs text-muted">+{colTasks.length - 2} more</div>}
                {totalHours > 0 && <div className={"text-xs font-bold mt-auto " + (totalHours > 45 ? "text-status-red" : totalHours >= 40 ? "text-status-amber" : "text-ink")}>{totalHours}h</div>}
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  return (
    <div className="bg-white rounded border border-rule overflow-hidden">
      <div className="overflow-auto max-h-[75vh]">
        <div style={isScrollable ? {width:`${320 + weeks.length * colWidth}px`, minWidth:"100%"} : {}}>
          <div className="flex border-b border-ink bg-ink text-white sticky top-0 z-20">
            <div className="w-80 flex-shrink-0 px-3 py-2 border-r border-white/20 bg-ink sticky left-0 z-30 font-bold text-xs">Proposals and events</div>
            {weeks.map(w => <div key={w.key} className={"px-1 py-2 text-center border-r border-white/20 last:border-r-0 bg-ink" + colCls} style={colStyle}><div className="text-xs font-bold">{w.label}</div>{w.isPast && <div className="text-[10px] text-white/60">past</div>}</div>)}
          </div>
          {active.length === 0 && activeEvents.length === 0 ? <Empty>No active proposals or events.</Empty> : <>
            {active.map(p => renderRow(p, 'proposal'))}
            {activeEvents.length > 0 && <div className="flex border-t border-ink bg-ground"><div className="w-80 flex-shrink-0 px-3 py-1.5 border-r border-rule sticky left-0 z-10 bg-ground text-[11px] font-bold text-muted uppercase tracking-[0.08em]">Events</div>{weeks.map(w => <div key={w.key} className={"bg-ground" + colCls} style={colStyle} />)}</div>}
            {activeEvents.map(e => renderRow(e, 'event'))}
          </>}
        </div>
      </div>
    </div>
  );
}

// ─── Horizon (dots per week) ─────────────────────────────────────
export function HorizonView({proposals,events,clients,onClickProposal}) {
  const [range,setRange]=useState(16);
  const weeks=useMemo(()=>getWeeksArray(range,0),[range]);
  const active=proposals.filter(p=>!CLOSED_STATUSES.includes(p.status)&&!isLeadStatus(p.status));
  const activeEvents=(events||[]).filter(e=>e.date);
  const allItems=[...active.map(p=>({...p,_type:'proposal',_name:p.projectName})),...activeEvents.map(e=>({...e,_type:'event',_name:e.name,probability:'-'}))];
  const getDotsForWeek = (item, weekKey) => {
    const dots = [];
    (item.tasks||[]).forEach(t => { if(t.type && t.date && dateInWeek(t.date, weekKey)) dots.push({type:t.type, desc:t.desc}); });
    if(item._type==='proposal' && item.dueDate && dateInWeek(item.dueDate, weekKey)) { if(!dots.some(d => d.type==='deadline')) dots.push({type:'deadline', desc:`Due: ${item._name}`}); }
    if(item._type==='event' && item.date && dateInWeek(item.date, weekKey)) { if(dots.length===0) dots.push({type:'hardCheckIn', desc:item._name}); }
    return dots;
  };
  const counts={};weeks.forEach(w=>{counts[w.key]={deadline:0,hard:0,soft:0};});
  allItems.forEach(p=>weeks.forEach(w=>{ getDotsForWeek(p, w.key).forEach(d=>{ if(d.type==="deadline") counts[w.key].deadline++; else if(d.type==="hardCheckIn") counts[w.key].hard++; else counts[w.key].soft++; }); }));
  const Count = ({n,cls}) => n>0 ? <span className={"w-5 h-5 rounded-full inline-flex items-center justify-center text-[10px] font-bold "+cls}>{n}</span> : null;
  return (
    <div>
      <div className="mb-3"><Select value={range} onChange={e=>setRange(parseInt(e.target.value))}><option value={4}>4 weeks</option><option value={8}>8 weeks</option><option value={16}>16 weeks</option><option value={26}>6 months</option></Select></div>
      <div className="bg-white rounded border border-rule overflow-x-auto">
        <table className="of-table w-full border-collapse" style={{minWidth:range>16?"1600px":"1200px"}}>
          <thead>
            <tr>
              <th className="w-40 sticky left-0 z-10">Project</th>
              {weeks.map(w=><th key={w.key} className="text-center" style={{minWidth:"40px",maxWidth:"40px",padding:"6px 2px"}}><div className="text-[10px] font-normal opacity-70">{w.label.split(" ")[0]}</div><div className="text-xs">{w.label.split(" ")[1]}</div></th>)}
            </tr>
          </thead>
          <tbody>
            <tr className="of-total">
              <td className="sticky left-0 bg-white z-10">Totals</td>
              {weeks.map(w=>{const c=counts[w.key];return <td key={w.key} className="text-center" style={{padding:"4px 2px"}}><div className="flex items-center justify-center gap-0.5"><Count n={c.deadline} cls="bg-ink text-white" /><Count n={c.hard} cls="bg-accent text-white" /><Count n={c.soft} cls="border border-accent text-accent" /></div></td>;})}
            </tr>
            {allItems.length===0?<tr><td colSpan={weeks.length+1}><Empty>No active proposals or events.</Empty></td></tr>:
            allItems.map(p=>{
              const c=p._type==='proposal'?clients.find(x=>x.id===p.clientId):null;
              return (
                <tr key={`${p._type}-${p.id}`} className="hover:bg-ground cursor-pointer" onClick={()=>onClickProposal(p)}>
                  <td className="sticky left-0 bg-white z-10"><div className="font-flecha text-sm truncate">{p._name||"Unnamed"}</div><div className="text-xs text-muted">{p._type==='proposal'?`${p.probability} · ${c?.name||''}`:`Event · ${p.type||''}`}</div></td>
                  {weeks.map(w=>{ const dots=getDotsForWeek(p, w.key); return <td key={w.key} className="text-center" style={{padding:"4px 2px"}}><div className="flex flex-col items-center gap-0.5">{dots.map((d,i)=><Dot key={i} type={d.type} title={d.desc} />)}</div></td>; })}
                </tr>
              );
            })}
          </tbody>
        </table>
        <div className="px-4 py-2 border-t border-rule flex gap-6 text-xs text-muted">
          <div className="flex items-center gap-1.5"><Dot type="deadline" /> Deadline (incl. auto due date)</div>
          <div className="flex items-center gap-1.5"><Dot type="hardCheckIn" /> Hard check-in / event</div>
          <div className="flex items-center gap-1.5"><Dot type="softCheckIn" /> Soft check-in</div>
        </div>
      </div>
    </div>
  );
}

// ─── Monthly calendar ────────────────────────────────────────────
export function MonthCal({events,proposals,touchpoints,clients,onClickEvent,onClickProposal}) {
  const [month,setMonth]=useState(new Date().getMonth());
  const [yr,setYr]=useState(new Date().getFullYear());
  const fd=new Date(yr,month,1).getDay(),dim=new Date(yr,month+1,0).getDate(),today=new Date();
  const items={};
  const push=(day,it)=>{if(!items[day])items[day]=[];items[day].push(it);};
  events.forEach(e=>{if(e.date){
    const startD=new Date(e.date+"T12:00:00"); const endD=e.endDate?new Date(e.endDate+"T12:00:00"):startD;
    for(let d=new Date(startD);d<=endD;d.setDate(d.getDate()+1)){ if(d.getMonth()===month&&d.getFullYear()===yr) push(d.getDate(),{t:"evt",l:e.name+(e.attendees?.length?` (${e.attendees.join(",")})`:``),c:"bg-ink text-white",d:e}); }
  }});
  proposals.forEach(p=>{if(p.dueDate){const d=new Date(p.dueDate+"T12:00:00");if(d.getMonth()===month&&d.getFullYear()===yr) push(d.getDate(),{t:"due",l:p.projectName+" Due",c:"border border-ink text-ink",d:p});}});
  (touchpoints||[]).filter(t=>t.status==="planned").forEach(t=>{if(t.date){const d=new Date(t.date+"T12:00:00");if(d.getMonth()===month&&d.getFullYear()===yr){const c=clients.find(x=>x.id===t.clientId);push(d.getDate(),{t:"tp",l:`${t.type}: ${c?.name||"?"}`,c:"border border-accent text-accent",d:t});}}});
  const prev=()=>{ if(month===0){setMonth(11);setYr(yr-1);} else setMonth(month-1); };
  const next=()=>{ if(month===11){setMonth(0);setYr(yr+1);} else setMonth(month+1); };
  return (
    <div>
      <div className="flex justify-between items-center mb-3">
        <button type="button" onClick={prev} className="h-8 px-3 border border-ink rounded-[3px] text-sm font-bold" aria-label="Previous month">‹</button>
        <span className="font-flecha text-lg">{MONTHS[month]} {yr}</span>
        <button type="button" onClick={next} className="h-8 px-3 border border-ink rounded-[3px] text-sm font-bold" aria-label="Next month">›</button>
      </div>
      <div className="grid grid-cols-7 gap-px bg-rule border border-rule rounded overflow-hidden">
        {["Sun","Mon","Tue","Wed","Thu","Fri","Sat"].map(d=><div key={d} className="text-center py-1.5 bg-ink text-white text-[11px] font-bold">{d}</div>)}
        {Array.from({length:fd},(_,i)=><div key={`e${i}`} className="bg-ground min-h-[70px]" />)}
        {Array.from({length:dim},(_,i)=>{
          const day=i+1,isToday=today.getDate()===day&&today.getMonth()===month&&today.getFullYear()===yr,di=items[day]||[];
          return <div key={day} className={"bg-white min-h-[70px] p-0.5 "+(isToday?"outline outline-2 -outline-offset-2 outline-accent":"")}>
            <div className={"text-xs mb-0.5 px-0.5 "+(isToday?"font-bold text-accent":"text-muted")}>{day}</div>
            {di.map((it,j)=><div key={j} onClick={()=>it.t==="evt"?onClickEvent(it.d):it.t==="due"?onClickProposal(it.d):null} className={"text-[11px] px-1 rounded-[2px] mb-0.5 truncate cursor-pointer "+it.c}>{it.l}</div>)}
          </div>;
        })}
      </div>
    </div>
  );
}

// ─── Annual overview ─────────────────────────────────────────────
export function AnnualCal({events,proposals,touchpoints,clients,onClickEvent,onClickProposal}) {
  const [yr,setYr]=useState(new Date().getFullYear());
  const byDate={};
  const add=(ds,x)=>{if(!byDate[ds])byDate[ds]=[];byDate[ds].push(x);};
  events.forEach(e=>{if(e.date){
    const startD=new Date(e.date+"T12:00:00"); const endD=e.endDate?new Date(e.endDate+"T12:00:00"):startD;
    for(let d=new Date(startD);d<=endD;d.setDate(d.getDate()+1)){ add(`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`,{type:'event',data:e,dot:"bg-ink"}); }
  }});
  (proposals||[]).forEach(p=>{(p.tasks||[]).filter(t=>t.type==='deadline'&&t.date).forEach(t=>add(t.date,{type:'deadline',data:p,dot:"bg-accent"}));});
  (touchpoints||[]).filter(t=>t.status==='planned'&&t.date).forEach(t=>add(t.date,{type:'tp',data:t,dot:"border border-accent bg-white"}));
  return (
    <div>
      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <div className="flex items-center gap-2"><button type="button" onClick={()=>setYr(yr-1)} className="h-8 px-3 border border-ink rounded-[3px] text-sm font-bold" aria-label="Previous year">‹</button><span className="font-flecha text-lg">{yr}</span><button type="button" onClick={()=>setYr(yr+1)} className="h-8 px-3 border border-ink rounded-[3px] text-sm font-bold" aria-label="Next year">›</button></div>
        <div className="flex gap-4 text-xs text-muted">
          <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-ink" />Event</span>
          <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-accent" />Deadline</span>
          <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full border border-accent" />Planned touchpoint</span>
        </div>
      </div>
      <div className="grid grid-cols-3 gap-2.5">
        {MONTHS.map((m,mi)=>{
          const fd=new Date(yr,mi,1).getDay(),dim=new Date(yr,mi+1,0).getDate();
          return <div key={m} className="bg-white border border-rule rounded p-2">
            <div className="text-center font-bold text-xs mb-1">{m}</div>
            <div className="grid grid-cols-7 gap-0">
              {["S","M","T","W","T","F","S"].map((d,i)=><div key={i} className="text-center text-muted" style={{fontSize:8,padding:1}}>{d}</div>)}
              {Array.from({length:fd},(_,i)=><div key={`e${i}`} style={{height:20}} />)}
              {Array.from({length:dim},(_,i)=>{
                const day=i+1,ds=`${yr}-${String(mi+1).padStart(2,"0")}-${String(day).padStart(2,"0")}`,de=byDate[ds]||[];
                return <div key={day} className={"flex flex-col items-center justify-center "+(de.length?"cursor-pointer":"")} style={{height:20}} onClick={()=>{const evt=de.find(x=>x.type==='event');if(evt)onClickEvent(evt.data);else{const dl=de.find(x=>x.type==='deadline');if(dl)onClickProposal(dl.data);}}} title={de.map(x=>x.type==='event'?x.data.name:x.type==='deadline'?`Deadline: ${x.data.projectName}`:'Planned touchpoint').join(", ")}>
                  <div className={de.length?"font-bold text-ink":"text-muted"} style={{fontSize:8,lineHeight:1}}>{day}</div>
                  {de.length>0&&<div className="flex gap-px mt-px">{de.slice(0,3).map((x,j)=><span key={j} className={"rounded-full "+x.dot} style={{width:4,height:4}} />)}</div>}
                </div>;
              })}
            </div>
          </div>;
        })}
      </div>
    </div>
  );
}
