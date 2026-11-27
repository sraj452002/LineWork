import { test, expect } from '@playwright/test';
import JSZip from '../frontend/node_modules/jszip/lib/index.js';

// Tools → E-learning: a course made of scenes and slides, with layers, states, triggers, variables and a quiz,
// previewed in its player and published as a web page and a SCORM package.

test.beforeEach(async ({ page }) => {
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  test.info().errors_ = errors;
  await page.addInitScript(() => {
    try { if (sessionStorage.getItem('seeded')) return; } catch (e) { return; } // (the course preview: a sandboxed frame)
    localStorage.clear();
    localStorage.setItem('linework:local-mode', '1');
    localStorage.setItem('linework:ai-open', '0');
    sessionStorage.setItem('seeded', '1');
  });
  await page.goto('/');
});
test.afterEach(async () => { expect(test.info().errors_, 'page errors').toEqual([]); });
test.use({ actionTimeout: 8000 });
const tool = (page, name) => page.locator('.tool-card').filter({ has: page.locator('b', { hasText: new RegExp('^' + name + '$') }) });

test('the sample course plays: a typed name, layers, visited states and a scored quiz', async ({ page }) => {
  test.setTimeout(60_000);
  await page.getByRole('button', { name: 'Tools' }).first().click();
  await tool(page, 'Interactive course').click();
  await expect(page.getByRole('button', { name: 'View: Course' })).toBeVisible();
  const slides = page.getByRole('complementary', { name: 'Slides' });
  await expect(slides.getByRole('button', { name: /^Slide \d+:/ })).toHaveCount(6);

  await page.getByRole('button', { name: '▶ Preview' }).click();
  await page.getByRole('menuitem', { name: 'The whole course' }).click();
  const p = page.frameLocator('iframe[title="Course preview"]');
  await p.getByRole('button', { name: 'Start' }).click();
  await p.getByLabel('Your first name').fill('Asha');
  await p.getByLabel('Your first name').press('Enter');
  await expect(p.getByText('Nice to meet you, Asha!')).toBeVisible();
  await p.getByRole('button', { name: 'Next ›' }).click();

  // Each tile shows its layer and becomes visited; the counter goes up once per tile.
  await expect(p.getByText('Click each tile to learn more, Asha. (0 of 3 seen)')).toBeVisible();
  await p.getByRole('button', { name: 'Fire' }).click();
  await expect(p.getByText('Know your nearest exit')).toBeVisible();
  await p.getByRole('button', { name: 'Close' }).click();
  await expect(p.getByText('Know your nearest exit')).toHaveCount(0);
  await expect(p.getByRole('button', { name: 'Fire' })).toContainText('✓ Fire');
  await p.getByRole('button', { name: 'Fire' }).click();
  await p.getByRole('button', { name: 'Close' }).click();
  await p.getByRole('button', { name: 'Lifting' }).click();
  await expect(p.getByText('(2 of 3 seen)')).toBeVisible();
  await p.getByRole('button', { name: 'Close' }).click();
  await p.getByRole('button', { name: 'Next ›' }).click();

  // Question 1: Next waits; a wrong answer leaves a second try.
  await expect(p.getByRole('button', { name: 'Next ›' })).toBeDisabled();
  await p.getByText('Walk around it').click();
  await p.getByRole('button', { name: 'Submit' }).click();
  await expect(p.getByText('You have 1 more try.')).toBeVisible();
  await p.getByRole('button', { name: 'Try again' }).click();
  await p.getByText('Wipe it up or put up a warning sign').click();
  await p.getByRole('button', { name: 'Submit' }).click();
  await expect(p.getByText('✓ Exactly')).toBeVisible();
  await p.getByRole('button', { name: 'Continue ›' }).click();
  // Question 2: wrong.
  await p.getByText('False', { exact: true }).click();
  await p.getByRole('button', { name: 'Submit' }).click();
  await p.getByRole('button', { name: 'Continue ›' }).click();
  await expect(p.locator('.cp-ring')).toContainText('50%');
  await expect(p.getByText('10 of 20 points · You need 80% to pass')).toBeVisible();
  // Retry goes back to the first question, with the score cleared.
  await p.getByRole('button', { name: 'Retry the quiz' }).click();
  await expect(p.getByText('You see a spill in the corridor')).toBeVisible();
});

test('build a slide: insert, format, a state, a layer and triggers; publish HTML and SCORM', async ({ page }) => {
  test.setTimeout(60_000);
  await page.getByRole('button', { name: 'Tools' }).first().click();
  await tool(page, 'Blank course').click();
  await page.getByRole('button', { name: '＋ New slide' }).click();
  await page.getByRole('menuitem', { name: 'Blank' }).click();
  const slides = page.getByRole('complementary', { name: 'Slides' });
  await expect(slides.getByRole('button', { name: /^Slide \d+:/ })).toHaveCount(2);

  // A button, renamed, with a Hover state and a new text.
  await page.getByRole('toolbar', { name: 'Course tools' }).getByRole('button', { name: 'Button', exact: true }).click();
  const props = page.getByRole('complementary', { name: 'Properties' });
  await props.getByLabel('Object name').fill('Reveal');
  await props.getByLabel('Text', { exact: true }).fill('Show me');
  await expect(page.locator('.cv-o.sel')).toContainText('Show me');
  await props.getByRole('tab', { name: 'States' }).click();
  await props.getByRole('button', { name: 'Edit the Hover state' }).click();
  await expect(page.locator('.cv-stbar')).toContainText('Hover');

  // A layer with a text, shown by a trigger on the button.
  await page.getByRole('button', { name: '＋ Layer' }).click();
  await page.getByRole('toolbar', { name: 'Course tools' }).getByRole('button', { name: 'Text', exact: true }).click();
  await props.getByRole('tab', { name: 'Format' }).click();
  await props.getByLabel('Text', { exact: true }).fill('The secret is out');
  await page.getByRole('tab', { name: /Base layer/ }).click();
  await page.locator('.cv-stage .cv-o', { hasText: 'Show me' }).click();
  await props.getByRole('button', { name: '＋ Trigger' }).click();
  await props.getByLabel('Action').selectOption('showLayer');
  await expect(props.getByLabel('Layer', { exact: true })).toHaveValue(/./);
  await expect(props.locator('.cv-trig-h')).toContainText('Show layer Layer 1');
  await expect(props.locator('.cv-trig-h')).toContainText('When user clicks Reveal');

  // Preview this slide: clicking shows the layer.
  await page.getByRole('button', { name: '▶ Preview' }).click();
  await page.getByRole('menuitem', { name: 'This slide' }).click();
  const p = page.frameLocator('iframe[title="Course preview"]');
  await expect(p.getByText('The secret is out')).toHaveCount(0);
  await p.getByRole('button', { name: 'Show me' }).click();
  await expect(p.getByText('The secret is out')).toBeVisible();
  await page.getByRole('button', { name: 'Close preview' }).click();

  // Undo: first the action goes back to Jump, then the trigger goes; redo brings both back.
  await page.keyboard.press('Control+z');
  await expect(props.locator('.cv-trig-h')).toContainText('Jump to slide');
  await page.keyboard.press('Control+z');
  await expect(props.locator('.cv-trig')).toHaveCount(0);
  await page.keyboard.press('Control+y');
  await page.keyboard.press('Control+y');
  await expect(props.locator('.cv-trig-h')).toContainText('Show layer Layer 1');

  // Publish: one HTML page, and a SCORM 1.2 zip with its manifest.
  await page.getByRole('button', { name: 'Publish' }).click();
  const [html] = await Promise.all([page.waitForEvent('download'), page.getByRole('menuitem', { name: /Web page/ }).click()]);
  expect(html.suggestedFilename()).toBe('Course.html');
  await page.getByRole('button', { name: 'Publish' }).click();
  const [zipDl] = await Promise.all([page.waitForEvent('download'), page.getByRole('menuitem', { name: /SCORM/ }).click()]);
  const zip = await JSZip.loadAsync(await (await import('node:fs')).promises.readFile(await zipDl.path()));
  const manifest = await zip.file('imsmanifest.xml').async('string');
  expect(manifest).toContain('<schemaversion>1.2</schemaversion>');
  expect(manifest).toContain('href="index.html"');
  expect(await zip.file('index.html').async('string')).toContain('LMSInitialize');

  // The SCORM page reports to an LMS: completion and where the learner is.
  const lms = await page.context().newPage();
  await lms.setContent('<body></body>');
  const calls = await lms.evaluate(async src => {
    const log = [];
    window.API = { LMSInitialize: () => 'true', LMSGetValue: k => (k === 'cmi.core.lesson_status' ? 'not attempted' : ''), LMSSetValue: (k, v) => { log.push(k + '=' + v); return 'true'; }, LMSCommit: () => 'true', LMSFinish: () => 'true', LMSGetLastError: () => '0' };
    const f = document.createElement('iframe'); f.style.cssText = 'width:900px;height:600px'; document.body.appendChild(f);
    f.srcdoc = src; await new Promise(r => { f.onload = r; });
    await new Promise(r => setTimeout(r, 300));
    f.contentDocument.querySelector('.cp-next').click();
    await new Promise(r => setTimeout(r, 300));
    return log;
  }, await zip.file('index.html').async('string'));
  expect(calls).toContain('cmi.core.lesson_status=incomplete');
  expect(calls).toContain('cmi.core.lesson_status=completed');
  expect(calls.some(c => c.startsWith('cmi.core.lesson_location='))).toBe(true);
});
