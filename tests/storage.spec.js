import { test, expect } from '@playwright/test';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openStore } from '../backend/store.js';
import { folderBackend, memoryBackend } from '../backend/drive.js';
import { createApp } from '../backend/app.js';

// Where the Linework API keeps each account's data, and how much it may keep.

const doc = (id, n) => JSON.stringify({ id, title: 'x'.repeat(n), diagrams: [] });

test('each account\'s files are in its own folder, and ones kept side by side before move there', async () => {
  const blobs = new Map();
  blobs.set('meta.json', JSON.stringify({
    nextVid: 2,
    users: { u1: { id: 'u1', email: 'ada@example.com', name: '', pass: '', created: 1 }, u2: { id: 'u2', email: 'grace@example.com', name: '', pass: '', created: 2 } },
    files: { u1: { f1: { updated: 1, hash: 'h', size: 2 } } },
    versions: { u1: { f1: [{ vid: 1, saved: 1, size: 2, title: '' }] } },
    images: { u2: { img1: { size: 15, saved: 1 } } },
  }));
  blobs.set('file.u1.f1.json', '{}');
  blobs.set('version.1.json', '{}');
  blobs.set('image.u2.img1.json', '{"data":"data:x"}');

  const st = await openStore(memoryBackend(blobs));
  expect([...blobs.keys()].sort()).toEqual(['ada@example.com/file.f1.json', 'ada@example.com/version.1.json', 'grace@example.com/image.img1.json', 'meta.json']);
  expect(await st.readFile('u1', 'f1')).toBe('{}');
  expect((await st.readVersion('u1', 'f1', 1)).data).toBe('{}');
  expect(await st.readImage('u2', 'img1')).toBe('data:x');

  await st.saveFile('u2', 'f9', doc('f9', 5), 5);
  expect(blobs.has('grace@example.com/file.f9.json')).toBe(true);
  expect([...blobs.keys()].filter(k => k.startsWith('grace@example.com/version.'))).toHaveLength(1);
  // Opening it again moves nothing.
  await openStore(memoryBackend(blobs));
  expect(blobs.size).toBe(6);
});

test('a local folder keeps each account in a folder too', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'lw-folders-'));
  try {
    const b = folderBackend(dir);
    await b.open();
    await b.write('ada@example.com/file.f1.json', '{"a":1}');
    await b.write('meta.json', '{}');
    expect(existsSync(join(dir, 'ada@example.com', 'file.f1.json'))).toBe(true);
    expect((await b.open()).sort()).toEqual(['ada@example.com/file.f1.json', 'meta.json']);
    await b.move('ada@example.com/file.f1.json', 'grace@example.com/file.f1.json');
    expect(await b.read('grace@example.com/file.f1.json')).toBe('{"a":1}');
    expect(await b.read('ada@example.com/file.f1.json')).toBe(null);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('the storage limit: the oldest versions make room, then saving stops', async () => {
  const st = await openStore(memoryBackend(), { versionEvery: 0, storageLimit: 900 });
  st.s.addUser.run('u', 'ada@example.com', '', '', 1, 1);
  const a = doc('f', 200), b = doc('f', 210), c = doc('f', 220);
  await st.saveFile('u', 'f', a, 1, 1000);
  await st.saveFile('u', 'f', b, 2, 2000);
  expect(st.storage('u')).toEqual({ used: b.length + a.length + b.length, limit: 900 });
  // The next one needs room: the oldest version (a) goes.
  await st.saveFile('u', 'f', c, 3, 3000);
  expect(st.versions('u', 'f').map(v => v.size)).toEqual([c.length, b.length]);
  expect(st.storage('u').used).toBe(c.length * 2 + b.length);
  expect(st.storage('u').used).toBeLessThanOrEqual(900);

  // Too big even without any versions: refused, and nothing changes.
  const before = st.storage('u').used;
  await expect(st.saveFile('u', 'g', doc('g', 900), 4, 4000)).rejects.toMatchObject({ code: 'storage_full', limit: 900 });
  expect(st.storage('u').used).toBe(before);
  expect(st.hasFile('u', 'g')).toBe(false);
  expect(st.versions('u', 'f')).toHaveLength(2);
  // Pictures count too.
  await expect(st.saveImage('u', 'img1', 'data:image/png;base64,' + 'A'.repeat(1500))).rejects.toMatchObject({ code: 'storage_full' });
  // No limit: anything goes.
  const free = await openStore(memoryBackend(), { storageLimit: 0 });
  await free.saveFile('u', 'g', doc('g', 5000), 1);
  expect(free.storage('u')).toEqual({ used: doc('g', 5000).length * 2, limit: 0 });
});

test('the API says how much storage is used, and refuses a save when it\'s full', async () => {
  const st = await openStore(memoryBackend(), { versionEvery: 0, storageLimit: 3000 });
  const srv = createApp(st, { requireVerified: false }).listen(0);
  const base = `http://localhost:${srv.address().port}/api`;
  try {
    let cookie = '';
    const call = async (method, path, body) => {
      const r = await fetch(base + path, { method, headers: { 'content-type': 'application/json', cookie }, body: body === undefined ? undefined : JSON.stringify(body) });
      const set = r.headers.get('set-cookie'); if (set) cookie = set.split(';')[0];
      return { status: r.status, json: await r.json() };
    };
    const up = await call('POST', '/auth/signup', { email: 'ada@example.com', password: 'a long password' });
    expect(up.json.user.storage).toEqual({ used: 0, limit: 3000 });
    const saved = await call('PUT', '/files/f1', JSON.parse(doc('f1', 400)));
    expect(saved.json).toEqual({ ok: true, storage: { used: doc('f1', 400).length * 2, limit: 3000 } });
    const full = await call('PUT', '/files/f2', JSON.parse(doc('f2', 2000)));
    expect(full.status).toBe(507);
    expect(full.json).toMatchObject({ error: 'storage_full', storage: { limit: 3000 } });
    expect(full.json.message).toMatch(/storage is full/);
    // Deleting makes room again.
    expect((await call('DELETE', '/files/f1')).json.storage.used).toBe(0);
    expect((await call('PUT', '/files/f2', JSON.parse(doc('f2', 1000)))).status).toBe(200);
    expect((await call('GET', '/auth/me')).json.user.storage.used).toBe(doc('f2', 1000).length * 2);
  } finally { srv.close(); }
});

test('the app warns when storage is nearly full, and when it is full', async ({ browser }) => {
  test.setTimeout(120_000);
  // A blank file and its first version take about 500 bytes: one nearly fills this, a second doesn't fit.
  const st = await openStore(memoryBackend(), { versionEvery: 0, storageLimit: 540 });
  const srv = createApp(st, { requireVerified: false }).listen(0);
  const { spawn } = await import('node:child_process');
  const port = 5194;
  const vite = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--port', String(port), '--strictPort'], { cwd: 'frontend', env: { ...process.env, LINEWORK_API: `http://localhost:${srv.address().port}` }, stdio: 'ignore', detached: true });
  try {
    const appUrl = `http://localhost:${port}`;
    for (let i = 0; i < 60; i++) { try { if ((await fetch(appUrl)).ok) break; } catch (e) {} await new Promise(r => setTimeout(r, 500)); }
    const page = await (await browser.newContext({ baseURL: appUrl })).newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto('/');
    await page.getByRole('button', { name: 'Create an account' }).click();
    await page.getByLabel('Email').fill('ada@example.com');
    await page.getByLabel('Password').fill('a long password');
    await page.getByRole('button', { name: 'Create account' }).click();
    await page.getByRole('button', { name: 'Create a Blank File' }).click();
    const warn = page.locator('.storage-warn');
    await expect(warn).toContainText(/You’ve used .* of your/);
    await warn.getByRole('button', { name: 'OK' }).click();
    await expect(warn).toHaveCount(0);
    // A second file doesn't fit: saving stops, and the notice stays.
    await page.goto('/');
    await page.getByRole('button', { name: 'Create a Blank File' }).click();
    await expect(warn).toContainText('Your storage is full');
    await expect(page.locator('.saved')).toHaveText('Storage full');
    await expect(warn.getByRole('button')).toHaveCount(0);
    expect(errors).toEqual([]);
  } finally {
    try { process.kill(-vite.pid); } catch (e) { vite.kill(); }
    srv.close();
  }
});
