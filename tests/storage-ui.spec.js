import { test, expect } from '@playwright/test';
import { spawn, spawnSync } from 'node:child_process';
import { openStore } from '../backend/store.js';
import { memoryBackend } from '../backend/storage.js';
import { createApp } from '../backend/app.js';

// Home → Storage: upload files (any kind), see them, preview one, make a folder, move a file into it,
// rename it and delete it. The server keeps them (here in memory, so the page warns about restarts).
const stop = p => { try { if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(p.pid), '/T', '/F']); else process.kill(-p.pid); } catch (e) { /* gone */ } };

test('Storage keeps any files in folders: upload, preview, move, rename, delete', async ({ browser }) => {
  test.setTimeout(150_000);
  const app = createApp(await openStore(memoryBackend()), { noAccounts: true });
  const srv = app.listen(0), api = `http://localhost:${srv.address().port}/api`;
  const port = 5254;
  const vite = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--port', String(port), '--strictPort'], { cwd: 'frontend', env: { ...process.env, LINEWORK_API: `http://localhost:${srv.address().port}` }, stdio: 'ignore', detached: process.platform !== 'win32' });
  try {
    const url = `http://localhost:${port}`;
    for (let i = 0; i < 60; i++) { try { if ((await fetch(url)).ok) break; } catch (e) {} await new Promise(r => setTimeout(r, 500)); }
    const ctx = await browser.newContext({ baseURL: url });
    await ctx.addInitScript(() => localStorage.setItem('linework:ai-open', '0'));
    const page = await ctx.newPage();
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    await page.goto('/');
    await page.getByRole('navigation', { name: 'Files' }).getByRole('button', { name: /^Storage/ }).click();
    const st = page.getByRole('region', { name: 'Storage' });
    await expect(st.getByRole('heading', { name: 'Your Storage is empty' })).toBeVisible();
    await expect(st.locator('.st-where.warn')).toContainText('server’s memory');

    await st.getByLabel('Files to upload').setInputFiles([
      { name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('Buy milk\nCall Asha') },
      { name: 'song.mp3', mimeType: 'audio/mpeg', buffer: Buffer.alloc(3000, 7) },
    ]);
    await expect(st.locator('.st-file')).toHaveCount(2);
    await expect(st.locator('.st-use')).toContainText('2 files');

    // Preview a text file.
    await st.getByRole('button', { name: 'Open notes.txt' }).click();
    const prev = page.getByRole('dialog', { name: 'notes.txt' });
    await expect(prev.locator('pre')).toHaveText('Buy milk\nCall Asha');
    await prev.getByRole('button', { name: 'Close' }).click();

    // A folder, and the song moved into it.
    await st.getByRole('button', { name: 'New folder' }).click();
    await page.getByRole('dialog', { name: 'New folder' }).getByRole('textbox').fill('Music');
    await page.getByRole('button', { name: 'Create' }).click();
    await expect(st.getByRole('button', { name: 'Open folder Music' })).toBeVisible();
    await st.getByRole('button', { name: 'Actions for song.mp3' }).click();
    await page.getByRole('menuitem', { name: 'Move to' }).click();
    await page.getByRole('menuitem', { name: 'Music' }).click();
    await expect(st.locator('.st-file')).toHaveCount(1);
    await st.getByRole('button', { name: 'Open folder Music' }).click();
    await expect(st.getByRole('button', { name: 'Open song.mp3' })).toBeVisible();

    // Rename, then delete.
    await st.getByRole('button', { name: 'Actions for song.mp3' }).click();
    await page.getByRole('menuitem', { name: 'Rename' }).click();
    await page.getByRole('dialog', { name: 'Rename file' }).getByRole('textbox').fill('tune.mp3');
    await page.getByRole('button', { name: 'Rename', exact: true }).click();
    await expect(st.getByRole('button', { name: 'Open tune.mp3' })).toBeVisible();
    await st.getByRole('button', { name: 'Actions for tune.mp3' }).click();
    await page.getByRole('menuitem', { name: 'Delete' }).click();
    await page.getByRole('button', { name: 'Delete', exact: true }).click();
    await expect(st.getByRole('heading', { name: 'This folder is empty' })).toBeVisible();

    // Search finds files in every folder.
    await st.getByRole('button', { name: 'Storage', exact: true }).click();
    await page.getByLabel('Search Storage').fill('notes');
    await expect(st.locator('.st-file')).toHaveCount(1);
    const list = await (await fetch(`${api}/drive`)).json();
    expect(list.files.map(f => f.name)).toEqual(['notes.txt']);
    expect(list.folders).toEqual(['Music']);
    expect(errors).toEqual([]);
  } finally { stop(vite); srv.close(); app.flows.close(); }
});
