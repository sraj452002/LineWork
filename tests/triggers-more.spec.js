import { test, expect } from '@playwright/test';
import { createServer } from 'node:http';
import { createHmac, generateKeyPairSync, sign } from 'node:crypto';
import { openStore } from '../backend/store.js';
import { memoryBackend } from '../backend/drive.js';
import { createApp } from '../backend/app.js';
import { cronDue, parseCron } from '../backend/flow-more-triggers.js';

// The newer triggers: a chat page, being called by another workflow, app webhooks (WhatsApp, Discord,
// GitLab, Jira, Linear, Razorpay, WooCommerce), a new Workline file, and the Schedule's cron mode.

const node = (id, type, params = {}, extra = {}) => ({ id, type, name: extra.name || id, params, ...extra });
const edge = (from, to) => ({ id: `${from}-${to}`, from, to, fromPort: 'main', toPort: 'main' });
const hex = (secret, body, enc = 'hex') => createHmac('sha256', secret).update(body).digest(enc);

test('cron expressions', () => {
  expect(parseCron('0 9 * * 1-5')).toBeTruthy();
  expect(parseCron('61 * * * *')).toBe(null);
  expect(parseCron('* * *')).toBe(null);
  const at = s => Date.parse(s);
  // 09:00 UTC on a Monday (2026-10-19), not on the Sunday before.
  expect(cronDue('0 9 * * 1-5', at('2026-10-19T08:59:30Z'), at('2026-10-19T09:00:10Z'))).toBe(true);
  expect(cronDue('0 9 * * 1-5', at('2026-10-18T08:59:30Z'), at('2026-10-18T09:00:10Z'))).toBe(false);
  expect(cronDue('*/15 * * * *', at('2026-10-19T10:01:00Z'), at('2026-10-19T10:14:00Z'))).toBe(false);
  expect(cronDue('*/15 * * * *', at('2026-10-19T10:01:00Z'), at('2026-10-19T10:15:00Z'))).toBe(true);
  expect(cronDue('0 0 1 * *', at('2026-10-31T23:59:00Z'), at('2026-11-01T00:00:30Z'))).toBe(true);
});

test.describe('through the API', () => {
  test.describe.configure({ mode: 'serial' });
  let store, app, srv, base, fake, fakeUrl, got = [];
  let cookie = '';
  const call = async (method, path, body) => {
    const r = await fetch(base + path, { method, headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    const set = r.headers.get('set-cookie'); if (set) cookie = set.split(';')[0];
    return { status: r.status, json: await r.json().catch(() => null) };
  };
  const save = (id, flow, title = id) => call('PUT', `/files/${id}`, { id, title, diagrams: [], doc: '', updated: Date.now(), view: 'flow', flow });
  const sent = () => got.map(g => g.body);

  test.beforeAll(async () => {
    fake = createServer((req, res) => {
      let body = ''; req.on('data', c => { body += c; });
      req.on('end', () => { got.push({ url: req.url, body: body ? JSON.parse(body) : null }); res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"ok":true}'); });
    }).listen(0);
    fakeUrl = `http://localhost:${fake.address().port}`;
    store = await openStore(memoryBackend());
    app = createApp(store, { requireVerified: false, dbAllowPrivate: true, flowSecret: 'test secret' });
    srv = app.listen(0);
    base = `http://localhost:${srv.address().port}/api`;
    await call('POST', '/auth/signup', { email: 'trig@example.com', password: 'a long password' });
  });
  test.afterAll(() => { srv?.close(); fake?.close(); app?.flows.close(); });

  test('a chat page answers with what the workflow gives', async () => {
    expect((await save('f_chat', { active: true, nodes: [
      node('chat', 'trigger.chat', { path: 'chatchatchat1234', title: 'Help desk', welcome: 'Hi <there>' }),
      node('say', 'core.set', { fields: [{ name: 'reply', value: 'You said: {{ $json.message }}' }] }),
    ], edges: [edge('chat', 'say')] })).status).toBe(200);
    const page = await fetch(`${base}/hook/chatchatchat1234`);
    const html = await page.text();
    expect(page.headers.get('content-type')).toMatch(/html/);
    expect(html).toContain('<title>Help desk</title>');
    expect(html).toContain('Hi &lt;there&gt;'); // escaped
    const ask = message => fetch(`${base}/hook/chatchatchat1234`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ message, sessionId: 's1' }) });
    expect(await (await ask('hello')).json()).toEqual({ reply: 'You said: hello' });
    expect((await ask('')).status).toBe(400);
  });

  test('“Run another workflow” starts at the Called by a workflow trigger', async () => {
    await save('f_child', { active: false, nodes: [
      node('man', 'trigger.manual'), node('a', 'core.set', { fields: [{ name: 'from', value: 'by hand' }] }),
      node('called', 'trigger.workflow'), node('b', 'core.set', { fields: [{ name: 'from', value: 'called with {{ $json.n }}' }] }),
    ], edges: [edge('man', 'a'), edge('called', 'b')] });
    const parent = { active: false, nodes: [node('t', 'trigger.manual'), node('sub', 'core.subflow', { fileId: 'f_child' })], edges: [edge('t', 'sub')] };
    const r = await call('POST', '/flows/f_parent/data', { flow: parent, input: [{ n: 7 }] });
    expect(r.status).toBe(200);
    expect(r.json.items.map(i => i.json ?? i)).toEqual([{ n: 7, from: 'called with 7' }]);
  });

  test('app webhooks: WhatsApp, Discord, GitLab, Jira, Linear, Razorpay, WooCommerce', async () => {
    const { publicKey, privateKey } = generateKeyPairSync('ed25519');
    const pub = publicKey.export({ format: 'der', type: 'spki' }).subarray(12).toString('hex');
    const starts = ['wa', 'dc', 'gl', 'ji', 'li', 'rz', 'wc'];
    expect((await save('f_apps', { active: true, nodes: [
      node('wa', 'trigger.whatsapp', { path: 'whatsappwhats123', verifyToken: 'letmein', secret: 'wa-secret' }),
      node('dc', 'trigger.discord', { path: 'discorddiscord12', publicKey: pub, reply: 'On it!' }),
      node('gl', 'trigger.gitlab', { path: 'gitlabgitlab1234', secret: 'gl-token', events: 'merge_request' }),
      node('ji', 'trigger.jira', { path: 'jirajirajira1234', secret: 'ji-secret' }),
      node('li', 'trigger.linear', { path: 'linearlinear1234', secret: 'li-secret', events: 'Issue.create' }),
      node('rz', 'trigger.razorpay', { path: 'razorpayrazor123', secret: 'rz-secret', events: 'payment.captured' }),
      node('wc', 'trigger.woocommerce', { path: 'woocommercewoo12', secret: 'wc-secret' }),
      node('send', 'core.http', { method: 'POST', url: `${fakeUrl}/trig`, body: '{{ $json }}' }),
    ], edges: starts.map(t => edge(t, 'send')) })).status).toBe(200);
    const post = (path, body, headers = {}) => fetch(`${base}/hook/${path}`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body });

    // WhatsApp: Meta's URL check, then a signed message (a status update alone is ignored).
    expect(await (await fetch(`${base}/hook/whatsappwhats123?hub.mode=subscribe&hub.verify_token=letmein&hub.challenge=12345`)).text()).toBe('12345');
    expect((await fetch(`${base}/hook/whatsappwhats123?hub.mode=subscribe&hub.verify_token=nope&hub.challenge=1`)).status).toBe(403);
    const wa = JSON.stringify({ entry: [{ changes: [{ value: { metadata: { phone_number_id: '99' }, contacts: [{ wa_id: '919999', profile: { name: 'Ravi' } }], messages: [{ from: '919999', id: 'wamid.1', timestamp: '1760000000', type: 'text', text: { body: 'Order status?' } }] } }] }] });
    expect((await post('whatsappwhats123', wa, { 'x-hub-signature-256': 'sha256=bad' })).status).toBe(401);
    expect((await post('whatsappwhats123', wa, { 'x-hub-signature-256': `sha256=${hex('wa-secret', wa)}` })).status).toBe(202);
    await expect.poll(() => sent().length).toBe(1);
    expect(sent()[0]).toMatchObject({ from: '919999', name: 'Ravi', text: 'Order status?', phoneNumberId: '99' });

    // Discord: signed with Ed25519; its PING, then a slash command answered at once.
    const dc = body => { const ts = String(Math.floor(Date.now() / 1000)); return post('discorddiscord12', body, { 'x-signature-timestamp': ts, 'x-signature-ed25519': sign(null, Buffer.from(ts + body), privateKey).toString('hex') }); };
    expect(await (await dc(JSON.stringify({ type: 1 }))).json()).toEqual({ type: 1 });
    expect((await post('discorddiscord12', JSON.stringify({ type: 1 }), { 'x-signature-timestamp': '1', 'x-signature-ed25519': '0'.repeat(128) })).status).toBe(401);
    const cmd = await dc(JSON.stringify({ type: 2, token: 'tok', application_id: 'app', channel_id: 'c1', guild_id: 'g1', member: { user: { id: 'u1', username: 'ada' } }, data: { name: 'ask', options: [{ name: 'question', value: 'Why?' }] } }));
    expect(await cmd.json()).toEqual({ type: 4, data: { content: 'On it!' } });
    await expect.poll(() => sent().length).toBe(2);
    expect(sent()[1]).toMatchObject({ command: 'ask', options: { question: 'Why?' }, user: 'ada', channelId: 'c1' });

    // GitLab: its secret token; events not asked for are ignored.
    const mr = JSON.stringify({ object_kind: 'merge_request', user: { username: 'ada' }, project: { path_with_namespace: 'me/app' }, object_attributes: { action: 'open', title: 'Fix', url: 'https://gitlab.com/me/app/-/merge_requests/1' } });
    expect((await post('gitlabgitlab1234', mr, { 'x-gitlab-token': 'wrong' })).status).toBe(401);
    expect((await (await post('gitlabgitlab1234', JSON.stringify({ object_kind: 'push' }), { 'x-gitlab-token': 'gl-token' })).json()).ignored).toBe('push');
    expect((await post('gitlabgitlab1234', mr, { 'x-gitlab-token': 'gl-token' })).status).toBe(202);
    await expect.poll(() => sent().length).toBe(3);
    expect(sent()[2]).toMatchObject({ event: 'merge_request', action: 'open', project: 'me/app', title: 'Fix' });

    // Jira, Linear, Razorpay, WooCommerce: each one's own signature.
    const ji = JSON.stringify({ webhookEvent: 'jira:issue_created', issue: { key: 'WL-1', fields: { summary: 'Login fails', status: { name: 'To Do' } } }, user: { displayName: 'Ada' } });
    expect((await post('jirajirajira1234', ji, { 'x-hub-signature': `sha256=${hex('ji-secret', ji)}` })).status).toBe(202);
    const li = JSON.stringify({ type: 'Issue', action: 'create', url: 'https://linear.app/x/WL-2', actor: { name: 'Ada' }, data: { title: 'Dark mode', identifier: 'WL-2' } });
    expect((await post('linearlinear1234', li, { 'linear-signature': hex('li-secret', li) })).status).toBe(202);
    const rz = JSON.stringify({ event: 'payment.captured', payload: { payment: { entity: { id: 'pay_1', amount: 49900, currency: 'INR', status: 'captured', email: 'a@b.in', contact: '+919999' } } } });
    expect((await post('razorpayrazor123', rz, { 'x-razorpay-signature': 'bad' })).status).toBe(401);
    expect((await post('razorpayrazor123', rz, { 'x-razorpay-signature': hex('rz-secret', rz) })).status).toBe(202);
    const wc = JSON.stringify({ id: 1001, status: 'processing', total: '499.00', currency: 'INR', billing: { email: 'c@d.in' } });
    expect((await (await post('woocommercewoo12', 'webhook_id=5', { 'content-type': 'application/x-www-form-urlencoded' })).json()).ignored).toBe('ping');
    expect((await post('woocommercewoo12', wc, { 'x-wc-webhook-topic': 'order.created', 'x-wc-webhook-signature': hex('wc-secret', wc, 'base64') })).status).toBe(202);
    await expect.poll(() => sent().length).toBe(7);
    const by = k => sent().find(x => x[k] !== undefined && x[k] !== null);
    expect(by('issueKey')).toMatchObject({ event: 'jira:issue_created', issueKey: 'WL-1', summary: 'Login fails', status: 'To Do' });
    expect(by('identifier')).toMatchObject({ type: 'Issue', action: 'create', title: 'Dark mode', actor: 'Ada' });
    expect(by('contact')).toMatchObject({ event: 'payment.captured', id: 'pay_1', amount: 499, currency: 'INR' });
    expect(by('topic')).toMatchObject({ topic: 'order.created', id: 1001, total: '499.00', email: 'c@d.in' });
  });

  test('a new Workline file, and the Schedule’s cron mode', async () => {
    got = [];
    expect((await save('f_watch', { active: true, nodes: [
      node('nf', 'trigger.file', { kind: 'doc', every: 5 }),
      node('cr', 'trigger.schedule', { mode: 'cron', cron: '30 9 * * *' }),
      node('send', 'core.http', { method: 'POST', url: `${fakeUrl}/trig`, body: '{{ $json }}' }),
    ], edges: [edge('nf', 'send'), edge('cr', 'send')] })).status).toBe(200);
    await app.flows.poll(); // the first look only notes what's there
    expect(Object.values(store.meta.polls).find(x => x.fileId === 'f_watch').error).toBe(null);
    await call('PUT', '/files/f_newdoc', { id: 'f_newdoc', title: 'Meeting notes', diagrams: [], doc: '# Notes', view: 'doc', updated: Date.now() });
    await call('PUT', '/files/f_newsheet', { id: 'f_newsheet', title: 'Budget', diagrams: [], doc: '', view: 'sheet', updated: Date.now() });
    await app.flows.poll(Date.now() + 6 * 60_000);
    await expect.poll(() => sent().length).toBe(1);
    expect(sent()[0]).toMatchObject({ fileId: 'f_newdoc', title: 'Meeting notes', kind: 'doc', change: 'new' });

    const s = Object.values(store.meta.schedules).find(x => x.fileId === 'f_watch');
    expect(s.mode).toBe('cron');
    s.last = Date.parse('2026-10-19T09:29:00Z');
    await app.flows.tick(Date.parse('2026-10-19T09:29:40Z'));
    expect(sent()).toHaveLength(1);
    await app.flows.tick(Date.parse('2026-10-19T09:30:05Z'));
    await expect.poll(() => sent().length).toBe(2);
    expect(sent()[1]).toHaveProperty('firedAt');
  });
});

// The feeds and services on the internet, answered by a stand-in for fetch.
test('YouTube, Reddit, GitHub releases and Google Drive: the first look notes, later ones bring what’s new', async () => {
  const { MORE_TRIGGERS } = await import('../backend/flow-more-triggers.js');
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const key = JSON.stringify({ client_email: 'bot@p.iam.gserviceaccount.com', private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }) });
  let videos = ['aaaaaaaaaaa'], posts = ['p1'], releases = [1], files = [];
  const seen = [];
  const real = globalThis.fetch;
  // No real names are looked up (this may run offline): every host is a public address.
  const { createRequire, syncBuiltinESMExports } = await import('node:module');
  const dnsp = createRequire(import.meta.url)('node:dns/promises'), realLookup = dnsp.lookup;
  dnsp.lookup = async () => [{ address: '93.184.216.34', family: 4 }];
  syncBuiltinESMExports();
  globalThis.fetch = async (u, init = {}) => {
    const url = String(u); seen.push({ url, auth: init.headers?.authorization });
    const json = b => new Response(JSON.stringify(b), { headers: { 'content-type': 'application/json' } });
    if (url.includes('youtube.com/feeds')) return new Response(`<feed>${videos.map(v => `<entry><title>Video ${v}</title><link rel="alternate" href="https://www.youtube.com/watch?v=${v}"/><published>2026-10-20T10:00:00Z</published></entry>`).join('')}</feed>`, { headers: { 'content-type': 'application/atom+xml' } });
    if (url.includes('reddit.com')) return json({ data: { children: posts.map(id => ({ data: { id, title: `Need a React dev ${id}`, author: 'u', selftext: '', url: 'x', permalink: `/r/forhire/${id}`, score: 1, num_comments: 0, created_utc: 1760000000 } })) } });
    if (url.includes('api.github.com')) return json(releases.map(id => ({ id, tag_name: `v${id}`, name: `Release ${id}`, html_url: `https://github.com/o/r/releases/v${id}`, body: 'Notes', author: { login: 'ada' }, draft: false, prerelease: false, published_at: '2026-10-20T10:00:00Z' })));
    if (url.includes('oauth2.googleapis.com')) return json({ access_token: 'gtoken', expires_in: 3600 });
    if (url.includes('googleapis.com/drive')) return json({ files });
    return new Response('nope', { status: 404 });
  };
  const ctx = { allowPrivate: true, cred: async () => ({ serviceAccountJson: key, token: 'ghp_x' }) };
  const poll = async (type, params, state, credential) => MORE_TRIGGERS[type].poll({ params, node: { params, credential }, state, ctx });
  try {
    let s = await poll('trigger.youtube', { channel: 'https://www.youtube.com/channel/UCabcdefghijklmnopqrstuv' }, {});
    expect(s.items).toEqual([]);
    videos = ['bbbbbbbbbbb', 'aaaaaaaaaaa'];
    s = await poll('trigger.youtube', { channel: 'UCabcdefghijklmnopqrstuv' }, s.state);
    expect(s.items).toMatchObject([{ videoId: 'bbbbbbbbbbb', title: 'Video bbbbbbbbbbb', link: 'https://www.youtube.com/watch?v=bbbbbbbbbbb', thumbnail: 'https://i.ytimg.com/vi/bbbbbbbbbbb/hqdefault.jpg' }]);
    await expect(poll('trigger.youtube', { channel: '@somebody' }, {})).rejects.toThrow(/channel id/);

    s = await poll('trigger.reddit', { subreddit: 'r/forhire', keywords: 'react' }, {});
    posts = ['p2', 'p1'];
    s = await poll('trigger.reddit', { subreddit: 'forhire', keywords: 'react' }, s.state);
    expect(s.items).toMatchObject([{ id: 'p2', permalink: 'https://www.reddit.com/r/forhire/p2' }]);

    s = await poll('trigger.ghrelease', { repo: 'https://github.com/o/r' }, {}, 'cred1');
    releases = [2, 1];
    s = await poll('trigger.ghrelease', { repo: 'o/r' }, s.state, 'cred1');
    expect(s.items).toMatchObject([{ repo: 'o/r', tag: 'v2', name: 'Release 2', author: 'ada' }]);
    expect(seen.filter(x => x.url.includes('api.github.com')).every(x => x.auth === 'Bearer ghp_x')).toBe(true);

    s = await poll('trigger.drive', { folderId: 'https://drive.google.com/drive/folders/1AbCdEfGhIjKlMn?usp=sharing' }, {}, 'g');
    expect(s.items).toEqual([]);
    files = [{ id: 'd1', name: 'invoice.pdf', mimeType: 'application/pdf', size: '1200', webViewLink: 'https://drive.google.com/file/d/d1', createdTime: '2099-01-01T00:00:00.000Z', modifiedTime: '2099-01-01T00:00:00.000Z' }];
    const s2 = await poll('trigger.drive', { folderId: '1AbCdEfGhIjKlMn' }, s.state, 'g');
    expect(s2.items).toMatchObject([{ id: 'd1', name: 'invoice.pdf', size: 1200 }]);
    expect(decodeURIComponent(seen.findLast(x => x.url.includes('/drive/')).url)).toContain("'1AbCdEfGhIjKlMn' in parents");
    // The same file isn't brought twice.
    expect((await poll('trigger.drive', { folderId: '1AbCdEfGhIjKlMn' }, s2.state, 'g')).items).toEqual([]);
  } finally { globalThis.fetch = real; dnsp.lookup = realLookup; syncBuiltinESMExports(); }
});
