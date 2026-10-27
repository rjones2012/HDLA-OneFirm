import { NextResponse } from 'next/server';
import { supabaseAdmin } from '../../../lib/supabaseAdmin';
import { requireCaller, LEADERSHIP } from '../../../lib/apiAuth';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

const BASE_SYSTEM_PROMPT = `You are the HDLA Proposal Agent. You generate complete proposal content for Hodgson Douglas Landscape Architects.

CRITICAL RULES:
- Output ONLY valid JSON. No markdown, no preamble, no explanation.
- Follow HDLA proposal structure exactly.
- Use the exact language patterns from HDLA's established proposals.
- Smart quotes: use curly quotes not straight quotes.
- Fee lines use exact dollar formatting: $XX,XXX.00

OUTPUT FORMAT — respond with a JSON object:
{
  "projectName": "string",
  "location": "string", 
  "clientName": "string",
  "clientContact": "string",
  "clientAddress": "string",
  "partner": "string",
  "date": "string",
  "reLine": "string",
  "openingParagraph": "string",
  "projectUnderstanding": "string",
  "scopeIntro": "string",
  "exteriorSpaces": ["string"],
  "hardscapeItems": ["string"],
  "footnotes": ["string"],
  "additionalScopeItems": ["string"],
  "adaLanguage": "string",
  "compensationIntro": "string",
  "phases": [
    {
      "name": "string",
      "description": ["string"],
      "deliverables": ["string"],
      "feeLabel": "Lump Sum Fee",
      "feeAmount": "$XX,XXX.00"
    }
  ],
  "totalFee": "$XXX,XXX.00",
  "feeYear": "2026",
  "mileageRate": ".725",
  "holdClause": true,
  "exclusions": ["string"],
  "additionalServices": ["string"],
  "clientCompanyName": "string"
}

SCOPE LANGUAGE RULES:
- If project has pool: include pool footnote "* HDLA will design the layout of the pool. The pool contractor will be responsible for all pool structural design, pool mechanical and plumbing systems, pool lighting, access steps, ADA access, pool marking and receiving approval from the Local Health Department. HDLA will design the pool coping and pool deck. Pool contractor is responsible for applying for and receiving all variances and permits."
- If project has shade structures: include shade structure footnote with HNTE $10,000 structural engineer clause and 800sf/2 structure limit.
- If amenity deck/rooftop: include full hardscape coordination items (Hardscape Finishes Plan, planters with structural connection note, lighting coordination, rails/fencing/gates with structural note, guardrails excluded, small walls <3 ft by HDLA / taller by structural, custom elements catch-all)
- If working under architect: coordination language references the architect firm by name
- Always include ADA language for design projects
- Opening always starts: "We are pleased to submit the following proposal for Landscape Architectural Services for the [Project Name] project in [Location]."
- Always include: "Please find our outlined scope of work and associated fees below. We have based this proposal on our experience with projects of similar scope and scale and the anticipated time it will take to complete the tasks."

PHASE DELIVERABLES (standard for SD through CA):
- Concept: Kickoff meeting, Conceptual Master Vision Plan with color plans and precedent images
- SD: Biweekly virtual coordination meetings, Hardscape Plans and Material Callouts, Preliminary Planting Plan, Design/Build Irrigation Extents Plans, Suitable for Preliminary Pricing
- DD: Revised Design based on updated budget, Hardscape Plans with Material Legend, Layout Plans, Grading/drainage coordination, Hardscape Details, Planting Plans/Schedule/Details, Irrigation, Draft Specifications
- CD: Same as DD with "Final" prefix on all items, Final Specifications
- BP: Coordination with Client and Architect for Bidding Review and answering RFIs
- CA: Shop Drawing submittal review, Planting material review, X site visits with field observation notes, Site inspection with initial punch list, Final site inspection with final punch list, Project Close-out

EXCLUSIONS (typical for urban/amenity deck):
1. Lighting design, 2. Guardrail detailing, 3. Structural Engineering, 4. Final pool detailing (if pool), 5. Final irrigation design (if design/build), 6. Wind Uplift Study

ADDITIONAL SERVICES (standard):
1. Artist renderings, 2. Marketing materials, 3-4. Revisions after CD completion or inconsistent with approvals, 5. Vandalism replacement consultation, 6. Contractor default services, 7. Field tagging plants, 8. Additional CA site visits`;

async function getCorrections() {
  try {
    const { data } = await supabaseAdmin
      .from('proposal_corrections')
      .select('correction')
      .eq('active', true)
      .order('created_at', { ascending: true });
    return (data || []).map(r => r.correction);
  } catch (e) {
    return [];
  }
}

async function logProposal(input_mode, raw_input, form_data, proposal) {
  try {
    await supabaseAdmin.from('proposal_history').insert({
      project_name: proposal?.projectName || '',
      client_name: proposal?.clientName || '',
      fee: proposal?.totalFee || '',
      input_mode,
      raw_input: raw_input || null,
      form_data: form_data || null,
      generated_proposal: proposal
    });
  } catch (e) {
    console.error('Failed to log proposal:', e);
  }
}

export async function POST(req) {
  const { error: authError } = await requireCaller(req, LEADERSHIP);
  if (authError) return authError;
  try {
    const body = await req.json();
    const { formData, rawInput, action } = body;

    // ─── Handle correction submissions ───
    if (action === 'add_correction') {
      const { correction, proposalContext } = body;
      const { error } = await supabaseAdmin.from('proposal_corrections').insert({
        correction,
        proposal_context: proposalContext || null,
        source: 'CM'
      });
      if (error) throw error;
      return NextResponse.json({ success: true });
    }

    // ─── Handle fetching corrections ───
    if (action === 'get_corrections') {
      const corrections = await getCorrections();
      return NextResponse.json({ corrections });
    }

    // ─── Handle removing a correction ───
    if (action === 'remove_correction') {
      const { correctionId } = body;
      await supabaseAdmin.from('proposal_corrections').update({ active: false }).eq('id', correctionId);
      return NextResponse.json({ success: true });
    }

    // ─── Generate proposal ───
    const corrections = await getCorrections();
    
    let systemPrompt = BASE_SYSTEM_PROMPT;
    if (corrections.length > 0) {
      systemPrompt += '\n\n=== HDLA-SPECIFIC CORRECTIONS (ALWAYS FOLLOW THESE) ===\n';
      corrections.forEach((c, i) => {
        systemPrompt += `${i + 1}. ${c}\n`;
      });
    }

    let userMessage = '';
    if (rawInput && rawInput.trim()) {
      userMessage = `Generate a complete HDLA proposal from this partner communication. Extract all project details and fill in reasonable assumptions for anything not specified. Flag assumptions in the clientContact field as "[TBD - verify]".

PARTNER MESSAGE:
${rawInput}

${formData && Object.values(formData).some(v => v) ? `\nADDITIONAL FORM DATA:\n${JSON.stringify(formData, null, 2)}` : ''}`;
    } else {
      userMessage = `Generate a complete HDLA proposal from these details:\n${JSON.stringify(formData, null, 2)}`;
    }

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 8000,
        system: systemPrompt,
        messages: [{ role: 'user', content: userMessage }],
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      return NextResponse.json({ error: `Claude API error: ${err}` }, { status: 500 });
    }

    const data = await response.json();
    const text = data.content?.[0]?.text || '';
    const clean = text.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
    const proposal = JSON.parse(clean);

    await logProposal(rawInput ? 'paste' : 'form', rawInput || null, formData || null, proposal);

    return NextResponse.json({ proposal, correctionsApplied: corrections.length });
  } catch (err) {
    console.error('Proposal generation error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
