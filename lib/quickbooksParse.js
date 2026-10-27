// Pure parsers for QuickBooks report JSON (no server deps, unit-testable).
// ── Report parsing ──
// QB report JSON: { Columns:{Column:[{ColTitle}]}, Rows:{Row:[ {type:'Section', Header:{ColData}, Rows:{Row:[…]}, Summary}, {type:'Data', ColData:[…]} ]} }
const MONTHS = { Jan: '01', Feb: '02', Mar: '03', Apr: '04', May: '05', Jun: '06', Jul: '07', Aug: '08', Sep: '09', Oct: '10', Nov: '11', Dec: '12' };
function monthKeyFromTitle(t) {
  const m = String(t || '').match(/^([A-Z][a-z]{2})\w*\s+(\d{4})$/);          // "Jan 2026" / "January 2026"
  if (m && MONTHS[m[1]]) return `${m[2]}-${MONTHS[m[1]]}`;
  const d = String(t || '').match(/^(\d{4})-(\d{2})/);
  return d ? `${d[1]}-${d[2]}` : null;
}
const KIND = { 'Income': 'income', 'Cost of Goods Sold': 'cogs', 'Expenses': 'expense', 'Other Income': 'other_income', 'Other Expenses': 'other_expense' };
const num = v => { const n = parseFloat(String(v ?? '').replace(/[,$]/g, '')); return isNaN(n) ? 0 : n; };

// → [{month, kind, category, subcategory, amount}]
export function parseProfitAndLoss(rep) {
  const cols = (rep?.Columns?.Column || []).map(c => c.ColTitle || '');
  const monthCols = cols.map((t, i) => ({ i, month: monthKeyFromTitle(t) })).filter(c => c.month);
  const out = [];
  const walk = (rows, path) => {
    for (const r of rows || []) {
      if (r.type === 'Section') {
        const name = r.Header?.ColData?.[0]?.value || '';
        walk(r.Rows?.Row, [...path, name]);
      } else if (r.type === 'Data' && r.ColData) {
        const top = path[0] || '';
        const kind = KIND[top]; if (!kind) continue;
        const subcategory = r.ColData[0]?.value || '';
        const category = path[1] || subcategory;
        for (const c of monthCols) {
          const amount = num(r.ColData[c.i]?.value);
          if (amount) out.push({ month: c.month, kind, category, subcategory, amount });
        }
      }
    }
  };
  walk(rep?.Rows?.Row, []);
  return out;
}

// Aged detail reports (AR/AP): rows grouped by bucket sections; each data row = one open document.
// → [{bucket, date, type, num, name, dueDate, amount, balance}]
export function parseAgedDetail(rep) {
  const cols = (rep?.Columns?.Column || []).map(c => (c.ColTitle || '').toLowerCase());
  const col = (...names) => { for (const n of names) { const i = cols.findIndex(c => c === n.toLowerCase()); if (i >= 0) return i; } return -1; };
  const iDate = col('date', 'txn date'), iType = col('transaction type', 'type'), iNum = col('num', 'no.', 'number'),
    iName = col('customer', 'name', 'vendor', 'customer name', 'vendor name'), iDue = col('due date'), iAmt = col('amount'), iBal = col('open balance', 'balance');
  const out = [];
  const walk = (rows, bucket) => {
    for (const r of rows || []) {
      if (r.type === 'Section') walk(r.Rows?.Row, r.Header?.ColData?.[0]?.value || bucket);
      else if (r.type === 'Data' && r.ColData) {
        const g = i => (i >= 0 ? r.ColData[i]?.value : '') || '';
        const balance = num(g(iBal));
        if (!g(iName) && !g(iNum)) continue;
        out.push({ bucket, date: g(iDate), type: g(iType), num: g(iNum), name: g(iName), dueDate: g(iDue), amount: num(g(iAmt)), balance, qboId: r.ColData[iNum >= 0 ? iNum : 0]?.id || r.ColData[0]?.id || '' });
      }
    }
  };
  walk(rep?.Rows?.Row, '');
  return out;
}

