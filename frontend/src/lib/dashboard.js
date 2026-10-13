/* Dashboard blocks on the canvas: HTML (with <style> and <script>) shown live in a sandboxed frame,
   given `data` from a source:
     - 'flow': this file's workflow, run on the Workline server; data is what its last nodes output.
     - code blocks wired into the dashboard (an arrow from a code block to it): each one's result.
   The frame has no access to the app (sandbox without allow-same-origin), so a dashboard's script can
   only draw itself and fetch public URLs. A few helpers (cards, bars, line, pie, table) cover the usual
   widgets; anything else can load a chart library from a CDN. */

const MAX_ITEMS = 5000;

// What a code block gives a dashboard: its return value, else the last console line (parsed when it's JSON).
const RUNNER = `
const out = [];
const show = v => (typeof v === 'string' ? v : (() => { try { return JSON.stringify(v); } catch (e) { return String(v); } })());
console.log = console.info = console.warn = console.error = (...a) => out.push(a.map(show).join(' '));
onmessage = async e => {
  try {
    const value = await (0, eval)('(async () => {\\n' + e.data + '\\n})()');
    postMessage({ value, out });
  } catch (err) { postMessage({ error: String(err && err.message || err), out }); }
};`;

export function runForData(code, timeout = 8000) {
  const url = URL.createObjectURL(new Blob([RUNNER], { type: 'text/javascript' }));
  const w = new Worker(url);
  return new Promise(res => {
    const done = r => { clearTimeout(t); w.terminate(); URL.revokeObjectURL(url); res(r); };
    const t = setTimeout(() => done({ error: 'Stopped after 8 seconds without finishing.' }), timeout);
    w.onmessage = e => {
      const { value, out = [], error } = e.data || {};
      if (error) return done({ error });
      if (value !== undefined) return done({ data: value });
      const last = out[out.length - 1];
      if (last === undefined) return done({ data: null });
      try { done({ data: JSON.parse(last) }); } catch (_) { done({ data: last }); }
    };
    w.onerror = e => { e.preventDefault(); done({ error: e.message || 'The code failed to start.' }); };
    // A worker can't post functions or other things that don't clone; turn the result into plain JSON.
    w.postMessage(code);
  }).then(r => ('data' in r ? { data: plain(r.data) } : r));
}
const plain = v => { try { return v === undefined ? null : JSON.parse(JSON.stringify(v)); } catch (_) { return String(v); } };

// Data from several sources becomes one list: arrays are joined, anything else is one entry.
export const asList = parts => parts.flatMap(p => (Array.isArray(p) ? p : p == null ? [] : [p])).slice(0, MAX_ITEMS);

// Run this file's workflow and give back what its last nodes output (their items' json).
export async function runFlowForData(file, onStatus) {
  const { api, hasFeature } = await import('./backend.js');
  if (!(await hasFeature('flows'))) throw new Error('Workflows run on the Workline server. Sign in to use workflow data.');
  const flow = file.flow;
  if (!flow || !flow.nodes || !flow.nodes.length) throw new Error('This file has no workflow yet. Build one in the Workflow view.');
  const { getRun } = await import('./flows.js');
  const got = await api(`/flows/${encodeURIComponent(file.id)}/data`, { method: 'POST', body: { flow: JSON.parse(JSON.stringify(flow)) } });
  if (!got.pending) return got.items || [];
  // Still running after a minute: wait for it, then use what the run kept (a sample of each step).
  let r = { status: 'running', nodes: {} };
  for (let i = 0; i < 300 && r.status === 'running'; i++) {
    await new Promise(res => setTimeout(res, 2000));
    r = await getRun(got.runId);
    onStatus && onStatus(r);
  }
  if (r.status === 'running') throw new Error('The workflow is still running. Refresh again later.');
  if (r.status !== 'success') throw new Error(r.error || 'The workflow failed.');
  const done = n => r.nodes[n.id] && r.nodes[n.id].status === 'success';
  const ends = flow.nodes.filter(n => done(n) && !flow.edges.some(e => e.from === n.id && done({ id: e.to })));
  // A run keeps each node's output as its items' json (the first 20 per node).
  return ends.flatMap(n => r.nodes[n.id].output?.main || []).slice(0, MAX_ITEMS);
}

// Code blocks with an arrow into dashboard `id`, in the order they sit (top to bottom, then left to right).
export const wiredCode = (shapes, id) => {
  const from = new Set(shapes.filter(s => s.pts && s.a1 && s.a1.s === id && s.a0 && s.a0.s).map(s => s.a0.s));
  return shapes.filter(s => s.t === 'code' && from.has(s.id)).sort((a, b) => a.y - b.y || a.x - b.x);
};

// Keep cached data small enough to save with the file.
export const cacheable = data => { try { return JSON.stringify(data).length <= 200_000; } catch (_) { return false; } };

const HELPERS = `
const $ = s => (typeof s === 'string' ? document.querySelector(s) : s);
const fmt = v => (typeof v === 'number' ? v.toLocaleString(undefined, { maximumFractionDigits: 2 }) : v == null ? '' : String(v));
const escH = v => fmt(v).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const PALETTE = ['var(--c1)', 'var(--c2)', 'var(--c3)', 'var(--c4)', 'var(--c5)', 'var(--c6)'];
// cards('#el', [['Label', value], ...])
function cards(el, pairs) {
  $(el).innerHTML = '<div class="lw-cards">' + pairs.map(([k, v]) => '<div class="lw-card"><span>' + escH(k) + '</span><b>' + escH(v) + '</b></div>').join('') + '</div>';
}
// table('#el', rows, ['col', ...]?)
function table(el, rows, cols) {
  rows = rows || []; cols = cols || [...new Set(rows.flatMap(r => (r && typeof r === 'object' ? Object.keys(r) : [])))];
  $(el).innerHTML = '<table class="lw-table"><thead><tr>' + cols.map(c => '<th>' + escH(c) + '</th>').join('') + '</tr></thead><tbody>'
    + rows.slice(0, 500).map(r => '<tr>' + cols.map(c => '<td>' + escH(r && typeof r === 'object' ? (typeof r[c] === 'object' && r[c] !== null ? JSON.stringify(r[c]) : r[c]) : r) + '</td>').join('') + '</tr>').join('') + '</tbody></table>';
}
function frame(el, height) { const box = $(el); const w = Math.max(160, box.clientWidth || document.body.clientWidth - 24); return { box, w, h: height || 180 }; }
// bars('#el', rows, 'labelKey', 'valueKey', {height})
function bars(el, rows, x, y, o) {
  o = o || {}; const { box, w, h } = frame(el, o.height), vals = rows.map(r => +r[y] || 0), max = Math.max(1, ...vals), bw = Math.min(w / Math.max(1, rows.length), 90);
  box.innerHTML = '<svg class="lw-chart" width="' + w + '" height="' + (h + 20) + '">' + rows.map((r, i) => {
    const bh = (vals[i] / max) * (h - 16), bx = i * bw + bw * .15;
    return '<rect x="' + bx + '" y="' + (h - bh) + '" width="' + bw * .7 + '" height="' + bh + '" rx="3" fill="' + (o.color || PALETTE[0]) + '"><title>' + escH(r[x]) + ': ' + escH(vals[i]) + '</title></rect>'
      + '<text x="' + (bx + bw * .35) + '" y="' + (h - bh - 4) + '" text-anchor="middle" class="v">' + escH(vals[i]) + '</text>'
      + '<text x="' + (bx + bw * .35) + '" y="' + (h + 14) + '" text-anchor="middle">' + escH(r[x]) + '</text>';
  }).join('') + '</svg>';
}
// line('#el', rows, 'labelKey', 'valueKey', {height})
function line(el, rows, x, y, o) {
  o = o || {}; const { box, w, h } = frame(el, o.height), vals = rows.map(r => +r[y] || 0), max = Math.max(1, ...vals), min = Math.min(0, ...vals);
  const px = i => 12 + (rows.length < 2 ? (w - 24) / 2 : i * (w - 24) / (rows.length - 1)), py = v => 8 + (h - 16) * (1 - (v - min) / (max - min || 1));
  const d = vals.map((v, i) => (i ? 'L' : 'M') + px(i) + ' ' + py(v)).join('');
  box.innerHTML = '<svg class="lw-chart" width="' + w + '" height="' + (h + 20) + '"><path d="' + d + '" fill="none" stroke="' + (o.color || PALETTE[0]) + '" stroke-width="2.5" stroke-linejoin="round"/>'
    + vals.map((v, i) => '<circle cx="' + px(i) + '" cy="' + py(v) + '" r="3.5" fill="' + (o.color || PALETTE[0]) + '"><title>' + escH(rows[i][x]) + ': ' + escH(v) + '</title></circle><text x="' + px(i) + '" y="' + (h + 14) + '" text-anchor="middle">' + escH(rows[i][x]) + '</text>').join('') + '</svg>';
}
// pie('#el', rows, 'labelKey', 'valueKey', {height})
function pie(el, rows, x, y, o) {
  o = o || {}; const { box, h } = frame(el, o.height), vals = rows.map(r => Math.max(0, +r[y] || 0)), sum = vals.reduce((a, b) => a + b, 0) || 1, r = h / 2 - 4;
  let a0 = -Math.PI / 2, svg = '';
  vals.forEach((v, i) => {
    const a1 = a0 + (v / sum) * Math.PI * 2, big = a1 - a0 > Math.PI ? 1 : 0, p = a => [h / 2 + r * Math.cos(a), h / 2 + r * Math.sin(a)];
    const [x0, y0] = p(a0), [x1, y1] = p(a1);
    svg += vals.length === 1 ? '<circle cx="' + h / 2 + '" cy="' + h / 2 + '" r="' + r + '" fill="' + PALETTE[0] + '"/>'
      : '<path d="M' + h / 2 + ' ' + h / 2 + 'L' + x0 + ' ' + y0 + 'A' + r + ' ' + r + ' 0 ' + big + ' 1 ' + x1 + ' ' + y1 + 'Z" fill="' + PALETTE[i % 6] + '"><title>' + escH(rows[i][x]) + ': ' + escH(v) + '</title></path>';
    a0 = a1;
  });
  box.innerHTML = '<div class="lw-pie"><svg width="' + h + '" height="' + h + '">' + svg + '</svg><ul>' + rows.map((row, i) => '<li><i style="background:' + PALETTE[i % 6] + '"></i>' + escH(row[x]) + ' <b>' + escH(vals[i]) + '</b></li>').join('') + '</ul></div>';
}
`;

// The frame's document: theme colours, the helpers, `data`, then the block's own HTML.
export function dashboardDoc(html, data, theme = {}) {
  const t = { ink: '#1f2328', ink2: '#57606a', surface: '#ffffff', line: '#d0d7de', bg: '#ffffff', ...theme };
  const json = JSON.stringify(data == null ? [] : data).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>
:root{--ink:${t.ink};--ink2:${t.ink2};--surface:${t.surface};--line:${t.line};--c1:#3b82f6;--c2:#10b981;--c3:#f59e0b;--c4:#8b5cf6;--c5:#ef4444;--c6:#14b8a6;color-scheme:${t.dark ? 'dark' : 'light'}}
html,body{margin:0;background:${t.bg};color:var(--ink);font:13px/1.45 system-ui,-apple-system,Segoe UI,sans-serif}
body{padding:12px}
h1,h2,h3{margin:0 0 8px;font-weight:650}
.lw-cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(110px,1fr));gap:8px;margin-bottom:10px}
.lw-card{border:1px solid var(--line);border-radius:8px;padding:8px 10px;background:var(--surface)}
.lw-card span{display:block;color:var(--ink2);font-size:11px}
.lw-card b{font-size:20px;font-weight:650}
.lw-chart{display:block;overflow:visible}
.lw-chart text{font-size:10px;fill:var(--ink2)}
.lw-chart text.v{fill:var(--ink)}
.lw-table{border-collapse:collapse;width:100%;font-size:12px}
.lw-table th,.lw-table td{border-bottom:1px solid var(--line);padding:4px 6px;text-align:left;white-space:nowrap}
.lw-table th{color:var(--ink2);font-weight:600}
.lw-pie{display:flex;gap:14px;align-items:center}
.lw-pie ul{list-style:none;margin:0;padding:0;font-size:12px}
.lw-pie i{display:inline-block;width:9px;height:9px;border-radius:2px;margin-right:6px}
.lw-error{color:#d1242f;font:12px/1.4 ui-monospace,monospace;white-space:pre-wrap}
</style>
<script>
window.data = ${json};
${HELPERS}
window.addEventListener('error', e => { const p = document.createElement('div'); p.className = 'lw-error'; p.textContent = 'Error: ' + e.message; document.body.appendChild(p); });
</script></head><body>
${html || ''}
</body></html>`;
}
