import {
  AuthError, getSettings, getUser, handleAuthCallback, login, logout, oauthLogin,
  requestPasswordRecovery, signup, updateUser, acceptInvite,
} from '@netlify/identity';
import { api, asUser, serverInfo } from './backend.js';

/* Two ways to use Linework:
   - 'cloud': signed in to an account. Files are saved to it (see cloud.js). Accounts are Netlify Identity
     on Netlify, or the Linework server's own (server/) when the app is served from there.
   - 'local': no account. Files stay in this browser only (and AI is off, since it costs money per request).
     Only where accounts aren't available (local development, the tests), or the site allows it:
     ALLOW_LOCAL_MODE on the server, VITE_ALLOW_LOCAL_MODE when building for Netlify. */

const LOCAL = 'linework:local-mode';
const NETLIFY_LOCAL = import.meta.env.VITE_ALLOW_LOCAL_MODE === 'true';

// Whether accounts are available here; null when they aren't (local dev, or Identity not enabled).
// allowLocal: whether "Continue without an account" is offered alongside them.
export async function accountSettings() {
  const srv = await serverInfo();
  if (srv) return { server: true, autoconfirm: !srv.mail, providers: srv.providers || {}, signup: srv.signup, mail: srv.mail, allowLocal: srv.allowLocal };
  // Off Netlify (e.g. the Vite dev server) the settings URL answers with the app's HTML, so check its shape.
  try {
    const s = await getSettings();
    // getSettings() fills in defaults, so look for a field only a real Identity response sets.
    return s && typeof s.autoconfirm === 'boolean' ? { ...s, mail: true, allowLocal: NETLIFY_LOCAL } : null;
  } catch (e) { return null; }
}
const localAllowed = async () => {
  try { if (localStorage.getItem(LOCAL) !== '1') return false; } catch (e) { return false; }
  const s = await accountSettings();
  return !s || s.allowLocal;
};

// What the server's email links and Google/GitHub sign-in hand back, in the address's #fragment.
function takeHash() {
  const h = new URLSearchParams(location.hash.slice(1));
  const keys = ['verify', 'reset', 'mfa', 'auth_error', 'account'];
  const out = Object.fromEntries(keys.filter(k => h.has(k)).map(k => [k, h.get(k)]));
  if (Object.keys(out).length) history.replaceState(null, '', location.pathname + location.search);
  return out;
}
const AUTH_ERRORS = {
  state: 'That sign-in took too long or came from somewhere else. Try again.',
  cancelled: 'Sign-in was cancelled.',
  provider: 'Couldn’t reach Google or GitHub. Try again.',
  no_email: 'That account has no verified email address, so it can’t be used here.',
  signup_disabled: 'New accounts are by invitation only.',
  provider_off: 'That way of signing in isn’t set up here.',
  signed_out: 'Sign in first, then connect the account.',
};

// Finish any sign-in link (email confirmation, Google/GitHub, password reset, invite), then
// work out who's here. Returns {mode, user?, pending?, notice?}, or null when nobody is signed in.
// pending: {type: 'recovery' | 'invite' | 'mfa', token} — a step still to do on the sign-in screen.
export async function startSession() {
  if (await serverInfo()) {
    const h = takeHash();
    let notice = h.auth_error ? AUTH_ERRORS[h.auth_error] || 'Sign-in didn’t work. Try again.' : null;
    if (h.account) notice = h.account === 'taken' ? 'That account is already connected to a different Linework account.' : `Connected ${/github/.test(h.account) ? 'GitHub' : 'Google'}. You can sign in with it now.`;
    if (h.reset) return { mode: null, pending: { type: 'recovery', token: h.reset } };
    if (h.mfa) return { mode: null, pending: { type: 'mfa', token: h.mfa } };
    if (h.verify) {
      try {
        const r = await api('/auth/verify', { method: 'POST', body: { token: h.verify } });
        if (r.mfa) return { mode: null, pending: { type: 'mfa', token: r.mfa } };
        return { mode: 'cloud', user: asUser(r.user), notice: 'Your email is confirmed. Welcome to Linework!' };
      } catch (e) { notice = e.message || 'That link didn’t work.'; }
    }
    try { return { mode: 'cloud', user: asUser((await api('/auth/me')).user), notice }; }
    catch (e) { /* signed out */ }
    if (await localAllowed()) return { mode: 'local' };
    return notice ? { mode: null, notice } : null;
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
  if (await localAllowed()) return { mode: 'local' };
  return null;
}

export const chooseLocal = () => { try { localStorage.setItem(LOCAL, '1'); } catch (e) {} };

// The server's answers: the account ({user}), or {mfa} when a code from the authenticator app is
// needed next, or {pending: 'verify'} when the email needs confirming first.
const signedIn = r => (r.user ? asUser(r.user) : r);

export async function signIn(email, password) {
  if (await serverInfo()) return signedIn(await api('/auth/login', { method: 'POST', body: { email, password } }));
  return login(email.trim(), password);
}
export async function createAccount(email, password, name) {
  if (await serverInfo()) return signedIn(await api('/auth/signup', { method: 'POST', body: { email, password, name } }));
  return signup(email.trim(), password, name ? { full_name: name.trim() } : undefined);
}
export const verifyCode = async (challenge, code) => signedIn(await api('/auth/2fa/verify', { method: 'POST', body: { challenge, code } }));
export const resendConfirmation = email => api('/auth/resend', { method: 'POST', body: { email } });

export async function signInWith(provider) {
  if (await serverInfo()) { location.href = `/api/auth/oauth/${encodeURIComponent(provider)}`; return; }
  return oauthLogin(provider);
}
export async function sendPasswordReset(email) {
  if (await serverInfo()) return api('/auth/forgot', { method: 'POST', body: { email } });
  return requestPasswordRecovery(email.trim());
}
// A new password: from a reset link (token), or for the signed-in account.
export async function setPassword(password, token) {
  if (await serverInfo()) return signedIn(await api('/auth/reset', { method: 'POST', body: { token, password } }));
  return updateUser({ password });
}
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
