import { test, expect } from '@playwright/test';
import { openStore } from '../backend/store.js';
import { memoryBackend } from '../backend/storage.js';
import { createApp, LOCAL_USER } from '../backend/app.js';
import { iconPng } from '../backend/app-install.js';

// Icons of your own wherever something is published (a picture, or any emoji), and workflows and pages in
// sections of their own in the phone app and in Home → Apps.
test('custom icons when publishing, and workflows and pages apart', async ({ browser }) => {
  test.setTimeout(120_000);
  const { spawn } = await import('node:child_process');
  const app = createApp(await openStore(memoryBackend()), { noAccounts: true, storeOwner: LOCAL_USER });
  const srv = app.listen(0);
  const port = 5264;
  const vite = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--port', String(port), '--strictPort'], { cwd: 'frontend', env: { ...process.env, LINEWORK_API: `http://localhost:${srv.address().port}` }, stdio: 'ignore', detached: true });
  try {
    const url = `http://localhost:${port}`;
    for (let i = 0; i < 60; i++) { try { if ((await fetch(url)).ok) break; } catch (e) {} await new Promise(r => setTimeout(r, 500)); }
    const ctx = await browser.newContext({ baseURL: url });
    await ctx.addInitScript(() => {
      if (sessionStorage.getItem('seeded')) return; sessionStorage.setItem('seeded', '1');
      localStorage.clear(); localStorage.setItem('linework:ai-open', '0');
      const now = Date.now(), dg = [{ id: 'd1', type: 'architecture', name: 'Diagram 1', code: '' }];
      const wf = { active: false, edges: [], nodes: [{ id: 't', type: 'trigger.manual', name: 'Start', x: 80, y: 160, params: { fields: 'Name' } }],
        app: { published: true, name: 'Greeter', description: 'Says hi', icon: '✨', tone: 'blue', startId: 't', outputId: '', show: 'auto', inputs: [{ label: 'Name', key: 'name', kind: 'text' }] } };
      const pg = { active: true, edges: [{ id: 'e', from: 'p', to: 'x', fromPort: 'main', toPort: 'main' }], nodes: [
        { id: 'p', type: 'trigger.page', name: 'Page', x: 80, y: 160, params: { path: 'moviepagemovie123', title: 'Movies', icon: '🎬' } },
        { id: 'x', type: 'ui.text', name: 'Text', x: 380, y: 160, params: { text: '# Movies' } }] };
      localStorage.setItem('linework:files:v2', JSON.stringify([
        { id: 'wf1', title: 'Greeter', created: now, updated: now, doc: '', diagrams: dg, active: 0, view: 'flow', flow: wf },
        { id: 'pg1', title: 'Movies', created: now, updated: now, doc: '', diagrams: dg, active: 0, view: 'flow', flow: pg }]));
    });
    const page = await ctx.newPage();
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    await page.goto('/');

    // Publish: an emoji typed in, then a picture of your own.
    await page.getByText('Greeter').first().click();
    await page.getByRole('button', { name: /Published|Publish/ }).first().click();
    const dlg = page.getByRole('dialog', { name: 'Publish as an app' });
    await dlg.getByLabel('Your own emoji').fill('🦄');
    await expect(dlg.getByLabel('Your own emoji')).toHaveValue('🦄');
    await dlg.getByLabel('Icon picture').setInputFiles({ name: 'logo.png', mimeType: 'image/png', buffer: iconPng('G', '#e11d48', 192) });
    await expect(dlg.getByRole('button', { name: 'Your picture' }).locator('img')).toHaveAttribute('src', /^data:image\/png;base64,/);
    await dlg.getByRole('button', { name: 'Done' }).or(dlg.getByRole('button', { name: 'Close' })).first().click().catch(() => page.keyboard.press('Escape'));

    // Home → Apps: the app with its picture, and the page in a Pages section of its own.
    await page.goto('/');
    await page.getByRole('button', { name: 'Apps' }).first().click();
    await expect(page.getByRole('button', { name: 'Open the app Greeter' }).locator('img.app-img-icon')).toBeVisible();
    await expect(page.getByRole('heading', { name: /Pages/ })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Open the page Movies' })).toContainText('🎬');
    await page.waitForTimeout(1500); // the copies reach the server

    // The phone app: Workflows and Pages apart.
    const phone = await ctx.newPage();
    await phone.setViewportSize({ width: 412, height: 860 });
    await phone.goto('/run');
    await expect(phone.getByRole('tab', { name: /Workflows/ })).toHaveAttribute('aria-selected', 'true');
    await expect(phone.getByRole('button', { name: 'Run Greeter' }).locator('img.app-img-icon')).toBeVisible({ timeout: 15_000 });
    await expect(phone.getByRole('button', { name: 'Open Movies' })).toHaveCount(0);
    await phone.getByRole('tab', { name: /Pages/ }).click();
    await expect(phone.getByRole('button', { name: 'Open Movies' })).toContainText('🎬');
    await expect(phone.getByRole('button', { name: 'Run Greeter' })).toHaveCount(0);
    await phone.screenshot({ path: 'test-results/phone-pages.png' });
    expect(errors).toEqual([]);
  } finally { try { process.kill(-vite.pid); } catch (e) {} srv.close(); app.flows.close(); }
});

// A custom app (the App view) installed on a phone or computer gets the icon chosen for it.
test('an installed custom app uses its own icon', async () => {
  const app = createApp(await openStore(memoryBackend()), { noAccounts: true });
  const srv = app.listen(0);
  const base = `http://localhost:${srv.address().port}/api`;
  try {
    const png = iconPng('Z', '#16a34a', 512);
    const token = 'appicontokenappicontoken12';
    const put = await fetch(`${base}/files/ap1`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: 'ap1', title: 'Shop', diagrams: [], doc: '', updated: Date.now(), view: 'app',
      ui: { html: '<h1>Shop</h1>', flows: [], published: true, token, icon: '🛒', iconPng: `data:image/png;base64,${png.toString('base64')}` } }) });
    expect(put.status).toBe(200);
    const icon = Buffer.from(await (await fetch(`${base}/ui/${token}/icon-512.png`)).arrayBuffer());
    expect(icon.equals(png)).toBe(true);
    const manifest = await (await fetch(`${base}/ui/${token}/manifest.webmanifest`)).json();
    expect(manifest.icons).toEqual([{ src: expect.stringContaining('/icon-512.png'), sizes: '512x512', type: 'image/png', purpose: 'any' }]);
  } finally { srv.close(); app.flows.close(); }
});
