import { test, expect } from '@playwright/test';

// Workflow view: a string (connection) can be bent by dragging the handle in its middle, so it goes around
// nodes and other strings; double-clicking the handle straightens it again. The bend is saved with the file.

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    if (window.top !== window || sessionStorage.getItem('seeded')) return;
    localStorage.clear();
    localStorage.setItem('linework:local-mode', '1');
    localStorage.setItem('linework:ai-open', '0');
    sessionStorage.setItem('seeded', '1');
  });
  await page.setViewportSize({ width: 1500, height: 900 });
  await page.goto('/');
});

test('a string bends by its handle, stays bent, and straightens on double-click', async ({ page }) => {
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.getByRole('navigation', { name: 'Files' }).getByRole('button', { name: /^Templates/ }).click();
  await page.getByRole('button', { name: 'Use the template StarPlay 2: OTT app made only of nodes', exact: true }).click();
  await expect(page.locator('.fv-node').first()).toBeVisible();

  const edge = page.locator('.fv-edge').first();
  const line = edge.locator('path.line');
  const before = await line.getAttribute('d');
  const handle = edge.locator('circle.fv-bend');
  const box = await handle.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 10, box.y + 60, { steps: 6 });
  await page.mouse.move(box.x + box.width / 2 + 20, box.y + 120, { steps: 6 });
  await page.mouse.up();
  // Bent: through the dragged point, as two curves, and its handle marked bent.
  const bent = await line.getAttribute('d');
  expect(bent).not.toBe(before);
  expect(bent.match(/C/g)).toHaveLength(2);
  await expect(handle).toHaveClass(/bent/);
  const moved = await handle.boundingBox();
  expect(moved.y - box.y).toBeGreaterThan(80);
  await expect(edge).toHaveClass(/\bon\b/); // the string is picked

  // Saved with the file: open it again.
  await expect(page.getByText('Saved', { exact: true }).first()).toBeVisible();
  await page.getByRole('button', { name: /^(Back to files|Files)$/ }).first().click();
  await page.locator('.ftable tbody tr', { hasText: 'StarPlay 2' }).first().click();
  await expect(page.locator('.fv-edge').first().locator('path.line')).toHaveAttribute('d', bent);

  // Double-click straightens it.
  await page.locator('.fv-edge').first().locator('circle.fv-bend').dblclick();
  await expect(page.locator('.fv-edge').first().locator('path.line')).toHaveAttribute('d', before);
  await expect(page.locator('.fv-edge').first().locator('circle.fv-bend')).not.toHaveClass(/bent/);
  expect(errors).toEqual([]);
});
