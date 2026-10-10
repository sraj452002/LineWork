import express from 'express';
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { FlowError, runFlow } from './flow-engine.js';
import { NODE_TYPES } from './flow-nodes.js';
import { APP_NODES } from './flow-apps.js';
import { WORKLINE_NODES } from './flow-workline.js';
import { POLL_EVERY, TRIGGER_TYPES } from './flow-triggers.js';
import { WEB_NODES } from './flow-web.js';

const TYPES = { ...NODE_TYPES, ...APP_NODES, ...WORKLINE_NODES, ...TRIGGER_TYPES, ...WEB_NODES };
import { limiter, newToken } from './auth.js';

/* Workflows on the server: credentials, runs, webhooks and schedules. A workflow lives in a file
   (file.flow), saved like any other; when it's saved with `active` on, its webhook, schedule and
   polling triggers (flow-triggers.js) are listed in meta.json (hooks, schedules, polls) so they can start it.

   Credentials (API keys, tokens, connection strings) are encrypted with AES-256-GCM under a key from
   FLOW_SECRET (or, without it, one kept in meta.json), and never sent back to the browser.
   A run goes on in the background: POST …/run answers with its id at once, and the app asks how it's
   going (GET /api/runs/:id), since a proxy in front may not wait long. Each flow keeps its last 20 runs
   in the account's folder (run.<id>.json), counted in its storage. */

export const CRED_FIELDS = {
  slack: ['token', 'webhookUrl'],
  discord: ['webhookUrl'],
  telegram: ['botToken'],
  github: ['token'],
  notion: ['token'],
  smtp: ['smtpUrl', 'from'],
  database: ['type', 'url', 'host', 'port', 'database', 'user', 'password', 'ssl', 'readOnly'],
  bearer: ['token'],
  header: ['headerName', 'headerValue'],
  google: ['serviceAccountJson'],
  airtable: ['token'],
  trello: ['apiKey', 'token'],
  jira: ['site', 'email', 'apiToken'],
  linear: ['apiKey'],
  asana: ['token'],
  clickup: ['token'],
  todoist: ['token'],
  hubspot: ['token'],
  pipedrive: ['apiToken', 'domain'],
  stripe: ['secretKey'],
  shopify: ['shop', 'token'],
  twilio: ['accountSid', 'authToken', 'from'],
  sendgrid: ['apiKey', 'from'],
  resend: ['apiKey', 'from'],
  mailchimp: ['apiKey'],
  openai: ['apiKey', 'baseUrl'],
  gemini: ['apiKey'],
  supabase: ['url', 'serviceKey'],
  dropbox: ['token'],
  chatWebhook: ['webhookUrl'],
  whatsapp: ['token', 'phoneNumberId'],
  zendesk: ['subdomain', 'email', 'apiToken'],
  gitlab: ['token', 'baseUrl'],
  wordpress: ['url', 'username', 'appPassword'],
  ntfy: ['server', 'token'],
  mailgun: ['apiKey', 'domain', 'region', 'from'],
  postmark: ['serverToken', 'from'],
  brevo: ['apiKey', 'from'],
  pushover: ['appToken', 'userKey'],
  pagerduty: ['routingKey'],
  deepl: ['apiKey'],
  bitly: ['token'],
  browserless: ['token', 'baseUrl'],
};
const KEEP_RUNS = 20, SAMPLE = 20, MAX_DETAIL = 1_000_000, RUNNING_PER_USER = 5;
const UNIT = { minutes: 60_000, hours: 3_600_000, days: 86_400_000 };
const ID = /^[\w-]{1,80}$/;

export function createFlows({ store, ai = {}, mailer, allowPrivate = false, secret = '' }) {
  const m = store.meta;

  /* ---- credentials ---- */
  if (!secret && !m.flowKey) { m.flowKey = randomBytes(32).toString('base64url'); store.touch(); }
  const key = createHash('sha256').update(secret || m.flowKey).digest();
  const seal = obj => {
    const iv = randomBytes(12), c = createCipheriv('aes-256-gcm', key, iv);
    const enc = Buffer.concat([c.update(JSON.stringify(obj), 'utf8'), c.final()]);
    return [iv, c.getAuthTag(), enc].map(b => b.toString('base64url')).join('.');
  };
  const unseal = text => {
    const [iv, tag, enc] = String(text).split('.').map(x => Buffer.from(x, 'base64url'));
    const d = createDecipheriv('aes-256-gcm', key, iv);
    d.setAuthTag(tag);
    return JSON.parse(Buffer.concat([d.update(enc), d.final()]).toString('utf8'));
  };
  const credsOf = uid => (m.creds[uid] ||= {});
  const pick = (type, data) => Object.fromEntries(CRED_FIELDS[type].filter(f => data && data[f] !== undefined && data[f] !== '').map(f => [f, typeof data[f] === 'boolean' ? data[f] : String(data[f]).slice(0, 4000)]));
  const publicCred = ({ id, type, name, created, updated }) => ({ id, type, name, created, updated });

  const ctxFor = (uid, depth = 0) => ({
    uid, allowPrivate, mailer,
    // The account's own files, for the Workline nodes. A save is like the app's: versions, storage, triggers.
    files: {
      async read(id) { const t = await store.readFile(uid, String(id)); return t ? JSON.parse(t) : null; },
      async save(file) {
        file.updated = Date.now();
        const text = JSON.stringify(file);
        if (text.length > 4_000_000) throw new FlowError(`“${file.title}” would be over 4 MB.`, 'too_large');
        try { await store.saveFile(uid, file.id, text, file.updated); } catch (e) { throw new FlowError(e.code === 'storage_full' ? 'Your storage is full.' : e.message, e.code || 'save'); }
        reindex(uid, file.id, file);
      },
    },
    // A connection saved in the Database view (by id or name), with its password if it was remembered.
    dbConnection(id) { const list = m.userdata[uid]?.['db-connections']; return Array.isArray(list) ? list.find(c => c.id === id || c.name === id) || null : null; },
    // Another workflow file of this account, run on these items: what its last steps produce.
    async runFile(fileId, input) {
      if (depth >= 3) throw new FlowError('Workflows can call each other only 3 deep.', 'too_deep');
      const flow = await savedFlow(uid, String(fileId));
      if (!flow) throw new FlowError('That workflow file wasn’t found (save it first).', 'not_found');
      const start = flow.nodes.find(n => n.type === 'trigger.manual') || flow.nodes.find(n => String(n.type).startsWith('trigger.'));
      if (!start) throw new FlowError('That workflow has no trigger to start from.', 'no_start');
      const r = await runFlow(flow, { startId: start.id, input, types: TYPES, ctx: ctxFor(uid, depth + 1) });
      if (r.status !== 'success') throw new FlowError(`The other workflow failed: ${r.error}`, 'subflow');
      const ends = flow.nodes.filter(n => r.nodes[n.id]?.status === 'success' && !flow.edges.some(e => e.from === n.id));
      return ends.flatMap(n => (r.nodes[n.id].output?.main || []).map(json => ({ json })));
    },
    async cred(id) {
      const c = credsOf(uid)[id];
      if (!c) throw new FlowError('That credential was deleted. Pick another.', 'no_credential');
      try { return unseal(c.data); } catch (e) { throw new FlowError(`The credential “${c.name}” can't be read (did FLOW_SECRET change?). Enter it again.`, 'credential'); }
    },
    ai: { key: ai.key, base: ai.base, model: ai.model, allow: () => store.useAi(uid, ai.dailyLimit ?? 50) },
  });

  /* ---- runs ---- */
  const live = new Map(); // run id → {uid, run}, while it runs and for a while after
  const trim = r => {
    const out = r.output && Object.fromEntries(Object.entries(r.output).map(([p, list]) => [p, list.slice(0, SAMPLE)]));
    return { ...r, ...(out ? { output: out, more: Object.values(r.output).some(l => l.length > SAMPLE) } : {}) };
  };
  const save = async (uid, run) => {
    let text = JSON.stringify(run);
    if (text.length > MAX_DETAIL) text = JSON.stringify({ ...run, nodes: Object.fromEntries(Object.entries(run.nodes).map(([k, v]) => [k, { ...v, output: undefined, cut: true }])) });
    let size = text.length;
    try { store.room(uid, size); } catch (e) { size = 0; } // storage full: keep the summary only
    const list = ((m.runs[uid] ||= {})[run.fileId] ||= []);
    list.unshift({ id: run.id, started: run.started, finished: run.finished, status: run.status, trigger: run.trigger, error: run.error, size });
    for (const old of list.splice(KEEP_RUNS)) if (old.size) store.blob.remove(uid, `run.${old.id}.json`);
    store.touch();
    if (size) await store.blob.write(uid, `run.${run.id}.json`, text);
  };
  const running = uid => [...live.values()].filter(x => x.uid === uid && x.run.status === 'running').length;
  const start = (uid, fileId, flow, startId, input, trigger) => {
    if (running(uid) >= RUNNING_PER_USER) throw new FlowError(`${RUNNING_PER_USER} workflows are already running. Wait for one to finish.`, 'busy');
    const run = { id: newToken().slice(0, 16), fileId, trigger, startId, status: 'running', started: Date.now(), nodes: {} };
    live.set(run.id, { uid, run });
    (async () => {
      try {
        const r = await runFlow(flow, { startId, input, types: TYPES, ctx: ctxFor(uid), onStep: (id, res) => { run.nodes[id] = trim(res); } });
        Object.assign(run, { status: r.status, error: r.error, failed: r.failed });
      } catch (e) { Object.assign(run, { status: 'error', error: e.message }); }
      run.finished = Date.now();
      await save(uid, run).catch(e => console.error('Saving a workflow run failed:', e.message));
      setTimeout(() => live.delete(run.id), 10 * 60_000).unref?.();
    })();
    return run;
  };
  const savedFlow = async (uid, fileId) => {
    const text = await store.readFile(uid, fileId);
    try { return text ? JSON.parse(text).flow || null : null; } catch (e) { return null; }
  };
  const asItems = v => (v === undefined || v === null ? [{ json: {} }] : (Array.isArray(v) ? v : [v]).map(j => ({ json: j && typeof j === 'object' ? j : { value: j } })));

  /* ---- triggers: listed when an active flow is saved ---- */
  const reindex = (uid, fileId, file) => {
    const before = {};
    m.polls ||= {};
    for (const table of ['hooks', 'schedules', 'polls']) for (const [k, v] of Object.entries(m[table])) if (v.uid === uid && v.fileId === fileId) { before[k] = v; delete m[table][k]; }
    const flow = file && file.flow;
    if (flow && flow.active) for (const n of Array.isArray(flow.nodes) ? flow.nodes : []) {
      const p = n.params || {};
      if ((n.type === 'trigger.webhook' || TYPES[n.type]?.hook) && /^[\w-]{12,80}$/.test(String(p.path || '')) && !m.hooks[p.path]) {
        m.hooks[p.path] = { uid, fileId, nodeId: n.id, type: n.type, method: n.type !== 'trigger.webhook' ? 'ANY' : ['GET', 'POST', 'PUT', 'DELETE'].includes(p.method) ? p.method : 'ANY' };
      }
      if (TYPES[n.type]?.poll) {
        const k = `${uid}:${fileId}:${n.id}`, was = before[k];
        // The same thing watched keeps what was seen; something else starts afresh.
        const what = JSON.stringify([n.type, p.url, p.fileId, p.sheet, n.credential]);
        m.polls[k] = { uid, fileId, nodeId: n.id, type: n.type, every: POLL_EVERY(p), last: was?.what === what ? was.last : 0, what, state: was?.what === what ? was.state : {}, error: null };
      }
      if (n.type === 'trigger.schedule') {
        const k = `${uid}:${fileId}:${n.id}`;
        m.schedules[k] = { uid, fileId, nodeId: n.id, mode: p.mode === 'daily' ? 'daily' : 'interval', every: Math.max(1, Number(p.every) || 15), unit: UNIT[p.unit] ? p.unit : 'minutes', at: /^\d\d:\d\d$/.test(p.at || '') ? p.at : '09:00', last: before[k]?.last || Date.now() };
      }
    }
    store.touch();
  };
  const due = (s, now) => {
    if (s.mode === 'interval') return now - s.last >= s.every * UNIT[s.unit];
    const d = new Date(now), [h, mi] = s.at.split(':').map(Number);
    const at = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), h, mi);
    return now >= at && s.last < at;
  };
  const tick = async (now = Date.now()) => {
    for (const s of Object.values(m.schedules)) {
      if (!due(s, now)) continue;
      s.last = now; store.touch();
      const flow = await savedFlow(s.uid, s.fileId).catch(() => null);
      if (!flow || !flow.active) continue;
      try { start(s.uid, s.fileId, flow, s.nodeId, [{ json: { firedAt: new Date(now).toISOString() } }], 'schedule'); }
      catch (e) { console.error('A scheduled workflow could not start:', e.message); }
    }
  };
  // Polling triggers: look for something new; start the flow with it.
  const polling = new Set();
  const poll = async (now = Date.now()) => {
    for (const [k, s] of Object.entries(m.polls || {})) {
      if (polling.has(k) || now - s.last < s.every) continue;
      polling.add(k);
      s.last = now;
      try {
        const flow = await savedFlow(s.uid, s.fileId).catch(() => null);
        const node = flow?.active && flow.nodes.find(n => n.id === s.nodeId);
        if (!node) continue;
        const r = await TYPES[node.type].poll({ params: node.params || {}, node, state: s.state || {}, ctx: ctxFor(s.uid) });
        s.state = r.state || {}; s.error = null;
        if (r.items.length) start(s.uid, s.fileId, flow, s.nodeId, r.items.slice(0, 100).map(json => ({ json })), 'poll');
      } catch (e) { s.error = e.message; console.error('A polling trigger failed:', e.message); }
      finally { polling.delete(k); store.touch(); }
    }
  };
  const timer = setInterval(() => {
    tick().catch(e => console.error('Workflow schedule failed:', e.message));
    poll().catch(e => console.error('Workflow polling failed:', e.message));
  }, 30_000);
  timer.unref?.();

  /* ---- webhooks: anyone with the URL, so they're mounted before the API's same-site checks ---- */
  const hooks = express.Router();
  const hits = limiter({ max: 120, windowMs: 60_000 });
  // The body as sent is kept too: app triggers check its signature.
  const keep = (req, res, buf) => { req.raw = buf; };
  hooks.use(express.json({ limit: '5mb', verify: keep }), express.urlencoded({ extended: true, limit: '5mb', verify: keep }), express.text({ type: 'text/*', limit: '5mb', verify: keep }));
  hooks.all('/:token', async (req, res) => {
    const h = m.hooks[req.params.token];
    if (!h) return res.status(404).json({ error: 'not_found', message: 'No active workflow listens here.' });
    if (h.method !== 'ANY' && h.method !== req.method) return res.status(405).json({ error: 'method', message: `This webhook takes ${h.method} requests.` });
    if (hits.blocked(req.params.token)) return res.status(429).json({ error: 'too_many' });
    hits.fail(req.params.token);
    const flow = await savedFlow(h.uid, h.fileId);
    if (!flow || !flow.active) return res.status(404).json({ error: 'not_found' });
    const node = flow.nodes.find(n => n.id === h.nodeId), type = node && TYPES[node.type];
    const reply = r => (r.type === 'html' ? res.status(r.status).type('html').send(r.body) : res.status(r.status).json(r.body));
    try {
      if (type?.hook) {
        const got = type.hook(req, node.params || {});
        if (got.error) return res.status(got.status).json({ error: got.error, message: got.message });
        if (got.items) start(h.uid, h.fileId, flow, h.nodeId, got.items, node.type.replace('trigger.', ''));
        return got.respond ? reply(got.respond) : res.status(202).json({ ok: true });
      }
      const headers = Object.fromEntries(Object.entries(req.headers).filter(([k]) => !/^(cookie|authorization|x-forwarded-|x-real-ip|cf-)/i.test(k)));
      const run = start(h.uid, h.fileId, flow, h.nodeId, [{ json: { method: req.method, query: req.query, headers, body: req.body ?? null } }], 'webhook');
      res.status(202).json({ ok: true, runId: run.id });
    } catch (e) { res.status(e.code === 'busy' ? 429 : 500).json({ error: e.code || 'flow_error', message: e.message }); }
  });

  /* ---- the API for the app (signed in) ---- */
  const routes = (api, signedIn) => {
    api.get('/credentials', signedIn, (req, res) => {
      res.json({ credentials: Object.values(credsOf(req.user.id)).map(publicCred).sort((a, b) => a.name.localeCompare(b.name)) });
    });
    api.post('/credentials', signedIn, (req, res) => {
      const { type, name, data } = req.body || {};
      if (!CRED_FIELDS[type]) return res.status(400).json({ error: 'bad_type', message: 'Unknown kind of credential.' });
      if (!String(name || '').trim()) return res.status(400).json({ error: 'bad_name', message: 'Give the credential a name.' });
      const mine = credsOf(req.user.id);
      if (Object.keys(mine).length >= 100) return res.status(413).json({ error: 'too_many', message: 'That’s 100 credentials already.' });
      const id = newToken().slice(0, 16), now = Date.now();
      mine[id] = { id, type, name: String(name).trim().slice(0, 80), created: now, updated: now, data: seal(pick(type, data)) };
      store.touch();
      res.status(201).json({ credential: publicCred(mine[id]) });
    });
    // A new name, and the fields given (empty ones keep what was there, so secrets needn't be shown to be kept).
    api.put('/credentials/:id', signedIn, (req, res) => {
      const c = credsOf(req.user.id)[req.params.id];
      if (!c) return res.status(404).json({ error: 'not_found' });
      const { name, data } = req.body || {};
      if (String(name || '').trim()) c.name = String(name).trim().slice(0, 80);
      if (data && typeof data === 'object') { let old = {}; try { old = unseal(c.data); } catch (e) { /* replaced below */ } c.data = seal({ ...old, ...pick(c.type, data) }); }
      c.updated = Date.now();
      store.touch();
      res.json({ credential: publicCred(c) });
    });
    api.delete('/credentials/:id', signedIn, (req, res) => {
      delete credsOf(req.user.id)[req.params.id];
      store.touch();
      res.json({ ok: true });
    });

    // Run a flow as it is in the editor (saved or not), from a trigger (or any node), with optional input.
    api.post('/flows/:fileId/run', signedIn, (req, res) => {
      if (!ID.test(req.params.fileId)) return res.status(400).json({ error: 'bad_id' });
      const { flow, startId, input } = req.body || {};
      if (!flow || !Array.isArray(flow.nodes) || flow.nodes.length > 300 || !Array.isArray(flow.edges)) return res.status(400).json({ error: 'bad_flow', message: 'That isn’t a workflow.' });
      const first = startId || flow.nodes.find(n => n.type?.startsWith('trigger.'))?.id;
      if (!flow.nodes.some(n => n.id === first)) return res.status(400).json({ error: 'no_start', message: 'Add a trigger to start the workflow from.' });
      try {
        const run = start(req.user.id, req.params.fileId, flow, first, asItems(input), 'manual');
        res.status(202).json({ runId: run.id });
      } catch (e) { res.status(e.code === 'busy' ? 429 : 400).json({ error: e.code || 'flow_error', message: e.message }); }
    });
    // Run a published app: the saved workflow (so always its latest version), from its chosen trigger,
    // with the form's answers as the one item. Only the inputs the app declares are passed on.
    api.post('/flows/:fileId/app', signedIn, async (req, res) => {
      if (!ID.test(req.params.fileId)) return res.status(400).json({ error: 'bad_id' });
      const flow = await savedFlow(req.user.id, req.params.fileId);
      const app = flow && flow.app;
      if (!app || !app.published) return res.status(404).json({ error: 'not_found', message: 'That app isn’t published.' });
      const from = flow.nodes.find(n => n.id === app.startId) || flow.nodes.find(n => n.type === 'trigger.manual') || flow.nodes.find(n => String(n.type).startsWith('trigger.'));
      if (!from) return res.status(400).json({ error: 'no_start', message: 'The app’s workflow has no trigger to start from.' });
      const given = req.body && typeof req.body.input === 'object' && req.body.input ? req.body.input : {};
      const input = {};
      for (const f of Array.isArray(app.inputs) ? app.inputs : []) {
        const key = String(f.key || ''), v = given[key];
        if (!key) continue;
        if (f.required && (v === undefined || v === null || String(v).trim() === '')) return res.status(400).json({ error: 'missing', message: `Fill in ${f.label || key}.` });
        input[key] = f.kind === 'number' ? (v === '' || v == null ? null : Number(v)) : f.kind === 'yesno' ? v === true || v === 'true' : String(v ?? '').slice(0, 20_000);
      }
      try {
        const run = start(req.user.id, req.params.fileId, flow, from.id, [{ json: input }], 'app');
        res.status(202).json({ runId: run.id });
      } catch (e) { res.status(e.code === 'busy' ? 429 : 400).json({ error: e.code || 'flow_error', message: e.message }); }
    });
    api.get('/flows/:fileId/runs', signedIn, (req, res) => {
      const list = (m.runs[req.user.id] || {})[req.params.fileId] || [];
      const now = [...live.values()].filter(x => x.uid === req.user.id && x.run.fileId === req.params.fileId && x.run.status === 'running').map(x => x.run);
      res.json({ runs: [...now.map(({ id, started, status, trigger }) => ({ id, started, status, trigger })), ...list] });
    });
    api.get('/runs/:id', signedIn, async (req, res) => {
      const l = live.get(req.params.id);
      if (l && l.uid === req.user.id) return res.json({ run: l.run });
      const owner = Object.entries(m.runs[req.user.id] || {}).find(([, list]) => list.some(r => r.id === req.params.id));
      if (!owner) return res.status(404).json({ error: 'not_found' });
      const summary = owner[1].find(r => r.id === req.params.id);
      const text = summary.size ? await store.blob.read(req.user.id, `run.${req.params.id}.json`) : null;
      res.json({ run: text ? JSON.parse(text) : { ...summary, fileId: owner[0], nodes: {}, detail: false } });
    });
  };

  return { hooks, routes, reindex, tick, poll, close: () => clearInterval(timer) };
}
