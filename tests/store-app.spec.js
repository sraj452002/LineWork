import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { openStore } from '../backend/store.js';
import { memoryBackend } from '../backend/drive.js';
import { createApp } from '../backend/app.js';

// The end users' app (/run, what the Android APK opens): with STORE_OWNER set, anyone sees that
// account's published workflows and runs them, without an account. Nothing else is there.
test('end users see the owner’s published workflows at /run and run them, with no account', async ({ browser }) => {
  test.setTimeout(150_000);
  const { spawn } = await import('node:child_process');
  const srv = createApp(await openStore(memoryBackend()), { requireVerified: false, storeOwner: 'owner@example.com' }).listen(0);
  const port = 5217;
  const vite = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--port', String(port), '--strictPort'], { cwd: 'frontend', env: { ...process.env, LINEWORK_API: 'http://localhost:' + srv.address().port }, stdio: 'ignore', detached: true });
  try {
    const url = 'http://localhost:' + port;
    for (let i = 0; i < 60; i++) { try { if ((await fetch(url)).ok) break; } catch (e) {} await new Promise(r => setTimeout(r, 500)); }

    // The owner publishes a workflow (and has one that isn't published).
    const owner = await browser.newContext({ baseURL: url });
    const op = await owner.newPage();
    await op.goto('/');
    await op.getByRole('button', { name: 'Create an account' }).click();
    await op.getByLabel('Email').fill('owner@example.com');
    await op.getByLabel('Password').fill('a long password');
    await op.getByRole('button', { name: 'Create account' }).click();
    await expect(op.getByRole('button', { name: 'Create a Blank File' })).toBeVisible();
    const flow = (published, name) => ({
      active: false,
      nodes: [{ id: 't', type: 'trigger.manual', name: 'Run by hand', x: 0, y: 0, params: {} }, { id: 'u', type: 'text.upper', name: 'Shout', x: 200, y: 0, params: { value: 'Hello {{ $json.name }}!', output: 'text' } }],
      edges: [{ id: 'e1', from: 't', fromPort: 'main', to: 'u', toPort: 'main' }],
      app: { published, name, description: 'Says hello, loudly.', icon: '👋', tone: 'green', startId: 't', outputId: 'u', show: 'text', inputs: [{ key: 'name', label: 'Your name', kind: 'text', required: true }] },
    });
    const put = (id, f) => op.request.put(`/api/files/${id}`, { data: { id, title: f.app.name, diagrams: [{ id: 'd1', type: 'architecture', name: 'D', code: '', manual: {}, dir: 'LR', style: 'color' }], active: 0, doc: '', updated: Date.now(), view: 'flow', flow: f } });
    await put('f_greet', flow(true, 'Greeter'));
    await put('f_draft', flow(false, 'Draft'));

    // An end user, on a phone, with no account.
    const ctx = await browser.newContext({ baseURL: url, viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
    const page = await ctx.newPage();
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    await page.goto('/run');
    await expect(page.getByRole('heading', { name: 'Workflows' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Run Greeter' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Run Draft' })).toHaveCount(0);
    // Workflows only: no sign-in, no AI chat, no tabs.
    await expect(page.getByRole('button', { name: 'Create an account' })).toHaveCount(0);
    await expect(page.getByRole('navigation', { name: 'WorkLine Apps' })).toHaveCount(0);
    await page.screenshot({ path: 'test-results/store-list.png' });
    await page.getByRole('button', { name: 'Run Greeter' }).click();
    await page.getByLabel('Your name *').fill('Asha');
    await page.getByRole('button', { name: 'Run', exact: true }).click();
    await expect(page.getByText('HELLO ASHA!')).toBeVisible({ timeout: 20_000 });
    await page.screenshot({ path: 'test-results/store-run.png' });
    await page.getByRole('button', { name: '← Workflows' }).click();
    await expect(page.getByRole('button', { name: 'Run Greeter' })).toBeVisible();

    // The API: only declared inputs, required ones checked, unpublished ones refused.
    expect((await page.request.post('/api/store/f_greet/run', { data: { input: {} } })).status()).toBe(400);
    expect((await page.request.post('/api/store/f_draft/run', { data: { input: { name: 'x' } } })).status()).toBe(404);
    const list = await (await page.request.get('/api/store')).json();
    expect(list.apps.map(a => a.name)).toEqual(['Greeter']);
    expect(JSON.stringify(list)).not.toContain('Shout'); // nothing about the nodes
    // The Android app opens /run, and its manifest starts there.
    expect(JSON.parse(readFileSync('mobile/capacitor.config.json', 'utf8')).server.url).toMatch(/\/run$/);
    await expect(page.locator('link[rel="manifest"]')).toHaveAttribute('href', '/run.webmanifest');
    expect(errors).toEqual([]);
    await ctx.close(); await owner.close();
  } finally { try { process.kill(-vite.pid); } catch (e) {} srv.close(); }
});

test('without STORE_OWNER, /api/store says there are no public workflows', async () => {
  const srv = createApp(await openStore(memoryBackend()), { requireVerified: false }).listen(0);
  try {
    const r = await fetch(`http://localhost:${srv.address().port}/api/store`);
    expect(r.status).toBe(404);
    expect((await r.json()).error).toBe('no_store');
  } finally { srv.close(); }
});
