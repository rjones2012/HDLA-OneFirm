import { NextResponse } from 'next/server';
import { requireCaller, PARTNERS } from '../../../../lib/apiAuth';
import { disconnect } from '../../../../lib/quickbooks';

export const dynamic = 'force-dynamic';

export async function POST(req) {
  const { error } = await requireCaller(req, PARTNERS);
  if (error) return error;
  const { realmId } = await req.json().catch(() => ({}));
  if (!realmId) return NextResponse.json({ error: 'realmId required' }, { status: 400 });
  await disconnect(String(realmId));
  return NextResponse.json({ ok: true });
}
