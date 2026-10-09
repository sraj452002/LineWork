/* .xlsx files in and out, with ExcelJS (loaded only when a file is opened or saved).
   Kept: every sheet, values and formulas, number formats, fonts (bold, italic, underline, strike, size,
   family, colour), fills, alignment and wrapping, borders, column widths, row heights, merged cells and
   frozen panes. Charts and pictures inside .xlsx files aren't read; Workline's charts aren't written. */

import { addr, colName, evaluate, isErr, literal, newSheet, parseAddr, shiftFormula } from './sheet.js';

const load = async () => (await import('exceljs')).default;

// Office's default theme colours, for colours given as {theme, tint}.
const THEME = ['FFFFFF', '000000', 'E7E6E6', '44546A', '4472C4', 'ED7D31', 'A5A5A5', 'FFC000', '5B9BD5', '70AD47'];
function color(c) {
  if (!c) return null;
  if (c.argb) return '#' + c.argb.slice(-6).toLowerCase();
  if (c.theme != null && THEME[c.theme]) {
    let [r, g, b] = [0, 2, 4].map(i => parseInt(THEME[c.theme].slice(i, i + 2), 16));
    const t = c.tint || 0;
    [r, g, b] = [r, g, b].map(x => Math.round(t < 0 ? x * (1 + t) : x + (255 - x) * t));
    return '#' + [r, g, b].map(x => x.toString(16).padStart(2, '0')).join('');
  }
  return null;
}
const argb = hex => 'FF' + String(hex).replace('#', '').toUpperCase();
const BORDER_IN = { thin: 1, hair: 1, dotted: 1, dashed: 1, medium: 2, mediumDashed: 2, thick: 3, double: 3 };
const BORDER_OUT = { 1: 'thin', 2: 'medium', 3: 'thick' };

// Our number formats → Excel's codes.
function excelNumFmt(nf, dp) {
  const d = n => (n > 0 ? '.' + '0'.repeat(n) : '');
  if (!nf || nf === 'General') return dp != null ? '0' + d(dp) : null;
  const map = {
    '0': '0' + d(dp ?? 0), '0.00': '0' + d(dp ?? 2), '#,##0': '#,##0' + d(dp ?? 0), '#,##0.00': '#,##0' + d(dp ?? 2),
    '%': '0' + d(dp ?? 0) + '%', '0%': '0' + d(dp ?? 0) + '%', '0.00%': '0' + d(dp ?? 2) + '%',
    '$': '"$"#,##0' + d(dp ?? 2), '€': '"€"#,##0' + d(dp ?? 2), '£': '"£"#,##0' + d(dp ?? 2), '₹': '"₹"#,##0' + d(dp ?? 2),
    acct: '_(#,##0' + d(dp ?? 2) + '_);(#,##0' + d(dp ?? 2) + ')', sci: '0' + d(dp ?? 2) + 'E+00',
    date: 'dd-mm-yyyy', datelong: 'dddd, d mmmm yyyy', time: 'hh:mm:ss', 'yyyy-mm-dd hh:mm': 'yyyy-mm-dd hh:mm', text: '@',
  };
  return map[nf] || nf;
}

/* ---- reading ---- */
export async function readXlsx(buffer) {
  const ExcelJS = await load();
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  const out = [];
  wb.eachSheet(ws => {
    if (ws.state && ws.state !== 'visible') return;
    const sh = newSheet(ws.name);
    const cells = {}, fmt = {};
    let maxC = 0, maxR = 0;
    ws.eachRow({ includeEmpty: false }, (row, rn) => {
      row.eachCell({ includeEmpty: true }, (cell, cn) => {
        const a = addr(cn - 1, rn - 1), f = {};
        maxC = Math.max(maxC, cn); maxR = Math.max(maxR, rn);
        let v = cell.value, raw = '';
        if (v && typeof v === 'object' && !(v instanceof Date)) {
          if (v.formula || v.sharedFormula) {
            let formula = cell.formula;
            if (!formula && v.sharedFormula) {
              const m = ws.getCell(v.sharedFormula), p = parseAddr(v.sharedFormula), q = parseAddr(a);
              formula = m.value && m.value.formula ? shiftFormula('=' + m.value.formula, q.c - p.c, q.r - p.r).slice(1) : '';
            }
            raw = formula ? '=' + formula : String(v.result ?? '');
          } else if (v.richText) raw = v.richText.map(t => t.text).join('');
          else if (v.text != null) raw = typeof v.text === 'object' && v.text.richText ? v.text.richText.map(t => t.text).join('') : String(v.text);
          else if (v.error) raw = v.error;
          else if (v.result != null) raw = String(v.result);
        } else if (v instanceof Date) {
          raw = String((v.getTime() - Date.UTC(1899, 11, 30)) / 86400000);
          if (!cell.numFmt || cell.numFmt === 'General') f.nf = 'date';
        } else if (typeof v === 'boolean') raw = v ? 'TRUE' : 'FALSE';
        else if (v != null) raw = String(v);
        // Text that would read as a number or date here stays text.
        if (typeof v === 'string' && typeof literal(v) !== 'string') raw = "'" + v;
        if (raw !== '') cells[a] = raw;

        if (cell.numFmt && cell.numFmt !== 'General') f.nf = cell.numFmt === '@' ? 'text' : cell.numFmt;
        const ft = cell.font || {};
        if (ft.bold) f.b = 1;
        if (ft.italic) f.i = 1;
        if (ft.underline) f.u = 1;
        if (ft.strike) f.s = 1;
        if (ft.size && ft.size !== 11) f.fs = ft.size;
        if (ft.name && !/^calibri$/i.test(ft.name)) f.ff = ft.name;
        const fc = color(ft.color);
        if (fc && fc !== '#000000') f.fc = fc;
        const fill = cell.fill;
        if (fill && fill.type === 'pattern' && fill.pattern === 'solid') { const bg = color(fill.fgColor); if (bg && bg !== '#ffffff') f.bg = bg; }
        const al = cell.alignment || {};
        if (['left', 'center', 'right'].includes(al.horizontal)) f.al = al.horizontal;
        if (al.horizontal === 'centerContinuous') f.al = 'center';
        if (al.vertical === 'top' || al.vertical === 'middle') f.va = al.vertical;
        if (al.wrapText) f.wrap = 1;
        const bd = cell.border || {}, b = {};
        for (const [k, s] of [['t', 'top'], ['r', 'right'], ['b', 'bottom'], ['l', 'left']]) if (bd[s] && bd[s].style) b[k] = BORDER_IN[bd[s].style] || 1;
        if (Object.keys(b).length) f.bd = b;
        if (Object.keys(f).length) fmt[a] = f;
      });
    });
    sh.cells = cells;
    sh.fmt = fmt;
    sh.cols = Math.max(26, maxC + 4);
    sh.rows = Math.max(100, maxR + 20);
    (ws.columns || []).forEach((c, i) => { if (c && c.width) sh.widths[colName(i)] = Math.round(c.width * 7 + 5); });
    const heights = {};
    ws.eachRow({ includeEmpty: true }, (row, rn) => { if (row.height && Math.abs(row.height - 15) > 0.5) heights[rn - 1] = Math.round(row.height * 4 / 3); });
    if (Object.keys(heights).length) sh.heights = heights;
    const merges = (ws.model.merges || []).map(m => { const [a, b] = m.split(':').map(parseAddr); return a && b ? { c0: a.c, r0: a.r, c1: b.c, r1: b.r } : null; }).filter(Boolean);
    if (merges.length) sh.merges = merges;
    const view = (ws.views || [])[0];
    if (view && view.state === 'frozen' && (view.xSplit || view.ySplit)) sh.freeze = { c: view.xSplit || 0, r: view.ySplit || 0 };
    if (view && view.showGridLines === false) sh.noGrid = true;
    out.push(sh);
  });
  return out;
}

/* ---- writing ---- */
export async function writeXlsx(sheets) {
  const ExcelJS = await load();
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Workline';
  const used = new Set();
  for (const sh of sheets) {
    let name = String(sh.name || 'Sheet').replace(/[\\/?*[\]:]/g, ' ').slice(0, 31) || 'Sheet';
    for (let k = 2; used.has(name.toLowerCase()); k++) name = name.slice(0, 28) + ' ' + k;
    used.add(name.toLowerCase());
    const ws = wb.addWorksheet(name, { views: [{ showGridLines: !sh.noGrid, ...(sh.freeze && (sh.freeze.r || sh.freeze.c) ? { state: 'frozen', xSplit: sh.freeze.c || 0, ySplit: sh.freeze.r || 0 } : {}) }] });
    const val = evaluate(sh, sheets);
    const keys = new Set([...Object.keys(sh.cells || {}), ...Object.keys(sh.fmt || {})]);
    for (const a of keys) {
      if (!parseAddr(a)) continue;
      const cell = ws.getCell(a), raw = (sh.cells || {})[a], f = (sh.fmt || {})[a] || {};
      if (raw != null && raw !== '') {
        const v = val(a);
        if (String(raw)[0] === '=') cell.value = { formula: String(raw).slice(1), result: isErr(v) ? { error: v.code } : v };
        else if (String(raw)[0] === "'") cell.value = String(raw).slice(1);
        else cell.value = isErr(v) ? { error: v.code } : v;
        const auto = val.hint(a);
        if (!f.nf && auto) cell.numFmt = excelNumFmt(auto);
      }
      const nf = excelNumFmt(f.nf, f.dp);
      if (nf) cell.numFmt = nf;
      const font = {};
      if (f.b) font.bold = true;
      if (f.i) font.italic = true;
      if (f.u) font.underline = true;
      if (f.s) font.strike = true;
      if (f.fs) font.size = f.fs;
      if (f.ff) font.name = f.ff;
      if (f.fc) font.color = { argb: argb(f.fc) };
      if (Object.keys(font).length) cell.font = { name: 'Calibri', size: 11, ...font };
      if (f.bg) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: argb(f.bg) } };
      if (f.al || f.va || f.wrap) cell.alignment = { ...(f.al ? { horizontal: f.al } : {}), ...(f.va ? { vertical: f.va } : {}), ...(f.wrap ? { wrapText: true } : {}) };
      if (f.bd) {
        const b = {};
        for (const [k, s] of [['t', 'top'], ['r', 'right'], ['b', 'bottom'], ['l', 'left']]) if (f.bd[k]) b[s] = { style: BORDER_OUT[f.bd[k]] || 'thin' };
        cell.border = b;
      }
    }
    Object.entries(sh.widths || {}).forEach(([c, w]) => { ws.getColumn(c).width = Math.max(1, Math.round(((w - 5) / 7) * 100) / 100); });
    Object.entries(sh.heights || {}).forEach(([r, h]) => { ws.getRow(Number(r) + 1).height = Math.round(h * 0.75 * 100) / 100; });
    (sh.merges || []).forEach(m => ws.mergeCells(m.r0 + 1, m.c0 + 1, m.r1 + 1, m.c1 + 1));
  }
  const buf = await wb.xlsx.writeBuffer();
  return new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}

