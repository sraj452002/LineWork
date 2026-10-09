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
