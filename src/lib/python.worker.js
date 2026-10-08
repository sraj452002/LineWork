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
def _lw_run(path, argv=()):
    sys.argv = [path, *argv]
    try:
        runpy.run_path(path, run_name='__main__')
        return 0
    except SystemExit as e:
        return e.code if isinstance(e.code, int) else (0 if e.code is None else 1)
    except BaseException:
        _lw_tb()
        return 1
def _lw_exec(src, argv=()):
    sys.argv = ['-c', *argv]
    try:
        exec(compile(src, '<string>', 'exec'), {'__name__': '__main__', '__builtins__': __builtins__})
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

# ---- code visualiser: structure (same shape as codeviz.js analyzeJS) ----
import ast as _ast, json as _json, types as _types, io as _io, os as _os
def _lw_analyze(src):
    try:
        tree = _ast.parse(src)
    except SyntaxError as e:
        return _json.dumps({'error': f'{e.msg} (line {e.lineno})', 'imports': [], 'classes': [], 'functions': []})
    seg = lambda n: ' '.join(((_ast.get_source_segment(src, n) or '').split('\\n')[0]).split())
    imports = []
    for n in _ast.walk(tree):
        if isinstance(n, _ast.Import):
            imports += [{'mod': a.name, 'level': 0} for a in n.names]
        elif isinstance(n, _ast.ImportFrom):
            imports.append({'mod': n.module or '', 'level': n.level, 'names': [a.name for a in n.names]})
    TryT = (_ast.Try,) + ((_ast.TryStar,) if hasattr(_ast, 'TryStar') else ())
    def ir(stmts):
        out = []
        for s in stmts:
            L = getattr(s, 'lineno', None)
            if isinstance(s, _ast.If):
                out.append({'k': 'if', 'text': 'if ' + seg(s.test), 'line': L, 'then': ir(s.body), 'else': ir(s.orelse)})
            elif isinstance(s, (_ast.For, _ast.AsyncFor)):
                out.append({'k': 'loop', 'text': f'for {seg(s.target)} in {seg(s.iter)}', 'line': L, 'body': ir(s.body)})
            elif isinstance(s, _ast.While):
                out.append({'k': 'loop', 'text': 'while ' + seg(s.test), 'line': L, 'body': ir(s.body)})
            elif isinstance(s, _ast.Return):
                out.append({'k': 'return', 'text': seg(s), 'line': L})
            elif isinstance(s, _ast.Raise):
                out.append({'k': 'raise', 'text': seg(s), 'line': L})
            elif isinstance(s, _ast.Break):
                out.append({'k': 'break', 'line': L})
            elif isinstance(s, _ast.Continue):
                out.append({'k': 'continue', 'line': L})
            elif isinstance(s, TryT):
                out.append({'k': 'try', 'line': L, 'body': ir(s.body),
                            'handlers': [{'text': 'except ' + (seg(h.type) if h.type else ''), 'body': ir(h.body)} for h in s.handlers],
                            'fin': ir(s.orelse) + ir(s.finalbody)})
            elif isinstance(s, (_ast.With, _ast.AsyncWith)):
                out.append({'k': 'stmt', 'text': 'with ' + ', '.join(seg(i.context_expr) for i in s.items), 'line': L})
                out += ir(s.body)
            elif isinstance(s, (_ast.FunctionDef, _ast.AsyncFunctionDef)):
                out.append({'k': 'stmt', 'text': f'def {s.name}(…)', 'line': L})
            elif isinstance(s, _ast.ClassDef):
                out.append({'k': 'stmt', 'text': f'class {s.name}', 'line': L})
            elif isinstance(s, _ast.Pass):
                continue
            else:
                out.append({'k': 'stmt', 'text': seg(s), 'line': L})
        return out
    classes, functions = [], []
    def params(f):
        a = f.args
        return [x.arg for x in a.posonlyargs + a.args if x.arg not in ('self', 'cls')] + (['*' + a.vararg.arg] if a.vararg else []) + [x.arg for x in a.kwonlyargs] + (['**' + a.kwarg.arg] if a.kwarg else [])
    def visit(body, prefix=''):
        for n in body:
            if isinstance(n, _ast.ClassDef):
                fields, methods, names = [], [], set()
                for b in n.body:
                    if isinstance(b, (_ast.FunctionDef, _ast.AsyncFunctionDef)):
                        methods.append({'name': b.name, 'params': params(b)})
                    elif isinstance(b, _ast.AnnAssign) and isinstance(b.target, _ast.Name):
                        fields.append({'name': b.target.id, 'type': seg(b.annotation)}); names.add(b.target.id)
                    elif isinstance(b, _ast.Assign):
                        for t in b.targets:
                            if isinstance(t, _ast.Name) and t.id not in names:
                                fields.append({'name': t.id, 'type': ''}); names.add(t.id)
                for b in n.body:
                    if isinstance(b, _ast.FunctionDef) and b.name == '__init__':
                        for x in _ast.walk(b):
                            ts = x.targets if isinstance(x, _ast.Assign) else [x.target] if isinstance(x, _ast.AnnAssign) else []
                            for t in ts:
                                if isinstance(t, _ast.Attribute) and isinstance(t.value, _ast.Name) and t.value.id == 'self' and t.attr not in names:
                                    fields.append({'name': t.attr, 'type': seg(x.annotation) if isinstance(x, _ast.AnnAssign) else ''}); names.add(t.attr)
                classes.append({'name': n.name, 'bases': [seg(b) for b in n.bases if seg(b) != 'object'], 'fields': fields, 'methods': methods, 'line': n.lineno})
                visit(n.body, prefix + n.name + '.')
            elif isinstance(n, (_ast.FunctionDef, _ast.AsyncFunctionDef)):
                functions.append({'name': prefix + n.name, 'line': n.lineno, 'endLine': n.end_lineno, 'params': params(n), 'flow': ir(n.body)})
                visit(n.body, prefix + n.name + '.')
    visit(tree.body)
    top = [s for s in tree.body if not isinstance(s, (_ast.FunctionDef, _ast.AsyncFunctionDef, _ast.ClassDef, _ast.Import, _ast.ImportFrom))]
    if top:
        functions.insert(0, {'name': '(whole file)', 'line': 1, 'endLine': len(src.splitlines()), 'params': [], 'flow': ir(top)})
    return _json.dumps({'imports': imports, 'classes': classes, 'functions': functions})

# ---- code visualiser: a step-by-step recording of one run ----
def _lw_trace(path, maxsteps=2000):
    full = _os.path.abspath(path)
    steps, out = [], _io.StringIO()
    def rep(v, d=0):
        # Like repr, but objects show their attributes (Square(s=2)) instead of their address.
        try:
            plain = type(v).__repr__ is object.__repr__ and hasattr(v, '__dict__')
            if plain and d < 2:
                r = type(v).__name__ + '(' + ', '.join(f'{k}={rep(x, d + 1)}' for k, x in list(vars(v).items())[:8]) + ')'
            elif isinstance(v, (list, tuple, set)) and d < 2 and type(v) in (list, tuple, set):
                items = [rep(x, d + 1) for x in list(v)[:12]] + (['…'] if len(v) > 12 else [])
                o, c = {list: '[]', tuple: '()', set: '{}'}[type(v)]
                r = o + ', '.join(items) + (',' if type(v) is tuple and len(v) == 1 else '') + c
            elif type(v) is dict and d < 2:
                r = '{' + ', '.join(f'{rep(k, d + 1)}: {rep(x, d + 1)}' for k, x in list(v.items())[:10]) + (', …' if len(v) > 10 else '') + '}'
            else:
                r = repr(v)
        except Exception:
            r = '<?>'
        return r if len(r) <= 120 else r[:117] + '…'
    def keep(k, v):
        return not k.startswith('__') and not isinstance(v, (_types.ModuleType, _types.BuiltinFunctionType))
    def stack(frame):
        st, f = [], frame
        while f is not None:
            if f.f_code.co_filename == full:
                st.append({'fn': '(module)' if f.f_code.co_name == '<module>' else f.f_code.co_name,
                           'line': f.f_lineno,
                           'vars': {k: ('function' if isinstance(v, _types.FunctionType) else 'class' if isinstance(v, type) else rep(v)) if isinstance(v, (_types.FunctionType, type)) else rep(v) for k, v in list(f.f_locals.items()) if keep(k, v)}})
            f = f.f_back
        return st
    class _Stop(BaseException):
        pass
    def tracer(frame, event, arg):
        if frame.f_code.co_filename != full:
            return None
        if event in ('line', 'return', 'exception'):
            if len(steps) >= maxsteps:
                raise _Stop()
            st = {'line': frame.f_lineno, 'event': event, 'stack': stack(frame), 'out': len(out.getvalue())}
            if event == 'return':
                st['ret'] = rep(arg)
            steps.append(st)
        return tracer
    old_out, old_err = sys.stdout, sys.stderr
    sys.stdout = sys.stderr = out
    error, truncated = None, False
    sys.argv = [full]
    sys.settrace(tracer)
    try:
        runpy.run_path(full, run_name='__main__')
    except _Stop:
        truncated = True
    except SystemExit:
        pass
    except BaseException as e:
        tb = e.__traceback__
        while tb is not None and tb.tb_frame.f_code.co_filename != full:
            tb = tb.tb_next
        error = ''.join(traceback.format_exception(type(e), e, tb)).strip()
    finally:
        sys.settrace(None)
        sys.stdout, sys.stderr = old_out, old_err
    return _json.dumps({'steps': steps, 'out': out.getvalue(), 'error': error, 'truncated': truncated})
`;
let helpers = null;
const helper = name => {
  if (!helpers) { helpers = pyodide.globals.get('dict')(); pyodide.runPython(HELPERS, { globals: helpers }); }
  return helpers.get(name);
};

// path is relative to the project folder; the program runs in the project's subfolder cwd.
async function run(dir, path, argv = [], cwd = '') {
  cd(cwd ? dir + '/' + cwd : dir);
  if (cwd) pyodide.runPython(`import sys\nif ${JSON.stringify(dir)} not in sys.path: sys.path.insert(1, ${JSON.stringify(dir)})`);
  const full = dir + '/' + path;
  await loadImports(pyodide.FS.readFile(full, { encoding: 'utf8' }));
  return helper('_lw_run')(full, pyodide.toPy(argv));
}
async function exec(dir, code, argv = [], cwd = '') {
  cd(cwd ? dir + '/' + cwd : dir);
  await loadImports(code);
  return helper('_lw_exec')(code, pyodide.toPy(argv));
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
      else if (type === 'run') result = await run(e.data.dir, e.data.path, e.data.argv, e.data.cwd);
      else if (type === 'exec') result = await exec(e.data.dir, e.data.code, e.data.argv, e.data.cwd);
      else if (type === 'line') result = await line(e.data.dir, e.data.line);
      else if (type === 'pip') result = await pip(e.data.dir, e.data.pkgs);
      else if (type === 'analyze') result = JSON.parse(helper('_lw_analyze')(e.data.code));
      else if (type === 'trace') { cd(e.data.dir); const full = e.data.dir + '/' + e.data.path; await loadImports(pyodide.FS.readFile(full, { encoding: 'utf8' })); result = JSON.parse(helper('_lw_trace')(full)); }
    }
    postMessage({ id, result });
  } catch (err) {
    postMessage({ id, error: String(err && err.message || err).replace(/^PythonError: /, '') });
  }
};
