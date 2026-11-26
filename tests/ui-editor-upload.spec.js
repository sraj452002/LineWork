import { test, expect } from '@playwright/test';
import ExcelJS from '../backend/node_modules/exceljs/excel.js';
import { openStore } from '../backend/store.js';
import { memoryBackend } from '../backend/storage.js';
import { createApp } from '../backend/app.js';

// “Edit any file”: a Page workflow whose Editor takes a file uploaded on the page. It finds out the kind
// of file, opens it in the right editor, saves the changes and gives the whole file back in the same format.
test('upload a file, edit it on the page, download it back in its own format', async ({ browser }) => {
  test.setTimeout(90_000);
  const app = createApp(await openStore(memoryBackend()), { noAccounts: true });
  const srv = app.listen(0), base = `http://localhost:${srv.address().port}/api`;
  try {
    const n = (id, type, name, params) => ({ id, type, name, x: 0, y: 0, params });
    const flow = { active: true, nodes: [
      n('p', 'trigger.page', 'Upload a file', { path: 'editanyfile12345', title: 'Edit a file' }),
      n('e', 'ui.editor', 'Editor', { source: 'upload', title: 'Your file', button: 'Save' }),
      n('o', 'core.set', 'Edited file', { fields: [{ name: 'file', value: '{{ $json.file }}' }], keep: false })],
    edges: [{ id: 'e1', from: 'p', to: 'e', fromPort: 'main', toPort: 'main' }, { id: 'e2', from: 'e', to: 'o', fromPort: 'main', toPort: 'main' }] };
    const f = { id: 'fedit1', title: 'Edit any file', created: 1, updated: 1, doc: '', diagrams: [{ id: 'd1', type: 'architecture', name: 'D', code: '' }], active: 0, view: 'flow', flow };
    expect((await fetch(`${base}/files/fedit1`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(f) })).ok).toBe(true);
    const page = await (await browser.newContext({ acceptDownloads: true })).newPage();
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    const upload = async (name, mimeType, buffer) => {
      await page.goto(`${base}/hook/editanyfile12345`);
      await page.locator('input[type=file][name=upload]').setInputFiles({ name, mimeType, buffer });
      await page.getByRole('button', { name: 'Open' }).click();
    };
    const downloaded = async () => {
      const [d] = await Promise.all([page.waitForEvent('download'), page.locator('.ed-dl').click()]);
      const chunks = []; for await (const c of await d.createReadStream()) chunks.push(c);
      return { name: d.suggestedFilename(), buf: Buffer.concat(chunks) };
    };

    // A CSV: a grid. Change a cell, add a row; the download is the CSV, edited.
    await upload('prices.csv', 'text/csv', Buffer.from('Item,Price\nMilk,40\n'));
    await expect(page.locator('.ed-kind')).toHaveText('Sheet');
    await expect(page.getByLabel('B2')).toHaveValue('40');
    await expect(page).toHaveURL(/\/hook\/editanyfile12345\??$/);
    await page.getByLabel('B2').fill('45');
    await page.getByLabel('A3').fill('Bread');
    await page.getByLabel('B3').fill('30');
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.locator('.ed-ok')).toHaveText('✓ Saved');
    await expect(page.getByLabel('B2')).toHaveValue('45');
    await expect(page).toHaveURL(/\?doc=.+&k=[0-9a-f]+$/);
    let got = await downloaded();
    expect(got.name).toBe('prices.csv');
    expect(got.buf.toString()).toBe('Item,Price\nMilk,45\nBread,30');
    // Its link opens it again (the key is needed: without it, the upload box).
    const link = page.url();
    await page.goto(link.replace(/k=[0-9a-f]+/, 'k=nope'));
    await expect(page.locator('.ed-err')).toContainText('isn’t here any more');
    await page.goto(link);
    await expect(page.getByLabel('A3')).toHaveValue('Bread');

    // An Excel file: back as .xlsx, edited.
    const wb = new ExcelJS.Workbook(); const ws = wb.addWorksheet('Stock'); ws.addRow(['Item', 'Qty']); ws.addRow(['Pens', 10]);
    await upload('stock.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', Buffer.from(await wb.xlsx.writeBuffer()));
    await expect(page.locator('.ed-kind')).toHaveText('Sheet');
    await expect(page.getByLabel('B2')).toHaveValue('10');
    await page.getByLabel('B2').fill('12');
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.locator('.ed-ok')).toHaveText('✓ Saved');
    got = await downloaded();
    expect(got.name).toBe('stock.xlsx');
    const back = new ExcelJS.Workbook(); await back.xlsx.load(got.buf);
    expect(back.worksheets[0].name).toBe('Stock');
    expect(back.worksheets[0].getCell('A2').value).toBe('Pens');
    expect(back.worksheets[0].getCell('B2').value).toBe(12);

    // JSON (code): a code box; the download is the same file name.
    await upload('config.json', 'application/json', Buffer.from('{\n  "debug": false\n}\n'));
    await expect(page.locator('.ed-kind')).toHaveText('Code');
    await page.locator('textarea').fill('{\n  "debug": true\n}\n');
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.locator('.ed-ok')).toHaveText('✓ Saved');
    got = await downloaded();
    expect(got.name).toBe('config.json');
    expect(got.buf.toString()).toBe('{\n  "debug": true\n}\n');
    await page.screenshot({ path: 'test-results/edit-any-file.png', fullPage: true });

    // A picture can't be edited: the box says so.
    await upload('photo.png', 'image/png', Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0]));
    await expect(page.locator('.ed-err')).toContainText('isn’t a file that can be edited here');

    // The last step (“Edited file”) has the whole file, for whatever comes next.
    const { runs } = await (await fetch(`${base}/flows/fedit1/runs`)).json();
    const outs = [];
    for (const r of runs.filter(x => x.status === 'success')) {
      const { run } = await (await fetch(`${base}/runs/${r.id}`)).json();
      outs.push(Object.values(run.nodes.o?.output || {}).flat()[0]);
    }
    expect(outs).toContainEqual(expect.objectContaining({ file: expect.objectContaining({ name: 'config.json', type: 'application/json' }) }));
    expect(errors).toEqual([]);
  } finally { srv.close(); app.flows.close(); }
});
