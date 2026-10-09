import { test, expect } from '@playwright/test';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openStore } from '../backend/store.js';
import { memoryBackend } from '../backend/drive.js';
import { createApp } from '../backend/app.js';
import { codeAt, stepAt } from '../backend/totp.js';

// Signing in to the Linework server: confirming email, resetting a password, two-step verification,
// Google and GitHub. Email goes to an in-memory outbox, and a stand-in plays Google and GitHub.

test.describe.configure({ mode: 'serial' });
let dir, store, srv, base, idp, idpBase, vite;
const outbox = [];
const mailer = { configured: true, send: async m => { outbox.push(m); } };
const linkIn = (to, kind) => {
  const m = [...outbox].reverse().find(x => x.to === to && x.text.includes(`#${kind}=`));
  return m && m.text.match(new RegExp(`(\\S+#${kind}=[\\w-]+)`))[1];
};

// The stand-in identity provider. `people` maps a login code to who signs in.
const people = new Map();
let nextPerson = null;
test.beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'lw-auth-'));
  idp = createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    const json = (o, status = 200) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)); };
    if (u.pathname === '/authorize') {
      const code = 'c' + Math.random().toString(36).slice(2);
      people.set(code, nextPerson);
      res.writeHead(302, { location: `${u.searchParams.get('redirect_uri')}?code=${code}&state=${u.searchParams.get('state')}` });
      return res.end();
    }
    if (u.pathname === '/token') {
      let body = '';
      req.on('data', d => { body += d; });
      return req.on('end', () => {
        const p = new URLSearchParams(body);
        if (!p.get('code_verifier') || p.get('client_secret') !== 'secret') return json({ error: 'bad' }, 400);
        json({ access_token: 'tok:' + p.get('code') });
      });
    }
    const who = people.get(String(req.headers.authorization || '').replace('Bearer tok:', ''));
    if (!who) return json({ message: 'no' }, 401);
    if (u.pathname === '/userinfo') return json({ sub: who.id, email: who.email, email_verified: who.verified, name: who.name });
    if (u.pathname === '/gh/user') return json({ id: Number(who.id), login: who.name, name: null });
    if (u.pathname === '/gh/user/emails') return json([{ email: who.email, primary: true, verified: who.verified }]);
    json({}, 404);
  }).listen(0);
  idpBase = `http://localhost:${idp.address().port}`;
  store = await openStore(memoryBackend());
  const app = createApp(store, {
    mailer,
    oauth: {
      google: { clientId: 'g', clientSecret: 'secret', authUrl: `${idpBase}/authorize`, tokenUrl: `${idpBase}/token`, userUrl: `${idpBase}/userinfo` },
      github: { clientId: 'h', clientSecret: 'secret', authUrl: `${idpBase}/authorize`, tokenUrl: `${idpBase}/token`, userUrl: `${idpBase}/gh/user` },
    },
  });
  srv = app.listen(0);
  base = `http://localhost:${srv.address().port}`;
});
test.afterAll(async () => {
  if (vite) try { process.kill(-vite.pid); } catch (e) { vite.kill(); } // its process group; Windows has none
  srv?.close(); idp?.close(); store?.close();
  rmSync(dir, { recursive: true, force: true });
});

const client = () => {
  let cookie = '';
  const keep = r => { for (const c of r.headers.getSetCookie()) { const [kv] = c.split(';'); const [k] = kv.split('='); cookie = [...cookie.split('; ').filter(x => x && !x.startsWith(k + '=')), ...(/=$/.test(kv) ? [] : [kv])].join('; '); } };
  const call = async (method, path, body) => {
    const r = await fetch(base + '/api' + path, { method, headers: { ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...(cookie ? { cookie } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    keep(r);
    const j = await r.json().catch(() => null);
    return { status: r.status, json: j };
  };
  // Follow a "Continue with …" sign-in through the stand-in provider, and return where it lands.
  const oauth = async (provider, person, link = false) => {
    nextPerson = person;
    let r = await fetch(`${base}/api/auth/oauth/${provider}${link ? '?link=1' : ''}`, { redirect: 'manual', headers: cookie ? { cookie } : {} });
    keep(r);
    r = await fetch(r.headers.get('location'), { redirect: 'manual' });               // the provider
    r = await fetch(r.headers.get('location'), { redirect: 'manual', headers: { cookie } }); // back to the server
    keep(r);
    return r.headers.get('location');
  };
  return { call, oauth, get cookie() { return cookie; } };
};

test('the server says what sign-in it offers, and that an account is required', async () => {
  const info = (await client().call('GET', '/server')).json;
  expect(info).toMatchObject({ mail: true, allowLocal: false, signup: true, providers: { google: 'Google', github: 'GitHub' } });
});

test('new accounts confirm their email before signing in', async () => {
  const a = client();
  const up = await a.call('POST', '/auth/signup', { email: 'ada@example.com', password: 'correct horse', name: 'Ada Lovelace' });
  expect(up.status).toBe(202);
  expect(up.json).toEqual({ pending: 'verify', email: 'ada@example.com' });
  expect(a.cookie).toBe('');
  expect(outbox.at(-1)).toMatchObject({ to: 'ada@example.com', subject: 'Confirm your email for Linework' });
  expect(outbox.at(-1).html).toContain('Confirm my email');

  const login = await a.call('POST', '/auth/login', { email: 'ada@example.com', password: 'correct horse' });
  expect(login.status).toBe(403);
  expect(login.json.error).toBe('unverified');

  await a.call('POST', '/auth/resend', { email: 'ada@example.com' });
  const link = linkIn('ada@example.com', 'verify');
  expect(link).toMatch(new RegExp(`^${base}/#verify=`));
  const token = link.split('#verify=')[1];
  const ok = await a.call('POST', '/auth/verify', { token });
  expect(ok.json.user).toMatchObject({ email: 'ada@example.com', hasPassword: true, totp: false });
  expect((await a.call('GET', '/auth/me')).status).toBe(200);
  expect((await client().call('POST', '/auth/verify', { token })).json.error).toBe('bad_token'); // once only
});

test('a forgotten password is reset by an emailed link, which signs out other devices', async () => {
  const other = client();
  await other.call('POST', '/auth/login', { email: 'ada@example.com', password: 'correct horse' });
  expect((await other.call('GET', '/auth/me')).status).toBe(200);

  const a = client();
  expect((await a.call('POST', '/auth/forgot', { email: 'nobody@example.com' })).json).toEqual({ ok: true }); // same answer
  await a.call('POST', '/auth/forgot', { email: 'ada@example.com' });
  const token = linkIn('ada@example.com', 'reset').split('#reset=')[1];
  expect((await a.call('POST', '/auth/reset', { token, password: 'short' })).json.error).toBe('weak_password');
  expect((await a.call('POST', '/auth/reset', { token, password: 'new password 1' })).json.user.email).toBe('ada@example.com');
  expect((await a.call('POST', '/auth/reset', { token, password: 'new password 2' })).json.error).toBe('bad_token');
  expect((await other.call('GET', '/auth/me')).status).toBe(401);
  expect((await client().call('POST', '/auth/login', { email: 'ada@example.com', password: 'correct horse' })).json.error).toBe('bad_login');
  expect((await client().call('POST', '/auth/login', { email: 'ada@example.com', password: 'new password 1' })).status).toBe(200);
});

test('two-step verification: setup, codes at sign-in, no reuse, recovery codes, turning it off', async () => {
  const a = client();
  await a.call('POST', '/auth/login', { email: 'ada@example.com', password: 'new password 1' });
  const setup = (await a.call('POST', '/auth/2fa/setup', {})).json;
  expect(setup.uri).toMatch(/^otpauth:\/\/totp\/Linework:ada%40example\.com\?secret=[A-Z2-7]{32}&issuer=Linework/);
  expect(setup.qr).toMatch(/^<svg/);
  expect((await a.call('POST', '/auth/2fa/enable', { code: '000000' })).json.error).toBe('bad_code');
  const step = stepAt();
  const on = (await a.call('POST', '/auth/2fa/enable', { code: codeAt(setup.secret, step) })).json;
  expect(on.user.totp).toBe(true);
  expect(on.recovery).toHaveLength(10);

  // A password alone isn't enough now.
  const b = client();
  const first = (await b.call('POST', '/auth/login', { email: 'ada@example.com', password: 'new password 1' })).json;
  expect(Object.keys(first)).toEqual(['mfa']);
  expect((await b.call('GET', '/auth/me')).status).toBe(401);
  expect((await b.call('POST', '/auth/2fa/verify', { challenge: first.mfa, code: '123456' })).json.error).toBe('bad_code');
  // The code used to turn it on was this time step's, so it can't be used again: a recovery code can.
  expect((await b.call('POST', '/auth/2fa/verify', { challenge: first.mfa, code: codeAt(setup.secret, step) })).json.error).toBe('bad_code');
  expect((await b.call('POST', '/auth/2fa/verify', { challenge: first.mfa, code: on.recovery[0].toUpperCase() })).json.user.email).toBe('ada@example.com');
  expect((await b.call('GET', '/auth/me')).status).toBe(200);

  const c = client();
  const again = (await c.call('POST', '/auth/login', { email: 'ada@example.com', password: 'new password 1' })).json;
  expect((await c.call('POST', '/auth/2fa/verify', { challenge: again.mfa, code: on.recovery[0] })).json.error).toBe('bad_code'); // used up
  expect((await c.call('POST', '/auth/2fa/verify', { challenge: again.mfa, code: on.recovery[1] })).status).toBe(200);
  // Five wrong codes and the challenge is gone.
  const d = client();
  const ch = (await d.call('POST', '/auth/login', { email: 'ada@example.com', password: 'new password 1' })).json.mfa;
  for (let i = 0; i < 5; i++) await d.call('POST', '/auth/2fa/verify', { challenge: ch, code: '00000' + i });
  expect((await d.call('POST', '/auth/2fa/verify', { challenge: ch, code: on.recovery[2] })).status).toBe(429);

  expect((await c.call('POST', '/auth/2fa/disable', { code: 'nope' })).json.error).toBe('bad_code');
  expect((await c.call('POST', '/auth/2fa/disable', { code: on.recovery[3] })).json.user.totp).toBe(false);
  expect((await client().call('POST', '/auth/login', { email: 'ada@example.com', password: 'new password 1' })).json.user).toBeTruthy();
});

test('Google and GitHub: new accounts, matching an existing account, connecting, and refusals', async () => {
  // A new person through Google: an account, already confirmed, without a password.
  const g = client();
  expect(await g.oauth('google', { id: 'g-1', email: 'Grace@Example.com', verified: true, name: 'Grace Hopper' })).toBe('/');
  const grace = (await g.call('GET', '/auth/me')).json.user;
  expect(grace).toMatchObject({ email: 'grace@example.com', name: 'Grace Hopper', hasPassword: false, identities: [{ provider: 'google', email: 'grace@example.com' }] });
  expect((await client().call('POST', '/auth/login', { email: 'grace@example.com', password: 'anything at all' })).json.error).toBe('use_provider');

  // GitHub with Ada's verified address signs in to Ada's account.
  const h = client();
  expect(await h.oauth('github', { id: '42', email: 'ada@example.com', verified: true, name: 'ada' })).toBe('/');
  expect((await h.call('GET', '/auth/me')).json.user).toMatchObject({ email: 'ada@example.com', identities: [{ provider: 'github' }] });

  // An unverified address can't claim an account.
  expect(await client().oauth('google', { id: 'g-2', email: 'ada@example.com', verified: false, name: 'Mallory' })).toBe('/#auth_error=no_email');

  // Grace connects GitHub while signed in; another account can't take it.
  expect(await g.oauth('github', { id: '77', email: 'grace@users.noreply.github.com', verified: true, name: 'grace' }, true)).toBe('/#account=linked-github');
  expect((await g.call('GET', '/auth/me')).json.user.identities.map(i => i.provider)).toEqual(['google', 'github']);
  expect(await h.oauth('github', { id: '77', email: 'x@example.com', verified: true, name: 'x' }, true)).toBe('/#account=taken');
  expect((await g.call('POST', '/auth/unlink', { provider: 'github' })).json.user.identities.map(i => i.provider)).toEqual(['google']);
  expect((await g.call('POST', '/auth/unlink', { provider: 'google' })).json.error).toBe('last_method');

  // A forged return (state that wasn't ours) is refused.
  const r = await fetch(`${base}/api/auth/oauth/google/callback?code=x&state=forged`, { redirect: 'manual' });
  expect(r.headers.get('location')).toBe('/#auth_error=state');
});

test('Google sign-in on an account with two-step verification still asks for the code', async () => {
  const a = client();
  await a.call('POST', '/auth/login', { email: 'ada@example.com', password: 'new password 1' });
  const setup = (await a.call('POST', '/auth/2fa/setup', {})).json;
  const step = stepAt();
  const on = (await a.call('POST', '/auth/2fa/enable', { code: codeAt(setup.secret, step) })).json;
  const h = client();
  const to = await h.oauth('github', { id: '42', email: 'ada@example.com', verified: true, name: 'ada' });
  expect(to).toMatch(/^\/#mfa=[\w-]+$/);
  expect((await h.call('GET', '/auth/me')).status).toBe(401);
  expect((await h.call('POST', '/auth/2fa/verify', { challenge: to.split('=')[1], code: on.recovery[0] })).status).toBe(200);
  await h.call('POST', '/auth/2fa/disable', { code: on.recovery[1] });
});

test('the app: sign-in required, confirm email, two-step verification, Google', async ({ browser }) => {
  test.setTimeout(120_000);
  const port = 5195;
  vite = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--port', String(port), '--strictPort'], { cwd: 'frontend', env: { ...process.env, LINEWORK_API: base }, stdio: 'ignore', detached: true });
  const appUrl = `http://localhost:${port}`;
  for (let i = 0; i < 60; i++) { try { if ((await fetch(appUrl)).ok) break; } catch (e) {} await new Promise(r => setTimeout(r, 500)); }
  const errors = [];
  const fresh = async () => { const p = await (await browser.newContext({ baseURL: appUrl })).newPage(); p.on('pageerror', e => errors.push(e.message)); return p; };

  // No way in without an account; Google and GitHub are offered.
  const page = await fresh();
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Continue with Google' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Continue with GitHub' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Continue without an account' })).toHaveCount(0);

  // Sign up, then open the emailed link.
  await page.getByRole('button', { name: 'Create an account' }).click();
  await page.getByLabel('Name').fill('Katherine Johnson');
  await page.getByLabel('Email').fill('kj@example.com');
  await page.getByLabel('Password').fill('orbital mechanics');
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('status').first()).toContainText('Check kj@example.com for a link');
  await page.getByLabel('Password').fill('orbital mechanics');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('alert')).toContainText('Confirm your email first');
  await expect(page.getByRole('button', { name: 'Send the confirmation email again' })).toBeVisible();
  const link = linkIn('kj@example.com', 'verify');
  expect(link.startsWith(appUrl + '/#verify=')).toBe(true);
  await page.goto(link);
  await expect(page.getByRole('heading', { name: /, Katherine$/ })).toBeVisible();
  await expect(page.locator('.toast')).toContainText('Your email is confirmed');
  expect(page.url()).toBe(appUrl + '/');

  // Turn on two-step verification.
  await page.getByRole('button', { name: 'Account & security' }).click();
  const dlg = page.getByRole('dialog', { name: 'Account & security' });
  await dlg.getByRole('button', { name: 'Set up' }).click();
  await expect(dlg.getByRole('img', { name: 'QR code for your authenticator app' }).locator('svg')).toBeVisible();
  const secret = (await dlg.locator('.acct-secret code').textContent()).replace(/\s/g, '');
  await dlg.getByLabel('Code from the app').fill(codeAt(secret, stepAt()));
  await dlg.getByRole('button', { name: 'Turn on' }).click();
  await expect(dlg.getByRole('list', { name: 'Recovery codes' }).getByRole('listitem')).toHaveCount(10);
  const codes = await dlg.getByRole('list', { name: 'Recovery codes' }).getByRole('listitem').allTextContents();
  expect(codes).toHaveLength(10);
  await dlg.getByRole('button', { name: 'I’ve saved them' }).click();
  await expect(dlg.getByText('On', { exact: true })).toBeVisible();
  await dlg.getByRole('button', { name: 'Close' }).click();

  // Sign in again elsewhere: password, then a recovery code.
  const p2 = await fresh();
  await p2.goto('/');
  await p2.getByLabel('Email').fill('kj@example.com');
  await p2.getByLabel('Password').fill('orbital mechanics');
  await p2.getByRole('button', { name: 'Sign in' }).click();
  await expect(p2.getByRole('heading', { name: 'Two-step verification' })).toBeVisible();
  await p2.getByLabel('Code').fill('000000');
  await p2.getByRole('button', { name: 'Verify' }).click();
  await expect(p2.getByRole('alert')).toContainText('That code isn’t right');
  await p2.getByLabel('Code').fill(codes[0]);
  await p2.getByRole('button', { name: 'Verify' }).click();
  await expect(p2.getByRole('heading', { name: /, Katherine$/ })).toBeVisible();

  // Continue with Google: through the provider and back, signed in.
  nextPerson = { id: 'g-9', email: 'dorothy@example.com', verified: true, name: 'Dorothy Vaughan' };
  const p3 = await fresh();
  await p3.goto('/');
  await p3.getByRole('button', { name: 'Continue with Google' }).click();
  await expect(p3.getByRole('heading', { name: /, Dorothy$/ })).toBeVisible();
  await p3.getByRole('button', { name: 'Account & security' }).click();
  await expect(p3.getByRole('dialog').getByRole('heading', { name: 'Set a password' })).toBeVisible();
  await expect(p3.getByRole('dialog').getByRole('listitem').filter({ hasText: 'Google' })).toContainText('Connected · dorothy@example.com');
  expect(errors).toEqual([]);
});
