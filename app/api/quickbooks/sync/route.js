import { NextResponse } from 'next/server';
import { requireCaller, FINANCE, isCron } from '../../../../lib/apiAuth';
import { syncAll, syncConnection } from '../../../../lib/quickbooks';
import { supabaseAdmin } from '../../../../lib/supabaseAdmin';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

async function run(realmId) {
  const { data: runRow } = await supabaseAdmin.from('integration_runs').insert({ integration: 'qbo', status: 'running' }).select().single();
  const results = realmId ? [{ realmId, ...(await syncConnection(realmId)) }] : await syncAll();
  const ok = results.length > 0 && results.every(r => r.ok);
  const detail = results.map(r => `${r.company || r.realmId}: ${r.detail}`).join(' | ') || 'no connections';
  if (runRow) await supabaseAdmin.from('integration_runs').update({ finished_at: new Date().toISOString(), status: ok ? 'ok' : 'error', detail }).eq('id', runRow.id);
  return { ok, results };
}

// GET — Vercel cron (Authorization: Bearer CRON_SECRET)
export async function GET(req) {
  if (!isCron(req)) {
    const { error } = await requireCaller(req, FINANCE);
    if (error) return error;
  }
  return NextResponse.json(await run());
}

// POST — "Pull now" from the Admin page; optional { realmId }
export async function POST(req) {
  const { error } = await requireCaller(req, FINANCE);
  if (error) return error;
  const body = await req.json().catch(() => ({}));
  return NextResponse.json(await run(body.realmId));
}
