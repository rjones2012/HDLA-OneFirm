import { NextResponse } from 'next/server';
import { supabaseAdmin } from '../../../../lib/supabaseAdmin';
import { requireCaller, FINANCE } from '../../../../lib/apiAuth';
import { renderInvoicePdf } from '../../../../lib/invoicePdf';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const REMIT_TO = '507 Main Street, Nashville, TN 37206';

// GET /api/billing/pdf?id=<invoice uuid>&token=<access token>   (token in query so the PDF can open in a tab)
export async function GET(req) {
  try {
    const { searchParams, origin } = new URL(req.url);
    // The PDF opens in a new tab, so the browser cannot add a header; the page passes the session token as ?token= instead.
    // Either way it is verified the same way (supabaseAdmin.auth.getUser inside requireCaller) and must be a finance role.
    const token = searchParams.get('token');
    const authReq = { headers: { get: k => (k === 'authorization' && token ? `Bearer ${token}` : req.headers.get(k)) } };
    const { error: authError } = await requireCaller(authReq, FINANCE);
    if (authError) return authError;

    const id = searchParams.get('id');
    const [{ data: inv }, { data: lines }] = await Promise.all([
      supabaseAdmin.from('invoices').select('*').eq('id', id).single(),
      supabaseAdmin.from('invoice_lines').select('*').eq('invoice_id', id).order('sort_order'),
    ]);
    if (!inv) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const buf = await renderInvoicePdf({ ...inv, lines: lines || [], remit_to: REMIT_TO }, { origin });
    const name = `HDLA_Invoice_${inv.invoice_number || 'DRAFT'}_${inv.project_num}.pdf`;
    return new NextResponse(buf, { headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `${searchParams.get('download') ? 'attachment' : 'inline'}; filename="${name}"` } });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
