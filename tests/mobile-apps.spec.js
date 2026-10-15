import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { openStore } from '../backend/store.js';
import { memoryBackend } from '../backend/drive.js';
import { createApp } from '../backend/app.js';

// WorkLine Apps (/mobile): the phone app. Signed in, it lists the account's published apps and live
// pages, runs an app, and is installable (a manifest, icons and a service worker).
test('WorkLine Apps: sign in on a phone, see the published apps and pages, run one; installable', async ({ browser }) => {
  test.setTimeout(150_000);
  const { spawn } = await import('node:child_process');
  const srv = createApp(await openStore(memoryBackend()), { requireVerified: false }).listen(0);
  const port = 5216;
  const vite = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--port', String(port), '--strictPort'], { cwd: 'frontend', env: { ...process.env, LINEWORK_API: 'http://localhost:' + srv.address().port }, stdio: 'ignore', detached: true });
  try {
    const url = 'http://localhost:' + port;
    for (let i = 0; i < 60; i++) { try { if ((await fetch(url)).ok) break; } catch (e) {} await new Promise(r => setTimeout(r, 500)); }
    const ctx = await browser.newContext({ baseURL: url, viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
    const page = await ctx.newPage();
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    await page.goto('/mobile');
    // Not signed in: the sign-in screen, then the apps.
    await page.getByRole('button', { name: 'Create an account' }).click();
    await page.getByLabel('Email').fill('maya@example.com');
    await page.getByLabel('Password').fill('a long password');
    await page.getByRole('button', { name: 'Create account' }).click();
    await expect(page.getByRole('heading', { name: 'WorkLine Apps' })).toBeVisible();
    await expect(page.getByText('No apps yet.')).toBeVisible();

    // A published app (a greeting) and a live page, made on the account.
    const flow = {
      active: true,
      nodes: [
        { id: 't', type: 'trigger.manual', name: 'Run by hand', x: 0, y: 0, params: {} },
        { id: 'u', type: 'text.upper', name: 'Shout', x: 200, y: 0, params: { value: 'Hello {{ $json.name }}!', output: 'text' } },
        { id: 'pg', type: 'trigger.page', name: 'Page', x: 0, y: 200, params: { path: 'pg0123456789abcdefghijklm', link: 'hello-maya', title: 'Hello' } },
      ],
      edges: [{ id: 'e1', from: 't', fromPort: 'main', to: 'u', toPort: 'main' }],
      app: { published: true, name: 'Greeter', description: 'Says hello, loudly.', icon: '👋', tone: 'green', startId: 't', outputId: 'u', show: 'text', inputs: [{ key: 'name', label: 'Your name', kind: 'text' }] },
    };
    await page.request.put('/api/files/f_greet', { data: { id: 'f_greet', title: 'Greeter', diagrams: [{ id: 'd1', type: 'architecture', name: 'D', code: '', manual: {}, dir: 'LR', style: 'color' }], active: 0, doc: '', updated: Date.now(), view: 'flow', flow } });
    await page.getByRole('button', { name: 'Refresh' }).click();
    await expect(page.getByRole('button', { name: 'Open the app Greeter' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Open the page Greeter' })).toHaveAttribute('href', '/p/hello-maya');
    await page.screenshot({ path: 'test-results/mobile-apps.png' });

    // Search, then run the app.
    await page.getByLabel('Search your apps').fill('zzz');
    await expect(page.getByRole('button', { name: 'Open the app Greeter' })).toHaveCount(0);
    await page.getByLabel('Search your apps').fill('greet');
    await page.getByRole('button', { name: 'Open the app Greeter' }).click();
    await page.getByLabel('Your name').fill('Maya');
    await page.getByRole('button', { name: 'Run' }).click();
    await expect(page.getByText('HELLO MAYA!')).toBeVisible({ timeout: 20_000 });
    await page.screenshot({ path: 'test-results/mobile-apps-run.png' });

    // Installable: its manifest, icons and service worker.
    await expect(page.locator('link[rel="manifest"]')).toHaveAttribute('href', '/mobile.webmanifest');
    const manifest = await (await page.request.get('/mobile.webmanifest')).json();
    expect(manifest).toMatchObject({ name: 'WorkLine Apps', start_url: '/mobile', display: 'standalone' });
    for (const icon of manifest.icons) expect((await page.request.get(icon.src)).headers()['content-type']).toContain('image/png');
    expect(await page.evaluate(() => navigator.serviceWorker.getRegistration().then(r => !!r))).toBe(true);
    // The Android app (Capacitor) opens this page.
    const cap = JSON.parse(readFileSync('mobile/capacitor.config.json', 'utf8'));
    expect(cap.server.url).toMatch(/\/mobile$/);
    expect(errors).toEqual([]);
    await ctx.close();
  } finally { try { process.kill(-vite.pid); } catch (e) {} srv.close(); }
});
