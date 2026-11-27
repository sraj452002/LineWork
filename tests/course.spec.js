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

// A Storyline 360 package as Storyline writes it (OPC parts: story/story.xml, story/slides/*.xml with _rels):
// shapes keep their place, fill, outline and rich text; pictures are found from the media list; layers (quiz feedback
// layers too), object states drawn by their own shapes, timing and triggers come over and work in the player — the
// player's Next button included; a quiz question drawn on the slide is scored; and every trigger is accounted for.
test('a Storyline 360 package imports faithfully, and every trigger is accounted for', async ({ page }) => {
  test.setTimeout(60_000);
  const z = new JSZip();
  const span = (text, size, color, bold = 'False', font = 'Aptos') => `&lt;Span Text="${text}"&gt;&lt;Style FontFamily="${font}" FontSize="${size}" FontIsBold="${bold}" ForegroundColor="${color}" /&gt;&lt;/Span&gt;`;
  const doc = (...blocks) => `&lt;Document&gt;&lt;Content&gt;${blocks.map(b => `&lt;Block&gt;&lt;Style Justification="Left" /&gt;${b}&lt;/Block&gt;`).join('')}&lt;/Content&gt;&lt;/Document&gt;`;
  const fill = (rgb, line = '') => `<bG><solidFill><clr><srgbClr val="${rgb}" /></clr></solidFill>${line}</bG>`;
  const tm = (start, dur, until = 'true') => `<tmCtxLst version="3"><txtTmCtx start="${start}" dur="${dur}" untilEnd="${until}" /></tmCtxLst>`;
  const trig = (event, action, inner, extra = '') => `<trig type="user"${extra}><data enabled="true" event="${event}" action="${action}" ${inner}</data><condLst /></trig>`;
  const choice = (g, label, z0, y) => `<roundRect g="${g}" name="${label}" zOrder="${z0}" initState="Normal">${tm(0, 0)}<trigLst />
      <stateLst><state name="Normal"><bg><noFill /></bg><shapeLst><roundRect name="bar">${fill('0057B8')}<loc l="0" t="0" r="500" b="50" /></roundRect><rect name="t"><loc l="20" t="0" r="480" b="50" /><text>${doc(span(label, 15, 'lt1,00'))}</text><plain>${label}</plain></rect></shapeLst></state>
        <state name="Selected"><bg /><shapeLst><roundRect name="bar2">${fill('00B9E8')}<loc l="0" t="0" r="500" b="50" /></roundRect><rect name="t2"><loc l="20" t="0" r="480" b="50" /><text>${doc(span(label, 15, 'lt1,00'))}</text><plain>${label}</plain></rect></shapeLst></state></stateLst>
      <loc l="100" t="${y}" r="600" b="${y + 50}" /></roundRect>`;
  z.file('[Content_Types].xml', '<Types/>');
  z.file('story/story.xml', `<story><varLst><var g="v1" name="Player.Volume" dataType="num" val="1" type="builtIn" /><var g="v2" name="Clicks" dataType="num" val="0" type="user" /></varLst>
    <mediaLst><media g="m1" type="Png" bytes="${PNG.length}"><md5Checksum><stream>x</stream><source>y</source></md5Checksum></media></mediaLst>
    <sceneLst><scene g="sc1" name="Main scene"><sldIdLst><sldId>R1</sldId><sldId>R2</sldId><sldId>R3</sldId></sldIdLst></scene></sceneLst><props><sz w="1366" h="768" /></props></story>`);
  z.file('story/_rels/story.xml.rels', '<Relationships><Relationship Type="slide" Target="/story/slides/slide.xml" Id="R1" /><Relationship Type="slide" Target="/story/slides/slide2.xml" Id="R2" /><Relationship Type="slide" Target="/story/slides/slide3.xml" Id="R3" /></Relationships>');
  z.file('story/media/Rpic.png', PNG);
  // Slide 1: a header with rich text (two looks), a tab drawn by its states that shows a layer, a picture, a blocker
  // for 1 s, notes; a disabled trigger and one on a variable that isn't in the file (both do nothing in Storyline).
  z.file('story/slides/slide.xml', `<sld g="s1" name="Pick a tab"><bg><solidFill><clr><srgbClr val="F4F6FA" /></clr></solidFill></bg><shapeLst>
    <rect g="o1" name="Header" zOrder="0" vertAlign="ctr">${tm(0, 0)}<trigLst />${fill('00388F')}<loc l="0" t="0" r="1366" b="80" /><textMargin l="10" t="0" r="10" b="0" /><text>${doc(span('Module 1: ', 24, '#FFD200', 'True', 'Aptos ExtraBold') + span('Safety', 24, 'lt1,00'))}</text><plain>Module 1: Safety</plain></rect>
    <rect g="o2" name="Tab A" zOrder="1" initState="Normal">${tm(500, 0)}<trigLst>
        ${trig('OnClick', 'showSubSlide', 'actSubType="spec"><shape setStateName="" /><sldLayer showG="L1" /><other op="ass" />')}
        ${trig('OnClick', 'adjustVar', 'actSubType="spec"><shape setStateName="" /><sldLayer /><other varG="v2" op="add" dblVal="1" />')}
        ${trig('OnClick', 'adjustVar', 'actSubType="spec"><shape setStateName="" /><sldLayer /><other varG="v2" op="add" dblVal="5" />').replace('enabled="true"', 'enabled="false"')}
        ${trig('OnVariableValueChange', 'PauseTimeline', 'actSubType="me"><shape setStateName="" /><sldLayer /><other varChangeG="gone-var" />')}
      </trigLst>
      <stateLst><state name="Normal"><bg><noFill /></bg><shapeLst><rect name="bgA">${fill('0057B8')}<loc l="0" t="0" r="300" b="60" /></rect><rect name="labelA"><loc l="10" t="0" r="290" b="60" /><text>${doc(span('Tab A', 18, 'lt1,00'))}</text><plain>Tab A</plain></rect></shapeLst><trigLst>${trig('OnClick', 'showSubSlide', 'actSubType="spec"><shape setStateName="" /><sldLayer showG="L1" /><other op="ass" />')}</trigLst></state>
        <state name="Selected"><bg /><shapeLst><rect name="bgA2">${fill('00B9E8')}<loc l="0" t="0" r="300" b="60" /></rect><rect name="labelA2"><loc l="10" t="0" r="290" b="60" /><text>${doc(span('Tab A', 18, 'lt1,00'))}</text><plain>Tab A</plain></rect></shapeLst></state></stateLst>
      ${fill('D8DCE1')}<loc l="100" t="150" r="520" b="234" /></rect>
    <pic g="o3" name="Photo" zOrder="2" assetG="m1">${tm(0, 0)}<trigLst /><loc l="900" t="150" r="1100" b="350" /></pic>
    <clkAreaRect g="o4" name="Blocker" zOrder="3" initState="">${tm(0, 1000, 'false')}<trigLst /><loc l="0" t="100" r="1366" b="400" /></clkAreaRect>
  </shapeLst><trigLst>${trig('OnNextButtonClick', 'jumpToSlide', 'actSubType="next" NavigationIntent="Next"><shape setStateName="" /><sldLayer /><other op="ass" />')}</trigLst>
  <note>${doc(span('Say hello to the learners', 12, '#000000'))}</note>
  <sldLayerLst>
    <sldLayer g="L1" name="Details"><shapeLst><rect g="o5" name="Panel" zOrder="0">${tm(0, 0)}<trigLst>${trig('OnClick', 'hideSubSlide', 'actSubType="me"><shape setStateName="" /><sldLayer hideG="L1" /><other op="ass" />')}</trigLst>${fill('FFFFFF', '<solidLine><clr><srgbClr val="00388F" /></clr></solidLine><lineStyle w="1.5" />')}<loc l="100" t="300" r="800" b="600" /><text>${doc(span('Details of tab A', 20, '#1F2433'))}</text><plain>Details of tab A</plain></rect></shapeLst>
      <trigLst>${trig('OnStart', 'changeShapeState', 'actSubType="spec"><shape setStateG="o2" setStateName="Selected" /><sldLayer /><other op="ass" />')}</trigLst></sldLayer>
  </sldLayerLst></sld>`);
  // Slide 2: Next is disabled until the timeline ends (Storyline: "change the state of Next").
  z.file('story/slides/slide2.xml', `<sld g="s2" name="Wait for it"><shapeLst><rect g="w1" name="Msg" zOrder="0">${tm(0, 0)}<trigLst /><loc l="100" t="100" r="900" b="200" /><text>${doc(span('Watch this', 20, '#000000'))}</text><plain>Watch this</plain></rect></shapeLst>
    <trigLst>${trig('OnStart', 'changeShapeState', 'actSubType="next"><shape setStateName="Disabled" /><sldLayer /><other op="ass" />')}${trig('OnEnd', 'changeShapeState', 'actSubType="next"><shape setStateName="Normal" /><sldLayer /><other op="ass" />')}</trigLst>
    <tmProps min="1000" /></sld>`);
  // Slide 3: a pick-one question drawn on the slide; Submit turns on when any choice is selected; feedback layers.
  z.file('story/slides/slide3.xml', `<sld g="s3" name="Quiz"><shapeLst>
    ${choice('c1', 'Right answer', 0, 150)}${choice('c2', 'Wrong answer', 1, 220)}
    <roundRect g="sub" name="Submit" zOrder="2" initState="Disabled">${tm(0, 0)}<trigLst>
        <trig type="user"><data enabled="true" event="OnStateChange" action="changeShapeState" actSubType="next"><shape setStateG="sub" setStateName="Normal" stateInclude="any" statesNot="are" stateName="Selected"><stateLst><g>c1</g><g>c2</g></stateLst></shape><sldLayer /><other op="ass" /></data><condLst /></trig>
        ${trig('OnClick', 'submitInteraction', 'actSubType="next"><shape setStateName="" /><sldLayer /><other op="ass" />')}
      </trigLst><stateLst><state name="Disabled"><bg /></state></stateLst>${fill('0D2B4F')}<loc l="100" t="320" r="300" b="370" /><text>${doc(span('Submit', 15, '#FFFFFF'))}</text><plain>Submit</plain></roundRect>
    <freePickOneIntr g="q1" zOrder="3"><loc l="0" t="0" r="1366" b="768" /><intrProps corPts="10" corFbG="F1" incFbG="F2" tryFbG="F3" attempts="two" /><choices>
      <intrFreeChoice shpG="c1"><scoringData correct="true" /></intrFreeChoice><intrFreeChoice shpG="c2"><scoringData correct="false" /></intrFreeChoice></choices></freePickOneIntr>
  </shapeLst><trigLst /><sldLayerLst>
    <feedBackLayer g="F1" name=""><shapeLst><rect g="f1" name="ok" zOrder="0">${tm(0, 0)}<trigLst />${fill('E6F6EF')}<loc l="700" t="150" r="1200" b="300" /><text>${doc(span('Correct!', 24, '#0F6B52'))}</text><plain>Correct!</plain></rect></shapeLst><trigLst /></feedBackLayer>
    <feedBackLayer g="F2" name=""><shapeLst><rect g="f2" name="no" zOrder="0">${tm(0, 0)}<trigLst />${fill('FDECEC')}<loc l="700" t="150" r="1200" b="300" /><text>${doc(span('Incorrect', 24, '#A8322A'))}</text><plain>Incorrect</plain></rect></shapeLst><trigLst /></feedBackLayer>
    <feedBackLayer g="F3" name="Try Again"><shapeLst><rect g="f3" name="again" zOrder="0">${tm(0, 0)}<trigLst>${trig('OnClick', 'hideSubSlide', 'actSubType="me"><shape setStateName="" /><sldLayer hideG="F3" /><other op="ass" />')}</trigLst>${fill('FFF4E5')}<loc l="700" t="150" r="1200" b="300" /><text>${doc(span('Try again', 24, '#8A4A12'))}</text><plain>Try again</plain></rect></shapeLst><trigLst /></feedBackLayer>
  </sldLayerLst></sld>`);
  const buf = await z.generateAsync({ type: 'nodebuffer' });

  await page.getByRole('navigation', { name: 'Files' }).getByRole('button', { name: /^Course Studio/ }).click();
  await page.locator('.cs-new', { hasText: 'Import a course' }).click();
  await page.getByLabel('Course to import').setInputFiles({ name: 'Course.story', mimeType: 'application/octet-stream', buffer: buf });
  await expect(page.getByRole('toolbar', { name: 'Course tools' })).toBeVisible();
  const note = page.locator('.sl-import');
  await expect(note).toContainText('3 slides, 4 layers');
  await expect(note).toContainText('1 quiz question and the notes of 1 slide');
  await expect(note).toContainText('2 triggers that do nothing in Storyline either');
  await expect(note).toContainText('All 13 triggers in the file are accounted for.');
  await note.getByRole('button', { name: 'Details' }).click();
  await expect(page.getByRole('dialog', { name: 'What didn’t come over' })).toContainText('turned off in Storyline');
  await expect(page.getByRole('dialog', { name: 'What didn’t come over' })).toContainText('points at something not in the file');
  await page.getByRole('button', { name: 'Done' }).click();
  await expect(page.locator('.sl-status')).toContainText('1366 × 768');

  // Slide 1 in the editor: rich text, a tab drawn by its Normal state, the picture, the notes.
  await page.getByRole('button', { name: /^Slide 1\.1: Pick a tab/ }).dblclick();
  await expect(page.locator('.cv-stage .cv-o[data-name="Header"] span').first()).toHaveCSS('color', 'rgb(255, 210, 0)');
  await expect(page.locator('.cv-stage .cv-o[data-name="Header"] span').first()).toHaveCSS('font-weight', '700');
  await expect(page.locator('.cv-stage .cv-o[data-name="Header"] span').nth(1)).toHaveCSS('color', 'rgb(255, 255, 255)');
  const tab = page.locator('.cv-stage .cv-o[data-name="Tab A"]');
  await expect(tab).toHaveCSS('left', '100px');
  await expect(tab.locator('.cv-part').first()).toHaveCSS('background-color', 'rgb(0, 87, 184)');
  await expect(tab).toContainText('Tab A');
  await expect(page.locator('.cv-stage .cv-o[data-name="Photo"] img')).toHaveAttribute('src', /^data:image\//);
  await page.locator('.sl-bottom').getByRole('tab', { name: 'Notes' }).click();
  await expect(page.getByLabel('Slide notes')).toHaveValue('Say hello to the learners');

  // The whole course in the player.
  await page.getByRole('button', { name: 'Preview', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Entire project' }).click();
  const p = page.frameLocator('iframe[title="Course preview"]');
  await page.waitForTimeout(1300); // the blocker goes after 1 s
  await p.locator('.cp-o', { hasText: /^Tab A$/ }).click();
  await expect(p.getByText('Details of tab A')).toBeVisible();
  await expect(p.locator('.cp-o', { hasText: /^Tab A$/ }).locator('.cp-part').first()).toHaveCSS('background-color', 'rgb(0, 185, 232)'); // Selected
  await expect(p.locator('.cp-o', { hasText: 'Details of tab A' })).toHaveCSS('border-top-color', 'rgb(0, 56, 143)');
  await p.locator('.cp-o', { hasText: 'Details of tab A' }).click();
  await expect(p.getByText('Details of tab A')).toHaveCount(0);
  // Slide 2: Next is off until its timeline (1 s) ends.
  await p.getByRole('button', { name: 'Next ›' }).click();
  await expect(p.getByText('Watch this')).toBeVisible();
  await expect(p.getByRole('button', { name: 'Next ›' })).toBeDisabled();
  await expect(p.getByRole('button', { name: 'Next ›' })).toBeEnabled({ timeout: 4000 });
  await p.getByRole('button', { name: 'Next ›' }).click();
  // Slide 3: the question. Submit turns on when a choice is picked; wrong → Try again; right → Correct.
  const submit = p.locator('.cp-o', { hasText: /^Submit$/ });
  await expect(submit).toHaveClass(/cp-disabled/);
  await p.locator('.cp-o', { hasText: /^Wrong answer$/ }).click();
  await expect(submit).not.toHaveClass(/cp-disabled/);
  await submit.click();
  await expect(p.getByText('Try again')).toBeVisible();
  await p.locator('.cp-o', { hasText: /^Try again$/ }).click();
  await p.locator('.cp-o', { hasText: /^Right answer$/ }).click();
  await expect(p.locator('.cp-o', { hasText: /^Wrong answer$/ }).locator('.cp-part').first()).toHaveCSS('background-color', 'rgb(0, 87, 184)'); // pick one: the other is cleared
  await submit.click();
  await expect(p.getByText('Correct!')).toBeVisible();
});

// The ribbon folds to its tabs and each panel hides; the editor remembers both.
test('the ribbon folds and every panel can be hidden, and stays so', async ({ page }) => {
  await studio(page, 'Interactive sample');
  const ribbon = page.getByRole('toolbar', { name: 'Course tools' });
  await page.getByRole('button', { name: 'Collapse the ribbon' }).click();
  await expect(ribbon).toHaveCount(0);
  await page.getByRole('tab', { name: 'INSERT' }).click(); // a tab opens it again
  await expect(ribbon.getByRole('button', { name: 'Text Box' })).toBeVisible();
  await page.getByRole('tab', { name: 'INSERT' }).dblclick(); // double-click folds it
  await expect(ribbon).toHaveCount(0);

  await page.getByRole('button', { name: /^Slide 2\.1:/ }).dblclick();
  const box = async () => (await page.locator('.cv-stage-box').boundingBox()).width;
  const before = await box();
  await page.getByRole('button', { name: 'Slide list panel' }).click();
  await expect(page.getByRole('complementary', { name: 'Slides' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Hide the right panel' }).click();
  await expect(page.getByRole('complementary', { name: 'Properties' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Hide the Timeline panel' }).click();
  await expect(page.locator('.sl-bottom')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Focus on the slide' })).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(box).toBeGreaterThan(before * 1.3); // the slide gets the room

  // Remembered after a reload.
  await page.reload();
  await page.getByRole('navigation', { name: 'Files' }).getByRole('button', { name: /^Course Studio/ }).click();
  await page.locator('.cs-card').first().click();
  await expect(page.getByRole('tablist', { name: 'Ribbon' })).toBeVisible();
  await expect(ribbon).toHaveCount(0);
  await expect(page.locator('.sl-bottom')).toHaveCount(0);
  await page.getByRole('button', { name: 'Focus on the slide' }).click(); // everything back
  await expect(page.getByRole('complementary', { name: 'Slides' })).toBeVisible();
  await expect(page.getByRole('complementary', { name: 'Properties' })).toBeVisible();
  await expect(page.locator('.sl-bottom')).toBeVisible();
});
