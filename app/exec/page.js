'use client';
import { useState, useEffect, useMemo } from 'react';
import { BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, ReferenceLine } from 'recharts';
import { Shell } from '../../components/shell/Shell';
import { Panel, Figure, Pill, Tabs, Empty } from '../../components/shell/ui';

/* ═══════════════════════════════════════════════════════════════════
   ONEFIRM — Executive
   Data: Work plan Supabase (projects, projections) + SharePoint Master Data (fees) + Marketing (proposals)
   QuickBooks (expenses, aging) arrives through /api/financials and /api/aging when those are wired.
   ═══════════════════════════════════════════════════════════════════ */

// Chart palette: ONE accent, then grays. Nothing else.
const MAGENTA = '#E00087';
const GRAY = '#8A8A86';
const INK = '#141414';
const GRID = '#EDEDEB';
const TICK = { fontSize: 11, fill: '#5C5C58' };
const TOOLTIP_STYLE = { contentStyle: { border: '1px solid #E3E3E0', borderRadius: 3, fontSize: 12, boxShadow: 'none' }, labelStyle: { fontWeight: 700 } };

const PRINCIPALS = ['RW','AB','MM','HD'];
const PARTNERS = ['RJ','CB','MB','TJ'];

const TEAM_STRUCTURE = {
  RW: { name: 'Robert Whittemore', office: 'Nashville', members: ['Maggie Ackerman','Carly Shows','Elizabeth Crimmins','John Yakimicki','Jennifer Kerr'] },
  AB: { name: 'Austen Berry', office: 'Nashville', members: ['Watts Brown','Margaret Apperson','Taylor Uren','Madeline Easter','Grace Ackerman'] },
  MM: { name: 'Mary Miller', office: 'Nashville', members: ['Thomas Schneider','Savannah Alexander','Samie Hubbard','Jackson Davis','Katelyn Rockey'] },
  HD: { name: 'Hank Dalton', office: 'Dallas', members: ['Yuan Ren','Robert Cunning','Andy Molina','Alex Ramirez','Jessica Fairman'] },
};

const MONTHLY_CAPACITY = 21000;

// ─── Formatters ────────────────────────────────────────────────────
const fmtK = v => { if(!v&&v!==0)return''; if(Math.abs(v)>=1e6) return `$${(v/1e6).toFixed(1)}M`; if(Math.abs(v)>=1e3) return `$${(v/1e3).toFixed(0)}K`; return `$${v.toFixed(0)}`; };
const fmtFull = v => new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',minimumFractionDigits:0,maximumFractionDigits:0}).format(v||0);
const fmtTime = d => d ? d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }).toLowerCase() : '…';
const fmtStamp = iso => { if (!iso) return ''; const d = new Date(iso); return isNaN(d) ? String(iso) : d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).toLowerCase(); };
const monthName = key => { const [y, m] = String(key).split('-').map(Number); if (!y || !m) return String(key); return new Date(y, m - 1, 1).toLocaleDateString('en-US', { month: 'short', year: 'numeric' }); };

// ─── Components ────────────────────────────────────────────────────
function Toggle({label, checked, onChange}) {
  return (
    <label className="inline-flex items-center cursor-pointer">
      <div className="relative">
        <input type="checkbox" className="sr-only" checked={checked} onChange={e=>onChange(e.target.checked)} />
        <div className={`w-9 h-5 rounded-full transition-colors ${checked?'bg-accent':'bg-rule'}`} />
        <div className={`absolute left-0.5 top-0.5 w-4 h-4 bg-white rounded-full transition-transform ${checked?'translate-x-4':''}`} />
      </div>
      <span className="ml-2 text-xs text-muted">{label}</span>
    </label>
  );
}

// Column-driven table on the of-table standard. Alignment is inline because .of-table th outranks utilities.
function DataTable({columns, data, totalRow}) {
  if(!data||data.length===0) return <Empty>No data</Empty>;
  return (
    <div className="overflow-x-auto">
      <table className="of-table w-full border-collapse">
        <thead>
          <tr>{columns.map(c=><th key={c.key} style={{textAlign:c.align==='right'?'right':'left'}}>{c.header}</th>)}</tr>
        </thead>
        <tbody>
          {data.map((row,i)=>(
            <tr key={i} className={totalRow && i===data.length-1 ? 'of-total' : 'hover:bg-ground'}>
              {columns.map(c=>(
                <td key={c.key} className={c.align==='right'?'text-right':''}>
                  {c.render ? c.render(row[c.key], row) : row[c.key]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// Segmented control (view switches) — ink outline, active = solid ink
function Segmented({options, value, onChange}) {
  return (
    <div className="inline-flex border border-ink rounded-[3px] overflow-hidden">
      {options.map((o,i)=>(
        <button key={o.id} type="button" onClick={()=>onChange(o.id)} className={`px-3 h-8 text-[13px] ${i>0?'border-l border-ink':''} ${value===o.id?'bg-ink text-white font-bold':'bg-white text-ink hover:bg-ground'}`}>{o.label}</button>
      ))}
    </div>
  );
}

const H2 = ({children}) => <h2 className="text-xl mb-3">{children}</h2>;
const Sub = ({children}) => <span className="text-[13px] font-normal text-muted ml-2 font-lato">{children}</span>;

// Status language: healthy = outline, watch = amber, hire = red. Health: Good outline, Watch amber, Poor red.
const StatusPill = ({status}) => <Pill kind={status==='hire'?'red':status==='watch'?'amber':'outline'}>{status==='hire'?'Hire now':status}</Pill>;
const HealthPill = ({v}) => v ? <Pill kind={v==='Poor'?'red':v==='Watch'?'amber':'outline'}>{v}</Pill> : <span className="text-done">—</span>;
const pctCls = status => status==='hire'?'text-status-red font-bold':status==='watch'?'text-status-amber font-bold':'font-bold';
const ProbPill = ({v}) => <Pill>{v || '—'}</Pill>;

// ─── Data Loading ──────────────────────────────────────────────────
function useExecData() {
  const [projects, setProjects] = useState([]);
  const [masterData, setMasterData] = useState([]);
  const [projections, setProjections] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [proposals, setProposals] = useState([]);
  const [clients, setClients] = useState([]);
  const [summary, setSummary] = useState([]);
  const [loadedAt, setLoadedAt] = useState(null);

  useEffect(()=>{
    Promise.all([
      fetch('/api/projects').then(r=>r.json()).catch(()=>({projects:[]})),
      fetch('/api/masterdata').then(r=>r.json()).catch(()=>({data:[],summary:[]})),
      fetch('/api/projections').then(r=>r.json()).catch(()=>({projections:{}})),
      fetch('/api/marketing').then(r=>r.json()).catch(()=>({proposals:[],clients:[]})),
    ]).then(([projRes, mdRes, projnRes, mktRes])=>{
      setProjects(projRes.projects||[]);
      setMasterData(mdRes.data||[]);
      setSummary(mdRes.summary||[]);
      setProjections(projnRes.projections||{});
      setProposals(mktRes.proposals||[]);
      setClients(mktRes.clients||[]);
      setLoadedAt(new Date());
      setLoading(false);
    }).catch(err=>{
      setError(err.message);
      setLoading(false);
    });
  },[]);

  return { projects, masterData, summary, projections, proposals, clients, loading, error, loadedAt };
}

// QuickBooks feeds — routes may not exist yet. 404 / bad JSON / empty → null (placeholder shown).
function useOptionalJSON(url) {
  const [state, setState] = useState({ status: 'loading', data: null });
  useEffect(()=>{
    let alive = true;
    fetch(url).then(async r => {
      if (!r.ok) throw new Error(String(r.status));
      const ct = r.headers.get('content-type') || '';
      if (!ct.includes('json')) throw new Error('not json');
      return r.json();
    }).then(d => { if (alive) setState({ status: 'ok', data: d }); })
      .catch(() => { if (alive) setState({ status: 'missing', data: null }); });
    return () => { alive = false; };
  }, [url]);
  return state;
}

// ─── Computation ───────────────────────────────────────────────────
function computeCapacity(masterData, projections) {
  const results = {};

  // ─── Build project list EXACTLY like work plan Projections tab ───
  // This ensures projection IDs match perfectly
  const rawProjects = masterData.filter(r => r.Status === 'O' || r.Status === 'PR');
  const phaseCount = {};
  rawProjects.forEach(r => {
    const key = `${r['Project #']}-${r['Phase']}`;
    phaseCount[key] = (phaseCount[key] || 0) + 1;
  });
  const allProjProjects = rawProjects.map(r => {
    const baseKey = `${r['Project #']}-${r['Phase']}`;
    const hasDuplicates = phaseCount[baseKey] > 1;
    const nameSuffix = hasDuplicates ? `-${(r['Project Name'] || '').replace(/[^a-zA-Z0-9]/g, '').slice(-15)}` : '';
    return {
      id: `${baseKey}${nameSuffix}`,
      pm: r.PM,
      fee: r['Fee'] || 0,
      previouslyBilledPct: r['Previously Billed %'] || 0,
    };
  });

  // Month keys: current + next 2
  const now = new Date();
  const months = [];
  for (let i = 0; i < 3; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
    months.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  }
  // Previous month for first-month delta
  const prevDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const prevMonthKey = `${prevDate.getFullYear()}-${String(prevDate.getMonth() + 1).padStart(2, '0')}`;

  PRINCIPALS.forEach(pm => {
    const team = TEAM_STRUCTURE[pm];
    const teamSize = team.members.length + 1;

    const pmRows = masterData.filter(r => r.PM === pm && (r.Status === 'O' || r.Status === 'PR'));
    const feeRemaining = pmRows.reduce((s,r) => s + (r['Fee Remaining']||0), 0);

    // ─── FEE-BASED (12-month horizon) ───
    const capacity12 = teamSize * MONTHLY_CAPACITY * 12;
    const crunch12 = capacity12 > 0 ? Math.round((feeRemaining / capacity12) * 100) : 0;
    const status12 = crunch12 > 125 ? 'hire' : crunch12 > 100 ? 'watch' : 'healthy';

    // ─── PROJECTION-BASED (current + next 2 months) ───
    // Same calculation as work plan Projections tab: sum (thisMonth% - prevMonth%) × fee
    const pmProjects = allProjProjects.filter(p => p.pm === pm);
    let projectedBilling = 0;

    pmProjects.forEach(project => {
      const projData = projections[project.id];
      if (!projData?.months) return;

      months.forEach((monthKey, idx) => {
        const pct = projData.months[monthKey];
        if (pct == null || pct === '') return;

        let prevPct;
        if (idx === 0) {
          prevPct = projData.months[prevMonthKey];
          if (prevPct == null || prevPct === '') prevPct = project.previouslyBilledPct;
        } else {
          prevPct = projData.months[months[idx - 1]];
          if (prevPct == null || prevPct === '') prevPct = project.previouslyBilledPct;
        }

        projectedBilling += Math.max(0, ((pct - prevPct) / 100) * project.fee);
      });
    });

    const capacity3 = teamSize * MONTHLY_CAPACITY * 3;
    const crunch3 = capacity3 > 0 ? Math.round((projectedBilling / capacity3) * 100) : 0;
    const status3 = crunch3 > 125 ? 'hire' : crunch3 > 100 ? 'watch' : 'healthy';

    results[pm] = {
      name: team.name, office: team.office, teamSize, members: team.members,
      feeRemaining, projectCount: pmRows.length,
      capacity12, crunch12, status12,
      projectedBilling, capacity3, crunch3, status3,
    };
  });

  return results;
}

function computeExecutive(masterData, locationFilter = null) {
  // Filter by location if specified (null/undefined = all locations)
  const filtered = locationFilter
    ? masterData.filter(r => (r.Location || '').toLowerCase() === locationFilter.toLowerCase())
    : masterData;

  const open = filtered.filter(r => r.Status === 'O');
  const pr = filtered.filter(r => r.Status === 'PR');

  const totalFeeO = open.reduce((s,r) => s + (r['Fee Remaining']||0), 0);
  const totalFeePR = pr.reduce((s,r) => s + (r['Fee Remaining']||0), 0);
  const projectCountO = new Set(open.map(r=>r['Project #'])).size;
  const clientCount = new Set(open.map(r=>r['Client']||r['Project Name']).filter(Boolean)).size;

  // Fee by partner
  const feeByPartnerO = {};
  const feeByPartnerPR = {};
  PARTNERS.forEach(p => { feeByPartnerO[p]=0; feeByPartnerPR[p]=0; });
  open.forEach(r => { const p=r.Partner; if(p&&feeByPartnerO.hasOwnProperty(p)) feeByPartnerO[p]+=(r['Fee Remaining']||0); });
  pr.forEach(r => { const p=r.Partner; if(p&&feeByPartnerPR.hasOwnProperty(p)) feeByPartnerPR[p]+=(r['Fee Remaining']||0); });

  // Fee by PM
  const feeByPM_O = {};
  const feeByPM_PR = {};
  open.forEach(r => { const pm=r.PM; if(pm) feeByPM_O[pm]=(feeByPM_O[pm]||0)+(r['Fee Remaining']||0); });
  pr.forEach(r => { const pm=r.PM; if(pm) feeByPM_PR[pm]=(feeByPM_PR[pm]||0)+(r['Fee Remaining']||0); });

  return { totalFeeO, totalFeePR, projectCountO, clientCount, feeByPartnerO, feeByPartnerPR, feeByPM_O, feeByPM_PR };
}

function computeProjectHealth(projects) {
  const counts = { Good:0, Watch:0, Poor:0 };
  const needsReview = [];
  const hasNeeds = [];

  projects.forEach(p => {
    const worst = (p.internalHealth==='Poor'||p.externalHealth==='Poor') ? 'Poor' :
                  (p.internalHealth==='Watch'||p.externalHealth==='Watch') ? 'Watch' : 'Good';
    counts[worst]++;
    if((p.needsReview||[]).length > 0) needsReview.push(p);
    if(p.needs && p.needs.trim()) hasNeeds.push(p);
  });

  return { counts, needsReview, hasNeeds };
}

// ─── Shared chart blocks ───────────────────────────────────────────
function StackedFeeChart({data, includePR}) {
  return (
    <ResponsiveContainer width="100%" height={250}>
      <BarChart data={data}>
        <CartesianGrid strokeDasharray="3 3" stroke={GRID} vertical={false} />
        <XAxis dataKey="name" tick={TICK} axisLine={{stroke:GRID}} tickLine={false} />
        <YAxis tickFormatter={fmtK} tick={TICK} axisLine={false} tickLine={false} />
        <Tooltip formatter={v=>fmtFull(v)} {...TOOLTIP_STYLE} cursor={{fill:GRID}} />
        <Legend iconType="square" wrapperStyle={{fontSize:12}} />
        <Bar dataKey="O" stackId="a" fill={MAGENTA} name="O" />
        {includePR && <Bar dataKey="PR" stackId="a" fill={GRAY} name="PR" />}
      </BarChart>
    </ResponsiveContainer>
  );
}

const FEE_COLUMNS = key => [
  {header: key==='pm' ? 'PM' : 'Partner', key},
  {header:'O', key:'o', align:'right', render:v=>fmtFull(v)},
  {header:'PR', key:'pr', align:'right', render:v=>fmtFull(v)},
  {header:'Combined', key:'combined', align:'right', render:v=>fmtFull(v)},
];

// ─── QuickBooks panels ─────────────────────────────────────────────
// /api/financials?months=12 → rows [{month:'2026-09', category, subcategory, amount, kind:'income'|'expense'|'cogs'}]
function ExpensesPanel({ locLabel, fin }) {
  const table = useMemo(() => {
    const rows = Array.isArray(fin.data) ? fin.data : Array.isArray(fin.data?.rows) ? fin.data.rows : null;
    if (!rows || rows.length === 0) return null;
    const exp = rows.filter(r => r && (r.kind === 'expense' || r.kind === 'cogs') && r.month);
    if (exp.length === 0) return null;
    const months = [...new Set(exp.map(r => String(r.month)))].sort().slice(-3);
    const byCat = {};
    exp.filter(r => months.includes(String(r.month))).forEach(r => {
      const cat = r.category || 'Uncategorized';
      byCat[cat] = byCat[cat] || { category: cat, total: 0 };
      byCat[cat][r.month] = (byCat[cat][r.month] || 0) + (Number(r.amount) || 0);
      byCat[cat].total += Number(r.amount) || 0;
    });
    const data = Object.values(byCat).sort((a, b) => b.total - a.total);
    const total = { category: 'Total', total: data.reduce((s, r) => s + r.total, 0) };
    months.forEach(m => { total[m] = data.reduce((s, r) => s + (r[m] || 0), 0); });
    return { months, data: [...data, total], pulledAt: fin.data?.pulledAt };
  }, [fin]);

  if (fin.status === 'loading') return <Panel title={`Expenses — ${locLabel}`} meta="QuickBooks"><Empty>Checking QuickBooks…</Empty></Panel>;
  if (!table) return (
    <Panel title={`Expenses — ${locLabel}`} meta="QuickBooks · not connected" pad>
      <p className="text-sm text-muted m-0">Expenses by category arrive from QuickBooks — see Admin → QuickBooks.</p>
    </Panel>
  );
  return (
    <Panel title={`Expenses — ${locLabel}`} meta={`QuickBooks · ${table.pulledAt ? `pulled ${fmtStamp(table.pulledAt)}` : 'firm-wide'} · last 3 months`}>
      <DataTable totalRow columns={[
        {header:'Category', key:'category'},
        ...table.months.map(m => ({header: monthName(m), key: m, align:'right', render: v => v ? fmtFull(v) : <span className="text-done">—</span>})),
        {header:'3-mo total', key:'total', align:'right', render: v => fmtFull(v)},
      ]} data={table.data} />
    </Panel>
  );
}

// /api/aging → {pulledAt, rows:[{partner, current, d31, d61, d90, total}]}
function AgingPanel() {
  const aging = useOptionalJSON('/api/aging');
  const rows = Array.isArray(aging.data?.rows) ? aging.data.rows : [];
  const late = v => (Number(v) || 0) > 0 ? <span className="text-status-red font-bold">{fmtFull(v)}</span> : <span className="text-done">—</span>;
  const money = v => (Number(v) || 0) ? fmtFull(v) : <span className="text-done">—</span>;
  if (aging.status === 'loading') return <Panel title="Aging" meta="QuickBooks"><Empty>Checking QuickBooks…</Empty></Panel>;
  if (aging.status !== 'ok' || rows.length === 0) return (
    <Panel title="Aging" meta="QuickBooks · not connected" pad>
      <p className="text-sm text-muted m-0">Aging arrives from QuickBooks — see Admin.</p>
    </Panel>
  );
  const sum = k => rows.reduce((s, r) => s + (Number(r[k]) || 0), 0);
  const firm = { partner: 'Firm total', current: sum('current'), d31: sum('d31'), d61: sum('d61'), d90: sum('d90'), total: sum('total') };
  return (
    <Panel title="Aging" meta={`QuickBooks · ${aging.data?.pulledAt ? `pulled ${fmtStamp(aging.data.pulledAt)}` : 'pulled'} · receivables by partner`}>
      <DataTable totalRow columns={[
        {header:'Partner', key:'partner'},
        {header:'Current', key:'current', align:'right', render: money},
        {header:'31–60', key:'d31', align:'right', render: money},
        {header:'61–90', key:'d61', align:'right', render: late},
        {header:'90+', key:'d90', align:'right', render: late},
        {header:'Total', key:'total', align:'right', render: v => fmtFull(v)},
      ]} data={[...rows, firm]} />
    </Panel>
  );
}

// ─── Main Component ────────────────────────────────────────────────
const TABS = [
  {id:'summary', label:'Executive Summary'},
  {id:'nashville', label:'Nashville'},
  {id:'dallas', label:'Dallas'},
  {id:'raleigh', label:'Raleigh'},
  {id:'pipeline', label:'Pipeline'},
  {id:'capacity', label:'Capacity'},
  {id:'health', label:'Project Health'},
];
const TAB_SUB = {
  summary: 'Under contract and projected work overview',
  nashville: 'Nashville office — under contract, projected, and expenses',
  dallas: 'Dallas office — under contract, projected, and expenses',
  raleigh: 'Raleigh office — under contract, projected, and expenses',
  pipeline: 'Proposals and projected work pipeline',
  capacity: 'Team capacity scoring based on billing projections',
  health: 'Work plan project status and partner review needs',
};

function ExecDashboardInner() {
  const { projects, masterData, summary, projections, proposals, clients, loading, error, loadedAt } = useExecData();
  const fin = useOptionalJSON('/api/financials?months=12');
  const [tab, setTab] = useState('summary');
  const [includePR, setIncludePR] = useState(true);

  const exec = useMemo(() => computeExecutive(masterData), [masterData]);
  const execNashville = useMemo(() => computeExecutive(masterData, 'Nashville'), [masterData]);
  const execDallas = useMemo(() => computeExecutive(masterData, 'Dallas'), [masterData]);
  const execRaleigh = useMemo(() => computeExecutive(masterData, 'Raleigh'), [masterData]);
  const capacity = useMemo(() => computeCapacity(masterData, projections), [masterData, projections]);
  const health = useMemo(() => computeProjectHealth(projects), [projects]);
  const [healthSortBy, setHealthSortBy] = useState('principal'); // 'principal' | 'partner'
  const [capacityView, setCapacityView] = useState('both'); // 'both' | 'fee' | 'proj' | 'hours'

  // 3-month rolling averages from Summary tab
  // Use date-based window: last 12 COMPLETE months before current month
  const summaryMetrics = useMemo(() => {
    if (!summary || summary.length === 0) return null;

    // Parse month labels into sortable dates for filtering
    const now = new Date();
    const currentMonthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

    // A month is "complete" if it has any billing OR expenses AND is before current month
    const complete = summary.filter(r => {
      if ((r.billing || 0) <= 0 && (r.expenses || 0) <= 0) return false;
      // Try to parse the month to check if it's current month (skip it)
      // Month labels may be "Mar 2026", "March 2026", "3/1/2026", etc.
      try {
        const d = new Date(r.month + ' 1');
        if (!isNaN(d.getTime())) {
          const rKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
          if (rKey === currentMonthKey) return false; // skip current month
        }
      } catch(e) {}
      return true;
    });

    if (complete.length === 0) return null;
    const last12 = complete.slice(-12);
    const last3 = complete.slice(-3);
    const avg = (arr, key) => arr.length ? arr.reduce((s, r) => s + (r[key] || 0), 0) / arr.length : 0;
    const billing3 = avg(last3, 'billing');
    const expenses3 = avg(last3, 'expenses');
    const marginPct3 = billing3 > 0 ? Math.round(((billing3 - expenses3) / billing3) * 100) : 0;
    const billing12 = avg(last12, 'billing');
    const expenses12 = avg(last12, 'expenses');
    const marginPct12 = billing12 > 0 ? Math.round(((billing12 - expenses12) / billing12) * 100) : 0;
    return {
      last12,
      billing3mo: billing3,
      expenses3mo: expenses3,
      pipeline3mo: avg(last3, 'pipeline'),
      billing12mo: billing12,
      expenses12mo: expenses12,
      marginPct3,
      marginPct12,
    };
  }, [summary]);

  // Hours-based capacity from work plan
  const hoursCapacity = useMemo(() => {
    const results = {};
    const WORK_HOURS_PER_MONTH = 160; // ~160 billable hours/person/month
    // Look at next 12 weeks of assigned hours
    const allWeeks = [];
    const monday = new Date();
    const day = monday.getDay();
    monday.setDate(monday.getDate() - day + (day === 0 ? -6 : 1));
    for (let i = 0; i < 12; i++) {
      const d = new Date(monday);
      d.setDate(monday.getDate() + i * 7);
      allWeeks.push(d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }));
    }
    PRINCIPALS.forEach(pm => {
      const team = TEAM_STRUCTURE[pm];
      const allMembers = [...team.members, pm]; // initials + full names
      const pmProjects = projects.filter(p => p.principal === pm);
      const hoursByMember = {};
      allMembers.forEach(m => { hoursByMember[m] = 0; });
      pmProjects.forEach(proj => {
        (proj.tasks || []).forEach(t => {
          if (allWeeks.includes(t.week) && t.hours && t.staff) {
            if (hoursByMember.hasOwnProperty(t.staff)) {
              hoursByMember[t.staff] += (t.hours || 0);
            }
          }
        });
      });
      // Principal assumed 100% = full capacity
      const teamCapacityHours = team.members.length * WORK_HOURS_PER_MONTH * 3; // 3 months
      const principalHours = WORK_HOURS_PER_MONTH * 3; // principal at 100%
      const assignedHours = Object.values(hoursByMember).reduce((s, h) => s + h, 0);
      const totalCapacity = teamCapacityHours + principalHours;
      const crunch = totalCapacity > 0 ? Math.round((assignedHours / totalCapacity) * 100) : 0;
      const status = crunch > 125 ? 'hire' : crunch > 100 ? 'watch' : 'healthy';
      results[pm] = { ...capacity[pm], assignedHours, totalCapacityHours: totalCapacity, crunchHours: crunch, statusHours: status, hoursByMember };
    });
    return results;
  }, [projects, capacity]);

  const MD_META = `Master Data · loaded ${fmtTime(loadedAt)}`;
  const MKT_META = `Marketing · loaded ${fmtTime(loadedAt)}`;
  const WP_META = `Work Plan · loaded ${fmtTime(loadedAt)}`;
  const PROJ_META = `Work Plan projections · loaded ${fmtTime(loadedAt)}`;

  if (loading) return <div className="py-16 text-center text-muted animate-pulse">Loading executive dashboard…</div>;
  if (error) return <Panel title="Could not load" pad><p className="text-sm text-status-red m-0">Error: {error}</p></Panel>;

  // Chart data
  const partnerChartData = PARTNERS.map(p => ({
    name: p,
    O: exec.feeByPartnerO[p]||0,
    PR: includePR ? (exec.feeByPartnerPR[p]||0) : 0,
  }));

  const pmChartData = Object.keys(exec.feeByPM_O)
    .map(pm => ({
      name: pm,
      O: exec.feeByPM_O[pm]||0,
      PR: includePR ? (exec.feeByPM_PR[pm]||0) : 0,
      combined: (exec.feeByPM_O[pm]||0) + (exec.feeByPM_PR[pm]||0),
    }))
    .sort((a,b) => b.combined - a.combined)
    .slice(0,8);

  // Tables
  const partnerTableData = PARTNERS.map(p => ({
    partner: p,
    o: exec.feeByPartnerO[p]||0,
    pr: exec.feeByPartnerPR[p]||0,
    combined: (exec.feeByPartnerO[p]||0) + (exec.feeByPartnerPR[p]||0),
  }));

  const pmTableData = Object.keys(exec.feeByPM_O)
    .map(pm => ({
      pm,
      o: exec.feeByPM_O[pm]||0,
      pr: exec.feeByPM_PR[pm]||0,
      combined: (exec.feeByPM_O[pm]||0) + (exec.feeByPM_PR[pm]||0),
    }))
    .sort((a,b) => b.combined - a.combined);

  const prToggle = <Toggle label="Include PR" checked={includePR} onChange={setIncludePR} />;

  return (
    <div>
      <Tabs tabs={TABS} value={tab} onChange={setTab} />
      <p className="text-[13px] text-muted -mt-2 mb-5">{TAB_SUB[tab]}</p>

      {/* ═══ EXECUTIVE SUMMARY TAB ═══ */}
      {tab === 'summary' && (
        <div>
          {/* Fee Remaining */}
          <H2>Fee Remaining</H2>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-6">
            <Figure label="Under Contract (O)" value={fmtFull(exec.totalFeeO)} sub="Master Data" />
            <Figure label="Projected (PR)" value={fmtFull(exec.totalFeePR)} sub="Master Data" />
            <Figure label="Combined" value={fmtFull(exec.totalFeeO + exec.totalFeePR)} sub="O + PR" />
            <Figure label="Projects (O)" value={exec.projectCountO} sub="distinct project numbers" />
            <Figure label="Clients (O)" value={exec.clientCount} sub="distinct clients" />
          </div>

          {/* Charts */}
          <H2>Fee Remaining by Partner &amp; PM</H2>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
            <Panel title={`By Partner ${includePR?'(O + PR)':'(O only)'}`} meta={MD_META} action={prToggle} pad>
              <StackedFeeChart data={partnerChartData} includePR={includePR} />
            </Panel>
            <Panel title={`By PM ${includePR?'(O + PR)':'(O only)'}`} meta={MD_META} action={prToggle} pad>
              <StackedFeeChart data={pmChartData} includePR={includePR} />
            </Panel>
          </div>

          {/* Tables */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
            <Panel title="By Partner" meta={MD_META}><DataTable columns={FEE_COLUMNS('partner')} data={partnerTableData} /></Panel>
            <Panel title="By PM" meta={MD_META}><DataTable columns={FEE_COLUMNS('pm')} data={pmTableData} /></Panel>
          </div>

          {/* Aging — QuickBooks */}
          <div className="mb-6"><AgingPanel /></div>

          {/* 3-Month Rolling Averages */}
          {summaryMetrics && (
            <div className="mb-6">
              <H2>3-Month Rolling Averages <Sub>from the Master Data Summary tab</Sub></H2>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
                <Figure label="Avg Billing (3mo)" value={fmtK(summaryMetrics.billing3mo)} sub={`vs ${fmtK(summaryMetrics.billing12mo)} 12mo avg`} />
                <Figure label="Avg Expenses (3mo)" value={fmtK(summaryMetrics.expenses3mo)} sub={`vs ${fmtK(summaryMetrics.expenses12mo)} 12mo avg`} />
                <Figure label="Margin (3mo)" value={`${summaryMetrics.marginPct3}%`} sub={`vs ${summaryMetrics.marginPct12}% 12mo avg`} />
                <Figure label="Margin (3mo $)" value={fmtK(summaryMetrics.billing3mo-summaryMetrics.expenses3mo)} sub="billing minus expenses" />
              </div>

              {/* 12-Month Rolling Line Charts */}
              <H2>12-Month Rolling Trends</H2>
              <Panel title="Billing, Expenses, Pipeline & Under Contract — 12 months" meta={MD_META} className="mb-4" pad>
                <ResponsiveContainer width="100%" height={300}>
                  <LineChart data={summaryMetrics.last12} margin={{top:5,right:20,left:10,bottom:5}}>
                    <CartesianGrid strokeDasharray="3 3" stroke={GRID} vertical={false} />
                    <XAxis dataKey="month" tick={TICK} interval={0} angle={-35} textAnchor="end" height={50} axisLine={{stroke:GRID}} tickLine={false} />
                    <YAxis tickFormatter={fmtK} tick={TICK} axisLine={false} tickLine={false} />
                    <Tooltip formatter={v=>fmtFull(v)} {...TOOLTIP_STYLE} />
                    <Legend iconType="plainline" wrapperStyle={{fontSize:12}} />
                    <Line type="monotone" dataKey="billing" stroke={MAGENTA} strokeWidth={2.5} dot={{r:3}} name="Billing" />
                    <Line type="monotone" dataKey="expenses" stroke={INK} strokeWidth={2} dot={{r:3}} name="Expenses" />
                    <Line type="monotone" dataKey="pipeline" stroke={GRAY} strokeWidth={2} dot={{r:3}} strokeDasharray="4 2" name="Pipeline" />
                    <Line type="monotone" dataKey="underContract" stroke={GRAY} strokeWidth={2} dot={{r:3}} name="Under Contract" />
                  </LineChart>
                </ResponsiveContainer>
              </Panel>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
                <Panel title="Billing vs Expenses" meta={MD_META} pad>
                  <ResponsiveContainer width="100%" height={220}>
                    <LineChart data={summaryMetrics.last12}>
                      <CartesianGrid strokeDasharray="3 3" stroke={GRID} vertical={false} />
                      <XAxis dataKey="month" tick={{...TICK,fontSize:10}} interval={0} angle={-35} textAnchor="end" height={45} axisLine={{stroke:GRID}} tickLine={false} />
                      <YAxis tickFormatter={fmtK} tick={{...TICK,fontSize:10}} axisLine={false} tickLine={false} />
                      <Tooltip formatter={v=>fmtFull(v)} {...TOOLTIP_STYLE} />
                      <Legend iconType="plainline" wrapperStyle={{fontSize:12}} />
                      <Line type="monotone" dataKey="billing" stroke={MAGENTA} strokeWidth={2.5} dot={{r:2}} name="Billing" />
                      <Line type="monotone" dataKey="expenses" stroke={INK} strokeWidth={2} dot={{r:2}} name="Expenses" />
                      <ReferenceLine y={summaryMetrics.billing12mo} stroke={GRAY} strokeDasharray="3 3" label={{value:'Billing avg',fill:GRAY,fontSize:9}} />
                    </LineChart>
                  </ResponsiveContainer>
                </Panel>
                <Panel title="Monthly Margin %" meta={MD_META} pad>
                  <ResponsiveContainer width="100%" height={220}>
                    <LineChart data={summaryMetrics.last12.map(r=>{const b=r.billing||0;const e=r.expenses||0;return{...r,marginPct:b>0?Math.round(((b-e)/b)*100):0,margin:b-e};})} margin={{top:5,right:10,left:10,bottom:5}}>
                      <CartesianGrid strokeDasharray="3 3" stroke={GRID} vertical={false} />
                      <XAxis dataKey="month" tick={{...TICK,fontSize:10}} interval={0} angle={-35} textAnchor="end" height={45} axisLine={{stroke:GRID}} tickLine={false} />
                      <YAxis tickFormatter={v=>`${v}%`} tick={{...TICK,fontSize:10}} axisLine={false} tickLine={false} />
                      <Tooltip formatter={(v,name)=>name==='Margin %'?`${v}%`:fmtFull(v)} {...TOOLTIP_STYLE} />
                      <ReferenceLine y={0} stroke={INK} strokeWidth={1.5} />
                      <ReferenceLine y={summaryMetrics.marginPct12} stroke={GRAY} strokeDasharray="3 3" label={{value:`${summaryMetrics.marginPct12}% avg`,fill:GRAY,fontSize:9}} />
                      <Line type="monotone" dataKey="marginPct" stroke={MAGENTA} strokeWidth={2.5} dot={{r:2}} name="Margin %" />
                    </LineChart>
                  </ResponsiveContainer>
                </Panel>
              </div>
            </div>
          )}
          {!summaryMetrics && (
            <Panel title="Rolling trends" meta="Master Data · Summary tab" className="mb-6" pad>
              <p className="text-sm text-muted m-0">Historical billing data not yet loaded — ensure the Summary tab is present in HDLA Master Data.xlsx</p>
            </Panel>
          )}
        </div>
      )}

      {/* ═══ LOCATION TABS (Nashville / Dallas / Raleigh) ═══ */}
      {(tab === 'nashville' || tab === 'dallas' || tab === 'raleigh') && (() => {
        const locExec = tab === 'nashville' ? execNashville : tab === 'dallas' ? execDallas : execRaleigh;
        const locLabel = tab === 'nashville' ? 'Nashville' : tab === 'dallas' ? 'Dallas' : 'Raleigh';

        // ─── 3mo Avg Invoiced (past 3 complete months) and 3mo Avg Projected (next 3 months) from projections ───
        // Past months in projections are reconciled to actuals at end of each month, so they're treated as invoiced.
        // Current + future months are forecasts.
        const now = new Date();
        const pastMonths = [];
        const futureMonths = [];
        for (let i = 1; i <= 3; i++) {
          const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
          pastMonths.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
        }
        for (let i = 0; i < 3; i++) {
          const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
          futureMonths.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
        }
        // Month before the earliest past month, for delta computation on the first past month
        const beforePast = new Date(now.getFullYear(), now.getMonth() - 4, 1);
        const beforePastKey = `${beforePast.getFullYear()}-${String(beforePast.getMonth() + 1).padStart(2, '0')}`;
        const beforeFuture = new Date(now.getFullYear(), now.getMonth() - 1, 1);
        const beforeFutureKey = `${beforeFuture.getFullYear()}-${String(beforeFuture.getMonth() + 1).padStart(2, '0')}`;

        // Build project list for this location (same construction as computeCapacity)
        const locRawProjects = masterData.filter(r =>
          (r.Status === 'O' || r.Status === 'PR') &&
          (r.Location || '').toLowerCase() === locLabel.toLowerCase()
        );
        const locPhaseCount = {};
        locRawProjects.forEach(r => {
          const key = `${r['Project #']}-${r['Phase']}`;
          locPhaseCount[key] = (locPhaseCount[key] || 0) + 1;
        });
        const locProjectsForBilling = locRawProjects.map(r => {
          const baseKey = `${r['Project #']}-${r['Phase']}`;
          const hasDuplicates = locPhaseCount[baseKey] > 1;
          const nameSuffix = hasDuplicates ? `-${(r['Project Name'] || '').replace(/[^a-zA-Z0-9]/g, '').slice(-15)}` : '';
          return {
            id: `${baseKey}${nameSuffix}`,
            fee: r['Fee'] || 0,
            previouslyBilledPct: r['Previously Billed %'] || 0,
          };
        });

        // Sum billing for a window of months
        const sumBillingForMonths = (monthList, prevKey) => {
          let total = 0;
          locProjectsForBilling.forEach(project => {
            const projData = projections[project.id];
            if (!projData?.months) return;
            monthList.forEach((monthKey, idx) => {
              const pct = projData.months[monthKey];
              if (pct == null || pct === '') return;
              let prevPct;
              if (idx === 0) {
                prevPct = projData.months[prevKey];
                if (prevPct == null || prevPct === '') prevPct = project.previouslyBilledPct;
              } else {
                prevPct = projData.months[monthList[idx - 1]];
                if (prevPct == null || prevPct === '') prevPct = project.previouslyBilledPct;
              }
              total += Math.max(0, ((pct - prevPct) / 100) * project.fee);
            });
          });
          return total;
        };

        const invoiced3moTotal = sumBillingForMonths(pastMonths.slice().reverse(), beforePastKey);
        const projected3moTotal = sumBillingForMonths(futureMonths, beforeFutureKey);
        const avgInvoiced3mo = invoiced3moTotal / 3;
        const avgProjected3mo = projected3moTotal / 3;

        // ─── Weighted Pipeline (proposals × H/M/L weights) for this location ───
        const PROP_WEIGHTS = { H: 0.85, M: 0.65, L: 0.25, XL: 0 };
        const locProposals = (proposals || []).filter(p =>
          !['Awarded','Not Awarded','Declined'].includes(p.status) &&
          (p.office || '').toLowerCase() === locLabel.toLowerCase()
        );
        const weightedPipeline = locProposals.reduce((s, p) => {
          const w = PROP_WEIGHTS[p.probability] ?? 0.5;
          return s + (p.fee || 0) * w;
        }, 0);
        const rawPipeline = locProposals.reduce((s, p) => s + (p.fee || 0), 0);
        const pipelineCounts = {
          H: locProposals.filter(p => p.probability === 'H').length,
          M: locProposals.filter(p => p.probability === 'M').length,
          L: locProposals.filter(p => p.probability === 'L').length,
          XL: locProposals.filter(p => p.probability === 'XL').length,
        };

        const locPartnerChart = PARTNERS.map(p => ({
          name: p,
          O: locExec.feeByPartnerO[p]||0,
          PR: includePR ? (locExec.feeByPartnerPR[p]||0) : 0,
        }));
        const locPmChart = Object.keys(locExec.feeByPM_O)
          .map(pm => ({
            name: pm,
            O: locExec.feeByPM_O[pm]||0,
            PR: includePR ? (locExec.feeByPM_PR[pm]||0) : 0,
            combined: (locExec.feeByPM_O[pm]||0) + (locExec.feeByPM_PR[pm]||0),
          }))
          .filter(r => r.combined > 0)
          .sort((a,b) => b.combined - a.combined)
          .slice(0,8);
        const locPartnerTable = PARTNERS.map(p => ({
          partner: p,
          o: locExec.feeByPartnerO[p]||0,
          pr: locExec.feeByPartnerPR[p]||0,
          combined: (locExec.feeByPartnerO[p]||0) + (locExec.feeByPartnerPR[p]||0),
        })).filter(r => r.combined > 0);
        const locPmTable = Object.keys(locExec.feeByPM_O)
          .map(pm => ({
            pm,
            o: locExec.feeByPM_O[pm]||0,
            pr: locExec.feeByPM_PR[pm]||0,
            combined: (locExec.feeByPM_O[pm]||0) + (locExec.feeByPM_PR[pm]||0),
          }))
          .filter(r => r.combined > 0)
          .sort((a,b) => b.combined - a.combined);

        const hasData = locExec.totalFeeO > 0 || locExec.totalFeePR > 0;

        return (
          <div>
            {!hasData && (
              <Panel title={`No projects found for ${locLabel}`} meta={MD_META} className="mb-6" pad>
                <p className="text-sm text-muted m-0">Verify the Location column (column C) in HDLA Master Data.xlsx is populated with &ldquo;{locLabel}&rdquo; for relevant projects.</p>
              </Panel>
            )}

            {/* Fee Remaining */}
            <H2>Fee Remaining — {locLabel}</H2>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-6">
              <Figure label="Under Contract (O)" value={fmtFull(locExec.totalFeeO)} sub="Master Data" />
              <Figure label="Projected (PR)" value={fmtFull(locExec.totalFeePR)} sub="Master Data" />
              <Figure label="Combined" value={fmtFull(locExec.totalFeeO + locExec.totalFeePR)} sub="O + PR" />
              <Figure label="Projects (O)" value={locExec.projectCountO} sub="distinct project numbers" />
              <Figure label="Clients (O)" value={locExec.clientCount} sub="distinct clients" />
            </div>

            {/* Billing — Invoiced (past 3mo actuals) + Projected (next 3mo forecast) */}
            <H2>Billing — {locLabel} <Sub>from work plan projections</Sub></H2>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
              <Figure label="3mo Avg Invoiced" value={fmtK(avgInvoiced3mo)} sub={`${fmtK(invoiced3moTotal)} total past 3mo`} />
              <Figure label="3mo Avg Projected" value={fmtK(avgProjected3mo)} sub={`${fmtK(projected3moTotal)} total next 3mo`} />
              <Figure label="Past 3mo Window" value={`${pastMonths[2]?.slice(5)}–${pastMonths[0]?.slice(5)}`} sub="reconciled actuals" />
              <Figure label="Next 3mo Window" value={`${futureMonths[0]?.slice(5)}–${futureMonths[2]?.slice(5)}`} sub="PM forecast" />
            </div>

            {/* Pipeline — Weighted proposals for this location */}
            <H2>Pipeline — {locLabel} <Sub>weighted proposals · Marketing</Sub></H2>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-2">
              <Figure label="Weighted Pipeline" value={fmtK(weightedPipeline)} sub={`${fmtK(rawPipeline)} raw fee`} />
              <Figure label="High (×0.85)" value={pipelineCounts.H} sub="probability H" />
              <Figure label="Medium (×0.65)" value={pipelineCounts.M} sub="probability M" />
              <Figure label="Low (×0.25)" value={pipelineCounts.L} sub="probability L" />
            </div>
            {pipelineCounts.XL > 0 && (
              <div className="text-xs text-muted mb-6 ml-1">+ {pipelineCounts.XL} XL (excluded — long-shot, 0 weight)</div>
            )}
            {pipelineCounts.XL === 0 && <div className="mb-6" />}

            {/* Charts */}
            {hasData && (
              <>
                <H2>Fee Remaining by Partner &amp; PM — {locLabel}</H2>
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
                  <Panel title={`By Partner ${includePR?'(O + PR)':'(O only)'}`} meta={MD_META} action={prToggle} pad>
                    <StackedFeeChart data={locPartnerChart} includePR={includePR} />
                  </Panel>
                  <Panel title={`By PM ${includePR?'(O + PR)':'(O only)'}`} meta={MD_META} action={prToggle} pad>
                    <StackedFeeChart data={locPmChart} includePR={includePR} />
                  </Panel>
                </div>

                {/* Tables */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
                  <Panel title="By Partner" meta={MD_META}><DataTable columns={FEE_COLUMNS('partner')} data={locPartnerTable} /></Panel>
                  <Panel title="By PM" meta={MD_META}><DataTable columns={FEE_COLUMNS('pm')} data={locPmTable} /></Panel>
                </div>
              </>
            )}

            {/* Expenses — QuickBooks */}
            <div className="mb-6"><ExpensesPanel locLabel={locLabel} fin={fin} /></div>
          </div>
        );
      })()}

      {/* ═══ PIPELINE TAB ═══ */}
      {tab === 'pipeline' && (() => {
        const WEIGHTS = {H:.85,M:.65,L:.25,XL:0};
        const openProps = proposals.filter(p=>!['Awarded','Not Awarded','Declined'].includes(p.status));
        const awardedProps = proposals.filter(p=>p.status==='Awarded');
        const clientMap = {};
        clients.forEach(c=>{clientMap[c.id]=c.name;});

        const totalRaw = openProps.reduce((s,p)=>s+(p.fee||0),0);
        const totalWeighted = openProps.reduce((s,p)=>s+(p.fee||0)*(WEIGHTS[p.probability]||0),0);

        const byProb = {};
        ['H','M','L','XL'].forEach(pr=>{
          const group = openProps.filter(p=>p.probability===pr);
          byProb[pr] = { count: group.length, raw: group.reduce((s,p)=>s+(p.fee||0),0), weighted: group.reduce((s,p)=>s+(p.fee||0)*(WEIGHTS[pr]||0),0) };
        });

        const byPartner = {};
        openProps.forEach(p=>{
          const pa = p.partner||'—';
          if(!byPartner[pa]) byPartner[pa]={count:0,raw:0,weighted:0};
          byPartner[pa].count++;
          byPartner[pa].raw+=(p.fee||0);
          byPartner[pa].weighted+=(p.fee||0)*(WEIGHTS[p.probability]||0);
        });

        const daysBetween = s => { if(!s) return null; return Math.floor((Date.now()-new Date(s).getTime())/864e5); };

        return (
          <div>
            {/* Pipeline Summary */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
              <Figure label="Open Proposals" value={openProps.length} sub="Marketing" />
              <Figure label="Total Pipeline (Raw)" value={fmtFull(totalRaw)} sub="sum of open fees" />
              <Figure label="Weighted Pipeline" value={fmtFull(totalWeighted)} accent sub="H ×0.85 · M ×0.65 · L ×0.25" />
              <Figure label="Awarded YTD" value={awardedProps.length} sub={fmtFull(awardedProps.reduce((s,p)=>s+(p.fee||0),0))} />
            </div>

            {/* By Probability */}
            <Panel title="Pipeline by Probability" meta={MKT_META} className="mb-6" pad>
              <div className="grid grid-cols-4 gap-4">
                {['H','M','L','XL'].map(pr=>(
                  <div key={pr} className="text-center">
                    <div className="mb-2"><Pill>{pr} · {Math.round((WEIGHTS[pr]||0)*100)}%</Pill></div>
                    <div className="font-flecha text-2xl leading-none">{fmtFull(byProb[pr]?.weighted||0)}</div>
                    <div className="text-xs text-muted mt-1.5">{byProb[pr]?.count||0} · {fmtFull(byProb[pr]?.raw||0)}</div>
                  </div>
                ))}
              </div>
            </Panel>

            {/* By Partner */}
            <Panel title="Pipeline by Partner" meta={MKT_META} className="mb-6">
              <DataTable columns={[
                {header:'Partner', key:'partner'},
                {header:'Count', key:'count', align:'right'},
                {header:'Raw', key:'raw', align:'right', render:v=>fmtFull(v)},
                {header:'Weighted', key:'weighted', align:'right', render:v=>fmtFull(v)},
              ]} data={Object.entries(byPartner).map(([k,v])=>({partner:k,...v})).sort((a,b)=>b.weighted-a.weighted)} />
            </Panel>

            {/* Open Proposals Table */}
            <Panel title={`Open Proposals (${openProps.length})`} meta={MKT_META} className="mb-6">
              <DataTable columns={[
                {header:'Project', key:'projectName'},
                {header:'Client', key:'clientName'},
                {header:'Partner', key:'partner'},
                {header:'Fee', key:'fee', align:'right', render:v=>fmtFull(v)},
                {header:'Prob', key:'probability', render:v=><ProbPill v={v} />},
                {header:'Status', key:'status', render:v=>v?<Pill>{v}</Pill>:'—'},
                {header:'Due', key:'dueDate', render:v=>v?new Date(v).toLocaleDateString('en-US',{month:'short',day:'numeric'}):'—'},
                {header:'Days Open', key:'daysOpen', align:'right', render:v=>v!==null?v:'—'},
              ]} data={openProps.map(p=>({...p,clientName:clientMap[p.clientId]||'—',daysOpen:daysBetween(p.submittedDate||p.dueDate)})).sort((a,b)=>(b.fee||0)-(a.fee||0))} />
            </Panel>

            {/* Recent Awards */}
            {awardedProps.length > 0 && (
              <Panel title={`Awarded (${awardedProps.length})`} meta={MKT_META} className="mb-6">
                <DataTable columns={[
                  {header:'Project', key:'projectName'},
                  {header:'Client', key:'clientName'},
                  {header:'Partner', key:'partner'},
                  {header:'Fee', key:'fee', align:'right', render:v=>fmtFull(v)},
                  {header:'Awarded', key:'awardedDate', render:v=>v?new Date(v).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'}):'—'},
                ]} data={awardedProps.map(p=>({...p,clientName:clientMap[p.clientId]||'—'})).sort((a,b)=>new Date(b.awardedDate||0)-new Date(a.awardedDate||0))} />
              </Panel>
            )}
          </div>
        );
      })()}

      {/* ═══ CAPACITY TAB ═══ */}
      {tab === 'capacity' && (
        <div>
          {/* View toggle */}
          <div className="mb-5">
            <Segmented value={capacityView} onChange={setCapacityView} options={[{id:'both',label:'Side by Side'},{id:'fee',label:'Fee-Based (12mo)'},{id:'proj',label:'Projection-Based (3mo)'},{id:'hours',label:'Hours-Based (Work Plan)'}]} />
          </div>

          {/* Side by side cards */}
          {(capacityView==='both'||capacityView==='fee'||capacityView==='proj') && (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
              {PRINCIPALS.map(pm => {
                const t = capacity[pm];
                return (
                  <Panel key={pm} title={`${pm} — ${t.office}`} meta={`${t.teamSize} ppl`} pad>
                    <div className="space-y-4">
                      {(capacityView==='both'||capacityView==='fee') && (
                        <div>
                          <div className="flex items-center justify-between gap-2 mb-1"><div className="text-[11px] tracking-[0.08em] uppercase text-muted">Fee-Based · 12mo</div><StatusPill status={t.status12} /></div>
                          <div className={'font-flecha text-[30px] leading-none ' + (t.status12==='hire'?'text-status-red':t.status12==='watch'?'text-status-amber':'')}>{t.crunch12}%</div>
                          <div className="text-xs text-muted mt-1.5">{fmtK(t.feeRemaining)} remaining ÷ {fmtK(t.capacity12)} capacity</div>
                        </div>
                      )}
                      {(capacityView==='both'||capacityView==='proj') && (
                        <div className={capacityView==='both' ? 'pt-4 border-t border-hair' : ''}>
                          <div className="flex items-center justify-between gap-2 mb-1"><div className="text-[11px] tracking-[0.08em] uppercase text-muted">Projections · 3mo</div><StatusPill status={t.status3} /></div>
                          <div className={'font-flecha text-[30px] leading-none ' + (t.status3==='hire'?'text-status-red':t.status3==='watch'?'text-status-amber':'')}>{t.crunch3}%</div>
                          <div className="text-xs text-muted mt-1.5">{fmtK(t.projectedBilling)} projected ÷ {fmtK(t.capacity3)} capacity</div>
                        </div>
                      )}
                    </div>
                  </Panel>
                );
              })}
            </div>
          )}

          {/* Hours-based cards */}
          {capacityView==='hours' && (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
              {PRINCIPALS.map(pm => {
                const t = hoursCapacity[pm];
                return (
                  <Panel key={pm} title={`${pm} — ${t.office}`} meta={<StatusPill status={t.statusHours} />} pad>
                    <div className={'font-flecha text-[30px] leading-none ' + (t.statusHours==='hire'?'text-status-red':t.statusHours==='watch'?'text-status-amber':'')}>{t.crunchHours}%</div>
                    <div className="text-xs text-muted mt-1.5">{t.teamSize} ppl · {t.assignedHours}h assigned / {t.totalCapacityHours}h cap (3mo)</div>
                  </Panel>
                );
              })}
            </div>
          )}

          {/* Tables */}
          <Panel className="mb-6" title={capacityView==='hours'?'Hours Assigned (12-week)':capacityView==='fee'?'Fee-Based Capacity (12-month)':capacityView==='proj'?'Projection-Based Capacity (3-month)':'Dual Capacity View'} meta={capacityView==='hours'?WP_META:`${MD_META} · ${PROJ_META}`}>
            {capacityView==='hours'?<DataTable columns={[
              {header:'Principal', key:'principal'},
              {header:'Name', key:'name'},
              {header:'Team', key:'teamSize', align:'right'},
              {header:'Hrs Assigned', key:'assignedHours', align:'right', render:v=>`${v}h`},
              {header:'Hrs Capacity', key:'totalCapacityHours', align:'right', render:v=>`${v}h`},
              {header:'Load %', key:'crunchHours', align:'right', render:(v,row)=>(<span className={pctCls(row.statusHours)}>{v}%</span>)},
              {header:'Status', key:'statusHours', render:v=><StatusPill status={v} />},
            ]} data={PRINCIPALS.map(pm=>({principal:pm,...hoursCapacity[pm]}))} />
            :<DataTable columns={[
              {header:'Principal', key:'principal'},
              {header:'Name', key:'name'},
              {header:'Team', key:'teamSize', align:'right'},
              {header:'Fee Remaining', key:'feeRemaining', align:'right', render:v=>fmtK(v)},
              {header:'12mo Crunch', key:'crunch12', align:'right', render:(v,row)=>(<span className={pctCls(row.status12)}>{v}%</span>)},
              {header:'3mo Projected', key:'projectedBilling', align:'right', render:v=>fmtK(v)},
              {header:'3mo Crunch', key:'crunch3', align:'right', render:(v,row)=>(<span className={pctCls(row.status3)}>{v}%</span>)},
            ]} data={PRINCIPALS.map(pm=>({principal:pm,...capacity[pm]}))} />}
          </Panel>

          {/* Formula */}
          <Panel title="The Formulas" meta="$21K per person per month" className="mb-6" pad>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
              <div className="border border-rule rounded p-4">
                <div className="text-[11px] tracking-[0.08em] uppercase text-muted mb-2">Fee-Based (12-month)</div>
                <div className="font-mono text-[13px]">Crunch % = Total Fee Remaining ÷ (Team × $21K × 12)</div>
                <div className="text-xs text-muted mt-1">Big picture — do we have enough work for the year?</div>
              </div>
              <div className="border border-rule rounded p-4">
                <div className="text-[11px] tracking-[0.08em] uppercase text-muted mb-2">Projection-Based (3-month)</div>
                <div className="font-mono text-[13px]">Crunch % = Projected Billing (next 3mo) ÷ (Team × $21K × 3)</div>
                <div className="text-xs text-muted mt-1">Near-term crunch — do we need to hire now?</div>
              </div>
            </div>
            <div className="flex flex-wrap gap-6 text-[13px]">
              <div className="flex items-center gap-2"><Pill>healthy</Pill><span>&lt;100%</span></div>
              <div className="flex items-center gap-2"><Pill kind="amber">watch</Pill><span>100–125%</span></div>
              <div className="flex items-center gap-2"><Pill kind="red">Hire now</Pill><span>&gt;125%</span></div>
            </div>
          </Panel>

          {/* Team rosters */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {PRINCIPALS.map(pm => {
              const t = capacity[pm];
              return (
                <Panel key={pm} title={`Team ${pm}`} meta={<span>{t.name} · {t.office}</span>} action={<StatusPill status={t.status3} />}>
                  <ul className="m-0 p-0 list-none">
                    {t.members.map(m=>(
                      <li key={m} className="text-[13px] px-5 py-2 border-b border-hair last:border-b-0">{m}</li>
                    ))}
                  </ul>
                </Panel>
              );
            })}
          </div>
        </div>
      )}

      {/* ═══ PROJECT HEALTH TAB ═══ */}
      {tab === 'health' && (
        <div>
          {/* Sort controls */}
          <div className="flex items-center gap-3 mb-5">
            <span className="text-xs text-muted">Sort by</span>
            <Segmented value={healthSortBy} onChange={setHealthSortBy} options={[{id:'principal',label:'Principal'},{id:'partner',label:'Partner (needs review first)'}]} />
          </div>
          {/* Health summary */}
          <div className="grid grid-cols-3 gap-4 mb-6">
            <Figure label="Good" value={health.counts.Good} sub="No issues flagged" />
            <Figure label="Watch" value={health.counts.Watch} sub="Internal or external concern" />
            <Figure label="Poor" value={health.counts.Poor} sub="Needs immediate attention" red={health.counts.Poor > 0} />
          </div>

          {/* Needs Partner Review */}
          {health.needsReview.length > 0 && (
            <Panel title={`Needs Partner Review (${health.needsReview.length})`} meta={WP_META} className="mb-4">
              {health.needsReview.map(p => (
                <div key={p.id} className="px-5 py-2.5 border-b border-hair last:border-b-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-bold text-[13px]">{p.projectName}</span>
                    <Pill>{p.principal}</Pill>
                    <span className="text-xs text-status-red font-bold">{(p.needsReview||[]).join(', ')}</span>
                  </div>
                  {p.partnerNeeds && <div className="text-[13px] text-muted mt-1 italic">&ldquo;{p.partnerNeeds}&rdquo;</div>}
                </div>
              ))}
            </Panel>
          )}

          {/* Project Needs */}
          {health.hasNeeds.length > 0 && (
            <Panel title={`Project Needs (${health.hasNeeds.length})`} meta={WP_META} className="mb-4">
              {health.hasNeeds.map(p => (
                <div key={p.id} className="px-5 py-2.5 border-b border-hair last:border-b-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-bold text-[13px]">{p.projectName}</span>
                    <Pill>{p.principal}</Pill>
                  </div>
                  <div className="text-[13px] text-status-amber mt-0.5">{p.needs}</div>
                </div>
              ))}
            </Panel>
          )}

          {/* All projects — sorted by principal or partner */}
          {healthSortBy==='principal'?PRINCIPALS.map(pm => {
            const pmProjects = projects.filter(p => p.principal === pm);
            if (pmProjects.length === 0) return null;
            return (
              <Panel key={pm} title={TEAM_STRUCTURE[pm].name} meta={`${pmProjects.length} projects · ${WP_META}`} className="mb-4">
                <DataTable columns={[
                  {header:'Project', key:'projectName'},
                  {header:'Phase', key:'phase'},
                  {header:'Internal', key:'internalHealth', render:v=><HealthPill v={v} />},
                  {header:'External', key:'externalHealth', render:v=><HealthPill v={v} />},
                  {header:'Partners', key:'partnersInCharge', render:v=>(v||[]).join(', ')||'—'},
                  {header:'Review', key:'needsReview', render:v=>(v||[]).length>0?<span className="text-status-red font-bold text-xs">YES</span>:<span className="text-done">—</span>},
                ]} data={pmProjects} />
              </Panel>
            );
          }):PARTNERS.map(partner => {
            const partnerProjects = projects.filter(p=>(p.partnersInCharge||[]).includes(partner)||(p.partner||'')==='RJ'&&partner==='RJ');
            const reviewFirst = [...partnerProjects].sort((a,b)=>(b.needsReview||[]).length-(a.needsReview||[]).length);
            if (reviewFirst.length === 0) return null;
            const nReview = reviewFirst.filter(p=>(p.needsReview||[]).length>0).length;
            return (
              <Panel key={partner} title={`Partner ${partner}`} meta={<span>{reviewFirst.length} projects{nReview>0&&<span className="ml-2 text-status-red font-bold">{nReview} need review</span>} · {WP_META}</span>} className="mb-4">
                <DataTable columns={[
                  {header:'Project', key:'projectName'},
                  {header:'Principal', key:'principal'},
                  {header:'Phase', key:'phase'},
                  {header:'Internal', key:'internalHealth', render:v=><HealthPill v={v} />},
                  {header:'External', key:'externalHealth', render:v=><HealthPill v={v} />},
                  {header:'Review', key:'needsReview', render:v=>(v||[]).length>0?<span className="text-status-red font-bold text-xs">YES — {(v||[]).join(', ')}</span>:<span className="text-done">—</span>},
                ]} data={reviewFirst} />
              </Panel>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default function ExecDashboard() {
  return (
    <Shell module="exec" eyebrow="Executive · Master Data + Marketing + Work Plan" title="Executive Summary">
      <ExecDashboardInner />
    </Shell>
  );
}
