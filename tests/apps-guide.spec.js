import { test, expect } from '@playwright/test';

// The Custom apps guide: its own tab in the guide, and opened from the App view.
test('the Custom apps guide opens from the guide tabs and from the App view', async ({ page }) => {
  await page.addInitScript(() => { if (window.top !== window) return; localStorage.clear(); localStorage.setItem('linework:local-mode', '1'); localStorage.setItem('linework:ai-open', '0'); });
  await page.goto('/');
  await page.getByRole('button', { name: 'Create a Blank File' }).click();
  // From the App view.
  await page.getByRole('button', { name: /^View:/ }).click();
  await page.getByRole('menuitemradio', { name: /^App/ }).click();
  await page.getByRole('button', { name: '? Guide' }).click();
  await expect(page.getByRole('heading', { name: 'Custom apps', level: 1 })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Custom apps', pressed: true })).toBeVisible();
  for (const h of ['What a custom app is', 'No code: a page made of nodes', 'Your first app', 'Running a workflow from the page', 'Publishing and sharing', 'Ready-made: OTT streaming app', 'Code in many languages', 'Dashboards on the canvas', 'Tips and troubleshooting'])
    await expect(page.getByRole('heading', { name: h })).toBeVisible();
  await expect(page.locator('.g-doc')).toContainText("await workline.run('Weather'");
  // The tabs switch guides; the main guide links here.
  await page.getByRole('button', { name: 'Using Workline' }).click();
  await page.locator('.g-doc a[data-guide="apps"]').click();
  await expect(page.getByRole('heading', { name: 'Custom apps', level: 1 })).toBeVisible();
});
