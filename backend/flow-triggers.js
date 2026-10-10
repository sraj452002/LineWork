import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { FlowError } from './flow-engine.js';
import { NODE_TYPES } from './flow-nodes.js';
import { WORKLINE_NODES } from './flow-workline.js';
import { failIfBad, request } from './flow-util.js';

/* Triggers beyond Run by hand, Webhook and Schedule. Two kinds (flows.js lists them when an active flow
   is saved):
   - hook: another service calls the node's URL (/api/hook/<path>). hook(req, params) checks the
     signature (when a signing secret is filled in), drops events not asked for, and gives the items to
     start with, or a reply of its own (the form page, Slack's URL check).
   - poll: every few minutes the server looks for something new. poll({params, node, state, ctx})
     → {items, state}; state is kept between polls (small: what was seen last). The first poll of a
     feed, page or sheet only notes what's there, so old things don't all arrive at once. */

const pass = { run: ({ items: list }) => ({ main: list }) };
const same = (a, b) => { const x = Buffer.from(String(a || '')), y = Buffer.from(String(b || '')); return x.length === y.length && timingSafeEqual(x, y); };
const hmac = (secret, data, enc = 'hex', algo = 'sha256') => createHmac(algo, String(secret)).update(data).digest(enc);
const bad = message => ({ status: 401, error: 'bad_signature', message });
const ignored = why => ({ respond: { status: 200, body: { ok: true, ignored: why } } });
// "a, b" → the events asked for; none means all. An event matches its name or its family ("issues" for "issues.opened").
const wanted = (list, ...names) => {
  const want = String(list || '').split(/[\s,]+/).filter(Boolean);
  return !want.length || names.filter(Boolean).some(n => want.includes(n) || want.includes(String(n).split(/[./]/)[0]));
};
// "t=…,v1=…" (Stripe, Calendly) → {t, v1: [...]}
const parts = header => String(header || '').split(',').reduce((o, kv) => { const [k, v] = kv.split('='); if (k && v) (o[k.trim()] ||= []).push(v.trim()); return o; }, {});
const fresh = t => Math.abs(Date.now() / 1000 - Number(t)) < 300;
const raw = req => (req.raw ? req.raw.toString('utf8') : typeof req.body === 'string' ? req.body : JSON.stringify(req.body ?? ''));

// Form fields, one a line: "Email*" is required, "(long)" a big box, "(email)" / "(number)" / "(date)" a kind.
export const formFields = text => String(text || 'Name\nEmail* (email)\nMessage (long)').split('\n').map(l => l.trim()).filter(Boolean).slice(0, 30).map(l => {
  const kind = (/\((long|email|number|date|tel|url)\)/i.exec(l) || [])[1]?.toLowerCase() || 'text';
  const label = l.replace(/\((long|email|number|date|tel|url)\)/i, '').trim();
  const required = label.endsWith('*');
  const name = label.replace(/\*$/, '').trim();
  return { name, key: name.replace(/[^\w ]+/g, '').trim().replace(/\s+(\w)/g, (_, c) => c.toUpperCase()).replace(/^\w/, c => c.toLowerCase()) || 'field', kind, required };
});
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const page = (title, inner) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title><style>
*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;padding:24px 16px;font:15px/1.5 system-ui,-apple-system,Segoe UI,sans-serif;color:#1d2433;background:radial-gradient(1200px 600px at 10% -10%,#dfe8ff,transparent),radial-gradient(900px 500px at 110% 110%,#e4f7ee,transparent),#f6f7fb}
main{width:100%;max-width:520px;background:rgba(255,255,255,.86);backdrop-filter:blur(12px);border:1px solid #e3e6ef;border-radius:20px;padding:28px;box-shadow:0 20px 60px -25px rgba(30,40,80,.35)}
h1{margin:0 0 6px;font-size:22px}p{margin:0 0 18px;color:#5b6475}label{display:block;margin:0 0 14px;font-weight:600;font-size:13px}
input,textarea{display:block;width:100%;margin-top:6px;padding:10px 12px;font:inherit;border:1px solid #d5d9e4;border-radius:10px;background:#fff}textarea{min-height:110px;resize:vertical}
input:focus,textarea:focus{outline:2px solid #6c8cff;border-color:transparent}button{width:100%;margin-top:6px;padding:12px;border:0;border-radius:12px;font:600 15px system-ui;color:#fff;background:linear-gradient(135deg,#5b7cfa,#7a5cf0);cursor:pointer}
.ok{font-size:42px;margin-bottom:6px}small{display:block;margin-top:18px;text-align:center;color:#9aa1b0}
</style></head><body><main>${inner}<small>Made with Workline</small></main></body></html>`;

export const TRIGGER_TYPES = {
  /* ---- a form of its own: GET shows it, a POST sends the answers ---- */
  'trigger.form': { ...pass, hook(req, p) {
    const fields = formFields(p.fields);
    if (req.method === 'GET') {
      return { respond: { status: 200, type: 'html', body: page(p.title || 'Form', `<h1>${esc(p.title || 'Form')}</h1>${p.description ? `<p>${esc(p.description)}</p>` : ''}<form method="post">${fields.map(f => `<label>${esc(f.name)}${f.required ? ' *' : ''}${f.kind === 'long' ? `<textarea name="${esc(f.key)}"${f.required ? ' required' : ''}></textarea>` : `<input name="${esc(f.key)}" type="${f.kind}"${f.required ? ' required' : ''}>`}</label>`).join('')}<button>${esc(p.button || 'Send')}</button></form>`) } };
    }
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const missing = fields.filter(f => f.required && !String(body[f.key] ?? '').trim());
    if (missing.length) return { respond: { status: 400, type: 'html', body: page('Missing', `<h1>Almost there</h1><p>Please fill in ${esc(missing.map(f => f.name).join(', '))}.</p><p><a href="">Back to the form</a></p>`) } };
    const answers = Object.fromEntries(fields.map(f => [f.key, String(body[f.key] ?? '').slice(0, 10_000)]));
    return { items: [{ json: { ...answers, submittedAt: new Date().toISOString() } }], respond: { status: 200, type: 'html', body: page('Thanks', `<div class="ok">✓</div><h1>${esc(p.thanks || 'Thanks! We got it.')}</h1>`) } };
  } },

  /* ---- app events, each with its own signature ---- */
  'trigger.github': { ...pass, hook(req, p) {
    if (p.secret && !same(req.headers['x-hub-signature-256'], `sha256=${hmac(p.secret, raw(req))}`)) return bad('The GitHub signature doesn’t match the secret.');
    const event = req.headers['x-github-event'], b = req.body || {};
    if (event === 'ping') return ignored('ping');
    if (!wanted(p.events, event, b.action && `${event}.${b.action}`)) return ignored(event);
    return { items: [{ json: { event, action: b.action || null, repository: b.repository?.full_name || null, sender: b.sender?.login || null, payload: b } }] };
  } },
  'trigger.stripe': { ...pass, hook(req, p) {
    if (p.secret) {
      const s = parts(req.headers['stripe-signature']);
      if (!s.t || !fresh(s.t[0]) || !(s.v1 || []).some(v => same(v, hmac(p.secret, `${s.t[0]}.${raw(req)}`)))) return bad('The Stripe signature doesn’t match the signing secret (whsec_…).');
    }
    const b = req.body || {};
    if (!wanted(p.events, b.type)) return ignored(b.type);
    return { items: [{ json: { type: b.type, id: b.id, object: b.data?.object ?? null, livemode: !!b.livemode, created: b.created ? new Date(b.created * 1000).toISOString() : null } }] };
  } },
  'trigger.shopify': { ...pass, hook(req, p) {
    if (p.secret && !same(req.headers['x-shopify-hmac-sha256'], hmac(p.secret, raw(req), 'base64'))) return bad('The Shopify signature doesn’t match the secret.');
    const topic = req.headers['x-shopify-topic'];
    if (!wanted(p.events, topic)) return ignored(topic);
    return { items: [{ json: { topic: topic || null, shop: req.headers['x-shopify-shop-domain'] || null, data: req.body ?? null } }] };
  } },
  'trigger.slack': { ...pass, hook(req, p) {
    if (p.secret) {
      const ts = req.headers['x-slack-request-timestamp'];
      if (!fresh(ts) || !same(req.headers['x-slack-signature'], `v0=${hmac(p.secret, `v0:${ts}:${raw(req)}`)}`)) return bad('The Slack signature doesn’t match the signing secret.');
    }
    const b = req.body || {};
    if (b.type === 'url_verification') return { respond: { status: 200, body: { challenge: b.challenge } } };
    const e = b.event || {};
    if (e.bot_id || e.subtype === 'bot_message') return ignored('bot'); // not our own messages again
    if (!wanted(p.events, e.type)) return ignored(e.type);
    return { items: [{ json: { type: e.type || b.type, user: e.user || null, channel: e.channel || null, text: e.text ?? null, ts: e.ts || null, team: b.team_id || null, event: e } }] };
  } },
  'trigger.typeform': { ...pass, hook(req, p) {
    if (p.secret && !same(req.headers['typeform-signature'], `sha256=${hmac(p.secret, raw(req), 'base64')}`)) return bad('The Typeform signature doesn’t match the secret.');
    const r = (req.body || {}).form_response || {};
    const titles = Object.fromEntries((r.definition?.fields || []).map(f => [f.id, f.title]));
    const value = a => a[a.type] && typeof a[a.type] === 'object' ? (a[a.type].label ?? a[a.type].labels ?? a[a.type]) : a[a.type];
    const answers = Object.fromEntries((r.answers || []).map(a => [titles[a.field?.id] || a.field?.ref || a.field?.id, value(a)]));
    return { items: [{ json: { formId: r.form_id || null, submittedAt: r.submitted_at || null, answers, hidden: r.hidden || {}, response: r } }] };
  } },
  'trigger.calendly': { ...pass, hook(req, p) {
    if (p.secret) {
      const s = parts(req.headers['calendly-webhook-signature']);
      if (!s.t || !fresh(s.t[0]) || !(s.v1 || []).some(v => same(v, hmac(p.secret, `${s.t[0]}.${raw(req)}`)))) return bad('The Calendly signature doesn’t match the signing key.');
    }
    const b = req.body || {}, x = b.payload || {};
    if (!wanted(p.events, b.event)) return ignored(b.event);
    return { items: [{ json: { event: b.event, name: x.name || null, email: x.email || null, eventUri: x.event || null, cancelUrl: x.cancel_url || null, rescheduleUrl: x.reschedule_url || null, answers: x.questions_and_answers || [], payload: x } }] };
  } },

  /* ---- something new, looked for every few minutes ---- */
  'trigger.rss': { ...pass, async poll({ params: p, state, ctx }) {
    const r = await NODE_TYPES['data.rss'].run(one(ctx, { url: p.url, limit: 50 }));
    const posts = r.main.map(i => i.json), key = x => String(x.link || x.title).slice(0, 300);
    const seen = new Set(state.seen || []);
    const newer = state.seen ? posts.filter(x => !seen.has(key(x))) : [];
    return { items: newer.reverse(), state: { seen: [...new Set([...posts.map(key), ...(state.seen || [])])].slice(0, 300) } };
  } },
  'trigger.telegram': { ...pass, async poll({ node, state, ctx }) {
    if (!node.credential) throw new FlowError('Pick a Telegram credential.', 'no_credential');
    const c = await ctx.cred(node.credential);
    const r = await request(`https://api.telegram.org/bot${c.botToken}/getUpdates?timeout=0&limit=100${state.offset ? `&offset=${state.offset}` : ''}`, {}, { allowPrivate: ctx.allowPrivate });
    const list = failIfBad(r, 'Telegram').result || [];
    const items = list.map(u => { const msg = u.message || u.edited_message || u.channel_post || {}; return { updateId: u.update_id, chatId: msg.chat?.id ?? null, from: msg.from?.username || msg.from?.first_name || null, text: msg.text ?? msg.caption ?? null, date: msg.date ? new Date(msg.date * 1000).toISOString() : null, message: msg }; });
    return { items, state: { offset: list.length ? list[list.length - 1].update_id + 1 : state.offset } };
  } },
  'trigger.urlchange': { ...pass, async poll({ params: p, state, ctx }) {
    const r = await request(p.url, { headers: { accept: 'text/html,application/json,*/*' } }, { allowPrivate: ctx.allowPrivate });
    let text = typeof r.body === 'string' ? r.body : JSON.stringify(r.body);
    if (p.text === true || p.text === 'true') text = text.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    const hash = createHash('sha256').update(text).digest('hex');
    const changed = state.hash && state.hash !== hash;
    return { items: changed ? [{ url: p.url, status: r.status, changedAt: new Date().toISOString(), hash, previousHash: state.hash, text: text.slice(0, 5000) }] : [], state: { hash } };
  } },
  'trigger.sheetrow': { ...pass, async poll({ params: p, state, ctx }) {
    const rows = (await WORKLINE_NODES['workline.sheet'].run(one(ctx, { fileId: p.fileId, sheet: p.sheet, operation: 'read' }))).main.map(i => i.json);
    const items = state.count === undefined || rows.length < state.count ? [] : rows.slice(state.count).map((r, i) => ({ ...r, rowNumber: state.count + i + 2 }));
    return { items, state: { count: rows.length } };
  } },
};
// Args for running another node's code once, outside a flow.
const one = (ctx, params) => ({ node: { params }, items: [{ json: {} }], params: () => params, ctx });

export const POLL_EVERY = p => Math.min(1440, Math.max(1, Number(p.every) || 5)) * 60_000;
