import { test, expect } from '@playwright/test';
import { openStore } from '../backend/store.js';
import { memoryBackend } from '../backend/drive.js';
import { createApp } from '../backend/app.js';

// A dashboard block fed by its file's workflow, run on the server.
test('a dashboard block shows what the file’s workflow outputs', async ({ browser }) => {
  test.setTimeout(120_000);
  const { spawn } = await import('node:child_process');
  const st = await openStore(memoryBackend());
  const srv = createApp(st, { requireVerified: false }).listen(0);
  const port = 5191;
  const vite = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--port', String(port), '--strictPort'], { cwd: 'frontend', env: { ...process.env, LINEWORK_API: `http://localhost:${srv.address().port}` }, stdio: 'ignore', detached: true });
  try {
    const url = `http://localhost:${port}`;
    for (let i = 0; i < 60; i++) { try { if ((await fetch(url)).ok) break; } catch (e) {} await new Promise(r => setTimeout(r, 500)); }
    const ctx = await browser.newContext({ baseURL: url });
    await ctx.addInitScript(() => { if (window.top === window) localStorage.setItem('linework:ai-open', '0'); });
    const page = await ctx.newPage();
    await page.goto('/');
    await page.getByRole('button', { name: 'Create an account' }).click();
    await page.getByLabel('Email').fill('dash@example.com');
    await page.getByLabel('Password').fill('a long password');
    await page.getByRole('button', { name: 'Create account' }).click();
    await page.getByRole('button', { name: 'Create a Blank File' }).click();

    // The workflow: Run by hand → Code that returns 30 rows (more than a run keeps of each step).
    await page.getByRole('button', { name: /^View:/ }).click();
    await page.getByRole('menuitemradio', { name: /^Workflow/ }).click();
    await expect(page.locator('.fv-node')).toHaveCount(1);
    await page.locator('.fv-node').first().click();
    await page.locator('.fv-lib-q').fill('code');
    await page.locator('.fv-lib-item').filter({ hasText: /^Code/ }).first().click();
    await expect(page.locator('.fv-node')).toHaveCount(2);
    await page.locator('.fv-panel textarea.code').fill("return Array.from({ length: 30 }, (_, i) => ({ team: i === 29 ? 'South' : 'Team ' + i, deals: i }));");

    // Back on the canvas: a dashboard block, fed by the workflow.
    await page.getByRole('button', { name: /^View:/ }).click();
    await page.getByRole('menuitemradio', { name: /^Canvas/ }).click();
    await page.getByRole('button', { name: /insert/i }).first().click();
    await page.getByRole('button', { name: /^Dashboard block/ }).first().click();
    await page.getByLabel('Dashboard data').selectOption('flow');
    await page.locator('.cv-dash').evaluate(() => {}); // the frame is there
    await page.getByRole('button', { name: /Refresh/ }).click();
    const frame = page.frameLocator('.cv-dash iframe');
    // Show the workflow's rows with a table: all 30 arrive, not just the run's sample.
    await expect(page.getByRole('button', { name: /Refresh/ })).toBeEnabled({ timeout: 20_000 });
    await page.getByRole('button', { name: 'Edit HTML' }).click();
    await page.getByLabel('Edit text').fill("<div id=t></div><script>table('#t', data)</script>");
    await page.keyboard.press('Escape');
    await expect(frame.locator('.lw-table td', { hasText: 'South' })).toHaveCount(1);
    await expect(frame.locator('.lw-table th')).toHaveText(['team', 'deals']);
    await expect(frame.locator('.lw-table tbody tr')).toHaveCount(30);
    await ctx.close();
  } finally {
    try { process.kill(-vite.pid); } catch (e) {}
    srv.close();
  }
});
