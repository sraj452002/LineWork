import { test, expect } from '@playwright/test';
import { openStore } from '../backend/store.js';
import { memoryBackend } from '../backend/storage.js';
import { createApp } from '../backend/app.js';

// The Editor node: a Page workflow shows a file's doc, a sheet (as a grid) and a diagram's code, filled in
// with what's there now; Save writes the changes back to the file and shows them again with “Saved”.
test('the Editor node edits a file’s doc, sheet and diagram from a page', async ({ browser }) => {
  test.setTimeout(90_000);
  const app = createApp(await openStore(memoryBackend()), { noAccounts: true });
  const srv = app.listen(0), base = `http://localhost:${srv.address().port}/api`;
  const put = (id, f) => fetch(`${base}/files/${id}`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(f) });
  const get = async id => (await fetch(`${base}/files/${id}`)).json();
  try {
    const now = Date.now();
    expect((await put('fnotes1', { id: 'fnotes1', title: 'Notes', created: now, updated: now, doc: '# Shopping\n- milk',
      sheets: [{ id: 's1', name: 'Prices', rows: 100, cols: 26, cells: { A1: 'Item', B1: 'Price', A2: 'Milk', B2: '40' } }],
      diagrams: [{ id: 'd1', type: 'architecture', name: 'Diagram 1', code: 'web > api' }], active: 0, view: 'doc' })).ok).toBe(true);
    const n = (id, type, name, params) => ({ id, type, name, x: 0, y: 0, params });
    const flow = { active: true, nodes: [
      n('p', 'trigger.page', 'Page', { path: 'editorpage123456', title: 'My notes' }),
      n('a', 'ui.editor', 'Doc', { fileId: 'fnotes1', part: 'doc', button: 'Save' }),
      n('b', 'ui.editor', 'Sheet', { fileId: 'fnotes1', part: 'sheet', title: 'Prices', button: 'Save prices' }),
      n('c', 'ui.editor', 'Diagram', { fileId: 'fnotes1', part: 'diagram', title: 'Diagram', button: 'Save diagram' })],
    edges: [['p', 'a'], ['a', 'b'], ['b', 'c']].map(([f, t], i) => ({ id: 'e' + i, from: f, to: t, fromPort: 'main', toPort: 'main' })) };
    expect((await put('fpage1', { id: 'fpage1', title: 'Notes page', created: now, updated: now, doc: '', diagrams: [{ id: 'd1', type: 'architecture', name: 'D', code: '' }], active: 0, view: 'flow', flow })).ok).toBe(true);

    const page = await (await browser.newContext()).newPage();
    await page.goto(`${base}/hook/editorpage123456`);
    // The doc, as it is now.
    const doc = page.locator('.n-doc textarea');
    await expect(doc).toHaveValue('# Shopping\n- milk');
    await doc.fill('# Shopping\n- milk\n- bread');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.locator('.n-doc .ed-ok')).toHaveText('✓ Saved');
    await expect(page.locator('.n-doc textarea')).toHaveValue('# Shopping\n- milk\n- bread');
    expect((await get('fnotes1')).doc).toBe('# Shopping\n- milk\n- bread');

    // The sheet: change a price, add a row in the spare one.
    await expect(page.getByLabel('B2')).toHaveValue('40');
    await page.getByLabel('B2').fill('45');
    await page.getByLabel('A3').fill('Bread');
    await page.getByLabel('B3').fill('30');
    await page.getByRole('button', { name: 'Save prices' }).click();
    await expect(page.locator('.n-sheet .ed-ok')).toHaveText('✓ Saved');
    await expect(page.getByLabel('A3')).toHaveValue('Bread');
    const cells = (await get('fnotes1')).sheets[0].cells;
    expect(cells).toMatchObject({ A1: 'Item', B1: 'Price', A2: 'Milk', B2: '45', A3: 'Bread', B3: '30' });
    // The doc wasn't touched by the sheet's Save.
    expect((await get('fnotes1')).doc).toBe('# Shopping\n- milk\n- bread');

    // The diagram's code.
    const code = page.locator('.n-diagram textarea');
    await expect(code).toHaveValue('web > api');
    await code.fill('web > api > db');
    await page.getByRole('button', { name: 'Save diagram' }).click();
    await expect(page.locator('.n-diagram .ed-ok')).toHaveText('✓ Saved');
    expect((await get('fnotes1')).diagrams[0].code).toBe('web > api > db');
    await page.screenshot({ path: 'test-results/ui-editor.png', fullPage: true });
  } finally { srv.close(); app.flows.close(); }
});
