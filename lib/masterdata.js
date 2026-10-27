// lib/masterdata.js — load HDLA Master Data.xlsx from SharePoint (server-only).
// Master Data is the firm's sacred project/fee record: read-only here, never written.
import 'server-only';
import * as XLSX from 'xlsx';
import { downloadFile } from './graph';

function parseNumber(val) {
  if (typeof val === 'number') return val;
  if (typeof val === 'string') return parseFloat(val.replace(/[$,%]/g, '')) || 0;
  return 0;
}
function parsePercent(val) {
  if (typeof val === 'number') return val > 1 ? val : val * 100;
  if (typeof val === 'string') return parseFloat(val.replace(/[$,%]/g, '')) || 0;
  return 0;
}

let cache = { at: 0, value: null };
const TTL_MS = 2 * 60 * 1000; // a short server-side cache so a sync or a page load doesn't hit SharePoint repeatedly

export async function loadMasterData({ fresh = false } = {}) {
  if (!fresh && cache.value && Date.now() - cache.at < TTL_MS) return cache.value;
  const buffer = await downloadFile('HDLA Master Data.xlsx');
  const workbook = XLSX.read(Buffer.from(buffer), { type: 'buffer' });
  const sheet = workbook.Sheets['Master Data'];
  if (!sheet) throw new Error('Master Data sheet not found');
  const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });
  const data = rows.map(row => {
    const projectNum = row['Project #'] || row['Project#'] || row['Project Number'] || '';
    return {
      'Project #': String(projectNum).trim(),
      'Project Name': String(row['Project Name'] || row['Project Name '] || '').trim(),
      'Client': String(row['Client'] || row['Client '] || '').trim(),
      'Location': String(row['Location'] || row['Office'] || '').trim(),
      'Phase': String(row['Phase'] || '').trim(),
      'PM': String(row['PM'] || '').trim(),
      'Partner': String(row['Partner'] || '').trim(),
      'Status': String(row['Status'] || '').trim(),
      'Fee': parseNumber(row['Fee']),
      'Previously Billed': parseNumber(row['Previously Billed']),
      'Previously Billed %': parsePercent(row['Previously Billed %']),
      'Fee Remaining': parseNumber(row['Fee Remaining']),
    };
  }).filter(r => r['Project #']);

  let summary = [];
  try {
    const summarySheet = workbook.Sheets['Summary'];
    if (summarySheet) {
      const summaryRows = XLSX.utils.sheet_to_json(summarySheet, { defval: '', raw: true });
      summary = summaryRows.filter(r => r['Month'] || r['month']).map(r => {
        const monthRaw = r['Month'] || r['month'] || '';
        let monthLabel = '';
        if (typeof monthRaw === 'number' && monthRaw > 10000) {
          const dt = new Date(new Date(1899, 11, 30).getTime() + monthRaw * 86400000);
          monthLabel = dt.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
        } else if (monthRaw instanceof Date || (typeof monthRaw === 'string' && monthRaw.match(/^\d{4}-\d{2}/))) {
          const dt = new Date(monthRaw);
          if (!isNaN(dt.getTime())) monthLabel = dt.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
        } else monthLabel = String(monthRaw).trim();
        return {
          month: monthLabel,
          billing: parseNumber(r['Billing'] || r['billing'] || 0),
          expenses: parseNumber(r['Expenses'] || r['expenses'] || 0),
          pipeline: parseNumber(r['Pipeline'] || r['pipeline'] || 0),
          underContract: parseNumber(r['Under Contract'] || r['underContract'] || r['Under contract'] || 0),
          underContract12: parseNumber(r['Under Contract 12 Months'] || r['Under Contract 12 months'] || 0),
          balance: parseNumber(r['Balance'] || r['balance'] || 0),
          deposits: parseNumber(r['Deposits'] || r['deposits'] || 0),
        };
      }).filter(r => r.month).sort((a, b) => new Date(a.month + ' 1') - new Date(b.month + ' 1'));
    }
  } catch (e) { console.error('Summary tab error:', e.message); }

  cache = { at: Date.now(), value: { data, summary, loadedAt: new Date().toISOString() } };
  return cache.value;
}

// "YY-NNNN Something" or "26-2496" → "26-2496". Used to join QuickBooks customers/bills to projects.
export function projectNumFrom(text) {
  const m = String(text || '').match(/\b(\d{2})-?(\d{3,4})\b/);
  return m ? `${m[1]}-${m[2]}` : '';
}

// project number → { partner, pm, client, office, name } from Master Data (first matching line)
export function indexByProject(data) {
  const idx = {};
  for (const r of data || []) {
    const k = r['Project #'];
    if (!k || idx[k]) continue;
    idx[k] = { partner: r['Partner'], pm: r['PM'], client: r['Client'], office: r['Location'], name: r['Project Name'], status: r['Status'] };
  }
  return idx;
}
