import {
  AuthError, getSettings, getUser, handleAuthCallback, login, logout, oauthLogin,
  requestPasswordRecovery, signup, updateUser, acceptInvite,
} from '@netlify/identity';
import { api, asUser, serverInfo } from './backend.js';

/* Two ways to use Linework:
   - 'cloud': signed in to an account. Files are saved to it (see cloud.js). Accounts are Netlify Identity
     on Netlify, or the Linework server's own (server/) when the app is served from there.
   - 'local': no account. Files stay in this browser only (and AI is off, since it costs money per request).
   Identity only works on a deployed site, so local development and the tests use 'local'. */

const LOCAL = 'linework:local-mode';

// Whether accounts are available here; null when they aren't (local dev, or Identity not enabled).
export async function accountSettings() {
  const srv = await serverInfo();
  if (srv) return { server: true, autoconfirm: true, providers: {}, signup: srv.signup };
  // Off Netlify (e.g. the Vite dev server) the settings URL answers with the app's HTML, so check its shape.
  try {
    const s = await getSettings();
    // getSettings() fills in defaults, so look for a field only a real Identity response sets.
    return s && typeof s.autoconfirm === 'boolean' ? s : null;
  } catch (e) { return null; }
}

// Finish any sign-in link (email confirmation, Google/GitHub, password reset, invite), then
// work out who's here. Returns {mode, user?, pending?}, or null when nobody is signed in.
export async function startSession() {
  if (await serverInfo()) {
    try { return { mode: 'cloud', user: asUser((await api('/auth/me')).user) }; }
    catch (e) { /* signed out */ }
    try { if (localStorage.getItem(LOCAL) === '1') return { mode: 'local' }; } catch (e) {}
    return null;
  }
  let pending = null;
  try {
    const cb = await handleAuthCallback();
    // A password reset or invite link signs the person in but still needs a new password.
    if (cb && (cb.type === 'recovery' || cb.type === 'invite')) pending = { type: cb.type, token: cb.token };
  } catch (e) { /* no link in the URL, or Identity unavailable */ }
  try {
    const user = await getUser();
    if (user) return { mode: 'cloud', user, pending };
  } catch (e) { /* Identity unavailable */ }
  if (pending && pending.type === 'invite') return { mode: null, pending };
  try { if (localStorage.getItem(LOCAL) === '1') return { mode: 'local' }; } catch (e) {}
  return null;
}

export const chooseLocal = () => { try { localStorage.setItem(LOCAL, '1'); } catch (e) {} };

export async function signIn(email, password) {
  if (await serverInfo()) return asUser((await api('/auth/login', { method: 'POST', body: { email, password } })).user);
  return login(email.trim(), password);
}
export async function createAccount(email, password, name) {
  if (await serverInfo()) return asUser((await api('/auth/signup', { method: 'POST', body: { email, password, name } })).user);
  return signup(email.trim(), password, name ? { full_name: name.trim() } : undefined);
}
export const signInWith = provider => oauthLogin(provider);
export const sendPasswordReset = email => requestPasswordRecovery(email.trim());
export const setPassword = password => updateUser({ password });
export const finishInvite = (token, password) => acceptInvite(token, password);
// Profile changes: {full_name} and {folders}. The server keeps folders on their own.
export async function saveProfile(data) {
  if (!(await serverInfo())) return updateUser({ data });
  if (data.folders) await api('/folders', { method: 'PUT', body: { folders: data.folders } });
  if (data.full_name !== undefined) await api('/auth/me', { method: 'PATCH', body: { name: data.full_name } });
}

export async function signOut(mode) {
  try { localStorage.removeItem(LOCAL); } catch (e) {}
  if (mode === 'cloud') {
    if (await serverInfo()) { try { await api('/auth/logout', { method: 'POST' }); } catch (e) {} }
    else { try { await logout(); } catch (e) {} }
  }
}

// Friendly text for Identity errors.
export function authMessage(e) {
  if (e && e.code && e.message && !(e instanceof AuthError)) return e.message; // the server's own wording
  const s = e instanceof AuthError ? e.status : e && e.status;
  const m = String((e && e.message) || '').toLowerCase();
  if (s === 400 && /invalid|password|grant/.test(m)) return 'That email and password don’t match.';
  if (/not confirmed|confirm/.test(m)) return 'Confirm your email first: open the link we sent you.';
  if (/already|registered|exists/.test(m)) return 'There’s already an account with that email. Sign in instead.';
  if (/signup.*disabled|disabled/.test(m)) return 'New accounts are by invitation only.';
  if (s === 429) return 'Too many tries. Wait a minute, then try again.';
  if (/password/.test(m) && /short|least|weak/.test(m)) return 'Use a longer password (at least 8 characters).';
  return (e && e.message) || 'That didn’t work. Try again.';
}
