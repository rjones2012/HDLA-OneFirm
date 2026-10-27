import { NextResponse } from 'next/server';
import { requireCaller, FINANCE } from '../../../lib/apiAuth';
import { qboConfigured, qboEnv, listConnections } from '../../../lib/quickbooks';
import { supabaseAdmin } from '../../../lib/supabaseAdmin';

export const dynamic = 'force-dynamic';

// GET /api/quickbooks — connection status for the Admin page
export async function GET(req) {
  const { error } = await requireCaller(req, FINANCE);
  if (error) return error;
  const connections = await listConnections();
  const { data: runs } = await supabaseAdmin.from('integration_runs').select('*').eq('integration', 'qbo').order('started_at', { ascending: false }).limit(10);
  return NextResponse.json({ configured: qboConfigured(), environment: qboEnv(), connections, runs: runs || [] });
}
