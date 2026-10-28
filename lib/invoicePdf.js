// lib/invoicePdf.js — server-only. Renders an HDLA invoice to a PDF buffer.
// Layout mirrors the Excel invoices: logo, bill-to, project header, 7-column table,
// optional hourly / reimbursable sections, TOTAL DUE, signer, remit line.
import React from 'react';
import { Document, Page, Text, View, Image, Font, StyleSheet, renderToBuffer } from '@react-pdf/renderer';

let fontsRegistered = false;
export function registerFonts(origin) {
  if (fontsRegistered) return;
  Font.register({ family: 'Lato', fonts: [
    { src: `${origin}/fonts/Lato-Regular.ttf` },
    { src: `${origin}/fonts/Lato-Bold.ttf`, fontWeight: 700 },
    { src: `${origin}/fonts/Lato-Light.ttf`, fontWeight: 300 },
    { src: `${origin}/fonts/Lato-Italic.ttf`, fontStyle: 'italic' },
    { src: `${origin}/fonts/Lato-BoldItalic.ttf`, fontWeight: 700, fontStyle: 'italic' },
  ]});
  Font.registerHyphenationCallback(w => [w]);
  fontsRegistered = true;
}

const ink = '#111111';
const grey = '#6b6b6b';
const band = '#e5e5e5';

const s = StyleSheet.create({
  page: { fontFamily: 'Lato', fontSize: 9, color: ink, paddingTop: 54, paddingBottom: 90, paddingHorizontal: 54 },
  logo: { width: 118, marginBottom: 42 },
  topRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 26 },
  billTo: { fontSize: 9.5, lineHeight: 1.45, maxWidth: 330 },
  meta: { width: 170 },
  metaRow: { flexDirection: 'row', marginBottom: 2 },
  metaLabel: { width: 78, fontSize: 9.5 },
  metaVal: { fontSize: 9.5 },
  hdr: { marginBottom: 22 },
  hdrRow: { flexDirection: 'row', marginBottom: 2.5 },
  hdrLabel: { width: 190, fontSize: 9.5 },
  hdrVal: { fontSize: 9.5, flex: 1 },
  table: { marginBottom: 6 },
  thead: { flexDirection: 'row', backgroundColor: band, alignItems: 'flex-end', paddingTop: 5, paddingBottom: 3, borderBottomWidth: 1.5, borderBottomColor: ink },
  th: { fontSize: 8.5, fontWeight: 700, paddingHorizontal: 3 },
  tr: { flexDirection: 'row', paddingVertical: 3, alignItems: 'center' },
  td: { fontSize: 8.5, color: grey, fontWeight: 300 },
  tdInk: { fontSize: 8.5, color: ink },
  tfoot: { flexDirection: 'row', paddingVertical: 4, borderTopWidth: 1.5, borderTopColor: ink, marginTop: 2 },
  tf: { fontSize: 9, fontWeight: 700 },
  sectionTitle: { fontSize: 9.5, fontWeight: 700, marginTop: 14, marginBottom: 4 },
  subHead: { flexDirection: 'row', backgroundColor: band, paddingVertical: 3, borderBottomWidth: 1.5, borderBottomColor: ink, marginTop: 16 },
  totalDue: { flexDirection: 'row', justifyContent: 'flex-end', marginTop: 34 },
  totalLabel: { fontSize: 9.5, fontWeight: 700, marginRight: 24 },
  totalVal: { fontSize: 9.5, fontWeight: 700, width: 110, textAlign: 'right' },
  closing: { marginTop: 34, fontSize: 9.5 },
  signer: { marginTop: 30, fontSize: 9.5 },
  remit: { position: 'absolute', bottom: 60, left: 54, fontSize: 9, fontStyle: 'italic' },
});

// Column widths (points) for the phase table: label + 6 numeric columns
const W = { label: 160, amt: 64, pct: 42, earned: 64, prev: 64, thisInv: 64, rem: 64 };
const money = n => (n == null || isNaN(n)) ? '' : (Math.abs(n) < 0.005 ? '-' : Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const pct = n => (n == null || isNaN(n)) ? '' : `${Math.round(Number(n))}%`;   // nearest whole number; amounts are still computed from the exact percentage
const dateUS = iso => { if (!iso) return ''; const [y, m, d] = String(iso).split('-'); return `${Number(m)}/${Number(d)}/${y}`; };

function Money({ v, w, ink: inkCol, bold }) {
  return (
    <View style={{ width: w, flexDirection: 'row', justifyContent: 'space-between', paddingRight: 4 }}>
      <Text style={[bold ? s.tf : inkCol ? s.tdInk : s.td]}>$</Text>
      <Text style={[bold ? s.tf : inkCol ? s.tdInk : s.td, { textAlign: 'right' }]}>{money(v)}</Text>
    </View>
  );
}

function PhaseTable({ lines, totals, hourly }) {
  return (
    <View style={s.table}>
      <View style={s.thead}>
        <Text style={[s.th, { width: W.label, paddingLeft: 2 }]}>Billing Phase:</Text>
        <Text style={[s.th, { width: W.amt, textAlign: 'center' }]}>Contract Amount</Text>
        <Text style={[s.th, { width: W.pct, textAlign: 'center' }]}>% Work to Date</Text>
        <Text style={[s.th, { width: W.earned, textAlign: 'center' }]}>Amount Earned</Text>
        <Text style={[s.th, { width: W.prev, textAlign: 'center' }]}>Previous Billing</Text>
        <Text style={[s.th, { width: W.thisInv, textAlign: 'center' }]}>This Invoice Billing</Text>
        <Text style={[s.th, { width: W.rem, textAlign: 'center' }]}>Balance Remaining</Text>
      </View>
      {lines.map((l, i) => {
        if (l.kind === 'header') return <View key={i} style={s.tr}><Text style={[s.tdInk, { width: W.label, paddingLeft: 2, fontWeight: 700 }]}>{l.description}</Text></View>;
        if (l.tbd) return (
          <View key={i} style={s.tr}>
            <Text style={[s.td, { width: W.label, paddingLeft: 2 }]}>{l.description}</Text>
            <Text style={[s.td, { width: W.amt, textAlign: 'center' }]}>TBD</Text>
          </View>
        );
        const isHourly = l.kind === 'hourly';
        return (
          <View key={i} style={s.tr}>
            <Text style={[s.td, { width: W.label, paddingLeft: 2 }]}>{l.description}</Text>
            {isHourly ? <Text style={[s.td, { width: W.amt, textAlign: 'center' }]}>HOURLY</Text> : <Money v={l.contract_amount} w={W.amt} />}
            <Text style={[s.td, { width: W.pct, textAlign: 'center' }]}>{isHourly ? '' : pct(l.pct)}</Text>
            <Money v={l.earned} w={W.earned} />
            <Money v={l.previous} w={W.prev} />
            <Money v={l.this_invoice} w={W.thisInv} />
            {isHourly ? <Text style={{ width: W.rem }} /> : <Money v={l.remaining} w={W.rem} />}
          </View>
        );
      })}
      <View style={s.tfoot}>
        <Text style={[s.tf, { width: W.label, paddingLeft: 2 }]}>{hourly ? 'SUB-TOTAL FEE' : ''}</Text>
        <Money v={totals.contract} w={W.amt} bold />
        <Text style={{ width: W.pct }} />
        <Money v={totals.earned} w={W.earned} bold />
        <Money v={totals.previous} w={W.prev} bold />
        <Money v={totals.this_invoice} w={W.thisInv} bold />
        <Money v={totals.remaining} w={W.rem} bold />
      </View>
    </View>
  );
}

function ConsultantTable({ lines }) {
  const sum = k => lines.reduce((a, l) => a + (Number(l[k]) || 0), 0);
  return (
    <View style={s.table}>
      <View style={[s.subHead, { marginTop: 12 }]}>
        <Text style={[s.th, { width: W.label, paddingLeft: 2 }]}>Consultants</Text>
        <Text style={[s.th, { width: W.amt, textAlign: 'center' }]}>Contract Amount</Text>
        <Text style={[s.th, { width: W.pct, textAlign: 'center' }]}>% to Date</Text>
        <Text style={[s.th, { width: W.earned, textAlign: 'center' }]}>Amount Earned</Text>
        <Text style={[s.th, { width: W.prev, textAlign: 'center' }]}>Previous Billing</Text>
        <Text style={[s.th, { width: W.thisInv, textAlign: 'center' }]}>This Invoice Billing</Text>
        <Text style={[s.th, { width: W.rem, textAlign: 'center' }]}>Balance Remaining</Text>
      </View>
      {lines.map((l, i) => (
        <View key={i} style={s.tr}>
          <Text style={[s.td, { width: W.label, paddingLeft: 2 }]}>{l.description}</Text>
          <Money v={l.contract_amount} w={W.amt} />
          <Text style={[s.td, { width: W.pct, textAlign: 'center' }]}>{pct(l.pct)}</Text>
          <Money v={l.earned} w={W.earned} />
          <Money v={l.previous} w={W.prev} />
          <Money v={l.this_invoice} w={W.thisInv} />
          <Money v={l.remaining} w={W.rem} />
        </View>
      ))}
      <View style={s.tfoot}>
        <Text style={[s.tf, { width: W.label, paddingLeft: 2 }]}>SUB-TOTAL CONSULTANTS</Text>
        <Money v={sum('contract_amount')} w={W.amt} bold />
        <Text style={{ width: W.pct }} />
        <Money v={sum('earned')} w={W.earned} bold />
        <Money v={sum('previous')} w={W.prev} bold />
        <Money v={sum('this_invoice')} w={W.thisInv} bold />
        <Money v={sum('remaining')} w={W.rem} bold />
      </View>
    </View>
  );
}

function HourlyTable({ rows }) {
  const total = rows.reduce((a, r) => a + (Number(r.hours) || 0) * (Number(r.rate) || 0), 0);
  return (
    <View style={{ width: 400, marginBottom: 6 }}>
      <View style={s.subHead}>
        <Text style={[s.th, { width: 180, paddingLeft: 2 }]}>HDLA Hourly Breakdown</Text>
        <Text style={[s.th, { width: 60, textAlign: 'center' }]}>Hours</Text>
        <Text style={[s.th, { width: 70, textAlign: 'center' }]}>Rate</Text>
        <Text style={[s.th, { width: 90, textAlign: 'center' }]}>Total</Text>
      </View>
      {rows.map((r, i) => (
        <View key={i} style={s.tr}>
          <Text style={[s.td, { width: 180, paddingLeft: 2 }]}>{r.name}</Text>
          <Text style={[s.td, { width: 60, textAlign: 'center' }]}>{Number(r.hours || 0).toFixed(2)}</Text>
          <Money v={r.rate} w={70} />
          <Money v={(Number(r.hours) || 0) * (Number(r.rate) || 0)} w={90} />
        </View>
      ))}
      <View style={s.tfoot}>
        <Text style={[s.tf, { width: 310, paddingLeft: 2 }]}>SUB-TOTAL FEE</Text>
        <Money v={total} w={90} bold />
      </View>
    </View>
  );
}

function ExpenseTable({ title, rows, showQty }) {
  const total = rows.reduce((a, r) => a + (Number(r.this_invoice) || 0), 0);
  return (
    <View style={{ width: showQty ? 400 : 240, marginBottom: 6 }}>
      <View style={s.subHead}>
        <Text style={[s.th, { width: 180, paddingLeft: 2 }]}>{title}</Text>
        {showQty && <><Text style={[s.th, { width: 50, textAlign: 'center' }]}>Qty</Text><Text style={[s.th, { width: 50, textAlign: 'center' }]}>Unit</Text><Text style={[s.th, { width: 60, textAlign: 'center' }]}>Rate</Text></>}
        <Text style={[s.th, { width: 60, textAlign: 'center' }]}>Total</Text>
      </View>
      {rows.map((r, i) => (
        <View key={i} style={s.tr}>
          <Text style={[s.td, { width: 180, paddingLeft: 2 }]}>{r.description}</Text>
          {showQty && <><Text style={[s.td, { width: 50, textAlign: 'center' }]}>{r.qty || ''}</Text><Text style={[s.td, { width: 50, textAlign: 'center' }]}>{r.unit || ''}</Text><Text style={[s.td, { width: 60, textAlign: 'center' }]}>{r.rate != null ? money(r.rate) : ''}</Text></>}
          <Money v={r.this_invoice} w={60} />
        </View>
      ))}
      <View style={s.tfoot}>
        <Text style={[s.tf, { width: showQty ? 340 : 180, paddingLeft: 2 }]}>SUB-TOTAL {title.toUpperCase().includes('REIMB') ? 'REIMBURSABLES' : 'EXPENSES'}</Text>
        <Money v={total} w={60} bold />
      </View>
    </View>
  );
}

export function InvoiceDoc({ inv, logoUrl }) {
  const lines = inv.lines || [];
  const phaseLines = lines.filter(l => ['phase', 'hourly', 'consultant', 'header'].includes(l.kind));
  const consultantSection = lines.filter(l => l.kind === 'consultant_section');
  const hourlyDetail = lines.filter(l => l.kind === 'hourly').flatMap(l => l.hourly_detail || []);
  const reimb = lines.filter(l => l.kind === 'reimbursable');
  const expenses = lines.filter(l => l.kind === 'expense');
  const sum = k => phaseLines.filter(l => l.kind !== 'header' && !l.tbd).reduce((a, l) => a + (Number(l[k]) || 0), 0);
  const totals = { contract: sum('contract_amount'), earned: sum('earned'), previous: sum('previous'), this_invoice: sum('this_invoice'), remaining: sum('remaining') };
  const bt = inv.bill_to || {};
  const billToLines = [bt.attn, bt.title, bt.company, bt.address1, bt.address2, bt.city_state_zip].filter(Boolean);
  const refs = inv.reference_lines || inv.references || [];

  return (
    <Document title={`HDLA Invoice ${inv.invoice_number || 'DRAFT'}`} author="HDLA">
      <Page size="LETTER" style={s.page}>
        <Image src={logoUrl} style={s.logo} />
        <View style={s.topRow}>
          <View style={s.billTo}>{billToLines.map((t, i) => <Text key={i}>{t}</Text>)}</View>
          <View style={s.meta}>
            <View style={s.metaRow}><Text style={s.metaLabel}>Invoice Date:</Text><Text style={s.metaVal}>{dateUS(inv.invoice_date)}</Text></View>
            <View style={s.metaRow}><Text style={s.metaLabel}>Invoice #:</Text><Text style={s.metaVal}>{inv.invoice_number || 'DRAFT'}</Text></View>
          </View>
        </View>
        <View style={s.hdr}>
          <View style={s.hdrRow}><Text style={s.hdrLabel}>HDLA Project #:</Text><Text style={s.hdrVal}>{inv.project_num_display || inv.project_num}</Text></View>
          <View style={s.hdrRow}><Text style={s.hdrLabel}>HDLA {inv.principal_label || 'Principal'}:</Text><Text style={s.hdrVal}>{inv.principal_name || ''}</Text></View>
          <View style={s.hdrRow}><Text style={s.hdrLabel}>Project Description:</Text><Text style={s.hdrVal}>{inv.project_name}</Text></View>
          <View style={s.hdrRow}><Text style={s.hdrLabel}>Professional Fees for Services:</Text><Text style={s.hdrVal}>{dateUS(inv.services_through)}</Text></View>
          {refs.map((r, i) => <View key={i} style={s.hdrRow}><Text style={s.hdrLabel}>{r.label}</Text><Text style={s.hdrVal}>{r.value}</Text></View>)}
        </View>

        <PhaseTable lines={phaseLines} totals={totals} hourly={hourlyDetail.length > 0 || reimb.length > 0 || expenses.length > 0 || consultantSection.length > 0} />
        {consultantSection.length > 0 && <ConsultantTable lines={consultantSection} />}
        {hourlyDetail.length > 0 && <HourlyTable rows={hourlyDetail} />}
        {expenses.length > 0 && <ExpenseTable title="Expenses" rows={expenses} />}
        {reimb.length > 0 && <ExpenseTable title="Reimbursable Expense Detail" rows={reimb} showQty />}

        <View wrap={false}>
          <View style={s.totalDue}>
            <Text style={s.totalLabel}>TOTAL DUE THIS INVOICE:</Text>
            <View style={{ flexDirection: 'row', width: 110, justifyContent: 'space-between' }}><Text style={s.tf}>$</Text><Text style={s.tf}>{money(inv.total_due)}</Text></View>
          </View>
          <Text style={s.closing}>Thank you,</Text>
          <Text style={s.signer}>{inv.signer_text}</Text>
        </View>
        <Text style={s.remit} fixed>Please remit payments to: {inv.remit_to || '507 Main Street, Nashville, TN 37206'}</Text>
      </Page>
    </Document>
  );
}

export async function renderInvoicePdf(inv, { origin }) {
  registerFonts(origin);
  return renderToBuffer(<InvoiceDoc inv={inv} logoUrl={`${origin}/logo_hdla.png`} />);
}
