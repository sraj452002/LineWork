import { test, expect } from '@playwright/test';
import { spawn, spawnSync } from 'node:child_process';
import { openStore } from '../backend/store.js';
import { memoryBackend } from '../backend/storage.js';
import { createApp, LOCAL_USER } from '../backend/app.js';

// Pages in WorkLine Apps (/run, what the Android app opens): an active workflow with a Page trigger is
// listed with the published apps, opens full screen inside the app, and the back button comes back.

const stop = p => { try { if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(p.pid), '/T', '/F']); else process.kill(-p.pid); } catch (e) { /* gone */ } };

test('/run lists live pages and opens them inside the app', async ({ browser }) => {
  test.setTimeout(150_000);
  const app = createApp(await openStore(memoryBackend()), { noAccounts: true, storeOwner: LOCAL_USER });
  const srv = app.listen(0);
  const api = `http://localhost:${srv.address().port}/api`;
  const now = Date.now();
  const page = (id, title, active, path) => ({
    id, title, created: now, updated: now, doc: '', diagrams: [{ id: 'd1', type: 'architecture', name: 'Diagram 1', code: '' }], active: 0, view: 'flow',
    flow: { active, edges: [{ id: 'e', from: 't', to: 'x', fromPort: 'main', toPort: 'main' }], nodes: [
      { id: 't', type: 'trigger.page', name: 'Page', x: 0, y: 0, params: { path, title: 'StarPlay', description: 'Shows to watch tonight', theme: 'dark' } },
      { id: 'x', type: 'ui.text', name: 'Hello', x: 300, y: 0, params: { text: '## Hello from the page', style: 'text' } }] },
  });
  for (const f of [page('fpage1', 'StarPlay 2', true, 'pagepathabc123456'), page('fpage2', 'Draft page', false, 'pagepathdef789012')]) {
    const r = await fetch(`${api}/files/${f.id}`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(f) });
    expect(r.ok).toBe(true);
  }
  const port = 5247;
  const vite = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--port', String(port), '--strictPort'], { cwd: 'frontend', env: { ...process.env, LINEWORK_API: `http://localhost:${srv.address().port}` }, stdio: 'ignore', detached: process.platform !== 'win32' });
  try {
    // The store lists the active page (not the inactive one), with its link.
    const s = await (await fetch(`${api}/store`)).json();
    expect(s.pages).toEqual([{ id: 'fpage1:t', title: 'StarPlay', description: 'Shows to watch tonight', url: '/api/hook/pagepathabc123456' }]);

    const url = `http://localhost:${port}`;
    for (let i = 0; i < 60; i++) { try { if ((await fetch(url)).ok) break; } catch (e) {} await new Promise(r => setTimeout(r, 500)); }
    const ctx = await browser.newContext({ baseURL: url, viewport: { width: 412, height: 860 }, userAgent: 'Mozilla/5.0 (Linux; Android 14) WorkLineApp' });
    const tab = await ctx.newPage();
    const errors = []; tab.on('pageerror', e => errors.push(e.message));
    await tab.goto('/run');
    // Listed as a web app, beside any published apps.
    const open = tab.getByRole('button', { name: 'Open StarPlay' });
    await expect(open).toBeVisible();
    await expect(open).toContainText('Web app');
    await expect(tab.getByRole('button', { name: 'Open Draft page' })).toHaveCount(0);
    // It opens full screen inside the app, the page itself drawn by its workflow.
    await open.click();
    await expect(tab.locator('.m-page-bar')).toContainText('StarPlay');
    await expect(tab.frameLocator('.m-page-view iframe').getByText('Hello from the page')).toBeVisible({ timeout: 20_000 });
    await tab.waitForTimeout(1500);
    await tab.screenshot({ path: 'test-results/run-page.png' });
    // The phone's back button comes back to the list (not out of the app).
    await tab.goBack();
    await expect(tab.getByRole('button', { name: 'Open StarPlay' })).toBeVisible();
    await expect(tab).toHaveURL(/\/run$/);
    // And the on-screen ← Workflows does too.
    await tab.getByRole('button', { name: 'Open StarPlay' }).click();
    await tab.getByRole('button', { name: '← Workflows' }).click();
    await expect(tab.getByRole('button', { name: 'Open StarPlay' })).toBeVisible();
    expect(errors).toEqual([]);
  } finally { stop(vite); srv.close(); app.flows.close(); }
});
