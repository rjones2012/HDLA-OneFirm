import { NextResponse } from 'next/server';
import * as XLSX from 'xlsx';
import { supabaseAdmin } from '../../../lib/supabaseAdmin';
import { downloadFile } from '../../../lib/graph';
import { requireCaller, FINANCE } from '../../../lib/apiAuth';

export const dynamic = 'force-dynamic';

function resolveOffice(row) {
  const state = (row['Office State'] || '').trim().toUpperCase();
  const loc = (row['Office Location'] || '').trim().toLowerCase();
  if (state === 'TX' || loc.includes('dallas')) return 'Dallas';
  return 'Nashville';
}

const uid = () => Date.now().toString(36) + Math.random().toString(36).substr(2, 9);

export async function POST(req) {
  const { error: authError } = await requireCaller(req, FINANCE);
  if (authError) return authError;
  try {
    const buffer = Buffer.from(await downloadFile('Marketing.xlsx'));
    const workbook = XLSX.read(buffer, { type: 'buffer' });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    if (!sheet) return NextResponse.json({ error: 'No sheet found' }, { status: 404 });

    const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });
    console.log(`[MIGRATE] Read ${rows.length} rows from Marketing.xlsx`);

    // Flatten multi-market clients into one record per client name
    const byClient = {};
    for (const row of rows) {
      const name = (row.Client || '').trim();
      if (!name) continue;
      if (!byClient[name]) byClient[name] = [];
      byClient[name].push(row);
    }

    const clients = [];
    for (const [name, entries] of Object.entries(byClient)) {
      const bestTier = Math.min(...entries.map(r => parseInt(r.Tier) || 5));
      const bestRow = entries.find(r => parseInt(r.Tier) === bestTier) || entries[0];

      const markets = entries
        .map(r => ({ market: (r.Market || '').trim(), submarket: (r['Sub Market'] || '').trim() }))
        .filter(m => m.market);

      const allPartners = [...new Set(entries.map(r => (r.Partner || '').trim()).filter(Boolean))];

      const relScore = parseFloat(bestRow['Relationship Status']) || 5;
      const touchVal = parseFloat(bestRow['Touchpoint Value']) || 5;
      
      const strategic = entries.some(r => {
        const val = r.Strategic || r['Strategic '] || '';
        return val === 'Yes' || val === 'yes' || val === true || val === 'TRUE' || val === 1;
      });

      const contactName = (bestRow.Contact || '').trim();
      const contacts = contactName ? [{ id: uid(), name: contactName, title: '', email: '', phone: '' }] : [];

      const office = resolveOffice(bestRow);
      const notes = (bestRow.Notes || '').trim();

      clients.push({
        id: uid(),
        name,
        sector: '',
        office,
        markets,
        partners: allPartners,
        tier: bestTier,
        relationship_score: relScore,
        relationship_override: null,
        touchpoint_value: touchVal,
        strategic,
        contacts,
        notes,
        updated_at: new Date().toISOString(),
      });
    }

    console.log(`[MIGRATE] Flattened to ${clients.length} unique clients`);

    // Check if already populated
    const { count } = await supabaseAdmin.from('marketing_clients').select('*', { count: 'exact', head: true });
    if (count > 0) {
      return NextResponse.json({
        error: `marketing_clients already has ${count} records. Clear the table first if you want to re-migrate.`,
        existingCount: count,
      }, { status: 409 });
    }

    // Batch insert
    let inserted = 0;
    for (let i = 0; i < clients.length; i += 50) {
      const batch = clients.slice(i, i + 50);
      const { error } = await supabaseAdmin.from('marketing_clients').insert(batch);
      if (error) throw error;
      inserted += batch.length;
    }

    return NextResponse.json({
      success: true,
      totalRows: rows.length,
      uniqueClients: clients.length,
      inserted,
      sample: clients.slice(0, 3).map(c => ({
        name: c.name,
        tier: c.tier,
        markets: c.markets.length,
        partners: c.partners,
        office: c.office,
      })),
    });
  } catch (error) {
    console.error('Migration error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
