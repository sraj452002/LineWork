import express from 'express';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { COOKIE, DUMMY, SESSION_DAYS, checkPassword, hashPassword, limiter, newId, newToken, readCookie, sessionCookie, tokenHash } from './auth.js';

/* Linework's own backend: accounts, files with version history, folders, share links and the AI proxy
   with a daily allowance. It answers the same /api/files and /api/ai requests as the Netlify functions,
   so the app works with either; GET /api/server tells the app which one it's talking to.
   With `publicDir` (the Vite build), it also serves the app itself. */

const MAX_FILE = 4_000_000;
const ID = /^[\w-]{1,80}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function createApp(store, opts = {}) {
  const {
    allowSignup = true, aiKey = '', aiModel = 'claude-sonnet-5-5', aiBase = 'https://api.anthropic.com',
    aiDailyLimit = 50, publicDir = null, trustProxy = false,
  } = opts;
  const { s } = store;
  const app = express();
  app.disable('x-powered-by');
  if (trustProxy) app.set('trust proxy', trustProxy);
  // Failed sign-ins: 10 per email, and 50 per address (many people can share one, e.g. behind a proxy).
  const byEmail = limiter({ max: 10 }), byIp = limiter({ max: 50 });

  // Cross-origin isolation for the Code view's runtimes (as in netlify.toml), on every response.
  app.use((req, res, next) => {
    res.set({ 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'credentialless', 'X-Content-Type-Options': 'nosniff' });
    next();
  });

  const api = express.Router();
  api.use((req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
  // Changes must come from this site: a same-origin page, sending JSON. Cross-site forms can do neither.
  api.use((req, res, next) => {
    if (req.method === 'GET' || req.method === 'HEAD') return next();
    const origin = req.headers.origin;
    // Hosts only: behind a proxy that ends HTTPS, the server itself sees plain http.
    let host = null; try { host = origin && new URL(origin).host; } catch (e) { host = '?'; }
    if (origin && host !== req.headers.host) return res.status(403).json({ error: 'forbidden' });
    if (req.method !== 'DELETE' && !req.is('application/json')) return res.status(415).json({ error: 'json_only' });
    next();
  });
  api.use(express.json({ limit: '30mb' })); // a file is at most 4 MB; AI requests can carry pictures
  api.use((req, res, next) => {
    const t = readCookie(req, COOKIE);
    req.token = t;
    req.user = t ? s.session.get(tokenHash(t), Date.now()) || null : null;
    next();
  });
  const signedIn = (req, res, next) => (req.user ? next() : res.status(401).json({ error: 'unauthorized' }));
  const publicUser = u => ({ id: u.id, email: u.email, name: u.name, created: u.created });

  api.get('/server', (req, res) => res.json({
    name: 'linework-server', signup: allowSignup,
    features: ['versions', 'share', 'folders', 'ai-limits'],
    ai: { configured: Boolean(aiKey), dailyLimit: aiDailyLimit },
  }));

  /* ---- accounts ---- */
  const startSession = (req, res, user) => {
    const t = newToken();
    s.addSession.run(tokenHash(t), user.id, Date.now() + SESSION_DAYS * 86400_000);
    res.set('Set-Cookie', sessionCookie(req, t, SESSION_DAYS * 86400));
  };
  const me = u => ({ user: { ...publicUser(u), folders: JSON.parse(s.folders.get(u.id)?.data || '[]') } });

  api.post('/auth/signup', async (req, res) => {
    if (!allowSignup) return res.status(403).json({ error: 'signup_disabled', message: 'New accounts are by invitation only.' });
    const email = String(req.body?.email || '').trim().toLowerCase(), password = String(req.body?.password || ''), name = String(req.body?.name || '').trim().slice(0, 80);
    if (!EMAIL.test(email) || email.length > 200) return res.status(400).json({ error: 'bad_email', message: 'Enter a valid email address.' });
    if (password.length < 8 || password.length > 200) return res.status(400).json({ error: 'weak_password', message: 'Use a longer password (at least 8 characters).' });
    if (s.userByEmail.get(email)) return res.status(409).json({ error: 'exists', message: 'There’s already an account with that email. Sign in instead.' });
    const user = { id: newId(), email, name, pass: await hashPassword(password), created: Date.now() };
    s.addUser.run(user.id, user.email, user.name, user.pass, user.created);
    startSession(req, res, user);
    res.status(201).json(me(user));
  });

  api.post('/auth/login', async (req, res) => {
    const email = String(req.body?.email || '').trim().toLowerCase(), password = String(req.body?.password || '');
    if (byEmail.blocked(email) || byIp.blocked(req.ip)) return res.status(429).json({ error: 'too_many', message: 'Too many tries. Wait a few minutes, then try again.' });
    const user = s.userByEmail.get(email);
    const ok = await checkPassword(password, user ? user.pass : DUMMY);
    if (!user || !ok) { byEmail.fail(email); byIp.fail(req.ip); return res.status(400).json({ error: 'bad_login', message: 'That email and password don’t match.' }); }
    byEmail.clear(email);
    startSession(req, res, user);
    res.json(me(user));
  });

  api.post('/auth/logout', (req, res) => {
    if (req.token) s.dropSession.run(tokenHash(req.token));
    res.set('Set-Cookie', sessionCookie(req, '', 0)).json({ ok: true });
  });

  api.get('/auth/me', signedIn, (req, res) => res.json(me(req.user)));

  // Change the name, or the password (which needs the current one, and signs out other devices).
  api.patch('/auth/me', signedIn, async (req, res) => {
    const b = req.body || {};
    if (typeof b.name === 'string') s.setName.run(b.name.trim().slice(0, 80), req.user.id);
    if (typeof b.password === 'string') {
      if (!(await checkPassword(String(b.current || ''), req.user.pass))) return res.status(400).json({ error: 'bad_password', message: 'Your current password isn’t right.' });
      if (b.password.length < 8 || b.password.length > 200) return res.status(400).json({ error: 'weak_password', message: 'Use a longer password (at least 8 characters).' });
      s.setPass.run(await hashPassword(b.password), req.user.id);
      s.dropSessions.run(req.user.id, tokenHash(req.token));
    }
    res.json(me(s.userById.get(req.user.id)));
  });

  /* ---- files (same contract as netlify/functions/files.mts) ---- */
  const parseFile = (raw, id) => {
    const text = typeof raw === 'string' ? raw : JSON.stringify(raw);
    if (text.length > MAX_FILE) return { status: 413, error: 'too_large' };
    const file = typeof raw === 'string' ? (() => { try { return JSON.parse(raw); } catch { return null; } })() : raw;
    if (!file || file.id !== id || !Array.isArray(file.diagrams)) return { status: 400, error: 'bad_file' };
    return { file, text };
  };
  const idOk = (req, res, next) => (ID.test(req.params.id) ? next() : res.status(400).json({ error: 'bad_id' }));

  api.get('/files', signedIn, (req, res) => {
    res.json({ files: s.files.all(req.user.id).map(r => JSON.parse(r.data)) });
  });
  api.get('/files/:id', signedIn, idOk, (req, res) => {
    const r = s.file.get(req.user.id, req.params.id);
    r ? res.type('json').send(r.data) : res.status(404).json({ error: 'not_found' });
  });
  api.put('/files/:id', signedIn, idOk, (req, res) => {
    const p = parseFile(req.body, req.params.id);
    if (p.error) return res.status(p.status).json({ error: p.error });
    store.saveFile(req.user.id, req.params.id, p.text, Number(p.file.updated) || Date.now());
    res.json({ ok: true });
  });
  api.delete('/files/:id', signedIn, idOk, (req, res) => {
    s.dropFile.run(req.user.id, req.params.id);
    res.json({ ok: true });
  });

  /* ---- version history ---- */
  api.get('/files/:id/versions', signedIn, idOk, (req, res) => {
    res.json({ versions: s.versions.all(req.user.id, req.params.id).map(v => ({ id: v.vid, saved: v.saved, size: v.size, title: v.title })) });
  });
  api.get('/files/:id/versions/:vid', signedIn, idOk, (req, res) => {
    const v = s.version.get(req.user.id, req.params.id, Number(req.params.vid) || 0);
    v ? res.json({ saved: v.saved, file: JSON.parse(v.data) }) : res.status(404).json({ error: 'not_found' });
  });

  /* ---- folders ---- */
  api.get('/folders', signedIn, (req, res) => res.json({ folders: JSON.parse(s.folders.get(req.user.id)?.data || '[]') }));
  api.put('/folders', signedIn, (req, res) => {
    const list = req.body?.folders;
    if (!Array.isArray(list) || list.length > 500 || !list.every(f => f && ID.test(String(f.id)) && typeof f.name === 'string' && f.name.length <= 120))
      return res.status(400).json({ error: 'bad_folders' });
    s.putFolders.run(req.user.id, JSON.stringify(list.map(f => ({ id: String(f.id), name: f.name }))));
    res.json({ ok: true });
  });

  /* ---- share links ---- */
  const shareUrl = (req, t) => `${req.protocol}://${req.headers.host}/s/${t}`;
  api.get('/files/:id/shares', signedIn, idOk, (req, res) => {
    res.json({ shares: s.shares.all(req.user.id, req.params.id).map(x => ({ token: x.token, mode: x.mode, created: x.created, url: shareUrl(req, x.token) })) });
  });
  api.post('/files/:id/shares', signedIn, idOk, (req, res) => {
    const mode = req.body?.mode === 'edit' ? 'edit' : 'view';
    if (!s.file.get(req.user.id, req.params.id)) return res.status(404).json({ error: 'not_found', message: 'Save the file to your account first.' });
    const token = newToken();
    s.addShare.run(token, req.user.id, req.params.id, mode, Date.now());
    res.status(201).json({ token, mode, url: shareUrl(req, token) });
  });
  api.delete('/shares/:token', signedIn, (req, res) => {
    s.dropShare.run(req.params.token, req.user.id);
    res.json({ ok: true });
  });
  // Anyone with the link: read the file, and with an edit link, save it (into the owner's account).
  api.get('/shared/:token', (req, res) => {
    const sh = s.share.get(req.params.token);
    const r = sh && s.file.get(sh.user_id, sh.file_id);
    if (!r) return res.status(404).json({ error: 'not_found' });
    res.json({ mode: sh.mode, owner: sh.owner_name || sh.owner_email.split('@')[0], file: JSON.parse(r.data) });
  });
  api.put('/shared/:token', (req, res) => {
    const sh = s.share.get(req.params.token);
    if (!sh || !s.file.get(sh.user_id, sh.file_id)) return res.status(404).json({ error: 'not_found' });
    if (sh.mode !== 'edit') return res.status(403).json({ error: 'view_only' });
    const p = parseFile(req.body, sh.file_id);
    if (p.error) return res.status(p.status).json({ error: p.error });
    store.saveFile(sh.user_id, sh.file_id, p.text, Number(p.file.updated) || Date.now());
    res.json({ ok: true });
  });

  /* ---- AI (same contract as netlify/edge-functions/ai.ts), with a daily allowance per account ---- */
  api.get('/ai/status', (req, res) => {
    const used = req.user ? store.aiUsed(req.user.id) : 0;
    const reason = !aiKey ? 'no_key' : !req.user ? 'signed_out' : aiDailyLimit > 0 && used >= aiDailyLimit ? 'daily_limit' : null;
    res.json({ enabled: !reason, reason, limit: aiDailyLimit, used });
  });
  api.post('/ai', signedIn, async (req, res) => {
    if (!aiKey) return res.status(503).json({ error: 'not_configured' });
    const b = req.body || {};
    const prompt = typeof b.prompt === 'string' ? b.prompt : '';
    if (!prompt) return res.status(400).json({ error: 'bad_request' });
    if (prompt.length > 400_000) return res.status(413).json({ error: 'too_large' });
    const TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];
    const images = Array.isArray(b.images) ? b.images : [];
    if (images.length > 4) return res.status(413).json({ error: 'too_many_images' });
    if (images.some(im => !TYPES.includes(im?.media_type) || typeof im?.data !== 'string')) return res.status(400).json({ error: 'bad_image' });
    if (images.some(im => im.data.length > 6_000_000)) return res.status(413).json({ error: 'too_large' });
    if (!store.useAi(req.user.id, aiDailyLimit)) return res.status(429).json({ error: 'daily_limit', limit: aiDailyLimit });

    const content = images.length
      ? [...images.map(im => ({ type: 'image', source: { type: 'base64', media_type: im.media_type, data: im.data } })), { type: 'text', text: prompt }]
      : prompt;
    const ctl = new AbortController();
    res.on('close', () => ctl.abort());
    let up;
    try {
      up = await fetch(`${aiBase}/v1/messages`, {
        method: 'POST', signal: ctl.signal,
        headers: { 'x-api-key': aiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
        body: JSON.stringify({ model: aiModel, max_tokens: 8000, stream: true, messages: [{ role: 'user', content }] }),
      });
    } catch (e) {
      return res.headersSent || res.status(502).json({ error: 'upstream' });
    }
    if (!up.ok || !up.body) {
      console.log('Anthropic API error', up.status, await up.text().catch(() => ''));
      return res.status(up.status === 429 || up.status === 529 ? 429 : 502).json({ error: 'upstream' });
    }
    res.set('Content-Type', 'text/event-stream');
    Readable.fromWeb(up.body).on('error', () => res.end()).pipe(res);
  });

  api.use((req, res) => res.status(404).json({ error: 'not_found' }));
  // Bad JSON and oversized bodies, as JSON errors.
  api.use((err, req, res, next) => {
    if (err.type === 'entity.too.large') return res.status(413).json({ error: 'too_large' });
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'bad_json' });
    console.error(err);
    res.status(500).json({ error: 'server_error' });
  });
  app.use('/api', api);

  // The app itself, with every other path (like /s/<token>) going to index.html.
  if (publicDir && existsSync(join(publicDir, 'index.html'))) {
    app.use(express.static(publicDir, { index: false, setHeaders: (res, p) => { if (/[\\/]assets[\\/]/.test(p)) res.set('Cache-Control', 'public, max-age=31536000, immutable'); } }));
    app.get(/.*/, (req, res) => res.sendFile(join(publicDir, 'index.html'), { headers: { 'Cache-Control': 'no-cache' } }));
  }

  // Expired sessions, hourly.
  const sweep = setInterval(() => s.oldSessions.run(Date.now()), 3600_000);
  sweep.unref();
  return app;
}
