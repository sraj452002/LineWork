import express from 'express';
import { Readable } from 'node:stream';
import { COOKIE, newToken, readCookie, tokenHash } from './auth.js';
import { accountRoutes } from './accounts.js';
import { createMailer } from './mail.js';
import { DbError, handle as dbHandle } from './dbconnect.js';
import { createFlows } from './flows.js';
import { electronRoute } from './app-install.js';
import { createAgent } from './agent.js';

/* The Workline API: accounts, files with version history, folders, share links, live databases and the
   AI proxy with a daily allowance, all under /api. The frontend (../frontend) is hosted on its own and
   reaches this through a proxy on its own site (Netlify's /api/* rewrite, or Vite's in development),
   so the session cookie stays first-party. GET /api/server tells the app it's talking to this API. */

const MAX_FILE = 4_000_000;
const ID = /^[\w-]{1,80}$/;

// NVIDIA's models offered by default (NVIDIA_MODEL overrides, comma-separated), and their names in the app.
export const NVIDIA_MODELS = 'z-ai/glm-5.3-flash,nvidia/nemotron-3.5-lightning-30b-a3b';
const NVIDIA_NAMES = { 'z-ai/glm-5.3-flash': 'GLM 5.3 Flash', 'nvidia/nemotron-3.5-lightning-30b-a3b': 'NVIDIA Nemotron' };
export const nvidiaLabel = m => NVIDIA_NAMES[m] || (/nemotron/i.test(m) ? 'NVIDIA Nemotron' : m.split('/').pop().replace(/[-_]+/g, ' ').replace(/\b([a-z])/g, c => c.toUpperCase()).replace(/\bGlm\b/, 'GLM'));

export function createApp(store, opts = {}) {
  const {
    allowSignup = true, aiKey = '', aiModel = 'claude-sonnet-5-5', aiBase = 'https://api.anthropic.com',
    nvidiaKey = '', nvidiaModel = NVIDIA_MODELS, nvidiaBase = 'https://integrate.api.nvidia.com/v1',
    aiDailyLimit = 50, trustProxy = false,
    mailer = createMailer(), oauth = {}, appUrl = '', allowLocal = false, dbAllowPrivate = false, dbTimeout = 30_000,
  } = opts;
  // New accounts confirm their email when the server can send one (unless turned off).
  const requireVerified = opts.requireVerified ?? mailer.configured;
  const { s } = store;
  const app = express();
  app.disable('x-powered-by');
  if (trustProxy) app.set('trust proxy', trustProxy);

  app.use((req, res, next) => { res.set('X-Content-Type-Options', 'nosniff'); next(); });

  const api = express.Router();
  // Workflows (flows.js). Their webhooks are called by other services, from anywhere, so they come
  // before the checks below that changes come from this site as JSON.
  const flows = createFlows({ store, ai: { key: aiKey, base: aiBase, model: aiModel, dailyLimit: aiDailyLimit }, mailer, allowPrivate: dbAllowPrivate, secret: opts.flowSecret || '', storeOwner: opts.storeOwner || '' });
  api.use('/hook', flows.hooks);
  api.use('/ui', flows.ui); // published custom apps: public pages, like webhooks
  api.use('/p', flows.pages); // pages made of nodes at a name of their own (/p/<name> on the site)
  api.use((req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
  // Changes must come from the app's own site, sending JSON. Cross-site forms can do neither.
  // Through the frontend's proxy a request arrives addressed to this host, from a page at APP_URL.
  const hostOf = u => { try { return new URL(u).host; } catch (e) { return '?'; } };
  const appHost = appUrl ? hostOf(appUrl) : null;
  api.use((req, res, next) => {
    if (req.method === 'GET' || req.method === 'HEAD') return next();
    const origin = req.headers.origin;
    // Hosts only: behind a proxy that ends HTTPS, the server itself sees plain http.
    const host = origin ? hostOf(origin) : null;
    if (origin && host !== req.headers.host && host !== appHost) return res.status(403).json({ error: 'forbidden' });
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
  // A change is answered once it's in storage (Google Drive), so nothing reported as done is lost.
  api.use((req, res, next) => {
    if (req.method === 'GET' && !req.path.startsWith('/auth/oauth/')) return next();
    const after = fn => (...a) => {
      store.flush().then(() => fn.apply(res, a), e => {
        console.error('Storage write failed:', e.message);
        res.status(503).type('json'); send.call(res, JSON.stringify({ error: 'storage', message: 'Couldn’t save to storage. Try again in a moment.' }));
      });
      return res;
    };
    const send = res.send, redirect = res.redirect;
    res.send = after(send); res.redirect = after(redirect);
    next();
  });
  const signedIn = (req, res, next) => (req.user ? next() : res.status(401).json({ error: 'unauthorized' }));
  flows.routes(api, signedIn);
  electronRoute(api, signedIn, { base: opts.electronBase });
  const accounts = accountRoutes(api, { store, mailer, allowSignup, requireVerified, oauthConfig: oauth, appUrl, signedIn });

  // What this server offers. allowLocal: whether the app may be used without an account.
  api.get('/server', (req, res) => res.json({
    name: 'linework-server', ...accounts.info(), allowLocal,
    features: ['versions', 'share', 'folders', 'ai-limits', '2fa', 'db', 'flows'],
    ai: { configured: Boolean(aiKey || nvidiaKey), dailyLimit: aiDailyLimit },
  }));

  /* ---- files ---- */
  const parseFile = (raw, id) => {
    const text = typeof raw === 'string' ? raw : JSON.stringify(raw);
    if (text.length > MAX_FILE) return { status: 413, error: 'too_large' };
    const file = typeof raw === 'string' ? (() => { try { return JSON.parse(raw); } catch { return null; } })() : raw;
    if (!file || file.id !== id || !Array.isArray(file.diagrams)) return { status: 400, error: 'bad_file' };
    return { file, text };
  };
  const idOk = (req, res, next) => (ID.test(req.params.id) ? next() : res.status(400).json({ error: 'bad_id' }));
  // A save that counts against the account's storage: answered with how much it uses now, or 507 when
  // it's full. Through a share link (owner: false) the answer doesn't show the owner's storage.
  const GB = b => `${(b / 2 ** 30).toFixed(1).replace(/\.0$/, '')} GB`;
  const storing = async (res, uid, save, owner = true) => {
    try { await save(); }
    catch (e) {
      if (e.code !== 'storage_full') throw e;
      return res.status(507).json(owner
        ? { error: 'storage_full', storage: store.storage(uid), message: `Your storage is full (${GB(e.limit)}). Delete some files or pictures to save again.` }
        : { error: 'storage_full', message: 'The owner’s storage is full, so this can’t be saved.' });
    }
    res.json(owner ? { ok: true, storage: store.storage(uid) } : { ok: true });
  };

  api.get('/files', signedIn, async (req, res) => {
    res.json({ files: await store.listFiles(req.user.id) });
  });
  api.get('/files/:id', signedIn, idOk, async (req, res) => {
    const data = await store.readFile(req.user.id, req.params.id);
    data ? res.type('json').send(data) : res.status(404).json({ error: 'not_found' });
  });
  api.put('/files/:id', signedIn, idOk, async (req, res) => {
    const p = parseFile(req.body, req.params.id);
    if (p.error) return res.status(p.status).json({ error: p.error });
    await storing(res, req.user.id, async () => { await store.saveFile(req.user.id, req.params.id, p.text, Number(p.file.updated) || Date.now()); flows.reindex(req.user.id, req.params.id, p.file); });
  });
  api.delete('/files/:id', signedIn, idOk, async (req, res) => {
    flows.reindex(req.user.id, req.params.id, null);
    await store.dropFile(req.user.id, req.params.id);
    res.json({ ok: true, storage: store.storage(req.user.id) });
  });

  /* ---- version history ---- */
  api.get('/files/:id/versions', signedIn, idOk, (req, res) => {
    res.json({ versions: store.versions(req.user.id, req.params.id).map(v => ({ id: v.vid, saved: v.saved, size: v.size, title: v.title })) });
  });
  api.get('/files/:id/versions/:vid', signedIn, idOk, async (req, res) => {
    const v = await store.readVersion(req.user.id, req.params.id, Number(req.params.vid) || 0);
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

  /* ---- pictures on canvases: files keep only a key, the picture is its own blob ---- */
  const MAX_IMAGE = 12_000_000; // a data: URL; the app scales big pictures down to about 3 MB
  const keyOk = (req, res, next) => (ID.test(req.params.key) ? next() : res.status(400).json({ error: 'bad_id' }));
  // The account's own pictures; with ?share=<token>, the pictures of that shared file's owner.
  api.get('/images/:key', keyOk, async (req, res) => {
    const uid = req.query.share ? s.share.get(String(req.query.share))?.user_id : req.user?.id;
    if (!uid) return res.status(req.query.share ? 404 : 401).json({ error: req.query.share ? 'not_found' : 'unauthorized' });
    const data = await store.readImage(uid, req.params.key);
    data ? res.json({ data }) : res.status(404).json({ error: 'not_found' });
  });
  api.put('/images/:key', signedIn, keyOk, async (req, res) => {
    const data = req.body?.data;
    if (typeof data !== 'string' || !/^data:image\/[\w.+-]+;base64,/.test(data)) return res.status(400).json({ error: 'bad_image' });
    if (data.length > MAX_IMAGE) return res.status(413).json({ error: 'too_large' });
    await storing(res, req.user.id, () => store.saveImage(req.user.id, req.params.key, data));
  });

  /* ---- the account's own settings: saved database connections, query history ---- */
  const DATA_NAME = /^[\w:.-]{1,100}$/;
  api.get('/userdata', signedIn, (req, res) => res.json({ data: s.userData.get(req.user.id) }));
  // {value}: any JSON, or null to remove it.
  api.put('/userdata/:name', signedIn, (req, res) => {
    const name = req.params.name, value = req.body?.value;
    if (!DATA_NAME.test(name) || value === undefined) return res.status(400).json({ error: 'bad_request' });
    const all = s.userData.get(req.user.id);
    if (JSON.stringify(value).length > 200_000 || (!(name in all) && Object.keys(all).length >= 200)) return res.status(413).json({ error: 'too_large' });
    s.putUserData.run(req.user.id, name, value);
    res.json({ ok: true });
  });

  /* ---- share links ---- */
  // On the app's site (APP_URL), where /s/<token> opens the file; this API's own host serves no pages.
  const shareUrl = (req, t) => `${(appUrl || `${req.protocol}://${req.headers.host}`).replace(/\/$/, '')}/s/${t}`;
  api.get('/files/:id/shares', signedIn, idOk, (req, res) => {
    res.json({ shares: s.shares.all(req.user.id, req.params.id).map(x => ({ token: x.token, mode: x.mode, created: x.created, url: shareUrl(req, x.token) })) });
  });
  api.post('/files/:id/shares', signedIn, idOk, (req, res) => {
    const mode = req.body?.mode === 'edit' ? 'edit' : 'view';
    if (!store.hasFile(req.user.id, req.params.id)) return res.status(404).json({ error: 'not_found', message: 'Save the file to your account first.' });
    const token = newToken();
    s.addShare.run(token, req.user.id, req.params.id, mode, Date.now());
    res.status(201).json({ token, mode, url: shareUrl(req, token) });
  });
  api.delete('/shares/:token', signedIn, (req, res) => {
    s.dropShare.run(req.params.token, req.user.id);
    res.json({ ok: true });
  });
  // Anyone with the link: read the file, and with an edit link, save it (into the owner's account).
  api.get('/shared/:token', async (req, res) => {
    const sh = s.share.get(req.params.token);
    const data = sh && await store.readFile(sh.user_id, sh.file_id);
    if (!data) return res.status(404).json({ error: 'not_found' });
    res.json({ mode: sh.mode, owner: sh.owner_name || sh.owner_email.split('@')[0], file: JSON.parse(data) });
  });
  api.put('/shared/:token', async (req, res) => {
    const sh = s.share.get(req.params.token);
    if (!sh || !store.hasFile(sh.user_id, sh.file_id)) return res.status(404).json({ error: 'not_found' });
    if (sh.mode !== 'edit') return res.status(403).json({ error: 'view_only' });
    const p = parseFile(req.body, sh.file_id);
    if (p.error) return res.status(p.status).json({ error: p.error });
    await storing(res, sh.user_id, async () => { await store.saveFile(sh.user_id, sh.file_id, p.text, Number(p.file.updated) || Date.now()); flows.reindex(sh.user_id, sh.file_id, p.file); }, false);
  });

  /* ---- AI, with a daily allowance per account ----
     Models: Claude (ANTHROPIC_API_KEY) and NVIDIA's (NVIDIA_API_KEY, an OpenAI-style API at
     integrate.api.nvidia.com). Each request picks one; the answer streams back in Anthropic's event
     format either way, so the app reads one format. */
  // NVIDIA_MODEL may name several, comma-separated; each is a choice in the AI chat. Nemotron keeps the
  // id “nvidia” (choices people saved earlier still work); the others are nvidia:<model>.
  const nvidiaModels = String(nvidiaModel || '').split(',').map(m => m.trim()).filter(Boolean);
  const providers = [
    ...(aiKey ? [{ id: 'claude', label: 'Claude', model: aiModel, images: true }] : []),
    ...(nvidiaKey ? nvidiaModels.map(model => ({ id: /nemotron/i.test(model) ? 'nvidia' : `nvidia:${model}`, label: nvidiaLabel(model), model, images: false, thinking: true, nvidia: true })) : []),
  ];
  // The default: GLM 5.3 Flash when NVIDIA is set up (it answers fast), else the first one.
  const defaultProvider = providers.find(p => p.model === 'z-ai/glm-5.3-flash') || providers[0] || null;
  api.get('/ai/status', (req, res) => {
    const used = req.user ? store.aiUsed(req.user.id) : 0;
    const reason = !providers.length ? 'no_key' : !req.user ? 'signed_out' : aiDailyLimit > 0 && used >= aiDailyLimit ? 'daily_limit' : null;
    res.json({ enabled: !reason, reason, limit: aiDailyLimit, used, providers, default: defaultProvider?.id || null });
  });
  /* ---- live databases (the Database view): see dbconnect.js ---- */
  api.post('/db', signedIn, async (req, res) => {
    try { res.json(await dbHandle(req.body || {}, { allowPrivate: dbAllowPrivate, timeout: dbTimeout })); }
    catch (e) { res.status(e instanceof DbError ? e.status : 500).json({ error: e.code || 'db_error', message: e instanceof DbError ? e.message : 'The database request failed.' }); }
  });

  // The AI assistant: a chat that can use the account's workflows, nodes and files (agent.js).
  const agentChat = createAgent({ store, flows, providers, defaultProvider, dailyLimit: aiDailyLimit, aiKey, aiBase, nvidiaKey, nvidiaBase });
  api.post('/ai/chat', signedIn, (req, res) => (providers.length ? agentChat(req, res) : res.status(503).json({ error: 'not_configured' })));

  api.post('/ai', signedIn, async (req, res) => {
    if (!providers.length) return res.status(503).json({ error: 'not_configured' });
    const b = req.body || {};
    const provider = providers.find(p => p.id === b.provider) || defaultProvider;
    const prompt = typeof b.prompt === 'string' ? b.prompt : '';
    if (!prompt) return res.status(400).json({ error: 'bad_request' });
    if (prompt.length > 400_000) return res.status(413).json({ error: 'too_large' });
    const TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];
    const images = Array.isArray(b.images) ? b.images : [];
    if (images.length > 4) return res.status(413).json({ error: 'too_many_images' });
    if (images.some(im => !TYPES.includes(im?.media_type) || typeof im?.data !== 'string')) return res.status(400).json({ error: 'bad_image' });
    if (images.some(im => im.data.length > 6_000_000)) return res.status(413).json({ error: 'too_large' });
    if (images.length && !provider.images) return res.status(400).json({ error: 'bad_image', message: `${provider.label} doesn't read pictures. Pick Claude for that.` });
    if (!store.useAi(req.user.id, aiDailyLimit)) return res.status(429).json({ error: 'daily_limit', limit: aiDailyLimit });

    const content = images.length
      ? [...images.map(im => ({ type: 'image', source: { type: 'base64', media_type: im.media_type, data: im.data } })), { type: 'text', text: prompt }]
      : prompt;
    const ctl = new AbortController();
    res.on('close', () => ctl.abort());
    if (provider.nvidia) return nvidiaStream(provider.model, prompt, res, ctl);
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

  // NVIDIA (OpenAI-style chat completions, streamed). Its chunks carry the answer in delta.content and
  // the model's reasoning in delta.reasoning_content; they're passed on as Anthropic-style text_delta and
  // thinking_delta events.
  async function nvidiaStream(model, prompt, res, ctl) {
    let up;
    try {
      up = await fetch(`${nvidiaBase.replace(/\/+$/, '')}/chat/completions`, {
        method: 'POST', signal: ctl.signal,
        headers: { authorization: `Bearer ${nvidiaKey}`, 'content-type': 'application/json', accept: 'text/event-stream' },
        body: JSON.stringify({
          model, messages: [{ role: 'user', content: prompt }], stream: true,
          // Nemotron thinks first, with its own settings; the others (GLM…) take NVIDIA's suggested ones.
          ...(/nemotron/i.test(model)
            ? { temperature: 1, top_p: 0.95, max_tokens: 16384, reasoning_budget: 16384, chat_template_kwargs: { enable_thinking: true } }
            : { temperature: 0.5, top_p: 1, max_tokens: 8192 }),
        }),
      });
    } catch (e) {
      return res.headersSent || res.status(502).json({ error: 'upstream' });
    }
    if (!up.ok || !up.body) {
      console.log('NVIDIA API error', up.status, await up.text().catch(() => ''));
      return res.status(up.status === 429 ? 429 : 502).json({ error: 'upstream' });
    }
    res.set('Content-Type', 'text/event-stream');
    const send = ev => res.write(`event: ${ev.type}\ndata: ${JSON.stringify(ev)}\n\n`);
    const reader = up.body.getReader(), dec = new TextDecoder();
    let buf = '';
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let i;
        while ((i = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
          if (!line.startsWith('data:')) continue;
          const data = line.slice(5).trim();
          if (data === '[DONE]') continue;
          let chunk; try { chunk = JSON.parse(data); } catch (e) { continue; }
          if (chunk.error) { send({ type: 'error', error: { type: 'api_error', message: String(chunk.error.message || chunk.error) } }); continue; }
          const delta = chunk.choices?.[0]?.delta || {};
          if (delta.reasoning_content) send({ type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: delta.reasoning_content } });
          if (delta.content) send({ type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: delta.content } });
        }
      }
      send({ type: 'message_stop' });
    } catch (e) {
      if (!ctl.signal.aborted) send({ type: 'error', error: { type: 'api_error', message: 'The stream broke off.' } });
    }
    res.end();
  }

  api.use((req, res) => res.status(404).json({ error: 'not_found' }));
  // Bad JSON and oversized bodies, as JSON errors.
  api.use((err, req, res, next) => {
    if (err.type === 'entity.too.large') return res.status(413).json({ error: 'too_large' });
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'bad_json' });
    console.error(err);
    res.status(500).json({ error: 'server_error' });
  });
  app.use('/api', api);
  // Only the API is here; the app itself is hosted separately (APP_URL).
  app.get('/', (req, res) => res.json({ name: 'linework-api', app: appUrl || null }));
  app.use((req, res) => res.status(404).json({ error: 'not_found' }));

  // Expired sessions and links, hourly.
  const sweep = setInterval(() => { s.oldSessions.run(Date.now()); accounts.sweep(); }, 3600_000);
  sweep.unref();
  app.flows = flows; // for the tests
  return app;
}
