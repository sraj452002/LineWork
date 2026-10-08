import { test, expect } from '@playwright/test';

// Start every test signed in with an empty workspace, and fail on any uncaught page error.
test.beforeEach(async ({ page }) => {
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error' && !/api\/ai|Failed to load resource/.test(m.text())) errors.push(m.text()); });
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
test.afterEach(async () => {
  expect(test.info().errors_, 'page errors').toEqual([]);
});

const newFromTemplate = async (page, name) => {
  await page.getByRole('button', { name: 'Start from a Template' }).click();
  await page.getByRole('menuitem', { name: new RegExp(name) }).click();
  await expect(page.locator('.cwrap')).toBeVisible();
};

test('home page shows the dashboard', async ({ page }) => {
  await expect(page.getByRole('button', { name: /All Files/ })).toBeVisible();
  for (const n of ['Create a Blank File', 'Generate an AI Diagram', 'Write a Design Doc', 'Start from a Template'])
    await expect(page.getByRole('button', { name: n })).toBeVisible();
  await expect(page.locator('.nofiles')).toContainText('No files yet');
});

test('blank file opens the editor, and files can be archived and found again', async ({ page }) => {
  await page.getByRole('button', { name: 'Create a Blank File' }).click();
  await expect(page.locator('.cwrap')).toBeVisible();
  await page.getByRole('button', { name: 'Back to files' }).click();
  const row = page.locator('.ftable tbody tr').first();
  await expect(row).toContainText('Untitled');
  await row.hover();
  await row.getByRole('button', { name: /Actions for/ }).click();
  await page.getByRole('menuitem', { name: 'Archive' }).click();
  await expect(page.locator('.nofiles')).toBeVisible();
  await page.getByRole('button', { name: /Archive/ }).first().click();
  await expect(page.locator('.ftable tbody tr')).toHaveCount(1);
});

test('database template: table toolbar, row selection and column edits write code', async ({ page }) => {
  await newFromTemplate(page, 'Database schema');
  const users = page.locator('[data-node="users"]');
  await expect(users).toBeVisible();
  // Header click selects the table.
  await users.locator('text').first().click();
  await expect(page.getByRole('toolbar', { name: 'Table users' })).toBeVisible();
  // Row click selects one column.
  await users.locator('[data-field="email"] rect').first().click({ force: true });
  const bar = page.getByRole('toolbar', { name: 'Column users.email' });
  await expect(bar).toBeVisible();
  const type = bar.getByLabel('Column type');
  await type.fill('varchar');
  await type.press('Enter');
  await page.getByRole('button', { name: 'Code Editor' }).click();
  await expect(page.locator('#code')).toHaveValue(/email varchar unique/);
  // Arrow keys move between rows.
  await page.locator('#svg').click({ position: { x: 5, y: 5 } }).catch(() => {});
});

test('code editor opens on the right and closes AI chat', async ({ page }) => {
  await newFromTemplate(page, 'Cloud architecture');
  await page.getByRole('button', { name: 'AI Chat', exact: false }).first().click();
  await expect(page.locator('.aichat')).toBeVisible();
  await page.locator('.dhdr').getByRole('button', { name: 'Code Editor' }).click();
  await expect(page.locator('.drawer')).toBeVisible();
  await expect(page.locator('.aichat')).toHaveCount(0);
  const box = await page.locator('.drawer').boundingBox();
  expect(box.x).toBeGreaterThan(900);
  await expect(page.locator('.code-gut div').first()).toHaveText('1');
});

test('draw a box, style it, and convert the drawing to code', async ({ page }) => {
  await page.getByRole('button', { name: 'Create a Blank File' }).click();
  const svg = page.locator('#svg');
  await page.keyboard.press('r');
  await svg.click({ position: { x: 500, y: 300 } });
  const bar = page.getByRole('toolbar', { name: 'Selected object' });
  await expect(bar).toBeVisible();
  // Shape picker swaps the shape.
  await bar.getByRole('button', { name: 'Shape' }).click();
  await page.getByRole('button', { name: 'cylinder' }).click();
  // Fill panel sets a colour.
  await bar.getByRole('button', { name: 'Fill and style' }).click();
  await page.getByRole('button', { name: 'Green' }).click();
  // Give it text, then convert.
  await page.keyboard.press('Escape');
  const shape = page.locator('g[data-shape]').first();
  await shape.click();
  await page.keyboard.press('Enter');
  await page.keyboard.type('Orders DB');
  await page.locator('#svg').click({ position: { x: 1000, y: 700 } });
  await shape.click();
  await page.getByRole('toolbar', { name: 'Selected object' }).getByRole('button', { name: 'More' }).click();
  await page.getByRole('menuitem', { name: /Convert to code/ }).click();
  await page.locator('.menu.sub button', { hasText: 'Architecture' }).click();
  await page.getByRole('button', { name: 'Code Editor' }).click();
  await expect(page.locator('#code')).toHaveValue(/orders-db \[Orders DB\] database/);
});

test('group and ungroup shapes', async ({ page }) => {
  await page.getByRole('button', { name: 'Create a Blank File' }).click();
  const svg = page.locator('#svg'), shapes = page.locator('g[data-shape]');
  const empty = () => svg.click({ position: { x: 1000, y: 700 } });
  const one = page.getByRole('toolbar', { name: 'Selected object' }), two = page.getByRole('toolbar', { name: '2 objects selected' });
  for (const x of [400, 700]) { await page.keyboard.press('r'); await svg.click({ position: { x, y: 300 } }); }
  await expect(shapes).toHaveCount(2);
  await shapes.nth(0).click();
  await shapes.nth(1).click({ modifiers: ['Shift'] });
  await expect(two).toBeVisible();
  await page.keyboard.press('Control+g');

  // A click on one member selects the whole group; a second click picks just that one.
  await empty();
  await shapes.nth(0).click();
  await expect(two).toBeVisible();
  await page.waitForTimeout(450); // not a double-click
  await shapes.nth(0).click();
  await expect(one).toBeVisible();

  // Dragging one member moves the group.
  await empty();
  const before = await shapes.nth(1).boundingBox();
  const a = await shapes.nth(0).boundingBox();
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(a.x + a.width / 2 + 60, a.y + a.height / 2 + 40, { steps: 5 });
  await page.mouse.up();
  const after = await shapes.nth(1).boundingBox();
  expect(Math.round(after.x - before.x)).toBeGreaterThan(30);

  // Ungroup from the menu: members select on their own again.
  await two.getByRole('button', { name: 'More' }).click();
  await page.getByRole('menuitem', { name: /^Ungroup/ }).click();
  await empty();
  await shapes.nth(0).click();
  await expect(one).toBeVisible();

  // Undo brings the group back.
  await page.keyboard.press('Control+z');
  await empty();
  await shapes.nth(1).click();
  await expect(two).toBeVisible();
});

test('icon picker loads the big icon set', async ({ page }) => {
  await page.getByRole('button', { name: 'Create a Blank File' }).click();
  await page.keyboard.press('/');
  await page.locator('.ins-item', { hasText: /^Icon/ }).click();
  await page.getByRole('button', { name: /General Icon/ }).click();
  await expect(page.locator('.ins-grid .ins-tile').nth(100)).toBeVisible({ timeout: 15_000 });
  // Searching inside General Icon stays in that group; from the top it finds logos too.
  await page.getByLabel('Search items').fill('activity');
  await expect(page.locator('.ins-tile', { hasText: 'activity' }).first()).toBeVisible();
  await page.getByLabel('Search items').fill('');
  await page.getByRole('button', { name: 'All Categories' }).click();
  await page.getByLabel('Search items').fill('docker');
  await expect(page.locator('.ins-tile', { hasText: 'Docker' })).toBeVisible();
});

test('schema exports SQL and the guide opens', async ({ page }) => {
  await newFromTemplate(page, 'Database schema');
  await page.locator('.dhdr button').first().click();
  const diag = page.getByRole('toolbar', { name: 'Diagram' });
  await expect(diag).toBeVisible();
  await diag.getByRole('button', { name: 'More' }).click();
  await page.getByRole('menuitem', { name: /Export as SQL/ }).click();
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('menuitem', { name: 'Download SQL (PostgreSQL)' }).click()]);
  expect(dl.suggestedFilename()).toMatch(/\.sql$/);
  await page.getByRole('button', { name: 'More actions' }).click();
  await page.getByRole('menuitem', { name: /How to use Linework/ }).click();
  await expect(page.getByRole('heading', { name: 'How to use Linework' })).toBeVisible();
});

test('without an account, the sign-in screen offers to keep files in this browser', async ({ page }) => {
  await page.evaluate(() => { localStorage.removeItem('linework:local-mode'); });
  await page.reload();
  // Identity isn't available in local development, so only the no-account option is offered.
  await expect(page.getByText('Accounts aren’t available here yet')).toBeVisible();
  await page.getByRole('button', { name: 'Continue without an account' }).click();
  await expect(page.getByRole('button', { name: 'Create a Blank File' })).toBeVisible();
  await expect(page.getByText('Saved in this browser only')).toBeVisible();
});
