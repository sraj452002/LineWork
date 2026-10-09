import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  FUNCTIONS, SAMPLE, addr, autoFormat, colIndex, colName, display, evaluate, fillSeries, fromCSV, isErr, moveRefs,
  newSheet, parseAddr, parseRange, rangeName, shiftFormula, shown, toCSV, usedRange,
} from '../lib/sheet.js';
import { CHART_TYPES, chartSVG } from '../lib/charts.js';
import { downloads } from '../lib/ai.js';
import { rid } from '../lib/utils.js';
import { useUI } from './ui.jsx';

/* The Sheet view, made to work like Excel: a ribbon (File, Home, Insert, Formulas, Data, View), the formula bar,
   the grid with merged cells, frozen panes, filters and charts, the fill handle, sheet tabs and the status bar.
   Sheets live in the file (file.sheets); see lib/sheet.js for the cell model and formulas. */

const HEAD_W = 46, HEAD_H = 22, DEF_W = 72, DEF_H = 22;
const FONTS = ['Calibri', 'Arial', 'Aptos', 'Cambria', 'Georgia', 'Times New Roman', 'Verdana', 'Tahoma', 'Courier New', 'Consolas'];
const SIZES = [8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 36, 48, 72];
const COLORS = [
  ['#000000', 'Black'], ['#ffffff', 'White'], ['#e7e6e6', 'Light grey'], ['#44546a', 'Blue-grey'], ['#4472c4', 'Blue'], ['#ed7d31', 'Orange'],
  ['#a5a5a5', 'Grey'], ['#ffc000', 'Gold'], ['#5b9bd5', 'Light blue'], ['#70ad47', 'Green'], ['#c00000', 'Dark red'], ['#ff0000', 'Red'],
  ['#ffff00', 'Yellow'], ['#92d050', 'Light green'], ['#00b050', 'Green (dark)'], ['#00b0f0', 'Sky blue'], ['#0070c0', 'Dark blue'], ['#7030a0', 'Purple'],
  ['#fce4d6', 'Peach'], ['#ddebf7', 'Pale blue'], ['#e2efda', 'Pale green'], ['#fff2cc', 'Pale yellow'],
];
const NUMBER_FORMATS = [
  ['', 'General'], ['0.00', 'Number'], ['$', 'Currency ($)'], ['₹', 'Currency (₹)'], ['€', 'Currency (€)'], ['£', 'Currency (£)'], ['acct', 'Accounting'],
  ['date', 'Short Date'], ['datelong', 'Long Date'], ['time', 'Time'], ['0%', 'Percentage'], ['#,##0', 'Comma (#,##0)'], ['sci', 'Scientific'], ['text', 'Text'],
];
const FN_GROUPS = [
  ['Financial', ['PMT', 'FV', 'PV', 'NPV']],
  ['Logical', ['IF', 'IFS', 'IFERROR', 'IFNA', 'AND', 'OR', 'NOT', 'XOR', 'SWITCH', 'TRUE', 'FALSE']],
  ['Text', ['CONCAT', 'TEXTJOIN', 'LEFT', 'RIGHT', 'MID', 'LEN', 'FIND', 'SEARCH', 'SUBSTITUTE', 'REPLACE', 'UPPER', 'LOWER', 'PROPER', 'TRIM', 'TEXT', 'VALUE', 'REPT', 'EXACT']],
  ['Date & Time', ['TODAY', 'NOW', 'DATE', 'TIME', 'YEAR', 'MONTH', 'DAY', 'HOUR', 'MINUTE', 'WEEKDAY', 'WEEKNUM', 'EDATE', 'EOMONTH', 'DAYS', 'DATEDIF', 'NETWORKDAYS', 'WORKDAY', 'DATEVALUE']],
  ['Lookup & Reference', ['XLOOKUP', 'VLOOKUP', 'HLOOKUP', 'INDEX', 'MATCH', 'CHOOSE', 'ROW', 'COLUMN', 'ROWS', 'COLUMNS']],
  ['Math & Trig', ['SUM', 'SUMIF', 'SUMIFS', 'SUMPRODUCT', 'PRODUCT', 'ROUND', 'ROUNDUP', 'ROUNDDOWN', 'INT', 'TRUNC', 'MOD', 'ABS', 'SQRT', 'POWER', 'CEILING', 'FLOOR', 'RAND', 'RANDBETWEEN', 'PI', 'LOG', 'LN', 'EXP']],
  ['Statistical', ['AVERAGE', 'AVERAGEIF', 'AVERAGEIFS', 'COUNT', 'COUNTA', 'COUNTBLANK', 'COUNTIF', 'COUNTIFS', 'MAX', 'MAXIFS', 'MIN', 'MINIFS', 'MEDIAN', 'MODE', 'LARGE', 'SMALL', 'RANK', 'STDEV', 'VAR']],
];
// Icons for the ribbon, in a 20px box.
const I = {
  paste: 'M7 4h6M8 3h4v3H8zM6 5H4.5v12H10M12 8h5v9h-7V8z', cut: 'M6 6a2 2 0 1 0 0 .01M6 14a2 2 0 1 0 0 .01M7.5 7.5 16 15M7.5 12.5 16 5', copy: 'M7 7h9v10H7zM4 13V3h9',
  brush: 'M12 3l5 5-6 6-5-5zM6 9l-3 3v4h4l3-3', undo: 'M8 5 4 9l4 4M4 9h8a5 5 0 0 1 0 10h-2', redo: 'M12 5l4 4-4 4M16 9H8a5 5 0 0 0 0 10h2',
  bold: 'M6 4h5a3 3 0 0 1 0 6H6zM6 10h6a3 3 0 0 1 0 6H6z', italic: 'M9 4h6M5 16h6M12 4 8 16', underline: 'M6 4v6a4 4 0 0 0 8 0V4M5 18h10', strike: 'M4 10h12M13 6.5A3 3 0 0 0 10 5c-2 0-3 1-3 2.3M7 13.5A3 3 0 0 0 10 15c2 0 3-1 3-2.3',
  border: 'M3 3h14v14H3zM3 10h14M10 3v14', fill: 'M4 9l6-6 6 6-6 6zM15 13s2 2 2 3.5a2 2 0 0 1-4 0c0-1.5 2-3.5 2-3.5', fontColor: 'M6 15 10 4l4 11M7.5 11h5',
  alTop: 'M4 3h12M7 7h6M7 10h6', alMid: 'M4 10h12M7 6h6M7 14h6', alBot: 'M4 17h12M7 10h6M7 13h6',
  alL: 'M3 5h14M3 9h9M3 13h14M3 17h9', alC: 'M3 5h14M5.5 9h9M3 13h14M5.5 17h9', alR: 'M3 5h14M8 9h9M3 13h14M8 17h9',
  wrap: 'M3 5h14M3 10h11a3 3 0 0 1 0 6h-4M12 14l-2 2 2 2M3 15h4', merge: 'M3 4h14v12H3zM6 10h8M8 8l-2 2 2 2M12 8l2 2-2 2',
  pct: 'M5 15 15 5M6 6h.01M14 14h.01', comma: 'M8 13c0 2-1 3-2 4M12 13c0 2-1 3-2 4', decUp: 'M3 14h.01M6 9a2 2 0 0 1 4 0v5a2 2 0 0 1-4 0zM13 11h4M15 9v4', decDn: 'M3 14h.01M6 9a2 2 0 0 1 4 0v5a2 2 0 0 1-4 0zM13 11h4',
  insRow: 'M3 3h14v4H3zM3 13h14v4H3zM10 8v4M8 10h4', delRow: 'M3 3h14v4H3zM3 13h14v4H3zM8 10h4', sigma: 'M15 4H5l5 6-5 6h10', sortAZ: 'M4 4v12M2 14l2 2 2-2M10 8l2-5 2 5M10.6 6.5h2.8M10 11h4l-4 5h4',
  sortZA: 'M4 4v12M2 14l2 2 2-2M10 3h4l-4 5h4M10 16l2-5 2 5M10.6 14.5h2.8', filter: 'M3 4h14l-5 6v5l-4 2v-7z', find: 'M8.5 3a5.5 5.5 0 1 0 0 11 5.5 5.5 0 0 0 0-11zM13 13l4 4', clear: 'M4 15h7M6 13l7-9 4 3-7 9',
  chartCol: 'M4 16V9M8 16V5M12 16v-6M16 16V7M3 16.5h14', chartBar: 'M3 4h7M3 8h12M3 12h5M3 16h9M3 3v14', chartLine: 'M3 15l4-5 4 3 6-8M3 17h14', chartPie: 'M10 3v7h7a7 7 0 1 1-7-7zM12 2a7 7 0 0 1 6 6h-6z', chartArea: 'M3 16l4-6 4 3 6-8v11zM3 17h14',
  freeze: 'M3 3h14v14H3zM3 8h14M8 3v14', grid: 'M3 3h14v14H3zM3 8h14M3 13h14M8 3v14M13 3v14', fx: 'M8 16c2 0 2-2 2.5-6S11 4 13 4M7 9h6', canvas: 'M3 4h14v10H3zM7 17h6M10 14v3',
  open: 'M3 6h5l2 2h7v8H3z', save: 'M4 3h10l3 3v11H4zM7 3v4h6V3M7 11h6v6H7z', plus: 'M10 4v12M4 10h12', sheet: 'M3 3h14v14H3zM3 8h14M8 3v14',
};
const Ic = ({ d, size = 18 }) => <svg width={size} height={size} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={d} /></svg>;

// Text a colour picker shows for its current colour.
const swatch = c => <i className="xl-swatch" style={{ background: c || 'transparent' }} />;

// A ribbon button: an icon, with its label beside it when wide.
const B = ({ icon, label, on, act, wide, menu: m, title, disabled }) => (
  <button className={'xl-btn' + (wide ? ' wide' : '') + (on ? ' on' : '')} aria-pressed={on === undefined ? undefined : !!on} title={title || label} aria-label={label}
    aria-haspopup={m ? 'menu' : undefined} onClick={act} disabled={disabled}>
    {icon && <Ic d={I[icon]} size={wide ? 22 : 18} />}{wide && <span>{label}</span>}{m && <i className="xl-caret" aria-hidden="true">▾</i>}
  </button>
);
const Group = ({ name, children }) => <div className="xl-group" role="group" aria-label={name}><div className="xl-gbody">{children}</div><div className="xl-glabel">{name}</div></div>;

export default function SheetView({ file, update, visible, onAddToCanvas }) {
  const { popup, ask, toast, theme } = useUI();
  const sheets = file.sheets || [];
  const active = sheets.find(s => s.id === file.activeSheet) || sheets[0] || null;
  const activeId = active && active.id;
  const mutSheet = useCallback(fn => update(c => {
    const s = (c.sheets || []).find(x => x.id === activeId);
    if (s) { fn(s); s.cells = { ...s.cells }; s.fmt = { ...(s.fmt || {}) }; }
  }), [update, activeId]);

  const [sel, setSel] = useState({ a: { c: 0, r: 0 }, b: { c: 0, r: 0 } });
  const [edit, setEdit] = useState(null); // {value, from: 'cell' | 'bar'}
  const [tab, setTab] = useState('home');
  const [zoom, setZoom] = useState(100);
  const [showFormulas, setShowFormulas] = useState(false);
  const [painter, setPainter] = useState(null); // formats copied by the Format Painter
  const [fillTo, setFillTo] = useState(null);   // where the fill handle is being dragged to
  const [filterAt, setFilterAt] = useState(null); // {c, x, y} open filter menu
  const [find, setFind] = useState(null);       // {replace: bool} when Find & Replace is open
  const [chartSel, setChartSel] = useState(null);
  const gridRef = useRef(null), inRef = useRef(null), barRef = useRef(null), fileRef = useRef(null);
  const undo = useRef([]), redo = useRef([]), clip = useRef(null), dragging = useRef(false);
  const editing = useRef(false), selRef = useRef(sel);
  selRef.current = sel;
  useEffect(() => { editing.current = !!edit; }, [edit]);
  useEffect(() => { setSel({ a: { c: 0, r: 0 }, b: { c: 0, r: 0 } }); setEdit(null); setChartSel(null); setFilterAt(null); }, [activeId]);
  useEffect(() => { if (visible && !editing.current) gridRef.current?.focus({ preventScroll: true }); }, [visible, activeId]);

  const val = useMemo(() => (active ? evaluate(active, sheets) : () => ''), [active, sheets]);
  const colors = useMemo(() => {
    const cs = getComputedStyle(document.documentElement), g = n => cs.getPropertyValue(n).trim();
    return { ink: g('--ink') || '#333', ink2: g('--ink2') || '#666', line: g('--line') || '#ddd', bg: g('--surface') || '#fff' };
  }, [theme]); // eslint-disable-line react-hooks/exhaustive-deps

  // Rows hidden by the filter.
  const hidden = useMemo(() => {
    const f = active && active.filter, out = new Set();
    if (!f || !f.hide) return out;
    const u = usedRange(active);
    if (!u) return out;
    for (let r = f.r + 1; r <= u.r1; r++) {
      for (const [c, vals] of Object.entries(f.hide)) {
        if (vals && vals.length && vals.includes(shown(val, active, addr(+c, r)))) { out.add(r); break; }
      }
    }
    return out;
  }, [active, val]); // eslint-disable-line react-hooks/exhaustive-deps
  const pickStart = useRef(null);
  const fillDrag = useRef(null);
  const fillDragTarget = useRef(null);

  /* ---- opening files ---- */
  async function openFile(f) {
    if (!f) return;
    fileRef.current && (fileRef.current.value = '');
    try {
      let added;
      if (/\.(xlsx|xlsm)$/i.test(f.name)) {
        toast('Opening ' + f.name + '…');
        const { readXlsx } = await import('../lib/xlsx.js');
        added = await readXlsx(await f.arrayBuffer());
        if (!added.length) { toast('That workbook has no sheets.'); return; }
      } else if (/\.xls$/i.test(f.name)) { toast('Old .xls files can’t be opened. Save it as .xlsx in Excel first.'); return; }
      else {
        const text = await f.text();
        added = [Object.assign(newSheet(f.name.replace(/\.\w+$/, '').slice(0, 31) || 'Imported'), fromCSV(text))];
      }
      update(c => {
        const names = new Set((c.sheets || []).map(s => s.name.toLowerCase()));
        added.forEach(s => { let n = s.name, k = 2; while (names.has(n.toLowerCase())) n = `${s.name} (${k++})`; s.name = n; names.add(n.toLowerCase()); });
        // A brand-new, untouched sheet is replaced by what was opened.
        const blank = (c.sheets || []).length === 1 && !Object.keys(c.sheets[0].cells || {}).length;
        c.sheets = [...(blank ? [] : c.sheets || []), ...added];
        c.activeSheet = added[0].id;
      });
      toast(`Opened ${f.name}${added.length > 1 ? ` (${added.length} sheets)` : ''}`);
    } catch (e) {
      console.error(e);
      toast('That file couldn’t be opened. Is it an Excel (.xlsx) or CSV file?');
    }
  }
  const pickFile = () => fileRef.current?.click();
  const fileInput = <input ref={fileRef} type="file" accept=".xlsx,.xlsm,.csv,.tsv,.txt,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv" hidden onChange={e => openFile(e.target.files[0])} />;

  if (!active) {
    const add = sample => update(c => { const s = sample ? SAMPLE() : newSheet(); c.sheets = [...(c.sheets || []), s]; c.activeSheet = s.id; });
    return (
      <div className="sv-empty">
        <h2>Sheet</h2>
        <p>A spreadsheet that works like Excel: formulas such as <code>=SUM(B2:B9)</code> and <code>=XLOOKUP(…)</code>, formatting, charts, filters and frozen panes. Open and save <b>.xlsx</b> files, and show a sheet on the canvas next to the diagram.</p>
        <div className="cw-start">
          <button className="btn dark" onClick={() => add(false)}>Blank workbook</button>
          <button className="btn" onClick={() => add(true)}>Start from an example</button>
          <button className="btn" onClick={pickFile}>Open an Excel or CSV file</button>
        </div>
        {fileInput}
      </div>
    );
  }

  /* ---- the sheet's layout ---- */
  const cols = active.cols || 26, rows = active.rows || 100;
  const fmtAll = active.fmt || {};
  const fmt = a => fmtAll[a] || {};
  const width = c => (active.widths || {})[colName(c)] || DEF_W;
  const height = r => (active.heights || {})[r] || DEF_H;
  const raw = a => (active.cells || {})[a] ?? '';
  const freeze = active.freeze || { r: 0, c: 0 };
  const merges = active.merges || [];
  const mergeOf = (c, r) => merges.find(m => c >= m.c0 && c <= m.c1 && r >= m.r0 && r <= m.r1) || null;
  const cur = sel.b, curAddr = addr(cur.c, cur.r);
  const box = { c0: Math.min(sel.a.c, sel.b.c), c1: Math.max(sel.a.c, sel.b.c), r0: Math.min(sel.a.r, sel.b.r), r1: Math.max(sel.a.r, sel.b.r) };
  // A selection grows to cover any merged cells it touches.
  for (let grew = true; grew;) {
    grew = false;
    for (const m of merges) {
      if (m.c1 < box.c0 || m.c0 > box.c1 || m.r1 < box.r0 || m.r0 > box.r1) continue;
      if (m.c0 < box.c0 || m.c1 > box.c1 || m.r0 < box.r0 || m.r1 > box.r1) { box.c0 = Math.min(box.c0, m.c0); box.c1 = Math.max(box.c1, m.c1); box.r0 = Math.min(box.r0, m.r0); box.r1 = Math.max(box.r1, m.r1); grew = true; }
    }
  }
  const live = () => { const { a, b } = selRef.current; return { cur: b, box: { c0: Math.min(a.c, b.c), c1: Math.max(a.c, b.c), r0: Math.min(a.r, b.r), r1: Math.max(a.r, b.r) } }; };
  const inBox = (c, r) => c >= box.c0 && c <= box.c1 && r >= box.r0 && r <= box.r1;
  const single = box.c0 === box.c1 && box.r0 === box.r1 || (() => { const m = mergeOf(box.c0, box.r0); return m && m.c0 === box.c0 && m.c1 === box.c1 && m.r0 === box.r0 && m.r1 === box.r1; })();


  /* ---- changes, with undo ---- */
  const KEYS = ['cells', 'fmt', 'merges', 'widths', 'heights', 'cols', 'rows', 'freeze', 'filter', 'charts', 'noGrid'];
  const snap = () => Object.fromEntries(KEYS.map(k => [k, active[k]]));
  const change = (fn, label) => {
    undo.current.push(snap());
    if (undo.current.length > 200) undo.current.shift();
    redo.current = [];
    mutSheet(fn);
    if (label) toast(label);
  };
  const restore = (from, to) => {
    const s = from.current.pop();
    if (!s) return;
    to.current.push(snap());
    mutSheet(sh => { KEYS.forEach(k => { if (s[k] === undefined) delete sh[k]; else sh[k] = s[k]; }); });
  };
  const grow = (s, list) => {
    s.cols = Math.max(s.cols || 26, ...list.map(p => p.c + 2));
    s.rows = Math.max(s.rows || 100, ...list.map(p => p.r + 10));
  };
  // Set cells: {A1: '12', …}; typed dates, percents and currency pick up a number format, as in Excel.
  const setCells = (map, fmts) => change(s => {
    s.fmt = { ...(s.fmt || {}) };
    for (const [a, v] of Object.entries(map)) {
      if (v === '' || v == null) delete s.cells[a]; else s.cells[a] = v;
      const auto = autoFormat(v);
      if (auto && !(s.fmt[a] || {}).nf) s.fmt[a] = { ...(s.fmt[a] || {}), nf: auto };
    }
    if (fmts) for (const [a, f] of Object.entries(fmts)) { if (f && Object.keys(f).length) s.fmt[a] = { ...f }; else delete s.fmt[a]; }
    grow(s, Object.keys(map).map(parseAddr).filter(Boolean));
  });
  const eachIn = (b, fn) => { for (let r = b.r0; r <= b.r1; r++) for (let c = b.c0; c <= b.c1; c++) fn(addr(c, r), c, r); };
  const setFmt = patch => change(s => {
    const { box: b } = live();
    s.fmt = { ...(s.fmt || {}) };
    eachIn(b, a => {
      const f = { ...(s.fmt[a] || {}), ...(typeof patch === 'function' ? patch(s.fmt[a] || {}) : patch) };
      Object.keys(f).forEach(k => { if (f[k] == null || f[k] === '' || f[k] === false) delete f[k]; });
      if (Object.keys(f).length) s.fmt[a] = f; else delete s.fmt[a];
    });
  });
  const f0 = fmt(curAddr);
  const toggle = k => setFmt({ [k]: f0[k] ? null : 1 });

  /* ---- moving around ---- */
  const scrollTo = (c, r) => requestAnimationFrame(() => gridRef.current?.querySelector(`[data-a="${addr(c, r)}"]`)?.scrollIntoView({ block: 'nearest', inline: 'nearest' }));
  const go = (c, r, extend) => {
    const p = { c: Math.max(0, Math.min(cols - 1, c)), r: Math.max(0, Math.min(rows - 1, r)) };
    const m = !extend && mergeOf(p.c, p.r);
    const q = m ? { c: m.c0, r: m.r0 } : p;
    setSel(s => (extend ? { a: s.a, b: p } : { a: q, b: q }));
    scrollTo(p.c, p.r);
  };
  // Ctrl + arrow: to the edge of the data, as in Excel.
  const jump = (dc, dr) => {
    const has = (c, r) => raw(addr(c, r)) !== '';
    let c = cur.c, r = cur.r;
    const inside = (x, y) => x >= 0 && y >= 0 && x < cols && y < rows;
    if (has(c, r) && inside(c + dc, r + dr) && has(c + dc, r + dr)) { while (inside(c + dc, r + dr) && has(c + dc, r + dr)) { c += dc; r += dr; } }
    else { c += dc; r += dr; while (inside(c, r) && !has(c, r)) { c += dc; r += dr; } if (!inside(c, r)) { c -= dc; r -= dr; } }
    return { c, r };
  };

  /* ---- editing a cell ---- */
  const startEdit = (value, from = 'cell') => { editing.current = true; setEdit({ value, from }); };
  const commit = (move = [0, 1]) => {
    if (!edit) return;
    const v = edit.value;
    editing.current = false;
    setEdit(null);
    if (v !== raw(curAddr)) setCells({ [curAddr]: v.startsWith('=') ? autoClose(v) : v });
    if (move) { const m = mergeOf(cur.c, cur.r); go((move[0] > 0 && m ? m.c1 : cur.c) + move[0], (move[1] > 0 && m ? m.r1 : cur.r) + move[1]); }
    requestAnimationFrame(() => gridRef.current?.focus({ preventScroll: true }));
  };
  const cancel = () => { editing.current = false; setEdit(null); gridRef.current?.focus({ preventScroll: true }); };
  // Close brackets left open, as Excel does: =SUM(A1:A4 → =SUM(A1:A4)
  const autoClose = v => { let open = 0, q = false; for (const ch of v) { if (ch === '"') q = !q; else if (!q && ch === '(') open++; else if (!q && ch === ')') open--; } return open > 0 && !q ? v + ')'.repeat(open) : v; };
  // While writing a formula, clicking a cell (or dragging over cells) puts its address in.
  const pickingRef = edit && edit.value.startsWith('=') && /[=(,+\-*/^&<>:]\s*$/.test(edit.value);

  /* ---- copy, cut, paste ---- */
  const onCopy = (e, cut) => {
    if (editing.current || e.target.closest?.('input,textarea,select')) return;
    e.preventDefault();
    const { box: b } = live(), text = [], raws = [], fmts = [];
    for (let r = b.r0; r <= b.r1; r++) {
      if (hidden.has(r)) continue;
      const t = [], rr = [], ff = [];
      for (let c = b.c0; c <= b.c1; c++) { const a = addr(c, r); t.push(shown(val, active, a)); rr.push(raw(a)); ff.push(fmtAll[a]); }
      text.push(t.join('\t')); raws.push(rr); fmts.push(ff);
    }
    clip.current = { text: text.join('\n'), raws, fmts, c0: b.c0, r0: b.r0, cut: cut ? { ...b, sheet: activeId } : null };
    e.clipboardData.setData('text/plain', clip.current.text);
    toast(cut ? 'Cut. Paste where it should go.' : 'Copied');
  };
  const onPaste = e => {
    if (editing.current || e.target.closest?.('input,textarea,select')) return;
    e.preventDefault();
    pasteText(e.clipboardData.getData('text/plain'));
  };
  const pasteText = text => {
    const { box: b } = live();
    const mine = clip.current && clip.current.text === text.replace(/\r?\n$/, '').replace(/\r/g, '') ? clip.current : null;
    const grid = mine ? mine.raws : text.replace(/\r?\n$/, '').split(/\r?\n/).map(l => l.split('\t'));
    const one = grid.length === 1 && grid[0].length === 1;
    const rr = one ? b.r1 - b.r0 + 1 : grid.length, cc = one ? b.c1 - b.c0 + 1 : Math.max(...grid.map(g => g.length));
    const map = {}, fmts = mine ? {} : null;
    if (mine && mine.cut && mine.cut.sheet === activeId) eachIn(mine.cut, a => { map[a] = ''; fmts[a] = null; });
    for (let y = 0; y < rr; y++) for (let x = 0; x < cc; x++) {
      const sy = one ? 0 : y, sx = one ? 0 : x, v = (grid[sy] || [])[sx];
      if (v === undefined) continue;
      const a = addr(b.c0 + x, b.r0 + y);
      map[a] = mine && !mine.cut ? shiftFormula(v, b.c0 + x - (mine.c0 + sx), b.r0 + y - (mine.r0 + sy)) : v;
      if (mine) fmts[a] = (mine.fmts[sy] || [])[sx] || null;
    }
    setCells(map, fmts);
    if (mine && mine.cut) clip.current = null;
    setSel({ a: { c: b.c0, r: b.r0 }, b: { c: b.c0 + cc - 1, r: b.r0 + rr - 1 } });
  };
  const pasteButton = async () => {
    try { pasteText(await navigator.clipboard.readText()); }
    catch (e) { toast('Press Ctrl V to paste (the browser asks for that).'); }
  };
  const copyButton = async cut => {
    const ev = { preventDefault() {}, target: document.body, clipboardData: { setData: (t, v) => navigator.clipboard?.writeText(v).catch(() => {}) } };
    onCopy(ev, cut);
  };
  const clearBox = what => change(s => {
    const { box: b } = live();
    s.fmt = { ...(s.fmt || {}) };
    eachIn(b, a => { if (what !== 'formats') delete s.cells[a]; if (what === 'formats' || what === 'all') delete s.fmt[a]; });
  });

  /* ---- fill: Ctrl D / Ctrl R, and the fill handle ---- */
  const fillRange = (src, dst, vertical, backwards) => {
    // src: the seed block; dst: the block to fill (next to it). Series continue; formulas shift.
    const map = {}, fmts = {};
    const lines = vertical ? [src.c0, src.c1] : [src.r0, src.r1];
    for (let k = lines[0]; k <= lines[1]; k++) {
      const seedAddrs = [];
      if (vertical) for (let r = src.r0; r <= src.r1; r++) seedAddrs.push(addr(k, r)); else for (let c = src.c0; c <= src.c1; c++) seedAddrs.push(addr(c, k));
      const ordered = backwards ? [...seedAddrs].reverse() : seedAddrs;
      const n = vertical ? dst.r1 - dst.r0 + 1 : dst.c1 - dst.c0 + 1;
      const series = fillSeries(ordered.map(raw), n);
      for (let i = 0; i < n; i++) {
        const target = vertical ? addr(k, backwards ? dst.r1 - i : dst.r0 + i) : addr(backwards ? dst.c1 - i : dst.c0 + i, k);
        const from = ordered[i % ordered.length], p = parseAddr(from), q = parseAddr(target);
        map[target] = series ? series[i] : shiftFormula(raw(from), q.c - p.c, q.r - p.r);
        fmts[target] = fmtAll[from] || null;
      }
    }
    setCells(map, fmts);
  };
  const fillDown = down => {
    const { box: b } = live();
    if (down ? b.r0 === b.r1 : b.c0 === b.c1) return;
    fillRange(down ? { ...b, r1: b.r0 } : { ...b, c1: b.c0 }, down ? { ...b, r0: b.r0 + 1 } : { ...b, c0: b.c0 + 1 }, down, false);
  };
  const startFill = e => {
    e.preventDefault(); e.stopPropagation();
    fillDrag.current = { ...box };
    const up = () => {
      removeEventListener('pointerup', up);
      const t = fillDragTarget.current, b = fillDrag.current;
      fillDrag.current = null; fillDragTarget.current = null; setFillTo(null);
      if (!t) return;
      if (t.dir === 'down') fillRange(b, { ...b, r0: b.r1 + 1, r1: t.to }, true, false), setSel({ a: { c: b.c0, r: b.r0 }, b: { c: b.c1, r: t.to } });
      if (t.dir === 'up') fillRange(b, { ...b, r0: t.to, r1: b.r0 - 1 }, true, true), setSel({ a: { c: b.c0, r: t.to }, b: { c: b.c1, r: b.r1 } });
      if (t.dir === 'right') fillRange(b, { ...b, c0: b.c1 + 1, c1: t.to }, false, false), setSel({ a: { c: b.c0, r: b.r0 }, b: { c: t.to, r: b.r1 } });
      if (t.dir === 'left') fillRange(b, { ...b, c0: t.to, c1: b.c0 - 1 }, false, true), setSel({ a: { c: t.to, r: b.r0 }, b: { c: b.c1, r: b.r1 } });
    };
    addEventListener('pointerup', up);
  };
  const fillOver = (c, r) => {
    const b = fillDrag.current;
    if (!b) return;
    const dy = r > b.r1 ? r - b.r1 : r < b.r0 ? r - b.r0 : 0, dx = c > b.c1 ? c - b.c1 : c < b.c0 ? c - b.c0 : 0;
    let t = null;
    if (Math.abs(dy) >= Math.abs(dx) && dy) t = { dir: dy > 0 ? 'down' : 'up', to: r };
    else if (dx) t = { dir: dx > 0 ? 'right' : 'left', to: c };
    fillDragTarget.current = t;
    setFillTo(t);
  };
  // Double-click the fill handle: fill down as far as the column next to it has data.
  const fillDouble = e => {
    e.preventDefault(); e.stopPropagation();
    const b = box, side = b.c0 > 0 && raw(addr(b.c0 - 1, b.r1 + 1)) !== '' ? b.c0 - 1 : b.c1 + 1;
    let r = b.r1;
    while (r + 1 < rows && raw(addr(side, r + 1)) !== '') r++;
    if (r > b.r1) { fillRange(b, { ...b, r0: b.r1 + 1, r1: r }, true, false); setSel({ a: { c: b.c0, r: b.r0 }, b: { c: b.c1, r } }); }
  };
  const inFill = (c, r) => {
    if (!fillTo) return false;
    const b = box;
    if (fillTo.dir === 'down') return c >= b.c0 && c <= b.c1 && r > b.r1 && r <= fillTo.to;
    if (fillTo.dir === 'up') return c >= b.c0 && c <= b.c1 && r < b.r0 && r >= fillTo.to;
    if (fillTo.dir === 'right') return r >= b.r0 && r <= b.r1 && c > b.c1 && c <= fillTo.to;
    return r >= b.r0 && r <= b.r1 && c < b.c0 && c >= fillTo.to;
  };

  /* ---- AutoSum and friends ---- */
  const autoSum = (fn = 'SUM') => {
    const { box: b } = live();
    const isNum = a => typeof val(a) === 'number';
    if (b.c0 === b.c1 && b.r0 === b.r1) {
      // One cell: total the numbers just above it (or to its left).
      let r = b.r0 - 1;
      while (r >= 0 && raw(addr(b.c0, r)) === '') r--;
      let top = r;
      while (top - 1 >= 0 && isNum(addr(b.c0, top - 1))) top--;
      if (r >= 0 && isNum(addr(b.c0, r))) { setCells({ [addr(b.c0, b.r0)]: `=${fn}(${addr(b.c0, top)}:${addr(b.c0, r)})` }); return; }
      let c = b.c0 - 1;
      while (c >= 0 && raw(addr(c, b.r0)) === '') c--;
      let left = c;
      while (left - 1 >= 0 && isNum(addr(left - 1, b.r0))) left--;
      if (c >= 0 && isNum(addr(c, b.r0))) { setCells({ [addr(b.c0, b.r0)]: `=${fn}(${addr(left, b.r0)}:${addr(c, b.r0)})` }); return; }
      startEdit(`=${fn}(`);
      return;
    }
    // A block: a total under each column.
    const map = {};
    for (let c = b.c0; c <= b.c1; c++) map[addr(c, b.r1 + 1)] = `=${fn}(${addr(c, b.r0)}:${addr(c, b.r1)})`;
    setCells(map);
  };
  const insertFn = name => {
    gridRef.current?.focus();
    startEdit(`=${name}(`);
  };

  /* ---- rows and columns ---- */
  // Insert (n > 0) or delete (n < 0) rows/columns at `at`; formulas everywhere follow, as do formats, merges and sizes.
  const shiftLines = (rowsNotCols, at, n) => {
    undo.current.push(snap());
    redo.current = [];
    update(c => {
      for (const s of c.sheets || []) {
        const mine = s.id === activeId;
        const nextCells = {};
        for (const [a, v] of Object.entries(s.cells || {})) {
          const p = parseAddr(a);
          const moved = mine && p ? moveAddr(p, rowsNotCols, at, n) : a;
          if (moved == null) continue;
          nextCells[moved] = moveRefs(v, rowsNotCols, at, n, active.name, s.name);
        }
        s.cells = nextCells;
        if (!mine) continue;
        const nf = {};
        for (const [a, f] of Object.entries(s.fmt || {})) { const p = parseAddr(a), m = p && moveAddr(p, rowsNotCols, at, n); if (m) nf[m] = f; }
        s.fmt = nf;
        const sizes = rowsNotCols ? s.heights : s.widths;
        if (sizes) {
          const out = {};
          for (const [k, v] of Object.entries(sizes)) {
            const i = rowsNotCols ? Number(k) : colIndex(k);
            const j = i >= at ? (n < 0 && i < at - n ? null : i + n) : i;
            if (j != null) out[rowsNotCols ? j : colName(j)] = v;
          }
          if (rowsNotCols) s.heights = out; else s.widths = out;
        }
        s.merges = (s.merges || []).map(m => {
          const k0 = rowsNotCols ? 'r0' : 'c0', k1 = rowsNotCols ? 'r1' : 'c1', x = { ...m };
          if (n > 0) { if (x[k0] >= at) x[k0] += n; if (x[k1] >= at) x[k1] += n; }
          else { const lo = at + n; if (x[k0] >= lo && x[k1] < at) return null; if (x[k0] >= at) x[k0] += n; else if (x[k0] >= lo) x[k0] = lo; if (x[k1] >= at) x[k1] += n; else if (x[k1] >= lo) x[k1] = lo - 1; if (x[k1] < x[k0]) return null; }
          return x.c1 === x.c0 && x.r1 === x.r0 ? null : x;
        }).filter(Boolean);
        if (n > 0) { if (rowsNotCols) s.rows = (s.rows || 100) + n; else s.cols = (s.cols || 26) + n; }
      }
    });
  };
  const insert = (rowsNotCols, before) => { const { box: b } = live(); const n = rowsNotCols ? b.r1 - b.r0 + 1 : b.c1 - b.c0 + 1; shiftLines(rowsNotCols, rowsNotCols ? (before ? b.r0 : b.r1 + 1) : (before ? b.c0 : b.c1 + 1), n); };
  const remove = rowsNotCols => { const { box: b } = live(); const n = rowsNotCols ? b.r1 - b.r0 + 1 : b.c1 - b.c0 + 1; shiftLines(rowsNotCols, (rowsNotCols ? b.r0 : b.c0) + n, -n); };
  const setSize = async rowsNotCols => {
    const { box: b, cur: c0 } = live();
    const now = rowsNotCols ? height(c0.r) : width(c0.c);
    const v = Number(await ask({ title: rowsNotCols ? 'Row height' : 'Column width', text: 'In pixels.', value: String(now), ok: 'OK' }));
    if (!v || v < 4 || v > 1200) return;
    change(s => {
      if (rowsNotCols) { s.heights = { ...(s.heights || {}) }; for (let r = b.r0; r <= b.r1; r++) s.heights[r] = Math.round(v); }
      else { s.widths = { ...(s.widths || {}) }; for (let c = b.c0; c <= b.c1; c++) s.widths[colName(c)] = Math.round(v); }
    });
  };
  // AutoFit: as wide as the longest value in each selected column.
  const autoFit = () => change(s => {
    const { box: b } = live(), u = usedRange(s);
    if (!u) return;
    s.widths = { ...(s.widths || {}) };
    for (let c = b.c0; c <= b.c1; c++) {
      let w = 30;
      for (let r = 0; r <= u.r1; r++) { const a = addr(c, r), f = fmtAll[a] || {}; if (mergeOf(c, r)) continue; w = Math.max(w, shown(val, s, a).length * 7.2 * ((f.fs || 11) / 11) + 12); }
      s.widths[colName(c)] = Math.min(500, Math.round(w));
    }
  });

  /* ---- sorting and filtering ---- */
  // The table around the selection: the selection itself when it's a block, else the data around the active cell.
  const region = () => {
    const { box: b, cur: p } = live();
    if (b.r0 !== b.r1 || b.c0 !== b.c1) return b;
    const u = usedRange(active);
    if (!u) return b;
    let c0 = p.c, c1 = p.c, r0 = p.r, r1 = p.r;
    const has = (c, r) => c >= 0 && r >= 0 && raw(addr(c, r)) !== '';
    for (let changed = true; changed;) {
      changed = false;
      if ([...Array(r1 - r0 + 1)].some((_, i) => has(c0 - 1, r0 + i))) { c0--; changed = true; }
      if ([...Array(r1 - r0 + 1)].some((_, i) => has(c1 + 1, r0 + i))) { c1++; changed = true; }
      if ([...Array(c1 - c0 + 1)].some((_, i) => has(c0 + i, r0 - 1))) { r0--; changed = true; }
      if ([...Array(c1 - c0 + 1)].some((_, i) => has(c0 + i, r1 + 1))) { r1++; changed = true; }
    }
    return { c0, c1, r0, r1 };
  };
  const sortBy = (desc, col, area) => change(s => {
    const b = area || region();
    const c = col ?? live().cur.c;
    const v = evaluate(s, sheets);
    const headRow = b.r1 > b.r0 && typeof v(addr(c, b.r0)) === 'string' && [...Array(b.c1 - b.c0 + 1)].every((_, i) => { const x = v(addr(b.c0 + i, b.r0)); return x === '' || typeof x === 'string'; });
    const r0 = headRow ? b.r0 + 1 : b.r0, list = [];
    for (let r = r0; r <= b.r1; r++) list.push({ r, key: v(addr(c, r)), row: Array.from({ length: b.c1 - b.c0 + 1 }, (_, i) => [s.cells[addr(b.c0 + i, r)], (s.fmt || {})[addr(b.c0 + i, r)]]) });
    list.sort((x, y) => { const a = x.key, bb = y.key; if (a === '' && bb !== '') return 1; if (bb === '' && a !== '') return -1; const d = typeof a === 'number' && typeof bb === 'number' ? a - bb : String(display(a)).localeCompare(String(display(bb)), undefined, { numeric: true, sensitivity: 'base' }); return desc ? -d : d; });
    const cells = { ...s.cells }, fm = { ...(s.fmt || {}) };
    list.forEach((it, i) => it.row.forEach(([x, f], j) => {
      const a = addr(b.c0 + j, r0 + i);
      if (x == null) delete cells[a]; else cells[a] = shiftFormula(x, 0, r0 + i - it.r);
      if (f) fm[a] = f; else delete fm[a];
    }));
    s.cells = cells; s.fmt = fm;
  });
  const toggleFilter = () => change(s => {
    if (s.filter) { delete s.filter; return; }
    const b = region();
    s.filter = { r: b.r0, c0: b.c0, c1: b.c1, hide: {} };
  });
  const filterValues = c => {
    const f = active.filter, u = usedRange(active), seen = new Set();
    if (!f || !u) return [];
    for (let r = f.r + 1; r <= u.r1; r++) seen.add(shown(val, active, addr(c, r)));
    return [...seen].sort((a, b) => (a === '' ? 1 : b === '' ? -1 : a.localeCompare(b, undefined, { numeric: true })));
  };

  /* ---- merge, freeze, borders ---- */
  const merge = how => change(s => {
    const { box: b } = live();
    const rest = (s.merges || []).filter(m => m.c1 < b.c0 || m.c0 > b.c1 || m.r1 < b.r0 || m.r0 > b.r1);
    if (how === 'unmerge') { s.merges = rest; return; }
    if (b.c0 === b.c1 && b.r0 === b.r1) { s.merges = rest; return; }
    const add = how === 'across' ? [...Array(b.r1 - b.r0 + 1)].map((_, i) => ({ c0: b.c0, c1: b.c1, r0: b.r0 + i, r1: b.r0 + i })) : [{ ...b }];
    // Like Excel, only the top-left value stays.
    eachIn(b, (a, c, r) => { if (!add.some(m => m.c0 === c && m.r0 === r)) delete s.cells[a]; });
    s.merges = [...rest, ...add.filter(m => m.c1 > m.c0 || m.r1 > m.r0)];
    if (how === 'center') { s.fmt = { ...(s.fmt || {}) }; const a = addr(b.c0, b.r0); s.fmt[a] = { ...(s.fmt[a] || {}), al: 'center', va: 'middle' }; }
  });
  const isMerged = !!mergeOf(cur.c, cur.r);
  const setFreeze = f => change(s => { if (f) s.freeze = f; else delete s.freeze; });
  const setBorders = kind => change(s => {
    const { box: b } = live();
    s.fmt = { ...(s.fmt || {}) };
    eachIn(b, (a, c, r) => {
      const f = { ...(s.fmt[a] || {}) }, bd = kind === 'none' ? {} : { ...(f.bd || {}) };
      if (kind === 'all') Object.assign(bd, { t: 1, r: 1, b: 1, l: 1 });
      if (kind === 'outside' || kind === 'thick') { const w = kind === 'thick' ? 2 : 1; if (r === b.r0) bd.t = w; if (r === b.r1) bd.b = w; if (c === b.c0) bd.l = w; if (c === b.c1) bd.r = w; }
      if (kind === 'bottom' && r === b.r1) bd.b = 1;
      if (kind === 'top' && r === b.r0) bd.t = 1;
      if (kind === 'left' && c === b.c0) bd.l = 1;
      if (kind === 'right' && c === b.c1) bd.r = 1;
      if (kind === 'thickBottom' && r === b.r1) bd.b = 2;
      if (kind === 'double' && r === b.r1) bd.b = 3;
      if (Object.keys(bd).length) f.bd = bd; else delete f.bd;
      if (Object.keys(f).length) s.fmt[a] = f; else delete s.fmt[a];
    });
  });
  // Increase/Decrease Decimal start from the places the cell shows now: its format's, else its value's.
  const DEF_DP = { '0': 0, '0.00': 2, '#,##0': 0, '#,##0.00': 2, '%': 0, '0%': 0, '0.00%': 2, $: 2, '€': 2, '£': 2, '₹': 2, acct: 2, sci: 2 };
  const placesNow = (f, a) => {
    if (f.dp != null) return f.dp;
    const nf = f.nf || val.hint(a);
    if (nf && DEF_DP[nf] != null) return DEF_DP[nf];
    if (nf && /0\.(0+)/.test(nf)) return /0\.(0+)/.exec(nf)[1].length;
    return guessDp(val(a));
  };
  const bump = (k, d) => { const n = placesNow(f0, curAddr) + d; setFmt({ dp: Math.max(0, Math.min(10, n)) }); };
  const guessDp = v => (typeof v === 'number' && !Number.isInteger(v) ? Math.min(10, String(+v.toPrecision(10)).split('.')[1]?.length || 0) : 0);

  /* ---- charts ---- */
  const addChart = type => {
    const b = region();
    // One series takes its header as the title, as in Excel; several get a title to edit.
    const name = b.c1 - b.c0 === 1 && typeof val(addr(b.c0 + 1, b.r0)) === 'string' ? display(val(addr(b.c0 + 1, b.r0))) : 'Chart Title';
    let x = HEAD_W; for (let c = 0; c <= b.c1; c++) x += width(c);
    let y = HEAD_H; for (let r = 0; r < b.r0; r++) if (!hidden.has(r)) y += height(r);
    const ch = { id: rid('ch'), type, range: rangeName(b), title: name, x: x + 24, y, w: 440, h: 270 };
    change(s => { s.charts = [...(s.charts || []), ch]; });
    setChartSel(ch.id);
  };
  const updChart = (id, patch, record = true) => (record ? change : mutSheet)(s => { s.charts = (s.charts || []).map(c => (c.id === id ? { ...c, ...patch } : c)); });
  const delChart = id => { change(s => { s.charts = (s.charts || []).filter(c => c.id !== id); }); setChartSel(null); };

  /* ---- keyboard ---- */
  const onKey = e => {
    if (e.target.closest?.('.xl-chart, .xl-find, .xl-filter')) return;
    if (editing.current && !edit) {
      if (e.key.length === 1 && !e.ctrlKey && !e.metaKey) { e.preventDefault(); setEdit(x => (x ? { ...x, value: x.value + e.key } : x)); }
      return;
    }
    if (edit) return;
    const mod = e.ctrlKey || e.metaKey, k = e.key, kl = k.toLowerCase();
    const moves = { ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0] };
    if (moves[k]) {
      e.preventDefault();
      const [dc, dr] = moves[k];
      if (mod) { const t = jump(dc, dr); go(t.c, t.r, e.shiftKey); return; }
      let r = cur.r + dr;
      while (dr && hidden.has(r)) r += dr;
      const m = !e.shiftKey && mergeOf(cur.c, cur.r);
      go((m && dc > 0 ? m.c1 : cur.c) + dc, (m && dr > 0 ? m.r1 + 1 : r), e.shiftKey);
    } else if (k === 'Tab') { e.preventDefault(); go(cur.c + (e.shiftKey ? -1 : 1), cur.r); }
    else if (k === 'Enter') { e.preventDefault(); if (e.shiftKey) go(cur.c, cur.r - 1); else go(cur.c, cur.r + 1); }
    else if (k === 'F2') { e.preventDefault(); startEdit(raw(curAddr)); }
    else if (k === 'Delete' || k === 'Backspace') { e.preventDefault(); if (k === 'Backspace' && single) startEdit(''); else clearBox('contents'); }
    else if (k === 'Escape') { setPainter(null); clip.current = clip.current && { ...clip.current, cut: null }; }
    else if (k === 'Home') { e.preventDefault(); go(0, mod ? 0 : cur.r, e.shiftKey); }
    else if (k === 'End' && mod) { e.preventDefault(); const u = usedRange(active) || { c1: 0, r1: 0 }; go(u.c1, u.r1, e.shiftKey); }
    else if (k === 'PageDown' || k === 'PageUp') { e.preventDefault(); go(cur.c, cur.r + (k === 'PageDown' ? 20 : -20), e.shiftKey); }
    else if (mod && kl === 'z') { e.preventDefault(); e.shiftKey ? restore(redo, undo) : restore(undo, redo); }
    else if (mod && kl === 'y') { e.preventDefault(); restore(redo, undo); }
    else if (mod && kl === 'a') { e.preventDefault(); setSel({ a: { c: 0, r: 0 }, b: { c: cols - 1, r: rows - 1 } }); }
    else if (mod && kl === 'b') { e.preventDefault(); toggle('b'); }
    else if (mod && kl === 'i') { e.preventDefault(); toggle('i'); }
    else if (mod && kl === 'u') { e.preventDefault(); toggle('u'); }
    else if (mod && k === '5') { e.preventDefault(); toggle('s'); }
    else if (mod && kl === 'd') { e.preventDefault(); fillDown(true); }
    else if (mod && kl === 'r') { e.preventDefault(); fillDown(false); }
    else if (mod && kl === 'f') { e.preventDefault(); setFind({ replace: false }); }
    else if (mod && kl === 'h') { e.preventDefault(); setFind({ replace: true }); }
    else if (mod && e.shiftKey && kl === 'l') { e.preventDefault(); toggleFilter(); }
    else if (mod && (k === '`' || e.code === 'Backquote')) { e.preventDefault(); setShowFormulas(x => !x); }
    else if (mod && (k === ';' || k === ':')) {
      e.preventDefault();
      const n = new Date(), p = x => String(x).padStart(2, '0');
      setCells({ [curAddr]: e.shiftKey ? `${p(n.getHours())}:${p(n.getMinutes())}` : `${n.getFullYear()}-${p(n.getMonth() + 1)}-${p(n.getDate())}` });
      if (e.shiftKey) setFmt({ nf: 'h:mm' });
    }
    else if (mod && e.shiftKey && (k === '$' || k === '4')) { e.preventDefault(); setFmt({ nf: '$' }); }
    else if (mod && e.shiftKey && (k === '%' || k === '5')) { e.preventDefault(); setFmt({ nf: '0%' }); }
    else if (e.altKey && (k === '=' || e.code === 'Equal')) { e.preventDefault(); autoSum(); }
    else if (e.ctrlKey && k === ' ') { e.preventDefault(); setSel({ a: { c: box.c0, r: 0 }, b: { c: box.c1, r: rows - 1 } }); }
    else if (e.shiftKey && k === ' ') { e.preventDefault(); setSel({ a: { c: 0, r: box.r0 }, b: { c: cols - 1, r: box.r1 } }); }
    else if (!mod && !e.altKey && k.length === 1) { e.preventDefault(); startEdit(k); }
  };
  const editKey = e => {
    if (e.key === 'Enter' && e.altKey) { e.preventDefault(); const t = e.currentTarget, p = t.selectionStart; setEdit(x => ({ ...x, value: x.value.slice(0, p) + '\n' + x.value.slice(t.selectionEnd) })); requestAnimationFrame(() => t.setSelectionRange(p + 1, p + 1)); return; }
    if (e.key === 'Enter') { e.preventDefault(); commit([0, e.shiftKey ? -1 : 1]); }
    else if (e.key === 'Tab') { e.preventDefault(); commit([e.shiftKey ? -1 : 1, 0]); }
    else if (e.key === 'Escape') { e.preventDefault(); cancel(); }
  };

  /* ---- mouse ---- */
  const cellDown = (e, c, r) => {
    if (e.button !== 0) return;
    if (edit && pickingRef) {
      // Writing a formula: the click (or drag) adds this cell's address.
      e.preventDefault();
      pickStart.current = { c, r, base: edit.value };
      setEdit(x => ({ ...x, value: x.value + addr(c, r) }));
      const up = () => { removeEventListener('pointerup', up); pickStart.current = null; requestAnimationFrame(() => (edit.from === 'bar' ? barRef : inRef).current?.focus()); };
      addEventListener('pointerup', up);
      return;
    }
    if (edit) commit(null);
    e.preventDefault();
    gridRef.current?.focus({ preventScroll: true });
    setChartSel(null);
    const m = !e.shiftKey && mergeOf(c, r);
    setSel(s => (e.shiftKey ? { a: s.a, b: { c, r } } : { a: m ? { c: m.c0, r: m.r0 } : { c, r }, b: m ? { c: m.c1, r: m.r1 } : { c, r } }));
    dragging.current = true;
    const up = () => {
      dragging.current = false;
      removeEventListener('pointerup', up);
      if (painter) {
        // Format Painter: the copied formats go onto what was just selected.
        const { box: b } = live(), map = {};
        eachIn(b, (a, cc, rr) => { const pr = painter.rows, pc = painter.cols; map[a] = painter.fmts[(rr - b.r0) % pr][(cc - b.c0) % pc] || null; });
        setCells({}, map);
        setPainter(null);
      }
    };
    addEventListener('pointerup', up);
  };
  const cellEnter = (c, r) => {
    if (fillDrag.current) { fillOver(c, r); return; }
    if (pickStart.current) { const p = pickStart.current; setEdit(x => ({ ...x, value: p.base + (p.c === c && p.r === r ? addr(c, r) : `${addr(Math.min(p.c, c), Math.min(p.r, r))}:${addr(Math.max(p.c, c), Math.max(p.r, r))}`) })); return; }
    if (dragging.current) setSel(s => ({ a: s.a, b: { c, r } }));
  };
  const headDown = (e, c, r) => {
    e.preventDefault();
    if (edit) commit(null);
    gridRef.current?.focus({ preventScroll: true });
    if (c != null) setSel(s => ({ a: e.shiftKey ? { c: s.a.c, r: 0 } : { c, r: 0 }, b: { c, r: rows - 1 } }));
    else setSel(s => ({ a: e.shiftKey ? { c: 0, r: s.a.r } : { c: 0, r }, b: { c: cols - 1, r } }));
    dragging.current = true;
    const up = () => { dragging.current = false; removeEventListener('pointerup', up); };
    addEventListener('pointerup', up);
  };
  const headEnter = (c, r) => {
    if (!dragging.current) return;
    if (c != null) setSel(s => ({ a: { c: s.a.c, r: 0 }, b: { c, r: rows - 1 } }));
    else setSel(s => ({ a: { c: 0, r: s.a.r }, b: { c: cols - 1, r } }));
  };
  const resize = (e, c, r) => {
    e.preventDefault(); e.stopPropagation();
    const start = c != null ? e.clientX : e.clientY, from = c != null ? width(c) : height(r), k = zoom / 100;
    const move = ev => mutSheet(s => {
      const v = Math.max(c != null ? 8 : 8, Math.min(c != null ? 800 : 400, Math.round(from + ((c != null ? ev.clientX : ev.clientY) - start) / k)));
      if (c != null) s.widths = { ...(s.widths || {}), [colName(c)]: v }; else s.heights = { ...(s.heights || {}), [r]: v };
    });
    const up = () => { removeEventListener('pointermove', move); removeEventListener('pointerup', up); };
    undo.current.push(snap());
    addEventListener('pointermove', move); addEventListener('pointerup', up);
  };
  const resizeDouble = (e, c) => { e.preventDefault(); e.stopPropagation(); setSel({ a: { c, r: 0 }, b: { c, r: rows - 1 } }); selRef.current = { a: { c, r: 0 }, b: { c, r: rows - 1 } }; autoFit(); };
  const cellMenu = (e, c, r) => {
    e.preventDefault();
    if (!inBox(c, r)) { selRef.current = { a: { c, r }, b: { c, r } }; setSel(selRef.current); }
    const at = { getBoundingClientRect: () => ({ left: e.clientX, right: e.clientX, top: e.clientY, bottom: e.clientY, width: 0, height: 0 }), contains: () => false };
    popup(at, [
      { label: 'Cut', kbd: 'Ctrl X', act: () => copyButton(true) },
      { label: 'Copy', kbd: 'Ctrl C', act: () => copyButton(false) },
      { label: 'Paste', kbd: 'Ctrl V', act: pasteButton },
      '-',
      { label: 'Insert', items: [
        { label: 'Rows above', act: () => insert(true, true) }, { label: 'Rows below', act: () => insert(true, false) },
        { label: 'Columns left', act: () => insert(false, true) }, { label: 'Columns right', act: () => insert(false, false) },
      ] },
      { label: 'Delete', items: [{ label: 'Rows', danger: true, act: () => remove(true) }, { label: 'Columns', danger: true, act: () => remove(false) }] },
      { label: 'Clear contents', kbd: 'Del', act: () => clearBox('contents') },
      '-',
      { label: 'Sort', items: [{ label: 'A → Z', act: () => sortBy(false) }, { label: 'Z → A', act: () => sortBy(true) }] },
      { label: active.filter ? 'Remove filter' : 'Filter', act: toggleFilter },
      '-',
      { label: 'Insert chart', items: CHART_TYPES.map(([k, n]) => ({ label: n, act: () => addChart(k) })) },
      { label: isMerged ? 'Unmerge cells' : 'Merge & Center', act: () => merge(isMerged ? 'unmerge' : 'center') },
    ]);
  };

  /* ---- sheets ---- */
  const addSheet = () => update(c => { let k = (c.sheets || []).length + 1; const names = new Set((c.sheets || []).map(s => s.name)); while (names.has('Sheet ' + k)) k++; const s = newSheet('Sheet ' + k); c.sheets = [...(c.sheets || []), s]; c.activeSheet = s.id; });
  const renameSheet = async s => {
    const v = await ask({ title: 'Rename sheet', value: s.name, ok: 'Rename' });
    const n = v && v.trim().replace(/[\\/?*[\]:]/g, ' ').slice(0, 31);
    if (!n || n === s.name) return;
    if (sheets.some(x => x.id !== s.id && x.name.toLowerCase() === n.toLowerCase())) { toast('There’s already a sheet with that name.'); return; }
    // Formulas that point at the old name follow it.
    const q = x => (/^[A-Za-z_][\w.]*$/.test(x) ? x : `'${x.replace(/'/g, "''")}'`);
    const re = new RegExp(`(^|[^\\w'])(${s.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}|'${s.name.replace(/'/g, "''").replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}')!`, 'gi');
    update(c => { c.sheets.forEach(x => { if (x.id === s.id) x.name = n; x.cells = Object.fromEntries(Object.entries(x.cells || {}).map(([a, v]) => [a, typeof v === 'string' && v[0] === '=' ? v.replace(re, `$1${q(n)}!`) : v])); }); });
  };
  const sheetMenu = (btn, s) => popup(btn, [
    { label: 'Rename', act: () => renameSheet(s) },
    { label: 'Duplicate', act: () => update(c => { const x = JSON.parse(JSON.stringify(s)); x.id = newSheet().id; x.name = (s.name + ' (2)').slice(0, 31); c.sheets.splice(c.sheets.findIndex(y => y.id === s.id) + 1, 0, x); c.activeSheet = x.id; }) },
    { label: 'Move left', act: () => update(c => { const i = c.sheets.findIndex(y => y.id === s.id); if (i > 0) [c.sheets[i - 1], c.sheets[i]] = [c.sheets[i], c.sheets[i - 1]]; }) },
    { label: 'Move right', act: () => update(c => { const i = c.sheets.findIndex(y => y.id === s.id); if (i < c.sheets.length - 1) [c.sheets[i + 1], c.sheets[i]] = [c.sheets[i], c.sheets[i + 1]]; }) },
    { label: 'Show on the canvas', act: () => onAddToCanvas(s.id) },
    '-',
    { label: 'Delete', danger: true, act: async () => {
      if (!(await ask({ title: `Delete “${s.name}”?`, text: 'Its cells are removed for good. Formulas that use it show #REF!.', input: false, ok: 'Delete' }))) return;
      update(c => { c.sheets = c.sheets.filter(x => x.id !== s.id); if (c.activeSheet === s.id) c.activeSheet = c.sheets[0]?.id; });
    } },
  ]);

  /* ---- saving files ---- */
  const base = (file.title || active.name || 'workbook').replace(/[^\w.-]+/g, '-');
  const saveXlsx = async () => {
    try {
      toast('Preparing the .xlsx…');
      const { writeXlsx } = await import('../lib/xlsx.js');
      downloads.save({ filename: base + '.xlsx', data: await writeXlsx(sheets) });
      if (sheets.some(s => (s.charts || []).length)) toast('Saved. Charts stay in Linework; .xlsx files get the cells and formatting.');
    } catch (e) { console.error(e); toast('The .xlsx couldn’t be made.'); }
  };
  const saveCSV = () => downloads.save({ filename: (active.name || 'sheet').replace(/[^\w.-]+/g, '-') + '.csv', data: new Blob([toCSV(active, true, sheets)], { type: 'text/csv' }) });

  /* ---- the ribbon ---- */
  const menu = (items) => e => popup(e.currentTarget, items);
  const colorMenu = (k, label) => e => popup(e.currentTarget, [
    { label: k === 'bg' ? 'No fill' : 'Automatic', act: () => setFmt({ [k]: null }) },
    '-',
    ...COLORS.map(([c, n]) => ({ label: n, swatch: c, act: () => setFmt({ [k]: c }) })),
  ]);
  const numberFmtValue = NUMBER_FORMATS.some(([k]) => k === (f0.nf || '')) ? (f0.nf || '') : '__custom';
  const TABS = [['file', 'File'], ['home', 'Home'], ['insert', 'Insert'], ['formulas', 'Formulas'], ['data', 'Data'], ['view', 'View']];
  const ribbon = {
    file: (<>
      <Group name="Open"><B wide icon="open" label="Open .xlsx / .csv" act={pickFile} /><B wide icon="plus" label="New sheet" act={addSheet} /></Group>
      <Group name="Save a copy"><B wide icon="save" label="Download .xlsx" act={saveXlsx} /><B wide icon="save" label="Download .csv" act={saveCSV} /></Group>
      <Group name="Share"><B wide icon="canvas" label="Show on canvas" act={() => onAddToCanvas(active.id)} /></Group>
    </>),
    home: (<>
      <Group name="Clipboard">
        <B wide icon="paste" label="Paste" act={pasteButton} />
        <div className="xl-col">
          <B icon="cut" label="Cut (Ctrl X)" act={() => copyButton(true)} />
          <B icon="copy" label="Copy (Ctrl C)" act={() => copyButton(false)} />
          <B icon="brush" label="Format Painter" on={!!painter} act={() => {
            if (painter) { setPainter(null); return; }
            const fm = [];
            for (let r = box.r0; r <= box.r1; r++) { const row = []; for (let c = box.c0; c <= box.c1; c++) row.push(fmtAll[addr(c, r)] || null); fm.push(row); }
            setPainter({ fmts: fm, rows: fm.length, cols: fm[0].length });
            toast('Now select the cells to paint these formats onto.');
          }} />
        </div>
      </Group>
      <Group name="Font">
        <div className="xl-col">
          <div className="xl-row">
            <select className="xl-sel font" aria-label="Font" value={f0.ff || 'Calibri'} onChange={e => setFmt({ ff: e.target.value === 'Calibri' ? null : e.target.value })}>
              {FONTS.map(f => <option key={f} value={f}>{f}</option>)}
            </select>
            <select className="xl-sel size" aria-label="Font size" value={f0.fs || 11} onChange={e => setFmt({ fs: Number(e.target.value) === 11 ? null : Number(e.target.value) })}>
              {[...new Set([...SIZES, f0.fs || 11])].sort((a, b) => a - b).map(s => <option key={s} value={s}>{s}</option>)}
            </select>
            <B icon="fontColor" label="Bigger text" title="Increase font size" act={() => setFmt(f => ({ fs: SIZES.find(s => s > (f.fs || 11)) || 72 }))} />
          </div>
          <div className="xl-row">
            <B icon="bold" label="Bold (Ctrl B)" on={f0.b} act={() => toggle('b')} />
            <B icon="italic" label="Italic (Ctrl I)" on={f0.i} act={() => toggle('i')} />
            <B icon="underline" label="Underline (Ctrl U)" on={f0.u} act={() => toggle('u')} />
            <B icon="strike" label="Strikethrough (Ctrl 5)" on={f0.s} act={() => toggle('s')} />
            <span className="xl-sep" />
            <B icon="border" label="Borders" menu act={menu([
              { label: 'Bottom border', act: () => setBorders('bottom') }, { label: 'Top border', act: () => setBorders('top') },
              { label: 'Left border', act: () => setBorders('left') }, { label: 'Right border', act: () => setBorders('right') },
              '-', { label: 'No border', act: () => setBorders('none') }, { label: 'All borders', act: () => setBorders('all') },
              { label: 'Outside borders', act: () => setBorders('outside') }, { label: 'Thick outside borders', act: () => setBorders('thick') },
              '-', { label: 'Thick bottom border', act: () => setBorders('thickBottom') }, { label: 'Double bottom border', act: () => setBorders('double') },
            ])} />
            <button className="xl-btn" aria-haspopup="menu" aria-label="Fill colour" title="Fill colour" onClick={colorMenu('bg')}><Ic d={I.fill} />{swatch(f0.bg || '#ffff00')}</button>
            <button className="xl-btn" aria-haspopup="menu" aria-label="Font colour" title="Font colour" onClick={colorMenu('fc')}><Ic d={I.fontColor} />{swatch(f0.fc || '#c00000')}</button>
          </div>
        </div>
      </Group>
      <Group name="Alignment">
        <div className="xl-col">
          <div className="xl-row">
            <B icon="alTop" label="Top align" on={f0.va === 'top'} act={() => setFmt({ va: f0.va === 'top' ? null : 'top' })} />
            <B icon="alMid" label="Middle align" on={f0.va === 'middle'} act={() => setFmt({ va: f0.va === 'middle' ? null : 'middle' })} />
            <B icon="alBot" label="Bottom align" on={!f0.va} act={() => setFmt({ va: null })} />
            <span className="xl-sep" />
            <B wide icon="wrap" label="Wrap Text" on={f0.wrap} act={() => toggle('wrap')} />
          </div>
          <div className="xl-row">
            <B icon="alL" label="Align left" on={f0.al === 'left'} act={() => setFmt({ al: f0.al === 'left' ? null : 'left' })} />
            <B icon="alC" label="Center" on={f0.al === 'center'} act={() => setFmt({ al: f0.al === 'center' ? null : 'center' })} />
            <B icon="alR" label="Align right" on={f0.al === 'right'} act={() => setFmt({ al: f0.al === 'right' ? null : 'right' })} />
            <span className="xl-sep" />
            <B wide icon="merge" label="Merge & Center" on={isMerged} menu act={menu([
              { label: 'Merge & Center', act: () => merge('center') }, { label: 'Merge Across', act: () => merge('across') },
              { label: 'Merge Cells', act: () => merge('cells') }, { label: 'Unmerge Cells', act: () => merge('unmerge') },
            ])} />
          </div>
        </div>
      </Group>
      <Group name="Number">
        <div className="xl-col">
          <select className="xl-sel nf" aria-label="Number format" value={numberFmtValue} onChange={e => setFmt({ nf: e.target.value || null, dp: null })}>
            {NUMBER_FORMATS.map(([k, n]) => <option key={k} value={k}>{n}</option>)}
            {numberFmtValue === '__custom' && <option value="__custom">{f0.nf}</option>}
          </select>
          <div className="xl-row">
            <B icon="sigma" label="Currency" title="Currency format" act={() => setFmt({ nf: '$' })} />
            <B icon="pct" label="Percent style (Ctrl Shift %)" act={() => setFmt({ nf: '0%', dp: null })} />
            <B icon="comma" label="Comma style" act={() => setFmt({ nf: '#,##0.00', dp: null })} />
            <B icon="decUp" label="Increase decimal" act={() => bump('dp', 1)} />
            <B icon="decDn" label="Decrease decimal" act={() => bump('dp', -1)} />
          </div>
        </div>
      </Group>
      <Group name="Cells">
        <B wide icon="insRow" label="Insert" menu act={menu([
          { label: 'Insert rows above', act: () => insert(true, true) }, { label: 'Insert rows below', act: () => insert(true, false) },
          { label: 'Insert columns left', act: () => insert(false, true) }, { label: 'Insert columns right', act: () => insert(false, false) },
          '-', { label: 'Insert sheet', act: addSheet },
        ])} />
        <B wide icon="delRow" label="Delete" menu act={menu([
          { label: 'Delete rows', danger: true, act: () => remove(true) }, { label: 'Delete columns', danger: true, act: () => remove(false) },
        ])} />
        <B wide icon="grid" label="Format" menu act={menu([
          { label: 'Row height…', act: () => setSize(true) }, { label: 'Column width…', act: () => setSize(false) },
          { label: 'AutoFit column width', act: autoFit },
        ])} />
      </Group>
      <Group name="Editing">
        <div className="xl-col">
          <B wide icon="sigma" label="AutoSum" menu act={menu(['SUM', 'AVERAGE', 'COUNT', 'MAX', 'MIN'].map(f => ({ label: f[0] + f.slice(1).toLowerCase(), act: () => autoSum(f) })))} />
          <B wide icon="insRow" label="Fill" menu act={menu([{ label: 'Down', kbd: 'Ctrl D', act: () => fillDown(true) }, { label: 'Right', kbd: 'Ctrl R', act: () => fillDown(false) }])} />
          <B wide icon="clear" label="Clear" menu act={menu([{ label: 'Clear all', act: () => clearBox('all') }, { label: 'Clear formats', act: () => clearBox('formats') }, { label: 'Clear contents', act: () => clearBox('contents') }])} />
        </div>
        <B wide icon="sortAZ" label="Sort & Filter" menu act={menu([
          { label: 'Sort A to Z', act: () => sortBy(false) }, { label: 'Sort Z to A', act: () => sortBy(true) },
          '-', { label: active.filter ? 'Remove filter' : 'Filter', kbd: 'Ctrl Shift L', act: toggleFilter },
        ])} />
        <B wide icon="find" label="Find & Select" menu act={menu([{ label: 'Find…', kbd: 'Ctrl F', act: () => setFind({ replace: false }) }, { label: 'Replace…', kbd: 'Ctrl H', act: () => setFind({ replace: true }) }])} />
      </Group>
    </>),
    insert: (<>
      <Group name="Charts">
        <B wide icon="chartCol" label="Column" act={() => addChart('column')} />
        <B wide icon="chartBar" label="Bar" act={() => addChart('bar')} />
        <B wide icon="chartLine" label="Line" act={() => addChart('line')} />
        <B wide icon="chartArea" label="Area" act={() => addChart('area')} />
        <B wide icon="chartPie" label="Pie" menu act={menu([{ label: 'Pie', act: () => addChart('pie') }, { label: 'Doughnut', act: () => addChart('doughnut') }])} />
        <B wide icon="chartLine" label="Scatter" act={() => addChart('scatter')} />
      </Group>
      <Group name="Cells"><B wide icon="insRow" label="Rows above" act={() => insert(true, true)} /><B wide icon="insRow" label="Columns left" act={() => insert(false, true)} /><B wide icon="sheet" label="Sheet" act={addSheet} /></Group>
      <Group name="Linework"><B wide icon="canvas" label="Show on canvas" act={() => onAddToCanvas(active.id)} /></Group>
    </>),
    formulas: (<>
      <Group name="Function Library">
        <B wide icon="fx" label="Insert Function" menu act={menu(FUNCTIONS.slice(0, 1).length ? [{ label: 'All functions', items: FUNCTIONS.map(f => ({ label: f, act: () => insertFn(f) })) }] : [])} />
        <B wide icon="sigma" label="AutoSum" menu act={menu(['SUM', 'AVERAGE', 'COUNT', 'MAX', 'MIN'].map(f => ({ label: f[0] + f.slice(1).toLowerCase(), act: () => autoSum(f) })))} />
        {FN_GROUPS.map(([g, list]) => <B key={g} wide icon="fx" label={g} menu act={menu(list.map(f => ({ label: f, act: () => insertFn(f) })))} />)}
      </Group>
      <Group name="Formula Auditing"><B wide icon="fx" label="Show Formulas" on={showFormulas} act={() => setShowFormulas(x => !x)} /></Group>
    </>),
    data: (<>
      <Group name="Get Data"><B wide icon="open" label="From .xlsx / .csv" act={pickFile} /></Group>
      <Group name="Sort & Filter">
        <B wide icon="sortAZ" label="Sort A to Z" act={() => sortBy(false)} />
        <B wide icon="sortZA" label="Sort Z to A" act={() => sortBy(true)} />
        <B wide icon="filter" label="Filter" on={!!active.filter} act={toggleFilter} />
        <B wide icon="clear" label="Clear" disabled={!active.filter} act={() => change(s => { if (s.filter) s.filter = { ...s.filter, hide: {} }; })} />
      </Group>
      <Group name="Export"><B wide icon="save" label="Download .xlsx" act={saveXlsx} /><B wide icon="save" label="Download .csv" act={saveCSV} /></Group>
    </>),
    view: (<>
      <Group name="Window">
        <B wide icon="freeze" label="Freeze Panes" on={!!(freeze.r || freeze.c)} menu act={menu([
          { label: 'Freeze panes', note: `Above and left of ${curAddr}`, act: () => setFreeze({ r: cur.r, c: cur.c }) },
          { label: 'Freeze top row', act: () => setFreeze({ r: 1, c: 0 }) },
          { label: 'Freeze first column', act: () => setFreeze({ r: 0, c: 1 }) },
          '-', { label: 'Unfreeze panes', act: () => setFreeze(null) },
        ])} />
      </Group>
      <Group name="Show"><B wide icon="grid" label="Gridlines" on={!active.noGrid} act={() => change(s => { if (s.noGrid) delete s.noGrid; else s.noGrid = true; })} /><B wide icon="fx" label="Formulas" on={showFormulas} act={() => setShowFormulas(x => !x)} /></Group>
      <Group name="Zoom">
        <B wide icon="find" label="Zoom out" act={() => setZoom(z => Math.max(25, z - 10))} />
        <B wide icon="find" label="100%" act={() => setZoom(100)} />
        <B wide icon="find" label="Zoom in" act={() => setZoom(z => Math.min(400, z + 10))} />
      </Group>
    </>),
  };

  /* ---- status ---- */
  const stats = (() => {
    if (single) return null;
    let n = 0, sum = 0, count = 0;
    eachIn(box, a => { const v = val(a); if (v !== '' && v != null) count++; if (typeof v === 'number') { n++; sum += v; } });
    return count > 1 ? { n, sum, count } : null;
  })();
  const loc = n => n.toLocaleString(undefined, { maximumFractionDigits: 4 });
  const hint = edit && edit.value.startsWith('=') ? (() => {
    const m = /([A-Za-z.]+)\($/.exec(edit.value) || /([A-Za-z][A-Za-z.]+)$/.exec(edit.value);
    const q = m && m[1].toUpperCase();
    return q ? FUNCTIONS.filter(f => f.startsWith(q)).slice(0, 8) : [];
  })() : [];
  const barValue = edit ? edit.value : raw(curAddr);

  /* ---- grid geometry for frozen panes ---- */
  const leftOf = c => { let x = HEAD_W; for (let i = 0; i < c; i++) x += width(i); return x; };
  const topOf = r => { let y = HEAD_H; for (let i = 0; i < r; i++) if (!hidden.has(i)) y += height(i); return y; };
  const frozenStyle = (c, r) => {
    const fr = r != null && r < freeze.r, fc = c != null && c < freeze.c;
    if (!fr && !fc) return null;
    return { position: 'sticky', ...(fr ? { top: topOf(r) } : {}), ...(fc ? { left: leftOf(c) } : {}), zIndex: fr && fc ? 4 : 2 };
  };
  const totalW = HEAD_W + Array.from({ length: cols }, (_, c) => width(c)).reduce((a, b) => a + b, 0);

  // How a cell looks: its formats, the selection edges and the fill-handle preview, as inset shadows.
  const cellStyle = (a, c, r, f, v, m) => {
    const st = {};
    if (f.b) st.fontWeight = 700;
    if (f.i) st.fontStyle = 'italic';
    if (f.u || f.s) st.textDecoration = [f.u && 'underline', f.s && 'line-through'].filter(Boolean).join(' ');
    if (f.fs) st.fontSize = (f.fs * 4) / 3;
    if (f.ff) st.fontFamily = `"${f.ff}", Calibri, Carlito, sans-serif`;
    if (f.fc) st.color = f.fc;
    if (f.bg) { st.background = f.bg; if (!f.fc) st.color = '#000'; } // a filled cell keeps dark text, in dark mode too
    st.textAlign = f.al || (showFormulas && String(raw(a))[0] === '=' ? 'left' : typeof v === 'number' ? 'right' : typeof v === 'boolean' || isErr(v) ? 'center' : 'left');
    st.verticalAlign = f.va === 'top' ? 'top' : f.va === 'middle' ? 'middle' : 'bottom';
    if (f.wrap) { st.whiteSpace = 'pre-wrap'; st.wordBreak = 'break-word'; }
    const sh = [], bd = f.bd || {}, W = { 1: 1, 2: 2, 3: 3 }, ink = 'var(--xl-border)';
    if (bd.t) sh.push(`inset 0 ${W[bd.t]}px 0 0 ${ink}`);
    if (bd.b) sh.push(`inset 0 -${W[bd.b]}px 0 0 ${ink}`);
    if (bd.l) sh.push(`inset ${W[bd.l]}px 0 0 0 ${ink}`);
    if (bd.r) sh.push(`inset -${W[bd.r]}px 0 0 0 ${ink}`);
    const c1 = m ? m.c1 : c, r1 = m ? m.r1 : r;
    if (inBox(c, r) || (m && inBox(m.c0, m.r0))) {
      const G = 'var(--xl-accent)';
      if (r === box.r0) sh.push(`inset 0 2px 0 0 ${G}`);
      if (r1 === box.r1) sh.push(`inset 0 -2px 0 0 ${G}`);
      if (c === box.c0) sh.push(`inset 2px 0 0 0 ${G}`);
      if (c1 === box.c1) sh.push(`inset -2px 0 0 0 ${G}`);
    }
    if (sh.length) st.boxShadow = sh.join(',');
    return st;
  };

  const ROWS = [];
  const filter = active.filter;
  for (let r = 0; r < rows; r++) {
    if (hidden.has(r)) continue;
    const tds = [];
    for (let c = 0; c < cols; c++) {
      const m = mergeOf(c, r);
      if (m && (m.c0 !== c || m.r0 !== r)) continue;
      const a = addr(c, r), v = val(a), f = fmt(a), isCur = (m ? m.c0 === cur.c && m.r0 === cur.r : c === cur.c && r === cur.r) || (m && cur.c >= m.c0 && cur.c <= m.c1 && cur.r >= m.r0 && cur.r <= m.r1);
      const text = showFormulas && String(raw(a))[0] === '=' ? raw(a) : shown(val, active, a);
      const spans = m ? { colSpan: m.c1 - m.c0 + 1, rowSpan: [...Array(m.r1 - m.r0 + 1)].filter((_, i) => !hidden.has(m.r0 + i)).length || 1 } : {};
      // Text runs on into empty cells to its right, as in Excel.
      const spill = !m && !f.wrap && typeof v === 'string' && v !== '' && (f.al || 'left') === 'left' && c + 1 < cols && raw(addr(c + 1, r)) === '' && !mergeOf(c + 1, r);
      const corner = !fillTo && !edit && (m ? m.c1 : c) === box.c1 && (m ? m.r1 : r) === box.r1;
      const isFilterHead = filter && r === filter.r && c >= filter.c0 && c <= filter.c1;
      const st = { ...cellStyle(a, c, r, f, v, m), ...(frozenStyle(c, r) || {}) };
      tds.push(
        <td key={c} data-a={a} role="gridcell" aria-selected={inBox(c, r)} {...spans}
          className={[inBox(c, r) && !isCur && 'sel', isCur && 'cur', isErr(v) && 'err', spill && 'spill', inFill(c, r) && 'fillprev', frozenStyle(c, r) && 'frz', active.noGrid && 'nogrid', c === freeze.c - 1 && 'frz-r', r === freeze.r - 1 && 'frz-b'].filter(Boolean).join(' ') || undefined}
          style={st}
          onPointerDown={e => cellDown(e, c, r)} onPointerEnter={() => cellEnter(c, r)}
          onDoubleClick={() => startEdit(raw(a))} onContextMenu={e => cellMenu(e, c, r)}>
          {isCur && edit && edit.from === 'cell'
            ? <textarea ref={inRef} autoFocus rows={1} className="xl-in" aria-label={`Edit ${a}`} value={edit.value} spellCheck="false"
                style={{ textAlign: 'left', fontSize: st.fontSize, fontWeight: st.fontWeight, fontStyle: st.fontStyle, fontFamily: st.fontFamily, minWidth: Math.max(60, (edit.value.length + 2) * 7.5) }}
                onFocus={e => { const n = e.target.value.length; e.target.setSelectionRange(n, n); }}
                onChange={e => setEdit({ value: e.target.value, from: 'cell' })} onKeyDown={editKey}
                onBlur={() => { if (!pickStart.current) commit(null); }} />
            : <span className="xl-v">{text}</span>}
          {isFilterHead && <button className={'xl-fbtn' + ((filter.hide[c] || []).length ? ' on' : '')} aria-label={`Filter ${colName(c)}`} onPointerDown={e => e.stopPropagation()}
            onClick={e => { e.stopPropagation(); const rc = e.currentTarget.getBoundingClientRect(); setFilterAt({ c, x: rc.left, y: rc.bottom }); }}>▾</button>}
          {corner && <i className="xl-handle" onPointerDown={startFill} onDoubleClick={fillDouble} title="Drag to fill; double-click to fill down" />}
        </td>,
      );
    }
    ROWS.push(
      <tr key={r} style={{ height: height(r) }}>
        <th className={(r >= box.r0 && r <= box.r1 ? 'on' : '') + (r === freeze.r - 1 ? ' frz-b' : '')} style={frozenStyle(null, r) ? { ...frozenStyle(null, r), left: 0, zIndex: 5 } : undefined}
          onPointerDown={e => headDown(e, null, r)} onPointerEnter={() => headEnter(null, r)}>
          {r + 1}<i className="xl-rs-r" onPointerDown={e => resize(e, null, r)} aria-hidden="true" />
        </th>
        {tds}
      </tr>,
    );
  }

  return (
    <div className={'xl' + (painter ? ' painting' : '')} onCopy={e => onCopy(e)} onCut={e => onCopy(e, true)} onPaste={onPaste}>
      <div className="xl-tabs" role="tablist" aria-label="Ribbon">
        {TABS.map(([k, n]) => <button key={k} role="tab" aria-selected={tab === k} className={'xl-tab' + (k === 'file' ? ' file' : '')} onClick={() => setTab(k)}>{n}</button>)}
        <span className="grow" />
        <button className="xl-btn" title="Undo (Ctrl Z)" aria-label="Undo" onClick={() => restore(undo, redo)} disabled={!undo.current.length}><Ic d={I.undo} /></button>
        <button className="xl-btn" title="Redo (Ctrl Y)" aria-label="Redo" onClick={() => restore(redo, undo)} disabled={!redo.current.length}><Ic d={I.redo} /></button>
      </div>
      <div className="xl-ribbon" role="toolbar" aria-label={TABS.find(t => t[0] === tab)[1]}>{ribbon[tab]}</div>

      <div className="xl-bar">
        <input className="xl-name" aria-label="Name box" value={single ? curAddr : rangeName(box)} spellCheck="false"
          onChange={() => {}} onKeyDown={e => {
            if (e.key !== 'Enter') return;
            e.preventDefault();
            const b = parseRange(e.currentTarget.value.toUpperCase());
            if (b) { setSel({ a: { c: b.c0, r: b.r0 }, b: { c: b.c1, r: b.r1 } }); scrollTo(b.c0, b.r0); gridRef.current?.focus(); }
          }} onFocus={e => e.target.select()} />
        <span className="xl-fx" aria-hidden="true">
          {edit ? <><button onPointerDown={e => { e.preventDefault(); cancel(); }} aria-label="Cancel">✕</button><button onPointerDown={e => { e.preventDefault(); commit(null); }} aria-label="Enter">✓</button></> : null}
          <i>fx</i>
        </span>
        <textarea ref={barRef} rows={1} className="xl-formula" aria-label="Cell contents" value={barValue} spellCheck="false"
          onFocus={() => { if (!edit) startEdit(raw(curAddr), 'bar'); }}
          onChange={e => setEdit({ value: e.target.value, from: 'bar' })} onKeyDown={editKey}
          onBlur={() => { if (edit && edit.from === 'bar' && !pickStart.current) commit(null); }} />
        {hint.length > 0 && <span className="xl-hint" role="status">{hint.map(h => <button key={h} onPointerDown={e => { e.preventDefault(); setEdit(x => ({ ...x, value: x.value.replace(/[A-Za-z.]*\(?$/, '') + h + '(' })); }}>{h}</button>)}</span>}
      </div>

      <div className="xl-grid" ref={gridRef} tabIndex={0} role="grid" aria-label={active.name} aria-rowcount={rows} aria-colcount={cols} onKeyDown={onKey}
        onPointerDown={e => { if (e.target === gridRef.current) setChartSel(null); }}>
        <div className="xl-zoom" style={{ zoom: zoom / 100 }}>
          <table style={{ width: totalW }}>
            <colgroup><col style={{ width: HEAD_W }} />{Array.from({ length: cols }, (_, c) => <col key={c} style={{ width: width(c) }} />)}</colgroup>
            <thead>
              <tr style={{ height: HEAD_H }}>
                <th className="xl-corner" onPointerDown={e => { e.preventDefault(); setSel({ a: { c: 0, r: 0 }, b: { c: cols - 1, r: rows - 1 } }); }} aria-label="Select all" />
                {Array.from({ length: cols }, (_, c) => (
                  <th key={c} className={(c >= box.c0 && c <= box.c1 ? 'on' : '') + (c === freeze.c - 1 ? ' frz-r' : '')} style={c < freeze.c ? { left: leftOf(c), zIndex: 6 } : undefined}
                    onPointerDown={e => headDown(e, c, null)} onPointerEnter={() => headEnter(c, null)}>
                    {colName(c)}<i className="xl-rs" onPointerDown={e => resize(e, c, null)} onDoubleClick={e => resizeDouble(e, c)} aria-hidden="true" />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>{ROWS}</tbody>
          </table>
          {(active.charts || []).map(ch => (
            <ChartBox key={ch.id} ch={ch} sheet={active} book={sheets} colors={colors} selected={chartSel === ch.id} zoom={zoom}
              onSelect={() => setChartSel(ch.id)} onChange={(p, rec) => updChart(ch.id, p, rec)} onDelete={() => delChart(ch.id)} ask={ask} popup={popup} />
          ))}
          <div className="xl-more">
            <button className="btn" onClick={() => mutSheet(s => { s.rows = (s.rows || 100) + 100; })}>+ 100 rows</button>
            <button className="btn" onClick={() => mutSheet(s => { s.cols = (s.cols || 26) + 10; })}>+ 10 columns</button>
          </div>
        </div>
      </div>

      <div className="xl-foot">
        <div className="xl-sheets" role="tablist" aria-label="Sheets">
          {sheets.map(s => (
            <button key={s.id} role="tab" aria-selected={s.id === active.id} className={'xl-stab' + (s.id === active.id ? ' on' : '')}
              onClick={() => update(c => { c.activeSheet = s.id; })} onDoubleClick={() => renameSheet(s)}
              onContextMenu={e => { e.preventDefault(); sheetMenu(e.currentTarget, s); }}>
              {s.name}{s.id === active.id && <span className="tm" role="button" tabIndex={0} aria-label="Sheet actions" onClick={e => { e.stopPropagation(); sheetMenu(e.currentTarget, s); }}>⋯</span>}
            </button>
          ))}
          <button className="xl-add" onClick={addSheet} aria-label="Add a sheet" title="New sheet">+</button>
        </div>
      </div>
      <div className="xl-status">
        <span>{painter ? 'Select cells to paint formats' : edit ? 'Edit' : fillTo ? 'Drag to fill' : 'Ready'}</span>
        {filter && <span>Filter on{hidden.size ? ` · ${hidden.size} row${hidden.size === 1 ? '' : 's'} hidden` : ''}</span>}
        <span className="grow" />
        {stats && <span className="xl-stats" aria-live="polite">{stats.n ? `Average: ${loc(stats.sum / stats.n)}   Count: ${stats.count}   Sum: ${loc(stats.sum)}` : `Count: ${stats.count}`}</span>}
        <span className="xl-zoomctl">
          <button onClick={() => setZoom(z => Math.max(25, z - 10))} aria-label="Zoom out">−</button>
          <input type="range" min="25" max="200" step="5" value={zoom} onChange={e => setZoom(Number(e.target.value))} aria-label="Zoom" />
          <button onClick={() => setZoom(z => Math.min(400, z + 10))} aria-label="Zoom in">+</button>
          <b>{zoom}%</b>
        </span>
      </div>

      {filterAt && filter && (
        <FilterMenu at={filterAt} values={filterValues(filterAt.c)} hiddenVals={filter.hide[filterAt.c] || []}
          onSort={desc => { sortBy(desc, filterAt.c, { r0: filter.r, r1: (usedRange(active) || { r1: filter.r }).r1, c0: filter.c0, c1: filter.c1 }); setFilterAt(null); gridRef.current?.focus({ preventScroll: true }); }}
          onApply={hide => { change(s => { s.filter = { ...s.filter, hide: { ...s.filter.hide, [filterAt.c]: hide } }; }); setFilterAt(null); gridRef.current?.focus({ preventScroll: true }); }}
          onClose={() => { setFilterAt(null); gridRef.current?.focus({ preventScroll: true }); }} />
      )}
      {find && <FindBar mode={find} sheet={active} val={val} onGo={(c, r) => { setSel({ a: { c, r }, b: { c, r } }); scrollTo(c, r); }}
        onReplace={map => setCells(map)} onClose={() => { setFind(null); gridRef.current?.focus(); }} cur={cur} />}
      {fileInput}
    </div>
  );
}

// Moved address for inserted (n > 0) or deleted (n < 0) rows/columns; null when it was deleted.
function moveAddr(p, rowsNotCols, at, n) {
  const k = rowsNotCols ? p.r : p.c;
  if (k < at) { if (n < 0 && k >= at + n) return null; return addr(p.c, p.r); }
  return rowsNotCols ? addr(p.c, p.r + n) : addr(p.c + n, p.r);
}

// A chart over the grid: drag to move, the corner to resize; its bar changes the type, title and cells.
function ChartBox({ ch, sheet, book, colors, selected, zoom, onSelect, onChange, onDelete, ask, popup }) {
  const svg = useMemo(() => chartSVG(ch, sheet, book, ch.w, ch.h, colors), [ch, sheet, book, colors]);
  const drag = (e, resize) => {
    e.preventDefault(); e.stopPropagation();
    onSelect();
    const x0 = e.clientX, y0 = e.clientY, start = { x: ch.x, y: ch.y, w: ch.w, h: ch.h }, k = zoom / 100;
    let first = true;
    const move = ev => {
      const dx = (ev.clientX - x0) / k, dy = (ev.clientY - y0) / k;
      onChange(resize ? { w: Math.max(160, Math.round(start.w + dx)), h: Math.max(120, Math.round(start.h + dy)) } : { x: Math.max(0, Math.round(start.x + dx)), y: Math.max(0, Math.round(start.y + dy)) }, first);
      first = false;
    };
    const up = () => { removeEventListener('pointermove', move); removeEventListener('pointerup', up); };
    addEventListener('pointermove', move); addEventListener('pointerup', up);
  };
  return (
    <div className={'xl-chart' + (selected ? ' on' : '')} style={{ left: ch.x, top: ch.y, width: ch.w, height: ch.h }} role="figure" aria-label={`Chart: ${ch.title || ch.type}`}
      onPointerDown={e => drag(e, false)} onKeyDown={e => { if (e.key === 'Delete' && selected) onDelete(); }} tabIndex={0}>
      <div className="xl-chart-svg" dangerouslySetInnerHTML={{ __html: svg }} />
      {selected && (
        <div className="xl-chart-bar" onPointerDown={e => e.stopPropagation()}>
          <select aria-label="Chart type" value={ch.type} onChange={e => onChange({ type: e.target.value })}>{CHART_TYPES.map(([k, n]) => <option key={k} value={k}>{n}</option>)}</select>
          <button onClick={async () => { const v = await ask({ title: 'Chart title', value: ch.title || '', ok: 'Save' }); if (v != null) onChange({ title: v.slice(0, 80) }); }}>Title</button>
          <button onClick={async () => { const v = await ask({ title: 'Chart data', text: 'The cells to chart, like A1:D6. The first row and column can hold labels.', value: ch.range, ok: 'Save' }); if (v && parseRange(v.toUpperCase())) onChange({ range: v.toUpperCase().replace(/\$/g, '') }); }}>Data</button>
          <button className="danger" onClick={onDelete} aria-label="Delete chart">Delete</button>
        </div>
      )}
      {selected && <i className="xl-chart-rs" onPointerDown={e => drag(e, true)} aria-hidden="true" />}
    </div>
  );
}

// The filter menu on a header cell: sort, and tick the values to show.
function FilterMenu({ at, values, hiddenVals, onSort, onApply, onClose }) {
  const [hide, setHide] = useState(() => new Set(hiddenVals));
  const [q, setQ] = useState('');
  const ref = useRef(null);
  useEffect(() => {
    const down = e => { if (ref.current && !ref.current.contains(e.target)) onClose(); };
    const t = setTimeout(() => addEventListener('pointerdown', down));
    return () => { clearTimeout(t); removeEventListener('pointerdown', down); };
  }, [onClose]);
  const list = values.filter(v => !q || v.toLowerCase().includes(q.toLowerCase()));
  const all = list.every(v => !hide.has(v));
  return (
    <div className="xl-filter" ref={ref} role="dialog" aria-label="Filter" style={{ left: Math.min(at.x, innerWidth - 250), top: Math.min(at.y + 2, innerHeight - 380) }}
      onKeyDown={e => { if (e.key === 'Escape') onClose(); }}>
      <button onClick={() => onSort(false)}>Sort A to Z</button>
      <button onClick={() => onSort(true)}>Sort Z to A</button>
      <hr />
      <input autoFocus placeholder="Search" aria-label="Search values" value={q} onChange={e => setQ(e.target.value)} />
      <div className="xl-fl">
        <label><input type="checkbox" checked={all} onChange={() => setHide(h => { const n = new Set(h); list.forEach(v => (all ? n.add(v) : n.delete(v))); return n; })} /> (Select all)</label>
        {list.map(v => (
          <label key={v}><input type="checkbox" checked={!hide.has(v)} onChange={() => setHide(h => { const n = new Set(h); n.has(v) ? n.delete(v) : n.add(v); return n; })} /> {v === '' ? '(Blanks)' : v}</label>
        ))}
      </div>
      <div className="xl-factions"><button className="btn dark" onClick={() => onApply([...hide])}>OK</button><button className="btn" onClick={onClose}>Cancel</button></div>
    </div>
  );
}

// Find & Replace, like Excel's: looks in values and formulas, row by row from the active cell.
function FindBar({ mode, sheet, val, onGo, onReplace, onClose, cur }) {
  const [q, setQ] = useState(''), [rep, setRep] = useState(''), [replace, setReplace] = useState(mode.replace);
  const [matchCase, setCase] = useState(false), [whole, setWhole] = useState(false), [note, setNote] = useState('');
  const pos = useRef(cur);
  const hits = () => {
    const u = usedRange(sheet);
    if (!u || !q) return [];
    const test = s => { const a = matchCase ? s : s.toLowerCase(), b = matchCase ? q : q.toLowerCase(); return whole ? a === b : a.includes(b); };
    const out = [];
    for (let r = 0; r <= u.r1; r++) for (let c = 0; c <= u.c1; c++) {
      const a = addr(c, r), raw = String((sheet.cells || {})[a] ?? '');
      if (raw && (test(raw) || test(shown(val, sheet, a)))) out.push({ c, r, a });
    }
    return out;
  };
  const next = () => {
    const h = hits();
    if (!h.length) { setNote('No matches.'); return; }
    const p = pos.current, i = h.findIndex(x => x.r > p.r || (x.r === p.r && x.c > p.c));
    const t = h[i < 0 ? 0 : i];
    pos.current = t; onGo(t.c, t.r);
    setNote(`${h.indexOf(t) + 1} of ${h.length}`);
  };
  const swap = s => { const re = new RegExp(whole ? `^${q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$` : q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), matchCase ? 'g' : 'gi'); return s.replace(re, rep); };
  const replaceOne = () => {
    const p = pos.current, a = addr(p.c, p.r), raw = String((sheet.cells || {})[a] ?? '');
    if (raw && swap(raw) !== raw) onReplace({ [a]: swap(raw) });
    next();
  };
  const replaceAll = () => {
    const map = {};
    hits().forEach(h => { const raw = String((sheet.cells || {})[h.a] ?? ''), s = swap(raw); if (s !== raw) map[h.a] = s; });
    const n = Object.keys(map).length;
    if (n) onReplace(map);
    setNote(n ? `Replaced ${n} cell${n === 1 ? '' : 's'}.` : 'No matches.');
  };
  return (
    <div className="xl-find" role="dialog" aria-label="Find and Replace" onKeyDown={e => { if (e.key === 'Escape') onClose(); }}>
      <div className="xl-find-tabs">
        <button aria-pressed={!replace} onClick={() => setReplace(false)}>Find</button>
        <button aria-pressed={replace} onClick={() => setReplace(true)}>Replace</button>
        <span className="grow" />
        <button onClick={onClose} aria-label="Close">✕</button>
      </div>
      <label>Find what <input autoFocus value={q} onChange={e => { setQ(e.target.value); setNote(''); }} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); next(); } }} /></label>
      {replace && <label>Replace with <input value={rep} onChange={e => setRep(e.target.value)} /></label>}
      <div className="xl-find-opts">
        <label><input type="checkbox" checked={matchCase} onChange={e => setCase(e.target.checked)} /> Match case</label>
        <label><input type="checkbox" checked={whole} onChange={e => setWhole(e.target.checked)} /> Match entire cell</label>
      </div>
      <div className="xl-find-acts">
        <span className="note" role="status">{note}</span>
        {replace && <><button className="btn" onClick={replaceAll}>Replace All</button><button className="btn" onClick={replaceOne}>Replace</button></>}
        <button className="btn dark" onClick={next}>Find Next</button>
      </div>
    </div>
  );
}
