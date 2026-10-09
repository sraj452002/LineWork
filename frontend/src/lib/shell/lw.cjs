/* Extra commands for the Code view's Terminal. The WebContainer shell (jsh) has cd, ls, cat, cp, mv,
   rm, mkdir, echo, pwd, node, npm, npx, yarn and pnpm; this adds the rest of an everyday toolset.
   Each command is a small launcher on PATH (".lw/bin/<name>") that calls run(name) here.

   Commands that need the page (python, pip, code) talk to it through an escape sequence on stdout,
   which the page's terminal picks up and hides:  ESC ] 7771 ; <json> BEL
   For python and pip the page answers on stdin with a line "__lw_done <id> <exit code>". */
'use strict';
const fs = require('fs');
const path = require('path');
const cp = require('child_process');

const out = s => process.stdout.write(s);
// Piped into something that stopped reading (like "| head"): stop quietly.
process.stdout.on('error', e => { if (e.code === 'EPIPE') process.exit(0); });
const err = s => process.stderr.write(s);
class Exit extends Error { constructor(code) { super('exit ' + code); this.code = code; } }
const fail = (msg, code = 1) => { err(msg.endsWith('\n') ? msg : msg + '\n'); throw new Exit(code); };

// Flags: "-abc" sets a, b and c; names listed in withValue take the next argument.
function parse(argv, withValue = []) {
  const flags = {}, rest = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--') { rest.push(...argv.slice(i + 1)); break; }
    if (a.startsWith('--') && a.length > 2) {
      const [k, v] = a.slice(2).split('=');
      flags[k] = v !== undefined ? v : withValue.includes(k) ? argv[++i] : true;
    } else if (a.startsWith('-') && a.length > 1 && !/^-\d/.test(a)) {
      const letters = a.slice(1);
      for (let j = 0; j < letters.length; j++) {
        const k = letters[j];
        if (withValue.includes(k)) { flags[k] = letters.slice(j + 1) || argv[++i]; break; }
        flags[k] = true;
      }
    } else if (/^-\d+$/.test(a) && withValue.includes('n')) flags.n = a.slice(1);
    else rest.push(a);
  }
  return { flags, rest };
}

function readStdin() {
  try { return fs.readFileSync(0, 'utf8'); } catch (e) { return ''; }
}
// Text of each named file, or of stdin when none are named.
function inputs(files) {
  if (!files.length || (files.length === 1 && files[0] === '-')) return [{ name: '(standard input)', text: readStdin() }];
  return files.map(f => {
    try { return { name: f, text: fs.readFileSync(f, 'utf8') }; }
    catch (e) { err(`${f}: ${e.code === 'EISDIR' ? 'Is a directory' : 'No such file or directory'}\n`); return null; }
  }).filter(Boolean);
}
const lines = t => { const ls = t.split('\n'); if (ls[ls.length - 1] === '') ls.pop(); return ls; };
const glob = p => new RegExp('^' + p.replace(/[.+^${}()|\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.') + '$');
const SKIP_DIRS = new Set(['node_modules', '.git']);
function walk(dir, fn, opts = {}) {
  let entries = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return; }
  entries.sort((a, b) => a.name.localeCompare(b.name));
  for (const e of entries) {
    const p = dir === '.' ? e.name : path.join(dir, e.name);
    const isDir = e.isDirectory();
    if (fn(p, isDir, e) === false) continue;
    if (isDir && (opts.all || !SKIP_DIRS.has(e.name))) walk(p, fn, opts);
  }
}
const human = n => { const u = ['B', 'K', 'M', 'G']; let i = 0; while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; } return (i ? n.toFixed(n < 10 ? 1 : 0) : n) + u[i]; };

/* ---- talking to the page ---- */
const bridge = msg => out(`\x1b]7771;${JSON.stringify(msg)}\x07`);
function askPage(msg) {
  const id = Math.random().toString(36).slice(2, 10);
  bridge({ ...msg, id, cwd: process.cwd() });
  return new Promise(resolve => {
    let buf = '';
    if (process.stdin.isTTY && process.stdin.setRawMode) process.stdin.setRawMode(true); // don't echo the reply
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', d => {
      if (d.includes('\x03')) { bridge({ op: 'interrupt', id }); }
      buf += d;
      const m = buf.match(new RegExp('__lw_done ' + id + ' (-?\\d+)'));
      if (m) { process.stdin.pause(); resolve(+m[1]); }
    });
  });
}

/* ---- commands ---- */
const C = {};
const HELP = {};
const def = (names, help, fn) => { names.split(' ').forEach(n => { C[n] = fn; }); HELP[names] = help; };

def('help', 'list the commands you can use here', () => {
  out('\x1b[1mShell (built in):\x1b[0m cd ls cat cp mv rm rmdir mkdir echo pwd export alias exit chmod\n');
  out('\x1b[1mJavaScript:\x1b[0m node npm npx yarn pnpm\n');
  out('\x1b[1mAdded by Linework:\x1b[0m\n');
  for (const [names, h] of Object.entries(HELP)) out(`  ${names.padEnd(22)} ${h}\n`);
});
def('clear cls', 'clear the screen', () => out('\x1bc'));
def('touch', 'create files, or update their time', a => {
  const { rest } = parse(a);
  if (!rest.length) fail('touch: missing file operand');
  const now = new Date();
  for (const f of rest) {
    if (fs.existsSync(f)) fs.utimesSync(f, now, now);
    else { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, ''); }
  }
});
def('head', 'first lines of files (-n N, -c bytes)', a => {
  const { flags, rest } = parse(a, ['n', 'c']);
  const n = +(flags.n || 10), list = inputs(rest);
  list.forEach((x, i) => {
    if (list.length > 1) out(`${i ? '\n' : ''}==> ${x.name} <==\n`);
    if (flags.c) out(Buffer.from(x.text).subarray(0, +flags.c).toString()); else lines(x.text).slice(0, n).forEach(l => out(l + '\n'));
  });
});
def('tail', 'last lines of files (-n N)', a => {
  const { flags, rest } = parse(a, ['n']);
  const n = +(flags.n || 10), list = inputs(rest);
  list.forEach((x, i) => { if (list.length > 1) out(`${i ? '\n' : ''}==> ${x.name} <==\n`); lines(x.text).slice(-n).forEach(l => out(l + '\n')); });
});
def('wc', 'count lines, words and bytes (-l -w -c)', a => {
  const { flags, rest } = parse(a);
  const pick = flags.l || flags.w || flags.c ? flags : { l: true, w: true, c: true };
  const tot = [0, 0, 0], list = inputs(rest);
  const row = (v, name) => out(['l', 'w', 'c'].filter(k => pick[k]).map((k, i) => String(v[['l', 'w', 'c'].indexOf(k)]).padStart(7)).join(' ') + (name ? ' ' + name : '') + '\n');
  list.forEach(x => {
    const v = [(x.text.match(/\n/g) || []).length, (x.text.match(/\S+/g) || []).length, Buffer.byteLength(x.text)];
    v.forEach((n, i) => { tot[i] += n; });
    row(v, rest.length ? x.name : '');
  });
  if (list.length > 1) row(tot, 'total');
});
def('grep', 'search text (-i -n -r -v -l -c -w -E)', a => {
  const { flags, rest } = parse(a, ['e']);
  const pat = flags.e || rest.shift();
  if (pat == null) fail('usage: grep [-inrvlcw] pattern [file ...]', 2);
  let src = flags.E || flags.P ? pat : pat.replace(/\\\|/g, '|').replace(/\\([(){}+?])/g, '$1');
  if (flags.F) src = pat.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (flags.w) src = `\\b(?:${src})\\b`;
  const re = new RegExp(src, flags.i ? 'i' : '');
  let files = rest;
  if (flags.r || flags.R) {
    files = [];
    (rest.length ? rest : ['.']).forEach(p => {
      if (fs.existsSync(p) && fs.statSync(p).isDirectory()) walk(p, (f, d) => { if (!d) files.push(f); });
      else files.push(p);
    });
  }
  const many = files.length > 1 || flags.r || flags.R;
  let found = false;
  for (const x of inputs(files)) {
    if (x.text.includes('\0')) continue;
    let count = 0;
    lines(x.text).forEach((l, i) => {
      if (re.test(l) === !flags.v) {
        count++; found = true;
        if (!flags.l && !flags.c) out(`${many ? '\x1b[35m' + x.name + '\x1b[0m:' : ''}${flags.n ? '\x1b[32m' + (i + 1) + '\x1b[0m:' : ''}${flags.v ? l : l.replace(new RegExp(re.source, 'g' + re.flags), m => '\x1b[1;31m' + m + '\x1b[0m')}\n`);
      }
    });
    if (flags.l && count) out(x.name + '\n');
    if (flags.c) out(`${many ? x.name + ':' : ''}${count}\n`);
  }
  if (!found) throw new Exit(1);
});
def('find', 'find files (-name -iname -type f|d -maxdepth)', a => {
  const roots = [], flags = {};
  while (a.length && !a[0].startsWith('-')) roots.push(a.shift());
  // find's options are words with one dash, each taking a value.
  for (let i = 0; i < a.length; i++) {
    const k = a[i].replace(/^-+/, '');
    if (!['name', 'iname', 'type', 'maxdepth'].includes(k)) fail(`find: unknown option ${a[i]}`);
    flags[k] = a[++i];
  }
  const re = flags.name ? glob(flags.name) : flags.iname ? new RegExp(glob(flags.iname).source, 'i') : null;
  const max = flags.maxdepth != null ? +flags.maxdepth : Infinity;
  for (const root of roots.length ? roots : ['.']) {
    const show = (p, isDir) => { if ((!re || re.test(path.basename(p))) && (!flags.type || (flags.type === 'd') === isDir)) out(p + '\n'); };
    show(root, true);
    walk(root, (p, isDir) => {
      const depth = path.relative(root, p).split(path.sep).length;
      if (depth > max) return false;
      show(p, isDir);
      return depth < max;
    }, { all: true });
  }
});
def('sort', 'sort lines (-r -n -u)', a => {
  const { flags, rest } = parse(a);
  let ls = inputs(rest).flatMap(x => lines(x.text));
  ls.sort(flags.n ? (x, y) => parseFloat(x) - parseFloat(y) : (x, y) => (x < y ? -1 : x > y ? 1 : 0));
  if (flags.r) ls.reverse();
  if (flags.u) ls = ls.filter((l, i) => i === 0 || l !== ls[i - 1]);
  ls.forEach(l => out(l + '\n'));
});
def('uniq', 'drop repeated lines (-c count)', a => {
  const { flags, rest } = parse(a);
  const ls = inputs(rest).flatMap(x => lines(x.text));
  for (let i = 0; i < ls.length;) {
    let j = i;
    while (j < ls.length && ls[j] === ls[i]) j++;
    out((flags.c ? String(j - i).padStart(7) + ' ' : '') + ls[i] + '\n');
    i = j;
  }
});
def('tree', 'show folders as a tree (-a includes node_modules)', a => {
  const { flags, rest } = parse(a);
  const root = rest[0] || '.';
  let dirs = 0, files = 0;
  out('\x1b[1;34m' + root + '\x1b[0m\n');
  const draw = (dir, prefix) => {
    let es = [];
    try { es = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return; }
    es = es.filter(e => flags.a || (!SKIP_DIRS.has(e.name) && !e.name.startsWith('.'))).sort((x, y) => x.name.localeCompare(y.name));
    es.forEach((e, i) => {
      const last = i === es.length - 1;
      out(prefix + (last ? '└── ' : '├── ') + (e.isDirectory() ? '\x1b[1;34m' + e.name + '\x1b[0m' : e.name) + '\n');
      if (e.isDirectory()) { dirs++; draw(path.join(dir, e.name), prefix + (last ? '    ' : '│   ')); } else files++;
    });
  };
  draw(root, '');
  out(`\n${dirs} director${dirs === 1 ? 'y' : 'ies'}, ${files} file${files === 1 ? '' : 's'}\n`);
});
// Line diff (longest common subsequence), printed in unified style.
function diffLines(a, b) {
  const n = a.length, m = b.length, L = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i][j] = a[i] === b[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  const ops = [];
  let i = 0, j = 0;
  while (i < n && j < m) { if (a[i] === b[j]) { ops.push([' ', a[i]]); i++; j++; } else if (L[i + 1][j] >= L[i][j + 1]) ops.push(['-', a[i++]]); else ops.push(['+', b[j++]]); }
  while (i < n) ops.push(['-', a[i++]]);
  while (j < m) ops.push(['+', b[j++]]);
  return ops;
}
function printDiff(ops, nameA, nameB) {
  if (!ops.some(o => o[0] !== ' ')) return false;
  out(`\x1b[1m--- ${nameA}\n+++ ${nameB}\x1b[0m\n`);
  const keep = new Set();
  ops.forEach((o, k) => { if (o[0] !== ' ') for (let d = -3; d <= 3; d++) keep.add(k + d); });
  let gap = false;
  ops.forEach((o, k) => {
    if (!keep.has(k)) { if (!gap) out('\x1b[36m@@\x1b[0m\n'); gap = true; return; }
    gap = false;
    out((o[0] === '-' ? '\x1b[31m' : o[0] === '+' ? '\x1b[32m' : '') + o[0] + o[1] + '\x1b[0m\n');
  });
  return true;
}
def('diff', 'compare two files', a => {
  const { rest } = parse(a);
  if (rest.length !== 2) fail('usage: diff file1 file2', 2);
  const [x, y] = inputs(rest);
  if (!x || !y) throw new Exit(2);
  if (printDiff(diffLines(lines(x.text), lines(y.text)), rest[0], rest[1])) throw new Exit(1);
});
def('sed', "replace text: sed [-i] 's/find/replace/g' file", a => {
  const { flags, rest } = parse(a);
  const expr = rest.shift();
  const m = expr && expr.match(/^s(.)(.*?)\1(.*?)\1([gi]*)$/);
  if (!m) fail("sed: only s/find/replace/flags is supported, e.g. sed 's/old/new/g' file", 2);
  const re = new RegExp(m[2], m[4].includes('g') ? 'g' + (m[4].includes('i') ? 'i' : '') : m[4].includes('i') ? 'i' : '');
  const rep = m[3].replace(/\\(\d)/g, '$$$1').replace(/&/g, '$$&');
  for (const x of inputs(rest)) {
    const t = lines(x.text).map(l => l.replace(re, rep)).join('\n') + (x.text.endsWith('\n') ? '\n' : '');
    if (flags.i && x.name !== '(standard input)') fs.writeFileSync(x.name, t); else out(t);
  }
});
def('which', 'where a command comes from', a => {
  let missing = false;
  for (const n of a) {
    const hit = (process.env.PATH || '').split(':').map(d => path.join(d, n)).find(p => fs.existsSync(p));
    if (hit) out(hit + '\n'); else if (['cd', 'ls', 'cat', 'cp', 'mv', 'rm', 'mkdir', 'echo', 'pwd', 'export'].includes(n)) out(`${n}: shell built-in command\n`); else { err(`${n} not found\n`); missing = true; }
  }
  if (missing) throw new Exit(1);
});
def('env printenv', 'environment variables', a => {
  if (a[0]) { if (process.env[a[0]] == null) throw new Exit(1); out(process.env[a[0]] + '\n'); return; }
  Object.keys(process.env).sort().forEach(k => out(`${k}=${process.env[k]}\n`));
});
def('date', 'the date and time (-u UTC, -I ISO)', a => {
  const { flags } = parse(a);
  const d = new Date();
  out((flags.I ? d.toISOString().slice(0, 10) : flags.u ? d.toUTCString() : d.toString()) + '\n');
});
def('basename', 'last part of a path', a => out(path.basename(a[0] || '', a[1]) + '\n'));
def('dirname', 'folder part of a path', a => out(path.dirname(a[0] || '.') + '\n'));
def('realpath', 'absolute path', a => (a.length ? a : ['.']).forEach(p => out(path.resolve(p) + '\n')));
def('du', 'disk usage (-s summary, -h readable)', a => {
  const { flags, rest } = parse(a);
  for (const root of rest.length ? rest : ['.']) {
    const size = p => { const st = fs.statSync(p); if (!st.isDirectory()) return st.size; let t = 0; for (const e of fs.readdirSync(p)) t += size(path.join(p, e)); return t; };
    if (flags.s) { out(`${flags.h ? human(size(root)) : Math.ceil(size(root) / 1024)}\t${root}\n`); continue; }
    walk(root, (p, d) => { if (d) out(`${flags.h ? human(size(p)) : Math.ceil(size(p) / 1024)}\t${p}\n`); }, { all: true });
    out(`${flags.h ? human(size(root)) : Math.ceil(size(root) / 1024)}\t${root}\n`);
  }
});
def('seq', 'numbers: seq [first] last', a => { const [f, l] = a.length > 1 ? [+a[0], +a[1]] : [1, +a[0]]; for (let i = f; i <= l; i++) out(i + '\n'); });
def('sleep', 'wait some seconds', a => new Promise(r => setTimeout(r, (+a[0] || 0) * 1000)));
def('true', 'do nothing, successfully', () => {});
def('false', 'do nothing, unsuccessfully', () => { throw new Exit(1); });
def('tee', 'copy input to files and output (-a append)', a => {
  const { flags, rest } = parse(a);
  const t = readStdin();
  rest.forEach(f => (flags.a ? fs.appendFileSync : fs.writeFileSync)(f, t));
  out(t);
});
def('less more', 'show a file (same as cat here)', a => inputs(a).forEach(x => out(x.text)));
def('history', 'commands you ran in this terminal', () => out('History lives in the shell: use the ↑ and ↓ keys.\n'));

/* ---- page commands: open in the editor, Python ---- */
def('code open nano vim vi edit', 'open a file in the editor (creates it if missing)', a => {
  const { rest } = parse(a);
  if (!rest.length) fail('usage: code <file> [file ...]');
  for (const f of rest) {
    if (!fs.existsSync(f)) { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, ''); }
    bridge({ op: 'open', path: path.resolve(f) });
  }
});
def('python python3 py', 'run Python: python file.py, python -c "code", python (opens the Python prompt)', async a => {
  if (a[0] === '-m' && a[1] === 'pip') return C.pip(a.slice(2));
  if (a[0] === '--version' || a[0] === '-V') a = ['-c', 'import sys; print("Python " + sys.version.split()[0])'];
  const code = await askPage({ op: 'python', args: a });
  throw new Exit(code);
});
def('pip pip3', 'install Python packages: pip install <package>', async a => {
  if (a[0] !== 'install') fail('Only "pip install <package> ..." is supported here.');
  const code = await askPage({ op: 'pip', args: a.slice(1).filter(x => !x.startsWith('-')) });
  throw new Exit(code);
});

/* ---- network ---- */
def('curl', 'fetch a URL (-o file, -O, -X method, -H header, -d data, -i, -s, -L)', async a => {
  const headers = {}, opts = { method: 'GET', redirect: 'manual' };
  let url = null, outFile = null, keepName = false, showHeaders = false, silent = false;
  for (let i = 0; i < a.length; i++) {
    const x = a[i];
    if (x === '-o' || x === '--output') outFile = a[++i];
    else if (x === '-O' || x === '--remote-name') keepName = true;
    else if (x === '-X' || x === '--request') opts.method = a[++i];
    else if (x === '-H' || x === '--header') { const [k, ...v] = a[++i].split(':'); headers[k.trim()] = v.join(':').trim(); }
    else if (x === '-d' || x === '--data' || x === '--data-raw' || x === '--json') { opts.body = a[++i]; if (opts.method === 'GET') opts.method = 'POST'; if (x === '--json') headers['content-type'] = 'application/json'; }
    else if (x === '-i' || x === '--include') showHeaders = true;
    else if (x === '-s' || x === '--silent' || x === '-sS') silent = true;
    else if (x === '-L' || x === '--location') opts.redirect = 'follow';
    else if (x === '-sL' || x === '-Ls') { silent = true; opts.redirect = 'follow'; }
    else if (!x.startsWith('-')) url = x;
  }
  if (!url) fail('usage: curl [options] <url>', 2);
  if (!/^https?:\/\//.test(url)) url = 'https://' + url;
  let res;
  try { res = await fetch(url, { ...opts, headers }); }
  catch (e) { fail(`curl: couldn't reach ${url}. In the browser, a site must allow cross-origin requests (CORS) to be fetched.`, 7); }
  const body = Buffer.from(await res.arrayBuffer());
  if (showHeaders) { out(`HTTP ${res.status} ${res.statusText}\n`); res.headers.forEach((v, k) => out(`${k}: ${v}\n`)); out('\n'); }
  const name = outFile || (keepName ? path.basename(new URL(url).pathname) || 'index.html' : null);
  if (name) { fs.writeFileSync(name, body); if (!silent) err(`Saved ${human(body.length)} to ${name}\n`); }
  else out(body.toString('utf8'));
  if (res.status >= 400) throw new Exit(22);
});
def('wget', 'download a URL to a file (-O file)', async a => {
  const { flags, rest } = parse(a, ['O']);
  if (!rest[0]) fail('usage: wget [-O file] <url>');
  const name = flags.O || path.basename(new URL(/^https?:/.test(rest[0]) ? rest[0] : 'https://' + rest[0]).pathname) || 'index.html';
  return C.curl(['-L', '-s', '-o', name, rest[0]]).then(() => err(`Saved to ${name}\n`));
});

/* ---- git (isomorphic-git, installed on first use) ---- */
const GIT_VERSION = '1.42.2';
function gitLib() {
  const tools = path.join(__dirname, 'tools');
  const mod = path.join(tools, 'node_modules', 'isomorphic-git');
  if (!fs.existsSync(mod)) {
    err('Setting up git (one time)…\n');
    fs.mkdirSync(tools, { recursive: true });
    if (!fs.existsSync(path.join(tools, 'package.json'))) fs.writeFileSync(path.join(tools, 'package.json'), '{"name":"lw-tools","private":true}');
    const r = cp.spawnSync('npm', ['install', '--no-audit', '--no-fund', '--silent', 'isomorphic-git@' + GIT_VERSION], { cwd: tools, stdio: 'inherit' });
    if (r.status !== 0 || !fs.existsSync(mod)) fail('git: setting up failed. Check your connection and try again.');
  }
  return { git: require(mod), http: require(path.join(mod, 'http', 'node')) };
}
function gitRoot(dir) {
  for (let d = path.resolve(dir); ; d = path.dirname(d)) {
    if (fs.existsSync(path.join(d, '.git'))) return d;
    if (path.dirname(d) === d) return null;
  }
}
const CORS = 'https://cors.isomorphic-git.org';
def('git', 'version control: init status add rm commit log diff branch checkout clone push pull remote config', async a => {
  const [sub, ...args] = a;
  if (!sub || sub === 'help' || sub === '--help') {
    out('git init | status | add <files>|. | rm <files> | commit -m "msg" | log [--oneline] | diff [file] | branch [name] | checkout [-b] <branch> | remote add <name> <url> | clone <url> [dir] | push | pull | config user.name|user.email <value>\n');
    out('Pushing and pulling use a CORS proxy and a token in $GITHUB_TOKEN (export GITHUB_TOKEN=...).\n');
    return;
  }
  const { git, http } = gitLib();
  const cwd = process.cwd();
  if (sub === 'init') { await git.init({ fs, dir: cwd, defaultBranch: 'main' }); out(`Initialized empty Git repository in ${path.join(cwd, '.git')}/\n`); return; }
  if (sub === 'clone') {
    const url = args.find(x => !x.startsWith('-'));
    if (!url) fail('usage: git clone <url> [dir]');
    const dir = path.resolve(args.filter(x => !x.startsWith('-'))[1] || path.basename(url).replace(/\.git$/, ''));
    out(`Cloning into '${path.basename(dir)}'…\n`);
    await git.clone({ fs, http, dir, url, corsProxy: CORS, singleBranch: true, depth: 50, onAuth: auth, onProgress: p => { if (p.total) err(`\r${p.phase}: ${p.loaded}/${p.total}`); } });
    err('\n');
    return;
  }
  const dir = gitRoot(cwd);
  if (!dir) fail('fatal: not a git repository (run "git init" first)', 128);
  const rel = p => path.relative(dir, path.resolve(cwd, p)).split(path.sep).join('/');
  const author = async () => {
    const name = await git.getConfig({ fs, dir, path: 'user.name' }) || process.env.GIT_AUTHOR_NAME || 'Linework user';
    const email = await git.getConfig({ fs, dir, path: 'user.email' }) || process.env.GIT_AUTHOR_EMAIL || 'user@linework.local';
    return { name, email };
  };
  function auth() { const t = process.env.GITHUB_TOKEN || process.env.GIT_TOKEN; return t ? { username: t, password: 'x-oauth-basic' } : {}; }
  const ignored = f => f.split('/').some(p => SKIP_DIRS.has(p));
  switch (sub) {
    case 'status': {
      const branch = await git.currentBranch({ fs, dir, fullname: false }).catch(() => null);
      out(`On branch ${branch || '(no branch)'}\n`);
      const m = (await git.statusMatrix({ fs, dir })).filter(([f]) => !ignored(f));
      const staged = [], unstaged = [], untracked = [];
      for (const [f, h, w, s] of m) {
        if (h === 0 && w === 2 && s === 0) untracked.push(f);
        if (s !== h || (h === 1 && s === 3)) staged.push((h === 0 ? 'new file:   ' : s === 0 ? 'deleted:    ' : 'modified:   ') + f);
        if (w !== s && !(h === 0 && w === 2 && s === 0)) unstaged.push((w === 0 ? 'deleted:    ' : 'modified:   ') + f);
      }
      if (staged.length) { out('\nChanges to be committed:\n'); staged.forEach(x => out('\t\x1b[32m' + x + '\x1b[0m\n')); }
      if (unstaged.length) { out('\nChanges not staged for commit:\n'); unstaged.forEach(x => out('\t\x1b[31m' + x + '\x1b[0m\n')); }
      if (untracked.length) { out('\nUntracked files:\n'); untracked.forEach(x => out('\t\x1b[31m' + x + '\x1b[0m\n')); }
      if (!staged.length && !unstaged.length && !untracked.length) out('nothing to commit, working tree clean\n');
      return;
    }
    case 'add': {
      const targets = args.filter(x => !x.startsWith('-'));
      if (!targets.length) fail('Nothing specified, nothing added. Try "git add ."');
      const all = targets.includes('.') || args.includes('-A') || args.includes('--all');
      const m = await git.statusMatrix({ fs, dir });
      const want = all ? null : targets.map(rel);
      for (const [f, , w] of m) {
        if (ignored(f) || (want && !want.some(t => f === t || f.startsWith(t + '/')))) continue;
        if (w === 0) await git.remove({ fs, dir, filepath: f }); else await git.add({ fs, dir, filepath: f });
      }
      return;
    }
    case 'rm': for (const f of args.filter(x => !x.startsWith('-'))) { await git.remove({ fs, dir, filepath: rel(f) }); if (!args.includes('--cached')) fs.rmSync(path.resolve(cwd, f), { force: true }); out(`rm '${rel(f)}'\n`); } return;
    case 'commit': {
      const i = args.findIndex(x => x === '-m' || x === '-am');
      if (args.includes('-a') || args[i] === '-am') for (const [f, h, w] of await git.statusMatrix({ fs, dir })) if (h === 1 && w !== 1 && !ignored(f)) { if (w === 0) await git.remove({ fs, dir, filepath: f }); else await git.add({ fs, dir, filepath: f }); }
      if (i < 0 || !args[i + 1]) fail('Please give a message: git commit -m "message"');
      const sha = await git.commit({ fs, dir, message: args[i + 1], author: await author() });
      const branch = await git.currentBranch({ fs, dir }).catch(() => 'main');
      out(`[${branch} ${sha.slice(0, 7)}] ${args[i + 1]}\n`);
      return;
    }
    case 'log': {
      const one = args.includes('--oneline'), ni = args.indexOf('-n'), depth = ni >= 0 ? +args[ni + 1] : undefined;
      let commits = [];
      try { commits = await git.log({ fs, dir, depth }); } catch (e) { fail("fatal: your current branch doesn't have any commits yet", 128); }
      for (const c of commits) {
        if (one) { out(`\x1b[33m${c.oid.slice(0, 7)}\x1b[0m ${c.commit.message.split('\n')[0]}\n`); continue; }
        out(`\x1b[33mcommit ${c.oid}\x1b[0m\nAuthor: ${c.commit.author.name} <${c.commit.author.email}>\nDate:   ${new Date(c.commit.author.timestamp * 1000).toString()}\n\n    ${c.commit.message.trim().split('\n').join('\n    ')}\n\n`);
      }
      return;
    }
    case 'diff': {
      const only = args.filter(x => !x.startsWith('-')).map(rel);
      const staged = args.includes('--staged') || args.includes('--cached');
      let head = null;
      try { head = await git.resolveRef({ fs, dir, ref: 'HEAD' }); } catch (e) {}
      const readHead = async f => { if (!head) return ''; try { const { blob } = await git.readBlob({ fs, dir, oid: head, filepath: f }); return Buffer.from(blob).toString('utf8'); } catch (e) { return ''; } };
      for (const [f, h, w, s] of await git.statusMatrix({ fs, dir })) {
        if (ignored(f) || (only.length && !only.some(t => f === t || f.startsWith(t + '/')))) continue;
        if (staged ? s === h || (h === 1 && s === 1) : w === s || (h === 0 && w === 2 && s === 0)) continue;
        const before = await readHead(f), after = w === 0 ? '' : fs.readFileSync(path.join(dir, f), 'utf8');
        printDiff(diffLines(lines(before), lines(after)), 'a/' + f, 'b/' + f);
      }
      return;
    }
    case 'branch': {
      const name = args.find(x => !x.startsWith('-'));
      if (args.includes('-d') || args.includes('-D')) { await git.deleteBranch({ fs, dir, ref: name }); out(`Deleted branch ${name}\n`); return; }
      if (name) { await git.branch({ fs, dir, ref: name }); return; }
      const cur = await git.currentBranch({ fs, dir }).catch(() => null);
      for (const b of await git.listBranches({ fs, dir })) out(b === cur ? `* \x1b[32m${b}\x1b[0m\n` : `  ${b}\n`);
      return;
    }
    case 'checkout': case 'switch': {
      const create = args.includes('-b') || args.includes('-c'), name = args.find(x => !x.startsWith('-'));
      if (!name) fail('usage: git checkout [-b] <branch>');
      if (create) await git.branch({ fs, dir, ref: name });
      await git.checkout({ fs, dir, ref: name });
      out(`Switched to ${create ? 'a new ' : ''}branch '${name}'\n`);
      return;
    }
    case 'remote': {
      if (args[0] === 'add') { await git.addRemote({ fs, dir, remote: args[1], url: args[2] }); return; }
      if (args[0] === 'remove' || args[0] === 'rm') { await git.deleteRemote({ fs, dir, remote: args[1] }); return; }
      for (const r of await git.listRemotes({ fs, dir })) out(args.includes('-v') ? `${r.remote}\t${r.url}\n` : r.remote + '\n');
      return;
    }
    case 'config': {
      const [k, v] = args.filter(x => !x.startsWith('--'));
      if (v === undefined) { const got = await git.getConfig({ fs, dir, path: k }); if (got != null) out(got + '\n'); return; }
      await git.setConfig({ fs, dir, path: k, value: v });
      return;
    }
    case 'push': {
      const remote = args[0] || 'origin', ref = args[1] || await git.currentBranch({ fs, dir });
      const r = await git.push({ fs, http, dir, remote, ref, corsProxy: CORS, onAuth: auth });
      out(r.ok ? `Pushed ${ref} to ${remote}\n` : `Push failed: ${JSON.stringify(r.refs)}\n`);
      return;
    }
    case 'pull': case 'fetch': {
      const remote = args[0] || 'origin';
      const fn = sub === 'pull' ? git.pull : git.fetch;
      await fn({ fs, http, dir, remote, corsProxy: CORS, onAuth: auth, author: await author(), singleBranch: true });
      out(sub === 'pull' ? 'Pulled.\n' : 'Fetched.\n');
      return;
    }
    default: fail(`git: '${sub}' isn't supported here. Try "git help".`);
  }
});

module.exports = async function run(name) {
  try {
    if (!C[name]) fail(`${name}: command not found`, 127);
    await C[name](process.argv.slice(2));
    process.exitCode = 0;
  } catch (e) {
    if (e instanceof Exit) process.exitCode = e.code;
    else { err(`${name}: ${e && e.message || e}\n`); process.exitCode = 1; }
  }
  if (process.stdin.isTTY && process.stdin.setRawMode) { try { process.stdin.setRawMode(false); } catch (e) {} }
  // Leave promptly even if stdin was opened.
  setTimeout(() => process.exit(process.exitCode || 0), 0).unref?.();
  if (process.stdin.readableFlowing) process.stdin.pause();
};
module.exports.commands = Object.keys(C);
