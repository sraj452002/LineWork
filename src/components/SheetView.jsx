import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FUNCTIONS, SAMPLE, addr, colName, display, evaluate, formatValue, fromCSV, isErr, newSheet, parseAddr, shiftFormula, toCSV } from '../lib/sheet.js';
import { downloads } from '../lib/ai.js';
import { useUI } from './ui.jsx';

/* The Sheet view: spreadsheets kept in the file (file.sheets), each a grid of cells with formulas.
   Click or use the arrow keys to move, type to replace a cell, Enter or F2 (or double-click) to edit it,
   Shift to select a block, Ctrl C / Ctrl V to copy and paste (also to and from Excel or Google Sheets). */

const ROW_H = 28, HEAD_W = 46, DEF_W = 110;
const FORMATS = [['', 'Automatic'], ['0', '1,234'], ['0.00', '1,234.56'], ['%', 'Percent'], ['$', 'Currency ($)'], ['€', 'Currency (€)'], ['₹', 'Currency (₹)'], ['text', 'Plain text']];

export default function SheetView({ file, update, visible, focusSheet, onAddToCanvas }) {
  const { popup, ask, toast } = useUI();
  const sheets = file.sheets || [];
  const active = sheets.find(s => s.id === file.activeSheet) || sheets[0] || null;
  const mutSheet = useCallback(fn => update(c => {
    const s = (c.sheets || []).find(x => x.id === (active && active.id));
    if (s) { fn(s); s.cells = { ...s.cells }; }
  }), [update, active && active.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const [sel, setSel] = useState({ a: { c: 0, r: 0 }, b: { c: 0, r: 0 } }); // anchor and far corner
  const [edit, setEdit] = useState(null); // {value, from: 'cell' | 'bar'} while editing the active cell
  const gridRef = useRef(null), inRef = useRef(null), barRef = useRef(null), fileRef = useRef(null);
  const undo = useRef([]), redo = useRef([]);
  const clip = useRef(null); // {text, raws, c0, r0} from this app, so formulas paste as formulas
  const dragging = useRef(false);
  const editing = useRef(false); // set at once, before React re-renders with the editor
  useEffect(() => { editing.current = !!edit; }, [edit]);
  const selRef = useRef(sel);
  selRef.current = sel;

  useEffect(() => { setSel({ a: { c: 0, r: 0 }, b: { c: 0, r: 0 } }); setEdit(null); }, [active && active.id]);
  useEffect(() => { if (focusSheet) update(c => { c.activeSheet = focusSheet; }); }, [focusSheet]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (visible && !edit) gridRef.current?.focus({ preventScroll: true }); }, [visible, active && active.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const val = useMemo(() => (active ? evaluate(active) : () => ''), [active]);
  if (!active) {
    const add = sample => update(c => { const s = sample ? SAMPLE() : newSheet(); c.sheets = [...(c.sheets || []), s]; c.activeSheet = s.id; });
    return (
      <div className="sv-empty">
        <h2>Sheet</h2>
        <p>Tables of numbers and text that work things out: totals, costs, capacity, schedules. Formulas work like Excel’s, such as <code>=SUM(B2:B9)</code> or <code>=B2*C2</code>, and a sheet can be shown on the canvas next to the diagram.</p>
        <div className="cw-start">
          <button className="btn dark" onClick={() => add(false)}>New sheet</button>
          <button className="btn" onClick={() => add(true)}>Start from an example</button>
          <button className="btn" onClick={() => fileRef.current?.click()}>Import a CSV file</button>
        </div>
        <input ref={fileRef} type="file" accept=".csv,.tsv,text/csv,text/plain" hidden onChange={e => importCSV(e.target.files[0], true)} />
      </div>
    );
  }

  const cols = active.cols || 12, rows = active.rows || 40;
  const cur = sel.b, curAddr = addr(cur.c, cur.r);
  const box = { c0: Math.min(sel.a.c, sel.b.c), c1: Math.max(sel.a.c, sel.b.c), r0: Math.min(sel.a.r, sel.b.r), r1: Math.max(sel.a.r, sel.b.r) };
  // The selection as it is now (menus act after a right-click has moved it).
  const live = () => { const { a, b } = selRef.current; return { cur: b, box: { c0: Math.min(a.c, b.c), c1: Math.max(a.c, b.c), r0: Math.min(a.r, b.r), r1: Math.max(a.r, b.r) } }; };
  const inBox = (c, r) => c >= box.c0 && c <= box.c1 && r >= box.r0 && r <= box.r1;
  const raw = a => active.cells[a] ?? '';
  const fmt = a => (active.fmt || {})[a] || {};
  const width = c => (active.widths || {})[colName(c)] || DEF_W;

  // Changes go through here, so they can be undone.
  const change = (fn, label) => {
    undo.current.push({ cells: active.cells, fmt: active.fmt, cols: active.cols, rows: active.rows });
    if (undo.current.length > 100) undo.current.shift();
    redo.current = [];
    mutSheet(fn);
    if (label) toast(label);
  };
  const restore = (from, to) => {
    const snap = from.current.pop();
    if (!snap) return;
    to.current.push({ cells: active.cells, fmt: active.fmt, cols: active.cols, rows: active.rows });
    mutSheet(s => { Object.assign(s, snap); });
  };
  const setCells = map => change(s => {
    for (const [a, v] of Object.entries(map)) { if (v === '' || v == null) delete s.cells[a]; else s.cells[a] = v; }
    const far = Object.keys(map).map(parseAddr).filter(Boolean);
    s.cols = Math.max(s.cols || 12, ...far.map(p => p.c + 2));
    s.rows = Math.max(s.rows || 40, ...far.map(p => p.r + 5));
  });
  const setFmt = patch => change(s => {
    s.fmt = { ...(s.fmt || {}) };
    for (let r = box.r0; r <= box.r1; r++) for (let c = box.c0; c <= box.c1; c++) {
      const a = addr(c, r), f = { ...(s.fmt[a] || {}), ...patch };
      Object.keys(f).forEach(k => { if (f[k] == null || f[k] === '' || f[k] === false) delete f[k]; });
      if (Object.keys(f).length) s.fmt[a] = f; else delete s.fmt[a];
    }
  });

  const go = (c, r, extend) => {
    const p = { c: Math.max(0, Math.min(cols - 1, c)), r: Math.max(0, Math.min(rows - 1, r)) };
    setSel(s => (extend ? { a: s.a, b: p } : { a: p, b: p }));
    requestAnimationFrame(() => gridRef.current?.querySelector(`[data-a="${addr(p.c, p.r)}"]`)?.scrollIntoView({ block: 'nearest', inline: 'nearest' }));
  };
  const startEdit = (value, from = 'cell') => { editing.current = true; setEdit({ value, from }); requestAnimationFrame(() => { const el = from === 'bar' ? barRef.current : inRef.current; if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length); } }); };
  const commit = (move = [0, 1]) => {
    if (!edit) return;
    const v = edit.value;
    editing.current = false;
    setEdit(null);
    if (v !== raw(curAddr)) setCells({ [curAddr]: v });
    if (move) go(cur.c + move[0], cur.r + move[1]);
    requestAnimationFrame(() => gridRef.current?.focus({ preventScroll: true }));
  };
  const cancel = () => { editing.current = false; setEdit(null); gridRef.current?.focus({ preventScroll: true }); };

  /* ---- copy and paste (tab-separated, like Excel and Google Sheets) ---- */
  const copyText = () => {
    const out = [];
    for (let r = box.r0; r <= box.r1; r++) { const row = []; for (let c = box.c0; c <= box.c1; c++) row.push(display(val(addr(c, r)))); out.push(row.join('\t')); }
    return out.join('\n');
  };
  const onCopy = (e, cut) => {
    if (edit) return;
    e.preventDefault();
    const text = copyText(), raws = [];
    for (let r = box.r0; r <= box.r1; r++) { const row = []; for (let c = box.c0; c <= box.c1; c++) row.push(raw(addr(c, r))); raws.push(row); }
    clip.current = { text, raws, c0: box.c0, r0: box.r0 };
    e.clipboardData.setData('text/plain', text);
    if (cut) clearBox();
  };
  const onPaste = e => {
    if (edit) return;
    e.preventDefault();
    const text = e.clipboardData.getData('text/plain');
    const mine = clip.current && clip.current.text === text ? clip.current : null;
    const grid = mine ? mine.raws : text.replace(/\r?\n$/, '').split(/\r?\n/).map(l => l.split('\t'));
    const map = {};
    // One copied cell fills the whole selection.
    const one = grid.length === 1 && grid[0].length === 1;
    const rr = one ? box.r1 - box.r0 + 1 : grid.length, cc = one ? box.c1 - box.c0 + 1 : Math.max(...grid.map(g => g.length));
    for (let y = 0; y < rr; y++) for (let x = 0; x < cc; x++) {
      const v = one ? grid[0][0] : grid[y][x];
      if (v === undefined) continue;
      const c = box.c0 + x, r = box.r0 + y;
      map[addr(c, r)] = mine ? shiftFormula(v, c - (mine.c0 + (one ? 0 : x)), r - (mine.r0 + (one ? 0 : y))) : v;
    }
    setCells(map);
    setSel({ a: { c: box.c0, r: box.r0 }, b: { c: box.c0 + cc - 1, r: box.r0 + rr - 1 } });
  };
  const clearBox = () => { const { box } = live(); const map = {}; for (let r = box.r0; r <= box.r1; r++) for (let c = box.c0; c <= box.c1; c++) map[addr(c, r)] = ''; setCells(map); };
  // Ctrl D / Ctrl R: copy the top row (left column) of the selection down (right), shifting formulas.
  const fill = down => {
    const map = {};
    for (let r = box.r0; r <= box.r1; r++) for (let c = box.c0; c <= box.c1; c++) {
      const src = down ? addr(c, box.r0) : addr(box.c0, r);
      if ((down && r === box.r0) || (!down && c === box.c0)) continue;
      map[addr(c, r)] = shiftFormula(raw(src), down ? 0 : c - box.c0, down ? r - box.r0 : 0);
    }
    setCells(map);
  };

  const onKey = e => {
    // Keys typed before the cell's editor has taken focus still go into it.
    if (editing.current && !edit) {
      if (e.key.length === 1 && !e.ctrlKey && !e.metaKey) { e.preventDefault(); setEdit(x => (x ? { ...x, value: x.value + e.key } : x)); }
      return;
    }
    if (edit) return;
    const mod = e.ctrlKey || e.metaKey, k = e.key;
    const moves = { ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0] };
    if (moves[k]) {
      e.preventDefault();
      let [dc, dr] = moves[k];
      if (mod) { dc *= cols; dr *= rows; }
      go(cur.c + dc, cur.r + dr, e.shiftKey);
    } else if (k === 'Tab') { e.preventDefault(); go(cur.c + (e.shiftKey ? -1 : 1), cur.r); }
    else if (k === 'Enter') { e.preventDefault(); if (e.shiftKey) go(cur.c, cur.r - 1); else startEdit(raw(curAddr)); }
    else if (k === 'F2') { e.preventDefault(); startEdit(raw(curAddr)); }
    else if (k === 'Delete' || k === 'Backspace') { e.preventDefault(); clearBox(); }
    else if (k === 'Home') { e.preventDefault(); go(0, mod ? 0 : cur.r, e.shiftKey); }
    else if (k === 'PageDown' || k === 'PageUp') { e.preventDefault(); go(cur.c, cur.r + (k === 'PageDown' ? 15 : -15), e.shiftKey); }
    else if (mod && k.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? restore(redo, undo) : restore(undo, redo); }
    else if (mod && k.toLowerCase() === 'y') { e.preventDefault(); restore(redo, undo); }
    else if (mod && k.toLowerCase() === 'a') { e.preventDefault(); setSel({ a: { c: 0, r: 0 }, b: { c: cols - 1, r: rows - 1 } }); }
    else if (mod && k.toLowerCase() === 'b') { e.preventDefault(); setFmt({ b: !fmt(curAddr).b }); }
    else if (mod && k.toLowerCase() === 'd') { e.preventDefault(); fill(true); }
    else if (mod && k.toLowerCase() === 'r') { e.preventDefault(); fill(false); }
    else if (!mod && !e.altKey && k.length === 1) { e.preventDefault(); startEdit(k); }
  };
  const editKey = e => {
    if (e.key === 'Enter' && !e.altKey) { e.preventDefault(); commit([0, e.shiftKey ? -1 : 1]); }
    else if (e.key === 'Tab') { e.preventDefault(); commit([e.shiftKey ? -1 : 1, 0]); }
    else if (e.key === 'Escape') { e.preventDefault(); cancel(); }
  };

  // Mouse: click to select, drag or Shift-click to extend, double-click to edit.
  const cellDown = (e, c, r) => {
    if (e.button !== 0) return;
    if (edit) commit(null);
    if (edit && edit.value.startsWith('=') && edit.from === 'bar') return; // clicking while writing a formula
    e.preventDefault();
    gridRef.current?.focus({ preventScroll: true });
    setSel(s => (e.shiftKey ? { a: s.a, b: { c, r } } : { a: { c, r }, b: { c, r } }));
    dragging.current = true;
    const up = () => { dragging.current = false; removeEventListener('pointerup', up); };
    addEventListener('pointerup', up);
  };
  const cellEnter = (c, r) => { if (dragging.current) setSel(s => ({ a: s.a, b: { c, r } })); };
  const headDown = (e, c, r) => {
    e.preventDefault();
    gridRef.current?.focus({ preventScroll: true });
    if (c != null) setSel(s => ({ a: e.shiftKey ? s.a : { c, r: 0 }, b: { c, r: rows - 1 } }));
    else setSel(s => ({ a: e.shiftKey ? s.a : { c: 0, r }, b: { c: cols - 1, r } }));
  };
  const resizeCol = (e, c) => {
    e.preventDefault(); e.stopPropagation();
    const x0 = e.clientX, w0 = width(c), name = colName(c);
    const move = ev => mutSheet(s => { s.widths = { ...(s.widths || {}), [name]: Math.max(40, Math.min(600, Math.round(w0 + ev.clientX - x0))) }; });
    const up = () => { removeEventListener('pointermove', move); removeEventListener('pointerup', up); };
    addEventListener('pointermove', move); addEventListener('pointerup', up);
  };

  /* ---- rows, columns, sheets ---- */
  const insert = (rowsNotCols, before) => change(s => {
    const { box } = live();
    const at = rowsNotCols ? (before ? box.r0 : box.r1 + 1) : (before ? box.c0 : box.c1 + 1);
    const n = rowsNotCols ? box.r1 - box.r0 + 1 : box.c1 - box.c0 + 1;
    s.cells = moveCells(s.cells, rowsNotCols, at, n);
    if (s.fmt) s.fmt = moveCells(s.fmt, rowsNotCols, at, n, true);
    if (rowsNotCols) s.rows = (s.rows || 40) + n; else s.cols = (s.cols || 12) + n;
  });
  const remove = rowsNotCols => change(s => {
    const { box } = live();
    const at = rowsNotCols ? box.r0 : box.c0, n = rowsNotCols ? box.r1 - box.r0 + 1 : box.c1 - box.c0 + 1;
    s.cells = moveCells(s.cells, rowsNotCols, at + n, -n, false, at);
    if (s.fmt) s.fmt = moveCells(s.fmt, rowsNotCols, at + n, -n, true, at);
  });
  const sortBy = desc => change(s => {
    const { box, cur } = live();
    const c = cur.c, r0 = box.r0 === box.r1 ? 1 : box.r0, r1 = box.r0 === box.r1 ? Math.max(0, ...Object.keys(s.cells).map(a => parseAddr(a)?.r ?? 0)) : box.r1;
    const c0 = box.c0 === box.c1 ? 0 : box.c0, c1 = box.c0 === box.c1 ? Math.max(0, ...Object.keys(s.cells).map(a => parseAddr(a)?.c ?? 0)) : box.c1;
    const v = evaluate(s), list = [];
    for (let r = r0; r <= r1; r++) list.push({ r, key: v(addr(c, r)), row: Array.from({ length: c1 - c0 + 1 }, (_, i) => s.cells[addr(c0 + i, r)]) });
    list.sort((x, y) => { const a = x.key, b = y.key; if (a === '' && b !== '') return 1; if (b === '' && a !== '') return -1; const d = typeof a === 'number' && typeof b === 'number' ? a - b : String(a).localeCompare(String(b), undefined, { numeric: true }); return desc ? -d : d; });
    const next = { ...s.cells };
    list.forEach((it, i) => it.row.forEach((x, j) => { const a = addr(c0 + j, r0 + i); if (x == null) delete next[a]; else next[a] = shiftFormula(x, 0, r0 + i - it.r); }));
    s.cells = next;
  });
  const cellMenu = (e, c, r) => {
    e.preventDefault();
    if (!inBox(c, r)) { selRef.current = { a: { c, r }, b: { c, r } }; setSel(selRef.current); }
    const anchor = { getBoundingClientRect: () => ({ left: e.clientX, right: e.clientX, top: e.clientY, bottom: e.clientY, width: 0, height: 0 }), contains: () => false };
    popup(anchor, [
      { label: 'Insert row above', act: () => insert(true, true) },
      { label: 'Insert row below', act: () => insert(true, false) },
      { label: 'Insert column left', act: () => insert(false, true) },
      { label: 'Insert column right', act: () => insert(false, false) },
      '-',
      { label: 'Delete rows', danger: true, act: () => remove(true) },
      { label: 'Delete columns', danger: true, act: () => remove(false) },
      '-',
      { label: 'Sort A → Z', note: `By column ${colName(live().cur.c)}`, act: () => sortBy(false) },
      { label: 'Sort Z → A', note: `By column ${colName(live().cur.c)}`, act: () => sortBy(true) },
      '-',
      { label: 'Clear', kbd: 'Del', act: clearBox },
    ]);
  };

  const addSheet = () => update(c => { const s = newSheet(`Sheet ${(c.sheets || []).length + 1}`); c.sheets = [...(c.sheets || []), s]; c.activeSheet = s.id; });
  const sheetMenu = (btn, s) => popup(btn, [
    { label: 'Rename', act: async () => { const v = await ask({ title: 'Rename sheet', value: s.name, ok: 'Rename' }); if (v && v.trim()) update(c => { c.sheets.find(x => x.id === s.id).name = v.trim().slice(0, 40); }); } },
    { label: 'Duplicate', act: () => update(c => { const x = JSON.parse(JSON.stringify(s)); x.id = newSheet().id; x.name = s.name + ' copy'; c.sheets.push(x); c.activeSheet = x.id; }) },
    { label: 'Show on the canvas', act: () => onAddToCanvas(s.id) },
    '-',
    { label: 'Delete', danger: true, act: async () => {
      if (!(await ask({ title: `Delete “${s.name}”?`, text: 'Its cells are removed for good, and canvas blocks that show it go blank.', input: false, ok: 'Delete' }))) return;
      update(c => { c.sheets = c.sheets.filter(x => x.id !== s.id); if (c.activeSheet === s.id) c.activeSheet = c.sheets[0]?.id; });
    } },
  ]);
  async function importCSV(f, asNew) {
    if (!f) return;
    const text = await f.text().catch(() => null);
    if (text == null) return;
    const parsed = fromCSV(text);
    if (asNew || !active) update(c => { const s = Object.assign(newSheet(f.name.replace(/\.\w+$/, '').slice(0, 40) || 'Imported'), parsed); c.sheets = [...(c.sheets || []), s]; c.activeSheet = s.id; });
    else change(s => { Object.assign(s, parsed); }, `Imported ${f.name}`);
    if (fileRef.current) fileRef.current.value = '';
  }
  const exportCSV = () => downloads.save({ filename: (active.name || 'sheet').replace(/[^\w.-]+/g, '-') + '.csv', data: new Blob([toCSV(active)], { type: 'text/csv' }) });

  // Sum, average and count of the selected numbers, like Excel's status bar.
  const stats = (() => {
    if (box.c0 === box.c1 && box.r0 === box.r1) return null;
    let n = 0, sum = 0, count = 0;
    for (let r = box.r0; r <= box.r1; r++) for (let c = box.c0; c <= box.c1; c++) {
      const v = val(addr(c, r));
      if (v !== '' && v != null) count++;
      if (typeof v === 'number') { n++; sum += v; }
    }
    return { n, sum, count };
  })();
  const f0 = fmt(curAddr);
  const barValue = edit ? edit.value : raw(curAddr);
  const hint = edit && edit.value.startsWith('=') ? (() => {
    const m = /([A-Za-z]+)\($/.exec(edit.value) || /([A-Za-z]{2,})$/.exec(edit.value);
    const q = m && m[1].toUpperCase();
    return q ? FUNCTIONS.filter(f => f.startsWith(q)).slice(0, 6) : [];
  })() : [];

  return (
    <div className="sv" onCopy={e => onCopy(e)} onCut={e => onCopy(e, true)} onPaste={onPaste}>
      <div className="sv-tools" role="toolbar" aria-label="Sheet">
        <button className={'sv-tb' + (f0.b ? ' on' : '')} aria-pressed={!!f0.b} title="Bold  Ctrl B" onClick={() => setFmt({ b: !f0.b })}><b>B</b></button>
        <div className="seg" role="group" aria-label="Align">
          {[['left', 'M4 6h16M4 12h10M4 18h14'], ['center', 'M4 6h16M7 12h10M5 18h14'], ['right', 'M4 6h16M10 12h10M6 18h14']].map(([k, d]) => (
            <button key={k} aria-pressed={f0.al === k} aria-label={`Align ${k}`} onClick={() => setFmt({ al: f0.al === k ? null : k })}><svg viewBox="0 0 24 24"><path d={d} /></svg></button>
          ))}
        </div>
        <select aria-label="Number format" value={f0.nf || ''} onChange={e => setFmt({ nf: e.target.value || null })}>
          {FORMATS.map(([k, n]) => <option key={k} value={k}>{n}</option>)}
        </select>
        <button className="btn" onClick={e => popup(e.currentTarget, [
          { label: 'Insert row above', act: () => insert(true, true) }, { label: 'Insert row below', act: () => insert(true, false) },
          { label: 'Insert column left', act: () => insert(false, true) }, { label: 'Insert column right', act: () => insert(false, false) },
          '-', { label: 'Delete rows', danger: true, act: () => remove(true) }, { label: 'Delete columns', danger: true, act: () => remove(false) },
          '-', { label: `Sort A → Z by ${colName(cur.c)}`, act: () => sortBy(false) }, { label: `Sort Z → A by ${colName(cur.c)}`, act: () => sortBy(true) },
        ])} aria-haspopup="menu">Rows &amp; columns ▾</button>
        <span className="grow" />
        <button className="btn" onClick={() => fileRef.current?.click()}>Import CSV</button>
        <button className="btn" onClick={exportCSV}>Export CSV</button>
        <button className="btn dark" onClick={() => onAddToCanvas(active.id)} title="Show this sheet on the canvas, beside the diagram">Show on canvas</button>
        <input ref={fileRef} type="file" accept=".csv,.tsv,text/csv,text/plain" hidden onChange={e => importCSV(e.target.files[0], false)} />
      </div>
      <div className="sv-bar">
        <span className="sv-name" aria-label="Cell">{box.c0 === box.c1 && box.r0 === box.r1 ? curAddr : `${addr(box.c0, box.r0)}:${addr(box.c1, box.r1)}`}</span>
        <span className="sv-fx" aria-hidden="true">fx</span>
        <input ref={barRef} className="sv-formula" aria-label="Cell contents" value={barValue} spellCheck="false"
          onFocus={() => { if (!edit) setEdit({ value: raw(curAddr), from: 'bar' }); }}
          onChange={e => setEdit({ value: e.target.value, from: 'bar' })} onKeyDown={editKey}
          onBlur={() => { if (edit && edit.from === 'bar') commit(null); }} />
        {hint.length > 0 && <span className="sv-hint">{hint.join('  ·  ')}</span>}
      </div>
      <div className="sv-grid" ref={gridRef} tabIndex={0} role="grid" aria-label={active.name} aria-rowcount={rows} aria-colcount={cols} onKeyDown={onKey}>
        <table style={{ width: HEAD_W + Array.from({ length: cols }, (_, c) => width(c)).reduce((a, b) => a + b, 0) }}>
          <colgroup><col style={{ width: HEAD_W }} />{Array.from({ length: cols }, (_, c) => <col key={c} style={{ width: width(c) }} />)}</colgroup>
          <thead>
            <tr>
              <th className="sv-corner" onPointerDown={e => { e.preventDefault(); setSel({ a: { c: 0, r: 0 }, b: { c: cols - 1, r: rows - 1 } }); }} />
              {Array.from({ length: cols }, (_, c) => (
                <th key={c} className={c >= box.c0 && c <= box.c1 ? 'on' : ''} onPointerDown={e => headDown(e, c, null)}>
                  {colName(c)}<i className="sv-rs" onPointerDown={e => resizeCol(e, c)} aria-hidden="true" />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: rows }, (_, r) => (
              <tr key={r} style={{ height: ROW_H }}>
                <th className={r >= box.r0 && r <= box.r1 ? 'on' : ''} onPointerDown={e => headDown(e, null, r)}>{r + 1}</th>
                {Array.from({ length: cols }, (_, c) => {
                  const a = addr(c, r), v = val(a), f = fmt(a), isCur = c === cur.c && r === cur.r;
                  const right = f.al ? f.al === 'right' : typeof v === 'number';
                  return (
                    <td key={c} data-a={a} role="gridcell" aria-selected={inBox(c, r)}
                      className={(inBox(c, r) ? 'sel' : '') + (isCur ? ' cur' : '') + (isErr(v) ? ' err' : '')}
                      style={{ textAlign: f.al || (right ? 'right' : 'left'), fontWeight: f.b ? 700 : undefined }}
                      onPointerDown={e => cellDown(e, c, r)} onPointerEnter={() => cellEnter(c, r)}
                      onDoubleClick={() => startEdit(raw(a))} onContextMenu={e => cellMenu(e, c, r)}>
                      {isCur && edit && edit.from === 'cell'
                        ? <input ref={inRef} autoFocus className="sv-in" aria-label={`Edit ${a}`} value={edit.value} spellCheck="false"
                            onChange={e => setEdit({ value: e.target.value, from: 'cell' })} onKeyDown={editKey} onBlur={() => commit(null)} />
                        : formatValue(v, f.nf)}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
        <div className="sv-more">
          <button className="btn" onClick={() => mutSheet(s => { s.rows = (s.rows || 40) + 20; })}>+ 20 rows</button>
          <button className="btn" onClick={() => mutSheet(s => { s.cols = (s.cols || 12) + 4; })}>+ 4 columns</button>
        </div>
      </div>
      <div className="sv-foot">
        <div className="sv-tabs" role="tablist" aria-label="Sheets">
          {sheets.map(s => (
            <button key={s.id} role="tab" aria-selected={s.id === active.id} className={'sv-tab' + (s.id === active.id ? ' on' : '')}
              onClick={() => update(c => { c.activeSheet = s.id; })} onContextMenu={e => { e.preventDefault(); sheetMenu(e.currentTarget, s); }}
              onDoubleClick={e => sheetMenu(e.currentTarget, s)}>
              {s.name}{s.id === active.id && <span className="tm" role="button" tabIndex={0} aria-label="Sheet actions" onClick={e => { e.stopPropagation(); sheetMenu(e.currentTarget, s); }}>⋯</span>}
            </button>
          ))}
          <button className="addtab" onClick={addSheet} aria-label="Add a sheet">+ Sheet</button>
        </div>
        <span className="grow" />
        {stats && <span className="sv-stats" aria-live="polite">{stats.n ? `Sum ${stats.sum.toLocaleString(undefined, { maximumFractionDigits: 4 })} · Average ${(stats.sum / stats.n).toLocaleString(undefined, { maximumFractionDigits: 4 })} · ` : ''}Count {stats.count}</span>}
      </div>
    </div>
  );
}

// Shift cells (or formats) at and after row/column `at` by n; with n < 0, `gone` and up to `at` are removed.
// Formulas follow: references past the edge move too.
function moveCells(map, rowsNotCols, at, n, isFmt, gone) {
  const out = {};
  for (const [a, v] of Object.entries(map)) {
    const p = parseAddr(a);
    if (!p) continue;
    const k = rowsNotCols ? p.r : p.c;
    if (n < 0 && k >= gone && k < at) continue;
    const moved = k >= at ? (rowsNotCols ? addr(p.c, p.r + n) : addr(p.c + n, p.r)) : a;
    out[moved] = isFmt ? v : moveRefs(v, rowsNotCols, at, n);
  }
  return out;
}
function moveRefs(raw, rowsNotCols, at, n) {
  if (typeof raw !== 'string' || raw[0] !== '=') return raw;
  return '=' + raw.slice(1).replace(/("(?:[^"]|"")*")|(\$?)([A-Za-z]{1,3})(\$?)(\d{1,6})(?![\w(])/g, (m, s, d1, c, d2, r) => {
    if (s) return s;
    const p = parseAddr(c + r);
    if (!p) return m;
    const k = rowsNotCols ? p.r : p.c;
    if (k < at) return m;
    const np = rowsNotCols ? { c: p.c, r: p.r + n } : { c: p.c + n, r: p.r };
    if (np.r < 0 || np.c < 0) return '#REF!';
    return d1 + colName(np.c) + d2 + (np.r + 1);
  });
}
