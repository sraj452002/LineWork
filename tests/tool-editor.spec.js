import { test, expect } from '@playwright/test';
import { spawn, spawnSync } from 'node:child_process';
import { openStore } from '../backend/store.js';
import { memoryBackend } from '../backend/storage.js';
import { createApp } from '../backend/app.js';

// The tool editors: a run stops and the file opens in its own Workline tool (a CSV in the Sheet, a new
// course in the Course editor); Save & continue goes on with the file, in its own kind.

const stop = p => { try { if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(p.pid), '/T', '/F']); else process.kill(-p.pid); } catch (e) { /* gone */ } };

test('tool editor nodes: a CSV in the Sheet, a new course in the Course editor', async ({ browser }) => {
  test.setTimeout(180_000);
  const app = createApp(await openStore(memoryBackend()), { noAccounts: true });
  const srv = app.listen(0);
  const port = 5246;
  const vite = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--port', String(port), '--strictPort'], { cwd: 'frontend', env: { ...process.env, LINEWORK_API: `http://localhost:${srv.address().port}` }, stdio: 'ignore', detached: process.platform !== 'win32' });
  try {
    const url = `http://localhost:${port}`;
    for (let i = 0; i < 60; i++) { try { if ((await fetch(url)).ok) break; } catch (e) {} await new Promise(r => setTimeout(r, 500)); }
    const ctx = await browser.newContext({ baseURL: url, viewport: { width: 1280, height: 800 } });
    await ctx.addInitScript(() => {
      if (sessionStorage.getItem('seeded')) return; sessionStorage.setItem('seeded', '1');
      localStorage.clear(); localStorage.setItem('linework:ai-open', '0'); localStorage.setItem('linework:run-side', 'on');
      const now = Date.now();
      const E = (id, f, t) => ({ id, from: f, to: t, fromPort: 'main', toPort: 'main' });
      const file = (id, title, flow, t) => ({ id, title, created: t, updated: t, doc: '', diagrams: [{ id: 'd1', type: 'architecture', name: 'Diagram 1', code: '' }], active: 0, view: 'flow', flow });
      const sheet = { active: false, edges: [E('e1', 't', 'ed')], nodes: [
        { id: 't', type: 'trigger.manual', name: 'Run by hand', x: 80, y: 160, params: { fields: 'Data* (file)' } },
        { id: 'ed', type: 'ui.edit.sheet', name: 'Sheet editor', x: 380, y: 160, params: { source: 'input', title: 'Check the numbers' } }] };
      const course = { active: false, edges: [E('e1', 't', 'ed')], nodes: [
        { id: 't', type: 'trigger.manual', name: 'Run by hand', x: 80, y: 160, params: {} },
        { id: 'ed', type: 'ui.edit.course', name: 'Course editor', x: 380, y: 160, params: { source: 'blank', title: 'Onboarding', button: 'Done' } }] };
      localStorage.setItem('linework:files:v2', JSON.stringify([file('wf1', 'Sheet check', sheet, now), file('wf2', 'Make a course', course, now - 1000)]));
    });
    const page = await ctx.newPage();
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    await page.goto('/');
    await page.getByRole('navigation', { name: 'Files' }).getByRole('button', { name: /^Run/ }).click();
    const panel = page.getByRole('complementary', { name: 'About this run' });

    // A CSV: the run stops and it opens in the Sheet, with its cells.
    await page.getByRole('button', { name: 'Run Sheet check' }).click();
    const form = page.getByRole('dialog', { name: 'Run with input' });
    await form.getByLabel(/^Data/).setInputFiles({ name: 'sales.csv', mimeType: 'text/csv', buffer: Buffer.from('Item,Total\nTea,4\nCake,6\n') });
    await form.getByRole('button', { name: 'Run' }).click();
    const tool = page.getByRole('dialog', { name: 'Edit sales.csv' });
    await expect(tool).toBeVisible({ timeout: 20_000 });
    await expect(tool.locator('.te-badge')).toHaveText('Sheet');
    await expect(tool.getByText('Check the numbers')).toBeVisible();
    await expect(tool.getByText('Cake').first()).toBeVisible({ timeout: 15_000 });
    await page.screenshot({ path: 'test-results/tool-editor-sheet.png' });
    await tool.getByRole('button', { name: 'Save & continue' }).click();
    await expect(page.locator('.fr-say')).toContainText('All done!', { timeout: 20_000 });
    const out = async () => page.evaluate(async id => { const { runs } = await (await fetch(`/api/flows/${id}/runs`)).json(); const { run } = await (await fetch('/api/runs/' + runs[0].id)).json(); return run.nodes.ed.output.main?.[0]; }, await page.evaluate(() => null) || 'wf1');
    const got = await out();
    expect(got).toMatchObject({ name: 'sales.csv', kind: 'sheet', saved: true });
    expect(Buffer.from(got.file.data, 'base64').toString()).toContain('Cake,6');

    // A new course: the Course editor with its ribbon; Done gives a .course.json.
    await page.getByRole('button', { name: 'Choose a workflow' }).click();
    await page.getByRole('option').filter({ hasText: 'Make a course' }).click();
    await page.getByRole('button', { name: 'Run Make a course' }).click();
    const ct = page.getByRole('dialog', { name: 'Edit Onboarding' });
    await expect(ct).toBeVisible({ timeout: 20_000 });
    await expect(ct.getByRole('tablist', { name: 'Ribbon' })).toBeVisible({ timeout: 15_000 });
    await page.screenshot({ path: 'test-results/tool-editor-course.png' });
    await ct.getByRole('button', { name: 'Done' }).click();
    await expect(page.locator('.fr-say')).toContainText('All done!', { timeout: 20_000 });
    const c = await page.evaluate(async () => { const { runs } = await (await fetch('/api/flows/wf2/runs')).json(); const { run } = await (await fetch('/api/runs/' + runs[0].id)).json(); return run.nodes.ed.output.main[0]; });
    expect(c).toMatchObject({ name: 'Onboarding.course.json', kind: 'course' });
    expect(JSON.parse(Buffer.from(c.file.data, 'base64').toString())).toMatchObject({ workline: 'course', course: { title: 'Onboarding' } });
    expect(errors).toEqual([]);
  } finally { srv.close(); stop(vite); }
});
