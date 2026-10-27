'use client';
// Record editors for the Marketing module. Same fields, same save rules as before; built on the
// OneFirm Modal / Input / Select. The TouchpointModal stays in marketing-shared (shared with Time).
import { useState, useEffect, useRef } from 'react';
import { Modal, Input, Select, Textarea, Label, Button, Link } from '../shell/ui';
import { OFFICES, TOUCHPOINT_PEOPLE, isLeadStatus, isLinkable, leadClientIds, normStatus, cid, uid, localDateKey, fmtDate, stepsOf, withSteps, blankStep, Pill, OtherClients, ContactGroups, NextStepsEditor } from '../marketing-shared';
import { TIERS, SECTORS, MARKET_DATA, PROBS, EVT_TYPES, PROPOSAL_TYPES, PROP_OFFICES, PROP_SECTORS, PROP_MARKETS, PROP_SUBMARKETS, BD_STAFF, clamp, round1, getDayLabel, getWeekLabel, getMonday, dateIsDay, dateInWeek, newClient } from './helpers';
import { Sec, AddLink, DelBtn, Hint } from './bits';

const Field = ({label,children,span}) => <div className={span?'col-span-2':''}><Label>{label}</Label>{children}</div>;
const Row = ({children}) => <div className="flex gap-2 items-center border border-hair rounded-[3px] p-2 mb-1.5">{children}</div>;
const Danger = ({onClick,children}) => <button type="button" onClick={onClick} className="text-[13px] font-bold text-status-red">{children}</button>;
const Quiet = ({onClick,children}) => <button type="button" onClick={onClick} className="text-[13px] text-muted hover:text-ink">{children}</button>;
const Picked = ({name,tag,onClear}) => <div className="text-sm font-bold border border-ink rounded-[3px] px-2.5 py-1.5 flex justify-between items-center"><span>{name}{tag&&<span className="ml-2 text-xs font-normal text-muted">{tag}</span>}</span><button type="button" onClick={onClear} className="text-xs text-muted hover:text-status-red" aria-label="Clear">×</button></div>;
const Hit = ({onClick,children,create}) => <div onClick={onClick} className={'px-2.5 py-1.5 text-sm cursor-pointer hover:bg-ground '+(create?'border-t border-hair text-accent font-bold':'')}>{children}</div>;

// ─── Milestones + tasks lists shared by Proposal and Event editors ──
function MilestoneRows({tasks,onChange}) {
  const list=tasks||[];
  const set=(idx,patch)=>{const u=[...list];u[idx]={...u[idx],...patch};onChange(u);};
  const ms=list.filter(t=>t.type);
  return <Sec title="Milestones" action={<AddLink onClick={()=>onChange([...list,{id:uid(),week:"",staff:"",desc:"",type:"deadline",done:false,hours:0,date:""}])}>+ Add milestone</AddLink>}>
    {ms.length===0&&<div className="text-sm text-muted italic py-1">No milestones</div>}
    {ms.map(t=>{const idx=list.indexOf(t);return <Row key={t.id}>
      <Select value={t.type} onChange={e=>set(idx,{type:e.target.value})} className="w-32"><option value="deadline">Deadline</option><option value="hardCheckIn">Hard check-in</option><option value="softCheckIn">Soft check-in</option></Select>
      <Input type="text" value={t.desc} onChange={e=>set(idx,{desc:e.target.value})} placeholder="Description" className="flex-1" />
      <Input type="date" value={t.date||""} onChange={e=>set(idx,{date:e.target.value})} className="w-36" />
      <DelBtn onClick={()=>onChange(list.filter((_,j)=>j!==idx))} />
    </Row>;})}
  </Sec>;
}
function TaskRows({tasks,onChange,emptyText}) {
  const list=tasks||[];
  const set=(idx,patch)=>{const u=[...list];u[idx]={...u[idx],...patch};onChange(u);};
  const ts=list.filter(t=>!t.type);
  const setDate=(idx,dateVal)=>{ if(dateVal){const dt=new Date(dateVal+'T12:00:00');set(idx,{date:dateVal,week:getDayLabel(dt),weekLabel:getWeekLabel(getMonday(dt))});} else set(idx,{date:'',week:'',weekLabel:''}); };
  return <Sec title="Tasks" action={<AddLink onClick={()=>onChange([...list,{id:uid(),week:"",staff:"SD",desc:"",type:null,done:false,hours:0,date:""}])}>+ Add task</AddLink>}>
    {ts.length===0&&<div className="text-sm text-muted italic py-1">{emptyText||"No tasks"}</div>}
    {ts.map(t=>{const idx=list.indexOf(t);return <Row key={t.id}>
      <Input type="date" value={t.date||""} onChange={e=>setDate(idx,e.target.value)} className="w-36" />
      <Select value={t.staff||""} onChange={e=>set(idx,{staff:e.target.value})} className="w-20"><option value="">Who</option>{BD_STAFF.map(x=><option key={x}>{x}</option>)}</Select>
      <Input type="text" value={t.desc} onChange={e=>set(idx,{desc:e.target.value})} placeholder="Task description" className="flex-1" />
      <Input type="number" value={t.hours||""} onChange={e=>set(idx,{hours:parseInt(e.target.value)||0})} placeholder="Hrs" className="w-16 text-right" />
      <DelBtn onClick={()=>onChange(list.filter((_,j)=>j!==idx))} />
    </Row>;})}
  </Sec>;
}
function NeedRows({needs,onChange,withDue}) {
  const list=needs||[];
  const set=(i,patch)=>{const u=[...list];u[i]={...u[i],...patch};onChange(u);};
  return <Sec title="Needs" action={<AddLink onClick={()=>onChange([...list,{id:uid(),desc:"",owner:"",due:"",done:false}])}>+ Add</AddLink>}>
    {list.map((n,i)=><div key={n.id} className="flex gap-2 items-center mb-1.5">
      <input type="checkbox" checked={!!n.done} onChange={e=>set(i,{done:e.target.checked})} className="w-4 h-4" />
      <Input value={n.desc} onChange={e=>set(i,{desc:e.target.value})} placeholder="Need…" className={"flex-1 "+(n.done?"line-through text-done":"")} />
      <Select value={n.owner||""} onChange={e=>set(i,{owner:e.target.value})} className="w-20"><option value="">Who</option>{BD_STAFF.map(x=><option key={x}>{x}</option>)}</Select>
      {withDue&&<Input type="date" value={n.due||""} onChange={e=>set(i,{due:e.target.value})} className="w-36" />}
      <DelBtn onClick={()=>onChange(list.filter((_,j)=>j!==i))} />
    </div>)}
  </Sec>;
}

// ─── Client ──────────────────────────────────────────────────────
export function ClientModal({client,relLog,onSave,onClose,onDelete}) {
  const [d,setD]=useState({...client});
  const [showHist,setShowHist]=useState(false);
  const s=(f,v)=>setD(prev=>({...prev,[f]:v}));
  const hist=relLog.filter(r=>r.clientId===client.id).sort((a,b)=>new Date(b.date)-new Date(a.date));
  return (
    <Modal title={d.name||"New client"} onClose={()=>{onSave(d);onClose();}} wide>
      <Sec title="Identity"><div className="grid grid-cols-2 gap-3">
        <Field label="Name" span><Input value={d.name||""} onChange={e=>s("name",e.target.value)} className="w-full" /></Field>
        <Field label="Sector"><Select value={d.sector||""} onChange={e=>s("sector",e.target.value)} className="w-full"><option value="">—</option>{SECTORS.map(x=><option key={x}>{x}</option>)}</Select></Field>
        <Field label="Office"><Select value={d.office||""} onChange={e=>s("office",e.target.value)} className="w-full">{OFFICES.map(x=><option key={x}>{x}</option>)}</Select></Field>
      </div></Sec>
      <Sec title="Markets" action={<AddLink onClick={()=>s("markets",[...(d.markets||[]),{market:"",submarket:""}])}>+ Add</AddLink>}>
        {(d.markets||[]).map((m,i)=><div key={i} className="flex gap-2 items-center mb-1.5">
          <Select value={m.market} onChange={e=>{const u=[...d.markets];u[i]={market:e.target.value,submarket:""};s("markets",u);}} className="flex-1"><option value="">Market…</option>{Object.keys(MARKET_DATA).map(x=><option key={x}>{x}</option>)}</Select>
          <Select value={m.submarket} onChange={e=>{const u=[...d.markets];u[i]={...m,submarket:e.target.value};s("markets",u);}} className="flex-1"><option value="">Sub…</option>{(MARKET_DATA[m.market]||[]).map(x=><option key={x}>{x}</option>)}</Select>
          <DelBtn onClick={()=>s("markets",d.markets.filter((_,j)=>j!==i))} />
        </div>)}
      </Sec>
      <Sec title="Scoring"><div className="grid grid-cols-2 gap-3">
        <Field label="Partners" span><div className="flex gap-4 flex-wrap">{TOUCHPOINT_PEOPLE.map(p=><label key={p} className="flex items-center gap-1.5 text-sm"><input type="checkbox" checked={(d.partners||[]).includes(p)} onChange={e=>s("partners",e.target.checked?[...(d.partners||[]),p]:(d.partners||[]).filter(x=>x!==p))} className="w-4 h-4" />{p}</label>)}</div></Field>
        <Field label="Tier"><Select value={d.tier||3} onChange={e=>s("tier",parseInt(e.target.value))} className="w-full">{TIERS.map(t=><option key={t} value={t}>Tier {t}</option>)}</Select></Field>
        <Field label={`Relationship (${round1(d.relationshipScore)})`}>
          {d.relationshipOverride!==null?<div className="flex gap-2 items-center"><Input type="number" min="1" max="10" step="0.5" value={d.relationshipOverride} onChange={e=>s("relationshipOverride",clamp(parseFloat(e.target.value)||1,1,10))} className="w-20" /><Pill color="blue">Override</Pill><Danger onClick={()=>s("relationshipOverride",null)}>Clear</Danger></div>:<Link onClick={()=>s("relationshipOverride",d.relationshipScore)} className="text-xs">Override</Link>}
        </Field>
        <Field label="Touch baseline"><Input type="number" min="1" max="10" value={d.touchpointValue||""} onChange={e=>s("touchpointValue",clamp(parseInt(e.target.value)||1,1,10))} className="w-full" /></Field>
        <div className="flex items-end"><label className="flex items-center gap-1.5 text-sm"><input type="checkbox" checked={d.strategic||false} onChange={e=>s("strategic",e.target.checked)} className="w-4 h-4" /><b>Strategic</b></label></div>
      </div></Sec>
      {hist.length>0&&<Sec title="Relationship history" action={<Quiet onClick={()=>setShowHist(!showHist)}>{showHist?"Hide":"Show"} ({hist.length})</Quiet>}>{showHist&&hist.map((r,i)=><div key={i} className="flex gap-2 text-xs py-0.5"><span className="text-muted w-12">{fmtDate(r.date)}</span><span className="font-bold">{round1(r.oldScore)} → {round1(r.newScore)}</span><span className="text-muted">{r.reason}</span></div>)}</Sec>}
      <Sec title="Contacts" action={<AddLink onClick={()=>s("contacts",[...(d.contacts||[]),{id:uid(),name:"",title:"",email:"",phone:""}])}>+ Add</AddLink>}>
        {(d.contacts||[]).map((c,i)=><div key={c.id} className="border border-hair rounded-[3px] p-2 mb-1.5"><div className="flex gap-2 mb-1.5"><Input value={c.name} onChange={e=>{const u=[...d.contacts];u[i]={...c,name:e.target.value};s("contacts",u);}} placeholder="Name" className="flex-1" /><Input value={c.title||""} onChange={e=>{const u=[...d.contacts];u[i]={...c,title:e.target.value};s("contacts",u);}} placeholder="Title" className="flex-1" /><DelBtn onClick={()=>s("contacts",d.contacts.filter((_,j)=>j!==i))} /></div><div className="flex gap-2"><Input value={c.email||""} onChange={e=>{const u=[...d.contacts];u[i]={...c,email:e.target.value};s("contacts",u);}} placeholder="Email" className="flex-1" /><Input value={c.phone||""} onChange={e=>{const u=[...d.contacts];u[i]={...c,phone:e.target.value};s("contacts",u);}} placeholder="Phone" className="flex-1" /></div></div>)}
      </Sec>
      <Sec title="Notes"><Textarea value={d.notes||""} onChange={e=>s("notes",e.target.value)} rows={3} className="w-full" /></Sec>
      <div className="pt-3 border-t border-hair flex justify-between items-center"><Danger onClick={()=>{if(confirm("Delete this client?")){onDelete(d.id);onClose();}}}>Delete client</Danger></div>
    </Modal>
  );
}

// ─── Quick-add lead ──────────────────────────────────────────────
export function QuickLeadModal({clients,onSave,onClose,defaultPartner}) {
  const [search,setSearch]=useState("");
  const [clientId,setClientId]=useState("");
  const [pending,setPending]=useState(null); // brand-new minimal client, saved only when the lead is saved
  const [newClients,setNewClients]=useState([]); // brand-new team clients typed under "Other clients"
  const [d,setD]=useState({title:"",type:"Proposal",partner:TOUCHPOINT_PEOPLE.includes(defaultPartner)?defaultPartner:"RJ",office:"Nashville",steps:[blankStep()],contactIds:[],newContact:"",otherClientIds:[]});
  const s=(f,v)=>setD(prev=>({...prev,[f]:v}));
  const client=pending||clients.find(c=>c.id===clientId)||null;
  const matches=clients.filter(c=>search&&c.name.toLowerCase().includes(search.toLowerCase())).sort((a,b)=>a.name.localeCompare(b.name)).slice(0,8);
  const exact=clients.some(c=>c.name.trim().toLowerCase()===search.trim().toLowerCase());
  const pick=c=>{setClientId(c.id);setPending(null);setSearch("");setD(prev=>({...prev,contactIds:[],office:OFFICES.includes(c.office)?c.office:prev.office}));};
  const create=()=>{const name=search.trim();if(!name)return;const nc=newClient({name,office:d.office,partners:[d.partner]});setPending(nc);setClientId(nc.id);setSearch("");setD(prev=>({...prev,contactIds:[]}));};
  const toggle=c=>setD(prev=>({...prev,contactIds:prev.contactIds.includes(cid(c))?prev.contactIds.filter(x=>x!==cid(c)):[...prev.contactIds,cid(c)]}));
  const createOther=name=>{const nc=newClient({name,office:d.office,partners:[d.partner]});setNewClients(p=>[...p,nc]);return nc;};
  const valid=!!client&&d.title.trim().length>0;
  const save=()=>{
    if(!valid) return false;
    let cl=client,changed=!!pending,ids=[...d.contactIds];
    if(d.newContact.trim()){const ct={id:uid(),name:d.newContact.trim(),title:"",email:"",phone:""};cl={...cl,contacts:[...(cl.contacts||[]),ct]};ids.push(ct.id);changed=true;}
    const today=localDateKey(new Date());
    let lead={id:uid(),clientId:cl.id,projectName:d.title.trim(),fee:0,probability:"M",status:"Lead",partner:d.partner,pm:"",proposalType:d.type,office:d.office,sector:cl.sector||"",market:"",submarket:"",dueDate:"",submittedDate:"",awardedDate:"",kickoffDone:false,notes:"",needs:[],tasks:[],reviewPartners:[],reviewNotes:"",leadSince:today,deadReason:"",sourceTouchpointId:"",contactIds:ids,otherClientIds:d.otherClientIds};
    lead=withSteps(lead,d.steps.filter(x=>(x.text||"").trim()||x.date).map(x=>({...x,text:x.text.trim(),done:false})));
    onSave({client:changed?cl:null,lead,extraClients:newClients.filter(n=>d.otherClientIds.includes(n.id))});
    return true;
  };
  return (
    <Modal title="Quick-add lead" onClose={()=>{if(valid)save();onClose();}}>
      <Field label="Client">
        {client?<Picked name={client.name} tag={pending?"new client":null} onClear={()=>{setClientId("");setPending(null);}} />:<>
          <Input type="text" value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search clients, or type a new organization…" className="w-full mb-1" />
          {search&&<div className="border border-rule rounded-[3px] max-h-[160px] overflow-y-auto">
            {matches.map(c=><Hit key={c.id} onClick={()=>pick(c)}>{c.name}</Hit>)}
            {!exact&&<div data-testid="create-client"><Hit onClick={create} create>+ Create “{search.trim()}” as a new client</Hit></div>}
          </div>}
        </>}
      </Field>
      <Field label="Lead"><Input type="text" value={d.title} onChange={e=>s("title",e.target.value)} placeholder="e.g. Greenway Phase 2" className="w-full" /></Field>
      <div className="grid grid-cols-3 gap-3">
        <Field label="Type"><Select value={d.type} onChange={e=>s("type",e.target.value)} className="w-full">{PROPOSAL_TYPES.map(t=><option key={t}>{t}</option>)}</Select></Field>
        <Field label="Partner"><Select value={d.partner} onChange={e=>s("partner",e.target.value)} className="w-full">{TOUCHPOINT_PEOPLE.map(p=><option key={p}>{p}</option>)}</Select></Field>
        <Field label="Office"><Select value={d.office} onChange={e=>s("office",e.target.value)} className="w-full">{OFFICES.map(o=><option key={o}>{o}</option>)}</Select></Field>
      </div>
      {client&&<Field label="Other clients on this lead (teams)"><OtherClients clients={[...clients,...newClients]} primaryId={client.id} value={d.otherClientIds} onChange={v=>s("otherClientIds",v)} onCreate={createOther} /></Field>}
      {client&&<Field label="Contacts"><ContactGroups clients={[client,...clients,...newClients]} ids={[client.id,...d.otherClientIds]} selected={d.contactIds} onToggle={toggle} /><Input type="text" value={d.newContact} onChange={e=>s("newContact",e.target.value)} placeholder="Or add a new contact (name)" className="w-full mt-1.5" /></Field>}
      <Field label="Next steps"><NextStepsEditor steps={d.steps} onChange={v=>s("steps",v)} defaultAssignee={d.partner} /></Field>
      <div className="pt-3 border-t border-hair flex justify-between items-center"><Quiet onClick={onClose}>Cancel</Quiet><span data-testid="add-lead"><Button disabled={!valid} onClick={()=>{if(save())onClose();}}>Add lead</Button></span></div>
    </Modal>
  );
}

// ─── Cell editor (milestones + tasks for one day/week in the grid) ──
export function ProposalCellEditor({proposal,weekKey,weekLabel,onClose,onSave}) {
  const isDaily = /^(Mon|Tue|Wed|Thu|Fri)/.test(weekLabel);
  const matchFn = isDaily ? dateIsDay : dateInWeek;
  const [milestones, setMilestones] = useState((proposal.tasks||[]).filter(t=>t.type&&t.date&&matchFn(t.date,weekKey)));
  const [localTasks, setLocalTasks] = useState((proposal.tasks||[]).filter(t=>!t.type&&t.week===weekLabel));
  const handleSave=()=>{
    const otherMilestones=(proposal.tasks||[]).filter(t=>t.type&&(!t.date||!matchFn(t.date,weekKey)));
    const otherTasks=(proposal.tasks||[]).filter(t=>!t.type&&t.week!==weekLabel);
    onSave({...proposal,tasks:[...otherMilestones,...milestones.filter(m=>m.desc),...otherTasks,...localTasks.filter(t=>t.desc)]});
    onClose();
  };
  const addMilestone=()=>{
    const defaultDate = isDaily ? weekKey : (() => { const d=new Date(weekKey);d.setDate(d.getDate()+4);return d.toISOString().split("T")[0]; })();
    setMilestones([...milestones,{id:uid(),type:"deadline",date:defaultDate,desc:"",done:false,hours:0}]);
  };
  return (
    <Modal title={proposal.projectName||proposal.name||"Edit"} onClose={handleSave}>
      <div className="text-sm text-muted -mt-2">{isDaily ? weekLabel : `Week of ${weekLabel}`}</div>
      <Sec title="Milestones" action={<AddLink onClick={addMilestone}>+ Add milestone</AddLink>}>
        {milestones.length===0&&<div className="text-sm text-muted italic py-1">{isDaily ? 'No milestones this day' : 'No milestones this week'}</div>}
        {milestones.map((m,i)=><Row key={m.id}>
          <Select value={m.type} onChange={e=>{const u=[...milestones];u[i]={...m,type:e.target.value};setMilestones(u);}} className="w-32"><option value="deadline">Deadline</option><option value="hardCheckIn">Hard check-in</option><option value="softCheckIn">Soft check-in</option></Select>
          <Input type="date" value={m.date||""} onChange={e=>{const u=[...milestones];u[i]={...m,date:e.target.value};setMilestones(u);}} className="w-36" />
          <Input type="text" value={m.desc} onChange={e=>{const u=[...milestones];u[i]={...m,desc:e.target.value};setMilestones(u);}} placeholder="Description" className="flex-1" autoFocus={!m.desc} />
          <DelBtn onClick={()=>setMilestones(milestones.filter((_,j)=>j!==i))} />
        </Row>)}
      </Sec>
      <Sec title="Tasks" action={<AddLink onClick={()=>setLocalTasks([...localTasks,{id:uid(),week:weekLabel,staff:"SD",desc:"",type:null,done:false,hours:0}])}>+ Add task</AddLink>}>
        {localTasks.length===0&&<div className="text-sm text-muted italic py-1">No tasks this week</div>}
        {localTasks.map((t,i)=><Row key={t.id}>
          <Select value={t.staff||""} onChange={e=>{const u=[...localTasks];u[i]={...t,staff:e.target.value};setLocalTasks(u);}} className="w-20"><option value="">Who</option>{BD_STAFF.map(x=><option key={x}>{x}</option>)}</Select>
          <Input type="text" value={t.desc} onChange={e=>{const u=[...localTasks];u[i]={...t,desc:e.target.value};setLocalTasks(u);}} placeholder="Task description" className="flex-1" autoFocus={!t.desc} />
          <Input type="number" value={t.hours||""} onChange={e=>{const u=[...localTasks];u[i]={...t,hours:parseInt(e.target.value)||0};setLocalTasks(u);}} placeholder="Hrs" className="w-16 text-right" />
          <DelBtn onClick={()=>setLocalTasks(localTasks.filter((_,j)=>j!==i))} />
        </Row>)}
      </Sec>
    </Modal>
  );
}

// ─── Proposal / lead editor ──────────────────────────────────────
// focusSection="steps" scrolls the next-steps block into view on open (Pipeline "+ Next step").
export function ProposalSettings({clients,proposal,onSave,onClose,onDelete,focusSection,defaultPartner}) {
  const [d,setD]=useState(proposal?{...proposal,status:normStatus(proposal.status),contactIds:proposal.contactIds||[],otherClientIds:proposal.otherClientIds||[],nextSteps:stepsOf(proposal)}:{id:uid(),clientId:"",projectName:"",fee:0,probability:"M",status:"Pursuing",partner:TOUCHPOINT_PEOPLE.includes(defaultPartner)?defaultPartner:"RJ",pm:"",proposalType:"Proposal",office:"Nashville",sector:"",market:"",submarket:"",dueDate:"",submittedDate:"",awardedDate:"",kickoffDone:false,notes:"",needs:[],tasks:[],reviewPartners:[],nextStep:"",nextStepDate:"",nextSteps:[],leadSince:"",deadReason:"",sourceTouchpointId:"",contactIds:[],otherClientIds:[]});
  const [clientSearch,setClientSearch]=useState("");
  const stepsRef=useRef(null);
  useEffect(()=>{ if(focusSection==="steps"&&stepsRef.current) stepsRef.current.scrollIntoView({block:"center"}); },[focusSection]);
  const s=(f,v)=>setD(prev=>({...prev,[f]:v}));
  const selectedClient = clients.find(c=>c.id===d.clientId);
  const filteredClients = clients.filter(c=>!clientSearch||c.name.toLowerCase().includes(clientSearch.toLowerCase())).sort((a,b)=>a.name.localeCompare(b.name));
  // Auto-stamp dates on status change
  const handleStatusChange = (newStatus) => {
    const today = new Date().toISOString().split('T')[0];
    const updates = { status: newStatus };
    if (newStatus === 'Submitted' && !d.submittedDate) updates.submittedDate = today;
    if (newStatus === 'Awarded' && !d.awardedDate) updates.awardedDate = today;
    if (isLeadStatus(newStatus) && !d.leadSince) updates.leadSince = today;
    setD(prev=>({ ...prev, ...updates }));
  };
  const daysToAward = d.submittedDate && d.awardedDate ? Math.floor((new Date(d.awardedDate) - new Date(d.submittedDate)) / 864e5) : null;
  const isLeadish = isLeadStatus(d.status)||d.status==="Dead";
  return (
    <Modal title={proposal?(d.projectName||"Proposal"):"New proposal"} onClose={()=>{onSave(withSteps(d,d.nextSteps||[]));onClose();}} wide>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Client" span>
          <Input type="text" value={clientSearch} onChange={e=>{setClientSearch(e.target.value);if(!e.target.value&&!d.clientId)s("clientId","");}} placeholder={selectedClient?selectedClient.name:"Search clients…"} className="w-full mb-1" />
          {selectedClient&&!clientSearch?<Picked name={selectedClient.name} onClear={()=>{s("clientId","");setClientSearch("");}} />:
          clientSearch?<div className="max-h-[120px] overflow-y-auto border border-rule rounded-[3px]">{filteredClients.slice(0,15).map(c=><Hit key={c.id} onClick={()=>{s("clientId",c.id);setClientSearch("");}}>{c.name}</Hit>)}</div>:null}
        </Field>
        <Field label={`Other clients on this ${isLeadish?"lead":"proposal"} (teams)`} span><OtherClients clients={clients} primaryId={d.clientId} value={d.otherClientIds} onChange={v=>s("otherClientIds",v)} /></Field>
        <Field label="Project name" span><Input value={d.projectName} onChange={e=>s("projectName",e.target.value)} className="w-full" /></Field>
        <Field label="Type"><Select value={d.proposalType||"Proposal"} onChange={e=>s("proposalType",e.target.value)} className="w-full">{PROPOSAL_TYPES.map(t=><option key={t}>{t}</option>)}</Select></Field>
        <Field label="Fee"><Input type="number" value={d.fee||""} onChange={e=>s("fee",parseInt(e.target.value)||0)} className="w-full" /></Field>
        <Field label="Office"><Select value={d.office||""} onChange={e=>s("office",e.target.value)} className="w-full"><option value="">Select…</option>{PROP_OFFICES.map(o=><option key={o}>{o}</option>)}</Select></Field>
        <Field label="Sector"><Select value={d.sector||""} onChange={e=>s("sector",e.target.value)} className="w-full"><option value="">Select…</option>{PROP_SECTORS.map(x=><option key={x}>{x}</option>)}</Select></Field>
        <Field label="Market"><Select value={d.market||""} onChange={e=>s("market",e.target.value)} className="w-full"><option value="">Select…</option>{PROP_MARKETS.map(x=><option key={x}>{x}</option>)}</Select></Field>
        <Field label="Submarket"><Select value={d.submarket||""} onChange={e=>s("submarket",e.target.value)} className="w-full"><option value="">Select…</option>{PROP_SUBMARKETS.map(x=><option key={x}>{x}</option>)}</Select></Field>
        <Field label="Probability"><Select value={d.probability} onChange={e=>s("probability",e.target.value)} className="w-full">{PROBS.map(p=><option key={p}>{p}</option>)}</Select></Field>
        <Field label="Status"><Select value={d.status} onChange={e=>handleStatusChange(e.target.value)} className="w-full">{"Lead,Pursuing,Submitted,Awarded,Not Awarded,Declined,Dead".split(",").map(x=><option key={x}>{x}</option>)}</Select></Field>
        <Field label="Partner"><Select value={d.partner} onChange={e=>s("partner",e.target.value)} className="w-full">{TOUCHPOINT_PEOPLE.map(p=><option key={p}>{p}</option>)}</Select></Field>
        <Field label="PM"><Input value={d.pm||""} onChange={e=>s("pm",e.target.value)} className="w-full" placeholder="Initials" /></Field>
        <Field label="Due"><Input type="date" value={d.dueDate||""} onChange={e=>s("dueDate",e.target.value)} className="w-full" /></Field>
        <Field label="Submitted"><Input type="date" value={d.submittedDate||""} onChange={e=>{const v=e.target.value;const updates={submittedDate:v};if(v&&isLinkable(d.status)) updates.status='Submitted';setD(prev=>({...prev,...updates}));}} className="w-full" /></Field>
        <Field label="Awarded"><Input type="date" value={d.awardedDate||""} onChange={e=>{const v=e.target.value;const updates={awardedDate:v};if(v&&d.status!=='Awarded'&&d.status!=='Not Awarded'&&d.status!=='Declined'&&d.status!=='Dead') updates.status='Awarded';setD(prev=>({...prev,...updates}));}} className="w-full" /></Field>
      </div>
      {!["Awarded","Not Awarded","Declined"].includes(d.status)&&<div ref={stepsRef}><Sec title={isLeadish?"Lead follow-up":"Next steps"}>
        <div data-section="proposal-steps"><Label>Next steps (tick when done · each shows on the assignee&apos;s Personal Planner)</Label><NextStepsEditor steps={d.nextSteps||[]} onChange={v=>s("nextSteps",v)} defaultAssignee={d.partner} /></div>
        {isLeadish&&selectedClient&&<div className="mt-2"><Label>Contacts on this lead</Label><ContactGroups clients={clients} ids={leadClientIds(d)} selected={d.contactIds} onToggle={c=>s("contactIds",(d.contactIds||[]).includes(cid(c))?(d.contactIds||[]).filter(x=>x!==cid(c)):[...(d.contactIds||[]),cid(c)])} /></div>}
        {d.status==='Dead'&&<div className="mt-2"><Label>Why did it go dead?</Label><Input value={d.deadReason||""} onChange={e=>s("deadReason",e.target.value)} placeholder="Optional" className="w-full" /></div>}
      </Sec></div>}
      {daysToAward !== null && <div className="text-sm text-muted border border-hair rounded-[3px] px-3 py-2">Submitted → Awarded in <b className="text-ink">{daysToAward} days</b></div>}
      {d.status==='Awarded'&&!d.kickoffDone&&<div className="text-sm border border-status-amber text-status-amber rounded-[3px] px-3 py-2 flex items-center gap-3"><span className="font-bold">Kickoff needed</span><Link onClick={()=>s("kickoffDone",true)} className="text-xs">Mark done</Link></div>}
      {d.status==='Awarded'&&d.kickoffDone&&<div className="text-sm text-muted border border-hair rounded-[3px] px-3 py-2">Kickoff complete</div>}
      <Sec title="Partner review">
        <div className="flex gap-4 mb-2 flex-wrap">{TOUCHPOINT_PEOPLE.map(p=><label key={p} className="flex items-center gap-1.5 text-sm"><input type="checkbox" checked={(d.reviewPartners||[]).includes(p)} onChange={e=>s("reviewPartners",e.target.checked?[...(d.reviewPartners||[]),p]:(d.reviewPartners||[]).filter(x=>x!==p))} className="w-4 h-4" />{p}</label>)}</div>
        {(d.reviewPartners||[]).length>0&&<div><Label>What do they need to review?</Label><Textarea value={d.reviewNotes||""} onChange={e=>s("reviewNotes",e.target.value)} rows={2} className="w-full" placeholder="Describe what partners need to look at…" /></div>}
        <Hint>Flagged partners see this in their planner</Hint>
      </Sec>
      <MilestoneRows tasks={d.tasks} onChange={v=>s("tasks",v)} />
      <TaskRows tasks={d.tasks} onChange={v=>s("tasks",v)} emptyText="No tasks — add from the calendar grid or here" />
      <NeedRows needs={d.needs} onChange={v=>s("needs",v)} withDue />
      <Field label="Notes"><Textarea value={d.notes||""} onChange={e=>s("notes",e.target.value)} rows={2} className="w-full" /></Field>
      {proposal&&<div className="pt-3 border-t border-hair"><Danger onClick={()=>{if(confirm("Delete?")){onDelete(d.id);onClose();}}}>Delete</Danger></div>}
    </Modal>
  );
}

// ─── Event ───────────────────────────────────────────────────────
export const EVENT_STAFF = ["RJ","CB","MB","TJ","HD","MM","AB","RW","CM","EP","SD","SI","Mac","TS","YR","WB","CH","RC","Map","EC","JY","TU","ME","SA","JD","SH","AM","AR","JK","GA","JF","KR","Aim"];
export function EventModal({event,onSave,onClose,onDelete}) {
  const [d,setD]=useState(event||{id:uid(),name:"",type:"Conference",date:"",endDate:"",location:"",attendees:[],needs:[],tasks:[]});
  const s=(f,v)=>setD(prev=>({...prev,[f]:v}));
  return (
    <Modal title={d.name||"New event"} onClose={()=>{onSave(d);onClose();}} wide>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Name" span><Input value={d.name} onChange={e=>s("name",e.target.value)} className="w-full" /></Field>
        <Field label="Type"><Select value={d.type} onChange={e=>s("type",e.target.value)} className="w-full">{EVT_TYPES.map(t=><option key={t}>{t}</option>)}</Select></Field>
        <Field label="Location" span><Input value={d.location||""} onChange={e=>s("location",e.target.value)} className="w-full" /></Field>
        <Field label="Start date"><Input type="date" value={d.date} onChange={e=>s("date",e.target.value)} className="w-full" /></Field>
        <Field label="End date"><Input type="date" value={d.endDate||""} onChange={e=>s("endDate",e.target.value)} className="w-full" /><Hint>Leave blank for single-day</Hint></Field>
      </div>
      <Sec title="Attendees"><div className="flex flex-wrap gap-2">{EVENT_STAFF.map(p=><label key={p} className="flex items-center gap-1 text-xs"><input type="checkbox" checked={(d.attendees||[]).includes(p)} onChange={e=>s("attendees",e.target.checked?[...(d.attendees||[]),p]:(d.attendees||[]).filter(x=>x!==p))} className="w-3.5 h-3.5" />{p}</label>)}</div></Sec>
      <MilestoneRows tasks={d.tasks} onChange={v=>s("tasks",v)} />
      <TaskRows tasks={d.tasks} onChange={v=>s("tasks",v)} />
      <NeedRows needs={d.needs} onChange={v=>s("needs",v)} />
      {event&&<div className="pt-3 border-t border-hair"><Danger onClick={()=>{if(confirm("Delete?")){onDelete(d.id);onClose();}}}>Delete</Danger></div>}
    </Modal>
  );
}

// ─── IDIQ ────────────────────────────────────────────────────────
export function IDIQModal({clients,idiq,onSave,onClose,onDelete}) {
  const [d,setD]=useState(idiq||{id:uid(),clientId:"",dateAwarded:"",dateExpired:"",contacts:[],notes:""});
  const s=(f,v)=>setD(prev=>({...prev,[f]:v}));
  const isEdit=!!idiq;
  const sortedClients=[...clients].sort((a,b)=>a.name.localeCompare(b.name));
  const addContact=()=>{ if((d.contacts||[]).length<3) s("contacts",[...(d.contacts||[]),{id:uid(),name:"",position:""}]); };
  return (
    <Modal title={isEdit?"Edit IDIQ":"New IDIQ"} onClose={()=>{if(d.clientId)onSave(d);onClose();}}>
      <Sec title="Agency">
        <Select value={d.clientId} onChange={e=>s("clientId",e.target.value)} className="w-full"><option value="">Select agency (client)…</option>{sortedClients.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</Select>
        <Hint>The agency must exist as a client. Projects and touchpoints roll up automatically by this link.</Hint>
      </Sec>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Date awarded"><Input type="date" value={d.dateAwarded||""} onChange={e=>s("dateAwarded",e.target.value)} className="w-full" /></Field>
        <Field label="Date expired"><Input type="date" value={d.dateExpired||""} onChange={e=>s("dateExpired",e.target.value)} className="w-full" /></Field>
      </div>
      <Sec title="Key contacts (max 3)" action={(d.contacts||[]).length<3?<AddLink onClick={addContact}>+ Add</AddLink>:null}>
        {(d.contacts||[]).length===0&&<div className="text-sm text-muted italic py-1">No contacts yet</div>}
        {(d.contacts||[]).map((c,i)=><div key={c.id} className="flex gap-2 items-center mb-1.5">
          <Input value={c.name} onChange={e=>{const u=[...d.contacts];u[i]={...c,name:e.target.value};s("contacts",u);}} placeholder="Name" className="flex-1" />
          <Input value={c.position||""} onChange={e=>{const u=[...d.contacts];u[i]={...c,position:e.target.value};s("contacts",u);}} placeholder="Position" className="flex-1" />
          <DelBtn onClick={()=>s("contacts",d.contacts.filter((_,j)=>j!==i))} />
        </div>)}
      </Sec>
      <Sec title="Notes"><Textarea value={d.notes||""} onChange={e=>s("notes",e.target.value)} rows={2} className="w-full" /></Sec>
      {isEdit&&onDelete&&<div className="pt-3 border-t border-hair"><Danger onClick={()=>{if(confirm("Delete this IDIQ?")){onDelete(d.id);onClose();}}}>Delete IDIQ</Danger></div>}
    </Modal>
  );
}
