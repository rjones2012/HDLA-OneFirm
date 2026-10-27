import { NextResponse } from 'next/server';
import { requireCaller } from '../../../lib/apiAuth';
import { supabaseAdmin } from '../../../lib/supabaseAdmin';

export const dynamic = 'force-dynamic';

// POST { module, tab } — light usage log so dead features get retired on evidence
export async function POST(req) {
  const { caller, error } = await requireCaller(req);
  if (error) return error;
  const b = await req.json().catch(() => ({}));
  await supabaseAdmin.from('page_views').insert({ initials: caller.initials || '', module: String(b.module || '').slice(0, 40), tab: String(b.tab || '').slice(0, 60) });
  return NextResponse.json({ ok: true });
}
