import { test, expect } from '@playwright/test';
import { openStore } from '../backend/store.js';
import { memoryBackend } from '../backend/storage.js';
import { createApp } from '../backend/app.js';

// A Form trigger with a (file) field: the shared form has a file picker, and the workflow gets the file
// as {name, type, size, data} (data in base64), ready to attach to an email.
test('a web form takes a file and hands it to the workflow', async ({ browser }) => {
  test.setTimeout(60_000);
  const app = createApp(await openStore(memoryBackend()), { noAccounts: true });
  const srv = app.listen(0), base = `http://localhost:${srv.address().port}/api`;
  try {
    const flow = { active: true, nodes: [
      { id: 'f', type: 'trigger.form', name: 'Apply', x: 0, y: 0, params: { path: 'formfilefile1234', title: 'Apply', fields: 'Name*\nYour CV* (file)', button: 'Send' } },
      { id: 'n', type: 'core.noop', name: 'Got it', x: 300, y: 0, params: {} }],
    edges: [{ id: 'e', from: 'f', to: 'n', fromPort: 'main', toPort: 'main' }] };
    const f = { id: 'fform1', title: 'Apply', created: 1, updated: 1, doc: '', diagrams: [{ id: 'd1', type: 'architecture', name: 'D', code: '' }], active: 0, view: 'flow', flow };
    expect((await fetch(`${base}/files/fform1`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(f) })).ok).toBe(true);

    const page = await (await browser.newContext()).newPage();
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    await page.goto(`${base}/hook/formfilefile1234`);
    await page.getByLabel(/^Name/).fill('Meera');
    await page.locator('input[type=file][name=yourCv]').setInputFiles({ name: 'cv.txt', mimeType: 'text/plain', buffer: Buffer.from('Hello, I am Meera.') });
    await page.getByRole('button', { name: 'Send' }).click();
    await expect(page.getByText('Thanks! We got it.')).toBeVisible();

    let item;
    await expect.poll(async () => {
      const { runs } = await (await fetch(`${base}/flows/fform1/runs`)).json();
      if (!runs?.[0] || runs[0].status !== 'success') return null;
      const { run } = await (await fetch(`${base}/runs/${runs[0].id}`)).json();
      item = Object.values(run.nodes.n.output).flat()[0];
      return item?.name;
    }, { timeout: 15_000 }).toBe('Meera');
    expect(item.yourCv).toMatchObject({ name: 'cv.txt', type: 'text/plain', size: 18 });
    expect(Buffer.from(item.yourCv.data, 'base64').toString()).toBe('Hello, I am Meera.');

    // Without the file (it's required): the server turns it away.
    const r = await fetch(`${base}/hook/formfilefile1234`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'X' }) });
    expect(r.status).toBe(400);
    expect(errors).toEqual([]);
  } finally { srv.close(); app.flows.close(); }
});
