import { test, expect } from '@playwright/test';
import { spawn, spawnSync } from 'node:child_process';
import { openStore } from '../backend/store.js';
import { memoryBackend } from '../backend/storage.js';
import { createApp } from '../backend/app.js';

// Home › Run, the run studio: pick a workflow from the dropdown, run it (with its input when it asks), and
// watch it go step by step; click a step to see what it gave, replay older runs; Active on or off. The
// menu panel is hidden here until ☰ Menu brings it back.

const stop = p => { try { if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(p.pid), '/T', '/F']); else process.kill(-p.pid); } catch (e) { /* gone */ } };

test('the run studio: dropdown, step-by-step runs with input, step output, replay, Active', async ({ browser }) => {
  test.setTimeout(180_000);
  const app = createApp(await openStore(memoryBackend()), { noAccounts: true });
  const srv = app.listen(0);
  const port = 5243;
  const vite = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--port', String(port), '--strictPort'], { cwd: 'frontend', env: { ...process.env, LINEWORK_API: `http://localhost:${srv.address().port}` }, stdio: 'ignore', detached: process.platform !== 'win32' });
  try {
    const url = `http://localhost:${port}`;
    for (let i = 0; i < 60; i++) { try { if ((await fetch(url)).ok) break; } catch (e) {} await new Promise(r => setTimeout(r, 500)); }
    const ctx = await browser.newContext({ baseURL: url });
    await ctx.addInitScript(() => {
      if (sessionStorage.getItem('seeded')) return; sessionStorage.setItem('seeded', '1');
      localStorage.clear(); localStorage.setItem('linework:ai-open', '0');
      const now = Date.now();
      const file = (id, title, flow, updated) => ({ id, title, created: now, updated, doc: '', diagrams: [{ id: 'd1', type: 'architecture', name: 'Diagram 1', code: '' }], active: 0, view: 'flow', flow });
      const greet = { active: false, edges: [{ id: 'e', from: 't', to: 's', fromPort: 'main', toPort: 'main' }], nodes: [
        { id: 't', type: 'trigger.manual', name: 'Run by hand', x: 80, y: 160, params: { fields: 'Name*' } },
        { id: 's', type: 'core.set', name: 'Greeting', x: 380, y: 160, params: { fields: [{ name: 'message', value: 'Hi {{ $json.name }}' }], keep: true } }] };
      const tick = { active: false, edges: [{ id: 'e', from: 't', to: 's', fromPort: 'main', toPort: 'main' }], nodes: [
        { id: 't', type: 'trigger.manual', name: 'Run by hand', x: 80, y: 160, params: {} },
        { id: 's', type: 'core.set', name: 'Stamp', x: 380, y: 160, params: { fields: [{ name: 'ok', value: 'yes' }], keep: true } }] };
      localStorage.setItem('linework:files:v2', JSON.stringify([file('wf1', 'Greet', greet, now), file('wf2', 'Tick', tick, now - 1000),
        { id: 'doc1', title: 'Just a doc', created: now, updated: now, doc: '# Hi', diagrams: [{ id: 'd1', type: 'architecture', name: 'Diagram 1', code: '' }], active: 0, view: 'doc' }]));
    });
    const page = await ctx.newPage();
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    await page.goto('/');
    await page.getByRole('navigation', { name: 'Files' }).getByRole('button', { name: /^Run/ }).click();

    // The menu panel is out of the way; ☰ Menu brings it back, and hides it again.
    const side = page.locator('aside.side');
    await expect(side).toBeHidden();
    await page.getByRole('button', { name: 'Menu', exact: true }).click();
    await expect(side).toBeVisible();
    await page.getByRole('button', { name: 'Hide menu' }).click();
    await expect(side).toBeHidden();

    // The dropdown: the newest workflow is chosen; it lists only workflows, with how they start.
    const pick = page.getByRole('button', { name: 'Choose a workflow' });
    await expect(pick).toContainText('Greet');
    await pick.click();
    const options = page.getByRole('listbox', { name: 'Workflows' }).getByRole('option');
    await expect(options).toHaveCount(2);
    await expect(options.first()).toContainText('Run by hand · 2 steps');
    await expect(options.first()).toContainText('Never run');
    await options.filter({ hasText: 'Tick' }).click();
    await expect(pick).toContainText('Tick');

    // Run: it plays step by step (the headline counts the steps), then says how it went and what it gave.
    const stage = page.getByRole('region', { name: 'Runs of Tick' });
    await page.getByRole('button', { name: 'Run Tick' }).click();
    await expect(stage.locator('.fr-orb.st-active')).toBeVisible({ timeout: 15_000 });
    await expect(stage.locator('.fr-say')).toContainText('All done!', { timeout: 20_000 });
    await expect(stage.locator('.fr-stack')).toContainText('2 steps finished');
    await expect(stage.locator('.fr-sub')).toContainText('Finished 2 steps');
    // The Result tab shows what its last step gave.
    const panel = page.getByRole('complementary', { name: 'About this run' });
    // The side panel starts hidden; its toggle shows it (and it stays as chosen).
    await expect(panel).toHaveCount(0);
    await page.getByRole('button', { name: 'Show the side panel' }).click();
    await expect(panel.getByRole('tab', { name: /^Result/ })).toHaveAttribute('aria-selected', 'true');
    // Shown readably (fields in words), or as the JSON.
    await expect(panel.locator('.rv-card1 .rv-f').filter({ hasText: 'Ok' })).toContainText('yes');
    await panel.getByRole('tab', { name: 'JSON' }).click();
    await expect(panel.locator('.rv-json')).toContainText('"ok": "yes"');
    await panel.getByRole('tab', { name: 'View' }).click();

    // Pick a workflow by keyboard; one with fields asks for them first.
    await pick.click();
    await page.getByLabel('Find a workflow').fill('gre');
    await page.keyboard.press('Enter');
    await expect(pick).toContainText('Greet');
    // Not run yet: the panel says how to run it, and the fields it asks for.
    await expect(panel.getByRole('tab', { name: 'How to run' })).toHaveAttribute('aria-selected', 'true');
    await expect(panel.locator('.rv-howto')).toContainText('Run it by hand');
    await expect(panel.locator('.rv-chip')).toHaveText(['Name*']);
    await page.getByRole('button', { name: 'Run Greet' }).click();
    const form = page.getByRole('dialog', { name: 'Run with input' });
    await form.getByLabel(/^Name/).fill('Meera');
    await form.getByRole('button', { name: 'Run' }).click();
    const greetStage = page.getByRole('region', { name: 'Runs of Greet' });
    await expect(greetStage.locator('.fr-say')).toContainText('All done!', { timeout: 20_000 });
    await expect(panel.locator('.rv-result')).toContainText('Hi Meera');
    await page.screenshot({ path: 'test-results/run-studio.png' });
    // The side panel folds away for a wider stage, and See the result brings it back.
    await page.getByRole('button', { name: 'Hide the side panel' }).click();
    await expect(panel).toHaveCount(0);
    await page.screenshot({ path: 'test-results/run-studio-noside.png' });
    await greetStage.getByRole('button', { name: 'See the result' }).click();
    await expect(panel.locator('.rv-result')).toContainText('Hi Meera');
    // The steps, for the curious; See the result opens the result.
    await greetStage.locator('.fr-stack').click();
    await expect(greetStage.locator('.fr-list')).toContainText('Greeting');
    await panel.getByRole('tab', { name: 'How to run' }).click();
    await greetStage.getByRole('button', { name: 'See the result' }).click();
    await expect(panel.getByRole('tab', { name: /^Result/ })).toHaveAttribute('aria-selected', 'true');

    // Run again; an older run plays back again from History.
    await page.getByRole('button', { name: 'Run Greet' }).click();
    await form.getByLabel(/^Name/).fill('Ravi');
    await form.getByRole('button', { name: 'Run' }).click();
    // The last run's result goes at once: the stage starts over, not replaying the old run.
    await expect(panel.locator('.rv-result')).toHaveCount(0);
    await expect(greetStage.locator('.fr-orb.st-active')).toBeVisible();
    await expect(greetStage.locator('.fr-say')).not.toContainText('All done!');
    await expect(panel.locator('.rv-result')).toContainText('Hi Ravi', { timeout: 20_000 });
    await panel.getByRole('tab', { name: /^History/ }).click();
    await expect(panel.locator('.ws-hist li')).toHaveCount(2, { timeout: 10_000 });
    await panel.locator('.ws-hist button').nth(1).click();
    await expect(greetStage.locator('.fr-orb.st-active')).toBeVisible();
    await expect(panel.locator('.rv-result')).toContainText('Hi Meera', { timeout: 10_000 });
    // Watch again plays the shown run again.
    await greetStage.getByRole('button', { name: '↺ Watch again' }).click();
    await expect(greetStage.locator('.fr-orb.st-active')).toBeVisible();
    await expect(greetStage.locator('.fr-say')).toContainText('All done!', { timeout: 10_000 });

    // Opening a workflow never looks like it ran: the stage is ready, the last run a quiet note to watch.
    await pick.click();
    await page.getByRole('option').filter({ hasText: 'Tick' }).click();
    const tickStage = page.getByRole('region', { name: 'Runs of Tick' });
    await expect(tickStage.locator('.fr-say')).toHaveText('Ready when you are');
    await expect(tickStage.locator('.fr-last')).toContainText('started by you (Run)');
    await expect(panel.getByRole('tab', { name: 'How to run' })).toHaveAttribute('aria-selected', 'true');
    await panel.getByRole('tab', { name: /^Result/ }).click();
    await expect(panel.locator('.rv-lastnote')).toContainText('From the last run');
    await tickStage.locator('.fr-last').getByRole('button', { name: 'Watch it' }).click();
    await expect(tickStage.locator('.fr-orb.st-active')).toBeVisible();
    await expect(tickStage.locator('.fr-say')).toContainText('All done!', { timeout: 10_000 });
    await pick.click();
    await page.getByRole('option').filter({ hasText: 'Greet' }).click();

    // Active on and off.
    const active = page.getByRole('checkbox', { name: 'Active: Greet' });
    await active.check({ force: true });
    await expect(page.getByText(/“Greet” is Active/)).toBeVisible();
    await active.uncheck({ force: true });

    // Open in editor opens the workflow.
    await page.getByRole('button', { name: 'Open in editor' }).click();
    await expect(page.locator('.fv-node').filter({ hasText: 'Greeting' })).toBeVisible();
    expect(errors).toEqual([]);
  } finally { stop(vite); srv.close(); app.flows.close(); }
});

test('without a server, the run studio says how to get one and doesn’t run', async ({ page }) => {
  await page.addInitScript(() => {
    if (sessionStorage.getItem('s')) return; sessionStorage.setItem('s', '1');
    localStorage.clear(); localStorage.setItem('linework:local-mode', '1'); localStorage.setItem('linework:ai-open', '0');
  });
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Create a Blank File' })).toBeVisible();
  // W opens Run (pressed on the page, once it's ready for shortcuts).
  await expect(async () => {
    await page.getByRole('heading', { level: 1 }).click();
    await page.keyboard.press('w');
    await expect(page.getByText(/No workflows yet/)).toBeVisible({ timeout: 1000 });
  }).toPass({ timeout: 10_000 });
  // Back to the menu, make a workflow, and back to Run.
  await page.getByRole('button', { name: 'Menu', exact: true }).click();
  await page.getByRole('navigation', { name: 'Files' }).getByRole('button', { name: /^Tools/ }).click();
  await page.locator('.tool-card').filter({ hasText: 'Form to a sheet' }).click();
  await page.getByRole('button', { name: 'Back to files' }).click();
  await page.getByRole('navigation', { name: 'Files' }).getByRole('button', { name: /^Run/ }).click();
  await expect(page.locator('.rh-note')).toContainText('npm run dev');
  await expect(page.getByRole('button', { name: /^Run Form to sheet/ })).toBeDisabled();
  await expect(page.locator('.fr-say')).toContainText('Ready when you are');
});

test('a step whose credential is gone: the fix card offers a saved one and runs again; Fix in editor opens that step', async ({ browser }) => {
  test.setTimeout(150_000);
  const app = createApp(await openStore(memoryBackend()), { noAccounts: true });
  const srv = app.listen(0);
  const api = `http://localhost:${srv.address().port}/api`;
  // A saved SMTP credential (to a mail server that isn't there, so nothing is sent).
  await fetch(api + '/credentials', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ type: 'smtp', name: 'My Gmail', data: { smtpUrl: 'smtp://127.0.0.1:9', from: 'me@example.com' } }) });
  const port = 5246;
  const vite = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--port', String(port), '--strictPort'], { cwd: 'frontend', env: { ...process.env, LINEWORK_API: `http://localhost:${srv.address().port}` }, stdio: 'ignore', detached: process.platform !== 'win32' });
  try {
    const url = `http://localhost:${port}`;
    for (let i = 0; i < 60; i++) { try { if ((await fetch(url)).ok) break; } catch (e) {} await new Promise(r => setTimeout(r, 500)); }
    const ctx = await browser.newContext({ baseURL: url });
    await ctx.addInitScript(() => {
      if (sessionStorage.getItem('seeded')) return; sessionStorage.setItem('seeded', '1');
      localStorage.clear(); localStorage.setItem('linework:ai-open', '0');
      const now = Date.now();
      const flow = { active: false, edges: [{ id: 'e', from: 't', to: 'm', fromPort: 'main', toPort: 'main' }], nodes: [
        { id: 't', type: 'trigger.manual', name: 'Enter the details', x: 80, y: 160, params: {} },
        { id: 'm', type: 'app.email', name: 'Mail them to me', x: 380, y: 160, credential: 'gone-123', params: { to: 'me@example.com', subject: 'Hi', text: 'Hello' } }] };
      localStorage.setItem('linework:files:v2', JSON.stringify([{ id: 'wf1', title: 'Mail me', created: now, updated: now, doc: '', diagrams: [{ id: 'd1', type: 'architecture', name: 'Diagram 1', code: '' }], active: 0, view: 'flow', flow }]));
    });
    const page = await ctx.newPage();
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    await page.goto('/');
    await page.getByRole('navigation', { name: 'Files' }).getByRole('button', { name: /^Run/ }).click();
    await page.getByRole('button', { name: 'Run Mail me' }).click();
    // The side panel is hidden: Fix it on the stage opens it at the fix card.
    await page.getByRole('region', { name: 'Runs of Mail me' }).getByRole('button', { name: 'Fix it' }).click({ timeout: 20_000 });
    const card = page.locator('.rs-fix');
    await expect(card).toContainText('“Mail them to me” needs an account connected', { timeout: 20_000 });
    await expect(card).toContainText('was deleted');
    await expect(card.getByLabel('Credential to use')).toHaveValue(/.+/);
    await expect(card.getByLabel('Credential to use').locator('option')).toHaveText(['My Gmail (Email (SMTP))']);
    await page.screenshot({ path: 'test-results/run-studio-fix.png' });
    // Use it: the step gets it, and the run goes again (failing now only because that mail server isn't there).
    await card.getByRole('button', { name: 'Use it & run again' }).click();
    await expect(page.getByText(/Using “My Gmail”/)).toBeVisible();
    await expect(page.locator('.rs-fail')).toBeVisible({ timeout: 30_000 });
    await expect(page.locator('.rs-fail .rs-oops-raw code')).not.toContainText('credential');
    // Fix in editor opens the workflow at that step, its settings showing.
    await page.locator('.rs-fail').getByRole('button', { name: /^Open “Mail them to me” in the editor/ }).click();
    await expect(page.getByLabel('Node name')).toHaveValue('Mail them to me');
    expect(errors).toEqual([]);
  } finally { stop(vite); srv.close(); app.flows.close(); }
});
