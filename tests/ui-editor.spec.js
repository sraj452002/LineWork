import { test, expect } from '@playwright/test';
import { openStore } from '../backend/store.js';
import { memoryBackend } from '../backend/storage.js';
import { createApp } from '../backend/app.js';

// The Editor node finds out what a file is (a doc, a sheet, a diagram or a code project), shows the right
// editor filled in with what's there now, saves the changes back, and offers the whole file to download
// (and to the next steps as {name, type, size, data}).
test('the Editor node finds out the kind of file, edits it and gives the whole file back', async ({ browser }) => {
  test.setTimeout(90_000);
  const app = createApp(await openStore(memoryBackend()), { noAccounts: true });
  const srv = app.listen(0), base = `http://localhost:${srv.address().port}/api`;
  const put = (id, f) => fetch(`${base}/files/${id}`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(f) });
  const get = async id => (await fetch(`${base}/files/${id}`)).json();
  const dg = (code = '') => [{ id: 'd1', type: 'architecture', name: 'Diagram 1', code }];
  try {
    const now = Date.now(), file = (id, title, more) => ({ id, title, created: now, updated: now, doc: '', diagrams: dg(), active: 0, ...more });
    expect((await put('fdoc1', file('fdoc1', 'Notes', { doc: '# Shopping\n- milk', view: 'doc' }))).ok).toBe(true);
    expect((await put('fsheet1', file('fsheet1', 'Prices', { view: 'sheet', sheets: [{ id: 's1', name: 'Sheet1', rows: 100, cols: 26, cells: { A1: 'Item', B1: 'Price', A2: 'Milk', B2: '40' } }] }))).ok).toBe(true);
    expect((await put('fdia1', file('fdia1', 'System', { view: 'canvas', diagrams: dg('web > api') }))).ok).toBe(true);
    expect((await put('fcode1', file('fcode1', 'Site', { view: 'code', code: { files: [{ id: 'c1', path: 'index.html', text: '<h1>Hi</h1>' }, { id: 'c2', path: 'app.js', text: 'console.log(1)' }], folders: [], open: ['c1'], active: 'c1' } }))).ok).toBe(true);
    const n = (id, name, fileId) => ({ id, type: 'ui.editor', name, x: 0, y: 0, params: { fileId, part: 'auto', button: `Save ${name}` } });
    const flow = { active: true, nodes: [
      { id: 'p', type: 'trigger.page', name: 'Page', x: 0, y: 0, params: { path: 'editorpage123456', title: 'My files' } },
      n('a', 'Doc', 'fdoc1'), n('b', 'Sheet', 'fsheet1'), n('c', 'Diagram', 'fdia1'), n('d', 'Code', 'fcode1')],
    edges: [['p', 'a'], ['a', 'b'], ['b', 'c'], ['c', 'd']].map(([f, t], i) => ({ id: 'e' + i, from: f, to: t, fromPort: 'main', toPort: 'main' })) };
    expect((await put('fpage1', file('fpage1', 'Files page', { view: 'flow', flow }))).ok).toBe(true);

    const page = await (await browser.newContext({ acceptDownloads: true })).newPage();
    await page.goto(`${base}/hook/editorpage123456`);
    // Each one found out: the right kind, the right editor.
    await expect(page.locator('.n-doc .ed-kind')).toHaveText('Doc');
    await expect(page.locator('.n-sheet .ed-kind')).toHaveText('Sheet');
    await expect(page.locator('.n-diagram .ed-kind')).toHaveText('Diagram');
    await expect(page.locator('.n-code .ed-kind')).toHaveText('Code');

    // The doc: edit, save, and download the whole file.
    const doc = page.locator('.n-doc textarea');
    await expect(doc).toHaveValue('# Shopping\n- milk');
    await doc.fill('# Shopping\n- milk\n- bread');
    await page.getByRole('button', { name: 'Save Doc' }).click();
    await expect(page.locator('.n-doc .ed-ok')).toHaveText('✓ Saved');
    expect((await get('fdoc1')).doc).toBe('# Shopping\n- milk\n- bread');
    const [down] = await Promise.all([page.waitForEvent('download'), page.locator('.n-doc .ed-dl').click()]);
    expect(down.suggestedFilename()).toBe('Notes.md');
    const chunks = []; for await (const c of await down.createReadStream()) chunks.push(c);
    expect(Buffer.concat(chunks).toString()).toBe('# Shopping\n- milk\n- bread');

    // The sheet: a grid; change a price, add a row; the download is the whole sheet as CSV.
    await page.locator('.n-sheet').getByLabel('B2').fill('45');
    await page.locator('.n-sheet').getByLabel('A3').fill('Bread, white');
    await page.locator('.n-sheet').getByLabel('B3').fill('30');
    await page.getByRole('button', { name: 'Save Sheet' }).click();
    await expect(page.locator('.n-sheet .ed-ok')).toHaveText('✓ Saved');
    expect((await get('fsheet1')).sheets[0].cells).toMatchObject({ A2: 'Milk', B2: '45', A3: 'Bread, white', B3: '30' });
    const csv = await page.locator('.n-sheet .ed-dl').getAttribute('href');
    expect(Buffer.from(csv.split(',')[1], 'base64').toString()).toBe('Item,Price\nMilk,45\n"Bread, white",30');
    await expect(page.locator('.n-sheet .ed-dl')).toHaveAttribute('download', 'Prices.csv');

    // The diagram's code.
    await page.locator('.n-diagram textarea').fill('web > api > db');
    await page.getByRole('button', { name: 'Save Diagram' }).click();
    await expect(page.locator('.n-diagram .ed-ok')).toHaveText('✓ Saved');
    expect((await get('fdia1')).diagrams[0].code).toBe('web > api > db');

    // The code project: the open file first, the others as tabs; edit app.js.
    await expect(page.locator('.n-code textarea')).toHaveValue('<h1>Hi</h1>');
    await page.locator('.n-code').getByRole('link', { name: 'app.js' }).click();
    await expect(page.locator('.n-code textarea')).toHaveValue('console.log(1)');
    await page.locator('.n-code textarea').fill('console.log(2)');
    await page.getByRole('button', { name: 'Save Code' }).click();
    await expect(page.locator('.n-code .ed-ok')).toHaveText('✓ Saved');
    await expect(page.locator('.n-code textarea')).toHaveValue('console.log(2)');
    const code = (await get('fcode1')).code.files;
    expect(code.find(x => x.path === 'app.js').text).toBe('console.log(2)');
    expect(code.find(x => x.path === 'index.html').text).toBe('<h1>Hi</h1>');
    await expect(page.locator('.n-code .ed-dl')).toHaveAttribute('download', 'app.js');
    await page.screenshot({ path: 'test-results/ui-editor.png', fullPage: true });

    // The next steps get the whole file too.
    const { runs } = await (await fetch(`${base}/flows/fpage1/runs`)).json();
    const { run } = await (await fetch(`${base}/runs/${runs[0].id}`)).json();
    expect(Object.values(run.nodes.a.output).flat()[0]).toMatchObject({ kind: 'doc', file: { name: 'Notes.md', type: 'text/markdown' } });
  } finally { srv.close(); app.flows.close(); }
});
