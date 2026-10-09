/* The Linework API (../../backend), reached at /api on this site: Netlify proxies it to the backend's
   host, and Vite does in development. GET /api/server answers when it's there; without it (the
   frontend on its own) the app works without accounts, in this browser. */

// A sleeping backend (a free host spins down when idle) takes up to a minute to wake, and the proxy in
// front of it gives up sooner (Netlify: 26 s) with a 502/503/504: ask again until it answers.
const WAKE_STATUS = [502, 503, 504], WAKE_FOR = 120_000;
const askServer = async () => {
  const until = Date.now() + WAKE_FOR;
  for (;;) {
    const r = await fetch('/api/server', { cache: 'no-store' });
    if (!WAKE_STATUS.includes(r.status) || Date.now() > until) return r;
    await new Promise(res => setTimeout(res, 3000));
  }
};
let info;
export function serverInfo() {
  if (info === undefined) {
    info = askServer()
      .then(r => (r.ok && (r.headers.get('content-type') || '').includes('json') ? r.json() : null))
      .then(j => (j && j.name === 'linework-server' ? j : null))
      .catch(() => null);
  }
  return info;
}
export const hasFeature = async f => ((await serverInfo())?.features || []).includes(f);

// JSON request to the server. Errors are thrown as {status, code, message}.
export async function api(path, { method = 'GET', body } = {}) {
  let res;
  try {
    res = await fetch('/api' + path, {
      method, cache: 'no-store',
      headers: body !== undefined || method !== 'GET' ? { 'content-type': 'application/json' } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch (e) { throw { status: 0, code: 'offline', message: 'Can’t reach the server. Check your connection.' }; }
  const j = await res.json().catch(() => null);
  if (!res.ok) throw { status: res.status, code: (j && j.error) || 'unavailable', message: j && j.message };
  return j;
}

// The server's user, in the shape the rest of the app uses.
export const asUser = u => ({ id: u.id, email: u.email, name: u.name, userMetadata: { full_name: u.name, folders: u.folders || [] } });

/* Version history */
export const listVersions = id => api(`/files/${encodeURIComponent(id)}/versions`).then(r => r.versions);
export const getVersion = (id, vid) => api(`/files/${encodeURIComponent(id)}/versions/${vid}`);

/* Share links */
export const listShares = id => api(`/files/${encodeURIComponent(id)}/shares`).then(r => r.shares);
export const addShare = (id, mode) => api(`/files/${encodeURIComponent(id)}/shares`, { method: 'POST', body: { mode } });
export const removeShare = token => api(`/shares/${encodeURIComponent(token)}`, { method: 'DELETE' });
export const openShared = token => api(`/shared/${encodeURIComponent(token)}`);
export const saveShared = (token, file) => api(`/shared/${encodeURIComponent(token)}`, { method: 'PUT', body: file });
// A share link's token, when the page was opened from one (/s/<token>).
export const sharedToken = () => (location.pathname.match(/^\/s\/([\w-]{20,})\/?$/) || [])[1] || null;
