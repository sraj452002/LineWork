import { test, expect } from '@playwright/test';
import { openStore } from '../backend/store.js';
import { memoryBackend } from '../backend/storage.js';
import { createApp } from '../backend/app.js';
import { runFields, runValues } from '../frontend/src/lib/flows.js';

// Run workflow with input: a Run by hand trigger's fields become a form before the run, and what's filled
// in is the first item; any workflow can also be run with an item written as JSON.

test('the fields a Run by hand trigger asks for', () => {
  const f = runFields('First name*\nEmail* (email)\nAmount (number)\nPlan (choice: Free, Pro)\nUrgent (yes/no)\nNotes (long)');
  expect(f.map(x => [x.key, x.kind, x.required])).toEqual([['firstName', 'text', true], ['email', 'email', true], ['amount', 'number', false], ['plan', 'choice', false], ['urgent', 'yesno', false], ['notes', 'long', false]]);
  expect(f[3].options).toEqual(['Free', 'Pro']);
  expect(runValues(f, { firstName: 'Asha', email: 'a@x.in', amount: '1250.5', plan: 'Pro', urgent: true, notes: '' })).toEqual({ firstName: 'Asha', email: 'a@x.in', amount: 1250.5, plan: 'Pro', urgent: true, notes: '' });
  expect(runValues(f, { amount: '' }).amount).toBe(null);
});

test('Run workflow opens the form, and the workflow gets what was filled in', async ({ browser }) => {
  test.setTimeout(120_000);
  const { spawn } = await import('node:child_process');
  const app = createApp(await openStore(memoryBackend()), { noAccounts: true });
  const srv = app.listen(0);
  const port = 5241;
  const vite = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--port', String(port), '--strictPort'], { cwd: 'frontend', env: { ...process.env, LINEWORK_API: `http://localhost:${srv.address().port}` }, stdio: 'ignore', detached: true });
  try {
    const url = `http://localhost:${port}`;
    for (let i = 0; i < 60; i++) { try { if ((await fetch(url)).ok) break; } catch (e) {} await new Promise(r => setTimeout(r, 500)); }
    const ctx = await browser.newContext({ baseURL: url });
    await ctx.addInitScript(() => {
      if (sessionStorage.getItem('seeded')) return; sessionStorage.setItem('seeded', '1');
      localStorage.clear(); localStorage.setItem('linework:ai-open', '0');
      const now = Date.now();
      const flow = { active: false, edges: [{ id: 'e', from: 't', to: 's', fromPort: 'main', toPort: 'main' }], nodes: [
        { id: 't', type: 'trigger.manual', name: 'Run by hand', x: 80, y: 160, params: { fields: 'Name*\nAmount (number)\nPlan (choice: Free, Pro)' } },
        { id: 's', type: 'core.set', name: 'Greeting', x: 380, y: 160, params: { fields: [{ name: 'message', value: 'Hi {{ $json.name }}, {{ $json.plan }} costs {{ $json.amount * 2 }}' }] } }] };
      localStorage.setItem('linework:files:v2', JSON.stringify([{ id: 'wf1', title: 'Greet', created: now, updated: now, doc: '', diagrams: [{ id: 'd1', type: 'architecture', name: 'Diagram 1', code: '' }], active: 0, view: 'flow', flow }]));
    });
    const page = await ctx.newPage();
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    await page.goto('/');
    await page.getByText('Greet').first().click();
    await page.getByRole('button', { name: 'Run workflow' }).click();
    const form = page.getByRole('dialog', { name: 'Run with input' });
    await expect(form).toBeVisible();
    // A required field left empty is asked for.
    await form.getByRole('button', { name: 'Run' }).click();
    await expect(form.getByRole('alert')).toHaveText('Fill in Name.');
    await form.getByLabel(/^Name/).fill('Asha');
    await form.getByLabel(/^Amount/).fill('600');
    await form.getByLabel(/^Plan/).selectOption('Pro');
    await page.screenshot({ path: 'test-results/run-form.png' });
    await form.getByRole('button', { name: 'Run' }).click();
    await expect(form).toHaveCount(0);
    await expect(page.locator('.fv-node').filter({ hasText: 'Greeting' })).toBeVisible();
    // The run's output: the greeting made from what was filled in.
    await expect.poll(async () => {
      const list = (await page.evaluate(() => fetch('/api/flows/wf1/runs').then(r => r.json()))).runs || [];
      if (!list[0]) return null;
      const { run } = await page.evaluate(id => fetch(`/api/runs/${id}`).then(r => r.json()), list[0].id);
      const out = run?.nodes?.s?.output?.main?.[0];
      return out?.message ?? out?.json?.message ?? null;
    }, { timeout: 20_000 }).toBe('Hi Asha, Pro costs 1200');

    // Run with input… : the same form, filled in from last time; JSON instead.
    await page.getByRole('button', { name: 'More ways to run' }).click();
    await page.getByRole('menuitem', { name: 'Run with input…' }).click();
    await expect(form.getByLabel(/^Name/)).toHaveValue('Asha');
    await form.getByRole('tab', { name: 'JSON' }).click();
    await expect(form.getByLabel('Input as JSON')).toHaveValue(/"name": "Asha"/);
    await form.getByLabel('Input as JSON').fill('{"name": "Ravi", "amount": 50, "plan": "Free"}');
    await form.getByRole('button', { name: 'Run' }).click();
    await expect(form).toHaveCount(0);
    expect(errors).toEqual([]);
  } finally { try { process.kill(-vite.pid); } catch (e) {} srv.close(); app.flows.close(); }
});
