import { test, expect } from '@playwright/test';

// Code blocks and dashboard blocks on the canvas: ports, wires, controls and live dashboards.
const open = async page => {
  await page.addInitScript(() => {
    if (window.top !== window) return; // not inside the dashboard frames, which have no storage
    localStorage.clear();
    localStorage.setItem('linework:local-mode', '1');
    localStorage.setItem('linework:ai-open', '0');
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Create a Blank File' }).click();
  await expect(page.locator('#svg')).toBeVisible();
};
const insert = async (page, name) => {
  await page.getByRole('button', { name: /insert/i }).first().click();
  await page.getByRole('button', { name }).first().click();
};
// The file as saved (saving is debounced, so wait for it).
const shapes = async page => {
  await page.waitForFunction(() => /"shapes"/.test(localStorage.getItem('linework:files:v2') || ''));
  await page.waitForTimeout(700);
  return page.evaluate(() => Object.values(JSON.parse(localStorage.getItem('linework:files:v2')))[0].diagrams[0].shapes || []);
};
const drag = async (page, from, to) => {
  await page.mouse.move(from.x, from.y); await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 10 }); await page.mouse.up();
};
const center = b => ({ x: b.x + b.width / 2, y: b.y + b.height / 2 });

test('code blocks: placed side by side, ports on hover, wires end exactly on the ports', async ({ page }) => {
  await open(page);
  const svg = page.locator('#svg');
  await insert(page, /^Code block/);
  await insert(page, /^Code block/);
  let list = await shapes(page);
  expect(list).toHaveLength(2);
  expect(list[1].x - list[0].x).toBeGreaterThanOrEqual(24); // not stacked exactly on top of each other
  expect(list[0].lang).toBe('javascript'); // ready to run

  // Spread them out: the second (selected) one goes right and down.
  await drag(page, { x: 760, y: 560 }, { x: 1060, y: 700 });
  await page.mouse.click(1300, 820);
  await page.mouse.move(1300, 820);
  await expect(svg.locator('.cv-port')).toHaveCount(0); // no ports until you point at a figure

  const first = await svg.locator('g[data-shape]').nth(0).boundingBox();
  await page.mouse.move(first.x + 40, first.y + 60);
  await expect(svg.locator('.cv-port')).toHaveCount(2);
  const out = center(await svg.locator('.cv-port.out').boundingBox());
  await page.mouse.move(out.x, out.y); await page.mouse.down();
  const second = await svg.locator('g[data-shape]').nth(1).boundingBox();
  await page.mouse.move(second.x + 30, second.y + second.height / 2, { steps: 12 });
  await expect(svg.locator('.cv-port')).toHaveCount(4); // every figure offers its ports while wiring
  await page.mouse.up();

  list = await shapes(page);
  const [a, b] = list.filter(s => s.t === 'code'), wire = list.find(s => s.t === 'arrow');
  expect(wire.a0).toEqual({ s: a.id, p: 'out' });
  expect(wire.a1).toEqual({ s: b.id, p: 'in' });
  // The drawn wire starts on the right-middle of the first block and ends on the left-middle of the second.
  const d = await svg.locator(`g[data-shape="${wire.id}"] path`).first().getAttribute('d');
  const nums = d.match(/-?\d+(\.\d+)?/g).map(Number);
  expect([nums[0], nums[1]]).toEqual([a.x + a.w, a.y + a.h / 2]);
  expect([nums[nums.length - 2], nums[nums.length - 1]]).toEqual([b.x, b.y + b.h / 2]);
});

test('code block controls line up with the block at any zoom, and output sits below it', async ({ page }) => {
  await open(page);
  await insert(page, /^Code block/);
  const block = await page.locator('#svg g[data-shape]').first().boundingBox();
  await page.getByRole('button', { name: /Run/ }).click();
  const output = page.locator('.cv-code-output');
  await expect(output).toContainText('(no output)');
  const o = await output.boundingBox();
  expect(o.y).toBeGreaterThanOrEqual(block.y + block.height); // never over the code

  // Zoom out: the header controls shrink with the block instead of spilling out of it.
  await page.getByRole('button', { name: 'Zoom out', exact: true }).click();
  await page.getByRole('button', { name: 'Zoom out', exact: true }).click();
  await page.waitForTimeout(500);
  const small = await page.locator('#svg g[data-shape]').first().boundingBox();
  const sel = await page.getByLabel('Select language').boundingBox();
  expect(sel.x + sel.width).toBeLessThanOrEqual(small.x + small.width);
  expect(sel.y).toBeGreaterThanOrEqual(small.y - 1);
  expect(sel.y + sel.height).toBeLessThanOrEqual(small.y + 28 * (small.width / block.width) + 1);
});

test('a dashboard block shows live widgets, fed by a wired code block', async ({ page }) => {
  await open(page);
  await insert(page, /^Dashboard block/);
  const frame = page.frameLocator('.cv-dash iframe');
  await expect(frame.locator('.lw-card').first()).toContainText('Total sales'); // the sample
  await expect(frame.locator('.lw-card b').first()).toHaveText('690');

  // Move the dashboard right by its header, then add a code block that returns rows.
  const dash = await page.locator('#svg g[data-shape]').first().boundingBox();
  await drag(page, { x: dash.x + 200, y: dash.y + 12 }, { x: dash.x + 560, y: dash.y + 12 });
  await insert(page, /^Code block/);
  await drag(page, { x: 720, y: 450 }, { x: 420, y: 450 });
  const code = (await shapes(page)).find(s => s.t === 'code');
  const box = await page.locator(`#svg g[data-shape="${code.id}"]`).boundingBox();
  await page.mouse.dblclick(box.x + 60, box.y + 80);
  await page.keyboard.press('Control+a');
  await page.keyboard.type("return [{ month: 'May', sales: 90 }, { month: 'Jun', sales: 300 }];");
  await page.keyboard.press('Escape');

  // Wire the code block's output into the dashboard.
  await page.mouse.move(box.x + 60, box.y + 80);
  const out = center(await page.locator(`#svg .cv-port.out[data-connector-id="${code.id}"]`).boundingBox());
  const d2 = await page.locator('#svg g[data-shape]').first().boundingBox();
  await drag(page, out, { x: d2.x + 40, y: d2.y + d2.height / 2 });
  await expect(frame.locator('.lw-card b').first()).toHaveText('390');
  await expect(frame.locator('.lw-chart text', { hasText: 'Jun' })).toHaveCount(1);

  // The dashboard's own controls: its data source shows the wired block, and Edit HTML opens its code.
  await page.mouse.click(d2.x + 200, d2.y + 12);
  await expect(page.getByLabel('Dashboard data')).toHaveValue('code');
  await page.getByRole('button', { name: 'Edit HTML' }).click();
  await expect(page.getByLabel('Edit text')).toHaveValue(/bars\('#chart'/);
});
