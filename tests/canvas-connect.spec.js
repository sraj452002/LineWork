import { test, expect } from '@playwright/test';

test('canvas figures connect by dragging an output port to an input port', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.clear();
    localStorage.setItem('linework:local-mode', '1');
    localStorage.setItem('linework:ai-open', '0');
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Create a Blank File' }).click();
  const svg = page.locator('#svg');
  await expect(svg).toBeVisible();

  for (const x of [320, 760]) {
    await page.keyboard.press('r');
    await svg.click({ position: { x, y: 320 } });
  }

  const output = svg.locator('.cv-port.out').nth(0);
  const input = svg.locator('.cv-port.in').nth(1);
  await expect(output).toBeVisible();
  await expect(input).toBeVisible();
  const a = await output.boundingBox();
  const b = await input.boundingBox();
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 12 });
  await page.mouse.up();

  await expect(svg.locator('g[data-shape]')).toHaveCount(3);
});
