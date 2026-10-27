'use client';
// OneFirm component language. Small, boring, consistent.
import { useState } from 'react';

export const fmt$ = n => '$' + Math.round(Number(n) || 0).toLocaleString();
export const fmtDate = s => { if (!s) return '—'; const p = String(s).split('T')[0].split('-').map(Number); if (p.length < 3 || isNaN(p[0])) return String(s); return new Date(p[0], p[1] - 1, p[2]).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }); };
export const todayKey = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

export function Panel({ title, meta, action, children, className = '', pad }) {
  return (
    <section className={'bg-white border border-rule rounded ' + className}>
      {(title || meta || action) && (
        <div className="flex justify-between items-baseline gap-3 px-5 py-4 border-b border-ink flex-wrap">
          {title && <h2 className="m-0 text-xl">{title}</h2>}
          <div className="flex items-center gap-3 text-xs text-muted">{meta}{action}</div>
        </div>
      )}
      <div className={pad ? 'p-5' : ''}>{children}</div>
    </section>
  );
}

export function Figure({ label, value, sub, accent, red }) {
  return (
    <div className="bg-white border border-rule rounded px-5 py-4 flex flex-col gap-1.5 min-w-0">
      <div className="text-[11px] tracking-[0.08em] uppercase text-muted">{label}</div>
      <div className={'font-flecha text-[30px] leading-none ' + (accent ? 'text-accent' : '')}>{value}</div>
      {sub && <div className={'text-xs ' + (red ? 'text-status-red font-bold' : 'text-muted')}>{sub}</div>}
    </div>
  );
}

export function Button({ children, variant = 'primary', href, onClick, type = 'button', disabled, className = '', title }) {
  const base = 'inline-flex items-center h-10 px-4 text-[13px] font-bold rounded-[3px] whitespace-nowrap disabled:opacity-40 ';
  const v = variant === 'primary' ? 'bg-ink text-white hover:bg-[#2a2a28]'
    : variant === 'secondary' ? 'bg-white text-ink border border-ink hover:bg-ground'
    : variant === 'danger' ? 'bg-white text-status-red border border-status-red'
    : 'text-accent h-auto px-0';
  if (href) return <a href={href} className={base + v + ' ' + className} title={title}>{children}</a>;
  return <button type={type} onClick={onClick} disabled={disabled} className={base + v + ' ' + className} title={title}>{children}</button>;
}

export function Link({ children, href, onClick, className = '' }) {
  if (href) return <a href={href} className={'text-[13px] font-bold text-accent ' + className}>{children}</a>;
  return <button type="button" onClick={onClick} className={'text-[13px] font-bold text-accent ' + className}>{children}</button>;
}

// Status pill: kind = solid | outline | red | amber | accent | phase | done
export function Pill({ kind = 'outline', children, className = '' }) {
  const k = {
    solid: 'bg-ink text-white',
    outline: 'border border-ink text-ink',
    red: 'border border-status-red text-status-red',
    amber: 'border border-status-amber text-status-amber',
    accent: 'text-accent border-0 px-0',
    phase: 'border border-ink text-ink',
    done: 'bg-hair text-done line-through',
    hard: 'bg-accent text-white',
    soft: 'border border-accent text-accent',
    deadline: 'bg-ink text-white',
  }[kind] || 'border border-ink';
  return <span className={'inline-block text-[11px] font-bold tracking-[0.04em] uppercase px-2 py-[3px] rounded-[2px] leading-none ' + k + ' ' + className}>{children}</span>;
}

export function Table({ head, children, className = '' }) {
  return (
    <div className="overflow-x-auto">
      <table className={'of-table w-full border-collapse ' + className}>
        {head && <thead><tr>{head.map((h, i) => <th key={i} className={typeof h === 'object' && h.right ? 'text-right' : ''}>{typeof h === 'object' ? h.label : h}</th>)}</tr></thead>}
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

export function Tabs({ tabs, value, onChange, right }) {
  return (
    <div className="flex gap-0.5 border-b border-ink flex-wrap mb-5">
      {tabs.map(t => {
        const on = t.id === value;
        return <button key={t.id} type="button" onClick={() => onChange(t.id)} className={'px-4 py-2.5 text-[13px] -mb-px ' + (on ? 'font-bold border-b-[3px] border-accent' : 'font-normal text-ink hover:text-accent')}>{t.label}{t.count != null && <span className="ml-1.5 text-[11px] text-muted font-normal">{t.count}</span>}</button>;
      })}
      {right && <div className="ml-auto flex items-center gap-1.5 pb-1.5 flex-wrap">{right}</div>}
    </div>
  );
}

export const Input = p => <input {...p} className={'h-[38px] border border-rule rounded-[3px] px-2.5 text-[13px] bg-white ' + (p.className || '')} />;
export const Select = ({ children, ...p }) => <select {...p} className={'h-[38px] border border-rule rounded-[3px] px-2 text-[13px] bg-white ' + (p.className || '')}>{children}</select>;
export const Textarea = p => <textarea {...p} className={'border border-rule rounded-[3px] px-2.5 py-2 text-[13px] bg-white resize-y ' + (p.className || '')} />;
export const Label = ({ children, htmlFor }) => <label htmlFor={htmlFor} className="block text-xs text-muted mb-1">{children}</label>;

export function Checkbox({ checked, onChange, label, sub, strike }) {
  return (
    <label className="grid grid-cols-[18px_minmax(0,1fr)] gap-3 items-start cursor-pointer py-1">
      <input type="checkbox" checked={!!checked} onChange={e => onChange(e.target.checked)} className="w-[18px] h-[18px] mt-0.5" />
      <span>
        <span className={'text-sm ' + (strike && checked ? 'line-through text-done' : '')}>{label}</span>
        {sub && <span className="block text-xs text-muted">{sub}</span>}
      </span>
    </label>
  );
}

export function Empty({ children }) { return <div className="px-5 py-6 text-center text-sm text-muted italic">{children}</div>; }

export function Modal({ title, onClose, children, wide }) {
  return (
    <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50" onClick={onClose}>
      <div className={'bg-white rounded max-h-[90vh] overflow-auto border border-rule ' + (wide ? 'w-[760px]' : 'w-[560px]')} onClick={e => e.stopPropagation()}>
        <div className="sticky top-0 bg-white border-b border-ink px-5 py-3 flex justify-between items-center z-10">
          <div className="font-flecha text-lg">{title}</div>
          <Button onClick={onClose} className="h-8 px-3">Done</Button>
        </div>
        <div className="p-5 space-y-4">{children}</div>
      </div>
    </div>
  );
}

export function useLocal(key, initial) {
  const [v, setV] = useState(() => { try { const s = localStorage.getItem(key); return s == null ? initial : JSON.parse(s); } catch { return initial; } });
  const set = x => { setV(x); try { localStorage.setItem(key, JSON.stringify(x)); } catch {} };
  return [v, set];
}
