/* Spreadsheets: cell addresses, and a small formula language like Excel's.
   A sheet is {id, name, cells: {A1: '12', B1: '=A1*2', …}, cols, rows, widths: {A: 140}}.
   Formulas start with "=": numbers, "text", cell references (A1, $A$1), ranges (A1:B5),
   + - * / ^ & = <> < > <= >=, and functions such as SUM, AVERAGE, IF, ROUND, VLOOKUP.
   evaluate() works out every cell, with errors (#DIV/0!, #REF!, #NAME?, #VALUE!, #CYCLE!) shown in place. */

import { rid } from './utils.js';

export const colName = i => { let s = ''; i++; while (i > 0) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; };
export const colIndex = s => [...s.toUpperCase()].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;
export const addr = (c, r) => colName(c) + (r + 1);
export function parseAddr(a) {
  const m = /^\$?([A-Za-z]{1,3})\$?(\d{1,6})$/.exec(String(a).trim());
  return m ? { c: colIndex(m[1]), r: Number(m[2]) - 1 } : null;
}

export function newSheet(name = 'Sheet 1', cells = {}) {
  return { id: rid('sh'), name, cells, cols: 12, rows: 40, widths: {} };
}
export const SAMPLE = () => newSheet('Budget', {
  A1: 'Item', B1: 'Qty', C1: 'Price', D1: 'Total',
  A2: 'Servers', B2: '4', C2: '120', D2: '=B2*C2',
  A3: 'Storage (TB)', B3: '10', C3: '23', D3: '=B3*C3',
  A4: 'CDN', B4: '1', C4: '200', D4: '=B4*C4',
  A5: 'Monitoring', B5: '1', C5: '49', D5: '=B5*C5',
  A6: 'Total', D6: '=SUM(D2:D5)',
});

/* ---- values ---- */
class Err { constructor(code) { this.code = code; } toString() { return this.code; } }
export const isErr = v => v instanceof Err;
const E = { div: new Err('#DIV/0!'), ref: new Err('#REF!'), name: new Err('#NAME?'), value: new Err('#VALUE!'), cycle: new Err('#CYCLE!'), na: new Err('#N/A'), parse: new Err('#ERROR!') };

const NUM = /^\s*[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?\s*%?\s*$/i;
// What a typed (non-formula) cell holds: a number when it looks like one (12, 3.5, 1e3, 20%, 1,200), else text.
export function literal(raw) {
  if (raw == null || raw === '') return '';
  const s = String(raw), t = s.replace(/,(?=\d{3}\b)/g, '');
  if (NUM.test(t)) { const n = parseFloat(t); return t.trim().endsWith('%') ? n / 100 : n; }
  if (/^(true|false)$/i.test(s.trim())) return s.trim().toUpperCase() === 'TRUE';
  return s;
}
const num = v => {
  if (isErr(v)) throw v;
  if (typeof v === 'number') return v;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (v === '' || v == null) return 0;
  const l = literal(v);
  if (typeof l === 'number') return l;
  throw E.value;
};
const str = v => { if (isErr(v)) throw v; return v === true ? 'TRUE' : v === false ? 'FALSE' : typeof v === 'number' ? fmtNum(v) : String(v ?? ''); };
const truthy = v => (typeof v === 'string' ? v !== '' && v.toUpperCase() !== 'FALSE' : !!num(v));

export function fmtNum(n) {
  if (!isFinite(n)) return E.div.code;
  if (Number.isInteger(n)) return String(n);
  return String(+n.toPrecision(12));
}
// How a value shows in a cell.
export function display(v) {
  if (isErr(v)) return v.code;
  if (typeof v === 'number') return fmtNum(v);
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
  return v == null ? '' : String(v);
}

// A value shown with a cell's number format: '0', '0.00', '%', a currency sign, or 'text'.
export function formatValue(v, nf) {
  if (typeof v !== 'number' || !nf || nf === 'text') return display(v);
  if (nf === '%') return (v * 100).toLocaleString(undefined, { maximumFractionDigits: 2 }) + '%';
  if (nf === '0') return Math.round(v).toLocaleString();
  if (nf === '0.00') return v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return (v < 0 ? '-' : '') + nf + Math.abs(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/* ---- the file's sheets, for drawing them on the canvas (set by the editor) ---- */
let SHEETS = new Map();
export const setSheets = list => { SHEETS = new Map((list || []).map(s => [s.id, s])); };
export const sheetById = id => SHEETS.get(id) || null;

/* ---- formulas: tokens → tree ---- */
function tokenize(src) {
  const out = [];
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (/\s/.test(ch)) { i++; continue; }
    if (ch === '"') {
      let j = i + 1, s = '';
      while (j < src.length) { if (src[j] === '"') { if (src[j + 1] === '"') { s += '"'; j += 2; continue; } break; } s += src[j++]; }
      if (j >= src.length) throw E.parse;
      out.push({ t: 'str', v: s }); i = j + 1; continue;
    }
    const m = /^(\d+\.?\d*|\.\d+)(e[-+]?\d+)?/i.exec(src.slice(i));
    if (m) { out.push({ t: 'num', v: parseFloat(m[0]) }); i += m[0].length; continue; }
    const r = /^\$?[A-Za-z]{1,3}\$?\d{1,6}(:\$?[A-Za-z]{1,3}\$?\d{1,6})?(?![\w(])/.exec(src.slice(i));
    if (r) { out.push({ t: 'ref', v: r[0].replace(/\$/g, '').toUpperCase() }); i += r[0].length; continue; }
    const w = /^[A-Za-z_][\w.]*/.exec(src.slice(i));
    if (w) { out.push({ t: 'name', v: w[0].toUpperCase() }); i += w[0].length; continue; }
    const op = /^(<>|<=|>=|[-+*/^&=<>(),:%])/.exec(src.slice(i));
    if (op) { out.push({ t: 'op', v: op[0] }); i += op[0].length; continue; }
    throw E.parse;
  }
  return out;
}

// Precedence, low to high: comparison, &, + -, * /, ^, unary -, %.
function parse(src) {
  const toks = tokenize(src);
  let p = 0;
  const peek = () => toks[p], next = () => toks[p++];
  const isOp = (...v) => peek() && peek().t === 'op' && v.includes(peek().v);
  const bin = (sub, ...ops) => () => { let l = sub(); while (isOp(...ops)) { const o = next().v; l = { k: 'bin', o, l, r: sub() }; } return l; };
  const atom = () => {
    const t = next();
    if (!t) throw E.parse;
    if (t.t === 'num') return { k: 'num', v: t.v };
    if (t.t === 'str') return { k: 'str', v: t.v };
    if (t.t === 'ref') return t.v.includes(':') ? { k: 'range', v: t.v } : { k: 'ref', v: t.v };
    if (t.t === 'name') {
      if (isOp('(')) {
        next();
        const args = [];
        if (!isOp(')')) { do { args.push(cmp()); } while (isOp(',') && next()); }
        if (!isOp(')')) throw E.parse;
        next();
        return { k: 'call', f: t.v, args };
      }
      if (t.v === 'TRUE' || t.v === 'FALSE') return { k: 'bool', v: t.v === 'TRUE' };
      return { k: 'name', v: t.v };
    }
    if (t.t === 'op' && t.v === '(') { const e = cmp(); if (!isOp(')')) throw E.parse; next(); return e; }
    if (t.t === 'op' && (t.v === '-' || t.v === '+')) { const e = pow(); return t.v === '-' ? { k: 'neg', e } : e; }
    throw E.parse;
  };
  const pct = () => { let e = atom(); while (isOp('%')) { next(); e = { k: 'bin', o: '/', l: e, r: { k: 'num', v: 100 } }; } return e; };
  const pow = bin(pct, '^');
  const mul = bin(pow, '*', '/');
  const add = bin(mul, '+', '-');
  const cat = bin(add, '&');
  const cmp = bin(cat, '=', '<>', '<', '>', '<=', '>=');
  const tree = cmp();
  if (p < toks.length) throw E.parse;
  return tree;
}

/* ---- functions ---- */
const flat = args => args.flatMap(a => (Array.isArray(a) ? a.flat() : [a]));
const nums = args => flat(args).filter(v => { if (isErr(v)) throw v; return typeof v === 'number'; });
const FN = {
  SUM: a => nums(a).reduce((s, x) => s + x, 0),
  AVERAGE: a => { const n = nums(a); if (!n.length) throw E.div; return n.reduce((s, x) => s + x, 0) / n.length; },
  AVG: a => FN.AVERAGE(a),
  MIN: a => { const n = nums(a); return n.length ? Math.min(...n) : 0; },
  MAX: a => { const n = nums(a); return n.length ? Math.max(...n) : 0; },
  COUNT: a => nums(a).length,
  COUNTA: a => flat(a).filter(v => v !== '' && v != null).length,
  COUNTBLANK: a => flat(a).filter(v => v === '' || v == null).length,
  PRODUCT: a => nums(a).reduce((s, x) => s * x, 1),
  MEDIAN: a => { const n = nums(a).sort((x, y) => x - y); if (!n.length) throw E.value; const m = n.length >> 1; return n.length % 2 ? n[m] : (n[m - 1] + n[m]) / 2; },
  ABS: ([x]) => Math.abs(num(x)),
  SQRT: ([x]) => { const n = num(x); if (n < 0) throw E.value; return Math.sqrt(n); },
  POWER: ([x, y]) => Math.pow(num(x), num(y)),
  MOD: ([x, y]) => { const d = num(y); if (!d) throw E.div; const r = num(x) % d; return r && Math.sign(r) !== Math.sign(d) ? r + d : r; },
  ROUND: ([x, d]) => { const k = 10 ** num(d ?? 0); return Math.round(num(x) * k) / k; },
  ROUNDUP: ([x, d]) => { const k = 10 ** num(d ?? 0), n = num(x); return Math.sign(n) * Math.ceil(Math.abs(n) * k) / k; },
  ROUNDDOWN: ([x, d]) => { const k = 10 ** num(d ?? 0), n = num(x); return Math.sign(n) * Math.floor(Math.abs(n) * k) / k; },
  INT: ([x]) => Math.floor(num(x)),
  IF: ([c, a, b]) => (truthy(c) ? a ?? true : b ?? false),
  IFERROR: ([a, b]) => (isErr(a) ? b : a),
  AND: a => flat(a).every(truthy),
  OR: a => flat(a).some(truthy),
  NOT: ([x]) => !truthy(x),
  CONCAT: a => flat(a).map(str).join(''),
  CONCATENATE: a => FN.CONCAT(a),
  LEN: ([x]) => str(x).length,
  UPPER: ([x]) => str(x).toUpperCase(),
  LOWER: ([x]) => str(x).toLowerCase(),
  TRIM: ([x]) => str(x).trim().replace(/\s+/g, ' '),
  LEFT: ([x, n]) => str(x).slice(0, num(n ?? 1)),
  RIGHT: ([x, n]) => { const s = str(x), k = num(n ?? 1); return k ? s.slice(-k) : ''; },
  MID: ([x, s, n]) => str(x).substr(num(s) - 1, num(n)),
  SUMIF: ([range, crit, sumRange]) => { const r = flat([range]), s = sumRange ? flat([sumRange]) : r, test = criterion(crit); return r.reduce((t, v, i) => (test(v) && typeof s[i] === 'number' ? t + s[i] : t), 0); },
  COUNTIF: ([range, crit]) => { const test = criterion(crit); return flat([range]).filter(test).length; },
  AVERAGEIF: ([range, crit, avgRange]) => { const r = flat([range]), s = avgRange ? flat([avgRange]) : r, test = criterion(crit); const v = r.map((x, i) => (test(x) && typeof s[i] === 'number' ? s[i] : null)).filter(x => x != null); if (!v.length) throw E.div; return v.reduce((a, b) => a + b, 0) / v.length; },
  VLOOKUP: ([key, table, col, approx]) => {
    if (!Array.isArray(table)) throw E.value;
    const c = num(col) - 1;
    if (c < 0 || c >= (table[0] || []).length) throw E.ref;
    const exact = approx === false || (approx !== undefined && !truthy(approx));
    const k = typeof key === 'string' ? key.toLowerCase() : key;
    if (exact) { const row = table.find(r => (typeof r[0] === 'string' ? r[0].toLowerCase() : r[0]) === k); if (!row) throw E.na; return row[c]; }
    let hit = null;
    for (const r of table) { if (typeof r[0] === typeof key && r[0] <= key) hit = r; else if (hit) break; }
    if (!hit) throw E.na;
    return hit[c];
  },
  PI: () => Math.PI,
  TODAY: () => new Date().toISOString().slice(0, 10),
  NOW: () => new Date().toISOString().slice(0, 16).replace('T', ' '),
};
// "=5", ">10", "<>x", or a plain value.
function criterion(c) {
  const m = typeof c === 'string' && /^(<>|<=|>=|=|<|>)(.*)$/.exec(c);
  const op = m ? m[1] : '=', rhs = m ? literal(m[2]) : c;
  return v => {
    if (isErr(v)) return false;
    const a = typeof rhs === 'number' ? (typeof v === 'number' ? v : NaN) : String(v ?? '').toLowerCase();
    const b = typeof rhs === 'number' ? rhs : String(rhs ?? '').toLowerCase();
    return op === '=' ? a === b : op === '<>' ? a !== b : op === '<' ? a < b : op === '>' ? a > b : op === '<=' ? a <= b : a >= b;
  };
}
export const FUNCTIONS = Object.keys(FN).sort();

/* ---- evaluation ---- */
export function evaluate(sheet) {
  const cells = sheet.cells || {}, vals = new Map(), busy = new Set(), trees = new Map();
  const cell = a => {
    if (vals.has(a)) return vals.get(a);
    const raw = cells[a];
    if (raw == null || raw === '' || String(raw)[0] !== '=') { const v = literal(raw); vals.set(a, v); return v; }
    if (busy.has(a)) throw E.cycle;
    busy.add(a);
    let v;
    try {
      let t = trees.get(a);
      if (!t) { t = parse(String(raw).slice(1)); trees.set(a, t); }
      v = ev(t);
      if (Array.isArray(v)) v = v[0]?.[0] ?? '';
      if (typeof v === 'number' && !isFinite(v)) v = E.div;
    } catch (e) { v = isErr(e) ? e : E.value; }
    busy.delete(a);
    vals.set(a, v);
    return v;
  };
  const get = cell;
  const range = r => {
    const [a, b] = r.split(':').map(parseAddr);
    if (!a || !b) throw E.ref;
    const out = [];
    for (let y = Math.min(a.r, b.r); y <= Math.max(a.r, b.r); y++) {
      const row = [];
      for (let x = Math.min(a.c, b.c); x <= Math.max(a.c, b.c); x++) row.push(get(addr(x, y)));
      out.push(row);
    }
    return out;
  };
  const ev = t => {
    switch (t.k) {
      case 'num': case 'str': case 'bool': return t.v;
      case 'ref': return get(t.v);
      case 'range': return range(t.v);
      case 'name': throw E.name;
      case 'neg': return -num(ev(t.e));
      case 'call': {
        const f = FN[t.f];
        if (!f) throw E.name;
        // IF and IFERROR only work out the branch they need.
        if (t.f === 'IF') return truthy(scalar(ev(t.args[0]))) ? (t.args[1] ? scalar(ev(t.args[1])) : true) : (t.args[2] ? scalar(ev(t.args[2])) : false);
        if (t.f === 'IFERROR') { let v; try { v = scalar(ev(t.args[0])); } catch (e) { if (!isErr(e) || e === E.cycle) throw e; v = e; } return isErr(v) ? scalar(ev(t.args[1])) : v; }
        return f(t.args.map(ev));
      }
      case 'bin': {
        const l = scalar(ev(t.l)), r = scalar(ev(t.r));
        if (isErr(l)) throw l;
        if (isErr(r)) throw r;
        switch (t.o) {
          case '+': return num(l) + num(r);
          case '-': return num(l) - num(r);
          case '*': return num(l) * num(r);
          case '/': { const d = num(r); if (d === 0) throw E.div; return num(l) / d; }
          case '^': return Math.pow(num(l), num(r));
          case '&': return str(l) + str(r);
          default: {
            const [a, b] = typeof l === 'number' && typeof r === 'number' ? [l, r] : [str(l).toLowerCase(), str(r).toLowerCase()];
            return t.o === '=' ? a === b : t.o === '<>' ? a !== b : t.o === '<' ? a < b : t.o === '>' ? a > b : t.o === '<=' ? a <= b : a >= b;
          }
        }
      }
      default: throw E.parse;
    }
  };
  const scalar = v => (Array.isArray(v) ? (v.length === 1 && v[0].length === 1 ? v[0][0] : (() => { throw E.value; })()) : v);
  Object.keys(cells).forEach(a => { if (parseAddr(a)) cell(a); });
  return a => (vals.has(a) ? vals.get(a) : cell(a));
}

// The rectangle of cells that hold something: {c0, r0, c1, r1}, or null for an empty sheet.
export function usedRange(sheet) {
  let c0 = Infinity, r0 = Infinity, c1 = -1, r1 = -1;
  for (const [a, v] of Object.entries(sheet.cells || {})) {
    if (v === '' || v == null) continue;
    const p = parseAddr(a);
    if (!p) continue;
    c0 = Math.min(c0, p.c); r0 = Math.min(r0, p.r); c1 = Math.max(c1, p.c); r1 = Math.max(r1, p.r);
  }
  return c1 < 0 ? null : { c0, r0, c1, r1 };
}

/* ---- CSV ---- */
export function toCSV(sheet, values = true) {
  const u = usedRange(sheet);
  if (!u) return '';
  const val = values ? evaluate(sheet) : null, rows = [];
  for (let r = 0; r <= u.r1; r++) {
    const row = [];
    for (let c = 0; c <= u.c1; c++) {
      const a = addr(c, r), s = values ? display(val(a)) : String(sheet.cells[a] ?? '');
      row.push(/[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s);
    }
    rows.push(row.join(','));
  }
  return rows.join('\n') + '\n';
}
export function fromCSV(text) {
  const rows = [];
  let row = [], f = '', q = false;
  const t = String(text).replace(/^﻿/, '');
  for (let i = 0; i < t.length; i++) {
    const ch = t[i];
    if (q) { if (ch === '"') { if (t[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += ch; continue; }
    if (ch === '"' && f === '') q = true;
    else if (ch === ',' || ch === '\t') { row.push(f); f = ''; }
    else if (ch === '\n' || ch === '\r') { if (ch === '\r' && t[i + 1] === '\n') i++; row.push(f); rows.push(row); row = []; f = ''; }
    else f += ch;
  }
  if (f !== '' || row.length) { row.push(f); rows.push(row); }
  const cells = {};
  rows.forEach((r, y) => r.forEach((v, x) => { if (v !== '') cells[addr(x, y)] = v; }));
  return { cells, cols: Math.max(12, ...rows.map(r => r.length + 2)), rows: Math.max(40, rows.length + 10) };
}

// Move formulas when a block of cells is copied or filled: relative references shift, $-fixed ones stay.
export function shiftFormula(raw, dc, dr) {
  if (typeof raw !== 'string' || raw[0] !== '=') return raw;
  return '=' + raw.slice(1).replace(/("(?:[^"]|"")*")|(\$?)([A-Za-z]{1,3})(\$?)(\d{1,6})(?![\w(])/g, (m, s, d1, c, d2, r) => {
    if (s) return s;
    const ci = d1 ? colIndex(c) : colIndex(c) + dc, ri = d2 ? Number(r) : Number(r) + dr;
    if (ci < 0 || ri < 1) return '#REF!';
    return d1 + colName(ci) + d2 + ri;
  });
}
