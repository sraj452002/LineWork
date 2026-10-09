/* Talking to /api/files on the Linework API (../../backend). The session cookie identifies the user. */

const req = async (path, opts = {}) => {
  const res = await fetch('/api/files' + path, { ...opts, headers: { 'content-type': 'application/json', ...(opts.headers || {}) } });
  if (res.status === 401) throw { code: 'signed_out' };
  if (res.status === 413) throw { code: 'too_large' };
  if (!res.ok) throw { code: 'unavailable', status: res.status };
  return res.json();
};

export const listFiles = () => req('').then(r => r.files || []);
export const putFile = file => req('/' + encodeURIComponent(file.id), { method: 'PUT', body: JSON.stringify(file) });
export const removeFile = id => req('/' + encodeURIComponent(id), { method: 'DELETE' });

/* Keeping the account in step with what's on screen.
   Every change is written to this browser first (so nothing is lost offline), then the files whose
   `updated` time moved are uploaded. Uploads and deletes that fail are kept and retried. */
const CACHE = uid => 'linework:cloud:' + uid;

export function loadCache(uid) {
  try {
    const o = JSON.parse(localStorage.getItem(CACHE(uid)) || 'null');
    return o && Array.isArray(o.files) ? o : { files: [], synced: {}, deleted: [] };
  } catch (e) { return { files: [], synced: {}, deleted: [] }; }
}
export function saveCache(uid, state) {
  try { localStorage.setItem(CACHE(uid), JSON.stringify(state)); return true; } catch (e) { return false; }
}

// Combine the account's files with this browser's copy: the newer version of each file wins,
// files deleted here stay deleted, and local files the account hasn't seen yet are kept for upload.
export function merge(remote, cache) {
  const byId = new Map(remote.map(f => [f.id, f]));
  const gone = new Set(cache.deleted || []);
  cache.files.forEach(f => {
    const r = byId.get(f.id), syncedAt = cache.synced[f.id];
    if (!r) { if (syncedAt == null) byId.set(f.id, f); return; } // never uploaded: keep it; uploaded but gone remotely: deleted elsewhere
    if ((f.updated || 0) > (r.updated || 0) && (f.updated || 0) !== syncedAt) byId.set(f.id, f);
  });
  gone.forEach(id => byId.delete(id));
  return [...byId.values()];
}
