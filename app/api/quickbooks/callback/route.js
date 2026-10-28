import { NextResponse } from 'next/server';
import { exchangeCode, verifyState, syncConnection } from '../../../../lib/quickbooks';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// Intuit sends the browser here after the user approves: ?code=…&realmId=…&state=…
// No session token on this request (it's a top-level redirect), so the signed state is the proof.
export async function GET(req) {
  const { searchParams, origin } = new URL(req.url);
  const site = (process.env.NEXT_PUBLIC_SITE_URL || origin).replace(/\/+$/, '');
  const code = searchParams.get('code');
  const realmId = searchParams.get('realmId');
  const state = verifyState(searchParams.get('state'));
  const err = searchParams.get('error');
  if (err) return NextResponse.redirect(`${site}/admin?qbo=denied`);
  if (!code || !realmId || !state) return NextResponse.redirect(`${site}/admin?qbo=badstate`);
  try {
    const { companyName } = await exchangeCode(code, realmId, state.initials);
    // First pull right away so the pages have something to show. Awaited: a serverless function is
    // frozen as soon as the response goes out, so a fire-and-forget sync would never finish.
    await syncConnection(realmId).catch(() => {});
    return NextResponse.redirect(`${site}/admin?qbo=connected&company=${encodeURIComponent(companyName || '')}`);
  } catch (e) {
    return NextResponse.redirect(`${site}/admin?qbo=error&message=${encodeURIComponent(e.message || 'unknown')}`);
  }
}
