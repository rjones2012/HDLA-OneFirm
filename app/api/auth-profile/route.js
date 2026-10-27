import { NextResponse } from 'next/server';
import { supabaseAdmin } from '../../../lib/supabaseAdmin';
import { getCaller } from '../../../lib/apiAuth';

export const dynamic = 'force-dynamic';

// Tier access codes — read from the environment only; there is no fallback.
// If any is unset the PIN check refuses everyone rather than accepting a guessable default.
function tierPins() {
  return {
    partner: process.env.PIN_PARTNER || '',
    principal: process.env.PIN_PRINCIPAL || '',
    staff: process.env.PIN_STAFF || '',
  };
}

// Map roles to which tier PIN they need
const ROLE_TIER = {
  partner: 'partner',
  operations: 'partner',
  office: 'partner',
  marketing: 'partner',
  principal: 'principal',
  staff: 'staff',
};

// GET /api/auth-profile?user_id=xxx — a signed-in person may load only their own profile
export async function GET(req) {
  try {
    const caller = await getCaller(req);
    if (!caller) return NextResponse.json({ error: 'Sign in required', profile: null }, { status: 401 });

    const { searchParams } = new URL(req.url);
    const userId = searchParams.get('user_id');
    if (!userId) return NextResponse.json({ error: 'Missing user_id', profile: null }, { status: 400 });
    if (userId !== caller.id) return NextResponse.json({ error: 'You can only load your own profile', profile: null }, { status: 403 });

    const { data, error } = await supabaseAdmin
      .from('staff_profiles')
      .select('*')
      .eq('id', userId)
      .single();

    if (error) throw error;
    return NextResponse.json({ profile: data });
  } catch (e) {
    return NextResponse.json({ error: e.message, profile: null }, { status: 200 });
  }
}

// POST /api/auth-profile — verify tier PIN during sign-in (runs before a session token is attached).
// Returns only { valid, role }; never the profile.
export async function POST(req) {
  try {
    const { user_id, pin } = await req.json();
    if (!user_id || !pin) return NextResponse.json({ error: 'Missing user_id or pin', valid: false }, { status: 400 });

    const pins = tierPins();
    if (!pins.partner || !pins.principal || !pins.staff) {
      return NextResponse.json({ error: 'Access codes not configured', valid: false }, { status: 500 });
    }

    const { data, error } = await supabaseAdmin
      .from('staff_profiles')
      .select('role')
      .eq('id', user_id)
      .single();

    if (error || !data) return NextResponse.json({ error: 'Profile not found', valid: false }, { status: 400 });

    const tier = ROLE_TIER[data.role] || 'staff';
    const expected = pins[tier];
    const valid = !!expected && pin === expected;

    return NextResponse.json({ valid, role: valid ? data.role : undefined });
  } catch (e) {
    return NextResponse.json({ error: e.message, valid: false }, { status: 500 });
  }
}
