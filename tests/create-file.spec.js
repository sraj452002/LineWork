import { test, expect } from '@playwright/test';
import http from 'node:http';
import { readFileSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { openStore } from '../backend/store.js';
import { memoryBackend } from '../backend/storage.js';
import { createApp } from '../backend/app.js';

// Create file: the code converter (form → AI rewrite → Create file) gives a .py file, which the Run studio's
// Result offers as a download (and a preview), with the AI's markdown fence taken off.

const stop = p => { try { if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(p.pid), '/T', '/F']); else process.kill(-p.pid); } catch (e) { /* gone */ } };

test('the code converter gives output.py to download', async ({ browser }) => {
  test.setTimeout(150_000);
  const nv = http.createServer((req, res) => { req.resume(); req.on('end', () => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ choices: [{ message: { content: '```python\ndef add(a, b):\n    return a + b\n```' } }] })); }); }).listen(0);
  const app = createApp(await openStore(memoryBackend()), { noAccounts: true, nvidiaKey: 'nvapi-test', nvidiaBase: `http://localhost:${nv.address().port}/v1` });
  const srv = app.listen(0);
  const { flow } = JSON.parse(readFileSync('code-converter.workflow.json', 'utf8'));
  const now = Date.now();
  const files = [{ id: 'fcode1', title: 'code converter', created: now, updated: now, doc: '', diagrams: [{ id: 'd1', type: 'architecture', name: 'Diagram 1', code: '' }], active: 0, view: 'flow', flow }];
  const port = 5251;
  const vite = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--port', String(port), '--strictPort'], { cwd: 'frontend', env: { ...process.env, LINEWORK_API: `http://localhost:${srv.address().port}` }, stdio: 'ignore', detached: process.platform !== 'win32' });
  try {
    const url = `http://localhost:${port}`;
    for (let i = 0; i < 60; i++) { try { if ((await fetch(url)).ok) break; } catch (e) {} await new Promise(r => setTimeout(r, 500)); }
    const ctx = await browser.newContext({ baseURL: url, viewport: { width: 1400, height: 900 }, acceptDownloads: true });
    await ctx.addInitScript(list => { if (window.top !== window) return; localStorage.setItem('linework:ai-open', '0'); if (!sessionStorage.getItem('seeded')) { sessionStorage.setItem('seeded', '1'); localStorage.setItem('linework:files:v2', JSON.stringify(list)); } }, files);
    const page = await ctx.newPage();
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    await page.goto('/');
    await page.getByRole('button', { name: /^Run W/ }).click();
    await page.getByRole('button', { name: 'Run code converter' }).click();
    const form = page.getByRole('dialog', { name: 'Run with input' });
    await form.getByLabel(/^Code/).fill('function add(a,b){return a+b}');
    await form.getByRole('button', { name: 'Run' }).click();
    // The Result: the file is ready, with a preview and a download.
    const ready = page.locator('.rv-files');
    await expect(ready).toContainText('Your file is ready', { timeout: 30_000 });
    await expect(ready).toContainText('output.py');
    await ready.getByRole('button', { name: 'Preview' }).click();
    await expect(ready.locator('.rv-file-peek')).toHaveText('def add(a, b):\n    return a + b');
    await page.screenshot({ path: 'test-results/create-file.png' });
    const [dl] = await Promise.all([page.waitForEvent('download'), ready.getByRole('button', { name: 'Download output.py' }).click()]);
    expect(dl.suggestedFilename()).toBe('output.py');
    expect(readFileSync(await dl.path(), 'utf8')).toBe('def add(a, b):\n    return a + b');
    // The JSON view shows the file too (big files' base64 is shortened there).
    await page.getByRole('tab', { name: 'JSON' }).click();
    await expect(page.locator('.rv-json').first()).toContainText('"name": "output.py"');
    expect(errors).toEqual([]);
  } finally { stop(vite); srv.close(); nv.close(); app.flows.close(); }
});
