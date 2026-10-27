import { NextResponse } from 'next/server';
import { exchangeCode, verifyState, syncConnection } from '../../../../lib/quickbooks';

export const dynamic = 'force-dynamic';

// Intuit sends the browser here after the user approves: ?code=…&realmId=…&state=…
// No session token on this request (it's a top-level redirect), so the signed state is the proof.
export async function GET(req) {
  const { searchParams, origin } = new URL(req.url);
  const site = process.env.NEXT_PUBLIC_SITE_URL || origin;
  const code = searchParams.get('code');
  const realmId = searchParams.get('realmId');
  const state = verifyState(searchParams.get('state'));
  const err = searchParams.get('error');
  if (err) return NextResponse.redirect(`${site}/admin?qbo=denied`);
  if (!code || !realmId || !state) return NextResponse.redirect(`${site}/admin?qbo=badstate`);
  try {
    const { companyName } = await exchangeCode(code, realmId, state.initials);
    // first pull right away so the pages have something to show
    syncConnection(realmId).catch(() => {});
    return NextResponse.redirect(`${site}/admin?qbo=connected&company=${encodeURIComponent(companyName || '')}`);
  } catch (e) {
    return NextResponse.redirect(`${site}/admin?qbo=error&message=${encodeURIComponent(e.message || 'unknown')}`);
  }
}
