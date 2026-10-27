// lib/quickbooks.js — QuickBooks Online, read-only. Server-only.
// QuickBooks is the firm's source of truth for money. OneFirm pulls three reports nightly
// (P&L by month, A/R aging detail, A/P aging detail), stores them in Supabase, and never writes back.
import 'server-only';
import crypto from 'crypto';
import { supabaseAdmin } from './supabaseAdmin';
import { loadMasterData, projectNumFrom, indexByProject } from './masterdata';
import { parseProfitAndLoss, parseAgedDetail } from './quickbooksParse';

const CLIENT_ID = process.env.QBO_CLIENT_ID;
const CLIENT_SECRET = process.env.QBO_CLIENT_SECRET;
const REDIRECT_URI = process.env.QBO_REDIRECT_URI;
const ENV = (process.env.QBO_ENV || 'sandbox').toLowerCase();
const TOKEN_SECRET = process.env.QBO_TOKEN_SECRET;
const MINOR = 73;

export const QBO_BASE = ENV === 'production' ? 'https://quickbooks.api.intuit.com' : 'https://sandbox-quickbooks.api.intuit.com';
const AUTH_URL = 'https://appcenter.intuit.com/connect/oauth2';
const TOKEN_URL = 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer';
const REVOKE_URL = 'https://developer.api.intuit.com/v2/oauth2/tokens/revoke';
export const SCOPE = 'com.intuit.quickbooks.accounting';

export function qboConfigured() { return !!(CLIENT_ID && CLIENT_SECRET && REDIRECT_URI && TOKEN_SECRET); }
export function qboEnv() { return ENV; }

// ── token encryption at rest (AES-256-GCM) ──
function key() {
  if (!TOKEN_SECRET) throw new Error('QBO_TOKEN_SECRET is not set');
  return crypto.createHash('sha256').update(TOKEN_SECRET).digest();
}
export function encrypt(text) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const enc = Buffer.concat([cipher.update(String(text), 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), enc]).toString('base64');
}
export function decrypt(b64) {
  const buf = Buffer.from(b64, 'base64');
  const iv = buf.subarray(0, 12), tag = buf.subarray(12, 28), enc = buf.subarray(28);
  const d = crypto.createDecipheriv('aes-256-gcm', key(), iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(enc), d.final()]).toString('utf8');
}

// ── OAuth state: signed so the callback can trust who started the connection ──
export function signState(initials) {
  const payload = `${initials}|${Date.now()}|${crypto.randomBytes(8).toString('hex')}`;
  const sig = crypto.createHmac('sha256', process.env.QBO_TOKEN_SECRET || '').update(payload).digest('hex').slice(0, 24);
  return Buffer.from(`${payload}|${sig}`).toString('base64url');
}
export function verifyState(state) {
  try {
    const raw = Buffer.from(String(state || ''), 'base64url').toString('utf8');
    const parts = raw.split('|'); if (parts.length !== 4) return null;
    const [initials, ts, nonce, sig] = parts;
    const expect = crypto.createHmac('sha256', process.env.QBO_TOKEN_SECRET || '').update(`${initials}|${ts}|${nonce}`).digest('hex').slice(0, 24);
    if (sig !== expect) return null;
    if (Date.now() - Number(ts) > 15 * 60 * 1000) return null;
    return { initials };
  } catch { return null; }
}


// ── OAuth ──
export function authorizeUrl(state) {
  const p = new URLSearchParams({ client_id: CLIENT_ID, response_type: 'code', scope: SCOPE, redirect_uri: REDIRECT_URI, state });
  return `${AUTH_URL}?${p.toString()}`;
}
function basicAuth() { return 'Basic ' + Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64'); }

async function tokenRequest(params) {
  const res = await fetch(TOKEN_URL, { method: 'POST', headers: { Authorization: basicAuth(), Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(params).toString() });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`QuickBooks token error ${res.status}: ${data.error_description || data.error || 'unknown'}`);
  return data;
}

export async function exchangeCode(code, realmId, connectedBy) {
  const t = await tokenRequest({ grant_type: 'authorization_code', code, redirect_uri: REDIRECT_URI });
  const now = Date.now();
  let companyName = '';
  try { const info = await apiGetWithToken(realmId, t.access_token, `/v3/company/${realmId}/companyinfo/${realmId}`); companyName = info?.CompanyInfo?.CompanyName || ''; } catch (e) { /* name is cosmetic */ }
  const row = {
    realm_id: String(realmId), company_name: companyName, environment: ENV,
    access_token_enc: encrypt(t.access_token), refresh_token_enc: encrypt(t.refresh_token),
    access_expires_at: new Date(now + (t.expires_in || 3600) * 1000).toISOString(),
    refresh_expires_at: new Date(now + (t.x_refresh_token_expires_in || 100 * 86400) * 1000).toISOString(),
    connected_by: connectedBy || '', connected_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  };
  const { error } = await supabaseAdmin.from('qbo_connections').upsert(row, { onConflict: 'realm_id' });
  if (error) throw error;
  return { realmId: String(realmId), companyName };
}

async function refresh(conn) {
  const t = await tokenRequest({ grant_type: 'refresh_token', refresh_token: decrypt(conn.refresh_token_enc) });
  const now = Date.now();
  const patch = {
    access_token_enc: encrypt(t.access_token), refresh_token_enc: encrypt(t.refresh_token),
    access_expires_at: new Date(now + (t.expires_in || 3600) * 1000).toISOString(),
    refresh_expires_at: new Date(now + (t.x_refresh_token_expires_in || 100 * 86400) * 1000).toISOString(),
    updated_at: new Date().toISOString(),
  };
  await supabaseAdmin.from('qbo_connections').update(patch).eq('realm_id', conn.realm_id);
  return { ...conn, ...patch };
}

export async function listConnections() {
  const { data } = await supabaseAdmin.from('qbo_connections').select('realm_id, company_name, environment, connected_by, connected_at, last_sync_at, last_sync_status, refresh_expires_at').order('connected_at');
  return data || [];
}

async function getConnection(realmId) {
  const { data, error } = await supabaseAdmin.from('qbo_connections').select('*').eq('realm_id', realmId).single();
  if (error || !data) throw new Error('QuickBooks is not connected');
  return data;
}

async function accessToken(conn) {
  const exp = conn.access_expires_at ? new Date(conn.access_expires_at).getTime() : 0;
  if (exp - Date.now() < 120 * 1000) conn = await refresh(conn);
  return { token: decrypt(conn.access_token_enc), conn };
}

export async function disconnect(realmId) {
  try { const conn = await getConnection(realmId); await fetch(REVOKE_URL, { method: 'POST', headers: { Authorization: basicAuth(), 'Content-Type': 'application/json' }, body: JSON.stringify({ token: decrypt(conn.refresh_token_enc) }) }); } catch (e) { /* best effort */ }
  await supabaseAdmin.from('qbo_connections').delete().eq('realm_id', realmId);
}

// ── API ──
async function apiGetWithToken(realmId, token, path, params) {
  const url = new URL(QBO_BASE + path);
  url.searchParams.set('minorversion', String(MINOR));
  Object.entries(params || {}).forEach(([k, v]) => { if (v != null && v !== '') url.searchParams.set(k, String(v)); });
  const res = await fetch(url.toString(), { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } });
  if (!res.ok) { const txt = await res.text().catch(() => ''); throw new Error(`QuickBooks ${res.status} on ${path}: ${txt.slice(0, 300)}`); }
  return res.json();
}
export async function apiGet(realmId, path, params) {
  let conn = await getConnection(realmId);
  const { token } = await accessToken(conn);
  return apiGetWithToken(realmId, token, path, params);
}
export async function report(realmId, name, params) { return apiGet(realmId, `/v3/company/${realmId}/reports/${name}`, params); }

function daysPast(due) { if (!due) return 0; const d = new Date(due); if (isNaN(d)) return 0; return Math.max(0, Math.floor((Date.now() - d.getTime()) / 86400000)); }
const ymd = d => d.toISOString().slice(0, 10);

// ── The nightly sync ──
export async function syncConnection(realmId, { months = 18 } = {}) {
  const started = new Date();
  const detail = [];
  try {
    const end = new Date(); const start = new Date(end.getFullYear(), end.getMonth() - (months - 1), 1);
    // 1. P&L by month (accrual, the way the firm reads it; cash available via param later)
    const pl = await report(realmId, 'ProfitAndLoss', { start_date: ymd(start), end_date: ymd(end), summarize_column_by: 'Month', accounting_method: 'Accrual' });
    const rows = parseProfitAndLoss(pl);
    const plRows = rows.map(r => ({ id: `qbo:${realmId}:${r.month}:${r.kind}:${r.category}:${r.subcategory}`.slice(0, 400), realm_id: String(realmId), month: r.month, kind: r.kind, category: r.category, subcategory: r.subcategory, amount: r.amount, class: '', source: 'qbo', pulled_at: started.toISOString() }));
    await supabaseAdmin.from('monthly_financials').delete().eq('realm_id', String(realmId)).eq('source', 'qbo').gte('month', ymd(start).slice(0, 7));
    for (let i = 0; i < plRows.length; i += 500) { const { error } = await supabaseAdmin.from('monthly_financials').upsert(plRows.slice(i, i + 500), { onConflict: 'id' }); if (error) throw error; }
    detail.push(`P&L ${plRows.length} rows`);

    // 2. A/R aging detail → ar_invoices (replace this realm's rows)
    const md = await loadMasterData().catch(() => ({ data: [] }));
    const byProject = indexByProject(md.data);
    const ar = parseAgedDetail(await report(realmId, 'AgedReceivableDetail', { report_date: ymd(end) }));
    const arRows = ar.filter(r => r.balance > 0).map(r => {
      const project_num = projectNumFrom(r.name) || projectNumFrom(r.num);
      const m = byProject[project_num] || {};
      return { id: `${realmId}:${r.qboId || r.num || r.name + r.date}`, realm_id: String(realmId), qbo_id: r.qboId || '', doc_number: r.num, customer: r.name, project_num, partner: m.partner || '', txn_date: r.date, due_date: r.dueDate, amount: r.amount, balance: r.balance, days_past_due: daysPast(r.dueDate), source: 'qbo', pulled_at: started.toISOString() };
    });
    await supabaseAdmin.from('ar_invoices').delete().eq('realm_id', String(realmId)).eq('source', 'qbo');
    if (arRows.length) { const { error } = await supabaseAdmin.from('ar_invoices').upsert(arRows, { onConflict: 'id' }); if (error) throw error; }
    detail.push(`A/R ${arRows.length} open invoices`);

    // 3. A/P aging detail → ap_bills
    const ap = parseAgedDetail(await report(realmId, 'AgedPayableDetail', { report_date: ymd(end) }));
    const apRows = ap.filter(r => r.balance > 0).map(r => ({ id: `${realmId}:${r.qboId || r.num || r.name + r.date}`, realm_id: String(realmId), qbo_id: r.qboId || '', doc_number: r.num, vendor: r.name, project_num: projectNumFrom(r.num) || '', txn_date: r.date, due_date: r.dueDate, amount: r.amount, balance: r.balance, days_past_due: daysPast(r.dueDate), source: 'qbo', pulled_at: started.toISOString() }));
    await supabaseAdmin.from('ap_bills').delete().eq('realm_id', String(realmId)).eq('source', 'qbo');
    if (apRows.length) { const { error } = await supabaseAdmin.from('ap_bills').upsert(apRows, { onConflict: 'id' }); if (error) throw error; }
    detail.push(`A/P ${apRows.length} open bills`);

    await supabaseAdmin.from('qbo_connections').update({ last_sync_at: new Date().toISOString(), last_sync_status: 'ok' }).eq('realm_id', String(realmId));
    return { ok: true, detail: detail.join(' · ') };
  } catch (e) {
    await supabaseAdmin.from('qbo_connections').update({ last_sync_at: new Date().toISOString(), last_sync_status: 'error: ' + (e.message || e) }).eq('realm_id', String(realmId));
    return { ok: false, detail: (detail.join(' · ') + ' · ' + (e.message || e)).trim() };
  }
}

export async function syncAll() {
  const conns = await listConnections();
  const results = [];
  for (const c of conns) results.push({ realmId: c.realm_id, company: c.company_name, ...(await syncConnection(c.realm_id)) });
  return results;
}

// ── Aging rollup used by Exec and the role homes ──
export function bucket(days) { return days <= 0 ? 'current' : days <= 30 ? 'd1' : days <= 60 ? 'd31' : days <= 90 ? 'd61' : 'd90'; }
export async function agingByPartner({ partner } = {}) {
  let q = supabaseAdmin.from('ar_invoices').select('*').gt('balance', 0);
  if (partner) q = q.eq('partner', partner);
  const { data } = await q;
  const rows = data || [];
  const by = {};
  let pulledAt = null;
  for (const r of rows) {
    const k = r.partner || '—';
    by[k] = by[k] || { partner: k, current: 0, d1: 0, d31: 0, d61: 0, d90: 0, total: 0, count: 0 };
    by[k][bucket(r.days_past_due)] += Number(r.balance) || 0;
    by[k].total += Number(r.balance) || 0; by[k].count += 1;
    if (!pulledAt || r.pulled_at > pulledAt) pulledAt = r.pulled_at;
  }
  const out = Object.values(by).sort((a, b) => b.total - a.total);
  const firm = out.reduce((a, r) => ({ partner: 'Firm', current: a.current + r.current, d1: a.d1 + r.d1, d31: a.d31 + r.d31, d61: a.d61 + r.d61, d90: a.d90 + r.d90, total: a.total + r.total, count: a.count + r.count }), { partner: 'Firm', current: 0, d1: 0, d31: 0, d61: 0, d90: 0, total: 0, count: 0 });
  return { pulledAt, rows: out, firm, invoices: rows };
}
