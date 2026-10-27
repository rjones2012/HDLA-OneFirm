// Shared by the Marketing page and the Time page ("Log as touchpoint"), so both open the same touchpoint form
// and apply the same rules when it is saved. The Planner imports the staff list and step helpers from here too.
'use client';
import { useState } from "react";

export const FONT_H = "Flecha M, Georgia, serif";
export const PARTNERS = ["RJ","CB","MB","TJ"];
export const PRINCIPALS = ["AB","RW","CM","HD","MM"];
export const TOUCHPOINT_PEOPLE = [...PARTNERS, ...PRINCIPALS];
export const OFFICES = ["Nashville","Dallas","Raleigh"];
export const TP_TYPES = ["Lunch","Call","Email","Site Visit","Coffee","Meeting","Other"];
export const CLOSED_STATUSES = ["Awarded","Not Awarded","Declined","Dead"];
export const isLeadStatus = s => s==="Lead"||s==="Tracking"; // Leads tab only
// statuses a touchpoint can be linked to (the lead search in the touchpoint form)
export const isLinkable = s => isLeadStatus(s)||s==="Pursuing"||s==="Submitted";
export const leadClientIds = p => [p.clientId,...(p.otherClientIds||[])].filter(Boolean);
export const normStatus = s => s==="Tracking"?"Lead":s;
export const QUIET_DAYS = 30; // an open lead with no logged touchpoint for this long is flagged "quiet"
export const cid = c => c.id||("n:"+(c.name||""));
export const uid = () => Date.now().toString(36)+Math.random().toString(36).substr(2,9);
export const localDateKey = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
export const daysBetween = s => { if(!s) return 999; return Math.floor((Date.now()-new Date(s).getTime())/864e5); };
export const fmtDate = s => { if(!s) return "—"; const [y,m,d]=s.split("-").map(Number); return new Date(y,m-1,d).toLocaleDateString("en-US",{month:"short",day:"numeric"}); };
export const todayKey = () => localDateKey(new Date());

// Everyone a next step can be assigned to (same list the Planner's "Assign a task" uses)
export const ALL_STAFF = ['RJ','CB','TJ','MB','MM','AB','RW','HD','CM','EP','SD','SI','Mac','TS','YR','WB','CH','RC','Map','EC','JY','TU','ME','SA','JD','SH','AM','AR','JK','GA','JF','KR','Aim'];
export const STAFF_NAMES = {RJ:'Richie Jones',CB:'Chris Barkley',TJ:'TJ Eliason',MB:'Michael Black',MM:'Mary Miller',AB:'Austen Berry',RW:'Robert Whittemore',HD:'Hank Dalton',CM:'Chris Mantle',EP:'Ellie Peebles',SD:'Sarah DuBose',SI:'Sam Irwin',Mac:'Maggie Ackerman',TS:'Thomas Schneider',YR:'Yuan Ren',WB:'Watts Brown',CH:'Carly Hutchison',RC:'Robert Cunningham',Map:'Margaret Apperson',EC:'Elizabeth Crimmins',JY:'John Yakimicki',TU:'Taylor Uren',ME:'Madeline Easter',SA:'Savannah Alexander',JD:'Jackson Davis',SH:'Samie Hubbard',AM:'Andy Molina',AR:'Alex Ramirez',JK:'Jennifer Kerr',GA:'Grace Ackerman',JF:'Jessica Fairman',KR:'Katelyn Rockey',Aim:'Aimee Robisky'};

const clamp = (v,lo,hi) => Math.max(lo,Math.min(hi,v));
const round1 = n => Math.round(n*10)/10;

// ─── Next steps ───────────────────────────────────────────────────────────────────────
// A step is {id, text, date, done, doneAt, assignedTo, assignedBy}. Leads AND touchpoints hold a list.
// Once supabase-next-steps-planner.sql has run, every step is a row in assigned_tasks, so it shows on
// the assignee's Personal Planner and ticking it anywhere ticks it everywhere. The earliest open step
// on a lead is still mirrored into nextStep/nextStepDate (what older data and the Leads tab list use).
export const stepsOf = p => (Array.isArray(p.nextSteps)&&p.nextSteps.length)?p.nextSteps:((p.nextStep||p.nextStepDate)?[{id:"legacy-"+(p.id||""),text:p.nextStep||"",date:p.nextStepDate||"",done:false}]:[]);
const byDate = (a,b) => { const x=a.date||"9999-99-99",y=b.date||"9999-99-99"; return x<y?-1:x>y?1:0; };
export const openSteps = p => stepsOf(p).filter(s=>!s.done).sort(byDate);
export const withSteps = (p,steps) => {
  const keep=(steps||[]).filter(s=>(s.text||"").trim()||s.date);
  const first=keep.filter(s=>!s.done).sort(byDate)[0];
  return {...p,nextSteps:keep,nextStep:first?(first.text||""):"",nextStepDate:first?(first.date||""):""};
};
export const blankStep = (assignedTo) => ({id:uid(),text:"",date:"",done:false,assignedTo:assignedTo||""});
// Summary for a row in a table: open count, overdue flag, who
export const stepsSummary = steps => { const list=steps||[]; const open=list.filter(s=>!s.done); const overdue=open.some(s=>s.date&&s.date<todayKey()); return {total:list.length,open:open.length,done:list.length-open.length,overdue,next:[...open].sort(byDate)[0]||null}; };

// Lead health: last completed touchpoint linked to the lead, quiet / overdue / no-next-step flags.
export function leadFlags(lead, touchpoints) {
  if(!isLeadStatus(lead.status)) return {lastTouch:"",dSince:null,quiet:false,overdue:false,noNext:false,any:false};
  const linked = touchpoints.filter(t=>t.status==="completed"&&(t.leadIds||[]).includes(lead.id)).map(t=>t.date).filter(Boolean).sort();
  const lastTouch = linked.length?linked[linked.length-1]:"";
  const base = lastTouch || lead.leadSince || (lead.createdAt||"").slice(0,10);
  const dSince = base ? daysBetween(base) : null;
  const quiet = dSince!=null && dSince>QUIET_DAYS;
  const open = openSteps(lead);
  const overdue = open.some(s=>s.date&&s.date<todayKey());
  const noNext = open.length===0;
  return {lastTouch,dSince,quiet,overdue,noNext,any:quiet||overdue||noNext};
}

export function Modal({title,onClose,children,wide}) {
  return (
    <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50" onClick={onClose}>
      <div className={"bg-white rounded-lg shadow-xl max-h-[90vh] overflow-auto "+(wide?"w-[720px]":"w-[600px]")} onClick={e=>e.stopPropagation()}>
        <div className="sticky top-0 bg-white border-b px-4 py-3 flex justify-between items-center z-10">
          <div className="font-bold text-gray-900" style={{fontFamily:FONT_H}}>{title}</div>
          <button onClick={onClose} className="bg-ink text-white px-3 py-1 rounded-[3px] text-sm font-bold">Done</button>
        </div>
        <div className="p-4 space-y-4">{children}</div>
      </div>
    </div>
  );
}
export const Sec = ({title,action,children}) => <div><div className="flex justify-between items-center mb-2"><label className="text-xs font-semibold text-gray-500 uppercase tracking-wide">{title}</label>{action}</div>{children}</div>;
export const AddBtn = ({onClick,children}) => <button onClick={onClick} className="text-xs text-hdla-green font-medium">{children}</button>;
export const DelBtn = ({onClick}) => <button onClick={onClick} className="text-gray-400 hover:text-red-500 px-1 text-lg">×</button>;
export const Lbl = ({children}) => <label className="block text-xs font-medium text-gray-500 mb-1">{children}</label>;
export const Inp = (p) => <input {...p} className={"border border-gray-200 rounded px-2 py-1.5 text-sm bg-white "+(p.className||"")} />;
export const Sel = ({children,...p}) => <select {...p} className={"border border-gray-200 rounded px-2 py-1.5 text-sm bg-white "+(p.className||"")}>{children}</select>;
export const Txt = (p) => <textarea {...p} className={"border border-gray-200 rounded px-2 py-1.5 text-sm bg-white resize-none "+(p.className||"")} />;
export function Pill({color,children}) {
  // One pill language: statuses are outlined ink, semantic states carry their color, done is muted.
  const cls = {
    gray:"bg-hair text-muted", green:"border border-ink text-ink", amber:"border border-status-amber text-status-amber",
    red:"border border-status-red text-status-red", blue:"border border-ink text-ink", violet:"text-accent",
    probH:"bg-ink text-white", probM:"border border-ink text-ink", probL:"border border-muted text-muted", probXL:"bg-hair text-done",
    statTracking:"border border-ink text-ink", statPursuing:"border border-ink text-ink", statSubmitted:"border border-ink text-ink",
    statLead:"border border-ink text-ink", statDead:"bg-hair text-done", statAwarded:"bg-accent text-white", "statNot Awarded":"bg-hair text-done", statDeclined:"bg-hair text-done",
  }[color]||"border border-ink text-ink";
  return <span className={"inline-block text-[11px] font-bold uppercase tracking-[0.04em] px-1.5 py-[2px] rounded-[2px] leading-none "+cls}>{children}</span>;
}

export function OtherClients({clients,primaryId,value,onChange,onCreate}) {
  const [q,setQ]=useState("");
  const ids=value||[];
  const chosen=ids.map(id=>clients.find(c=>c.id===id)).filter(Boolean);
  const res=q?clients.filter(c=>c.id!==primaryId&&!ids.includes(c.id)&&c.name.toLowerCase().includes(q.toLowerCase())).sort((a,b)=>a.name.localeCompare(b.name)).slice(0,8):[];
  const exact=clients.some(c=>c.name.trim().toLowerCase()===q.trim().toLowerCase());
  const canCreate=!!onCreate&&q.trim().length>0&&!exact;
  return <div data-section="other-clients">
    {chosen.map(c=><div key={c.id} className="bg-green-50 rounded px-2 py-1.5 mb-1 flex justify-between items-center text-sm"><span>{c.name}</span><button type="button" onClick={()=>onChange(ids.filter(x=>x!==c.id))} className="text-xs text-gray-400 hover:text-red-500" title="Remove">✕</button></div>)}
    <Inp type="text" value={q} onChange={e=>setQ(e.target.value)} placeholder="Search clients to add..." className="w-full" />
    {(res.length>0||canCreate)&&<div className="border border-gray-200 rounded mt-1 max-h-[140px] overflow-y-auto">{res.map(c=><div key={c.id} onClick={()=>{onChange([...ids,c.id]);setQ("");}} className="px-2 py-1.5 text-sm cursor-pointer hover:bg-blue-50">{c.name}</div>)}{canCreate&&<div data-testid="create-other-client" onClick={()=>{const nc=onCreate(q.trim());onChange([...ids,nc.id]);setQ("");}} className="px-2 py-1.5 text-sm cursor-pointer hover:bg-amber-50 text-amber-800 border-t border-gray-100">+ Create “{q.trim()}” as a new client</div>}</div>}
  </div>;
}
export function ContactGroups({clients,ids,selected,onToggle}) {
  const list=(ids||[]).map(id=>clients.find(c=>c.id===id)).filter(Boolean);
  return <div className="space-y-2">{list.map(c=><div key={c.id}>{list.length>1&&<div className="text-xs text-gray-500 mb-1">{c.name}</div>}<ContactChips contacts={c.contacts} selected={selected} onToggle={onToggle} /></div>)}</div>;
}
export function ContactChips({contacts,selected,onToggle}) {
  const list=(contacts||[]).filter(c=>c.name);
  if(list.length===0) return <div className="text-xs text-gray-400 italic">No contacts on this client yet. Add them in the client record.</div>;
  return <div className="flex flex-wrap gap-1.5">{list.map(c=>{const on=(selected||[]).includes(cid(c));return <button type="button" key={cid(c)} data-chip={c.name} onClick={()=>onToggle(c)} className={"text-xs px-2 py-1 rounded-full border "+(on?"bg-hdla-green text-white border-hdla-green":"bg-white text-gray-600 border-gray-300 hover:border-gray-400")}>{on?"✓ ":""}{c.name}{c.title?<span className="opacity-70"> · {c.title}</span>:null}</button>;})}</div>;
}

// Assignee dropdown for a step. Anyone can assign to anyone.
export function AssigneeSel({value,onChange,className}) {
  const opts=[...new Set([...ALL_STAFF,value].filter(Boolean))];
  return <Sel value={value||""} onChange={e=>onChange(e.target.value)} className={className||""} title="Shows on this person's Personal Planner" data-testid="step-assignee">
    <option value="">Assign to…</option>
    {opts.map(s=><option key={s} value={s}>{s}</option>)}
  </Sel>;
}

// ─── Next-steps editor (a list of steps; tick to mark done; pick who it is for) ───────────
// defaultAssignee: who a new step goes to (the lead's partner / the touchpoint's partner).
// noDone: hide the tick box (used where you are only adding new steps).
export function NextStepsEditor({steps,onChange,defaultAssignee,noDone}) {
  const list=steps||[];
  const set=(id,patch)=>onChange(list.map(x=>x.id===id?{...x,...patch}:x));
  return <div data-section="next-steps" className="space-y-1.5">
    {list.map(st=><div key={st.id} data-step-row className={"grid gap-2 items-center "+(noDone?"grid-cols-[1fr_8.5rem_5.5rem_auto]":"grid-cols-[auto_1fr_8.5rem_5.5rem_auto]")}>
      {!noDone&&<input type="checkbox" checked={!!st.done} onChange={e=>set(st.id,{done:e.target.checked,doneAt:e.target.checked?todayKey():""})} title="Done" className="rounded" data-testid="step-done" />}
      <Inp type="text" value={st.text} onChange={e=>set(st.id,{text:e.target.value})} placeholder="Next step" className={"w-full "+(st.done?"line-through text-gray-400":"")} data-testid="step-text" />
      <Inp type="date" value={st.date||""} onChange={e=>set(st.id,{date:e.target.value})} className="w-full" />
      <AssigneeSel value={st.assignedTo||defaultAssignee||""} onChange={v=>set(st.id,{assignedTo:v})} className="w-full" />
      <button type="button" onClick={()=>onChange(list.filter(x=>x.id!==st.id))} className="text-gray-400 hover:text-red-500 px-1" title="Remove">✕</button>
    </div>)}
    <div className="flex items-center gap-3">
      <button type="button" data-testid="step-add" onClick={()=>onChange([...list,blankStep(defaultAssignee)])} className="text-xs text-hdla-green font-medium">+ Add {list.length?"another ":""}next step</button>
      {list.length>0&&<span className="text-[11px] text-gray-400">Each step shows on the assignee's Personal Planner.</span>}
    </div>
  </div>;
}


// ─── Touchpoint Modal (create, edit, or a draft handed over from Time) ───────────────
export function TouchpointModal({clients,proposals,touchpoint,onSave,onClose,onDelete,defaultPartner}) {
  const isDraft=!!(touchpoint&&touchpoint._draft);
  const isEdit=!!touchpoint&&!isDraft;
  const [d,setD]=useState(touchpoint?{contactIds:[],contactNames:[],leadIds:[],...touchpoint}:{id:uid(),clientId:"",type:"Lunch",partner:defaultPartner||"RJ",date:localDateKey(new Date()),status:"completed",rating:5,notes:"",contactIds:[],contactNames:[],leadIds:[]});
  const [clientSearch,setClientSearch]=useState("");
  const [leadQ,setLeadQ]=useState("");
  const [newLead,setNewLead]=useState(false);
  const newOpp=()=>({id:uid(),title:"",steps:[blankStep(d.partner)],otherClientIds:[]});
  const [opps,setOpps]=useState([newOpp()]); // a touchpoint can surface more than one opportunity
  const setOpp=(id,patch)=>setOpps(prev=>prev.map(o=>o.id===id?{...o,...patch}:o));
  const [nlNew,setNlNew]=useState([]); // brand-new team clients typed under the new lead
  const [ns,setNs]=useState({steps:[blankStep(d.partner)],status:"",done:[]});
  // the touchpoint's OWN next steps — independent of any lead; each goes to the assignee's planner
  const [tpSteps,setTpSteps]=useState(()=>(isEdit&&Array.isArray(touchpoint.nextSteps)&&touchpoint.nextSteps.length)?touchpoint.nextSteps:[]);
  const s=(f,v)=>setD(prev=>({...prev,[f]:v}));
  const ratingLabels={1:'Poor',2:'Weak',3:'Below Avg',4:'Fair',5:'Neutral',6:'Decent',7:'Good',8:'Strong',9:'Very Strong',10:'Exceptional'};
  const ratingColor=v=>v>=8?'border-green-500 bg-green-50 text-green-700':v>=6?'border-green-300 bg-green-50/50 text-green-600':v===5?'border-gray-400 bg-gray-50 text-gray-600':v>=3?'border-amber-400 bg-amber-50 text-amber-600':'border-red-400 bg-red-50 text-red-600';
  const filteredClients = clients.filter(c=>!clientSearch||c.name.toLowerCase().includes(clientSearch.toLowerCase())).sort((a,b)=>a.name.localeCompare(b.name));
  const selectedClient = clients.find(c=>c.id===d.clientId);
  const props=proposals||[];
  const nameOf=id=>clients.find(c=>c.id===id)?.name||"";
  const openLeadsFor = id => props.filter(p=>leadClientIds(p).includes(id)&&isLinkable(p.status));
  const pickClient = id => {
    const only=openLeadsFor(id);
    setD(prev=>({...prev,clientId:id,contactIds:[],contactNames:[],leadIds:(!isEdit&&only.length===1)?[only[0].id]:[]}));
    setNewLead(false);
  };
  const selectedLeads = props.filter(p=>(d.leadIds||[]).includes(p.id));
  const clientLeads = props.filter(p=>leadClientIds(p).includes(d.clientId)&&isLinkable(p.status));
  const shownLeads = [...clientLeads,...selectedLeads.filter(p=>!clientLeads.some(x=>x.id===p.id))];
  const toggleContact = c => setD(prev=>{
    const id=cid(c),ids=prev.contactIds||[],names=prev.contactNames||[];
    const i=ids.indexOf(id);
    return i>=0?{...prev,contactIds:ids.filter((_,j)=>j!==i),contactNames:names.filter((_,j)=>j!==i)}:{...prev,contactIds:[...ids,id],contactNames:[...names,c.name]};
  });
  const matchesQ = (p,q) => (p.projectName||"").toLowerCase().includes(q)||leadClientIds(p).some(id=>nameOf(id).toLowerCase().includes(q));
  // top search finds clients AND leads; picking a lead fills in its client and ticks the lead
  const q0=clientSearch.trim().toLowerCase();
  const leadHits=q0?props.filter(p=>isLinkable(p.status)&&matchesQ(p,q0)).slice(0,8):[];
  const pickLead = p => { setD(prev=>({...prev,clientId:p.clientId,contactIds:[],contactNames:[],leadIds:[p.id]})); setNewLead(false); setClientSearch(""); };
  // the lead search inside the form adds more leads, from any client
  const lq=leadQ.trim().toLowerCase();
  const addHits=lq?props.filter(p=>isLinkable(p.status)&&!(d.leadIds||[]).includes(p.id)&&matchesQ(p,lq)).slice(0,8):[];
  const addLead = p => { setD(prev=>({...prev,leadIds:[...(prev.leadIds||[]),p.id]})); setLeadQ(""); };
  const switchClient = id => setD(prev=>({...prev,clientId:id,contactIds:[],contactNames:[]}));
  const teamIds=[...new Set(selectedLeads.flatMap(p=>leadClientIds(p)))];
  const toggleLead = id => setD(prev=>({...prev,leadIds:(prev.leadIds||[]).includes(id)?prev.leadIds.filter(x=>x!==id):[...(prev.leadIds||[]),id]}));
  const toggleDone = id => setNs(prev=>({...prev,done:prev.done.includes(id)?prev.done.filter(x=>x!==id):[...prev.done,id]}));
  // steps typed in this form: keep text/date/assignee; new ones start open
  const cleanSteps = list => list.filter(x=>(x.text||"").trim()||x.date).map(x=>({id:x.id,text:(x.text||"").trim(),date:x.date||"",done:false,assignedTo:x.assignedTo||d.partner||"",assignedBy:d.partner||""}));
  // the touchpoint's own steps keep their done state when editing
  const cleanOwn = list => list.filter(x=>(x.text||"").trim()||x.date).map(x=>({id:x.id,text:(x.text||"").trim(),date:x.date||"",done:!!x.done,doneAt:x.doneAt||"",assignedTo:x.assignedTo||d.partner||"",assignedBy:x.assignedBy||d.partner||""}));
  const canStatus = selectedLeads.some(p=>isLeadStatus(p.status)||p.status==="Pursuing");
  const finish=()=>{
    if(!d.clientId){onClose();return;}
    const extra={};
    if(newLead){
      const used=opps.filter((o,i)=>i===0||o.title.trim()||cleanSteps(o.steps).length||o.otherClientIds.length);
      const allIds=used.flatMap(o=>o.otherClientIds);
      extra.newLeads=used.map((o,i)=>({title:o.title.trim()||((selectedClient?.name||"New")+" opportunity"+(used.length>1?" "+(i+1):"")),nextSteps:cleanSteps(o.steps),otherClientIds:o.otherClientIds,newClients:nlNew.filter(n=>o.otherClientIds.includes(n.id)&&allIds.includes(n.id))}));
    }
    const addSteps=cleanSteps(ns.steps);
    if((d.leadIds||[]).length&&(addSteps.length||ns.done.length||ns.status)) extra.update={addSteps,doneIds:ns.done,status:canStatus?ns.status:""};
    const {_draft,...clean}=d;
    onSave({...clean,nextSteps:cleanOwn(tpSteps)},extra);onClose();
  };
  const setNsStep=(id,patch)=>setNs(prev=>({...prev,steps:prev.steps.map(x=>x.id===id?{...x,...patch}:x)}));
  const partnerOpts=[...new Set([...TOUCHPOINT_PEOPLE,d.partner].filter(Boolean))];
  const ownSum=stepsSummary(tpSteps.filter(x=>(x.text||"").trim()||x.date));
  return (
    <Modal title={isEdit?"Edit Touchpoint":"Log Touchpoint"} onClose={finish}>
      {d.timeEntryId&&<div data-testid="from-time" className="text-xs text-blue-700 bg-blue-50 rounded px-2.5 py-1.5">Logged from a Time entry{d.timeHours?` · ${d.timeHours}h`:""}. Editing here does not change the hours.</div>}
      <div><Lbl>Client</Lbl>
        <Inp type="text" value={clientSearch} onChange={e=>{setClientSearch(e.target.value);if(!e.target.value&&!isDraft)pickClient("");}} placeholder="Search clients..." className="w-full mb-1" />
        {selectedClient&&!clientSearch?<div className="text-sm font-medium text-gray-800 bg-green-50 px-2 py-1.5 rounded flex justify-between items-center"><span>{selectedClient.name}</span><button onClick={()=>{pickClient("");setClientSearch("");}} className="text-xs text-gray-400 hover:text-red-500">✕</button></div>:
        <div className="max-h-[200px] overflow-y-auto border border-gray-200 rounded">
          {filteredClients.length===0&&leadHits.length===0?<div className="text-xs text-gray-400 p-2">No matches</div>:<>
            {leadHits.length>0&&clientSearch&&<div className="px-2 pt-1.5 text-[10px] font-semibold text-gray-400 uppercase tracking-wide">Clients</div>}
            {filteredClients.slice(0,20).map(c=><div key={c.id} onClick={()=>{pickClient(c.id);setClientSearch("");}} className={"px-2 py-1.5 text-sm cursor-pointer hover:bg-blue-50 "+(d.clientId===c.id?"bg-blue-50 font-medium":"")}>{c.name}</div>)}
            {leadHits.length>0&&<div className="px-2 pt-1.5 text-[10px] font-semibold text-gray-400 uppercase tracking-wide border-t border-gray-100">Leads and proposals</div>}
            {leadHits.map(p=><div key={p.id} data-lead-hit={p.projectName} onClick={()=>pickLead(p)} className="px-2 py-1.5 text-sm cursor-pointer hover:bg-purple-50"><b>{p.projectName||"Untitled"}</b> <Pill color={"stat"+normStatus(p.status)}>{normStatus(p.status)}</Pill><div className="text-xs text-gray-500">{leadClientIds(p).map(nameOf).filter(Boolean).join(" + ")}</div></div>)}
          </>}
        </div>}
      </div>
      {selectedClient&&teamIds.length>1&&<div data-section="team"><Lbl>Which team did you meet with?</Lbl><div className="flex flex-wrap gap-1.5">{teamIds.map(id=>{const c=clients.find(x=>x.id===id);if(!c)return null;const on=id===d.clientId;return <button type="button" key={id} data-team={c.name} onClick={()=>switchClient(id)} className={"text-xs px-2.5 py-1 rounded-full border "+(on?"bg-hdla-green text-white border-hdla-green":"bg-white text-gray-600 border-gray-300 hover:border-gray-400")}>{c.name}</button>;})}</div></div>}
      {selectedClient&&<div><Lbl>Who did you meet with?</Lbl><ContactChips contacts={selectedClient.contacts} selected={d.contactIds} onToggle={toggleContact} /></div>}
      <div className="grid grid-cols-2 gap-3">
        <div><Lbl>Type</Lbl><Sel value={d.type} onChange={e=>s("type",e.target.value)} className="w-full">{TP_TYPES.map(t=><option key={t}>{t}</option>)}</Sel></div>
        <div><Lbl>Partner</Lbl><Sel value={d.partner} onChange={e=>s("partner",e.target.value)} className="w-full">{partnerOpts.map(p=><option key={p}>{p}</option>)}</Sel></div>
        <div><Lbl>Date</Lbl><Inp type="date" value={d.date} onChange={e=>s("date",e.target.value)} className="w-full" /></div>
        <div><Lbl>Status</Lbl><Sel value={d.status} onChange={e=>{const v=e.target.value;setD(prev=>({...prev,status:v,rating:v==="planned"?null:prev.rating}));}} className="w-full"><option value="completed">Completed</option><option value="planned">Planned</option></Sel></div>
      </div>

      {/* ── The touchpoint's own next steps — independent of any lead ── */}
      {selectedClient&&<div className="rounded border border-violet-200 bg-violet-50/60 p-2.5 space-y-1.5" data-section="tp-steps">
        <div className="flex items-center justify-between gap-2">
          <Lbl>Next steps from this touchpoint</Lbl>
          {ownSum.total>0&&<span className="text-[11px] text-gray-500">{ownSum.open} open{ownSum.done?` · ${ownSum.done} done`:""}{ownSum.overdue?<span className="text-red-600 font-medium"> · overdue</span>:null}</span>}
        </div>
        <NextStepsEditor steps={tpSteps} onChange={setTpSteps} defaultAssignee={d.partner} />
        <div className="text-[11px] text-gray-500">Action items for {selectedClient.name} that are not tied to a lead. Assign to anyone; they land on that person's planner. Tick here or there — it is one list.</div>
      </div>}

      {/* ── Leads / proposals this touchpoint is about ── */}
      {selectedClient&&<div className="bg-gray-50 rounded p-2.5 space-y-2" data-section="leads">
        <div><Lbl>Which leads or proposals?</Lbl>
          {shownLeads.length===0?<div className="text-xs text-gray-400 italic">No open leads for this client. Search below to add one from another client.</div>:
          <div className="space-y-1">{shownLeads.map(p=><label key={p.id} data-lead-row-tp={p.projectName} className="flex items-center gap-2 text-sm cursor-pointer"><input type="checkbox" checked={(d.leadIds||[]).includes(p.id)} onChange={()=>toggleLead(p.id)} className="rounded" /><span className="font-medium">{p.projectName||"Untitled"}</span><Pill color={"stat"+normStatus(p.status)}>{normStatus(p.status)}</Pill><span className="text-xs text-gray-400">{p.partner}{p.clientId!==d.clientId?" · filed under "+(nameOf(p.clientId)||"?"):""}</span></label>)}</div>}
          <div className="relative mt-1.5">
            <Inp type="text" value={leadQ} onChange={e=>setLeadQ(e.target.value)} placeholder="Search all active leads, pursuits and proposals to add..." className="w-full" data-testid="lead-search" />
            {addHits.length>0&&<div className="border border-gray-200 rounded mt-1 max-h-[160px] overflow-y-auto bg-white">{addHits.map(p=><div key={p.id} data-lead-pick={p.projectName} onClick={()=>addLead(p)} className="px-2 py-1.5 text-sm cursor-pointer hover:bg-purple-50"><b>{p.projectName||"Untitled"}</b> <Pill color={"stat"+normStatus(p.status)}>{normStatus(p.status)}</Pill><div className="text-xs text-gray-500">{leadClientIds(p).map(nameOf).filter(Boolean).join(" + ")}</div></div>)}</div>}
            {lq&&addHits.length===0&&<div className="text-xs text-gray-400 mt-1">No other active leads match.</div>}
          </div>
          <div className="text-xs text-gray-400 mt-1">Leave empty for a plain relationship touchpoint.</div>
        </div>
        {selectedLeads.length>0&&<div className="border-t border-gray-200 pt-2 space-y-2" data-section="followup">
          {selectedLeads.map(p=>{const os=openSteps(p);return os.length>0&&<div key={p.id} data-open-steps={p.projectName}>
            <div className="text-xs text-gray-500 mb-1">{selectedLeads.length>1?<b>{p.projectName||"Untitled"}</b>:null}{selectedLeads.length>1?" · ":""}Open next steps on this lead. Tick any this touchpoint completed.</div>
            {os.map(st=>{const on=ns.done.includes(st.id);return <label key={st.id} data-step={st.text} className="flex items-center gap-2 text-sm cursor-pointer"><input type="checkbox" checked={on} onChange={()=>toggleDone(st.id)} className="rounded" /><span className={on?"line-through text-gray-400":""}>{st.text||"(no description)"}</span>{st.assignedTo&&<span className="text-[11px] text-violet-700 bg-violet-100 rounded px-1">{st.assignedTo}</span>}{st.date&&<span className={"text-xs "+(st.date<todayKey()&&!on?"text-red-600":"text-gray-400")}>{fmtDate(st.date)}</span>}</label>;})}
          </div>;})}
          <div>
            <div className="text-xs text-gray-500 mb-1">Add next steps to the lead{selectedLeads.length>1?"s above (added to every one)":""}. Leave blank for none.</div>
            <NextStepsEditor steps={ns.steps} onChange={v=>setNs(prev=>({...prev,steps:v}))} defaultAssignee={d.partner} noDone />
          </div>
          {canStatus&&<div><Sel value={ns.status} onChange={e=>setNs({...ns,status:e.target.value})}><option value="">Status: no change</option><option value="Lead">Lead</option><option value="Pursuing">Pursuing (moves it to Proposals)</option><option value="Dead">Dead</option></Sel>{selectedLeads.some(p=>!isLeadStatus(p.status)&&p.status!=="Pursuing")&&<span className="text-xs text-gray-400 ml-2">Status applies to leads and pursuits only.</span>}</div>}
        </div>}
        <div className="border-t border-gray-200 pt-2">
          <label className="flex items-center gap-2 text-sm cursor-pointer"><input type="checkbox" checked={newLead} onChange={e=>setNewLead(e.target.checked)} className="rounded" data-testid="new-opp" /><b>This surfaced a new opportunity</b></label>
          {newLead&&<div className="mt-2 space-y-2" data-section="opportunities">
            {clientLeads.length>0&&<div className="text-xs text-amber-700 bg-amber-50 rounded p-2">{selectedClient.name} is already on an open lead ({clientLeads.map(p=>p.projectName||"Untitled").join(", ")}). If this is the same one, tick it above instead.</div>}
            {opps.map((o,i)=><div key={o.id} data-opp={i+1} className="bg-amber-50 rounded p-2 space-y-2">
              {opps.length>1&&<div className="flex justify-between items-center"><span className="text-xs font-semibold text-amber-800">Opportunity {i+1}</span><button type="button" onClick={()=>setOpps(prev=>prev.filter(x=>x.id!==o.id))} className="text-xs text-gray-400 hover:text-red-500" title="Remove this opportunity">✕ Remove</button></div>}
              <Inp type="text" value={o.title} onChange={e=>setOpp(o.id,{title:e.target.value})} placeholder="Lead title (e.g. Greenway Phase 2)" className="w-full" />
              <div><div className="text-xs text-gray-500 mb-1">Other clients on this lead (teams)</div><OtherClients clients={[...clients,...nlNew]} primaryId={d.clientId} value={o.otherClientIds} onChange={v=>setOpp(o.id,{otherClientIds:v})} onCreate={name=>{const nc={id:uid(),name,sector:"",office:selectedClient?.office||"Nashville",tier:3,relationshipScore:5,relationshipOverride:null,touchpointValue:5,partners:[d.partner],strategic:false,markets:[],contacts:[],notes:""};setNlNew(p=>[...p,nc]);return nc;}} /></div>
              <div><div className="text-xs text-gray-500 mb-1">Next steps on this lead</div><NextStepsEditor steps={o.steps} onChange={v=>setOpp(o.id,{steps:v})} defaultAssignee={d.partner} noDone /></div>
            </div>)}
            <button type="button" data-testid="add-opp" onClick={()=>setOpps(prev=>[...prev,newOpp()])} className="text-xs text-hdla-green font-medium">+ Add another opportunity</button>
            <div className="text-xs text-gray-500">Each starts as a Lead under {d.partner}. They carry the contacts you picked and this touchpoint.</div>
          </div>}
        </div>
      </div>}
      {d.status==="completed"&&<div><Lbl>How did it go? ({d.rating||5}/10)</Lbl><div className="grid grid-cols-5 gap-1">{[1,2,3,4,5,6,7,8,9,10].map(v=><button key={v} onClick={()=>s("rating",v)} className={"py-1.5 rounded-lg text-center border-2 "+(d.rating===v?ratingColor(v):"border-gray-100 hover:border-gray-200")}><div className={"text-base font-bold "+(d.rating===v?"":"text-gray-400")}>{v}</div></button>)}</div><div className="text-xs text-gray-500 mt-1 text-center">{ratingLabels[d.rating]||''}</div></div>}
      <div><Lbl>Notes</Lbl><Txt value={d.notes} onChange={e=>s("notes",e.target.value)} rows={2} className="w-full" /></div>
      {(isEdit||d.clientId)&&<div className="pt-2 border-t flex justify-between">
        {isEdit&&onDelete?<button onClick={()=>{if(confirm("Delete this touchpoint?")){onDelete(d.id);onClose();}}} className="text-red-500 text-sm hover:text-red-700">Delete Touchpoint</button>:<div/>}
        {!isEdit&&d.clientId&&<button onClick={()=>onClose()} className="text-gray-500 text-sm hover:text-red-500">Cancel without saving</button>}
      </div>}
    </Modal>
  );
}

// What saving a touchpoint changes, as plain data, so Marketing (local state) and Time (API calls) apply it the same way:
// { touchpoint, props: [changed/new proposals], newClients, clientUpdate, relEntry }
export function planTouchpointSave(t0, extra, clients, proposals) {
  const today=localDateKey(new Date());
  const out={touchpoint:t0,props:[],newClients:[],clientUpdate:null,relEntry:null};
  let t=t0;
  if(extra&&extra.update){
    const u=extra.update;
    (t0.leadIds||[]).forEach(id=>{
      const p=proposals.find(x=>x.id===id); if(!p) return;
      let np={...p};
      if((u.doneIds||[]).length||(u.addSteps||[]).length){
        const steps=stepsOf(p).map(st=>(u.doneIds||[]).includes(st.id)?{...st,done:true,doneAt:today}:st);
        np=withSteps(np,[...steps,...(u.addSteps||[]).map(st=>({...st,id:uid(),done:false,assignedTo:st.assignedTo||t0.partner||p.partner||"",assignedBy:t0.partner||""}))]);
      }
      if(u.status&&(isLeadStatus(p.status)||p.status==="Pursuing")){np.status=u.status; if(isLeadStatus(u.status)&&!np.leadSince) np.leadSince=today;}
      out.props.push(np);
    });
  }
  const newLeads=(extra&&(extra.newLeads||(extra.newLead?[extra.newLead]:[])))||[];
  newLeads.forEach(nl=>{
    const cl=clients.find(c=>c.id===t0.clientId)||{};
    const base={id:uid(),clientId:t0.clientId,projectName:nl.title,fee:0,probability:"M",status:"Lead",partner:t0.partner,pm:"",proposalType:"Proposal",office:OFFICES.includes(cl.office)?cl.office:"",sector:cl.sector||"",market:"",submarket:"",dueDate:"",submittedDate:"",awardedDate:"",kickoffDone:false,notes:"",needs:[],tasks:[],reviewPartners:[],reviewNotes:"",leadSince:t0.date||today,deadReason:"",sourceTouchpointId:t0.id,contactIds:t0.contactIds||[],otherClientIds:nl.otherClientIds||[]};
    const lead=withSteps(base,(nl.nextSteps||[]).map(st=>({...st,id:uid(),done:false,assignedTo:st.assignedTo||t0.partner||"",assignedBy:t0.partner||""})));
    (nl.newClients||[]).forEach(c=>{if(!out.newClients.some(x=>x.id===c.id))out.newClients.push(c);});
    out.props.push(lead);
    t={...t,leadIds:[...(t.leadIds||[]),lead.id]};
  });
  out.touchpoint=t;
  if(t.status==="completed"&&t.rating&&t.clientId){
    const cl=clients.find(c=>c.id===t.clientId);
    if(cl&&cl.relationshipOverride===null){
      // 1-10 scale: 5=neutral (no change), above/below shifts relationship
      const delta = t.rating >= 9 ? 0.5 : t.rating >= 7 ? 0.3 : t.rating === 6 ? 0.1 : t.rating === 5 ? 0 : t.rating === 4 ? -0.1 : t.rating >= 2 ? -0.3 : -0.5;
      if(delta){const os=cl.relationshipScore,nsc=round1(clamp(os+delta,1,10));
        if(nsc!==os){
          out.clientUpdate={...cl,relationshipScore:nsc};
          out.relEntry={clientId:t.clientId,date:t.date,oldScore:os,newScore:nsc,reason:`Touchpoint rated ${t.rating} (${t.type} w/ ${t.partner})`};
        }
      }
    }
  }
  return out;
}
