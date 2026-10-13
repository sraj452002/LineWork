import { test, expect } from '@playwright/test';
import { openStore } from '../backend/store.js';
import { memoryBackend } from '../backend/drive.js';
import { createApp } from '../backend/app.js';

// App view → Visual: an app built by placing components, filled by a workflow, with pages, sign-in for
// the people who use it, and a phone layout.

test('build an app visually, publish it behind sign-in, and use it on a phone', async ({ browser }) => {
  test.setTimeout(240_000);
  const { spawn } = await import('node:child_process');
  const srv = createApp(await openStore(memoryBackend()), { requireVerified: false }).listen(0);
  const port = 5187;
  const vite = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--port', String(port), '--strictPort'], { cwd: 'frontend', env: { ...process.env, LINEWORK_API: `http://localhost:${srv.address().port}` }, stdio: 'ignore', detached: true });
  try {
    const url = `http://localhost:${port}`;
    for (let i = 0; i < 60; i++) { try { if ((await fetch(url)).ok) break; } catch (e) {} await new Promise(r => setTimeout(r, 500)); }
    const ctx = await browser.newContext({ baseURL: url, viewport: { width: 1500, height: 950 } });
    await ctx.addInitScript(() => { if (window.top === window) localStorage.setItem('linework:ai-open', '0'); });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto('/');
    await page.getByRole('button', { name: 'Create an account' }).click();
    await page.getByLabel('Email').fill('maker@example.com');
    await page.getByLabel('Password').fill('a long password');
    await page.getByRole('button', { name: 'Create account' }).click();

    // A workflow with some orders, which says who asked.
    const code = `const who = items[0] && items[0].user ? items[0].user.email : 'nobody';
return [
  { id: 1, customer: 'Ada', total: 120, who },
  { id: 2, customer: 'Grace', total: 80, who },
];`;
    const put = await page.request.put('/api/files/f_orders', { data: { id: 'f_orders', title: 'Orders', diagrams: [{ id: 'd1', type: 'architecture', name: 'Diagram 1', code: '', manual: {}, dir: 'LR', style: 'color' }], active: 0, doc: '', updated: Date.now(), view: 'app', flow: { active: false, nodes: [
      { id: 't', type: 'trigger.manual', name: 'Run by hand', x: 80, y: 160, params: {} },
      { id: 'c', type: 'core.code', name: 'Orders', x: 340, y: 160, params: { language: 'javascript', code } },
    ], edges: [{ id: 'e', from: 't', fromPort: 'main', to: 'c', toPort: 'main' }] } } });
    expect(put.ok()).toBe(true);
    // The file list loads from the server; reload until the new file is in it.
    const row = page.locator('.ftable tbody tr', { hasText: 'Orders' });
    for (let i = 0; i < 6 && !(await row.count()); i++) { await page.reload(); await row.waitFor({ timeout: 8000 }).catch(() => {}); }
    await row.click();

    // A new app starts in Visual, with a table filled from this file's workflow.
    await expect(page.getByRole('button', { name: 'Visual' }), errors.join('\n')).toHaveAttribute('aria-pressed', 'true', { timeout: 15_000 });
    const canvas = page.frameLocator('iframe[title="App canvas"]');
    await expect(canvas.locator('.wl-tbl')).toContainText('Grace');
    await expect(canvas.locator('.wl-stat b')).toHaveText('2');

    // Add an input and a text that greets whoever is typed in.
    await page.getByRole('button', { name: 'Add Input' }).click();
    const props = page.getByRole('complementary', { name: 'Properties' });
    await expect(props.getByLabel('Component name')).toHaveValue('input1');
    await props.getByLabel('Label').fill('Your name');
    await page.getByRole('button', { name: 'Add Text' }).click();
    await props.getByLabel('Text').fill('Hello **{{ vars.input1 || "stranger" }}**, {{ data.items.length }} orders');
    await expect(canvas.locator('.wl-t').last()).toHaveText('Hello stranger, 2 orders');

    // Make it half as wide, then drag it two columns right.
    await props.getByLabel('Width').fill('6');
    const box = page.getByRole('button', { name: 'Text text2' });
    const b = await box.boundingBox();
    await page.mouse.move(b.x + 20, b.y + 10);
    await page.mouse.down();
    await page.mouse.move(b.x + 20 + b.width / 6 * 2 + 4, b.y + 10, { steps: 6 });
    await page.mouse.up();
    await expect(props.getByLabel('Column')).toHaveValue('2');

    // A details page, opened by clicking a row.
    await page.getByRole('button', { name: 'Add a page' }).click();
    await page.getByRole('button', { name: 'Add Heading' }).click();
    await props.getByLabel('Text').fill('Order {{ vars.table1.id }} for {{ vars.table1.customer }}');
    await page.getByRole('tab', { name: 'Home' }).click();
    await page.getByRole('button', { name: /^Table table1/ }).click();
    await props.getByRole('button', { name: '+ Add a step' }).click();
    await props.getByLabel('Step', { exact: true }).selectOption('go');
    await props.getByLabel('Page', { exact: true }).selectOption({ label: 'Page 2' });

    // Preview: type, click a row, land on the details page.
    await page.getByRole('button', { name: '▶ Preview' }).click();
    const app = page.frameLocator('iframe[title="App preview"]');
    await app.getByLabel('Your name').fill('Sam');
    await expect(app.locator('.wl-t').last()).toHaveText('Hello Sam, 2 orders');
    await app.locator('.wl-tbl td', { hasText: 'Grace' }).click();
    await expect(app.locator('h1.wl-h')).toHaveText('Order 2 for Grace');
    await expect(app.locator('.wl-nav a.on')).toHaveText('Page 2');
    await page.getByRole('button', { name: '✎ Edit' }).click();

    // Only people who sign in; then publish.
    await page.getByRole('tab', { name: 'App' }).click();
    await page.getByLabel('People who sign in (anyone can make an account)').check();
    await expect(page.getByText('No accounts yet')).toBeVisible();
    await page.getByText('Publish', { exact: true }).click();
    const link = await page.getByLabel('App link').inputValue();
    await expect(page.getByText('Saved')).toBeVisible();

    // Someone opens the link on a phone: a sign-in screen, then the app, made for them.
    const phone = await browser.newContext({ viewport: { width: 390, height: 800 } });
    const p = await phone.newPage();
    await p.goto(link);
    await expect(p.getByRole('heading', { name: 'Orders' })).toBeVisible();
    await p.getByRole('button', { name: 'Create account' }).first().click();
    await p.getByLabel('Your name').fill('Pat');
    await p.getByLabel('Email').fill('pat@example.com');
    await p.getByLabel('Password').fill('a long password');
    await p.locator('form').getByRole('button', { name: 'Create account' }).last().click();
    await expect(p.locator('.wl-tbl')).toContainText('pat@example.com');
    await expect(p.locator('.wl-nav .who')).toHaveText('Pat');
    await expect(p.locator('.wl-page')).toHaveClass(/stack/);
    // Still signed in after a reload; signed out after Sign out.
    await p.reload();
    await expect(p.locator('.wl-tbl')).toContainText('Ada');
    await p.getByText('Sign out').click();
    await expect(p.getByRole('button', { name: 'Sign in' }).last()).toBeVisible();
    await phone.close();

    // The owner sees who has an account.
    await expect(page.getByRole('list', { name: 'People with an account' })).toBeHidden();
    await page.getByRole('tab', { name: 'Data' }).click();
    await page.getByRole('tab', { name: 'App' }).click();
    await expect(page.getByRole('list', { name: 'People with an account' })).toContainText('pat@example.com');
    expect(errors).toEqual([]);
    await ctx.close();
  } finally {
    try { process.kill(-vite.pid); } catch (e) {}
    srv.close();
  }
});
