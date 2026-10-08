import {
  AuthError, getSettings, getUser, handleAuthCallback, login, logout, oauthLogin,
  requestPasswordRecovery, signup, updateUser, acceptInvite,
} from '@netlify/identity';
import { googleReturn, restoreGoogle, signOutGoogle } from './gdrive.js';

/* Three ways to use Linework:
   - 'cloud': signed in with Netlify Identity. Files are saved to the account (see cloud.js).
   - 'drive': signed in with Google. Files are saved to the person's Google Drive (see gdrive.js).
   - 'local': no account. Files stay in this browser only (and AI is off, since it costs money per request).
   Identity only works on a deployed site, so local development and the tests use 'local'. */

const LOCAL = 'linework:local-mode';
// Read once at load: what Google's sign-in page sent back (?google=…), before the URL is tidied.
const GOOGLE_BACK = googleReturn();

// Whether accounts are available here; null when they aren't (local dev, or Identity not enabled).
export async function accountSettings() {
  // Off Netlify (e.g. the Vite dev server) the settings URL answers with the app's HTML, so check its shape.
  try {
    const s = await getSettings();
    // getSettings() fills in defaults, so look for a field only a real Identity response sets.
    return s && typeof s.autoconfirm === 'boolean' ? s : null;
  } catch (e) { return null; }
}

// Finish any sign-in link (email confirmation, Google/GitHub, password reset, invite), then
// work out who's here. Returns {mode, user?, pending?}, {mode: null, notice} after a Google
// sign-in that didn't finish, or null when nobody is signed in.
export async function startSession() {
  const google = GOOGLE_BACK;
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
  const g = await restoreGoogle();
  if (g) return { mode: 'drive', user: g };
  if (google && google !== 'signed_in') return { mode: null, notice: google };
  if (pending && pending.type === 'invite') return { mode: null, pending };
  try { if (localStorage.getItem(LOCAL) === '1') return { mode: 'local' }; } catch (e) {}
  return null;
}

export const chooseLocal = () => { try { localStorage.setItem(LOCAL, '1'); } catch (e) {} };

export async function signIn(email, password) { return login(email.trim(), password); }
export async function createAccount(email, password, name) {
  return signup(email.trim(), password, name ? { full_name: name.trim() } : undefined);
}
export const signInWith = provider => oauthLogin(provider);
export const sendPasswordReset = email => requestPasswordRecovery(email.trim());
export const setPassword = password => updateUser({ password });
export const finishInvite = (token, password) => acceptInvite(token, password);
export const saveProfile = data => updateUser({ data });

export async function signOut(mode) {
  try { localStorage.removeItem(LOCAL); } catch (e) {}
  if (mode === 'cloud') { try { await logout(); } catch (e) {} }
  if (mode === 'drive') await signOutGoogle();
}

// Friendly text for Identity errors.
export function authMessage(e) {
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
