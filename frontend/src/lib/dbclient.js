/* The Database view's side of live connections.
   - Saved connections live on the account (userdata.js, in Google Drive). Passwords are kept only when
     "Remember password" is ticked; otherwise only for this visit. They are never put in files, which can be shared.
   - PostgreSQL, MySQL, SQL Server and MongoDB go through the server (POST /api/db, see backend/dbconnect.js).
   - SQLite files open right here in the browser (sql.js), and can be downloaded again after changes.
   - schemaToErd turns a live schema into database-schema diagram code for the canvas. */

import { rid } from './utils.js';
import { getData, setData } from './userdata.js';

export const DB_KINDS = [
  { type: 'postgres', name: 'PostgreSQL', note: 'Also Supabase, Neon, RDS, CockroachDB', port: 5432, example: 'postgres://user:password@host:5432/database' },
  { type: 'mysql', name: 'MySQL / MariaDB', note: 'Also PlanetScale, TiDB, RDS MySQL', port: 3306, example: 'mysql://user:password@host:3306/database' },
  { type: 'mssql', name: 'SQL Server', note: 'Also Azure SQL', port: 1433, example: 'Server=tcp:host,1433;Database=db;User ID=user;Password=…;Encrypt=True' },
  { type: 'mongodb', name: 'MongoDB', note: 'Also MongoDB Atlas', port: 27017, example: 'mongodb+srv://user:password@cluster0.example.mongodb.net/database' },
  { type: 'sqlite', name: 'SQLite file', note: 'A .db / .sqlite file, opened in your browser', port: null, example: '' },
];
export const kindOf = type => DB_KINDS.find(k => k.type === type) || DB_KINDS[0];

/* ---- saved connections ---- */
const KEY = 'db-connections';
const secrets = new Map(); // id -> password (or connection string) for this visit only
export function loadConnections() {
  const list = getData(KEY, []);
  return Array.isArray(list) ? list.filter(c => c && c.id) : [];
}
export function saveConnections(list) {
  setData(KEY, list.map(c => {
    const { password, url, ...rest } = c;
    if (!c.remember) { secrets.set(c.id, { password, url }); return { ...rest, url: url ? stripPassword(url) : '' }; }
    return c;
  }));
}
// The last queries run on a connection, newest first.
export const queryHistory = id => { const h = getData('db-history:' + id, []); return Array.isArray(h) ? h : []; };
export const saveQueryHistory = (id, list) => setData('db-history:' + id, list);
// The connection with its password filled in from this visit, when it isn't remembered.
export function withSecret(c) {
  const s = secrets.get(c.id);
  return s ? { ...c, password: c.password || s.password, url: s.url || c.url } : c;
}
export const hasSecret = c => !!(c.remember || secrets.has(c.id) || c.type === 'sqlite' || (!c.user && !c.url));
export const newConnection = type => ({ id: rid('db'), name: '', type, url: '', host: '', port: kindOf(type).port || '', database: '', user: '', password: '', ssl: 'require', readOnly: false, remember: false });
// A connection string without its password, for showing and storing.
export function stripPassword(url) {
  return String(url || '').replace(/^(\w[\w+.-]*:\/\/[^:/@]+:)[^@]*@/, '$1•••@').replace(/(password|pwd)=[^;]*/ig, '$1=•••');
}
export const hostOf = c => {
  if (c.type === 'sqlite') return c.file || 'SQLite file';
  if (c.url) { const m = /@([^/?;,]+)/.exec(c.url) || /server=(?:tcp:)?([^;,]+)/i.exec(c.url) || /\/\/([^/?;]+)/.exec(c.url); return m ? m[1] : ''; }
  return c.host + (c.port && c.port !== kindOf(c.type).port ? ':' + c.port : '');
};

/* ---- talking to the server ---- */
export async function dbRequest(conn, op, extra = {}) {
  if (conn.type === 'sqlite') return sqliteRequest(conn, op, extra);
  const c = withSecret(conn);
  const payload = { type: c.type, readOnly: !!c.readOnly, ssl: c.ssl, ...(c.url ? { url: c.url } : { host: c.host, port: c.port, database: c.database, user: c.user, password: c.password }) };
  let r;
  try { r = await fetch('/api/db', { method: 'POST', headers: { 'content-type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify({ op, conn: payload, ...extra }) }); }
  catch (e) { throw new Error('Couldn’t reach the Workline server. Check your internet connection.'); }
  let body = null;
  try { body = await r.json(); } catch (e) {}
  if (r.status === 401) throw new Error('Sign in to connect to databases. Connections go through your Workline account.');
  if (r.status === 404 || (!body && r.status >= 400)) throw new Error('This copy of Workline has no database connector. It needs the Workline API (backend/, see the README).');
  if (!r.ok) throw new Error((body && body.message) || 'The database request failed.');
  return body;
}

/* ---- SQLite, in the browser ---- */
const sqlite = new Map(); // connection id -> sql.js Database
let SQL = null;
async function sqlJs() {
  if (SQL) return SQL;
  const [{ default: init }, { default: wasmUrl }] = await Promise.all([import('sql.js'), import('sql.js/dist/sql-wasm.wasm?url')]);
  SQL = await init({ locateFile: () => wasmUrl });
  return SQL;
}
export async function openSqliteFile(conn, bytes) {
  const S = await sqlJs();
  const db = new S.Database(new Uint8Array(bytes));
  db.exec('PRAGMA foreign_keys = ON');
  try { db.exec('SELECT count(*) FROM sqlite_master'); } catch (e) { db.close(); throw new Error('That isn’t a SQLite database file.'); }
  sqlite.get(conn.id)?.close();
  sqlite.set(conn.id, db);
  return db;
}
export const sqliteOpen = conn => sqlite.has(conn.id);
export const sqliteBytes = conn => sqlite.get(conn.id)?.export();
export function closeSqlite(conn) { sqlite.get(conn.id)?.close(); sqlite.delete(conn.id); }

const qi = s => '"' + String(s).replace(/"/g, '""') + '"';
const all = (db, sql, params = []) => {
  const st = db.prepare(sql);
  try { st.bind(params); const out = []; while (st.step()) out.push(st.getAsObject()); return out; } finally { st.free(); }
};
const cellOut = v => (v instanceof Uint8Array ? { $bytes: v.length } : v);
const READ_SQL = /^\s*(select|with|explain|values|pragma)\b/i;

async function sqliteRequest(conn, op, req) {
  const db = sqlite.get(conn.id);
  if (!db) throw new Error('Open the SQLite file again: files opened in the browser are closed when the page reloads.');
  const started = performance.now();
  if (op === 'test') return { ok: true, version: 'SQLite ' + all(db, 'select sqlite_version() v')[0].v };
  if (op === 'schema') {
    const tables = all(db, "select name, type from sqlite_master where type in ('table','view') and name not like 'sqlite_%' order by name");
    return { tables: tables.map(t => {
      const cols = all(db, `pragma table_info(${qi(t.name)})`);
      const pk = cols.filter(c => c.pk).sort((a, b) => a.pk - b.pk).map(c => c.name);
      const unique = all(db, `pragma index_list(${qi(t.name)})`).filter(i => i.unique && i.origin !== 'pk').map(i => all(db, `pragma index_info(${qi(i.name)})`).map(x => x.name));
      const fkRows = all(db, `pragma foreign_key_list(${qi(t.name)})`);
      const fks = [];
      fkRows.forEach(f => { let x = fks.find(y => y.id === f.id); if (!x) fks.push(x = { id: f.id, cols: [], refSchema: 'main', refTable: f.table, refCols: [] }); x.cols.push(f.from); x.refCols.push(f.to); });
      // REFERENCES t with no column means t's primary key.
      fks.forEach(f => { if (f.refCols.some(c => c == null)) { const rp = all(db, `pragma table_info(${qi(f.refTable)})`).filter(c => c.pk).map(c => c.name); f.refCols = f.refCols.map((c, i) => c ?? rp[i] ?? 'rowid'); } delete f.id; });
      let rows = null;
      try { rows = all(db, `select count(*) n from ${qi(t.name)}`)[0].n; } catch (e) {}
      return { schema: 'main', name: t.name, kind: t.type, rows, columns: cols.map(c => ({ name: c.name, type: (c.type || '').toLowerCase(), nullable: !c.notnull && !c.pk, default: c.dflt_value })), pk, unique, fks };
    }) };
  }
  if (op === 'rows') {
    const name = qi(req.table.name), params = [];
    const where = (req.filters || []).filter(f => f.col).map(f => {
      const c = qi(f.col);
      if (f.op === 'null') return `${c} IS NULL`;
      if (f.op === 'notnull') return `${c} IS NOT NULL`;
      params.push(f.op === 'contains' ? `%${f.value}%` : f.op === 'starts' ? `${f.value}%` : f.value);
      return f.op === 'contains' || f.op === 'starts' ? `${c} LIKE ?` : `${c} ${{ '=': '=', '!=': '<>', '>': '>', '<': '<', '>=': '>=', '<=': '<=' }[f.op] || '='} ?`;
    });
    const w = where.length ? ' WHERE ' + where.join(' AND ') : '';
    const sort = req.sort && req.sort.col ? ` ORDER BY ${qi(req.sort.col)} ${req.sort.desc ? 'DESC' : 'ASC'}` : '';
    const limit = Math.max(1, Math.min(1000, req.limit | 0 || 100)), offset = Math.max(0, req.offset | 0);
    const res = db.exec(`SELECT * FROM ${name}${w}${sort} LIMIT ${limit} OFFSET ${offset}`, params);
    const columns = res[0] ? res[0].columns : all(db, `pragma table_info(${name})`).map(c => c.name);
    return { columns, rows: res[0] ? res[0].values.map(r => r.map(cellOut)) : [], total: all(db, `SELECT count(*) n FROM ${name}${w}`, params)[0].n };
  }
  if (op === 'query') {
    const sql = String(req.sql || '');
    if (conn.readOnly && sql.split(/;\s*(?=\S)/).some(s => s.trim() && !READ_SQL.test(s))) throw new Error('This connection is read-only, so only SELECT-style queries can run.');
    const total = () => db.exec('select total_changes()')[0].values[0][0];
    const before = total();
    let sets;
    try { sets = db.exec(sql); } catch (e) { throw new Error(e.message); }
    const changed = total() - before;
    const results = sets.map(s => ({ command: 'SELECT', columns: s.columns, rows: s.values.slice(0, 1000).map(r => r.map(cellOut)), count: s.values.length, truncated: s.values.length > 1000 }));
    if (!results.length || (changed > 0 && !READ_SQL.test(sql))) results.push({ command: 'OK', columns: [], rows: null, count: changed });
    return { results, ms: Math.round(performance.now() - started), changed: changed > 0 };
  }
  if (conn.readOnly) throw new Error('This connection is read-only.');
  const name = qi(req.table.name), params = [];
  const keyWhere = () => {
    const k = Object.entries(req.key || {});
    if (!k.length) throw new Error('This table has no primary key, so rows can’t be changed here. Use a query instead.');
    return ' WHERE ' + k.map(([c, v]) => (v === null ? `${qi(c)} IS NULL` : (params.push(v), `${qi(c)} = ?`))).join(' AND ');
  };
  let sql;
  if (op === 'insert') { const e = Object.entries(req.values || {}); sql = e.length ? `INSERT INTO ${name} (${e.map(([k]) => qi(k)).join(', ')}) VALUES (${e.map(([, v]) => (params.push(v), '?')).join(', ')})` : `INSERT INTO ${name} DEFAULT VALUES`; }
  else if (op === 'update') { const e = Object.entries(req.values || {}); sql = `UPDATE ${name} SET ${e.map(([k, v]) => (params.push(v), `${qi(k)} = ?`)).join(', ')}`; sql += keyWhere(); }
  else sql = `DELETE FROM ${name}` + keyWhere();
  db.exec('SAVEPOINT lw');
  try {
    db.run(sql, params);
    const n = db.getRowsModified();
    if (op !== 'insert' && n > 1) throw new Error(`That would change ${n} rows, not one, so nothing was changed.`);
    db.exec('RELEASE lw');
    return { count: n, changed: true };
  } catch (e) { db.exec('ROLLBACK TO lw'); db.exec('RELEASE lw'); throw new Error(e.message); }
}

/* ---- a live schema as diagram code ---- */
// Database types, shortened for the diagram: character varying(100) → varchar(100).
export function shortType(t) {
  let s = String(t || '').toLowerCase().trim();
  s = s.replace(/^character varying/, 'varchar').replace(/^character\b/, 'char').replace(/^double precision$/, 'double')
    .replace(/^timestamp(\(\d+\))? with time zone$/, 'timestamptz').replace(/^timestamp(\(\d+\))? without time zone$/, 'timestamp')
    .replace(/^time(\(\d+\))? with time zone$/, 'timetz').replace(/^time(\(\d+\))? without time zone$/, 'time')
    .replace(/^(tinyint|smallint|mediumint|int|bigint)\(\d+\)/, '$1').replace(/\s+unsigned/, '').replace(/^enum\(.*\)$/, 'enum').replace(/^set\(.*\)$/, 'set');
  return s.replace(/\s+/g, '_').replace(/[^\w(),.[\]|-]/g, '').slice(0, 40);
}
const ident = s => String(s).replace(/[^\w-]/g, '_') || '_';

// tables: from the 'schema' request. Only tables in `schemas` (all when empty) are drawn, plus nothing else.
export function schemaToErd(tables, { title = '', schemas = null, views = false } = {}) {
  const shown = tables.filter(t => (views || t.kind !== 'view') && (!schemas || !schemas.length || schemas.includes(t.schema)));
  // Tables with the same name in two schemas get the schema in front.
  const clash = new Set(), seen = new Set();
  shown.forEach(t => { if (seen.has(t.name)) clash.add(t.name); seen.add(t.name); });
  const idOf = (schema, name) => ident(clash.has(name) ? schema + '_' + name : name);
  const byKey = new Map(shown.map(t => [t.schema + '.' + t.name, t]));
  const lines = title ? [`title: ${title}`] : [];
  const rels = [];
  shown.forEach(t => {
    const id = idOf(t.schema, t.name), fkCols = new Set(t.fks.flatMap(f => f.cols));
    const uniq = new Set(t.unique.filter(u => u.length === 1).map(u => u[0]));
    lines.push(`${id}${t.kind === 'view' ? ' [icon: eye]' : t.kind === 'collection' ? ' [icon: database]' : ''} {`);
    t.columns.forEach(c => {
      const pk = t.pk.includes(c.name), fk = fkCols.has(c.name);
      const key = pk && fk ? 'pk,fk' : pk ? 'pk' : fk ? 'fk' : uniq.has(c.name) ? 'unique' : '';
      const ty = shortType(c.type);
      lines.push(`  ${ident(c.name)}${ty ? ' ' + ty : ''}${key ? ' ' + key : ''}`);
    });
    lines.push('}');
    t.fks.forEach(f => {
      const to = byKey.get(f.refSchema + '.' + f.refTable) || shown.find(x => x.name === f.refTable);
      if (!to) return;
      const one = f.cols.length === 1 && (uniq.has(f.cols[0]) || (t.pk.length === 1 && t.pk[0] === f.cols[0]));
      rels.push(`${id}.${ident(f.cols[0])} ${one ? '-' : '>'} ${idOf(to.schema, to.name)}.${ident(f.refCols[0] || 'id')}`);
    });
  });
  if (rels.length) lines.push('', ...new Set(rels));
  return lines.join('\n') + '\n';
}

// How a value from the database reads in a grid cell.
export function showValue(v) {
  if (v == null) return '';
  if (typeof v === 'object') {
    if ('$bytes' in v) return `‹binary, ${v.$bytes} bytes›`;
    if ('$oid' in v) return v.$oid;
    if ('$date' in v) return typeof v.$date === 'string' ? v.$date : JSON.stringify(v.$date);
    if ('$numberDecimal' in v) return v.$numberDecimal;
    return JSON.stringify(v);
  }
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T00:00:00(\.000)?Z$/.test(v)) return v.slice(0, 10);
  return String(v);
}
// A cell's value as text to edit, and back. Empty stays empty text; the NULL button sets null.
export const editText = v => (v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v));
