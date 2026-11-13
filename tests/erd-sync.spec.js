import { test, expect } from '@playwright/test';
import { followRenames } from '../frontend/src/lib/erdcode.js';

// Database schema diagrams: the code and the diagram stay in step. Renaming a table or column in the code
// renames it in the relationships too (even when the name is cleared and typed again), so the diagram
// keeps its lines; a table only a relationship names can be merged into a real one from its toolbar.
const CODE = `title: Company Schema
Employes [icon: users, color: blue] {
  id uuid pk
  name text
  created_at timestamptz
}
users [icon: user, color: blue] {
  id uuid pk
  team_id uuid fk
  email text unique
  name text
}
projects [icon: folder, color: green] {
  id uuid pk
  team_id uuid fk
  title text
}
tasks [icon: check, color: orange] {
  id uuid pk
  project_id uuid fk
  assignee_id uuid fk
}

users.team_id > Employes.id
projects.team_id > Employes.id
tasks.project_id > projects.id
tasks.assignee_id > users.id`;
test('renames in the code follow into the relationships', () => {
  const base = 'teams {\n  id uuid pk\n}\nusers {\n  id uuid pk\n  team_id uuid fk\n}\nusers.team_id > teams.id\nprojects > teams';
  const pending = {};
  let cur = base;
  for (const name of ['team', 'tea', 'te', 't', '', 'E', 'Em', 'Employes']) cur = followRenames(cur, cur.replace(/^\S* \{/, `${name} {`), pending);
  expect(cur).toContain('users.team_id > Employes.id\nprojects > Employes');
  expect(followRenames(cur, cur.replace('team_id uuid fk', 'dept_id uuid fk'), {})).toContain('users.dept_id > Employes.id');
  // A line added or removed: nothing is renamed.
  expect(followRenames(base, base.replace('teams {', 'staff {\n  name text'), {})).toContain('> teams.id');
});

test('typing a new table name in the code keeps the diagram connected', async ({ page }) => {
  await page.addInitScript(code => {
    if (sessionStorage.getItem('seeded')) return; sessionStorage.setItem('seeded', '1');
    localStorage.clear(); localStorage.setItem('linework:local-mode', '1'); localStorage.setItem('linework:ai-open', '0');
    const now = Date.now();
    localStorage.setItem('linework:files:v2', JSON.stringify([{ id: 'f1', title: 'Database', created: now, updated: now, doc: '', diagrams: [{ id: 'd1', type: 'erd', name: 'Company', code }], active: 0, view: 'canvas' }]));
  }, CODE);
  await page.goto('/');
  await page.getByText('Database').first().click();
  await page.waitForTimeout(1500);
  await page.locator('[data-node="Employes"]').click({ position: { x: 30, y: 12 } });
  await page.getByRole('button', { name: 'Code', exact: true }).first().click({ timeout: 3000 }).catch(() => { /* the code may be open already */ });
  const ta = page.getByLabel('Diagram code');
  await expect(ta).toBeVisible();
  // put the caret right after "Employes" on line 2, delete it, type a new name key by key
  await ta.evaluate(t => { const i = t.value.indexOf('Employes') + 'Employes'.length; t.focus(); t.selectionStart = t.selectionEnd = i; });
  for (let i = 0; i < 'Employes'.length; i++) await page.keyboard.press('Backspace');
  await page.keyboard.type('Staff');
  await page.keyboard.type(' ');
  await page.keyboard.press('Backspace');
  await page.waitForTimeout(600);
  const code = await ta.inputValue();
  expect(code).toContain('users.team_id > Staff.id');
  expect(code).toContain('Staff [icon: users, color: blue] {');
  expect(await ta.evaluate(t => t.selectionStart)).toBe(code.indexOf('Staff') + 5);
  // A table only a relationship names (“no columns”), merged into Staff from its toolbar.
  await ta.evaluate(t => { t.focus(); t.selectionStart = t.selectionEnd = t.value.length; });
  await page.keyboard.type('\ntasks > Ghost');
  await expect(page.locator('[data-node="Ghost"]')).toBeVisible();
  await page.locator('[data-node="Ghost"]').click({ position: { x: 30, y: 12 } });
  const f = page.getByLabel('Table name');
  await f.fill('Staff'); await f.press('Enter');
  await expect(page.locator('[data-node="Ghost"]')).toHaveCount(0);
  expect(await ta.inputValue()).toContain('tasks > Staff');
});

test('toolbar edits show in the code as they’re typed, and a line drawn between tables is a relationship', async ({ page }) => {
  await page.addInitScript(code => {
    if (sessionStorage.getItem('seeded')) return; sessionStorage.setItem('seeded', '1');
    localStorage.clear(); localStorage.setItem('linework:local-mode', '1'); localStorage.setItem('linework:ai-open', '0');
    const now = Date.now();
    localStorage.setItem('linework:files:v2', JSON.stringify([{ id: 'f1', title: 'Database', created: now, updated: now, doc: '', diagrams: [{ id: 'd1', type: 'erd', name: 'Company', code }], active: 0, view: 'canvas' }]));
  }, CODE);
  await page.goto('/');
  await page.getByText('Database').first().click();
  await page.locator('[data-node="users"]').click({ position: { x: 30, y: 12 } });
  await page.getByRole('button', { name: 'Code', exact: true }).first().click({ timeout: 3000 }).catch(() => { /* the code may be open already */ });
  const ta = page.getByLabel('Diagram code');
  await page.locator('[data-node="users"]').click({ position: { x: 30, y: 12 } });
  // The table's name, typed key by key without pressing Enter: the code and the diagram follow each key.
  const name = page.getByLabel('Table name');
  await name.click(); await name.press('End');
  await name.pressSequentially('_x');
  await expect(page.locator('[data-node="users_x"]')).toBeVisible();
  expect(await ta.inputValue()).toContain('tasks.assignee_id > users_x.id');
  await expect(name).toBeFocused();
  await expect(name).toHaveValue('users_x');
  await name.press('Enter');

  // A line dragged from one table's port to another table: a relationship in the code.
  await page.locator('[data-node="tasks"]').hover({ position: { x: 30, y: 12 } });
  const port = page.locator('[data-connector-node="tasks"][data-connector-side="out"]');
  const a = await port.boundingBox(), b = await page.locator('[data-node="Employes"]').boundingBox();
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width / 2, b.y + 20, { steps: 12 });
  await page.mouse.up();
  await expect.poll(() => ta.inputValue()).toContain('tasks > Employes');
  await expect(page.locator('[data-node]')).toHaveCount(4); // no new drawing, no new table
  await page.screenshot({ path: 'test-results/erd-live.png' });
});
