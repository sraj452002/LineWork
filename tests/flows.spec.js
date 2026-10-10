import { test, expect } from '@playwright/test';
import { createServer } from 'node:http';
import { createHmac } from 'node:crypto';
import { openStore } from '../backend/store.js';
import { memoryBackend } from '../backend/drive.js';
import { createApp } from '../backend/app.js';
import { evaluate, runFlow } from '../backend/flow-engine.js';
import { NODE_TYPES } from '../backend/flow-nodes.js';

// Workflows: the engine on its own, then credentials, runs, webhooks and schedules through the API.

const node = (id, type, params = {}, extra = {}) => ({ id, type, name: extra.name || id, params, ...extra });
const edge = (from, to, fromPort = 'main', toPort = 'main') => ({ id: `${from}-${to}`, from, to, fromPort, toPort });

test('expressions: whole values keep their type, text gets filled in', () => {
  const ctx = { $json: { n: 3, user: { name: 'Ada' }, tags: ['a', 'b'] }, $node: { Start: { json: { x: 1 } } } };
  expect(evaluate('{{ $json.n * 2 }}', ctx)).toBe(6);
  expect(evaluate('{{ $json.tags }}', ctx)).toEqual(['a', 'b']);
  expect(evaluate('Hi {{ $json.user.name }}, x={{ $node["Start"].json.x }}', ctx)).toBe('Hi Ada, x=1');
  expect(evaluate({ a: ['{{ $json.n }}', 'plain'] }, ctx)).toEqual({ a: [3, 'plain'] });
  expect(() => evaluate('{{ nope.nope }}', ctx)).toThrow(/expression/);
});

test('the engine: set, IF branches, merge, split and code, with skipped branches', async () => {
  const flow = {
    nodes: [
      node('t', 'trigger.manual'),
      node('split', 'core.split', { field: 'people' }),
      node('if', 'core.if', { left: '{{ $json.age }}', op: 'gte', right: '18' }),
      node('adult', 'core.set', { fields: [{ name: 'group', value: 'adult' }] }),
      node('child', 'core.set', { fields: [{ name: 'group', value: 'child' }] }),
      node('merge', 'core.merge'),
      node('code', 'core.code', { code: 'return items.map(i => ({ ...i, label: i.name + ":" + i.group }));' }),
      node('never', 'core.set', { fields: [{ name: 'x', value: 1 }] }),
    ],
    edges: [edge('t', 'split'), edge('split', 'if'), edge('if', 'adult', 'true'), edge('if', 'child', 'false'),
      edge('adult', 'merge', 'main', 'a'), edge('child', 'merge', 'main', 'b'), edge('merge', 'code')],
  };
  const input = [{ json: { people: [{ name: 'Ada', age: 36 }, { name: 'Tim', age: 9 }] } }];
  const r = await runFlow(flow, { startId: 't', input, types: NODE_TYPES });
  expect(r.status).toBe('success');
  expect(r.nodes.code.output.main.map(x => x.label)).toEqual(['Ada:adult', 'Tim:child']);
  expect(r.nodes.if.output).toEqual({ true: [{ name: 'Ada', age: 36 }], false: [{ name: 'Tim', age: 9 }] });
  expect(r.nodes.never).toBeUndefined(); // not connected to the trigger
  // An IF whose items all go one way skips the other branch.
  const one = await runFlow(flow, { startId: 't', input: [{ json: { people: [{ name: 'Ada', age: 36 }] } }], types: NODE_TYPES });
  expect(one.nodes.child.status).toBe('skipped');
  // Loops and errors.
  await expect(runFlow({ nodes: [node('t', 'trigger.manual'), node('a', 'core.set'), node('b', 'core.set')], edges: [edge('t', 'a'), edge('a', 'b'), edge('b', 'a')] }, { startId: 't', types: NODE_TYPES })).rejects.toThrow(/loops back/);
  const bad = await runFlow({ nodes: [node('t', 'trigger.manual'), node('c', 'core.code', { code: 'throw new Error("boom")' }, { name: 'My code' })], edges: [edge('t', 'c')] }, { startId: 't', types: NODE_TYPES });
  expect(bad).toMatchObject({ status: 'error', failed: 'c' });
  expect(bad.error).toMatch(/My code: The code failed: boom/);
});

test.describe('through the API', () => {
  test.describe.configure({ mode: 'serial' });
  let store, app, srv, base, fake, fakeUrl, got = [], feed = '';
  test.beforeAll(async () => {
    // Stands in for Slack and any web service.
    fake = createServer((req, res) => {
      let body = '';
      req.on('data', c => { body += c; });
      req.on('end', () => {
        if (req.url.startsWith('/feed')) { res.writeHead(200, { 'content-type': 'application/rss+xml' }); res.end(feed); return; }
        got.push({ url: req.url, method: req.method, body: body ? JSON.parse(body) : null, auth: req.headers.authorization });
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(req.url.startsWith('/users') ? JSON.stringify([{ id: 1, name: 'Ada' }, { id: 2, name: 'Grace' }]) : '{"ok":true}');
      });
    }).listen(0);
    fakeUrl = `http://localhost:${fake.address().port}`;
    store = await openStore(memoryBackend());
    app = createApp(store, { requireVerified: false, dbAllowPrivate: true, flowSecret: 'test secret' });
    srv = app.listen(0);
    base = `http://localhost:${srv.address().port}/api`;
  });
  test.afterAll(() => { srv?.close(); fake?.close(); app?.flows.close(); });

  let cookie = '';
  const call = async (method, path, body) => {
    const r = await fetch(base + path, { method, headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    const set = r.headers.get('set-cookie'); if (set) cookie = set.split(';')[0];
    return { status: r.status, json: await r.json().catch(() => null) };
  };
  const finished = async id => {
    for (let i = 0; i < 100; i++) {
      const r = (await call('GET', `/runs/${id}`)).json.run;
      if (r.status !== 'running') return r;
      await new Promise(res => setTimeout(res, 50));
    }
    throw new Error('the run did not finish');
  };

  test('credentials are kept encrypted and never sent back', async () => {
    await call('POST', '/auth/signup', { email: 'flow@example.com', password: 'a long password' });
    expect((await call('POST', '/credentials', { type: 'nope', name: 'x' })).status).toBe(400);
    const made = await call('POST', '/credentials', { type: 'slack', name: 'Team Slack', data: { webhookUrl: `${fakeUrl}/slack`, extra: 'dropped' } });
    expect(made.status).toBe(201);
    expect(made.json.credential).toMatchObject({ type: 'slack', name: 'Team Slack' });
    expect(JSON.stringify(made.json)).not.toContain('/slack'); // the secret field never comes back
    const list = (await call('GET', '/credentials')).json.credentials;
    expect(list).toHaveLength(1);
    expect(list[0].data).toBeUndefined();
    const stored = JSON.stringify(store.meta.creds);
    expect(stored).not.toContain('/slack');
    expect(stored).not.toContain('dropped');
    // Renaming keeps the secret.
    await call('PUT', `/credentials/${list[0].id}`, { name: 'Slack' });
    expect((await call('GET', '/credentials')).json.credentials[0].name).toBe('Slack');
  });

  test('a manual run: HTTP, a Slack message, and the run kept with each step', async () => {
    const credId = (await call('GET', '/credentials')).json.credentials[0].id;
    const flow = {
      nodes: [
        node('t', 'trigger.manual'),
        node('get', 'core.http', { method: 'GET', url: `${fakeUrl}/users` }, { name: 'Get users' }),
        node('say', 'app.slack', { text: 'Hello {{ $json.name }} from {{ $node["Get users"].json.id }}' }, { name: 'Tell Slack', credential: credId }),
      ],
      edges: [edge('t', 'get'), edge('get', 'say')],
    };
    const started = await call('POST', '/flows/f_flow/run', { flow });
    expect(started.status).toBe(202);
    const run = await finished(started.json.runId);
    expect(run.status).toBe('success');
    expect(run.nodes.get).toMatchObject({ status: 'success', items: 2 });
    expect(got.filter(g => g.url === '/slack').map(g => g.body.text)).toEqual(['Hello Ada from 1', 'Hello Grace from 1']);
    const runs = (await call('GET', '/flows/f_flow/runs')).json.runs;
    expect(runs[0]).toMatchObject({ id: run.id, status: 'success', trigger: 'manual' });
    expect(store.backend.blobs.has(`flow@example.com/run.${run.id}.json`)).toBe(true);
    // A missing credential stops the run with a clear message.
    const bad = await finished((await call('POST', '/flows/f_flow/run', { flow: { ...flow, nodes: flow.nodes.map(n => (n.id === 'say' ? { ...n, credential: 'gone' } : n)) } })).json.runId);
    expect(bad).toMatchObject({ status: 'error', failed: 'say' });
    expect(bad.error).toMatch(/credential was deleted/);
  });

  test('Workline nodes: a sheet, a doc and a diagram in the account’s own files', async () => {
    const file = { id: 'f_work', title: 'Team', diagrams: [{ id: 'd1', type: 'architecture', name: 'Diagram 1', code: 'a > b' }], doc: '# Notes', updated: Date.now(),
      sheets: [{ id: 's1', name: 'People', cells: { A1: 'Name', B1: 'Age', A2: 'Ada', B2: '36' }, fmt: {}, cols: 26, rows: 100 }] };
    expect((await call('PUT', '/files/f_work', file)).status).toBe(200);
    const flow = {
      nodes: [
        node('t', 'trigger.manual'),
        node('add', 'workline.sheet', { operation: 'append', fileId: 'f_work', sheet: 'People' }),
        node('read', 'workline.sheet', { operation: 'read', fileId: 'f_work' }),
        node('note', 'workline.doc', { operation: 'append', fileId: 'f_work', text: '- {{ $json.Name }} is {{ $json.Age }}' }),
        node('draw', 'workline.diagram', { operation: 'write', fileId: 'f_work', name: 'People', type: 'flowchart', code: 'Ada > Grace' }),
        node('new', 'workline.doc', { operation: 'create', title: 'Made by a workflow', text: 'Hello' }),
      ],
      edges: [edge('t', 'add'), edge('add', 'read'), edge('read', 'note'), edge('note', 'draw'), edge('draw', 'new')],
    };
    const r = await finished((await call('POST', '/flows/f_work/run', { flow, input: [{ Name: 'Grace', Age: 85, Team: 'Navy' }] })).json.runId);
    expect(r.status).toBe('success');
    expect(r.nodes.read.output.main).toEqual([{ Name: 'Ada', Age: '36', Team: '' }, { Name: 'Grace', Age: '85', Team: 'Navy' }]);
    const saved = (await call('GET', '/files/f_work')).json;
    expect(saved.sheets[0].cells).toMatchObject({ C1: 'Team', A3: 'Grace', B3: '85', C3: 'Navy' });
    expect(saved.doc).toBe('# Notes\n\n- Ada is 36\n\n- Grace is 85');
    expect(saved.diagrams.map(d => [d.name, d.type, d.code])).toEqual([['Diagram 1', 'architecture', 'a > b'], ['People', 'flowchart', 'Ada > Grace']]);
    expect((await call('GET', '/files/f_work/versions')).json.versions[0].title).toBe('Team'); // kept in its history like any save
    const made = r.nodes.new.output.main[0];
    expect((await call('GET', `/files/${made.fileId}`)).json).toMatchObject({ title: 'Made by a workflow', doc: 'Hello' });
    // A file that isn't there, and a saved database connection that isn't either.
    const bad = await finished((await call('POST', '/flows/f_work/run', { flow: { nodes: [node('t', 'trigger.manual'), node('x', 'workline.doc', { operation: 'read', fileId: 'nope' })], edges: [edge('t', 'x')] } })).json.runId);
    expect(bad.error).toMatch(/wasn’t found/);
    const db = await finished((await call('POST', '/flows/f_work/run', { flow: { nodes: [node('t', 'trigger.manual'), node('x', 'workline.database', { connection: 'db_gone', sql: 'select 1' })], edges: [edge('t', 'x')] } })).json.runId);
    expect(db.error).toMatch(/isn’t saved in the Database view/);
  });

  test('webhooks and schedules start a saved, active workflow', async () => {
    const flow = {
      active: true,
      nodes: [
        node('hook', 'trigger.webhook', { path: 'abcdefghijkl123', method: 'POST' }),
        node('tick', 'trigger.schedule', { mode: 'interval', every: 5, unit: 'minutes' }),
        node('send', 'core.http', { method: 'POST', url: `${fakeUrl}/got`, body: '{{ $json }}' }),
      ],
      edges: [edge('hook', 'send'), edge('tick', 'send')],
    };
    const file = { id: 'f_hook', title: 'Hooked', diagrams: [], doc: '', updated: Date.now(), flow };
    expect((await call('PUT', '/files/f_hook', file)).status).toBe(200);
    expect(store.meta.hooks.abcdefghijkl123).toMatchObject({ fileId: 'f_hook', nodeId: 'hook', method: 'POST' });

    // Called from anywhere, with any body; no session needed.
    const hook = await fetch(`${base}/hook/abcdefghijkl123?from=test`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', origin: 'https://elsewhere.example' }, body: 'order=42' });
    expect(hook.status).toBe(202);
    const run = await finished((await hook.json()).runId);
    expect(run).toMatchObject({ status: 'success', trigger: 'webhook' });
    expect(got.find(g => g.url === '/got').body).toMatchObject({ method: 'POST', query: { from: 'test' }, body: { order: '42' } });
    expect((await fetch(`${base}/hook/abcdefghijkl123`)).status).toBe(405);
    expect((await fetch(`${base}/hook/nothing-listens-here`, { method: 'POST' })).status).toBe(404);

    // The schedule fires once it's due, and not again until the next interval.
    const sched = Object.values(store.meta.schedules).find(s => s.fileId === 'f_hook');
    const before = got.length;
    await app.flows.tick(sched.last + 4 * 60_000);
    expect(got.length).toBe(before);
    await app.flows.tick(sched.last + 5 * 60_000);
    await expect.poll(() => got.length).toBe(before + 1);

    // Switched off, nothing listens.
    await call('PUT', '/files/f_hook', { ...file, flow: { ...flow, active: false }, updated: Date.now() + 1 });
    expect(store.meta.hooks.abcdefghijkl123).toBeUndefined();
    expect(Object.values(store.meta.schedules).some(s => s.fileId === 'f_hook')).toBe(false);
  });

  test('apps: a published workflow runs saved, from its trigger, with only the answers it asks for', async () => {
    const flow = { active: false, nodes: [
      node('t', 'trigger.manual'),
      node('send', 'core.http', { method: 'POST', url: `${fakeUrl}/app`, body: '{{ $json }}' }),
    ], edges: [edge('t', 'send')] };
    const file = { id: 'f_app', title: 'An app', diagrams: [], doc: '', updated: Date.now(), flow };
    await call('PUT', '/files/f_app', file);
    expect((await call('POST', '/flows/f_app/app', { input: {} })).status).toBe(404); // not published
    flow.app = { published: true, name: 'Ask', startId: 't', inputs: [{ key: 'city', label: 'City', kind: 'text', required: true }, { key: 'days', label: 'Days', kind: 'number' }] };
    await call('PUT', '/files/f_app', { ...file, flow, updated: Date.now() + 1 });
    expect((await call('POST', '/flows/f_app/app', { input: { days: 2 } })).json.message).toBe('Fill in City.');
    const r = await call('POST', '/flows/f_app/app', { input: { city: 'Pune', days: '3', sneaky: 'dropped' } });
    expect(r.status).toBe(202);
    const run = await finished(r.json.runId);
    expect(run).toMatchObject({ status: 'success', trigger: 'app' });
    expect(got.filter(g => g.url === '/app').pop().body).toEqual({ city: 'Pune', days: 3 });
  });

  test('app triggers: a form, a signed GitHub event, Slack’s URL check, and polls of a sheet and a feed', async () => {
    const rows = { id: 'f_rows', title: 'Rows', diagrams: [], doc: '', updated: Date.now(), sheets: [{ id: 's1', name: 'Sheet 1', cells: { A1: 'Name', A2: 'Ada' } }] };
    expect((await call('PUT', '/files/f_rows', rows)).status).toBe(200);
    const starts = ['form', 'gh', 'sl', 'rows', 'feed'];
    const flow = { active: true, nodes: [
      node('form', 'trigger.form', { path: 'formformform1234', title: 'Join us', fields: 'Name*\nEmail (email)' }),
      node('gh', 'trigger.github', { path: 'githubgithub1234', secret: 's3cret', events: 'issues.opened' }),
      node('sl', 'trigger.slack', { path: 'slackslackslack1' }),
      node('rows', 'trigger.sheetrow', { fileId: 'f_rows', every: 5 }),
      node('feed', 'trigger.rss', { url: `${fakeUrl}/feed.xml`, every: 5 }),
      node('send', 'core.http', { method: 'POST', url: `${fakeUrl}/trig`, body: '{{ $json }}' }),
    ], edges: starts.map(t => edge(t, 'send')) };
    expect((await call('PUT', '/files/f_trig', { id: 'f_trig', title: 'Triggers', diagrams: [], doc: '', updated: Date.now(), flow })).status).toBe(200);
    const sent = () => got.filter(g => g.url === '/trig').map(g => g.body);

    // The form: its page, an answer missing, then a whole answer.
    const page = await fetch(`${base}/hook/formformform1234`);
    expect(page.headers.get('content-type')).toMatch(/html/);
    expect(await page.text()).toContain('name="name" type="text" required');
    const post = body => fetch(`${base}/hook/formformform1234`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body });
    expect((await post('email=a%40b.c')).status).toBe(400);
    const sentForm = await post('name=Ada&email=ada%40example.com');
    expect(sentForm.status).toBe(200);
    expect(await sentForm.text()).toContain('Thanks');
    await expect.poll(() => sent().length).toBe(1);
    expect(sent()[0]).toMatchObject({ name: 'Ada', email: 'ada@example.com' });

    // GitHub: signed with the secret; other events and bad signatures are turned away.
    const body = JSON.stringify({ action: 'opened', issue: { title: 'Bug' }, repository: { full_name: 'me/app' }, sender: { login: 'ada' } });
    const sig = 'sha256=' + createHmac('sha256', 's3cret').update(body).digest('hex');
    const gh = (event, signature) => fetch(`${base}/hook/githubgithub1234`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-github-event': event, 'x-hub-signature-256': signature }, body });
    expect((await gh('issues', 'sha256=bad')).status).toBe(401);
    expect((await (await gh('push', sig)).json()).ignored).toBe('push');
    expect((await gh('issues', sig)).status).toBe(202);
    await expect.poll(() => sent().length).toBe(2);
    expect(sent()[1]).toMatchObject({ event: 'issues', action: 'opened', repository: 'me/app', sender: 'ada' });

    // Slack checks the URL with a challenge.
    const sl = await fetch(`${base}/hook/slackslackslack1`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ type: 'url_verification', challenge: 'xyz' }) });
    expect(await sl.json()).toEqual({ challenge: 'xyz' });

    // Polls: the first only looks; a later one starts the flow with each new post and row.
    const rss = titles => `<rss><channel>${titles.map(t => `<item><title>${t}</title><link>https://blog.example/${t}</link></item>`).join('')}</channel></rss>`;
    feed = rss(['One']);
    await app.flows.poll();
    expect(Object.values(store.meta.polls).filter(x => x.fileId === 'f_trig').map(x => x.error)).toEqual([null, null]);
    expect(sent()).toHaveLength(2);
    feed = rss(['Two', 'One']);
    await call('PUT', '/files/f_rows', { ...rows, sheets: [{ ...rows.sheets[0], cells: { ...rows.sheets[0].cells, A3: 'Grace' } }], updated: Date.now() + 1 });
    await app.flows.poll(Date.now() + 2 * 60_000); // not due yet
    expect(sent()).toHaveLength(2);
    await app.flows.poll(Date.now() + 5 * 60_000);
    await expect.poll(() => sent().length).toBe(4);
    expect(sent().slice(2).map(x => x.title || x.Name).sort()).toEqual(['Grace', 'Two']);
  });
});

test('the Workflow view: a template, a credential, a run, and adding a node', async ({ browser }) => {
  test.setTimeout(120_000);
  const { spawn } = await import('node:child_process');
  const slack = createServer((req, res) => { req.resume(); req.on('end', () => { res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"ok":true}'); }); }).listen(0);
  const st = await openStore(memoryBackend());
  const app = createApp(st, { requireVerified: false, dbAllowPrivate: true });
  const srv = app.listen(0);
  const port = 5193;
  const vite = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--port', String(port), '--strictPort'], { cwd: 'frontend', env: { ...process.env, LINEWORK_API: `http://localhost:${srv.address().port}` }, stdio: 'ignore', detached: true });
  try {
    const url = `http://localhost:${port}`;
    for (let i = 0; i < 60; i++) { try { if ((await fetch(url)).ok) break; } catch (e) {} await new Promise(r => setTimeout(r, 500)); }
    const ctx = await browser.newContext({ baseURL: url });
    await ctx.addInitScript(() => localStorage.setItem('linework:ai-open', '0'));
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto('/');
    await page.getByRole('button', { name: 'Create an account' }).click();
    await page.getByLabel('Email').fill('flows@example.com');
    await page.getByLabel('Password').fill('a long password');
    await page.getByRole('button', { name: 'Create account' }).click();
    await page.getByRole('button', { name: 'Tools' }).click();
    await page.locator('.tool-card').filter({ hasText: 'Webhook to Slack' }).click();

    const nodes = page.locator('.fv-node');
    await expect(nodes).toHaveCount(2);
    await expect(nodes.filter({ hasText: 'Slack' })).toContainText('Needs a credential');
    // The webhook shows its URL.
    await nodes.filter({ hasText: 'Webhook' }).click();
    await expect(page.locator('.fv-panel input[readonly]')).toHaveValue(new RegExp(`^${url}/api/hook/[a-z0-9]{24}$`));

    // A credential for Slack, made from the node.
    await nodes.filter({ hasText: 'Slack' }).click();
    await page.getByRole('button', { name: 'New', exact: true }).click();
    await page.getByLabel('Webhook URL').fill(`http://localhost:${slack.address().port}/hook`);
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(nodes.filter({ hasText: 'Slack' })).not.toContainText('Needs a credential');

    await page.getByRole('button', { name: 'Run workflow' }).click();
    await expect(page.locator('.fv-node.s-success')).toHaveCount(2, { timeout: 15_000 });
    await page.getByRole('tab', { name: /Output/ }).click();
    await expect(page.locator('.fv-out pre')).toContainText('"ok": true');

    // A node from the library on the left, joined to the selected one.
    await page.locator('.fv-lib-q').fill('if');
    await page.locator('.fv-lib-item').filter({ hasText: /^IF$/ }).click();
    await expect(nodes).toHaveCount(3);
    await expect(page.locator('.fv-edge')).toHaveCount(2);
    await expect(page.locator('.fv-np-head input')).toHaveValue('IF');

    // Published as an app: a form in Home → Apps that runs the saved workflow.
    await page.getByRole('button', { name: 'Publish', exact: true }).click();
    const pub = page.getByRole('dialog', { name: 'Publish as an app' });
    await pub.getByText('Not published').click();
    await pub.getByRole('button', { name: '+ Add a question' }).click();
    await pub.getByLabel('Question').fill('Your message');
    await expect(pub).toContainText('{{ $json.yourMessage }}');
    await pub.getByRole('button', { name: 'Done' }).click();
    await expect(page.getByRole('button', { name: 'Published' })).toBeVisible();
    await expect(page.locator('.saved')).toHaveText('Saved', { timeout: 10_000 });
    await page.getByRole('button', { name: 'Files' }).click();
    await page.getByRole('navigation', { name: 'Files' }).getByRole('button', { name: /^Apps/ }).click();
    await page.getByRole('button', { name: 'Open the app Webhook to Slack' }).click();
    await page.getByLabel('Your message').fill('Hello');
    await page.getByRole('button', { name: 'Run', exact: true }).click();
    await expect(page.locator('.app-out')).toContainText('Done', { timeout: 15_000 });
    await expect(page.locator('.app-history li')).toHaveCount(1);
    expect(errors).toEqual([]);
  } finally {
    try { process.kill(-vite.pid); } catch (e) { vite.kill(); }
    srv.close(); slack.close(); app.flows.close();
  }
});
