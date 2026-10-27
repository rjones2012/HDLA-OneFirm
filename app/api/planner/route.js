import { NextResponse } from 'next/server';
import { supabaseAdmin } from '../../../lib/supabaseAdmin';
import { requireCaller } from '../../../lib/apiAuth';

export const dynamic = 'force-dynamic';

// GET /api/planner?week_key=2026-03-04   (the week is always the caller's own; a user_id in the query is ignored)
export async function GET(req) {
  const { caller, error: authError } = await requireCaller(req);
  if (authError) return authError;
  try {
    const { searchParams } = new URL(req.url);
    const userId = caller.id;
    const weekKey = searchParams.get('week_key');

    if (!weekKey) {
      return NextResponse.json({ error: 'Missing week_key' }, { status: 400 });
    }

    const { data, error } = await supabaseAdmin
      .from('weekly_planner')
      .select('*')
      .eq('user_id', userId)
      .eq('week_key', weekKey)
      .single();

    if (error && error.code !== 'PGRST116') {
      throw error;
    }

    // If no entry for this week, check previous week for carry-over priorities
    if (!data) {
      const prevMonday = new Date(weekKey);
      prevMonday.setDate(prevMonday.getDate() - 7);
      const prevKey = prevMonday.toISOString().split('T')[0];
      
      const { data: prevData } = await supabaseAdmin
        .from('weekly_planner')
        .select('priorities')
        .eq('user_id', userId)
        .eq('week_key', prevKey)
        .single();
      
      // Carry over uncompleted priorities
      const carriedPriorities = prevData?.priorities
        ? prevData.priorities.filter(p => !p.done).map(p => ({ ...p, id: p.id + '_co' }))
        : [];
      
      return NextResponse.json({ entry: null, carriedPriorities });
    }

    return NextResponse.json({ entry: data });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

// POST /api/planner — upsert the caller's own entry (body.user_id is ignored)
export async function POST(req) {
  const { caller, error: authError } = await requireCaller(req);
  if (authError) return authError;
  try {
    const body = await req.json();
    const { week_key, focus_notes, meetings, priorities, reflections, promoted_events, completed_promoted } = body;
    const user_id = caller.id;

    if (!week_key) {
      return NextResponse.json({ error: 'Missing week_key' }, { status: 400 });
    }

    const uid = `${user_id}_${week_key}`;
    const { data, error } = await supabaseAdmin
      .from('weekly_planner')
      .upsert({
        id: uid,
        user_id,
        week_key,
        focus_notes: focus_notes ?? '',
        meetings: meetings ?? [],
        priorities: priorities ?? [],
        reflections: reflections ?? '',
        promoted_events: promoted_events ?? [],
        completed_promoted: completed_promoted ?? [],
        updated_at: new Date().toISOString(),
      }, { onConflict: 'user_id,week_key' })
      .select()
      .single();

    if (error) throw error;
    return NextResponse.json({ entry: data });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
