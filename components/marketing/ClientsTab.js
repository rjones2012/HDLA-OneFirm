'use client';
// Clients — search, filters (partner / tier / office / market / sector / relationship), sorts with
// direction, and three views (cards / list / table) driven by the health engine. Same rules as before.
import { useMemo, useState } from 'react';
import { Panel, Link, Select, Input, Empty, Pill as UiPill } from '../shell/ui';
import { OFFICES, TOUCHPOINT_PEOPLE, fmtDate, Pill } from '../marketing-shared';
import { TIERS, SECTORS, MARKET_DATA, fmt$, round1 } from './helpers';
import { SubTabs, Bars, Trend, Caption } from './bits';

const SORT_GROUPS = [
  ["Recency",[["stalest","Stalest first"],["freshest","Most recent"]]],
  ["Health",[["unhealthiest","Least healthy"],["healthiest","Most healthy"]]],
  ["Activity",[["activeProjects","Most projects"],["activeFee","Highest active fee"],["pipeline","Highest pipeline"]]],
  ["Scores",[["relationship","Highest relationship"],["touchScore","Highest touch score"],["touchScoreAsc","Lowest touch score"]]],
  ["Other",[["priority","Priority score"],["tier","Tier"],["name","A–Z"]]],
];

function ClientCard({client,health,touchTrend,onClick,compact,mine}) {
  const {health:h,dSince,lastDate,planned,work,pipeFee,relScore} = health;
  const box="border rounded cursor-pointer bg-white hover:border-ink "+(mine?"border-accent":"border-rule");
  if(compact) return (
    <div onClick={onClick} className={box+" px-3 py-2 flex justify-between items-center gap-3"}>
      <div className="flex items-center gap-2 min-w-0">
        {client.strategic&&<UiPill kind="solid">S</UiPill>}
        <span className="font-flecha text-sm truncate">{client.name}</span>
        <Pill color="gray">T{client.tier}</Pill>
      </div>
      <div className="flex items-center gap-3 text-xs shrink-0"><span className="flex items-center gap-1 font-bold">{touchTrend.label}<Trend trend={touchTrend.trend} /></span><Bars n={health.recencyBar} title="Recency" /><span className="text-muted">{client.partners.join(", ")}</span><span className="font-bold w-7 text-right" title="Health">{h}</span></div>
    </div>
  );
  return (
    <div onClick={onClick} className={box+" p-3 relative"}>
      <div className="flex justify-between items-start gap-2 mb-0.5">
        <span className="font-flecha text-sm">{client.name}</span>
        <div className="flex items-center gap-1 shrink-0">{client.strategic&&<UiPill kind="solid">S</UiPill>}<Pill color="gray">T{client.tier}</Pill></div>
      </div>
      <div className="text-xs text-muted mb-2 truncate">{client.markets.map(m=>m.market).join(", ")||"—"} · {client.partners.join(", ")||"—"} · {client.office}</div>
      <div className="flex gap-5 items-end mb-2">
        <div><div className="text-[10px] uppercase tracking-[0.08em] text-muted mb-0.5">Touch</div><div className="flex items-center gap-1 text-sm font-bold">{touchTrend.label}<Trend trend={touchTrend.trend} /></div></div>
        <div><div className="text-[10px] uppercase tracking-[0.08em] text-muted mb-0.5">Pipeline</div><div className="text-sm font-bold">{pipeFee>0?fmt$(pipeFee):"—"}</div></div>
        <div><div className="text-[10px] uppercase tracking-[0.08em] text-muted mb-0.5">Rel</div><div className="text-sm font-bold">{round1(relScore)}</div></div>
        <div><div className="text-[10px] uppercase tracking-[0.08em] text-muted mb-0.5">Health</div><div className="text-sm font-bold">{h}</div></div>
      </div>
      <div className="text-xs mb-1.5">{work.projects>0?<span><b>Active</b> {fmt$(work.fee)} · {work.projects} project{work.projects>1?"s":""}</span>:!pipeFee?<span className="text-muted">No active work or pipeline</span>:null}</div>
      <div className="border-t border-hair pt-1.5 flex justify-between items-center text-xs">
        <span className="text-muted flex items-center gap-2"><Bars n={health.recencyBar} title="Recency" />{lastDate?`Last ${fmtDate(lastDate)} (${dSince}d)`:"Baseline scores"}</span>
        {planned.length>0?<span className="font-bold">{planned.length} planned</span>:lastDate&&dSince>60&&client.tier<=2?<span className="text-status-amber font-bold">No upcoming</span>:null}
      </div>
    </div>
  );
}

export function ClientsTab({m}) {
  const {clients,healthMap,touchTrendMap,me,loadedAt,setModal,newClientModal}=m;
  const [q,setQ]=useState("");
  const [fPartner,setFPartner]=useState("all");
  const [fTier,setFTier]=useState("all");
  const [fOffice,setFOffice]=useState("all");
  const [fMarket,setFMarket]=useState("all");
  const [fSector,setFSector]=useState("all");
  const [fRelMin,setFRelMin]=useState("all");
  const [viewMode,setViewMode]=useState("cards");
  const [sortBy,setSortBy]=useState("stalest");
  const [sortDir,setSortDir]=useState("asc");

  const filtered=useMemo(()=>{
    const qq=q.trim().toLowerCase();
    const hit=c=>!qq||[c.name,c.sector,c.office,(c.partners||[]).join(" "),(c.markets||[]).map(mm=>mm.market+" "+mm.submarket).join(" "),c.notes,(c.contacts||[]).map(x=>[x.name,x.title,x.email].join(" ")).join(" ")].join(" ").toLowerCase().includes(qq);
    let list=clients.filter(hit);
    if(fPartner!=="all") list=list.filter(c=>c.partners.includes(fPartner));
    if(fTier!=="all") list=list.filter(c=>c.tier===parseInt(fTier));
    if(fOffice!=="all") list=list.filter(c=>c.office===fOffice);
    if(fMarket!=="all") list=list.filter(c=>c.markets.some(mm=>mm.market===fMarket));
    if(fSector!=="all") list=list.filter(c=>c.sector===fSector);
    if(fRelMin!=="all") list=list.filter(c=>(healthMap[c.id]?.relScore||0)>=parseInt(fRelMin));
    const dir = sortDir === 'asc' ? 1 : -1;
    list.sort((a,b)=>{
      const ha=healthMap[a.id]||{},hb=healthMap[b.id]||{};
      const ta=touchTrendMap[a.id]||{score:5},tb=touchTrendMap[b.id]||{score:5};
      const dA=ha.dSince!=null?ha.dSince:9999, dB=hb.dSince!=null?hb.dSince:9999;
      switch(sortBy) {
        case 'stalest': return (dB-dA)*dir;
        case 'freshest': return (dA-dB)*dir;
        case 'priority': return (hb.touchPriority-ha.touchPriority)*dir;
        case 'healthiest': return (hb.health-ha.health)*dir;
        case 'unhealthiest': return (ha.health-hb.health)*dir;
        case 'tier': return (a.tier-b.tier||dB-dA)*dir;
        case 'pipeline': return ((hb.pipeFee||0)-(ha.pipeFee||0))*dir;
        case 'activeFee': return ((hb.work?.fee||0)-(ha.work?.fee||0))*dir;
        case 'activeProjects': return ((hb.work?.projects||0)-(ha.work?.projects||0))*dir;
        case 'relationship': return ((hb.relScore||0)-(ha.relScore||0))*dir;
        case 'touchScore': return ((tb.score||0)-(ta.score||0))*dir;
        case 'touchScoreAsc': return ((ta.score||0)-(tb.score||0))*dir;
        default: return a.name.localeCompare(b.name)*dir;
      }
    });
    return list;
  },[clients,q,fPartner,fTier,fOffice,fMarket,fSector,fRelMin,sortBy,sortDir,healthMap,touchTrendMap]);

  const anyF=q||fPartner!=="all"||fTier!=="all"||fOffice!=="all"||fMarket!=="all"||fSector!=="all"||fRelMin!=="all";
  const open=c=>setModal({type:"client",data:c});
  const mine=c=>(c.partners||[]).includes(me);

  return <div className="space-y-4">
    <div className="flex items-center justify-between gap-3 flex-wrap">
      <div className="flex flex-wrap gap-1.5 items-center">
        <Input type="text" value={q} onChange={e=>setQ(e.target.value)} placeholder="Search clients, contacts, partners, markets, notes…" className="w-72" data-testid="client-search" />
        {[
          {v:fPartner,s:setFPartner,o:TOUCHPOINT_PEOPLE,a:"All partners"},
          {v:fTier,s:setFTier,o:TIERS.map(String),a:"All tiers",pre:"Tier "},
          {v:fOffice,s:setFOffice,o:OFFICES,a:"All offices"},
          {v:fMarket,s:setFMarket,o:Object.keys(MARKET_DATA),a:"All markets"},
          {v:fSector,s:setFSector,o:SECTORS,a:"All sectors"},
          {v:fRelMin,s:setFRelMin,o:["7","5","3"],a:"Any relationship",pre:"Rel ",post:"+"},
        ].map((f,i)=><Select key={i} value={f.v} onChange={e=>f.s(e.target.value)}><option value="all">{f.a}</option>{f.o.map(x=><option key={x} value={x}>{(f.pre||"")+x+(f.post||"")}</option>)}</Select>)}
        {anyF&&<Link onClick={()=>{setQ("");setFPartner("all");setFTier("all");setFOffice("all");setFMarket("all");setFSector("all");setFRelMin("all");}} className="text-xs">Reset</Link>}
      </div>
      <div className="flex gap-2 items-center flex-wrap">
        <Select value={sortBy} onChange={e=>setSortBy(e.target.value)} className="w-44">{SORT_GROUPS.map(([g,opts])=><optgroup key={g} label={g}>{opts.map(([v,l])=><option key={v} value={v}>{l}</option>)}</optgroup>)}</Select>
        <button type="button" onClick={()=>setSortDir(d=>d==='desc'?'asc':'desc')} className="h-[38px] px-2.5 border border-rule rounded-[3px] text-xs text-muted hover:border-ink" title="Reverse sort">{sortDir==='desc'?'↓':'↑'}</button>
        <SubTabs value={viewMode} onChange={setViewMode} tabs={[{id:"cards",label:"Cards"},{id:"compact",label:"List"},{id:"table",label:"Table"}]} />
        <Link onClick={newClientModal} data-testid="header-add-client">+ Client</Link>
      </div>
    </div>
    <Caption>{filtered.length} of {clients.length} clients · T1 {clients.filter(c=>c.tier===1).length} · T2 {clients.filter(c=>c.tier===2).length} · Health and recency from logged touchpoints; baseline scores until the first one is logged · Master Data for active work · loaded {loadedAt}</Caption>

    {filtered.length===0&&<Panel><Empty>No clients match.</Empty></Panel>}
    {viewMode==="cards"&&<div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-2">{filtered.map(c=><ClientCard key={c.id} client={c} health={healthMap[c.id]} touchTrend={touchTrendMap[c.id]} mine={mine(c)} onClick={()=>open(c)} />)}</div>}
    {viewMode==="compact"&&<div className="space-y-1">{filtered.map(c=><ClientCard key={c.id} client={c} health={healthMap[c.id]} touchTrend={touchTrendMap[c.id]} mine={mine(c)} compact onClick={()=>open(c)} />)}</div>}
    {viewMode==="table"&&filtered.length>0&&<Panel title="Clients" meta={`Supabase · loaded ${loadedAt}`}>
      <div className="overflow-x-auto"><table className="of-table w-full border-collapse">
        <thead><tr><th>Client</th><th>Tier</th><th>Partners</th><th>Markets</th><th>Office</th><th className="text-right">Rel</th><th>Touch</th><th>Recency</th><th className="text-right">Active</th><th className="text-right">Pipeline</th><th>Last</th><th className="text-right">Health</th></tr></thead>
        <tbody>{filtered.map(c=>{const h=healthMap[c.id];const t=touchTrendMap[c.id];return <tr key={c.id} className={"cursor-pointer hover:bg-ground "+(mine(c)?"of-mine":"")} onClick={()=>open(c)}>
          <td><span className="font-flecha text-sm">{c.name}</span>{c.strategic&&<span className="ml-1.5"><UiPill kind="solid">S</UiPill></span>}</td>
          <td>{c.tier}</td>
          <td className="text-xs">{c.partners.join(", ")}</td>
          <td className="text-xs text-muted">{c.markets.map(mm=>mm.market).join(", ")}</td>
          <td className="text-xs">{c.office}</td>
          <td className="text-right font-bold">{round1(h.relScore)}</td>
          <td><span className="flex items-center gap-1 text-xs font-bold">{t.label}<Trend trend={t.trend} /></span></td>
          <td><Bars n={h.recencyBar} /></td>
          <td className="text-right text-xs">{h.work.fee>0?fmt$(h.work.fee):"—"}</td>
          <td className="text-right text-xs">{h.pipeFee>0?fmt$(h.pipeFee):"—"}</td>
          <td className="text-xs text-muted whitespace-nowrap">{h.lastDate?fmtDate(h.lastDate)+" ("+h.dSince+"d)":"—"}</td>
          <td className="text-right font-bold">{h.health}</td>
        </tr>;})}</tbody>
      </table></div>
    </Panel>}
  </div>;
}
