import { test, expect } from '@playwright/test';
import { readFileSync, statSync } from 'node:fs';

// Help → Video guides: recorded videos of the real app (with music), and a short video of every node
// with an example (scripts/node-videos.mjs), which each node's guide card also offers.
test('video guides: the recorded videos, and a video for each node', async ({ page }) => {
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.addInitScript(() => { localStorage.setItem('linework:local-mode', '1'); localStorage.setItem('linework:ai-open', '0'); });
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Create a Blank File' })).toBeVisible();
  await page.keyboard.press('g');
  await page.getByRole('button', { name: '▶ Video guides' }).click();
  await expect(page.getByRole('heading', { name: 'Video guides', level: 1 })).toBeVisible();

  // The two recorded videos; nothing animated any more.
  await expect(page.getByLabel('Video: Build a workflow in 60 seconds')).toHaveAttribute('src', '/guides/workflow.mp4');
  await expect(page.getByLabel('Video: A tour of WorkLine')).toHaveAttribute('src', '/guides/tour.mp4');
  await expect(page.locator('.vg-stage')).toHaveCount(0);
  for (const f of ['workflow.mp4', 'workflow.jpg', 'tour.mp4', 'tour.jpg']) expect(statSync(`frontend/public/guides/${f}`).size, f).toBeGreaterThan(10_000);
  for (const f of ['workflow.mp4', 'tour.mp4']) expect(readFileSync(`frontend/public/guides/${f}`).includes('mp4a'), `${f} has sound`).toBe(true);

  // Every node: find one, watch it.
  const index = JSON.parse(readFileSync('frontend/public/guides/nodes/index.json', 'utf8'));
  expect(Object.keys(index).length).toBeGreaterThan(600);
  await page.getByLabel('Find a node video').fill('Uppercase');
  await page.getByRole('button', { name: 'Watch Uppercase' }).click();
  await expect(page.getByLabel('Video: Uppercase')).toHaveAttribute('src', '/guides/nodes/text.upper.mp4');
  expect((await page.request.get('/guides/nodes/text.upper.mp4')).ok()).toBe(true);
  expect(readFileSync('frontend/public/guides/nodes/text.upper.mp4').includes('mp4a')).toBe(true);
  expect(errors).toEqual([]);
});

test('a node’s guide card plays its video', async ({ page }) => {
  await page.addInitScript(() => { localStorage.setItem('linework:local-mode', '1'); localStorage.setItem('linework:ai-open', '0'); });
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Create a Blank File' })).toBeVisible();
  await page.keyboard.press('g');
  await page.getByRole('button', { name: 'Workflows', exact: true }).click();
  await page.getByLabel('Find a node', { exact: true }).fill('Uppercase');
  const card = page.locator('#g-node-text\\.upper');
  await card.getByRole('button', { name: /Watch the video/ }).click();
  await expect(card.getByLabel('Video: Uppercase')).toHaveAttribute('src', '/guides/nodes/text.upper.mp4');
});
