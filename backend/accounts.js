import QRCode from 'qrcode';
import { DUMMY, SESSION_DAYS, checkPassword, hashPassword, limiter, newId, newToken, sessionCookie, readCookie, tokenHash } from './auth.js';
import { linkEmail } from './mail.js';
import * as oauth from './oauth.js';
import { checkCode, newRecoveryCodes, newSecret, normRecovery, otpauthUri } from './totp.js';

/* Accounts on the Linework server:
   - email and password, with the address confirmed by an emailed link (when email is set up);
   - forgotten passwords reset by an emailed link;
   - "Continue with Google / GitHub", linked to an existing account with the same verified email;
   - optional two-step verification: a code from an authenticator app (or a recovery code) after the
     password or Google/GitHub, before the session starts. */

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const HOUR = 3600_000;
const OAUTH_COOKIE = 'lw_oauth';
const msg = (res, status, error, message, extra = {}) => res.status(status).json({ error, message, ...extra });

/* Accounts the server makes when it starts, if they aren't there yet (DEFAULT_USERS):
   "ada@example.com:first password, grace@example.com:second password". An account that's already
   there is left alone, so a password changed in the app stays changed. Returns the emails it made. */
export async function ensureUsers(store, spec = '') {
  const { s } = store, made = [];
  for (const entry of String(spec).split(',').map(e => e.trim()).filter(Boolean)) {
    const i = entry.indexOf(':');
    const email = entry.slice(0, i).trim().toLowerCase(), password = entry.slice(i + 1);
    if (i < 1 || !EMAIL.test(email)) throw new Error(`DEFAULT_USERS: "${entry.slice(0, 40)}" isn't email:password.`);
    if (password.length < 8) throw new Error(`DEFAULT_USERS: the password for ${email} needs at least 8 characters.`);
    if (s.userByEmail.get(email)) continue;
    s.addUser.run(newId(), email, email.split('@')[0], await hashPassword(password), Date.now(), 1);
    made.push(email);
  }
  await store.flush();
  return made;
}

export function accountRoutes(api, { store, mailer, allowSignup, requireVerified, oauthConfig, appUrl, signedIn }) {
  const { s } = store;
  const byEmail = limiter({ max: 10 }), byIp = limiter({ max: 50 });  // failed sign-ins
  const mails = limiter({ max: 5, windowMs: HOUR });                    // emails sent per address
  const codes = limiter({ max: 10 });                                   // wrong 2-step codes per account
  const idps = oauth.providers(oauthConfig);
  const base = req => (appUrl || `${req.protocol}://${req.headers.host}`).replace(/\/$/, '');

  const info = () => ({
    signup: allowSignup,
    mail: mailer.configured,
    providers: Object.fromEntries(Object.values(idps).map(p => [p.id, p.name])),
  });

  const startSession = (req, res, user) => {
    const t = newToken();
    s.addSession.run(tokenHash(t), user.id, Date.now() + SESSION_DAYS * 86400_000);
    res.append('Set-Cookie', sessionCookie(req, t, SESSION_DAYS * 86400));
  };
  const me = u => ({ user: {
    id: u.id, email: u.email, name: u.name, created: u.created,
    folders: JSON.parse(s.folders.get(u.id)?.data || '[]'),
    hasPassword: Boolean(u.pass), totp: Boolean(u.totp_secret),
    identities: s.identities.all(u.id).map(i => ({ provider: i.provider, email: i.email })),
    storage: store.storage(u.id),
  } });
  const newSecretToken = (user, kind, ttl) => {
    const t = newToken();
    s.addToken.run(tokenHash(t), user.id, kind, Date.now() + ttl);
    return t;
  };
  // Signed in, unless two-step verification is on: then a short-lived challenge for the code.
  const finishSignIn = (req, res, user, status = 200) => {
    if (user.totp_secret) return res.status(status).json({ mfa: newSecretToken(user, 'mfa', 10 * 60_000) });
    startSession(req, res, user);
    res.status(status).json(me(user));
  };

  const sendLink = async (req, user, kind) => {
    if (!mailer.configured || mails.blocked(user.email)) return;
    mails.fail(user.email);
    s.dropTokens.run(user.id, kind);
    const t = newSecretToken(user, kind, kind === 'verify' ? 48 * HOUR : HOUR);
    const url = `${base(req)}/#${kind}=${t}`;
    const m = kind === 'verify'
      ? linkEmail({ title: 'Confirm your email for Linework', intro: `Hi${user.name ? ' ' + user.name.split(' ')[0] : ''}, open this link to confirm ${user.email} and start using Linework.`, button: 'Confirm my email', url, outro: 'The link works for 48 hours. If you didn’t create an account, ignore this email.' })
      : linkEmail({ title: 'Reset your Linework password', intro: `Someone (hopefully you) asked to reset the password for ${user.email}.`, button: 'Choose a new password', url, outro: 'The link works for one hour, once. If you didn’t ask, ignore this email: your password stays the same.' });
    try { await mailer.send({ to: user.email, ...m }); }
    catch (e) { console.error('Email failed:', e.message); }
  };
  const useToken = (raw, kind) => {
    const row = raw && s.token.get(tokenHash(String(raw)), kind, Date.now());
    if (row) s.dropToken.run(row.token);
    return row ? s.userById.get(row.user_id) : null;
  };

  /* ---- email and password ---- */
  api.post('/auth/signup', async (req, res) => {
    if (!allowSignup) return msg(res, 403, 'signup_disabled', 'New accounts are by invitation only.');
    const email = String(req.body?.email || '').trim().toLowerCase(), password = String(req.body?.password || ''), name = String(req.body?.name || '').trim().slice(0, 80);
    if (!EMAIL.test(email) || email.length > 200) return msg(res, 400, 'bad_email', 'Enter a valid email address.');
    if (password.length < 8 || password.length > 200) return msg(res, 400, 'weak_password', 'Use a longer password (at least 8 characters).');
    if (s.userByEmail.get(email)) return msg(res, 409, 'exists', 'There’s already an account with that email. Sign in instead.');
    const user = { id: newId(), email, name, pass: await hashPassword(password), created: Date.now(), verified: requireVerified ? 0 : 1 };
    s.addUser.run(user.id, user.email, user.name, user.pass, user.created, user.verified);
    if (requireVerified) { await sendLink(req, user, 'verify'); return res.status(202).json({ pending: 'verify', email }); }
    startSession(req, res, user);
    res.status(201).json(me(s.userById.get(user.id)));
  });

  api.post('/auth/login', async (req, res) => {
    const email = String(req.body?.email || '').trim().toLowerCase(), password = String(req.body?.password || '');
    if (byEmail.blocked(email) || byIp.blocked(req.ip)) return msg(res, 429, 'too_many', 'Too many tries. Wait a few minutes, then try again.');
    const user = s.userByEmail.get(email);
    const ok = await checkPassword(password, user && user.pass ? user.pass : DUMMY);
    if (!user || !ok) {
      byEmail.fail(email); byIp.fail(req.ip);
      if (user && !user.pass && s.identities.all(user.id).length) return msg(res, 400, 'use_provider', `This account signs in with ${s.identities.all(user.id).map(i => idps[i.provider]?.name || i.provider).join(' or ')}. Use that button, or reset the password to set one.`);
      return msg(res, 400, 'bad_login', 'That email and password don’t match.');
    }
    byEmail.clear(email);
    if (requireVerified && !user.verified) return msg(res, 403, 'unverified', `Confirm your email first: open the link we sent to ${user.email}.`);
    finishSignIn(req, res, user);
  });

  api.post('/auth/resend', async (req, res) => {
    const user = s.userByEmail.get(String(req.body?.email || '').trim().toLowerCase());
    if (user && !user.verified) await sendLink(req, user, 'verify');
    res.json({ ok: true });
  });
  api.post('/auth/verify', (req, res) => {
    const user = useToken(req.body?.token, 'verify');
    if (!user) return msg(res, 400, 'bad_token', 'That confirmation link has expired or was already used. Sign in to get a new one.');
    s.setVerified.run(user.id);
    finishSignIn(req, res, s.userById.get(user.id));
  });

  // Forgotten password: always the same answer, so it doesn't reveal who has an account.
  api.post('/auth/forgot', async (req, res) => {
    if (!mailer.configured) return msg(res, 501, 'no_mail', 'This server can’t send email. Ask whoever runs it to reset your password.');
    const user = s.userByEmail.get(String(req.body?.email || '').trim().toLowerCase());
    if (user) await sendLink(req, user, 'reset');
    res.json({ ok: true });
  });
  api.post('/auth/reset', async (req, res) => {
    const password = String(req.body?.password || '');
    if (password.length < 8 || password.length > 200) return msg(res, 400, 'weak_password', 'Use a longer password (at least 8 characters).');
    const user = useToken(req.body?.token, 'reset');
    if (!user) return msg(res, 400, 'bad_token', 'That reset link has expired or was already used. Ask for a new one.');
    s.setPass.run(await hashPassword(password), user.id);
    s.setVerified.run(user.id); // they opened an email sent to the address
    s.dropSessions.run(user.id, '');
    finishSignIn(req, res, s.userById.get(user.id));
  });

  /* ---- two-step verification ---- */
  // A code from the app, or a recovery code (used up). Returns true when it's right.
  const checkSecondFactor = (user, code) => {
    const step = checkCode(user.totp_secret, code, user.totp_last);
    if (step != null) return s.useTotpStep.run(step, user.id, step).changes === 1;
    const hashes = JSON.parse(user.recovery || '[]'), h = tokenHash(normRecovery(code));
    if (!normRecovery(code) || !hashes.includes(h)) return false;
    s.setRecovery.run(JSON.stringify(hashes.filter(x => x !== h)), user.id);
    return true;
  };

  api.post('/auth/2fa/verify', (req, res) => {
    const raw = String(req.body?.challenge || '');
    const row = raw && s.token.get(tokenHash(raw), 'mfa', Date.now());
    if (!row) return msg(res, 400, 'bad_challenge', 'That took too long. Sign in again.');
    const user = s.userById.get(row.user_id);
    if (row.tries >= 5 || codes.blocked(user.id)) { s.dropToken.run(row.token); return msg(res, 429, 'too_many', 'Too many wrong codes. Sign in again in a few minutes.'); }
    if (!checkSecondFactor(user, req.body?.code)) {
      s.tryToken.run(row.token); codes.fail(user.id);
      return msg(res, 400, 'bad_code', 'That code isn’t right. Use the current code from your app, or a recovery code.');
    }
    s.dropToken.run(row.token);
    startSession(req, res, user);
    res.json(me(user));
  });

  api.post('/auth/2fa/setup', signedIn, async (req, res) => {
    if (req.user.totp_secret) return msg(res, 409, 'already_on', 'Two-step verification is already on.');
    const secret = newSecret();
    s.setPendingTotp.run(secret, req.user.id);
    const uri = otpauthUri(secret, req.user.email);
    res.json({ secret, uri, qr: await QRCode.toString(uri, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' }) });
  });
  api.post('/auth/2fa/enable', signedIn, (req, res) => {
    const pending = req.user.totp_pending;
    if (!pending) return msg(res, 400, 'no_setup', 'Start the setup again.');
    const step = checkCode(pending, req.body?.code, 0);
    if (step == null) return msg(res, 400, 'bad_code', 'That code isn’t right. Check the time on your phone, and use the newest code.');
    const recovery = newRecoveryCodes();
    s.enableTotp.run(step, JSON.stringify(recovery.map(c => tokenHash(normRecovery(c)))), req.user.id);
    s.dropSessions.run(req.user.id, tokenHash(req.token)); // other devices sign in again, with a code
    res.json({ ...me(s.userById.get(req.user.id)), recovery });
  });
  api.post('/auth/2fa/disable', signedIn, (req, res) => {
    if (!req.user.totp_secret) return res.json(me(req.user));
    if (codes.blocked(req.user.id)) return msg(res, 429, 'too_many', 'Too many wrong codes. Try again in a few minutes.');
    if (!checkSecondFactor(req.user, req.body?.code)) { codes.fail(req.user.id); return msg(res, 400, 'bad_code', 'That code isn’t right.'); }
    s.disableTotp.run(req.user.id);
    res.json(me(s.userById.get(req.user.id)));
  });
  api.post('/auth/2fa/recovery', signedIn, (req, res) => {
    if (!req.user.totp_secret) return msg(res, 400, 'off', 'Two-step verification is off.');
    if (!checkSecondFactor(req.user, req.body?.code)) { codes.fail(req.user.id); return msg(res, 400, 'bad_code', 'That code isn’t right.'); }
    const recovery = newRecoveryCodes();
    s.setRecovery.run(JSON.stringify(recovery.map(c => tokenHash(normRecovery(c)))), req.user.id);
    res.json({ recovery });
  });

  /* ---- Google and GitHub ---- */
  const oauthCookie = (req, value, maxAge) => `${OAUTH_COOKIE}=${value}; Path=/api/auth/oauth; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${req.secure ? '; Secure' : ''}`;
  const back = (res, hash) => res.redirect(302, `/${hash ? '#' + hash : ''}`);

  // ?link=1 while signed in adds the provider to this account instead of signing in.
  api.get('/auth/oauth/:provider', (req, res) => {
    const p = idps[req.params.provider];
    if (!p) return back(res, 'auth_error=provider_off');
    const link = req.query.link === '1' && req.user ? '1' : '0';
    const { url, state, verifier } = oauth.start(p, `${base(req)}/api/auth/oauth/${p.id}/callback`);
    res.set('Set-Cookie', oauthCookie(req, [p.id, state, verifier, link].join('.'), 600));
    res.redirect(302, url);
  });

  api.get('/auth/oauth/:provider/callback', async (req, res) => {
    const p = idps[req.params.provider];
    const [pid, state, verifier, link] = String(readCookie(req, OAUTH_COOKIE) || '').split('.');
    res.set('Set-Cookie', oauthCookie(req, '', 0));
    if (!p || pid !== p.id || !state || state !== req.query.state) return back(res, 'auth_error=state');
    if (req.query.error || !req.query.code) return back(res, 'auth_error=cancelled');
    let who;
    try { who = await oauth.finish(p, String(req.query.code), verifier, `${base(req)}/api/auth/oauth/${p.id}/callback`); }
    catch (e) { console.error(`${p.name} sign-in failed:`, e.message); return back(res, 'auth_error=provider'); }

    const known = s.identity.get(p.id, who.subject);
    if (link === '1') {
      if (!req.user) return back(res, 'auth_error=signed_out');
      if (known && known.user_id !== req.user.id) return back(res, 'account=taken');
      if (!known) s.addIdentity.run(p.id, who.subject, req.user.id, who.email, Date.now());
      return back(res, `account=linked-${p.id}`);
    }
    let user = known && s.userById.get(known.user_id);
    if (!user) {
      // Only an address the provider has checked can be matched to an account.
      if (!who.email || !who.verified) return back(res, 'auth_error=no_email');
      user = s.userByEmail.get(who.email);
      if (!user) {
        if (!allowSignup) return back(res, 'auth_error=signup_disabled');
        user = { id: newId(), email: who.email, name: who.name.slice(0, 80), pass: '', created: Date.now() };
        s.addUser.run(user.id, user.email, user.name, '', user.created, 1);
      }
      s.addIdentity.run(p.id, who.subject, user.id, who.email, Date.now());
      s.setVerified.run(user.id);
      user = s.userById.get(user.id);
    }
    if (user.totp_secret) return back(res, `mfa=${newSecretToken(user, 'mfa', 10 * 60_000)}`);
    startSession(req, res, user);
    back(res, '');
  });

  api.post('/auth/unlink', signedIn, (req, res) => {
    const provider = String(req.body?.provider || '');
    const others = s.identities.all(req.user.id).filter(i => i.provider !== provider);
    if (!req.user.pass && !others.length) return msg(res, 400, 'last_method', 'Set a password first, so you can still sign in.');
    s.dropIdentity.run(req.user.id, provider);
    res.json(me(req.user));
  });

  /* ---- the signed-in account ---- */
  api.post('/auth/logout', (req, res) => {
    if (req.token) s.dropSession.run(tokenHash(req.token));
    res.set('Set-Cookie', sessionCookie(req, '', 0)).json({ ok: true });
  });
  api.get('/auth/me', signedIn, (req, res) => res.json(me(req.user)));

  // Change the name, or the password (which needs the current one, if there is one, and signs out other devices).
  api.patch('/auth/me', signedIn, async (req, res) => {
    const b = req.body || {};
    if (typeof b.name === 'string') s.setName.run(b.name.trim().slice(0, 80), req.user.id);
    if (typeof b.password === 'string') {
      if (req.user.pass && !(await checkPassword(String(b.current || ''), req.user.pass))) return msg(res, 400, 'bad_password', 'Your current password isn’t right.');
      if (b.password.length < 8 || b.password.length > 200) return msg(res, 400, 'weak_password', 'Use a longer password (at least 8 characters).');
      s.setPass.run(await hashPassword(b.password), req.user.id);
      s.dropSessions.run(req.user.id, tokenHash(req.token));
    }
    res.json(me(s.userById.get(req.user.id)));
  });

  return { info, sweep: () => s.oldTokens.run(Date.now()) };
}
