/* Signing in with Google and keeping files in the person's Google Drive.
   Sign-in runs on the server (netlify/functions/google.mts), which keeps the long-lived Google
   session in an HttpOnly cookie and hands this page short-lived access tokens. With those, the page
   talks to the Drive API directly.

   In Drive, each Linework file is a JSON file "<title>.linework.json" in a "Linework" folder, and the
   folder list lives in "Linework settings.json" beside them. The drive.file scope only reaches files
   Linework made, so nothing else in the Drive is visible to it. appProperties tag what's what:
   {linework: 'root' | 'file' | 'settings', lineworkId: <file id>}. */

const FLAG = 'linework:google'; // while signed in with Google: the user as JSON ('1' until known), so startup knows to check
const API = 'https://www.googleapis.com/drive/v3/files', UPLOAD = 'https://www.googleapis.com/upload/drive/v3/files';

let cfgP = null;
// Whether Google sign-in is set up on this site. Off Netlify the URL answers with the app's HTML.
export function googleEnabled() {
  if (!cfgP) cfgP = fetch('/api/google/config', { cache: 'no-store' })
    .then(r => (r.ok ? r.json() : null)).then(j => !!(j && j.enabled === true)).catch(() => false);
  return cfgP;
}

export function signInWithGoogle() {
  try { localStorage.setItem(FLAG, '1'); } catch (e) {}
  location.assign('/api/google/start');
}

// What the server said when sending the browser back from Google (?google=…), removed from the URL.
export function googleReturn() {
  const q = new URLSearchParams(location.search), v = q.get('google');
  if (!v) return null;
  q.delete('google');
  history.replaceState(null, '', location.pathname + (q.toString() ? '?' + q : '') + location.hash);
  if (v !== 'signed_in') { try { localStorage.removeItem(FLAG); } catch (e) {} }
  return v;
}

const post = path => fetch('/api/google/' + path, { method: 'POST', headers: { 'x-requested-with': 'XmlHttpRequest' }, cache: 'no-store' });

let tok = null; // {value, until}
let tokP = null;
async function refresh() {
  const res = await post('token').catch(() => null);
  if (!res) throw { code: 'unavailable' };
  if (res.status === 401) throw { code: 'signed_out' };
  const j = res.ok ? await res.json().catch(() => null) : null;
  if (!j || !j.accessToken) throw { code: 'unavailable' };
  tok = { value: j.accessToken, until: Date.now() + (j.expiresIn - 120) * 1000, user: j.user };
  try { localStorage.setItem(FLAG, JSON.stringify(j.user)); } catch (e) {}
  return tok;
}
// A valid access token, refreshed shortly before it runs out.
function token(force) {
  if (!force && tok && Date.now() < tok.until) return Promise.resolve(tok.value);
  if (!tokP) tokP = refresh().finally(() => { tokP = null; });
  return tokP.then(t => t.value);
}

// The signed-in Google user ({id, email, name, picture}), or null. Offline, the last known user,
// so files open from this browser's copy and upload once back online.
export async function restoreGoogle() {
  let saved = null;
  try { saved = localStorage.getItem(FLAG); } catch (e) {}
  if (!saved) return null;
  try { return (await refresh()).user; }
  catch (e) {
    if (e.code === 'signed_out') { try { localStorage.removeItem(FLAG); } catch (x) {} return null; }
    try { const u = JSON.parse(saved); if (u && u.id) return u; } catch (x) {}
    return null;
  }
}

export async function signOutGoogle() {
  try { localStorage.removeItem(FLAG); } catch (e) {}
  tok = null; rootP = null; settingsId = null; ids.clear(); // forget this person's Drive
  await post('signout').catch(() => {});
}

/* ---- Drive ---- */
async function drive(url, opts = {}, retried) {
  const res = await fetch(url, { ...opts, headers: { authorization: 'Bearer ' + await token(), ...(opts.headers || {}) } })
    .catch(() => { throw { code: 'unavailable' }; });
  if (res.status === 401 && !retried) { await token(true); return drive(url, opts, true); }
  if (res.status === 401) throw { code: 'signed_out' };
  if (res.status === 404) throw { code: 'not_found' };
  if (res.status === 403) {
    const j = await res.json().catch(() => null), why = j?.error?.errors?.[0]?.reason || '';
    throw { code: /storageQuota/i.test(why) ? 'too_large' : 'unavailable', why };
  }
  if (!res.ok) throw { code: 'unavailable', status: res.status };
  return res.status === 204 ? null : res.json();
}
const qs = o => new URLSearchParams(o).toString();
const tagged = (k, v) => `appProperties has { key='${k}' and value='${String(v).replace(/[\\']/g, '\\$&')}' }`;

async function find(q) {
  let out = [], page = '';
  do {
    const r = await drive(`${API}?${qs({ q: q + ' and trashed=false', fields: 'nextPageToken,files(id,appProperties)', pageSize: '1000', spaces: 'drive', ...(page ? { pageToken: page } : {}) })}`);
    out = out.concat(r.files || []);
    page = r.nextPageToken || '';
  } while (page);
  return out;
}

let rootP = null;
function root() {
  if (!rootP) rootP = find(tagged('linework', 'root')).then(async fs => {
    if (fs.length) return fs[0].id;
    const f = await drive(API + '?fields=id', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Linework', mimeType: 'application/vnd.google-apps.folder', appProperties: { linework: 'root' } }),
    });
    return f.id;
  }).catch(e => { rootP = null; throw e; });
  return rootP;
}

// Create or replace a JSON file in the Linework folder.
async function upload(driveId, name, appProperties, data) {
  const meta = driveId ? { name, appProperties } : { name, appProperties, mimeType: 'application/json', parents: [await root()] };
  const b = 'lw' + Math.random().toString(36).slice(2);
  const body = `--${b}\r\ncontent-type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n--${b}\r\ncontent-type: application/json\r\n\r\n${JSON.stringify(data)}\r\n--${b}--`;
  return drive(`${UPLOAD}${driveId ? '/' + driveId : ''}?uploadType=multipart&fields=id`, {
    method: driveId ? 'PATCH' : 'POST', headers: { 'content-type': 'multipart/related; boundary=' + b }, body,
  });
}
const fileName = f => `${String(f.title || 'Untitled').replace(/[\\/]/g, '-').slice(0, 120)}.linework.json`;

const ids = new Map(); // Linework file id -> Drive file id
async function driveIdOf(id) {
  if (ids.has(id)) return ids.get(id);
  const [hit] = await find(tagged('lineworkId', id));
  if (hit) ids.set(id, hit.id);
  return hit ? hit.id : null;
}

// Same shape as cloud.js: list, save and delete Linework files.
async function pool(items, n, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (i < items.length) { const k = i++; out[k] = await fn(items[k]); } }));
  return out;
}
export async function listDriveFiles() {
  await root();
  const found = await find(tagged('linework', 'file'));
  const files = await pool(found, 6, async x => {
    const f = await drive(`${API}/${x.id}?alt=media`).catch(() => null);
    if (!f || !f.id || !Array.isArray(f.diagrams)) return null;
    ids.set(f.id, x.id);
    return f;
  });
  return files.filter(Boolean);
}
export async function putDriveFile(f) {
  const props = { linework: 'file', lineworkId: f.id }, known = await driveIdOf(f.id);
  let r;
  try { r = await upload(known, fileName(f), props, f); }
  catch (e) {
    if (e.code !== 'not_found' || !known) throw e;
    ids.delete(f.id); // deleted in Drive meanwhile: save it as a new file
    r = await upload(null, fileName(f), props, f);
  }
  if (r && r.id) ids.set(f.id, r.id);
}
// Deleting moves the file to the Drive trash, so it can still be recovered from Drive for 30 days.
export async function removeDriveFile(id) {
  const d = await driveIdOf(id);
  if (!d) return;
  await drive(`${API}/${d}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ trashed: true }) })
    .catch(e => { if (e.code !== 'not_found') throw e; });
  ids.delete(id);
}

let settingsId = null;
export async function loadDriveFolders() {
  const [s] = await find(tagged('linework', 'settings'));
  if (!s) return [];
  settingsId = s.id;
  const o = await drive(`${API}/${s.id}?alt=media`).catch(() => null);
  return o && Array.isArray(o.folders) ? o.folders.filter(k => k && k.id && typeof k.name === 'string') : [];
}
export async function saveDriveFolders(folders) {
  if (!settingsId) { const [s] = await find(tagged('linework', 'settings')); settingsId = s ? s.id : null; }
  const r = await upload(settingsId, 'Linework settings.json', { linework: 'settings' }, { folders });
  if (r && r.id) settingsId = r.id;
}
