import { createSign } from 'node:crypto';
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync, existsSync, renameSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

/* Where the server keeps its data: named JSON blobs in one Google Drive folder. Every backend has the
   same calls (open, read, write, remove, move), all by name; the store (store.js) decides the names.
   A name may have one folder in front ("ada@example.com/file.x.json"): that's a folder inside the
   main one, made when it's first needed. open() returns every name, in the main folder and one level down.

   driveBackend   Google Drive, signed in either way:
                  - an OAuth refresh token for your own Drive (`npm run drive-auth` gets one), or
                  - a service account's key, with the folder in a Shared Drive (service accounts have no
                    storage of their own in My Drive).
   folderBackend  a local folder, for development without Google.
   memoryBackend  nothing saved, for the tests. */

const API = 'https://www.googleapis.com/drive/v3';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3';
const FOLDER = 'application/vnd.google-apps.folder';
const ALL = 'supportsAllDrives=true';

// An access token, refreshed a minute before it runs out.
function tokenSource({ refreshToken, clientId, clientSecret, serviceAccount, tokenUrl = 'https://oauth2.googleapis.com/token' }) {
  let cached = null;
  const fetchToken = async () => {
    let body;
    if (serviceAccount) {
      const now = Math.floor(Date.now() / 1000);
      const enc = o => Buffer.from(JSON.stringify(o)).toString('base64url');
      const unsigned = `${enc({ alg: 'RS256', typ: 'JWT' })}.${enc({ iss: serviceAccount.client_email, scope: 'https://www.googleapis.com/auth/drive', aud: serviceAccount.token_uri || tokenUrl, iat: now, exp: now + 3600 })}`;
      const sig = createSign('RSA-SHA256').update(unsigned).sign(serviceAccount.private_key).toString('base64url');
      body = new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${unsigned}.${sig}` });
    } else {
      body = new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken, client_id: clientId, client_secret: clientSecret });
    }
    const r = await fetch(serviceAccount?.token_uri || tokenUrl, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.access_token) throw new Error(`Google sign-in for Drive failed (${r.status}): ${j.error_description || j.error || 'no token'}`);
    cached = { token: j.access_token, until: Date.now() + (Number(j.expires_in) || 3600) * 1000 - 60_000 };
  };
  return async (fresh = false) => {
    if (fresh || !cached || Date.now() > cached.until) await fetchToken();
    return cached.token;
  };
}

export function driveBackend({ folderId = '', folderName = 'Linework data', ...auth }) {
  const token = tokenSource(auth);
  const ids = new Map(); // name → Drive file id
  const dirs = new Map(); // folder name inside the main one → a promise of its Drive id
  let folder = folderId;
  const split = name => { const i = name.lastIndexOf('/'); return i < 0 ? [null, name] : [name.slice(0, i), name.slice(i + 1)]; };
  // The Drive folder a name goes in, made if it isn't there yet (once, even when asked for twice at once).
  const parentOf = dir => {
    if (!dir) return Promise.resolve(folder);
    if (!dirs.has(dir)) {
      const made = call(`${API}/files?${ALL}&fields=id`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: dir, mimeType: FOLDER, parents: [folder] }) })
        .then(r => r.json()).then(j => j.id);
      made.catch(() => dirs.delete(dir));
      dirs.set(dir, made);
    }
    return dirs.get(dir);
  };

  // A Drive request, retried on rate limits and server errors, with a new token once if it was refused.
  const call = async (url, init = {}, { okMissing = false } = {}) => {
    for (let attempt = 0, fresh = false; ; attempt++) {
      const r = await fetch(url, { ...init, headers: { ...init.headers, authorization: `Bearer ${await token(fresh)}` } });
      if (r.ok) return r;
      if (okMissing && r.status === 404) return null;
      if (r.status === 401 && !fresh) { fresh = true; continue; }
      if ((r.status === 429 || r.status >= 500 || r.status === 403 && /rate/i.test(await r.clone().text())) && attempt < 4) {
        await new Promise(res => setTimeout(res, 500 * 2 ** attempt + Math.random() * 250));
        continue;
      }
      throw new Error(`Google Drive answered ${r.status}: ${(await r.text()).slice(0, 300)}`);
    }
  };
  const q = s => `'${String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
  const search = async query => {
    const out = [];
    let page = '';
    do {
      const url = `${API}/files?${ALL}&includeItemsFromAllDrives=true&pageSize=1000&fields=nextPageToken,files(id,name,mimeType)&q=${encodeURIComponent(query)}${page ? `&pageToken=${page}` : ''}`;
      const j = await (await call(url)).json();
      out.push(...j.files);
      page = j.nextPageToken || '';
    } while (page);
    return out;
  };

  return {
    describe: () => `Google Drive folder ${folder}`,
    // Find (or make) the folder, and learn the names in it.
    async open() {
      if (!folder) {
        const found = await search(`name = ${q(folderName)} and mimeType = '${FOLDER}' and trashed = false`);
        if (found.length) folder = found[0].id;
        else {
          const r = await call(`${API}/files?${ALL}&fields=id`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: folderName, mimeType: FOLDER }) });
          folder = (await r.json()).id;
          console.log(`Made the Google Drive folder "${folderName}" (${folder}). Set GOOGLE_DRIVE_FOLDER_ID=${folder} to keep using it.`);
        }
      }
      ids.clear(); dirs.clear();
      for (const f of await search(`${q(folder)} in parents and trashed = false`)) {
        if (f.mimeType === FOLDER) { if (!dirs.has(f.name)) dirs.set(f.name, Promise.resolve(f.id)); }
        else if (!ids.has(f.name)) ids.set(f.name, f.id);
      }
      for (const [dir, id] of dirs) {
        for (const f of await search(`${q(await id)} in parents and trashed = false and mimeType != '${FOLDER}'`)) {
          if (!ids.has(`${dir}/${f.name}`)) ids.set(`${dir}/${f.name}`, f.id);
        }
      }
      return [...ids.keys()];
    },
    async read(name) {
      const id = ids.get(name);
      if (!id) return null;
      const r = await call(`${API}/files/${id}?alt=media&${ALL}`, {}, { okMissing: true });
      return r ? r.text() : null;
    },
    async write(name, text) {
      const id = ids.get(name);
      if (id) {
        const r = await call(`${UPLOAD}/files/${id}?uploadType=media&${ALL}&fields=id`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: text }, { okMissing: true });
        if (r) return;
        ids.delete(name); // removed in Drive by hand: make it again
      }
      const [dir, base] = split(name);
      const boundary = `lw${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
      const body = `--${boundary}\r\ncontent-type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify({ name: base, parents: [await parentOf(dir)], mimeType: 'application/json' })}\r\n--${boundary}\r\ncontent-type: application/json\r\n\r\n${text}\r\n--${boundary}--`;
      const r = await call(`${UPLOAD}/files?uploadType=multipart&${ALL}&fields=id`, { method: 'POST', headers: { 'content-type': `multipart/related; boundary=${boundary}` }, body });
      ids.set(name, (await r.json()).id);
    },
    async remove(name) {
      const id = ids.get(name);
      if (!id) return;
      ids.delete(name);
      await call(`${API}/files/${id}?${ALL}`, { method: 'DELETE' }, { okMissing: true });
    },
    // Give a blob a new name, maybe in another folder, without copying it.
    async move(from, to) {
      const id = ids.get(from);
      if (!id || from === to) return;
      const [fromDir] = split(from), [toDir, base] = split(to);
      const [oldParent, newParent] = await Promise.all([parentOf(fromDir), parentOf(toDir)]);
      const parents = oldParent === newParent ? '' : `&addParents=${newParent}&removeParents=${oldParent}`;
      await call(`${API}/files/${id}?${ALL}${parents}&fields=id`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: base }) });
      ids.delete(from); ids.set(to, id);
    },
  };
}

export function folderBackend(dir) {
  const path = name => join(dir, ...name.split('/'));
  return {
    describe: () => `the folder ${dir}`,
    async open() {
      mkdirSync(dir, { recursive: true });
      return readdirSync(dir, { withFileTypes: true }).flatMap(e => (e.isDirectory()
        ? readdirSync(join(dir, e.name)).filter(n => n.endsWith('.json')).map(n => `${e.name}/${n}`)
        : e.name.endsWith('.json') ? [e.name] : []));
    },
    async read(name) { return existsSync(path(name)) ? readFileSync(path(name), 'utf8') : null; },
    async write(name, text) { mkdirSync(dirname(path(name)), { recursive: true }); writeFileSync(path(name) + '.tmp', text); renameSync(path(name) + '.tmp', path(name)); },
    async remove(name) { rmSync(path(name), { force: true }); },
    async move(from, to) { if (!existsSync(path(from))) return; mkdirSync(dirname(path(to)), { recursive: true }); renameSync(path(from), path(to)); },
  };
}

export function memoryBackend(blobs = new Map()) {
  return {
    blobs,
    describe: () => 'memory (nothing is saved)',
    async open() { return [...blobs.keys()]; },
    async read(name) { return blobs.get(name) ?? null; },
    async write(name, text) { blobs.set(name, text); },
    async remove(name) { blobs.delete(name); },
    async move(from, to) { if (blobs.has(from)) { blobs.set(to, blobs.get(from)); blobs.delete(from); } },
  };
}

// The backend that the environment asks for: Google Drive when it's set up, else DATA_DIR, else nothing.
export function backendFromEnv(env, root) {
  const key = env.GOOGLE_SERVICE_ACCOUNT_KEY;
  const folderId = env.GOOGLE_DRIVE_FOLDER_ID || '';
  if (key) {
    const serviceAccount = JSON.parse(key.trim().startsWith('{') ? key : readFileSync(resolve(root, key), 'utf8'));
    if (!folderId) throw new Error('With a service account, set GOOGLE_DRIVE_FOLDER_ID to a folder in a Shared Drive that the account can edit.');
    return driveBackend({ serviceAccount, folderId });
  }
  if (env.GOOGLE_DRIVE_REFRESH_TOKEN) {
    const clientId = env.GOOGLE_DRIVE_CLIENT_ID || env.GOOGLE_CLIENT_ID, clientSecret = env.GOOGLE_DRIVE_CLIENT_SECRET || env.GOOGLE_CLIENT_SECRET;
    if (!clientId || !clientSecret) throw new Error('GOOGLE_DRIVE_REFRESH_TOKEN needs the OAuth client it came from: GOOGLE_DRIVE_CLIENT_ID and GOOGLE_DRIVE_CLIENT_SECRET.');
    return driveBackend({ refreshToken: env.GOOGLE_DRIVE_REFRESH_TOKEN, clientId, clientSecret, folderId, folderName: env.GOOGLE_DRIVE_FOLDER_NAME || 'Linework data' });
  }
  if (env.DATA_DIR) return folderBackend(resolve(root, env.DATA_DIR));
  return null;
}
