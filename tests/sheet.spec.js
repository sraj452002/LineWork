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

  const cell = (page, a) => page.locator(`.sv-grid td[data-a="${a}"]`);

  test('the Sheet view: edit cells, formulas update, fill, copy and paste, undo, sort, CSV', async ({ page }) => {
    await page.getByRole('button', { name: 'Start from an example' }).click();
    await expect(cell(page, 'D6')).toHaveText('959');
    await expect(page.getByRole('tab', { name: /Budget/ })).toHaveAttribute('aria-selected', 'true');

    // Type over a cell; the total follows.
    await cell(page, 'B2').click();
    await expect(page.getByLabel('Cell', { exact: true })).toHaveText('B2');
    await page.keyboard.type('5');
    await page.keyboard.press('Enter');
    await expect(cell(page, 'D2')).toHaveText('600');
    await expect(cell(page, 'D6')).toHaveText('1079');
    await expect(page.getByLabel('Cell', { exact: true })).toHaveText('B3'); // Enter moves down

    // The formula bar shows a formula, and suggests functions while writing one.
    await cell(page, 'D6').click();
    await expect(page.getByLabel('Cell contents')).toHaveValue('=SUM(D2:D5)');
    await cell(page, 'E2').click();
    await page.keyboard.type('=B2*C2*1.1');
    await page.keyboard.press('Enter');
    await expect(cell(page, 'E2')).toHaveText('660');
    await cell(page, 'E7').click();
    await page.keyboard.type('=AVER');
    await expect(page.locator('.sv-hint')).toContainText('AVERAGE');
    await page.keyboard.type('AGE(D2:D5)');
    await page.keyboard.press('Enter');
    await expect(cell(page, 'E7')).toHaveText('269.75');

    // Ctrl D fills E2's formula down, shifting its references.
    await cell(page, 'E2').click();
    await cell(page, 'E5').click({ modifiers: ['Shift'] });
    await expect(page.locator('.sv-stats')).toContainText('Count 1');
    await page.keyboard.press('Control+d');
    await expect(cell(page, 'E3')).toHaveText('253');
    await expect(cell(page, 'E5')).toHaveText('53.9');
    await expect(page.locator('.sv-stats')).toContainText('Sum 1,186.9');

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
    await cell(page, 'G1').click();
    await page.keyboard.type('=1/0');
    await page.keyboard.press('Enter');
    await expect(cell(page, 'G1')).toHaveText('#DIV/0!');
    await expect(cell(page, 'G1')).toHaveClass(/err/);

    // Sort the table by price, from the cell menu.
    await cell(page, 'C2').click({ button: 'right' });
    await page.getByRole('menuitem', { name: /Sort Z → A/ }).click();
    await expect(cell(page, 'A2')).toHaveText('CDN');
    await expect(cell(page, 'D2')).toHaveText('200'); // its formula moved with the row

    // Bold and a currency format.
    await cell(page, 'D6').click();
    await page.keyboard.press('Control+b');
    await page.getByLabel('Number format').selectOption('$');
    await expect(cell(page, 'D6')).toHaveCSS('font-weight', '700');
    await expect(cell(page, 'D6')).toHaveText(/^\$1,079\.00$/);

    // Export as CSV.
    const dl = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Export CSV' }).click();
    const file = await dl;
    expect(file.suggestedFilename()).toBe('Budget.csv');
    expect(readFileSync(await file.path(), 'utf8')).toMatch(/^Item,Qty,Price,Total/);

    // A second sheet, as a tab.
    await page.getByRole('button', { name: 'Add a sheet' }).click();
    await expect(page.getByRole('tab', { name: 'Sheet 2' })).toHaveAttribute('aria-selected', 'true');
    await expect(cell(page, 'A1')).toHaveText('');
  });

  test('a sheet on the canvas follows its cells, and opens in the Sheet view', async ({ page }) => {
    await page.getByRole('button', { name: 'Start from an example' }).click();
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
