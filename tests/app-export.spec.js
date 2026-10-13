import { test, expect } from '@playwright/test';
import { openStore } from '../backend/store.js';
import { memoryBackend } from '../backend/drive.js';
import { createApp } from '../backend/app.js';

// App view → Export: the app's page on its own (a file, an Android WebView, an Electron window) runs its
// workflows through the published link; the Android and desktop projects are complete.

let ex, ab;
test.beforeAll(async () => {
  globalThis.innerWidth ??= 1200;
  ex = await import('../frontend/src/lib/appexport.js');
  ab = await import('../frontend/src/lib/appbuilder.js');
});

test.describe('an exported app', () => {
  test.describe.configure({ mode: 'serial' });
  let app, srv, base, cookie = '';
  const TOKEN = 'exported' + 'x'.repeat(24);
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
  const flow = { active: false, nodes: [
    { id: 't', type: 'trigger.manual', name: 'Run by hand', x: 0, y: 0, params: {} },
    { id: 'c', type: 'core.code', name: 'Rows', x: 200, y: 0, params: { language: 'javascript', code: 'return [{ name: "Ada", who: items[0].user ? items[0].user.email : "nobody" }, { name: "Grace", who: "-" }];' } },
  ], edges: [{ id: 'e', from: 't', fromPort: 'main', to: 'c', toPort: 'main' }] };

  test('runs from a file of its own, signs in, and gets its data from the server', async ({ page }) => {
    await call('POST', '/auth/signup', { email: 'export@example.com', password: 'a long password' });
    const spec = ab.newVisualApp('Team', 'Team');
    const ui = { mode: 'visual', spec, access: 'signin', html: ab.builderHtml(spec, { access: 'signin' }), flows: ['f_export'], published: true, token: TOKEN };
    expect((await call('PUT', '/files/f_export', { id: 'f_export', title: 'Team', diagrams: [], doc: '', updated: Date.now(), flow, ui: { ...ui, doc: '' } })).status).toBe(200);

    // The page, as an exported app has it: no Workline around it, another origin.
    const html = ex.pageFor(ui, { title: 'Team', workflows: [{ id: 'f_export', name: 'Team' }], base: `${base}/ui/${TOKEN}` });
    expect(html).toContain(`window.WORKLINE_BASE = "${base}/ui/${TOKEN}"`);
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.setContent(html);
    await page.getByRole('button', { name: 'Create account' }).first().click();
    await page.getByLabel('Email').fill('member@example.com');
    await page.getByLabel('Password').fill('a long password');
    await page.locator('form').getByRole('button', { name: 'Create account' }).last().click();
    await expect(page.locator('.wl-tbl')).toContainText('member@example.com');
    await expect(page.locator('.wl-stat b')).toHaveText('2');
    expect(errors).toEqual([]);
  });
});

test.describe('an installed app (PWA)', () => {
  test.describe.configure({ mode: 'serial' });
  let app, srv, base, cookie = '';
  const TOKEN = 'installed' + 'x'.repeat(24);
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

  test('has a manifest, icons and a service worker, and keeps people signed in between launches', async ({ page }) => {
    await call('POST', '/auth/signup', { email: 'pwa@example.com', password: 'a long password' });
    const { appDoc } = await import('../frontend/src/lib/apphost.js');
    const spec = ab.newVisualApp('Team Hub', 'Team Hub');
    spec.theme.primary = '#0e7490';
    const html = ab.builderHtml(spec, { access: 'signin' });
    const flow = { active: false, nodes: [{ id: 't', type: 'trigger.manual', name: 'Run by hand', x: 0, y: 0, params: {} }, { id: 'c', type: 'core.code', name: 'Rows', x: 200, y: 0, params: { language: 'javascript', code: 'return [{ hello: items[0].user.email }];' } }], edges: [{ id: 'e', from: 't', fromPort: 'main', to: 'c', toPort: 'main' }] };
    expect((await call('PUT', '/files/f_pwa', { id: 'f_pwa', title: 'Team Hub', diagrams: [], doc: '', updated: Date.now(), flow, ui: { mode: 'visual', spec, access: 'signin', html, doc: appDoc(html, { workflows: [{ id: 'f_pwa', name: 'Team Hub' }], title: 'Team Hub' }), flows: ['f_pwa'], published: true, token: TOKEN } })).status).toBe(200);

    const manifest = await (await fetch(`${base}/ui/${TOKEN}/manifest.webmanifest`)).json();
    expect(manifest).toMatchObject({ name: 'Team Hub', display: 'standalone', start_url: `/api/ui/${TOKEN}/app`, scope: `/api/ui/${TOKEN}/`, theme_color: '#0e7490' });
    expect(manifest.icons.map(i => i.sizes)).toEqual(['192x192', '512x512']);
    const icon = Buffer.from(await (await fetch(`${base}/ui/${TOKEN}/icon-512.png`)).arrayBuffer());
    expect(icon.subarray(1, 4).toString()).toBe('PNG');
    expect(icon.readUInt32BE(16)).toBe(512);
    const sw = await fetch(`${base}/ui/${TOKEN}/sw.js`);
    expect(sw.headers.get('content-type')).toMatch(/javascript/);
    expect((await fetch(`${base}/ui/${'nothere'.repeat(4)}/app`)).status).toBe(404);

    // Installed: the page around the app; sign in once, and it remembers.
    await page.goto(`${base}/ui/${TOKEN}/app`);
    await expect(page.locator('link[rel=manifest]')).toHaveAttribute('href', `/api/ui/${TOKEN}/manifest.webmanifest`);
    const app = page.frameLocator('#app');
    await app.getByRole('button', { name: 'Create account' }).first().click();
    await app.getByLabel('Email').fill('member@example.com');
    await app.getByLabel('Password').fill('a long password');
    await app.locator('form').getByRole('button', { name: 'Create account' }).last().click();
    await expect(app.locator('.wl-tbl')).toContainText('member@example.com');
    await page.reload();
    await expect(page.frameLocator('#app').locator('.wl-tbl')).toContainText('member@example.com'); // still signed in
    await page.frameLocator('#app').getByText('Sign out').click();
    await page.reload();
    await expect(page.frameLocator('#app').getByRole('button', { name: 'Sign in' }).last()).toBeVisible();
  });
});

test('the Electron route passes Electron’s build through, to signed-in people', async () => {
  const JSZip = (await import('node:module')).createRequire(import.meta.url)('../frontend/node_modules/jszip');
  const zip = new JSZip(); zip.file('electron.exe', 'MZ fake'); zip.file('resources/default_app.asar', 'x'); zip.file('LICENSE', 'MIT');
  const body = await zip.generateAsync({ type: 'nodebuffer' });
  const { createServer } = await import('node:http');
  let asked = '';
  const gh = createServer((req, res) => { asked = req.url; res.writeHead(200, { 'content-type': 'application/zip', 'content-length': body.length }); res.end(body); }).listen(0);
  const app = createApp(await openStore(memoryBackend()), { requireVerified: false, electronBase: `http://localhost:${gh.address().port}` });
  const srv = app.listen(0), base = `http://localhost:${srv.address().port}/api`;
  try {
    expect((await fetch(`${base}/electron/win32-x64`)).status).toBe(401);
    const up = await fetch(`${base}/auth/signup`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'e@example.com', password: 'a long password' }) });
    const cookie = up.headers.get('set-cookie').split(';')[0];
    expect((await fetch(`${base}/electron/darwin-arm64`, { headers: { cookie } })).status).toBe(404);
    const r = await fetch(`${base}/electron/win32-x64`, { headers: { cookie } });
    expect(r.status).toBe(200);
    expect(asked).toBe('/v31.7.7/electron-v31.7.7-win32-x64.zip');
    expect(Buffer.from(await r.arrayBuffer()).equals(body)).toBe(true);
  } finally { srv.close(); app.flows.close(); gh.close(); }
});

test('the Android project is a complete Gradle project with its page and a build on GitHub', () => {
  const ui = { html: '<h1>Hi</h1>' };
  const files = ex.androidFiles(ui, { title: 'My Shop!', workflows: [], base: 'https://example.com/api/ui/abc' });
  for (const f of ['settings.gradle', 'build.gradle', 'app/build.gradle', 'app/src/main/AndroidManifest.xml', 'app/src/main/res/values/strings.xml', 'app/src/main/assets/index.html', '.github/workflows/build-android.yml', 'README.md'])
    expect(files[f], f).toBeTruthy();
  const main = Object.keys(files).find(f => f.endsWith('MainActivity.java'));
  expect(main).toBe('app/src/main/java/app/workline/myshop/MainActivity.java');
  expect(files[main]).toContain('package app.workline.myshop;');
  expect(files['app/build.gradle']).toContain("applicationId 'app.workline.myshop'");
  expect(files['app/src/main/AndroidManifest.xml']).toContain('android.permission.INTERNET');
  expect(files['app/src/main/res/values/strings.xml']).toContain('<string name="app_name">My Shop!</string>');
  expect(files['app/src/main/assets/index.html']).toContain('<h1>Hi</h1>');
  expect(files['app/src/main/assets/index.html']).toContain('WORKLINE_BASE');
  expect(files['.github/workflows/build-android.yml']).toContain('gradle assembleDebug');
});

test('the desktop project builds an .exe, .dmg and .AppImage', () => {
  const files = ex.desktopFiles({ html: '<h1>Hi</h1>' }, { title: 'My Shop!', workflows: [], base: 'https://example.com/api/ui/abc' });
  const pkg = JSON.parse(files['package.json']);
  expect(pkg.main).toBe('main.js');
  expect(pkg.productName).toBe('My Shop!');
  expect(pkg.build.win.target).toContain('nsis');
  expect(pkg.devDependencies.electron).toBeTruthy();
  expect(files['main.js']).toContain("loadFile(path.join(__dirname, 'app', 'index.html'))");
  expect(files['app/index.html']).toContain('<h1>Hi</h1>');
  expect(files['.github/workflows/build-desktop.yml']).toContain('${{ matrix.os }}');
  expect(files['.github/workflows/build-desktop.yml']).toContain('dist/*.exe');
});
