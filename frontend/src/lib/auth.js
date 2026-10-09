import { api, asUser, serverInfo } from './backend.js';

/* Two ways to use Workline:
   - 'cloud': signed in to an account on the Workline API (../../backend). Files are saved to it (see cloud.js).
   - 'local': no account. Files stay in this browser only (and AI is off, since it costs money per request).
     Only where the API isn't there (the frontend on its own, the tests), or it allows it (ALLOW_LOCAL_MODE). */

const LOCAL = 'linework:local-mode';

// Whether accounts are available here; null when the API isn't.
// allowLocal: whether "Continue without an account" is offered alongside them.
export async function accountSettings() {
  const srv = await serverInfo();
  return srv ? { server: true, autoconfirm: !srv.mail, providers: srv.providers || {}, signup: srv.signup, mail: srv.mail, allowLocal: srv.allowLocal } : null;
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

// Finish any sign-in link (email confirmation, Google/GitHub, password reset), then work out who's
// here. Returns {mode, user?, pending?, notice?}, or null when nobody is signed in.
// pending: {type: 'recovery' | 'mfa', token} — a step still to do on the sign-in screen.
export async function startSession() {
  if (!(await serverInfo())) return (await localAllowed()) ? { mode: 'local' } : null;
  const h = takeHash();
  let notice = h.auth_error ? AUTH_ERRORS[h.auth_error] || 'Sign-in didn’t work. Try again.' : null;
  if (h.account) notice = h.account === 'taken' ? 'That account is already connected to a different Workline account.' : `Connected ${/github/.test(h.account) ? 'GitHub' : 'Google'}. You can sign in with it now.`;
  if (h.reset) return { mode: null, pending: { type: 'recovery', token: h.reset } };
  if (h.mfa) return { mode: null, pending: { type: 'mfa', token: h.mfa } };
  if (h.verify) {
    try {
      const r = await api('/auth/verify', { method: 'POST', body: { token: h.verify } });
      if (r.mfa) return { mode: null, pending: { type: 'mfa', token: r.mfa } };
      return { mode: 'cloud', user: asUser(r.user), notice: 'Your email is confirmed. Welcome to Workline!' };
    } catch (e) { notice = e.message || 'That link didn’t work.'; }
  }
  try { return { mode: 'cloud', user: asUser((await api('/auth/me')).user), notice }; }
  catch (e) { /* signed out */ }
  if (await localAllowed()) return { mode: 'local' };
  return notice ? { mode: null, notice } : null;
}

export const chooseLocal = () => { try { localStorage.setItem(LOCAL, '1'); } catch (e) {} };

// The server's answers: the account ({user}), or {mfa} when a code from the authenticator app is
// needed next, or {pending: 'verify'} when the email needs confirming first.
const signedIn = r => (r.user ? asUser(r.user) : r);

export const signIn = async (email, password) => signedIn(await api('/auth/login', { method: 'POST', body: { email, password } }));
export const createAccount = async (email, password, name) => signedIn(await api('/auth/signup', { method: 'POST', body: { email, password, name } }));
export const verifyCode = async (challenge, code) => signedIn(await api('/auth/2fa/verify', { method: 'POST', body: { challenge, code } }));
export const resendConfirmation = email => api('/auth/resend', { method: 'POST', body: { email } });

export const signInWith = provider => { location.href = `/api/auth/oauth/${encodeURIComponent(provider)}`; };
export const sendPasswordReset = email => api('/auth/forgot', { method: 'POST', body: { email } });
// A new password, from a reset link.
export const setPassword = async (password, token) => signedIn(await api('/auth/reset', { method: 'POST', body: { token, password } }));
// Profile changes: {full_name} and {folders}. The server keeps folders on their own.
export async function saveProfile(data) {
  if (data.folders) await api('/folders', { method: 'PUT', body: { folders: data.folders } });
  if (data.full_name !== undefined) await api('/auth/me', { method: 'PATCH', body: { name: data.full_name } });
}

export async function signOut(mode) {
  try { localStorage.removeItem(LOCAL); } catch (e) {}
  if (mode === 'cloud') { try { await api('/auth/logout', { method: 'POST' }); } catch (e) {} }
}

// Friendly text for errors.
export function authMessage(e) {
  if (e && e.code && e.message) return e.message; // the server's own wording
  const s = e && e.status;
  const m = String((e && e.message) || '').toLowerCase();
  if (s === 400 && /invalid|password|grant/.test(m)) return 'That email and password don’t match.';
  if (/not confirmed|confirm/.test(m)) return 'Confirm your email first: open the link we sent you.';
  if (/already|registered|exists/.test(m)) return 'There’s already an account with that email. Sign in instead.';
  if (/signup.*disabled|disabled/.test(m)) return 'New accounts are by invitation only.';
  if (s === 429) return 'Too many tries. Wait a minute, then try again.';
  if (/password/.test(m) && /short|least|weak/.test(m)) return 'Use a longer password (at least 8 characters).';
  return (e && e.message) || 'That didn’t work. Try again.';
}
