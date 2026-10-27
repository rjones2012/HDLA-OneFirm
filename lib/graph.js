// lib/graph.js — Microsoft Graph (SharePoint files + Outlook calendar). Server-only.
// One token cache, one drive lookup, used by masterdata, backup, migrations and calendar.
import 'server-only';

const TENANT_ID = process.env.AZURE_TENANT_ID;
const CLIENT_ID = process.env.AZURE_CLIENT_ID;
const CLIENT_SECRET = process.env.AZURE_CLIENT_SECRET;
const SHAREPOINT_HOST = process.env.SHAREPOINT_HOST || 'hodgsondouglas.sharepoint.com';
const SITE_PATH = '/sites/' + (process.env.SHAREPOINT_SITE || 'Sharepoint');
const FOLDER_PATH = '/' + (process.env.SHAREPOINT_FOLDER || 'HDLA Dashboard');

let tokenCache = { token: null, expires: 0 };
let driveCache = { id: null, expires: 0 };

function assertConfigured() {
  if (!TENANT_ID || !CLIENT_ID || !CLIENT_SECRET) throw new Error('Microsoft Graph is not configured (AZURE_TENANT_ID / AZURE_CLIENT_ID / AZURE_CLIENT_SECRET)');
}

export async function graphToken() {
  assertConfigured();
  if (tokenCache.token && Date.now() < tokenCache.expires) return tokenCache.token;
  const res = await fetch(`https://login.microsoftonline.com/${TENANT_ID}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'client_credentials', client_id: CLIENT_ID, client_secret: CLIENT_SECRET, scope: 'https://graph.microsoft.com/.default' }).toString(),
  });
  if (!res.ok) throw new Error(`Graph token error: ${res.status}`);
  const data = await res.json();
  tokenCache = { token: data.access_token, expires: Date.now() + Math.max(60, (data.expires_in || 3600) - 300) * 1000 };
  return tokenCache.token;
}

export async function graphFetch(path, init = {}) {
  const token = await graphToken();
  const url = path.startsWith('http') ? path : `https://graph.microsoft.com/v1.0${path}`;
  const res = await fetch(url, { ...init, headers: { Authorization: `Bearer ${token}`, ...(init.headers || {}) } });
  return res;
}

// The "Documents" drive of the HDLA SharePoint site
export async function getDrive() {
  if (driveCache.id && Date.now() < driveCache.expires) return driveCache.id;
  const siteRes = await graphFetch(`/sites/${SHAREPOINT_HOST}:${SITE_PATH}`);
  if (!siteRes.ok) throw new Error(`SharePoint site lookup failed: ${siteRes.status}`);
  const site = await siteRes.json();
  const drivesRes = await graphFetch(`/sites/${site.id}/drives`);
  if (!drivesRes.ok) throw new Error(`SharePoint drives lookup failed: ${drivesRes.status}`);
  const drives = (await drivesRes.json()).value || [];
  const drive = drives.find(d => d.name === 'Documents') || drives[0];
  if (!drive) throw new Error('No SharePoint drive found');
  driveCache = { id: drive.id, expires: Date.now() + 6 * 3600 * 1000 };
  return drive.id;
}

// Download a file from the dashboard folder as an ArrayBuffer
export async function downloadFile(fileName) {
  const driveId = await getDrive();
  const path = encodeURI(`${FOLDER_PATH}/${fileName}`);
  const res = await graphFetch(`/drives/${driveId}/root:${path}:/content`);
  if (!res.ok) throw new Error(`Download failed for ${fileName}: ${res.status}`);
  return await res.arrayBuffer();
}

export async function downloadJson(fileName) {
  const buf = await downloadFile(fileName);
  return JSON.parse(Buffer.from(buf).toString('utf8'));
}

// Upload (create or replace) a file in the dashboard folder
export async function uploadFile(fileName, content, contentType = 'application/octet-stream') {
  const driveId = await getDrive();
  const path = encodeURI(`${FOLDER_PATH}/${fileName}`);
  const res = await graphFetch(`/drives/${driveId}/root:${path}:/content`, { method: 'PUT', headers: { 'Content-Type': contentType }, body: content });
  if (!res.ok) throw new Error(`Upload failed for ${fileName}: ${res.status}`);
  return await res.json();
}

export const SHAREPOINT = { host: SHAREPOINT_HOST, site: SITE_PATH, folder: FOLDER_PATH };
