import { NextResponse } from 'next/server';
import { requireCaller, LEADERSHIP } from '../../../lib/apiAuth';
import { agingByPartner, bucket } from '../../../lib/quickbooks';
import { supabaseAdmin } from '../../../lib/supabaseAdmin';

export const dynamic = 'force-dynamic';

// GET /api/aging            → by-partner rollup + every open invoice (partners/ops/office)
// GET /api/aging?partner=RJ → one partner's rows (any leadership role; a principal gets their PM projects via ?pm=)
export async function GET(req) {
  const { caller, error } = await requireCaller(req, LEADERSHIP);
  if (error) return error;
  const { searchParams } = new URL(req.url);
  const partner = searchParams.get('partner') || '';
  const finance = ['partner', 'operations', 'office'].includes(caller.role);
  if (!finance && !partner) {
    // principals: only invoices on projects where they are PM (resolved from Master Data at sync time is partner-only, so match by project list)
    const { data: projects } = await supabaseAdmin.from('projects').select('project_num').eq('principal', caller.initials);
    const nums = (projects || []).map(p => p.project_num).filter(Boolean);
    const all = await agingByPartner();
    const invoices = all.invoices.filter(i => nums.includes(i.project_num));
    const total = invoices.reduce((s, i) => s + Number(i.balance || 0), 0);
    return NextResponse.json({ pulledAt: all.pulledAt, scope: 'pm', rows: [], firm: null, invoices, total });
  }
  const out = await agingByPartner(partner ? { partner } : {});
  return NextResponse.json({ pulledAt: out.pulledAt, scope: partner ? 'partner' : 'firm', rows: out.rows, firm: out.firm, invoices: out.invoices, bucketOf: undefined });
}

// POST /api/aging — manual upload of a QuickBooks A/R Aging Detail export, parsed in the browser:
// { rows:[{docNumber, customer, txnDate, dueDate, amount, balance}] } — replaces previous uploaded rows.
export async function POST(req) {
  const { error } = await requireCaller(req, ['partner', 'operations', 'office']);
  if (error) return error;
  const body = await req.json().catch(() => ({}));
  const rows = Array.isArray(body.rows) ? body.rows : [];
  const { loadMasterData, projectNumFrom, indexByProject } = await import('../../../lib/masterdata');
  const md = await loadMasterData().catch(() => ({ data: [] }));
  const byProject = indexByProject(md.data);
  const now = new Date().toISOString();
  const out = rows.filter(r => Number(r.balance) > 0).map((r, i) => {
    const project_num = projectNumFrom(r.customer) || projectNumFrom(r.docNumber) || projectNumFrom(r.memo);
    const due = r.dueDate ? new Date(r.dueDate) : null;
    const days = due && !isNaN(due) ? Math.max(0, Math.floor((Date.now() - due.getTime()) / 86400000)) : 0;
    return { id: `upload:${r.docNumber || i}:${r.customer || ''}`.slice(0, 200), realm_id: 'upload', qbo_id: '', doc_number: String(r.docNumber || ''), customer: String(r.customer || ''), project_num, partner: byProject[project_num]?.partner || '', txn_date: String(r.txnDate || ''), due_date: String(r.dueDate || ''), amount: Number(r.amount) || 0, balance: Number(r.balance) || 0, days_past_due: days, source: 'upload', pulled_at: now };
  });
  await supabaseAdmin.from('ar_invoices').delete().eq('source', 'upload');
  if (out.length) { const { error: e } = await supabaseAdmin.from('ar_invoices').upsert(out, { onConflict: 'id' }); if (e) return NextResponse.json({ error: e.message }, { status: 500 }); }
  return NextResponse.json({ ok: true, count: out.length, unmatched: out.filter(r => !r.project_num).length });
}
