import { test, expect } from '@playwright/test';

// The doc, as in Word: ribbon formatting, tables, pages, comments, tracked changes, find and replace,
// header and page numbers, .docx out and back in, and the Markdown kept beside it (search finds it).

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    if (sessionStorage.getItem('seeded')) return;
    localStorage.clear();
    localStorage.setItem('linework:local-mode', '1');
    localStorage.setItem('linework:ai-open', '0');
    sessionStorage.setItem('seeded', '1');
  });
  await page.goto('/');
});

test('a Word-like doc: format, tables, pages, comments, tracked changes, find, .docx', async ({ page }, info) => {
  test.setTimeout(90_000);
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.getByRole('button', { name: 'Write a Design Doc' }).click();
  const doc = page.locator('.wd-doc');
  await expect(doc.locator('h1')).toHaveText('Design doc: Untitled');
  await doc.click();
  await page.keyboard.press('Control+a');
  await page.keyboard.press('Delete');
  const tab = n => page.locator('.wr-tab', { hasText: new RegExp(`^${n}$`) });
  // Select a word: find it, and close the find bar (the match stays selected).
  const select = async word => {
    await page.keyboard.press('Control+f');
    await page.getByRole('textbox', { name: 'Find', exact: true }).fill(word);
    await page.getByRole('textbox', { name: 'Find', exact: true }).press('Enter');
    await page.getByRole('button', { name: 'Close find' }).click();
  };
  await expect(page.locator('.wd-sheet')).toHaveCount(1);
  await expect(page.locator('.wd-status')).toContainText('Page 1 of 1');

  // Styles and fonts from the Home tab.
  await page.getByRole('button', { name: 'Heading 1', exact: true }).click();
  await page.keyboard.type('Quarterly plan');
  await page.keyboard.press('Enter');
  await page.keyboard.type('We will ship the zebrafish feature soon. ');
  await page.keyboard.press('Control+b');
  await page.keyboard.type('Bold words');
  await page.keyboard.press('Control+b');
  await expect(doc.locator('h1')).toHaveText('Quarterly plan');
  await expect(doc.locator('strong')).toHaveText('Bold words');
  await page.getByLabel('Font size').fill('18');
  await page.keyboard.type(' big');
  await expect(doc.locator('span[style*="font-size: 18pt"]')).toContainText('big');

  // A table from Insert, and the Table tab while inside it.
  await tab('Insert').click();
  await page.getByRole('button', { name: 'Table', exact: true }).click();
  await page.getByRole('button', { name: '3 by 2' }).click();
  await expect(doc.locator('table tr')).toHaveCount(2);
  await expect(tab('Table')).toBeVisible();
  await tab('Table').click();
  await page.getByRole('button', { name: 'Row below' }).click();
  await expect(doc.locator('table tr')).toHaveCount(3);

  // A page break starts page 2; the header and page numbers show on each page.
  await doc.locator('p').last().click();
  await page.keyboard.press('Control+End');
  await page.keyboard.press('Control+Enter');
  await page.keyboard.type('On the second page.');
  await expect(page.locator('.wd-sheet')).toHaveCount(2);
  await tab('Layout').click();
  await page.getByPlaceholder('Text at the top of each page').fill('Acme · Confidential');
  await expect(page.locator('.wd-hd').first()).toHaveText('Acme · Confidential');
  await expect(page.locator('.wd-ft').nth(1)).toContainText('Page 2 of 2');

  // A comment on a word.
  await select('zebrafish');
  await tab('Review').click();
  await page.getByRole('button', { name: 'New comment' }).click();
  await page.getByRole('dialog').getByRole('textbox').fill('Is this the right name?');
  await page.getByRole('dialog').getByRole('button', { name: 'Comment' }).click();
  await expect(doc.locator('.wd-comment')).toHaveText('zebrafish');
  await expect(page.locator('.wd-cm')).toContainText('Is this the right name?');

  // Tracked changes: typing is marked as inserted, deleting as deleted, until accepted.
  await page.getByRole('button', { name: 'Track changes' }).click();
  await doc.getByText('On the second page.').click();
  await page.keyboard.press('End');
  await page.keyboard.type(' Added later');
  await expect(doc.locator('ins.wd-ins')).toContainText('Added later');
  await page.keyboard.press('Backspace');
  await expect(doc.locator('ins.wd-ins')).toContainText('Added late');
  await select('soon');
  await page.keyboard.press('Delete');
  await expect(doc.locator('del.wd-del')).toHaveText('soon');
  await expect(page.locator('.wd-chg')).toHaveCount(2);
  await page.getByRole('button', { name: 'Accept all changes' }).click();
  await expect(doc.locator('ins.wd-ins, del.wd-del')).toHaveCount(0);
  await expect(doc).not.toContainText('soon');
  await page.getByRole('button', { name: 'Tracking: on' }).click();

  // Find and replace.
  await page.keyboard.press('Control+h');
  await page.getByRole('textbox', { name: 'Find', exact: true }).fill('Bold');
  await expect(page.locator('.wd-find-bar')).toContainText('1 of 1');
  await page.getByLabel('Replace with').fill('Strong');
  await page.getByRole('button', { name: 'Replace all' }).click();
  await expect(doc.locator('strong')).toHaveText('Strong words');
  await page.getByRole('button', { name: 'Close find' }).click();

  // Out as a Word file and back in.
  await page.getByRole('button', { name: 'File', exact: true }).click();
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Save as Word (.docx)' }).click()]);
  expect(download.suggestedFilename()).toMatch(/\.docx$/);
  const path = info.outputPath('doc.docx');
  await download.saveAs(path);
  await page.getByRole('button', { name: 'File', exact: true }).click();
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Open a Word file (.docx)…' }).click();
  await (await chooser).setFiles(path);
  await page.getByRole('dialog').getByRole('button', { name: 'Replace' }).click();
  await expect(doc.locator('h1')).toHaveText('Quarterly plan');
  await expect(doc.locator('table')).toHaveCount(1);
  await expect(doc).toContainText('Strong words');

  // Web layout: one long page.
  await tab('View').click();
  await page.getByRole('button', { name: 'Web layout' }).click();
  await expect(page.locator('.wd-sheet')).toHaveCount(0);
  await page.getByRole('button', { name: 'Print layout' }).click();

  // Saved: open it again from Files; the Markdown kept beside it is searchable.
  await page.waitForTimeout(800);
  await page.getByRole('button', { name: 'Files' }).click();
  await page.getByLabel('Search files').fill('zebrafish');
  await expect(page.locator('.ftable tbody tr')).toHaveCount(1);
  await page.locator('.ftable tbody tr').first().click();
  await expect(page.locator('.wd-doc h1')).toHaveText('Quarterly plan');
  await expect(page.locator('.wd-doc table')).toHaveCount(1);
  expect(errors).toEqual([]);
});
