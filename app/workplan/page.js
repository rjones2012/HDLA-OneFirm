'use client';
const qp = (k, d) => { try { return new URLSearchParams(window.location.search).get(k) || d; } catch { return d; } };
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { supabase, dbToProject } from '../../lib/supabase';
import { Shell } from '../../components/shell/Shell';
import { Panel, Figure, Button, Pill, Tabs, Select, Modal, Empty } from '../../components/shell/ui';

/* ═══════════════════════════════════════════════════════════════════
   OneFirm — Work Plan
   Ported from the Hub's /workplan/[code] page. Every interaction is unchanged:
   Principal View grid, Team View, CDAM, Horizon, Dashboard (scorecard / hours /
   timeline / data admin), Projections (debounced cell saves + Wednesday snapshot),
   cell editor, repeat tasks, review flags, realtime subscriptions, Export for Claude.
   Only the chrome (Shell, Tabs, Panel, Pill, chips) and the palette changed.
   ═══════════════════════════════════════════════════════════════════ */

// ─── Staff Data with Rates ─────────────────────────────────────────────────────

const STAFF_RATES = {
  RJ: { name: 'Richie Jones', role: 'Partner', rate: 215 },
  CB: { name: 'Chris Barkley', role: 'Partner', rate: 215 },
  TJ: { name: 'TJ Eliason', role: 'Partner', rate: 205 },
  MB: { name: 'Michael Black', role: 'Partner', rate: 215 },
  RW: { name: 'Robert Whittemore', role: 'Principal', rate: 185 },
  AB: { name: 'Austen Berry', role: 'Principal', rate: 185 },
  MM: { name: 'Mary Miller', role: 'Principal', rate: 185 },
  HD: { name: 'Hank Dalton', role: 'Principal', rate: 185 },
  CM: { name: 'Chris Mantle', role: 'Principal - Operations', rate: 185 },
  Mac: { name: 'Maggie Ackerman', role: 'PM', rate: 150 },
  TS: { name: 'Thomas Schneider', role: 'PM', rate: 150 },
  YR: { name: 'Yuan Ren', role: 'SPD', rate: 150 },
  CH: { name: 'Carly Hutchison', role: 'SPD', rate: 135 },
  WB: { name: 'Watts Brown', role: 'PM', rate: 150 },
  RC: { name: 'Robert Cunningham', role: 'SPD', rate: 150 },
  EC: { name: 'Elizabeth Crimmins', role: 'PD', rate: 105 },
  JY: { name: 'John Yakimicki', role: 'PD', rate: 105 },
  Map: { name: 'Margaret Apperson', role: 'SPD', rate: 135 },
  TU: { name: 'Taylor Uren', role: 'PD', rate: 105 },
  ME: { name: 'Madeline Easter', role: 'PD', rate: 105 },
  SA: { name: 'Savannah Alexander', role: 'PD', rate: 105 },
  JD: { name: 'Jackson Davis', role: 'PD', rate: 105 },
  AM: { name: 'Andy Molina', role: 'PD', rate: 105 },
  AR: { name: 'Alex Ramirez', role: 'PD', rate: 105 },
  SI: { name: 'Sam Irwin', role: 'CDAM', rate: 115 },
  SD: { name: 'Sarah DuBose', role: 'Marketing Manager', rate: 105 },
  EP: { name: 'Ellie Peebles', role: 'Office Manager', rate: 75 },
  JK: { name: 'Jennifer Kerr', role: 'PD', rate: 105 },
  GA: { name: 'Grace Ackerman', role: 'PD', rate: 105 },
  JF: { name: 'Jessica Fairman', role: 'PD', rate: 105 },
  KR: { name: 'Katelyn Rockey', role: 'Intern', rate: 95 },
  Aim: { name: 'Aimee Robisky', role: 'Graphic Designer', rate: 105 },
};

const STAFF_BY_PRINCIPAL = {
  MM: ['TS', 'JD', 'SH', 'SA', 'KR'],
  AB: ['WB', 'Map', 'TU', 'ME', 'GA'],
  RW: ['Mac', 'CH', 'EC', 'JY', 'JK'],
  HD: ['YR', 'RC', 'AM', 'AR', 'JF'],
  CM: ['SD', 'EP', 'Aim']
};

// Add SH to rates (missing from image but on MM's team)
STAFF_RATES['SH'] = { name: 'Samie Hubbard', role: 'PD', rate: 105 };

const PHASES = ['MP', 'CO', 'SD', 'DD', 'CD', 'CA'];
const PARTNERS = ['RJ', 'CB', 'TJ', 'MB'];
const HEALTH_OPTIONS = ['Good', 'Watch', 'Poor'];
const PRINCIPAL_NAMES = { MM: 'Mary Miller', AB: 'Austen Berry', RW: 'Robert Whittemore', HD: 'Hank Dalton', CM: 'Chris Mantle' };

function getStaffForProject(principal, partnersInCharge = []) {
  const baseStaff = [...(STAFF_BY_PRINCIPAL[principal] || [])];
  baseStaff.push(principal);
  if (principal !== 'CM') {
    baseStaff.push('SI');
    baseStaff.push('TJ');
    partnersInCharge.forEach(p => { if (p !== 'TJ' && !baseStaff.includes(p)) baseStaff.push(p); });
  }
  return baseStaff;
}

function generateId() { return Date.now().toString(36) + Math.random().toString(36).substr(2, 9); }

function getMonday(date) {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  d.setDate(diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

function getWeekLabel(date) { return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }); }

function getWeeksArray(numWeeks = 8, includePastWeeks = 0) {
  const weeks = [];
  const monday = getMonday(new Date());
  // Start from past weeks if specified
  for (let i = -includePastWeeks; i < numWeeks; i++) {
    const weekStart = new Date(monday);
    weekStart.setDate(monday.getDate() + i * 7);
    weeks.push({ date: weekStart, label: getWeekLabel(weekStart), key: weekStart.toISOString().split('T')[0] });
  }
  return weeks;
}

function isDateInWeek(dateStr, weekKey) {
  if (!dateStr) return false;
  const date = new Date(dateStr);
  const weekStart = new Date(weekKey);
  const weekEnd = new Date(weekKey);
  weekEnd.setDate(weekEnd.getDate() + 6);
  weekEnd.setHours(23, 59, 59, 999);
  return date >= weekStart && date <= weekEnd;
}

function formatDate(dateStr) {
  if (!dateStr) return '';
  // Parse as local time to avoid timezone shift
  const [year, month, day] = dateStr.split('-').map(Number);
  const d = new Date(year, month - 1, day);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function formatShortDate(dateStr) {
  if (!dateStr) return '';
  // Parse as local time to avoid timezone shift
  const [year, month, day] = dateStr.split('-').map(Number);
  return `${month}/${day}`;
}

function calculatePlannedFee(tasks) {
  let total = 0;
  (tasks || []).forEach(t => {
    const rate = STAFF_RATES[t.staff]?.rate || 100;
    total += (t.hours || 0) * rate;
  });
  return total;
}

function formatCurrency(num) {
  if (!num && num !== 0) return '';
  return '$' + num.toLocaleString('en-US', { maximumFractionDigits: 0 });
}

// ─── Visual helpers (OneFirm chips / status colors) ────────────────────────────

// Milestone chip class: one meaning per shape, one palette.
// deadline = solid ink, hardCheckIn = solid accent, softCheckIn = accent outline, completed = done.
function chipClass(type, completed) {
  if (completed) return 'chip-done';
  if (type === 'deadline') return 'chip-deadline';
  if (type === 'hardCheckIn') return 'chip-hard';
  return 'chip-soft';
}
const MILESTONE_PILL_KIND = { deadline: 'deadline', hardCheckIn: 'hard', softCheckIn: 'soft' };
const MILESTONE_SHORT = { deadline: 'Deadline', hardCheckIn: 'Hard', softCheckIn: 'Soft' };
function milestonePill(type) { return <Pill kind={MILESTONE_PILL_KIND[type] || 'soft'}>{MILESTONE_SHORT[type] || 'Soft'}</Pill>; }

// Weekly hours: red only over the 45h line, amber at 40–45 (watch), ink otherwise
function hoursTextClass(hours) { return hours > 45 ? 'text-status-red' : hours >= 40 ? 'text-status-amber' : 'text-ink'; }
function hoursBarClass(hours) { return hours > 45 ? 'bg-status-red' : hours >= 40 ? 'bg-status-amber' : 'bg-ink'; }

// Health dot: Poor = red, Watch = amber, Good = ink
function healthDotClass(project) {
  if (project.internalHealth === 'Poor' || project.externalHealth === 'Poor') return 'bg-status-red';
  if (project.internalHealth === 'Watch' || project.externalHealth === 'Watch') return 'bg-status-amber';
  return 'bg-ink';
}

// Small form controls for the dense editors (ui Input/Select are 38px tall; these keep the old row height)
const smallField = 'border border-rule rounded-[3px] px-2 py-1.5 text-[13px] bg-white';
const tinyField = 'text-xs border border-rule rounded-[3px] px-1.5 py-0.5 bg-white text-ink';
const removeBtn = 'text-muted hover:text-status-red px-1 text-lg leading-none';
const linkBtn = 'text-xs font-bold text-accent';
const gridHeader = 'bg-ink text-white';
const stickyProjectCell = 'w-80 flex-shrink-0 px-3 py-2 border-r border-rule sticky left-0 z-30 flex items-center justify-between gap-2';

// ─── Cell Editor Modal ─────────────────────────────────────────────────────────

function CellEditor({ project, weekKey, weekLabel, onClose, onSave, principal }) {
  const [milestones, setMilestones] = useState((project.milestones || []).filter(m => isDateInWeek(m.date, weekKey)));
  const [tasks, setTasks] = useState((project.tasks || []).filter(t => t.week === weekLabel));
  const staff = getStaffForProject(principal, project.partnersInCharge || []);

  const handleSave = async () => {
    const cleanTasks = tasks.filter(t => t.task);
    const cleanMilestones = milestones.filter(m => m.description);

    // Expand repeated tasks
    const repeatTasks = [];
    cleanTasks.forEach(t => {
      if (t.repeatWeeks && t.repeatWeeks > 0) {
        const baseMonday = getMonday(new Date(weekKey));
        for (let w = 1; w <= t.repeatWeeks; w++) {
          const futureMonday = new Date(baseMonday);
          futureMonday.setDate(baseMonday.getDate() + w * 7);
          const futureLabel = getWeekLabel(futureMonday);
          repeatTasks.push({ ...t, id: generateId(), week: futureLabel, repeatWeeks: undefined });
        }
      }
    });
    const tasksToSave = cleanTasks.map(t => ({ ...t, repeatWeeks: undefined }));

    // Single atomic save — tasks + milestones + repeats in one DB round-trip
    try {
      await fetch('/api/projects', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ saveCellEdit: { projectId: project.id, weekLabel, weekKey, tasks: tasksToSave, milestones: cleanMilestones, repeatTasks: repeatTasks.length > 0 ? repeatTasks : undefined } }) });
    } catch (e) { console.error('Save error:', e); }

    // Update local state optimistically
    const otherTasks = (project.tasks || []).filter(t => t.week !== weekLabel);
    const otherMilestones = (project.milestones || []).filter(m => !isDateInWeek(m.date, weekKey));
    onSave({ ...project, tasks: [...otherTasks, ...tasksToSave, ...repeatTasks], milestones: [...otherMilestones, ...cleanMilestones] });
    onClose();
  };

  const addMilestone = () => {
    const weekDate = new Date(weekKey);
    weekDate.setDate(weekDate.getDate() + 4);
    setMilestones([...milestones, { id: generateId(), type: 'deadline', date: weekDate.toISOString().split('T')[0], description: '' }]);
  };

  const addTask = () => { setTasks([...tasks, { id: generateId(), week: weekLabel, staff: staff[0] || '', task: '', hours: 0, repeatWeeks: 0 }]); };

  // Closing the modal (backdrop or Done) saves, exactly as before
  return (
    <Modal title={<>{project.projectName || 'Unnamed'} <span className="font-lato font-light text-sm text-muted ml-2">Week of {weekLabel}</span></>} onClose={handleSave}>
      <div>
        <div className="flex justify-between items-center mb-2">
          <label className="text-xs text-muted uppercase tracking-[0.08em]">Milestones</label>
          <button type="button" onClick={addMilestone} className={linkBtn}>+ Add Milestone</button>
        </div>
        {milestones.length === 0 ? <div className="text-sm text-muted italic py-2">No milestones this week</div> : (
          <div className="space-y-2">
            {milestones.map((m, i) => (
              <div key={m.id || i} className={`flex gap-2 items-center p-2 rounded-[3px] border border-hair ${m.completed ? 'bg-hair' : 'bg-ground'}`}>
                <input type="checkbox" checked={!!m.completed} onChange={(e) => { const updated = [...milestones]; updated[i] = { ...m, completed: e.target.checked }; setMilestones(updated); }} className="flex-shrink-0" title="Mark complete" />
                <select value={m.type} onChange={(e) => { const updated = [...milestones]; updated[i] = { ...m, type: e.target.value }; setMilestones(updated); }} className={`${smallField} w-28`}>
                  <option value="hardCheckIn">Hard Check-in</option>
                  <option value="softCheckIn">Soft Check-in</option>
                  <option value="deadline">Deadline</option>
                </select>
                <input type="date" value={m.date} onChange={(e) => { const updated = [...milestones]; updated[i] = { ...m, date: e.target.value }; setMilestones(updated); }} className={smallField} />
                <input type="text" value={m.description} onChange={(e) => { const updated = [...milestones]; updated[i] = { ...m, description: e.target.value }; setMilestones(updated); }} placeholder="Description" className={`${smallField} flex-1 ${m.completed ? 'line-through text-done' : ''}`} autoFocus={!m.description} />
                <button type="button" onClick={() => setMilestones(milestones.filter((_, j) => j !== i))} className={removeBtn}>×</button>
              </div>
            ))}
          </div>
        )}
      </div>
      <div>
        <div className="flex justify-between items-center mb-2">
          <label className="text-xs text-muted uppercase tracking-[0.08em]">Tasks</label>
          <button type="button" onClick={addTask} className={linkBtn}>+ Add Task</button>
        </div>
        {tasks.length === 0 ? <div className="text-sm text-muted italic py-2">No tasks this week</div> : (
          <div className="space-y-2">
            {tasks.map((t, i) => (
              <div key={t.id || i} className={`flex gap-2 items-center p-2 rounded-[3px] border border-hair ${t.completed ? 'bg-hair' : 'bg-ground'}`}>
                <input type="checkbox" checked={!!t.completed} onChange={(e) => { const updated = [...tasks]; updated[i] = { ...t, completed: e.target.checked, completionUpdatedAt: Date.now() }; setTasks(updated); }} className="flex-shrink-0" title="Mark complete" />
                <select value={t.staff} onChange={(e) => { const updated = [...tasks]; updated[i] = { ...t, staff: e.target.value }; setTasks(updated); }} className={`${smallField} w-20`}>{staff.map(s => <option key={s} value={s}>{s}</option>)}</select>
                <input type="text" value={t.task} onChange={(e) => { const updated = [...tasks]; updated[i] = { ...t, task: e.target.value }; setTasks(updated); }} placeholder="Task description" className={`${smallField} flex-1 ${t.completed ? 'line-through text-done' : ''}`} autoFocus={!t.task} />
                <input type="number" value={t.hours || ''} onChange={(e) => { const updated = [...tasks]; updated[i] = { ...t, hours: parseInt(e.target.value) || 0 }; setTasks(updated); }} placeholder="Hrs" className={`${smallField} w-16 text-right`} />
                <select value={t.repeatWeeks || 0} onChange={(e) => { const updated = [...tasks]; updated[i] = { ...t, repeatWeeks: parseInt(e.target.value) || 0 }; setTasks(updated); }} className={`${smallField} w-20`} title="Repeat across weeks"><option value={0}>1×</option><option value={1}>2wk</option><option value={2}>3wk</option><option value={3}>4wk</option><option value={5}>6wk</option><option value={7}>8wk</option><option value={11}>12wk</option></select>
                <button type="button" onClick={() => setTasks(tasks.filter((_, j) => j !== i))} className={removeBtn}>×</button>
              </div>
            ))}
          </div>
        )}
      </div>
    </Modal>
  );
}

// ─── Project Settings Modal ────────────────────────────────────────────────────

function ProjectSettings({ project, onSave, onClose, onDelete }) {
  const [data, setData] = useState({ ...project });
  const handleSave = async () => {
    // Send only the scalar fields that could have changed
    const fields = {
      projectNum: data.projectNum, projectName: data.projectName, phase: data.phase,
      partnersInCharge: data.partnersInCharge, teamMembers: data.teamMembers,
      needsReview: data.needsReview, partnerNeeds: data.partnerNeeds,
      internalHealth: data.internalHealth, externalHealth: data.externalHealth, needs: data.needs,
    };
    try {
      await fetch('/api/projects', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ updateFields: { projectId: data.id, fields } }) });
    } catch (e) { console.error('Save error:', e); }
    onSave(data);
    onClose();
  };

  const fieldLabel = 'block text-xs text-muted mb-1';
  const fullField = `w-full ${smallField} px-3 py-2`;

  return (
    <Modal title="Project settings" onClose={handleSave}>
      <div className="grid grid-cols-2 gap-4">
        <div><label className={fieldLabel}>Project #</label><input type="text" value={data.projectNum || ''} onChange={(e) => setData({ ...data, projectNum: e.target.value })} className={fullField} placeholder="25-2454" /></div>
        <div><label className={fieldLabel}>Phase</label><select value={data.phase || ''} onChange={(e) => setData({ ...data, phase: e.target.value })} className={fullField}><option value="">Select...</option>{PHASES.map(p => <option key={p} value={p}>{p}</option>)}</select></div>
      </div>
      <div><label className={fieldLabel}>Project Name</label><input type="text" value={data.projectName || ''} onChange={(e) => setData({ ...data, projectName: e.target.value })} className={fullField} placeholder="Harpeth Knoll" /></div>

      <div><label className={fieldLabel}>Partner In Charge</label><div className="flex gap-4">{PARTNERS.map(p => (<label key={p} className="flex items-center gap-1.5 text-sm"><input type="checkbox" checked={(data.partnersInCharge || []).includes(p)} onChange={(e) => { const partnersInCharge = e.target.checked ? [...(data.partnersInCharge || []), p] : (data.partnersInCharge || []).filter(x => x !== p); setData({ ...data, partnersInCharge }); }} />{p}</label>))}</div></div>

      <div className="border-t border-rule pt-4">
        <label className={fieldLabel}>Needs Partner Review</label>
        <div className="flex gap-4 mb-2">{PARTNERS.map(p => (<label key={p} className="flex items-center gap-1.5 text-sm"><input type="checkbox" checked={(data.needsReview || []).includes(p)} onChange={(e) => { const needsReview = e.target.checked ? [...(data.needsReview || []), p] : (data.needsReview || []).filter(x => x !== p); setData({ ...data, needsReview }); }} /><span className={`${(data.needsReview || []).includes(p) ? 'text-status-red font-bold' : ''}`}>{p}</span></label>))}</div>
        <label className={fieldLabel}>Partner Needs</label>
        <textarea value={data.partnerNeeds || ''} onChange={(e) => setData({ ...data, partnerNeeds: e.target.value })} className={`${fullField} h-16 resize-none`} placeholder="What specifically do you need from partner?" />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div><label className={fieldLabel}>Internal Health</label><select value={data.internalHealth || ''} onChange={(e) => setData({ ...data, internalHealth: e.target.value })} className={fullField}><option value="">Select...</option>{HEALTH_OPTIONS.map(h => <option key={h} value={h}>{h}</option>)}</select></div>
        <div><label className={fieldLabel}>External Health</label><select value={data.externalHealth || ''} onChange={(e) => setData({ ...data, externalHealth: e.target.value })} className={fullField}><option value="">Select...</option>{HEALTH_OPTIONS.map(h => <option key={h} value={h}>{h}</option>)}</select></div>
      </div>

      <div><label className={fieldLabel}>General Project Needs</label><textarea value={data.needs || ''} onChange={(e) => setData({ ...data, needs: e.target.value })} className={`${fullField} h-20 resize-none`} placeholder="What does this project need?" /></div>

      <div className="border-t border-rule pt-4">
        <label className="block text-xs text-muted mb-2">Project Team Members</label>
        <p className="text-xs text-muted mb-2">Check who is on this project. In Team View, filtered staff will only see deadlines for their assigned projects.</p>
        <div className="flex flex-wrap gap-3">
          {(() => {
            const principalKey = data.principal || '';
            const teamStaff = [...(STAFF_BY_PRINCIPAL[principalKey] || []), principalKey].filter(Boolean);
            return teamStaff.map(s => (
              <label key={s} className="flex items-center gap-1.5 text-sm">
                <input type="checkbox" checked={(data.teamMembers || []).includes(s)} onChange={(e) => { const teamMembers = e.target.checked ? [...(data.teamMembers || []), s] : (data.teamMembers || []).filter(x => x !== s); setData({ ...data, teamMembers }); }} />
                <span className="font-bold">{s}</span>
                <span className="text-muted text-xs">{STAFF_RATES[s]?.name || ''}</span>
              </label>
            ));
          })()}
        </div>
      </div>

      <div className="pt-2 border-t border-rule flex justify-between items-center"><button type="button" onClick={() => { onDelete(data.id); onClose(); }} className="text-status-red text-sm font-bold">Delete Project</button></div>
    </Modal>
  );
}

// ─── Staff Task Editor Modal ───────────────────────────────────────────────────

function StaffTaskEditor({ staffMember, weekLabel, projects, principal, onClose, onSave }) {
  const principalProjects = projects.filter(p => p.principal === principal);
  const [tasksByProject, setTasksByProject] = useState(() => {
    const result = {};
    principalProjects.forEach(project => { result[project.id] = (project.tasks || []).filter(t => t.week === weekLabel && t.staff === staffMember); });
    return result;
  });

  const handleSave = async () => {
    const updatedProjects = principalProjects.map(project => {
      const otherTasks = (project.tasks || []).filter(t => !(t.week === weekLabel && t.staff === staffMember));
      const newTasks = (tasksByProject[project.id] || []).filter(t => t.task);
      return { ...project, tasks: [...otherTasks, ...newTasks] };
    });
    // Atomic save: for each project that changed, send setTasksForWeek
    // But we only changed tasks for this staff+week, so we send full week tasks per project
    try {
      await Promise.all(principalProjects.map(project => {
        const allWeekTasks = [
          ...(project.tasks || []).filter(t => t.week === weekLabel && t.staff !== staffMember),
          ...((tasksByProject[project.id] || []).filter(t => t.task)),
        ];
        // Only save if something changed
        const origTasks = (project.tasks || []).filter(t => t.week === weekLabel);
        if (JSON.stringify(allWeekTasks) === JSON.stringify(origTasks)) return Promise.resolve();
        // We need ALL tasks for this week (all staff), not just this staff member
        const otherStaffTasks = (project.tasks || []).filter(t => t.week === weekLabel && t.staff !== staffMember);
        const thisStaffTasks = (tasksByProject[project.id] || []).filter(t => t.task);
        return fetch('/api/projects', { method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ setTasksForWeek: { projectId: project.id, weekLabel, tasks: [...otherStaffTasks, ...thisStaffTasks] } }) });
      }));
    } catch (e) { console.error('Save error:', e); }
    onSave(updatedProjects);
    onClose();
  };

  const addTask = (projectId) => { setTasksByProject({ ...tasksByProject, [projectId]: [...(tasksByProject[projectId] || []), { id: generateId(), week: weekLabel, staff: staffMember, task: '', hours: 0 }] }); };
  const updateTask = (projectId, taskIndex, field, value) => { const updated = [...(tasksByProject[projectId] || [])]; updated[taskIndex] = { ...updated[taskIndex], [field]: value, ...(field === 'completed' ? { completionUpdatedAt: Date.now() } : {}) }; setTasksByProject({ ...tasksByProject, [projectId]: updated }); };
  const removeTask = (projectId, taskIndex) => { const updated = (tasksByProject[projectId] || []).filter((_, i) => i !== taskIndex); setTasksByProject({ ...tasksByProject, [projectId]: updated }); };
  const totalHours = Object.values(tasksByProject).flat().reduce((sum, t) => sum + (t.hours || 0), 0);

  return (
    <Modal title={<>{STAFF_RATES[staffMember]?.name || staffMember} <span className="font-lato font-light text-sm text-muted ml-2">Week of {weekLabel} · {totalHours}h total</span></>} onClose={handleSave}>
      {principalProjects.map(project => (
        <div key={project.id} className="border border-rule rounded p-3">
          <div className="flex justify-between items-center mb-2"><div className="font-flecha text-sm">{project.projectName || 'Unnamed'}</div><button type="button" onClick={() => addTask(project.id)} className={linkBtn}>+ Add Task</button></div>
          {(tasksByProject[project.id] || []).length === 0 ? <div className="text-sm text-muted italic">No tasks assigned</div> : (
            <div className="space-y-2">
              {(tasksByProject[project.id] || []).map((t, i) => (
                <div key={t.id || i} className={`flex gap-2 items-center ${t.completed ? 'opacity-60' : ''}`}>
                  <input type="checkbox" checked={!!t.completed} onChange={(e) => updateTask(project.id, i, 'completed', e.target.checked)} className="flex-shrink-0" title="Mark complete" />
                  <input type="text" value={t.task} onChange={(e) => updateTask(project.id, i, 'task', e.target.value)} placeholder="Task description" className={`${smallField} flex-1 ${t.completed ? 'line-through text-done' : ''}`} autoFocus={!t.task} />
                  <input type="number" value={t.hours || ''} onChange={(e) => updateTask(project.id, i, 'hours', parseInt(e.target.value) || 0)} placeholder="Hrs" className={`${smallField} w-16 text-right`} />
                  <button type="button" onClick={() => removeTask(project.id, i)} className={removeBtn}>×</button>
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
    </Modal>
  );
}

// ─── Staff Hours Summary ───────────────────────────────────────────────────────

function StaffHoursSummary({ projects, weeks, principal }) {
  const staff = getStaffForProject(principal, []);
  const principalProjects = projects.filter(p => p.principal === principal);
  const hoursByStaffByWeek = {};
  staff.forEach(s => { hoursByStaffByWeek[s] = {}; weeks.forEach(w => { hoursByStaffByWeek[s][w.label] = 0; }); });
  principalProjects.forEach(project => { (project.tasks || []).forEach(task => { if (hoursByStaffByWeek[task.staff] && hoursByStaffByWeek[task.staff][task.week] !== undefined) { hoursByStaffByWeek[task.staff][task.week] += task.hours || 0; } }); });

  return (
    <Panel title="Staff hours" meta="Planned task hours per week · red over 45h, amber 40–45h" className="mt-4 overflow-hidden">
      <div className={`flex border-b border-rule ${gridHeader}`}>
        <div className="w-48 flex-shrink-0 px-3 py-2 font-bold text-xs border-r border-rule">Staff</div>
        {weeks.map(week => (<div key={week.key} className="flex-1 min-w-0 px-1 py-2 text-center border-r border-rule/30 last:border-r-0"><div className="text-xs font-bold">{week.label}</div></div>))}
      </div>
      {staff.filter(s => STAFF_BY_PRINCIPAL[principal]?.includes(s) || s === principal).map(s => (
        <div key={s} className="flex border-b border-hair last:border-b-0">
          <div className="w-48 flex-shrink-0 px-3 py-1.5 border-r border-rule text-sm font-bold text-ink">{s}</div>
          {weeks.map(week => {
            const hours = hoursByStaffByWeek[s]?.[week.label] || 0;
            const cls = hours > 0 ? `${hoursTextClass(hours)} font-bold` : 'text-done';
            return (<div key={week.key} className={`flex-1 min-w-0 px-1 py-1.5 text-center text-sm border-r border-hair last:border-r-0 ${cls}`}>{hours > 0 ? `${hours}h` : '—'}</div>);
          })}
        </div>
      ))}
    </Panel>
  );
}

// ─── Principal View ────────────────────────────────────────────────────────────

function PrincipalView({ projects, principal, onCellClick, onProjectClick, feeData, projectionData, allWeeks, zoomLevel }) {
  // Sorting - persisted in localStorage
  const [sortBy, setSortBy] = useState(() => {
    if (typeof window !== 'undefined') {
      try { return localStorage.getItem('hdla-sort') || 'name'; } catch { return 'name'; }
    }
    return 'name';
  });

  // Phase filter - persisted in localStorage
  const [filterPhase, setFilterPhase] = useState(() => {
    if (typeof window !== 'undefined') {
      try { return localStorage.getItem('hdla-phase-filter') || 'all'; } catch { return 'all'; }
    }
    return 'all';
  });

  const handleSortChange = (newSort) => {
    setSortBy(newSort);
    if (typeof window !== 'undefined') {
      try { localStorage.setItem('hdla-sort', newSort); } catch {}
    }
  };

  const handlePhaseFilterChange = (newPhase) => {
    setFilterPhase(newPhase);
    if (typeof window !== 'undefined') {
      try { localStorage.setItem('hdla-phase-filter', newPhase); } catch {}
    }
  };

  // Get total fee remaining across ALL phases for a project
  const getTotalFeeRemaining = (projectNum) => {
    if (!feeData || !projectNum) return null;
    const matches = feeData.filter(row => row['Project #'] === projectNum);
    if (matches.length === 0) return null;
    return matches.reduce((sum, row) => sum + (row['Fee Remaining'] || 0), 0);
  };

  // Filter and sort projects
  const filteredProjects = projects.filter(p => p.principal === principal)
    .filter(p => filterPhase === 'all' || p.phase === filterPhase);

  const sortedProjects = [...filteredProjects].sort((a, b) => {
    switch (sortBy) {
      case 'name':
        return (a.projectName || '').localeCompare(b.projectName || '');
      case 'number':
        return (a.projectNum || '').localeCompare(b.projectNum || '');
      case 'fee': {
        const feeA = getTotalFeeRemaining(a.projectNum) || 0;
        const feeB = getTotalFeeRemaining(b.projectNum) || 0;
        return feeB - feeA; // High to low
      }
      default:
        return 0;
    }
  });

  const principalProjects = sortedProjects;

  // Get projected percentages for next 4 months - aggregated across all phases for this project
  const getProjectedPercentages = (projectNum) => {
    const months = getMonthsArray(4);

    // Find all projection keys that start with this project number
    const projectKeys = Object.keys(projectionData || {}).filter(key => key.startsWith(projectNum + '-'));

    return months.map(month => {
      const seen = new Set();
      const entries = [];
      projectKeys.forEach(key => {
        const projData = projectionData[key];
        const pct = projData?.months?.[month.key];
        if (pct !== null && pct !== undefined) {
          const withoutProjectNum = key.slice(projectNum.length + 1);
          const parts = withoutProjectNum.split('-');
          const phase = parts[0];
          // Deduplicate: only one entry per phase+pct combo
          const dedupeKey = `${phase}-${pct}`;
          if (!seen.has(dedupeKey)) {
            seen.add(dedupeKey);
            entries.push({ pct, phase });
          }
        }
      });
      const letterLabel = month.label.charAt(0);
      return { label: letterLabel, entries };
    });
  };

  // For 1, 2, 4: show exactly that many weeks, no scroll, no past week
  // For 8, 16: show all weeks with scroll, includes past week
  const isScrollable = zoomLevel >= 8;
  const displayWeeks = isScrollable ? allWeeks : getWeeksArray(zoomLevel, 0); // 0 = no past weeks for small zoom

  // Column widths - for non-scrollable, fill available space nicely
  const colWidth = isScrollable ? 120 : Math.floor(1000 / zoomLevel);

  return (
    <>
      <div className="bg-white border border-rule rounded overflow-hidden">
        <div className="overflow-auto max-h-[75vh]">
          <div style={isScrollable ? { width: `${320 + displayWeeks.length * colWidth}px`, minWidth: '100%' } : {}}>
            {/* Sticky header */}
            <div className={`flex border-b border-rule sticky top-0 z-20 ${gridHeader}`}>
              <div className={`${stickyProjectCell} ${gridHeader}`}>
                <span className="font-bold text-xs">Projects</span>
                <div className="flex gap-1">
                  <select
                    value={filterPhase}
                    onChange={(e) => handlePhaseFilterChange(e.target.value)}
                    className={tinyField}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <option value="all">All Phases</option>
                    {PHASES.map(phase => (
                      <option key={phase} value={phase}>{phase}</option>
                    ))}
                  </select>
                  <select
                    value={sortBy}
                    onChange={(e) => handleSortChange(e.target.value)}
                    className={tinyField}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <option value="name">A-Z</option>
                    <option value="number">Number</option>
                    <option value="fee">Fee ↓</option>
                  </select>
                </div>
              </div>
              {displayWeeks.map((week, idx) => {
                const isPastWeek = isScrollable && idx === 0;
                return (
                  <div key={week.key} className={`${isScrollable ? 'flex-shrink-0' : 'flex-1'} px-1 py-2 text-center border-r border-white/15 last:border-r-0 ${isPastWeek ? 'opacity-70' : ''}`} style={isScrollable ? { width: `${colWidth}px` } : {}}>
                    <div className="text-xs font-bold">{week.label}</div>
                    {isPastWeek && <div className="text-[10px] font-normal">last wk</div>}
                  </div>
                );
              })}
            </div>
            {principalProjects.length === 0 ? (<Empty>No projects yet. Click &ldquo;+ Add Project&rdquo; to get started.</Empty>) : (
              principalProjects.map(project => {
                const hasNeeds = project.needs && project.needs.trim();
                const needsReview = project.needsReview || [];
                const totalFeeRemaining = getTotalFeeRemaining(project.projectNum);
                const plannedFee = calculatePlannedFee(project.tasks);
                const projectedPcts = getProjectedPercentages(project.projectNum);

                // Planned vs remaining: red at 90%+ of the remaining fee, amber at 75%+, ink below
                const getPlannedColor = () => {
                  if (!totalFeeRemaining || totalFeeRemaining <= 0) return 'text-muted';
                  const pct = (plannedFee / totalFeeRemaining) * 100;
                  if (pct >= 90) return 'text-status-red';
                  if (pct >= 75) return 'text-status-amber';
                  return 'text-ink';
                };

                return (
                  <div key={project.id} className="border-t border-rule first:border-t-0">
                    {(hasNeeds || needsReview.length > 0) && (
                      <div className="flex bg-ground border-b border-hair text-xs">
                        <div className="w-80 flex-shrink-0 px-3 py-1 border-r border-rule truncate sticky left-0 bg-ground z-10">{needsReview.length > 0 && (needsReview.map(r => { const done = (project.reviewCompletedBy || {})[r]; return <span key={r} className={`inline-block px-1.5 py-0.5 rounded-[2px] text-[11px] font-bold mr-1 ${done ? 'chip-done' : 'border border-status-red text-status-red'}`}>{r} {done ? '✓' : 'review'}</span>; }))}</div>
                        <div className="flex-1 px-2 py-1 text-muted truncate">{hasNeeds && project.needs}</div>
                      </div>
                    )}
                    <div className="flex hover:bg-ground/60">
                      <div className="w-80 flex-shrink-0 px-2 py-2 border-r border-rule cursor-pointer hover:bg-ground bg-white flex sticky left-0 z-10" onClick={() => onProjectClick(project)}>
                        {/* Left column - project info */}
                        <div className="flex-1 min-w-0 pr-2">
                          {/* Project name links to the project page; the rest of the cell still opens settings */}
                          <a href={`/workplan/project/${project.id}`} onClick={(e) => e.stopPropagation()} className="font-flecha text-sm text-ink hover:text-accent block truncate" title="Open project">{project.projectName || 'Unnamed'}</a>
                          <div className="text-xs text-muted flex items-center gap-2">
                            <span>{project.projectNum || '—'}</span>
                            {project.phase && <Pill kind="phase">{project.phase}</Pill>}
                            {(project.internalHealth === 'Poor' || project.externalHealth === 'Poor') && (<span className="w-2 h-2 rounded-full bg-status-red" />)}
                            {(project.internalHealth === 'Watch' || project.externalHealth === 'Watch') && project.internalHealth !== 'Poor' && project.externalHealth !== 'Poor' && (<span className="w-2 h-2 rounded-full bg-status-amber" />)}
                          </div>
                          <div className="text-xs mt-1 space-y-0.5">
                            {totalFeeRemaining !== null && (
                              <div className="font-bold text-ink">
                                {formatCurrency(totalFeeRemaining)} <span className="font-normal text-muted">remaining</span>
                              </div>
                            )}
                            {plannedFee > 0 && (
                              <div className={`font-bold ${getPlannedColor()}`}>{formatCurrency(plannedFee)} planned</div>
                            )}
                          </div>
                        </div>
                        {/* Right column - projected percentages (fixed width, consistent alignment) */}
                        <div className="w-28 flex-shrink-0 border-l border-rule pl-2 text-xs text-muted overflow-hidden">
                          {projectedPcts.some(p => p.entries && p.entries.length > 0) ? (
                            <div className="space-y-0.5">
                              {projectedPcts.map((p, i) => (
                                <div key={i} className="flex">
                                  <span className="w-4 font-bold text-muted">{p.label}:</span>
                                  <span className="flex-1 text-ink">
                                    {p.entries && p.entries.length > 0 ? (
                                      p.entries.map((e, j) => (
                                        <span key={j}>
                                          {j > 0 && '/'}
                                          {e.pct}<span className="text-muted text-[10px]">{e.phase}</span>
                                        </span>
                                      ))
                                    ) : '—'}
                                  </span>
                                </div>
                              ))}
                            </div>
                          ) : (
                            <div className="text-done text-[10px]">No projections</div>
                          )}
                        </div>
                      </div>
                      {displayWeeks.map((week, idx) => {
                        const milestones = (project.milestones || []).filter(m => isDateInWeek(m.date, week.key));
                        const tasks = (project.tasks || []).filter(t => t.week === week.label);
                        const totalHours = tasks.reduce((sum, t) => sum + (t.hours || 0), 0);
                        const isPastWeek = isScrollable && idx === 0;
                        return (
                          <div key={week.key} className={`${isScrollable ? 'flex-shrink-0' : 'flex-1'} p-1 border-r border-rule last:border-r-0 cursor-pointer hover:bg-accent-tint overflow-hidden ${isPastWeek ? 'bg-ground' : ''}`} style={isScrollable ? { width: `${colWidth}px`, minHeight: '80px' } : { minHeight: '80px' }} onClick={() => onCellClick(project, week)}>
                            {milestones.map((m, i) => (<div key={i} className={`text-xs truncate mb-0.5 px-1 rounded-[2px] font-bold ${chipClass(m.type, m.completed)}`}>{formatShortDate(m.date)} {m.description}</div>))}
                            {tasks.slice(0, 2).map((t, i) => (<div key={i} className={`text-xs truncate ${t.completed ? 'line-through text-done' : 'text-muted'}`}><span className="font-bold">{t.staff}</span>: {t.task}</div>))}
                            {tasks.length > 2 && (<div className="text-xs text-muted">+{tasks.length - 2} more</div>)}
                            {totalHours > 0 && (<div className={`text-xs font-bold mt-1 ${hoursTextClass(totalHours)}`}>{totalHours}h</div>)}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>
      <StaffHoursSummary projects={projects} weeks={displayWeeks.slice(0, 8)} principal={principal} />
    </>
  );
}

// ─── Team View ─────────────────────────────────────────────────────────────────

function TeamView({ projects, weeks, principal, onStaffCellClick }) {
  const baseStaff = STAFF_BY_PRINCIPAL[principal] || [];
  const allStaff = [...baseStaff, principal];
  const [filterStaff, setFilterStaff] = useState('all');
  const principalProjects = projects.filter(p => p.principal === principal);
  const displayStaff = filterStaff === 'all' ? allStaff : [filterStaff];

  const getStaffWeekData = (staffMember, weekLabel) => {
    let hours = 0; const taskList = [];
    principalProjects.forEach(project => { (project.tasks || []).forEach(task => { if (task.staff === staffMember && task.week === weekLabel) { hours += task.hours || 0; taskList.push({ project: project.projectName, task: task.task, hours: task.hours, completed: !!task.completed }); } }); });
    return { hours, tasks: taskList };
  };

  // Get deadlines for the team - optionally filtered to projects a staff member is on
  const getDeadlinesForWeek = (weekKey, staffFilter = null) => {
    const deadlines = [];
    principalProjects.forEach(project => {
      // If filtering by staff, only show deadlines from projects they're assigned to
      if (staffFilter) {
        const teamMembers = project.teamMembers || [];
        // If teamMembers is empty (not configured yet), show all deadlines
        // If configured, only show if this staff member is on the team
        if (teamMembers.length > 0 && !teamMembers.includes(staffFilter)) return;
      }
      (project.milestones || []).forEach(m => {
        if (isDateInWeek(m.date, weekKey)) {
          deadlines.push({ ...m, projectName: project.projectName });
        }
      });
    });
    return deadlines;
  };

  // Build chronological task list
  const buildTaskList = () => {
    const list = [];
    weeks.forEach(week => {
      // Add deadlines - filtered by staff's project assignments when filtering
      const deadlineStaffFilter = filterStaff !== 'all' ? filterStaff : null;
      const deadlines = getDeadlinesForWeek(week.key, deadlineStaffFilter);
      deadlines.forEach(d => {
        if (filterStaff === 'all' || filterStaff === principal || deadlineStaffFilter) {
          list.push({ type: 'milestone', milestoneType: d.type, date: d.date, description: d.description, projectName: d.projectName, week: week.label });
        }
      });
      // Add tasks
      displayStaff.forEach(staffMember => {
        const { tasks } = getStaffWeekData(staffMember, week.label);
        tasks.forEach(t => {
          list.push({ type: 'task', staff: staffMember, task: t.task, hours: t.hours, project: t.project, week: week.label, completed: t.completed });
        });
      });
    });
    return list;
  };

  const taskList = buildTaskList();

  return (
    <div>
      <div className="mb-3"><Select value={filterStaff} onChange={(e) => setFilterStaff(e.target.value)}><option value="all">All Team Members</option>{allStaff.map(s => (<option key={s} value={s}>{s} - {STAFF_RATES[s]?.name || s}</option>))}</Select></div>

      <div className="bg-white border border-rule rounded overflow-hidden">
        <div className={`flex border-b border-rule ${gridHeader}`}>
          <div className="w-48 flex-shrink-0 px-3 py-2 font-bold text-xs border-r border-white/15">Team Members</div>
          {weeks.map(week => (<div key={week.key} className="flex-1 min-w-0 px-1 py-2 text-center border-r border-white/15 last:border-r-0"><div className="text-xs font-bold">{week.label}</div></div>))}
        </div>

        {/* Deadlines row - show in all view */}
        {filterStaff === 'all' && (
          <div className="flex border-b border-rule bg-ground/60">
            <div className="w-48 flex-shrink-0 px-3 py-2 border-r border-rule text-sm font-bold text-ink">Deadlines</div>
            {weeks.map(week => {
              const deadlines = getDeadlinesForWeek(week.key);
              return (
                <div key={week.key} className="flex-1 min-w-0 p-1 border-r border-hair last:border-r-0 overflow-hidden" style={{ minHeight: '50px' }}>
                  {deadlines.map((d, i) => (<div key={i} className={`text-xs truncate mb-0.5 px-1 rounded-[2px] font-bold ${chipClass(d.type, d.completed)}`}>{d.projectName?.slice(0,10)}: {d.description}</div>))}
                </div>
              );
            })}
          </div>
        )}

        {displayStaff.map(staffMember => (
          <div key={staffMember} className="flex border-b border-rule last:border-b-0 hover:bg-ground/60">
            <div className="w-48 flex-shrink-0 px-3 py-2 border-r border-rule"><div className="font-bold text-sm text-ink">{staffMember}</div><div className="text-xs text-muted">{STAFF_RATES[staffMember]?.name}</div></div>
            {weeks.map(week => {
              const { hours, tasks } = getStaffWeekData(staffMember, week.label);
              // Show deadlines in filtered view - filtered by this staff member's project assignments
              const deadlines = filterStaff !== 'all' ? getDeadlinesForWeek(week.key, staffMember) : [];
              return (
                <div key={week.key} className="flex-1 min-w-0 p-1 border-r border-hair last:border-r-0 cursor-pointer hover:bg-accent-tint overflow-hidden" style={{ minHeight: '70px' }} onClick={() => onStaffCellClick(staffMember, week)}>
                  {deadlines.map((d, i) => (<div key={`d${i}`} className={`text-xs truncate mb-0.5 px-1 rounded-[2px] font-bold ${chipClass(d.type, d.completed)}`}>{d.description}</div>))}
                  {tasks.slice(0, 3).map((t, i) => (<div key={i} className={`text-xs truncate ${t.completed ? 'line-through text-done' : 'text-ink'}`}><span className="text-muted">{t.project?.slice(0, 10)}:</span> {t.task}</div>))}
                  {tasks.length > 3 && (<div className="text-xs text-muted">+{tasks.length - 3} more</div>)}
                  {hours > 0 && (<div className={`text-xs font-bold mt-1 ${hoursTextClass(hours)}`}>{hours}h</div>)}
                </div>
              );
            })}
          </div>
        ))}
      </div>

      {/* Task List View */}
      <Panel title="Task list" meta={`${taskList.length} item${taskList.length === 1 ? '' : 's'} · tasks and deadlines in week order`} className="mt-4">
        <div className="max-h-80 overflow-auto">
          {taskList.length === 0 ? (<Empty>No tasks or deadlines</Empty>) : (
            taskList.map((item, i) => (
              <div key={i} className="flex items-center gap-3 px-4 py-2 border-b border-hair last:border-b-0 text-sm">
                <div className="w-16 text-muted">{item.week}</div>
                {item.type === 'milestone' ? (
                  <>
                    {milestonePill(item.milestoneType)}
                    <div className="flex-1 font-bold">{item.description}</div>
                    <div className="text-muted">{item.projectName}</div>
                  </>
                ) : (
                  <>
                    <div className={`w-12 font-bold ${item.completed ? 'text-done' : 'text-ink'}`}>{item.staff}</div>
                    <div className={`flex-1 ${item.completed ? 'line-through text-done' : ''}`}>{item.task}</div>
                    <div className="text-muted">{item.project}</div>
                    <div className={`w-12 text-right font-bold ${item.completed ? 'text-done' : 'text-ink'}`}>{item.hours}h</div>
                  </>
                )}
              </div>
            ))
          )}
        </div>
      </Panel>
    </div>
  );
}

// ─── Horizon View ──────────────────────────────────────────────────────────────

function HorizonView({ projects, principal }) {
  const [horizonRange, setHorizonRange] = useState(16);
  const principalProjects = projects.filter(p => p.principal === principal);
  const weeks = getWeeksArray(horizonRange === 26 ? 26 : horizonRange);

  // Count milestones by type per week
  const milestoneCounts = {};
  weeks.forEach(w => {
    milestoneCounts[w.key] = { deadline: 0, hard: 0, soft: 0 };
  });
  principalProjects.forEach(project => {
    (project.milestones || []).forEach(m => {
      weeks.forEach(w => {
        if (isDateInWeek(m.date, w.key)) {
          if (m.type === 'deadline') milestoneCounts[w.key].deadline++;
          else if (m.type === 'hardCheckIn') milestoneCounts[w.key].hard++;
          else milestoneCounts[w.key].soft++;
        }
      });
    });
  });

  const countBubble = 'w-5 h-5 rounded-[2px] flex items-center justify-center text-[11px] font-bold';

  return (
    <div>
      <div className="mb-3">
        <Select value={horizonRange} onChange={(e) => setHorizonRange(parseInt(e.target.value))}>
          <option value={4}>4 weeks</option>
          <option value={8}>8 weeks</option>
          <option value={16}>16 weeks</option>
          <option value={26}>6 months</option>
        </Select>
      </div>
      <div className="bg-white border border-rule rounded overflow-x-auto">
        <table className="w-full border-collapse" style={{ minWidth: horizonRange > 16 ? '1600px' : '1200px' }}>
          <thead>
            <tr className={`border-b border-rule ${gridHeader}`}>
              <th className={`w-40 px-3 py-2 text-left text-xs font-bold border-r border-white/15 sticky left-0 z-10 ${gridHeader}`}>Project</th>
              {weeks.map(week => (<th key={week.key} className="px-1 py-2 text-center border-r border-white/15 last:border-r-0" style={{ minWidth: '40px', maxWidth: '40px' }}><div className="text-[10px] font-normal opacity-80">{week.label.split(' ')[0]}</div><div className="text-xs font-bold">{week.label.split(' ')[1]}</div></th>))}
            </tr>
            <tr className="border-b-2 border-ink">
              <td className="px-3 py-2 text-xs font-bold text-ink border-r border-rule sticky left-0 bg-white z-10">TOTALS</td>
              {weeks.map(week => {
                const counts = milestoneCounts[week.key];
                return (
                  <td key={week.key} className="px-1 py-1 text-center border-r border-hair last:border-r-0">
                    <div className="flex items-center justify-center gap-0.5">
                      {counts.deadline > 0 && (
                        <div className={`${countBubble} chip-deadline`}>{counts.deadline}</div>
                      )}
                      {counts.hard > 0 && (
                        <div className={`${countBubble} chip-hard`}>{counts.hard}</div>
                      )}
                      {counts.soft > 0 && (
                        <div className={`${countBubble} chip-soft`}>{counts.soft}</div>
                      )}
                    </div>
                  </td>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {principalProjects.length === 0 ? (<tr><td colSpan={weeks.length + 1} className="p-8 text-center text-muted italic text-sm">No projects yet.</td></tr>) : (
              principalProjects.map(project => (
                <tr key={project.id} className="border-b border-hair hover:bg-ground/60">
                  <td className="px-3 py-2 border-r border-rule sticky left-0 bg-white z-10"><div className="font-flecha text-sm text-ink truncate">{project.projectName || 'Unnamed'}</div><div className="text-xs text-muted">{project.phase}</div></td>
                  {weeks.map(week => {
                    const milestones = (project.milestones || []).filter(m => isDateInWeek(m.date, week.key));
                    return (
                      <td key={week.key} className="px-1 py-1 text-center border-r border-hair last:border-r-0">
                        <div className="flex flex-col items-center gap-0.5">
                          {milestones.map((m, i) => (<div key={i} className={`w-3 h-3 rounded-[2px] ${chipClass(m.type, m.completed)}`} title={`${m.type}: ${m.description}`} />))}
                        </div>
                      </td>
                    );
                  })}
                </tr>
              ))
            )}
          </tbody>
        </table>
        <div className="px-4 py-2 border-t border-rule bg-ground flex gap-6 text-xs text-muted">
          <div className="flex items-center gap-1.5"><div className="w-3 h-3 rounded-[2px] chip-deadline" /> Deadline</div>
          <div className="flex items-center gap-1.5"><div className="w-3 h-3 rounded-[2px] chip-hard" /> Hard Check-in</div>
          <div className="flex items-center gap-1.5"><div className="w-3 h-3 rounded-[2px] chip-soft" /> Soft Check-in</div>
          <div className="flex items-center gap-1.5"><div className="w-3 h-3 rounded-[2px] chip-done" /> Done</div>
        </div>
      </div>
    </div>
  );
}

// ─── Dashboard View ────────────────────────────────────────────────────────────

function DashboardView({ projects, weeks, principal, feeData, projectionData }) {
  const [dashTab, setDashTab] = useState(() => qp('tab', 'scorecard'));
  const [partnerFilter, setPartnerFilter] = useState('all');
  const [hoursWeeks, setHoursWeeks] = useState(1);
  const [migrating, setMigrating] = useState(null); // { oldKey, newProjectNum }
  const [migrateStatus, setMigrateStatus] = useState('');

  const principalProjects = principal === 'ALL' ? projects : projects.filter(p => p.principal === principal);
  const baseStaff = principal === 'ALL' ? Object.keys(STAFF_BY_PRINCIPAL).flatMap(k => STAFF_BY_PRINCIPAL[k]) : (STAFF_BY_PRINCIPAL[principal] || []);
  const allStaff = principal === 'ALL' ? [...new Set([...baseStaff, ...Object.keys(PRINCIPAL_NAMES)])] : [...baseStaff, principal];

  // Filter projects by partner if selected
  const partnerFilteredProjects = partnerFilter === 'all'
    ? principalProjects
    : principalProjects.filter(p => (p.partnersInCharge || []).includes(partnerFilter));

  // Detect orphaned projection entries
  const validProjectNums = new Set((feeData || []).map(r => r['Project #']));
  const projectionKeys = Object.keys(projectionData || {});

  // Build set of all valid projection IDs from current master data
  // This handles both simple keys (25014-SD) and suffixed keys (25014-SD-iFamilyMallSite)
  const validProjectionIds = new Set();
  const rawProjRows = (feeData || []).filter(row => row['Status'] === 'O' || row['Status'] === 'PR');
  const projPhaseCount = {};
  rawProjRows.forEach(row => {
    const key = `${row['Project #']}-${row['Phase']}`;
    projPhaseCount[key] = (projPhaseCount[key] || 0) + 1;
  });
  rawProjRows.forEach(row => {
    const baseKey = `${row['Project #']}-${row['Phase']}`;
    const hasDuplicates = projPhaseCount[baseKey] > 1;
    const nameSuffix = hasDuplicates ? `-${(row['Project Name'] || '').replace(/[^a-zA-Z0-9]/g, '').slice(-15)}` : '';
    validProjectionIds.add(`${baseKey}${nameSuffix}`);
  });

  const orphanedKeys = projectionKeys.filter(key => {
    // Check if this key matches any valid projection ID
    if (validProjectionIds.has(key)) return false;
    // Also check if the project number itself exists (key might be from a closed project)
    const matchesAnyProject = [...validProjectNums].some(pn => key.startsWith(pn + '-'));
    return !matchesAnyProject;
  });

  // Group orphans - each key is its own entry since parsing is unreliable with suffixed keys
  const orphansByProject = {};
  orphanedKeys.forEach(key => {
    // Try to extract project number by matching against known format (digits-digits)
    const match = key.match(/^(\d+-\d+)/);
    const groupKey = match ? match[1] : key;
    if (!orphansByProject[groupKey]) orphansByProject[groupKey] = [];
    orphansByProject[groupKey].push(key);
  });
  const orphanCount = Object.keys(orphansByProject).length;

  // Get list of valid projects for dropdown
  const validProjects = [...new Set((feeData || []).map(r => r['Project #']))].sort();

  // Handle migration
  const handleMigrate = async (oldProjectNum, newProjectNum) => {
    if (!newProjectNum) return;
    setMigrateStatus('Migrating...');
    try {
      const res = await fetch('/api/migrate-project', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ oldProjectNum, newProjectNum })
      });
      const data = await res.json();
      if (data.success) {
        setMigrateStatus(`Migrated ${data.migratedCount} entries. Refresh to see changes.`);
        setMigrating(null);
      } else {
        setMigrateStatus(`Error: ${data.error}`);
      }
    } catch (err) {
      setMigrateStatus(`Error: ${err.message}`);
    }
  };

  // Delete orphaned projection keys
  const handleDeleteOrphans = async (keys) => {
    if (!confirm(`Delete ${keys.length} orphaned projection(s)? This cannot be undone.`)) return;
    setMigrateStatus('Deleting...');
    try {
      const res = await fetch('/api/projections', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deleteKeys: keys })
      });
      const data = await res.json();
      if (data.success) {
        setMigrateStatus(`Deleted ${keys.length} orphaned entries. Refresh to see changes.`);
      } else {
        setMigrateStatus(`Error: ${data.error}`);
      }
    } catch (err) {
      setMigrateStatus(`Error: ${err.message}`);
    }
  };

  // Health counts based on filtered projects
  const healthCounts = { Good: 0, Watch: 0, Poor: 0 };
  partnerFilteredProjects.forEach(p => {
    const worst = p.internalHealth === 'Poor' || p.externalHealth === 'Poor' ? 'Poor' :
                  p.internalHealth === 'Watch' || p.externalHealth === 'Watch' ? 'Watch' : 'Good';
    healthCounts[worst]++;
  });

  // Hours by week - separate columns
  const hoursWeeksArray = weeks.slice(0, hoursWeeks);
  const hoursByStaffByWeek = {};
  allStaff.forEach(s => {
    hoursByStaffByWeek[s] = {};
    hoursWeeksArray.forEach(w => { hoursByStaffByWeek[s][w.label] = 0; });
  });
  partnerFilteredProjects.forEach(project => {
    (project.tasks || []).forEach(task => {
      if (hoursByStaffByWeek[task.staff] && hoursWeeksArray.some(w => w.label === task.week)) {
        hoursByStaffByWeek[task.staff][task.week] = (hoursByStaffByWeek[task.staff][task.week] || 0) + (task.hours || 0);
      }
    });
  });

  // Timeline
  const chronoList = [];
  partnerFilteredProjects.forEach(project => { (project.milestones || []).forEach(m => { if (m.date) { chronoList.push({ milestoneType: m.type, date: m.date, description: m.description, projectName: project.projectName }); } }); });
  chronoList.sort((a, b) => new Date(a.date) - new Date(b.date));
  const eightWeeksOut = new Date(); eightWeeksOut.setDate(eightWeeksOut.getDate() + 56);
  const upcomingChrono = chronoList.filter(item => { const d = new Date(item.date); return d >= new Date() && d <= eightWeeksOut; });

  const principalTag = (project) => principal === 'ALL' ? <Pill kind="outline">{PRINCIPAL_NAMES[project.principal] || project.principal}</Pill> : null;
  const sourceMeta = 'Work Plan tasks and milestones · Master Data for project numbers';

  return (
    <div>
      {/* Sub-tabs and partner filter */}
      <Tabs
        tabs={[
          { id: 'scorecard', label: 'Scorecard' },
          { id: 'hours', label: 'Hours' },
          { id: 'timeline', label: 'Timeline' },
          { id: 'admin', label: 'Data admin', count: orphanCount > 0 ? orphanCount : undefined },
        ]}
        value={dashTab}
        onChange={setDashTab}
        right={dashTab !== 'admin' ? (
          <Select value={partnerFilter} onChange={(e) => setPartnerFilter(e.target.value)}>
            <option value="all">All Partners</option>
            {PARTNERS.map(p => (<option key={p} value={p}>{p}&apos;s Projects</option>))}
          </Select>
        ) : null}
      />

      {dashTab === 'scorecard' && (
        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-4">
            <Figure label="Healthy" value={healthCounts.Good} />
            <Figure label="Watch" value={healthCounts.Watch} sub={healthCounts.Watch > 0 ? 'Internal or external health marked Watch' : undefined} />
            <Figure label="Poor" value={healthCounts.Poor} sub={healthCounts.Poor > 0 ? 'Internal or external health marked Poor' : undefined} red={healthCounts.Poor > 0} />
          </div>
          {partnerFilteredProjects.some(p => (p.needsReview || []).length > 0) && (
            <Panel title="Needs partner review" meta="Flags set in project settings · clear when the partner marks the review done" pad>
              {partnerFilteredProjects.filter(p => (p.needsReview || []).length > 0).map(project => (
                <div key={project.id} className="py-2 border-b border-hair last:border-b-0">
                  <div className="flex items-center gap-2 flex-wrap"><span className="font-bold text-sm">{project.projectName}</span>{principalTag(project)}<Pill kind="red">{(project.needsReview || []).join(', ')}</Pill></div>
                  {project.partnerNeeds && <div className="text-sm text-muted mt-1 italic">&ldquo;{project.partnerNeeds}&rdquo;</div>}
                </div>
              ))}
            </Panel>
          )}
          {partnerFilteredProjects.some(p => p.needs && p.needs.trim()) && (
            <Panel title="General project needs" meta="From each project's settings" pad>
              {partnerFilteredProjects.filter(p => p.needs && p.needs.trim()).map(project => (<div key={project.id} className="py-2 border-b border-hair last:border-b-0"><div className="flex items-center gap-2 flex-wrap"><div className="font-bold text-sm text-ink">{project.projectName}</div>{principalTag(project)}</div><div className="text-sm text-muted">{project.needs}</div></div>))}
            </Panel>
          )}
          <Panel title="All projects" meta={`${partnerFilteredProjects.length} project${partnerFilteredProjects.length === 1 ? '' : 's'} · ${sourceMeta}`} pad>
            {partnerFilteredProjects.map(project => (
              <div key={project.id} className="flex items-center gap-3 py-2 border-b border-hair last:border-b-0">
                <div className={`w-3 h-3 rounded-full flex-shrink-0 ${healthDotClass(project)}`} />
                <div className="flex-1 font-bold text-sm">{project.projectName || 'Unnamed'}</div>
                {principalTag(project)}
                <div className="text-xs text-muted">{project.phase}</div>
                {(project.needsReview || []).length > 0 && (<Pill kind="red">{(project.needsReview || []).join(', ')}</Pill>)}
                <div className="text-xs text-muted">{(project.partnersInCharge || []).join(', ')}</div>
              </div>
            ))}
          </Panel>
        </div>
      )}

      {dashTab === 'hours' && (
        <Panel title="Weekly hours" meta="45h target per week · planned task hours" action={
          <Select value={hoursWeeks} onChange={(e) => setHoursWeeks(parseInt(e.target.value))} className="h-8"><option value={1}>1 Week</option><option value={2}>2 Weeks</option><option value={4}>4 Weeks</option></Select>
        } pad>
          <div className="flex gap-4">
            {hoursWeeksArray.map(week => (
              <div key={week.key} className="flex-1 border border-rule rounded p-3">
                <div className="text-sm font-bold text-ink mb-3 text-center">{week.label}</div>
                <div className="flex items-end gap-2 justify-center" style={{ height: '200px' }}>
                  {allStaff.map(staffMember => {
                    const hours = hoursByStaffByWeek[staffMember]?.[week.label] || 0;
                    const pct = Math.min(100, (hours / 50) * 100);
                    return (
                      <div key={staffMember} className="flex flex-col items-center" style={{ width: '24px' }}>
                        <div className="text-xs text-muted mb-1">{hours > 0 ? hours : ''}</div>
                        <div className="w-full bg-hair relative" style={{ height: '160px' }}>
                          <div className={`absolute bottom-0 left-0 right-0 ${hoursBarClass(hours)}`} style={{ height: `${pct * 1.6}px` }} />
                          {/* 45h line */}
                          <div className="absolute left-0 right-0 border-t-2 border-muted border-dashed" style={{ bottom: `${(45/50) * 160}px` }} />
                        </div>
                        <div className="text-xs font-bold text-ink mt-1">{staffMember}</div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>

          <div className="mt-4 pt-3 border-t border-rule flex gap-4 text-xs text-muted">
            <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-[2px] bg-ink"></span> Under 40h</span>
            <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-[2px] bg-status-amber"></span> 40-45h</span>
            <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-[2px] bg-status-red"></span> Over 45h</span>
            <span className="ml-auto">--- 45h target</span>
          </div>
        </Panel>
      )}

      {dashTab === 'timeline' && (
        <Panel title="Upcoming milestones and deadlines" meta="Next 8 weeks · Work Plan milestones" pad>
          {upcomingChrono.length === 0 ? (<div className="text-muted italic text-sm">No milestones scheduled</div>) : (
            <div className="space-y-1">
              {upcomingChrono.map((item, i) => (
                <div key={i} className="flex items-center gap-3 py-2 border-b border-hair last:border-b-0">
                  <div className="w-16 text-sm text-muted">{formatDate(item.date)}</div>
                  {milestonePill(item.milestoneType)}
                  <div className="flex-1 text-sm font-bold text-ink">{item.description}</div>
                  <div className="text-xs text-muted">{item.projectName}</div>
                </div>
              ))}
            </div>
          )}
        </Panel>
      )}

      {dashTab === 'admin' && (
        <div className="space-y-4">
          <Panel title="Orphaned projections" meta="Projection keys compared against Master Data project numbers" pad>
            <p className="text-sm text-muted mb-4">
              These projection entries reference project numbers that no longer exist in Master Data.
              This usually happens when a project number changes (e.g., PR → contracted).
            </p>

            {orphanCount === 0 ? (
              <div className="text-ink font-bold text-sm">No orphaned entries found</div>
            ) : (
              <div className="space-y-3">
                {Object.entries(orphansByProject).map(([oldProjectNum, keys]) => (
                  <div key={oldProjectNum} className="border border-rule rounded p-3">
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-ink">{oldProjectNum}</span>
                        <Pill kind="red">{keys.length} phase{keys.length > 1 ? 's' : ''}</Pill>
                      </div>
                    </div>
                    <div className="text-xs text-muted mb-2">
                      Phases: {keys.map(k => k.split('-').pop()).join(', ')}
                    </div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm text-muted">Link to:</span>
                      <Select
                        className="flex-1 max-w-xs"
                        value={migrating?.oldKey === oldProjectNum ? migrating.newProjectNum : ''}
                        onChange={(e) => setMigrating({ oldKey: oldProjectNum, newProjectNum: e.target.value })}
                      >
                        <option value="">Select project...</option>
                        {validProjects.map(p => (
                          <option key={p} value={p}>{p}</option>
                        ))}
                      </Select>
                      <Button
                        variant="secondary"
                        onClick={() => handleMigrate(oldProjectNum, migrating?.newProjectNum)}
                        disabled={migrating?.oldKey !== oldProjectNum || !migrating?.newProjectNum}
                      >
                        Migrate
                      </Button>
                      <Button variant="danger" onClick={() => handleDeleteOrphans(keys)}>Delete</Button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {migrateStatus && (
              <div className={`mt-4 p-3 rounded border text-sm ${migrateStatus.includes('Error') ? 'border-status-red text-status-red' : 'border-rule text-ink'}`}>
                {migrateStatus}
              </div>
            )}
          </Panel>
        </div>
      )}
    </div>
  );
}

// ─── Projections View ─────────────────────────────────────────────────────────

function getMonthsArray(numMonths = 7) {
  const months = [];
  const now = new Date();
  // Start from PREVIOUS month so EP always has last month's projections for invoicing
  for (let i = -1; i < numMonths - 1; i++) {
    const date = new Date(now.getFullYear(), now.getMonth() + i, 1);
    months.push({
      key: `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`,
      label: date.toLocaleDateString('en-US', { month: 'short' }),
      fullLabel: date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' }),
      isPreviousMonth: i === -1
    });
  }
  return months;
}

// Bearer token for the signed-in user (the fee-by-time feeds check it server-side)
async function authHeaders() {
  try { const { data } = await supabase.auth.getSession(); const t = data?.session?.access_token; return t ? { Authorization: `Bearer ${t}` } : {}; } catch { return {}; }
}

function ProjectionsView({ feeData, principal }) {
  const [projectionData, setProjectionData] = useState({});
  // Time spent (read-only): all logged hours × fee-chart rate by billing phase and month, from Oct 1 2026. Principals and partners only; for anyone else nothing extra shows.
  const [tv, setTv] = useState(null);
  useEffect(() => { (async () => { try { const r = await fetch('/api/time?view=timevs', { headers: await authHeaders() }); setTv(r.ok ? await r.json() : null); } catch { setTv(null); } })(); }, []);
  const tvOn = !!(tv && tv.byLine);
  const tvLine = (num, name, phase) => (tvOn ? tv.byLine[`${num}||${String(name || '').trim()}||${phase || ''}`] : null) || null;
  const tvSum = (phases, monthKey) => phases.reduce((a, p) => { const d = tvLine(p.projectNum, p.projectName, p.phase); const c = d ? (monthKey ? d.months?.[monthKey] : d) : null; if (c) { a.hours += c.hours || 0; a.value += c.value || 0; } return a; }, { hours: 0, value: 0 });
  const tvBlock = (c, strong) => (c && c.hours > 0) ? <div className={`text-xs leading-tight text-accent ${strong ? 'font-bold' : ''}`}>{Math.round(c.hours * 10) / 10} h · {formatCurrency(c.value)}</div> : null;
  const [snapshot, setSnapshot] = useState(null);
  const [previousSnapshot, setPreviousSnapshot] = useState(null);
  const [saving, setSaving] = useState(false);
  const [filterPrincipal, setFilterPrincipal] = useState('all');
  const [loaded, setLoaded] = useState(false);
  const [projTab, setProjTab] = useState('entry');
  const [expandedProjects, setExpandedProjects] = useState(new Set());

  const months = getMonthsArray(13);
  const PRINCIPALS = ['MM', 'AB', 'RW', 'HD'];
  const CONFIDENCE_OPTIONS = ['', 'H', 'M', 'L'];

  // Filter projects from Master Data - only O and PR status, one row per project-phase
  // First pass: identify which project-phase combos have duplicates
  const rawProjects = (feeData || []).filter(row =>
    row['Status'] === 'O' || row['Status'] === 'PR'
  );

  // Count occurrences of each project-phase combo
  const phaseCount = {};
  rawProjects.forEach(row => {
    const key = `${row['Project #']}-${row['Phase']}`;
    phaseCount[key] = (phaseCount[key] || 0) + 1;
  });

  // Build projects - include project name suffix ONLY if there are duplicate phases
  const allProjects = rawProjects.map(row => {
    const baseKey = `${row['Project #']}-${row['Phase']}`;
    const hasDuplicates = phaseCount[baseKey] > 1;
    // For duplicates only, add last 15 chars of project name (alphanumeric) to make unique
    const nameSuffix = hasDuplicates ? `-${(row['Project Name'] || '').replace(/[^a-zA-Z0-9]/g, '').slice(-15)}` : '';
    const id = `${baseKey}${nameSuffix}`;

    return {
      id,
      projectNum: row['Project #'],
      projectName: row['Project Name'],
      phase: row['Phase'],
      pm: row['PM'],
      partner: row['Partner'],
      status: row['Status'],
      fee: row['Fee'] || 0,
      previouslyBilledPct: row['Previously Billed %'] || 0,
      feeRemaining: row['Fee Remaining'] || 0
    };
  });

  // Group projects by project number for collapsible view
  const projectsByNum = {};
  allProjects.forEach(p => {
    if (!projectsByNum[p.projectNum]) {
      projectsByNum[p.projectNum] = {
        projectNum: p.projectNum,
        projectName: p.projectName,
        pm: p.pm,
        status: p.status,
        phases: []
      };
    }
    projectsByNum[p.projectNum].phases.push(p);
    // Use PR status if any phase is PR
    if (p.status === 'PR') projectsByNum[p.projectNum].status = 'PR';
  });
  const groupedProjects = Object.values(projectsByNum);

  // Filter by selected principal
  const filteredProjects = filterPrincipal === 'all'
    ? allProjects
    : allProjects.filter(p => p.pm === filterPrincipal);

  const filteredGrouped = filterPrincipal === 'all'
    ? groupedProjects
    : groupedProjects.filter(g => g.pm === filterPrincipal);

  // Group by principal
  const projectsByPrincipal = {};
  const groupedByPrincipal = {};
  PRINCIPALS.forEach(pm => {
    projectsByPrincipal[pm] = [];
    groupedByPrincipal[pm] = [];
  });
  filteredProjects.forEach(p => {
    if (projectsByPrincipal[p.pm]) {
      projectsByPrincipal[p.pm].push(p);
    }
  });
  filteredGrouped.forEach(g => {
    if (groupedByPrincipal[g.pm]) {
      groupedByPrincipal[g.pm].push(g);
    }
  });

  // Toggle project expansion
  const toggleProject = (projectNum) => {
    setExpandedProjects(prev => {
      const next = new Set(prev);
      if (next.has(projectNum)) {
        next.delete(projectNum);
      } else {
        next.add(projectNum);
      }
      return next;
    });
  };

  // Load projections from SharePoint
  useEffect(() => {
    fetch('/api/projections')
      .then(r => r.json())
      .then(data => {
        setProjectionData(data.projections || {});
        setSnapshot(data.snapshot || null);
        setPreviousSnapshot(data.previousSnapshot || null);
        setLoaded(true);
      })
      .catch(err => {
        console.error('Failed to load projections:', err);
        setLoaded(true);
      });
  }, []);

  // Save projections (with debounce)
  const saveProjections = async (newData, newSnapshot) => {
    setSaving(true);
    try {
      await fetch('/api/projections', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projections: newData,
          snapshot: newSnapshot || snapshot,
          previousSnapshot: snapshot
        })
      });
    } catch (err) {
      console.error('Failed to save projections:', err);
    }
    setSaving(false);
  };

  // Returns the most recent Wednesday noon CST (CST = UTC-6, CDT = UTC-5).
  // Uses America/Chicago to get correct offset regardless of DST.
  const getLastWedNoonCST = () => {
    const now = new Date();
    // Get current time in Chicago
    const chicagoNow = new Date(now.toLocaleString('en-US', { timeZone: 'America/Chicago' }));
    const d = new Date(chicagoNow);
    // Rewind to most recent Wednesday at noon
    // getDay(): Sun=0, Mon=1, Tue=2, Wed=3, Thu=4, Fri=5, Sat=6
    const day = d.getDay();
    const hour = d.getHours();
    // Days since last Wed noon (if today is Wed before noon, use last week's Wed)
    let daysBack;
    if (day === 3 && hour >= 12) daysBack = 0;
    else if (day === 3) daysBack = 7;
    else if (day > 3) daysBack = day - 3;
    else daysBack = day + 4; // Sun(0)→4, Mon(1)→5, Tue(2)→6
    d.setDate(d.getDate() - daysBack);
    d.setHours(12, 0, 0, 0);
    return d;
  };

  // Decide whether the current snapshot should rotate into previousSnapshot.
  // Rotate only when the existing snapshot was taken BEFORE the most recent Wed-noon-CST boundary.
  const shouldRotateSnapshot = (currentSnap) => {
    if (!currentSnap?.date) return false;
    const snapDate = new Date(currentSnap.date);
    const lastWed = getLastWedNoonCST();
    return snapDate < lastWed;
  };

  // Debounce timers per cell — prevents rapid keystrokes from racing each other
  // on the network (e.g., typing "30" sending save(3) and save(30) out of order
  // could leave the server with 3). Each cell has its own timer so edits to
  // different cells don't block each other.
  const saveTimers = useRef({});

  // Update projection for a project/month — atomic single-cell save (debounced)
  const updateProjection = (projectId, monthKey, field, value) => {
    const newData = { ...projectionData };
    if (!newData[projectId]) {
      newData[projectId] = { confidence: '', months: {} };
    }
    if (!newData[projectId].months) newData[projectId].months = {};
    newData[projectId].months[monthKey] = value;
    setProjectionData(newData);

    const newSnapshot = calculateSnapshot(newData);
    setSnapshot(newSnapshot);

    // Rotate previousSnapshot only when we've crossed a Wed-noon-CST boundary
    // since the last snapshot was taken. Otherwise, keep prev untouched.
    const rotate = shouldRotateSnapshot(snapshot);
    const nextPrev = rotate ? snapshot : previousSnapshot;
    if (rotate) setPreviousSnapshot(snapshot);

    // Debounce the network save by 400ms per cell. Rapid keystrokes coalesce
    // into a single request with the final value — no more race-condition
    // overwrites where an earlier keystroke's save lands after a later one.
    const timerKey = `${projectId}|${monthKey}`;
    if (saveTimers.current[timerKey]) clearTimeout(saveTimers.current[timerKey]);
    saveTimers.current[timerKey] = setTimeout(() => {
      fetch('/api/projections', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          setCell: { projectId, monthKey, value },
          snapshot: newSnapshot,
          previousSnapshot: nextPrev
        })
      }).catch(err => console.error('Projection save error:', err));
      delete saveTimers.current[timerKey];
    }, 400);
  };

  // Calculate projected fee for a project/month
  const calculateProjectedFee = (project, monthIndex) => {
    const projData = projectionData[project.id];
    if (!projData?.months) return null;

    const monthKey = months[monthIndex].key;
    const projectedPct = projData.months[monthKey];

    if (projectedPct === undefined || projectedPct === null || projectedPct === '') return null;

    let prevPct;
    if (monthIndex === 0) {
      prevPct = project.previouslyBilledPct;
    } else {
      const prevMonthKey = months[monthIndex - 1].key;
      prevPct = projData.months[prevMonthKey];
      if (prevPct === undefined || prevPct === null || prevPct === '') {
        prevPct = project.previouslyBilledPct;
      }
    }

    const pctDiff = (projectedPct - prevPct) / 100;
    return Math.max(0, pctDiff * project.fee);
  };

  // Calculate totals for a group of projects
  const calculateGroupTotals = (projects, monthIndex) => {
    let total = 0;
    projects.forEach(p => {
      const fee = calculateProjectedFee(p, monthIndex);
      if (fee !== null) total += fee;
    });
    return total;
  };

  // Calculate confidence-filtered totals
  const calculateConfidenceTotals = (projects, monthIndex, confidence) => {
    let total = 0;
    const monthKey = months[monthIndex].key;
    projects.forEach(p => {
      const projData = projectionData[p.id];
      const monthConf = projData?.months?.[monthKey + '_conf'] || '';
      if (confidence === '' ? !monthConf : monthConf === confidence) {
        const fee = calculateProjectedFee(p, monthIndex);
        if (fee !== null) total += fee;
      }
    });
    return total;
  };

  // Calculate status-filtered totals
  const calculateStatusTotals = (projects, monthIndex, status) => {
    let total = 0;
    projects.forEach(p => {
      if (p.status === status) {
        const fee = calculateProjectedFee(p, monthIndex);
        if (fee !== null) total += fee;
      }
    });
    return total;
  };

  // Calculate fee that sits BEYOND the projection window for a single project:
  // Fee Remaining − (sum of all projected fee in the visible months).
  // Floored at 0 — if someone has over-projected, we don't show a negative.
  const calculateBeyondWindow = (project) => {
    let projectedInWindow = 0;
    months.forEach((m, idx) => {
      const fee = calculateProjectedFee(project, idx);
      if (fee !== null) projectedInWindow += fee;
    });
    return Math.max(0, (project.feeRemaining || 0) - projectedInWindow);
  };

  // Sum beyond-window fee for a group, optionally filtered by status
  const calculateBeyondWindowTotals = (projects, status = null) => {
    let total = 0;
    projects.forEach(p => {
      if (status !== null && p.status !== status) return;
      total += calculateBeyondWindow(p);
    });
    return total;
  };

  // Calculate snapshot for week-over-week comparison
  const calculateSnapshot = (data) => {
    const snap = { date: new Date().toISOString(), totals: {} };
    months.forEach((month, idx) => {
      let total = 0;
      allProjects.forEach(p => {
        const projData = data[p.id];
        if (!projData?.months) return;
        const projectedPct = projData.months[month.key];
        if (projectedPct === undefined || projectedPct === null) return;

        let prevPct;
        if (idx === 0) {
          prevPct = p.previouslyBilledPct;
        } else {
          const prevMonthKey = months[idx - 1].key;
          prevPct = projData.months[prevMonthKey];
          if (prevPct === undefined || prevPct === null) prevPct = p.previouslyBilledPct;
        }
        total += Math.max(0, ((projectedPct - prevPct) / 100) * p.fee);
      });
      snap.totals[month.key] = total;
    });
    return snap;
  };

  // Calculate change from previous snapshot
  const getChange = (monthKey) => {
    if (!previousSnapshot?.totals || !snapshot?.totals) return null;
    const current = snapshot.totals[monthKey] || 0;
    const previous = previousSnapshot.totals[monthKey] || 0;
    return current - previous;
  };

  if (!loaded) {
    return <div className="text-muted p-8 animate-pulse">Loading projections…</div>;
  }

  const thBase = 'px-2 py-2 text-xs font-bold bg-ink text-white';
  const remainingCell = (remaining, size) => remaining > 0 ? <span className={`${size} font-bold text-muted`}>{formatCurrency(remaining)}</span> : <span className={`${size} text-done`}>—</span>;

  return (
    <div className="space-y-4">
      {/* Entry / Totals sub-tabs, principal filter and save state */}
      <Tabs
        tabs={[{ id: 'entry', label: 'Entry' }, { id: 'totals', label: 'Totals' }]}
        value={projTab}
        onChange={setProjTab}
        right={<>
          <Select value={filterPrincipal} onChange={(e) => setFilterPrincipal(e.target.value)}>
            <option value="all">All Principals</option>
            {PRINCIPALS.map(pm => (
              <option key={pm} value={pm}>{PRINCIPAL_NAMES[pm]}</option>
            ))}
          </Select>
          <span className={`text-xs ml-2 ${saving ? 'text-status-amber' : 'text-muted'}`}>{saving ? 'Saving…' : 'Auto-saved'}</span>
        </>}
      />

      {/* Entry Tab */}
      {projTab === 'entry' && (
      <Panel title="Projections by project" meta="Master Data fees and previously billed % · projections saved per cell · ★ = last month (for invoicing)">
        <div className="overflow-y-auto max-h-[70vh]">
          <table className="w-full text-sm">
            <thead className="sticky top-0 z-10">
              <tr>
                <th className={`text-left px-3 ${thBase} min-w-[250px]`}>Project</th>
                <th className={`text-right ${thBase} w-20`}>Fee</th>
                {months.map(month => (
                  <th key={month.key} className={`text-center ${thBase} min-w-[120px]`}>{month.label}{month.isPreviousMonth ? ' ★' : ''}</th>
                ))}
                <th className={`text-right ${thBase} min-w-[100px]`}>Remaining</th>
              </tr>
            </thead>
            <tbody>
              {PRINCIPALS.filter(pm => filterPrincipal === 'all' || filterPrincipal === pm).map(pm => (
                <React.Fragment key={pm}>
                  {filterPrincipal === 'all' && (
                    <tr className="bg-ground">
                      <td colSpan={3 + months.length} className="px-3 py-2 font-flecha text-sm text-ink">
                        {PRINCIPAL_NAMES[pm]}
                      </td>
                    </tr>
                  )}

                  {groupedByPrincipal[pm].map(group => {
                    const isExpanded = expandedProjects.has(group.projectNum);
                    const isPR = group.status === 'PR';

                    // Calculate total fee across all phases for this project
                    const totalProjectedFee = (monthIdx) => {
                      let total = 0;
                      group.phases.forEach(phase => {
                        const fee = calculateProjectedFee(phase, monthIdx);
                        if (fee !== null) total += fee;
                      });
                      return total > 0 ? total : null;
                    };

                    return (
                      <React.Fragment key={group.projectNum}>
                        {/* Project header row - always clickable to expand */}
                        <tr
                          className={`border-b border-rule ${isPR ? 'bg-accent-tint/60' : 'bg-white'} cursor-pointer hover:bg-ground`}
                          onClick={() => toggleProject(group.projectNum)}
                        >
                          <td className="px-3 py-2">
                            <div className="flex items-center gap-2">
                              <span className="text-muted text-xs w-3">{isExpanded ? '▼' : '▶'}</span>
                              <div>
                                <div className="font-bold text-ink">{group.projectName || group.projectNum}</div>
                                <div className="text-xs text-muted flex items-center gap-1.5">
                                  {group.projectNum}
                                  {isPR && <Pill kind="outline">PR</Pill>}
                                </div>
                                {(() => {
                                  const projectedTotal = group.phases.reduce((sum, p) => sum + months.reduce((a, _m, i) => a + (calculateProjectedFee(p, i) || 0), 0), 0);
                                  const billedTotal = group.phases.reduce((sum, p) => sum + (p.fee || 0) * (p.previouslyBilledPct || 0) / 100, 0);
                                  const spent = tvOn ? tvSum(group.phases, null).value : 0;
                                  return (
                                    <div className="text-xs mt-0.5">
                                      <span className="text-ink">Projected {formatCurrency(projectedTotal)}</span>
                                      <span className="text-rule"> · </span>
                                      <span className="text-muted">Billed {formatCurrency(billedTotal)}</span>
                                      {tvOn && <span className="text-rule"> · </span>}
                                      {tvOn && <span className="text-accent">Spent {formatCurrency(spent)}</span>}
                                    </div>
                                  );
                                })()}
                              </div>
                            </div>
                          </td>
                          <td className="text-right px-2 py-2 text-ink font-bold">
                            {formatCurrency(group.phases.reduce((sum, p) => sum + p.fee, 0))}
                          </td>
                          {months.map((month, idx) => {
                            const totalFee = totalProjectedFee(idx);
                            return (
                              <td key={month.key} className="text-center px-2 py-2">
                                {totalFee !== null && (
                                  <div className="text-sm font-bold text-ink">{formatCurrency(totalFee)}</div>
                                )}
                                {tvOn && (() => { const c = tvSum(group.phases, month.key); return c.hours > 0 ? <div className="text-sm font-bold text-accent">{formatCurrency(c.value)}</div> : null; })()}
                              </td>
                            );
                          })}
                          <td className="text-right px-2 py-2">
                            {(() => {
                              const totalFee = group.phases.reduce((sum, p) => sum + p.fee, 0);
                              // Find the highest cumulative % projected across all phases
                              let totalProjected = 0;
                              group.phases.forEach(phase => {
                                const pd = projectionData[phase.id]?.months || {};
                                // Get all month pct values, find the last one entered
                                let lastPct = phase.previouslyBilledPct || 0;
                                months.forEach(m => {
                                  const v = pd[m.key];
                                  if (v !== undefined && v !== null && v !== '') lastPct = v;
                                });
                                totalProjected += (lastPct / 100) * phase.fee;
                              });
                              const remaining = totalFee - totalProjected;
                              return remainingCell(remaining, 'text-sm');
                            })()}
                          </td>
                        </tr>

                        {/* Phase rows (shown when expanded) */}
                        {isExpanded && group.phases.map(project => {
                          const projData = projectionData[project.id] || { confidence: '', months: {} };
                          // Check if this is a duplicate phase - show name hint if so
                          const duplicatePhases = group.phases.filter(p => p.phase === project.phase);
                          const showNameHint = duplicatePhases.length > 1;
                          // Extract distinguishing part of name (last part after dash)
                          const nameParts = (project.projectName || '').split('-');
                          const nameHint = nameParts.length > 1 ? nameParts[nameParts.length - 1].trim() : '';

                          return (
                            <tr key={project.id} className="border-b border-hair hover:bg-ground bg-white">
                              <td className="px-3 py-2 pl-8">
                                <div className="flex items-center gap-2">
                                  <Pill kind="phase">{project.phase || '—'}</Pill>
                                  {showNameHint && nameHint && (
                                    <span className="text-xs text-muted italic">{nameHint}</span>
                                  )}
                                </div>
                              </td>
                              <td className="text-right px-2 py-2 text-muted">
                                {formatCurrency(project.fee)}
                              </td>
                              {months.map((month, idx) => {
                                const projectedPct = projData.months?.[month.key];
                                const projectedFee = calculateProjectedFee(project, idx);
                                const isPrevMonth = month.isPreviousMonth;
                                const conf = projData.months?.[month.key + '_conf'] || '';

                                return (
                                  <td key={month.key} className={`px-1 py-1 ${isPrevMonth ? 'bg-ground' : ''}`}>
                                    <div className="flex flex-col items-center gap-0.5">
                                      <div className="flex items-center gap-1">
                                        <input
                                          type="number"
                                          min="0"
                                          max="100"
                                          value={projectedPct ?? ''}
                                          onChange={(e) => {
                                            const val = e.target.value === '' ? null : Math.min(100, Math.max(0, parseInt(e.target.value) || 0));
                                            updateProjection(project.id, month.key, 'pct', val);
                                          }}
                                          onWheel={(e) => e.target.blur()}
                                          placeholder="—"
                                          className={`w-12 text-center border rounded-[3px] px-1 py-0.5 text-xs bg-white ${isPrevMonth ? 'border-ink' : 'border-rule'}`}
                                        />
                                        <select
                                          value={conf}
                                          onChange={(e) => updateProjection(project.id, month.key + '_conf', 'conf', e.target.value)}
                                          title="Confidence: H / M / L"
                                          className={`w-9 text-center border rounded-[3px] px-0.5 py-0.5 text-xs font-bold ${
                                            conf === 'H' ? 'bg-ink border-ink text-white' :
                                            conf === 'M' ? 'bg-white border-ink text-ink' :
                                            conf === 'L' ? 'bg-white border-status-amber text-status-amber' :
                                            'bg-ground border-rule text-muted'
                                          }`}
                                        >
                                          {CONFIDENCE_OPTIONS.map(c => (
                                            <option key={c} value={c}>{c || '—'}</option>
                                          ))}
                                        </select>
                                      </div>
                                      {projectedFee !== null && (
                                        <div className="text-xs font-bold text-ink">
                                          {formatCurrency(projectedFee)}
                                        </div>
                                      )}
                                      {tvOn && tvBlock(tvSum([project], month.key), false)}
                                    </div>
                                  </td>
                                );
                              })}
                              <td className="text-right px-2 py-2">
                                {(() => {
                                  const pd = projData.months || {};
                                  let lastPct = project.previouslyBilledPct || 0;
                                  months.forEach(m => {
                                    const v = pd[m.key];
                                    if (v !== undefined && v !== null && v !== '') lastPct = v;
                                  });
                                  const remaining = project.fee * (1 - lastPct / 100);
                                  return remainingCell(remaining, 'text-xs');
                                })()}
                              </td>
                            </tr>
                          );
                        })}
                      </React.Fragment>
                    );
                  })}

                  {filterPrincipal === 'all' && projectsByPrincipal[pm].length > 0 && (
                    <tr className="bg-ground font-bold border-t-2 border-ink">
                      <td className="px-3 py-2 text-ink">{pm} Total</td>
                      <td></td>
                      {months.map((month, idx) => (
                        <td key={month.key} className="text-center px-2 py-2 text-ink">
                          {formatCurrency(calculateGroupTotals(projectsByPrincipal[pm], idx))}
                        </td>
                      ))}
                    </tr>
                  )}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
      )}

      {/* Totals Tab */}
      {projTab === 'totals' && (
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <Panel title="Monthly totals" meta="Projected fee by principal · vs Last Wed compares to the Wednesday-noon snapshot" className="xl:col-span-2">
          <div className="p-4 overflow-x-auto">
          <table className="w-full text-sm min-w-[900px]">
            <thead>
              <tr className="border-b border-ink">
                <th className="text-left py-2 text-xs text-muted font-normal"></th>
                {months.map(month => (
                  <th key={month.key} className="text-right py-2 text-xs font-bold text-ink px-2">{month.label}</th>
                ))}
                <th className="text-right py-2 text-xs font-bold text-ink px-2 border-l border-rule bg-ground" title="Contracted fee remaining beyond the projection window: Fee Remaining − projected fee in visible months, status = O">Beyond Window (O)</th>
                <th className="text-right py-2 text-xs font-bold text-accent px-2 bg-ground" title="Projected (PR) fee beyond the projection window: Fee Remaining − projected fee in visible months, status = PR">Beyond Window (PR)</th>
              </tr>
            </thead>
            <tbody>
              {PRINCIPALS.map(pm => {
                const beyondO = calculateBeyondWindowTotals(projectsByPrincipal[pm], 'O');
                const beyondPR = calculateBeyondWindowTotals(projectsByPrincipal[pm], 'PR');
                return (
                <tr key={pm} className="border-b border-hair">
                  <td className="py-2 text-ink">{pm}</td>
                  {months.map((month, idx) => (
                    <td key={month.key} className="text-right py-2 px-2 text-ink">
                      {formatCurrency(calculateGroupTotals(projectsByPrincipal[pm], idx))}
                    </td>
                  ))}
                  <td className="text-right py-2 px-2 font-bold text-ink border-l border-rule bg-ground">{formatCurrency(beyondO)}</td>
                  <td className="text-right py-2 px-2 font-bold text-accent bg-ground">{formatCurrency(beyondPR)}</td>
                </tr>
                );
              })}
              <tr className="bg-ink text-white font-bold">
                <td className="py-2 px-2">Grand Total</td>
                {months.map((month, idx) => (
                  <td key={month.key} className="text-right py-2 px-2">
                    {formatCurrency(calculateGroupTotals(allProjects, idx))}
                  </td>
                ))}
                <td className="text-right py-2 px-2 border-l border-white/20">
                  {formatCurrency(calculateBeyondWindowTotals(allProjects, 'O'))}
                </td>
                <td className="text-right py-2 px-2 text-white/80">
                  {formatCurrency(calculateBeyondWindowTotals(allProjects, 'PR'))}
                </td>
              </tr>
              {previousSnapshot && (
                <tr className="text-xs">
                  <td className="py-1 text-muted">vs Last Wed</td>
                  {months.map(month => {
                    const change = getChange(month.key);
                    if (change === null) return <td key={month.key}></td>;
                    return (
                      <td key={month.key} className={`text-right py-1 px-2 font-bold ${change >= 0 ? 'text-ink' : 'text-status-red'}`}>
                        {change >= 0 ? '+' : ''}{formatCurrency(change)}
                      </td>
                    );
                  })}
                  <td className="border-l border-rule bg-ground"></td>
                  <td className="bg-ground"></td>
                </tr>
              )}
            </tbody>
          </table>
          </div>
        </Panel>

        <Panel title="Breakdown" meta="By confidence (H / M / L) and by status (O contracted, PR projected)" className="xl:col-span-1">
          <div className="p-4 overflow-x-auto">
          <table className="w-full text-sm min-w-[600px]">
            <thead>
              <tr className="border-b border-ink">
                <th className="text-left py-2 text-xs text-muted font-normal"></th>
                {months.map(month => (
                  <th key={month.key} className="text-right py-2 text-xs font-bold text-ink px-2">{month.label}</th>
                ))}
                <th className="text-right py-2 text-xs font-bold text-ink px-2 border-l border-rule bg-ground" title="Fee Remaining beyond the projection window. Confidence rows N/A — confidence is a per-month attribute.">Beyond Window</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-b border-hair">
                <td className="py-2"><Pill kind="solid">High</Pill></td>
                {months.map((month, idx) => (
                  <td key={month.key} className="text-right py-2 px-2 text-ink">
                    {formatCurrency(calculateConfidenceTotals(allProjects, idx, 'H'))}
                  </td>
                ))}
                <td className="text-right py-2 px-2 text-done border-l border-rule bg-ground">—</td>
              </tr>
              <tr className="border-b border-hair">
                <td className="py-2"><Pill kind="outline">Med</Pill></td>
                {months.map((month, idx) => (
                  <td key={month.key} className="text-right py-2 px-2 text-ink">
                    {formatCurrency(calculateConfidenceTotals(allProjects, idx, 'M'))}
                  </td>
                ))}
                <td className="text-right py-2 px-2 text-done border-l border-rule bg-ground">—</td>
              </tr>
              <tr className="border-b border-hair">
                <td className="py-2"><Pill kind="amber">Low</Pill></td>
                {months.map((month, idx) => (
                  <td key={month.key} className="text-right py-2 px-2 text-ink">
                    {formatCurrency(calculateConfidenceTotals(allProjects, idx, 'L'))}
                  </td>
                ))}
                <td className="text-right py-2 px-2 text-done border-l border-rule bg-ground">—</td>
              </tr>
              <tr className="border-b border-hair">
                <td className="py-2 text-muted text-xs">Blank</td>
                {months.map((month, idx) => (
                  <td key={month.key} className="text-right py-2 px-2 text-muted">
                    {formatCurrency(calculateConfidenceTotals(allProjects, idx, ''))}
                  </td>
                ))}
                <td className="text-right py-2 px-2 text-done border-l border-rule bg-ground">—</td>
              </tr>

              <tr><td colSpan={months.length + 2} className="py-2"></td></tr>

              <tr className="border-b border-hair">
                <td className="py-2 text-ink">Contracted (O)</td>
                {months.map((month, idx) => (
                  <td key={month.key} className="text-right py-2 px-2 text-ink">
                    {formatCurrency(calculateStatusTotals(allProjects, idx, 'O'))}
                  </td>
                ))}
                <td className="text-right py-2 px-2 font-bold text-ink border-l border-rule bg-ground">
                  {formatCurrency(calculateBeyondWindowTotals(allProjects, 'O'))}
                </td>
              </tr>
              <tr className="border-b border-hair">
                <td className="py-2 text-accent">Projected (PR)</td>
                {months.map((month, idx) => (
                  <td key={month.key} className="text-right py-2 px-2 text-accent">
                    {formatCurrency(calculateStatusTotals(allProjects, idx, 'PR'))}
                  </td>
                ))}
                <td className="text-right py-2 px-2 font-bold text-accent border-l border-rule bg-ground">
                  {formatCurrency(calculateBeyondWindowTotals(allProjects, 'PR'))}
                </td>
              </tr>
              <tr className="bg-ground font-bold border-t-2 border-ink">
                <td className="py-2 px-2 text-ink">Total (no PR)</td>
                {months.map((month, idx) => (
                  <td key={month.key} className="text-right py-2 px-2 text-ink">
                    {formatCurrency(calculateStatusTotals(allProjects, idx, 'O'))}
                  </td>
                ))}
                <td className="text-right py-2 px-2 font-bold text-ink border-l border-rule">
                  {formatCurrency(calculateBeyondWindowTotals(allProjects, 'O'))}
                </td>
              </tr>
            </tbody>
          </table>
          </div>
        </Panel>
      </div>
      )}
    </div>
  );
}

// ─── CDAM View (SI's aggregated assignments) ─────────────────────────────────────

function CDAMView({ projects, weeks }) {
  const CDAM_STAFF = 'SI'; // The shared staff member
  const [viewMode, setViewMode] = useState('calendar'); // 'calendar' or 'list'
  const [filterPrincipal, setFilterPrincipal] = useState('all');

  // Get all tasks assigned to SI across all principals
  const getAllSITasks = () => {
    const tasks = [];
    projects.forEach(project => {
      (project.tasks || []).forEach(task => {
        if (task.staff === CDAM_STAFF) {
          tasks.push({
            ...task,
            projectName: project.projectName,
            projectNum: project.projectNum,
            principal: project.principal,
            phase: project.phase
          });
        }
      });
    });
    return tasks;
  };

  const allSITasks = getAllSITasks();

  // Filter by principal
  const siTasks = filterPrincipal === 'all'
    ? allSITasks
    : allSITasks.filter(t => t.principal === filterPrincipal);

  // Group by week for calendar view
  const getTasksForWeek = (weekLabel) => {
    return siTasks.filter(t => t.week === weekLabel);
  };

  // Calculate hours per week
  const getHoursForWeek = (weekLabel) => {
    return siTasks.filter(t => t.week === weekLabel).reduce((sum, t) => sum + (t.hours || 0), 0);
  };

  // Group by project for list view
  const tasksByProject = {};
  siTasks.forEach(task => {
    const key = task.projectNum || task.projectName;
    if (!tasksByProject[key]) {
      tasksByProject[key] = {
        projectName: task.projectName,
        projectNum: task.projectNum,
        principal: task.principal,
        phase: task.phase,
        tasks: []
      };
    }
    tasksByProject[key].tasks.push(task);
  });

  // Calculate total hours
  const totalHours = siTasks.reduce((sum, t) => sum + (t.hours || 0), 0);

  return (
    <div>
      <Tabs
        tabs={[{ id: 'calendar', label: 'Calendar' }, { id: 'list', label: 'List' }]}
        value={viewMode}
        onChange={setViewMode}
        right={
          <div className="flex items-center gap-4 text-sm">
            <div>
              <span className="font-bold text-ink">{STAFF_RATES[CDAM_STAFF]?.name || CDAM_STAFF}</span>
              <span className="ml-2 text-muted">Construction Documentation &amp; Admin Manager</span>
            </div>
            <div className="text-sm">
              <span className="text-muted">Total:</span>
              <span className={`font-bold ml-1 ${hoursTextClass(totalHours)}`}>{totalHours}h</span>
            </div>
          </div>
        }
      />

      {viewMode === 'calendar' && (
        <div className="bg-white border border-rule rounded overflow-hidden">
          <div className={`flex border-b border-rule ${gridHeader}`}>
            <div className="w-48 flex-shrink-0 px-3 py-2 font-bold text-xs border-r border-white/15">Week</div>
            <div className="flex-1 px-3 py-2 font-bold text-xs">Assignments</div>
          </div>
          {weeks.map(week => {
            const weekTasks = getTasksForWeek(week.label);
            const weekHours = getHoursForWeek(week.label);
            const hoursColor = weekHours > 0 ? hoursTextClass(weekHours) : 'text-done';

            return (
              <div key={week.key} className="flex border-b border-hair last:border-b-0 hover:bg-ground/60">
                <div className="w-48 flex-shrink-0 px-3 py-2 border-r border-rule">
                  <div className="font-bold text-sm text-ink">{week.label}</div>
                  <div className={`text-sm font-bold ${hoursColor}`}>{weekHours > 0 ? `${weekHours}h` : '—'}</div>
                </div>
                <div className="flex-1 p-2">
                  {weekTasks.length === 0 ? (
                    <div className="text-sm text-muted italic">No assignments</div>
                  ) : (
                    <div className="space-y-1">
                      {weekTasks.map((t, i) => (
                        <div key={i} className="flex items-center gap-2 text-sm">
                          <Pill kind="outline">{t.principal}</Pill>
                          <span className="font-bold text-ink">{t.projectName}</span>
                          <span className="text-muted">—</span>
                          <span className="text-ink flex-1">{t.task}</span>
                          <span className="font-bold text-muted">{t.hours}h</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {viewMode === 'list' && (
        <div className="bg-white border border-rule rounded overflow-hidden">
          <div className={`flex border-b border-rule ${gridHeader}`}>
            <div className="flex-1 px-3 py-2 font-bold text-xs">Assignments by Project</div>
          </div>
          {Object.keys(tasksByProject).length === 0 ? (
            <Empty>No assignments</Empty>
          ) : (
            Object.values(tasksByProject).map((project, idx) => {
              const projectHours = project.tasks.reduce((sum, t) => sum + (t.hours || 0), 0);
              return (
                <div key={idx} className="border-b border-rule last:border-b-0">
                  <div className="flex items-center gap-3 px-3 py-2 bg-ground">
                    <Pill kind="outline">{project.principal}</Pill>
                    <span className="font-flecha text-sm text-ink">{project.projectName}</span>
                    <span className="text-xs text-muted">{project.projectNum}</span>
                    {project.phase && <Pill kind="phase">{project.phase}</Pill>}
                    <span className="ml-auto font-bold text-ink">{projectHours}h total</span>
                  </div>
                  <div className="px-3 py-2 space-y-1">
                    {project.tasks.map((t, i) => (
                      <div key={i} className={`flex items-center gap-2 text-sm pl-4 ${t.completed ? 'opacity-60' : ''}`}>
                        <span className="text-muted">{t.week}</span>
                        <span className="text-muted">—</span>
                        <span className={`flex-1 ${t.completed ? 'line-through text-done' : 'text-ink'}`}>{t.task}</span>
                        <span className="font-bold text-muted">{t.hours}h</span>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}

// ─── Main Page ─────────────────────────────────────────────────────────────────

const VIEW_TABS = [
  { id: 'principal', label: 'Principal View' },
  { id: 'team', label: 'Team View' },
  { id: 'cdam', label: 'CDAM' },
  { id: 'horizon', label: 'Horizon' },
  { id: 'dashboard', label: 'Dashboard' },
  { id: 'projections', label: 'Projections' },
];

function WorkPlansPageInner() {
  // ?principal=AB (project page breadcrumb) or ?principal=ALL; anything else falls back to MM
  const [principal, setPrincipal] = useState(() => { const v = qp('principal', 'MM'); return v === 'ALL' || PRINCIPAL_NAMES[v] ? v : 'MM'; });
  const [projects, setProjects] = useState([]);
  const [feeData, setFeeData] = useState([]);
  const [projectionData, setProjectionData] = useState({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [activeTab, setActiveTab] = useState(() => qp('view', 'principal'));
  const [numWeeks, setNumWeeks] = useState(8);
  const [editingCell, setEditingCell] = useState(null);
  const [editingProject, setEditingProject] = useState(null);
  const [editingStaffCell, setEditingStaffCell] = useState(null);

  // Refs for tracking server state
  const lastKnownData = useRef([]);
  const loadedSuccessfully = useRef(false);

  const principalWeekOptions = [1, 2, 4, 8, 16];
  const teamWeekOptions = [1, 2, 4];
  const weekOptions = activeTab === 'team' ? teamWeekOptions : principalWeekOptions;
  const weeks = getWeeksArray(numWeeks);
  const allWeeks = getWeeksArray(78, 1); // 1 past week + 78 future weeks = 79 total

  useEffect(() => {
    Promise.all([
      fetch('/api/projects').then(r => r.json()),
      fetch('/api/masterdata').then(r => r.json()).catch(() => ({ data: [] })),
      fetch('/api/projections').then(r => r.json()).catch(() => ({ projections: {} }))
    ]).then(([projectData, masterData, projData]) => {
      const projectsWithIds = (projectData.projects || []).map(p => ({ ...p, id: p.id || generateId() }));

      // Clean up completed reviews past last Friday — remove from needsReview entirely
      const currentMonday = getMonday(new Date());
      const lastFriday = new Date(currentMonday); lastFriday.setDate(lastFriday.getDate() - 3);
      const lastFridayStr = `${lastFriday.getFullYear()}-${String(lastFriday.getMonth()+1).padStart(2,'0')}-${String(lastFriday.getDate()).padStart(2,'0')}`;
      let anyChanged = false;
      const cleanedProjects = projectsWithIds.map(p => {
        const rcb = p.reviewCompletedBy || {};
        const expiredPartners = Object.entries(rcb).filter(([_, date]) => date <= lastFridayStr).map(([initials]) => initials);
        if (expiredPartners.length === 0) return p;
        const newNeedsReview = (p.needsReview || []).filter(x => !expiredPartners.includes(x));
        const newRcb = { ...rcb }; expiredPartners.forEach(x => delete newRcb[x]);
        anyChanged = true;
        return { ...p, needsReview: newNeedsReview, reviewCompletedBy: newRcb };
      });

      setProjects(cleanedProjects);
      setFeeData(masterData.data || []);
      setProjectionData(projData.projections || {});
      lastKnownData.current = cleanedProjects;
      loadedSuccessfully.current = true;
      setLoading(false);

      // Save cleaned projects via atomic updateFields
      if (anyChanged) {
        cleanedProjects.filter((p, i) => p !== projectsWithIds[i]).forEach(p => {
          fetch('/api/projects', { method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ updateFields: { projectId: p.id, fields: { needsReview: p.needsReview, reviewCompletedBy: p.reviewCompletedBy } } })
          }).catch(e => console.error('Review cleanup save error:', e));
        });
      }
    }).catch(err => {
      console.error('Load error:', err);
      setProjects([]);
      loadedSuccessfully.current = false; // SAFETY: don't allow saves if load failed
      setLoading(false);
    });
  }, []);

  // Real-time subscription for project changes from other users
  useEffect(() => {
    if (loading) return;

    const channel = supabase
      .channel('projects-realtime')
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'projects' },
        (payload) => {
          if (payload.eventType === 'INSERT' || payload.eventType === 'UPDATE') {
            const updatedProject = dbToProject(payload.new);
            setProjects(current => {
              const idx = current.findIndex(p => p.id === updatedProject.id);
              if (idx >= 0) {
                const updated = [...current];
                updated[idx] = updatedProject;
                return updated;
              } else {
                return [...current, updatedProject];
              }
            });
          } else if (payload.eventType === 'DELETE') {
            const deletedId = payload.old?.id;
            if (deletedId) {
              setProjects(current => current.filter(p => p.id !== deletedId));
            }
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [loading]);

  // Real-time subscription for projection changes from other users
  useEffect(() => {
    if (loading) return;

    const channel = supabase
      .channel('projections-realtime')
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'projections' },
        (payload) => {
          if (payload.eventType === 'INSERT' || payload.eventType === 'UPDATE') {
            const row = payload.new;
            if (row?.project_id) {
              setProjectionData(current => {
                const updated = { ...current };
                // Merge: keep local keys, add/overwrite with DB keys
                const existing = updated[row.project_id]?.months || {};
                updated[row.project_id] = {
                  confidence: row.confidence || '',
                  months: { ...existing, ...(row.months || {}) }
                };
                return updated;
              });
            }
          }
        }
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [loading]);

  // Refresh fee data periodically
  useEffect(() => {
    const interval = setInterval(() => {
      fetch('/api/masterdata').then(r => r.json()).then(data => setFeeData(data.data || [])).catch(() => {});
    }, 60000); // every minute
    return () => clearInterval(interval);
  }, []);

  // Save a new project to Supabase (full upsert - only for new project creation)
  const saveProject = useCallback(async (project) => {
    if (!loadedSuccessfully.current) return;
    setSaving(true);
    try {
      await fetch('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ project })
      });
    } catch (err) {
      console.error('Save error:', err);
    }
    setSaving(false);
  }, []);

  // Delete a project from Supabase
  const deleteProjectFromServer = useCallback(async (projectId) => {
    if (!loadedSuccessfully.current) return;
    setSaving(true);
    try {
      const res = await fetch('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deleteProjectId: projectId })
      });
      const data = await res.json();
      if (!data.success) {
        console.error('Delete failed:', data.error);
        alert('Delete failed! Please refresh and try again.');
      }
    } catch (err) {
      console.error('Delete error:', err);
      alert('Delete failed! Please refresh and try again.');
    }
    setSaving(false);
  }, []);

  const addProject = () => {
    const newProject = { id: generateId(), projectNum: '', projectName: '', principal: principal, phase: '', milestones: [], tasks: [], partnersInCharge: [], teamMembers: [], needsReview: [], reviewCompletedBy: {}, partnerNeeds: '', internalHealth: '', externalHealth: '', needs: '' };
    setProjects([...projects, newProject]);
    saveProject(newProject); // Save skeleton to DB immediately
    setEditingProject(newProject);
  };

  const updateProject = (updatedProject) => {
    setProjects(prev => prev.map(p => p.id === updatedProject.id ? updatedProject : p));
  };

  const updateMultipleProjects = (updatedProjects) => {
    const updatedIds = new Set(updatedProjects.map(p => p.id));
    setProjects(prev => prev.map(p => updatedIds.has(p.id) ? updatedProjects.find(up => up.id === p.id) : p));
  };

  const deleteProject = (projectId) => {
    if (confirm('Delete this project?')) {
      setProjects(projects.filter(p => p.id !== projectId));
      deleteProjectFromServer(projectId);
    }
  };

  // Components save directly to the API with atomic operations.
  // No debounce timer needed — saves happen on modal close.

  // Export principal's data for Claude
  const exportForClaude = () => {
    const principalProjects = projects.filter(p => p.principal === principal);
    const today = new Date().toISOString().split('T')[0];

    let md = `# ${PRINCIPAL_NAMES[principal]} Active Projects - ${today}\n\n`;
    md += `*Exported from HDLA Work Plans Dashboard*\n\n`;
    md += `---\n\n`;

    principalProjects.forEach(project => {
      // Get fee data for this project
      const projectFees = (feeData || []).filter(f => f['Project #'] === project.projectNum);
      const totalFeeRemaining = projectFees.reduce((sum, f) => sum + (f['Fee Remaining'] || 0), 0);

      md += `## ${project.projectName || 'Unnamed Project'}\n`;
      md += `- **Project #:** ${project.projectNum || 'N/A'}\n`;
      md += `- **Phase:** ${project.phase || 'N/A'}\n`;
      md += `- **Fee Remaining:** ${totalFeeRemaining > 0 ? '$' + totalFeeRemaining.toLocaleString() : 'N/A'}\n`;

      // Health status
      const health = project.internalHealth === 'Poor' || project.externalHealth === 'Poor' ? 'Poor' :
                     project.internalHealth === 'Watch' || project.externalHealth === 'Watch' ? 'Watch' : 'Good';
      md += `- **Health:** ${health}\n`;

      // Partners
      if (project.partnersInCharge?.length > 0) {
        md += `- **Partners:** ${project.partnersInCharge.join(', ')}\n`;
      }

      // Needs
      if (project.needs?.trim()) {
        md += `- **Needs:** ${project.needs}\n`;
      }
      if (project.needsReview?.length > 0) {
        md += `- **Needs Review From:** ${project.needsReview.join(', ')}\n`;
      }

      // Milestones
      const milestones = (project.milestones || []).filter(m => m.date);
      if (milestones.length > 0) {
        md += `\n### Upcoming Milestones\n`;
        milestones.sort((a, b) => new Date(a.date) - new Date(b.date)).forEach(m => {
          const type = m.type === 'deadline' ? '🔴 Deadline' : m.type === 'hardCheckIn' ? '🔵 Hard Check-in' : '🩷 Soft Check-in';
          md += `- ${m.date}: ${type} - ${m.description}\n`;
        });
      }

      // Tasks
      const tasks = project.tasks || [];
      if (tasks.length > 0) {
        md += `\n### Assigned Tasks\n`;
        const tasksByWeek = {};
        tasks.forEach(t => {
          if (!tasksByWeek[t.week]) tasksByWeek[t.week] = [];
          tasksByWeek[t.week].push(t);
        });
        Object.keys(tasksByWeek).forEach(week => {
          md += `**${week}:**\n`;
          tasksByWeek[week].forEach(t => {
            md += `- ${t.staff}: ${t.task} (${t.hours}h)\n`;
          });
        });
      }

      md += `\n---\n\n`;
    });

    // Team summary
    md += `## Team Members\n`;
    const teamStaff = STAFF_BY_PRINCIPAL[principal] || [];
    md += `- Principal: ${principal}\n`;
    teamStaff.forEach(s => {
      md += `- ${s}\n`;
    });

    // Download the file
    const blob = new Blob([md], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${principal}-projects-${today}.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  // Adjust weeks if switching tabs and current value not valid
  useEffect(() => {
    if (activeTab === 'team' && !teamWeekOptions.includes(numWeeks)) {
      setNumWeeks(4);
    }
  }, [activeTab]);

  // Auto-switch to Dashboard when All Principals selected
  useEffect(() => {
    if (principal === 'ALL' && !['dashboard', 'cdam', 'projections'].includes(activeTab)) {
      setActiveTab('dashboard');
    }
  }, [principal]);

  const eyebrow = `Work Plan · ${principal === 'ALL' ? 'All Principals' : `${PRINCIPAL_NAMES[principal]}'s team`}`;

  // Header actions: pickers and buttons from the old in-page header
  const actions = (
    <>
      {activeTab !== 'horizon' && activeTab !== 'dashboard' && activeTab !== 'projections' && (
        <Select value={numWeeks} onChange={(e) => setNumWeeks(parseInt(e.target.value))} aria-label="Weeks shown">
          {weekOptions.map(w => <option key={w} value={w}>{w} week{w > 1 ? 's' : ''}</option>)}
        </Select>
      )}
      <Select value={principal} onChange={(e) => setPrincipal(e.target.value)} aria-label="Principal"><option value="ALL">All Principals</option>{Object.entries(PRINCIPAL_NAMES).map(([k, v]) => (<option key={k} value={k}>{v}</option>))}</Select>
      {activeTab === 'principal' && (<Button onClick={addProject}>+ Add Project</Button>)}
      {activeTab === 'principal' && (<Button variant="secondary" onClick={exportForClaude}>Export for Claude</Button>)}
      <span className={`text-xs ml-1 ${saving ? 'text-status-amber' : 'text-muted'}`}>{saving ? 'Saving…' : 'Saved'}</span>
    </>
  );

  return (
    <Shell module="workplan" eyebrow={eyebrow} title="Work Plans" actions={actions}>
      {loading ? (
        <div className="py-16 text-center text-muted animate-pulse">Loading…</div>
      ) : (
        <>
          <Tabs tabs={VIEW_TABS} value={activeTab} onChange={setActiveTab} />

          {(activeTab === 'principal' || activeTab === 'team') && (
            <div className="flex gap-4 mb-2 text-xs text-muted items-center">
              <div className="flex items-center gap-1.5"><span className="chip-deadline px-1.5 py-0.5 rounded-[2px] text-[11px] font-bold">Deadline</span></div>
              <div className="flex items-center gap-1.5"><span className="chip-hard px-1.5 py-0.5 rounded-[2px] text-[11px] font-bold">Hard</span> Check-in</div>
              <div className="flex items-center gap-1.5"><span className="chip-soft px-1.5 py-0.5 rounded-[2px] text-[11px] font-bold">Soft</span> Check-in</div>
              <div className="flex items-center gap-1.5"><span className="chip-done px-1.5 py-0.5 rounded-[2px] text-[11px] font-bold">Done</span></div>
              <div className="ml-auto">Click cells to edit · click a project name to open it</div>
            </div>
          )}

          {activeTab === 'principal' && principal !== 'ALL' && <PrincipalView projects={projects} allWeeks={allWeeks} zoomLevel={numWeeks} principal={principal} onCellClick={(project, week) => setEditingCell({ project, week })} onProjectClick={(project) => setEditingProject(project)} feeData={feeData} projectionData={projectionData} />}
          {activeTab === 'team' && principal !== 'ALL' && <TeamView projects={projects} weeks={weeks} principal={principal} onStaffCellClick={(staffMember, week) => setEditingStaffCell({ staffMember, week })} />}
          {activeTab === 'cdam' && <CDAMView projects={projects} weeks={weeks} />}
          {activeTab === 'horizon' && principal !== 'ALL' && <HorizonView projects={projects} principal={principal} />}
          {activeTab === 'dashboard' && <DashboardView projects={projects} weeks={weeks} principal={principal} feeData={feeData} projectionData={projectionData} />}
          {activeTab === 'projections' && <ProjectionsView feeData={feeData} principal={principal} />}

          {editingCell && <CellEditor project={editingCell.project} weekKey={editingCell.week.key} weekLabel={editingCell.week.label} principal={principal} onClose={() => setEditingCell(null)} onSave={updateProject} />}
          {editingProject && <ProjectSettings project={editingProject} onClose={() => setEditingProject(null)} onSave={updateProject} onDelete={deleteProject} />}
          {editingStaffCell && <StaffTaskEditor staffMember={editingStaffCell.staffMember} weekLabel={editingStaffCell.week.label} projects={projects} principal={principal} onClose={() => setEditingStaffCell(null)} onSave={updateMultipleProjects} />}
        </>
      )}
    </Shell>
  );
}

export default function WorkPlansPage() {
  return <WorkPlansPageInner />;
}
