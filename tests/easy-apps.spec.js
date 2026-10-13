import { test, expect } from '@playwright/test';
import { openStore } from '../backend/store.js';
import { memoryBackend } from '../backend/drive.js';
import { createApp } from '../backend/app.js';

// Help → Easy start: a guide in plain words, and two examples (a workflow, then an app on it) that open
// from the guide and work.

test('the Easy start guide opens two examples, and both work', async ({ browser }) => {
  test.setTimeout(240_000);
  const { spawn } = await import('node:child_process');
  const srv = createApp(await openStore(memoryBackend()), { requireVerified: false }).listen(0);
  const port = 5191;
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
    await page.getByLabel('Email').fill('learner@example.com');
    await page.getByLabel('Password').fill('a long password');
    await page.getByRole('button', { name: 'Create account' }).click();
    await expect(page.getByRole('button', { name: 'Create a Blank File' })).toBeVisible();

    // The guide, from the home page's keyboard shortcut, then its Easy start tab.
    await page.keyboard.press('g');
    await page.getByRole('button', { name: 'Easy start' }).click();
    await expect(page.getByRole('heading', { name: 'Easy start: make your first app' })).toBeVisible();
    await expect(page.locator('.g-doc')).toContainText('The workflow is the kitchen');

    // Example 1: the report card.
    await page.getByRole('button', { name: 'Open Example 1 (ready-made)' }).click();
    await expect(page.getByRole('button', { name: 'Visual' })).toHaveAttribute('aria-pressed', 'true', { timeout: 15_000 });
    await page.getByRole('button', { name: '▶ Preview' }).click();
    let app = page.frameLocator('iframe[title="App preview"]');
    await app.getByLabel('Your name').fill('Riya');
    for (const [s, m] of [['Maths', 95], ['Science', 88], ['English', 76], ['Hindi', 81], ['Social science', 70]]) await app.getByLabel(s, { exact: true }).fill(String(m));
    await app.getByRole('button', { name: 'Make my report card' }).click();
    const stat = label => app.locator('.wl-stat', { hasText: label }).locator('b');
    await expect(stat('Total')).toHaveText('410', { timeout: 30_000 });
    await expect(stat('Percentage')).toHaveText('82%');
    await expect(stat('Grade')).toHaveText('A');
    await expect(stat('Result')).toHaveText('Pass');
    await expect(app.getByText('Well done, Riya!')).toBeVisible();
    await page.getByRole('button', { name: '✎ Edit' }).click();

    // Example 2: the quiz, from the guide again.
    await page.getByRole('button', { name: /Back|Home/ }).first().click();
    await page.keyboard.press('g');
    await page.getByRole('button', { name: 'Easy start' }).click();
    await page.getByRole('button', { name: 'Open Example 2 (ready-made)' }).click();
    await expect(page.getByRole('button', { name: 'Visual' })).toHaveAttribute('aria-pressed', 'true', { timeout: 15_000 });
    await page.getByRole('button', { name: '▶ Preview' }).click();
    app = page.frameLocator('iframe[title="App preview"]');
    await expect(app.getByText('1. What is 12 × 12?')).toBeVisible({ timeout: 30_000 });
    await expect(app.locator('.wl-radio input:checked')).toHaveCount(0); // nothing picked for you
    for (const a of ['144', 'Mars', 'Oxygen', 'Rabindranath Tagore', 'Water']) await app.getByLabel(a, { exact: true }).check();
    await app.getByRole('button', { name: 'Check my answers' }).click();
    await expect(app.locator('h1.wl-h')).toHaveText('Your score');
    await expect(app.locator('.wl-stat b')).toHaveText('4 / 5', { timeout: 30_000 });
    await expect(app.locator('.wl-tbl tbody tr')).toHaveCount(5);
    await expect(app.locator('.wl-tbl tbody tr').nth(2)).toContainText('Carbon dioxide');
    await app.getByRole('button', { name: '↺ Try again' }).click();
    await expect(app.getByText('1. What is 12 × 12?')).toBeVisible();
    expect(errors).toEqual([]);
    await ctx.close();
  } finally {
    try { process.kill(-vite.pid); } catch (e) {}
    srv.close();
  }
});
