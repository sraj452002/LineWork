import { useEffect, useRef, useState } from 'react';
import { TEMPLATES, dg, newFile } from '../lib/engines.js';
import { SAMPLES } from '../lib/samples.js';
import { SAMPLE, fromCSV, newSheet } from '../lib/sheet.js';
import { readSql } from '../lib/sql.js';
import { rid } from '../lib/utils.js';
import { useUI } from './ui.jsx';

/* The Tools page: every tool in Linework in one place. Each one makes a new file that opens in that tool. */

const ICON = {
  arch: 'M4 5h6v5H4zM14 5h6v5h-6zM9 15h6v5H9zM7 10v2h10v-2M12 12v3',
  flow: 'M9 3h6v4H9zM12 7v3M12 10l5 4-5 4-5-4zM12 18v3',
  seq: 'M6 3v18M18 3v18M6 8h12M18 13H6M6 18h12',
  erd: 'M3 5h8v6H3zM13 13h8v6h-8zM3 8h8M13 16h8M11 8h3v8h-1',
  board: 'M4 4h16v16H4zM8 15c2-4 4-6 8-7M8 9h3',
  ai: 'M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8zM19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z',
  doc: 'M7 3h7l5 5v13H7zM14 3v5h5M10 13h6M10 17h6',
  sheet: 'M4 4h16v16H4zM4 9h16M4 14h16M9 4v16',
  csv: 'M6 3h9l4 4v14H6zM15 3v4h4M9 12h7M9 16h7M12 12v8',
  sql: 'M4 6c0-1.7 3.6-3 8-3s8 1.3 8 3-3.6 3-8 3-8-1.3-8-3zM4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3',
  code: 'M8 7l-5 5 5 5M16 7l5 5-5 5M14 4l-4 16',
  term: 'M4 5h16v14H4zM7 9l3 3-3 3M12 15h5',
  py: 'M12 3c-4 0-4 1.8-4 3v2h4v1H6c-2 0-3 1.5-3 4s1 4 3 4h2v-2.5c0-1.4 1.1-2.5 2.5-2.5h4c1.4 0 2.5-1.1 2.5-2.5V6c0-1.6-1.6-3-5-3zM10 5.5h.01M12 21c4 0 4-1.8 4-3v-2h-4v-1h6c2 0 3-1.5 3-4M14 18.5h.01',
  viz: 'M3 4h7v6H3zM14 14h7v6h-7zM6.5 10v4a2 2 0 0 0 2 2H14M14 4h7v6h-7zM10 7h4',
  node: 'M12 3l8 4.5v9L12 21l-8-4.5v-9zM9 10v4l3 2 3-2',
};

export default function Tools({ q = '', onCreate, onGenerate, busy }) {
  const { ask, toast } = useUI();
  const csvRef = useRef(null), sqlRef = useRef(null);
  const [cat, setCat] = useState('all');
  // A search shows matches in every category.
  useEffect(() => { if (q.trim()) setCat('all'); }, [q]);
  const T = key => TEMPLATES.find(t => t.key === key);
  const blank = (title, extra = {}) => {
    const now = Date.now();
    return { id: rid('f'), title, created: now, updated: now, doc: '', diagrams: [dg('architecture', 'Diagram 1', '')], active: 0, view: 'canvas', ...extra };
  };
  // A code project: sample files, open in the Code view, optionally starting in a panel.
  const code = (title, sample, launch) => {
    const files = sample ? SAMPLES[sample].files.map(f => ({ id: rid('cf'), path: f.path, text: f.text })) : [];
    const first = files.find(f => !/\.md$/.test(f.path)) || files[0];
    return blank(title, { view: 'code', code: { files, folders: [], open: first ? [first.id] : [], active: first ? first.id : null, ...(launch ? { launch } : {}) } });
  };
  const sheetFile = (title, sh) => blank(title, { view: 'sheet', sheets: [sh], activeSheet: sh.id });

  const importCSV = async f => {
    if (!f) return;
    csvRef.current.value = '';
    const name = f.name.replace(/\.\w+$/, '').slice(0, 40) || 'Imported';
    if (/\.(xlsx|xlsm)$/i.test(f.name)) {
      try {
        const { readXlsx } = await import('../lib/xlsx.js');
        const sheets = await readXlsx(await f.arrayBuffer());
        if (!sheets.length) { toast('That workbook has no sheets.'); return; }
        onCreate(blank(name, { view: 'sheet', sheets, activeSheet: sheets[0].id }));
      } catch (e) { toast('That file couldn’t be opened. Is it an Excel (.xlsx) file?'); }
      return;
    }
    const text = await f.text().catch(() => null);
    if (text == null) { toast('That file couldn’t be read.'); return; }
    onCreate(sheetFile(name, Object.assign(newSheet(name), fromCSV(text))));
  };
  // SQL (pasted, or a .sql schema / migration / dump) → a new file with its database schema diagram.
  const sqlToFile = (sql, name) => {
    const r = readSql(sql);
    if (!r) { toast(name ? `No CREATE TABLE statements in ${name}.` : 'No CREATE TABLE statements found in that SQL.'); return; }
    const title = name ? name.replace(/\.\w+$/, '').slice(0, 40) : 'Schema from SQL';
    onCreate(blank(title, { diagrams: [dg('erd', 'Schema', r.code)] }));
    toast(`Drew ${r.tables} table${r.tables === 1 ? '' : 's'} and ${r.rels} relationship${r.rels === 1 ? '' : 's'}`);
  };
  const importSQL = async () => {
    const sql = ((await ask({ title: 'Database schema from SQL', text: 'Paste CREATE TABLE statements, a migration or a database dump (PostgreSQL, MySQL, SQLite, SQL Server). Linework draws the tables and the relationships between them.', multiline: true, ok: 'Draw it' })) || '').trim();
    if (sql) sqlToFile(sql);
  };
  const openSQL = async f => {
    if (!f) return;
    sqlRef.current.value = '';
    if (f.size > 50e6) { toast('That file is too big (over 50 MB). Export just the schema, e.g. pg_dump --schema-only.'); return; }
    const text = await f.text().catch(() => null);
    if (text == null) { toast('That file couldn’t be read.'); return; }
    sqlToFile(text, f.name);
  };


  // Tools grouped by what you're making. `view` is where the new file opens.
  const GROUPS = [
    { id: 'diagrams', name: 'Diagrams', k: 'arch', note: 'Draw how a system works: its services, the steps of a process, the calls between parts, or anything freehand.', list: [
      { k: 'arch', view: 'Canvas', name: 'Architecture diagram', note: 'Services, databases and how they connect', act: () => onCreate(newFile(T('aws'))) },
      { k: 'flow', view: 'Canvas', name: 'Flowchart', note: 'Steps, decisions and loops', act: () => onCreate(newFile(T('flow'))) },
      { k: 'seq', view: 'Canvas', name: 'Sequence diagram', note: 'Calls between services over time', act: () => onCreate(newFile(T('seq'))) },
      { k: 'board', view: 'Canvas', name: 'Whiteboard', note: 'Draw freely: shapes, arrows, sticky notes', act: () => onCreate(blank('Whiteboard', { diagrams: [dg('architecture', 'Whiteboard', '')] })) },
      { k: 'ai', view: 'Canvas', name: busy ? 'Generating… click to stop' : 'AI diagram', note: 'Describe a system; AI writes the doc and draws it', act: onGenerate },
    ] },
    { id: 'database', name: 'Databases', k: 'erd', note: 'Design tables, columns and the relationships between them, or draw the ones in SQL you already have.', list: [
      { k: 'erd', view: 'Canvas', name: 'Database schema', note: 'Start from an example schema', act: () => onCreate(newFile(T('erd'))) },
      { k: 'sql', view: 'Canvas', name: 'Open a .sql file', note: 'Draw the tables in a schema file, migration or dump', act: () => sqlRef.current?.click() },
      { k: 'sql', view: 'Canvas', name: 'Schema from SQL', note: 'Paste CREATE TABLE statements', act: importSQL },
    ] },
    { id: 'docs', name: 'Docs & spreadsheets', k: 'doc', note: 'Write a design doc, or work with numbers and tables like in Excel.', list: [
      { k: 'doc', view: 'Doc', name: 'Design doc', note: 'A doc with sections ready to fill in', act: () => onCreate(newFile(T('doc'))) },
      { k: 'sheet', view: 'Sheet', name: 'Spreadsheet', note: 'Cells, formulas and charts, like Excel', act: () => onCreate(sheetFile('Spreadsheet', newSheet('Sheet 1'))) },
      { k: 'sheet', view: 'Sheet', name: 'Budget sheet', note: 'An example spreadsheet with totals', act: () => onCreate(sheetFile('Budget', SAMPLE())) },
      { k: 'csv', view: 'Sheet', name: 'Open an Excel or CSV file', note: 'Open a .xlsx, CSV or TSV as a spreadsheet', act: () => csvRef.current?.click() },
    ] },
    { id: 'code', name: 'Code', k: 'code', note: 'Write, run and understand code, all in the browser.', list: [
      { k: 'code', view: 'Code', name: 'Code editor', note: 'VS Code’s editor, with files and folders', act: () => onCreate(code('Code', null)) },
      { k: 'term', view: 'Code', name: 'Terminal', note: 'node, npm, git, grep and more', act: () => onCreate(code('Terminal', null, 'terminal')) },
      { k: 'py', view: 'Code', name: 'Python', note: 'A Python prompt, with pip install', act: () => onCreate(code('Python', 'py', 'python')) },
      { k: 'node', view: 'Code', name: 'Node.js web server', note: 'A small server with a live preview', act: () => onCreate(code('Node.js server', 'node')) },
      { k: 'viz', view: 'Code', name: 'Code visualizer', note: 'Flowcharts of code, and step-by-step runs', act: () => onCreate(code('Visualize code', 'ts', 'viz')) },
    ] },
  ];
  const needle = q.trim().toLowerCase();
  const matching = GROUPS.map(g => ({ ...g, list: g.list.filter(t => !needle || (t.name + ' ' + t.note + ' ' + g.name).toLowerCase().includes(needle)) })).filter(g => g.list.length);
  const groups = matching.filter(g => cat === 'all' || g.id === cat);
  const Icon = ({ k }) => <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={ICON[k]} /></svg>;

  return (
    <div className="tools">
      <div className="tools-cats" role="group" aria-label="Categories">
        {[{ id: 'all', name: 'All', list: matching.flatMap(g => g.list) }, ...matching].map(g => (
          <button key={g.id} className={'tcat' + (g.k ? ' t-' + g.k : '')} aria-pressed={cat === g.id} onClick={() => setCat(g.id)}>
            {g.k && <Icon k={g.k} />}{g.name}<small>{g.list.length}</small>
          </button>
        ))}
      </div>
      {groups.map(g => (
        <section key={g.id} className={'tools-sec t-' + g.k} aria-labelledby={'tools-' + g.id}>
          <header>
            <i className="tool-ico"><Icon k={g.k} /></i>
            <div><h2 id={'tools-' + g.id}>{g.name}</h2><p>{g.note}</p></div>
          </header>
          <div className="tools-grid">
            {g.list.map(t => (
              <button key={t.name} className={'tool-card t-' + t.k} onClick={t.act}>
                <i className="tool-ico"><Icon k={t.k} /></i>
                <span><b>{t.name}</b><small>{t.note}</small></span>
                <em className="tool-view">{t.view}</em>
              </button>
            ))}
          </div>
        </section>
      ))}
      {!matching.length && <div className="nofiles">No tools match “{q.trim()}”.</div>}
      <input ref={sqlRef} type="file" accept=".sql,.ddl,.txt,.psql,.mysql,application/sql" hidden onChange={e => openSQL(e.target.files[0])} />
      <input ref={csvRef} type="file" accept=".xlsx,.xlsm,.csv,.tsv,text/csv,text/plain,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" hidden onChange={e => importCSV(e.target.files[0])} />
    </div>
  );
}
