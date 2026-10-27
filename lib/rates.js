// lib/rates.js — server-only. Fee-chart resolution shared by Time and Billing.
import { supabaseAdmin } from './supabaseAdmin';

export const TITLE_COL = {
  'Partner': 'partner', 'Principal': 'principal', 'Project Manager': 'project_manager',
  'Senior Project Designer': 'senior_project_designer', 'Project Designer': 'project_designer',
  'Office Manager': 'office_manager', 'CDAM': 'senior_project_designer',
  'Marketing Manager': 'senior_project_designer', 'Marketing Coordinator': 'project_designer',
};

export function yearFromProjectNum(num) {
  const m = String(num || '').trim().match(/^(\d{2})-?\d{3,4}$/);
  return m ? 2000 + parseInt(m[1], 10) : null;
}

export async function loadRateContext() {
  const [{ data: schedules }, { data: overrides }, { data: profiles }] = await Promise.all([
    supabaseAdmin.from('rate_schedules').select('*').order('effective_year'),
    supabaseAdmin.from('project_rate_overrides').select('*'),
    supabaseAdmin.from('staff_profiles').select('id, initials, display_name, role, office, rate_title, cost_rate'),
  ]);
  return { schedules: schedules || [], overrides: overrides || [], profiles: profiles || [] };
}

export function buildResolver(schedules, overrides) {
  const years = schedules.map(s => s.effective_year).sort((a, b) => a - b);
  const byYear = {}; schedules.forEach(s => { byYear[s.effective_year] = s; });
  const current = years[years.length - 1];
  const ovr = {}; (overrides || []).forEach(o => { ovr[o.project_num] = o.schedule_year; });
  const scheduleYearFor = projectNum => {
    if (ovr[projectNum] != null) return ovr[projectNum];
    const y = yearFromProjectNum(projectNum);
    if (y == null) return current;
    let pick = null; for (const yr of years) { if (yr <= y) pick = yr; }
    return pick ?? years[0];
  };
  const rateFor = (projectNum, rateTitle) => {
    const col = TITLE_COL[rateTitle]; if (!col) return 0;
    const s = byYear[scheduleYearFor(projectNum)]; return s ? Number(s[col]) || 0 : 0;
  };
  return { scheduleYearFor, rateFor, current };
}
