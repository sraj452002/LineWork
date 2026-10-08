import { test, expect } from '@playwright/test';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

// Running code from the Code view. Python runs for real: Pyodide's files come from the pyodide npm
// package instead of the CDN. Node.js runs in a StackBlitz WebContainer, which needs StackBlitz's
// servers, so here a small stand-in takes its place to check the wiring (sync, output, preview, files
// coming back). That stand-in replaces Vite's development bundle, so these Node checks run against
// the development server only.

const PYODIDE_DIR = join(process.cwd(), 'node_modules/pyodide');
const FAKE_WEBCONTAINER = `
const files = new Map(), watchers = [], listeners = { 'server-ready': [], port: [] };
const enc = s => new ReadableStream({ start(c) { c.enqueue(s); c.close(); } });
const fire = (path) => watchers.forEach(w => path.startsWith(w.dir + '/') && w.cb('change', path.slice(w.dir.length + 1)));
const fs = {
  mkdir: async () => {},
  writeFile: async (p, t) => { files.set(p, t); },
  readFile: async (p, enc) => { if (!files.has(p)) throw new Error('ENOENT'); const t = files.get(p); return enc ? t : new TextEncoder().encode(t); },
  readdir: async () => { throw new Error('ENOTDIR'); },
  rm: async p => { files.delete(p); },
  watch: (dir, opts, cb) => { const w = { dir, cb }; watchers.push(w); return { close() {} }; },
};
export const WebContainer = { boot: async () => ({
  fs,
  on: (ev, cb) => { (listeners[ev] ||= []).push(cb); return () => {}; },
  spawn: async (cmd, args, opts) => {
    const line = [cmd, ...args].join(' ');
    let out = '[node] ' + line + ' in ' + opts.cwd + '\\r\\n';
    if (cmd === 'node') out += '[node] read ' + (files.get(opts.cwd + '/' + args[0]) || '').length + ' bytes\\r\\n';
    if (line === 'npm install') { files.set(opts.cwd + '/package-lock.json', '{"lockfileVersion":3}'); setTimeout(() => fire(opts.cwd + '/package-lock.json'), 10); }
    if (line === 'npm run start') setTimeout(() => listeners['server-ready'].forEach(f => f(3000, location.origin + '/?preview')), 50);
    let input;
    const proc = { output: enc(out), exit: new Promise(r => setTimeout(() => r(0), cmd === 'jsh' ? 1e9 : 100)), kill() {}, resize() {},
      input: new WritableStream({ write(d) { input = (input || '') + d; } }) };
    return proc;
  },
}) };
export const auth = {};
`;

test.beforeEach(async ({ page }) => {
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  test.info().errors_ = errors;
  await page.route('https://cdn.jsdelivr.net/pyodide/**', route => {
    const f = join(PYODIDE_DIR, new URL(route.request().url()).pathname.split('/').pop());
    if (!existsSync(f)) return route.fulfill({ status: 404, body: 'not here' });
    const type = f.endsWith('.wasm') ? 'application/wasm' : /\.m?js$/.test(f) ? 'text/javascript' : f.endsWith('.json') ? 'application/json' : 'application/octet-stream';
    return route.fulfill({ status: 200, body: readFileSync(f), headers: { 'content-type': type, 'access-control-allow-origin': '*' } });
  });
  await page.route(/\/node_modules\/\.vite\/deps\/@webcontainer_api\.js/, route => route.fulfill({ status: 200, contentType: 'text/javascript', body: FAKE_WEBCONTAINER }));
  await page.addInitScript(() => {
    if (sessionStorage.getItem('seeded')) return;
    localStorage.clear();
    localStorage.setItem('linework:local-mode', '1');
    localStorage.setItem('linework:ai-open', '0');
    sessionStorage.setItem('seeded', '1');
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Create a Blank File' }).click();
  await page.getByRole('group', { name: 'View' }).getByRole('button', { name: 'Code' }).click();
});
test.afterEach(async () => {
  expect(test.info().errors_, 'page errors').toEqual([]);
});

const sample = async (page, name) => {
  await page.getByRole('button', { name: /Start from a sample/ }).click({ timeout: 20000 });
  await page.getByRole('menuitem', { name }).click();
};
const output = page => page.locator('.rp-term[aria-label="Output"] .xterm-rows');

test('the page is cross-origin isolated, so code can run', async ({ page }) => {
  expect(await page.evaluate(() => crossOriginIsolated)).toBe(true);
});

test('Run a Python file, and use the Python prompt', async ({ page }) => {
  test.setTimeout(90_000);
  await sample(page, 'Python');
  await expect(page.locator('.cw-tab.on')).toContainText('main.py');
  await page.getByRole('button', { name: 'Run', exact: true }).click();
  await expect(output(page)).toContainText("Numbers: [3, 1, 4, 1, 5, 9, 2, 6]", { timeout: 60_000 });
  await expect(output(page)).toContainText("'median': 3.5");
  await expect(output(page)).toContainText('exited with code 0');

  // The prompt keeps state between lines, sees the workspace's modules, and files it writes come back.
  await page.getByRole('tab', { name: 'Python' }).click();
  const prompt = page.locator('.rp-term[aria-label="Python prompt"]');
  await expect(prompt.locator('.xterm-rows')).toContainText('>>>', { timeout: 60_000 });
  await prompt.click();
  for (const line of ['from stats import summary', 'x = summary([10, 20])', "x['mean'] * 2", "open('notes.txt', 'w').write('from python')"]) {
    await page.keyboard.type(line);
    await page.keyboard.press('Enter');
  }
  await expect(prompt.locator('.xterm-rows')).toContainText('30');
  await expect(page.getByRole('tree', { name: 'Files' }).getByRole('treeitem', { name: /notes\.txt/ })).toBeVisible();

  // Ctrl C stops a program that would run forever.
  await page.keyboard.type('while True: pass');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(500);
  await page.keyboard.press('Control+c');
  await expect(prompt.locator('.xterm-rows')).toContainText('KeyboardInterrupt', { timeout: 10_000 });
  await page.keyboard.type('1 + 1');
  await page.keyboard.press('Enter');
  await expect(prompt.locator('.xterm-rows')).toContainText('2');
});

test('Run Node.js files and npm scripts, with a preview and files coming back', async ({ page }) => {
  await sample(page, 'Node.js web server');
  await page.getByRole('treeitem', { name: /server\.js/ }).click();
  await expect(page.getByRole('button', { name: 'Run', exact: true })).toHaveAttribute('title', /Run server\.js/);
  await page.getByRole('button', { name: 'Run', exact: true }).click();
  await expect(output(page)).toContainText('> node server.js');
  // The file's current text was copied into the runtime before it ran.
  const savedLength = () => page.evaluate(() => Object.values(JSON.parse(localStorage.getItem('linework:files:v2')) || {})[0]?.code?.files?.find(f => f.path === 'server.js')?.text.length || 0);
  await expect.poll(savedLength).toBeGreaterThan(0);
  const server = await savedLength();
  await expect(output(page)).toContainText(`[node] read ${server} bytes`);
  await expect(output(page)).toContainText('exited with code 0');

  // npm install writes package-lock.json, which appears in the explorer.
  await page.getByRole('button', { name: 'More ways to run' }).click();
  await page.getByRole('menuitem', { name: /npm install/ }).click();
  await expect(page.getByRole('treeitem', { name: /package-lock\.json/ })).toBeVisible();

  // npm run start starts a server; the Preview tab shows it.
  await page.getByRole('button', { name: 'More ways to run' }).click();
  await page.getByRole('menuitem', { name: /npm run start/ }).click();
  await expect(page.getByRole('tab', { name: 'Preview' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('textbox', { name: 'Preview address' })).toHaveValue(/\?preview\/$/);

  // The Terminal tab starts a shell.
  await page.getByRole('tab', { name: 'Terminal' }).click();
  await expect(page.locator('.rp-term[aria-label="Terminal"] .xterm-rows')).toContainText('[node] jsh');
});
