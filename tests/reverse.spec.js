import { test, expect } from '@playwright/test';
import http from 'node:http';
import { spawn, spawnSync } from 'node:child_process';
import { reverseCode, reverseData, reverseWorkflow, reverseSite } from '../frontend/src/lib/reverse.js';
import { analyseSite } from '../backend/reverse-site.js';
import { openStore } from '../backend/store.js';
import { memoryBackend } from '../backend/storage.js';
import { createApp } from '../backend/app.js';

// Tools → Reverse engineer: code, data, workflows and websites taken apart into a report, diagrams and
// (for data and workflows) a workflow.
const stop = p => { try { if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(p.pid), '/T', '/F']); else process.kill(-p.pid); } catch (e) { /* gone */ } };

test('code: stack, routes, data model and modules', () => {
  const files = [
    { path: 'package.json', text: JSON.stringify({ dependencies: { express: '^4', '@prisma/client': '^5', stripe: '^14', react: '^18' } }) },
    { path: 'server/index.js', text: "import express from 'express';\nimport users from './routes/users.js';\nconst app = express();\napp.use('/api/users', users);\napp.get('/health', (q, r) => r.send('ok'));" },
    { path: 'server/routes/users.js', text: "import { db } from '../db.js';\nimport { Router } from 'express';\nconst router = Router();\nrouter.get('/:id', async () => {});\nrouter.post('/', async () => {});\nexport default router;" },
    { path: 'server/db.js', text: "import { PrismaClient } from '@prisma/client';\nexport const db = new PrismaClient();" },
    { path: 'prisma/schema.prisma', text: 'model User {\n  id Int @id\n  email String @unique\n  posts Post[]\n}\nmodel Post {\n  id Int @id\n  title String\n  authorId Int\n  author User @relation(fields: [authorId], references: [id])\n}' },
  ];
  const r = reverseCode(files, 'Shop');
  expect(r.title).toBe('Shop (reverse engineered)');
  expect(r.doc).toContain('Express');
  expect(r.doc).toContain('Prisma ORM');
  expect(r.doc).toContain('Stripe');
  expect(r.doc).toContain('`/health`');
  expect(r.doc).toContain('`/:id`');
  expect(r.diagrams.map(d => d.name)).toEqual(['System', 'Modules', 'Data model']);
  const erd = r.diagrams.find(d => d.type === 'erd').code;
  expect(erd).toContain('User {');
  expect(erd).toContain('Post.authorId > User.id');
  expect(r.diagrams[0].code).toContain('api > db');
});

test('data: nested JSON becomes tables, and a workflow for it', () => {
  const r = reverseData(JSON.stringify({ data: [{ id: 1, name: 'Ada', email: 'ada@x.io', address: { city: 'Pune' }, orders: [{ total: 40.5, paid: true }] }], page: 1 }), 'Customers');
  const erd = r.diagrams[0].code;
  expect(erd).toContain('data {');
  expect(erd).toContain('email email');
  expect(erd).toContain('data_orders {');
  expect(erd).toContain('data_orders.data_id > data.id');
  expect(r.flow.nodes.map(n => n.type)).toEqual(['trigger.webhook', 'core.split', 'core.set']);
  const csv = reverseData('name,age\nAda,36\nGrace,45', 'People');
  expect(csv.doc).toContain('**CSV**');
  expect(csv.diagrams[0].code).toContain('age int');
});

test('workflow: an n8n export explained and made into a Workline workflow', () => {
  const n8n = { name: 'Lead alert', nodes: [
    { id: '1', name: 'Webhook', type: 'n8n-nodes-base.webhook', parameters: { path: 'lead' }, position: [0, 0] },
    { id: '2', name: 'Is big?', type: 'n8n-nodes-base.if', parameters: {}, position: [200, 0] },
    { id: '3', name: 'Slack', type: 'n8n-nodes-base.slack', parameters: { text: 'Big lead' }, position: [400, 0] },
  ], connections: { Webhook: { main: [[{ node: 'Is big?', type: 'main', index: 0 }]] }, 'Is big?': { main: [[{ node: 'Slack', type: 'main', index: 0 }]] } } };
  const r = reverseWorkflow(JSON.stringify(n8n));
  expect(r.title).toBe('Lead alert (reverse engineered)');
  expect(r.doc).toContain('**n8n** workflow with **3 steps**');
  expect(r.flow.nodes.length).toBe(3);
  expect(r.diagrams[0].code).toMatch(/\[Is big\?\] decision/);
});

test('website: a page read as a visitor, and private addresses refused', async () => {
  const srv = http.createServer((req, res) => {
    if (req.url === '/robots.txt') { res.end('User-agent: *'); return; }
    if (req.url === '/sitemap.xml') { res.setHeader('content-type', 'application/xml'); res.end('<urlset><url><loc>a</loc></url><url><loc>b</loc></url></urlset>'); return; }
    res.setHeader('content-type', 'text/html'); res.setHeader('server', 'nginx');
    res.end(`<!doctype html><html lang="en"><head><title>Acme Shop</title><meta name="description" content="Buy things">
      <script src="https://www.googletagmanager.com/gtag/js?id=G-1"></script><script src="https://js.stripe.com/v3"></script><script id="__NEXT_DATA__"></script></head>
      <body><h1>Welcome</h1><a href="/about">About</a><a href="/pricing">Pricing</a><a href="https://twitter.com/acme">Twitter</a>
      <form action="/subscribe" method="post"><input name="email" type="email"><button>Go</button></form>
      <script>fetch('/api/products').then(r => r.json())</script></body></html>`);
  }).listen(0);
  try {
    const url = `http://localhost:${srv.address().port}/`;
    await expect(analyseSite(url)).rejects.toThrow();
    const info = await analyseSite(url, { allowPrivate: true });
    expect(info.title).toBe('Acme Shop');
    expect(info.tech.map(t => t.name)).toEqual(expect.arrayContaining(['Next.js', 'Google Analytics', 'Stripe', 'nginx']));
    expect(info.links.filter(l => l.internal).map(l => l.path)).toEqual(['/about', '/pricing']);
    expect(info.forms[0]).toMatchObject({ action: '/subscribe', method: 'POST', fields: ['email'] });
    expect(info.apis).toContain('/api/products');
    expect(info.robots).toBe(true);
    expect(info.sitemap).toBe(2);
    const r = reverseSite(info, url);
    expect(r.doc).toContain('Acme Shop');
    expect(r.diagrams.map(d => d.name)).toEqual(['Site map', 'Tech']);
  } finally { srv.close(); }
});

test('the Reverse engineer tool makes a file with the report, schema and workflow', async ({ browser }) => {
  test.setTimeout(150_000);
  const app = createApp(await openStore(memoryBackend()), { noAccounts: true });
  const srv = app.listen(0), port = 5253;
  const vite = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--port', String(port), '--strictPort'], { cwd: 'frontend', env: { ...process.env, LINEWORK_API: `http://localhost:${srv.address().port}` }, stdio: 'ignore', detached: process.platform !== 'win32' });
  try {
    const url = `http://localhost:${port}`;
    for (let i = 0; i < 60; i++) { try { if ((await fetch(url)).ok) break; } catch (e) {} await new Promise(r => setTimeout(r, 500)); }
    const ctx = await browser.newContext({ baseURL: url });
    await ctx.addInitScript(() => { if (sessionStorage.getItem('seeded')) return; sessionStorage.setItem('seeded', '1'); localStorage.clear(); localStorage.setItem('linework:ai-open', '0'); });
    const page = await ctx.newPage();
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    await page.goto('/');
    await page.getByRole('navigation', { name: 'Files' }).getByRole('button', { name: /^Tools/ }).click();
    await page.getByRole('button', { name: /Reverse engineer data/ }).click();
    const dlg = page.getByRole('dialog', { name: 'Reverse engineer' });
    await expect(dlg.getByRole('tab', { name: 'Data / JSON' })).toHaveAttribute('aria-selected', 'true');
    await dlg.getByLabel('Paste here').fill('[{"id": 1, "name": "Ada", "orders": [{"total": 40}]}]');
    await page.waitForTimeout(300);
    await page.screenshot({ path: 'test-results/reverse-dialog.png' });
    await dlg.getByRole('button', { name: '⟲ Reverse engineer' }).click();
    await expect(dlg).toHaveCount(0);
    await expect(page.getByText('Reverse engineered: Data')).toBeVisible({ timeout: 10_000 });
    await page.screenshot({ path: 'test-results/reverse-result.png' });
    expect(errors).toEqual([]);
  } finally { stop(vite); srv.close(); app.flows.close(); }
});
