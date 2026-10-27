'use client';
// Small presentational pieces the Marketing tabs share. Everything here is built on the OneFirm
// system: ink/muted/rule palette, 4px radius max, no shadows, no colored card backgrounds.
import { useState } from 'react';
import { Link } from '../shell/ui';

// Section inside a modal: small caps label with an optional action on the right.
export const Sec = ({title,action,children}) => <div><div className="flex justify-between items-center mb-1.5"><div className="text-[11px] tracking-[0.08em] uppercase text-muted">{title}</div>{action}</div>{children}</div>;
export const AddLink = ({onClick,children}) => <Link onClick={onClick} className="text-xs">{children}</Link>;
export const DelBtn = ({onClick,title}) => <button type="button" onClick={onClick} title={title||"Remove"} className="text-muted hover:text-status-red px-1 text-base leading-none" aria-label="Remove">×</button>;
export const Hint = ({children}) => <div className="text-xs text-muted mt-1">{children}</div>;
export const Caption = ({children,className=''}) => <div className={'text-xs text-muted '+className}>{children}</div>;

// A Figure that is also a link: click goes somewhere (a tab + filter).
export function LinkedFigure({label,value,sub,onClick,accent,red,title}) {
  return (
    <button type="button" onClick={onClick} title={title} className="bg-white border border-rule rounded px-5 py-4 flex flex-col gap-1.5 min-w-0 text-left hover:border-ink">
      <div className="text-[11px] tracking-[0.08em] uppercase text-muted">{label}</div>
      <div className={'font-flecha text-[30px] leading-none '+(accent?'text-accent':'')}>{value}</div>
      {sub&&<div className={'text-xs '+(red?'text-status-red font-bold':'text-muted')}>{sub}</div>}
    </button>
  );
}

// Second-level view switch inside a tab (List · Board · …). Outlined ink, selected = solid ink.
export function SubTabs({tabs,value,onChange}) {
  return <div className="inline-flex border border-ink rounded-[3px] overflow-hidden">
    {tabs.map(t=>{const on=t.id===value;return <button key={t.id} type="button" data-testid={t.testId} onClick={()=>onChange(t.id)} className={'px-3 h-8 text-[12px] font-bold '+(on?'bg-ink text-white':'bg-white text-ink hover:bg-ground')}>{t.label}{t.count!=null&&<span className={'ml-1.5 font-normal '+(on?'text-white/70':'text-muted')}>{t.count}</span>}</button>;})}
  </div>;
}

// Toggle chip (multi-select stage filter). On = solid ink.
export function Chip({on,onClick,children,count,testId}) {
  return <button type="button" data-testid={testId} onClick={onClick} className={'inline-flex items-center gap-1.5 h-8 px-3 rounded-[3px] text-[12px] font-bold border '+(on?'bg-ink text-white border-ink':'bg-white text-ink border-rule hover:border-ink')}>{children}{count!=null&&<span className={'font-normal '+(on?'text-white/70':'text-muted')}>· {count}</span>}</button>;
}

// Four small squares: filled = ink, empty = hair. Used for recency / pipeline bars in client views.
export function Bars({n,of=4,title}) {
  return <span className="inline-flex gap-0.5" title={title}>{Array.from({length:of},(_,i)=><span key={i} className={'w-[7px] h-[7px] rounded-[1px] '+(i<n?'bg-ink':'bg-hair')} />)}</span>;
}

// Trend arrow for the touch score, drawn as stroke SVG (no emoji).
export function Trend({trend}) {
  const d = trend==='up' ? 'M3 9 L7 4 L11 9' : trend==='down' ? 'M3 5 L7 10 L11 5' : 'M3 7 L11 7';
  return <svg width="14" height="14" viewBox="0 0 14 14" className="inline-block" aria-label={trend}><path d={d} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}

// Collapsible list with a count; hidden when empty.
export function Expander({title,count,children,open:initial=false}) {
  const [open,setOpen]=useState(initial);
  if(!count) return null;
  return (
    <div className="border-t border-hair first:border-t-0">
      <button type="button" onClick={()=>setOpen(!open)} className="w-full px-5 py-2.5 flex justify-between items-center text-sm text-left"><span className="font-bold">{title} <span className="text-muted font-normal">{count}</span></span><span className="text-xs text-muted">{open?'Hide':'Show'}</span></button>
      {open&&<div className="px-5 pb-3">{children}</div>}
    </div>
  );
}

// Section header + collapse used on Today panels.
export function Collapse({title,meta,open:initial=false,children,action}) {
  const [open,setOpen]=useState(initial);
  return (
    <section className="bg-white border border-rule rounded">
      <div className="flex justify-between items-baseline gap-3 px-5 py-3 border-b border-ink flex-wrap">
        <button type="button" onClick={()=>setOpen(!open)} className="text-left"><h2 className="m-0 text-xl">{title} <span className="text-xs text-muted font-normal font-sans">{open?'hide':'show'}</span></h2></button>
        <div className="flex items-center gap-3 text-xs text-muted">{meta}{action}</div>
      </div>
      {open&&<div>{children}</div>}
    </section>
  );
}

// Milestone chip in the system language.
export function MilestoneChip({type,done,children}) {
  const cls = done?'chip-done':type==='deadline'?'chip-deadline':type==='hardCheckIn'?'chip-hard':'chip-soft';
  return <span className={'inline-block text-[11px] px-1.5 py-[2px] rounded-[2px] leading-none truncate max-w-full '+cls}>{children}</span>;
}
export function Dot({type,title}) {
  const cls = type==='deadline'?'bg-ink':type==='hardCheckIn'?'bg-accent':'bg-white border border-accent';
  return <span className={'inline-block w-2.5 h-2.5 rounded-full '+cls} title={title} />;
}

// Native checkbox styled for table cells.
export const Tick = ({checked,onChange,title}) => <input type="checkbox" checked={!!checked} onChange={e=>onChange(e.target.checked)} title={title} className="w-4 h-4 shrink-0" onClick={e=>e.stopPropagation()} />;

export const Who = ({children}) => <span className="text-[10px] font-bold uppercase tracking-[0.04em] border border-rule rounded-[2px] px-1 py-px leading-none text-muted">{children}</span>;
