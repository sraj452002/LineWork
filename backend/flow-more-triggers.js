import { createHmac, createPublicKey, timingSafeEqual, verify } from 'node:crypto';
import { FlowError } from './flow-engine.js';
import { NODE_TYPES } from './flow-nodes.js';
import { googleToken } from './flow-apps.js';
import { api, failIfBad, need, request } from './flow-util.js';

/* More triggers (see flow-triggers.js for how hooks and polls work):
   - Chat message: a chat page at the node's link; each message runs the workflow, its answer is the reply.
   - Called by another workflow: where "Run another workflow" starts this one.
   - App events by webhook: WhatsApp, Discord (slash commands), GitLab, Jira, Linear, Razorpay, WooCommerce.
   - Looked for every few minutes: a new or changed Workline file, a new file in a Google Drive folder, a
     new YouTube video, a new Reddit post, a new GitHub release. */

const pass = { run: ({ items: list }) => ({ main: list }) };
const same = (a, b) => { const x = Buffer.from(String(a || '')), y = Buffer.from(String(b || '')); return x.length === y.length && timingSafeEqual(x, y); };
const hmac = (secret, data, enc = 'hex') => createHmac('sha256', String(secret)).update(data).digest(enc);
const bad = message => ({ status: 401, error: 'bad_signature', message });
const ignored = why => ({ respond: { status: 200, body: { ok: true, ignored: why ?? null } } });
const raw = req => (req.raw ? req.raw.toString('utf8') : typeof req.body === 'string' ? req.body : JSON.stringify(req.body ?? ''));
const wanted = (list, ...names) => {
  const want = String(list || '').split(/[\s,]+/).filter(Boolean).map(s => s.toLowerCase());
  return !want.length || names.filter(Boolean).map(n => String(n).toLowerCase()).some(n => want.includes(n) || want.includes(n.split(/[./:]/)[0]));
};
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
// Ids seen so far, newest first, kept small.
const remember = (fresh, seen, max = 300) => [...new Set([...fresh, ...(seen || [])])].slice(0, max);

// Discord signs each interaction with Ed25519; its public key is 32 bytes, in hex.
const discordKey = hex => createPublicKey({ key: Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), Buffer.from(hex, 'hex')]), format: 'der', type: 'spki' });
const discordSigned = (req, publicKey) => {
  try {
    const sig = String(req.headers['x-signature-ed25519'] || ''), ts = String(req.headers['x-signature-timestamp'] || '');
    if (!/^[0-9a-f]{128}$/i.test(sig) || !ts || !/^[0-9a-f]{64}$/i.test(String(publicKey).trim())) return false;
    return verify(null, Buffer.from(ts + raw(req)), discordKey(String(publicKey).trim()), Buffer.from(sig, 'hex'));
  } catch (e) { return false; }
};

// The chat page: a message box; each message is POSTed here and the workflow's answer shown.
const chatPage = p => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(p.title || 'Chat')}</title><style>
*{box-sizing:border-box}html,body{height:100%}body{margin:0;display:flex;flex-direction:column;font:15px/1.5 system-ui,-apple-system,Segoe UI,sans-serif;color:#1d2433;background:#f6f7fb}
header{padding:14px 16px;border-bottom:1px solid #e3e6ef;background:#fff;font-weight:700}#log{flex:1;overflow:auto;padding:16px;display:flex;flex-direction:column;gap:10px;max-width:760px;width:100%;margin:0 auto}
.m{max-width:85%;padding:10px 13px;border-radius:14px;white-space:pre-wrap;word-wrap:break-word}.you{align-self:flex-end;background:#5b7cfa;color:#fff;border-bottom-right-radius:4px}.bot{align-self:flex-start;background:#fff;border:1px solid #e3e6ef;border-bottom-left-radius:4px}.err{color:#b42318}
form{display:flex;gap:8px;padding:12px 16px;border-top:1px solid #e3e6ef;background:#fff;max-width:760px;width:100%;margin:0 auto}input{flex:1;padding:11px 13px;font:inherit;border:1px solid #d5d9e4;border-radius:12px}button{padding:0 18px;border:0;border-radius:12px;font:600 15px system-ui;color:#fff;background:#5b7cfa;cursor:pointer}button:disabled{opacity:.5}
@media (prefers-color-scheme:dark){body{background:#141414;color:#eee}header,form{background:#1d1d1d;border-color:#333}.bot{background:#222;border-color:#333}input{background:#141414;color:#eee;border-color:#3a3a3a}}
</style></head><body><header>${esc(p.title || 'Chat')}</header><div id="log" aria-live="polite">${p.welcome ? `<div class="m bot">${esc(p.welcome)}</div>` : ''}</div>
<form id="f"><input id="t" autocomplete="off" placeholder="${esc(p.placeholder || 'Type a message…')}" aria-label="Message" required><button>Send</button></form>
<script>
var log=document.getElementById('log'),f=document.getElementById('f'),t=document.getElementById('t'),b=f.querySelector('button'),sid;
try{sid=localStorage.getItem('wl-chat')||'';if(!sid){sid=Math.random().toString(36).slice(2)+Date.now().toString(36);localStorage.setItem('wl-chat',sid);}}catch(e){sid=Math.random().toString(36).slice(2);}
function add(text,cls){var d=document.createElement('div');d.className='m '+cls;d.textContent=text;log.appendChild(d);log.scrollTop=log.scrollHeight;return d;}
f.onsubmit=function(e){e.preventDefault();var text=t.value.trim();if(!text)return;add(text,'you');t.value='';b.disabled=true;var wait=add('…','bot');
fetch(location.pathname,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({message:text,sessionId:sid})}).then(function(r){return r.json().then(function(j){return{ok:r.ok,j:j};});})
.then(function(x){wait.textContent=x.ok?(x.j.reply||'(no answer)'):(x.j.message||'Something went wrong.');if(!x.ok)wait.className+=' err';}).catch(function(){wait.textContent='Couldn’t reach the server.';wait.className+=' err';}).then(function(){b.disabled=false;t.focus();});};
</script></body></html>`;

export const MORE_TRIGGERS = {
  /* ---- a chat: GET is the page, a POST {message} runs the workflow and answers with its reply ---- */
  'trigger.chat': { ...pass, hook(req, p) {
    if (req.method === 'GET') return { respond: { status: 200, type: 'html', body: chatPage(p) } };
    const b = req.body && typeof req.body === 'object' ? req.body : {};
    const message = String(b.message ?? b.text ?? '').trim().slice(0, 20_000);
    if (!message) return { respond: { status: 400, body: { error: 'no_message', message: 'Send {"message": "…"}.' } } };
    return { chat: true, items: [{ json: { message, sessionId: String(b.sessionId || '').slice(0, 80) || null, sentAt: new Date().toISOString() } }] };
  } },

  // Started by "Run another workflow" (flows.js picks it first), with the items it was given.
  'trigger.workflow': pass,

  /* ---- app events by webhook ---- */
  'trigger.whatsapp': { ...pass, hook(req, p) {
    const q = req.query || {};
    // Meta checks the URL first: it sends the verify token and wants the challenge back.
    if (req.method === 'GET') {
      if (q['hub.mode'] === 'subscribe' && p.verifyToken && same(q['hub.verify_token'], p.verifyToken)) return { respond: { status: 200, type: 'text', body: String(q['hub.challenge'] ?? '') } };
      return { status: 403, error: 'bad_token', message: 'The verify token doesn’t match the one in the node.' };
    }
    if (p.secret && !same(req.headers['x-hub-signature-256'], `sha256=${hmac(p.secret, raw(req))}`)) return bad('The WhatsApp signature doesn’t match the app secret.');
    const items = [];
    for (const entry of (req.body || {}).entry || []) for (const ch of entry.changes || []) {
      const v = ch.value || {}, names = Object.fromEntries((v.contacts || []).map(c => [c.wa_id, c.profile?.name]));
      for (const m of v.messages || []) {
        const text = m.text?.body ?? m.button?.text ?? m.interactive?.button_reply?.title ?? m.interactive?.list_reply?.title ?? m[m.type]?.caption ?? null;
        items.push({ json: { from: m.from, name: names[m.from] || null, type: m.type, text, messageId: m.id, timestamp: m.timestamp ? new Date(Number(m.timestamp) * 1000).toISOString() : null, phoneNumberId: v.metadata?.phone_number_id || null, message: m } });
      }
    }
    return items.length ? { items } : ignored('no messages (a status update)');
  } },
  'trigger.discord': { ...pass, hook(req, p) {
    if (!p.publicKey) return bad('Paste the app’s public key (Discord Developer Portal → General Information) into the node.');
    if (!discordSigned(req, p.publicKey)) return bad('The Discord signature doesn’t match the public key.');
    const b = req.body || {};
    if (b.type === 1) return { respond: { status: 200, body: { type: 1 } } }; // Discord's check of the URL
    const d = b.data || {}, user = b.member?.user || b.user || {};
    if (!wanted(p.commands, d.name)) return { respond: { status: 200, body: { type: 4, data: { content: 'This command isn’t handled here.', flags: 64 } } } };
    const options = Object.fromEntries((d.options || []).map(o => [o.name, o.value ?? (o.options || []).map(x => ({ [x.name]: x.value }))]));
    return { items: [{ json: { command: d.name || null, options, user: user.username || null, userId: user.id || null, channelId: b.channel_id || null, guildId: b.guild_id || null, interactionToken: b.token, applicationId: b.application_id, interaction: b } }],
      respond: { status: 200, body: { type: 4, data: { content: String(p.reply || 'Got it ✓').slice(0, 2000) } } } };
  } },
  'trigger.gitlab': { ...pass, hook(req, p) {
    if (p.secret && !same(req.headers['x-gitlab-token'], p.secret)) return bad('The GitLab secret token doesn’t match.');
    const b = req.body || {}, kind = b.object_kind || b.event_name || null, action = b.object_attributes?.action || null;
    if (!wanted(p.events, kind, action && `${kind}.${action}`)) return ignored(kind);
    return { items: [{ json: { event: kind, action, project: b.project?.path_with_namespace || null, user: b.user?.username || b.user_username || null, title: b.object_attributes?.title || null, url: b.object_attributes?.url || b.project?.web_url || null, payload: b } }] };
  } },
  'trigger.jira': { ...pass, hook(req, p) {
    if (p.secret && !same(req.headers['x-hub-signature'], `sha256=${hmac(p.secret, raw(req))}`)) return bad('The Jira signature doesn’t match the secret.');
    const b = req.body || {}, issue = b.issue || {};
    if (!wanted(p.events, b.webhookEvent, String(b.webhookEvent || '').replace(/^jira:/, ''))) return ignored(b.webhookEvent);
    return { items: [{ json: { event: b.webhookEvent || null, issueKey: issue.key || null, summary: issue.fields?.summary || null, status: issue.fields?.status?.name || null, assignee: issue.fields?.assignee?.displayName || null, user: b.user?.displayName || null, comment: b.comment?.body || null, payload: b } }] };
  } },
  'trigger.linear': { ...pass, hook(req, p) {
    if (p.secret && !same(req.headers['linear-signature'], hmac(p.secret, raw(req)))) return bad('The Linear signature doesn’t match the signing secret.');
    const b = req.body || {}, d = b.data || {};
    if (!wanted(p.events, b.type && b.action ? `${b.type}.${b.action}` : b.type, b.type)) return ignored(b.type);
    return { items: [{ json: { type: b.type || null, action: b.action || null, title: d.title || d.body || null, identifier: d.identifier || null, url: b.url || d.url || null, actor: b.actor?.name || null, data: d, payload: b } }] };
  } },
  'trigger.razorpay': { ...pass, hook(req, p) {
    if (p.secret && !same(req.headers['x-razorpay-signature'], hmac(p.secret, raw(req)))) return bad('The Razorpay signature doesn’t match the webhook secret.');
    const b = req.body || {}, x = b.payload?.payment?.entity || b.payload?.order?.entity || b.payload?.subscription?.entity || {};
    if (!wanted(p.events, b.event)) return ignored(b.event);
    return { items: [{ json: { event: b.event || null, id: x.id || null, amount: typeof x.amount === 'number' ? x.amount / 100 : null, currency: x.currency || null, status: x.status || null, email: x.email || null, contact: x.contact || null, orderId: x.order_id || null, method: x.method || null, payload: b.payload || null } }] };
  } },
  'trigger.woocommerce': { ...pass, hook(req, p) {
    const topic = req.headers['x-wc-webhook-topic'];
    if (!topic) return ignored('ping'); // sent once when the webhook is made
    if (p.secret && !same(req.headers['x-wc-webhook-signature'], hmac(p.secret, raw(req), 'base64'))) return bad('The WooCommerce signature doesn’t match the secret.');
    if (!wanted(p.events, topic)) return ignored(topic);
    const b = req.body || {};
    return { items: [{ json: { topic, id: b.id ?? null, status: b.status || null, total: b.total ?? null, currency: b.currency || null, email: b.billing?.email || b.email || null, data: b } }] };
  } },

  /* ---- something new, looked for every few minutes ---- */
  'trigger.file': { ...pass, async poll({ params: p, state, ctx }) {
    const list = await ctx.files.index();
    const now = Object.fromEntries(list.map(f => [f.id, f.updated]));
    if (!state.seen) return { items: [], state: { seen: now } };
    const changed = p.changes === true || p.changes === 'true';
    const hits = list.filter(f => !(f.id in state.seen) || (changed && state.seen[f.id] !== f.updated)).slice(0, 20);
    const items = [];
    const words = String(p.title || '').toLowerCase().trim();
    for (const f of hits) {
      const file = await ctx.files.read(f.id).catch(() => null);
      if (!file || file.archived) continue;
      const kind = file.view === 'flow' || (file.flow?.nodes?.length > 1) ? 'workflow' : { canvas: 'diagram', both: 'doc' }[file.view] || file.view || 'diagram';
      if (p.kind && p.kind !== 'any' && kind !== p.kind) continue;
      if (words && !String(file.title || '').toLowerCase().includes(words)) continue;
      items.push({ fileId: f.id, title: file.title || 'Untitled', kind, change: f.id in state.seen ? 'changed' : 'new', updated: new Date(Number(f.updated) || Date.now()).toISOString() });
    }
    return { items, state: { seen: now } };
  } },
  'trigger.drive': { ...pass, async poll({ params: p, node, state, ctx }) {
    if (!node.credential) throw new FlowError('Pick a Google credential.', 'no_credential');
    const args = { ctx, node }, folder = String(need(p.folderId, 'the folder id')).replace(/^.*\/folders\//, '').replace(/[?#].*$/, '');
    if (!/^[\w-]{10,}$/.test(folder)) throw new FlowError('That isn’t a Google Drive folder id or link.', 'bad_param');
    const token = await googleToken(args, await ctx.cred(node.credential), 'https://www.googleapis.com/auth/drive.readonly');
    if (!state.since) return { items: [], state: { since: new Date().toISOString(), seen: [] } };
    const q = `'${folder}' in parents and trashed = false and createdTime > '${state.since}'`;
    const r = await api(args, `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&orderBy=createdTime&pageSize=100&supportsAllDrives=true&includeItemsFromAllDrives=true&fields=${encodeURIComponent('files(id,name,mimeType,size,webViewLink,createdTime,modifiedTime,owners(emailAddress))')}`, { bearer: token });
    const seen = new Set(state.seen || []);
    const files = (failIfBad(r, 'Google Drive').files || []).filter(f => !seen.has(f.id));
    const items = files.map(f => ({ id: f.id, name: f.name, mimeType: f.mimeType, size: f.size ? Number(f.size) : null, link: f.webViewLink || null, createdTime: f.createdTime, modifiedTime: f.modifiedTime, owner: f.owners?.[0]?.emailAddress || null }));
    const since = files.reduce((t, f) => (f.createdTime > t ? f.createdTime : t), state.since);
    return { items, state: { since, seen: remember(files.map(f => f.id), state.seen, 200) } };
  } },
  'trigger.youtube': { ...pass, async poll({ params: p, state, ctx }) {
    const id = (/(UC[\w-]{22})/.exec(String(need(p.channel, 'the channel id'))) || [])[1];
    if (!id) throw new FlowError('Use the channel id (it starts with UC…): on the channel, Share → Copy channel ID, or its youtube.com/channel/UC… link.', 'bad_param');
    const r = await NODE_TYPES['data.rss'].run({ node: { params: {} }, items: [{ json: {} }], params: () => ({ url: `https://www.youtube.com/feeds/videos.xml?channel_id=${id}`, limit: 30 }), ctx });
    const videos = r.main.map(i => i.json).map(v => ({ videoId: (/[?&]v=([\w-]{11})/.exec(v.link || '') || [])[1] || null, title: v.title, link: v.link, published: v.date || v.published || v.pubDate || null, author: v.author || null, description: v.description || v.summary || null, thumbnail: null }))
      .map(v => ({ ...v, thumbnail: v.videoId ? `https://i.ytimg.com/vi/${v.videoId}/hqdefault.jpg` : null }));
    const key = v => v.videoId || v.link;
    const seen = new Set(state.seen || []);
    const items = state.seen ? videos.filter(v => !seen.has(key(v))).reverse() : [];
    return { items, state: { seen: remember(videos.map(key), state.seen) } };
  } },
  'trigger.reddit': { ...pass, async poll({ params: p, state, ctx }) {
    const sub = String(need(p.subreddit, 'the subreddit')).replace(/^.*\/r\//, '').replace(/^r\//, '').replace(/[/?#].*$/, '').trim();
    if (!/^\w{2,30}$/.test(sub)) throw new FlowError('Write the subreddit’s name, like “webdev”.', 'bad_param');
    const r = await request(`https://www.reddit.com/r/${sub}/new.json?limit=50&raw_json=1`, { headers: { 'user-agent': 'WorkLine/1.0 (workflow trigger)' } }, { allowPrivate: ctx.allowPrivate });
    const posts = (failIfBad(r, 'Reddit').data?.children || []).map(c => c.data).filter(Boolean);
    const words = String(p.keywords || '').toLowerCase().split(',').map(s => s.trim()).filter(Boolean);
    const seen = new Set(state.seen || []);
    const fresh = state.seen ? posts.filter(x => !seen.has(x.id)) : [];
    const items = fresh.filter(x => !words.length || words.some(w => `${x.title} ${x.selftext}`.toLowerCase().includes(w))).reverse()
      .map(x => ({ id: x.id, title: x.title, author: x.author, text: (x.selftext || '').slice(0, 10_000), url: x.url, permalink: `https://www.reddit.com${x.permalink}`, score: x.score, comments: x.num_comments, flair: x.link_flair_text || null, created: new Date(x.created_utc * 1000).toISOString() }));
    return { items, state: { seen: remember(posts.map(x => x.id), state.seen) } };
  } },
  'trigger.ghrelease': { ...pass, async poll({ params: p, node, state, ctx }) {
    const repo = String(need(p.repo, 'the repository')).replace(/^https?:\/\/github\.com\//, '').replace(/\.git$|\/+$/g, '').trim();
    if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) throw new FlowError('Write the repository as owner/name, like “nodejs/node”.', 'bad_param');
    const token = node.credential ? (await ctx.cred(node.credential)).token : '';
    const r = await request(`https://api.github.com/repos/${repo}/releases?per_page=20`, { headers: { accept: 'application/vnd.github+json', 'user-agent': 'WorkLine', ...(token ? { authorization: `Bearer ${token}` } : {}) } }, { allowPrivate: ctx.allowPrivate });
    const list = failIfBad(r, 'GitHub').filter(x => !x.draft && (p.prereleases === true || p.prereleases === 'true' || !x.prerelease));
    const seen = new Set(state.seen || []);
    const items = state.seen ? list.filter(x => !seen.has(x.id)).reverse().map(x => ({ repo, tag: x.tag_name, name: x.name || x.tag_name, url: x.html_url, notes: (x.body || '').slice(0, 20_000), author: x.author?.login || null, prerelease: !!x.prerelease, publishedAt: x.published_at })) : [];
    return { items, state: { seen: remember(list.map(x => x.id), state.seen, 100) } };
  } },
};

// Cron (the Schedule trigger's "cron" mode): five fields, minute hour day month weekday, in UTC. Each is
// *, a number, a range a-b, a step (every n: star-slash-n, or a-b/n), or a list of those. Day and
// weekday: like cron, when both are set either may match.
const RANGES = [[0, 59], [0, 23], [1, 31], [1, 12], [0, 7]];
export function parseCron(expr) {
  const f = String(expr || '').trim().split(/\s+/);
  if (f.length !== 5) return null;
  const sets = [];
  for (let i = 0; i < 5; i++) {
    const [lo, hi] = RANGES[i], set = new Set();
    for (const part of f[i].split(',')) {
      const m = /^(\*|(\d+)(?:-(\d+))?)(?:\/(\d+))?$/.exec(part);
      if (!m) return null;
      const a = m[1] === '*' ? lo : Number(m[2]), b = m[1] === '*' ? hi : m[3] !== undefined ? Number(m[3]) : m[4] ? hi : a, step = Number(m[4] || 1);
      if (a < lo || b > hi || a > b || step < 1) return null;
      for (let v = a; v <= b; v += step) set.add(i === 4 && v === 7 ? 0 : v);
    }
    sets.push(set);
  }
  return { sets, anyDay: f[2] === '*', anyWeekday: f[4] === '*' };
}
export function cronMatches(c, t) {
  const d = new Date(t);
  if (!c.sets[0].has(d.getUTCMinutes()) || !c.sets[1].has(d.getUTCHours()) || !c.sets[3].has(d.getUTCMonth() + 1)) return false;
  const day = c.sets[2].has(d.getUTCDate()), week = c.sets[4].has(d.getUTCDay());
  return c.anyDay || c.anyWeekday ? day && week : day || week;
}
// Did a minute that matches pass after `last`, up to `now`? (At most a day back is looked at.)
export function cronDue(expr, last, now) {
  const c = parseCron(expr);
  if (!c) return false;
  const from = Math.max(Math.floor(last / 60_000) + 1, Math.floor(now / 60_000) - 1440);
  for (let mi = from; mi <= Math.floor(now / 60_000); mi++) if (cronMatches(c, mi * 60_000)) return true;
  return false;
}
