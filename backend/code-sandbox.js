/* The Code node's sandbox: a separate Node process started by flow-code.js with Node's permission model
   (--permission). It can read only the runtimes' own package folders (and write the Python package
   cache), can't start processes or workers, and has no environment variables, so code run here can't
   reach the server's files or secrets. It can use the network (fetch), like the Code node always could.

   Messages in (IPC): {id, lang, code, items}; out: {id, result, logs} or {id, error, logs}.
   Languages: javascript, typescript, python (Pyodide), lua (wasmoon), sql (SQLite via sql.js). */
import vm from 'node:vm';
import { constants } from 'node:fs';

// Pyodide's file system code asks for the fs constants through process.binding, which the permission
// model refuses; give it just those.
process.binding = name => { if (name === 'constants') return { fs: constants }; throw new Error(`process.binding(${name}) isn't available here`); };

const CACHE = process.argv[2] || undefined;
const show = v => (typeof v === 'string' ? v : (() => { try { return JSON.stringify(v); } catch (e) { return String(v); } })());

/* ---- JavaScript and TypeScript ---- */
let sucrase;
async function runJS(code, items, logs, ts) {
  let src = `(async (items, $input) => {\n${code}\n})`;
  if (ts) {
    sucrase ||= await import('sucrase');
    try { src = sucrase.transform(src, { transforms: ['typescript'] }).code.replace(/;\s*$/, ''); }
    catch (e) { throw new Error(`The code doesn't parse: ${e.message}`); }
  }
  const sandbox = {
    console: { log: (...a) => logs.push(a.map(show).join(' ')) },
    fetch, URL, URLSearchParams, JSON, Math, Date, structuredClone, setTimeout, TextEncoder, TextDecoder, atob, btoa,
  };
  sandbox.console.info = sandbox.console.warn = sandbox.console.error = sandbox.console.log;
  let fn;
  try { fn = vm.runInNewContext(src, sandbox, { timeout: 2000 }); }
  catch (e) { throw new Error(`The code doesn't parse: ${e.message}`); }
  return fn(items, { all: () => items, first: () => items[0] });
}

/* ---- Python ---- */
let pyodide;
async function runPython(code, items, logs) {
  if (!pyodide) {
    const { loadPyodide } = await import('pyodide');
    // jsglobals: Python's `js` module sees an empty object, not this process.
    pyodide = await loadPyodide({ jsglobals: {}, packageCacheDir: CACHE, stdout: () => {}, stderr: () => {} });
  }
  pyodide.setStdout({ batched: l => logs.push(l) });
  pyodide.setStderr({ batched: l => logs.push(l) });
  // Packages the code imports (numpy, pandas…) are fetched once and kept in the cache.
  await pyodide.loadPackagesFromImports(code, { messageCallback: () => {}, errorCallback: m => logs.push(m) });
  const g = pyodide.globals.get('dict')();
  g.set('__lw_input', JSON.stringify(items));
  // The code is the body of a function, so `return` works; `await` too.
  const body = code.split('\n').map(l => '    ' + l).join('\n');
  // Errors come with Pyodide's own frames: keep the error and the line of the user's code.
  const short = e => {
    const msg = String(e && e.message || e), lines = msg.trim().split('\n'), at = [...msg.matchAll(/File "<exec>", line (\d+)/g)].pop();
    const line = at ? Number(at[1]) - 2 : 0;
    return new Error(lines[lines.length - 1] + (line > 0 ? ` (line ${line})` : ''));
  };
  let text;
  try { text = await pyodide.runPythonAsync(`import json as __lw_json
async def __lw_main(items):
${body}
    return None
__lw_r = await __lw_main(__lw_json.loads(__lw_input))
None if __lw_r is None else __lw_json.dumps(__lw_r, default=str)`, { globals: g }); }
  catch (e) { throw short(e); }
  finally { g.destroy(); }
  return text == null ? undefined : JSON.parse(text);
}

/* ---- Lua ---- */
let luaFactory;
async function runLua(code, items, logs) {
  if (!luaFactory) { const { LuaFactory } = await import('wasmoon'); luaFactory = new LuaFactory(); }
  const lua = await luaFactory.createEngine();
  try {
    lua.global.set('items', items);
    lua.global.set('print', (...a) => logs.push(a.map(show).join('\t')));
    // The code is the body of a function: `return` passes the new items on.
    const r = await lua.doString(`return (function(items)\n${code}\nend)(items)`);
    return r === null ? undefined : JSON.parse(JSON.stringify(r));
  } finally { lua.global.close(); }
}

/* ---- SQL (SQLite) ---- */
let SQL;
async function runSQL(code, items) {
  if (!SQL) { const init = (await import('sql.js')).default; SQL = await init(); }
  const db = new SQL.Database();
  try {
    // The items become a table `items`, one column per field (lists and objects as JSON text).
    const cols = [...new Set(items.flatMap(i => (i && typeof i === 'object' ? Object.keys(i) : [])))];
    const q = c => '"' + String(c).replace(/"/g, '""') + '"';
    db.run(`CREATE TABLE items (${cols.length ? cols.map(q).join(', ') : 'value'})`);
    if (cols.length) {
      const ins = db.prepare(`INSERT INTO items VALUES (${cols.map(() => '?').join(', ')})`);
      for (const it of items) ins.run(cols.map(c => {
        const v = it ? it[c] : null;
        return v === undefined || v === null ? null : typeof v === 'boolean' ? (v ? 1 : 0) : typeof v === 'object' ? JSON.stringify(v) : v;
      }));
      ins.free();
    }
    const res = db.exec(code);
    // The last statement that gives rows is the result; with none (only changes), the items table.
    const last = res.length ? res[res.length - 1] : db.exec('SELECT * FROM items')[0];
    return last ? last.values.map(row => Object.fromEntries(last.columns.map((c, i) => [c, row[i]]))) : [];
  } finally { db.close(); }
}

const RUN = { javascript: (c, i, l) => runJS(c, i, l, false), typescript: (c, i, l) => runJS(c, i, l, true), python: runPython, lua: runLua, sql: runSQL };

process.on('message', async ({ id, lang, code, items }) => {
  const logs = [];
  try {
    const run = RUN[lang];
    if (!run) throw new Error(`This sandbox doesn't run ${lang}.`);
    const result = await run(String(code || ''), items, logs);
    process.send({ id, result: result === undefined ? null : JSON.parse(JSON.stringify(result)), none: result === undefined, logs });
  } catch (e) {
    process.send({ id, error: String((e && e.message) || e).replace(/\s+$/, ''), logs });
  }
});
process.on('disconnect', () => process.exit(0)); // the server went away
process.send({ ready: true });
