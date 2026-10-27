import { NextResponse } from 'next/server';
import { supabaseAdmin, projectToDb } from '../../../lib/supabaseAdmin';
import { graphFetch, getDrive, SHAREPOINT } from '../../../lib/graph';
import { requireCaller, FINANCE } from '../../../lib/apiAuth';

export const dynamic = 'force-dynamic';

// A missing file is not an error here (nothing to migrate), so this reads via graphFetch rather than downloadJson
async function readSharePointFile(driveId, filename) {
  const filePath = encodeURI(`${SHAREPOINT.folder}/${filename}`);
  const response = await graphFetch(`/drives/${driveId}/root:${filePath}:/content`);

  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`Read error: ${response.status}`);

  return response.json();
}

export async function POST(request) {
  const { error: authError } = await requireCaller(request, FINANCE);
  if (authError) return authError;
  console.log('=== MIGRATION START ===');
  const results = { projects: 0, projections: 0, errors: [] };

  try {
    const driveId = await getDrive();

    // --- Migrate Projects ---
    console.log('Reading workplans-data.json from SharePoint...');
    const projectData = await readSharePointFile(driveId, 'workplans-data.json');
    
    if (projectData?.projects?.length > 0) {
      console.log(`Found ${projectData.projects.length} projects to migrate`);
      
      const dbRows = projectData.projects.map(p => projectToDb(p));
      
      // Upsert in batches of 50
      for (let i = 0; i < dbRows.length; i += 50) {
        const batch = dbRows.slice(i, i + 50);
        const { error } = await supabaseAdmin
          .from('projects')
          .upsert(batch, { onConflict: 'id' });
        
        if (error) {
          console.error(`Batch ${i} error:`, error);
          results.errors.push(`Projects batch ${i}: ${error.message}`);
        } else {
          results.projects += batch.length;
        }
      }
      console.log(`Migrated ${results.projects} projects`);
    } else {
      console.log('No projects found in SharePoint');
    }

    // --- Migrate Projections ---
    console.log('Reading workplans-projections.json from SharePoint...');
    const projData = await readSharePointFile(driveId, 'workplans-projections.json');
    
    if (projData?.projections) {
      const entries = Object.entries(projData.projections);
      console.log(`Found ${entries.length} projections to migrate`);
      
      const rows = entries.map(([projectId, data]) => ({
        project_id: projectId,
        confidence: data.confidence || '',
        months: data.months || {}
      }));

      // Upsert in batches of 50
      for (let i = 0; i < rows.length; i += 50) {
        const batch = rows.slice(i, i + 50);
        const { error } = await supabaseAdmin
          .from('projections')
          .upsert(batch, { onConflict: 'project_id' });
        
        if (error) {
          console.error(`Projections batch ${i} error:`, error);
          results.errors.push(`Projections batch ${i}: ${error.message}`);
        } else {
          results.projections += batch.length;
        }
      }

      // Migrate snapshots
      if (projData.snapshot) {
        const { error } = await supabaseAdmin
          .from('projection_snapshots')
          .upsert({
            id: 1,
            snapshot: projData.snapshot,
            previous_snapshot: projData.previousSnapshot || {}
          }, { onConflict: 'id' });
        
        if (error) results.errors.push(`Snapshot: ${error.message}`);
      }

      console.log(`Migrated ${results.projections} projections`);
    } else {
      console.log('No projections found in SharePoint');
    }

    console.log('=== MIGRATION COMPLETE ===');
    return NextResponse.json({
      success: true,
      migrated: results,
      message: `Migrated ${results.projects} projects and ${results.projections} projections`
    });

  } catch (error) {
    console.error('Migration error:', error);
    return NextResponse.json({
      success: false,
      error: error.message,
      migrated: results
    }, { status: 500 });
  }
}

// GET shows migration status / current counts
export async function GET(req) {
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
      message: projectCount > 0 ? 'Data exists in Supabase' : 'Supabase is empty - run POST to migrate'
    });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
