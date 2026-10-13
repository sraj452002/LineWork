import { test, expect } from '@playwright/test';

// App view → Visual: every component in the palette can be added, draws without errors, and the
// interactive ones keep what people pick in vars.

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    if (window.top !== window || sessionStorage.getItem('seeded')) return;
    localStorage.clear();
    localStorage.setItem('linework:local-mode', '1');
    localStorage.setItem('linework:ai-open', '0');
    sessionStorage.setItem('seeded', '1');
  });
  await page.setViewportSize({ width: 1500, height: 950 });
  await page.goto('/');
});

test('every component can be added and drawn, and the inputs hold what is picked', async ({ page }) => {
  test.setTimeout(240_000);
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.getByRole('button', { name: 'Create a Blank File' }).click();
  await page.getByRole('button', { name: /^View:/ }).click();
  await page.getByRole('menuitemradio', { name: /^App/ }).click();
  await expect(page.getByRole('button', { name: 'Visual' })).toHaveAttribute('aria-pressed', 'true');

  // The palette: grouped, and searchable.
  const palette = page.getByLabel('Components', { exact: true });
  for (const g of ['Basics', 'Inputs', 'Data', 'Status', 'Media', 'Layout', 'AI']) await expect(palette.getByText(g, { exact: true })).toBeVisible();
  await page.getByLabel('Find a component').fill('kanban');
  await expect(palette.locator('.vb-tile')).toHaveCount(1);
  await page.getByLabel('Find a component').fill('');
  const tiles = await palette.locator('.vb-tile').allTextContents();
  expect(tiles.length).toBeGreaterThanOrEqual(45);

  // Add every one.
  for (const name of tiles) await palette.getByRole('button', { name: `Add ${name}`, exact: true }).click();
  const canvas = page.frameLocator('iframe[title="App canvas"]');
  await expect(canvas.locator('.wl-c')).toHaveCount(tiles.length + 2); // + the new app's heading and text
  await expect(canvas.locator('.lw-error')).toHaveCount(0);

  // A text that shows what the inputs hold.
  await page.getByRole('button', { name: 'Add Text', exact: true }).click();
  const props = page.getByRole('complementary', { name: 'Properties' });
  await props.getByLabel('Text', { exact: true }).fill('switch={{ vars.switch1 }} stars={{ vars.rating1 }} tags={{ (vars.multiselect1 || []).join("+") }} size={{ vars.radio1 }} tab={{ vars.tabs1 }}');

  // Use them in the preview.
  await page.getByRole('button', { name: '▶ Preview' }).click();
  const app = page.frameLocator('iframe[title="App preview"]');
  const out = app.locator('.wl-t', { hasText: 'switch=' });
  await expect(out).toHaveText('switch=true stars=0 tags= size=Medium tab=');
  await app.getByText('Notifications').click();
  await app.getByRole('button', { name: '4 stars' }).click();
  await app.getByRole('button', { name: 'Support' }).click();
  await app.getByRole('button', { name: 'Design' }).click();
  await app.getByLabel('Large').check();
  await app.getByRole('tab', { name: 'Details' }).click();
  await expect(out).toHaveText('switch=false stars=4 tags=Support+Design size=Large tab=Details');
  await expect(app.getByRole('tabpanel')).toHaveText('More to read.');

  // Some of the others, drawn.
  await expect(app.locator('.wl-stepper li')).toHaveCount(4);
  await expect(app.locator('.wl-stepper li.done')).toHaveCount(2);
  await expect(app.locator('.wl-bar')).toHaveAttribute('aria-valuenow', '65');
  await expect(app.locator('.wl-acc')).toHaveCount(3);
  await expect(app.locator('.wl-cal-d:not(.off)').first()).toBeVisible();
  await app.getByRole('button', { name: 'Next month' }).click();
  await expect(app.locator('.wl-badge')).toHaveText('New');
  await expect(app.locator('.wl-alert')).toContainText('Heads up');
  await expect(app.locator('.wl-tl li')).toHaveCount(2);
  await expect(app.locator('iframe.wl-embed').first()).toHaveAttribute('src', /youtube\.com\/embed\/aqz-KE-bpKQ/);
  await expect(app.locator('iframe.wl-embed').nth(1)).toHaveAttribute('src', /openstreetmap\.org/);
  await expect(app.locator('.wl-chat .wl-msg')).toHaveText('Hi! How can I help?');
  await expect(app.locator('.lw-error')).toHaveCount(0);
  expect(errors).toEqual([]);
});
