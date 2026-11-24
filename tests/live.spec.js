import { test, expect } from '@playwright/test';
import { spawn, spawnSync } from 'node:child_process';
import { openStore } from '../backend/store.js';
import { memoryBackend } from '../backend/storage.js';
import { createApp, LOCAL_USER } from '../backend/app.js';

// Home › Live lists everything published or switched on (apps, pages, forms, schedules…), with links and a
// way to take each offline; the WorkLine Apps phone app (/run) has a Published tab with what's live there.

const stop = p => { try { if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(p.pid), '/T', '/F']); else process.kill(-p.pid); } catch (e) { /* gone */ } };

test('Live shows what is published, and the phone app has a Published tab', async ({ browser }) => {
  test.setTimeout(180_000);
  const app = createApp(await openStore(memoryBackend()), { noAccounts: true, storeOwner: LOCAL_USER });
  const srv = app.listen(0);
  const api = `http://localhost:${srv.address().port}/api`;
  const now = Date.now();
  const file = (id, title, flow) => ({ id, title, created: now, updated: now, doc: '', diagrams: [{ id: 'd1', type: 'architecture', name: 'Diagram 1', code: '' }], active: 0, view: 'flow', flow });
  const files = [
    // Live: a published app, and (active) a page, a form and a schedule.
    file('flive1', 'Shop tools', { active: true, app: { published: true, name: 'Price checker', description: 'Checks a price', icon: '💸', inputs: [] }, edges: [], nodes: [
      { id: 't1', type: 'trigger.page', name: 'Page', x: 0, y: 0, params: { path: 'pagepathabc123456', title: 'Shop page', link: 'shop-page' } },
      { id: 't2', type: 'trigger.form', name: 'Order form', x: 0, y: 100, params: { path: 'formpathabc123456', title: 'Order form' } },
      { id: 't3', type: 'trigger.schedule', name: 'Every morning', x: 0, y: 200, params: { mode: 'daily', at: '08:30' } }] }),
    // Not live: inactive, nothing published.
    file('flive2', 'Draft flow', { active: false, edges: [], nodes: [{ id: 't', type: 'trigger.webhook', name: 'Webhook', x: 0, y: 0, params: { path: 'hookpathdef789012' } }] }),
  ];
  for (const f of files) expect((await fetch(`${api}/files/${f.id}`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(f) })).ok).toBe(true);
  const port = 5249;
  const vite = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--port', String(port), '--strictPort'], { cwd: 'frontend', env: { ...process.env, LINEWORK_API: `http://localhost:${srv.address().port}` }, stdio: 'ignore', detached: process.platform !== 'win32' });
  try {
    const url = `http://localhost:${port}`;
    for (let i = 0; i < 60; i++) { try { if ((await fetch(url)).ok) break; } catch (e) {} await new Promise(r => setTimeout(r, 500)); }
    const ctx = await browser.newContext({ baseURL: url, viewport: { width: 1400, height: 900 } });
    // Home keeps files in the browser: the same two, there (once, so changes stay).
    await ctx.addInitScript(list => { if (window.top !== window) return; localStorage.setItem('linework:ai-open', '0'); if (!sessionStorage.getItem('seeded')) { sessionStorage.setItem('seeded', '1'); localStorage.setItem('linework:files:v2', JSON.stringify(list)); } }, files);
    const page = await ctx.newPage();
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    await page.goto('/');
    await page.getByRole('button', { name: 'Live' }).click();
    const card = page.getByRole('article', { name: 'Shop tools' });
    await expect(card).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole('article', { name: 'Draft flow' })).toHaveCount(0);
    await expect(page.locator('.lv-count')).toHaveText('4');
    await expect(card.locator('li')).toHaveCount(4);
    await expect(card).toContainText('Price checker');
    await expect(card.getByRole('link', { name: /\/p\/shop-page$/ })).toBeVisible();
    await expect(card).toContainText('Runs every day at 08:30');
    // Filter by kind.
    await page.getByRole('tab', { name: /Form/ }).click();
    await expect(card.locator('li')).toHaveCount(1);
    await page.getByRole('tab', { name: /^All/ }).click();
    await page.screenshot({ path: 'test-results/live.png' });
    // Unpublishing the app takes only it away; the triggers stay live.
    await card.getByRole('button', { name: 'Unpublish' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Unpublish' }).click();
    await expect(card.locator('li')).toHaveCount(3);
    await expect(page.locator('.lv-count')).toHaveText('3');

    // The phone app: a Published tab with the live web page (the app was unpublished above, and that reached the server).
    const phone = await browser.newContext({ baseURL: url, viewport: { width: 412, height: 860 }, userAgent: 'Mozilla/5.0 (Linux; Android 14) WorkLineApp' });
    const tab = await phone.newPage();
    tab.on('pageerror', e => errors.push(e.message));
    await expect(async () => {
      await tab.goto('/run');
      await tab.getByRole('tab', { name: /Published/ }).click({ timeout: 5000 });
      await expect(tab.locator('.m-pub li')).toHaveCount(1, { timeout: 3000 });
    }).toPass({ timeout: 30_000 });
    await expect(tab.locator('.m-pub')).toContainText('Shop page');
    await expect(tab.locator('.m-pub')).toContainText('Web page');
    await expect(tab.locator('.m-pub')).not.toContainText('Price checker');
    await expect(tab.locator('.m-pub-sum')).toContainText('1 live · 0 apps · 1 web page');
    await tab.screenshot({ path: 'test-results/run-published.png' });
    expect(errors).toEqual([]);
  } finally { stop(vite); srv.close(); app.flows.close(); }
});
