import { createHash } from 'node:crypto';

/* The server's data, kept in a backend from drive.js (Google Drive in production) instead of a database.

   meta.json            accounts, sessions, sign-in links, Google/GitHub identities, folders, share links,
                        AI usage, and the index of everyone's files and versions. Small: it's held in memory
                        and written back after every change (changes close together go in one write).
   <email>/             each account's own folder (named by its email), with:
     file.<id>.json       a saved file, as the app sends it.
     version.<n>.json     one version of a file.
     image.<key>.json     a picture on a canvas ({data: a data: URL}); files keep only its key.
   meta.json also keeps each account's own settings (`userdata`: saved database connections, query history).

   Each account may keep up to `storageLimit` bytes (files, their versions and pictures, counted from the
   sizes in meta.json). To make room the oldest versions go first; past that, saving throws StorageFull.

   One server process owns the folder: run one instance, and stop it before `npm run admin`.
   `s` has the same calls the SQLite version had (get / run / all), so the account code reads the same;
   reading and writing files themselves is async, since that goes to the backend. */

const META = 'meta.json';
const sha = t => createHash('sha256').update(t).digest('base64url');
export class StorageFull extends Error {
  constructor(used, limit) { super('storage full'); this.code = 'storage_full'; this.used = used; this.limit = limit; }
}
const empty = () => ({ v: 1, nextVid: 1, users: {}, sessions: {}, tokens: {}, identities: {}, folders: {}, shares: {}, ai: {}, files: {}, versions: {}, images: {}, userdata: {},
  // Workflows (flows.js): credentials, active triggers, and each flow's recent runs.
  creds: {}, hooks: {}, schedules: {}, polls: {}, runs: {} });
const USER_DEFAULTS = { verified: 1, totp_secret: null, totp_pending: null, totp_last: 0, recovery: '[]' };

// Recently used file texts, so listing files doesn't download them all each time.
function textCache(maxChars = 64_000_000) {
  const m = new Map(); let size = 0;
  const drop = k => { const t = m.get(k); if (t !== undefined) { size -= t.length; m.delete(k); } };
  return {
    get(k) { const t = m.get(k); if (t !== undefined) { m.delete(k); m.set(k, t); } return t; },
    set(k, t) { drop(k); m.set(k, t); size += t.length; for (const key of m.keys()) { if (size <= maxChars) break; drop(key); } },
    drop,
  };
}

export async function openStore(backend, { versionEvery = 10 * 60_000, keepVersions = 100, storageLimit = 0 } = {}) {
  const names = new Set(await backend.open());
  const raw = await backend.read(META);
  const m = Object.assign(empty(), raw ? JSON.parse(raw) : {});
  const cache = textCache();

  // Each account's blobs are in its own folder, named by its email (or its id, without one).
  const dirOf = uid => String(m.users[uid]?.email || uid).replace(/[\\/]/g, '_');
  const fileName = (uid, id) => `${dirOf(uid)}/file.${id}.json`;
  const versionName = (uid, vid) => `${dirOf(uid)}/version.${vid}.json`;
  const imageName = (uid, key) => `${dirOf(uid)}/image.${key}.json`;
  // Earlier versions kept everyone's blobs side by side in the main folder: move each to its account's folder.
  const moves = [
    ...Object.entries(m.files).flatMap(([uid, fs]) => Object.keys(fs).map(id => [`file.${uid}.${id}.json`, fileName(uid, id)])),
    ...Object.entries(m.versions).flatMap(([uid, byFile]) => Object.values(byFile).flat().map(v => [`version.${v.vid}.json`, versionName(uid, v.vid)])),
    ...Object.entries(m.images).flatMap(([uid, ims]) => Object.keys(ims).map(key => [`image.${uid}.${key}.json`, imageName(uid, key)])),
  ].filter(([from]) => names.has(from));
  for (let i = 0; i < moves.length; i += 8) await Promise.all(moves.slice(i, i + 8).map(([from, to]) => backend.move(from, to)));
  if (moves.length) console.log(`Moved ${moves.length} saved files into each account's own folder.`);

  /* ---- writing back ---- */
  // Writes to one name happen in the order they were asked for.
  const chains = new Map();
  const queue = (name, job) => {
    const next = (chains.get(name) || Promise.resolve()).catch(() => {}).then(job);
    chains.set(name, next);
    next.finally(() => { if (chains.get(name) === next) chains.delete(name); }).catch(() => {});
    return next;
  };
  // meta.json: a change marks it dirty; one write at a time, and another after it if more changed.
  let dirty = false, writing = null;
  const saveMeta = () => {
    dirty = true;
    if (!writing) writing = (async () => {
      try { while (dirty) { dirty = false; await queue(META, () => backend.write(META, JSON.stringify(m))); } }
      catch (e) { dirty = true; console.error('Saving meta.json failed:', e.message); throw e; }
      finally { writing = null; }
    })();
    writing.catch(() => setTimeout(() => dirty && saveMeta(), 5000)); // try again shortly
    return writing;
  };
  const removeLater = name => { cache.drop(name); queue(name, () => backend.remove(name)).catch(e => console.error(`Removing ${name} failed:`, e.message)); };
  const changed = (result = { changes: 1 }) => { if (result.changes) saveMeta(); return result; };

  /* ---- accounts and the rest of meta.json, as the SQLite statements were ---- */
  const user = id => { const u = m.users[id]; return u ? { ...USER_DEFAULTS, ...u } : undefined; };
  const patch = (id, fields) => changed({ changes: m.users[id] ? (Object.assign(m.users[id], fields), 1) : 0 });
  const dropWhere = (table, test) => { let n = 0; for (const [k, v] of Object.entries(m[table])) if (test(v, k)) { delete m[table][k]; n++; } return changed({ changes: n }); };
  const fileIndex = uid => (m.files[uid] ||= {});
  const versionList = (uid, id) => ((m.versions[uid] ||= {})[id] ||= []);

  const dropFileNow = (uid, id) => {
    if (!m.files[uid]?.[id]) return { changes: 0 };
    delete m.files[uid][id];
    for (const v of m.versions[uid]?.[id] || []) removeLater(versionName(uid, v.vid));
    if (m.versions[uid]) delete m.versions[uid][id];
    dropWhere('shares', sh => sh.user_id === uid && sh.file_id === id);
    removeLater(fileName(uid, id));
    return changed();
  };

  const s = {
    userByEmail: { get: email => user(Object.values(m.users).find(u => u.email === email)?.id) },
    userById: { get: id => user(id) },
    addUser: { run(id, email, name, pass, created, verified) {
      if (Object.values(m.users).some(u => u.email === email)) throw new Error('email taken');
      m.users[id] = { id, email, name, pass, created, ...USER_DEFAULTS, verified };
      return changed();
    } },
    setVerified: { run: id => patch(id, { verified: 1 }) },
    setPendingTotp: { run: (secret, id) => patch(id, { totp_pending: secret }) },
    enableTotp: { run: (last, recovery, id) => patch(id, { totp_secret: m.users[id]?.totp_pending ?? null, totp_pending: null, totp_last: last, recovery }) },
    disableTotp: { run: id => patch(id, { totp_secret: null, totp_pending: null, totp_last: 0, recovery: '[]' }) },
    useTotpStep: { run: (step, id) => (m.users[id] && (m.users[id].totp_last || 0) < step ? patch(id, { totp_last: step }) : { changes: 0 }) },
    setRecovery: { run: (recovery, id) => patch(id, { recovery }) },
    setName: { run: (name, id) => patch(id, { name }) },
    setPass: { run: (pass, id) => patch(id, { pass }) },

    addToken: { run(token, user_id, kind, expires) { m.tokens[token] = { token, user_id, kind, expires, tries: 0 }; return changed(); } },
    token: { get: (token, kind, now) => { const t = m.tokens[token]; return t && t.kind === kind && t.expires > now ? { ...t } : undefined; } },
    tryToken: { run: token => changed({ changes: m.tokens[token] ? (m.tokens[token].tries++, 1) : 0 }) },
    dropToken: { run: token => dropWhere('tokens', (t, k) => k === token) },
    dropTokens: { run: (uid, kind) => dropWhere('tokens', t => t.user_id === uid && t.kind === kind) },
    oldTokens: { run: now => dropWhere('tokens', t => t.expires <= now) },

    identity: { get: (provider, subject) => { const i = m.identities[`${provider}:${subject}`]; return i && { ...i }; } },
    identities: { all: uid => Object.values(m.identities).filter(i => i.user_id === uid).sort((a, b) => a.created - b.created).map(({ provider, email, created }) => ({ provider, email, created })) },
    addIdentity: { run(provider, subject, user_id, email, created) {
      const k = `${provider}:${subject}`;
      if (m.identities[k]) throw new Error('identity taken');
      m.identities[k] = { provider, subject, user_id, email, created };
      return changed();
    } },
    dropIdentity: { run: (uid, provider) => dropWhere('identities', i => i.user_id === uid && i.provider === provider) },

    // Sessions are kept by the hash of the cookie value, never the value itself.
    addSession: { run(token, user_id, expires) { m.sessions[token] = { user_id, expires }; return changed(); } },
    session: { get: (token, now) => { const x = m.sessions[token]; return x && x.expires > now ? user(x.user_id) : undefined; } },
    dropSession: { run: token => dropWhere('sessions', (x, k) => k === token) },
    dropSessions: { run: (uid, keep) => dropWhere('sessions', (x, k) => x.user_id === uid && k !== keep) },
    oldSessions: { run: now => dropWhere('sessions', x => x.expires <= now) },

    folders: { get: uid => (m.folders[uid] ? { data: m.folders[uid] } : undefined) },
    putFolders: { run(uid, data) { m.folders[uid] = data; return changed(); } },

    // The account's own settings by name (the app's saved database connections, query history…).
    userData: { get: uid => ({ ...m.userdata[uid] }) },
    putUserData: { run(uid, name, value) {
      if (value === null) { if (m.userdata[uid]) delete m.userdata[uid][name]; }
      else (m.userdata[uid] ||= {})[name] = value;
      return changed();
    } },

    addShare: { run(token, user_id, file_id, mode, created) { m.shares[token] = { token, user_id, file_id, mode, created }; return changed(); } },
    shares: { all: (uid, id) => Object.values(m.shares).filter(x => x.user_id === uid && x.file_id === id).sort((a, b) => a.created - b.created).map(({ token, mode, created }) => ({ token, mode, created })) },
    share: { get: token => { const x = m.shares[token], u = x && m.users[x.user_id]; return u ? { ...x, owner_name: u.name, owner_email: u.email } : undefined; } },
    dropShare: { run: (token, uid) => dropWhere('shares', (x, k) => k === token && x.user_id === uid) },

    listUsers: { all: () => Object.values(m.users).sort((a, b) => a.created - b.created).map(u => ({ email: u.email, name: u.name, created: u.created, verified: u.verified ?? 1, totp: u.totp_secret ? 1 : 0, files: Object.keys(m.files[u.id] || {}).length, used: used(u.id) })) },
    // An account and everything it owns.
    dropUser: { run(id) {
      if (!m.users[id]) return { changes: 0 };
      for (const fid of Object.keys(m.files[id] || {})) dropFileNow(id, fid);
      for (const key of Object.keys(m.images[id] || {})) removeLater(imageName(id, key));
      for (const list of Object.values(m.runs[id] || {})) for (const r of list) removeLater(`${dirOf(id)}/run.${r.id}.json`);
      delete m.users[id]; delete m.files[id]; delete m.versions[id]; delete m.folders[id]; delete m.ai[id];
      delete m.images[id]; delete m.userdata[id]; delete m.runs[id]; delete m.creds[id];
      for (const table of ['hooks', 'schedules', 'polls']) for (const [k, v] of Object.entries(m[table] || {})) if (v.uid === id) delete m[table][k];
      for (const table of ['sessions', 'tokens', 'identities', 'shares']) dropWhere(table, x => x.user_id === id);
      return changed();
    } },
  };

  /* ---- files and their versions ---- */
  const readText = async name => {
    let t = cache.get(name);
    if (t === undefined) { t = await backend.read(name); if (t != null) cache.set(name, t); }
    return t ?? null;
  };
  const hasFile = (uid, id) => Boolean(m.files[uid]?.[id]);
  const readFile = (uid, id) => (hasFile(uid, id) ? readText(fileName(uid, id)) : Promise.resolve(null));
  // Newest first, as parsed objects.
  const listFiles = async uid => {
    const ids = Object.entries(m.files[uid] || {}).sort((a, b) => b[1].updated - a[1].updated).map(([id]) => id);
    const texts = [];
    for (let i = 0; i < ids.length; i += 8) texts.push(...await Promise.all(ids.slice(i, i + 8).map(id => readFile(uid, id))));
    return texts.filter(Boolean).map(t => JSON.parse(t));
  };

  /* ---- storage: what an account keeps in the backend (files, their versions, pictures), and its limit ---- */
  const used = uid => {
    let n = 0;
    for (const f of Object.values(m.files[uid] || {})) n += f.size || 0;
    for (const list of Object.values(m.versions[uid] || {})) for (const v of list) n += v.size || 0;
    for (const im of Object.values(m.images[uid] || {})) n += im.size || 0;
    for (const list of Object.values(m.runs[uid] || {})) for (const r of list) n += r.size || 0;
    return n;
  };
  const storage = uid => ({ used: used(uid), limit: storageLimit });
  // Room for `extra` more bytes, making it by dropping the oldest versions (never `keep`, the one about
  // to be written). Throws StorageFull, dropping nothing, when even that isn't enough.
  const makeRoom = (uid, extra, keep = null) => {
    if (!storageLimit) return;
    let over = used(uid) + extra - storageLimit;
    if (over <= 0) return;
    const old = Object.values(m.versions[uid] || {}).flatMap(list => list.map(v => ({ list, v })))
      .filter(x => x.v.vid !== keep).sort((a, b) => a.v.saved - b.v.saved);
    if (old.reduce((n, x) => n + (x.v.size || 0), 0) < over) throw new StorageFull(used(uid), storageLimit);
    for (const { list, v } of old) {
      if (over <= 0) break;
      list.splice(list.indexOf(v), 1);
      removeLater(versionName(uid, v.vid));
      over -= v.size || 0;
    }
    saveMeta();
  };

  // Save a file and keep its history: edits within `versionEvery` of the latest version update that
  // version in place, later ones start a new one. So each version is how the file stood at the end of
  // a stretch of editing. Resolves once the file and meta.json are in the backend; false if unchanged.
  const saveFile = async (uid, id, text, updated, now = Date.now()) => {
    const hash = sha(text), before = m.files[uid]?.[id];
    if (before && before.hash === hash) return false;
    let title = '';
    try { title = String(JSON.parse(text).title || ''); } catch (e) { /* the caller checked it */ }
    const list = versionList(uid, id), last = list[0];
    const inPlace = last && now - last.saved < versionEvery;
    makeRoom(uid, text.length - (before?.size || 0) + text.length - (inPlace ? last.size || 0 : 0), inPlace ? last.vid : null);
    let vid;
    if (inPlace) { vid = last.vid; Object.assign(last, { saved: now, size: text.length, title }); }
    else { vid = m.nextVid++; list.unshift({ vid, saved: now, size: text.length, title }); }
    for (const old of list.splice(keepVersions)) removeLater(versionName(uid, old.vid));
    fileIndex(uid)[id] = { updated, hash, size: text.length };
    cache.set(fileName(uid, id), text);
    await Promise.all([
      queue(fileName(uid, id), () => backend.write(fileName(uid, id), text)),
      queue(versionName(uid, vid), () => backend.write(versionName(uid, vid), text)),
      saveMeta(),
    ]);
    return true;
  };
  const dropFile = async (uid, id) => { dropFileNow(uid, id); await flush(); };
  const versions = (uid, id) => (m.versions[uid]?.[id] || []).map(v => ({ ...v }));
  const readVersion = async (uid, id, vid) => {
    const v = (m.versions[uid]?.[id] || []).find(x => x.vid === vid);
    const data = v && await readText(versionName(uid, vid));
    return data ? { data, saved: v.saved } : null;
  };

  /* ---- pictures on canvases: one blob each, read straight from the backend (not kept in memory) ---- */
  const hasImage = (uid, key) => Boolean(m.images[uid]?.[key]);
  const saveImage = async (uid, key, dataUrl, now = Date.now()) => {
    makeRoom(uid, dataUrl.length - (m.images[uid]?.[key]?.size || 0));
    (m.images[uid] ||= {})[key] = { size: dataUrl.length, saved: now };
    await Promise.all([queue(imageName(uid, key), () => backend.write(imageName(uid, key), JSON.stringify({ data: dataUrl }))), saveMeta()]);
  };
  const readImage = async (uid, key) => {
    if (!hasImage(uid, key)) return null;
    const t = await backend.read(imageName(uid, key));
    try { return t ? JSON.parse(t).data : null; } catch (e) { return null; }
  };

  /* ---- AI allowance: count one request against today's (UTC) allowance; false when it's used up ---- */
  const today = now => new Date(now).toISOString().slice(0, 10);
  const aiUsed = (uid, now = Date.now()) => (m.ai[uid]?.day === today(now) ? m.ai[uid].count : 0);
  const useAi = (uid, limit, now = Date.now()) => {
    const used = aiUsed(uid, now);
    if (limit > 0 && used >= limit) return false;
    m.ai[uid] = { day: today(now), count: used + 1 };
    saveMeta();
    return true;
  };

  // Everything asked for so far, written.
  const flush = async () => {
    while (writing || dirty || chains.size) {
      if (dirty && !writing) saveMeta();
      await Promise.allSettled([writing, ...chains.values()]);
      if (dirty && !writing) await saveMeta();
    }
  };

  return {
    s, backend, meta: m,
    hasFile, readFile, listFiles, saveFile, dropFile, versions, readVersion,
    hasImage, saveImage, readImage, storage,
    // For flows.js: meta.json changed; blobs in an account's folder; room for more (or StorageFull).
    touch: () => saveMeta(),
    blob: {
      write: (uid, name, text) => queue(`${dirOf(uid)}/${name}`, () => backend.write(`${dirOf(uid)}/${name}`, text)),
      read: (uid, name) => backend.read(`${dirOf(uid)}/${name}`),
      remove: (uid, name) => removeLater(`${dirOf(uid)}/${name}`),
    },
    room: makeRoom,
    useAi, aiUsed, flush, close: flush,
  };
}
