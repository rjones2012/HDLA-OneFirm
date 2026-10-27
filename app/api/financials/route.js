import { NextResponse } from 'next/server';
import { requireCaller, FINANCE } from '../../../lib/apiAuth';
import { supabaseAdmin } from '../../../lib/supabaseAdmin';

export const dynamic = 'force-dynamic';

// GET /api/financials?months=12 → P&L rows by month/category (QuickBooks pull or upload), newest months first
export async function GET(req) {
  const { error } = await requireCaller(req, FINANCE);
  if (error) return error;
  const { searchParams } = new URL(req.url);
  const months = Math.min(60, Math.max(1, parseInt(searchParams.get('months') || '12', 10)));
  const d = new Date(); d.setMonth(d.getMonth() - (months - 1));
  const from = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  const { data, error: e } = await supabaseAdmin.from('monthly_financials').select('*').gte('month', from).order('month', { ascending: false });
  if (e) return NextResponse.json({ error: e.message }, { status: 500 });
  const rows = data || [];
  // when both a QuickBooks pull and an upload exist for a month, the pull wins
  const qboMonths = new Set(rows.filter(r => r.source === 'qbo').map(r => r.month));
  const merged = rows.filter(r => r.source === 'qbo' || !qboMonths.has(r.month));
  const pulledAt = merged.reduce((m, r) => (!m || r.pulled_at > m ? r.pulled_at : m), null);
  // monthly totals
  const totals = {};
  for (const r of merged) {
    const t = totals[r.month] = totals[r.month] || { month: r.month, income: 0, cogs: 0, expense: 0, other_income: 0, other_expense: 0 };
    t[r.kind] = (t[r.kind] || 0) + Number(r.amount || 0);
  }
  const summary = Object.values(totals).sort((a, b) => b.month.localeCompare(a.month)).map(t => ({ ...t, gross: t.income - t.cogs, net: t.income - t.cogs - t.expense + t.other_income - t.other_expense }));
  return NextResponse.json({ pulledAt, rows: merged, summary });
}

// POST /api/financials — manual upload of a QuickBooks P&L export parsed in the browser:
// { month:'2026-09', rows:[{kind, category, subcategory, amount}] } — replaces that month's uploaded rows.
export async function POST(req) {
  const { error } = await requireCaller(req, FINANCE);
  if (error) return error;
  const body = await req.json().catch(() => ({}));
  const month = String(body.month || '');
  if (!/^\d{4}-\d{2}$/.test(month)) return NextResponse.json({ error: 'month must be YYYY-MM' }, { status: 400 });
  const rows = (Array.isArray(body.rows) ? body.rows : []).filter(r => r && r.kind && Number(r.amount));
  const now = new Date().toISOString();
  const out = rows.map(r => ({ id: `upload::${month}:${r.kind}:${r.category || ''}:${r.subcategory || ''}`.slice(0, 400), realm_id: '', month, kind: r.kind, category: String(r.category || ''), subcategory: String(r.subcategory || ''), amount: Number(r.amount), class: String(r.class || ''), source: 'upload', pulled_at: now }));
  await supabaseAdmin.from('monthly_financials').delete().eq('source', 'upload').eq('month', month);
  if (out.length) { const { error: e } = await supabaseAdmin.from('monthly_financials').upsert(out, { onConflict: 'id' }); if (e) return NextResponse.json({ error: e.message }, { status: 500 }); }
  return NextResponse.json({ ok: true, count: out.length });
}
