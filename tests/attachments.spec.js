import { test, expect } from '@playwright/test';
import dns from 'node:dns/promises';
import { syncBuiltinESMExports } from 'node:module';
import { runFlow } from '../backend/flow-engine.js';
import { NODE_TYPES } from '../backend/flow-nodes.js';
import { APP_NODES } from '../backend/flow-apps.js';
import { ACTION_NODES } from '../backend/flow-actions.js';
import { attachments } from '../backend/flow-util.js';
import { runFields, runValues } from '../frontend/src/lib/flows.js';

// Files: a Run by hand (file) field brings the file into the item, and the email nodes attach it.

const FILE = { name: 'report.txt', type: 'text/plain', size: 11, data: Buffer.from('hello world').toString('base64') };
const run = async (type, params, json, ctx = {}) => {
  const flow = { nodes: [{ id: 't', type: 'trigger.manual', name: 'Start' }, { id: 'n', type, name: 'Mail', params, credential: ctx.cred ? 'c1' : undefined }], edges: [{ from: 't', to: 'n' }] };
  const r = await runFlow(flow, { startId: 't', input: [{ json }], types: { ...NODE_TYPES, ...APP_NODES }, ctx });
  if (r.status !== 'success') throw new Error(r.error);
  return r.nodes.n.output.main;
};

test('a (file) field: its answer is the file', () => {
  const f = runFields('Name*\nResume* (file)');
  expect(f.map(x => [x.key, x.kind, x.required])).toEqual([['name', 'text', true], ['resume', 'file', true]]);
  expect(runValues(f, { name: 'Asha', resume: FILE })).toEqual({ name: 'Asha', resume: FILE });
  expect(runValues(f, { name: 'Asha' }).resume).toBe(null);
});

test('attachments: files, lists, data: URLs; blank is none; the rest is explained', () => {
  expect(attachments('')).toEqual([]);
  expect(attachments(null)).toEqual([]);
  expect(attachments(FILE)).toEqual([{ filename: 'report.txt', contentType: 'text/plain', base64: FILE.data }]);
  expect(attachments([FILE, { ...FILE, name: 'b.txt' }]).map(a => a.filename)).toEqual(['report.txt', 'b.txt']);
  // An expression in a longer text gives JSON text: read too.
  expect(attachments(JSON.stringify(FILE))[0].filename).toBe('report.txt');
  expect(attachments('data:image/png;base64,iVBORw0KGgo=')[0]).toMatchObject({ contentType: 'image/png', base64: 'iVBORw0KGgo=' });
  // A name can't escape into a path.
  expect(attachments({ ...FILE, name: '../../etc/passwd' })[0].filename).toBe('.._.._etc_passwd');
  expect(() => attachments('https://example.com/a.pdf')).toThrow('takes a file from a form’s file field');
  expect(() => attachments({ name: 'x' })).toThrow('takes a file');
  expect(() => attachments({ name: 'x', data: 'not base64!' })).toThrow('isn’t a file Workline can attach');
  expect(() => attachments({ name: 'big', data: 'A'.repeat(28 * 2 ** 20) })).toThrow('at most 20 MB');
  expect(() => attachments(Array.from({ length: 11 }, () => FILE))).toThrow('At most 10 attachments');
});

test('the Email node attaches the file from the form', async () => {
  const sent = [];
  const ctx = { mailer: { configured: true, send: async m => { sent.push(m); } } };
  const [out] = await run('app.email', { to: 'me@example.com', subject: 'New from {{ $json.name }}', text: 'See attached', attachments: '{{ $json.attachment }}' }, { name: 'Asha', attachment: FILE }, ctx);
  expect(out).toEqual({ sent: true, to: 'me@example.com', attached: ['report.txt'] });
  expect(sent[0].subject).toBe('New from Asha');
  expect(sent[0].attachments).toHaveLength(1);
  expect(sent[0].attachments[0]).toMatchObject({ filename: 'report.txt', contentType: 'text/plain' });
  expect(sent[0].attachments[0].content.toString()).toBe('hello world');
  // No file picked (an optional field): the email goes without one.
  const [plain] = await run('app.email', { to: 'me@example.com', subject: 'x', text: 'y', attachments: '{{ $json.attachment }}' }, { attachment: null }, ctx);
  expect(plain).toEqual({ sent: true, to: 'me@example.com' });
  expect(sent[1].attachments).toBe(undefined);
});

test('SendGrid, Resend, Postmark and Brevo send the file the way each wants it', async () => {
  const real = globalThis.fetch, realLookup = dns.lookup, calls = [];
  dns.lookup = async () => [{ address: '93.184.216.34', family: 4 }];
  syncBuiltinESMExports();
  globalThis.fetch = async (url, init) => { calls.push({ url: String(url), body: JSON.parse(init.body) }); return new Response('{"id":"1","MessageID":"1","messageId":"1"}', { status: 200, headers: { 'content-type': 'application/json' } }); };
  const ctx = { cred: async () => ({ apiKey: 'k', serverToken: 't', from: 'me@example.com' }), brevo: { apiKey: 'xkeysib-k', from: 'me@example.com' } };
  const params = { to: 'you@example.com', subject: 'Hi', text: 'Attached', attachments: '{{ $json.file }}' };
  try {
    for (const type of ['sendgrid', 'resend', 'postmark', 'brevo']) await run(type, params, { file: FILE }, ctx);
    const [sg, rs, pm, bv] = calls.map(c => c.body);
    expect(sg.attachments).toEqual([{ content: FILE.data, filename: 'report.txt', type: 'text/plain', disposition: 'attachment' }]);
    expect(rs.attachments).toEqual([{ filename: 'report.txt', content: FILE.data, content_type: 'text/plain' }]);
    expect(pm.Attachments).toEqual([{ Name: 'report.txt', Content: FILE.data, ContentType: 'text/plain' }]);
    expect(bv.attachment).toEqual([{ name: 'report.txt', content: FILE.data }]);
    // Without a file nothing is added.
    calls.length = 0;
    await run('resend', { ...params, attachments: '' }, {}, ctx);
    expect(calls[0].body.attachments).toBe(undefined);
  } finally { globalThis.fetch = real; dns.lookup = realLookup; syncBuiltinESMExports(); }
});

test('pick a file in the run form; it goes with the run, and a big one is refused', async ({ browser }) => {
  test.setTimeout(120_000);
  const { spawn, spawnSync } = await import('node:child_process');
  const { openStore } = await import('../backend/store.js');
  const { memoryBackend } = await import('../backend/storage.js');
  const { createApp } = await import('../backend/app.js');
  const app = createApp(await openStore(memoryBackend()), { noAccounts: true });
  const srv = app.listen(0);
  const port = 5244;
  const vite = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--port', String(port), '--strictPort'], { cwd: 'frontend', env: { ...process.env, LINEWORK_API: `http://localhost:${srv.address().port}` }, stdio: 'ignore', detached: process.platform !== 'win32' });
  try {
    const url = `http://localhost:${port}`;
    for (let i = 0; i < 60; i++) { try { if ((await fetch(url)).ok) break; } catch (e) {} await new Promise(r => setTimeout(r, 500)); }
    const ctx = await browser.newContext({ baseURL: url });
    await ctx.addInitScript(() => {
      if (sessionStorage.getItem('s')) return; sessionStorage.setItem('s', '1');
      localStorage.clear(); localStorage.setItem('linework:ai-open', '0');
      const now = Date.now();
      const flow = { active: false, edges: [], nodes: [{ id: 't', type: 'trigger.manual', name: 'Run by hand', x: 80, y: 160, params: { fields: 'Name*\nResume* (file)' } }] };
      localStorage.setItem('linework:files:v2', JSON.stringify([{ id: 'wf1', title: 'Upload', created: now, updated: now, doc: '', diagrams: [{ id: 'd1', type: 'architecture', name: 'Diagram 1', code: '' }], active: 0, view: 'flow', flow }]));
    });
    const page = await ctx.newPage();
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    let sent = null;
    await page.route('**/api/flows/wf1/run', async r => { sent = r.request().postDataJSON(); await r.continue(); });
    await page.goto('/');
    await page.getByText('Upload').first().click();
    await page.getByRole('button', { name: 'Run workflow' }).click();
    const form = page.getByRole('dialog', { name: 'Run with input' });
    await form.getByLabel(/^Name/).fill('Asha');
    // Required: asked for when missing.
    await form.getByRole('button', { name: 'Run' }).click();
    await expect(form.getByRole('alert')).toHaveText('Fill in Resume.');
    // Too big: refused with the reason.
    await form.getByLabel(/^Resume/).setInputFiles({ name: 'huge.bin', mimeType: 'application/octet-stream', buffer: Buffer.alloc(11 * 2 ** 20) });
    await expect(form.getByRole('alert')).toContainText('“huge.bin” is 11.0 MB: a file can be at most 10 MB.');
    await form.getByLabel(/^Resume/).setInputFiles({ name: 'cv.txt', mimeType: 'text/plain', buffer: Buffer.from('my cv') });
    await expect(form.locator('.fv-rf-file small')).toHaveText('cv.txt · 1 KB');
    // The JSON tab shows the file without its contents.
    await form.getByRole('tab', { name: 'JSON' }).click();
    await expect(form.getByLabel('Input as JSON')).toHaveValue(/files are sent from the Form tab/);
    await form.getByRole('tab', { name: 'Form' }).click();
    await form.getByLabel(/^Resume/).setInputFiles({ name: 'cv.txt', mimeType: 'text/plain', buffer: Buffer.from('my cv') });
    await form.screenshot({ path: 'test-results/run-form-file.png' });
    await form.getByRole('button', { name: 'Run' }).click();
    await expect.poll(() => sent).not.toBe(null);
    expect(sent.input).toEqual([{ name: 'Asha', resume: { name: 'cv.txt', type: 'text/plain', size: 5, data: Buffer.from('my cv').toString('base64') } }]);
    // The run's record keeps small files whole; the output shows the item.
    await expect.poll(async () => {
      const list = (await page.evaluate(() => fetch('/api/flows/wf1/runs').then(r => r.json()))).runs || [];
      if (!list[0]) return null;
      const { run } = await page.evaluate(id => fetch(`/api/runs/${id}`).then(r => r.json()), list[0].id);
      return run?.nodes?.t?.output?.main?.[0]?.resume?.name ?? null;
    }, { timeout: 15_000 }).toBe('cv.txt');
    expect(errors).toEqual([]);
  } finally {
    try { if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(vite.pid), '/T', '/F']); else process.kill(-vite.pid); } catch (e) {}
    srv.close(); app.flows.close();
  }
});

test('a big file is kept out of the run’s record, by name and size', async () => {
  const { openStore } = await import('../backend/store.js');
  const { memoryBackend } = await import('../backend/storage.js');
  const { createApp } = await import('../backend/app.js');
  const app = createApp(await openStore(memoryBackend()), { noAccounts: true });
  const srv = app.listen(0);
  const base = `http://localhost:${srv.address().port}/api`;
  try {
    const big = { name: 'scan.pdf', type: 'application/pdf', size: 700000, data: 'A'.repeat(940000) };
    const flow = { nodes: [{ id: 't', type: 'trigger.manual', name: 'Start', params: {} }], edges: [] };
    const { runId } = await fetch(base + '/flows/wf9/run', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ flow, startId: 't', input: [{ name: 'Asha', doc: big }] }) }).then(r => r.json());
    let run;
    for (let i = 0; i < 30; i++) { ({ run } = await fetch(base + '/runs/' + runId).then(r => r.json())); if (run.status !== 'running') break; await new Promise(r => setTimeout(r, 100)); }
    const item = run.nodes.t.output.main[0];
    expect(item.name).toBe('Asha');
    expect(item.doc).toMatchObject({ name: 'scan.pdf', size: 700000 });
    expect(item.doc.data).toMatch(/file contents, \d+ KB, not kept/);
  } finally { srv.close(); app.flows.close(); }
});

test('an email step that can’t reach its SMTP server says why and what works instead', async () => {
  const net = await import('node:net');
  // A port nothing listens on: the connection is refused, as a blocked email port is.
  const server = net.createServer();
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  await new Promise(r => server.close(r));
  const ctx = { cred: async () => ({ smtpUrl: `smtp://u:p@127.0.0.1:${port}` }) };
  const flow = { nodes: [{ id: 't', type: 'trigger.manual', name: 'Start' }, { id: 'n', type: 'app.email', name: 'Mail', params: { to: 'me@example.com', subject: 'x', text: 'y' }, credential: 'c1' }], edges: [{ from: 't', to: 'n' }] };
  const r = await runFlow(flow, { startId: 't', input: [{ json: {} }], types: { ...NODE_TYPES, ...APP_NODES }, ctx });
  expect(r.status).not.toBe('success');
  expect(r.error).toContain('SMTP blocked');
  expect(r.error).toContain('Resend, Brevo, SendGrid, Mailgun or Postmark');
});

test('Brevo takes its key and sender from the server (BREVO_API_KEY, BREVO_FROM), not a credential', async () => {
  const flow = { nodes: [{ id: 't', type: 'trigger.manual', name: 'Start' }, { id: 'n', type: 'brevo', name: 'Brevo', params: { to: 'you@example.com', subject: 'x', text: 'y' } }, { id: 'c', type: 'brevo.contact', name: 'Contact', params: { email: 'you@example.com' } }], edges: [{ from: 't', to: 'n' }] };
  const go = async (brevo, startAt = 'n', fetchImpl) => {
    const real = globalThis.fetch, realLookup = dns.lookup;
    if (fetchImpl) { globalThis.fetch = fetchImpl; dns.lookup = async () => [{ address: '93.184.216.34', family: 4 }]; syncBuiltinESMExports(); }
    const f = { ...flow, edges: [{ from: 't', to: startAt }] };
    try { return await runFlow(f, { startId: 't', input: [{ json: {} }], types: { ...NODE_TYPES, ...APP_NODES, ...ACTION_NODES }, ctx: { brevo } }); }
    finally { globalThis.fetch = real; dns.lookup = realLookup; syncBuiltinESMExports(); }
  };
  // Not set up, or an SMTP key: a plain answer.
  expect((await go({})).error).toContain('BREVO_API_KEY');
  expect((await go({ apiKey: 'xsmtpsib-abc', from: 'me@example.com' })).error).toContain('xkeysib-');
  expect((await go({ apiKey: 'xsmtpsib-abc' }, 'c')).error).toContain('xkeysib-');
  // Set: the key (spaces and quotes taken off) and the sender go to Brevo, for the email and the contact steps.
  const calls = [];
  const answer = async (url, init) => { calls.push({ url: String(url), key: new Headers(init.headers).get('api-key'), body: JSON.parse(init.body) }); return new Response('{"messageId":"m1","id":1}', { status: 201, headers: { 'content-type': 'application/json' } }); };
  expect((await go({ apiKey: ' "xkeysib-abc" ', from: 'Workline <me@example.com>' }, 'n', answer)).status).toBe('success');
  expect((await go({ apiKey: 'xkeysib-abc' }, 'c', answer)).status).toBe('success');
  expect(calls.map(c => [c.url, c.key])).toEqual([['https://api.brevo.com/v3/smtp/email', 'xkeysib-abc'], ['https://api.brevo.com/v3/contacts', 'xkeysib-abc']]);
  expect(calls[0].body.sender).toEqual({ name: 'Workline', email: 'me@example.com' });
});
