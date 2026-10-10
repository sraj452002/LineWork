import { randomBytes } from 'node:crypto';
import { FlowError } from './flow-engine.js';
import { each, need } from './flow-util.js';
import { handle as dbHandle } from './dbconnect.js';

/* Workflow nodes for Workline's own tools, on the account's files: a file's sheets, its doc, its
   diagrams, and the database connections saved in the Database view. ctx.files (flows.js) reads and
   saves the account's files; a file changed here is saved like any other (with its version history).
   Sheet cells are read as written: a formula cell gives its formula, not its value. */

const COL = n => { let s = ''; for (n += 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s; return s; };
const parseAddr = a => { const m = /^([A-Z]+)(\d+)$/.exec(a); if (!m) return null; let c = 0; for (const ch of m[1]) c = c * 26 + ch.charCodeAt(0) - 64; return { c: c - 1, r: Number(m[2]) - 1 }; };
const rid = p => p + Date.now().toString(36) + randomBytes(4).toString('hex');
const text = v => (v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v));

async function fileOf(args, id) {
  const f = await args.ctx.files.read(need(id, 'the Workline file'));
  if (!f) throw new FlowError('That Workline file wasn’t found. Pick it again.', 'not_found');
  return f;
}
const sheetOf = (f, name) => {
  const sheets = Array.isArray(f.sheets) ? f.sheets : [];
  const s = name ? sheets.find(x => x.name === name) : sheets[0];
  if (!s) throw new FlowError(name ? `No sheet called “${name}” in “${f.title}”.` : `“${f.title}” has no sheets yet.`, 'not_found');
  return s;
};
// A sheet's used area: the last row and column with something in them.
const extent = cells => {
  let rows = 0, cols = 0;
  for (const a of Object.keys(cells || {})) { const p = parseAddr(a); if (p && cells[a] !== '') { rows = Math.max(rows, p.r + 1); cols = Math.max(cols, p.c + 1); } }
  return { rows, cols };
};

export const WORKLINE_NODES = {
  'workline.sheet': { run: async args => {
    const p = args.params(), f = await fileOf(args, p.fileId), sh = sheetOf(f, p.sheet);
    sh.cells ||= {};
    const { rows, cols } = extent(sh.cells);
    const header = Array.from({ length: cols }, (_, c) => text(sh.cells[`${COL(c)}1`]).trim());
    if ((p.operation || 'read') === 'read') {
      const out = [];
      for (let r = 2; r <= rows; r++) {
        const row = Object.fromEntries(header.map((h, c) => [h || COL(c), sh.cells[`${COL(c)}${r}`] ?? '']));
        if (Object.values(row).some(v => v !== '')) out.push({ json: row });
      }
      return { main: out };
    }
    // Add each item as a row under the last one; its fields go under the matching header (new ones added on the right).
    let next = Math.max(rows, 1) + 1;
    const out = [];
    args.items.forEach((item, i) => {
      const q = args.params(item, i);
      const values = q.values && typeof q.values === 'object' && !Array.isArray(q.values) ? q.values : item.json;
      for (const k of Object.keys(values)) if (!header.includes(k)) { header.push(k); sh.cells[`${COL(header.length - 1)}1`] = k; }
      header.forEach((h, c) => { if (h && values[h] !== undefined) sh.cells[`${COL(c)}${next}`] = text(values[h]); });
      out.push({ json: { ...item.json, _row: next } });
      next++;
    });
    sh.rows = Math.max(sh.rows || 100, next + 20);
    sh.cols = Math.max(sh.cols || 26, header.length);
    await args.ctx.files.save(f);
    return { main: out };
  } },
  'workline.doc': { run: async args => {
    const p = args.params(), op = p.operation || 'read';
    if (op === 'create') {
      return each(args, async q => {
        const now = Date.now();
        const f = { id: rid('f'), title: String(q.title || 'From a workflow').slice(0, 120), created: now, updated: now, doc: text(q.text), diagrams: [{ id: rid('d'), type: 'architecture', name: 'Diagram 1', code: '', manual: {}, dir: 'LR', style: 'color' }], active: 0, view: 'doc' };
        await args.ctx.files.save(f);
        return { fileId: f.id, title: f.title };
      });
    }
    const f = await fileOf(args, p.fileId);
    if (op === 'read') return { main: [{ json: { fileId: f.id, title: f.title, doc: f.doc || '' } }] };
    const parts = args.items.map((item, i) => text(args.params(item, i).text)).filter(Boolean);
    f.doc = op === 'replace' ? parts.join('\n\n') : [String(f.doc || '').replace(/\s+$/, ''), ...parts].filter(Boolean).join('\n\n');
    await args.ctx.files.save(f);
    return { main: [{ json: { fileId: f.id, title: f.title, length: f.doc.length } }] };
  } },
  'workline.diagram': { run: async args => {
    const p = args.params(), f = await fileOf(args, p.fileId);
    f.diagrams = Array.isArray(f.diagrams) ? f.diagrams : [];
    if ((p.operation || 'read') === 'read') {
      const list = p.name ? f.diagrams.filter(d => d.name === p.name) : f.diagrams;
      return { main: list.map(d => ({ json: { fileId: f.id, name: d.name, type: d.type, code: d.code || '' } })) };
    }
    const out = [];
    args.items.forEach((item, i) => {
      const q = args.params(item, i), name = String(q.name || 'From a workflow').slice(0, 40), type = q.type || 'architecture';
      const code = text(need(q.code, 'the diagram code')).trim();
      const d = f.diagrams.find(x => x.name === name);
      if (d) Object.assign(d, { code, type, manual: d.type === type ? d.manual : {} });
      else f.diagrams.push({ id: rid('d'), type, name, code, manual: {}, dir: type === 'flowchart' ? 'TB' : 'LR', style: 'color' });
      out.push({ json: { fileId: f.id, diagram: name, type, replaced: !!d } });
    });
    await args.ctx.files.save(f);
    return { main: out };
  } },
  'workline.database': { run: async args => {
    const id = need(args.params().connection, 'a saved connection');
    const conn = args.ctx.dbConnection(id);
    if (!conn) throw new FlowError('That connection isn’t saved in the Database view any more. Pick another.', 'not_found');
    if (conn.user && !conn.password && !/:\/\/[^/]*:[^@/]*@/.test(conn.url || '')) throw new FlowError(`Tick “Remember the password” for “${conn.name || 'this connection'}” in the Database view, so workflows can use it.`, 'no_password');
    return each(args, async q => {
      const r = await dbHandle({ op: 'query', conn, sql: need(q.sql, 'the query') }, { allowPrivate: args.ctx.allowPrivate, timeout: 30_000 })
        .catch(e => { throw new FlowError(e.message, 'database'); });
      const set = (r.results || []).slice(-1)[0];
      if (!set || !set.rows) return { command: set?.command, count: set?.count ?? 0 };
      return set.rows.map(row => Object.fromEntries(set.columns.map((col, i) => [col, row[i]])));
    });
  } },
};
