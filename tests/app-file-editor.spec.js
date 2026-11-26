import { test, expect } from '@playwright/test';
import { spawn, spawnSync } from 'node:child_process';
import { openStore } from '../backend/store.js';
import { memoryBackend } from '../backend/storage.js';
import { createApp, LOCAL_USER } from '../backend/app.js';

// A published app that takes a file and has an Editor: the app's form has a file picker, the run stops at
// the Editor and its card opens in the app (here, WorkLine Apps on a phone), and Save & continue finishes
// the run, whose result is the edited file, ready to download.
const stop = p => { try { if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(p.pid), '/T', '/F']); else process.kill(-p.pid); } catch (e) { /* gone */ } };

test('a published app takes a file, opens the editor card, and gives the edited file', async ({ browser }) => {
  test.setTimeout(150_000);
  const app = createApp(await openStore(memoryBackend()), { noAccounts: true, storeOwner: LOCAL_USER });
  const srv = app.listen(0), api = `http://localhost:${srv.address().port}/api`;
  const n = (id, type, name, params) => ({ id, type, name, x: 0, y: 0, params });
  const flow = { active: false, nodes: [
    n('t', 'trigger.manual', 'Pick a file', { fields: 'Document* (file)' }),
    n('e', 'ui.editor', 'Editor', { source: 'input', input: '{{ $json.document }}', title: 'Edit your file', button: 'Save & continue' }),
    n('o', 'core.set', 'Edited file', { fields: [{ name: 'file', value: '{{ $json.file }}' }], keep: false })],
  edges: [{ id: 'e1', from: 't', to: 'e', fromPort: 'main', toPort: 'main' }, { id: 'e2', from: 'e', to: 'o', fromPort: 'main', toPort: 'main' }],
  app: { published: true, name: 'File Editor', description: 'let you edit file manually', icon: '🧾', startId: 't', outputId: 'o', show: 'auto', inputs: [{ key: 'document', label: 'Document', kind: 'text', required: true }] } }; // published before apps had file questions
  const f = { id: 'fapp1', title: 'File Editor', created: 1, updated: 1, doc: '', diagrams: [{ id: 'd1', type: 'architecture', name: 'D', code: '' }], active: 0, view: 'flow', flow };
  expect((await fetch(`${api}/files/fapp1`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(f) })).ok).toBe(true);
  const port = 5252;
  const vite = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--port', String(port), '--strictPort'], { cwd: 'frontend', env: { ...process.env, LINEWORK_API: `http://localhost:${srv.address().port}` }, stdio: 'ignore', detached: process.platform !== 'win32' });
  try {
    // The store lists the file question as a file.
    const s = await (await fetch(`${api}/store`)).json();
    expect(s.apps[0].inputs[0]).toMatchObject({ key: 'document', kind: 'file', required: true });
    // Continuing can't name some other file to save into.
    const sneaky = await fetch(`${api}/store/fapp1/continue`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ nodeId: 'e', edited: { kind: 'doc', name: 'x.txt', text: 'hi', fileId: 'fapp1' } }) });
    expect((await sneaky.json()).items[0].file.name).toBe('x.txt');
    expect((await (await fetch(`${api}/files/fapp1`)).json()).flow.nodes.length).toBe(3);

    const url = `http://localhost:${port}`;
    for (let i = 0; i < 60; i++) { try { if ((await fetch(url)).ok) break; } catch (e) {} await new Promise(r => setTimeout(r, 500)); }
    const ctx = await browser.newContext({ baseURL: url, viewport: { width: 412, height: 860 }, userAgent: 'Mozilla/5.0 (Linux; Android 14) WorkLineApp' });
    const page = await ctx.newPage();
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    await page.goto('/run');
    await page.getByRole('button', { name: /File Editor/ }).first().click();
    // A file picker, not a text box.
    await page.getByLabel('Document').setInputFiles({ name: 'todo.txt', mimeType: 'text/plain', buffer: Buffer.from('milk\neggs\n') });
    await expect(page.getByText('todo.txt ·')).toBeVisible();
    await page.getByRole('button', { name: 'Run' }).click();
    // The run stops at the Editor: its card opens in the app.
    const card = page.getByRole('dialog', { name: 'Edit todo.txt' });
    await expect(card).toBeVisible({ timeout: 30_000 });
    await expect(card.getByRole('textbox')).toHaveValue('milk\neggs\n');
    await card.getByRole('textbox').fill('milk\neggs\nbread\n');
    await page.waitForTimeout(500);
    await page.screenshot({ path: 'test-results/app-file-editor.png' });
    await card.getByRole('button', { name: 'Save & continue' }).click();
    // The result: the edited file, ready.
    await expect(page.getByText('Your file is ready')).toBeVisible({ timeout: 30_000 });
    await expect(page.locator('.rv-files')).toContainText('todo.txt');
    await page.screenshot({ path: 'test-results/app-file-editor-done.png' });
    expect(errors).toEqual([]);
  } finally { stop(vite); srv.close(); app.flows.close(); }
});
