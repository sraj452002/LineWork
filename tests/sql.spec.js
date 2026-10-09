import { test, expect } from '@playwright/test';
import { readSql, sqlToErd, erdToSql } from '../src/lib/sql.js';

// SQL files → database schema diagrams: the reader, and opening .sql files from Tools and the canvas.

const PG_DUMP = `--
-- PostgreSQL database dump
--
SET statement_timeout = 0;
CREATE TYPE public.status AS ENUM ('open', 'closed');
CREATE TABLE public.users (
    id integer NOT NULL,
    email character varying(255) NOT NULL,
    created_at timestamp(6) with time zone DEFAULT now(),
    balance numeric(10, 2) DEFAULT 0.00,
    tags text[],
    note text DEFAULT 'a, (b); c'
);
CREATE TABLE public.posts (id bigint NOT NULL, user_id integer, title text, status public.status);
CREATE TABLE public.post_tags (post_id bigint NOT NULL, tag_id int NOT NULL);
CREATE TABLE public.tags (id serial PRIMARY KEY, name text UNIQUE);
CREATE FUNCTION public.f() RETURNS trigger AS $$ BEGIN CREATE TABLE ghost (x int); END; $$ LANGUAGE plpgsql;
ALTER TABLE ONLY public.users ADD CONSTRAINT users_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.posts
    ADD CONSTRAINT posts_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.users ADD CONSTRAINT users_email_key UNIQUE (email);
ALTER TABLE ONLY public.post_tags ADD CONSTRAINT post_tags_pkey PRIMARY KEY (post_id, tag_id);
ALTER TABLE ONLY public.posts
    ADD CONSTRAINT posts_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.post_tags ADD CONSTRAINT a FOREIGN KEY (post_id) REFERENCES public.posts(id);
ALTER TABLE ONLY public.post_tags ADD CONSTRAINT b FOREIGN KEY (tag_id) REFERENCES public.tags(id);
COPY public.users (id, email) FROM stdin;
`;
const MYSQL_DUMP = `/*!40101 SET NAMES utf8mb4 */;
DROP TABLE IF EXISTS \`orders\`;
CREATE TABLE \`customers\` (
  \`id\` int unsigned NOT NULL AUTO_INCREMENT,
  \`key\` varchar(64) NOT NULL COMMENT 'api key, (secret)',
  \`name\` varchar(100) CHARACTER SET utf8mb4,
  PRIMARY KEY (\`id\`),
  UNIQUE KEY \`key_UNIQUE\` (\`key\`),
  KEY \`idx_name\` (\`name\`)
) ENGINE=InnoDB AUTO_INCREMENT=5 DEFAULT CHARSET=utf8mb4;
CREATE TABLE \`orders\` (
  \`id\` int NOT NULL AUTO_INCREMENT,
  \`customer_id\` int unsigned NOT NULL,
  \`total\` decimal(10,2) DEFAULT NULL,
  \`status\` enum('new','paid') DEFAULT 'new',
  PRIMARY KEY (\`id\`),
  KEY \`fk_c\` (\`customer_id\`),
  CONSTRAINT \`fk_c\` FOREIGN KEY (\`customer_id\`) REFERENCES \`customers\` (\`id\`) ON DELETE CASCADE
) ENGINE=InnoDB;
INSERT INTO \`orders\` VALUES (1,1,'9.99','new'),(2,1,'CREATE TABLE nope (a int);','paid');
`;

test('reads pg_dump output: keys added later, types with sizes, arrays, enums; skips functions and data', () => {
  const r = readSql(PG_DUMP);
  expect(r.tables).toBe(4);
  expect(r.rels).toBe(3);
  expect(r.code).toContain('users {\n  id integer pk\n  email varchar(255) unique\n  created_at timestamptz\n  balance numeric(10,2)\n  tags text[]\n  note text\n}');
  expect(r.code).toContain('  status status\n');
  expect(r.code).toContain('post_tags {\n  post_id bigint pk,fk\n  tag_id int pk,fk\n}');
  expect(r.code).toContain('posts.user_id > users.id');
  expect(r.code).not.toContain('ghost');
});

test('reads mysqldump, SQLite and SQL Server scripts', () => {
  const my = readSql(MYSQL_DUMP).code;
  expect(my).toContain('customers {\n  id int pk\n  key varchar(64) unique\n  name varchar(100)\n}');
  expect(my).toContain('  status enum\n');
  expect(my).toContain('orders.customer_id > customers.id');
  expect(my).not.toContain('nope');

  const lite = sqlToErd(`CREATE TABLE artists(ArtistId INTEGER PRIMARY KEY AUTOINCREMENT, Name NVARCHAR(120));
CREATE TABLE IF NOT EXISTS "albums" ([AlbumId] INTEGER NOT NULL, [ArtistId] INTEGER NOT NULL,
  CONSTRAINT [PK_Album] PRIMARY KEY ([AlbumId]), FOREIGN KEY ([ArtistId]) REFERENCES "artists" ([ArtistId]));
CREATE TABLE tracks (id integer primary key, album_id integer references albums, key varchar(10), name text);`);
  expect(lite).toContain('tracks.album_id > albums.AlbumId'); // REFERENCES with no column: the table's primary key
  expect(lite).toContain('  key varchar(10)\n'); // a column called "key" isn't mistaken for an index
  expect(lite).toContain('albums.ArtistId > artists.ArtistId');

  const ms = sqlToErd(`CREATE TABLE [dbo].[Departments] ([DepartmentID] INT IDENTITY(1,1) NOT NULL, [Name] NVARCHAR(MAX),
  CONSTRAINT [PK_Departments] PRIMARY KEY CLUSTERED ([DepartmentID] ASC));
GO
CREATE TABLE [dbo].[Employees] ([EmployeeID] INT IDENTITY(1,1) PRIMARY KEY, [DepartmentID] INT NULL, [Salary] DECIMAL(18, 2));
GO
ALTER TABLE [dbo].[Employees] WITH CHECK ADD CONSTRAINT [FK_E_D] FOREIGN KEY([DepartmentID]) REFERENCES [dbo].[Departments] ([DepartmentID]);`);
  expect(ms).toContain('Departments {\n  DepartmentID int pk\n  Name nvarchar(max)\n}');
  expect(ms).toContain('  Salary decimal(18,2)\n');
  expect(ms).toContain('Employees.DepartmentID > Departments.DepartmentID');
});

test('follows migrations in order, and marks one-to-one keys', () => {
  const code = sqlToErd(`CREATE TABLE accounts (id uuid primary key, label text, legacy int);
CREATE TABLE profiles (account_id uuid UNIQUE REFERENCES accounts, avatar text);
ALTER TABLE accounts ADD COLUMN email text NOT NULL, ADD INDEX idx_email (email);
ALTER TABLE accounts DROP COLUMN label;
ALTER TABLE accounts RENAME COLUMN legacy TO legacy_id;
CREATE UNIQUE INDEX accounts_email ON accounts (email);
CREATE TABLE old_stuff (id int);
DROP TABLE old_stuff;`);
  expect(code).toContain('accounts {\n  id uuid pk\n  legacy_id int\n  email text unique\n}');
  expect(code).toContain('profiles.account_id - accounts.id');
  expect(code).not.toContain('old_stuff');
  expect(readSql('SELECT 1; INSERT INTO x VALUES (1);')).toBeNull();
  // And back out again.
  expect(erdToSql(code)).toContain('ALTER TABLE profiles ADD FOREIGN KEY (account_id) REFERENCES accounts (id);');
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
  });
  test.afterEach(async () => { expect(test.info().errors_, 'page errors').toEqual([]); });
  const sqlFile = (name, text) => ({ name, mimeType: 'application/sql', buffer: Buffer.from(text) });

  test('Tools → Open a .sql file draws the schema in a new file named after it', async ({ page }) => {
    await page.getByRole('navigation', { name: 'Files' }).getByRole('button', { name: /^Tools/ }).click();
    const chooser = page.waitForEvent('filechooser');
    await page.locator('.tool-card').filter({ hasText: 'Open a .sql file' }).click();
    await (await chooser).setFiles(sqlFile('shop.sql', MYSQL_DUMP));
    await expect(page.getByRole('group', { name: 'View' }).getByRole('button', { name: 'Canvas' })).toHaveAttribute('aria-pressed', 'true');
    const svg = page.locator('.canvaspane svg').first();
    await expect(svg).toContainText('customers');
    await expect(svg).toContainText('varchar(64)');
    await expect(page.getByText('Drew 2 tables and 1 relationship')).toBeVisible();
    await expect(page.getByRole('textbox', { name: 'File name' })).toHaveValue('shop');
  });

  test('on the canvas: Insert → Database schema from SQL, and dropping a .sql file', async ({ page }) => {
    await page.getByRole('button', { name: 'Create a Blank File' }).click();
    await page.getByRole('group', { name: 'View' }).getByRole('button', { name: 'Canvas' }).click();
    await page.getByRole('button', { name: 'Insert (/)' }).click();
    const ins = page.getByRole('dialog', { name: 'Insert' });
    await ins.getByRole('button', { name: /Database schema from SQL/ }).click();
    const chooser = page.waitForEvent('filechooser');
    await ins.getByRole('button', { name: /Open a \.sql file/ }).click();
    await (await chooser).setFiles(sqlFile('blog.sql', PG_DUMP));
    await expect(page.getByText('Imported 4 tables and 3 relationships from blog.sql')).toBeVisible();
    const svg = page.locator('.canvaspane svg').first();
    await expect(svg).toContainText('post_tags');
    await expect(svg).toContainText('timestamptz');

    // A second file, dropped on the canvas, goes into a new tab.
    const dt = await page.evaluateHandle(text => { const d = new DataTransfer(); d.items.add(new File([text], 'shop.sql', { type: 'application/sql' })); return d; }, MYSQL_DUMP);
    await page.locator('.cwrap').dispatchEvent('drop', { dataTransfer: dt });
    await expect(page.getByText('Imported 2 tables and 1 relationship from shop.sql into a new tab')).toBeVisible();
    await expect(svg).toContainText('customers');
  });
});
