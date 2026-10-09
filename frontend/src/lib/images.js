import { useEffect, useState } from 'react';
import { rid } from './utils.js';
import { api } from './backend.js';

/* Shapes keep only a key ({img}); the picture itself is kept apart. Signed in, that's on the account
   (PUT/GET /api/images/:key, in Google Drive), and pictures left in this browser by earlier versions
   move there the first time they're shown. Without an account (the frontend on its own, the tests),
   they're in IndexedDB, which has far more room than localStorage. Older files, a shared file's own
   additions, and browsers without IndexedDB keep the data inline ({src}). */
let remote = false, share = null;
// On a share link's page (share: its token), pictures come from the file owner's account.
export function imagesOnServer(on, shareToken = null) { remote = on; share = shareToken; }
const DB = 'linework', STORE = 'images';
let dbP = null;
function db() {
  if (!dbP) dbP = new Promise((res, rej) => {
    if (typeof indexedDB === 'undefined') { rej(new Error('IndexedDB unavailable')); return; }
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE);
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
  return dbP;
}
const done = r => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
const store = async mode => (await db()).transaction(STORE, mode).objectStore(STORE);

const cache = new Map(), missing = new Set(), pending = new Set(), subs = new Set(), mine = new Set();
const notify = () => subs.forEach(f => f());

// The data URL to draw for an image shape, or null while it loads or if it's gone.
export const imageSrc = s => s.src || cache.get(s.img) || null;
export const imageMissing = s => !s.src && missing.has(s.img);
export const imageKeys = shapes => (shapes || []).filter(s => s.t === 'image' && s.img).map(s => s.img);

// Returns the new key, or null when it can't be kept apart (the caller keeps it inline then).
export async function saveImage(dataUrl) {
  if (share) return null; // a shared file's additions stay in the file: the owner's account isn't ours
  try {
    const key = rid('img');
    if (remote) await api('/images/' + key, { method: 'PUT', body: { data: dataUrl } });
    else await done((await store('readwrite')).put(dataUrl, key));
    cache.set(key, dataUrl);
    mine.add(key);
    return key;
  } catch (e) {
    return null;
  }
}

const localImage = async k => { try { return (await done((await store('readonly')).get(k))) || null; } catch (e) { return null; } };
// From the account; a picture still only in this browser (from before) is moved there.
async function fetchImage(k) {
  try { return (await api('/images/' + encodeURIComponent(k) + (share ? '?share=' + encodeURIComponent(share) : ''))).data; }
  catch (e) {
    if (e.status !== 404 || share) return null;
    const data = await localImage(k);
    if (!data) return null;
    await api('/images/' + encodeURIComponent(k), { method: 'PUT', body: { data } });
    try { await done((await store('readwrite')).delete(k)); } catch (err) { /* it's on the account now */ }
    return data;
  }
}

export async function loadImages(keys) {
  const need = [...new Set(keys)].filter(k => !cache.has(k) && !missing.has(k) && !pending.has(k));
  if (!need.length) return;
  need.forEach(k => pending.add(k));
  try {
    const vals = remote ? await Promise.all(need.map(k => fetchImage(k).catch(() => null)))
      : await (async () => { const st = await store('readonly'); return Promise.all(need.map(k => done(st.get(k)))); })();
    need.forEach((k, i) => { if (vals[i]) cache.set(k, vals[i]); else missing.add(k); });
  } catch (e) {
    need.forEach(k => missing.add(k));
  } finally {
    need.forEach(k => pending.delete(k));
    notify();
  }
}

// Loads the images these shapes use and returns a number that changes when any arrive.
export function useImages(shapes) {
  const [v, setV] = useState(0);
  useEffect(() => {
    const f = () => setV(n => n + 1);
    subs.add(f);
    return () => { subs.delete(f); };
  }, []);
  const sig = imageKeys(shapes).join(',');
  useEffect(() => { if (sig) loadImages(sig.split(',')); }, [sig]);
  return v;
}

const allShapes = files => files.flatMap(f => f.diagrams.flatMap(d => d.shapes || []));
const keyTime = k => parseInt(k.slice(3, -5), 36) || 0;

// Without an account, on startup: move inline images into IndexedDB, then delete stored images no
// file uses. Returns a Map of shape id -> new key for the moved images (empty if nothing moved).
// Signed in, inline images stay in their files, which are on the account already.
export async function tidyImages(getFiles) {
  const moved = new Map();
  if (remote) return moved;
  try { await db(); } catch (e) { return moved; }
  for (const s of allShapes(getFiles())) {
    if (s.t === 'image' && s.src && !s.img) {
      const k = await saveImage(s.src);
      if (k) moved.set(s.id, k);
    }
  }
  try {
    const used = new Set([...imageKeys(allShapes(getFiles())), ...moved.values()]);
    const keys = await done((await store('readonly')).getAllKeys());
    // Skip anything recent: another open tab may have just added it.
    const old = keys.filter(k => !used.has(k) && !mine.has(k) && Date.now() - keyTime(k) > 36e5);
    if (old.length) { const st = await store('readwrite'); old.forEach(k => st.delete(k)); }
  } catch (e) { /* cleanup is best effort */ }
  return moved;
}
