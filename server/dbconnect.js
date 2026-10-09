import { lookup, resolveSrv } from 'node:dns/promises';
import { isIP } from 'node:net';

/* Live database connections for the Database view: PostgreSQL, MySQL / MariaDB, SQL Server and MongoDB.
   Shared by the Linework server (POST /api/db) and the Netlify function (netlify/functions/db.mts).

   Every request carries its connection and opens it, does one thing and closes it, so nothing is kept
   between requests and the database's password is never stored on the server.
   Requests:  {op: 'test' | 'schema' | 'rows' | 'query' | 'insert' | 'update' | 'delete', conn, ...}
   conn:      {type, url} or {type, host, port, database, user, password, ssl: 'require' | 'verify' | 'off'},
              plus readOnly: true to refuse changes.

   Safety: hosts are resolved first, and private, loopback and link-local addresses are refused unless
   allowPrivate is set, so the server can't be used to reach machines on its own network. Queries time out,
   results are capped, and with readOnly nothing can be changed. (SQLite files are opened in the browser and
   never come here.) */

export const DB_TYPES = ['postgres', 'mysql', 'mssql', 'mongodb'];
const MAX_ROWS = 1000, MAX_RESULTS = 20, MAX_CELL = 10_000;

export class DbError extends Error {
  constructor(code, message, status = 400) { super(message); this.code = code; this.status = status; }
}

/* ---- connection settings ---- */
const DEFAULT_PORT = { postgres: 5432, mysql: 3306, mssql: 1433, mongodb: 27017 };

// A connection string → {host, port, database, user, password, ssl}. Mongo strings are kept whole.
export function parseConn(conn) {
  if (!conn || !DB_TYPES.includes(conn.type)) throw new DbError('bad_type', 'Pick a database type.');
  const out = { type: conn.type, readOnly: !!conn.readOnly, ssl: conn.ssl || 'require' };
  const url = String(conn.url || '').trim();
  if (!url) {
    Object.assign(out, { host: String(conn.host || '').trim(), port: Number(conn.port) || DEFAULT_PORT[conn.type], database: String(conn.database || ''), user: String(conn.user || ''), password: String(conn.password || '') });
    if (conn.type === 'mongodb') out.url = `mongodb://${out.user ? encodeURIComponent(out.user) + ':' + encodeURIComponent(out.password) + '@' : ''}${out.host}:${out.port}/${encodeURIComponent(out.database)}${out.ssl !== 'off' ? '?tls=true' : ''}`;
  } else if (conn.type === 'mongodb') {
    if (!/^mongodb(\+srv)?:\/\//i.test(url)) throw new DbError('bad_url', 'A MongoDB connection string starts with mongodb:// or mongodb+srv://');
    out.url = url;
    const m = /^mongodb(\+srv)?:\/\/(?:[^@/]*@)?([^/?]+)(?:\/([^?]*))?/i.exec(url);
    out.srv = !!m[1];
    out.hosts = m[2].split(',').map(h => { const x = /^\[?([^\]]+?)\]?(?::(\d+))?$/.exec(h); return { host: x[1], port: Number(x[2]) || 27017 }; });
    out.database = decodeURIComponent(m[3] || '');
  } else if (conn.type === 'mssql' && !/^\w+:\/\//.test(url)) {
    // ADO.NET / JDBC style: Server=tcp:host,1433;Database=x;User ID=u;Password=p;Encrypt=True
    const kv = {};
    url.replace(/^jdbc:sqlserver:\/\/([^;]*)/i, (a, hp) => { kv.server = hp; return ''; }).split(';').forEach(p => {
      const i = p.indexOf('=');
      if (i > 0) kv[p.slice(0, i).trim().toLowerCase().replace(/\s+/g, ' ')] = p.slice(i + 1).trim();
    });
    const server = (kv.server || kv['data source'] || kv.address || '').replace(/^tcp:/i, '');
    const [host, port] = server.split(/[,:]/);
    Object.assign(out, {
      host, port: Number(port || kv.port) || 1433, database: kv.database || kv['initial catalog'] || kv.databasename || '',
      user: kv['user id'] || kv.uid || kv.user || kv.username || '', password: kv.password || kv.pwd || '',
      ssl: /^(false|no|disable|optional)$/i.test(kv.encrypt || '') ? 'off' : /^(true|yes|strict|mandatory)$/i.test(kv.trustservercertificate || '') ? 'require' : kv.encrypt ? 'verify' : out.ssl,
    });
  } else {
    let u;
    try { u = new URL(url); } catch (e) { throw new DbError('bad_url', 'That connection string isn’t a valid URL.'); }
    const q = u.searchParams, mode = (q.get('sslmode') || q.get('ssl-mode') || q.get('ssl') || '').toLowerCase();
    Object.assign(out, {
      host: decodeURIComponent(u.hostname.replace(/^\[|\]$/g, '')), port: Number(u.port) || DEFAULT_PORT[conn.type],
      database: decodeURIComponent(u.pathname.replace(/^\//, '')), user: decodeURIComponent(u.username), password: decodeURIComponent(u.password),
      ssl: /^(disable|false|0|off)$/.test(mode) ? 'off' : /^(verify-ca|verify-full|verify_identity|verify_ca)$/.test(mode) ? 'verify' : mode ? 'require' : out.ssl,
    });
  }
  if (conn.type !== 'mongodb' && !out.host) throw new DbError('bad_host', 'Enter the database’s host name.');
  return out;
}

/* ---- refusing private addresses ---- */
function privateV4(ip) {
  const [a, b] = ip.split('.').map(Number);
  return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)
    || (a === 100 && b >= 64 && b <= 127) || (a === 192 && b === 0) || (a === 198 && (b === 18 || b === 19)) || a >= 224;
}
export function isPrivateIp(ip) {
  if (isIP(ip) === 4) return privateV4(ip);
  const s = ip.toLowerCase();
  const v4 = /^(?:::ffff:|64:ff9b::)(\d+\.\d+\.\d+\.\d+)$/.exec(s);
  if (v4) return privateV4(v4[1]);
  return s === '::' || s === '::1' || /^f[cd]/.test(s) || /^fe[89ab]/.test(s) || /^ff/.test(s);
}
// The addresses a host name stands for, refusing private ones. Returns the first address to connect to.
async function checkHost(host, allowPrivate) {
  if (!host) throw new DbError('bad_host', 'Enter the database’s host name.');
  let addrs;
  try { addrs = isIP(host) ? [{ address: host }] : await lookup(host, { all: true }); }
  catch (e) { throw new DbError('host_not_found', `The host “${host}” wasn’t found. Check the spelling.`); }
  if (!allowPrivate && (/^localhost$/i.test(host) || addrs.some(a => isPrivateIp(a.address))))
    throw new DbError('private_host', `“${host}” is a private or local address. This server only connects to databases on the internet; to reach one on your own network, run the Linework server there with DB_ALLOW_PRIVATE=1.`, 403);
  return addrs[0].address;
}

/* ---- values: everything the browser gets is plain JSON ---- */
function cell(v) {
  if (v == null) return null;
  if (typeof v === 'bigint') return v.toString();
  if (v instanceof Date) return isNaN(v) ? null : v.toISOString();
  if (Buffer.isBuffer(v) || v instanceof Uint8Array) return { $bytes: v.length };
  if (typeof v === 'string') return v.length > MAX_CELL ? v.slice(0, MAX_CELL) + '…' : v;
  if (typeof v === 'object') { const s = JSON.stringify(v, (k, x) => (typeof x === 'bigint' ? x.toString() : x)); return s.length > MAX_CELL ? s.slice(0, MAX_CELL) + '…' : JSON.parse(s); }
  return v;
}
// Rows as JSON-ready arrays, stopping at MAX_ROWS or about 4 MB of text, whichever comes first.
const MAX_CHARS = 4_000_000;
function rowsOut(rows, budget = { left: MAX_CHARS }) {
  const out = [];
  for (const r of rows.slice(0, MAX_ROWS)) {
    const row = r.map(cell);
    budget.left -= JSON.stringify(row).length;
    if (budget.left < 0 && out.length) { budget.cut = true; break; }
    out.push(row);
  }
  return out;
}

// Read-only SQL for databases without read-only transactions that cover everything.
const READ_SQL = /^\s*(select|with|show|describe|desc|explain|values|table)\b/i;
const splitStatements = sql => sql.split(/;\s*(?=\S)/).map(s => s.trim()).filter(Boolean);
const refuseWrites = sql => {
  const bad = splitStatements(sql.replace(/--[^\n]*|\/\*[\s\S]*?\*\//g, '').replace(/'(?:[^']|'')*'/g, "''")).find(s => !READ_SQL.test(s) || /\binto\b\s+[\w`"[]/i.test(s));
  if (bad) throw new DbError('read_only', 'This connection is read-only, so only SELECT-style queries can run.', 403);
};

/* ---- the drivers ---- */
const qi = { postgres: s => '"' + String(s).replace(/"/g, '""') + '"', mysql: s => '`' + String(s).replace(/`/g, '``') + '`', mssql: s => '[' + String(s).replace(/]/g, ']]') + ']' };

async function openPostgres(c, ip, timeout) {
  const { default: pg } = await import('pg');
  // Dates and big numbers as text, as the database shows them.
  const types = { getTypeParser: (oid, fmt) => ([1082, 1114, 1184, 1083, 1266, 20, 1700].includes(oid) ? v => v : pg.types.getTypeParser(oid, fmt)) };
  const client = new pg.Client({
    host: ip, port: c.port, database: c.database || undefined, user: c.user || undefined, password: c.password || undefined,
    ssl: c.ssl === 'off' ? false : { servername: isIP(c.host) ? undefined : c.host, rejectUnauthorized: c.ssl === 'verify' },
    connectionTimeoutMillis: Math.min(10_000, timeout), statement_timeout: timeout, query_timeout: timeout + 2000, application_name: 'Linework', types,
  });
  await client.connect();
  if (c.readOnly) await client.query('SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY');
  return {
    q: qi.postgres, ph: i => '$' + i,
    async all(sql, params = []) { const r = await client.query({ text: sql, values: params }); return r.rows; },
    async run(sql, params = []) { const r = await client.query({ text: sql, values: params }); return r.rowCount; },
    async query(sql) {
      const res = [].concat(await client.query({ text: sql, rowMode: 'array' }));
      return res.map(r => ({ command: r.command, columns: (r.fields || []).map(f => f.name), rows: r.fields && r.fields.length ? r.rows : null, count: r.rowCount }));
    },
    begin: () => client.query(c.readOnly ? 'BEGIN READ ONLY' : 'BEGIN'), commit: () => client.query('COMMIT'), rollback: () => client.query('ROLLBACK'),
    async version() { return (await client.query('select version() v')).rows[0].v; },
    close: () => client.end().catch(() => {}),
  };
}

async function openMysql(c, ip, timeout) {
  const mysql = (await import('mysql2/promise')).default;
  const conn = await mysql.createConnection({
    host: ip, port: c.port, database: c.database || undefined, user: c.user || undefined, password: c.password || undefined,
    ssl: c.ssl === 'off' ? undefined : { servername: isIP(c.host) ? undefined : c.host, rejectUnauthorized: c.ssl === 'verify' },
    connectTimeout: Math.min(10_000, timeout), multipleStatements: true, flags: ['-LOCAL_FILES'], // a server can't ask for files from this machine
    dateStrings: true, supportBigNumbers: true, bigNumberStrings: true, decimalNumbers: false,
  });
  if (c.readOnly) await conn.query('SET SESSION TRANSACTION READ ONLY');
  return {
    q: qi.mysql, ph: () => '?',
    async all(sql, params = []) { const [rows] = await conn.query({ sql, values: params, timeout }); return rows; },
    async run(sql, params = []) { const [r] = await conn.query({ sql, values: params, timeout }); return r.affectedRows; },
    async query(sql) {
      if (c.readOnly) refuseWrites(sql);
      const [res, fields] = await conn.query({ sql, rowsAsArray: true, timeout });
      // One statement gives [rows, fields]; several give arrays of each.
      const multi = splitStatements(sql).length > 1 && Array.isArray(res) && Array.isArray(fields) && fields.some(f => Array.isArray(f) || f == null);
      const sets = multi ? res.map((r, i) => [r, fields[i]]) : [[res, fields]];
      return sets.map(([r, f]) => (Array.isArray(r) ? { command: 'SELECT', columns: (f || []).map(x => x.name), rows: r, count: r.length } : { command: 'OK', columns: [], rows: null, count: r.affectedRows }));
    },
    begin: () => conn.query(c.readOnly ? 'START TRANSACTION READ ONLY' : 'START TRANSACTION'), commit: () => conn.query('COMMIT'), rollback: () => conn.query('ROLLBACK'),
    async version() { const [r] = await conn.query('select version() v'); return 'MySQL ' + r[0].v; },
    close: () => conn.end().catch(() => {}),
  };
}

async function openMssql(c, ip, timeout) {
  const sql = (await import('mssql')).default;
  const pool = new sql.ConnectionPool({
    server: c.host, port: c.port, database: c.database || undefined, user: c.user || undefined, password: c.password || undefined,
    options: { encrypt: c.ssl !== 'off', trustServerCertificate: c.ssl !== 'verify', appName: 'Linework' },
    connectionTimeout: Math.min(10_000, timeout), requestTimeout: timeout, pool: { max: 1, min: 0 },
  });
  await pool.connect();
  let tx = null;
  const req = () => (tx ? new sql.Request(tx) : pool.request());
  const bind = (r, params) => { params.forEach((p, i) => r.input('p' + (i + 1), p)); return r; };
  return {
    q: qi.mssql, ph: i => '@p' + i,
    async all(text, params = []) { return (await bind(req(), params).query(text)).recordset || []; },
    async run(text, params = []) { const r = await bind(req(), params).query(text); return r.rowsAffected.reduce((a, b) => a + b, 0); },
    async query(text) {
      if (c.readOnly) refuseWrites(text);
      const r = req();
      r.arrayRowMode = true;
      const res = await r.query(text);
      const sets = (res.recordsets || []).map((rows, i) => ({ command: 'SELECT', columns: ((res.columns || [])[i] || []).map(x => x.name), rows, count: rows.length }));
      return sets.length ? sets : [{ command: 'OK', columns: [], rows: null, count: res.rowsAffected.reduce((a, b) => a + b, 0) }];
    },
    async begin() { tx = new sql.Transaction(pool); await tx.begin(); }, async commit() { await tx.commit(); tx = null; }, async rollback() { if (tx) await tx.rollback().catch(() => {}); tx = null; },
    async version() { return (await pool.request().query('select @@version v')).recordset[0].v.split('\n')[0]; },
    close: () => pool.close().catch(() => {}),
  };
}

async function openMongo(c, timeout) {
  const { MongoClient, BSON } = await import('mongodb');
  const { EJSON } = BSON;
  const client = new MongoClient(c.url, { serverSelectionTimeoutMS: Math.min(10_000, timeout), connectTimeoutMS: Math.min(10_000, timeout), socketTimeoutMS: timeout + 5000, appName: 'Linework' });
  await client.connect();
  const db = client.db(c.database || undefined);
  return { client, db, EJSON, timeout, close: () => client.close().catch(() => {}) };
}

async function open(c, opts) {
  const timeout = opts.timeout || 30_000;
  if (c.type === 'mongodb') {
    // Check every host the string names (for +srv, the hosts its DNS record lists).
    const hosts = c.srv ? await resolveSrv('_mongodb._tcp.' + c.hosts[0].host).catch(() => { throw new DbError('host_not_found', `The host “${c.hosts[0].host}” wasn’t found.`); }).then(r => r.map(x => ({ host: x.name }))) : (c.hosts || [{ host: c.host }]);
    for (const h of hosts) await checkHost(h.host, opts.allowPrivate);
    return openMongo(c, timeout);
  }
  const ip = await checkHost(c.host, opts.allowPrivate);
  // Connect to the address that was checked, so the name can't point somewhere else by the time we connect.
  return c.type === 'postgres' ? openPostgres(c, ip, timeout) : c.type === 'mysql' ? openMysql(c, ip, timeout) : openMssql(c, ip, timeout);
}

/* ---- schema ---- */
const SYSTEM = { postgres: ['pg_catalog', 'information_schema'], mysql: ['mysql', 'information_schema', 'performance_schema', 'sys'], mssql: ['sys', 'INFORMATION_SCHEMA'] };

async function schemaSql(c, d) {
  const tables = new Map(), key = (s, n) => s + '.' + n;
  const table = (schema, name, kind, rows) => { const t = { schema, name, kind, rows: rows == null ? null : Math.max(0, Math.round(Number(rows))), columns: [], pk: [], unique: [], fks: [] }; tables.set(key(schema, name), t); return t; };
  if (c.type === 'postgres') {
    const ts = await d.all(`select c.oid, n.nspname s, c.relname t, c.relkind k, c.reltuples r from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where c.relkind in ('r','p','v','m','f') and n.nspname not in ('pg_catalog','information_schema') and n.nspname not like 'pg_toast%' and n.nspname not like 'pg_temp%'
      and not c.relispartition order by 2, 3`);
    const byOid = new Map();
    ts.forEach(r => byOid.set(r.oid, table(r.s, r.t, 'rvmf'.includes(r.k) && r.k !== 'r' ? (r.k === 'f' ? 'foreign' : 'view') : 'table', r.r < 0 ? null : r.r)));
    if (!ts.length) return [];
    const oids = ts.map(r => r.oid);
    const cols = await d.all(`select attrelid o, attname n, format_type(atttypid, atttypmod) ty, attnotnull nn, pg_get_expr(ad.adbin, ad.adrelid) df, attnum
      from pg_attribute a left join pg_attrdef ad on ad.adrelid = a.attrelid and ad.adnum = a.attnum
      where attrelid = any($1::oid[]) and attnum > 0 and not attisdropped order by attrelid, attnum`, [oids]);
    const names = new Map();
    cols.forEach(r => { const t = byOid.get(r.o); t.columns.push({ name: r.n, type: r.ty, nullable: !r.nn, default: r.df }); names.set(r.o + ':' + r.attnum, r.n); });
    const cons = await d.all(`select conrelid o, contype k, conkey ks, confrelid fo, confkey fks from pg_constraint where conrelid = any($1::oid[]) and contype in ('p','u','f')`, [oids]);
    cons.forEach(r => {
      const t = byOid.get(r.o), cs = (r.ks || []).map(n => names.get(r.o + ':' + n));
      if (r.k === 'p') t.pk = cs;
      else if (r.k === 'u') t.unique.push(cs);
      else {
        const to = byOid.get(r.fo);
        if (to) t.fks.push({ cols: cs, refSchema: to.schema, refTable: to.name, refCols: (r.fks || []).map(n => names.get(r.fo + ':' + n)) });
      }
    });
  } else if (c.type === 'mysql') {
    const where = c.database ? 'table_schema = database()' : `table_schema not in (${SYSTEM.mysql.map(s => `'${s}'`).join(',')})`;
    (await d.all(`select table_schema s, table_name t, table_type k, table_rows r from information_schema.tables where ${where} order by 1, 2`))
      .forEach(r => table(r.s, r.t, /view/i.test(r.k) ? 'view' : 'table', r.r));
    (await d.all(`select table_schema s, table_name t, column_name n, column_type ty, is_nullable nl, column_default df from information_schema.columns where ${where} order by table_schema, table_name, ordinal_position`))
      .forEach(r => { const t = tables.get(key(r.s, r.t)); if (t) t.columns.push({ name: r.n, type: r.ty, nullable: r.nl === 'YES', default: r.df }); });
    const idx = await d.all(`select table_schema s, table_name t, index_name i, non_unique nu, column_name n from information_schema.statistics where ${where} order by table_schema, table_name, index_name, seq_in_index`);
    const groups = new Map();
    idx.forEach(r => { const k = key(r.s, r.t) + '|' + r.i; if (!groups.has(k)) groups.set(k, { t: tables.get(key(r.s, r.t)), i: r.i, nu: Number(r.nu), cols: [] }); groups.get(k).cols.push(r.n); });
    groups.forEach(g => { if (!g.t) return; if (g.i === 'PRIMARY') g.t.pk = g.cols; else if (!g.nu) g.t.unique.push(g.cols); });
    const fk = await d.all(`select table_schema s, table_name t, constraint_name c, column_name n, referenced_table_schema rs, referenced_table_name rt, referenced_column_name rn
      from information_schema.key_column_usage where ${where} and referenced_table_name is not null order by table_schema, table_name, constraint_name, ordinal_position`);
    const fks = new Map();
    fk.forEach(r => { const k = key(r.s, r.t) + '|' + r.c; if (!fks.has(k)) fks.set(k, { t: tables.get(key(r.s, r.t)), f: { cols: [], refSchema: r.rs, refTable: r.rt, refCols: [] } }); const x = fks.get(k).f; x.cols.push(r.n); x.refCols.push(r.rn); });
    fks.forEach(({ t, f }) => t && t.fks.push(f));
  } else {
    (await d.all(`select s.name s, o.name t, o.type k, (select sum(p.rows) from sys.partitions p where p.object_id = o.object_id and p.index_id in (0,1)) r
      from sys.objects o join sys.schemas s on s.schema_id = o.schema_id where o.type in ('U','V') and o.is_ms_shipped = 0 order by 1, 2`))
      .forEach(r => table(r.s, r.t, r.k.trim() === 'V' ? 'view' : 'table', r.r));
    (await d.all(`select table_schema s, table_name t, column_name n, data_type ty, character_maximum_length l, numeric_precision p, numeric_scale sc, is_nullable nl, column_default df
      from information_schema.columns order by table_schema, table_name, ordinal_position`)).forEach(r => {
      const t = tables.get(key(r.s, r.t));
      if (!t) return;
      const ty = r.l != null && /char|binary/i.test(r.ty) ? `${r.ty}(${r.l === -1 ? 'max' : r.l})` : /^(decimal|numeric)$/i.test(r.ty) ? `${r.ty}(${r.p},${r.sc})` : r.ty;
      t.columns.push({ name: r.n, type: ty, nullable: r.nl === 'YES', default: r.df });
    });
    const kc = await d.all(`select tc.table_schema s, tc.table_name t, tc.constraint_name c, tc.constraint_type k, kcu.column_name n from information_schema.table_constraints tc
      join information_schema.key_column_usage kcu on kcu.constraint_name = tc.constraint_name and kcu.table_schema = tc.table_schema and kcu.table_name = tc.table_name
      where tc.constraint_type in ('PRIMARY KEY','UNIQUE') order by tc.table_schema, tc.table_name, tc.constraint_name, kcu.ordinal_position`);
    const g = new Map();
    kc.forEach(r => { const k = key(r.s, r.t) + '|' + r.c; if (!g.has(k)) g.set(k, { t: tables.get(key(r.s, r.t)), k: r.k, cols: [] }); g.get(k).cols.push(r.n); });
    g.forEach(x => { if (!x.t) return; if (x.k === 'PRIMARY KEY') x.t.pk = x.cols; else x.t.unique.push(x.cols); });
    const fk = await d.all(`select fk.name c, schema_name(tp.schema_id) s, tp.name t, cp.name n, schema_name(tr.schema_id) rs, tr.name rt, cr.name rn
      from sys.foreign_keys fk join sys.foreign_key_columns fkc on fkc.constraint_object_id = fk.object_id
      join sys.tables tp on tp.object_id = fkc.parent_object_id join sys.columns cp on cp.object_id = fkc.parent_object_id and cp.column_id = fkc.parent_column_id
      join sys.tables tr on tr.object_id = fkc.referenced_object_id join sys.columns cr on cr.object_id = fkc.referenced_object_id and cr.column_id = fkc.referenced_column_id
      order by fk.name, fkc.constraint_column_id`);
    const fks = new Map();
    fk.forEach(r => { const k = key(r.s, r.t) + '|' + r.c; if (!fks.has(k)) fks.set(k, { t: tables.get(key(r.s, r.t)), f: { cols: [], refSchema: r.rs, refTable: r.rt, refCols: [] } }); const x = fks.get(k).f; x.cols.push(r.n); x.refCols.push(r.rn); });
    fks.forEach(({ t, f }) => t && t.fks.push(f));
  }
  return [...tables.values()];
}

// MongoDB: each collection's fields, from a sample of its documents. A field like userId or user_id holding
// ObjectIds becomes a link to the users collection when there is one.
const bsonType = v => (v == null ? 'null' : v._bsontype ? ({ ObjectId: 'objectId', Decimal128: 'decimal', Long: 'long', Int32: 'int', Double: 'double', Binary: 'binData', Timestamp: 'timestamp' }[v._bsontype] || v._bsontype.toLowerCase())
  : v instanceof Date ? 'date' : Array.isArray(v) ? 'array' : typeof v === 'object' ? 'object' : typeof v === 'number' ? (Number.isInteger(v) ? 'int' : 'double') : typeof v);
async function schemaMongo(m) {
  const cols = (await m.db.listCollections({}, { nameOnly: false }).toArray()).filter(x => !x.name.startsWith('system.'));
  const names = new Set(cols.map(x => x.name));
  const out = [];
  for (const col of cols.sort((a, b) => a.name.localeCompare(b.name))) {
    const t = { schema: m.db.databaseName, name: col.name, kind: col.type === 'view' ? 'view' : 'collection', rows: null, columns: [], pk: ['_id'], unique: [], fks: [] };
    const coll = m.db.collection(col.name);
    t.rows = await coll.estimatedDocumentCount().catch(() => null);
    const docs = await coll.aggregate([{ $sample: { size: 100 } }], { maxTimeMS: Math.min(5000, m.timeout) }).toArray().catch(() => coll.find({}).limit(100).toArray());
    const fields = new Map();
    docs.forEach(d => Object.entries(d).forEach(([k, v]) => { if (!fields.has(k)) fields.set(k, new Map()); const ty = bsonType(v); fields.get(k).set(ty, (fields.get(k).get(ty) || 0) + 1); }));
    if (!fields.has('_id')) fields.set('_id', new Map([['objectId', 1]]));
    for (const [k, types] of [...fields].sort((a, b) => (a[0] === '_id' ? -1 : b[0] === '_id' ? 1 : 0))) {
      const list = [...types].filter(([ty]) => ty !== 'null').sort((a, b) => b[1] - a[1]).map(([ty]) => ty);
      t.columns.push({ name: k, type: list.join('|') || 'null', nullable: types.has('null') || [...types.values()].reduce((a, b) => a + b, 0) < docs.length });
      const base = /^(.+?)(?:_id|Id|ID)$/.exec(k);
      if (base && k !== '_id' && list[0] === 'objectId') {
        const b = base[1].toLowerCase(), target = [b, b + 's', b + 'es', b.replace(/y$/, 'ies')].find(n => names.has(n));
        if (target) t.fks.push({ cols: [k], refSchema: t.schema, refTable: target, refCols: ['_id'] });
      }
    }
    out.push(t);
  }
  return out;
}

/* ---- browsing and editing rows ---- */
const OPS = { '=': '=', '!=': '<>', '>': '>', '<': '<', '>=': '>=', '<=': '<=' };
function whereSql(c, d, filters, params) {
  const parts = (filters || []).filter(f => f && f.col).map(f => {
    const col = d.q(f.col);
    if (f.op === 'null') return `${col} IS NULL`;
    if (f.op === 'notnull') return `${col} IS NOT NULL`;
    params.push(f.op === 'contains' ? `%${f.value}%` : f.op === 'starts' ? `${f.value}%` : f.value);
    const p = d.ph(params.length);
    if (f.op === 'contains' || f.op === 'starts') return c.type === 'postgres' ? `CAST(${col} AS text) ILIKE ${p}` : c.type === 'mssql' ? `CAST(${col} AS nvarchar(max)) LIKE ${p}` : `${col} LIKE ${p}`;
    if (!OPS[f.op]) throw new DbError('bad_filter', 'Unknown filter.');
    return `${col} ${OPS[f.op]} ${p}`;
  });
  return parts.length ? ' WHERE ' + parts.join(' AND ') : '';
}
const tableName = (d, t) => {
  if (!t || !t.name) throw new DbError('bad_table', 'Pick a table.');
  return (t.schema ? d.q(t.schema) + '.' : '') + d.q(t.name);
};
const clampInt = (n, lo, hi, def) => { n = Math.floor(Number(n)); return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : def; };

export async function handle(body, opts = {}) {
  const c = parseConn(body && body.conn);
  const op = body.op;
  if (!['test', 'schema', 'rows', 'query', 'insert', 'update', 'delete'].includes(op)) throw new DbError('bad_op', 'Unknown request.');
  if (c.readOnly && ['insert', 'update', 'delete'].includes(op)) throw new DbError('read_only', 'This connection is read-only.', 403);
  const d = await open(c, opts).catch(e => { throw friendly(e, c); });
  const started = Date.now();
  try {
    if (c.type === 'mongodb') return await mongoOp(c, d, op, body);
    if (op === 'test') return { ok: true, version: await d.version() };
    if (op === 'schema') return { tables: await schemaSql(c, d) };
    if (op === 'rows') return await rows(c, d, body);
    if (op === 'query') {
      const sql = String(body.sql || '');
      if (!sql.trim()) throw new DbError('empty', 'Write a query first.');
      if (c.readOnly && c.type === 'postgres') { await d.begin(); try { return { results: shape(await d.query(sql)), ms: Date.now() - started }; } finally { await d.rollback().catch(() => {}); } }
      return { results: shape(await d.query(sql)), ms: Date.now() - started };
    }
    return await edit(c, d, op, body);
  } catch (e) {
    throw friendly(e, c);
  } finally {
    await d.close();
  }
}

const shape = sets => {
  const budget = { left: MAX_CHARS };
  return sets.slice(0, MAX_RESULTS).map(s => {
    const rows = s.rows ? rowsOut(s.rows, budget) : null;
    return { command: s.command, columns: s.columns, rows, count: s.count, truncated: !!(s.rows && rows.length < s.rows.length) };
  });
};

async function rows(c, d, req) {
  const name = tableName(d, req.table), params = [];
  const where = whereSql(c, d, req.filters, params);
  const limit = clampInt(req.limit, 1, MAX_ROWS, 100), offset = clampInt(req.offset, 0, 1e12, 0);
  const sort = req.sort && req.sort.col ? `${d.q(req.sort.col)} ${req.sort.desc ? 'DESC' : 'ASC'}` : null;
  const sql = c.type === 'mssql'
    ? `SELECT * FROM ${name}${where} ORDER BY ${sort || '(SELECT NULL)'} OFFSET ${offset} ROWS FETCH NEXT ${limit} ROWS ONLY`
    : `SELECT * FROM ${name}${where}${sort ? ' ORDER BY ' + sort : ''} LIMIT ${limit} OFFSET ${offset}`;
  const list = await d.all(sql, params);
  const columns = list.length ? Object.keys(list[0]) : (req.columns || []);
  // Counting a huge table can take long; past a million (estimated) rows, only filtered views are counted.
  let total = null;
  if (where || req.estimate == null || req.estimate < 1e6) {
    try { const [r] = await d.all(`SELECT COUNT(*) AS n FROM ${name}${where}`, params); total = Number(Object.values(r)[0]); } catch (e) { total = null; }
  }
  return { columns, rows: rowsOut(list.map(r => columns.map(k => r[k]))), total };
}

// Insert, update and delete one row, found by its primary key; more than one row matching is refused.
async function edit(c, d, op, req) {
  const name = tableName(d, req.table);
  const params = [];
  const val = v => { params.push(v === undefined ? null : v); return d.ph(params.length); };
  const keyWhere = () => {
    const pk = req.key && Object.entries(req.key);
    if (!pk || !pk.length) throw new DbError('no_key', 'This table has no primary key, so rows can’t be changed here. Use a query instead.');
    return ' WHERE ' + pk.map(([k, v]) => (v === null ? `${d.q(k)} IS NULL` : `${d.q(k)} = ${val(v)}`)).join(' AND ');
  };
  let sql;
  if (op === 'insert') {
    const e = Object.entries(req.values || {});
    sql = e.length ? `INSERT INTO ${name} (${e.map(([k]) => d.q(k)).join(', ')}) VALUES (${e.map(([, v]) => val(v)).join(', ')})` : (c.type === 'mysql' ? `INSERT INTO ${name} () VALUES ()` : `INSERT INTO ${name} DEFAULT VALUES`);
  } else if (op === 'update') {
    const e = Object.entries(req.values || {});
    if (!e.length) throw new DbError('nothing', 'Nothing to change.');
    const set = e.map(([k, v]) => `${d.q(k)} = ${val(v)}`).join(', ');
    sql = `UPDATE ${name} SET ${set}${keyWhere()}`;
  } else sql = `DELETE FROM ${name}${keyWhere()}`;
  await d.begin();
  try {
    const n = await d.run(sql, params);
    if (op !== 'insert' && n > 1) throw new DbError('not_unique', `That would change ${n} rows, not one, so nothing was changed.`);
    await d.commit();
    return { count: n };
  } catch (e) { await d.rollback().catch(() => {}); throw e; }
}

/* ---- MongoDB ---- */
// Commands that don't change anything, for read-only connections.
const MONGO_READ = new Set(['find', 'aggregate', 'count', 'distinct', 'listcollections', 'listindexes', 'dbstats', 'collstats', 'explain', 'buildinfo', 'ping', 'serverstatus', 'hello', 'ismaster']);
// Shell-style text (db.users.find({age: {$gt: 30}})) or a command document → the command document.
export function mongoCommand(text, EJSON) {
  const relaxed = s => s.replace(/'((?:[^'\\]|\\.)*)'/g, (a, x) => JSON.stringify(x.replace(/\\'/g, "'"))).replace(/([{,]\s*)([A-Za-z_$][\w$]*)\s*:/g, '$1"$2":')
    .replace(/ObjectId\(\s*"([0-9a-fA-F]{24})"\s*\)/g, '{"$oid":"$1"}').replace(/ISODate\(\s*"([^"]+)"\s*\)/g, '{"$date":"$1"}').replace(/,\s*([}\]])/g, '$1');
  const parse = s => EJSON.parse(relaxed(s.trim() || '{}'), { relaxed: false });
  const t = text.trim();
  const m = /^db\.(?:getCollection\(\s*["']([^"']+)["']\s*\)|([\w$-]+))\.(\w+)\(([\s\S]*?)\)\s*(?:\.limit\((\d+)\))?\s*;?$/.exec(t);
  if (!m) { if (!t.startsWith('{')) throw new DbError('bad_query', 'Write a command like db.users.find({ age: { $gt: 30 } }) or a command document like { "find": "users" }.'); return parse(t); }
  const coll = m[1] || m[2], fn = m[3], args = m[4].trim();
  const list = args ? parse('[' + args + ']') : [];
  const limit = m[5] ? Number(m[5]) : undefined;
  switch (fn) {
    case 'find': return { find: coll, filter: list[0] || {}, ...(list[1] ? { projection: list[1] } : {}), limit: limit || 100 };
    case 'findOne': return { find: coll, filter: list[0] || {}, limit: 1 };
    case 'aggregate': return { aggregate: coll, pipeline: list[0] || [], cursor: {} };
    case 'countDocuments': case 'count': return { count: coll, query: list[0] || {} };
    case 'distinct': return { distinct: coll, key: list[0], query: list[1] || {} };
    case 'insertOne': return { insert: coll, documents: [list[0]] };
    case 'insertMany': return { insert: coll, documents: list[0] };
    case 'updateOne': case 'updateMany': return { update: coll, updates: [{ q: list[0] || {}, u: list[1], multi: fn === 'updateMany' }] };
    case 'deleteOne': case 'deleteMany': return { delete: coll, deletes: [{ q: list[0] || {}, limit: fn === 'deleteOne' ? 1 : 0 }] };
    case 'drop': return { drop: coll };
    default: throw new DbError('bad_query', `db.${coll}.${fn}() isn’t supported here; use find, aggregate, countDocuments, distinct, insertOne/Many, updateOne/Many, deleteOne/Many or a command document.`);
  }
}
const docOut = (EJSON, d) => cell(EJSON.serialize(d, { relaxed: true }));

async function mongoOp(c, m, op, req) {
  const { db, EJSON } = m;
  if (op === 'test') { const b = await db.admin().command({ buildInfo: 1 }).catch(() => ({})); await db.command({ ping: 1 }); return { ok: true, version: 'MongoDB ' + (b.version || '') }; }
  if (op === 'schema') return { tables: await schemaMongo(m) };
  const coll = req.table && db.collection(String(req.table.name || ''));
  const filterOf = () => {
    const f = {};
    (req.filters || []).forEach(x => {
      if (!x || !x.col) return;
      const v = typeof x.value === 'string' && /^-?\d+(\.\d+)?$/.test(x.value) ? Number(x.value) : x.value;
      f[x.col] = x.op === 'null' ? null : x.op === 'notnull' ? { $ne: null } : x.op === 'contains' ? { $regex: String(x.value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' }
        : x.op === 'starts' ? { $regex: '^' + String(x.value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&') } : { '=': v, '!=': { $ne: v }, '>': { $gt: v }, '<': { $lt: v }, '>=': { $gte: v }, '<=': { $lte: v } }[x.op];
    });
    return f;
  };
  if (op === 'rows') {
    if (!coll) throw new DbError('bad_table', 'Pick a collection.');
    const filter = filterOf(), limit = clampInt(req.limit, 1, MAX_ROWS, 100), offset = clampInt(req.offset, 0, 1e12, 0);
    const docs = await coll.find(filter, { maxTimeMS: Math.min(20_000, m.timeout) }).sort(req.sort && req.sort.col ? { [req.sort.col]: req.sort.desc ? -1 : 1 } : {}).skip(offset).limit(limit).toArray();
    const columns = ['_id', ...new Set(docs.flatMap(x => Object.keys(x)).filter(k => k !== '_id'))];
    const total = Object.keys(filter).length || req.estimate == null || req.estimate < 1e6 ? await coll.countDocuments(filter, { maxTimeMS: Math.min(5000, m.timeout) }).catch(() => null) : null;
    return { columns, rows: docs.map(x => { const s = docOut(EJSON, x); return columns.map(k => (k in s ? s[k] : undefined) ?? null); }), total };
  }
  if (op === 'query') {
    const cmd = mongoCommand(String(req.sql || ''), EJSON);
    const name = Object.keys(cmd)[0] || '';
    if (c.readOnly && (!MONGO_READ.has(name.toLowerCase()) || (name === 'aggregate' && JSON.stringify(cmd.pipeline || []).match(/"\$(out|merge)"/))))
      throw new DbError('read_only', 'This connection is read-only, so only reading commands (find, aggregate, count, distinct…) can run.', 403);
    const started = Date.now();
    const r = await db.command({ ...cmd, ...(MONGO_READ.has(name.toLowerCase()) ? { maxTimeMS: Math.min(20_000, m.timeout) } : {}) });
    const batch = r.cursor ? r.cursor.firstBatch : name === 'distinct' ? r.values.map(v => ({ value: v })) : null;
    if (batch) {
      const docs = batch.map(x => docOut(EJSON, x));
      const columns = [...new Set(docs.flatMap(x => Object.keys(x)))];
      return { results: [{ command: name, columns, rows: docs.slice(0, MAX_ROWS).map(x => columns.map(k => (k in x ? x[k] : null))), count: docs.length, truncated: docs.length > MAX_ROWS }], ms: Date.now() - started };
    }
    const out = docOut(EJSON, r);
    return { results: [{ command: name, columns: ['result'], rows: [[out]], count: r.n ?? r.nModified ?? null }], ms: Date.now() - started };
  }
  if (!coll) throw new DbError('bad_table', 'Pick a collection.');
  const parse = v => { if (typeof v !== 'string') return v; try { return EJSON.parse(v, { relaxed: false }); } catch (e) { return v; } };
  const values = Object.fromEntries(Object.entries(req.values || {}).map(([k, v]) => [k, parse(v)]));
  const key = req.key && EJSON.deserialize(req.key, { relaxed: false });
  if (op === 'insert') { const r = await coll.insertOne(values); return { count: r.acknowledged ? 1 : 0 }; }
  if (!key || !('_id' in key)) throw new DbError('no_key', 'That document has no _id.');
  if (op === 'update') { const r = await coll.updateOne({ _id: key._id }, { $set: values }); return { count: r.modifiedCount }; }
  const r = await coll.deleteOne({ _id: key._id });
  return { count: r.deletedCount };
}

/* ---- errors people can act on ---- */
function friendly(e, c) {
  if (e instanceof DbError) return e;
  const msg = String(e && e.message || e), code = e && (e.code || e.number);
  let text = msg;
  if (/ECONNREFUSED/.test(msg) || code === 'ECONNREFUSED') text = `Nothing answered at ${c.host || 'that host'}:${c.port || ''}. Is the database running, and does it accept connections from the internet?`;
  else if (/ETIMEDOUT|timeout|timed out/i.test(msg) && !/statement|query|canceling/i.test(msg)) text = `Connecting to ${c.host || 'the database'} timed out. Check the host and port, and that its firewall lets this server in.`;
  else if (code === '28P01' || code === 'ER_ACCESS_DENIED_ERROR' || code === 'ELOGIN' || /authentication failed|Login failed|Access denied/i.test(msg)) text = 'The user name or password is wrong. ' + msg;
  else if (/self[- ]signed|certificate|SSL|TLS/i.test(msg)) text = 'The secure (SSL) connection failed: ' + msg + '. Try SSL “Require (don’t verify)” or “Off”.';
  else if (code === '3D000' || code === 'ER_BAD_DB_ERROR') text = `There’s no database called “${c.database}”.`;
  return new DbError('db_error', text);
}
