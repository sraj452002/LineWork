import { test, expect } from '@playwright/test';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import initSqlJs from 'sql.js';
import { handle, isPrivateIp, mongoCommand, parseConn } from '../backend/dbconnect.js';
import { schemaToErd, shortType } from '../frontend/src/lib/dbclient.js';
import { openStore } from '../backend/store.js';
import { memoryBackend } from '../backend/drive.js';
import { createApp } from '../backend/app.js';

// Live databases (the Database view): the connector's parsing and safety checks, the server's /api/db, a SQLite
// file opened in the browser, and real PostgreSQL / MySQL / SQL Server databases when these are set:
//   LINEWORK_TEST_PG=postgres://user:pw@localhost/shop   LINEWORK_TEST_MYSQL=mysql://user:pw@127.0.0.1/shop
//   LINEWORK_TEST_MSSQL='Server=localhost,1433;Database=shop;User ID=sa;Password=…;TrustServerCertificate=True'
// Each needs the shop tables from SHOP_SQL below (the tests create them).

const SHOP_SQL = [
  'DROP TABLE IF EXISTS order_items', 'DROP TABLE IF EXISTS orders', 'DROP TABLE IF EXISTS products', 'DROP TABLE IF EXISTS customers',
  'CREATE TABLE customers (id int primary key, name varchar(100) not null, email varchar(200) unique, created date)',
  'CREATE TABLE products (id int primary key, title varchar(100), price decimal(10,2))',
  'CREATE TABLE orders (id int primary key, customer_id int references customers(id), placed date)',
  'CREATE TABLE order_items (order_id int references orders(id), product_id int references products(id), qty int, primary key (order_id, product_id))',
  "INSERT INTO customers VALUES (1,'Ada','ada@x.com','2026-01-02'),(2,'Linus','linus@x.com','2026-02-03'),(3,'Grace',null,'2026-03-04')",
  "INSERT INTO products VALUES (1,'Keyboard',49.90),(2,'Mouse',19.50)",
  "INSERT INTO orders VALUES (1,1,'2026-04-01'),(2,2,'2026-04-02')",
  'INSERT INTO order_items VALUES (1,1,2),(1,2,1),(2,2,3)',
];

test('connection strings, private addresses and MongoDB commands', async () => {
  expect(parseConn({ type: 'postgres', url: 'postgres://ada:p%40ss@db.example.com:6543/shop?sslmode=verify-full' }))
    .toMatchObject({ host: 'db.example.com', port: 6543, database: 'shop', user: 'ada', password: 'p@ss', ssl: 'verify' });
  expect(parseConn({ type: 'mysql', url: 'mysql://root@h.example.com/app?ssl=false' })).toMatchObject({ host: 'h.example.com', port: 3306, ssl: 'off' });
  expect(parseConn({ type: 'mssql', url: 'Server=tcp:x.database.windows.net,1433;Initial Catalog=sales;User ID=me;Password=pw;Encrypt=True;' }))
    .toMatchObject({ host: 'x.database.windows.net', port: 1433, database: 'sales', user: 'me', password: 'pw', ssl: 'verify' });
  expect(parseConn({ type: 'mongodb', url: 'mongodb+srv://u:p@cluster0.ab.mongodb.net/shop' })).toMatchObject({ srv: true, database: 'shop', hosts: [{ host: 'cluster0.ab.mongodb.net' }] });
  expect(() => parseConn({ type: 'oracle' })).toThrow();

  for (const ip of ['10.1.2.3', '127.0.0.1', '169.254.169.254', '172.20.0.1', '192.168.1.1', '100.64.0.1', '::1', 'fd00::1', 'fe80::1', '::ffff:10.0.0.1']) expect(isPrivateIp(ip), ip).toBe(true);
  for (const ip of ['8.8.8.8', '52.1.2.3', '2606:4700::1111']) expect(isPrivateIp(ip), ip).toBe(false);
  // The server refuses databases on its own network unless told otherwise.
  await expect(handle({ op: 'test', conn: { type: 'postgres', url: 'postgres://u:p@localhost/x' } })).rejects.toMatchObject({ code: 'private_host', status: 403 });
  await expect(handle({ op: 'test', conn: { type: 'mysql', host: '169.254.169.254', user: 'x' } })).rejects.toMatchObject({ code: 'private_host' });
  await expect(handle({ op: 'drop', conn: { type: 'postgres', host: 'db.example.com' } })).rejects.toMatchObject({ code: 'bad_op' });
  await expect(handle({ op: 'delete', conn: { type: 'postgres', host: 'db.example.com', readOnly: true } })).rejects.toMatchObject({ code: 'read_only' });

  const { EJSON } = createRequire(import.meta.resolve('../backend/package.json'))('mongodb').BSON; // the backend's own copy
  const cmd = t => EJSON.serialize(mongoCommand(t, EJSON));
  expect(cmd("db.users.find({age: {$gt: 30}, name: 'Ada'}).limit(5)")).toEqual({ find: 'users', filter: { age: { $gt: 30 }, name: 'Ada' }, limit: 5 });
  expect(cmd('db.orders.aggregate([{$group: {_id: "$status", n: {$sum: 1}}}])')).toEqual({ aggregate: 'orders', pipeline: [{ $group: { _id: '$status', n: { $sum: 1 } } }], cursor: {} });
  expect(cmd('db.users.deleteOne({_id: ObjectId("64b7f0c2a1b2c3d4e5f60718")})')).toEqual({ delete: 'users', deletes: [{ q: { _id: { $oid: '64b7f0c2a1b2c3d4e5f60718' } }, limit: 1 }] });
  expect(cmd('{ "count": "users" }')).toEqual({ count: 'users' });
  expect(() => mongoCommand('drop everything', EJSON)).toThrow();
});

test('a live schema becomes diagram code', () => {
  expect(['character varying(255)', 'timestamp(6) with time zone', 'int(11) unsigned', "enum('a','b')", 'double precision'].map(shortType))
    .toEqual(['varchar(255)', 'timestamptz', 'int', 'enum', 'double']);
  const tables = [
    { schema: 'public', name: 'users', kind: 'table', columns: [{ name: 'id', type: 'integer' }, { name: 'email', type: 'text' }], pk: ['id'], unique: [['email']], fks: [] },
    { schema: 'public', name: 'profiles', kind: 'table', columns: [{ name: 'user_id', type: 'integer' }], pk: ['user_id'], unique: [], fks: [{ cols: ['user_id'], refSchema: 'public', refTable: 'users', refCols: ['id'] }] },
    { schema: 'public', name: 'posts', kind: 'table', columns: [{ name: 'id', type: 'bigint' }, { name: 'author', type: 'integer' }], pk: ['id'], unique: [], fks: [{ cols: ['author'], refSchema: 'public', refTable: 'users', refCols: ['id'] }] },
    { schema: 'audit', name: 'users', kind: 'table', columns: [{ name: 'id', type: 'integer' }], pk: [], unique: [], fks: [] },
    { schema: 'public', name: 'recent', kind: 'view', columns: [{ name: 'id', type: 'integer' }], pk: [], unique: [], fks: [] },
  ];
  const code = schemaToErd(tables);
  expect(code).toContain('public_users {\n  id integer pk\n  email text unique\n}');
  expect(code).toContain('audit_users {');
  expect(code).not.toContain('recent');
  expect(code).toContain('profiles.user_id - public_users.id'); // one-to-one: the key is the whole primary key
  expect(code).toContain('posts.author > public_users.id');
  expect(schemaToErd(tables, { schemas: ['public'] })).toContain('users {\n  id integer pk');
});

/* ---- a SQLite file, opened in the browser ---- */
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
  });
  test.afterEach(async () => { expect(test.info().errors_, 'page errors').toEqual([]); });

  test('a SQLite file: schema, drawing it, browsing and editing rows, and queries', async ({ page }) => {
    test.setTimeout(60_000);
    const SQL = await initSqlJs();
    const db = new SQL.Database();
    db.exec(SHOP_SQL.filter(s => !s.startsWith('DROP')).join(';'));
    const bytes = Buffer.from(db.export());

    await page.getByRole('navigation', { name: 'Files' }).getByRole('button', { name: /^Tools/ }).click();
    await page.locator('.tool-card').filter({ hasText: 'Connect to a database' }).click();
    await expect(page.getByRole('button', { name: 'View: Database' })).toBeVisible();
    await page.getByRole('button', { name: /^SQLite file/ }).click();
    const dialog = page.getByRole('dialog', { name: 'New connection' });
    await dialog.getByLabel('SQLite file').setInputFiles({ name: 'shop.db', mimeType: 'application/vnd.sqlite3', buffer: bytes });
    await dialog.getByRole('button', { name: 'Connect', exact: true }).click();

    // The schema: tables with their keys and links.
    await expect(page.locator('.dbv-title')).toContainText('SQLite 3');
    await expect(page.getByRole('complementary', { name: 'Connections' })).toContainText('shop');
    const orders = page.locator('.dbv-card').filter({ has: page.getByRole('button', { name: 'orders', exact: true }) });
    await expect(orders).toContainText('customer_id → customers.id');
    await expect(page.locator('.dbv-sum')).toHaveText('4 tables, 3 relationships');

    // Drawn on the canvas, as a database schema diagram.
    await page.getByRole('button', { name: 'Draw these on the canvas' }).click();
    await expect(page.getByRole('button', { name: 'View: Canvas' })).toBeVisible();
    const svg = page.locator('.canvaspane svg').first();
    await expect(svg).toContainText('order_items');
    await expect(svg).toContainText('decimal(10,2)');

    // Data: rows, sorting, a filter, and editing a cell, adding and deleting a row.
    await page.getByRole('button', { name: /^View:/ }).click();
    await page.getByRole('menuitemradio', { name: /^Database/ }).click();
    await page.locator('.dbv-table', { hasText: 'customers' }).click();
    const grid = page.getByRole('table', { name: 'Rows of customers' });
    await expect(grid.locator('tbody tr')).toHaveCount(3);
    await expect(page.locator('.dbv-pager')).toContainText('1–3 of 3');
    await grid.getByRole('button', { name: /^name/ }).click();
    await expect(grid.locator('tbody tr').first()).toContainText('Ada');
    await grid.getByRole('button', { name: /^name/ }).click();
    await expect(grid.locator('tbody tr').first()).toContainText('Linus');
    await grid.locator('tbody tr', { hasText: 'Grace' }).locator('td.null').dblclick();
    await page.getByLabel('Edit email').fill('grace@x.com');
    await page.getByLabel('Edit email').press('Enter');
    await expect(grid.locator('tbody tr', { hasText: 'Grace' })).toContainText('grace@x.com');
    await page.getByRole('button', { name: 'Add row' }).click();
    await page.getByLabel('New id').fill('4');
    await page.getByLabel('New name').fill('Barbara');
    await page.getByRole('button', { name: 'Save new row' }).click();
    await expect(grid.locator('tbody tr')).toHaveCount(4);
    await grid.locator('tbody tr', { hasText: 'Barbara' }).getByRole('button', { name: 'Delete row' }).click();
    await page.getByRole('button', { name: 'Delete', exact: true }).click();
    await expect(grid.locator('tbody tr')).toHaveCount(3);
    await page.getByRole('button', { name: '+ Filter' }).click();
    await page.getByLabel('Column').selectOption('name');
    await page.getByLabel('Value').fill('li');
    await page.getByLabel('Value').press('Enter');
    await expect(grid.locator('tbody tr')).toHaveCount(1);

    // Query: a join, results into a sheet; and a change.
    await page.getByRole('tab', { name: 'Query' }).click();
    await page.getByLabel('Query').fill('select c.name, sum(i.qty) as items from customers c join orders o on o.customer_id = c.id join order_items i on i.order_id = o.id group by c.name order by items desc, c.name');
    await page.getByLabel('Query').press('Control+Enter');
    const result = page.getByRole('table', { name: 'Result 1' });
    await expect(result.locator('tbody tr')).toHaveCount(2);
    await expect(result.locator('tbody tr').first()).toContainText('Ada');
    await page.getByRole('button', { name: 'Open in a sheet' }).click();
    await expect(page.getByText('Added “Query 1” to this file’s sheets')).toBeVisible();
    await page.getByLabel('Query').fill("update products set price = price * 2 where id = 1");
    await page.getByRole('button', { name: 'Run' }).click();
    await expect(page.locator('.dbv-result')).toContainText('OK: 1 row changed');
    await page.getByLabel('Query').fill('delete from order_items');
    await page.getByRole('button', { name: 'Run' }).click();
    await expect(page.getByRole('dialog').filter({ hasText: 'Run this on the live database?' })).toBeVisible();
    await page.getByRole('button', { name: 'Cancel' }).click();

    // The changed file can be downloaded again.
    await page.getByRole('button', { name: 'Actions for shop' }).click();
    const dl = page.waitForEvent('download');
    await page.getByRole('menuitem', { name: /Download \.sqlite file/ }).click();
    const file = await dl;
    expect(file.suggestedFilename()).toBe('shop.sqlite');
    const saved = new SQL.Database(new Uint8Array(await (await import('node:fs/promises')).readFile(await file.path())));
    expect(saved.exec('select price from products where id = 1')[0].values[0][0]).toBeCloseTo(99.8);
    expect(saved.exec("select email from customers where name = 'Grace'")[0].values[0][0]).toBe('grace@x.com');
  });
});

/* ---- real databases, through the server's /api/db ---- */
const LIVE = { postgres: process.env.LINEWORK_TEST_PG, mysql: process.env.LINEWORK_TEST_MYSQL, mssql: process.env.LINEWORK_TEST_MSSQL };
for (const [type, url] of Object.entries(LIVE)) {
  test(`live ${type}: schema, rows, edits, queries and read-only`, async () => {
    test.skip(!url, `set LINEWORK_TEST_${type === 'postgres' ? 'PG' : type.toUpperCase()} to run`);
    const conn = { type, url, ssl: type === 'mssql' ? 'require' : 'off' };
    const o = { allowPrivate: true };
    const run = (op, x = {}, c = conn) => handle({ op, conn: c, ...x }, o);
    for (const s of SHOP_SQL) await run('query', { sql: type === 'mssql' ? s.replace(/^DROP TABLE IF EXISTS/, 'DROP TABLE IF EXISTS') : s });
    expect((await run('test')).version).toMatch(/PostgreSQL|MySQL|MariaDB|Microsoft SQL Server/);
    const { tables } = await run('schema');
    const t = n => tables.find(x => x.name === n);
    expect(t('customers')).toMatchObject({ pk: ['id'], unique: [['email']] });
    expect(t('order_items').pk).toEqual(['order_id', 'product_id']);
    expect(t('orders').fks).toEqual([expect.objectContaining({ cols: ['customer_id'], refTable: 'customers', refCols: ['id'] })]);
    expect(schemaToErd(tables)).toContain('orders.customer_id > customers.id');
    const table = { schema: t('customers').schema, name: 'customers' };
    expect(await run('rows', { table, sort: { col: 'name', desc: true }, limit: 2 })).toMatchObject({ columns: ['id', 'name', 'email', 'created'], total: 3, rows: [[2, 'Linus', 'linus@x.com', expect.any(String)], [3, 'Grace', null, expect.any(String)]] });
    expect((await run('rows', { table, filters: [{ col: 'name', op: 'contains', value: 'A' }] })).total).toBe(2);
    expect(await run('update', { table, key: { id: 3 }, values: { email: 'grace@x.com' } })).toEqual({ count: 1 });
    expect(await run('insert', { table, values: { id: '9', name: 'Temp' } })).toEqual({ count: 1 });
    expect(await run('delete', { table, key: { id: 9 } })).toEqual({ count: 1 });
    // A key that matches several rows changes nothing.
    await expect(run('update', { table: { schema: table.schema, name: 'order_items' }, key: { order_id: 1 }, values: { qty: '5' } })).rejects.toMatchObject({ code: 'not_unique' });
    const q = await run('query', { sql: 'select count(*) as n from order_items where qty = 5; select title from products order by title' });
    expect(q.results.map(r => r.rows)).toEqual([[[type === 'mssql' ? 0 : '0']], [['Keyboard'], ['Mouse']]]);
    await expect(run('query', { sql: "update customers set name = 'x' where id = 1" }, { ...conn, readOnly: true })).rejects.toThrow(/read-only/);
    await expect(run('query', { sql: 'select * from nope' })).rejects.toMatchObject({ code: 'db_error' });
  });
}

test('live PostgreSQL in the app, through the Workline server', async ({ browser }) => {
  test.skip(!LIVE.postgres, 'set LINEWORK_TEST_PG to run');
  test.setTimeout(120_000);
  const dir = mkdtempSync(join(tmpdir(), 'lw-db-'));
  const store = await openStore(memoryBackend());
  const srv = createApp(store, { dbAllowPrivate: true, requireVerified: false }).listen(0);
  const port = 5194;
  const vite = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--port', String(port), '--strictPort'], { cwd: 'frontend', env: { ...process.env, LINEWORK_API: `http://localhost:${srv.address().port}` }, stdio: 'ignore', detached: true });
  try {
    for (let i = 0; i < 60; i++) { try { if ((await fetch(`http://localhost:${port}`)).ok) break; } catch (e) {} await new Promise(r => setTimeout(r, 500)); }
    const page = await (await browser.newContext({ baseURL: `http://localhost:${port}` })).newPage();
    await page.goto('/');
    await page.getByRole('button', { name: 'Create an account' }).click();
    await page.getByLabel('Email').fill('db@example.com');
    await page.getByLabel('Password').fill('a long password');
    await page.getByRole('button', { name: 'Create account' }).click();
    await page.getByRole('navigation', { name: 'Files' }).getByRole('button', { name: /^Tools/ }).click();
    await page.locator('.tool-card').filter({ hasText: 'Connect to a database' }).click();
    await page.getByRole('button', { name: /^PostgreSQL/ }).click();
    const dialog = page.getByRole('dialog', { name: 'New connection' });
    await dialog.getByLabel('Name').fill('Shop');
    await dialog.getByLabel('Connection string').fill(LIVE.postgres);
    await dialog.getByLabel('Secure connection (SSL)').selectOption('off');
    await dialog.getByRole('button', { name: 'Test' }).click();
    await expect(dialog.getByRole('status')).toContainText('Connected: PostgreSQL');
    await dialog.getByRole('button', { name: 'Connect', exact: true }).click();
    await expect(page.locator('.dbv-sum')).toContainText('4 tables, 3 relationships');
    await page.locator('.dbv-table', { hasText: 'products' }).click();
    const grid = page.getByRole('table', { name: 'Rows of products' });
    await grid.locator('tbody tr', { hasText: 'Mouse' }).locator('td', { hasText: '19.50' }).dblclick();
    await page.getByLabel('Edit price').fill('21.00');
    await page.getByLabel('Edit price').press('Enter');
    await expect(grid.locator('tbody tr', { hasText: 'Mouse' })).toContainText('21.00');
    // The password isn't stored, so after a reload it's asked for again.
    expect(await page.evaluate(() => localStorage.getItem('linework:db-connections'))).not.toContain(new URL(LIVE.postgres).password || '\u0000');
  } finally {
    try { process.kill(-vite.pid); } catch (e) { vite.kill(); }
    srv.close(); store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
