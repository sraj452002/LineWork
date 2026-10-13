import { test, expect } from '@playwright/test';
import { openStore } from '../backend/store.js';
import { memoryBackend } from '../backend/drive.js';
import { createApp } from '../backend/app.js';

// Workflow view → Publish web app: a workflow that starts with a Page trigger goes on the web at its link;
// unpublished, the link shows a page saying so.

test('a page made of nodes is published as a web app, and unpublished', async ({ browser }) => {
  test.setTimeout(240_000);
  const { spawn } = await import('node:child_process');
  const { createServer } = await import('node:http');
  const { readFileSync } = await import('node:fs');
  const list = createServer((req, res) => { res.writeHead(200, { 'content-type': 'text/plain' }); res.end(readFileSync('samples/videos.json')); }).listen(0);
  const srv = createApp(await openStore(memoryBackend()), { requireVerified: false, dbAllowPrivate: true }).listen(0);
  const port = 5202;
  const vite = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--port', String(port), '--strictPort'], { cwd: 'frontend', env: { ...process.env, LINEWORK_API: `http://localhost:${srv.address().port}` }, stdio: 'ignore', detached: true });
  try {
    const url = `http://localhost:${port}`;
    for (let i = 0; i < 60; i++) { try { if ((await fetch(url)).ok) break; } catch (e) {} await new Promise(r => setTimeout(r, 500)); }
    const ctx = await browser.newContext({ baseURL: url, viewport: { width: 1500, height: 950 } });
    await ctx.addInitScript(() => { if (window.top === window) localStorage.setItem('linework:ai-open', '0'); });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto('/');
    await page.getByRole('button', { name: 'Create an account' }).click();
    await page.getByLabel('Email').fill('web@example.com');
    await page.getByLabel('Password').fill('a long password');
    await page.getByRole('button', { name: 'Create account' }).click();
    await expect(page.getByRole('button', { name: 'Create a Blank File' })).toBeVisible();
    await page.getByRole('navigation', { name: 'Files' }).getByRole('button', { name: /^Templates/ }).click();
    await page.getByRole('button', { name: 'Use the template StarPlay 2: OTT app made only of nodes', exact: true }).click();
    await page.locator('.fv-node').filter({ hasText: 'Fetch video files' }).click();
    await page.locator('.fv-panel label.fv-f', { hasText: 'URL' }).locator('input').fill(`http://localhost:${list.address().port}/samples/videos.json`);

    // Publish web app: on, with its link.
    await page.getByRole('button', { name: 'Publish web app' }).click();
    const dlg = page.getByRole('dialog', { name: 'Publish as a web app' });
    const link = await dlg.getByLabel('Web app link').inputValue();
    expect(link).toMatch(/\/api\/hook\/\w+$/);
    // Not live yet: a browser gets a page saying so.
    const off = await ctx.newPage();
    await off.goto(link);
    await expect(off.getByRole('heading', { name: 'This app isn’t live' })).toBeVisible();
    await dlg.getByRole('button', { name: 'Publish', exact: true }).click();
    await expect(dlg.getByText('Live: anyone with the link can use it')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Live on the web' })).toBeVisible();
    await expect(page.getByText('Saved', { exact: true }).first()).toBeVisible();

    // Anyone opens it: the app, and its pages.
    const visitor = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const v = await visitor.newPage();
    await expect.poll(async () => { await v.goto(link); return v.locator('h1').first().textContent(); }, { timeout: 20_000 }).toBe('StarPlay 2');
    await expect(v.getByText('Top 10 in India Today')).toBeVisible();
    // Videos play on every browser: Safari's own controls need scripts allowed in the sandbox, while
    // script-src 'none' keeps any script on the page from running.
    const csp = (await fetch(link)).headers.get('content-security-policy');
    expect(csp).toContain('sandbox allow-scripts');
    expect(csp).toContain("script-src 'none'");
    await v.goto(link + '?page=watch&video=kaveri');
    await expect(v.locator('video[controls]')).toHaveAttribute('src', /\.mp4$/);
    expect(await v.evaluate(() => typeof window.ran)).toBe('undefined');
    await v.goto(link);
    await v.getByRole('link', { name: '🏏 Sports' }).click();
    await expect(v.getByRole('cell', { name: 'India vs Australia' })).toBeVisible();

    // Unpublish: the link says it isn't live.
    await dlg.getByRole('button', { name: 'Unpublish' }).click();
    await expect(page.getByRole('button', { name: 'Publish web app' })).toBeVisible();
    await expect.poll(async () => { await v.goto(link); return v.locator('h1').first().textContent(); }, { timeout: 20_000 }).toBe('This app isn’t live');
    await visitor.close(); await off.close();
    expect(errors).toEqual([]);
    await ctx.close();
  } finally {
    try { process.kill(-vite.pid); } catch (e) {}
    srv.close(); list.close();
  }
});
