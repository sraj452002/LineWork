// Python for the Code view: Pyodide (CPython compiled to WebAssembly) in a worker, so long runs
// don't freeze the page. Messages: boot, ready, sync, run, line, pip, scan (see runtime.js).

let pyodide = null, bootP = null, interrupt = null;
const say = (type, text) => postMessage({ type, text });
const enc = new TextDecoder();
// Package loading is quiet (no "Loading numpy…" lines in the program's output); a failure shows when the import runs.
const QUIET = { messageCallback: () => {}, errorCallback: () => {} };

async function boot(indexURL, buffer) {
  const { loadPyodide } = await import(/* @vite-ignore */ indexURL + 'pyodide.mjs');
  pyodide = await loadPyodide({ indexURL });
  // Raw stdout/stderr, so print(..., end='') and progress output show as they happen.
  pyodide.setStdout({ write: b => { say('out', enc.decode(b)); return b.length; } });
  pyodide.setStderr({ write: b => { say('err', enc.decode(b)); return b.length; } });
  pyodide.setStdin({ stdin: () => { say('err', '\n[input() isn’t available here; it reads as end of input]\n'); return null; } });
  if (buffer) { interrupt = new Int32Array(buffer); pyodide.setInterruptBuffer(interrupt); }
  await pyodide.loadPackage('micropip', QUIET).catch(() => {});
  return pyodide;
}

function cd(dir) {
  pyodide.FS.mkdirTree(dir);
  pyodide.runPython(`import os, sys\nos.chdir(${JSON.stringify(dir)})\nif ${JSON.stringify(dir)} not in sys.path: sys.path.insert(0, ${JSON.stringify(dir)})`);
}
// Fetch packages a piece of code imports (numpy, pandas…) before running it.
const loadImports = code => pyodide.loadPackagesFromImports(code, QUIET).catch(() => {});

function sync(dir, write, remove, dirs = []) {
  const FS = pyodide.FS;
  FS.mkdirTree(dir);
  for (const d of dirs) FS.mkdirTree(dir + '/' + d);
  for (const p of remove) { try { FS.unlink(dir + '/' + p); } catch (e) {} }
  for (const f of write) {
    const full = dir + '/' + f.path;
    FS.mkdirTree(full.slice(0, full.lastIndexOf('/')));
    FS.writeFile(full, f.text);
  }
  // Modules may have changed: drop cached ones from this folder so imports see the new code.
  pyodide.runPython(`import sys\nfor _n, _m in list(sys.modules.items()):\n    if (getattr(_m, '__file__', '') or '').startswith(${JSON.stringify(dir + '/')}): del sys.modules[_n]`);
}

function scan(dir) {
  const FS = pyodide.FS, out = [];
  const walk = (abs, rel) => {
    let names = [];
    try { names = FS.readdir(abs); } catch (e) { return; }
    for (const n of names) {
      if (n === '.' || n === '..' || n === '__pycache__' || n === 'node_modules' || n.startsWith('.')) continue;
      const a = abs + '/' + n, r = rel ? rel + '/' + n : n, st = FS.stat(a);
      if (FS.isDir(st.mode)) walk(a, r);
      else if (st.size <= 1_000_000) {
        const b = FS.readFile(a);
        if (b.includes(0)) continue;
        try { out.push({ path: r, text: new TextDecoder('utf-8', { fatal: true }).decode(b) }); } catch (e) {}
      }
    }
  };
  walk(dir, '');
  return out;
}

// Python-side helpers. Code runs synchronously in this worker, so Ctrl C (the interrupt buffer)
// raises KeyboardInterrupt in it cleanly; tracebacks are printed without these helpers' frames.
const HELPERS = `
import sys, traceback, codeop, runpy
_lw_g = {'__name__': '__main__', '__builtins__': __builtins__}
def _lw_tb():
    et, ev, tb = sys.exc_info()
    traceback.print_exception(et, ev, tb.tb_next)
def _lw_run(path):
    sys.argv = [path]
    try:
        runpy.run_path(path, run_name='__main__')
        return 0
    except SystemExit as e:
        return e.code if isinstance(e.code, int) else (0 if e.code is None else 1)
    except BaseException:
        _lw_tb()
        return 1
def _lw_line(src):
    try:
        code = codeop.compile_command(src, '<console>', 'single')
    except (SyntaxError, OverflowError, ValueError):
        traceback.print_exception(*sys.exc_info()[:2], None)
        return 'done'
    if code is None:
        return 'more'
    try:
        exec(code, _lw_g)
    except SystemExit:
        pass
    except BaseException:
        _lw_tb()
    return 'done'
`;
let helpers = null;
const helper = name => {
  if (!helpers) { helpers = pyodide.globals.get('dict')(); pyodide.runPython(HELPERS, { globals: helpers }); }
  return helpers.get(name);
};

async function run(dir, path) {
  cd(dir);
  await loadImports(pyodide.FS.readFile(dir + '/' + path, { encoding: 'utf8' }));
  return helper('_lw_run')(path);
}

// One line at the prompt; lines collect until they make a complete statement.
let pending = [];
async function line(dir, src) {
  cd(dir);
  pending.push(src);
  const source = pending.join('\n');
  const check = helper('_lw_line');
  if (/\S/.test(src) || pending.length === 1) {
    // Only check completeness here; run once complete (a blank line ends a block).
    const g = pyodide.toPy({ _src: source });
    let done = true;
    try { done = pyodide.runPython('import codeop\ntry:\n    _r = codeop.compile_command(_src, "<console>", "single") is not None\nexcept Exception:\n    _r = True\n_r', { globals: g }); }
    finally { g.destroy(); }
    if (!done) return { more: true };
  }
  pending = [];
  await loadImports(source);
  check(source);
  return { more: false };
}

async function pip(dir, pkgs) {
  cd(dir);
  const micropip = pyodide.pyimport('micropip');
  say('out', `Installing ${pkgs.join(', ')}…\n`);
  await micropip.install(pkgs);
  say('out', `Installed ${pkgs.join(', ')}.\n`);
  return 0;
}

onmessage = async e => {
  const { id, type } = e.data;
  try {
    let result = null;
    if (type === 'boot') { bootP = boot(e.data.indexURL, e.data.interrupt); await bootP; }
    else {
      if (!bootP) throw new Error('Python isn’t started');
      await bootP;
      if (type === 'sync') sync(e.data.dir, e.data.write, e.data.remove, e.data.dirs);
      else if (type === 'scan') result = scan(e.data.dir);
      else if (type === 'run') result = await run(e.data.dir, e.data.path);
      else if (type === 'line') result = await line(e.data.dir, e.data.line);
      else if (type === 'pip') result = await pip(e.data.dir, e.data.pkgs);
    }
    postMessage({ id, result });
  } catch (err) {
    postMessage({ id, error: String(err && err.message || err).replace(/^PythonError: /, '') });
  }
};
