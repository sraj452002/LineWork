import { test, expect } from '@playwright/test';
import { openStore } from '../backend/store.js';
import { memoryBackend } from '../backend/drive.js';
import { createApp } from '../backend/app.js';

// A published app behind sign-in: its own accounts (apart from Workline's), sessions, invite-only lists,
// and each workflow run told who it's for ($json.user).

test.describe('apps people sign in to', () => {
  test.describe.configure({ mode: 'serial' });
  let app, srv, base, cookie = '';
  test.beforeAll(async () => {
    app = createApp(await openStore(memoryBackend()), { requireVerified: false });
    srv = app.listen(0);
    base = `http://localhost:${srv.address().port}/api`;
  });
  test.afterAll(() => { srv?.close(); app?.flows.close(); });
  const call = async (method, path, body) => {
    const r = await fetch(base + path, { method, headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    const set = r.headers.get('set-cookie'); if (set) cookie = set.split(';')[0];
    return { status: r.status, json: await r.json().catch(() => null) };
  };
  // What a published page sends: text/plain JSON, no cookies.
  const page = async (path, body) => {
    const r = await fetch(`${base}/ui/${TOKEN}/${path}`, { method: 'POST', headers: { 'content-type': 'text/plain' }, body: JSON.stringify(body) });
    return { status: r.status, json: await r.json().catch(() => null) };
  };
  const TOKEN = 'appsignin' + 'x'.repeat(24);
  // A workflow that says who ran it.
  const flow = { active: false, nodes: [
    { id: 't', type: 'trigger.manual', name: 'Run by hand', x: 0, y: 0, params: {} },
    { id: 'c', type: 'core.code', name: 'Who', x: 200, y: 0, params: { language: 'javascript', code: 'return items.map(i => ({ hello: i.user ? i.user.email : "nobody", n: i.n }));' } },
  ], edges: [{ id: 'e', from: 't', fromPort: 'main', to: 'c', toPort: 'main' }] };
  const save = ui => call('PUT', '/files/f_signin', { id: 'f_signin', title: 'Members', diagrams: [], doc: '', updated: Date.now(), flow, ui: { html: '<p>app</p>', doc: '<p>app</p>', flows: ['f_signin'], published: true, token: TOKEN, ...ui } });

  test('a public app runs for anyone, and doesn’t take sign-ups', async () => {
    await call('POST', '/auth/signup', { email: 'owner@example.com', password: 'a long password' });
    expect((await save({ access: 'public' })).status).toBe(200);
    const r = await page('run', { input: { n: 1 } });
    expect(r.status).toBe(200);
    expect(r.json.items[0]).toEqual({ hello: 'nobody', n: 1 });
    expect((await page('signup', { email: 'a@example.com', password: 'a long password' })).status).toBe(400);
  });

  test('behind sign-in: runs need a session, and each run knows who', async () => {
    await save({ access: 'signin' });
    expect((await page('run', { input: { n: 1 } })).status).toBe(401);
    expect((await page('signup', { email: 'bad', password: 'a long password' })).json.error).toBe('bad_email');
    expect((await page('signup', { email: 'ann@example.com', password: 'short' })).json.error).toBe('weak_password');
    const up = await page('signup', { email: 'Ann@Example.com', password: 'a long password', name: 'Ann' });
    expect(up.status).toBe(200);
    expect(up.json.user).toEqual({ email: 'ann@example.com', name: 'Ann' });
    expect((await page('signup', { email: 'ann@example.com', password: 'another password' })).status).toBe(409);
    const session = up.json.session;
    // A user can't pass themselves off as someone else: the server says who.
    const r = await page('run', { session, input: { n: 2, user: { email: 'boss@example.com' } } });
    expect(r.json.items[0]).toEqual({ hello: 'ann@example.com', n: 2 });
    expect((await page('me', { session })).json.user.name).toBe('Ann');
    // Sign in again; a wrong password doesn't.
    expect((await page('login', { email: 'ann@example.com', password: 'wrong password' })).status).toBe(401);
    const again = await page('login', { email: 'ann@example.com', password: 'a long password' });
    expect(again.status).toBe(200);
    // Signing out ends that session only.
    await page('logout', { session });
    expect((await page('run', { session, input: {} })).status).toBe(401);
    expect((await page('run', { session: again.json.session, input: {} })).status).toBe(200);
    // A session for one app doesn't open another.
    expect((await fetch(`${base}/ui/${'other'.repeat(6)}/run`, { method: 'POST', body: JSON.stringify({ session: again.json.session }) })).status).toBe(404);
  });

  test('invite-only: only the listed emails; the owner sees and removes accounts', async () => {
    await save({ access: 'invite', allow: ['bo@example.com'] });
    expect((await page('signup', { email: 'eve@example.com', password: 'a long password' })).status).toBe(403);
    const bo = await page('signup', { email: 'bo@example.com', password: 'a long password' });
    expect(bo.status).toBe(200);
    // Ann made her account while anyone could; off the list now, she can't get in.
    expect((await page('login', { email: 'ann@example.com', password: 'a long password' })).status).toBe(401);
    const list = await call('GET', '/flows/f_signin/app-users');
    expect(list.json.users.map(u => u.email).sort()).toEqual(['ann@example.com', 'bo@example.com']);
    expect((await call('DELETE', '/flows/f_signin/app-users/bo%40example.com')).status).toBe(200);
    expect((await page('run', { session: bo.json.session, input: {} })).status).toBe(401);
    expect((await call('GET', '/flows/f_signin/app-users')).json.users.map(u => u.email)).toEqual(['ann@example.com']);
  });
});
