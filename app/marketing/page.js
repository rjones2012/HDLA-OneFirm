'use client';
// Marketing — where the work comes from. Clients, touchpoints, leads, proposals, IDIQ, events,
// reports and the Proposal Agent, on the OneFirm shell. Seven tabs:
//   Today · Pipeline · Clients · Touchpoints · Events · Reports · Proposal Agent
// Data: Supabase via /api/marketing (clients, touchpoints, proposals, events, rel log, IDIQ,
// priority list) and Master Data via /api/masterdata (active work per client). Persist calls are
// unchanged: every save POSTs the record, every delete POSTs its id.
import { useState, useMemo, useEffect, useRef } from "react";
import { useAuth } from '../../lib/auth';
import { Shell } from '../../components/shell/Shell';
import { Tabs, Button, Input, Select, Checkbox, Pill as UiPill } from '../../components/shell/ui';
import { TOUCHPOINT_PEOPLE, OFFICES, isLeadStatus, leadClientIds, normStatus, uid, todayKey, stepsOf, withSteps, TouchpointModal, planTouchpointSave, Pill } from '../../components/marketing-shared';
import { REPORT_PEOPLE, computeHealth, computeTouchTrend, newClient, draftTouchpoint } from '../../components/marketing/helpers';
import { ClientModal, QuickLeadModal, ProposalCellEditor, ProposalSettings, EventModal, IDIQModal } from '../../components/marketing/modals';
import { TodayTab } from '../../components/marketing/TodayTab';
import { PipelineTab } from '../../components/marketing/PipelineTab';
import { ClientsTab } from '../../components/marketing/ClientsTab';
import { TouchpointsTab } from '../../components/marketing/TouchpointsTab';
import { EventsTab } from '../../components/marketing/EventsTab';
import { ReportsTab } from '../../components/marketing/ReportsTab';
import { ProposalAgentTab } from '../../components/marketing/agent';

const TABS = [{id:"today",label:"Today"},{id:"pipeline",label:"Pipeline"},{id:"clients",label:"Clients"},{id:"touchpoints",label:"Touchpoints"},{id:"events",label:"Events"},{id:"reports",label:"Reports"},{id:"agent",label:"Proposal Agent"}];
const NEW_ITEMS = [["tp","Touchpoint"],["quickLead","Lead"],["client","Client"],["prop","Proposal"],["evt","Event"]];

export default function MarketingPage() {
  const { profile } = useAuth();
  const me = profile?.initials || '';
  const [tab,setTab]=useState("today");
  const [clients,setClients]=useState([]);
  const [touchpoints,setTouchpoints]=useState([]);
  const [proposals,setProposals]=useState([]);
  const [events,setEvents]=useState([]);
  const [relLog,setRelLog]=useState([]);
  const [idiqs,setIdiqs]=useState([]);
  const [priority,setPriority]=useState([]);
  const [masterData,setMasterData]=useState([]);
  const [loading,setLoading]=useState(true);
  const [loadedAt,setLoadedAt]=useState("");
  const [stepsReady,setStepsReady]=useState(true); // false until supabase-next-steps-planner.sql has run
  const [modal,setModal]=useState(null);

  // Global scope (Today + Pipeline): office, partner, just mine
  const [gOffice,setGOffice]=useState("all");
  const [gPartner,setGPartner]=useState("all");
  const [justMine,setJustMine]=useState(false);
  // Pipeline filters live here so Today can set them before switching tabs
  const [pStages,setPStages]=useState(["Lead","Pursuing"]);
  const [pType,setPType]=useState("all");
  const [pFlag,setPFlag]=useState("all");
  const [pProb,setPProb]=useState("all");
  const [pSector,setPSector]=useState("all");
  const [pSort,setPSort]=useState("flagged");
  const [pDir,setPDir]=useState(1);
  const [pView,setPView]=useState("list");
  const [pSearch,setPSearch]=useState("");
  // Header: search + "+ New" menu
  const [q,setQ]=useState("");
  const [newOpen,setNewOpen]=useState(false);
  const newRef=useRef(null);
  useEffect(()=>{ const h=e=>{ if(newRef.current&&!newRef.current.contains(e.target)) setNewOpen(false); }; document.addEventListener('mousedown',h); return ()=>document.removeEventListener('mousedown',h); },[]);

  // Load all data from Supabase + Master Data from SharePoint
  useEffect(()=>{
    Promise.all([
      fetch('/api/marketing').then(r=>r.json()).catch(()=>({})),
      fetch('/api/masterdata').then(r=>r.json()).catch(()=>({data:[]})),
    ]).then(([mkt,md])=>{
      setClients(mkt.clients||[]);
      setTouchpoints(mkt.touchpoints||[]);
      setProposals(mkt.proposals||[]);
      setEvents(mkt.events||[]);
      setRelLog(mkt.relLog||[]);
      setIdiqs(mkt.idiqs||[]);
      setPriority(mkt.priority||[]);
      setStepsReady(mkt.stepsReady!==false);
      setMasterData(md.data||[]);
      setLoadedAt(new Date().toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit'}).toLowerCase());
      setLoading(false);
    }).catch(()=>setLoading(false));
  },[]);

  // Persist to Supabase — fire and forget (unchanged)
  const _persist=(type,data)=>{fetch('/api/marketing',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({[type]:data})}).catch(console.error);};
  const _del=(type,id)=>{fetch('/api/marketing',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({[type]:id})}).catch(console.error);};

  // Active work from Master Data by matching client names (open projects only)
  const activeWork = useMemo(()=>{
    const map = {};
    const openProjects = masterData.filter(r => r.Status === 'O');
    clients.forEach(c => {
      const cName = c.name.trim().toLowerCase();
      const mdRows = openProjects.filter(r => { const mdClient = (r.Client || '').trim().toLowerCase(); return mdClient && mdClient === cName; });
      if (mdRows.length > 0) map[c.id] = { projects: mdRows.length, fee: mdRows.reduce((s, r) => s + (r['Fee Remaining'] || 0), 0) };
    });
    return map;
  }, [clients, masterData]);
  const healthMap=useMemo(()=>{const m={};clients.forEach(c=>{m[c.id]=computeHealth(c,touchpoints,proposals,activeWork);});return m;},[clients,touchpoints,proposals,activeWork]);
  const touchTrendMap=useMemo(()=>{const m={};clients.forEach(c=>{m[c.id]=computeTouchTrend(c,touchpoints);});return m;},[clients,touchpoints]);

  // Handlers (update React state + persist) — unchanged business rules
  const saveClient=c=>{if(!(c.name||"").trim())return;setClients(p=>p.find(x=>x.id===c.id)?p.map(x=>x.id===c.id?c:x):[...p,c]);_persist('client',c);};
  const deleteClient=id=>{setClients(p=>p.filter(x=>x.id!==id));_del('deleteClient',id);};
  const saveProp=p=>{setProposals(pr=>pr.find(x=>x.id===p.id)?pr.map(x=>x.id===p.id?p:x):[...pr,p]);_persist('proposal',p);};
  const saveTP=(t0,extra)=>{
    const plan=planTouchpointSave(t0,extra,clients,proposals);
    plan.newClients.forEach(saveClient);
    plan.props.forEach(saveProp);
    const t=plan.touchpoint;
    setTouchpoints(p=>p.find(x=>x.id===t.id)?p.map(x=>x.id===t.id?t:x):[...p,t]);
    _persist('touchpoint',t);
    if(plan.clientUpdate){setClients(p=>p.map(c=>c.id===plan.clientUpdate.id?plan.clientUpdate:c));_persist('client',plan.clientUpdate);}
    if(plan.relEntry){setRelLog(p=>[...p,plan.relEntry]);_persist('relLog',plan.relEntry);}
  };
  const addLeadQuick=({client,lead,extraClients})=>{if(client)saveClient(client);(extraClients||[]).forEach(saveClient);saveProp(lead);goPipeline({stages:["Lead"]});};
  const deleteProp=id=>{setProposals(p=>p.filter(x=>x.id!==id));_del('deleteProposal',id);};
  const deleteTP=id=>{setTouchpoints(p=>p.filter(x=>x.id!==id));_del('deleteTouchpoint',id);};
  // Tick one next step from a table row. Once the planner SQL has run this flips the single shared row
  // (same one the Personal Planner shows); before that it re-saves the parent record with the step changed.
  const tickStep=(kind,parentId,stepId,done)=>{
    const patch=st=>st.id===stepId?{...st,done,doneAt:done?todayKey():""}:st;
    if(kind==="touchpoint"){
      let upd=null; setTouchpoints(p=>p.map(t=>{if(t.id!==parentId)return t;upd={...t,nextSteps:(t.nextSteps||[]).map(patch)};return upd;}));
      if(stepsReady) _persist('stepDone',{id:stepId,done}); else if(upd) _persist('touchpoint',upd);
    } else {
      let upd=null; setProposals(p=>p.map(x=>{if(x.id!==parentId)return x;upd=withSteps(x,stepsOf(x).map(patch));return upd;}));
      if(stepsReady) _persist('stepDone',{id:stepId,done}); else if(upd) _persist('proposal',upd);
    }
  };
  const saveEvent=e=>{setEvents(ev=>ev.find(x=>x.id===e.id)?ev.map(x=>x.id===e.id?e:x):[...ev,e]);_persist('event',e);};
  const deleteEvent=id=>{setEvents(e=>e.filter(x=>x.id!==id));_del('deleteEvent',id);};
  const saveIdiq=i=>{setIdiqs(p=>p.find(x=>x.id===i.id)?p.map(x=>x.id===i.id?i:x):[...p,i]);_persist('idiq',i);};
  const deleteIdiq=id=>{setIdiqs(p=>p.filter(x=>x.id!==id));_del('deleteIdiq',id);};
  const addPriority=(clientId,owner)=>{if(!clientId)return;const pos=priority.reduce((m,x)=>Math.max(m,x.position||0),0)+1;const item={id:uid(),clientId,owner:owner||"",note:"",done:false,position:pos};setPriority(p=>[...p,item]);_persist('priority',item);};
  const savePriorityItem=item=>{setPriority(p=>p.map(x=>x.id===item.id?item:x));_persist('priority',item);};
  const deletePriorityItem=id=>{setPriority(p=>p.filter(x=>x.id!==id));_del('deletePriority',id);};
  const movePriority=(id,dir)=>{const sorted=[...priority].sort((a,b)=>(a.position||0)-(b.position||0));const i=sorted.findIndex(x=>x.id===id);const j=i+dir;if(j<0||j>=sorted.length)return;const a=sorted[i],b=sorted[j];const na={...a,position:b.position||0},nb={...b,position:a.position||0};setPriority(p=>p.map(x=>x.id===a.id?na:x.id===b.id?nb:x));_persist('priority',na);_persist('priority',nb);};

  // Scope for Today + Pipeline
  const partnerScope = justMine ? me : gPartner;
  const inScope = useMemo(()=>{
    const clientOf=id=>clients.find(c=>c.id===id);
    const client=c=>(gOffice==="all"||c.office===gOffice)&&(partnerScope==="all"||!partnerScope||(c.partners||[]).includes(partnerScope));
    const prop=p=>{ const c=clientOf(p.clientId); const off=p.office||c?.office||""; return (gOffice==="all"||off===gOffice)&&(partnerScope==="all"||!partnerScope||p.partner===partnerScope); };
    const tp=t=>{ const c=clientOf(t.clientId); return (gOffice==="all"||c?.office===gOffice)&&(partnerScope==="all"||!partnerScope||t.partner===partnerScope); };
    return {client,prop,tp,mine:justMine&&!!me};
  },[clients,gOffice,partnerScope,justMine,me]);
  const scopeLabel=[gOffice!=="all"?gOffice:null,justMine?`just ${me||"me"}`:gPartner!=="all"?gPartner:null].filter(Boolean).join(" · ");

  const goPipeline=({stages,flag,view}={})=>{ if(stages) setPStages(stages); setPFlag(flag||"all"); setPView(view||"list"); setTab("pipeline"); };
  const openTP=clientId=>setModal({type:"tp",draft:draftTouchpoint(clientId,TOUCHPOINT_PEOPLE.includes(me)?me:"RJ")});
  const openNew=kind=>{ setNewOpen(false); if(kind==="client") setModal({type:"client",data:newClient()}); else setModal({type:kind}); };

  // Header search: clients, contacts, leads and proposals
  const hits=useMemo(()=>{
    const qq=q.trim().toLowerCase(); if(!qq) return null;
    const cl=clients.filter(c=>[c.name,c.sector,c.office,(c.partners||[]).join(" "),(c.markets||[]).map(mm=>mm.market+" "+mm.submarket).join(" "),c.notes].join(" ").toLowerCase().includes(qq)).slice(0,6);
    const contacts=clients.flatMap(c=>(c.contacts||[]).filter(x=>x.name&&[x.name,x.title,x.email].join(" ").toLowerCase().includes(qq)).map(x=>({c,x}))).slice(0,6);
    const opps=proposals.filter(p=>(p.projectName||"").toLowerCase().includes(qq)||leadClientIds(p).some(id=>(clients.find(x=>x.id===id)?.name||"").toLowerCase().includes(qq))||(p.notes||"").toLowerCase().includes(qq)||(p.nextStep||"").toLowerCase().includes(qq)||(p.partner||"").toLowerCase()===qq).slice(0,8);
    return {cl,contacts,opps};
  },[q,clients,proposals]);
  const pick=fn=>{fn();setQ("");};

  const m={clients,touchpoints,proposals,events,idiqs,priority,relLog,activeWork,healthMap,touchTrendMap,me,loadedAt,inScope,scopeLabel,setModal,openTP,tickStep,addPriority,savePriorityItem,deletePriorityItem,movePriority,goPipeline,setTab,
    newClientModal:()=>setModal({type:"client",data:newClient()}),
    pipe:{stages:pStages,setStages:setPStages,type:pType,setType:setPType,flag:pFlag,setFlag:setPFlag,prob:pProb,setProb:setPProb,sector:pSector,setSector:setPSector,sort:pSort,setSort:setPSort,dir:pDir,setDir:setPDir,view:pView,setView:setPView,search:pSearch,setSearch:setPSearch}};

  const openCount=proposals.filter(p=>!["Awarded","Not Awarded","Declined","Dead"].includes(p.status)).length;
  const upcomingEvts=events.filter(e=>new Date(e.date)>new Date()).length;

  const actions=<>
    <div className="relative">
      <Input type="text" value={q} onChange={e=>setQ(e.target.value)} placeholder="Search clients, contacts, leads, proposals…" className="w-72" data-testid="global-search" />
      {hits&&<div className="absolute right-0 mt-1 w-[420px] max-h-[60vh] overflow-y-auto bg-white border border-rule rounded z-40 text-sm">
        {hits.cl.length===0&&hits.contacts.length===0&&hits.opps.length===0&&<div className="px-3 py-2 text-muted italic">No matches</div>}
        {hits.cl.length>0&&<div className="px-3 pt-2 pb-1 text-[10px] uppercase tracking-[0.08em] text-muted">Clients</div>}
        {hits.cl.map(c=><div key={c.id} onClick={()=>pick(()=>setModal({type:"client",data:c}))} className="px-3 py-1.5 cursor-pointer hover:bg-ground flex justify-between"><span className="font-bold">{c.name}</span><span className="text-xs text-muted">T{c.tier} · {c.office}</span></div>)}
        {hits.contacts.length>0&&<div className="px-3 pt-2 pb-1 text-[10px] uppercase tracking-[0.08em] text-muted border-t border-hair">Contacts</div>}
        {hits.contacts.map(({c,x},i)=><div key={i} onClick={()=>pick(()=>setModal({type:"client",data:c}))} className="px-3 py-1.5 cursor-pointer hover:bg-ground flex justify-between"><span><b>{x.name}</b>{x.title?<span className="text-muted"> · {x.title}</span>:null}</span><span className="text-xs text-muted">{c.name}</span></div>)}
        {hits.opps.length>0&&<div className="px-3 pt-2 pb-1 text-[10px] uppercase tracking-[0.08em] text-muted border-t border-hair">Leads and proposals</div>}
        {hits.opps.map(p=><div key={p.id} onClick={()=>pick(()=>setModal({type:"editProp",data:p}))} className="px-3 py-1.5 cursor-pointer hover:bg-ground flex justify-between gap-2"><span><b>{p.projectName||"Untitled"}</b> <span className="text-xs text-muted">{leadClientIds(p).map(id=>clients.find(x=>x.id===id)?.name).filter(Boolean).join(" + ")}</span></span><Pill color={"stat"+normStatus(p.status)}>{normStatus(p.status)}</Pill></div>)}
      </div>}
    </div>
    <div className="relative" ref={newRef}>
      <Button onClick={()=>setNewOpen(o=>!o)}>+ New <span className="ml-1.5 text-[10px]">▾</span></Button>
      {newOpen&&<div className="absolute right-0 mt-1 w-44 bg-white border border-rule rounded z-40 py-1">
        {NEW_ITEMS.map(([k,l])=><button key={k} type="button" onClick={()=>openNew(k)} data-testid={"new-"+k} className="w-full text-left px-3 py-2 text-sm hover:bg-ground">{l}</button>)}
      </div>}
    </div>
  </>;

  return (
    <Shell module="marketing" eyebrow={`Marketing · ${clients.length} clients · three offices`} title="Where the work comes from" actions={actions}>
      {loading ? <div className="py-20 text-center text-muted animate-pulse">Loading marketing data…</div> : <>
        <Tabs tabs={TABS.map(t=>({...t,count:t.id==="pipeline"?openCount:t.id==="events"&&upcomingEvts?upcomingEvts:t.id==="clients"?clients.length:null}))} value={tab} onChange={setTab} />
        {(tab==="today"||tab==="pipeline")&&<div className="flex items-center gap-2 flex-wrap mb-5">
          <span className="text-[11px] tracking-[0.08em] uppercase text-muted mr-1">Scope</span>
          <Select value={gOffice} onChange={e=>setGOffice(e.target.value)}><option value="all">All offices</option>{OFFICES.map(o=><option key={o}>{o}</option>)}</Select>
          <Select value={justMine?me:gPartner} onChange={e=>{setGPartner(e.target.value);setJustMine(false);}} disabled={justMine}><option value="all">All partners</option>{[...new Set([...TOUCHPOINT_PEOPLE,...REPORT_PEOPLE,me].filter(Boolean))].map(p=><option key={p}>{p}</option>)}</Select>
          <label className="flex items-center gap-1.5 text-sm cursor-pointer ml-1"><input type="checkbox" checked={justMine} onChange={e=>setJustMine(e.target.checked)} disabled={!me} className="w-4 h-4" />Just mine{me?` (${me})`:""}</label>
          {scopeLabel&&<span className="ml-2"><UiPill kind="accent">{scopeLabel}</UiPill></span>}
        </div>}
        {!stepsReady&&<div data-testid="steps-sql-banner" className="mb-4 text-xs text-status-amber border border-status-amber rounded px-3 py-2">Next steps are not yet on the Personal Planner: run <b>supabase-next-steps-planner.sql</b> once in Supabase. Until then lead steps save as before, and touchpoint next steps will not persist.</div>}

        {tab==="today"&&<TodayTab m={m} />}
        {tab==="pipeline"&&<PipelineTab m={m} />}
        {tab==="clients"&&<ClientsTab m={m} />}
        {tab==="touchpoints"&&<TouchpointsTab m={m} />}
        {tab==="events"&&<EventsTab m={m} />}
        {tab==="reports"&&<ReportsTab m={m} />}
        {tab==="agent"&&<ProposalAgentTab />}
      </>}

      {modal?.type==="client"&&<ClientModal client={modal.data} relLog={relLog} onSave={saveClient} onClose={()=>setModal(null)} onDelete={deleteClient} />}
      {modal?.type==="tp"&&<TouchpointModal clients={clients} proposals={proposals} touchpoint={modal.draft||undefined} defaultPartner={TOUCHPOINT_PEOPLE.includes(me)?me:"RJ"} onSave={saveTP} onClose={()=>setModal(null)} />}
      {modal?.type==="editTP"&&<TouchpointModal clients={clients} proposals={proposals} touchpoint={modal.data} onSave={saveTP} onClose={()=>setModal(null)} onDelete={deleteTP} />}
      {modal?.type==="quickLead"&&<QuickLeadModal clients={clients} onSave={addLeadQuick} onClose={()=>setModal(null)} defaultPartner={me} />}
      {modal?.type==="prop"&&<ProposalSettings clients={clients} onSave={saveProp} onClose={()=>setModal(null)} defaultPartner={me} />}
      {modal?.type==="editProp"&&<ProposalSettings clients={clients} proposal={modal.data} focusSection={modal.section} onSave={saveProp} onClose={()=>setModal(null)} onDelete={deleteProp} />}
      {modal?.type==="cell"&&<ProposalCellEditor proposal={modal.data.item} weekKey={modal.data.week.key} weekLabel={modal.data.week.label} onClose={()=>setModal(null)} onSave={modal.data.itemType==='proposal'?saveProp:saveEvent} />}
      {modal?.type==="evt"&&<EventModal onSave={saveEvent} onClose={()=>setModal(null)} />}
      {modal?.type==="editEvt"&&<EventModal event={modal.data} onSave={saveEvent} onClose={()=>setModal(null)} onDelete={deleteEvent} />}
      {modal?.type==="idiq"&&<IDIQModal clients={clients} onSave={saveIdiq} onClose={()=>setModal(null)} />}
      {modal?.type==="editIdiq"&&<IDIQModal clients={clients} idiq={modal.data} onSave={saveIdiq} onClose={()=>setModal(null)} onDelete={deleteIdiq} />}
    </Shell>
  );
}
