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
