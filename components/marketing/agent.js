'use client';
// Proposal Agent: paste an email or fill the form, the API drafts a proposal; corrections are rules
// saved for every future draft. Same API calls as before; chrome restyled to the system.
import { useState } from 'react';
import { Panel, Button, Link, Input, Textarea, Select, Label } from '../shell/ui';
import { SubTabs, Hint } from './bits';

const AGENT_PARTNERS = ['RJ', 'CB', 'MB', 'TJ'];
const AGENT_PROJECT_TYPES = ['Developer/Private', 'Mixed-Use/Urban', 'Public/State', 'Planning/Engagement', 'Institutional/Campus'];
const AGENT_PHASE_OPTIONS = ['Concept', 'SD', 'DD', 'CD', 'BP', 'CA'];
const partnerName = p => p === 'CB' ? 'Chris Barkley' : p === 'MB' ? 'Michael Black' : p === 'TJ' ? 'TJ Eliason' : 'Richie Jones';

function AgentField({ label, value, onChange, placeholder, multiline }) {
  return <div><Label>{label}</Label>{multiline ? <Textarea value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} rows={3} className="w-full" /> : <Input value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} className="w-full" />}</div>;
}

export function ProposalAgentTab() {
  const [mode, setMode] = useState('paste');
  const [rawInput, setRawInput] = useState('');
  const [formData, setFormData] = useState({
    projectName: '', location: '', clientName: '', clientContact: '', clientAddress: '',
    partner: 'RJ', date: new Date().toISOString().split('T')[0],
    projectType: 'Mixed-Use/Urban', fee: '', phases: ['Concept', 'SD', 'DD', 'CD', 'BP', 'CA'],
    scope: '', exteriorSpaces: '', architect: '', subconsultants: '', exclusions: '', notes: ''
  });
  const [proposal, setProposal] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [downloading, setDownloading] = useState(false);
  const [correctionText, setCorrectionText] = useState('');
  const [correctionSaved, setCorrectionSaved] = useState(false);
  const [corrections, setCorrections] = useState([]);
  const [showCorrections, setShowCorrections] = useState(false);

  const updateForm = (key, val) => setFormData(prev => ({ ...prev, [key]: val }));
  const togglePhase = (phase) => setFormData(prev => ({ ...prev, phases: prev.phases.includes(phase) ? prev.phases.filter(p => p !== phase) : [...prev.phases, phase] }));

  const loadCorrections = async () => {
    try { const res = await fetch('/api/generate-proposal', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'get_corrections' }) }); const data = await res.json(); setCorrections(data.corrections || []); } catch (e) {}
  };
  const handleAddCorrection = async () => {
    if (!correctionText.trim()) return;
    try {
      await fetch('/api/generate-proposal', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'add_correction', correction: correctionText.trim(), proposalContext: proposal?.projectName || '' }) });
      setCorrectionText(''); setCorrectionSaved(true); setTimeout(() => setCorrectionSaved(false), 3000); loadCorrections();
    } catch (err) { setError('Failed to save correction'); }
  };
  const handleGenerate = async () => {
    setLoading(true); setError(''); setProposal(null);
    try {
      const res = await fetch('/api/generate-proposal', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ formData: mode === 'form' ? formData : {}, rawInput: mode === 'paste' ? rawInput : '' }) });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setProposal(data.proposal);
    } catch (err) { setError(err.message); }
    setLoading(false);
  };
  const handleDownloadDocx = async () => {
    if (!proposal) return;
    setDownloading(true);
    try {
      const res = await fetch('/api/generate-proposal-docx', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ proposal }) });
      if (!res.ok) throw new Error('Download failed');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${(proposal.projectName || 'HDLA_Proposal').replace(/[^a-zA-Z0-9 ]/g, '').replace(/\s+/g, '_')}.docx`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) { setError('Download failed: ' + err.message); }
    setDownloading(false);
  };
  const toRoman = (n) => ['i','ii','iii','iv','v','vi','vii','viii','ix','x','xi','xii'][n - 1] || n;
  const canGenerate = !(loading || (mode === 'paste' && !rawInput.trim()) || (mode === 'form' && !formData.projectName && !formData.clientName));

  return (
    <div className="max-w-4xl space-y-4">
      <Panel title="Agent corrections" meta="Rules apply to every future draft" pad>
        <div className="flex items-end gap-3">
          <div className="flex-1">
            <Label>Add a rule</Label>
            <Input value={correctionText} onChange={e => setCorrectionText(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleAddCorrection()} placeholder="e.g. Never include concept as a separate phase under $80K" className="w-full" />
          </div>
          <Button variant="secondary" onClick={handleAddCorrection} disabled={!correctionText.trim()}>Save rule</Button>
        </div>
        {correctionSaved && <div className="text-xs text-accent font-bold mt-2">Correction saved — it will apply to the next proposal.</div>}
        <div className="mt-2"><Link onClick={() => { setShowCorrections(!showCorrections); if (!showCorrections) loadCorrections(); }} className="text-xs">{showCorrections ? 'Hide' : 'View'} active corrections</Link></div>
        {showCorrections && corrections.length > 0 && <ol className="mt-2 space-y-1 list-decimal pl-5">{corrections.map((c, i) => <li key={i} className="text-xs text-muted">{c}</li>)}</ol>}
        {showCorrections && corrections.length === 0 && <div className="text-xs text-muted italic mt-2">No corrections yet. Generate a proposal and flag anything that needs fixing.</div>}
      </Panel>

      <Panel title="Draft a proposal" meta="Claude API · generate-proposal" action={<SubTabs tabs={[{id:'paste',label:'Paste email / message'},{id:'form',label:'Structured form'}]} value={mode} onChange={setMode} />} pad>
        {mode === 'paste' ? (
          <div>
            <Label>Paste partner email, Teams message, or notes</Label>
            <Textarea value={rawInput} onChange={e => setRawInput(e.target.value)} rows={8} placeholder="Need a proposal on multifamily project in WeHo. It is for AJ Capital…" className="w-full" />
            <Hint>The agent extracts details, selects the right structure, and generates a complete draft.</Hint>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <AgentField label="Project name" value={formData.projectName} onChange={v => updateForm('projectName', v)} placeholder="AJ Capital WeHo MF" />
              <AgentField label="Location" value={formData.location} onChange={v => updateForm('location', v)} placeholder="Nashville, TN" />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <AgentField label="Client" value={formData.clientName} onChange={v => updateForm('clientName', v)} placeholder="AJ Capital" />
              <AgentField label="Client contact" value={formData.clientContact} onChange={v => updateForm('clientContact', v)} placeholder="Name and title" />
            </div>
            <AgentField label="Client address" value={formData.clientAddress} onChange={v => updateForm('clientAddress', v)} placeholder="Street, City, State ZIP" />
            <div className="grid grid-cols-3 gap-4">
              <div><Label>Partner</Label><Select value={formData.partner} onChange={e => updateForm('partner', e.target.value)} className="w-full">{AGENT_PARTNERS.map(p => <option key={p}>{p}</option>)}</Select></div>
              <div><Label>Project type</Label><Select value={formData.projectType} onChange={e => updateForm('projectType', e.target.value)} className="w-full">{AGENT_PROJECT_TYPES.map(t => <option key={t}>{t}</option>)}</Select></div>
              <AgentField label="Total fee" value={formData.fee} onChange={v => updateForm('fee', v)} placeholder="$100,000" />
            </div>
            <div><Label>Phases</Label><div className="flex gap-2 flex-wrap">{AGENT_PHASE_OPTIONS.map(p => { const on = formData.phases.includes(p); return <button key={p} type="button" onClick={() => togglePhase(p)} className={'h-8 px-3 rounded-[3px] text-xs font-bold border ' + (on ? 'bg-ink text-white border-ink' : 'bg-white text-ink border-rule hover:border-ink')}>{p}</button>; })}</div></div>
            <AgentField label="Scope items" value={formData.scope} onChange={v => updateForm('scope', v)} placeholder="Hardscape, landscape, planting, irrigation, pool…" multiline />
            <AgentField label="Exterior spaces" value={formData.exteriorSpaces} onChange={v => updateForm('exteriorSpaces', v)} placeholder="Primary amenity roof with pool, entry plaza…" multiline />
            <div className="grid grid-cols-2 gap-4">
              <AgentField label="Working under architect" value={formData.architect} onChange={v => updateForm('architect', v)} placeholder="Firm name or leave blank" />
              <AgentField label="Subconsultants" value={formData.subconsultants} onChange={v => updateForm('subconsultants', v)} placeholder="Pool, irrigation, structural…" />
            </div>
            <AgentField label="Special notes" value={formData.notes} onChange={v => updateForm('notes', v)} placeholder="Entitlement meetings, schedule constraints, etc." multiline />
          </div>
        )}
        <div className="mt-5 flex items-center gap-4">
          <Button onClick={handleGenerate} disabled={!canGenerate}>{loading ? 'Generating…' : 'Create proposal'}</Button>
          {error && <p className="text-sm text-status-red">{error}</p>}
        </div>
      </Panel>

      {proposal && (
        <Panel title={proposal.projectName} meta={`${proposal.location} · ${proposal.totalFee}`} action={<div className="flex gap-2"><Button variant="secondary" onClick={handleDownloadDocx} disabled={downloading} className="h-8 px-3">{downloading ? 'Preparing…' : 'Download Word'}</Button><Button variant="secondary" onClick={() => { navigator.clipboard.writeText(generateAgentText(proposal)); }} className="h-8 px-3">Copy text</Button></div>}>
          <div className="px-5 py-5 text-sm space-y-4 max-h-[600px] overflow-y-auto">
            <div className="font-flecha text-xl">PROPOSAL</div>
            <div>{proposal.projectName}</div>
            <div className="text-muted">{proposal.location}</div>
            <div className="mt-4 text-muted"><div>To: {proposal.clientContact || '[TBD]'}</div><div className="ml-8">{proposal.clientName}</div>{proposal.clientAddress && <div className="ml-8">{proposal.clientAddress}</div>}</div>
            <div className="text-muted"><div>From: {partnerName(proposal.partner)}</div><div className="ml-10">HDLA</div></div>
            <div className="border-t border-hair pt-4"><p>{proposal.openingParagraph}</p></div>
            <p>{proposal.projectUnderstanding}</p>
            <div className="font-bold mt-4">SCOPE OF WORK</div>
            <p>{proposal.scopeIntro}</p>
            {proposal.exteriorSpaces?.length > 0 && (<div className="ml-4"><div>1. Landscape and Hardscape for the following exterior spaces:</div>{proposal.exteriorSpaces.map((s, i) => <div key={i} className="ml-6">{String.fromCharCode(97 + i)}. {s}</div>)}</div>)}
            {proposal.hardscapeItems?.length > 0 && (<div className="ml-8 space-y-1 mt-2">{proposal.hardscapeItems.map((h, i) => <div key={i}>{toRoman(i + 1)}. {h}</div>)}</div>)}
            {proposal.footnotes?.map((f, i) => <p key={i} className="text-muted text-xs mt-2">{f}</p>)}
            <div className="font-bold mt-6">COMPENSATION</div>
            {proposal.phases?.map((phase, i) => (<div key={i} className="mt-3"><div className="font-bold">{phase.name}:</div>{phase.description?.map((d, j) => <div key={j}>{d}</div>)}{phase.deliverables?.map((d, j) => <div key={j} className="ml-4">• {d}</div>)}<div className="font-bold mt-1">{phase.feeLabel} {"·".repeat(40)} {phase.feeAmount}</div></div>))}
            <div className="font-bold text-base mt-4">Total Fee {"·".repeat(50)} {proposal.totalFee}</div>
            <div className="font-bold mt-6">EXCLUSIONS</div>
            {proposal.exclusions?.map((e, i) => <div key={i} className="ml-4">{i + 1}. {e}</div>)}
            <div className="text-xs text-muted mt-8 pt-4 border-t border-hair">Additional Services, Termination, Signature Blocks, Fee Chart, and Terms and Conditions are included in the downloaded document.</div>
          </div>
        </Panel>
      )}
    </div>
  );
}

export function generateAgentText(p) {
  let t = '';
  t += `PROPOSAL\n${p.projectName}\n${p.location}\n\n`;
  t += `To:\t${p.clientContact || '[TBD]'}\n\t${p.clientName}\n\t${p.clientAddress || '[Address]'}\n\n`;
  t += `From:\t${partnerName(p.partner)}\n\tHDLA\n\t507 Main Street\n\tNashville, TN 37206\n\n`;
  t += `Date:\t${p.date || '[DATE]'}\n\nRE:\t${p.reLine || 'Proposal for Landscape Architecture Services'}\n\n`;
  t += `${p.openingParagraph}\n\n${p.projectUnderstanding}\n\n`;
  t += `SCOPE OF WORK\n\n${p.scopeIntro}\n\n`;
  if (p.exteriorSpaces?.length) { t += `1. Landscape and Hardscape for the following exterior spaces:\n`; p.exteriorSpaces.forEach((s, i) => { t += `   ${String.fromCharCode(97 + i)}. ${s}\n`; }); t += `\n`; }
  if (p.hardscapeItems?.length) { t += `   Hardscape Design includes:\n\n`; const numerals = ['i','ii','iii','iv','v','vi','vii','viii','ix','x','xi','xii']; p.hardscapeItems.forEach((h, i) => { t += `      ${numerals[i] || i+1}. ${h}\n\n`; }); }
  p.footnotes?.forEach(f => { t += `${f}\n\n`; });
  p.additionalScopeItems?.forEach((s, i) => { t += `${i + 2}. ${s}\n\n`; });
  if (p.adaLanguage) t += `${p.adaLanguage}\n\n`;
  t += `COMPENSATION\n\n${p.compensationIntro}\n\n`;
  p.phases?.forEach(phase => { t += `${phase.name}:\n`; phase.description?.forEach(d => { t += `${d}\n`; }); phase.deliverables?.forEach(d => { t += `   • ${d}\n`; }); t += `${phase.feeLabel} ...... ${phase.feeAmount}\n\n`; });
  t += `Total Fee ...... ${p.totalFee}\n\n`;
  t += `Above fees represent HDLA ${p.feeYear || '2026'} Hourly Rates.\n\n`;
  if (p.holdClause) t += `HDLA reserves the right to provide an updated proposal should the project go on hold for greater than twelve (12) months.\n\n`;
  t += `EXCLUSIONS\n\n`; p.exclusions?.forEach((e, i) => { t += `${i + 1}. ${e}\n`; });
  t += `\nADDITIONAL SERVICES\n\n`; p.additionalServices?.forEach((s, i) => { t += `${i + 1}. ${s}\n`; });
  return t;
}
