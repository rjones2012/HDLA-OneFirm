'use client';
// Admin: QuickBooks connection and pulls, manual uploads until QuickBooks is live, people & rates, data admin.
import { useEffect, useState } from 'react';
import * as XLSX from 'xlsx';
import { Shell } from '../../components/shell/Shell';
import { Panel, Button, Link, Pill, Empty, Select, Label, fmt$ } from '../../components/shell/ui';

const fmtWhen = s => s ? new Date(s).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—';

export default function AdminPage() {
  const [qb, setQb] = useState(null);
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState('');
  const [notice, setNotice] = useState('');

  const load = () => fetch('/api/quickbooks').then(r => r.json()).then(setQb).catch(() => setQb({ error: true }));
  useEffect(() => { load(); const q = new URLSearchParams(window.location.search); const s = q.get('qbo'); if (s === 'connected') setNotice(`QuickBooks connected${q.get('company') ? ': ' + q.get('company') : ''}. First pull has run — status below.`); else if (s === 'denied') setNotice('QuickBooks connection was cancelled.'); else if (s === 'error') setNotice('QuickBooks error: ' + (q.get('message') || 'unknown')); else if (s === 'badstate') setNotice('That connection link had expired — try Connect again.'); }, []);

  const connect = async () => { setBusy('connect'); const r = await fetch('/api/quickbooks/connect'); const d = await r.json(); setBusy(''); if (d.url) window.location.href = d.url; else setMsg(d.error || 'Could not start the connection'); };
  const pull = async realmId => { setBusy('pull'); setMsg(''); const r = await fetch('/api/quickbooks/sync', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ realmId }) }); const d = await r.json(); setBusy(''); setMsg(d.ok ? 'Pulled: ' + d.results.map(x => x.detail).join(' · ') : 'Pull failed: ' + (d.results || []).map(x => x.detail).join(' · ') + (d.error || '')); load(); };
  const disconnect = async realmId => { if (!confirm('Disconnect this QuickBooks company? Pulled data stays until the next pull.')) return; setMsg(''); const r = await fetch('/api/quickbooks/disconnect', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ realmId }) }); const d = await r.json().catch(() => ({})); if (!r.ok) setMsg(d.error === 'Not allowed for your role' ? 'Only a partner can disconnect QuickBooks.' : 'Disconnect failed: ' + (d.error || r.status)); load(); };

  return (
    <Shell module="admin" eyebrow="Admin · partners and operations" title="Admin">
      {notice && <div className="mb-5 text-sm bg-accent-tint border border-rule rounded px-4 py-3">{notice}</div>}
      <div className="grid grid-cols-2 gap-6">
        <Panel title="QuickBooks Online" meta={qb && !qb.error ? <span>{qb.environment === 'production' ? 'Production' : 'Sandbox'} · {qb.configured ? 'keys set' : 'keys missing'}</span> : 'Loading…'} action={qb?.configured ? <Button onClick={connect} disabled={busy === 'connect'} className="h-8 px-3">{qb.connections?.length ? '+ Connect another company' : 'Connect to QuickBooks'}</Button> : null}>
          {!qb ? null : qb.error ? <Empty>Could not load status.</Empty> : !qb.configured ? (
            <div className="p-5 text-sm">Set <code className="text-xs">QBO_CLIENT_ID</code>, <code className="text-xs">QBO_CLIENT_SECRET</code>, <code className="text-xs">QBO_REDIRECT_URI</code> and <code className="text-xs">QBO_TOKEN_SECRET</code> in the Vercel project, redeploy, then connect. The redirect URI must match the one registered on the Intuit app.</div>
          ) : qb.connections.length === 0 ? <Empty>Not connected. Click Connect, sign in to QuickBooks as an admin, and approve.</Empty> : (
            <div className="flex flex-col">
              {qb.connections.map(c => (
                <div key={c.realm_id} className="px-5 py-3.5 border-b border-hair last:border-0 flex justify-between items-start gap-4 flex-wrap">
                  <div>
                    <div className="font-bold text-sm">{c.company_name || 'QuickBooks company'} <span className="text-xs text-muted font-normal">· {c.realm_id}</span></div>
                    <div className="text-xs text-muted">Connected by {c.connected_by || '—'} {fmtWhen(c.connected_at)} · last pull {fmtWhen(c.last_sync_at)} {c.last_sync_status && <Pill kind={c.last_sync_status === 'ok' ? 'solid' : 'red'}>{c.last_sync_status === 'ok' ? 'ok' : 'error'}</Pill>}</div>
                    {c.last_sync_status && c.last_sync_status !== 'ok' && <div className="text-xs text-status-red mt-1">{c.last_sync_status}</div>}
                    <div className="text-xs text-muted mt-1">Refresh token good until {fmtWhen(c.refresh_expires_at)} — renews on every nightly pull.</div>
                  </div>
                  <div className="flex gap-3 items-center"><Button variant="secondary" onClick={() => pull(c.realm_id)} disabled={busy === 'pull'} className="h-8 px-3">{busy === 'pull' ? 'Pulling…' : 'Pull now'}</Button><button type="button" onClick={() => disconnect(c.realm_id)} className="text-xs text-muted hover:text-status-red">Disconnect</button></div>
                </div>
              ))}
            </div>
          )}
          {msg && <div className="px-5 py-3 text-xs border-t border-hair">{msg}</div>}
          {qb?.runs?.length > 0 && <div className="px-5 py-3 border-t border-hair"><div className="text-[11px] uppercase tracking-[0.06em] text-muted mb-1">Recent pulls</div>{qb.runs.slice(0, 5).map(r => <div key={r.id} className="text-xs text-muted">{fmtWhen(r.started_at)} · <span className={r.status === 'ok' ? '' : 'text-status-red'}>{r.status}</span> · {r.detail}</div>)}</div>}
          <div className="px-5 py-3 border-t border-hair text-xs text-muted">Read-only: P&amp;L by month, A/R aging, A/P aging, pulled nightly at 5:30 am Central. Nothing is ever written to QuickBooks.</div>
        </Panel>

        <Uploads />

        <Panel title="People, rates and time accounts" meta="Time · partners and operations">
          <div className="p-5 text-sm flex flex-col gap-2">
            <div>Titles, fee charts (2022–2026), project rate overrides and the internal time accounts are managed on the Time module&apos;s Rates view.</div>
            <Link href="/time?view=rates">Open Rates →</Link>
          </div>
        </Panel>

        <Panel title="Data" meta="Work Plan · Master Data">
          <div className="p-5 text-sm flex flex-col gap-2">
            <div>Projection keys that no longer match a Master Data line, and the one-time migrations, are under the Work Plan dashboard&apos;s Data admin tab.</div>
            <Link href="/workplan?view=dashboard&tab=admin">Open Data admin →</Link>
            <div className="text-xs text-muted mt-2">Nightly backup of projects and projections to SharePoint runs at 2:00 am Central (needs <code>CRON_SECRET</code> set in Vercel).</div>
          </div>
        </Panel>
      </div>
    </Shell>
  );
}

// ── Manual uploads: QuickBooks exports parsed in the browser, until the API connection is live ──
const KIND_BY_HEADER = [['income', /^(total )?income$/i], ['cogs', /cost of goods sold/i], ['expense', /^(total )?expenses$/i], ['other_income', /other income/i], ['other_expense', /other expense/i]];

function parsePnlSheet(ws) {
  // QuickBooks P&L export: column A = account (indented sections), last numeric column = total. Section headers set the kind.
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
  const out = []; let kind = ''; let category = '';
  for (const r of rows) {
    const label = String(r[0] || '').trim(); if (!label) continue;
    const nums = r.slice(1).map(v => (typeof v === 'number' ? v : parseFloat(String(v).replace(/[,$()]/g, '')) || 0));
    const amount = nums.filter(n => n).pop() || 0;
    const kindHit = KIND_BY_HEADER.find(([, re]) => re.test(label));
    if (kindHit && !/^total/i.test(label)) { kind = kindHit[0]; category = ''; continue; }
    if (/^total /i.test(label) || /^net /i.test(label) || /^gross /i.test(label)) continue;
    if (!kind) continue;
    if (!amount) { category = label; continue; }               // a sub-heading with no number of its own
    out.push({ kind, category: category || label, subcategory: label, amount });
  }
  return out;
}

function parseAgingSheet(ws) {
  // QuickBooks A/R Aging Detail export: find the header row, then map columns by name.
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
  const hi = rows.findIndex(r => r.some(c => /open balance/i.test(String(c))) && r.some(c => /date/i.test(String(c))));
  if (hi < 0) return [];
  const head = rows[hi].map(c => String(c).toLowerCase().trim());
  const col = (...names) => head.findIndex(h => names.includes(h));
  const iDate = col('date', 'txn date'), iNum = col('num', 'no.', 'number'), iName = col('customer', 'name', 'customer name'), iDue = col('due date'), iAmt = col('amount'), iBal = col('open balance');
  const toDate = v => { if (v instanceof Date) return v.toISOString().slice(0, 10); if (typeof v === 'number') { const d = XLSX.SSF.parse_date_code(v); return d ? `${d.y}-${String(d.m).padStart(2, '0')}-${String(d.d).padStart(2, '0')}` : ''; } const d = new Date(String(v)); return isNaN(d) ? '' : d.toISOString().slice(0, 10); };
  const num = v => (typeof v === 'number' ? v : parseFloat(String(v).replace(/[,$()]/g, '')) || 0);
  return rows.slice(hi + 1).filter(r => (iName >= 0 && r[iName]) || (iNum >= 0 && r[iNum])).map(r => ({ docNumber: String(r[iNum] ?? ''), customer: String(r[iName] ?? ''), txnDate: toDate(r[iDate]), dueDate: toDate(r[iDue]), amount: num(r[iAmt]), balance: num(r[iBal]) })).filter(r => r.balance > 0);
}

function Uploads() {
  const now = new Date(); const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const [month, setMonth] = useState(`${prev.getFullYear()}-${String(prev.getMonth() + 1).padStart(2, '0')}`);
  const [out, setOut] = useState('');
  const months = Array.from({ length: 18 }, (_, i) => { const d = new Date(now.getFullYear(), now.getMonth() - i, 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; });
  const read = f => new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(XLSX.read(fr.result, { type: 'array', cellDates: true })); fr.onerror = rej; fr.readAsArrayBuffer(f); });
  const onPnl = async e => { const f = e.target.files?.[0]; if (!f) return; try { const wb = await read(f); const rows = parsePnlSheet(wb.Sheets[wb.SheetNames[0]]); if (!rows.length) { setOut('No P&L rows recognised — expected a QuickBooks Profit and Loss export (Excel or CSV).'); return; } const r = await fetch('/api/financials', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ month, rows }) }); const d = await r.json(); setOut(d.ok ? `Saved ${d.count} P&L lines for ${month}. Expenses by category now show in Exec.` : d.error || 'Upload failed'); } catch (err) { setOut(err.message); } e.target.value = ''; };
  const onAging = async e => { const f = e.target.files?.[0]; if (!f) return; try { const wb = await read(f); const rows = parseAgingSheet(wb.Sheets[wb.SheetNames[0]]); if (!rows.length) { setOut('No invoices recognised — expected a QuickBooks A/R Aging Detail export with Date, Num, Customer, Due Date, Amount, Open Balance.'); return; } const r = await fetch('/api/aging', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ rows }) }); const d = await r.json(); setOut(d.ok ? `Saved ${d.count} open invoices${d.unmatched ? ` · ${d.unmatched} could not be matched to a project number (put "YY-NNNN" in the customer:job or invoice number)` : ''}. Aging now shows on partner homes and Exec.` : d.error || 'Upload failed'); } catch (err) { setOut(err.message); } e.target.value = ''; };
  return (
    <Panel title="Monthly uploads" meta="Until QuickBooks is connected · replaces the same month / same set">
      <div className="p-5 flex flex-col gap-4 text-sm">
        <div className="grid grid-cols-[1fr_auto] gap-3 items-end">
          <div><Label htmlFor="pnlmonth">Profit &amp; Loss — month</Label><Select id="pnlmonth" value={month} onChange={e => setMonth(e.target.value)} className="w-full">{months.map(m => <option key={m} value={m}>{m}</option>)}</Select></div>
          <label className="inline-flex items-center h-[38px] px-4 bg-ink text-white font-bold text-[13px] rounded-[3px] cursor-pointer">Upload P&amp;L<input type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={onPnl} /></label>
        </div>
        <div className="text-xs text-muted">QuickBooks → Reports → Profit and Loss → Export to Excel. One file per month. Income, cost of goods sold and expense sections are read by their headers.</div>
        <div className="flex justify-between items-center gap-3 pt-3 border-t border-hair">
          <div><div className="font-bold">A/R Aging Detail</div><div className="text-xs text-muted">QuickBooks → Reports → A/R Aging Detail → Export to Excel. Replaces the last upload; QuickBooks pulls take precedence once connected.</div></div>
          <label className="inline-flex items-center h-[38px] px-4 bg-white text-ink border border-ink font-bold text-[13px] rounded-[3px] cursor-pointer whitespace-nowrap">Upload aging<input type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={onAging} /></label>
        </div>
        {out && <div className="text-xs bg-ground border border-rule rounded px-3 py-2">{out}</div>}
      </div>
    </Panel>
  );
}
