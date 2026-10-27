'use client';
// Loads everything the role home needs, each source independently (a failing source never blanks the page).
import { useEffect, useState, useCallback } from 'react';
import { isLeadershipRole, isFinanceRole } from '../../lib/auth';

export const getMonday = (date = new Date()) => { const d = new Date(date); const day = d.getDay(); d.setDate(d.getDate() - day + (day === 0 ? -6 : 1)); d.setHours(0, 0, 0, 0); return d; };
export const ymd = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
export const monthKey = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };

async function j(url, fallback) { try { const r = await fetch(url); if (!r.ok) return fallback; return await r.json(); } catch { return fallback; } }

export function useHomeData(user, profile) {
  const initials = profile?.initials || '';
  const role = profile?.role || 'staff';
  const leadership = isLeadershipRole(role);
  const finance = isFinanceRole(role);
  const monday = getMonday();
  const weekKey = ymd(monday);
  const lastWeekKey = ymd(addDays(monday, -7));
  const sunday = addDays(monday, 6);

  const [d, setD] = useState({ loading: true });
  const [tick, setTick] = useState(0);
  const reload = useCallback(() => setTick(t => t + 1), []);

  useEffect(() => {
    if (!user || !initials) return;
    let alive = true;
    (async () => {
      const [tasks, time, cal, projects, planner, marketing, approvals, billing, aging, financials] = await Promise.all([
        j(`/api/assigned-tasks?initials=${encodeURIComponent(initials)}`, { received: [], sent: [] }),
        j(`/api/time?week_key=${weekKey}`, { rows: [], entries: [], week: null }),
        j(`/api/calendar?initials=${encodeURIComponent(initials)}&start=${weekKey}&end=${ymd(sunday)}`, { events: [] }),
        j('/api/projects', { projects: [] }),
        j(`/api/planner?user_id=${user.id}&week_key=${weekKey}`, { entry: null, carriedPriorities: [] }),
        leadership ? j('/api/marketing', null) : Promise.resolve(null),
        leadership ? j(`/api/time?view=approvals&week_key=${lastWeekKey}`, { people: [] }) : Promise.resolve({ people: [] }),
        finance ? j(`/api/billing?view=month&period=${monthKey()}`, null) : Promise.resolve(null),
        leadership ? j('/api/aging', null) : Promise.resolve(null),
        finance ? j('/api/financials?months=3', null) : Promise.resolve(null),
      ]);
      if (!alive) return;
      setD({ loading: false, tasks, time, cal, projects: projects.projects || [], planner, marketing, approvals, billing, aging, financials, weekKey, lastWeekKey, monday, sunday });
    })();
    return () => { alive = false; };
  }, [user, initials, tick]); // eslint-disable-line react-hooks/exhaustive-deps

  return { ...d, reload, initials, role, leadership, finance, weekKey, monday, sunday };
}
