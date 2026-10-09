import { test, expect } from '@playwright/test';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openStore } from '../backend/store.js';
import { memoryBackend } from '../backend/drive.js';
import { createApp } from '../backend/app.js';

// The Linework API (backend/): directly, then the app running against it through Vite's proxy.
// AI requests go to a stand-in for Anthropic's API.

test.describe.configure({ mode: 'serial' });
let dir, store, srv, base, fakeAi, aiCalls = 0, vite, appUrl;

test.beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'lw-server-'));
  fakeAi = createServer((req, res) => {
    aiCalls++;
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.end('data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"Hello"}}\n\ndata: {"type":"message_stop"}\n\n');
  }).listen(0);
  store = await openStore(memoryBackend(), { versionEvery: 0, keepVersions: 3 });
  const app = createApp(store, { aiKey: 'test-key', aiBase: `http://localhost:${fakeAi.address().port}`, aiDailyLimit: 2 });
  srv = app.listen(0);
  base = `http://localhost:${srv.address().port}`;
});
test.afterAll(async () => {
  if (vite) try { process.kill(-vite.pid); } catch (e) { vite.kill(); } // its process group; Windows has none
  srv?.close(); fakeAi?.close(); store?.close();
  rmSync(dir, { recursive: true, force: true });
});

// A little client that keeps its own session cookie, like one browser.
const client = () => {
  let cookie = '';
  const call = async (method, path, body, headers = {}) => {
    const r = await fetch(base + '/api' + path, {
      method, headers: { ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...(cookie ? { cookie } : {}), ...headers },
      body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
    });
    const set = r.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    const text = await r.text();
    let json = null; try { json = JSON.parse(text); } catch (e) {}
    return { status: r.status, json, text, set };
  };
  return { call, get cookie() { return cookie; } };
};
const file = (id, title, more = {}) => ({ id, title, diagrams: [], doc: '', updated: Date.now(), ...more });

test('accounts: sign up, sign in, wrong password, sign out', async () => {
  const a = client();
  expect((await a.call('GET', '/server')).json).toMatchObject({ name: 'linework-server', features: ['versions', 'share', 'folders', 'ai-limits', '2fa', 'db'] });
  expect((await a.call('GET', '/auth/me')).status).toBe(401);
  expect((await a.call('POST', '/auth/signup', { email: 'ada@example.com', password: 'short' })).json.error).toBe('weak_password');
  const up = await a.call('POST', '/auth/signup', { email: ' Ada@Example.com ', password: 'correct horse', name: 'Ada' });
  expect(up.status).toBe(201);
  expect(up.json.user).toMatchObject({ email: 'ada@example.com', name: 'Ada', folders: [] });
  expect(up.set).toMatch(/lw_session=.+; Path=\/; HttpOnly; SameSite=Lax/);
  expect((await a.call('GET', '/auth/me')).json.user.email).toBe('ada@example.com');
  expect((await a.call('POST', '/auth/signup', { email: 'ada@example.com', password: 'another one' })).status).toBe(409);

  const b = client();
  expect((await b.call('POST', '/auth/login', { email: 'ada@example.com', password: 'wrong password' })).json.error).toBe('bad_login');
  // Ten wrong passwords for one email, and that email waits (15 minutes), even with the right one.
  await b.call('POST', '/auth/signup', { email: 'eve@example.com', password: 'eves password' });
  for (let i = 0; i < 10; i++) await b.call('POST', '/auth/login', { email: 'eve@example.com', password: 'guess ' + i });
  expect((await b.call('POST', '/auth/login', { email: 'eve@example.com', password: 'eves password' })).json.error).toBe('too_many');
  expect((await b.call('POST', '/auth/login', { email: 'ADA@example.com', password: 'correct horse' })).status).toBe(200);
  expect((await b.call('POST', '/auth/logout', {})).status).toBe(200);
  expect((await b.call('GET', '/auth/me')).status).toBe(401);

  // Storage keeps only a hash of the session token, and a scrypt hash of the password.
  await store.flush();
  const meta = store.backend.blobs.get('meta.json');
  expect(store.s.userByEmail.get('ada@example.com').pass).toMatch(/^scrypt\$/);
  expect(meta).not.toContain(decodeURIComponent(a.cookie.split('=')[1]));
  expect(meta).not.toContain('correct horse');
});

test('changes must come from the same site, as JSON', async () => {
  const a = client();
  await a.call('POST', '/auth/login', { email: 'ada@example.com', password: 'correct horse' });
  expect((await a.call('PUT', '/files/f1', file('f1', 'x'), { origin: 'https://evil.example' })).status).toBe(403);
  // The same host over https (a proxy ending TLS in front of the server) is this site.
  expect((await a.call('PUT', '/files/f0', file('f0', 'x'), { origin: base.replace('http:', 'https:') })).status).toBe(200);
  await a.call('DELETE', '/files/f0');
  expect((await a.call('PUT', '/files/f1', 'id=f1', { 'content-type': 'application/x-www-form-urlencoded' })).status).toBe(415);
  expect((await a.call('PUT', '/files/f1', '{not json')).json.error).toBe('bad_json');
});

test('files are private to each account, and keep a version history', async () => {
  const a = client(), b = client();
  await a.call('POST', '/auth/login', { email: 'ada@example.com', password: 'correct horse' });
  await b.call('POST', '/auth/signup', { email: 'bob@example.com', password: 'bobs password' });
  expect((await a.call('PUT', '/files/f1', file('f1', 'Plan v1'))).json.ok).toBe(true);
  expect((await a.call('PUT', '/files/f1', file('f2', 'wrong id'))).json.error).toBe('bad_file');
  expect((await a.call('GET', '/files')).json.files.map(f => f.title)).toEqual(['Plan v1']);
  expect((await b.call('GET', '/files')).json.files).toEqual([]);
  expect((await b.call('GET', '/files/f1')).status).toBe(404);

  // Each save is a version here (versionEvery: 0), the same content isn't, and only the last 3 are kept.
  for (const t of ['Plan v2', 'Plan v2', 'Plan v3', 'Plan v4']) await a.call('PUT', '/files/f1', file('f1', t, { updated: 1 }));
  const v = (await a.call('GET', '/files/f1/versions')).json.versions;
  expect(v.map(x => x.title)).toEqual(['Plan v4', 'Plan v3', 'Plan v2']);
  expect((await a.call('GET', `/files/f1/versions/${v[2].id}`)).json.file.title).toBe('Plan v2');
  expect((await b.call('GET', `/files/f1/versions/${v[2].id}`)).status).toBe(404);

  await a.call('DELETE', '/files/f1');
  expect((await a.call('GET', '/files/f1/versions')).json.versions).toEqual([]);
});

test('share links: view, edit, and turning one off', async () => {
  const a = client(), guest = client();
  await a.call('POST', '/auth/login', { email: 'ada@example.com', password: 'correct horse' });
  expect((await a.call('POST', '/files/nope/shares', { mode: 'view' })).status).toBe(404);
  await a.call('PUT', '/files/s1', file('s1', 'Shared plan'));
  const view = (await a.call('POST', '/files/s1/shares', { mode: 'view' })).json;
  const edit = (await a.call('POST', '/files/s1/shares', { mode: 'edit' })).json;
  expect(view.url).toBe(`${base}/s/${view.token}`);
  expect((await a.call('GET', '/files/s1/shares')).json.shares.map(s => s.mode)).toEqual(['view', 'edit']);

  expect((await guest.call('GET', `/shared/${view.token}`)).json).toMatchObject({ mode: 'view', owner: 'Ada', file: { title: 'Shared plan' } });
  expect((await guest.call('PUT', `/shared/${view.token}`, file('s1', 'hacked'))).status).toBe(403);
  expect((await guest.call('PUT', `/shared/${edit.token}`, file('other', 'wrong file'))).json.error).toBe('bad_file');
  expect((await guest.call('PUT', `/shared/${edit.token}`, file('s1', 'Edited by a guest'))).json.ok).toBe(true);
  expect((await a.call('GET', '/files/s1')).json.title).toBe('Edited by a guest');
  expect((await guest.call('GET', '/files')).status).toBe(401); // a link opens one file, not the account

  await a.call('DELETE', `/shares/${edit.token}`);
  expect((await guest.call('GET', `/shared/${edit.token}`)).status).toBe(404);
  await a.call('DELETE', '/files/s1');
  expect((await guest.call('GET', `/shared/${view.token}`)).status).toBe(404);
});

test('folders are saved to the account', async () => {
  const a = client();
  await a.call('POST', '/auth/login', { email: 'ada@example.com', password: 'correct horse' });
  expect((await a.call('PUT', '/folders', { folders: [{ id: 'bad id!', name: 'x' }] })).status).toBe(400);
  await a.call('PUT', '/folders', { folders: [{ id: 'k1', name: 'Work', extra: 'dropped' }] });
  expect((await a.call('GET', '/folders')).json.folders).toEqual([{ id: 'k1', name: 'Work' }]);
  expect((await a.call('GET', '/auth/me')).json.user.folders).toEqual([{ id: 'k1', name: 'Work' }]);
});

test('AI: signed-in only, streamed through, and limited per day', async () => {
  const anon = client(), a = client();
  expect((await anon.call('GET', '/ai/status')).json).toMatchObject({ enabled: false, reason: 'signed_out' });
  expect((await anon.call('POST', '/ai', { prompt: 'hi' })).status).toBe(401);
  await a.call('POST', '/auth/login', { email: 'ada@example.com', password: 'correct horse' });
  expect((await a.call('GET', '/ai/status')).json).toMatchObject({ enabled: true, limit: 2, used: 0 });
  const r = await a.call('POST', '/ai', { prompt: 'Draw a cache' });
  expect(r.status).toBe(200);
  expect(r.text).toContain('"text":"Hello"');
  expect((await a.call('POST', '/ai', { prompt: 'again', images: [{ media_type: 'image/bmp', data: 'x' }] })).json.error).toBe('bad_image');
  expect((await a.call('POST', '/ai', { prompt: 'again' })).status).toBe(200);
  const over = await a.call('POST', '/ai', { prompt: 'one more' });
  expect(over.status).toBe(429);
  expect(over.json).toEqual({ error: 'daily_limit', limit: 2 });
  expect((await a.call('GET', '/ai/status')).json).toMatchObject({ enabled: false, reason: 'daily_limit', used: 2 });
  expect(aiCalls).toBe(2);
});

test('pictures and the account\'s own settings are kept on the account', async () => {
  const a = client(), b = client();
  await a.call('POST', '/auth/signup', { email: 'pics@example.com', password: 'a long password' });
  await b.call('POST', '/auth/signup', { email: 'other@example.com', password: 'a long password' });
  const uid = (await a.call('GET', '/auth/me')).json.user.id;

  // Pictures: the account's own, also through a share link of one of its files.
  const png = 'data:image/png;base64,iVBORw0KGgo=';
  expect((await a.call('PUT', '/images/img_abc', { data: 'not a picture' })).json.error).toBe('bad_image');
  expect((await client().call('PUT', '/images/img_abc', { data: png })).status).toBe(401);
  expect((await a.call('PUT', '/images/img_abc', { data: png })).status).toBe(200);
  expect(store.backend.blobs.has("pics@example.com/image.img_abc.json")).toBe(true); // in the account's own folder
  expect((await a.call('GET', '/images/img_abc')).json.data).toBe(png);
  expect((await b.call('GET', '/images/img_abc')).status).toBe(404);
  expect((await client().call('GET', '/images/img_abc')).status).toBe(401);
  await a.call('PUT', '/files/f_pics', file('f_pics', 'Pictures'));
  const token = (await a.call('POST', '/files/f_pics/shares', { mode: 'view' })).json.token;
  expect((await client().call('GET', `/images/img_abc?share=${token}`)).json.data).toBe(png);
  expect((await client().call('GET', '/images/img_abc?share=nope')).status).toBe(404);

  // Settings by name: each account's own; null removes one.
  expect((await a.call('GET', '/userdata')).json.data).toEqual({});
  await a.call('PUT', '/userdata/db-connections', { value: [{ id: 'db1', name: 'Production' }] });
  await a.call('PUT', '/userdata/db-history%3Adb1', { value: ['select 1'] });
  expect((await a.call('GET', '/userdata')).json.data).toEqual({ 'db-connections': [{ id: 'db1', name: 'Production' }], 'db-history:db1': ['select 1'] });
  expect((await b.call('GET', '/userdata')).json.data).toEqual({});
  await a.call('PUT', '/userdata/db-history%3Adb1', { value: null });
  expect(Object.keys((await a.call('GET', '/userdata')).json.data)).toEqual(['db-connections']);
  expect((await a.call('PUT', '/userdata/' + 'x'.repeat(101), { value: 1 })).status).toBe(400);
  expect((await a.call('PUT', '/userdata/big', { value: 'x'.repeat(200_001) })).status).toBe(413);
  expect((await client().call('GET', '/userdata')).status).toBe(401);
});

test('the app against the server: account, folders, share link and version history', async ({ browser }) => {
  test.setTimeout(120_000);
  // The app from Vite's development server, with /api sent to this test's server.
  const port = 5196;
  vite = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--port', String(port), '--strictPort'], { cwd: 'frontend', env: { ...process.env, LINEWORK_API: base }, stdio: 'ignore', detached: true });
  appUrl = `http://localhost:${port}`;
  for (let i = 0; i < 60; i++) { try { if ((await fetch(appUrl)).ok) break; } catch (e) {} await new Promise(r => setTimeout(r, 500)); }

  const ctx = await browser.newContext({ baseURL: appUrl });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto('/');
  await expect(page.getByText('Forgot your password? Ask whoever runs this server to reset it.')).toBeVisible();
  await page.getByRole('button', { name: 'Create an account' }).click();
  await page.getByLabel('Name').fill('Grace Hopper');
  await page.getByLabel('Email').fill('grace@example.com');
  await page.getByLabel('Password').fill('a long password');
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('heading', { name: /, Grace$/ })).toBeVisible();

  // A folder, and a file saved to the account.
  await page.getByRole('button', { name: 'New folder' }).click();
  await page.getByRole('textbox').last().fill('Designs');
  await page.getByRole('button', { name: 'Create', exact: true }).click();
  const put = text => page.waitForResponse(r => r.request().method() === 'PUT' && /\/api\/files\/\w+$/.test(r.url()) && (r.request().postData() || '').includes(text));
  const first = put('');
  await page.getByRole('button', { name: 'Create a Blank File' }).click();
  expect((await first).status()).toBe(200);
  await page.getByRole('button', { name: 'More actions' }).click();
  await page.getByRole('menuitem', { name: /Rename file/ }).click();
  await page.getByRole('textbox').last().fill('Payments design');
  const uploaded = put('Payments design');
  await page.getByRole('button', { name: 'Rename', exact: true }).click();
  expect((await uploaded).status()).toBe(200);

  // Share a view-only link.
  await page.getByRole('button', { name: 'More actions' }).click();
  await page.getByRole('menuitem', { name: /Share/ }).click();
  const share = page.getByRole('dialog', { name: /Share “Payments design”/ });
  await share.getByRole('button', { name: 'Create link' }).click();
  const link = await share.getByRole('textbox', { name: 'Link' }).inputValue();
  expect(link).toMatch(new RegExp(`^${appUrl}/s/[\\w-]{40,}$`));
  await share.getByRole('button', { name: 'Done' }).click();

  // Someone without an account opens it.
  const guest = await (await browser.newContext()).newPage();
  await guest.goto(link);
  await expect(guest.locator('.shared-bar')).toContainText('Viewing Grace Hopper’s file');
  await expect(guest.locator('.saved')).toHaveText('View only');
  await expect(guest.getByLabel('File name')).toHaveValue('Payments design');

  // Version history: the untitled version can be restored.
  await page.getByRole('button', { name: 'More actions' }).click();
  await page.getByRole('menuitem', { name: /Version history/ }).click();
  const hist = page.getByRole('dialog', { name: 'Version history' });
  await expect(hist.getByRole('listitem').first()).toContainText('Current version');
  await expect(hist.getByRole('listitem')).toHaveCount(2);
  await hist.getByRole('button', { name: 'Restore' }).click();
  await expect(page.locator('.toast')).toContainText('Restored the version from');
  await expect(page.getByLabel('File name')).not.toHaveValue('Payments design');

  // Everything is on the server: a fresh browser signs in and finds the folder and the file.
  await expect(page.locator('.saved')).toHaveText('Saved', { timeout: 10_000 });
  const other = await (await browser.newContext({ baseURL: appUrl })).newPage();
  await other.goto('/');
  await other.getByLabel('Email').fill('grace@example.com');
  await other.getByLabel('Password').fill('a long password');
  await other.getByRole('button', { name: 'Sign in' }).click();
  await expect(other.getByRole('navigation', { name: 'Folders' })).toContainText('Designs');
  await expect(other.locator('.ftable tbody tr')).toHaveCount(1);

  // Nothing of the account is kept in the browser: pictures and saved connections go to the account too.
  expect(await page.evaluate(() => Object.keys(localStorage).filter(k => /^linework:(cloud|db-)/.test(k)))).toEqual([]);
  const key = await page.evaluate(() => import('/src/lib/images.js').then(m => m.saveImage('data:image/png;base64,iVBORw0KGgo=')));
  expect(key).toMatch(/^img/);
  const me = (await (await fetch(`${base}/api/auth/me`, { headers: { cookie: (await page.context().cookies()).map(c => `${c.name}=${c.value}`).join('; ') } })).json()).user;
  expect(await store.readImage(me.id, key)).toBe('data:image/png;base64,iVBORw0KGgo=');
  await page.evaluate(() => import('/src/lib/dbclient.js').then(m => m.saveConnections([{ id: 'db_1', name: 'Reports', type: 'postgres', host: 'db.example.com', password: 'secret', remember: true }])));
  await expect.poll(() => store.s.userData.get(me.id)['db-connections']?.[0]?.name).toBe('Reports');
  expect(await page.evaluate(() => Object.keys(localStorage).filter(k => /^linework:(cloud|db-)/.test(k)))).toEqual([]);
  expect(errors).toEqual([]);
});
