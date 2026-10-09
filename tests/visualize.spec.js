import { test, expect } from '@playwright/test';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

// The theme switch, and Code → Visualize: diagrams of the code, and stepping through a recorded run.
// Python is real (Pyodide's files come from the pyodide npm package instead of the CDN).

const PYODIDE_DIR = join(process.cwd(), 'node_modules/pyodide');

test.beforeEach(async ({ page }) => {
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  test.info().errors_ = errors;
  await page.route('https://cdn.jsdelivr.net/pyodide/**', route => {
    const f = join(PYODIDE_DIR, new URL(route.request().url()).pathname.split('/').pop());
    if (!existsSync(f)) return route.fulfill({ status: 404, body: 'not here' });
    const type = f.endsWith('.wasm') ? 'application/wasm' : /\.m?js$/.test(f) ? 'text/javascript' : f.endsWith('.json') ? 'application/json' : 'application/octet-stream';
    return route.fulfill({ status: 200, body: readFileSync(f), headers: { 'content-type': type, 'access-control-allow-origin': '*' } });
  });
  await page.addInitScript(() => {
    if (sessionStorage.getItem('seeded')) return;
    localStorage.clear();
    localStorage.setItem('linework:local-mode', '1');
    localStorage.setItem('linework:ai-open', '0');
    sessionStorage.setItem('seeded', '1');
  });
  await page.goto('/');
});
test.afterEach(async () => {
  expect(test.info().errors_, 'page errors').toEqual([]);
});

const JS = `class Shape {
  constructor(name) { this.name = name; }
  area() { return 0; }
}

class Square extends Shape {
  constructor(side) { super('square'); this.side = side; }
  area() { return this.side * this.side; }
}

function total(shapes) {
  let sum = 0;
  for (const s of shapes) {
    if (s.area() > 10) sum += s.area();
    else sum += 1;
  }
  return sum;
}

const shapes = [new Square(2), new Square(4)];
console.log('total', total(shapes));
`;

const PY = `class Account:
    def __init__(self, owner):
        self.owner = owner
        self.balance = 0

    def deposit(self, amount):
        self.balance += amount
        return self.balance


def run():
    acc = Account("ada")
    for x in [5, 8]:
        acc.deposit(x)
    print("total", acc.balance)


run()
`;

const codeView = async (page, files) => {
  await page.getByRole('button', { name: 'Create a Blank File' }).click();
  await page.getByRole('button', { name: /^View:/ }).click();
  await page.getByRole('menuitemradio', { name: /^Code/ }).click();
  await page.locator('.cw input[type=file]').setInputFiles(files.map(([name, text]) => ({ name, mimeType: 'text/plain', buffer: Buffer.from(text) })));
  await expect(page.locator('.cw-tab.on')).toContainText(files[files.length - 1][0], { timeout: 20000 });
  await page.getByRole('button', { name: 'Visualize' }).click();
};

test('the theme button switches between light, dark and the system setting, and remembers it', async ({ page }) => {
  const theme = () => page.evaluate(() => document.documentElement.dataset.theme || 'system');
  await page.getByRole('button', { name: /^Theme:/ }).click();
  await page.getByRole('menuitemradio', { name: 'Dark' }).click();
  expect(await theme()).toBe('dark');
  expect(await page.evaluate(() => getComputedStyle(document.documentElement).colorScheme)).toContain('dark');
  await page.reload();
  expect(await theme()).toBe('dark');
  // The editor has the button too.
  await page.getByRole('button', { name: 'Create a Blank File' }).click();
  await page.getByRole('button', { name: 'Theme: Dark' }).click();
  await page.getByRole('menuitemradio', { name: 'Light' }).click();
  expect(await theme()).toBe('light');
  await page.getByRole('button', { name: 'Theme: Light' }).click();
  await page.getByRole('menuitemradio', { name: 'System' }).click();
  expect(await theme()).toBe('system');
});

test('Visualize JavaScript: flowchart, classes, imports, open on canvas, and step through', async ({ page }) => {
  await codeView(page, [['util.js', 'export const twice = x => x * 2;\n'], ['shapes.js', "import { twice } from './util.js';\n" + JS]]);
  const viz = page.getByRole('complementary', { name: 'Visualize' });

  // Flowchart of a function: the decision and the loop are drawn.
  await viz.getByLabel('Function').selectOption('total');
  const svg = viz.locator('.viz-svg svg');
  await expect(svg).toContainText('for (const s of shapes)');
  await expect(svg).toContainText('s.area() > 10?');
  await expect(svg).toContainText('return sum');

  // Classes: both, with inheritance.
  await viz.getByRole('button', { name: 'Classes' }).click();
  await expect(svg).toContainText('Square');
  await expect(svg).toContainText('extends');
  await expect(svg).toContainText('side');

  // Imports: shapes.js → util.js.
  await viz.getByRole('button', { name: 'Imports' }).click();
  await expect(svg).toContainText('shapes.js');
  await expect(svg).toContainText('util.js');

  // Step through: each step highlights its line, with the stack, variables and output so far.
  await viz.getByRole('tab', { name: 'Step through' }).click();
  await viz.getByRole('button', { name: 'Record a run' }).click();
  await expect(viz.locator('.viz-where')).toContainText('Step 1', { timeout: 15000 });
  await expect(page.locator('.monaco-editor .cw-stepline')).toHaveCount(1);
  const steps = Number((await viz.locator('.viz-where').textContent()).match(/of (\d+)/)[1]);
  expect(steps).toBeGreaterThan(15);
  await viz.getByRole('button', { name: 'Last step' }).click();
  await expect(viz.locator('.viz-out pre').first()).toHaveText('total 17\n');
  // Find a step inside total(): the stack shows it over the whole file, with its variables.
  for (let k = 0; k < steps; k++) {
    if (await viz.locator('.viz-stack li').count() > 1 && await viz.locator('.viz-vars th', { hasText: /^sum$/ }).count()) break;
    await viz.getByRole('button', { name: 'Previous step' }).click();
  }
  await expect(viz.locator('.viz-stack li').first()).toContainText('total');
  await expect(viz.locator('.viz-vars')).toContainText('shapes');

  // A diagram can go onto the canvas as a new tab.
  await viz.getByRole('tab', { name: 'Structure' }).click();
  await viz.getByRole('button', { name: 'Classes' }).click();
  await viz.getByRole('button', { name: 'Open on canvas' }).click();
  await expect(page.getByRole('button', { name: 'View: Canvas' })).toBeVisible();
  await expect(page.getByText('Classes', { exact: true }).first()).toBeVisible();
});

test('Visualize Python: classes and step through a real run', async ({ page }) => {
  test.setTimeout(120_000);
  await codeView(page, [['bank.py', PY]]);
  const viz = page.getByRole('complementary', { name: 'Visualize' });
  await expect(viz.getByLabel('Function')).toBeVisible({ timeout: 60_000 });
  await viz.getByLabel('Function').selectOption('run');
  await expect(viz.locator('.viz-svg svg')).toContainText(/for x in .5, 8./);
  await viz.getByRole('button', { name: 'Classes' }).click();
  await expect(viz.locator('.viz-svg svg')).toContainText('Account');
  await expect(viz.locator('.viz-svg svg')).toContainText('balance');

  await viz.getByRole('tab', { name: 'Step through' }).click();
  await viz.getByRole('button', { name: 'Record a run' }).click();
  await expect(viz.locator('.viz-where')).toContainText('Step 1', { timeout: 60_000 });
  await expect(page.locator('.monaco-editor .cw-stepline')).toHaveCount(1);
  await viz.getByRole('button', { name: 'Last step' }).click();
  await expect(viz.locator('.viz-out pre').first()).toHaveText('total 13\n');
  await viz.getByRole('button', { name: 'First step' }).click();
  // Walk forward until deposit() is running.
  for (let k = 0; k < 40 && !(await viz.locator('.viz-stack li').first().textContent()).includes('deposit'); k++)
    await viz.getByRole('button', { name: 'Next step' }).click();
  await expect(viz.locator('.viz-stack li').first()).toContainText('deposit');
  await expect(viz.locator('.viz-vars')).toContainText('amount');
  await expect(viz.locator('.viz-vars')).toContainText("Account(owner='ada'");
});
