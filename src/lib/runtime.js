/* Running code from the Code view, entirely in the browser.
   - Node.js (with npm, npx, yarn and pnpm, and a shell) runs in a StackBlitz WebContainer.
   - Python (with pip for pure-Python and Pyodide-built packages) runs in Pyodide, in a worker.
   Both need a cross-origin isolated page (COOP/COEP headers, set in netlify.toml and vite.config.js).

   Each Linework file gets its own folder in each runtime, so projects don't mix. The workspace's
   files are copied in before anything runs and kept in step as they're edited; files a program or
   npm creates or changes come back into the workspace (except node_modules and other build output). */

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

// Copies of a workspace in a runtime: what was last written, so only changes go across.
export class NodeProject {
  constructor(fileId) { this.dir = dirFor(fileId); this.sent = new Map(); this.queue = Promise.resolve(); this.watcher = null; this.ready = null; }
  // First sync: mount the whole workspace; later ones write and delete what changed.
  sync(files) {
    this.queue = this.queue.then(async () => {
      const wc = await bootNode();
      if (!this.ready) {
        await wc.fs.mkdir(this.dir, { recursive: true });
        this.ready = true;
      }
      const now = new Map(files.map(f => [f.path, f.text || '']));
      for (const [p] of this.sent) if (!now.has(p)) { await wc.fs.rm(this.dir + '/' + p, { force: true }).catch(() => {}); this.sent.delete(p); }
      for (const [p, t] of now) {
        if (this.sent.get(p) === t) continue;
        const d = p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '';
        if (d) await wc.fs.mkdir(this.dir + '/' + d, { recursive: true });
        await wc.fs.writeFile(this.dir + '/' + p, t);
        this.sent.set(p, t);
      }
    }).catch(e => { console.warn('Linework: syncing files to Node failed', e); });
    return this.queue;
  }
  // Report files that programs create, change or delete: onBack({path, text | null}).
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
          // Gone (deleted or renamed), or a folder.
          const isDir = await wc.fs.readdir(full).then(() => true, () => false);
          if (!isDir && this.sent.has(p)) { this.sent.delete(p); onBack({ path: p, text: null }); }
          continue;
        }
        const s = asText(bytes);
        if (s == null || this.sent.get(p) === s) continue;
        this.sent.set(p, s);
        onBack({ path: p, text: s });
      }
    };
    this.watcher = wc.fs.watch(this.dir, { recursive: true }, (event, name) => {
      const p = String(name || '').replace(/\\/g, '/').replace(/^\.?\//, '');
      if (!p || SKIP.test(p)) return;
      due.add(p);
      clearTimeout(t);
      t = setTimeout(check, 250);
    });
  }
  async spawn(cmd, args, opts = {}) {
    await this.queue;
    const wc = await bootNode();
    return wc.spawn(cmd, args, { cwd: this.dir, ...opts });
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
  if ((type === 'run' || type === 'line' || type === 'pip') && p.interrupt) Atomics.store(p.interrupt, 0, 0);
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
  async sync(files) {
    pyWorker();
    const now = new Map(files.map(f => [f.path, f.text || '']));
    const write = [...now].filter(([p, t]) => this.sent.get(p) !== t).map(([path, text]) => ({ path, text }));
    const remove = [...this.sent.keys()].filter(p => !now.has(p));
    await call('sync', { dir: this.dir, write, remove });
    write.forEach(f => this.sent.set(f.path, f.text));
    remove.forEach(p => this.sent.delete(p));
  }
  // After a run: files the program created or changed, as [{path, text}].
  async changes() {
    const list = await call('scan', { dir: this.dir });
    return list.filter(f => !SKIP.test(f.path) && this.sent.get(f.path) !== f.text).map(f => { this.sent.set(f.path, f.text); return f; });
  }
  async run(path, files) { await this.sync(files); return call('run', { dir: this.dir, path }); }
  // One line typed at the Python prompt. Resolves to {more: true} while a block is still open.
  async line(src, files) { await this.sync(files); return call('line', { dir: this.dir, line: src }); }
  async pip(pkgs, files) { await this.sync(files); return call('pip', { dir: this.dir, pkgs }); }
}
