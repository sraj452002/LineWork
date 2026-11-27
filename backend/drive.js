import { createHash, createHmac, randomBytes } from 'node:crypto';

/* Storage: one common place for any files (PDFs, pictures, audio, video, documents…), in folders. The app's
   Storage view and the Storage workflow node both use it.

   Where the bytes go:
     an S3-compatible bucket   when S3_BUCKET, S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY are set (Cloudflare R2,
                               Amazon S3, Backblaze B2, MinIO…; S3_ENDPOINT for anything but Amazon). Kept for good:
                               the list of files is in the bucket too, so a server restart loses nothing.
     the server's own storage  otherwise (DATA_DIR, or memory): gone when a free host restarts without a disk.
   The keys are only ever read from the environment (Render's settings), never from the repository.

   A file is kept in parts of at most PART bytes (the browser sends one part per request, so a large file
   never needs one huge request), plus one index per account: { files: {id: entry}, folders: [path] }.
   An entry: { id, name, folder ('' or 'Docs/2024'), type, size, parts, created, updated, pending? }. */

export const PART = 2 * 1024 * 1024;
const MB = 1024 * 1024;
export class DriveError extends Error {
  constructor(message, code = 'bad_request', status = 400) { super(message); this.code = code; this.status = status; }
}

/* ---- AWS Signature Version 4, for S3-compatible buckets ---- */
const sha256 = b => createHash('sha256').update(b).digest('hex');
const hmac = (k, s) => createHmac('sha256', k).update(s).digest();
const rfc3986 = s => encodeURIComponent(s).replace(/[!'()*]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase());
// The headers that sign one request (with `authorization`). `body` is a Buffer/string, or empty.
export function signS3({ method, url, headers = {}, body = '', region, accessKeyId, secretAccessKey, now = new Date(), service = 's3' }) {
  const u = new URL(url);
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, ''), day = amzDate.slice(0, 8);
  const payload = sha256(body || '');
  const h = {};
  for (const [k, v] of Object.entries(headers)) h[k.toLowerCase()] = String(v);
  Object.assign(h, { host: u.host, 'x-amz-content-sha256': payload, 'x-amz-date': amzDate });
  const names = Object.keys(h).sort();
  const canonPath = u.pathname.split('/').map(seg => rfc3986(decodeURIComponent(seg))).join('/');
  const canonQuery = [...u.searchParams].map(([k, v]) => [rfc3986(k), rfc3986(v)]).sort((a, b) => (a[0] === b[0] ? (a[1] < b[1] ? -1 : 1) : a[0] < b[0] ? -1 : 1)).map(([k, v]) => `${k}=${v}`).join('&');
  const canon = [method, canonPath, canonQuery, names.map(n => `${n}:${h[n].trim().replace(/\s+/g, ' ')}\n`).join(''), names.join(';'), payload].join('\n');
  const scope = `${day}/${region}/${service}/aws4_request`;
  const key = hmac(hmac(hmac(hmac('AWS4' + secretAccessKey, day), region), service), 'aws4_request');
  const signature = createHmac('sha256', key).update(['AWS4-HMAC-SHA256', amzDate, scope, sha256(canon)].join('\n')).digest('hex');
  h.authorization = `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${scope}, SignedHeaders=${names.join(';')}, Signature=${signature}`;
  return h;
}

// Bytes by key in a bucket. get() answers null when there's no such object.
export function s3Bytes({ bucket, endpoint = '', region = '', accessKeyId, secretAccessKey, prefix = 'workline/', fetchFn = fetch }) {
  region ||= endpoint ? 'auto' : 'us-east-1';
  const base = (endpoint || `https://s3.${region}.amazonaws.com`).replace(/\/+$/, '');
  const urlOf = key => `${base}/${rfc3986(bucket)}/${(prefix + key).split('/').map(rfc3986).join('/')}`;
  const call = async (method, key, body, headers = {}) => {
    const url = urlOf(key);
    const r = await fetchFn(url, { method, body: body || undefined, headers: signS3({ method, url, headers, body, region, accessKeyId, secretAccessKey }) });
    if (method === 'GET' && r.status === 404) return null;
    if (!r.ok && !(method === 'DELETE' && r.status === 404)) {
      const text = await r.text().catch(() => '');
      const code = (text.match(/<Code>([^<]+)/) || [])[1] || `HTTP ${r.status}`;
      throw new DriveError(`The storage bucket answered ${code}. Check the S3_… settings on the server.`, 'bucket', 502);
    }
    return r;
  };
  return {
    kind: 'bucket', persistent: true, describe: `the bucket ${bucket}`,
    async get(key) { const r = await call('GET', key); return r ? Buffer.from(await r.arrayBuffer()) : null; },
    async put(key, buf, type = 'application/octet-stream') { await call('PUT', key, buf, { 'content-type': type }); },
    async del(key) { await call('DELETE', key); },
  };
}

// Bytes kept with the server's other data (store.blob: DATA_DIR or memory), base64 in JSON.
export function storeBytes(store, uid, persistent) {
  return {
    kind: persistent ? 'folder' : 'memory', persistent, describe: persistent ? 'the server’s data folder' : 'the server’s memory',
    async get(key) { const t = await store.blob.read(uid, `drive.${key}.json`); try { return t ? Buffer.from(JSON.parse(t).data, 'base64') : null; } catch (e) { return null; } },
    async put(key, buf) { await store.blob.write(uid, `drive.${key}.json`, JSON.stringify({ data: buf.toString('base64') })); },
    async del(key) { await store.blob.remove(uid, `drive.${key}.json`); },
  };
}

/* ---- names and folders ---- */
const cleanName = n => String(n ?? '').replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '-').replace(/\s+/g, ' ').trim().slice(0, 160);
export function cleanFolder(p) {
  const parts = String(p ?? '').split('/').map(cleanName).filter(s => s && s !== '.' && s !== '..');
  if (parts.length > 8) throw new DriveError('Folders go at most 8 deep.', 'too_deep');
  return parts.join('/');
}
const within = (folder, path) => folder === path || folder.startsWith(path + '/');
const TYPES = { pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml', avif: 'image/avif',
  mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', m4a: 'audio/mp4', flac: 'audio/flac', mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime',
  txt: 'text/plain', md: 'text/markdown', csv: 'text/csv', json: 'application/json', html: 'text/html', xml: 'application/xml', zip: 'application/zip',
  doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', ppt: 'application/vnd.ms-powerpoint', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' };
export const typeOf = (name, given) => (given && /^[\w.+-]+\/[\w.+-]+$/.test(given) && given !== 'application/octet-stream' ? given : TYPES[String(name).split('.').pop().toLowerCase()] || given || 'application/octet-stream');

/* ---- the drive ---- */
export function createDrive({ store, env = process.env, fetchFn = fetch }) {
  const bucket = env.S3_BUCKET && env.S3_ACCESS_KEY_ID && env.S3_SECRET_ACCESS_KEY
    ? s3Bytes({ bucket: env.S3_BUCKET, endpoint: env.S3_ENDPOINT || '', region: env.S3_REGION || '', accessKeyId: env.S3_ACCESS_KEY_ID, secretAccessKey: env.S3_SECRET_ACCESS_KEY, prefix: env.S3_PREFIX ?? 'workline/', fetchFn })
    : null;
  const onDisk = Boolean(env.DATA_DIR);
  const limit = Number(env.STORAGE_LIMIT_MB) > 0 ? Number(env.STORAGE_LIMIT_MB) * MB : (bucket ? 10_240 : onDisk ? 1024 : 200) * MB;
  const maxFile = Number(env.STORAGE_MAX_FILE_MB) > 0 ? Number(env.STORAGE_MAX_FILE_MB) * MB : (bucket ? 200 : 50) * MB;
  const userDir = uid => 'u-' + createHash('sha256').update(String(uid)).digest('hex').slice(0, 20);
  const bytesFor = uid => (bucket ? { ...bucket, get: k => bucket.get(`${userDir(uid)}/${k}`), put: (k, b, t) => bucket.put(`${userDir(uid)}/${k}`, b, t), del: k => bucket.del(`${userDir(uid)}/${k}`) } : storeBytes(store, uid, onDisk));

  // Each account's index, read once and then kept in memory; writes go one after another.
  const indexes = new Map(), chains = new Map();
  const load = async uid => {
    if (!indexes.has(uid)) {
      indexes.set(uid, (async () => {
        const raw = await bytesFor(uid).get('index');
        let ix = null; try { ix = raw ? JSON.parse(raw.toString('utf8')) : null; } catch (e) { ix = null; }
        return { files: ix?.files && typeof ix.files === 'object' ? ix.files : {}, folders: Array.isArray(ix?.folders) ? ix.folders : [] };
      })().catch(e => { indexes.delete(uid); throw e; }));
    }
    return indexes.get(uid);
  };
  const save = (uid, ix) => {
    const next = (chains.get(uid) || Promise.resolve()).catch(() => {}).then(() => bytesFor(uid).put('index', Buffer.from(JSON.stringify(ix)), 'application/json'));
    chains.set(uid, next);
    return next;
  };
  const used = ix => Object.values(ix.files).reduce((s, f) => s + (f.size || 0), 0);
  const ready = ix => Object.values(ix.files).filter(f => !f.pending);
  const freeName = (ix, folder, name, except) => {
    const taken = new Set(ready(ix).filter(f => f.folder === folder && f.id !== except).map(f => f.name.toLowerCase()));
    if (!taken.has(name.toLowerCase())) return name;
    const dot = name.lastIndexOf('.'), stem = dot > 0 ? name.slice(0, dot) : name, ext = dot > 0 ? name.slice(dot) : '';
    for (let n = 2; ; n++) if (!taken.has(`${stem} (${n})${ext}`.toLowerCase())) return `${stem} (${n})${ext}`;
  };
  const addFolders = (ix, path) => { const p = path.split('/'); for (let i = 1; i <= p.length; i++) { const f = p.slice(0, i).join('/'); if (f && !ix.folders.includes(f)) ix.folders.push(f); } };
  const pub = f => ({ id: f.id, name: f.name, folder: f.folder, type: f.type, size: f.size, created: f.created, updated: f.updated });
  const dropParts = async (uid, f) => { const b = bytesFor(uid); for (let n = 0; n < (f.parts || 0); n++) await b.del(`${f.id}.${n}`).catch(() => {}); };
  const entry = (ix, id) => { const f = ix.files[String(id)]; if (!f || f.pending) throw new DriveError('That file isn’t in Storage any more.', 'not_found', 404); return f; };

  const forUser = uid => ({
    async list() {
      const ix = await load(uid);
      // Uploads left unfinished for an hour are dropped.
      const stale = Object.values(ix.files).filter(f => f.pending && Date.now() - f.created > 3600_000);
      if (stale.length) { for (const f of stale) { delete ix.files[f.id]; dropParts(uid, f); } await save(uid, ix); }
      const files = ready(ix).map(pub);
      const folders = [...new Set([...ix.folders, ...files.map(f => f.folder).filter(Boolean)])].sort((a, b) => a.localeCompare(b));
      return { files, folders, used: files.reduce((n, f) => n + f.size, 0), limit, maxFile, part: PART, where: bucket ? 'bucket' : onDisk ? 'folder' : 'memory', persistent: Boolean(bucket || onDisk), describe: bytesFor(uid).describe };
    },
    // An upload: begin() makes a pending entry, part() takes each part in turn, finish() makes it a file.
    async begin({ name, folder, type, size }) {
      const ix = await load(uid);
      size = Number(size);
      if (!Number.isFinite(size) || size < 0) throw new DriveError('The file’s size is missing.');
      if (size > maxFile) throw new DriveError(`That file is over ${Math.round(maxFile / MB)} MB, the most one file can be here.`, 'too_large', 413);
      if (used(ix) + size > limit) throw new DriveError(`Storage is full (${Math.round(limit / MB)} MB). Delete some files first.`, 'storage_full', 507);
      const nm = cleanName(name) || 'file', fd = cleanFolder(folder), now = Date.now();
      const f = { id: randomBytes(9).toString('base64url'), name: nm, folder: fd, type: typeOf(nm, type), size, parts: Math.max(1, Math.ceil(size / PART)), created: now, updated: now, pending: true, got: 0 };
      ix.files[f.id] = f;
      return { id: f.id, parts: f.parts, part: PART };
    },
    async part(id, n, data) {
      const ix = await load(uid), f = ix.files[String(id)];
      if (!f || !f.pending) throw new DriveError('That upload isn’t going on.', 'not_found', 404);
      n = Number(n);
      if (!Number.isInteger(n) || n < 0 || n >= f.parts) throw new DriveError('That part doesn’t belong to the upload.');
      const buf = Buffer.isBuffer(data) ? data : Buffer.from(String(data || '').replace(/^data:[^,]*,/, ''), 'base64');
      const want = n === f.parts - 1 ? f.size - PART * (f.parts - 1) : PART;
      if (buf.length !== want) throw new DriveError(`Part ${n + 1} should be ${want} bytes, not ${buf.length}.`);
      await bytesFor(uid).put(`${f.id}.${n}`, buf, f.type);
      f.got = Math.max(f.got || 0, n + 1);
      return { ok: true };
    },
    async finish(id) {
      const ix = await load(uid), f = ix.files[String(id)];
      if (!f || !f.pending) throw new DriveError('That upload isn’t going on.', 'not_found', 404);
      if ((f.got || 0) < f.parts) throw new DriveError('Some parts of the file didn’t arrive. Upload it again.', 'incomplete');
      delete f.pending; delete f.got;
      f.name = freeName(ix, f.folder, f.name, f.id);
      if (f.folder) addFolders(ix, f.folder);
      await save(uid, ix);
      return pub(f);
    },
    // A whole file at once (the workflow node, small uploads): { name, folder, type, buf }.
    async put({ name, folder, type, buf, replace = false }) {
      const ix = await load(uid), fd = cleanFolder(folder), nm = cleanName(name) || 'file';
      const old = replace ? ready(ix).find(f => f.folder === fd && f.name.toLowerCase() === nm.toLowerCase()) : null;
      if (buf.length > maxFile) throw new DriveError(`That file is over ${Math.round(maxFile / MB)} MB, the most one file can be here.`, 'too_large', 413);
      if (used(ix) - (old?.size || 0) + buf.length > limit) throw new DriveError(`Storage is full (${Math.round(limit / MB)} MB). Delete some files first.`, 'storage_full', 507);
      const { id } = await this.begin({ name: nm, folder: fd, type, size: buf.length });
      for (let n = 0; n * PART < buf.length || n === 0; n++) await this.part(id, n, buf.subarray(n * PART, (n + 1) * PART));
      if (old) { delete ix.files[old.id]; dropParts(uid, old); }
      return this.finish(id);
    },
    async read(id) {
      const ix = await load(uid), f = entry(ix, id), b = bytesFor(uid), bufs = [];
      for (let n = 0; n < f.parts; n++) { const p = await b.get(`${f.id}.${n}`); if (!p) throw new DriveError('Part of that file is missing from Storage (was the server restarted?).', 'missing', 410); bufs.push(p); }
      return { file: pub(f), buf: Buffer.concat(bufs) };
    },
    // Each part in turn, for sending a file without holding it all.
    async *stream(id) {
      const ix = await load(uid), f = entry(ix, id), b = bytesFor(uid);
      for (let n = 0; n < f.parts; n++) { const p = await b.get(`${f.id}.${n}`); if (!p) throw new DriveError('Part of that file is missing from Storage (was the server restarted?).', 'missing', 410); yield p; }
    },
    async info(id) { return pub(entry(await load(uid), id)); },
    // A file by id, or by its path: "Reports/june.pdf" (the newest one with that name).
    async find(ref) {
      const ix = await load(uid), r = String(ref ?? '').trim();
      if (ix.files[r] && !ix.files[r].pending) return pub(ix.files[r]);
      const i = r.lastIndexOf('/'), fd = cleanFolder(i < 0 ? '' : r.slice(0, i)), nm = (i < 0 ? r : r.slice(i + 1)).toLowerCase();
      const f = ready(ix).filter(x => x.folder.toLowerCase() === fd.toLowerCase() && x.name.toLowerCase() === nm).sort((a, b) => b.updated - a.updated)[0];
      return f ? pub(f) : null;
    },
    async update(id, { name, folder }) {
      const ix = await load(uid), f = entry(ix, id);
      const fd = folder === undefined ? f.folder : cleanFolder(folder);
      const nm = name === undefined ? f.name : cleanName(name);
      if (!nm) throw new DriveError('Give the file a name.');
      f.folder = fd; f.name = freeName(ix, fd, nm, f.id); f.updated = Date.now();
      if (fd) addFolders(ix, fd);
      await save(uid, ix);
      return pub(f);
    },
    async remove(id) {
      const ix = await load(uid), f = entry(ix, id);
      delete ix.files[f.id];
      await save(uid, ix);
      await dropParts(uid, f);
      return { ok: true };
    },
    async addFolder(path) {
      const ix = await load(uid), p = cleanFolder(path);
      if (!p) throw new DriveError('Give the folder a name.');
      addFolders(ix, p);
      await save(uid, ix);
      return { folder: p };
    },
    // A folder renamed or moved, with everything in it.
    async moveFolder(from, to) {
      const ix = await load(uid), a = cleanFolder(from), b = cleanFolder(to);
      if (!a || !b) throw new DriveError('Give the folder a name.');
      if (within(b, a)) throw new DriveError('A folder can’t go inside itself.');
      const swap = p => (within(p, a) ? b + p.slice(a.length) : p);
      ix.folders = [...new Set(ix.folders.map(swap))];
      for (const f of ready(ix)) if (within(f.folder, a)) { f.folder = swap(f.folder); f.name = freeName(ix, f.folder, f.name, f.id); }
      addFolders(ix, b);
      await save(uid, ix);
      return { folder: b };
    },
    // A folder and everything in it.
    async removeFolder(path) {
      const ix = await load(uid), p = cleanFolder(path);
      if (!p) throw new DriveError('Pick a folder.');
      const gone = ready(ix).filter(f => within(f.folder, p));
      for (const f of gone) delete ix.files[f.id];
      ix.folders = ix.folders.filter(f => !within(f, p));
      await save(uid, ix);
      for (const f of gone) await dropParts(uid, f);
      return { ok: true, removed: gone.length };
    },
  });
  return { forUser, where: bucket ? 'bucket' : onDisk ? 'folder' : 'memory', limit, maxFile };
}

/* ---- the API: /api/drive… (signed in; JSON in, except downloads) ---- */
export function driveRoutes(api, signedIn, drive) {
  const h = fn => async (req, res) => {
    try { await fn(drive.forUser(req.user.id), req, res); }
    catch (e) {
      if (!(e instanceof DriveError)) { console.error('Storage:', e); return res.status(500).json({ error: 'server_error', message: 'Storage had a problem. Try again.' }); }
      if (!res.headersSent) res.status(e.status).json({ error: e.code, message: e.message });
      else res.end();
    }
  };
  api.get('/drive', signedIn, h(async (d, req, res) => res.json(await d.list())));
  api.post('/drive/uploads', signedIn, h(async (d, req, res) => res.json(await d.begin(req.body || {}))));
  api.post('/drive/uploads/:id/:n', signedIn, h(async (d, req, res) => res.json(await d.part(req.params.id, req.params.n, req.body?.data))));
  api.post('/drive/uploads/:id', signedIn, h(async (d, req, res) => res.json(await d.finish(req.params.id))));
  api.post('/drive/files/:id', signedIn, h(async (d, req, res) => res.json(await d.update(req.params.id, req.body || {}))));
  api.delete('/drive/files/:id', signedIn, h(async (d, req, res) => res.json(await d.remove(req.params.id))));
  api.post('/drive/folders', signedIn, h(async (d, req, res) => res.json(await d.addFolder(req.body?.path))));
  api.post('/drive/folders/move', signedIn, h(async (d, req, res) => res.json(await d.moveFolder(req.body?.from, req.body?.to))));
  api.post('/drive/folders/remove', signedIn, h(async (d, req, res) => res.json(await d.removeFolder(req.body?.path))));
  // The file itself: shown in the page (pictures, PDFs, audio, video) or, with ?download=1, saved.
  // Sandboxed, so an uploaded web page or SVG can't run scripts on this site.
  api.get('/drive/files/:id/raw', signedIn, h(async (d, req, res) => {
    const f = await d.info(req.params.id);
    const ascii = f.name.replace(/[^\x20-\x7e]|["\\]/g, '_');
    res.set({
      'content-type': f.type, 'content-length': String(f.size), 'cache-control': 'private, max-age=60',
      // (Not for PDFs: browsers won't show a PDF in a sandboxed page, and a PDF can't run scripts here.)
      ...(f.type === 'application/pdf' ? {} : { 'content-security-policy': 'sandbox; default-src \'none\'; img-src \'self\' data:; media-src \'self\'; style-src \'unsafe-inline\'' }),
      'content-disposition': `${req.query.download ? 'attachment' : 'inline'}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(f.name)}`,
    });
    for await (const part of d.stream(f.id)) if (!res.write(part)) await new Promise(r => res.once('drain', r));
    res.end();
  }));
}
