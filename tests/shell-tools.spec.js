import { test, expect } from '@playwright/test';
import { execFileSync, spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, copyFileSync, existsSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// The Terminal's extra commands (src/lib/shell/lw.cjs) are plain Node.js scripts, so they're tested
// here with Node directly, installed the way runtime.js installs them in the WebContainer.

// One scratch project, used in order (the git test changes files the others read).
test.describe.configure({ mode: 'serial' });
let root, proj, PATH;
const names = [...readFileSync('src/lib/shell/lw.cjs', 'utf8').matchAll(/^def\('([^']+)'/gm)].flatMap(m => m[1].split(' '));
test.beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'lw-shell-'));
  mkdirSync(join(root, '.lw/bin'), { recursive: true });
  copyFileSync('src/lib/shell/lw.cjs', join(root, '.lw/lw.cjs'));
  writeFileSync(join(root, '.lw/bin/package.json'), '{"type":"commonjs"}');
  for (const n of names) { const f = join(root, '.lw/bin', n); writeFileSync(f, `#!/usr/bin/env node\nrequire('../lw.cjs')(${JSON.stringify(n)});\n`); chmodSync(f, 0o755); }
  PATH = join(root, '.lw/bin') + ':' + process.env.PATH;
  proj = join(root, 'proj');
  mkdirSync(join(proj, 'src'), { recursive: true });
  mkdirSync(join(proj, 'node_modules/dep'), { recursive: true });
  writeFileSync(join(proj, 'a.txt'), 'alpha\nbeta\ngamma\nbeta\n');
  writeFileSync(join(proj, 'b.txt'), 'alpha\nBETA\ngamma\ndelta\n');
  writeFileSync(join(proj, 'src/app.js'), 'const x = 1; // TODO\n');
  writeFileSync(join(proj, 'node_modules/dep/index.js'), 'TODO in a dependency\n');
});
const strip = s => s.replace(/\x1b\[[0-9;]*m/g, '');
const sh = (cmd, input) => {
  try { return { code: 0, out: strip(execFileSync('bash', ['-c', cmd], { cwd: proj, env: { ...process.env, PATH }, input, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] })) }; }
  catch (e) { return { code: e.status, out: strip(e.stdout || ''), err: strip(e.stderr || '') }; }
};

test('text tools: head, tail, wc, grep, sort, uniq, sed, diff', () => {
  expect(sh('head -n 2 a.txt').out).toBe('alpha\nbeta\n');
  expect(sh('tail -n 1 a.txt').out).toBe('beta\n');
  expect(sh('wc -l a.txt').out.trim()).toBe('4 a.txt');
  expect(sh('cat a.txt | wc -w').out.trim()).toBe('4');
  expect(sh('grep -n beta a.txt').out).toBe('2:beta\n4:beta\n');
  expect(sh('grep -ri todo .').out).toBe('src/app.js:const x = 1; // TODO\n'); // skips node_modules
  expect(sh('grep -c beta a.txt').out).toBe('2\n');
  expect(sh('grep nothing a.txt').code).toBe(1);
  expect(sh('sort a.txt | uniq -c').out).toBe('      1 alpha\n      2 beta\n      1 gamma\n');
  expect(sh('sort -r a.txt | head -n 1').out).toBe('gamma\n');
  expect(sh("sed 's/beta/BETA/g' a.txt").out).toBe('alpha\nBETA\ngamma\nBETA\n');
  const d = sh('diff a.txt b.txt');
  expect(d.code).toBe(1);
  expect(d.out).toContain('-beta\n+BETA');
  expect(sh('curl -s nowhere.invalid | head -c 1; echo ok').out).toContain('ok'); // a closed pipe doesn't crash
});

test('file tools: find, tree, touch, du, which, seq, basename', () => {
  expect(sh('find . -name "*.js" -not-really').code).toBe(1);
  expect(sh('find src -name "*.js"').out).toBe('src/app.js\n');
  expect(sh('find . -type d -maxdepth 1').out.split('\n')).toEqual(['.', 'node_modules', 'src', '']);
  expect(sh('tree').out).toBe('.\n├── a.txt\n├── b.txt\n└── src\n    └── app.js\n\n1 directory, 3 files\n');
  sh('touch new/deep/file.txt');
  expect(existsSync(join(proj, 'new/deep/file.txt'))).toBe(true);
  expect(sh('du -sh src').out).toMatch(/^\d+B\tsrc\n$/);
  expect(sh('which grep').out).toBe(join(root, '.lw/bin/grep') + '\n');
  expect(sh('seq 3').out).toBe('1\n2\n3\n');
  expect(sh('basename /x/y/z.js .js').out).toBe('z\n');
  expect(sh(JSON.stringify(join(root, '.lw/bin/help'))).out).toContain('grep'); // bash has its own help; jsh doesn't
});

test('code asks the page to open a file, creating it if needed', () => {
  const r = sh('code notes/todo.md');
  expect(existsSync(join(proj, 'notes/todo.md'))).toBe(true);
  expect(r.out).toBe(`\x1b]7771;${JSON.stringify({ op: 'open', path: join(proj, 'notes/todo.md') })}\x07`);
});

test('python waits for the page to run it and exits with its code', async () => {
  const p = spawn('python', ['main.py', 'x'], { cwd: proj, env: { ...process.env, PATH } });
  let out = '';
  const msg = await new Promise(res => p.stdout.on('data', d => { out += d; const m = out.match(/\x1b\]7771;(.*?)\x07/); if (m) res(JSON.parse(m[1])); }));
  expect(msg).toMatchObject({ op: 'python', args: ['main.py', 'x'], cwd: proj });
  p.stdin.write(`__lw_done ${msg.id} 3\r`);
  expect(await new Promise(res => p.on('exit', res))).toBe(3);
});

test('git: init, add, commit, status, diff, log, branch, checkout', () => {
  test.setTimeout(180_000);
  const g = cmd => sh('git ' + cmd);
  expect(g('init').out).toContain('Initialized empty Git repository');
  g('config user.name Ada');
  g('add .');
  expect(g('status').out).toContain('new file:   a.txt');
  expect(g('commit -m first').out).toMatch(/^\[main [0-9a-f]{7}\] first\n$/);
  writeFileSync(join(proj, 'a.txt'), 'alpha\nbeta\ngamma\nbeta\nmore\n');
  expect(g('status').out).toContain('modified:   a.txt');
  expect(g('diff').out).toContain('+more');
  g('commit -am second');
  expect(g('log --oneline').out).toMatch(/^[0-9a-f]{7} second\n[0-9a-f]{7} first\n$/);
  expect(g('checkout -b feature').out).toBe("Switched to a new branch 'feature'\n");
  expect(g('branch').out).toBe('* feature\n  main\n');
  expect(g('log -n 1').out).toContain('Author: Ada');
});
