import { NextResponse } from 'next/server';
import { supabaseAdmin } from '../../../lib/supabaseAdmin';
import { requireCaller, LEADERSHIP } from '../../../lib/apiAuth';

export const dynamic = 'force-dynamic';

export async function GET(req) {
  const { error: authError } = await requireCaller(req);
  if (authError) return authError;
  try {
    // Get all projections
    const { data: projRows, error: projError } = await supabaseAdmin
      .from('projections')
      .select('*');

    if (projError) throw projError;

    // Convert rows back to the { projectId: { confidence, months } } format
    const projections = {};
    (projRows || []).forEach(row => {
      projections[row.project_id] = {
        confidence: row.confidence || '',
        months: row.months || {}
      };
    });

    // Get latest snapshot
    const { data: snapRows, error: snapError } = await supabaseAdmin
      .from('projection_snapshots')
      .select('*')
      .order('updated_at', { ascending: false })
      .limit(1);

    if (snapError) throw snapError;

    const snap = snapRows?.[0] || null;

    return NextResponse.json({
      projections,
      snapshot: snap?.snapshot || null,
      previousSnapshot: snap?.previous_snapshot || null
    });
  } catch (error) {
    console.error('Error loading projections:', error);
    return NextResponse.json({
      projections: {},
      snapshot: null,
      previousSnapshot: null,
      error: error.message
    });
  }
}

export async function POST(request) {
  const { error: authError } = await requireCaller(request, LEADERSHIP);
  if (authError) return authError;
  try {
    const body = await request.json();

    // Handle deletion of orphaned projection keys
    if (body.deleteKeys && Array.isArray(body.deleteKeys)) {
      const keys = body.deleteKeys;
      console.log('Deleting projection keys:', keys);

      const { error } = await supabaseAdmin
        .from('projections')
        .delete()
        .in('project_id', keys);

      if (error) throw error;

      console.log(`Deleted ${keys.length} projection entries`);
      return NextResponse.json({ success: true, deleted: keys.length });
    }

    // Handle single CELL update — atomic, no overwrite risk
    if (body.setCell) {
      const { projectId, monthKey, value } = body.setCell;
      // Read current months, set just this one key, write back
      const { data: existing } = await supabaseAdmin
        .from('projections').select('*').eq('project_id', projectId).single();
      const dbMonths = existing?.months || {};
      dbMonths[monthKey] = value;
      const { error } = await supabaseAdmin
        .from('projections').upsert({
          project_id: projectId,
          confidence: existing?.confidence || '',
          months: dbMonths
        }, { onConflict: 'project_id' });
      if (error) throw error;

      // Persist snapshot rotation if supplied (Wed-noon-CST anchored)
      if (body.snapshot) {
        await saveSnapshot(body.snapshot, body.previousSnapshot);
      }
      return NextResponse.json({ success: true });
    }

    // Handle single projection update with optional merge
    if (body.projectId) {
      const { projectId, confidence, months, merge } = body;

      if (merge) {
        // Read current DB version and merge months — incoming keys win, DB keys preserved
        const { data: existing } = await supabaseAdmin
          .from('projections')
          .select('*')
          .eq('project_id', projectId)
          .single();

        const dbMonths = existing?.months || {};
        const mergedMonths = { ...dbMonths, ...months };

        const { error } = await supabaseAdmin
          .from('projections')
          .upsert({
            project_id: projectId,
            confidence: confidence || existing?.confidence || '',
            months: mergedMonths
          }, { onConflict: 'project_id' });

        if (error) throw error;
        return NextResponse.json({ success: true, lastUpdated: new Date().toISOString() });
      }

      // Non-merge: full overwrite (backward compat)
      const { error } = await supabaseAdmin
        .from('projections')
        .upsert({
          project_id: projectId,
          confidence: confidence || '',
          months: months || {}
        }, { onConflict: 'project_id' });

      if (error) throw error;

      if (body.snapshot) {
        await saveSnapshot(body.snapshot, body.previousSnapshot);
      }

      return NextResponse.json({ success: true, lastUpdated: new Date().toISOString() });
    }

    // Handle bulk projection save (for backward compat during migration)
    if (body.projections) {
      const { projections, snapshot, previousSnapshot } = body;
      console.log('Saving all projections, count:', Object.keys(projections).length);

      // Upsert each projection as a row
      const rows = Object.entries(projections).map(([projectId, data]) => ({
        project_id: projectId,
        confidence: data.confidence || '',
        months: data.months || {}
      }));

      if (rows.length > 0) {
        const { error } = await supabaseAdmin
          .from('projections')
          .upsert(rows, { onConflict: 'project_id' });

        if (error) throw error;
      }

      // Save snapshot
      if (snapshot) {
        await saveSnapshot(snapshot, previousSnapshot);
      }

      return NextResponse.json({ success: true, lastUpdated: new Date().toISOString() });
    }

    return NextResponse.json({ success: false, error: 'Invalid request' }, { status: 400 });
  } catch (error) {
    console.error('Error saving projections:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

async function saveSnapshot(snapshot, previousSnapshot) {
  // Upsert into single row (id=1)
  const { error } = await supabaseAdmin
    .from('projection_snapshots')
    .upsert({
      id: 1,
      snapshot: snapshot || {},
      previous_snapshot: previousSnapshot || {}
    }, { onConflict: 'id' });

  if (error) console.error('Snapshot save error:', error);
}
