import { test, expect } from '@playwright/test';
import { existsSync, statSync } from 'node:fs';

// Help → Video guides: each guide animated in the page (a cursor, captions, chapters), or as a recorded video.
test('video guides play by themselves, step and jump by chapter, and offer the recorded video', async ({ page }) => {
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.addInitScript(() => { localStorage.setItem('linework:local-mode', '1'); localStorage.setItem('linework:ai-open', '0'); });
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Create a Blank File' })).toBeVisible();
  await page.keyboard.press('g');
  await page.getByRole('button', { name: '▶ Video guides' }).click();
  await expect(page.getByRole('heading', { name: 'Video guides', level: 1 })).toBeVisible();

  const g = page.getByRole('figure', { name: 'Animated guide: Build a workflow in 60 seconds' });
  await expect(g.locator('.vg-cap')).toContainText('A workflow is a row of steps');
  await expect(g.locator('.vg-count')).toHaveText('1 / 13');
  // Play: it moves on by itself, and the cursor and parts follow.
  await g.getByRole('button', { name: 'Play' }).click();
  await expect(g.locator('.vg-count')).toHaveText('2 / 13', { timeout: 6000 });
  await g.getByRole('button', { name: 'Pause' }).click();
  // Chapters jump; Run lights a node up and the strings carry beads.
  await g.getByRole('group', { name: 'Chapters' }).getByRole('button', { name: 'Run' }).click();
  await g.getByRole('button', { name: 'Pause' }).click();
  await g.getByRole('button', { name: 'Next step' }).click();
  await expect(g.locator('.vg-node.run')).toHaveCount(1);
  await expect(g.locator('.vg-bead').first()).toBeAttached();
  await g.getByRole('group', { name: 'Chapters' }).getByRole('button', { name: 'Publish' }).click();
  await expect(g.locator('.vg-dialog')).toContainText('workline.app/p/hello-world');

  // The recorded video of the real app.
  await page.getByRole('group', { name: 'How to watch Build a workflow in 60 seconds' }).getByRole('button', { name: 'Video' }).click();
  const video = page.getByLabel('Video: Build a workflow in 60 seconds');
  await expect(video).toHaveAttribute('src', '/guides/workflow.mp4');
  for (const f of ['workflow.mp4', 'workflow.jpg', 'tour.mp4', 'tour.jpg']) expect(statSync(`frontend/public/guides/${f}`).size, f).toBeGreaterThan(10_000);
  const head = await page.request.get('/guides/workflow.mp4');
  expect(head.ok()).toBe(true);

  // The tour is there too.
  await expect(page.getByRole('figure', { name: 'Animated guide: A tour of WorkLine' })).toBeVisible();
  expect(errors).toEqual([]);
  expect(existsSync('frontend/src/components/VideoGuide.jsx')).toBe(true);
});
