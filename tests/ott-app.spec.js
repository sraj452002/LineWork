import { test, expect } from '@playwright/test';
import { openStore } from '../backend/store.js';
import { memoryBackend } from '../backend/drive.js';
import { createApp } from '../backend/app.js';

// Templates → Apps → OTT streaming app: a workflow fetches the video files and builds the catalogue; the
// app is made in the Visual builder (no code): a spotlight, rows, title pages with seasons and episodes,
// a player, search, a watchlist, sports and plans.

test('the OTT streaming app, from its template', async ({ browser }) => {
  test.setTimeout(240_000);
  const { spawn } = await import('node:child_process');
  const { createServer } = await import('node:http');
  const { readFileSync } = await import('node:fs');
  const list = createServer((req, res) => { res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' }); res.end(readFileSync('samples/videos.json')); }).listen(0);
  const srv = createApp(await openStore(memoryBackend()), { requireVerified: false, dbAllowPrivate: true }).listen(0);
  const port = 5196;
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
    await page.getByLabel('Email').fill('ott@example.com');
    await page.getByLabel('Password').fill('a long password');
    await page.getByRole('button', { name: 'Create account' }).click();
    await expect(page.getByRole('button', { name: 'Create a Blank File' })).toBeVisible();

    // Templates → Apps holds just this one.
    await page.getByRole('navigation', { name: 'Files' }).getByRole('button', { name: /^Templates/ }).click();
    const ready = page.getByRole('region', { name: 'Ready-made' });
    await ready.getByRole('group', { name: 'Show templates for' }).getByRole('button', { name: /^Apps/ }).click();
    await expect(ready.locator('.tpl-starter')).toHaveCount(1);
    await ready.getByRole('button', { name: 'Use the template OTT streaming app (Hotstar-style)' }).click();
    await expect(page.getByRole('button', { name: 'View: App' })).toBeVisible();

    // Its workflow: Run by hand → Fetch video files → Build the catalogue. Point it at our copy of the list.
    await page.getByRole('button', { name: /^View:/ }).click();
    await page.getByRole('menuitemradio', { name: /^Workflow/ }).click();
    await expect(page.locator('.fv-node')).toHaveCount(3);
    await page.locator('.fv-node').filter({ hasText: 'Fetch video files' }).click();
    await page.locator('.fv-panel label.fv-f', { hasText: 'URL' }).locator('input').fill(`http://localhost:${list.address().port}/samples/videos.json`);
    await page.getByRole('button', { name: /^View:/ }).click();
    await page.getByRole('menuitemradio', { name: /^App/ }).click();

    await expect(page.getByRole('button', { name: 'Visual' })).toHaveAttribute('aria-pressed', 'true');
    await page.getByRole('button', { name: '▶ Preview' }).click();
    const app = page.frameLocator('iframe[title="App preview"]');
    const nav = name => app.locator('.wl-nav a', { hasText: name }).first().click();
    const cardIn = (text) => app.locator('.wl-card', { hasText: text }).first();

    // Home: the spotlight, and the rows.
    await expect(app.getByRole('heading', { name: 'Code Red: Delhi' })).toBeVisible({ timeout: 30_000 });
    await app.getByRole('button', { name: 'Next' }).click();
    await expect(app.getByRole('heading', { name: 'The Last Monsoon' })).toBeVisible();
    await expect(app.getByText('Continue Watching for Riya')).toBeVisible();
    await expect(cardIn('#1  Code Red: Delhi')).toBeVisible();
    await expect(cardIn('India vs Australia')).toContainText('● LIVE');

    // A show: its page, a season, an episode playing.
    await cardIn('Mumbai Nights').click();
    await expect(app.locator('.wl-hero h1')).toHaveText('Mumbai Nights');
    await app.getByLabel('Season').selectOption({ label: 'Season 3' });
    await expect(app.locator('.wl-card', { hasText: /^E\d · / })).toHaveCount(6);
    await cardIn('E2 · The Offer').click();
    await expect(app.getByRole('heading', { name: 'Mumbai Nights · S3 E2 · The Offer' })).toBeVisible();
    await expect(app.locator('video')).toHaveCount(1); // MP4s get a src; HLS streams are attached by hls.js

    // Search, then the watchlist.
    await nav('Search');
    await app.getByPlaceholder('Movies, shows, sports, languages…').fill('kaveri');
    await expect(app.getByText('1 results')).toBeVisible();
    await cardIn('Kaveri Blues').click();
    await app.getByRole('button', { name: '+ Watchlist' }).click();
    await expect(app.getByRole('button', { name: '✓ In Watchlist' })).toBeVisible();
    await nav('My Space');
    await expect(app.getByText('Watchlist (1)')).toBeVisible();
    await expect(cardIn('Kaveri Blues')).toBeVisible();

    // Movies by language; live sports; plans by period.
    await nav('Movies');
    await app.getByLabel('Language').selectOption('Tamil');
    await expect(app.locator('.wl-card')).toHaveCount(1);
    await nav('Sports');
    await expect(app.getByText('● 3 matches live now')).toBeVisible();
    await cardIn('India vs Australia').click();
    await expect(app.getByRole('heading', { name: 'India vs Australia' })).toBeVisible();
    await nav('Subscribe');
    await app.getByLabel('Yearly').check();
    await expect(app.locator('.wl-stat', { hasText: 'Premium' }).locator('b')).toHaveText('₹1499');
    await expect(app.locator('.wl-tbl tbody tr')).toHaveCount(3);
    expect(errors).toEqual([]);
    await ctx.close();
  } finally {
    try { process.kill(-vite.pid); } catch (e) {}
    srv.close(); list.close();
  }
});
