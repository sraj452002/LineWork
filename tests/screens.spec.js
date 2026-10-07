import { test } from '@playwright/test';
import { USERNAME } from '../src/lib/auth.js';

// Screenshots of the main screens for a visual check. Run with: npx playwright test screens --workers=1
// They're written to test-results/screens (not committed).
test.skip(!process.env.SCREENS, 'set SCREENS=1 to take screenshots');

test('screens', async ({ page }) => {
  await page.addInitScript(user => {
    if (sessionStorage.getItem('seeded')) return;
    localStorage.clear();
    localStorage.setItem('linework:session', JSON.stringify({ user, exp: Date.now() + 864e5 }));
    localStorage.setItem('linework:ai-open', '0');
    sessionStorage.setItem('seeded', '1');
  }, USERNAME);
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto('/');
  const shot = name => page.screenshot({ path: `test-results/screens/${name}.png` });
  await page.getByRole('button', { name: 'Start from a Template' }).click();
  await page.getByRole('menuitem', { name: /Database schema/ }).click();
  await page.waitForTimeout(600);
  await shot('1-erd');
  await page.locator('[data-node="users"] [data-field="email"] rect').first().click({ force: true });
  await shot('2-row-selected');
  await page.locator('.dhdr').getByRole('button', { name: 'Code Editor' }).click();
  await page.waitForTimeout(300);
  await shot('3-code-editor');
  await page.getByRole('button', { name: 'Back to files' }).click();
  await shot('4-home');
  await page.getByRole('button', { name: 'Create a Blank File' }).click();
  await page.keyboard.press('r');
  await page.locator('#svg').click({ position: { x: 500, y: 300 } });
  await page.getByRole('button', { name: 'Fill and style' }).click();
  await shot('5-fill-panel');
});
