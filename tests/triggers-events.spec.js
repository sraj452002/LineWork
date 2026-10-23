import { test, expect } from '@playwright/test';
import { createServer } from 'node:http';
import { createHash, createHmac } from 'node:crypto';
import { openStore } from '../backend/store.js';
import { memoryBackend } from '../backend/drive.js';
import { createApp } from '../backend/app.js';
import { EVENT_TRIGGERS } from '../backend/flow-event-triggers.js';

// Chat and notification triggers of popular apps: each one's own signature and URL check, and the item
// it gives (sent on to a stand-in service by an HTTP node).
const node = (id, type, params = {}) => ({ id, type, name: id, params });
const edge = (from, to) => ({ id: `${from}-${to}`, from, to, fromPort: 'main', toPort: 'main' });
const h = (secret, body, enc = 'hex', algo = 'sha256') => createHmac(algo, secret).update(body).digest(enc);

test.describe('chat and event triggers', () => {
  test.describe.configure({ mode: 'serial' });
  let app, srv, base, fake, got = [], cookie = '';
  const sent = () => got.map(g => g.body);
  test.beforeAll(async () => {
    fake = createServer((req, res) => { let b = ''; req.on('data', c => { b += c; }); req.on('end', () => { got.push({ body: b ? JSON.parse(b) : null }); res.writeHead(200, { 'content-type': 'application/json' }); res.end('{}'); }); }).listen(0);
    app = createApp(await openStore(memoryBackend()), { requireVerified: false, dbAllowPrivate: true, flowSecret: 'x' });
    srv = app.listen(0);
    base = `http://localhost:${srv.address().port}/api`;
    const r = await fetch(`${base}/auth/signup`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'ev@example.com', password: 'a long password' }) });
    cookie = r.headers.get('set-cookie').split(';')[0];
    const T = {
      teams: ['trigger.teams', { secret: Buffer.from('teams-key').toString('base64'), reply: 'On it' }], gchat: ['trigger.googlechat', { secret: 'gk', reply: 'Hi!' }],
      msgr: ['trigger.messenger', { verifyToken: 'vt', secret: 'ms' }], insta: ['trigger.instagram', { verifyToken: 'vt', secret: 'is' }],
      tw: ['trigger.twilio', { reply: 'Thanks & bye' }], line: ['trigger.line', { secret: 'ls' }], ic: ['trigger.intercom', { secret: 'ics' }],
      zd: ['trigger.zendesk', { secret: 'zs' }], zoom: ['trigger.zoom', { secret: 'zm' }], sen: ['trigger.sentry', { secret: 'ss' }],
      pd: ['trigger.pagerduty', { secret: 'ps' }], twitch: ['trigger.twitch', { secret: 'ts' }], notion: ['trigger.notion', { secret: 'ns' }],
      trello: ['trigger.trello', {}], cu: ['trigger.clickup', { secret: 'cs' }], mc: ['trigger.mailchimp', { secret: 'mk' }],
      bb: ['trigger.bitbucket', { secret: 'bs' }], vc: ['trigger.vercel', { secret: 'vs' }], nl: ['trigger.netlify', { secret: 'nls' }],
      tally: ['trigger.tally', { secret: 'tls' }], cal: ['trigger.calcom', { secret: 'cls', events: 'BOOKING_CREATED' }],
    };
    const nodes = Object.entries(T).map(([id, [type, p]]) => node(id, type, { path: `${id}hookhookhook12`.slice(0, 16), ...p }));
    const flow = { active: true, nodes: [...nodes, node('send', 'core.http', { method: 'POST', url: `http://localhost:${fake.address().port}/x`, body: '{{ $json }}' })], edges: Object.keys(T).map(id => edge(id, 'send')) };
    const r2 = await fetch(`${base}/files/f_ev`, { method: 'PUT', headers: { 'content-type': 'application/json', cookie }, body: JSON.stringify({ id: 'f_ev', title: 'Events', diagrams: [], doc: '', updated: Date.now(), view: 'flow', flow }) });
    expect(r2.status).toBe(200);
  });
  test.afterAll(() => { srv?.close(); fake?.close(); app?.flows.close(); });
  const url = id => `${base}/hook/${`${id}hookhookhook12`.slice(0, 16)}`;
  const post = (id, body, headers = {}, type = 'application/json') => fetch(url(id), { method: 'POST', headers: { 'content-type': type, ...headers }, body });
  const next = async n => { await expect.poll(() => sent().length).toBe(n); return sent()[n - 1]; };

  test('chat apps: Teams, Google Chat, Messenger, Instagram, Twilio, LINE, Intercom, Zendesk', async () => {
    let n = 0;
    const tb = JSON.stringify({ type: 'message', id: 'm1', text: '<at>WorkLine</at> status of 42?', from: { name: 'Ada', aadObjectId: 'u1' }, conversation: { id: 'c1' } });
    expect((await post('teams', tb, { authorization: 'HMAC bad' })).status).toBe(401);
    const teams = await post('teams', tb, { authorization: `HMAC ${h(Buffer.from('teams-key'), tb, 'base64')}` });
    expect(await teams.json()).toEqual({ type: 'message', text: 'On it' });
    expect(await next(++n)).toMatchObject({ text: 'status of 42?', from: 'Ada', conversationId: 'c1' });

    const gb = JSON.stringify({ type: 'MESSAGE', message: { text: '@bot hello', argumentText: ' hello', sender: { displayName: 'Ravi', email: 'r@x.in' }, thread: { name: 't1' } }, space: { name: 'spaces/1' } });
    expect((await fetch(`${url('gchat')}?key=nope`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: gb })).status).toBe(401);
    expect(await (await fetch(`${url('gchat')}?key=gk`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: gb })).json()).toEqual({ text: 'Hi!' });
    expect(await next(++n)).toMatchObject({ type: 'MESSAGE', text: 'hello', from: 'Ravi', email: 'r@x.in', space: 'spaces/1' });

    expect(await (await fetch(`${url('msgr')}?hub.mode=subscribe&hub.verify_token=vt&hub.challenge=777`)).text()).toBe('777');
    const mb = JSON.stringify({ entry: [{ id: 'page1', messaging: [{ sender: { id: 's1' }, recipient: { id: 'page1' }, timestamp: 1760000000000, message: { mid: 'mid1', text: 'Hi page' } }, { sender: { id: 'page1' }, message: { is_echo: true, text: 'echo' } }] }] });
    expect((await post('msgr', mb, { 'x-hub-signature-256': `sha256=${h('ms', mb)}` })).status).toBe(202);
    expect(await next(++n)).toMatchObject({ senderId: 's1', pageId: 'page1', text: 'Hi page', messageId: 'mid1' });

    const ib = JSON.stringify({ entry: [{ id: 'ig1', changes: [{ field: 'comments', value: { id: 'cm1', text: 'price?', from: { username: 'meera' }, media: { id: 'md1' } } }] }] });
    expect((await post('insta', ib, { 'x-hub-signature-256': `sha256=${h('is', ib)}` })).status).toBe(202);
    expect(await next(++n)).toMatchObject({ kind: 'comment', text: 'price?', from: 'meera', mediaId: 'md1' });

    const tw = await post('tw', 'From=%2B919999&To=%2B14155550100&Body=STATUS+42&NumMedia=0&MessageSid=SM1', {}, 'application/x-www-form-urlencoded');
    expect(tw.headers.get('content-type')).toMatch(/xml/);
    expect(await tw.text()).toContain('<Message>Thanks &amp; bye</Message>');
    expect(await next(++n)).toMatchObject({ from: '+919999', text: 'STATUS 42', channel: 'sms', messageSid: 'SM1' });

    const lb = JSON.stringify({ events: [{ type: 'message', replyToken: 'rt', source: { userId: 'U1' }, message: { type: 'text', text: 'こんにちは' }, timestamp: 1760000000000 }] });
    expect((await post('line', lb, { 'x-line-signature': h('ls', lb, 'base64') })).status).toBe(202);
    expect(await next(++n)).toMatchObject({ type: 'message', text: 'こんにちは', userId: 'U1', replyToken: 'rt' });
    expect(await (await post('line', '{"events":[]}', { 'x-line-signature': h('ls', '{"events":[]}', 'base64') })).json()).toMatchObject({ ignored: 'no events' });

    const icb = JSON.stringify({ topic: 'conversation.user.created', data: { item: { type: 'conversation', id: 'cv1', state: 'open', source: { body: '<p>Need help</p>', author: { name: 'Asha', email: 'a@x.in' } } } } });
    expect((await post('ic', icb, { 'x-hub-signature': `sha1=${h('ics', icb, 'hex', 'sha1')}` })).status).toBe(202);
    expect(await next(++n)).toMatchObject({ topic: 'conversation.user.created', conversationId: 'cv1', text: 'Need help', author: 'Asha' });

    const zb = JSON.stringify({ ticket_id: 77, subject: 'Refund', status: 'new' }), ts = '2026-10-23T10:00:00Z';
    expect((await post('zd', zb, { 'x-zendesk-webhook-signature-timestamp': ts, 'x-zendesk-webhook-signature': h('zs', ts + zb, 'base64') })).status).toBe(202);
    expect(await next(++n)).toMatchObject({ ticketId: 77, subject: 'Refund', status: 'new' });
  });

  test('event apps: Zoom, Sentry, PagerDuty, Twitch, Notion, Trello, ClickUp, Mailchimp, Bitbucket, Vercel, Netlify, Tally, Cal.com', async () => {
    got = [];
    let n = 0;
    // Zoom's URL check, then a signed event.
    expect(await (await post('zoom', JSON.stringify({ event: 'endpoint.url_validation', payload: { plainToken: 'abc' } }))).json()).toEqual({ plainToken: 'abc', encryptedToken: h('zm', 'abc') });
    const zb = JSON.stringify({ event: 'meeting.started', payload: { object: { id: 99, topic: 'Standup', host_email: 'h@x.in' } } }), zts = '1760000000';
    expect((await post('zoom', zb, { 'x-zm-request-timestamp': zts, 'x-zm-signature': `v0=${h('zm', `v0:${zts}:${zb}`)}` })).status).toBe(202);
    expect(await next(++n)).toMatchObject({ event: 'meeting.started', topic: 'Standup', meetingId: 99, host: 'h@x.in' });

    const sb = JSON.stringify({ action: 'created', data: { issue: { title: 'TypeError: x is undefined', level: 'error', web_url: 'https://sentry.io/i/1', project: { slug: 'web' } } } });
    expect((await post('sen', sb, { 'sentry-hook-resource': 'issue', 'sentry-hook-signature': h('ss', sb) })).status).toBe(202);
    expect(await next(++n)).toMatchObject({ resource: 'issue', action: 'created', title: 'TypeError: x is undefined', project: 'web' });

    const pb = JSON.stringify({ event: { event_type: 'incident.triggered', data: { id: 'P1', title: 'DB down', status: 'triggered', urgency: 'high', service: { summary: 'API' }, html_url: 'https://pd/1' } } });
    expect((await post('pd', pb, { 'x-pagerduty-signature': `v1=old, v1=${h('ps', pb)}` })).status).toBe(202);
    expect(await next(++n)).toMatchObject({ event: 'incident.triggered', title: 'DB down', urgency: 'high', service: 'API' });

    const tch = JSON.stringify({ challenge: 'chal', subscription: { type: 'stream.online' } });
    const tsig = (id, t, b) => `sha256=${h('ts', id + t + b)}`;
    expect(await (await post('twitch', tch, { 'twitch-eventsub-message-type': 'webhook_callback_verification', 'twitch-eventsub-message-id': 'i1', 'twitch-eventsub-message-timestamp': 't1', 'twitch-eventsub-message-signature': tsig('i1', 't1', tch) })).text()).toBe('chal');
    const tev = JSON.stringify({ subscription: { type: 'stream.online' }, event: { broadcaster_user_name: 'Streamer', started_at: '2026-10-23T10:00:00Z' } });
    expect((await post('twitch', tev, { 'twitch-eventsub-message-type': 'notification', 'twitch-eventsub-message-id': 'i2', 'twitch-eventsub-message-timestamp': 't2', 'twitch-eventsub-message-signature': tsig('i2', 't2', tev) })).status).toBe(202);
    expect(await next(++n)).toMatchObject({ type: 'stream.online', broadcaster: 'Streamer' });

    // Notion's verification token comes through as a run, to copy into the node.
    expect((await post('notion', JSON.stringify({ verification_token: 'secret_tok' }))).status).toBe(200);
    expect(await next(++n)).toMatchObject({ verificationToken: 'secret_tok' });
    const nb = JSON.stringify({ type: 'page.created', entity: { id: 'pg1', type: 'page' }, workspace_name: 'Team' });
    expect((await post('notion', nb, { 'x-notion-signature': `sha256=${h('ns', nb)}` })).status).toBe(202);
    expect(await next(++n)).toMatchObject({ type: 'page.created', entityId: 'pg1', workspace: 'Team' });

    expect((await fetch(url('trello'), { method: 'HEAD' })).status).toBe(200);
    expect((await post('trello', JSON.stringify({ action: { type: 'updateCard', date: 'd', memberCreator: { fullName: 'Ada' }, data: { card: { name: 'Fix login', id: 'c1', shortLink: 'abc' }, listBefore: { name: 'Doing' }, listAfter: { name: 'Done' }, board: { name: 'Web' } } } }))).status).toBe(202);
    expect(await next(++n)).toMatchObject({ type: 'updateCard', card: 'Fix login', list: 'Done', fromList: 'Doing', link: 'https://trello.com/c/abc' });

    const cb = JSON.stringify({ event: 'taskStatusUpdated', task_id: 't9', history_items: [{ field: 'status', before: { status: 'to do' }, after: { status: 'review' }, user: { username: 'ravi' } }] });
    expect((await post('cu', cb, { 'x-signature': h('cs', cb) })).status).toBe(202);
    expect(await next(++n)).toMatchObject({ event: 'taskStatusUpdated', taskId: 't9', before: 'to do', after: 'review', user: 'ravi' });

    expect((await fetch(url('mc'))).status).toBe(200);
    expect((await fetch(`${url('mc')}?key=mk`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'type=subscribe&fired_at=2026-10-23&data%5Bemail%5D=new%40x.in&data%5Blist_id%5D=L1&data%5Bmerges%5D%5BFNAME%5D=Meera' })).status).toBe(202);
    expect(await next(++n)).toMatchObject({ type: 'subscribe', email: 'new@x.in', listId: 'L1', firstName: 'Meera' });

    const bbb = JSON.stringify({ repository: { full_name: 'me/app' }, actor: { display_name: 'Ada' }, pullrequest: { title: 'Dark mode', source: { branch: { name: 'dark' } }, links: { html: { href: 'https://bb/pr/1' } } } });
    expect((await post('bb', bbb, { 'x-event-key': 'pullrequest:created', 'x-hub-signature': `sha256=${h('bs', bbb)}` })).status).toBe(202);
    expect(await next(++n)).toMatchObject({ event: 'pullrequest:created', repository: 'me/app', title: 'Dark mode', branch: 'dark' });

    const vb = JSON.stringify({ type: 'deployment.error', createdAt: 1760000000000, payload: { project: { name: 'site' }, deployment: { url: 'site-abc.vercel.app' }, target: 'production' } });
    expect((await post('vc', vb, { 'x-vercel-signature': h('vs', vb, 'hex', 'sha1') })).status).toBe(202);
    expect(await next(++n)).toMatchObject({ type: 'deployment.error', project: 'site', url: 'https://site-abc.vercel.app', state: 'error' });

    const nlb = JSON.stringify({ state: 'ready', name: 'work-line', ssl_url: 'https://work-line.netlify.app', branch: 'master', commit_ref: 'abc123' });
    const enc = o => Buffer.from(JSON.stringify(o)).toString('base64url');
    const head = enc({ alg: 'HS256', typ: 'JWT' }), claims = enc({ iss: 'netlify', sha256: createHash('sha256').update(nlb).digest('hex') });
    const jws = `${head}.${claims}.${h('nls', `${head}.${claims}`, 'base64url')}`;
    expect((await post('nl', nlb, { 'x-webhook-signature': `${head}.${claims}.bad` })).status).toBe(401);
    expect((await post('nl', nlb, { 'x-webhook-signature': jws })).status).toBe(202);
    expect(await next(++n)).toMatchObject({ state: 'ready', site: 'work-line', branch: 'master', commit: 'abc123' });

    const tb = JSON.stringify({ data: { formName: 'Signup', responseId: 'r1', fields: [{ label: 'Name', value: 'Asha' }, { label: 'Plan', value: ['o2'], options: [{ id: 'o1', text: 'Free' }, { id: 'o2', text: 'Pro' }] }] } });
    expect((await post('tally', tb, { 'tally-signature': h('tls', tb, 'base64') })).status).toBe(202);
    expect(await next(++n)).toMatchObject({ formName: 'Signup', answers: { Name: 'Asha', Plan: ['Pro'] } });

    const calb = JSON.stringify({ triggerEvent: 'BOOKING_CREATED', payload: { title: 'Intro call', startTime: '2026-10-24T05:00:00Z', attendees: [{ name: 'Ravi', email: 'r@x.in', timeZone: 'Asia/Kolkata' }] } });
    expect((await (await post('cal', JSON.stringify({ triggerEvent: 'BOOKING_CANCELLED', payload: {} }), { 'x-cal-signature-256': h('cls', JSON.stringify({ triggerEvent: 'BOOKING_CANCELLED', payload: {} })) })).json()).ignored).toBe('BOOKING_CANCELLED');
    expect((await post('cal', calb, { 'x-cal-signature-256': h('cls', calb) })).status).toBe(202);
    expect(await next(++n)).toMatchObject({ event: 'BOOKING_CREATED', title: 'Intro call', name: 'Ravi', timeZone: 'Asia/Kolkata' });
  });
});

// The two that look (Discord with a bot, ntfy), answered by a stand-in for fetch.
test('Discord channel messages and ntfy notifications: the first look notes, later ones bring what’s new', async () => {
  const { createRequire, syncBuiltinESMExports } = await import('node:module');
  const dnsp = createRequire(import.meta.url)('node:dns/promises'), realLookup = dnsp.lookup;
  dnsp.lookup = async () => [{ address: '93.184.216.34', family: 4 }];
  syncBuiltinESMExports();
  const real = globalThis.fetch, calls = [];
  let msgs = [{ id: '100', content: 'old', author: { username: 'a', id: '1' } }], ntfy = '';
  globalThis.fetch = async (u, init = {}) => {
    const s = String(u); calls.push({ url: s, auth: init.headers?.authorization });
    if (s.includes('discord.com')) { const after = (/after=(\d+)/.exec(s) || [])[1]; return new Response(JSON.stringify(after ? msgs.filter(m => BigInt(m.id) > BigInt(after)).reverse() : msgs.slice(-1)), { headers: { 'content-type': 'application/json' } }); }
    if (s.includes('ntfy')) return new Response(ntfy, { headers: { 'content-type': 'application/x-ndjson' } });
    return new Response('{}', { status: 404 });
  };
  const ctx = { allowPrivate: true, cred: async () => ({ botToken: 'BOT', server: 'https://ntfy.example.com', token: 'tk' }) };
  const poll = (type, params, state, credential) => EVENT_TRIGGERS[type].poll({ params, node: { params, credential }, state, ctx });
  try {
    let s = await poll('trigger.discordmsg', { channelId: 'https://discord.com/channels/1/555' }, {}, 'c');
    expect(s).toEqual({ items: [], state: { last: '100' } });
    msgs = [...msgs, { id: '101', content: 'hi', author: { username: 'ravi', id: '2' } }, { id: '102', content: 'bot says', author: { username: 'b', id: '3', bot: true } }, { id: '103', content: 'help?', author: { username: 'meera', id: '4' } }];
    s = await poll('trigger.discordmsg', { channelId: '555' }, s.state, 'c');
    expect(s.items.map(m => m.text)).toEqual(['hi', 'help?']);
    expect(s.state.last).toBe('103');
    expect(calls.filter(c => c.url.includes('discord')).every(c => c.auth === 'Bot BOT' && c.url.includes('/channels/555/'))).toBe(true);

    ntfy = '{"id":"n1","event":"open"}\n';
    s = await poll('trigger.ntfy', { topic: 'alerts' }, {}, 'c');
    expect(s.items).toEqual([]);
    ntfy = `${JSON.stringify({ id: 'n2', event: 'message', time: 1760000000, title: 'Disk', message: '90% full', priority: 4, tags: ['warning'] })}\n`;
    s = await poll('trigger.ntfy', { topic: 'alerts' }, s.state, 'c');
    expect(s.items).toMatchObject([{ id: 'n2', title: 'Disk', message: '90% full', priority: 4, tags: ['warning'] }]);
    expect(calls.at(-1).url).toMatch(/^https:\/\/ntfy\.example\.com\/alerts\/json\?poll=1&since=\d+$/);
    expect(calls.at(-1).auth).toBe('Bearer tk');
    expect(s.state.since).toBe('n2');
  } finally { globalThis.fetch = real; dnsp.lookup = realLookup; syncBuiltinESMExports(); }
});

// Twilio signs the URL it was given (the site's address, through its proxy) with the posted fields.
test('Twilio’s signature, over the address the site was called at', () => {
  const body = { From: '+919999', Body: 'hi', To: '+14155550100' }, at = 'https://work-line.netlify.app/api/hook/abc';
  const sig = h('tok', at + Object.keys(body).sort().map(k => k + body[k]).join(''), 'base64', 'sha1');
  const req = s => ({ method: 'POST', body, query: {}, originalUrl: '/api/hook/abc', headers: { 'x-twilio-signature': s, 'x-forwarded-proto': 'https', 'x-forwarded-host': 'work-line.netlify.app', host: 'linework-api.onrender.com' } });
  expect(EVENT_TRIGGERS['trigger.twilio'].hook(req(sig), { secret: 'tok' }).items[0].json).toMatchObject({ from: '+919999', text: 'hi', channel: 'sms' });
  expect(EVENT_TRIGGERS['trigger.twilio'].hook(req('bad'), { secret: 'tok' }).status).toBe(401);
});
