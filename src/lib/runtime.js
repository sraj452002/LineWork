/* Running code from the Code view, entirely in the browser.
   - Node.js (with npm, npx, yarn and pnpm, and a shell) runs in a StackBlitz WebContainer.
   - Python (with pip for pure-Python and Pyodide-built packages) runs in Pyodide, in a worker.
   Both need a cross-origin isolated page (COOP/COEP headers, set in netlify.toml and vite.config.js).

   Each Linework file gets its own folder in each runtime, so projects don't mix. The workspace's
   files are copied in before anything runs and kept in step as they're edited; files a program or
   npm creates or changes come back into the workspace (except node_modules and other build output). */

import LW_TOOLS from './shell/lw.cjs?raw';

export const isolated = () => typeof crossOriginIsolated !== 'undefined' && crossOriginIsolated;
export const PYODIDE_VERSION = '0.29.5';
export const PYODIDE_URL = `https://cdn.jsdelivr.net/pyodide/v${PYODIDE_VERSION}/full/`;

// Folders that hold installs and build output: never copied back into the workspace.
export const SKIP = /(^|\/)(node_modules|\.git|\.cache|\.npm|\.pnpm-store|\.yarn|dist|build|\.next|\.nuxt|\.svelte-kit|coverage|__pycache__|\.venv)(\/|$)/;
const MAX_BACK = 1_000_000;
const text = new TextDecoder('utf-8', { fatal: true });
const asText = bytes => { if (bytes.length > MAX_BACK || bytes.includes(0)) return null; try { return text.decode(bytes); } catch (e) { return null; } };
export const dirFor = fileId => 'lw-' + String(fileId).replace(/[^\w-]/g, '');

/* ---------------- Node: WebContainer ---------------- */
let wcP = null;
const nodeSubs = new Set(); // listeners for {type: 'server', port, url} and {type: 'port-closed', port}
export const onNode = fn => { nodeSubs.add(fn); return () => nodeSubs.delete(fn); };

export function bootNode() {
  if (!wcP) wcP = import('@webcontainer/api').then(async ({ WebContainer }) => {
    const wc = await WebContainer.boot({ coep: 'credentialless', workdirName: 'linework' });
    wc.on('server-ready', (port, url) => nodeSubs.forEach(f => f({ type: 'server', port, url })));
    wc.on('port', (port, type, url) => { if (type === 'close') nodeSubs.forEach(f => f({ type: 'port-closed', port, url })); });
    return wc;
  }).catch(e => { wcP = null; throw e; });
  return wcP;
}

/* The extra terminal commands (grep, find, git, curl, python, code…, see shell/lw.cjs): one script
   plus a launcher per command in .lw/bin, put first on the PATH of everything Linework starts. */
export const TOOL_NAMES = [...LW_TOOLS.matchAll(/^def\('([^']+)'/gm)].flatMap(m => m[1].split(' '));
let envP = null;
export function nodeEnv() {
  if (!envP) envP = bootNode().then(async wc => {
    await wc.fs.mkdir('.lw/bin', { recursive: true });
    await wc.fs.writeFile('.lw/lw.cjs', LW_TOOLS);
    await wc.fs.writeFile('.lw/bin/package.json', '{"type":"commonjs"}');
    for (const n of TOOL_NAMES) await wc.fs.writeFile('.lw/bin/' + n, `#!/usr/bin/env node\nrequire('../lw.cjs')(${JSON.stringify(n)});\n`);
    const bin = wc.workdir + '/.lw/bin';
    // Mark the launchers executable and read the default PATH, in one go.
    const p = await wc.spawn('node', ['-e', `const fs=require('fs');for(const n of fs.readdirSync(${JSON.stringify(bin)}))try{fs.chmodSync(${JSON.stringify(bin)}+'/'+n,0o755)}catch(e){}process.stdout.write(process.env.PATH||'')`]);
    let base = '';
    await p.output.pipeTo(new WritableStream({ write: d => { base += d; } })).catch(() => {});
    await p.exit;
    base = base.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '').trim() || '/usr/local/bin:/usr/bin:/bin';
    return { workdir: wc.workdir, env: { PATH: bin + ':' + base, LINEWORK: '1' } };
  }).catch(e => { envP = null; throw e; });
  return envP;
}

// Messages commands send the page (python, pip, code), hidden in the terminal output as
// ESC ] 7771 ; <json> BEL. Returns a filter for output chunks: it strips them and calls onMsg.
export function bridgeFilter(onMsg) {
  let hold = '';
  return chunk => {
    let s = hold + chunk, shown = '';
    hold = '';
    for (;;) {
      const i = s.indexOf('\x1b]7771;');
      if (i < 0) {
        // Keep a possible start of a message for the next chunk.
        const tail = s.lastIndexOf('\x1b');
        if (tail >= 0 && '\x1b]7771;'.startsWith(s.slice(tail))) { hold = s.slice(tail); s = s.slice(0, tail); }
        return shown + s;
      }
      const j = s.indexOf('\x07', i);
      if (j < 0) { hold = s.slice(i); return shown + s.slice(0, i); }
      shown += s.slice(0, i);
      try { onMsg(JSON.parse(s.slice(i + 7, j))); } catch (e) {} // after ESC ] 7771 ;
      s = s.slice(j + 1);
    }
  };
}

// Every folder a workspace has: its explicit (maybe empty) folders and the parents of its files.
const allDirs = ({ files, folders = [] }) => {
  const out = new Set(folders);
  files.forEach(f => { const parts = f.path.split('/'); for (let i = 1; i < parts.length; i++) out.add(parts.slice(0, i).join('/')); });
  return out;
};

// Copies of a workspace in a runtime: what was last written, so only changes go across.
// A workspace is {files: [{path, text}], folders: [path]}.
export class NodeProject {
  constructor(fileId) { this.dir = dirFor(fileId); this.sent = new Map(); this.dirs = new Set(); this.queue = Promise.resolve(); this.watcher = null; this.ready = null; }
  // Create, write and delete what changed since the last sync, folders included (empty ones too).
  sync(ws) {
    this.queue = this.queue.then(async () => {
      const wc = await bootNode();
      if (!this.ready) {
        await wc.fs.mkdir(this.dir, { recursive: true });
        this.ready = true;
      }
      const now = new Map(ws.files.map(f => [f.path, f.text || ''])), dirs = allDirs(ws);
      for (const [p] of this.sent) if (!now.has(p)) { await wc.fs.rm(this.dir + '/' + p, { force: true }).catch(() => {}); this.sent.delete(p); }
      // Folders removed in the explorer, deepest first (their files are gone by now).
      for (const d of [...this.dirs].filter(d => !dirs.has(d)).sort((a, b) => b.length - a.length)) {
        await wc.fs.rm(this.dir + '/' + d, { recursive: true, force: true }).catch(() => {});
        this.dirs.delete(d);
      }
      for (const d of [...dirs].sort((a, b) => a.length - b.length)) {
        if (this.dirs.has(d)) continue;
        await wc.fs.mkdir(this.dir + '/' + d, { recursive: true });
        this.dirs.add(d);
      }
      for (const [p, t] of now) {
        if (this.sent.get(p) === t) continue;
        await wc.fs.writeFile(this.dir + '/' + p, t);
        this.sent.set(p, t);
      }
    }).catch(e => { console.warn('Linework: syncing files to Node failed', e); });
    return this.queue;
  }
  // Report what programs create, change or delete: onBack({path, text}) for a file (text null when
  // it's gone) and onBack({path, dir: true, gone}) for a folder (mkdir, rm -r).
  async watch(onBack) {
    if (this.watcher) return;
    const wc = await bootNode();
    const due = new Set();
    let t = 0;
    const check = async () => {
      const list = [...due]; due.clear();
      for (const p of list) {
        const full = this.dir + '/' + p;
        let bytes = null;
        try { bytes = await wc.fs.readFile(full); }
        catch (e) {
          if (await wc.fs.readdir(full).then(() => true, () => false)) {
            if (!this.dirs.has(p)) { this.dirs.add(p); onBack({ path: p, dir: true, gone: false }); }
            continue;
          }
          // Gone: deleted or renamed.
          if (this.sent.has(p)) { this.sent.delete(p); onBack({ path: p, text: null }); }
          else if (this.dirs.has(p)) {
            [...this.dirs].forEach(d => { if (d === p || d.startsWith(p + '/')) this.dirs.delete(d); });
            [...this.sent.keys()].forEach(f => { if (f.startsWith(p + '/')) this.sent.delete(f); });
            onBack({ path: p, dir: true, gone: true });
          }
          continue;
        }
        const s = asText(bytes);
        if (s == null || this.sent.get(p) === s) continue;
        this.sent.set(p, s);
        onBack({ path: p, text: s });
      }
    };
    this.watcher = wc.fs.watch(this.dir, { recursive: true }, (event, name) => {
      const p = String(name || '').replace(/\\/g, '/').replace(/^\.?\//, '').replace(/\/$/, '');
      if (!p || SKIP.test(p)) return;
      due.add(p);
      clearTimeout(t);
      t = setTimeout(check, 250);
    });
  }
  async spawn(cmd, args, opts = {}) {
    await this.queue;
    const wc = await bootNode(), { env } = await nodeEnv();
    return wc.spawn(cmd, args, { cwd: this.dir, ...opts, env: { ...env, ...(opts.env || {}) } });
  }
  close() { this.watcher?.close(); this.watcher = null; }
}

/* ---------------- Python: Pyodide in a worker ---------------- */
let py = null; // {worker, calls: Map, n, interrupt: Int32Array, onOut}
const pySubs = new Set(); // output listeners: ({stream: 'out' | 'err', text})
export const onPython = fn => { pySubs.add(fn); return () => pySubs.delete(fn); };

function pyWorker() {
  if (py) return py;
  const worker = new Worker(new URL('./python.worker.js', import.meta.url), { type: 'module' });
  const interrupt = typeof SharedArrayBuffer !== 'undefined' ? new Int32Array(new SharedArrayBuffer(4)) : null;
  py = { worker, calls: new Map(), n: 0, interrupt };
  worker.onmessage = e => {
    const m = e.data;
    if (m.type === 'out' || m.type === 'err') { pySubs.forEach(f => f({ stream: m.type, text: m.text })); return; }
    const c = py.calls.get(m.id);
    if (!c) return;
    py.calls.delete(m.id);
    if (m.error) c.rej(Object.assign(new Error(m.error), { code: m.code })); else c.res(m.result);
  };
  worker.onerror = e => { py.calls.forEach(c => c.rej(new Error(e.message || 'Python stopped'))); py.calls.clear(); };
  call('boot', { indexURL: PYODIDE_URL, interrupt: interrupt && interrupt.buffer }).catch(() => {}); // reported by the next call
  return py;
}
function call(type, data) {
  const p = py;
  // Each command starts uninterrupted; Ctrl C any time after this stops it (even before it starts running).
  if ((type === 'run' || type === 'exec' || type === 'line' || type === 'pip' || type === 'trace') && p.interrupt) Atomics.store(p.interrupt, 0, 0);
  return new Promise((res, rej) => {
    const id = ++p.n;
    p.calls.set(id, { res, rej });
    p.worker.postMessage({ id, type, ...data });
  });
}
export const bootPython = () => { pyWorker(); return call('ready', {}); };
// Stop whatever Python is running (raises KeyboardInterrupt in it).
export function interruptPython() { if (py && py.interrupt) { Atomics.store(py.interrupt, 0, 2); } }

export class PythonProject {
  constructor(fileId) { this.dir = '/home/pyodide/' + dirFor(fileId); this.sent = new Map(); }
  async sync(ws) {
    pyWorker();
    const now = new Map(ws.files.map(f => [f.path, f.text || '']));
    const write = [...now].filter(([p, t]) => this.sent.get(p) !== t).map(([path, text]) => ({ path, text }));
    const remove = [...this.sent.keys()].filter(p => !now.has(p));
    await call('sync', { dir: this.dir, write, remove, dirs: [...allDirs(ws)] });
    write.forEach(f => this.sent.set(f.path, f.text));
    remove.forEach(p => this.sent.delete(p));
  }
  // After a run: files the program created or changed, as [{path, text}].
  async changes() {
    const list = await call('scan', { dir: this.dir });
    return list.filter(f => !SKIP.test(f.path) && this.sent.get(f.path) !== f.text).map(f => { this.sent.set(f.path, f.text); return f; });
  }
  // path and cwd are relative to the project; argv follows the script name.
  async run(path, ws, { argv = [], cwd = '' } = {}) { await this.sync(ws); return call('run', { dir: this.dir, path, argv, cwd }); }
  async exec(code, ws, { argv = [], cwd = '' } = {}) { await this.sync(ws); return call('exec', { dir: this.dir, code, argv, cwd }); }
  // One line typed at the Python prompt. Resolves to {more: true} while a block is still open.
  async line(src, ws) { await this.sync(ws); return call('line', { dir: this.dir, line: src }); }
  async pip(pkgs, ws) { await this.sync(ws); return call('pip', { dir: this.dir, pkgs }); }
  // Code visualiser: the structure of some Python source, and a step-by-step recording of a run.
  async analyze(code) { pyWorker(); return call('analyze', { code }); }
  async trace(path, ws) { await this.sync(ws); return call('trace', { dir: this.dir, path }); }
}
