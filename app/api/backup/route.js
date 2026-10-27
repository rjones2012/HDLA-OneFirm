import { NextResponse } from 'next/server';
import { supabaseAdmin, dbToProject } from '../../../lib/supabaseAdmin';
import { uploadFile } from '../../../lib/graph';
import { requireCaller, isCron, FINANCE } from '../../../lib/apiAuth';

export const dynamic = 'force-dynamic';

async function writeToSharePoint(filename, data) {
  await uploadFile(filename, JSON.stringify(data, null, 2), 'application/json');
  return true;
}

// POST = run the backup (finance roles)
export async function POST(req) {
  const { error: authError } = await requireCaller(req, FINANCE);
  if (authError) return authError;
  return runBackup();
}

async function runBackup() {
  console.log('=== BACKUP START ===');
  const results = { projects: 0, projections: 0, errors: [] };

  try {
    // Read from Supabase
    const { data: projectRows, error: projErr } = await supabaseAdmin
      .from('projects')
      .select('*');
    if (projErr) throw projErr;

    const { data: projectionRows, error: projnErr } = await supabaseAdmin
      .from('projections')
      .select('*');
    if (projnErr) throw projnErr;

    const { data: snapRows } = await supabaseAdmin
      .from('projection_snapshots')
      .select('*')
      .order('updated_at', { ascending: false })
      .limit(1);

    // Convert projects back to frontend format
    const projects = (projectRows || []).map(dbToProject);
    results.projects = projects.length;

    // Convert projections back to keyed object format
    const projections = {};
    (projectionRows || []).forEach(row => {
      projections[row.project_id] = {
        confidence: row.confidence || '',
        months: row.months || {}
      };
    });
    results.projections = Object.keys(projections).length;

    const snap = snapRows?.[0] || null;

    // Safety check - don't backup empty data over existing backups
    if (projects.length === 0) {
      console.error('SAFETY: Supabase returned 0 projects. Aborting backup.');
      return NextResponse.json({
        success: false,
        error: 'Supabase returned 0 projects - backup aborted to protect existing data'
      }, { status: 400 });
    }

    // Write to SharePoint

    // Backup projects
    const projectBackup = {
      projects,
      lastModified: new Date().toISOString(),
      backupSource: 'supabase',
      backupTimestamp: new Date().toISOString()
    };
    await writeToSharePoint('workplans-data.json', projectBackup);
    console.log(`Backed up ${projects.length} projects`);

    // Backup projections
    const projectionBackup = {
      projections,
      snapshot: snap?.snapshot || null,
      previousSnapshot: snap?.previous_snapshot || null,
      lastUpdated: new Date().toISOString(),
      backupSource: 'supabase',
      backupTimestamp: new Date().toISOString()
    };
    await writeToSharePoint('workplans-projections.json', projectionBackup);
    console.log(`Backed up ${results.projections} projections`);

    console.log('=== BACKUP COMPLETE ===');
    return NextResponse.json({
      success: true,
      backup: results,
      message: `Backed up ${results.projects} projects and ${results.projections} projections to SharePoint`,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Backup error:', error);
    return NextResponse.json({
      success: false,
      error: error.message,
      backup: results
    }, { status: 500 });
  }
}

// GET = Vercel cron runs the backup; a finance caller sees the current counts
export async function GET(req) {
  if (isCron(req)) return runBackup();
  const { error: authError } = await requireCaller(req, FINANCE);
  if (authError) return authError;
  try {
    const { count: projectCount } = await supabaseAdmin
      .from('projects')
      .select('*', { count: 'exact', head: true });

    const { count: projectionCount } = await supabaseAdmin
      .from('projections')
      .select('*', { count: 'exact', head: true });

    return NextResponse.json({
      supabase: { projects: projectCount || 0, projections: projectionCount || 0 },
      message: 'Run POST to backup Supabase data to SharePoint'
    });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
