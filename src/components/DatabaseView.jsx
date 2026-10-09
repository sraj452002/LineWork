import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  DB_KINDS, closeSqlite, dbRequest, editText, hasSecret, hostOf, kindOf, loadConnections, newConnection, openSqliteFile,
  saveConnections, schemaToErd, showValue, sqliteBytes, sqliteOpen, stripPassword,
} from '../lib/dbclient.js';
import { downloads } from '../lib/ai.js';
import { newSheet } from '../lib/sheet.js';
import { useUI } from './ui.jsx';

/* The Database view: connect to a live database, see its tables and the relationships between them (and draw them
   on the canvas), browse and edit rows, and run queries. Connections are kept in this browser (lib/dbclient.js);
   the file only remembers which connection and table it last showed (file.db). */

const PAGE = 100;
const FILTER_OPS = [['contains', 'contains'], ['=', '='], ['!=', '≠'], ['>', '>'], ['<', '<'], ['>=', '≥'], ['<=', '≤'], ['starts', 'starts with'], ['null', 'is empty'], ['notnull', 'is not empty']];
const ICON = {
  postgres: 'M12 3c-5 0-8 2-8 6 0 5 3 12 6 12 1 0 1-2 1-4M12 3c5 0 8 2 8 6 0 4-2 6-4 6M9 9h.01M15 9h.01',
  mysql: 'M4 18c3-1 4-4 5-8s3-6 7-6c2 0 3 1 4 3M14 9c1 1 3 1 4 0',
  mssql: 'M5 5h14v14H5zM9 9h6v6H9z',
  mongodb: 'M12 2c3 4 5 7 5 11s-2 7-5 9c-3-2-5-5-5-9s2-7 5-11zM12 2v20',
  sqlite: 'M6 3h9l4 4v14H6zM15 3v4h4M9 12h6M9 16h6',
  table: 'M3.5 4.5h17v15h-17zM3.5 9.5h17M9 4.5v15', view: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12zM12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z',
  plus: 'M12 5v14M5 12h14', refresh: 'M20 11a8 8 0 1 0-2.3 5.7M20 5v6h-6', diagram: 'M3 3.5h7v5H3zM14 15.5h7v5h-7zM6.5 8.5V13h11v2.5', play: 'M7 4l13 8-13 8z',
  edit: 'M15.5 4.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4z', trash: 'M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3', sheet: 'M3.5 4.5h17v15h-17zM3.5 9.5h17M3.5 14.5h17M9 4.5v15',
  download: 'M12 4v11M7.5 10.5 12 15l4.5-4.5M4.5 19.5h15', key: 'M14 10a4 4 0 1 0-3.5 4L9 16l2 2-2 2 1 1 6-6.5A4 4 0 0 0 14 10z', lock: 'M6 11h12v9H6zM8.5 11V8a3.5 3.5 0 0 1 7 0v3',
};
const Ic = ({ d, size = 16 }) => <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={d} /></svg>;
const fmtN = n => (n == null ? '' : Number(n).toLocaleString());
const PLACEHOLDER = {
  postgres: 'select * from customers where created > now() - interval \'30 days\' limit 50;',
  mysql: 'select * from customers order by id desc limit 50;',
  mssql: 'select top 50 * from dbo.customers order by id desc;',
  sqlite: 'select * from customers limit 50;',
  mongodb: 'db.customers.find({ age: { $gt: 30 } }).limit(50)\n\n// or aggregate, countDocuments, distinct, insertOne, updateOne, deleteOne…',
};
// Statements that change a lot at once get a second look before they run.
const RISKY = /\b(drop|truncate|alter)\b|\bdelete\s+from\b(?![\s\S]*\bwhere\b)|\bupdate\b(?![\s\S]*\bwhere\b)[\s\S]*\bset\b|\.(deleteMany|drop)\(/i;

export default function DatabaseView({ file, update, visible, onDiagram }) {
  const { popup, ask, toast } = useUI();
  const [conns, setConns] = useState(loadConnections);
  const [editing, setEditing] = useState(null);     // a connection being added or changed
  const [state, setState] = useState({});            // conn id -> {status, version, tables, error}
  const sel = file.db || {};
  const conn = conns.find(c => c.id === sel.conn) || null;
  const cs = (conn && state[conn.id]) || {};
  const setSel = patch => update(c => { c.db = { ...(c.db || {}), ...patch }; });
  const persist = list => { setConns(list); saveConnections(list); };

  /* ---- connecting ---- */
  const connect = useCallback(async (c, quiet) => {
    if (!c) return;
    if (c.type === 'sqlite' && !sqliteOpen(c)) { setState(s => ({ ...s, [c.id]: { status: 'closed' } })); return; }
    if (!hasSecret(c)) { setState(s => ({ ...s, [c.id]: { status: 'needs-password' } })); return; }
    // A quiet refresh (after a change) keeps showing what's there until the new schema arrives.
    setState(s => ({ ...s, [c.id]: { ...(s[c.id] || {}), status: quiet && s[c.id] && s[c.id].status === 'ok' ? 'ok' : 'connecting', error: null } }));
    try {
      const [t, sch] = await Promise.all([dbRequest(c, 'test'), dbRequest(c, 'schema')]);
      setState(s => ({ ...s, [c.id]: { status: 'ok', version: t.version, tables: sch.tables, at: Date.now() } }));
      return sch.tables;
    } catch (e) {
      setState(s => (quiet && s[c.id] && s[c.id].status === 'ok' ? s : { ...s, [c.id]: { status: 'error', error: e.message } }));
      toast(e.message);
    }
  }, [toast]);
  useEffect(() => { if (visible && conn && !state[conn.id]) connect(conn, true); }, [visible, conn && conn.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const choose = c => { setSel({ conn: c.id, table: null, tab: sel.conn === c.id ? sel.tab : 'schema' }); if (!state[c.id] || state[c.id].status === 'error') connect(c); };
  const saveConn = async (c, bytes, fileName) => {
    if (c.type === 'sqlite' && bytes) {
      try { await openSqliteFile(c, bytes); } catch (e) { toast(e.message); return false; }
      c = { ...c, file: fileName || c.file, name: c.name || (fileName || 'SQLite').replace(/\.\w+$/, '') };
    }
    const list = conns.some(x => x.id === c.id) ? conns.map(x => (x.id === c.id ? c : x)) : [...conns, c];
    persist(list);
    setEditing(null);
    setState(s => { const n = { ...s }; delete n[c.id]; return n; });
    setSel({ conn: c.id, table: null, tab: 'schema' });
    connect(c);
    return true;
  };
  const removeConn = async c => {
    if (!(await ask({ title: `Remove “${c.name || hostOf(c)}”?`, text: 'Only the saved connection is removed from this browser. The database isn’t touched.', input: false, ok: 'Remove' }))) return;
    if (c.type === 'sqlite') closeSqlite(c);
    persist(conns.filter(x => x.id !== c.id));
    if (sel.conn === c.id) setSel({ conn: null, table: null });
  };
  const connMenu = (btn, c) => popup(btn, [
    { label: 'Edit connection…', act: () => setEditing({ ...c }) },
    { label: 'Reconnect', act: () => connect(c) },
    ...(c.type === 'sqlite' ? [{ label: 'Download .sqlite file', note: 'With the changes made here', act: () => downloadSqlite(c) }] : []),
    '-',
    { label: 'Remove', danger: true, act: () => removeConn(c) },
  ]);
  const downloadSqlite = c => {
    const b = sqliteBytes(c);
    if (!b) { toast('Open the file first.'); return; }
    downloads.save({ filename: (c.file || c.name || 'database').replace(/\.(db|sqlite3?)$/i, '') + '.sqlite', data: new Blob([b], { type: 'application/vnd.sqlite3' }) });
  };

  /* ---- the schema on the canvas ---- */
  const tables = cs.tables || [];
  const schemas = useMemo(() => [...new Set(tables.map(t => t.schema))], [tables]);
  const mainSchemas = schemas.includes('public') ? ['public'] : schemas.includes('dbo') ? ['dbo'] : schemas;
  const draw = (only) => {
    if (!conn || !tables.length) return;
    const pick = only || (schemas.length > 1 ? mainSchemas : null);
    const code = schemaToErd(tables, { schemas: pick });
    onDiagram(code, conn.name || hostOf(conn), { conn: conn.id, schemas: pick || null });
  };

  /* ---- the sidebar ---- */
  const [q, setQ] = useState('');
  const tableList = tables.filter(t => !q || (t.schema + '.' + t.name).toLowerCase().includes(q.toLowerCase()));
  const openTable = t => setSel({ table: { schema: t.schema, name: t.name }, tab: 'data' });
  const current = sel.table && tables.find(t => t.schema === sel.table.schema && t.name === sel.table.name);

  const side = (
    <aside className="dbv-side" aria-label="Connections">
      <div className="dbv-head"><b>Connections</b><button className="dbv-ib" aria-label="New connection" title="New connection" onClick={() => setEditing(newConnection('postgres'))}><Ic d={ICON.plus} /></button></div>
      <div className="dbv-conns">
        {conns.map(c => (
          <div key={c.id} className={'dbv-conn' + (c.id === sel.conn ? ' on' : '')}>
            <button onClick={() => choose(c)} title={hostOf(c)}>
              <i className={'dbv-kind k-' + c.type}><Ic d={ICON[c.type]} /></i>
              <span><b>{c.name || hostOf(c) || kindOf(c.type).name}</b><small>{kindOf(c.type).name}{c.readOnly ? ' · read-only' : ''}</small></span>
              <em className={'dbv-dot s-' + ((state[c.id] || {}).status || 'idle')} aria-label={(state[c.id] || {}).status || 'not connected'} />
            </button>
            <button className="dbv-more" aria-label={`Actions for ${c.name || hostOf(c)}`} onClick={e => connMenu(e.currentTarget, c)}>⋯</button>
          </div>
        ))}
        {!conns.length && <p className="dbv-none">No connections yet.</p>}
      </div>
      {conn && cs.status === 'ok' && (
        <div className="dbv-tables">
          <div className="dbv-head"><b>{tables.length} table{tables.length === 1 ? '' : 's'}</b>
            <button className="dbv-ib" aria-label="Refresh" title="Refresh the schema" onClick={() => connect(conn)}><Ic d={ICON.refresh} /></button></div>
          {tables.length > 8 && <input className="dbv-search" type="search" placeholder="Find a table" aria-label="Find a table" value={q} onChange={e => setQ(e.target.value)} />}
          {schemas.map(s => {
            const list = tableList.filter(t => t.schema === s);
            if (!list.length) return null;
            return (
              <div key={s} role="group" aria-label={s}>
                {schemas.length > 1 && <div className="dbv-schema">{s}</div>}
                {list.map(t => (
                  <button key={t.name} className={'dbv-table' + (current === t ? ' on' : '')} onClick={() => openTable(t)}>
                    <Ic d={t.kind === 'view' ? ICON.view : ICON.table} size={14} /><span>{t.name}</span><small>{fmtN(t.rows)}</small>
                  </button>
                ))}
              </div>
            );
          })}
        </div>
      )}
    </aside>
  );

  /* ---- the main area ---- */
  let main;
  if (!conn) {
    main = (
      <div className="dbv-start">
        <h2>Connect to a database</h2>
        <p>See its tables and how they relate, browse and edit the data, and run queries. Draw the live schema on the canvas and refresh it whenever the database changes.</p>
        <div className="dbv-kinds">
          {DB_KINDS.map(k => (
            <button key={k.type} className={'dbv-kindcard k-' + k.type} onClick={() => setEditing(newConnection(k.type))}>
              <i className={'dbv-kind k-' + k.type}><Ic d={ICON[k.type]} size={20} /></i>
              <span><b>{k.name}</b><small>{k.note}</small></span>
            </button>
          ))}
        </div>
        <p className="dbv-fine">Connections are saved in this browser only, never in files. Databases on the internet (Supabase, Neon, RDS, Atlas, PlanetScale, Azure…) work from here; for one on your own network, run the Linework server there (see the guide).</p>
      </div>
    );
  } else if (cs.status !== 'ok') {
    main = (
      <div className="dbv-start">
        <h2>{conn.name || hostOf(conn)}</h2>
        {cs.status === 'connecting' && <p className="dbv-busy">Connecting to {hostOf(conn)}…</p>}
        {cs.status === 'error' && <><p className="dbv-err" role="alert">{cs.error}</p><div className="dbv-row"><button className="btn dark" onClick={() => connect(conn)}>Try again</button><button className="btn" onClick={() => setEditing({ ...conn })}>Edit connection</button></div></>}
        {cs.status === 'needs-password' && <PasswordAsk conn={conn} onDone={c => { saveConnPassword(c); }} />}
        {cs.status === 'closed' && <SqliteReopen conn={conn} onOpen={(bytes, name) => saveConn(conn, bytes, name)} />}
      </div>
    );
  } else {
    const tab = sel.tab || 'schema';
    main = (
      <>
        <div className="dbv-bar">
          <i className={'dbv-kind k-' + conn.type}><Ic d={ICON[conn.type]} /></i>
          <div className="dbv-title"><b>{conn.name || hostOf(conn)}</b><small>{cs.version}</small></div>
          {conn.readOnly ? <span className="dbv-badge"><Ic d={ICON.lock} size={13} />Read-only</span> : <span className="dbv-badge live">Read &amp; write</span>}
          <span className="grow" />
          <button className="btn" onClick={() => draw()}><Ic d={ICON.diagram} />Draw on canvas</button>
        </div>
        <div className="dbv-tabs" role="tablist" aria-label="Database">
          {[['schema', 'Schema'], ['data', 'Data'], ['query', 'Query']].map(([k, n]) => <button key={k} role="tab" aria-selected={tab === k} onClick={() => setSel({ tab: k })}>{n}</button>)}
        </div>
        {tab === 'schema' && <SchemaPane tables={tables} schemas={schemas} mainSchemas={mainSchemas} onOpen={openTable} onDraw={draw} />}
        {tab === 'data' && (current
          ? <DataPane key={conn.id + current.schema + current.name} conn={conn} table={current} ask={ask} toast={toast} onChanged={() => connect(conn, true)} />
          : <div className="dbv-start"><p>Pick a table on the left to see its rows.</p></div>)}
        {tab === 'query' && <QueryPane key={conn.id} conn={conn} ask={ask} toast={toast} update={update} onChanged={() => connect(conn, true)} />}
      </>
    );
  }
  function saveConnPassword(c) { persist(conns.map(x => (x.id === c.id ? c : x))); setState(s => { const n = { ...s }; delete n[c.id]; return n; }); connect(c); }

  return (
    <div className="dbv">
      {side}
      <section className="dbv-main" aria-label="Database">{main}</section>
      {editing && <ConnDialog conn={editing} isNew={!conns.some(c => c.id === editing.id)} onSave={saveConn} onClose={() => setEditing(null)} />}
    </div>
  );
}

/* ---- the connection form ---- */
function ConnDialog({ conn, isNew, onSave, onClose }) {
  const [c, setC] = useState(() => ({ ...conn, url: conn.url && conn.url.includes('•••') ? '' : conn.url }));
  const [mode, setMode] = useState(conn.url ? 'url' : conn.host ? 'fields' : 'url');
  const [busy, setBusy] = useState(false), [note, setNote] = useState(null);
  const [sqliteFile, setSqliteFile] = useState(null);
  const ref = useRef(null);
  useEffect(() => { ref.current?.querySelector('input:not([type=checkbox]), select')?.focus(); }, []);
  const set = patch => { setC(x => ({ ...x, ...patch })); setNote(null); };
  const k = kindOf(c.type);
  const ready = c.type === 'sqlite' ? (sqliteFile || sqliteOpen(c)) : mode === 'url' ? c.url.trim() : c.host.trim();
  const final = () => ({ ...c, ...(mode === 'url' ? { host: '', port: k.port, database: '', user: '', password: '' } : { url: '' }) });
  const test = async () => {
    setBusy(true); setNote(null);
    try { const t = await dbRequest(final(), 'test'); setNote({ ok: true, text: 'Connected: ' + t.version }); }
    catch (e) { setNote({ ok: false, text: e.message }); }
    setBusy(false);
  };
  const save = async e => {
    e.preventDefault();
    if (!ready) return;
    setBusy(true);
    const bytes = sqliteFile ? await sqliteFile.arrayBuffer() : null;
    const ok = await onSave(final(), bytes, sqliteFile && sqliteFile.name);
    if (!ok && ok !== undefined) setBusy(false);
  };
  return (
    <div className="dbv-modal" role="presentation" onPointerDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <form className="dbv-dialog" role="dialog" aria-label={isNew ? 'New connection' : 'Edit connection'} ref={ref} onSubmit={save} onKeyDown={e => { if (e.key === 'Escape') onClose(); }}>
        <h3>{isNew ? 'New connection' : 'Edit connection'}</h3>
        <div className="dbv-types" role="radiogroup" aria-label="Database type">
          {DB_KINDS.map(x => (
            <button type="button" key={x.type} role="radio" aria-checked={c.type === x.type} className={'k-' + x.type} onClick={() => set({ type: x.type, port: x.port || '' })}>
              <i className={'dbv-kind k-' + x.type}><Ic d={ICON[x.type]} /></i>{x.name}
            </button>
          ))}
        </div>
        <label>Name <input value={c.name} placeholder={c.type === 'sqlite' ? 'Taken from the file' : 'e.g. Production, Staging'} onChange={e => set({ name: e.target.value })} /></label>
        {c.type === 'sqlite' ? (
          <label>File <input type="file" accept=".db,.sqlite,.sqlite3,.db3,application/vnd.sqlite3,application/x-sqlite3" aria-label="SQLite file" onChange={e => setSqliteFile(e.target.files[0] || null)} />
            <small>Opened in your browser; nothing is uploaded. Download it again after making changes.</small></label>
        ) : (
          <>
            <div className="dbv-seg" role="group" aria-label="How to connect">
              <button type="button" aria-pressed={mode === 'url'} onClick={() => setMode('url')}>Connection string</button>
              <button type="button" aria-pressed={mode === 'fields'} onClick={() => setMode('fields')}>Host and user</button>
            </div>
            {mode === 'url' ? (
              <label>Connection string <input value={c.url} placeholder={k.example} spellCheck="false" autoComplete="off" onChange={e => set({ url: e.target.value })} />
                {conn.url && conn.url.includes('•••') && <small>Saved as {conn.url}. Paste it again to change it.</small>}</label>
            ) : (
              <div className="dbv-form">
                <label className="wide">Host <input value={c.host} placeholder="db.example.com" spellCheck="false" onChange={e => set({ host: e.target.value })} /></label>
                <label>Port <input value={c.port} inputMode="numeric" onChange={e => set({ port: e.target.value.replace(/\D/g, '') })} /></label>
                <label className="wide">Database <input value={c.database} spellCheck="false" onChange={e => set({ database: e.target.value })} /></label>
                <label>User <input value={c.user} spellCheck="false" autoComplete="off" onChange={e => set({ user: e.target.value })} /></label>
                <label>Password <input type="password" value={c.password || ''} autoComplete="new-password" onChange={e => set({ password: e.target.value })} /></label>
              </div>
            )}
            <label>Secure connection (SSL)
              <select value={c.ssl} onChange={e => set({ ssl: e.target.value })}>
                <option value="require">Required, don’t check the certificate</option>
                <option value="verify">Required, check the certificate</option>
                <option value="off">Off</option>
              </select>
            </label>
            <label className="check"><input type="checkbox" checked={!!c.remember} onChange={e => set({ remember: e.target.checked })} /> Remember the password in this browser</label>
          </>
        )}
        <label className="check"><input type="checkbox" checked={!!c.readOnly} onChange={e => set({ readOnly: e.target.checked })} /> Read-only: never change anything in this database</label>
        {note && <p className={note.ok ? 'dbv-ok' : 'dbv-err'} role="status">{note.text}</p>}
        <div className="dbv-row end">
          {c.type !== 'sqlite' && <button type="button" className="btn" disabled={!ready || busy} onClick={test}>Test</button>}
          <span className="grow" />
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button className="btn dark" disabled={!ready || busy}>{busy ? 'Connecting…' : isNew ? 'Connect' : 'Save'}</button>
        </div>
      </form>
    </div>
  );
}

function PasswordAsk({ conn, onDone }) {
  const [v, setV] = useState('');
  const byUrl = !!conn.url;
  return (
    <form className="dbv-ask" onSubmit={e => { e.preventDefault(); if (v) onDone(byUrl ? { ...conn, url: v } : { ...conn, password: v }); }}>
      <p>{byUrl ? 'Paste the connection string again: its password isn’t kept between visits.' : `Enter the password for ${conn.user}: it isn’t kept between visits.`}</p>
      <input autoFocus type={byUrl ? 'text' : 'password'} aria-label={byUrl ? 'Connection string' : 'Password'} placeholder={byUrl ? stripPassword(conn.url) : 'Password'} value={v} onChange={e => setV(e.target.value)} />
      <button className="btn dark" disabled={!v}>Connect</button>
    </form>
  );
}
function SqliteReopen({ conn, onOpen }) {
  return (
    <div className="dbv-ask">
      <p>Open {conn.file || 'the SQLite file'} again: files opened in the browser are closed when the page reloads.</p>
      <label className="btn dark">Choose file<input type="file" hidden accept=".db,.sqlite,.sqlite3,.db3" onChange={async e => { const f = e.target.files[0]; if (f) onOpen(await f.arrayBuffer(), f.name); }} /></label>
    </div>
  );
}

/* ---- Schema: every table with its columns and links ---- */
function SchemaPane({ tables, schemas, mainSchemas, onOpen, onDraw }) {
  const [only, setOnly] = useState(mainSchemas);
  const list = tables.filter(t => only.includes(t.schema));
  const links = list.reduce((n, t) => n + t.fks.length, 0);
  return (
    <div className="dbv-scroll">
      <div className="dbv-row">
        <span className="dbv-sum">{list.length} table{list.length === 1 ? '' : 's'}, {links} relationship{links === 1 ? '' : 's'}</span>
        {schemas.length > 1 && (
          <div className="dbv-schemas" role="group" aria-label="Schemas">
            {schemas.map(s => <label key={s}><input type="checkbox" checked={only.includes(s)} onChange={() => setOnly(o => (o.includes(s) ? o.filter(x => x !== s) : [...o, s]))} />{s}</label>)}
          </div>
        )}
        <span className="grow" />
        <button className="btn dark" disabled={!list.length} onClick={() => onDraw(only)}>Draw these on the canvas</button>
      </div>
      <div className="dbv-cards">
        {list.map(t => (
          <article key={t.schema + '.' + t.name} className="dbv-card">
            <header><button onClick={() => onOpen(t)} title="Show the rows">{t.name}</button><small>{t.kind !== 'table' ? t.kind + ' · ' : ''}{t.rows != null ? fmtN(t.rows) + ' rows' : ''}</small></header>
            <table><tbody>
              {t.columns.map(c => {
                const pk = t.pk.includes(c.name), fk = t.fks.find(f => f.cols.includes(c.name));
                return (
                  <tr key={c.name}>
                    <td>{pk && <span className="dbv-k pk" title="Primary key">PK</span>}{fk && <span className="dbv-k fk" title={`Links to ${fk.refTable}`}>FK</span>}{c.name}</td>
                    <td>{c.type}{c.nullable ? '' : <span className="dbv-nn" title="Required"> *</span>}</td>
                  </tr>
                );
              })}
            </tbody></table>
            {t.fks.length > 0 && <footer>{t.fks.map((f, i) => <div key={i}>{f.cols.join(', ')} → {f.refTable}.{f.refCols.join(', ')}</div>)}</footer>}
          </article>
        ))}
      </div>
    </div>
  );
}

/* ---- Data: a table's rows, with sorting, filters and editing ---- */
function DataPane({ conn, table, ask, toast, onChanged }) {
  const [page, setPage] = useState(0), [sort, setSort] = useState(null), [filters, setFilters] = useState([]);
  const [data, setData] = useState(null), [err, setErr] = useState(null), [busy, setBusy] = useState(false);
  const [edit, setEdit] = useState(null); // {r, c, value}
  const [adding, setAdding] = useState(null); // {col: value}
  const key = table.pk;
  const canEdit = !conn.readOnly && table.kind !== 'view' && key.length > 0;
  const load = useCallback(async () => {
    setBusy(true); setErr(null);
    try { setData(await dbRequest(conn, 'rows', { table: { schema: table.schema, name: table.name }, limit: PAGE, offset: page * PAGE, sort, filters: filters.filter(f => f.col), estimate: table.rows, columns: table.columns.map(c => c.name) })); }
    catch (e) { setErr(e.message); }
    setBusy(false);
  }, [conn, table, page, sort, filters]);
  useEffect(() => { load(); }, [load]);
  const cols = (data && data.columns) || table.columns.map(c => c.name);
  const typeOf = n => (table.columns.find(c => c.name === n) || {}).type || '';
  const keyOf = row => Object.fromEntries(key.map(k => [k, row[cols.indexOf(k)]]));
  const run = async (op, extra, done) => {
    try { const r = await dbRequest(conn, op, { table: { schema: table.schema, name: table.name }, ...extra }); done && done(r); await load(); if (conn.type === 'sqlite' || op !== 'update') onChanged(); return true; }
    catch (e) { toast(e.message); return false; }
  };
  const saveCell = async (row, col, value) => {
    setEdit(null);
    if (value === editText(row[cols.indexOf(col)])) return;
    await run('update', { key: keyOf(row), values: { [col]: value } });
  };
  const delRow = async row => {
    if (!(await ask({ title: 'Delete this row?', text: Object.entries(keyOf(row)).map(([k, v]) => `${k} = ${showValue(v)}`).join(', ') + ` will be deleted from ${table.name}.`, input: false, ok: 'Delete' }))) return;
    run('delete', { key: keyOf(row) }, () => toast('Row deleted'));
  };
  const total = data && data.total;
  const from = page * PAGE + 1, to = page * PAGE + ((data && data.rows.length) || 0);
  return (
    <div className="dbv-data">
      <div className="dbv-row dbv-filters">
        <b className="dbv-tname">{table.name}</b>
        {filters.map((f, i) => (
          <span key={i} className="dbv-filter">
            <select aria-label="Column" value={f.col} onChange={e => setFilters(fs => fs.map((x, j) => (j === i ? { ...x, col: e.target.value } : x)))}>{table.columns.map(c => <option key={c.name}>{c.name}</option>)}</select>
            <select aria-label="Condition" value={f.op} onChange={e => setFilters(fs => fs.map((x, j) => (j === i ? { ...x, op: e.target.value } : x)))}>{FILTER_OPS.map(([k, n]) => <option key={k} value={k}>{n}</option>)}</select>
            {!['null', 'notnull'].includes(f.op) && <input aria-label="Value" defaultValue={f.value} onKeyDown={e => { if (e.key === 'Enter') { const v = e.target.value; setPage(0); setFilters(fs => fs.map((x, j) => (j === i ? { ...x, value: v } : x))); } }} onBlur={e => { const v = e.target.value; if (v !== f.value) { setPage(0); setFilters(fs => fs.map((x, j) => (j === i ? { ...x, value: v } : x))); } }} />}
            <button aria-label="Remove filter" onClick={() => { setPage(0); setFilters(fs => fs.filter((x, j) => j !== i)); }}>✕</button>
          </span>
        ))}
        <button className="btn" onClick={() => setFilters(fs => [...fs, { col: table.columns[0] && table.columns[0].name, op: 'contains', value: '' }])}>+ Filter</button>
        <span className="grow" />
        {busy && <span className="dbv-busy">Loading…</span>}
        {canEdit && <button className="btn" onClick={() => setAdding(Object.fromEntries(table.columns.map(c => [c.name, ''])))}><Ic d={ICON.plus} />Add row</button>}
        <button className="dbv-ib" aria-label="Reload rows" title="Reload" onClick={load}><Ic d={ICON.refresh} /></button>
      </div>
      {err && <p className="dbv-err" role="alert">{err}</p>}
      {!canEdit && !conn.readOnly && table.kind !== 'view' && key.length === 0 && <p className="dbv-fine pad">This table has no primary key, so its rows can’t be edited here. Use the Query tab.</p>}
      <div className="dbv-gridwrap">
        <table className="dbv-grid" aria-label={`Rows of ${table.name}`}>
          <thead><tr>
            {canEdit && <th className="act" aria-label="Actions" />}
            {cols.map(c => (
              <th key={c} aria-sort={sort && sort.col === c ? (sort.desc ? 'descending' : 'ascending') : undefined}>
                <button onClick={() => { setPage(0); setSort(s => (s && s.col === c ? (s.desc ? null : { col: c, desc: true }) : { col: c, desc: false })); }}>
                  {key.includes(c) && <Ic d={ICON.key} size={12} />}{c}<small>{typeOf(c)}</small>{sort && sort.col === c ? (sort.desc ? ' ↓' : ' ↑') : ''}
                </button>
              </th>
            ))}
          </tr></thead>
          <tbody>
            {adding && (
              <tr className="adding">
                <td className="act"><button className="dbv-ib" title="Save" aria-label="Save new row" onClick={async () => {
                  const values = Object.fromEntries(Object.entries(adding).filter(([, v]) => v !== ''));
                  if (await run('insert', { values }, () => toast('Row added'))) setAdding(null);
                }}>✓</button><button className="dbv-ib" aria-label="Cancel" onClick={() => setAdding(null)}>✕</button></td>
                {cols.map(c => <td key={c}><input aria-label={`New ${c}`} placeholder={typeOf(c)} value={adding[c] ?? ''} onChange={e => setAdding(a => ({ ...a, [c]: e.target.value }))} /></td>)}
              </tr>
            )}
            {data && data.rows.map((row, r) => (
              <tr key={r}>
                {canEdit && <td className="act"><button className="dbv-ib" aria-label="Delete row" title="Delete row" onClick={() => delRow(row)}><Ic d={ICON.trash} size={14} /></button></td>}
                {row.map((v, ci) => {
                  const col = cols[ci], on = edit && edit.r === r && edit.c === ci;
                  return (
                    <td key={ci} className={v == null ? 'null' : typeof v === 'number' ? 'num' : undefined} title={showValue(v).length > 40 ? showValue(v).slice(0, 500) : undefined}
                      onDoubleClick={() => canEdit && setEdit({ r, c: ci, value: editText(v) })}>
                      {on ? (
                        <span className="dbv-edit">
                          <input autoFocus aria-label={`Edit ${col}`} value={edit.value} onChange={e => setEdit(x => ({ ...x, value: e.target.value }))}
                            onKeyDown={e => { if (e.key === 'Enter') saveCell(row, col, edit.value); if (e.key === 'Escape') setEdit(null); }} />
                          <button onPointerDown={e => { e.preventDefault(); setEdit(null); run('update', { key: keyOf(row), values: { [col]: null } }); }} title="Set to NULL">NULL</button>
                        </span>
                      ) : v == null ? 'NULL' : showValue(v)}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
        {data && !data.rows.length && <p className="dbv-fine pad">No rows{filters.some(f => f.col) ? ' match these filters' : ''}.</p>}
      </div>
      <div className="dbv-row dbv-pager">
        <span>{data && data.rows.length ? `${fmtN(from)}–${fmtN(to)}${total != null ? ' of ' + fmtN(total) : ''}` : ''}</span>
        {canEdit && <span className="dbv-fine">Double-click a cell to change it.</span>}
        <span className="grow" />
        <button className="btn" disabled={!page} onClick={() => setPage(p => p - 1)}>Previous</button>
        <button className="btn" disabled={!data || data.rows.length < PAGE || (total != null && to >= total)} onClick={() => setPage(p => p + 1)}>Next</button>
      </div>
    </div>
  );
}

/* ---- Query: run SQL (or MongoDB commands) and see the results ---- */
function QueryPane({ conn, ask, toast, update, onChanged }) {
  const { popup } = useUI();
  const hk = 'linework:db-history:' + conn.id;
  const [sql, setSql] = useState(() => { try { return (JSON.parse(localStorage.getItem(hk) || '[]')[0]) || ''; } catch (e) { return ''; } });
  const [res, setRes] = useState(null), [err, setErr] = useState(null), [busy, setBusy] = useState(false);
  const history = () => { try { return JSON.parse(localStorage.getItem(hk) || '[]'); } catch (e) { return []; } };
  const run = async () => {
    const text = sql.trim();
    if (!text || busy) return;
    if (!conn.readOnly && RISKY.test(text) && !(await ask({ title: 'Run this on the live database?', text: 'It can drop tables or change many rows at once, and can’t be undone from here.', input: false, ok: 'Run it' }))) return;
    setBusy(true); setErr(null);
    try {
      const r = await dbRequest(conn, 'query', { sql: text });
      setRes(r);
      try { localStorage.setItem(hk, JSON.stringify([text, ...history().filter(h => h !== text)].slice(0, 20))); } catch (e) {}
      if (r.results.some(x => x.command !== 'SELECT' && x.command !== 'find' && x.command !== 'aggregate')) onChanged();
    } catch (e) { setErr(e.message); setRes(null); }
    setBusy(false);
  };
  const toSheet = (r, i) => {
    const sh = newSheet(('Query ' + (i + 1)).slice(0, 31));
    const cells = {};
    const col = n => { let s = ''; n++; while (n) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; };
    r.columns.forEach((c, x) => { cells[col(x) + 1] = c; });
    r.rows.forEach((row, y) => row.forEach((v, x) => { const t = showValue(v); if (t !== '') cells[col(x) + (y + 2)] = /^[=+\-@]/.test(t) ? "'" + t : t; }));
    sh.cells = cells; sh.cols = Math.max(26, r.columns.length + 2); sh.rows = Math.max(100, r.rows.length + 10);
    update(c => { const names = new Set((c.sheets || []).map(s => s.name)); let k = 1; while (names.has(sh.name)) sh.name = 'Query ' + (++k); c.sheets = [...(c.sheets || []), sh]; c.activeSheet = sh.id; });
    toast(`Added “${sh.name}” to this file’s sheets`);
  };
  const csv = r => {
    const q = v => { const s = showValue(v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
    downloads.save({ filename: 'query.csv', data: new Blob([[r.columns.map(q).join(','), ...r.rows.map(row => row.map(q).join(','))].join('\n') + '\n'], { type: 'text/csv' }) });
  };
  return (
    <div className="dbv-query">
      <div className="dbv-editor">
        <textarea aria-label="Query" spellCheck="false" value={sql} placeholder={PLACEHOLDER[conn.type]} onChange={e => setSql(e.target.value)}
          onKeyDown={e => { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); run(); } }} />
        <div className="dbv-row">
          <button className="btn dark" disabled={busy || !sql.trim()} onClick={run}><Ic d={ICON.play} size={13} />{busy ? 'Running…' : 'Run'}</button>
          <span className="dbv-fine">Ctrl Enter</span>
          <span className="grow" />
          {history().length > 0 && <button className="btn" aria-haspopup="menu" onClick={e => popup(e.currentTarget, history().map(h => ({ label: h.length > 70 ? h.slice(0, 70) + '…' : h, act: () => setSql(h) })))}>History</button>}
        </div>
      </div>
      {err && <p className="dbv-err" role="alert">{err}</p>}
      {res && (
        <div className="dbv-results">
          {res.results.map((r, i) => (
            <section key={i} className="dbv-result">
              <div className="dbv-row">
                <b>{r.rows ? `${fmtN(r.rows.length)} row${r.rows.length === 1 ? '' : 's'}${r.truncated ? ` (first ${fmtN(r.rows.length)} of ${fmtN(r.count)})` : ''}` : `${r.command}: ${fmtN(r.count ?? 0)} row${r.count === 1 ? '' : 's'} changed`}</b>
                {i === 0 && <span className="dbv-fine">{res.ms} ms</span>}
                <span className="grow" />
                {r.rows && r.rows.length > 0 && <><button className="btn" onClick={() => toSheet(r, i)}><Ic d={ICON.sheet} />Open in a sheet</button><button className="btn" onClick={() => csv(r)}><Ic d={ICON.download} />CSV</button></>}
              </div>
              {r.rows && (
                <div className="dbv-gridwrap">
                  <table className="dbv-grid" aria-label={`Result ${i + 1}`}>
                    <thead><tr>{r.columns.map((c, k) => <th key={k}><span>{c}</span></th>)}</tr></thead>
                    <tbody>{r.rows.map((row, y) => <tr key={y}>{row.map((v, x) => <td key={x} className={v == null ? 'null' : typeof v === 'number' ? 'num' : undefined}>{v == null ? 'NULL' : showValue(v)}</td>)}</tr>)}</tbody>
                  </table>
                </div>
              )}
            </section>
          ))}
        </div>
      )}
    </div>
  );

}
