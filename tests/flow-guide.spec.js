import { test, expect } from '@playwright/test';
import { NODES } from '../frontend/src/lib/flows.js';
import { CRED_SETUP, NODE_GUIDE, NODE_SETUP } from '../frontend/src/lib/flowguide.js';
import { CRED_TYPES } from '../frontend/src/lib/flows.js';

// The Workflows guide explains every node the editor has, and nothing it doesn't.
test('every node has a guide entry: what it does, an example and what it gives', () => {
  expect(Object.keys(NODES).filter(k => !NODE_GUIDE[k])).toEqual([]);
  expect(Object.keys(NODE_GUIDE).filter(k => !NODES[k])).toEqual([]);
  for (const [k, g] of Object.entries(NODE_GUIDE)) {
    expect(g.what, k).toBeTruthy();
    expect(g.ex, k).toBeTruthy();
    expect(g.out, k).toBeTruthy();
    for (const f of Object.keys(g.fields || {})) expect(NODES[k].fields.map(x => x.k), `${k} explains ${f}`).toContain(f);
  }
});

test('a node’s ? explains it in a popup, which opens the full guide at that node; the guide finds nodes by name', async ({ page }) => {
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.addInitScript(() => {
    if (sessionStorage.getItem('seeded')) return;
    localStorage.clear();
    localStorage.setItem('linework:local-mode', '1');
    localStorage.setItem('linework:ai-open', '0');
    sessionStorage.setItem('seeded', '1');
  });
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Create a Blank File' })).toBeVisible();
  await page.getByRole('navigation', { name: 'Files' }).getByRole('button', { name: /^Tools/ }).click();
  await page.locator('.tool-card').filter({ hasText: 'Form to a sheet' }).click();
  await page.locator('.fv-node').filter({ hasText: 'Form' }).first().click();
  await page.getByRole('button', { name: 'How Form works' }).click();
  // A popup explains the node, over the workflow; Esc closes it.
  const pop = page.getByRole('dialog', { name: 'How Form works' });
  await expect(pop).toContainText('End the name with *');
  await expect(pop.locator('.gn-steps')).toContainText('Turn the workflow Active');
  await page.keyboard.press('Escape');
  await expect(pop).toHaveCount(0);
  // From it, the full guide opens at that node.
  await page.getByRole('button', { name: 'How Form works' }).click();
  await pop.getByRole('button', { name: 'Open the full workflows guide' }).click();
  await expect(page.getByRole('heading', { name: 'Workflows', level: 1 })).toBeVisible();
  const card = page.locator('[id="g-node-trigger.form"]');
  await expect(card).toHaveClass(/lit/);
  await expect(card).toContainText('End the name with *');
  await expect(card).toBeInViewport();
  // Search narrows the node cards.
  await page.getByRole('searchbox', { name: 'Find a node' }).fill('translate');
  await expect(page.locator('.gn')).toHaveCount(1);
  await expect(page.locator('.gn h3')).toHaveText('DeepL translate');
  // Back to the workflow.
  await page.getByRole('button', { name: '← Back' }).click();
  await expect(page.locator('.fv-node').first()).toBeVisible();
  expect(errors).toEqual([]);
});

test('every kind of credential says, step by step, where to find it', () => {
  expect(Object.keys(CRED_TYPES).filter(k => !CRED_SETUP[k])).toEqual([]);
  expect(Object.keys(CRED_SETUP).filter(k => !CRED_TYPES[k])).toEqual([]);
  expect(Object.keys(NODE_SETUP).filter(k => !NODES[k])).toEqual([]);
});
