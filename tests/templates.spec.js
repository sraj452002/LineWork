import { test, expect } from '@playwright/test';

// Home → Templates → Ready-made: a template for every tool, each opening a new file in its view.

test.beforeEach(async ({ page }) => {
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  test.info().errors_ = errors;
  await page.addInitScript(() => {
    if (window.top !== window || sessionStorage.getItem('seeded')) return;
    localStorage.clear();
    localStorage.setItem('linework:local-mode', '1');
    localStorage.setItem('linework:ai-open', '0');
    sessionStorage.setItem('seeded', '1');
  });
  await page.goto('/');
});
test.afterEach(async () => { expect(test.info().errors_, 'page errors').toEqual([]); });

const openTemplates = async page => {
  await page.getByRole('navigation', { name: 'Files' }).getByRole('button', { name: /^Templates/ }).click();
  return page.getByRole('region', { name: 'Ready-made' });
};

test('Ready-made has templates for every tool, filtered by tool and by search', async ({ page }) => {
  const ready = await openTemplates(page);
  const chips = ready.getByRole('group', { name: 'Show templates for' });
  for (const t of ['All', 'Diagrams', 'Docs', 'Sheets', 'Databases', 'Code', 'Workflows', 'Apps', 'Pages']) await expect(chips.getByRole('button', { name: new RegExp(`^${t} \\d+$`) })).toBeVisible();
  const all = await ready.locator('.tpl-starter').count();
  expect(all).toBeGreaterThanOrEqual(30);
  await chips.getByRole('button', { name: /^Sheets/ }).click();
  await expect(chips.getByRole('button', { name: /^Sheets/ })).toHaveAttribute('aria-pressed', 'true');
  await expect(ready.locator('.tpl-starter')).toHaveCount(4);
  await expect(ready.locator('.tpl-starter .tpl-kind').first()).toHaveText('Sheet');
  await chips.getByRole('button', { name: /^All/ }).click();
  await expect(ready.locator('.tpl-starter')).toHaveCount(all);
  // The home search box narrows them too; the saved ones (none yet) stay below.
  await page.getByRole('searchbox').fill('habit');
  await expect(ready.locator('.tpl-starter')).toHaveCount(1);
  await expect(page.getByText('No templates yet')).toBeVisible();
});

test('every ready-made template opens in its view', async ({ page }) => {
  test.setTimeout(240_000);
  let ready = await openTemplates(page);
  const names = await ready.locator('.tpl-starter b').allTextContents();
  const kinds = await ready.locator('.tpl-starter .tpl-kind').allTextContents();
  const VIEW = { Diagram: 'Canvas', Doc: 'Doc', Sheet: 'Sheet', 'Database schema': 'Canvas', Code: 'Code', Workflow: 'Workflow', 'Workflow + app': 'App', 'Page from nodes': 'Workflow' };
  for (const [i, name] of names.entries()) {
    await ready.getByRole('button', { name: `Use the template ${name}`, exact: true }).click();
    await expect(page.getByRole('button', { name: 'View: ' + VIEW[kinds[i]] }), name).toBeVisible();
    if (kinds[i] === 'Workflow' || kinds[i] === 'Page from nodes') await expect(page.locator('.fv-node').first(), name).toBeVisible();
    await page.getByRole('button', { name: /^(Back to files|Files)$/ }).first().click();
    ready = await openTemplates(page);
  }
});

test('templates open with their content', async ({ page }) => {
  // A diagram, drawn.
  let ready = await openTemplates(page);
  await ready.getByRole('button', { name: 'Use the template Microservices architecture' }).click();
  await expect(page.locator('svg text', { hasText: 'Orders service' }).first()).toBeVisible();
  await page.getByRole('button', { name: /^(Back to files|Files)$/ }).first().click();
  // A database schema with its tables.
  ready = await openTemplates(page);
  await ready.getByRole('button', { name: 'Use the template Online shop schema' }).click();
  await expect(page.locator('svg text', { hasText: 'order_items' }).first()).toBeVisible();
  await page.getByRole('button', { name: /^(Back to files|Files)$/ }).first().click();
  // A sheet whose formulas work out.
  ready = await openTemplates(page);
  await ready.getByRole('button', { name: 'Use the template Invoice' }).click();
  await expect(page.locator('[data-a="D12"]')).toHaveText(/3,?370/); // 10 × 85 + 24 × 95 + 240
  await page.getByRole('button', { name: /^(Back to files|Files)$/ }).first().click();
  // A workflow, wired: the triage switch sends three ways.
  ready = await openTemplates(page);
  await ready.getByRole('button', { name: 'Use the template Support ticket triage' }).click();
  await expect(page.locator('.fv-node')).toHaveCount(7);
  await expect(page.locator('.fv-edge')).toHaveCount(6);
  await page.getByRole('button', { name: /^(Back to files|Files)$/ }).first().click();
  // A doc.
  ready = await openTemplates(page);
  await ready.getByRole('button', { name: 'Use the template Incident postmortem' }).click();
  await expect(page.getByRole('heading', { name: 'Root cause' })).toBeVisible();
});
