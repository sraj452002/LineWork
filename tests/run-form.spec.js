import { test, expect } from '@playwright/test';
import { openStore } from '../backend/store.js';
import { memoryBackend } from '../backend/storage.js';
import { createApp } from '../backend/app.js';
import { inputPaths, itemRows, rowsItem, runFields, runValues, typedValue } from '../frontend/src/lib/flows.js';

// Run workflow with input: a Run by hand trigger's fields become a form before the run, and what's filled
// in is the first item; any workflow can also be run with an item written as JSON.

test('the fields a Run by hand trigger asks for', () => {
  const f = runFields('First name*\nEmail* (email)\nAmount (number)\nPlan (choice: Free, Pro)\nUrgent (yes/no)\nNotes (long)');
  expect(f.map(x => [x.key, x.kind, x.required])).toEqual([['firstName', 'text', true], ['email', 'email', true], ['amount', 'number', false], ['plan', 'choice', false], ['urgent', 'yesno', false], ['notes', 'long', false]]);
  expect(f[3].options).toEqual(['Free', 'Pro']);
  expect(runValues(f, { firstName: 'Asha', email: 'a@x.in', amount: '1250.5', plan: 'Pro', urgent: true, notes: '' })).toEqual({ firstName: 'Asha', email: 'a@x.in', amount: 1250.5, plan: 'Pro', urgent: true, notes: '' });
  expect(runValues(f, { amount: '' }).amount).toBe(null);
});

test('a node’s input form: the fields it reads, typed values, and rows to an item and back', () => {
  const flow = { edges: [{ from: 't', to: 'a' }, { from: 't', to: 'b' }], nodes: [
    { id: 't', type: 'trigger.webhook', params: {} },
    { id: 'a', type: 'app.email', params: { to: '{{ $json.email }}', subject: 'Order {{ $json.order.id }}', text: '{{ $json["first name"] }} {{ $json.email }}' } },
    { id: 'b', type: 'core.if', params: { left: '{{ $json.total * 2 }}', op: 'gt', right: '10' } }] };
  // A node: what its own settings read, once each, nested paths whole.
  expect(inputPaths(flow, 'a')).toEqual(['email', 'order.id', 'first name']);
  // A trigger passes its item on: what the nodes after it read.
  expect(inputPaths(flow, 't')).toEqual(['email', 'order.id', 'first name', 'total']);
  expect(inputPaths(flow, 'nope')).toEqual([]);
  // Typed values: numbers, true/false, null and JSON as such; phone numbers and 0123 stay text.
  expect([typedValue('12'), typedValue('1.5'), typedValue('-3'), typedValue('true'), typedValue('null'), typedValue('{"a":1}'), typedValue('[1,2]')]).toEqual([12, 1.5, -3, true, null, { a: 1 }, [1, 2]]);
  expect([typedValue('0123'), typedValue('919876543210123456'), typedValue('Asha'), typedValue('{oops'), typedValue('')]).toEqual(['0123', '919876543210123456', 'Asha', '{oops', '']);
  // Rows → item (dots nest; nameless rows are skipped) → rows.
  const item = rowsItem([{ name: 'email', value: 'a@x.in' }, { name: 'order.id', value: '42' }, { name: 'order.paid', value: 'true' }, { name: '', value: 'x' }]);
  expect(item).toEqual({ email: 'a@x.in', order: { id: 42, paid: true } });
  expect(itemRows(item)).toEqual([{ name: 'email', value: 'a@x.in' }, { name: 'order.id', value: '42' }, { name: 'order.paid', value: 'true' }]);
});

test('Run workflow opens the form, and the workflow gets what was filled in', async ({ browser }) => {
  test.setTimeout(120_000);
  const { spawn } = await import('node:child_process');
  const app = createApp(await openStore(memoryBackend()), { noAccounts: true });
  const srv = app.listen(0);
  const port = 5241;
  const vite = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--port', String(port), '--strictPort'], { cwd: 'frontend', env: { ...process.env, LINEWORK_API: `http://localhost:${srv.address().port}` }, stdio: 'ignore', detached: process.platform !== 'win32' });
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

    // Run from here on a node: a form with a box for each field it reads, and fields can be added.
    const runsBefore = (await page.evaluate(() => fetch('/api/flows/wf1/runs').then(r => r.json()))).runs.length;
    await page.locator('.fv-node').filter({ hasText: 'Greeting' }).click();
    await page.getByRole('button', { name: 'Run from here' }).click();
    await expect(form.getByRole('heading')).toHaveText('Run from “Greeting”');
    await expect(form.getByRole('tab', { name: 'Form' })).toHaveAttribute('aria-selected', 'true');
    await form.getByLabel(/^name/).fill('Meera');
    await form.getByLabel(/^plan/).fill('Team');
    await form.getByLabel(/^amount/).fill('25');
    await form.getByRole('button', { name: '+ Add a field' }).click();
    await form.getByLabel('Field 4 name').fill('customer.city');
    await form.getByLabel('Field 4 value').fill('Pune');
    await form.screenshot({ path: 'test-results/run-from-here.png' });
    // The JSON tab shows the same item, typed and nested, and back.
    await form.getByRole('tab', { name: 'JSON' }).click();
    expect(JSON.parse(await form.getByLabel('Input as JSON').inputValue())).toEqual({ name: 'Meera', plan: 'Team', amount: 25, customer: { city: 'Pune' } });
    await form.getByRole('tab', { name: 'Form' }).click();
    await expect(form.getByLabel('Field 4 name')).toHaveValue('customer.city');
    await form.getByRole('button', { name: 'Run' }).click();
    await expect(form).toHaveCount(0);
    await expect.poll(async () => {
      const list = (await page.evaluate(() => fetch('/api/flows/wf1/runs').then(r => r.json()))).runs || [];
      if (list.length <= runsBefore) return null;
      const { run } = await page.evaluate(id => fetch(`/api/runs/${id}`).then(r => r.json()), list[0].id);
      const out = run?.nodes?.s?.output?.main?.[0];
      return out ? [run.startId, out.message, out.customer?.city] : null;
    }, { timeout: 20_000 }).toEqual(['s', 'Hi Meera, Team costs 50', 'Pune']);
    // Next time, what was entered is there again.
    await page.getByRole('button', { name: 'Run from here' }).click();
    await expect(form.getByLabel(/^name/)).toHaveValue('Meera');
    await expect(form.getByLabel('Field 4 value')).toHaveValue('Pune');
    expect(errors).toEqual([]);
  } finally { try { if (process.platform === 'win32') (await import('node:child_process')).spawnSync('taskkill', ['/pid', String(vite.pid), '/T', '/F']); else process.kill(-vite.pid); } catch (e) {} srv.close(); app.flows.close(); }
});

// The ready-made "GST invoice calculator": its form's answers in, the invoice out.
test('the GST invoice calculator template works out the invoice from the form', async () => {
  Object.assign(globalThis, { innerWidth: globalThis.innerWidth || 1400 });
  const mod = await import('../frontend/src/lib/readymade.js');
  const list = Object.values(mod).find(v => Array.isArray(v) && v.some(t => t && t.k === 'w-gst'));
  const { flow } = list.find(t => t.k === 'w-gst').make();
  const { runFlow } = await import('../backend/flow-engine.js');
  const types = { ...(await import('../backend/flow-nodes.js')).NODE_TYPES, ...(await import('../backend/flow-tools.js')).TOOL_NODES };
  expect(runFields(flow.nodes[0].params.fields).map(f => f.key)).toEqual(['customer', 'item', 'amount', 'gstRate', 'priceIncludesGst']);
  const run = async answers => {
    const r = await runFlow(flow, { startId: flow.nodes[0].id, input: [{ json: answers }], types, ctx: {} });
    expect(r.status).toBe('success');
    const out = r.nodes[flow.nodes.at(-1).id].output.main[0];
    return out.json ?? out;
  };
  const a = await run({ customer: 'Asha Traders', item: 'Website design', amount: 25000, gstRate: '18', priceIncludesGst: false });
  expect(a.tax).toEqual({ net: 25000, tax: 4500, total: 29500, cgst: 2250, sgst: 2250 });
  expect(a.invoice).toBe('Invoice for Asha Traders\nWebsite design\nAmount: ₹25000\nCGST (9%): ₹2250\nSGST (9%): ₹2250\nTotal: ₹29500\n(Rupees twenty-nine thousand five hundred only)');
  // A price that already includes GST: the tax is taken out of it.
  const b = await run({ customer: 'Ravi', item: 'Shoes', amount: 1180, gstRate: '18', priceIncludesGst: true });
  expect(b.tax).toMatchObject({ net: 1000, tax: 180, total: 1180 });
});
