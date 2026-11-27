import { test, expect } from '@playwright/test';
import JSZip from '../frontend/node_modules/jszip/lib/index.js';

// Home → Course Studio: a course made of scenes and slides, with layers, states, triggers, variables and a quiz,
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
const studio = async (page, start) => {
  await page.getByRole('navigation', { name: 'Files' }).getByRole('button', { name: /^Course Studio/ }).click();
  await page.locator('.cs-new').filter({ has: page.locator('b', { hasText: new RegExp('^' + start + '$') }) }).click();
  await expect(page.getByRole('toolbar', { name: 'Course tools' })).toBeVisible();
};

test('the sample course plays: a typed name, layers, visited states and a scored quiz', async ({ page }) => {
  test.setTimeout(60_000);
  await studio(page, 'Interactive sample');
  await expect(page.getByRole('button', { name: 'View: Course' })).toBeVisible();
  // Story View: every scene and its slides.
  await expect(page.getByRole('region', { name: /^Scene \d+:/ })).toHaveCount(3);
  await expect(page.getByRole('button', { name: /^Slide \d+\.\d+:/ })).toHaveCount(6);

  await page.getByRole('button', { name: 'Preview', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Entire project' }).click();
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
  await studio(page, 'Blank course');
  await page.getByRole('button', { name: 'New Slide', exact: true }).first().click();
  await page.getByRole('menuitem', { name: 'Blank' }).click();
  await expect(page.getByRole('button', { name: /^Slide \d+\.\d+:/ })).toHaveCount(2);

  // A button, renamed, with a Hover state and a new text.
  await page.getByRole('tab', { name: 'INSERT' }).click();
  const ribbon = page.getByRole('toolbar', { name: 'Course tools' });
  await ribbon.getByRole('button', { name: 'Button', exact: true }).click();
  const panel = page.locator('.sl-bottom');
  await panel.getByLabel('Object name').fill('Reveal');
  await panel.getByLabel('Text', { exact: true }).fill('Show me');
  await expect(page.locator('.cv-o.sel')).toContainText('Show me');
  await panel.getByRole('tab', { name: 'States' }).click();
  await panel.getByRole('button', { name: 'Edit the Hover state' }).click();
  await expect(page.locator('.cv-stbar')).toContainText('Hover');
  await page.locator('.cv-stbar').getByRole('button', { name: 'Done' }).click();

  // A layer with a text, shown by a trigger on the button.
  const right = page.getByRole('complementary', { name: 'Properties' });
  await right.getByRole('button', { name: 'New layer' }).click();
  await ribbon.getByRole('button', { name: 'Text Box' }).click();
  await panel.getByLabel('Text', { exact: true }).fill('The secret is out');
  await right.getByRole('tab', { name: /base layer/ }).click();
  await page.locator('.cv-stage .cv-o', { hasText: 'Show me' }).click();
  await panel.getByRole('tab', { name: 'Format' }).click();
  await panel.getByRole('button', { name: '＋ Trigger' }).click();
  const trig = right.getByRole('region', { name: 'Triggers' });
  await trig.getByLabel('Action').selectOption('showLayer');
  await expect(trig.locator('.cv-trig-h')).toContainText('Show layer Layer 1');
  await expect(trig.locator('.cv-trig-h')).toContainText('When user clicks Reveal');

  // Preview this slide: clicking shows the layer.
  await page.getByRole('tab', { name: 'HOME' }).click();
  await page.getByRole('button', { name: 'Preview', exact: true }).click();
  await page.getByRole('menuitem', { name: 'This slide' }).click();
  const p = page.frameLocator('iframe[title="Course preview"]');
  await expect(p.getByText('The secret is out')).toHaveCount(0);
  await p.getByRole('button', { name: 'Show me' }).click();
  await expect(p.getByText('The secret is out')).toBeVisible();
  await page.getByRole('button', { name: 'Close preview' }).click();

  // Undo: first the action goes back to Jump, then the trigger goes; redo brings both back.
  await page.keyboard.press('Control+z');
  await expect(trig.locator('.cv-trig-h')).toContainText('Jump to slide');
  await page.keyboard.press('Control+z');
  await expect(trig.locator('.cv-trig')).toHaveCount(0);
  await page.keyboard.press('Control+y');
  await page.keyboard.press('Control+y');
  await expect(trig.locator('.cv-trig-h')).toContainText('Show layer Layer 1');

  // Publish: one HTML page, and a SCORM 1.2 zip with its manifest.
  await page.getByRole('button', { name: 'Publish', exact: true }).click();
  const [html] = await Promise.all([page.waitForEvent('download'), page.getByRole('menuitem', { name: /Web page/ }).click()]);
  expect(html.suggestedFilename()).toBe('Course.html');
  await page.getByRole('button', { name: 'Publish', exact: true }).click();
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

test('export a course file; import a published page and a course file; a broken .story file explains itself', async ({ page }) => {
  test.setTimeout(60_000);
  await studio(page, 'Quiz');
  await page.getByRole('button', { name: 'FILE', exact: true }).click();
  const [json] = await Promise.all([page.waitForEvent('download'), page.getByRole('menuitem', { name: /Export course file/ }).click()]);
  expect(json.suggestedFilename()).toBe('Quiz.course.json');
  const jsonPath = await json.path();
  await page.getByRole('button', { name: 'FILE', exact: true }).click();
  const [html] = await Promise.all([page.waitForEvent('download'), page.getByRole('menuitem', { name: /Publish: web page/ }).click()]);
  const htmlPath = await html.path();

  // Import slides into this course: the published page's 5 slides are added (10 in all).
  await page.getByRole('button', { name: 'FILE', exact: true }).click();
  await page.getByRole('menuitem', { name: /Import slides/ }).click();
  await page.getByLabel('Course file to import').setInputFiles({ name: 'Quiz.html', mimeType: 'text/html', buffer: await (await import('node:fs')).promises.readFile(htmlPath) });
  await expect(page.getByRole('button', { name: /^Slide \d+\.\d+:/ })).toHaveCount(10);

  // Course Studio lists the course; importing the course file makes a new one.
  await page.getByRole('button', { name: 'Back to files' }).click();
  await page.getByRole('navigation', { name: 'Files' }).getByRole('button', { name: /^Course Studio/ }).click();
  await expect(page.locator('.cs-card')).toHaveCount(1);
  await page.locator('.cs-new', { hasText: 'Import a course' }).click();
  await page.getByLabel('Course to import').setInputFiles({ name: 'Quiz.course.json', mimeType: 'application/json', buffer: await (await import('node:fs')).promises.readFile(jsonPath) });
  await expect(page.getByRole('toolbar', { name: 'Course tools' })).toBeVisible();
  await expect(page.getByRole('button', { name: /^Slide \d+\.\d+:/ })).toHaveCount(5);
  // A broken .story file says what to do instead.
  await page.getByRole('button', { name: 'Back to files' }).click();
  await page.getByRole('navigation', { name: 'Files' }).getByRole('button', { name: /^Course Studio/ }).click();
  await expect(page.locator('.cs-card')).toHaveCount(2);
  await page.locator('.cs-new', { hasText: 'Import a course' }).click();
  await page.getByLabel('Course to import').setInputFiles({ name: 'old.story', mimeType: 'application/octet-stream', buffer: Buffer.from('PK') });
  await expect(page.getByRole('alert')).toContainText('Publish → Web');
});

// Storyline: a .story file (XML and media in a zip) and a published course (story.html + html5/data/js) become
// courses with their scenes, slide titles, text and pictures. (Both files here are small stand-ins.)
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAIAAACQkWg2AAAAHElEQVR4nGNk+M9AEmAiTfmoBqI0MDIwkKYeACc7AR/0Dny3AAAAAElFTkSuQmCC', 'base64');
test('Storyline .story files and published courses import as courses', async ({ page }) => {
  test.setTimeout(60_000);
  const story = new JSZip();
  story.file('story/story.xml', '<story title="Site safety"><scenes><scene name="Introduction"><slide id="a1b2" title="Welcome"/><slide id="c3d4" title="Hazards"/></scene><scene name="Wrap up"><slide id="e5f6" title="Summary"/></scene></scenes></story>');
  story.file('story/slides/a1b2.xml', '<sld><shape name="Rectangle 1"><text>Welcome to the site safety course</text></shape><shape name="Text Box 2" text="Click Next to begin"/><pic src="media/logo.png"/></sld>');
  story.file('story/slides/c3d4.xml', '<sld><rich><![CDATA[<Paragraph><Run Text="Watch out for "/><Run Text="moving vehicles"/></Paragraph>]]></rich><shape name="Oval 3"><text>Wear a helmet at all times</text></shape></sld>');
  story.file('story/slides/e5f6.xml', '<sld><text>You finished the course</text></sld>');
  story.file('story/media/logo.png', PNG);
  const storyBuf = await story.generateAsync({ type: 'nodebuffer' });

  const pub = new JSZip();
  pub.file('story.html', '<html><body>player</body></html>');
  pub.file('html5/data/js/data.js', `window.globalProvideData('data', '${JSON.stringify({ title: 'Fire drill', scenes: [{ title: 'Drill', slides: [{ id: 'x1', title: 'Alarm sounds' }, { id: 'x2', title: 'Assembly point' }] }] }).replace(/'/g, "\\'")}');`);
  pub.file('html5/data/js/x1.js', `window.globalProvideData('slide', '${JSON.stringify({ id: 'x1', slideLayers: [{ objects: [{ textLib: [{ vartext: { blocks: [{ spans: [{ text: 'Leave the building calmly' }] }] } }], imagelib: [{ url: 'story_content/exit.png' }] }] }] })}');`);
  pub.file('html5/data/js/x2.js', `window.globalProvideData('slide', '${JSON.stringify({ id: 'x2', slideLayers: [{ objects: [{ textLib: [{ vartext: { blocks: [{ spans: [{ text: 'Meet at the car park' }] }] } }] }] }] })}');`);
  pub.file('story_content/exit.png', PNG);
  const pubBuf = await pub.generateAsync({ type: 'nodebuffer' });

  await page.getByRole('navigation', { name: 'Files' }).getByRole('button', { name: /^Course Studio/ }).click();
  await page.locator('.cs-new', { hasText: 'Import a course' }).click();
  await page.getByLabel('Course to import').setInputFiles({ name: 'Site safety.story', mimeType: 'application/octet-stream', buffer: storyBuf });
  await expect(page.getByRole('toolbar', { name: 'Course tools' })).toBeVisible();
  await expect(page.getByRole('region', { name: /^Scene \d+:/ })).toHaveCount(2);
  await expect(page.getByRole('button', { name: /^Slide \d+\.\d+:/ })).toHaveCount(3);
  await expect(page.locator('.sl-import')).toContainText('3 slides');
  await expect(page.locator('.sl-import')).toContainText('1 picture');
  await page.getByRole('button', { name: /^Slide 1\.2: Hazards/ }).dblclick();
  await expect(page.locator('.cv-stage')).toContainText('Watch out for moving vehicles');
  await expect(page.locator('.cv-stage')).toContainText('Wear a helmet at all times');
  await expect(page.locator('.cv-stage')).not.toContainText('Oval 3');
  await page.getByRole('button', { name: /^Slide 1\.1: Welcome/ }).click();
  await expect(page.locator('.cv-stage')).toContainText('Welcome to the site safety course');
  await expect(page.locator('.cv-stage img')).toHaveCount(1);

  // The published course goes in as slides of this one.
  await page.getByRole('button', { name: 'FILE', exact: true }).click();
  await page.getByRole('menuitem', { name: /Import slides/ }).click();
  await page.getByLabel('Course file to import').setInputFiles({ name: 'Fire drill.zip', mimeType: 'application/zip', buffer: pubBuf });
  await expect(page.locator('.sl-import')).toContainText('published Storyline course: 1 scene, 2 slides');
  await page.getByRole('button', { name: 'STORY VIEW' }).click();
  await expect(page.getByRole('region', { name: 'Scene 3: Drill' })).toBeVisible();
  await page.getByRole('button', { name: /^Slide 3\.1: Alarm sounds/ }).dblclick();
  await expect(page.locator('.cv-stage')).toContainText('Leave the building calmly');
  await expect(page.locator('.cv-stage img')).toHaveCount(1);
});
