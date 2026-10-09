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

const viewIs = (page, v) => expect(page.getByRole('button', { name: 'View: ' + v })).toBeVisible();
const tool = (page, name) => page.locator('.tool-card').filter({ has: page.locator('b', { hasText: new RegExp('^' + name + '$') }) });

test('the Tools page lists every tool, and search narrows it', async ({ page }) => {
  await expect(page.getByRole('button', { name: 'Create a Blank File' })).toBeVisible();
  await page.keyboard.press('t');
  await expect(page.getByRole('navigation', { name: 'Files' }).getByRole('button', { name: /^Tools/ })).toHaveAttribute('aria-current', 'page');
  for (const g of ['Diagrams', 'Databases', 'Docs & spreadsheets', 'Code']) await expect(page.getByRole('heading', { name: g })).toBeVisible();
  await expect(page.locator('.tool-card')).toHaveCount(17);
  // Each card says where it opens.
  await expect(page.locator('.tool-card').filter({ hasText: 'Open a .sql file' }).locator('.tool-view')).toHaveText('Canvas');
  // A category chip shows just that category.
  const cats = page.getByRole('group', { name: 'Categories' });
  await cats.getByRole('button', { name: /^Databases/ }).click();
  await expect(page.locator('.tool-card')).toHaveCount(3);
  await expect(page.getByRole('heading', { name: 'Code' })).toHaveCount(0);
  await cats.getByRole('button', { name: /^All/ }).click();
  await expect(page.locator('.tool-card')).toHaveCount(17);
  await page.getByRole('searchbox', { name: 'Search tools' }).fill('python');
  await expect(page.locator('.tool-card')).toHaveCount(1);
  await page.getByRole('searchbox', { name: 'Search tools' }).fill('zzz');
  await expect(page.getByText('No tools match “zzz”.')).toBeVisible();
});

test('tools open new files in the right view', async ({ page }) => {
  await page.getByRole('navigation', { name: 'Files' }).getByRole('button', { name: /^Tools/ }).click();

  // Spreadsheet → the Sheet view.
  await tool(page, 'Spreadsheet').click();
  await viewIs(page, 'Sheet');
  // The View menu lists every view, in groups, with the current one ticked.
  await page.getByRole('button', { name: 'View: Sheet' }).click();
  const menu = page.getByRole('menu');
  for (const h of ['Draw', 'Write', 'Data', 'Build']) await expect(menu.getByText(h, { exact: true })).toBeVisible();
  await expect(menu.getByRole('menuitemradio', { name: /^Sheet/ })).toHaveAttribute('aria-checked', 'true');
  await menu.getByRole('menuitemradio', { name: /^Doc \+ Canvas/ }).click();
  await viewIs(page, 'Doc + Canvas');
  await page.getByRole('button', { name: /^View:/ }).click();
  await page.getByRole('menuitemradio', { name: /^Sheet/ }).click();
  await viewIs(page, 'Sheet');
  await expect(page.getByRole('tab', { name: 'Sheet 1' })).toBeVisible();
  await page.getByRole('button', { name: 'Back to files' }).click();

  // Schema from SQL → an ERD of the tables.
  await page.getByRole('navigation', { name: 'Files' }).getByRole('button', { name: /^Tools/ }).click();
  await tool(page, 'Schema from SQL').click();
  await page.getByRole('textbox').last().fill('CREATE TABLE users (id int primary key, email text);\nCREATE TABLE posts (id int primary key, user_id int references users(id));');
  await page.getByRole('button', { name: 'Draw it' }).click();
  await viewIs(page, 'Canvas');
  await expect(page.locator('.canvaspane svg').first()).toContainText('posts');
  await page.getByRole('button', { name: 'Back to files' }).click();

  // Code visualizer → the Code view, with the sample open and the Visualize pane showing.
  await page.getByRole('navigation', { name: 'Files' }).getByRole('button', { name: /^Tools/ }).click();
  await tool(page, 'Code visualizer').click();
  await viewIs(page, 'Code');
  await expect(page.locator('.cw-tab.on')).toContainText('index.ts', { timeout: 20_000 });
  await expect(page.getByRole('complementary', { name: 'Visualize' })).toBeVisible();
  await page.getByRole('button', { name: 'Back to files' }).click();

  // The new files are in the list.
  await expect(page.locator('.ftable tbody tr')).toHaveCount(3);
});
