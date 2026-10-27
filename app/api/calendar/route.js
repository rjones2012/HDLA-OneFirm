import { NextResponse } from 'next/server';
import { requireCaller, hasRole, LEADERSHIP } from '../../../lib/apiAuth';
import { graphFetch } from '../../../lib/graph';

export const dynamic = 'force-dynamic';

const EMAIL_MAP = {
  // Partners
  RJ: 'rjones@hodgsondouglas.com',
  CB: 'cbarkley@hodgsondouglas.com',
  TJ: 'teliason@hodgsondouglas.com',
  MB: 'mblack@hodgsondouglas.com',
  // Principals
  MM: 'mmiller@hodgsondouglas.com',
  AB: 'aberry@hodgsondouglas.com',
  RW: 'rwhittemore@hodgsondouglas.com',
  HD: 'hdalton@hodgsondouglas.com',
  CM: 'cmantle@hodgsondouglas.com',
  // Ops
  EP: 'epeebles@hodgsondouglas.com',
  SD: 'sdubose@hodgsondouglas.com',
  SI: 'sirwin@hodgsondouglas.com',
  // PMs
  Mac: 'mackerman@hodgsondouglas.com',
  TS: 'tschneider@hodgsondouglas.com',
  YR: 'yren@hodgsondouglas.com',
  WB: 'wbrown@hodgsondouglas.com',
  // SPDs
  CH: 'chutchison@hodgsondouglas.com',
  RC: 'rcunning@hodgsondouglas.com',
  Map: 'mapperson@hodgsondouglas.com',
  // PDs
  EC: 'ecrimmins@hodgsondouglas.com',
  JY: 'jyakimicki@hodgsondouglas.com',
  TU: 'turen@hodgsondouglas.com',
  ME: 'measter@hodgsondouglas.com',
  SA: 'salexander@hodgsondouglas.com',
  JD: 'jdavis@hodgsondouglas.com',
  SH: 'shubbard@hodgsondouglas.com',
  AM: 'amolina@hodgsondouglas.com',
  AR: 'aramirez@hodgsondouglas.com',
  // New hires — July 2026
  JK: 'jkerr@hodgsondouglas.com',
  GA: 'gackerman@hodgsondouglas.com',
  JF: 'jfairman@hodgsondouglas.com',
  KR: 'krockey@hodgsondouglas.com',
  Aim: 'arobisky@hodgsondouglas.com',
};

// GET /api/calendar?initials=RJ&start=2026-03-03&end=2026-03-07
export async function GET(req) {
  // Signed-in people pull their own calendar; leadership may pull anyone's
  const { caller, error: authError } = await requireCaller(req);
  if (authError) return authError;
  try {
    const { searchParams } = new URL(req.url);
    const initials = searchParams.get('initials');
    const start = searchParams.get('start');
    const end = searchParams.get('end');

    if (!initials || !start || !end) {
      return NextResponse.json({ error: 'Missing initials, start, or end', events: [] }, { status: 400 });
    }

    if (caller.initials !== initials && !hasRole(caller, LEADERSHIP)) return NextResponse.json({ error: 'You can only view your own calendar', events: [] }, { status: 403 });

    const email = EMAIL_MAP[initials];
    if (!email) {
      return NextResponse.json({ error: `Unknown initials: ${initials}`, events: [] }, { status: 400 });
    }

    // Build query window in Central time (HDLA is Nashville/Dallas)
    const startISO = start + 'T00:00:00';
    const endISO = end + 'T23:59:59';

    const graphUrl = `/users/${email}/calendarView` +
      `?startDateTime=${startISO}&endDateTime=${endISO}` +
      `&$top=50&$orderby=start/dateTime` +
      `&$select=id,subject,start,end,location,showAs,isAllDay,isCancelled,organizer`;

    const res = await graphFetch(graphUrl, {
      headers: { 'Prefer': 'outlook.timezone="Central Standard Time"' },
    });

    if (!res.ok) {
      const errText = await res.text();
      console.error('Graph API error:', res.status, errText);
      return NextResponse.json({ error: `Graph API: ${res.status}`, events: [] });
    }

    const data = await res.json();

    // Filter out cancelled and tentative events (per Richie's rule)
    const events = (data.value || [])
      .filter(e => !e.isCancelled && e.showAs !== 'tentative')
      .map(e => ({
        id: e.id,
        subject: e.subject || '(No subject)',
        start: e.start?.dateTime || '',
        end: e.end?.dateTime || '',
        timeZone: e.start?.timeZone || 'Central Standard Time',
        location: e.location?.displayName || '',
        isAllDay: e.isAllDay || false,
        showAs: e.showAs || 'busy',
        organizer: e.organizer?.emailAddress?.name || '',
      }));

    return NextResponse.json({ events });
  } catch (error) {
    console.error('Calendar API error:', error);
    return NextResponse.json({ error: error.message, events: [] });
  }
}
