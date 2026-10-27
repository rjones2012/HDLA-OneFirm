// lib/phaseNames.js — spelled-out phase names for invoice lines.
// Keys are the phase codes exactly as they appear in the Master Data "Phase" column (matched case-insensitively).
// Codes with no spelled-out name (LEED, BZA) and any code not listed here print as written.
// To add or fix a phase name, edit one line below.

export const PHASE_NAMES = {
  SD: 'Schematic Design',
  DD: 'Design Development',
  CD: 'Construction Documentation',
  MP: 'Master Planning',
  CO: 'Concept',
  CL: 'Close Out',
  BN: 'Bidding and Negotiation',
  AS: 'Add Service',
  CA: 'Construction Administration',
  SP: 'Specific Plan',
  // LEED and BZA intentionally have no spelled-out name; they print as the abbreviation.
};

// Phase text for an invoice line: the spelled-out name if the code is in the legend, otherwise the phase exactly as written.
export function phaseLabel(phase) {
  const raw = String(phase ?? '').trim();
  if (!raw) return '';
  return PHASE_NAMES[raw.toUpperCase()] || raw;
}
