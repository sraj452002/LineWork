import { test, expect } from '@playwright/test';
import { openStore } from '../backend/store.js';
import { memoryBackend } from '../backend/storage.js';
import { createApp, LOCAL_USER } from '../backend/app.js';

// Publishing a workflow as an app: its questions should give the names the workflow reads. The Publish
// dialog offers Run by hand's own fields, and says when the two don't match. And the phone app (/run) has
// Nemo, the AI chat, beside the workflows, on a server without accounts.
test('publish: questions that match the workflow, and Nemo in the phone app', async ({ browser }) => {
  test.setTimeout(120_000);
  const { spawn } = await import('node:child_process');
  const app = createApp(await openStore(memoryBackend()), { noAccounts: true, storeOwner: LOCAL_USER, nvidiaKey: 'nvapi-test', nvidiaBase: 'http://127.0.0.1:9/v1' });
  const srv = app.listen(0);
  const port = 5263;
  const vite = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--port', String(port), '--strictPort'], { cwd: 'frontend', env: { ...process.env, LINEWORK_API: `http://localhost:${srv.address().port}` }, stdio: 'ignore', detached: true });
  try {
    const url = `http://localhost:${port}`;
    for (let i = 0; i < 60; i++) { try { if ((await fetch(url)).ok) break; } catch (e) {} await new Promise(r => setTimeout(r, 500)); }
    const ctx = await browser.newContext({ baseURL: url });
    await ctx.addInitScript(() => {
      if (sessionStorage.getItem('seeded')) return; sessionStorage.setItem('seeded', '1');
      localStorage.clear(); localStorage.setItem('linework:ai-open', '0');
      const now = Date.now();
      const flow = { active: false, edges: [{ id: 'e', from: 't', to: 'c', fromPort: 'main', toPort: 'main' }], nodes: [
        { id: 't', type: 'trigger.manual', name: 'Start', x: 80, y: 160, params: { fields: 'Code* (long)\nFile name' } },
        { id: 'c', type: 'core.set', name: 'Convert', x: 380, y: 160, params: { fields: [{ name: 'out', value: '{{ $json.code }} → {{ $node["Start"].json.fileName }}.py' }] } }],
        // Published earlier with a question whose name the workflow doesn't read.
        app: { published: true, name: 'converter', description: '', icon: '🤖', tone: 'blue', startId: 't', outputId: '', show: 'auto', inputs: [{ label: 'Js code', key: 'jsCode', kind: 'text', required: true }] } };
      localStorage.setItem('linework:files:v2', JSON.stringify([{ id: 'wf1', title: 'converter', created: now, updated: now, doc: '', diagrams: [{ id: 'd1', type: 'architecture', name: 'Diagram 1', code: '' }], active: 0, view: 'flow', flow }]));
    });
    const page = await ctx.newPage();
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    await page.goto('/');
    await page.getByText('converter').first().click();
    await page.getByRole('button', { name: /Published|Publish/ }).first().click();
    const dlg = page.getByRole('dialog', { name: 'Publish as an app' });
    await expect(dlg).toContainText('The workflow reads {{ $json.code }}, {{ $json.fileName }}, but no question gives them');
    await expect(dlg).toContainText('(nothing in the workflow reads it)');
    await page.screenshot({ path: 'test-results/publish-mismatch.png' });
    await dlg.getByRole('button', { name: 'Ask the same here' }).click();
    await expect(dlg.getByLabel('Question')).toHaveCount(2);
    await expect(dlg.getByLabel('Question').first()).toHaveValue('Code');
    await expect(dlg).not.toContainText('no question gives');
    await expect(dlg).not.toContainText('nothing in the workflow reads it');
    await expect(dlg.getByText('{{ $json.code }}', { exact: true })).toBeVisible();

    // The phone app: Workflows and Nemo.
    const phone = await ctx.newPage();
    await phone.setViewportSize({ width: 412, height: 860 });
    await phone.goto('/run');
    await expect(phone.getByRole('navigation', { name: 'WorkLine Apps' })).toBeVisible({ timeout: 20_000 });
    await phone.getByRole('button', { name: 'Nemo' }).click();
    await expect(phone.getByLabel('Message')).toBeVisible();
    await phone.screenshot({ path: 'test-results/run-nemo.png' });
    expect(errors).toEqual([]);
  } finally { try { process.kill(-vite.pid); } catch (e) {} srv.close(); app.flows.close(); }
});
