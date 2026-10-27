import { NextResponse } from 'next/server';
import { requireCaller, FINANCE } from '../../../../lib/apiAuth';
import { authorizeUrl, qboConfigured, signState } from '../../../../lib/quickbooks';

export const dynamic = 'force-dynamic';

export async function GET(req) {
  const { caller, error } = await requireCaller(req, FINANCE);
  if (error) return error;
  if (!qboConfigured()) return NextResponse.json({ error: 'QuickBooks keys are not set in the environment (QBO_CLIENT_ID, QBO_CLIENT_SECRET, QBO_REDIRECT_URI, QBO_TOKEN_SECRET)' }, { status: 400 });
  return NextResponse.json({ url: authorizeUrl(signState(caller.initials)) });
}
