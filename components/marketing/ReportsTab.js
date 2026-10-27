'use client';
// Reports — the monthly BD report (by partner and principal, with the Leads Generated drill-down and
// Word / Markdown exports) and the Summary (running won / lost / outstanding by year and office, CSV).
import { useState } from 'react';
import { Panel, Figure, Link, Button, Empty } from '../shell/ui';
import { OFFICES, normStatus, fmtDate, todayKey, Pill } from '../marketing-shared';
import { REPORT_PEOPLE, fmt$, monthKey, monthLabel, shiftMonth, leadMonth, leadsGenerated, computePersonReport, downloadFile, csvCell } from './helpers';
import { SubTabs, Caption } from './bits';

export function ReportsTab({m}) {
  const {clients,touchpoints,proposals,me,loadedAt,setModal}=m;
  const [sub,setSub]=useState("report");
  const [reportMonth,setReportMonth]=useState(monthKey(new Date()));
  return <div className="space-y-4">
    <SubTabs value={sub} onChange={setSub} tabs={[{id:"report",label:"Monthly BD report"},{id:"summary",label:"Summary"}]} />
    {sub==="report"&&<BDReport clients={clients} touchpoints={touchpoints} proposals={proposals} me={me} loadedAt={loadedAt} setModal={setModal} mKey={reportMonth} setMKey={setReportMonth} />}
    {sub==="summary"&&<Summary proposals={proposals} loadedAt={loadedAt} />}
  </div>;
}

function BDReport({clients,touchpoints,proposals,me,loadedAt,setModal,mKey,setMKey}) {
  const rows=REPORT_PEOPLE.map(person=>({person,...computePersonReport(person,mKey,touchpoints,proposals)}));
  const firm=rows.reduce((a,r)=>({touchpoints:a.touchpoints+r.touchpoints,leads:a.leads+r.leads,submitted:a.submitted+r.submitted,open:a.open+r.open}),{touchpoints:0,leads:0,submitted:0,open:0});
  const genLeads=leadsGenerated(mKey,touchpoints,proposals).map(x=>({...x,clientName:clients.find(c=>c.id===x.lead.clientId)?.name||"?"})).sort((a,b)=>(a.person||"").localeCompare(b.person||"")||leadMonth(a.lead).localeCompare(leadMonth(b.lead)));
  const unattributed=genLeads.filter(x=>!REPORT_PEOPLE.includes(x.person));
  const isThisMonth=mKey===monthKey(new Date());
  const esc=s=>String(s||"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
  const tpDesc=x=>x.touchpoint?`${x.touchpoint.type||"Touchpoint"} on ${fmtDate(x.touchpoint.date)} (${x.touchpoint.partner})${(x.touchpoint.contactNames||[]).length?" with "+x.touchpoint.contactNames.join(", "):""}`:"added by hand (no source touchpoint)";
  const exportWord=()=>{
    const th='style="background:#000;color:#fff;padding:6px 10px;text-align:left;font-family:Arial,sans-serif;font-size:12px"';
    const td='style="padding:6px 10px;border:1px solid #ccc;font-family:Arial,sans-serif;font-size:12px"';
    const body=rows.map(r=>`<tr><td ${td}>${r.person}</td><td ${td}>${r.touchpoints}</td><td ${td}>${r.leads}</td><td ${td}>${r.submitted}</td><td ${td}>${r.open}</td></tr>`).join('');
    const leadBody=genLeads.length?genLeads.map(x=>`<tr><td ${td}>${esc(x.person)}</td><td ${td}>${esc(x.lead.projectName||"Untitled")}</td><td ${td}>${esc(x.clientName)}</td><td ${td}>${esc(tpDesc(x))}</td><td ${td}>${esc(normStatus(x.lead.status))}</td></tr>`).join(''):`<tr><td ${td} colspan="5">No leads generated this month.</td></tr>`;
    const html=`<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40"><head><meta charset="utf-8"></head><body>`
      +`<h2 style="font-family:Georgia,serif">HDLA BD Report — ${monthLabel(mKey)}</h2>`
      +`<p style="font-family:Arial,sans-serif;font-size:11px;color:#555">Touchpoints, leads generated and proposal activity by partner &amp; principal.</p>`
      +`<table style="border-collapse:collapse;width:100%"><thead><tr><th ${th}>Person</th><th ${th}>Touchpoints</th><th ${th}>Leads Generated</th><th ${th}>Proposals Submitted</th><th ${th}>Open Proposals</th></tr></thead><tbody>${body}</tbody></table>`
      +`<h3 style="font-family:Georgia,serif;margin-top:18px">Leads generated — ${monthLabel(mKey)}</h3>`
      +`<table style="border-collapse:collapse;width:100%"><thead><tr><th ${th}>Person</th><th ${th}>Lead</th><th ${th}>Client</th><th ${th}>From touchpoint</th><th ${th}>Status now</th></tr></thead><tbody>${leadBody}</tbody></table>`
      +`</body></html>`;
    downloadFile(`HDLA-BD-Report-${mKey}.doc`,'application/msword',html);
  };
  const exportMd=()=>{
    let md=`# HDLA BD Report — ${monthLabel(mKey)}\n\nTouchpoints, leads generated and proposal activity by partner & principal.\n\n| Person | Touchpoints | Leads Generated | Proposals Submitted | Open Proposals |\n|---|---|---|---|---|\n`;
    rows.forEach(r=>{md+=`| ${r.person} | ${r.touchpoints} | ${r.leads} | ${r.submitted} | ${r.open} |\n`;});
    md+=`\n## Leads generated — ${monthLabel(mKey)}\n\n`;
    if(!genLeads.length) md+=`None this month.\n`;
    else { md+=`| Person | Lead | Client | From touchpoint | Status now |\n|---|---|---|---|---|\n`; genLeads.forEach(x=>{md+=`| ${x.person} | ${x.lead.projectName||"Untitled"} | ${x.clientName} | ${tpDesc(x)} | ${normStatus(x.lead.status)} |\n`;}); }
    downloadFile(`HDLA-BD-Report-${mKey}.md`,'text/markdown',md);
  };
  const Nav=({d,label})=><button type="button" onClick={()=>setMKey(shiftMonth(mKey,d))} className="h-8 px-3 border border-ink rounded-[3px] text-sm font-bold" aria-label={label}>{d<0?"‹":"›"}</button>;
  return <div className="space-y-4">
    <div className="flex items-center justify-between gap-3 flex-wrap">
      <div className="flex items-center gap-2"><Nav d={-1} label="Previous month" /><span className="font-flecha text-lg min-w-[150px] text-center">{monthLabel(mKey)}</span><Nav d={1} label="Next month" />{!isThisMonth&&<Link onClick={()=>setMKey(monthKey(new Date()))} className="text-xs">This month</Link>}</div>
      <div className="flex items-center gap-2"><Button onClick={exportWord}>Export (Word)</Button><Button variant="secondary" onClick={exportMd}>Export (Markdown)</Button></div>
    </div>
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
      <Figure label="Touchpoints" value={firm.touchpoints} sub={monthLabel(mKey)} />
      <Figure label="Leads generated" value={firm.leads} sub="credited to the touchpoint's partner" />
      <Figure label="Proposals submitted" value={firm.submitted} sub="by submitted date" />
      <Figure label="Open proposals" value={firm.open} sub="pursuing + submitted, now" />
    </div>
    <Panel title="By partner and principal" meta={`${monthLabel(mKey)} · Supabase · loaded ${loadedAt}`}>
      <div className="overflow-x-auto"><table className="of-table w-full border-collapse" data-testid="report-table">
        <thead><tr><th>Person</th><th className="text-right">Touchpoints</th><th className="text-right">Leads generated</th><th className="text-right">Proposals submitted</th><th className="text-right">Open proposals</th></tr></thead>
        <tbody>
          {rows.map(r=><tr key={r.person} className={r.person===me?"of-mine":""}><td className="font-bold">{r.person}</td>{[r.touchpoints,r.leads,r.submitted,r.open].map((v,i)=><td key={i} className={"text-right "+(v?"":"text-done")}>{v}</td>)}</tr>)}
          <tr className="of-total"><td>Firm</td><td className="text-right">{firm.touchpoints}</td><td className="text-right">{firm.leads}</td><td className="text-right">{firm.submitted}</td><td className="text-right">{firm.open}</td></tr>
        </tbody>
      </table></div>
    </Panel>
    <Panel title="Leads generated" meta={`${monthLabel(mKey)} · by partner and the touchpoint that produced each`}>
      <div data-testid="report-leads">
      {genLeads.length===0?<Empty>No leads generated this month. Leads count from the date they became a lead (tick &quot;This surfaced a new opportunity&quot; when logging a touchpoint, or + New › Lead).</Empty>:
      <div className="overflow-x-auto"><table className="of-table w-full border-collapse">
        <thead><tr><th>Person</th><th>Lead</th><th>Client</th><th>From touchpoint</th><th>Status now</th></tr></thead>
        <tbody>{genLeads.map(x=><tr key={x.lead.id} className={x.person===me?"of-mine":""}>
          <td className="font-bold">{x.person||<span className="text-muted font-normal">?</span>}</td>
          <td><Link onClick={()=>setModal({type:"editProp",data:x.lead})}>{x.lead.projectName||"Untitled"}</Link>{x.lead.proposalType&&x.lead.proposalType!=="Proposal"&&<span className="text-xs text-muted"> · {x.lead.proposalType}</span>}</td>
          <td className="text-xs">{x.clientName}</td>
          <td className="text-xs">{x.touchpoint?<Link onClick={()=>setModal({type:"editTP",data:x.touchpoint})} className="text-xs">{x.touchpoint.type||"Touchpoint"} · {fmtDate(x.touchpoint.date)}{(x.touchpoint.contactNames||[]).length?" · "+x.touchpoint.contactNames.join(", "):""}</Link>:<span className="text-muted italic">added by hand</span>}</td>
          <td><Pill color={"stat"+normStatus(x.lead.status)}>{normStatus(x.lead.status)}</Pill></td>
        </tr>)}</tbody>
      </table></div>}
      </div>
    </Panel>
    {unattributed.length>0&&<Caption className="text-status-amber">{unattributed.length} lead{unattributed.length===1?"":"s"} this month {unattributed.length===1?"is":"are"} under someone outside the partner/principal list, so {unattributed.length===1?"it counts":"they count"} in the list above but not in a row of the table.</Caption>}
    <Caption>BD activity only — touchpoints logged, leads generated and proposals led. A lead is credited to whoever logged the touchpoint that produced it (or its partner if added by hand), in the month it became a lead. Live view; pick any month. Realign quarterly.</Caption>
  </div>;
}

function Summary({proposals,loadedAt}) {
  // Always computed from the FULL proposal log — Pipeline filters do not apply.
  // Leads / Pursuing / Dead are excluded; only proposals that went out the door count.
  const SUMMARY_STATUSES = ["Awarded","Not Awarded","Submitted","Declined"];
  const log = proposals.filter(p=>SUMMARY_STATUSES.includes(p.status));
  const officeKey = p => OFFICES.includes(p.office) ? p.office : "Unassigned";
  const yearOf = p => { const d = p.status==="Awarded" ? (p.awardedDate||p.submittedDate||p.dueDate) : (p.submittedDate||p.dueDate); const y = (d||"").slice(0,4); return /^\d{4}$/.test(y) ? y : "Undated"; };
  const blank = () => ({awardedN:0,awardedFee:0,lostN:0,lostFee:0,outN:0,outFee:0,declN:0,declFee:0});
  const addTo = (b,p) => { const fee = p.fee||0; if(p.status==="Awarded"){b.awardedN++;b.awardedFee+=fee;} else if(p.status==="Not Awarded"){b.lostN++;b.lostFee+=fee;} else if(p.status==="Submitted"){b.outN++;b.outFee+=fee;} else if(p.status==="Declined"){b.declN++;b.declFee+=fee;} };
  const hasUnassigned = log.some(p=>officeKey(p)==="Unassigned");
  const allKeys = hasUnassigned ? ["firm",...OFFICES,"Unassigned"] : ["firm",...OFFICES];
  const buildGroup = list => { const g = Object.fromEntries(allKeys.map(k=>[k,blank()])); list.forEach(p=>{addTo(g.firm,p);const k=officeKey(p);if(g[k])addTo(g[k],p);}); return g; };
  const allTime = buildGroup(log);
  const years = [...new Set(log.map(yearOf))].sort((a,b)=>a==="Undated"?1:b==="Undated"?-1:b.localeCompare(a));
  const byYear = years.map(y=>({year:y,g:buildGroup(log.filter(p=>yearOf(p)===y))}));
  const pct = (a,b) => (a+b)>0 ? Math.round(100*a/(a+b))+"%" : "—";
  const label = k => k==="firm"?"Firm":k;
  const cols = ["Awarded","Fee won","Not awarded","Fee lost","Win rate (#)","Win rate ($)","Submitted (outstanding)","Fee out","Declined"];
  const Block = ({title,g,note}) => (
    <Panel title={title} meta={note}>
      <div className="overflow-x-auto"><table className="of-table w-full border-collapse">
        <thead><tr><th>Office</th>{cols.map(h=><th key={h} className="text-right whitespace-nowrap">{h}</th>)}</tr></thead>
        <tbody>
          {allKeys.map(k=>{const b=g[k];const isFirm=k==="firm";const empty=!b.awardedN&&!b.lostN&&!b.outN&&!b.declN;const cls="text-right tabular-nums "+(empty?"text-done":"");return (
            <tr key={k} className={isFirm?"of-total":""}>
              <td className={k==="Unassigned"?"text-status-amber":""}>{label(k)}</td>
              <td className={cls}>{b.awardedN}</td><td className={cls}>{fmt$(b.awardedFee)}</td>
              <td className={cls}>{b.lostN}</td><td className={cls}>{fmt$(b.lostFee)}</td>
              <td className={cls}>{pct(b.awardedN,b.lostN)}</td><td className={cls}>{pct(b.awardedFee,b.lostFee)}</td>
              <td className={cls}>{b.outN}</td><td className={cls}>{fmt$(b.outFee)}</td>
              <td className={cls}>{b.declN}</td>
            </tr>);})}
        </tbody>
      </table></div>
    </Panel>
  );
  const exportCsv = () => {
    const rows = [["Period","Office",...cols]];
    const push = (period,g) => allKeys.forEach(k=>{const b=g[k];rows.push([period,label(k),b.awardedN,Math.round(b.awardedFee),b.lostN,Math.round(b.lostFee),pct(b.awardedN,b.lostN),pct(b.awardedFee,b.lostFee),b.outN,Math.round(b.outFee),b.declN]);});
    push("All time",allTime); byYear.forEach(({year,g})=>push(year,g));
    downloadFile(`hdla-proposal-summary-${todayKey()}.csv`,"text/csv",rows.map(r=>r.map(csvCell).join(",")).join("\n"));
  };
  return <div className="space-y-4">
    <div className="flex items-center justify-between gap-3 flex-wrap">
      <Caption>Running totals from the full proposal log · {log.length} proposals · fee = proposed fee on the record · Win rate = Awarded ÷ (Awarded + Not Awarded); Declined excluded · loaded {loadedAt}</Caption>
      <Link onClick={exportCsv}>Export CSV</Link>
    </div>
    {log.length===0&&<Panel><Empty>No submitted, awarded, not-awarded or declined proposals in the log yet.</Empty></Panel>}
    {log.length>0&&<Block title="All time" g={allTime} note="Cumulative across every year" />}
    {byYear.map(({year,g})=><Block key={year} title={year} g={g} note={year==="Undated"?"No award / submitted / due date on record — add dates to place these":"Awards by award date · submitted and not awarded by submitted date"} />)}
    {hasUnassigned&&<Caption className="text-status-amber">Some proposals have no office set — they count toward Firm but appear under “Unassigned”. Set an office on each to place them.</Caption>}
  </div>;
}
