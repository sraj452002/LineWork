import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';

const JSZip = createRequire(import.meta.url)('../frontend/node_modules/jszip');

// Tools → Import a .zip: what's inside is listed, then each workflow, sheet, schema and doc becomes a
// file, and the source files one code project with their folders. Pictures and the like stay out.
test('a .zip is read and its files imported', async ({ page }) => {
  const zip = new JSZip();
  zip.file('shop/flows/greet.workflow.json', JSON.stringify({ workline: 'workflow', name: 'Greeter', flow: { nodes: [{ id: 'a', type: 'trigger.manual', name: 'Run by hand', x: 0, y: 0, params: {} }, { id: 'b', type: 'text.upper', name: 'Shout', x: 200, y: 0, params: {} }], edges: [{ id: 'e', from: 'a', fromPort: 'main', to: 'b', toPort: 'main' }] } }));
  zip.file('shop/orders.csv', 'id,customer,total\n1,Ada,120\n2,Grace,80\n');
  zip.file('shop/db/schema.sql', 'CREATE TABLE users (id int primary key, name text);\nCREATE TABLE orders (id int primary key, user_id int references users(id));');
  zip.file('shop/README.md', '# Shop\n\nNotes about the shop.');
  zip.file('shop/src/app.js', 'console.log("hi");');
  zip.file('shop/src/util/math.js', 'export const add = (a, b) => a + b;');
  zip.file('shop/logo.png', Buffer.from([137, 80, 78, 71]));
  zip.file('__MACOSX/shop/._README.md', 'junk');
  const buffer = await zip.generateAsync({ type: 'nodebuffer' });

  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.addInitScript(() => { localStorage.setItem('linework:local-mode', '1'); localStorage.setItem('linework:ai-open', '0'); });
  await page.goto('/');
  await page.getByRole('button', { name: 'Tools' }).click();
  await expect(page.locator('.tool-card', { hasText: 'Import a .zip' })).toBeVisible();
  await page.getByLabel('Zip file to import').setInputFiles({ name: 'shop.zip', mimeType: 'application/zip', buffer });
  const dlg = page.getByRole('dialog');
  await expect(dlg).toContainText('1 workflow, 1 sheet, 1 database schema, 1 doc and 1 code project (2 files)');
  await expect(dlg).toContainText('flows/greet.workflow.json');
  await expect(dlg).toContainText('1 other file');
  await dlg.getByRole('button', { name: 'Import' }).click();
  await expect(page.locator('.toast, [role="status"]').filter({ hasText: 'Imported 5 files from “shop.zip”' }).first()).toBeVisible();

  // Saved in this browser a moment later.
  await expect.poll(() => page.evaluate(() => Object.keys(JSON.parse(localStorage.getItem('linework:files:v2') || '{}')).length)).toBeGreaterThanOrEqual(5);
  const files = await page.evaluate(() => Object.values(JSON.parse(localStorage.getItem('linework:files:v2') || '{}')));
  const by = t => files.find(f => f.title === t);
  expect(by('Greeter').flow.nodes.map(n => n.type)).toEqual(['trigger.manual', 'text.upper']);
  expect(by('orders').view).toBe('sheet');
  expect(by('schema').diagrams[0].code).toContain('users');
  expect(by('README').doc).toContain('Notes about the shop.');
  expect(by('shop').code.files.map(f => f.path).sort()).toEqual(['src/app.js', 'src/util/math.js']);
  expect(errors).toEqual([]);
});
