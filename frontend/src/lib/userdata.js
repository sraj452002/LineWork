import { api } from './backend.js';

/* The account's own settings, by name (saved database connections, query history…). Signed in, they
   live on the account (GET/PUT /api/userdata, kept in Google Drive): loaded once when the workspace
   opens, read from memory after that, and each change sent back shortly after. Without an account
   (the frontend on its own, the tests) they stay in this browser. */

let remote = false, data = {};
const timers = new Map();

export async function startUserData(signedIn) {
  remote = signedIn;
  data = signedIn ? (await api('/userdata')).data || {} : {};
}

export function getData(name, fallback) {
  if (!remote) {
    try { const v = localStorage.getItem('linework:' + name); return v ? JSON.parse(v) : fallback; } catch (e) { return fallback; }
  }
  return name in data ? data[name] : fallback;
}

// null removes it.
export function setData(name, value) {
  if (!remote) {
    try { if (value === null) localStorage.removeItem('linework:' + name); else localStorage.setItem('linework:' + name, JSON.stringify(value)); } catch (e) {}
    return;
  }
  if (value === null) delete data[name]; else data[name] = value;
  clearTimeout(timers.get(name));
  timers.set(name, setTimeout(() => {
    timers.delete(name);
    api('/userdata/' + encodeURIComponent(name), { method: 'PUT', body: { value } }).catch(e => console.warn('Saving ' + name + ' failed:', e.message || e.code));
  }, 400));
}
