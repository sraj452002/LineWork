/* Charts from a block of cells, drawn as SVG, like Excel's Insert → Chart.
   The block's first row names the series when it holds text, and its first column labels the categories
   when it holds text; each other column is a series. */

import { addr, display, evaluate, parseRange } from './sheet.js';
import { esc } from './utils.js';

export const CHART_TYPES = [['column', 'Column'], ['bar', 'Bar'], ['line', 'Line'], ['area', 'Area'], ['pie', 'Pie'], ['doughnut', 'Doughnut'], ['scatter', 'Scatter']];
export const PALETTE = ['#4472c4', '#ed7d31', '#a5a5a5', '#ffc000', '#5b9bd5', '#70ad47', '#264478', '#9e480e', '#636363', '#997300'];

export function chartData(chart, sheet, book) {
  const b = parseRange(chart.range);
  if (!b) return null;
  const val = evaluate(sheet, book);
  const g = (c, r) => val(addr(c, r));
  const textAt = (c, r) => typeof g(c, r) === 'string' && g(c, r) !== '';
  const head = [...Array(b.c1 - b.c0 + 1)].some((_, i) => textAt(b.c0 + i, b.r0)) && b.r1 > b.r0;
  const labels = [...Array(b.r1 - b.r0 + 1)].some((_, i) => textAt(b.c0, b.r0 + i + (head ? 1 : 0)) && b.r0 + i + (head ? 1 : 0) <= b.r1) && b.c1 > b.c0;
  const r0 = b.r0 + (head ? 1 : 0), c0 = b.c0 + (labels ? 1 : 0);
  const cats = [];
  for (let r = r0; r <= b.r1; r++) cats.push(labels ? display(g(b.c0, r)) : String(r - r0 + 1));
  const series = [];
  for (let c = c0; c <= b.c1; c++) {
    const vals = [];
    for (let r = r0; r <= b.r1; r++) { const v = g(c, r); vals.push(typeof v === 'number' ? v : null); }
    series.push({ name: head ? display(g(c, b.r0)) : `Series ${c - c0 + 1}`, vals });
  }
  return { cats, series: series.filter(s => s.vals.some(v => v != null)) };
}

const nice = (lo, hi) => {
  if (lo === hi) { hi = lo + 1; lo = Math.min(0, lo); }
  const span = hi - lo, step0 = Math.pow(10, Math.floor(Math.log10(span / 5))), step = [1, 2, 2.5, 5, 10].map(k => k * step0).find(s => span / s <= 6) || step0 * 10;
  return { lo: Math.floor(lo / step) * step, hi: Math.ceil(hi / step) * step, step };
};
const short = n => { const a = Math.abs(n); return a >= 1e9 ? +(n / 1e9).toFixed(1) + 'B' : a >= 1e6 ? +(n / 1e6).toFixed(1) + 'M' : a >= 1e4 ? +(n / 1e3).toFixed(1) + 'K' : String(+n.toPrecision(6)); };

// SVG markup for a chart {type, range, title} of w × h px; ink and line are the text and gridline colours.
export function chartSVG(chart, sheet, book, w, h, { ink = '#333', ink2 = '#666', line = '#d9d9d9', bg = '#fff' } = {}) {
  const data = chartData(chart, sheet, book);
  const T = esc(chart.title || '');
  let s = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" font-family="Calibri, Carlito, 'Segoe UI', sans-serif"><rect width="${w}" height="${h}" fill="${bg}"/>`;
  const titleH = T ? 30 : 10;
  if (T) s += `<text x="${w / 2}" y="22" text-anchor="middle" font-size="15" fill="${ink}">${T}</text>`;
  if (!data || !data.series.length) return s + `<text x="${w / 2}" y="${h / 2}" text-anchor="middle" font-size="13" fill="${ink2}">Select cells with numbers to chart</text></svg>`;
  const { cats, series } = data, type = chart.type || 'column';
  const legendH = series.length > 1 || type === 'pie' || type === 'doughnut' ? 24 : 0;
  // Legend along the bottom.
  const legend = items => {
    let x = 0; const parts = items.map((it, i) => { const p = `<g transform="translate(${x} 0)"><rect y="-8" width="9" height="9" fill="${PALETTE[i % PALETTE.length]}"/><text x="13" y="0" font-size="12" fill="${ink2}">${esc(it)}</text></g>`; x += 22 + it.length * 6.4; return p; });
    return `<g transform="translate(${Math.max(8, (w - x) / 2)} ${h - 8})">${parts.join('')}</g>`;
  };
  if (type === 'pie' || type === 'doughnut') {
    const vals = series[0].vals.map(v => Math.max(0, v || 0)), total = vals.reduce((a, b) => a + b, 0) || 1;
    const cx = w / 2, cy = titleH + (h - titleH - legendH) / 2, r = Math.max(10, Math.min(w, h - titleH - legendH) / 2 - 12), ri = type === 'doughnut' ? r * 0.55 : 0;
    let a0 = -Math.PI / 2;
    vals.forEach((v, i) => {
      const a1 = a0 + (v / total) * Math.PI * 2, large = a1 - a0 > Math.PI ? 1 : 0;
      const P = (rr, a) => `${(cx + rr * Math.cos(a)).toFixed(2)} ${(cy + rr * Math.sin(a)).toFixed(2)}`;
      if (v > 0) {
        s += v === total
          ? `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${PALETTE[i % PALETTE.length]}"/>${ri ? `<circle cx="${cx}" cy="${cy}" r="${ri}" fill="${bg}"/>` : ''}`
          : `<path d="M${P(ri, a0)} L${P(r, a0)} A${r} ${r} 0 ${large} 1 ${P(r, a1)} L${P(ri, a1)} ${ri ? `A${ri} ${ri} 0 ${large} 0 ${P(ri, a0)}` : ''}Z" fill="${PALETTE[i % PALETTE.length]}" stroke="${bg}" stroke-width="1.5"/>`;
        const mid = (a0 + a1) / 2, pct = Math.round((v / total) * 100);
        if (pct >= 5) s += `<text x="${(cx + (ri ? (r + ri) / 2 : r * 0.62) * Math.cos(mid)).toFixed(1)}" y="${(cy + (ri ? (r + ri) / 2 : r * 0.62) * Math.sin(mid) + 4).toFixed(1)}" text-anchor="middle" font-size="12" fill="#fff">${pct}%</text>`;
      }
      a0 = a1;
    });
    return s + legend(cats) + '</svg>';
  }
  const all = series.flatMap(x => x.vals).filter(v => v != null);
  const horiz = type === 'bar';
  const { lo, hi, step } = nice(Math.min(0, ...all), Math.max(0, ...all));
  const L = horiz ? 12 + Math.min(110, Math.max(...cats.map(c => c.length)) * 6.5) : 46, R = 14, Tp = titleH + 6, B = (horiz ? 26 : 36) + legendH;
  const pw = Math.max(10, w - L - R), ph = Math.max(10, h - Tp - B);
  const scale = v => (v - lo) / (hi - lo || 1);
  // Gridlines and value axis.
  for (let v = lo; v <= hi + step / 2; v += step) {
    if (horiz) { const x = L + scale(v) * pw; s += `<path d="M${x} ${Tp}V${Tp + ph}" stroke="${line}"/><text x="${x}" y="${Tp + ph + 16}" text-anchor="middle" font-size="11" fill="${ink2}">${short(v)}</text>`; }
    else { const y = Tp + ph - scale(v) * ph; s += `<path d="M${L} ${y}H${L + pw}" stroke="${line}"/><text x="${L - 6}" y="${y + 4}" text-anchor="end" font-size="11" fill="${ink2}">${short(v)}</text>`; }
  }
  const n = cats.length, band = (horiz ? ph : pw) / Math.max(1, n);
  // Category labels, thinned out when crowded.
  const every = Math.max(1, Math.ceil(n / Math.max(1, Math.floor((horiz ? ph : pw) / (horiz ? 16 : 54)))));
  cats.forEach((c, i) => {
    if (i % every) return;
    const lab = esc(c.length > 14 ? c.slice(0, 13) + '…' : c);
    if (horiz) s += `<text x="${L - 6}" y="${Tp + band * (i + 0.5) + 4}" text-anchor="end" font-size="11" fill="${ink2}">${lab}</text>`;
    else s += `<text x="${L + band * (i + 0.5)}" y="${Tp + ph + 16}" text-anchor="middle" font-size="11" fill="${ink2}">${lab}</text>`;
  });
  const zero = horiz ? L + scale(0) * pw : Tp + ph - scale(0) * ph;
  if (type === 'column' || type === 'bar') {
    const k = series.length, gap = band * 0.2, bw = (band - gap * 2) / k;
    series.forEach((se, j) => se.vals.forEach((v, i) => {
      if (v == null) return;
      const p = horiz ? L + scale(v) * pw : Tp + ph - scale(v) * ph, o = band * i + gap + bw * j;
      s += horiz
        ? `<rect x="${Math.min(zero, p).toFixed(1)}" y="${(Tp + o).toFixed(1)}" width="${Math.abs(p - zero).toFixed(1)}" height="${Math.max(1, bw - 1).toFixed(1)}" fill="${PALETTE[j % PALETTE.length]}"/>`
        : `<rect x="${(L + o).toFixed(1)}" y="${Math.min(zero, p).toFixed(1)}" width="${Math.max(1, bw - 1).toFixed(1)}" height="${Math.abs(p - zero).toFixed(1)}" fill="${PALETTE[j % PALETTE.length]}"/>`;
    }));
  } else {
    series.forEach((se, j) => {
      const pts = se.vals.map((v, i) => (v == null ? null : [type === 'scatter' ? L + (i / Math.max(1, n - 1)) * pw : L + band * (i + 0.5), Tp + ph - scale(v) * ph]));
      const col = PALETTE[j % PALETTE.length], d = pts.filter(Boolean).map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join('');
      if (type === 'area' && d) { const f = pts.filter(Boolean); s += `<path d="${d}L${f[f.length - 1][0].toFixed(1)} ${zero}L${f[0][0].toFixed(1)} ${zero}Z" fill="${col}" fill-opacity=".35"/>`; }
      if (type !== 'scatter') s += `<path d="${d}" fill="none" stroke="${col}" stroke-width="2.25" stroke-linejoin="round"/>`;
      pts.forEach(p => { if (p) s += `<circle cx="${p[0].toFixed(1)}" cy="${p[1].toFixed(1)}" r="${type === 'scatter' ? 4 : 3}" fill="${col}"/>`; });
    });
  }
  s += horiz ? `<path d="M${zero} ${Tp}V${Tp + ph}" stroke="${ink2}"/>` : `<path d="M${L} ${zero}H${L + pw}" stroke="${ink2}"/>`;
  if (legendH) s += legend(series.map(x => x.name));
  return s + '</svg>';
}
