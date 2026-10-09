import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { display, evaluate, fromCSV, shiftFormula, toCSV } from '../src/lib/sheet.js';

// Spreadsheets: the formula engine, the Sheet view, and sheets shown on the canvas.

test('formulas: arithmetic, functions, ranges, text, errors and cycles', () => {
  const s = { cells: {
    A1: '10', A2: '20%', A3: '1,200', A4: 'apple',
    B1: '=A1*2+1', B2: '=SUM(A1:A3)', B3: '=AVERAGE(A1,A3)', B4: '=IF(A1>5,"big","small")', B5: '=A4&"s"',
    B6: '=ROUND(A3/7,2)', B7: '=SUMIF(A1:A3,">5")', B8: '=COUNTIF(A1:A4,"apple")', B9: '=VLOOKUP("Y",D1:E2,2,FALSE)',
    B10: '=1/0', B11: '=B12', B12: '=B11', B13: '=NOPE(1)', B14: '=A4+1', B15: '=IFERROR(1/0,"none")', B16: '=(1+2',
    D1: 'x', E1: '1', D2: 'y', E2: '2',
  } };
  const v = evaluate(s), at = a => display(v(a));
  expect([1, 2, 3, 4, 5, 6, 7, 8, 9].map(i => at('B' + i))).toEqual(['21', '1210.2', '605', 'big', 'apples', '171.43', '1210', '1', '2']);
  expect([10, 11, 12, 13, 14, 15, 16].map(i => at('B' + i))).toEqual(['#DIV/0!', '#CYCLE!', '#CYCLE!', '#NAME?', '#VALUE!', 'none', '#ERROR!']);
  expect(shiftFormula('=A1+$B$1+C$1+$D1+"A1"', 1, 2)).toBe('=B3+$B$1+D$1+$D3+"A1"');
  expect(shiftFormula('=A1', -1, 0)).toBe('=#REF!');
  const csv = toCSV({ cells: { A1: 'a,b', B1: '=1+1', A2: 'say "hi"' } });
  expect(csv).toBe('"a,b",2\n"say ""hi""",\n');
  expect(fromCSV(csv).cells).toEqual({ A1: 'a,b', B1: '2', A2: 'say "hi"' });
});

test.describe('in the app', () => {
  test.beforeEach(async ({ page }) => {
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    test.info().errors_ = errors;
    await page.addInitScript(() => {
      if (sessionStorage.getItem('seeded')) return;
      localStorage.clear();
      localStorage.setItem('linework:local-mode', '1');
      localStorage.setItem('linework:ai-open', '0');
      sessionStorage.setItem('seeded', '1');
    });
    await page.goto('/');
    await page.getByRole('button', { name: 'Create a Blank File' }).click();
    await page.getByRole('group', { name: 'View' }).getByRole('button', { name: 'Sheet' }).click();
  });
  test.afterEach(async () => { expect(test.info().errors_, 'page errors').toEqual([]); });

  const cell = (page, a) => page.locator(`.xl-grid td[data-a="${a}"]`);
  const nameBox = page => page.getByLabel('Name box');
  const ribbonTab = (page, n) => page.getByRole('tablist', { name: 'Ribbon' }).getByRole('tab', { name: n, exact: true });
  const type = async (page, a, text) => { await cell(page, a).click(); await page.keyboard.type(text); await page.keyboard.press('Enter'); };
  // Drag the fill handle of the selection to cell `to`.
  const dragFill = async (page, to) => {
    const h = await page.locator('.xl-handle').boundingBox(), t = await cell(page, to).boundingBox();
    await page.mouse.move(h.x + 3, h.y + 3);
    await page.mouse.down();
    await page.mouse.move(t.x + t.width / 2, t.y + t.height / 2, { steps: 8 });
    await page.mouse.up();
  };

  test('the Sheet view: edit cells, formulas update, fill, copy and paste, undo, sort, CSV', async ({ page }) => {
    await page.getByRole('button', { name: 'Start from an example' }).click();
    await expect(cell(page, 'D6')).toHaveText('959');
    await expect(page.getByRole('tab', { name: /Budget/ })).toHaveAttribute('aria-selected', 'true');
    // Looks like Excel: the ribbon's Home tab, the formula bar and the header fill.
    await expect(ribbonTab(page, 'Home')).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByRole('group', { name: 'Clipboard' })).toBeVisible();
    await expect(cell(page, 'A1')).toHaveCSS('background-color', 'rgb(219, 233, 225)');

    // Type over a cell; the total follows.
    await cell(page, 'B2').click();
    await expect(nameBox(page)).toHaveValue('B2');
    await page.keyboard.type('5');
    await page.keyboard.press('Enter');
    await expect(cell(page, 'D2')).toHaveText('600');
    await expect(cell(page, 'D6')).toHaveText('1079');
    await expect(nameBox(page)).toHaveValue('B3'); // Enter moves down

    // The formula bar shows a formula, and suggests functions while writing one.
    await cell(page, 'D6').click();
    await expect(page.getByLabel('Cell contents')).toHaveValue('=SUM(D2:D5)');
    await type(page, 'E2', '=B2*C2*1.1');
    await expect(cell(page, 'E2')).toHaveText('660');
    await cell(page, 'E7').click();
    await page.keyboard.type('=AVER');
    await expect(page.locator('.xl-hint')).toContainText('AVERAGE');
    await page.keyboard.type('AGE(D2:D5'); // the missing bracket is closed for you
    await page.keyboard.press('Enter');
    await expect(cell(page, 'E7')).toHaveText('269.75');

    // Ctrl D fills E2's formula down, shifting its references; the status bar sums the selection.
    await cell(page, 'E2').click();
    await cell(page, 'E5').click({ modifiers: ['Shift'] });
    await expect(nameBox(page)).toHaveValue('E2:E5');
    await page.keyboard.press('Control+d');
    await expect(cell(page, 'E3')).toHaveText('253');
    await expect(cell(page, 'E5')).toHaveText('53.9');
    await expect(page.locator('.xl-stats')).toContainText('Sum: 1,186.9');
    await expect(page.locator('.xl-stats')).toContainText('Count: 4');

    // Copy a formula and paste it elsewhere: references move with it.
    await cell(page, 'D2').click();
    await page.keyboard.press('Control+c');
    await cell(page, 'F3').click();
    await page.keyboard.press('Control+v');
    await expect(page.getByLabel('Cell contents')).toHaveValue('=D3*E3');

    // Delete, and undo it.
    await cell(page, 'F3').click();
    await page.keyboard.press('Delete');
    await expect(cell(page, 'F3')).toHaveText('');
    await page.keyboard.press('Control+z');
    await expect(cell(page, 'F3')).not.toHaveText('');

    // Errors show in the cell.
    await type(page, 'G1', '=1/0');
    await expect(cell(page, 'G1')).toHaveText('#DIV/0!');
    await expect(cell(page, 'G1')).toHaveClass(/err/);

    // Sort the table by price, from the cell menu.
    await cell(page, 'C2').click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Sort', exact: true }).click();
    await page.getByRole('menuitem', { name: /Z → A/ }).click();
    await expect(cell(page, 'A2')).toHaveText('CDN');
    await expect(cell(page, 'D2')).toHaveText('200'); // its formula moved with the row

    // Bold (the total already is, so Ctrl B turns it off), italic and a currency format.
    await cell(page, 'D6').click();
    await expect(cell(page, 'D6')).toHaveCSS('font-weight', '700');
    await page.keyboard.press('Control+b');
    await page.keyboard.press('Control+i');
    await page.getByLabel('Number format').selectOption('$');
    await expect(cell(page, 'D6')).toHaveCSS('font-weight', '400');
    await expect(cell(page, 'D6')).toHaveCSS('font-style', 'italic');
    await expect(page.getByRole('button', { name: 'Italic (Ctrl I)' })).toHaveAttribute('aria-pressed', 'true');
    await expect(cell(page, 'D6')).toHaveText(/^\$1,079\.00$/);
    await page.getByRole('button', { name: 'Increase decimal' }).click();
    await expect(cell(page, 'D6')).toHaveText(/^\$1,079\.000$/);

    // Export as CSV, from File.
    await ribbonTab(page, 'File').click();
    const dl = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download .csv' }).click();
    const file = await dl;
    expect(file.suggestedFilename()).toBe('Budget.csv');
    expect(readFileSync(await file.path(), 'utf8')).toMatch(/^Item,Qty,Price,Total/);

    // A second sheet, as a tab.
    await page.getByRole('button', { name: 'Add a sheet' }).click();
    await expect(page.getByRole('tab', { name: 'Sheet 2' })).toHaveAttribute('aria-selected', 'true');
    await expect(cell(page, 'A1')).toHaveText('');
  });

  test('Excel behaviours: fill series, dates, cross-sheet formulas, insert rows, merge, freeze, filter, find & replace', async ({ page }) => {
    await page.getByRole('button', { name: 'Blank workbook' }).click();

    // The fill handle continues a series: 1, 2 → 3, 4, 5; Mon → Tue, Wed; a formula's references shift.
    await type(page, 'A1', '1');
    await type(page, 'A2', '2');
    await type(page, 'B1', 'Mon');
    await type(page, 'C1', '=A1*10');
    await cell(page, 'A1').click();
    await cell(page, 'A2').click({ modifiers: ['Shift'] });
    await dragFill(page, 'A5');
    await expect(cell(page, 'A5')).toHaveText('5');
    await cell(page, 'B1').click();
    await dragFill(page, 'B3');
    await expect(cell(page, 'B3')).toHaveText('Wed');
    // Double-clicking the handle fills down as far as the data in the column beside it (B1:B3).
    await cell(page, 'C1').click();
    await page.locator('.xl-handle').dblclick();
    await expect(cell(page, 'C3')).toHaveText('30');
    await expect(cell(page, 'C4')).toHaveText('');

    // Typed dates and percents get a format, and date maths works.
    await type(page, 'D1', '2026-03-15');
    await type(page, 'D2', '=D1+30');
    await type(page, 'D3', '=TEXT(D2,"dddd")');
    await type(page, 'D4', '12.5%');
    await expect(cell(page, 'D2')).toHaveText('14-04-2026');
    await expect(cell(page, 'D3')).toHaveText('Tuesday');
    await expect(cell(page, 'D4')).toHaveText('12.50%');

    // A formula reads another sheet; renaming that sheet keeps it working.
    await page.getByRole('button', { name: 'Add a sheet' }).click();
    await type(page, 'A1', "='Sheet 1'!A5*2");
    await expect(cell(page, 'A1')).toHaveText('10');
    await page.getByRole('tab', { name: 'Sheet 1' }).dblclick();
    await page.getByRole('textbox').last().fill('Data');
    await page.getByRole('button', { name: 'Rename' }).click();
    await page.getByRole('tab', { name: 'Sheet 2' }).click();
    await cell(page, 'A1').click();
    await expect(page.getByLabel('Cell contents')).toHaveValue('=Data!A5*2');
    await expect(cell(page, 'A1')).toHaveText('10');

    // Inserting a row moves the data, and formulas everywhere follow it.
    await page.getByRole('tablist', { name: 'Sheets' }).getByRole('tab', { name: 'Data' }).click();
    await cell(page, 'A2').click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Insert', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Rows above' }).click();
    await expect(cell(page, 'A6')).toHaveText('5');
    await expect(cell(page, 'A2')).toHaveText('');
    await page.getByRole('tab', { name: 'Sheet 2' }).click();
    await cell(page, 'A1').click();
    await expect(page.getByLabel('Cell contents')).toHaveValue('=Data!A6*2');
    await page.getByRole('tablist', { name: 'Sheets' }).getByRole('tab', { name: 'Data' }).click();

    // Merge & Center.
    await type(page, 'F1', 'Report');
    await cell(page, 'F1').click();
    await cell(page, 'H1').click({ modifiers: ['Shift'] });
    await page.getByRole('button', { name: 'Merge & Center' }).click();
    await page.getByRole('menuitem', { name: 'Merge & Center', exact: true }).click();
    await expect(cell(page, 'F1')).toHaveAttribute('colspan', '3');
    await expect(cell(page, 'G1')).toHaveCount(0);

    // Freeze the top row: it stays put when scrolling.
    await ribbonTab(page, 'View').click();
    await page.getByRole('button', { name: 'Freeze Panes' }).click();
    await page.getByRole('menuitem', { name: 'Freeze top row' }).click();
    await expect(cell(page, 'A1')).toHaveCSS('position', 'sticky');
    await page.locator('.xl-grid').evaluate(g => { g.scrollTop = 600; });
    const head = await cell(page, 'A1').boundingBox(), grid = await page.locator('.xl-grid').boundingBox();
    expect(head.y - grid.y).toBeLessThan(60);

    // A filter hides rows by value.
    await page.locator('.xl-grid').evaluate(g => { g.scrollTop = 0; });
    await ribbonTab(page, 'Home').click();
    for (const [a, v] of [['J1', 'Team'], ['J2', 'Red'], ['J3', 'Blue'], ['J4', 'Red'], ['K1', 'Score'], ['K2', '3'], ['K3', '4'], ['K4', '5']]) await type(page, a, v);
    await cell(page, 'J2').click();
    await page.keyboard.press('Control+Shift+l');
    await page.getByRole('button', { name: 'Filter J' }).click();
    const menu = page.getByRole('dialog', { name: 'Filter' });
    await menu.getByLabel('Blue').uncheck();
    await menu.getByRole('button', { name: 'OK' }).click();
    await expect(cell(page, 'J3')).toHaveCount(0);
    await expect(page.locator('.xl-status')).toContainText('1 row hidden');
    await page.keyboard.press('Control+Shift+l');
    await expect(cell(page, 'J3')).toHaveText('Blue');

    // Find & Replace.
    await page.keyboard.press('Control+h');
    const find = page.getByRole('dialog', { name: 'Find and Replace' });
    await find.getByLabel('Find what').fill('Red');
    await find.getByLabel('Replace with').fill('Green');
    await find.getByRole('button', { name: 'Replace All' }).click();
    await expect(find.getByRole('status')).toHaveText('Replaced 2 cells.');
    await expect(cell(page, 'J4')).toHaveText('Green');
    await find.getByRole('button', { name: 'Close' }).click();
  });

  test('charts, and .xlsx files saved and opened again', async ({ page }) => {
    await page.getByRole('button', { name: 'Start from an example' }).click();

    // Insert → Column chart of the table.
    await cell(page, 'A2').click();
    await ribbonTab(page, 'Insert').click();
    await page.getByRole('button', { name: 'Column', exact: true }).click();
    const chart = page.getByRole('figure', { name: /Chart/ });
    await expect(chart.locator('svg rect')).not.toHaveCount(0);
    await expect(chart).toContainText('Servers');
    await chart.getByLabel('Chart type').selectOption('pie');
    await expect(chart.locator('svg path').first()).toBeVisible();
    await chart.getByRole('button', { name: 'Delete chart' }).click();
    await expect(chart).toHaveCount(0);

    // A cross-sheet formula and some formatting, saved as .xlsx…
    await page.getByRole('button', { name: 'Add a sheet' }).click();
    await type(page, 'A1', '=Budget!D6*2');
    await type(page, 'A2', '2026-01-31');
    await expect(cell(page, 'A1')).toHaveText('1918');
    await page.getByRole('tab', { name: /Budget/ }).click();
    await ribbonTab(page, 'File').click();
    const dl = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download .xlsx' }).click();
    const file = await dl;
    expect(file.suggestedFilename()).toMatch(/\.xlsx$/);
    const path = await file.path();
    expect(readFileSync(path).subarray(0, 2).toString()).toBe('PK');

    // …and opened again: both sheets come back, with formulas, formats and dates.
    await page.locator('.xl input[type=file]').setInputFiles({ name: 'budget.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: readFileSync(path) });
    await expect(page.getByRole('tab', { name: /Budget \(2\)/ })).toHaveAttribute('aria-selected', 'true');
    await expect(cell(page, 'D6')).toHaveText('959');
    await cell(page, 'D6').click();
    await expect(page.getByLabel('Cell contents')).toHaveValue('=SUM(D2:D5)');
    await expect(cell(page, 'A1')).toHaveCSS('font-weight', '700');
    await expect(cell(page, 'A1')).toHaveCSS('background-color', 'rgb(219, 233, 225)');
    await page.getByRole('tab', { name: 'Sheet 2 (2)' }).click();
    await expect(cell(page, 'A2')).toHaveText('31-01-2026');
    await cell(page, 'A1').click();
    await expect(page.getByLabel('Cell contents')).toHaveValue('=Budget!D6*2');
  });

  test('a sheet on the canvas follows its cells, and opens in the Sheet view', async ({ page }) => {
    await page.getByRole('button', { name: 'Start from an example' }).click();
    await ribbonTab(page, 'File').click();
    await page.getByRole('button', { name: 'Show on canvas' }).click();
    await expect(page.getByRole('group', { name: 'View' }).getByRole('button', { name: 'Canvas' })).toHaveAttribute('aria-pressed', 'true');
    const block = page.locator('.canvaspane g[data-shape]').filter({ hasText: 'Budget' });
    await expect(block).toContainText('Monitoring');
    await expect(block).toContainText('959');

    // Double-click opens it; a change shows on the canvas.
    await block.dblclick();
    await expect(page.getByRole('group', { name: 'View' }).getByRole('button', { name: 'Sheet' })).toHaveAttribute('aria-pressed', 'true');
    await cell(page, 'C5').click();
    await page.keyboard.type('51');
    await page.keyboard.press('Enter');
    await page.getByRole('group', { name: 'View' }).getByRole('button', { name: 'Canvas' }).click();
    await expect(block).toContainText('961');

    // The canvas's Insert panel adds a new, empty sheet too.
    await page.getByRole('button', { name: 'Insert (/)' }).click();
    const ins = page.getByRole('dialog', { name: 'Insert' });
    await ins.getByRole('button', { name: /Spreadsheet/ }).click();
    await ins.getByRole('button', { name: /New sheet/ }).click();
    await expect(page.locator('.canvaspane g[data-shape]').filter({ hasText: 'Sheet 2' })).toHaveCount(1);
  });
});
