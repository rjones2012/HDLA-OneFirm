// Browser-side Supabase client (anon key) plus the project row mappers.
// The service-role client lives in lib/supabaseAdmin.js and is server-only.
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  // Surfaces at build/boot rather than as a confusing 401 later
  console.warn('OneFirm: NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY are not set');
}

export const supabase = createClient(SUPABASE_URL || 'http://localhost', SUPABASE_ANON_KEY || 'anon', {
  realtime: { params: { eventsPerSecond: 10 } },
});

// Helper: convert DB row to frontend project format (snake_case -> camelCase)
export function dbToProject(row) {
  return {
    id: row.id,
    projectNum: row.project_num || '',
    projectName: row.project_name || '',
    principal: row.principal || '',
    phase: row.phase || '',
    milestones: row.milestones || [],
    tasks: row.tasks || [],
    partnersInCharge: row.partners_in_charge || [],
    teamMembers: row.team_members || [],
    needsReview: row.needs_review || [],
    reviewCompletedBy: row.review_completed_by || {},
    partnerNeeds: row.partner_needs || '',
    internalHealth: row.internal_health || '',
    externalHealth: row.external_health || '',
    needs: row.needs || '',
    // OneFirm additions (project page)
    schedule: row.schedule || [],
    links: row.links || [],
  };
}

// Helper: convert frontend project to DB format (camelCase -> snake_case)
export function projectToDb(project) {
  const out = {
    id: project.id,
    project_num: project.projectNum || '',
    project_name: project.projectName || '',
    principal: project.principal || '',
    phase: project.phase || '',
    milestones: project.milestones || [],
    tasks: project.tasks || [],
    partners_in_charge: project.partnersInCharge || [],
    team_members: project.teamMembers || [],
    needs_review: project.needsReview || [],
    review_completed_by: project.reviewCompletedBy || {},
    partner_needs: project.partnerNeeds || '',
    internal_health: project.internalHealth || '',
    external_health: project.externalHealth || '',
    needs: project.needs || '',
  };
  if (Array.isArray(project.schedule)) out.schedule = project.schedule;
  if (Array.isArray(project.links)) out.links = project.links;
  return out;
}
