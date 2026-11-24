import { test, expect } from '@playwright/test';
import { runFlow } from '../backend/flow-engine.js';
import { NODE_TYPES } from '../backend/flow-nodes.js';
import { cleanCustom, customTypes } from '../backend/flow-custom.js';
import { openStore } from '../backend/store.js';
import { memoryBackend } from '../backend/storage.js';
import { createApp } from '../backend/app.js';
import { NODES, shelves } from '../frontend/src/lib/flows.js';
import { STARTER, addMissing, blankNode, deleteCustom, importNode, exportNode, keyOf, listCustom, saveCustom, usedBy } from '../frontend/src/lib/customnodes.js';
import { exportFlow, importFlow } from '../frontend/src/lib/flowio.js';

// Custom nodes (My nodes): nodes people make, with their own settings and JavaScript or Python code, run by
// the server from the account's latest definition.

const JS = { id: 'tax', name: 'Add tax', language: 'javascript', fields: [{ k: 'rate', label: 'Rate', kind: 'number', d: 18 }, { k: 'field', label: 'Field', kind: 'text' }],
  code: 'return items.map((item, i) => ({ ...item, tax: item[itemSettings[i].field] * settings.rate / 100 }));' };
const PY = { id: 'shout', name: 'Shout', language: 'python', fields: [{ k: 'text', label: 'Text', kind: 'text' }, { k: 'marks', label: 'Marks', kind: 'number', d: 1 }],
  code: 'return [{**item, "loud": item_settings[i]["text"].upper() + "!" * int(settings["marks"])} for i, item in enumerate(items)]' };
const run = async (defs, type, params, input) => {
  const flow = { nodes: [{ id: 't', type: 'trigger.manual', name: 'Start' }, { id: 'n', type, name: 'Mine', params }], edges: [{ from: 't', to: 'n' }] };
  const r = await runFlow(flow, { startId: 't', input: input.map(json => ({ json })), types: { ...NODE_TYPES, ...customTypes(defs) } });
  if (r.status !== 'success') throw new Error(r.error);
  return r.nodes.n.output.main;
};

test('a custom node runs its code with its settings, in JavaScript and Python', async () => {
  // Settings are filled in per item: {{ }} expressions read each item.
  expect(await run({ tax: JS }, 'custom.tax', { rate: 10, field: 'total' }, [{ total: 200 }, { total: 50 }])).toEqual([{ total: 200, tax: 20 }, { total: 50, tax: 5 }]);
  expect(await run({ shout: PY }, 'custom.shout', { text: '{{ $json.name }}', marks: 2 }, [{ name: 'asha' }, { name: 'ravi' }])).toEqual([{ name: 'asha', loud: 'ASHA!!' }, { name: 'ravi', loud: 'RAVI!!' }]);
  // The starter code works as written.
  expect(await run({ s: { id: 's', name: 'S', language: 'javascript', code: STARTER.javascript } }, 'custom.s', { greeting: 'Hello' }, [{ name: 'Asha' }])).toEqual([{ name: 'Asha', greeting: 'Hello, Asha!' }]);
  expect(await run({ s: { id: 's', name: 'S', language: 'python', code: STARTER.python } }, 'custom.s', { greeting: 'Hi' }, [{}])).toEqual([{ greeting: 'Hi, there!' }]);
  // Errors say which node.
  await expect(run({ e: { id: 'e', name: 'Broken', language: 'javascript', code: 'throw new Error("nope")' } }, 'custom.e', {}, [{}])).rejects.toThrow(/Broken.*nope/);
  await expect(run({ e: { id: 'e', name: 'Empty', language: 'javascript', code: ' ' } }, 'custom.e', {}, [{}])).rejects.toThrow('has no code yet');
  // A definition is cleaned before use: unknown languages and kinds fall back, bad keys are dropped.
  expect(cleanCustom({ id: 'x', language: 'ruby', fields: [{ k: '1bad' }, { k: 'ok', kind: 'weird' }] })).toMatchObject({ language: 'javascript', fields: [{ k: 'ok', kind: 'text' }] });
  expect(cleanCustom({ id: 'bad id!' })).toBe(null);
});

test('workflows run the account’s latest version, and a file’s copy when the account hasn’t got it', async () => {
  const app = createApp(await openStore(memoryBackend()), { noAccounts: true });
  const srv = app.listen(0);
  const base = `http://localhost:${srv.address().port}/api`;
  const call = (path, body, method = body ? 'POST' : 'GET') => fetch(base + path, { method, headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }).then(r => r.json());
  const runIt = async flow => {
    const { runId } = await call('/flows/wf1/run', { flow, startId: 't', input: [{ total: 100 }] });
    for (let i = 0; i < 50; i++) { const { run } = await call(`/runs/${runId}`); if (run.status !== 'running') return run; await new Promise(r => setTimeout(r, 100)); }
    throw new Error('the run didn’t finish');
  };
  try {
    const flow = { nodes: [{ id: 't', type: 'trigger.manual', name: 'Start', params: {} }, { id: 'n', type: 'custom.tax', name: 'Tax', params: { rate: 18, field: 'total' } }], edges: [{ from: 't', to: 'n' }] };
    await call('/userdata/customNodes', { value: { tax: JS } }, 'PUT');
    expect((await runIt(flow)).nodes.n.output.main).toEqual([{ total: 100, tax: 18 }]);
    // Edited in My nodes: the next run uses the new code.
    await call('/userdata/customNodes', { value: { tax: { ...JS, code: 'return items.map(i => ({ ...i, tax: 1 }));' } } }, 'PUT');
    expect((await runIt(flow)).nodes.n.output.main).toEqual([{ total: 100, tax: 1 }]);
    // Not in the account: the copy the workflow file carries.
    await call('/userdata/customNodes', { value: null }, 'PUT');
    expect((await runIt({ ...flow, customNodes: { tax: JS } })).nodes.n.output.main).toEqual([{ total: 100, tax: 18 }]);
    const lost = await runIt(flow);
    expect(lost.status).toBe('error');
    expect(lost.nodes.n.error).toMatch('Unknown node type “custom.tax”');
  } finally { srv.close(); app.flows.close(); }
});

test('My nodes: saved nodes join the node list; workflow files carry the ones they use', () => {
  for (const d of listCustom()) deleteCustom(d.id);
  expect(keyOf('Block prefix')).toBe('blockPrefix');
  expect(() => saveCustom({ ...blankNode(), name: ' ' })).toThrow('Give the node a name');
  expect(() => saveCustom({ ...blankNode(), fields: [{ k: 'a', label: 'A' }, { k: 'a', label: 'B' }] })).toThrow('Two settings have the key “a”');
  expect(() => saveCustom({ ...blankNode(), fields: [{ k: 'p', label: 'Plan', kind: 'select', options: [] }] })).toThrow('Give the dropdown “Plan” its choices');
  const tax = saveCustom({ ...JS, tone: 'green', icon: 'sum' });
  // A node like any other: its settings, defaults, and a My nodes shelf.
  const d = NODES['custom.tax'];
  expect(d).toMatchObject({ label: 'Add tax', group: 'My nodes', custom: 'tax' });
  expect(d.fields.map(f => f.k)).toEqual(['rate', 'field']);
  expect(d.defaults()).toEqual({ rate: 18 });
  expect(shelves([['custom.tax', d]])[0].section).toBe('My nodes');
  // Export carries it; importing where it's missing brings it back.
  const flow = { nodes: [{ id: 'a', type: 'custom.tax', name: 'Tax', x: 0, y: 0, params: { rate: 5 } }], edges: [] };
  expect(Object.keys(usedBy(flow))).toEqual(['tax']);
  const text = exportFlow({ title: 'Taxes', flow });
  deleteCustom('tax');
  expect(NODES['custom.tax']).toBe(undefined);
  const back = importFlow(text);
  expect(back.flow.nodes.map(n => n.type)).toEqual(['custom.tax']);
  expect(addMissing(back.customNodes)).toBe(1);
  expect(NODES['custom.tax'].label).toBe('Add tax');
  expect(addMissing(back.customNodes)).toBe(0);
  // One node as a file: imported with a fresh id, so it never replaces yours.
  const copy = importNode(exportNode(tax));
  expect(copy.name).toBe('Add tax');
  expect(copy.id).not.toBe('tax');
  expect(() => importNode('{"x":1}')).toThrow('isn’t a Workline node file');
  deleteCustom('tax');
});

test('make a node in My nodes, then use it in a workflow', async ({ page }) => {
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.addInitScript(() => { if (sessionStorage.getItem('s')) return; localStorage.clear(); localStorage.setItem('linework:local-mode', '1'); localStorage.setItem('linework:ai-open', '0'); sessionStorage.setItem('s', '1'); });
  await page.goto('/');
  await page.getByRole('navigation', { name: 'Files' }).getByRole('button', { name: /^Tools/ }).click();
  await page.locator('.tool-card').filter({ hasText: 'Form to a sheet' }).click();
  await page.getByRole('button', { name: 'My nodes', exact: true }).click();
  const dlg = page.getByRole('dialog', { name: 'My nodes' });
  await expect(dlg.getByLabel('Setting 1 label')).toHaveValue('Greeting');
  await dlg.getByLabel('Name', { exact: true }).fill('Greeter');
  await dlg.getByRole('radio', { name: 'chat' }).click();
  await dlg.getByRole('button', { name: '+ Add a setting' }).click();
  await dlg.getByLabel('Setting 2 label').fill('Sign off');
  await expect(dlg.getByLabel('Setting 2 key')).toHaveValue('signOff');
  await dlg.getByLabel('Setting 2 kind').selectOption('select');
  await dlg.getByLabel('Setting 2 choices').fill('Thanks, Cheers');
  await dlg.getByRole('button', { name: 'Create node' }).click();
  await expect(page.getByText(/Saved “Greeter”/)).toBeVisible();
  await expect(dlg.getByRole('navigation', { name: 'Your nodes' })).toContainText('Greeter');
  await dlg.getByRole('button', { name: 'Close', exact: true }).click();
  // In the node list, under My nodes; added, it shows its settings and an Edit node button.
  await page.locator('.fv-lib-item').filter({ hasText: 'Greeter' }).click();
  await page.locator('.fv-node').filter({ hasText: 'Greeter' }).first().click();
  const panel = page.locator('.fv-np');
  await expect(panel.locator('.fv-custom')).toContainText('A node you made (JavaScript)');
  await expect(panel.getByText('Sign off')).toBeVisible();
  await panel.getByRole('button', { name: 'Edit node' }).click();
  await expect(dlg.getByLabel('Name', { exact: true })).toHaveValue('Greeter');
  await dlg.getByRole('button', { name: 'Close', exact: true }).click();
  // Kept in this browser (no account): there after a reload, and the workflow's node still knows it.
  await page.reload();
  await page.getByText('Form to sheet').first().click();
  await expect(page.locator('.fv-lib-item').filter({ hasText: 'Greeter' })).toBeVisible();
  await page.locator('.fv-node').filter({ hasText: 'Greeter' }).first().click();
  await expect(page.locator('.fv-np .fv-custom')).toBeVisible();
  await page.locator('.fv-np').screenshot({ path: 'test-results/custom-node-panel.png' });
  await page.getByRole('button', { name: 'My nodes', exact: true }).click();
  await dlg.screenshot({ path: 'test-results/my-nodes.png' });
  expect(errors).toEqual([]);
});
