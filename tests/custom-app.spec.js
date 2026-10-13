import { test, expect } from '@playwright/test';
import { openStore } from '../backend/store.js';
import { memoryBackend } from '../backend/drive.js';
import { createApp } from '../backend/app.js';

// Custom apps (the App view): a page of your own that runs workflows, tried in the editor's preview and
// then published at a link of its own. Also the Code node's language picker.
test('a custom app runs its workflow in the preview and at its published link', async ({ browser }) => {
  test.setTimeout(150_000);
  const { spawn } = await import('node:child_process');
  const st = await openStore(memoryBackend());
  const srv = createApp(st, { requireVerified: false }).listen(0);
  const port = 5190;
  const vite = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--port', String(port), '--strictPort'], { cwd: 'frontend', env: { ...process.env, LINEWORK_API: `http://localhost:${srv.address().port}` }, stdio: 'ignore', detached: true });
  try {
    const url = `http://localhost:${port}`;
    for (let i = 0; i < 60; i++) { try { if ((await fetch(url)).ok) break; } catch (e) {} await new Promise(r => setTimeout(r, 500)); }
    const ctx = await browser.newContext({ baseURL: url });
    await ctx.addInitScript(() => { if (window.top === window) localStorage.setItem('linework:ai-open', '0'); });
    const page = await ctx.newPage();
    await page.goto('/');
    await page.getByRole('button', { name: 'Create an account' }).click();
    await page.getByLabel('Email').fill('apps@example.com');
    await page.getByLabel('Password').fill('a long password');
    await page.getByRole('button', { name: 'Create account' }).click();

    // Tools → Custom app: a workflow (Run by hand → Code) and an App view with the form starter.
    await page.getByRole('button', { name: 'Tools' }).click();
    await page.locator('.tool-card').filter({ hasText: 'Custom app' }).click();
    await expect(page.getByRole('button', { name: 'View: App' })).toBeVisible();
    await expect(page.getByRole('button', { name: /^Workflows: My app/ })).toBeVisible();
    // It starts in the visual builder; this one is written as code, from the form.
    await page.getByRole('button', { name: 'Code', exact: true }).click();
    await page.getByRole('button', { name: 'Edit code' }).click();
    await page.getByRole('button', { name: 'Start from ▾' }).click();
    await page.getByRole('menuitem', { name: 'Form → results' }).click();
    await expect(page.getByLabel('App code')).toHaveValue(/workline\.run/);

    // The preview runs the workflow through the editor.
    const preview = page.frameLocator('iframe[title="App preview"]');
    await preview.getByLabel('Your question').fill('hello');
    await preview.getByRole('button', { name: 'Run' }).click();
    await expect(preview.locator('.lw-table td', { hasText: 'You asked: hello' })).toBeVisible({ timeout: 20_000 });

    // Change the page: the preview follows.
    const code = page.getByLabel('App code');
    await code.fill((await code.inputValue()).replace('<h1>My app</h1>', '<h1>Ask me</h1><script>const $ = s => document.querySelector(s);</script>'));  // a page can name things $ itself
    await expect(preview.locator('h1')).toHaveText('Ask me');

    // Publish: a link that works on its own, for anyone.
    await page.getByText('Publish', { exact: true }).click();
    const link = await page.getByLabel('App link').inputValue();
    expect(link).toMatch(new RegExp(`^${url}/api/ui/[a-z0-9]{32}$`));
    await expect.poll(async () => (await fetch(link)).status, { timeout: 15_000 }).toBe(200); // once it's saved

    const visitor = await browser.newContext(); // not signed in
    const app = await visitor.newPage();
    const res = await app.goto(link);
    expect(res.headers()['content-security-policy']).toMatch(/^sandbox allow-scripts/); // its own origin, away from Workline's cookies
    await expect(app.locator('h1')).toHaveText('Ask me');
    await app.getByLabel('Your question').fill('from outside');
    await app.getByRole('button', { name: 'Run' }).click();
    await expect(app.locator('.lw-table td', { hasText: 'You asked: from outside' })).toBeVisible({ timeout: 20_000 });

    // It can only run the workflows it was given.
    const token = link.split('/').pop();
    const other = await fetch(`${url}/api/ui/${token}/run`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ workflow: 'Something else', input: {} }) });
    expect(other.status).toBe(403);

    // Unpublished, the link stops working.
    await page.getByText('Published', { exact: true }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Unpublish' }).click();
    await expect.poll(async () => (await fetch(link)).status, { timeout: 15_000 }).toBe(404);
    await visitor.close();

    // The Code node: picking a language brings its starter code.
    await page.getByRole('button', { name: /^View:/ }).click();
    await page.getByRole('menuitemradio', { name: /^Workflow/ }).click();
    await page.locator('.fv-node').filter({ hasText: 'Code' }).click();
    const lang = page.locator('.fv-panel label.fv-f', { hasText: 'Language' }).locator('select');
    await expect(lang).toHaveValue('javascript');
    const src = page.locator('.fv-panel textarea.code');
    await lang.selectOption('python');
    await expect(src).toHaveValue(/You asked/); // code you've written stays
    await src.fill('');
    await lang.selectOption('lua');
    await expect(src).toHaveValue(/ipairs\(items\)/);
    await lang.selectOption('sql');
    await expect(src).toHaveValue(/FROM items/);

    // Tools → Video streaming app: the workflow and its player app, working.
    await page.getByRole('button', { name: 'Files' }).click();
    await page.getByRole('navigation', { name: 'Files' }).getByRole('button', { name: /^Tools/ }).click();
    await page.locator('.tool-card', { hasText: 'Video streaming app' }).click();
    await expect(page.getByRole('button', { name: 'View: App' })).toBeVisible();
    await expect(page.getByRole('button', { name: /^Workflows: Video library/ })).toBeVisible();
    const player = page.frameLocator('iframe[title="App preview"]');
    await expect(player.locator('.item')).toHaveCount(5, { timeout: 60_000 }); // Python's first start takes a moment
    await expect(player.locator('#title')).toHaveText('Big Buck Bunny');
    await expect(player.locator('#player')).toHaveAttribute('src', /BigBuckBunny_320x180\.mp4$/);
    await player.getByRole('button', { name: 'Streams' }).click();
    await expect(player.locator('.item')).toHaveCount(2);
    await player.locator('#q').fill('zzz');
    await expect(player.getByText('No videos match.')).toBeVisible();
    await page.getByRole('button', { name: /^View:/ }).click();
    await page.getByRole('menuitemradio', { name: /^Workflow/ }).click();
    await expect(page.locator('.fv-node')).toHaveCount(3);
    await ctx.close();
  } finally {
    try { process.kill(-vite.pid); } catch (e) {}
    srv.close();
  }
});
