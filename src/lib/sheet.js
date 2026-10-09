/* Spreadsheets, like Excel: cell addresses, number formats, and the formula language.
   A sheet is {id, name, cells: {A1: '12', B1: '=A1*2', …}, fmt: {A1: {b, i, u, s, fs, ff, fc, bg, al, va, wrap, bd, nf, dp}},
   cols, rows, widths: {A: 140}, heights: {3: 40}, merges: [{c0, r0, c1, r1}], freeze: {r, c}, filter, charts}.
   Formulas start with "=": numbers, "text", references (A1, $A$1, A1:B5, Sheet2!A1, 'My sheet'!A1:B2),
   + - * / ^ & % = <> < > <= >=, and Excel's functions (SUM, IF, XLOOKUP, INDEX, MATCH, TEXT, DATE, SUMIFS…).
   Dates are numbers, as in Excel: days since 30 Dec 1899. Errors (#DIV/0!, #REF!, #NAME?, #VALUE!, #N/A,
   #CYCLE!) show in the cell. */

import { rid } from './utils.js';

export const colName = i => { let s = ''; i++; while (i > 0) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; };
export const colIndex = s => [...s.toUpperCase()].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;
export const addr = (c, r) => colName(c) + (r + 1);
export function parseAddr(a) {
  const m = /^\$?([A-Za-z]{1,3})\$?(\d{1,7})$/.exec(String(a).trim());
  return m ? { c: colIndex(m[1]), r: Number(m[2]) - 1 } : null;
}
export function parseRange(s) {
  const [a, b] = String(s).split(':').map(parseAddr);
  if (!a) return null;
  const e = b || a;
  return { c0: Math.min(a.c, e.c), r0: Math.min(a.r, e.r), c1: Math.max(a.c, e.c), r1: Math.max(a.r, e.r) };
}
export const rangeName = b => (b.c0 === b.c1 && b.r0 === b.r1 ? addr(b.c0, b.r0) : `${addr(b.c0, b.r0)}:${addr(b.c1, b.r1)}`);

export function newSheet(name = 'Sheet 1', cells = {}) {
  return { id: rid('sh'), name, cells, fmt: {}, cols: 26, rows: 100, widths: {} };
}
export const SAMPLE = () => Object.assign(newSheet('Budget', {
  A1: 'Item', B1: 'Qty', C1: 'Price', D1: 'Total',
  A2: 'Servers', B2: '4', C2: '120', D2: '=B2*C2',
  A3: 'Storage (TB)', B3: '10', C3: '23', D3: '=B3*C3',
  A4: 'CDN', B4: '1', C4: '200', D4: '=B4*C4',
  A5: 'Monitoring', B5: '1', C5: '49', D5: '=B5*C5',
  A6: 'Total', D6: '=SUM(D2:D5)',
}), { fmt: { A1: { b: 1, bg: '#dbe9e1' }, B1: { b: 1, bg: '#dbe9e1' }, C1: { b: 1, bg: '#dbe9e1' }, D1: { b: 1, bg: '#dbe9e1' }, A6: { b: 1 }, D6: { b: 1, bd: { t: 1, b: 2 } } } });

/* ---- values ---- */
class Err { constructor(code) { this.code = code; } toString() { return this.code; } }
export const isErr = v => v instanceof Err;
const E = { div: new Err('#DIV/0!'), ref: new Err('#REF!'), name: new Err('#NAME?'), value: new Err('#VALUE!'), cycle: new Err('#CYCLE!'), na: new Err('#N/A'), num: new Err('#NUM!'), parse: new Err('#ERROR!') };
export const errOf = code => Object.values(E).find(e => e.code === code) || null;

/* ---- dates: Excel serial numbers (1 = 1 Jan 1900; this ignores Excel's 1900 leap-year bug before March 1900) ---- */
const DAY = 86400000, EPOCH = Date.UTC(1899, 11, 30);
export const toSerial = (y, m, d) => (Date.UTC(y, m - 1, d) - EPOCH) / DAY;
export const fromSerial = n => { const t = new Date(EPOCH + Math.round(n * DAY)); return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate(), wd: t.getUTCDay(), h: t.getUTCHours(), mi: t.getUTCMinutes(), s: t.getUTCSeconds() }; };
const nowSerial = () => { const n = new Date(); return (Date.UTC(n.getFullYear(), n.getMonth(), n.getDate(), n.getHours(), n.getMinutes(), n.getSeconds()) - EPOCH) / DAY; };
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
// A typed date: 2026-10-09, 9/10/2026 (day first unless the first part is over 12… read as month/day like Excel US when ambiguous), 9 Oct 2026.
export function parseDate(s) {
  const t = String(s).trim();
  let m;
  if ((m = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2}):(\d{2}))?$/.exec(t))) return toSerial(+m[1], +m[2], +m[3]) + (m[4] ? (+m[4] * 60 + +m[5]) / 1440 : 0);
  if ((m = /^(\d{1,2})[/.](\d{1,2})[/.](\d{4})$/.exec(t))) { let a = +m[1], b = +m[2]; if (a > 12) [a, b] = [b, a]; if (a > 12 || b > 31) return null; return toSerial(+m[3], a, b); }
  if ((m = /^(\d{1,2})[ -]([A-Za-z]{3,9})[ -,]*(\d{4})$/.exec(t))) { const mo = MONTHS.findIndex(x => x.slice(0, 3).toLowerCase() === m[2].slice(0, 3).toLowerCase()); if (mo >= 0) return toSerial(+m[3], mo + 1, +m[1]); }
  if ((m = /^([A-Za-z]{3,9}) (\d{1,2}),? (\d{4})$/.exec(t))) { const mo = MONTHS.findIndex(x => x.slice(0, 3).toLowerCase() === m[1].slice(0, 3).toLowerCase()); if (mo >= 0) return toSerial(+m[3], mo + 1, +m[2]); }
  return null;
}

const NUM = /^\s*[-+]?[$€£₹]?\s*(\d+\.?\d*|\.\d+)(e[-+]?\d+)?\s*%?\s*$/i;
// What a typed (non-formula) cell holds: a number (12, 3.5, 1e3, 20%, 1,200, $5), a date (as its serial), TRUE/FALSE, else text.
export function literal(raw) {
  if (raw == null || raw === '') return '';
  const s = String(raw);
  if (s[0] === "'") return s.slice(1); // a leading ' keeps it text, as in Excel
  const t = s.replace(/,(?=\d{3}\b)/g, '');
  if (NUM.test(t)) { const neg = /^\s*-/.test(t), n = parseFloat(t.replace(/[^\d.e+-]/gi, '').replace(/^[-+]/, '')) * (neg ? -1 : 1); return t.trim().endsWith('%') ? n / 100 : n; }
  if (/^(true|false)$/i.test(s.trim())) return s.trim().toUpperCase() === 'TRUE';
  const d = parseDate(s);
  if (d != null) return d;
  const e = errOf(s.trim().toUpperCase());
  return e || s;
}
// The format a typed value suggests, as Excel picks one: dates, percents, currency.
export function autoFormat(raw) {
  const s = String(raw ?? '').trim();
  if (!s || s[0] === '=' || s[0] === "'") return null;
  if (parseDate(s) != null) return /:\d\d$/.test(s) ? 'yyyy-mm-dd hh:mm' : 'date';
  if (/^[-+]?[\d,.]+%$/.test(s)) return /\.\d/.test(s) ? '0.00%' : '0%';
  const cur = /^-?([$€£₹])\s*[\d,.]+$/.exec(s);
  if (cur) return cur[1];
  return null;
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
const truthy = v => { if (isErr(v)) throw v; return typeof v === 'string' ? v !== '' && v.toUpperCase() !== 'FALSE' : !!num(v); };

export function fmtNum(n) {
  if (!isFinite(n)) return E.div.code;
  if (Number.isInteger(n)) return Math.abs(n) >= 1e15 ? n.toExponential(5).replace('e+', 'E+') : String(n);
  return String(+n.toPrecision(11));
}
// How a value shows in a cell with no format.
export function display(v) {
  if (isErr(v)) return v.code;
  if (typeof v === 'number') return fmtNum(v);
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
  return v == null ? '' : String(v);
}

/* ---- number formats ----
   Ours: '' (General), '0', '0.00', '#,##0', '#,##0.00', '0%', '0.00%', '$' '€' '£' '₹' (currency), 'acct',
   'date', 'datelong', 'time', 'yyyy-mm-dd hh:mm', 'sci', 'text'; and Excel format codes from .xlsx files.
   dp, when set, overrides the number of decimals. */
const pad = (n, w = 2) => String(n).padStart(w, '0');
function fmtDate(n, code) {
  const t = fromSerial(n), ampm = /AM\/PM/i.test(code), h12 = ((t.h + 11) % 12) + 1;
  // "mm" after hours or before seconds means minutes, elsewhere months (as in Excel).
  const c = code.replace(/(h+[^a-z]*)mm?/gi, '$1MI').replace(/mm?([^a-z]*s)/gi, 'MI$1');
  return c.replace(/MI|AM\/PM|yyyy|yy|mmmm|mmm|mm|m|dddd|ddd|dd|d|hh|h|ss|s/g, k => {
    switch (k.toLowerCase()) {
      case 'yyyy': return t.y; case 'yy': return pad(t.y % 100);
      case 'mmmm': return MONTHS[t.m - 1]; case 'mmm': return MONTHS[t.m - 1].slice(0, 3); case 'mm': return pad(t.m); case 'm': return t.m;
      case 'dddd': return DAYS[t.wd]; case 'ddd': return DAYS[t.wd].slice(0, 3); case 'dd': return pad(t.d); case 'd': return t.d;
      case 'hh': return pad(ampm ? h12 : t.h); case 'h': return ampm ? h12 : t.h;
      case 'mi': return pad(t.mi); case 'ss': return pad(t.s); case 's': return t.s;
      case 'am/pm': return t.h < 12 ? 'AM' : 'PM';
    }
    return k;
  });
}
const grouped = (v, d) => v.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
export function formatValue(v, nf, dp) {
  if (typeof v !== 'number' || !nf || nf === 'text' || nf === '@') {
    if (typeof v === 'number' && dp != null) return v.toFixed(dp);
    return display(v);
  }
  const D = (def) => (dp != null ? dp : def);
  switch (nf) {
    case 'General': return dp != null ? v.toFixed(dp) : display(v);
    case '0': return v.toFixed(D(0));
    case '0.00': return v.toFixed(D(2));
    case '#,##0': return grouped(v, D(0));
    case '#,##0.00': return grouped(v, D(2));
    case '%': case '0%': return (v * 100).toFixed(D(0)) + '%';
    case '0.00%': return (v * 100).toFixed(D(2)) + '%';
    case '$': case '€': case '£': case '₹': return (v < 0 ? '-' : '') + nf + grouped(Math.abs(v), D(2));
    case 'acct': return v < 0 ? `(${grouped(-v, D(2))})` : grouped(v, D(2)) + ' ';
    case 'sci': return v.toExponential(D(2)).replace('e+', 'E+').replace('e-', 'E-');
    case 'date': return fmtDate(v, 'dd-mm-yyyy');
    case 'datelong': return fmtDate(v, 'dddd, d mmmm yyyy');
    case 'time': return fmtDate(v, 'hh:mm:ss');
  }
  return excelFormat(v, nf, dp);
}
// An Excel number format code (from a .xlsx): the first section (or the negative one), with the common parts.
function excelFormat(v, code, dp) {
  const parts = code.split(';');
  let c = v < 0 && parts[1] ? parts[1] : parts[0];
  const neg = v < 0 && !parts[1];
  c = c.replace(/\[[^\]]*\]/g, '').replace(/_./g, ' ').replace(/\*./g, '').replace(/\\(.)/g, '$1');
  if (/[ymdhs]/i.test(c.replace(/"[^"]*"/g, '')) && !/[0#]/.test(c)) return fmtDate(v, c.replace(/"([^"]*)"/g, '$1').toLowerCase().replace('am/pm', 'AM/PM'));
  const lit = c.replace(/"([^"]*)"/g, '$1');
  const m = /[0#,]+(\.[0#]+)?/.exec(lit);
  if (!m) return lit.trim() === 'General' || !lit.trim() ? display(v) : lit;
  const pct = /%/.test(lit), d = dp != null ? dp : m[1] ? m[1].length - 1 : 0, n = Math.abs(v) * (pct ? 100 : 1);
  const body = /,/.test(m[0]) ? grouped(n, d) : n.toFixed(d);
  return (neg ? '-' : '') + lit.slice(0, m.index) + body + lit.slice(m.index + m[0].length);
}
// Formats that mean a date or time.
export const isDateFormat = nf => !!nf && (['date', 'datelong', 'time', 'yyyy-mm-dd hh:mm'].includes(nf) || (/[dy]/i.test(String(nf).replace(/"[^"]*"/g, '')) && !/[0#]/.test(nf)));

/* ---- the file's sheets, for drawing them on the canvas (set by the editor) ---- */
let SHEETS = new Map();
export const setSheets = list => { SHEETS = new Map((list || []).map(s => [s.id, s])); };
export const sheetById = id => SHEETS.get(id) || null;
export const allSheets = () => [...SHEETS.values()];

/* ---- formulas: tokens → tree ---- */
const SHEETREF = "(?:'(?:[^']|'')+'|[A-Za-z_][\\w.]*)!";
const REF = new RegExp(`^(${SHEETREF})?(\\$?[A-Za-z]{1,3}\\$?\\d{1,7}(?::\\$?[A-Za-z]{1,3}\\$?\\d{1,7})?|\\$?[A-Za-z]{1,3}:\\$?[A-Za-z]{1,3}|\\$?\\d{1,7}:\\$?\\d{1,7})(?![\\w(])`);
function tokenize(src) {
  const out = [];
  let i = 0;
  while (i < src.length) {
    const ch = src[i], rest = src.slice(i);
    if (/\s/.test(ch)) { i++; continue; }
    if (ch === '"') {
      let j = i + 1, s = '';
      while (j < src.length) { if (src[j] === '"') { if (src[j + 1] === '"') { s += '"'; j += 2; continue; } break; } s += src[j++]; }
      if (j >= src.length) throw E.parse;
      out.push({ t: 'str', v: s }); i = j + 1; continue;
    }
    const m = /^(\d+\.?\d*|\.\d+)(e[-+]?\d+)?(?![\w:])/i.exec(rest);
    if (m) { out.push({ t: 'num', v: parseFloat(m[0]) }); i += m[0].length; continue; }
    const r = REF.exec(rest);
    if (r) {
      const sheet = r[1] ? r[1].slice(0, -1).replace(/^'|'$/g, '').replace(/''/g, "'") : null;
      out.push({ t: 'ref', sheet, v: r[2].replace(/\$/g, '').toUpperCase() }); i += r[0].length; continue;
    }
    const e = /^#(DIV\/0!|REF!|NAME\?|VALUE!|N\/A|NUM!)/i.exec(rest);
    if (e) { out.push({ t: 'err', v: errOf(e[0].toUpperCase()) }); i += e[0].length; continue; }
    const w = /^[A-Za-z_][\w.]*/.exec(rest);
    if (w) { out.push({ t: 'name', v: w[0].toUpperCase() }); i += w[0].length; continue; }
    const op = /^(<>|<=|>=|[-+*/^&=<>(),;%{}])/.exec(rest);
    if (op) { out.push({ t: 'op', v: op[0] === ';' ? ',' : op[0] }); i += op[0].length; continue; }
    throw E.parse;
  }
  return out;
}
// Precedence, low to high: comparison, &, + -, * /, ^, unary -, %.
const TREES = new Map();
function parse(src) {
  if (TREES.has(src)) return TREES.get(src);
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
    if (t.t === 'err') return { k: 'err', v: t.v };
    if (t.t === 'ref') return { k: t.v.includes(':') ? 'range' : 'ref', v: t.v, sheet: t.sheet };
    if (t.t === 'name') {
      if (isOp('(')) {
        next();
        const args = [];
        if (!isOp(')')) { do { args.push(isOp(',', ')') ? { k: 'blank' } : cmp()); } while (isOp(',') && next()); }
        if (!isOp(')')) throw E.parse;
        next();
        return { k: 'call', f: t.v.replace(/^_XLFN\./, '').replace(/^_XLWS\./, ''), args };
      }
      if (t.v === 'TRUE' || t.v === 'FALSE') return { k: 'bool', v: t.v === 'TRUE' };
      return { k: 'name', v: t.v };
    }
    if (t.t === 'op' && t.v === '(') { const e = cmp(); if (!isOp(')')) throw E.parse; next(); return e; }
    if (t.t === 'op' && t.v === '{') { // {1,2,3} array constants, one row
      const row = [];
      if (!isOp('}')) { do { row.push(cmp()); } while (isOp(',') && next()); }
      if (!isOp('}')) throw E.parse;
      next();
      return { k: 'arr', row };
    }
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
  if (TREES.size > 5000) TREES.clear();
  TREES.set(src, tree);
  return tree;
}

/* ---- functions ---- */
const flat = args => args.flatMap(a => (Array.isArray(a) ? a.flat() : [a]));
const nums = args => flat(args).filter(v => { if (isErr(v)) throw v; return typeof v === 'number'; });
const col1 = a => (Array.isArray(a) ? (a.length === 1 ? a[0] : a.map(r => r[0])) : [a]);
const sum = a => a.reduce((s, x) => s + x, 0);
const mean = a => { if (!a.length) throw E.div; return sum(a) / a.length; };
const variance = (a, sample) => { if (a.length < (sample ? 2 : 1)) throw E.div; const m = mean(a); return sum(a.map(x => (x - m) ** 2)) / (a.length - (sample ? 1 : 0)); };
const eq = (a, b) => (typeof a === 'string' && typeof b === 'string' ? a.toLowerCase() === b.toLowerCase() : a === b);
// "=5", ">10", "<>x", "a*" (wildcards), or a plain value.
function criterion(c) {
  const m = typeof c === 'string' && /^(<>|<=|>=|=|<|>)(.*)$/.exec(c);
  const op = m ? m[1] : '=', rhs = m ? literal(m[2]) : c;
  const wild = typeof rhs === 'string' && /[*?]/.test(rhs) ? new RegExp('^' + rhs.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.') + '$', 'i') : null;
  return v => {
    if (isErr(v)) return false;
    if (wild) return (op === '<>') !== wild.test(String(v ?? ''));
    const a = typeof rhs === 'number' ? (typeof v === 'number' ? v : NaN) : String(v ?? '').toLowerCase();
    const b = typeof rhs === 'number' ? rhs : String(rhs ?? '').toLowerCase();
    return op === '=' ? a === b : op === '<>' ? a !== b : op === '<' ? a < b : op === '>' ? a > b : op === '<=' ? a <= b : a >= b;
  };
}
// The rows that meet all of SUMIFS-style (range, criterion) pairs.
const ifsMask = pairs => {
  const ranges = [], tests = [];
  for (let i = 0; i < pairs.length; i += 2) { ranges.push(flat([pairs[i]])); tests.push(criterion(pairs[i + 1])); }
  return ranges[0].map((_, k) => ranges.every((r, j) => tests[j](r[k])));
};
function textFormat(v, f) {
  const fs = str(f);
  if (typeof v !== 'number') { const l = literal(v); if (typeof l !== 'number') return str(v); v = l; }
  return formatValue(v, fs);
}
const FN = {
  SUM: a => sum(nums(a)),
  AVERAGE: a => mean(nums(a)), AVG: a => mean(nums(a)),
  MIN: a => { const n = nums(a); return n.length ? Math.min(...n) : 0; },
  MAX: a => { const n = nums(a); return n.length ? Math.max(...n) : 0; },
  COUNT: a => nums(a).length,
  COUNTA: a => flat(a).filter(v => v !== '' && v != null).length,
  COUNTBLANK: a => flat(a).filter(v => v === '' || v == null).length,
  PRODUCT: a => nums(a).reduce((s, x) => s * x, 1),
  MEDIAN: a => { const n = nums(a).sort((x, y) => x - y); if (!n.length) throw E.num; const m = n.length >> 1; return n.length % 2 ? n[m] : (n[m - 1] + n[m]) / 2; },
  MODE: a => { const n = nums(a), c = new Map(); n.forEach(x => c.set(x, (c.get(x) || 0) + 1)); let best = null, k = 1; c.forEach((v, x) => { if (v > k) { k = v; best = x; } }); if (best == null) throw E.na; return best; },
  STDEV: a => Math.sqrt(variance(nums(a), true)), 'STDEV.S': a => Math.sqrt(variance(nums(a), true)), STDEVP: a => Math.sqrt(variance(nums(a), false)), 'STDEV.P': a => Math.sqrt(variance(nums(a), false)),
  VAR: a => variance(nums(a), true), 'VAR.S': a => variance(nums(a), true), VARP: a => variance(nums(a), false), 'VAR.P': a => variance(nums(a), false),
  LARGE: ([r, k]) => { const n = nums([r]).sort((x, y) => y - x), i = num(k); if (i < 1 || i > n.length) throw E.num; return n[i - 1]; },
  SMALL: ([r, k]) => { const n = nums([r]).sort((x, y) => x - y), i = num(k); if (i < 1 || i > n.length) throw E.num; return n[i - 1]; },
  RANK: ([x, r, o]) => { const n = nums([r]), v = num(x); if (!n.includes(v)) throw E.na; return (o && num(o) ? n.filter(y => y < v) : n.filter(y => y > v)).length + 1; },
  'RANK.EQ': a => FN.RANK(a),
  SUMPRODUCT: a => { const arrs = a.map(x => flat([x])); return arrs[0].reduce((s, _, i) => s + arrs.reduce((p, r) => p * (typeof r[i] === 'number' ? r[i] : 0), 1), 0); },
  ABS: ([x]) => Math.abs(num(x)), SIGN: ([x]) => Math.sign(num(x)),
  SQRT: ([x]) => { const n = num(x); if (n < 0) throw E.num; return Math.sqrt(n); },
  POWER: ([x, y]) => Math.pow(num(x), num(y)), EXP: ([x]) => Math.exp(num(x)),
  LN: ([x]) => { const n = num(x); if (n <= 0) throw E.num; return Math.log(n); },
  LOG: ([x, b]) => { const n = num(x); if (n <= 0) throw E.num; return Math.log(n) / Math.log(b == null ? 10 : num(b)); },
  LOG10: ([x]) => FN.LOG([x]),
  MOD: ([x, y]) => { const d = num(y); if (!d) throw E.div; const r = num(x) % d; return r && Math.sign(r) !== Math.sign(d) ? r + d : r; },
  ROUND: ([x, d]) => { const k = 10 ** num(d ?? 0), n = num(x); return Math.sign(n) * Math.round(Math.abs(n) * k + 1e-9) / k; },
  ROUNDUP: ([x, d]) => { const k = 10 ** num(d ?? 0), n = num(x); return Math.sign(n) * Math.ceil(Math.abs(n) * k - 1e-9) / k; },
  ROUNDDOWN: ([x, d]) => { const k = 10 ** num(d ?? 0), n = num(x); return Math.sign(n) * Math.floor(Math.abs(n) * k + 1e-9) / k; },
  TRUNC: ([x, d]) => FN.ROUNDDOWN([x, d]),
  INT: ([x]) => Math.floor(num(x)),
  CEILING: ([x, s]) => { const k = s == null ? 1 : num(s); return k ? Math.ceil(num(x) / k) * k : 0; },
  FLOOR: ([x, s]) => { const k = s == null ? 1 : num(s); return k ? Math.floor(num(x) / k) * k : 0; },
  'CEILING.MATH': a => FN.CEILING(a), 'FLOOR.MATH': a => FN.FLOOR(a),
  RAND: () => Math.random(), RANDBETWEEN: ([a, b]) => Math.floor(num(a) + Math.random() * (num(b) - num(a) + 1)),
  PI: () => Math.PI,
  AND: a => flat(a).filter(v => v !== '').every(truthy),
  OR: a => flat(a).filter(v => v !== '').some(truthy),
  XOR: a => flat(a).filter(truthy).length % 2 === 1,
  NOT: ([x]) => !truthy(x),
  TRUE: () => true, FALSE: () => false, NA: () => { throw E.na; },
  ISBLANK: ([x]) => x === '' || x == null, ISNUMBER: ([x]) => typeof x === 'number', ISTEXT: ([x]) => typeof x === 'string' && x !== '',
  ISERROR: ([x]) => isErr(x), ISERR: ([x]) => isErr(x) && x !== E.na, ISNA: ([x]) => x === E.na, ISLOGICAL: ([x]) => typeof x === 'boolean',
  ISEVEN: ([x]) => Math.floor(Math.abs(num(x))) % 2 === 0, ISODD: ([x]) => Math.floor(Math.abs(num(x))) % 2 === 1,
  CONCAT: a => flat(a).map(str).join(''), CONCATENATE: a => flat(a).map(str).join(''),
  TEXTJOIN: ([d, ign, ...rest]) => flat(rest).filter(v => !(truthy(ign) && (v === '' || v == null))).map(str).join(str(d)),
  LEN: ([x]) => str(x).length,
  UPPER: ([x]) => str(x).toUpperCase(), LOWER: ([x]) => str(x).toLowerCase(),
  PROPER: ([x]) => str(x).toLowerCase().replace(/(^|[^a-z'])([a-z])/g, (m, a, b) => a + b.toUpperCase()),
  TRIM: ([x]) => str(x).trim().replace(/ +/g, ' '),
  LEFT: ([x, n]) => str(x).slice(0, num(n ?? 1)),
  RIGHT: ([x, n]) => { const s = str(x), k = num(n ?? 1); return k ? s.slice(-k) : ''; },
  MID: ([x, s, n]) => str(x).substr(num(s) - 1, num(n)),
  REPT: ([x, n]) => str(x).repeat(Math.max(0, num(n))),
  SUBSTITUTE: ([x, a, b, n]) => { const s = str(x), f = str(a), r = str(b); if (!f) return s; if (n == null) return s.split(f).join(r); let k = 0; return s.replace(new RegExp(f.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), m => (++k === num(n) ? r : m)); },
  REPLACE: ([x, s, n, r]) => { const t = str(x), i = num(s) - 1; return t.slice(0, i) + str(r) + t.slice(i + num(n)); },
  FIND: ([f, x, s]) => { const i = str(x).indexOf(str(f), num(s ?? 1) - 1); if (i < 0) throw E.value; return i + 1; },
  SEARCH: ([f, x, s]) => { const i = str(x).toLowerCase().indexOf(str(f).toLowerCase(), num(s ?? 1) - 1); if (i < 0) throw E.value; return i + 1; },
  EXACT: ([a, b]) => str(a) === str(b),
  VALUE: ([x]) => { if (typeof x === 'number') return x; const l = literal(str(x).trim()); if (typeof l !== 'number') throw E.value; return l; },
  TEXT: ([v, f]) => textFormat(v, f),
  CHAR: ([n]) => String.fromCharCode(num(n)), CODE: ([x]) => str(x).charCodeAt(0) || 0,
  N: ([x]) => (typeof x === 'number' ? x : x === true ? 1 : 0), T: ([x]) => (typeof x === 'string' ? x : ''),
  SUMIF: ([range, crit, sumRange]) => { const r = flat([range]), s = sumRange ? flat([sumRange]) : r, test = criterion(crit); return r.reduce((t, v, i) => (test(v) && typeof s[i] === 'number' ? t + s[i] : t), 0); },
  COUNTIF: ([range, crit]) => { const test = criterion(crit); return flat([range]).filter(test).length; },
  AVERAGEIF: ([range, crit, avgRange]) => { const r = flat([range]), s = avgRange ? flat([avgRange]) : r, test = criterion(crit); return mean(r.map((x, i) => (test(x) && typeof s[i] === 'number' ? s[i] : null)).filter(x => x != null)); },
  SUMIFS: ([s, ...p]) => { const v = flat([s]), m = ifsMask(p); return v.reduce((t, x, i) => (m[i] && typeof x === 'number' ? t + x : t), 0); },
  COUNTIFS: p => ifsMask(p).filter(Boolean).length,
  AVERAGEIFS: ([s, ...p]) => { const v = flat([s]), m = ifsMask(p); return mean(v.filter((x, i) => m[i] && typeof x === 'number')); },
  MAXIFS: ([s, ...p]) => { const v = flat([s]), m = ifsMask(p), n = v.filter((x, i) => m[i] && typeof x === 'number'); return n.length ? Math.max(...n) : 0; },
  MINIFS: ([s, ...p]) => { const v = flat([s]), m = ifsMask(p), n = v.filter((x, i) => m[i] && typeof x === 'number'); return n.length ? Math.min(...n) : 0; },
  VLOOKUP: ([key, table, col, approx]) => {
    if (!Array.isArray(table)) throw E.value;
    const c = num(col) - 1;
    if (c < 0 || c >= (table[0] || []).length) throw E.ref;
    const exact = approx === false || (approx != null && approx !== '' && !truthy(approx));
    if (exact) { const row = table.find(r => eq(r[0], key)); if (!row) throw E.na; return row[c]; }
    let hit = null;
    for (const r of table) { if (typeof r[0] === typeof key && r[0] <= key) hit = r; else if (hit) break; }
    if (!hit) throw E.na;
    return hit[c];
  },
  HLOOKUP: ([key, table, row, approx]) => FN.VLOOKUP([key, table[0].map((_, i) => table.map(r => r[i])), row, approx]),
  MATCH: ([key, range, type]) => {
    const list = flat([range]), t = type == null ? 1 : num(type);
    if (t === 0) { const i = list.findIndex(v => (typeof key === 'string' && /[*?]/.test(key) ? criterion(key)(v) : eq(v, key))); if (i < 0) throw E.na; return i + 1; }
    let best = -1;
    list.forEach((v, i) => { if (typeof v !== typeof key) return; if (t > 0 ? v <= key : v >= key) best = i; });
    if (best < 0) throw E.na;
    return best + 1;
  },
  INDEX: ([range, r, c]) => {
    const t = Array.isArray(range) ? range : [[range]];
    let ri = r == null || r === '' ? 1 : num(r), ci = c == null || c === '' ? 1 : num(c);
    if (t.length === 1 && c == null) { ci = ri; ri = 1; }
    const row = t[ri - 1];
    if (!row || ci < 1 || ci > row.length) throw E.ref;
    return row[ci - 1];
  },
  XLOOKUP: ([key, look, ret, notFound, mode]) => {
    const l = flat([look]), rr = Array.isArray(ret) ? ret : [[ret]];
    const rows = rr.length === l.length ? rr.map(r => r[0]) : rr[0];
    const m = mode == null ? 0 : num(mode);
    let i = l.findIndex(v => eq(v, key));
    if (i < 0 && m !== 0) {
      let best = -1;
      l.forEach((v, k) => { if (typeof v !== 'number') return; if (m < 0 ? v <= key && (best < 0 || v > l[best]) : v >= key && (best < 0 || v < l[best])) best = k; });
      i = best;
    }
    if (i < 0) { if (notFound != null && notFound !== '') return notFound; throw E.na; }
    return rows[i];
  },
  CHOOSE: ([i, ...opts]) => { const k = num(i); if (k < 1 || k > opts.length) throw E.value; return opts[k - 1]; },
  ROWS: ([r]) => (Array.isArray(r) ? r.length : 1), COLUMNS: ([r]) => (Array.isArray(r) ? r[0].length : 1),
  // dates and times
  TODAY: () => Math.floor(nowSerial()), NOW: () => nowSerial(),
  DATE: ([y, m, d]) => (Date.UTC(num(y), num(m) - 1, num(d)) - EPOCH) / DAY,
  TIME: ([h, m, s]) => (num(h) * 3600 + num(m) * 60 + num(s ?? 0)) / 86400,
  YEAR: ([x]) => fromSerial(num(x)).y, MONTH: ([x]) => fromSerial(num(x)).m, DAY: ([x]) => fromSerial(num(x)).d,
  HOUR: ([x]) => fromSerial(num(x)).h, MINUTE: ([x]) => fromSerial(num(x)).mi, SECOND: ([x]) => fromSerial(num(x)).s,
  WEEKDAY: ([x, t]) => { const w = fromSerial(num(x)).wd, k = t == null ? 1 : num(t); return k === 2 ? ((w + 6) % 7) + 1 : k === 3 ? (w + 6) % 7 : w + 1; },
  WEEKNUM: ([x]) => { const t = fromSerial(num(x)), jan1 = toSerial(t.y, 1, 1); return Math.floor((num(x) - jan1 + fromSerial(jan1).wd) / 7) + 1; },
  EDATE: ([x, n]) => { const t = fromSerial(num(x)), m = t.m - 1 + num(n), y = t.y + Math.floor(m / 12), mm = ((m % 12) + 12) % 12; const last = new Date(Date.UTC(y, mm + 1, 0)).getUTCDate(); return toSerial(y, mm + 1, Math.min(t.d, last)); },
  EOMONTH: ([x, n]) => { const t = fromSerial(num(x)), m = t.m - 1 + num(n); return (Date.UTC(t.y, m + 1, 0) - EPOCH) / DAY; },
  DAYS: ([e, s]) => Math.floor(num(e)) - Math.floor(num(s)),
  DATEDIF: ([s, e, u]) => {
    const a = fromSerial(num(s)), b = fromSerial(num(e)), unit = str(u).toUpperCase();
    if (num(e) < num(s)) throw E.num;
    const months = (b.y - a.y) * 12 + b.m - a.m - (b.d < a.d ? 1 : 0);
    if (unit === 'Y') return Math.floor(months / 12);
    if (unit === 'M') return months;
    if (unit === 'D') return Math.floor(num(e)) - Math.floor(num(s));
    if (unit === 'YM') return months % 12;
    throw E.num;
  },
  NETWORKDAYS: ([s, e]) => { let n = 0; const a = Math.floor(num(s)), b = Math.floor(num(e)); for (let d = Math.min(a, b); d <= Math.max(a, b); d++) { const w = fromSerial(d).wd; if (w && w < 6) n++; } return a <= b ? n : -n; },
  WORKDAY: ([s, k]) => { let d = Math.floor(num(s)), left = num(k), step = Math.sign(left) || 1; while (left) { d += step; const w = fromSerial(d).wd; if (w && w < 6) left -= step; } return d; },
  DATEVALUE: ([x]) => { const d = parseDate(str(x)); if (d == null) throw E.value; return Math.floor(d); },
  // money
  PMT: ([r, n, pv, fv, t]) => { const R = num(r), N = num(n), P = num(pv), F = num(fv ?? 0), T = num(t ?? 0); if (!R) return -(P + F) / N; const k = (1 + R) ** N; return -(R * (P * k + F)) / ((1 + R * T) * (k - 1)); },
  FV: ([r, n, p, pv, t]) => { const R = num(r), N = num(n), P = num(p), V = num(pv ?? 0), T = num(t ?? 0); if (!R) return -(V + P * N); const k = (1 + R) ** N; return -(V * k + P * (1 + R * T) * (k - 1) / R); },
  PV: ([r, n, p, fv, t]) => { const R = num(r), N = num(n), P = num(p), F = num(fv ?? 0), T = num(t ?? 0); if (!R) return -(F + P * N); const k = (1 + R) ** N; return -(F + P * (1 + R * T) * (k - 1) / R) / k; },
  NPV: ([r, ...v]) => nums(v).reduce((s, x, i) => s + x / (1 + num(r)) ** (i + 1), 0),
};
// Functions whose arguments are only worked out as needed.
const LAZY = new Set(['IF', 'IFERROR', 'IFNA', 'IFS', 'SWITCH', 'CHOOSE']);
export const FUNCTIONS = [...new Set([...Object.keys(FN), ...LAZY])].sort();
// Functions whose results are dates, so their cells show as dates unless formatted otherwise.
const DATE_FNS = new Set(['TODAY', 'DATE', 'EDATE', 'EOMONTH', 'WORKDAY', 'DATEVALUE']);

/* ---- evaluation ----
   evaluate(sheet, book) gives a getter for the sheet's cells; book is all the file's sheets, for Sheet2!A1. */
export function evaluate(sheet, book) {
  const sheets = book && book.length ? book : [sheet];
  const byName = new Map(sheets.map(s => [String(s.name).toLowerCase(), s]));
  const vals = new Map(), busy = new Set();
  let cur = null; // the cell being worked out, for ROW() and COLUMN()
  const cellOf = (sh, a) => {
    const key = sh.id + '!' + a;
    if (vals.has(key)) return vals.get(key);
    const raw = (sh.cells || {})[a];
    if (raw == null || raw === '' || String(raw)[0] !== '=') { const v = literal(raw); vals.set(key, v); return v; }
    if (busy.has(key)) throw E.cycle;
    busy.add(key);
    let v;
    try {
      const tree = parse(String(raw).slice(1)), outer = cur;
      cur = a;
      try { v = ev(tree, sh); } finally { cur = outer; }
      if (Array.isArray(v)) v = v[0]?.[0] ?? '';
      if (v === '' && tree.k === 'ref') v = 0; // =A1 of an empty cell is 0, as in Excel
      if (typeof v === 'number' && !isFinite(v)) v = E.num;
    } catch (e) { v = isErr(e) ? e : E.value; }
    busy.delete(key);
    vals.set(key, v);
    return v;
  };
  const target = (sh, name) => {
    if (!name) return sh;
    const t = byName.get(String(name).toLowerCase());
    if (!t) throw E.ref;
    return t;
  };
  const used = sh => usedRange(sh) || { c0: 0, r0: 0, c1: 0, r1: 0 };
  const range = (sh, r) => {
    let b;
    if (/^[A-Z]+:[A-Z]+$/.test(r)) { const [a, z] = r.split(':').map(colIndex), u = used(sh); b = { c0: Math.min(a, z), c1: Math.max(a, z), r0: 0, r1: u.r1 }; }
    else if (/^\d+:\d+$/.test(r)) { const [a, z] = r.split(':').map(Number), u = used(sh); b = { r0: Math.min(a, z) - 1, r1: Math.max(a, z) - 1, c0: 0, c1: u.c1 }; }
    else b = parseRange(r);
    if (!b) throw E.ref;
    if ((b.r1 - b.r0 + 1) * (b.c1 - b.c0 + 1) > 500000) throw E.num;
    const out = [];
    for (let y = b.r0; y <= b.r1; y++) {
      const row = [];
      for (let x = b.c0; x <= b.c1; x++) row.push(cellOf(sh, addr(x, y)));
      out.push(row);
    }
    return out;
  };
  const scalar = v => (Array.isArray(v) ? (v.length === 1 && v[0].length === 1 ? v[0][0] : (() => { throw E.value; })()) : v);
  const ev = (t, sh) => {
    switch (t.k) {
      case 'num': case 'str': case 'bool': return t.v;
      case 'blank': return '';
      case 'err': throw t.v;
      case 'arr': return [t.row.map(x => scalar(ev(x, sh)))];
      case 'ref': return cellOf(target(sh, t.sheet), t.v);
      case 'range': return range(target(sh, t.sheet), t.v);
      case 'name': throw E.name;
      case 'neg': return -num(scalar(ev(t.e, sh)));
      case 'call': {
        const A = t.args, S = x => scalar(ev(x, sh));
        const catchErr = x => { try { return S(x); } catch (e) { if (!isErr(e) || e === E.cycle) throw e; return e; } };
        switch (t.f) {
          case 'IF': return truthy(S(A[0])) ? (A[1] ? S(A[1]) : true) : (A[2] ? S(A[2]) : false);
          case 'IFERROR': { const v = catchErr(A[0]); return isErr(v) ? S(A[1]) : v; }
          case 'IFNA': { const v = catchErr(A[0]); return v === E.na ? S(A[1]) : v; }
          case 'IFS': for (let i = 0; i + 1 < A.length; i += 2) if (truthy(S(A[i]))) return S(A[i + 1]); throw E.na;
          case 'SWITCH': { const v = S(A[0]); for (let i = 1; i + 1 < A.length; i += 2) if (eq(S(A[i]), v)) return S(A[i + 1]); if (A.length % 2 === 0) return S(A[A.length - 1]); throw E.na; }
          case 'CHOOSE': { const k = num(S(A[0])); if (k < 1 || k >= A.length) throw E.value; return ev(A[k], sh); }
          case 'ROW': return (parseAddr(A.length ? A[0].v.split(':')[0] : cur) || { r: 0 }).r + 1;
          case 'COLUMN': return (parseAddr(A.length ? A[0].v.split(':')[0] : cur) || { c: 0 }).c + 1;
        }
        const f = FN[t.f];
        if (!f) throw E.name;
        // Errors inside ranges are passed through to the function (ISERROR, COUNTA see them); single values throw.
        const seesErrors = /^IS|^ERROR\.TYPE$/.test(t.f);
        const args = A.map(x => (seesErrors ? catchErr(x) : x.k === 'range' || x.k === 'arr' ? ev(x, sh) : x.k === 'ref' ? cellOf(target(sh, x.sheet), x.v) : ev(x, sh)));
        if (!seesErrors && !/^COUNTA$|^COUNTBLANK$/.test(t.f)) args.forEach(a => { if (isErr(a)) throw a; });
        return f(args);
      }
      case 'bin': {
        const l = scalar(ev(t.l, sh)), r = scalar(ev(t.r, sh));
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
            const L = l === '' && typeof r === 'number' ? 0 : l, R = r === '' && typeof l === 'number' ? 0 : r;
            const [a, b] = typeof L === 'number' && typeof R === 'number' ? [L, R] : typeof L === 'boolean' && typeof R === 'boolean' ? [+L, +R] : [str(L).toLowerCase(), str(R).toLowerCase()];
            return t.o === '=' ? a === b : t.o === '<>' ? a !== b : t.o === '<' ? a < b : t.o === '>' ? a > b : t.o === '<=' ? a <= b : a >= b;
          }
        }
      }
      default: throw E.parse;
    }
  };
  const get = a => cellOf(sheet, a);
  // The format a cell shows with when it has none of its own: dates for date values and date formulas.
  get.hint = a => {
    const raw = (sheet.cells || {})[a];
    if (raw == null || raw === '') return null;
    const s = String(raw);
    if (s[0] !== '=') return autoFormat(s);
    try {
      const t = parse(s.slice(1));
      if (t.k === 'call' && DATE_FNS.has(t.f)) return t.f === 'NOW' ? 'yyyy-mm-dd hh:mm' : 'date';
      if (t.k === 'call' && t.f === 'NOW') return 'yyyy-mm-dd hh:mm';
      if (t.k === 'bin' && (t.o === '+' || t.o === '-') && t.l.k === 'ref' && !t.l.sheet && isDateFormat(((sheet.fmt || {})[t.l.v] || {}).nf || get.hint(t.l.v))) return t.o === '-' && t.r.k === 'ref' ? null : 'date';
    } catch (e) { /* not a formula we can read */ }
    return null;
  };
  return get;
}

// Text a cell shows: its value in its number format (its own, or the one its contents suggest).
export function shown(val, sheet, a) {
  const f = (sheet.fmt || {})[a] || {};
  return formatValue(val(a), f.nf || (val.hint ? val.hint(a) : null), f.dp);
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

/* ---- auto fill: what dragging the fill handle continues ---- */
const SERIES = [
  DAYS, DAYS.map(d => d.slice(0, 3)), MONTHS, MONTHS.map(m => m.slice(0, 3)),
];
// The next n values after `seed` (an array of raw cell contents), as Excel's fill handle does.
export function fillSeries(seed, n, step = 1) {
  const out = [];
  const raws = seed.map(x => (x == null ? '' : String(x)));
  if (raws.some(r => r[0] === '=')) return null; // formulas are copied with shifted references by the caller
  const vals = raws.map(literal);
  // Numbers (or dates): continue the step between the seeds, or count up by 1 from a single date.
  if (vals.every(v => typeof v === 'number') && raws.every(r => r !== '')) {
    const isDate = raws.some(r => parseDate(r) != null);
    let d = vals.length > 1 ? (vals[vals.length - 1] - vals[0]) / (vals.length - 1) : isDate ? 1 : 0;
    if (vals.length === 1 && !isDate) d = 0;
    const last = vals[vals.length - 1];
    for (let i = 1; i <= n; i++) {
      const v = last + d * i * step;
      out.push(isDate && /^\d{4}-\d{1,2}-\d{1,2}$/.test(raws[0].trim()) ? fmtDate(v, 'yyyy-mm-dd') : String(+v.toPrecision(12)));
    }
    return out;
  }
  // Day and month names.
  for (const list of SERIES) {
    const idx = raws.map(r => list.findIndex(x => x.toLowerCase() === r.trim().toLowerCase()));
    if (idx.every(i => i >= 0)) {
      const d = idx.length > 1 ? idx[1] - idx[0] : 1, up = raws[0] === raws[0].toUpperCase() && raws[0] !== raws[0].toLowerCase();
      for (let i = 1; i <= n; i++) { const v = list[(((idx[idx.length - 1] + d * i) % list.length) + list.length) % list.length]; out.push(up ? v.toUpperCase() : v); }
      return out;
    }
  }
  // Text ending in a number: Item 1, Item 2…
  const tm = raws.map(r => /^(.*?)(\d+)$/.exec(r));
  if (tm.every(Boolean) && tm.every(m => m[1] === tm[0][1])) {
    const ns = tm.map(m => Number(m[2])), d = ns.length > 1 ? ns[ns.length - 1] - ns[ns.length - 2] : 1;
    for (let i = 1; i <= n; i++) out.push(tm[0][1] + (ns[ns.length - 1] + d * i));
    return out;
  }
  for (let i = 0; i < n; i++) out.push(raws[i % raws.length]);
  return out;
}

/* ---- CSV ---- */
export function toCSV(sheet, values = true, book) {
  const u = usedRange(sheet);
  if (!u) return '';
  const val = values ? evaluate(sheet, book) : null, rows = [];
  for (let r = 0; r <= u.r1; r++) {
    const row = [];
    for (let c = 0; c <= u.c1; c++) {
      const a = addr(c, r), s = values ? shown(val, sheet, a) : String(sheet.cells[a] ?? '');
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
  const tab = (t.split('\n')[0].match(/\t/g) || []).length > (t.split('\n')[0].match(/,/g) || []).length;
  for (let i = 0; i < t.length; i++) {
    const ch = t[i];
    if (q) { if (ch === '"') { if (t[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += ch; continue; }
    if (ch === '"' && f === '') q = true;
    else if (ch === (tab ? '\t' : ',')) { row.push(f); f = ''; }
    else if (ch === '\n' || ch === '\r') { if (ch === '\r' && t[i + 1] === '\n') i++; row.push(f); rows.push(row); row = []; f = ''; }
    else f += ch;
  }
  if (f !== '' || row.length) { row.push(f); rows.push(row); }
  const cells = {};
  rows.forEach((r, y) => r.forEach((v, x) => { if (v !== '') cells[addr(x, y)] = v; }));
  return { cells, cols: Math.max(26, ...rows.map(r => r.length + 2)), rows: Math.max(100, rows.length + 20) };
}

/* ---- formulas that move ---- */
const REFS = /("(?:[^"]|"")*")|((?:'(?:[^']|'')+'|[A-Za-z_][\w.]*)!)?(\$?)([A-Za-z]{1,3})(\$?)(\d{1,7})(?![\w(])/g;
// Copy or fill: relative references shift, $-fixed ones stay.
export function shiftFormula(raw, dc, dr) {
  if (typeof raw !== 'string' || raw[0] !== '=') return raw;
  return '=' + raw.slice(1).replace(REFS, (m, s, sh = '', d1, c, d2, r) => {
    if (s) return s;
    const ci = d1 ? colIndex(c) : colIndex(c) + dc, ri = d2 ? Number(r) : Number(r) + dr;
    if (ci < 0 || ri < 1) return '#REF!';
    return sh + d1 + colName(ci) + d2 + ri;
  });
}
// Rows or columns inserted (n > 0) or deleted (n < 0) at index `at` of sheet `name`: references follow.
// `inSheet` is the sheet the formula is on; references to other sheets only move when they point at `name`.
export function moveRefs(raw, rowsNotCols, at, n, name, inSheet) {
  if (typeof raw !== 'string' || raw[0] !== '=') return raw;
  return '=' + raw.slice(1).replace(REFS, (m, s, sh = '', d1, c, d2, r) => {
    if (s) return s;
    const target = sh ? sh.slice(0, -1).replace(/^'|'$/g, '').replace(/''/g, "'") : inSheet;
    if (String(target).toLowerCase() !== String(name).toLowerCase()) return m;
    const p = { c: colIndex(c), r: Number(r) - 1 }, k = rowsNotCols ? p.r : p.c;
    if (k < at) return m;
    if (n < 0 && k < at - n) return sh + '#REF!';
    const np = rowsNotCols ? { c: p.c, r: p.r + n } : { c: p.c + n, r: p.r };
    return sh + d1 + colName(np.c) + d2 + (np.r + 1);
  });
}
