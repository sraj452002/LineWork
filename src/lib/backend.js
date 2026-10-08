/* The Linework server (server/), when the app is served by it instead of Netlify.
   GET /api/server answers only there; on Netlify (and with no backend at all) the app uses Netlify
   Identity and functions, or this browser. */

let info;
export function serverInfo() {
  if (info === undefined) {
    info = fetch('/api/server', { cache: 'no-store' })
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

// The server's user, shaped like a Netlify Identity user so the rest of the app needn't care.
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
