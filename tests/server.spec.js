import { test, expect } from '@playwright/test';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb } from '../server/db.js';
import { createApp } from '../server/app.js';

// The Linework server (server/): its API directly, then the app running against it through Vite's proxy.
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
  store = openDb(join(dir, 'test.db'), { versionEvery: 0, keepVersions: 3 });
  const app = createApp(store, { aiKey: 'test-key', aiBase: `http://localhost:${fakeAi.address().port}`, aiDailyLimit: 2 });
  srv = app.listen(0);
  base = `http://localhost:${srv.address().port}`;
});
test.afterAll(async () => {
  if (vite) try { process.kill(-vite.pid); } catch (e) {} // npx and the vite it started
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
  expect((await a.call('GET', '/server')).json).toMatchObject({ name: 'linework-server', features: ['versions', 'share', 'folders', 'ai-limits', '2fa'] });
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

  // The database keeps only a hash of the session token, and a scrypt hash of the password.
  const row = store.db.prepare('SELECT pass FROM users WHERE email = ?').get('ada@example.com');
  expect(row.pass).toMatch(/^scrypt\$/);
  expect(store.db.prepare('SELECT count(*) AS n FROM sessions WHERE token = ?').get(a.cookie.split('=')[1]).n).toBe(0);
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

test('the app against the server: account, folders, share link and version history', async ({ browser }) => {
  test.setTimeout(120_000);
  // The app from Vite's development server, with /api sent to this test's server.
  const port = 5196;
  vite = spawn('npx', ['vite', '--port', String(port), '--strictPort'], { env: { ...process.env, LINEWORK_API: base }, stdio: 'ignore', detached: true });
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
  expect(errors).toEqual([]);
});
