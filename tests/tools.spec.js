import { test, expect } from '@playwright/test';

// Home → Tools: every tool in one place, each opening a new file in that tool.

test.beforeEach(async ({ page }) => {
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  test.info().errors_ = errors;
  await page.addInitScript(() => {
    if (sessionStorage.getItem('seeded')) return;
    localStorage.clear();
    localStorage.setItem('linework:local-mode', '1');
    localStorage.setItem('linework:ai-open', '0');
    sessionStorage.setItem('seeded', '1');
  });
  await page.goto('/');
});
test.afterEach(async () => { expect(test.info().errors_, 'page errors').toEqual([]); });

const view = page => page.getByRole('group', { name: 'View' });
const tool = (page, name) => page.locator('.tool-card').filter({ has: page.locator('b', { hasText: new RegExp('^' + name + '$') }) });

test('the Tools page lists every tool, and search narrows it', async ({ page }) => {
  await expect(page.getByRole('button', { name: 'Create a Blank File' })).toBeVisible();
  await page.keyboard.press('t');
  await expect(page.getByRole('navigation', { name: 'Files' }).getByRole('button', { name: /^Tools/ })).toHaveAttribute('aria-current', 'page');
  for (const g of ['Diagrams', 'Docs & data', 'Code']) await expect(page.getByRole('heading', { name: g })).toBeVisible();
  await expect(page.locator('.tool-card')).toHaveCount(16);
  await page.getByRole('searchbox', { name: 'Search tools' }).fill('python');
  await expect(page.locator('.tool-card')).toHaveCount(1);
  await page.getByRole('searchbox', { name: 'Search tools' }).fill('zzz');
  await expect(page.getByText('No tools match “zzz”.')).toBeVisible();
});

test('tools open new files in the right view', async ({ page }) => {
  await page.getByRole('navigation', { name: 'Files' }).getByRole('button', { name: /^Tools/ }).click();

  // Spreadsheet → the Sheet view.
  await tool(page, 'Spreadsheet').click();
  await expect(view(page).getByRole('button', { name: 'Sheet' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('tab', { name: 'Sheet 1' })).toBeVisible();
  await page.getByRole('button', { name: 'Back to files' }).click();

  // Schema from SQL → an ERD of the tables.
  await page.getByRole('navigation', { name: 'Files' }).getByRole('button', { name: /^Tools/ }).click();
  await tool(page, 'Schema from SQL').click();
  await page.getByRole('textbox').last().fill('CREATE TABLE users (id int primary key, email text);\nCREATE TABLE posts (id int primary key, user_id int references users(id));');
  await page.getByRole('button', { name: 'Draw it' }).click();
  await expect(view(page).getByRole('button', { name: 'Canvas' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.canvaspane svg').first()).toContainText('posts');
  await page.getByRole('button', { name: 'Back to files' }).click();

  // Code visualizer → the Code view, with the sample open and the Visualize pane showing.
  await page.getByRole('navigation', { name: 'Files' }).getByRole('button', { name: /^Tools/ }).click();
  await tool(page, 'Code visualizer').click();
  await expect(view(page).getByRole('button', { name: 'Code' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.cw-tab.on')).toContainText('index.ts', { timeout: 20_000 });
  await expect(page.getByRole('complementary', { name: 'Visualize' })).toBeVisible();
  await page.getByRole('button', { name: 'Back to files' }).click();

  // The new files are in the list.
  await expect(page.locator('.ftable tbody tr')).toHaveCount(3);
});
