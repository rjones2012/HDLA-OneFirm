'use client';
// Pure data helpers for the Marketing module: constants, health engine, pipeline math, BD report
// math, calendar/week helpers, IDIQ roll-up and the row-flag logic the Today and Pipeline tabs share.
// No React in here. Business rules are unchanged from the old page; only the file moved.
import { PARTNERS, PRINCIPALS, CLOSED_STATUSES, isLeadStatus, leadClientIds, normStatus, daysBetween, localDateKey, todayKey, uid, openSteps, leadFlags, QUIET_DAYS } from '../marketing-shared';

export const TIERS = [1,2,3,4,5];
export const SECTORS = ["Public","Private"];
export const MARKET_DATA = {
  Parks:["Municipal","Memorial","Recreation","Plaza","National","Planning"],
  Civic:["Planning","Building"],Infrastructure:["Utilities","Streetscape","Stormwater"],
  State:["Park","Building"],Institutional:["Non-profit","Museum","Federal","Church"],
  Campus:["Pre-K","K-12","Higher Education"],Multifamily:["Podium","Adaptive Reuse","Tower","Non-podium"],
  "Mixed-Use":["Podium","Adaptive Reuse","Tower","Non-podium","Non-tower","Planning"],
  Garden:["Garden"],Community:["Neighborhood","Single Family"],Commercial:["Hospitality","Office","Retail"],
};
export const PROBS = ["H","M","L","XL"];
export const WEIGHTS = {H:.80,M:.50,L:.20,XL:0};
export const EVT_TYPES = ["Conference","Award Ceremony","Groundbreaking","Speaking","Industry Event","Internal"];
export const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
export const PROPOSAL_TYPES = ["RFP","RFQ","Proposal"];
export const PROP_OFFICES = ["Nashville","Dallas","Raleigh"];
export const PROP_SECTORS = ["Public","Private"];
export const PROP_MARKETS = ["Campus","Commercial","Community","Infrastructure","Mixed-Use","Multifamily","Parks"];
export const PROP_SUBMARKETS = ["Amenity","Building","Higher Education","Hospitality","Industrial","K-12","Multifamily Non-Podium","Neighborhood","Office","Planning","Pre-K","Recreation","Retail","Single Family","Trail"];
export const BD_STAFF = ["CM","EP","SD","RJ","CB","MB","TJ","HD"];
export const REPORT_PEOPLE = [...PARTNERS, ...PRINCIPALS]; // rows in the monthly BD report (partners + principals)
export const STAGES = ["Lead","Pursuing","Submitted","Awarded","Closed","IDIQ"];
export const IDIQ_STALE_DAYS = 60; // contact goes "stale" after this many days with no completed touchpoint
export const AGING_DAYS = 60;      // a Submitted proposal is "aging" after this many days
export const DUE_SOON_DAYS = 14;

export const fmt$ = n => "$"+Math.round(n||0).toLocaleString();
export const fmtK = n => { const v=Math.round(n||0); return v>=1000000?"$"+(v/1000000).toFixed(1)+"M":v>=1000?"$"+Math.round(v/1000)+"K":"$"+v; };
export const fmtShort = s => { if(!s) return ""; const p=s.split("-"); return `${parseInt(p[1])}/${parseInt(p[2])}`; };
export const clamp = (v,lo,hi) => Math.max(lo,Math.min(hi,v));
export const round1 = n => Math.round(n*10)/10;
export const words = n => ["no","one","two","three"][n] || String(n);

// ─── Months / quarters ───────────────────────────────────────────
export const monthKey = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
export const inMonth = (dateStr, mKey) => !!dateStr && dateStr.slice(0,7)===mKey;
export const monthLabel = mKey => { const [y,m]=mKey.split("-").map(Number); return new Date(y,m-1,1).toLocaleDateString("en-US",{month:"long",year:"numeric"}); };
export const shiftMonth = (mKey, delta) => { const [y,m]=mKey.split("-").map(Number); return monthKey(new Date(y,m-1+delta,1)); };
export const quarterRange = (d=new Date()) => { const q=Math.floor(d.getMonth()/3)*3; const start=new Date(d.getFullYear(),q,1); const next=new Date(d.getFullYear(),q+3,1); return {start:localDateKey(start),next:localDateKey(next),label:`Q${q/3+1} ${d.getFullYear()}`}; };
export const inRange = (dateStr, r) => !!dateStr && dateStr>=r.start && dateStr<r.next;
export const addDays = (key, n) => { const [y,m,d]=key.split("-").map(Number); const x=new Date(y,m-1,d); x.setDate(x.getDate()+n); return localDateKey(x); };
export const monthYear = s => { if(!s) return ""; const [y,m]=s.split("-").map(Number); return `${MONTHS[m-1]} ${y}`; };
export const monthsUntil = s => { if(!s) return null; const [y,m]=s.split("-").map(Number); const now=new Date(); return (y-now.getFullYear())*12+(m-1-now.getMonth()); };

// ─── Monthly BD report ───────────────────────────────────────────
// BD activity only — touchpoints + proposal activity. No dollars, no awarded (shared contacts).
// Leads generated: a lead is credited to the person whose touchpoint produced it (sourceTouchpointId),
// falling back to the lead's partner when it was added by hand; counted in the month it became a lead.
export const leadMonth = p => (p.leadSince||(p.createdAt||"").slice(0,10)||"");
export function leadsGenerated(mKey, touchpoints, proposals) {
  return proposals.filter(p=>inMonth(leadMonth(p),mKey)).map(p=>{
    const tp=p.sourceTouchpointId?touchpoints.find(t=>t.id===p.sourceTouchpointId):null;
    return { lead:p, touchpoint:tp||null, person:(tp&&tp.partner)||p.partner||"" };
  });
}
export function computePersonReport(person, mKey, touchpoints, proposals) {
  const tps = touchpoints.filter(t=>t.partner===person && t.status==="completed" && inMonth(t.date,mKey)).length;
  const led = proposals.filter(p=>p.partner===person);
  const submitted = led.filter(p=>inMonth(p.submittedDate,mKey)).length;
  const open = led.filter(p=>!CLOSED_STATUSES.includes(p.status)&&!isLeadStatus(p.status)).length;
  const leads = leadsGenerated(mKey, touchpoints, proposals).filter(x=>x.person===person).length;
  return { touchpoints: tps, leads, submitted, open };
}

// ─── Health engine (unchanged) ───────────────────────────────────
export function computeHealth(client, touchpoints, proposals, activeWork) {
  const completed = touchpoints.filter(t=>t.clientId===client.id&&t.status==="completed").sort((a,b)=>new Date(b.date)-new Date(a.date));
  const lastDate = completed[0]?.date;
  const hasLoggedActivity = completed.length > 0;
  const dSince = lastDate ? daysBetween(lastDate) : 999;
  const planned = touchpoints.filter(t=>t.clientId===client.id&&t.status==="planned");
  const work = activeWork[client.id]||{projects:0,fee:0};
  const openProps = proposals.filter(p=>p.clientId===client.id&&!CLOSED_STATUSES.includes(p.status));
  const submittedProps = openProps.filter(p=>p.status==="Submitted");
  const pipeFee = submittedProps.reduce((s,p)=>s+(p.fee||0),0);
  const relScore = client.relationshipOverride!==null ? client.relationshipOverride : client.relationshipScore;
  const touchBase = client.touchpointValue||5;

  let h;
  if (!hasLoggedActivity) {
    // BASELINE MODE: spreadsheet scores are truth
    const avg = (relScore + touchBase) / 2;
    if (avg >= 7) h = 80; else if (avg >= 5) h = 55; else h = 30;
    h += client.tier<=2 ? 5 : 0;
    h += work.projects>0 ? 5 : 0;
    if (client.strategic && avg < 5) h -= 10;
  } else {
    // ALGORITHM MODE: recency clock is running
    h=50;
    h += client.tier<=2?10:0;
    h += relScore>=7?10:relScore>=5?5:-5;
    h += dSince<=30?15:dSince<=60?5:dSince<=90?-5:-15;
    h += work.projects>0?10:0;
    h += planned.length>0?5:0;
    if(client.tier<=2&&dSince>90) h-=15;
    if(work.fee>50000&&dSince>90) h-=10;
    if(client.strategic&&dSince>180) h-=10;
  }
  h = clamp(h,0,100);

  const recencyBar = !hasLoggedActivity ? (touchBase>=7?4:touchBase>=5?3:touchBase>=3?2:1) : (dSince<=30?4:dSince<=60?3:dSince<=120?2:dSince<=180?1:0);
  const pipeBar = submittedProps.some(p=>p.probability==="H")?3:pipeFee>100000?2:pipeFee>0?1:0;
  let touchPriority=0;
  if(client.tier<=2) touchPriority+=3; if(client.strategic) touchPriority+=2;
  if(work.fee>100000) touchPriority+=2; if(openProps.length>0) touchPriority+=2;
  if(hasLoggedActivity && dSince>90) touchPriority+=3;
  if(hasLoggedActivity && dSince>180) touchPriority+=2;
  if(!hasLoggedActivity && touchBase<=4) touchPriority+=3;
  if(planned.length>0) touchPriority-=3;
  return {health:h,recencyBar,pipeBar,dSince:hasLoggedActivity?dSince:null,lastDate,planned,work,openProps,pipeFee,relScore,touchPriority,hasLoggedActivity};
}

export function calcPipeline(proposals) {
  const open = proposals.filter(p=>p.status==="Submitted"); // only submitted proposals count toward pipeline
  const buckets = {}; PROBS.forEach(p=>{buckets[p]={raw:0,weighted:0,count:0};});
  open.forEach(p=>{const b=buckets[p.probability]||buckets.M;b.raw+=p.fee||0;b.weighted+=(p.fee||0)*(WEIGHTS[p.probability]||0);b.count++;});
  return {buckets,totalRaw:open.reduce((s,p)=>s+(p.fee||0),0),totalWeighted:Object.values(buckets).reduce((s,b)=>s+b.weighted,0)};
}

export function computeTouchTrend(client, touchpoints) {
  const completed = touchpoints.filter(t => t.clientId === client.id && t.status === "completed" && t.rating);
  const baseline = client.touchpointValue || 5;
  if (completed.length === 0) return { score: baseline, trend: "flat", label: String(baseline) };
  const allLegacy = completed.every(t => (t.rating || 5) <= 5);
  const avg = completed.reduce((s, t) => { let r = t.rating || 5; if (allLegacy) r = r * 2; return s + r; }, 0) / completed.length;
  const score = Math.round(avg * 10) / 10;
  const trend = score > baseline + 0.5 ? "up" : score < baseline - 0.5 ? "down" : "flat";
  return { score, trend, label: score.toFixed(1) };
}

// ─── Weeks / days for the calendar grid ──────────────────────────
export function getMonday(date) { const d=new Date(date); const day=d.getDay(); d.setDate(d.getDate()-day+(day===0?-6:1)); d.setHours(0,0,0,0); return d; }
export function getWeekLabel(date) { return date.toLocaleDateString("en-US",{month:"short",day:"numeric"}); }
export function getDayLabel(date) { const days=['Sun','Mon','Tue','Wed','Thu','Fri','Sat']; return `${days[date.getDay()]} ${date.getMonth()+1}/${date.getDate()}`; }
export function getWeeksArray(num,pastWeeks=1) {
  const weeks=[]; const monday=getMonday(new Date());
  for(let i=-pastWeeks;i<num;i++){ const d=new Date(monday); d.setDate(monday.getDate()+i*7); weeks.push({date:d,label:getWeekLabel(d),key:localDateKey(d),isPast:i<0,isDaily:false}); }
  return weeks;
}
export function getDaysArray(numWeeks,pastDays=0) {
  const days=[]; const monday=getMonday(new Date());
  const totalDays=numWeeks*7;
  for(let i=-pastDays;i<totalDays;i++){ const d=new Date(monday); d.setDate(monday.getDate()+i); const dow=d.getDay(); if(dow===0||dow===6) continue; days.push({date:d,label:getDayLabel(d),key:localDateKey(d),isPast:i<0,isDaily:true}); }
  return days;
}
export function dateIsDay(dateStr,dayKey) {
  if(!dateStr) return false;
  const d=new Date(dateStr+'T12:00:00'); const dk=new Date(dayKey+'T12:00:00');
  return d.getFullYear()===dk.getFullYear()&&d.getMonth()===dk.getMonth()&&d.getDate()===dk.getDate();
}
export function dateInWeek(dateStr, weekKey) {
  if (!dateStr) return false;
  const d = new Date(dateStr + 'T12:00:00');
  const ws = new Date(weekKey + 'T00:00:00');
  const we = new Date(weekKey + 'T00:00:00'); we.setDate(we.getDate() + 6); we.setHours(23,59,59,999);
  return d >= ws && d <= we;
}
export function getMarketingColumns(numWeeks) { if(numWeeks<=2) return getDaysArray(numWeeks,0); return getWeeksArray(numWeeks,1); }

// ─── IDIQ roll-up (unchanged) ────────────────────────────────────
export function computeIdiqRollup(idiq, proposals, touchpoints) {
  const props = proposals.filter(p => p.clientId === idiq.clientId);
  const awarded = props.filter(p => p.status === "Awarded");
  const notAwarded = props.filter(p => p.status === "Not Awarded");
  const wonFee = awarded.reduce((s,p)=>s+(p.fee||0),0);
  const tps = touchpoints.filter(t => t.clientId === idiq.clientId && t.status === "completed" && t.date);
  const lastDate = tps.length ? tps.map(t=>t.date).sort().slice(-1)[0] : "";
  const dSince = lastDate ? daysBetween(lastDate) : null;
  return { proposals: props.length, awarded: awarded.length, notAwarded: notAwarded.length, wonFee, touchpoints: tps.length, lastDate, dSince, stale: dSince === null || dSince > IDIQ_STALE_DAYS, expired: !!(idiq.dateExpired && daysBetween(idiq.dateExpired) > 0) };
}

// ─── Record factories ────────────────────────────────────────────
export const newClient = (over={}) => ({id:uid(),name:"",sector:"",office:"Nashville",tier:3,relationshipScore:5,relationshipOverride:null,touchpointValue:5,partners:[],strategic:false,markets:[],contacts:[],notes:"",...over});
// A touchpoint pre-filled for one client; TouchpointModal treats `_draft` as "new, with fields already set".
export const draftTouchpoint = (clientId, partner) => ({_draft:true,id:uid(),clientId:clientId||"",type:"Lunch",partner:partner||"RJ",date:todayKey(),status:"completed",rating:5,notes:"",contactIds:[],contactNames:[],leadIds:[]});

// ─── Stage / last-touch / flags shared by Today and Pipeline ─────
export const stageOf = p => { const s=normStatus(p.status); return s==="Lead"?"Lead":s==="Pursuing"?"Pursuing":s==="Submitted"?"Submitted":s==="Awarded"?"Awarded":"Closed"; };
export const isOpenStage = p => !CLOSED_STATUSES.includes(p.status);

// Last completed touchpoint for an opportunity: linked by leadIds first, else any completed touchpoint with one of its clients.
export function lastTouchFor(p, touchpoints) {
  const linked = touchpoints.filter(t=>t.status==="completed"&&(t.leadIds||[]).includes(p.id)).map(t=>t.date).filter(Boolean).sort();
  if(linked.length) { const d=linked[linked.length-1]; return {date:d,dSince:daysBetween(d),linked:true}; }
  const ids=leadClientIds(p);
  const byClient = touchpoints.filter(t=>t.status==="completed"&&ids.includes(t.clientId)).map(t=>t.date).filter(Boolean).sort();
  if(byClient.length) { const d=byClient[byClient.length-1]; return {date:d,dSince:daysBetween(d),linked:false}; }
  return {date:"",dSince:null,linked:false};
}

// Flags for one opportunity row. Leads keep the existing leadFlags rules exactly; pursuits and
// submitted proposals get the same next-step checks plus due / aging.
export function rowFlags(p, touchpoints) {
  const today=todayKey();
  const stage=stageOf(p);
  const open=isOpenStage(p);
  const lf=leadFlags(p,touchpoints);
  const steps=openSteps(p);
  const last=lastTouchFor(p,touchpoints);
  const noNext = open && (stage==="Lead" ? lf.noNext : steps.length===0);
  const overdue = open && steps.some(s=>s.date&&s.date<today);
  const quiet = stage==="Lead" ? lf.quiet : (stage==="Pursuing" && last.dSince!=null && last.dSince>QUIET_DAYS);
  const dSince = stage==="Lead" ? lf.dSince : last.dSince;
  const dueIn = (stage==="Lead"||stage==="Pursuing") && p.dueDate ? Math.floor((new Date(p.dueDate+"T12:00:00")-new Date(today+"T12:00:00"))/864e5) : null;
  const dueSoon = dueIn!=null && dueIn>=0 && dueIn<=DUE_SOON_DAYS;
  const pastDue = dueIn!=null && dueIn<0;
  const agingDays = stage==="Submitted" && p.submittedDate ? daysBetween(p.submittedDate) : null;
  const aging = agingDays!=null && agingDays>AGING_DAYS;
  const needsOpen = (p.needs||[]).filter(n=>!n.done).length;
  const any = noNext||overdue||quiet||dueSoon||pastDue||aging||needsOpen>0;
  const weight = (overdue?8:0)+(pastDue?8:0)+(aging?4:0)+(quiet?2:0)+(dueSoon?2:0)+(noNext?1:0)+(needsOpen?1:0);
  return {stage,open,noNext,overdue,quiet,dSince,lastTouch:stage==="Lead"?lf.lastTouch:last.date,dueIn,dueSoon,pastDue,agingDays,aging,needsOpen,any,weight};
}

// Shared sort for opportunity rows ({p, f, clientName}) — Pipeline list, board and CSV export use it.
export const SORTS = [
  ["flagged","Flagged first"],["newest","Newest"],["touch","Longest since touchpoint"],["due","Due date"],
  ["status","Status"],["fee","Fee"],["partner","Partner"],["client","Client"],["submitted","Submitted date"],["project","Project name"],
];
export function sortOpps(rows, sort, dir=1) {
  const o={Pursuing:0,Submitted:1,Lead:2,Tracking:2,Awarded:3,Dead:5};
  const cmp=(a,b)=>{
    switch(sort){
      case 'newest': return (b.p.leadSince||b.p.createdAt||"").localeCompare(a.p.leadSince||a.p.createdAt||"");
      case 'touch': { const da=a.f.dSince==null?-1:a.f.dSince, db=b.f.dSince==null?-1:b.f.dSince; return db-da; }
      case 'due': return (a.p.dueDate||'9999').localeCompare(b.p.dueDate||'9999');
      case 'fee': return (b.p.fee||0)-(a.p.fee||0);
      case 'partner': return (a.p.partner||'').localeCompare(b.p.partner||'')||(a.clientName||'').localeCompare(b.clientName||'');
      case 'submitted': return (a.p.submittedDate||'9999').localeCompare(b.p.submittedDate||'9999');
      case 'project': return (a.p.projectName||'').localeCompare(b.p.projectName||'');
      case 'client': return (a.clientName||'').localeCompare(b.clientName||'');
      case 'status': return ((o[a.p.status]??4)-(o[b.p.status]??4))||(b.p.fee||0)-(a.p.fee||0);
      default: return (b.f.weight-a.f.weight)||((b.f.dSince||0)-(a.f.dSince||0));
    }
  };
  return rows.slice().sort((a,b)=>dir*cmp(a,b));
}

// Browser download of a text blob (CSV, Word HTML, Markdown).
export const downloadFile = (name,mime,content) => { const blob=new Blob([content],{type:mime}); const url=URL.createObjectURL(blob); const a=document.createElement('a'); a.href=url; a.download=name; document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url); };
export const csvCell = v => { const s=(v==null?'':String(v)); return /[",\n]/.test(s)?'"'+s.replace(/"/g,'""')+'"':s; };
