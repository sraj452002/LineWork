import { test, expect } from '@playwright/test';
import { spawn, spawnSync } from 'node:child_process';
import { openStore } from '../backend/store.js';
import { memoryBackend } from '../backend/storage.js';
import { createApp } from '../backend/app.js';

// “Edit any file” with no page and no link: Run by hand takes a file, the run stops at the Editor and an
// editor card opens in the app; Save & continue runs the rest with the whole file, edited, in its format.
const stop = p => { try { if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(p.pid), '/T', '/F']); else process.kill(-p.pid); } catch (e) { /* gone */ } };

test('a run stops at the Editor, the card opens in the app, Save & continue gives the edited file', async ({ browser }) => {
  test.setTimeout(150_000);
  const app = createApp(await openStore(memoryBackend()), { noAccounts: true });
  const srv = app.listen(0), port = 5251;
  const vite = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--port', String(port), '--strictPort'], { cwd: 'frontend', env: { ...process.env, LINEWORK_API: `http://localhost:${srv.address().port}` }, stdio: 'ignore', detached: process.platform !== 'win32' });
  try {
    const url = `http://localhost:${port}`;
    for (let i = 0; i < 60; i++) { try { if ((await fetch(url)).ok) break; } catch (e) {} await new Promise(r => setTimeout(r, 500)); }
    const ctx = await browser.newContext({ baseURL: url });
    await ctx.addInitScript(() => {
      if (sessionStorage.getItem('seeded')) return; sessionStorage.setItem('seeded', '1');
      localStorage.clear(); localStorage.setItem('linework:ai-open', '0');
      const now = Date.now(), n = (id, type, name, x, params) => ({ id, type, name, x, y: 160, params });
      const flow = { active: false, nodes: [
        n('t', 'trigger.manual', 'Pick a file', 80, { fields: 'File* (file)' }),
        n('e', 'ui.editor', 'Editor', 360, { source: 'input', input: '{{ $json.file }}', title: 'Edit your file', button: 'Save & continue' }),
        n('o', 'core.set', 'Edited file', 640, { fields: [{ name: 'file', value: '{{ $json.file }}' }, { name: 'name', value: '{{ $json.name }}' }], keep: false })],
      edges: [{ id: 'e1', from: 't', to: 'e', fromPort: 'main', toPort: 'main' }, { id: 'e2', from: 'e', to: 'o', fromPort: 'main', toPort: 'main' }] };
      localStorage.setItem('linework:files:v2', JSON.stringify([{ id: 'wf1', title: 'Edit any file', created: now, updated: now, doc: '', diagrams: [{ id: 'd1', type: 'architecture', name: 'Diagram 1', code: '' }], active: 0, view: 'flow', flow }]));
    });
    const page = await ctx.newPage();
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    await page.goto('/');
    await page.getByRole('navigation', { name: 'Files' }).getByRole('button', { name: /^Run/ }).click();
    await page.getByRole('button', { name: 'Run Edit any file' }).click();
    const form = page.getByRole('dialog', { name: 'Run with input' });
    await form.locator('input[type=file]').setInputFiles({ name: 'prices.csv', mimeType: 'text/csv', buffer: Buffer.from('Item,Price\nMilk,40\n') });
    await form.getByRole('button', { name: 'Run' }).click();

    // The card: the CSV as a grid, right in the app.
    const card = page.getByRole('dialog', { name: 'Edit prices.csv' });
    await expect(card).toBeVisible({ timeout: 30_000 });
    await expect(card).toContainText('Edit your file');
    await expect(card.getByLabel('B2')).toHaveValue('40');
    // Behind it, the run says it's your turn (not “All done!”); Cancel and ✎ Open the editor brings the card back.
    await expect(page.getByRole('region', { name: 'Runs of Edit any file' }).locator('.fr-say')).toContainText('Your turn');
    await card.getByRole('button', { name: 'Cancel' }).click();
    await expect(card).toHaveCount(0);
    await page.getByRole('button', { name: '✎ Open the editor' }).click();
    await expect(card.getByLabel('B2')).toHaveValue('40');
    await card.getByLabel('B2').fill('45');
    await card.getByLabel('A3').fill('Bread');
    await card.getByLabel('B3').fill('30');
    await page.waitForTimeout(800);
    await page.screenshot({ path: 'test-results/editor-card.png' });
    await card.getByRole('button', { name: 'Save & continue' }).click();
    await expect(card).toHaveCount(0);

    // The run goes on from the Editor: the last step has the whole CSV, edited.
    const stage = page.getByRole('region', { name: 'Runs of Edit any file' });
    await expect(stage.locator('.fr-say')).toContainText('All done!', { timeout: 30_000 });
    await expect(page.getByRole('dialog', { name: 'Edit prices.csv' })).toHaveCount(0);
    const api = `http://localhost:${srv.address().port}/api`;
    const { runs } = await (await fetch(`${api}/flows/wf1/runs`)).json();
    const { run } = await (await fetch(`${api}/runs/${runs[0].id}`)).json();
    const out = Object.values(run.nodes.o.output).flat()[0];
    expect(out.name).toBe('prices.csv');
    expect(out.file.type).toBe('text/csv');
    expect(Buffer.from(out.file.data, 'base64').toString()).toBe('Item,Price\nMilk,45\nBread,30');

    // The same in the workflow editor: Run workflow, the card opens, Save & continue finishes the run.
    await page.goto('/');
    await page.getByText('Edit any file').first().click();
    await page.getByRole('button', { name: 'Run workflow' }).click();
    const form2 = page.getByRole('dialog', { name: 'Run with input' });
    await form2.locator('input[type=file]').setInputFiles({ name: 'notes.md', mimeType: 'text/markdown', buffer: Buffer.from('# Todo\n- milk\n') });
    await form2.getByRole('button', { name: 'Run' }).click();
    const card2 = page.getByRole('dialog', { name: 'Edit notes.md' });
    await expect(card2).toBeVisible({ timeout: 30_000 });
    await expect(card2.getByRole('textbox')).toHaveValue('# Todo\n- milk\n');
    await card2.getByRole('textbox').fill('# Todo\n- milk\n- eggs\n');
    await card2.getByRole('button', { name: 'Save & continue' }).click();
    await expect(page.getByText('The workflow ran')).toBeVisible({ timeout: 30_000 });
    const { runs: runs2 } = await (await fetch(`${api}/flows/wf1/runs`)).json();
    const { run: run2 } = await (await fetch(`${api}/runs/${runs2[0].id}`)).json();
    const out2 = Object.values(run2.nodes.o.output).flat()[0];
    expect(out2.name).toBe('notes.md');
    expect(Buffer.from(out2.file.data, 'base64').toString()).toBe('# Todo\n- milk\n- eggs\n');
    expect(errors).toEqual([]);
  } finally { stop(vite); srv.close(); app.flows.close(); }
});
