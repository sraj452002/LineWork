/* Pages built from workflow nodes, without code.
   - "Page" (trigger.page) gives the workflow a link (/api/hook/<path>). Opening it runs the workflow with
     {action: 'open', query, form: {}}; sending one of its forms runs it again with {action: <the form's
     name>, query, form: {answers}}, so IF nodes can branch on what happened.
   - The UI nodes each add a block to that page from the items reaching them, and pass the items on:
     Text, Cards, Table, Chart, Image or video, Buttons, Form. Blocks show in the order the nodes run.
   The page is rendered here as plain HTML and SVG: no scripts, everything escaped, so it's safe to show
   anyone, and it's served as a sandbox (flows.js) on top of that. */
import { FlowError } from './flow-engine.js';
import { formFields } from './flow-triggers.js';
import { COL, extent, fileOf, rid, sheetOf } from './flow-workline.js';
import { cellValue, csvRows } from './flow-extra.js';
import { randomBytes } from 'node:crypto';

const MAX_BLOCKS = 60, MAX_ROWS = 500;
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const show = v => (v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v));
const num = v => (typeof v === 'number' ? v : Number(String(v ?? '').replace(/[, ]/g, '')) || 0);
const fmt = v => (typeof v === 'number' ? v.toLocaleString('en-US', { maximumFractionDigits: 2 }) : show(v));
// Only web addresses and links within the page (?…, #…) become links and media.
const safeUrl = u => { const s = String(u ?? '').trim(); return /^https?:\/\//i.test(s) || /^[?#]/.test(s) ? s : ''; };
// Custom looks: CSS on a block (the node's Style field) and on the page (the Page trigger's). It can't
// break out of its attribute or <style>, and the page runs no scripts, so it only changes the look.
const cssOf = v => String(v ?? '').replace(/[<>]/g, '').slice(0, 4000);
const slug = s => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'block';
const add = (args, block) => {
  const page = args.ctx && args.ctx.page;
  // (A block that brings its own css (the Code block, whose params aren't expressions) skips filling them in.)
  if (page && page.blocks.length < MAX_BLOCKS) page.blocks.push({ node: args.node.name, ...block, css: cssOf('css' in block ? block.css : first(args).css) });
  return { main: args.items };
};
const first = args => args.params(args.items[0], 0);

/* ---- Code blocks: a part of the page in your own HTML, React or Vue ----
   The page itself has no scripts, so a code block is a document of its own, kept here for a while and
   served at /api/hook/code/<id> (flows.js) into a sandboxed frame on the page: scripts run there, from
   the page's items and React or Vue from a CDN, with no access to the page, its cookies or the person. */
const CODE = new Map(), CODE_TTL = 60 * 60_000, CODE_MAX = 1000;
export const codeBlock = id => { const c = CODE.get(String(id)); return c && Date.now() - c.at < CODE_TTL ? c.html : null; };
const keepCode = html => {
  const now = Date.now();
  for (const [k, v] of CODE) if (now - v.at > CODE_TTL || CODE.size >= CODE_MAX) CODE.delete(k); else break;
  const id = randomBytes(16).toString('hex');
  CODE.set(id, { html, at: now });
  return id;
};
const jsonIn = v => JSON.stringify(v).replace(/</g, '\\u003c');
const LIBS = {
  react: '<script src="https://unpkg.com/react@18.3.1/umd/react.production.min.js"></script><script src="https://unpkg.com/react-dom@18.3.1/umd/react-dom.production.min.js"></script><script src="https://unpkg.com/@babel/standalone@7.24.7/babel.min.js"></script>',
  vue: '<script src="https://unpkg.com/vue@3.4.38/dist/vue.global.prod.js"></script>',
};
export function codeDoc(framework, code, items) {
  const src = String(code || '');
  const head = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>html{color-scheme:dark light}body{margin:0;background:transparent;font:15px/1.5 system-ui,-apple-system,Segoe UI,sans-serif}</style><script>window.items=${jsonIn(items)};window.item=window.items[0]||{};addEventListener('error',function(e){var d=document.createElement('pre');d.style.cssText='color:#ff8080;white-space:pre-wrap;font:12px monospace';d.textContent=String(e.message||e);document.body.appendChild(d)});</script>`;
  if (framework === 'vue') return `${head}${LIBS.vue}</head><body><div id="app"></div><script>${src.replace(/<\/script/gi, '<\\/script')}
;(function(){var a=Vue.createApp(typeof App!=='undefined'?App:{template:'<p>Name your component App.</p>'});a.config.globalProperties.items=window.items;a.config.globalProperties.item=window.item;a.mount('#app')})();</script></body></html>`;
  if (framework === 'html') return `${head}</head><body>${src}</body></html>`;
  return `${head}${LIBS.react}</head><body><div id="root"></div><script type="text/babel" data-presets="react">${src.replace(/<\/script/gi, '<\\/script')}
;ReactDOM.createRoot(document.getElementById('root')).render(typeof App !== 'undefined' ? <App items={window.items} item={window.item} /> : <p>Name your component App.</p>);</script></body></html>`;
}

/* ---- a little Markdown: # headings, **bold**, *italic*, `code`, [links](…), - lists, paragraphs ---- */
function inline(s) {
  return esc(s)
    .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/\*(.+?)\*/g, '<i>$1</i>').replace(/`(.+?)`/g, '<code>$1</code>')
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (m, t, u) => { const href = safeUrl(u.replace(/&amp;/g, '&')); return href ? `<a href="${esc(href)}">${t}</a>` : t; });
}
export function markdown(text) {
  const out = [];
  let list = null, para = [];
  const flush = () => { if (para.length) out.push(`<p>${para.map(inline).join('<br>')}</p>`); para = []; if (list) { out.push(`<ul>${list.join('')}</ul>`); list = null; } };
  for (const raw of String(text ?? '').split('\n')) {
    const l = raw.trimEnd(), h = /^(#{1,3})\s+(.*)$/.exec(l), li = /^\s*[-*]\s+(.*)$/.exec(l);
    if (!l.trim()) { flush(); continue; }
    if (h) { flush(); out.push(`<h${h[1].length + 1}>${inline(h[2])}</h${h[1].length + 1}>`); continue; }
    if (li) { if (para.length) { out.push(`<p>${para.map(inline).join('<br>')}</p>`); para = []; } (list ||= []).push(`<li>${inline(li[1])}</li>`); continue; }
    if (list) { out.push(`<ul>${list.join('')}</ul>`); list = null; }
    para.push(l);
  }
  flush();
  return out.join('');
}

/* ---- charts, drawn as SVG ---- */
const COLORS = ['#4f7cff', '#16b38a', '#f59e0b', '#8b5cf6', '#ef4444', '#14b8a6', '#ec4899', '#64748b'];
function chart({ kind, rows, label, value }) {
  const vals = rows.map(r => num(r[value])), labels = rows.map(r => show(r[label]));
  if (!rows.length) return '<p class="muted">Nothing to chart.</p>';
  if (kind === 'pie') {
    const sum = vals.reduce((a, b) => a + Math.max(0, b), 0) || 1, r = 90, c = 100;
    let a0 = -Math.PI / 2, paths = '';
    vals.forEach((v, i) => {
      const a1 = a0 + (Math.max(0, v) / sum) * Math.PI * 2, big = a1 - a0 > Math.PI ? 1 : 0;
      const p = a => `${(c + r * Math.cos(a)).toFixed(1)} ${(c + r * Math.sin(a)).toFixed(1)}`;
      paths += vals.length === 1 ? `<circle cx="${c}" cy="${c}" r="${r}" fill="${COLORS[0]}"/>` : `<path d="M${c} ${c}L${p(a0)}A${r} ${r} 0 ${big} 1 ${p(a1)}Z" fill="${COLORS[i % COLORS.length]}"><title>${esc(labels[i])}: ${esc(fmt(v))}</title></path>`;
      a0 = a1;
    });
    return `<div class="pie"><svg viewBox="0 0 200 200" width="200" height="200" role="img">${paths}</svg><ul>${labels.map((l, i) => `<li><i style="background:${COLORS[i % COLORS.length]}"></i>${esc(l)} <b>${esc(fmt(vals[i]))}</b></li>`).join('')}</ul></div>`;
  }
  const W = 720, H = 240, top = 22, bottom = 30, max = Math.max(1, ...vals), min = Math.min(0, ...vals), span = max - min || 1, n = rows.length;
  const y = v => top + (H - top - bottom) * (1 - (v - min) / span);
  let body = '';
  if (kind === 'line') {
    const x = i => 30 + (n < 2 ? (W - 60) / 2 : i * (W - 60) / (n - 1));
    body = `<path d="${vals.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join('')}" fill="none" stroke="${COLORS[0]}" stroke-width="3" stroke-linejoin="round"/>`
      + vals.map((v, i) => `<circle cx="${x(i).toFixed(1)}" cy="${y(v).toFixed(1)}" r="4" fill="${COLORS[0]}"><title>${esc(labels[i])}: ${esc(fmt(v))}</title></circle><text x="${x(i).toFixed(1)}" y="${H - 10}" text-anchor="middle">${esc(labels[i]).slice(0, 14)}</text>`).join('');
  } else {
    const bw = W / n, w = Math.min(bw * .7, 70);
    body = vals.map((v, i) => {
      const bx = i * bw + (bw - w) / 2, by = y(Math.max(v, 0)), bh = Math.abs(y(v) - y(0));
      return `<rect x="${bx.toFixed(1)}" y="${by.toFixed(1)}" width="${w.toFixed(1)}" height="${Math.max(bh, 1).toFixed(1)}" rx="4" fill="${COLORS[0]}"><title>${esc(labels[i])}: ${esc(fmt(v))}</title></rect>`
        + `<text x="${(bx + w / 2).toFixed(1)}" y="${(by - 6).toFixed(1)}" text-anchor="middle" class="v">${esc(fmt(v))}</text><text x="${(bx + w / 2).toFixed(1)}" y="${H - 10}" text-anchor="middle">${esc(labels[i]).slice(0, 14)}</text>`;
    }).join('');
  }
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet" role="img">${body}</svg>`;
}

/* ---- the Editor node's helpers ---- */
// What a Workline file is, from what it holds and how it was last shown.
const KIND_WORD = { doc: 'Doc', sheet: 'Sheet', diagram: 'Diagram', code: 'Code' };
function kindOf(f) {
  const hasDoc = !!String(f.doc || '').trim();
  const hasSheet = (f.sheets || []).some(s => Object.values(s.cells || {}).some(v => v !== ''));
  const hasDiagram = (f.diagrams || []).some(d => String(d.code || '').trim());
  const hasCode = Array.isArray(f.code?.files) && f.code.files.length > 0;
  if (f.view === 'code' && hasCode) return 'code';
  if (f.view === 'sheet' && (f.sheets || []).length) return 'sheet';
  if ((f.view === 'canvas' || f.view === 'diagram') && (f.diagrams || []).length) return 'diagram';
  if (hasDoc) return 'doc';
  if (hasSheet) return 'sheet';
  if (hasCode) return 'code';
  if (hasDiagram) return 'diagram';
  return 'doc';
}
// A whole file, as the next steps (an email attachment, a Drive upload) take it.
const asFile = (name, type, text) => { const buf = Buffer.from(String(text ?? ''), 'utf8'); return { name: String(name).replace(/[\\/:*?"<>|]+/g, '-').slice(0, 120), type, size: buf.length, data: buf.toString('base64') }; };
const bufFile = (name, type, buf) => ({ name: String(name).replace(/[\\/:*?"<>|]+/g, '-').slice(0, 120), type, size: buf.length, data: buf.toString('base64') });
/* A file uploaded on the page (Editor, “A file you upload here”): it becomes a Workline file to edit
   (a sheet for .csv/.tsv/.xlsx, a doc for .md/.txt and other text, a code file for code), remembered with
   the node it came from and a key, so only its own link (?doc=…&k=…) opens it again. */
const UPLOAD_MAX = 3 * 2 ** 20;
const CODE_EXT = new Set('js mjs cjs ts jsx tsx py html htm css scss json xml yaml yml sql sh bash java c h cpp hpp cs go rs rb php ini toml env log svg kt swift dart lua r pl'.split(' '));
// A file's contents, ready to edit: a sheet's cells (.csv/.tsv/.xlsx), or text (a doc, or code by its extension).
async function parseFile(up) {
  const name = String(up?.name || 'file').slice(0, 120), ext = (name.includes('.') ? name.split('.').pop() : '').toLowerCase();
  const buf = Buffer.from(String(up?.data || '').replace(/^data:[^,]*,/, ''), 'base64');
  const type = up?.type || 'application/octet-stream';
  if (!buf.length) throw new FlowError(`“${name}” is empty.`, 'bad_file');
  if (buf.length > UPLOAD_MAX) throw new FlowError(`“${name}” is ${(buf.length / 2 ** 20).toFixed(1)} MB: a file can be at most 3 MB.`, 'too_large');
  const cellsOf = rows => {
    const cells = {};
    rows.slice(0, 2000).forEach((r, i) => (r || []).slice(0, 26).forEach((v, c) => { const t = v == null ? '' : String(v instanceof Date ? v.toISOString().slice(0, 10) : v); if (t !== '') cells[`${COL(c)}${i + 1}`] = t; }));
    return cells;
  };
  if (ext === 'csv' || ext === 'tsv') return { kind: 'sheet', format: ext, name, type, sheet: 'Sheet1', cells: cellsOf(csvRows(buf.toString('utf8').replace(/^﻿/, ''), ext === 'tsv' ? '\t' : ',')) };
  if (ext === 'xlsx') {
    const { default: ExcelJS } = await import('exceljs');
    const wb = new ExcelJS.Workbook();
    try { await wb.xlsx.load(buf); } catch (e) { throw new FlowError(`“${name}” couldn’t be read as an Excel file.`, 'bad_file'); }
    const ws = wb.worksheets[0], rows = [];
    if (ws) ws.eachRow({ includeEmpty: true }, (row, n) => { rows[n - 1] = row.values.slice(1).map(cellValue); });
    return { kind: 'sheet', format: 'xlsx', name, type, sheet: ws?.name || 'Sheet1', cells: cellsOf(Array.from(rows, r => r || [])) };
  }
  // Text of any kind; a file with NUL bytes (a picture, a PDF, a Word file) can't be edited as text.
  if (buf.subarray(0, 8000).includes(0)) throw new FlowError(`“${name}” isn’t a file that can be edited here. Use text, Markdown, CSV, Excel (.xlsx), JSON or code.`, 'bad_file');
  const text = buf.toString('utf8').replace(/^﻿/, '').replace(/\r\n?/g, '\n');
  return { kind: CODE_EXT.has(ext) ? 'code' : 'doc', format: 'text', name, type, text };
}
// The whole file again, from what was edited, in the format it came in.
async function buildFile(m, cells, text) {
  if (m.kind === 'sheet') {
    if (m.format === 'xlsx') {
      const { default: ExcelJS } = await import('exceljs');
      const wb = new ExcelJS.Workbook(), ws = wb.addWorksheet(m.sheet || 'Sheet1'), e = extent(cells || {});
      for (let r = 0; r < e.rows; r++) ws.addRow(Array.from({ length: e.cols }, (_, c) => { const v = (cells || {})[`${COL(c)}${r + 1}`] ?? ''; return v !== '' && /^-?\d+(\.\d+)?$/.test(v) ? Number(v) : v; }));
      return bufFile(m.name, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', Buffer.from(await wb.xlsx.writeBuffer()));
    }
    return bufFile(m.name, m.format === 'tsv' ? 'text/tab-separated-values' : 'text/csv', Buffer.from(toCsv(cells || {}, m.format === 'tsv' ? '\t' : ','), 'utf8'));
  }
  return bufFile(m.name, m.type && m.type !== 'application/octet-stream' ? m.type : mimeOf(m.name), Buffer.from(String(text ?? ''), 'utf8'));
}
async function importUpload(args, up) {
  const m = await parseFile(up), now = Date.now();
  const base = { id: rid('f'), title: m.name, created: now, updated: now, doc: '', diagrams: [{ id: rid('d'), type: 'architecture', name: 'Diagram 1', code: '', manual: {}, dir: 'LR', style: 'color' }], active: 0,
    upload: { node: args.node.id, key: randomBytes(12).toString('hex'), name: m.name, type: m.type, format: m.format } };
  if (m.kind === 'sheet') { const e = extent(m.cells); return { ...base, view: 'sheet', sheets: [{ id: rid('s'), name: m.sheet, rows: Math.max(100, e.rows + 20), cols: Math.max(26, e.cols), cells: m.cells }] }; }
  if (m.kind === 'code') return { ...base, view: 'code', code: { files: [{ id: rid('cf'), path: m.name, text: m.text }], folders: [], open: [], active: null } };
  return { ...base, view: 'doc', doc: m.text };
}
// The edited file, back in the format it came in.
async function exportUpload(f, kind) {
  const u = f.upload, m = { kind, format: u.format, name: u.name, type: u.type, sheet: (f.sheets || [])[0]?.name };
  return buildFile(m, (f.sheets || [])[0]?.cells, kind === 'code' ? f.code?.files?.[0]?.text : f.doc);
}
// The first thing in an item that looks like a file: {name, data} (a Run by hand or Form (file) field).
const fileIn = json => { for (const v of Object.values(json || {})) if (v && typeof v === 'object' && typeof v.data === 'string' && v.name) return v; return null; };
const toCsv = (cells, sep = ',') => {
  const e = extent(cells), q = v => { const t = String(v ?? ''); return /[",\n\r\t]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t; };
  return Array.from({ length: e.rows }, (_, r) => Array.from({ length: e.cols }, (_, c) => q(cells[`${COL(c)}${r + 1}`])).join(sep)).join('\n');
};
const MIME = { js: 'text/javascript', mjs: 'text/javascript', ts: 'text/plain', jsx: 'text/plain', tsx: 'text/plain', py: 'text/x-python', html: 'text/html', css: 'text/css', json: 'application/json', md: 'text/markdown', csv: 'text/csv', xml: 'application/xml', svg: 'image/svg+xml', yml: 'text/yaml', yaml: 'text/yaml', sql: 'text/plain', txt: 'text/plain' };
const mimeOf = path => MIME[(String(path).split('.').pop() || '').toLowerCase()] || 'text/plain';

// The data from the step before, to check or change (Editor “Which: The data from the step before”): all
// the items as JSON, or one field of the first item as text. Save & continue passes the edited data on.
const JSON_MAX = 400_000;
function editData(args, p, item) {
  const e = item._edited;
  if (e && typeof e === 'object' && e.kind === 'data') {
    if (e.field) {
      const base = e.base && typeof e.base === 'object' ? e.base : {};
      return { main: [{ json: { ...base, [e.field]: String(e.text ?? '').replace(/\r\n?/g, '\n') } }] };
    }
    let v;
    try { v = JSON.parse(String(e.text ?? '')); } catch (x) { throw new FlowError(`The edited data isn’t valid JSON (${x.message}). Run it again and fix it in the card.`, 'bad_param'); }
    const list = Array.isArray(v) ? v : [v];
    return { main: list.map(j => ({ json: j && typeof j === 'object' && !Array.isArray(j) ? j : { value: j } })) };
  }
  const items = args.items.map(i => i.json || {});
  const field = String(p.field || '').trim();
  let card;
  if (field) {
    const base = items[0] || {}, v = base[field];
    card = { kind: 'data', field, base, text: v == null ? '' : typeof v === 'object' ? JSON.stringify(v, null, 2) : String(v), name: field, mono: typeof v === 'object' };
  } else {
    const text = JSON.stringify(items.length === 1 ? items[0] : items, null, 2);
    if (text.length > JSON_MAX) throw new FlowError('That’s too much data to edit in a card (over 400 KB). Pick one field to edit (Field), or fewer items.', 'too_big');
    card = { kind: 'data', text, name: items.length === 1 ? 'The data' : `${items.length} items`, mono: true };
  }
  card.title = card.name;
  return { main: [], editor: [{ json: { ...card, button: p.button || 'Save & continue', heading: p.title || '' } }] };
}

/* The full Workline tool for a file (Editor “Open in: the full Workline tool”, and the Course / Doc / Sheet /
   Diagram / Code / Workflow editor nodes): the run stops and the app opens the file in its own tool (the
   Course editor for a course, the Sheet for a spreadsheet…). The app turns the file into a Workline file and,
   on Save & continue, back into a file of its kind ({_edited: {tool, file}}); a Workline file is saved back. */
export const TOOL_VIEWS = ['course', 'doc', 'sheet', 'canvas', 'code', 'flow'];
const TOOL_MAX = 20 * 2 ** 20;
const isUpload = v => v && typeof v === 'object' && typeof v.data === 'string' && typeof v.name === 'string';
async function toolEditor(args, p, view) {
  const item = args.items[0]?.json || {}, e = item._edited;
  const want = TOOL_VIEWS.includes(view) ? view : TOOL_VIEWS.includes(p.view) ? p.view : 'auto';
  if (e && typeof e === 'object' && e.tool) {
    let fileId = null;
    // Only the Workline file this node is set to edit is saved back (never one the edit names).
    if (p.source === 'file' && e.wfile && typeof e.wfile === 'object' && p.fileId) {
      const f = await fileOf(args, p.fileId);
      const next = { ...e.wfile, id: f.id, created: f.created };
      if (JSON.stringify(next).length > 4_000_000) throw new FlowError(`“${f.title}” would be over 4 MB.`, 'too_large');
      await args.ctx.files.save(next); fileId = f.id;
    }
    const file = isUpload(e.file) ? { name: String(e.file.name).slice(0, 200), type: String(e.file.type || 'application/octet-stream').slice(0, 120), size: Number(e.file.size) || Math.round(e.file.data.length * 0.75), data: e.file.data } : null;
    if (file && file.data.length > TOOL_MAX * 1.4) throw new FlowError('The edited file is over 20 MB.', 'too_large');
    return { main: [{ json: { file, name: file?.name || '', kind: e.view || want, ...(fileId ? { fileId } : {}), saved: true } }] };
  }
  const card = { tool: true, view: want, button: p.button || 'Save & continue', heading: p.title || '' };
  if (p.source === 'file') {
    const f = await fileOf(args, p.fileId);
    Object.assign(card, { wfile: f, fileId: f.id, name: f.title, title: f.title });
  } else if (p.source === 'blank') {
    Object.assign(card, { blank: true, name: p.title || 'Untitled', title: p.title || 'Untitled' });
  } else {
    const up = isUpload(p.input) ? p.input : fileIn(item);
    if (!up) {
      if (want === 'auto') throw new FlowError('No file reached the Editor. Add a file field to Run by hand (like “File* (file)”), or set its File to {{ $json.yourField }}.', 'missing');
      Object.assign(card, { blank: true, name: p.title || 'Untitled', title: p.title || 'Untitled' });
    } else {
      if (up.data.length > TOOL_MAX * 1.4) throw new FlowError(`“${up.name}” is over 20 MB: too big to open here.`, 'too_large');
      Object.assign(card, { upload: { name: up.name, type: up.type || '', size: up.size || 0, data: up.data }, name: up.name, title: up.name });
    }
  }
  return { main: [], editor: [{ json: card }] };
}

async function editInApp(args, p) {
  const item = args.items[0]?.json || {};
  if (p.open === 'tool' || item._edited?.tool) return toolEditor(args, p);
  if (p.source === 'data' || item._edited?.kind === 'data') return editData(args, p, item);
  if (item._edited && typeof item._edited === 'object') {
    const e = item._edited, cells = e.cells && typeof e.cells === 'object' ? e.cells : {}, text = String(e.text ?? '').replace(/\r\n?/g, '\n');
    let file;
    if (e.fileId) {
      // A Workline file: write the edit back, then give the whole file.
      const f = await fileOf(args, e.fileId);
      if (e.kind === 'sheet') {
        const sh = sheetOf(f, e.sheet);
        sh.cells = Object.fromEntries(Object.entries(cells).filter(([a, v]) => /^[A-Z]{1,2}\d{1,4}$/.test(a) && String(v) !== '').map(([a, v]) => [a, String(v)]));
        const x = extent(sh.cells); sh.rows = Math.max(sh.rows || 100, x.rows + 20); sh.cols = Math.max(sh.cols || 26, x.cols);
        file = asFile(`${f.title}${(f.sheets || []).length > 1 ? ` - ${sh.name}` : ''}.csv`, 'text/csv', toCsv(sh.cells));
      } else if (e.kind === 'code') {
        const cf = (f.code?.files || []).find(x => x.path === e.path);
        if (!cf) throw new FlowError(`“${e.path}” isn’t in “${f.title}” any more.`, 'not_found');
        cf.text = text; file = asFile(cf.path.split('/').pop(), mimeOf(cf.path), text);
      } else if (e.kind === 'diagram') {
        f.diagrams = Array.isArray(f.diagrams) ? f.diagrams : [];
        let d = f.diagrams.find(x => x.name === e.diagram);
        if (d) d.code = text; else { d = { id: rid('d'), type: 'architecture', name: e.diagram || 'Diagram 1', code: text, manual: {}, dir: 'LR', style: 'color' }; f.diagrams.push(d); }
        file = asFile(`${f.title} - ${d.name}.txt`, 'text/plain', text);
      } else { f.doc = text; file = asFile(`${f.title}.md`, 'text/markdown', text); }
      await args.ctx.files.save(f);
    } else file = await buildFile(e, cells, text);
    return { main: [{ json: { file, name: file.name, kind: e.kind, saved: true } }] };
  }
  let card;
  if (p.source === 'file') {
    const f = await fileOf(args, p.fileId);
    const kind = ['doc', 'sheet', 'diagram', 'code'].includes(p.part) ? p.part : kindOf(f);
    if (kind === 'sheet') { const sh = sheetOf(f, p.sheet); card = { kind, cells: sh.cells || {}, sheet: sh.name, name: `${f.title}.csv` }; }
    else if (kind === 'code') {
      const files = f.code?.files || [], cf = files.find(x => x.path === p.path) || files.find(x => x.id === f.code?.active) || files[0];
      if (!cf) throw new FlowError(`“${f.title}” has no code files yet.`, 'not_found');
      card = { kind, text: cf.text || '', path: cf.path, name: cf.path.split('/').pop() };
    } else if (kind === 'diagram') {
      const d = (f.diagrams || []).find(x => x.name === p.diagram) || (f.diagrams || []).find(x => String(x.code || '').trim()) || (f.diagrams || [])[0];
      card = { kind, text: d?.code || '', diagram: d?.name || 'Diagram 1', name: `${f.title} - ${d?.name || 'Diagram 1'}.txt` };
    } else card = { kind: 'doc', text: f.doc || '', name: `${f.title}.md` };
    Object.assign(card, { fileId: f.id, title: f.title });
  } else {
    // A file from the step before: the one named in “File”, else the first file in the item.
    const up = p.input && typeof p.input === 'object' && typeof p.input.data === 'string' ? p.input : fileIn(item);
    if (!up) throw new FlowError('No file reached the Editor. Add a file field to Run by hand (like “File* (file)”), or set the Editor’s File to {{ $json.yourField }}.', 'missing');
    card = await parseFile(up);
    card.title = card.name;
  }
  return { main: [], editor: [{ json: { ...card, button: p.button || 'Save & continue', heading: p.title || '' } }] };
}

/* ---- the nodes ---- */
const STYLE_OPTS = ['text', 'heading', 'note'];
export const UI_NODES = {
  'trigger.page': {
    // Opened at its link: flows.js runs the workflow and draws the page; a hook so it gets a link.
    page: true, hook: () => ({ respond: { status: 405, body: { error: 'page' } } }),
    run: ({ items }) => ({ main: items }),
  },
  'ui.text': { run: args => {
    const p = first(args), style = STYLE_OPTS.includes(p.style) ? p.style : 'text';
    return add(args, { kind: 'text', style, html: markdown(p.text) });
  } },
  'ui.cards': { run: args => {
    const p = first(args);
    const cards = (Array.isArray(p.cards) ? p.cards : []).filter(c => c && String(c.name || '').trim()).slice(0, 12).map(c => ({ label: String(c.name), value: c.value }));
    if (!cards.length) throw new FlowError('Add at least one card: a label and its value.', 'missing');
    return add(args, { kind: 'cards', title: p.title || '', cards });
  } },
  'ui.table': { run: args => {
    const p = first(args), rows = args.items.slice(0, Number(p.max) > 0 ? Math.min(Number(p.max), MAX_ROWS) : 100).map(x => x.json);
    const cols = String(p.columns || '').split(',').map(s => s.trim()).filter(Boolean);
    return add(args, { kind: 'table', title: p.title || '', columns: cols.length ? cols : [...new Set(rows.flatMap(r => (r && typeof r === 'object' ? Object.keys(r) : [])))].slice(0, 20), rows, more: Math.max(0, args.items.length - rows.length) });
  } },
  'ui.chart': { run: args => {
    const p = first(args);
    if (!p.value) throw new FlowError('Fill in the field holding the numbers.', 'missing');
    return add(args, { kind: 'chart', title: p.title || '', chart: chart({ kind: ['bar', 'line', 'pie'].includes(p.type) ? p.type : 'bar', rows: args.items.slice(0, 60).map(x => x.json), label: p.label || '', value: p.value }) });
  } },
  'ui.media': { run: args => {
    const all = p0 => (p0.layout === 'gallery' ? args.items.slice(0, 48) : args.items.slice(0, 1));
    const p0 = first(args);
    const media = all(p0).map((it, i) => { const p = args.params(it, i); return { url: safeUrl(p.url), caption: p.caption ? String(p.caption) : '', link: safeUrl(p.link), kind: p.kind === 'video' || (p.kind !== 'image' && /\.(mp4|webm|ogg|mov|m4v)(\?|$)/i.test(String(p.url || ''))) ? 'video' : 'image', poster: safeUrl(p.poster) }; }).filter(m => m.url);
    return add(args, { kind: 'media', layout: p0.layout === 'gallery' ? 'gallery' : 'one', media });
  } },
  'ui.buttons': { run: args => {
    const p = first(args);
    const buttons = (Array.isArray(p.buttons) ? p.buttons : []).filter(b => b && String(b.name || '').trim()).slice(0, 20).map(b => ({ label: String(b.name), href: safeUrl(b.value) }));
    return add(args, { kind: 'buttons', buttons });
  } },
  'ui.code': { run: args => {
    // The code as written: {{ }} in it is React's and Vue's, not an expression.
    const raw = args.node.params || {}, p = raw;
    const fw = ['react', 'vue', 'html'].includes(raw.framework) ? raw.framework : 'react';
    let items = args.items.slice(0, MAX_ROWS).map(x => x.json);
    while (items.length > 1 && JSON.stringify(items).length > 400_000) items = items.slice(0, Math.ceil(items.length / 2));
    const id = keepCode(codeDoc(fw, String(raw.code || '').slice(0, 100_000), items));
    return add(args, { kind: 'code', id, height: Math.min(4000, Math.max(60, Number(p.height) || 320)), title: String(p.title || args.node.name || 'Code block'), css: p.css || '' });
  } },
  /* An editor for one of your Workline files, on the page. It looks at the file to see what it is (or uses
     what's picked): a doc (its text in a big box), a sheet (a grid of cells), a diagram (its code) or a code
     project (one of its files, with the others as tabs). Save (a POST with this node's action) writes the
     changes back to the file, then draws it again with “Saved”. Either way the page offers the whole file to
     download, and the node gives it to the next steps as {name, type, size, data} (data in base64). */
  'ui.editor': { run: async args => {
    const p = first(args), page = args.ctx?.page || {}, query = page.query || {};
    // Not on a page (Run, Run by hand, a schedule…): the run stops here and the app shows an editor card.
    // “Save & continue” runs it again from this node with what was edited ({_edited}): the node then gives
    // the whole file, edited, to the next steps (and saves a Workline file back).
    if (page.action == null || p.source === 'data' || p.open === 'tool') return editInApp(args, p);
    let f, qs = '';
    if (p.source === 'upload') {
      // A file uploaded here: the upload box until one is sent, then its editor (on its own link).
      const open = `open-${args.node.id}`, title = p.title || 'Edit a file';
      const box = error => { add(args, { kind: 'editor', part: 'upload', title, action: open, error, button: 'Open' }); return { main: [{ json: { saved: false, file: null } }] }; };
      if (page.action === open) {
        const up = (page.files || {}).upload;
        if (!up) return box('Choose a file first.');
        try { f = await importUpload(args, up); } catch (e) { if (e instanceof FlowError) return box(e.message); throw e; }
        await args.ctx.files.save(f);
      } else if (query.doc) {
        const got = await args.ctx.files.read(String(query.doc)).catch(() => null);
        if (got && got.upload && got.upload.node === args.node.id && got.upload.key === String(query.k || '')) f = got;
        else return box('That file isn’t here any more. Upload it again.');
      } else return box('');
      qs = `doc=${encodeURIComponent(f.id)}&k=${encodeURIComponent(f.upload.key)}`;
    } else f = await fileOf(args, p.fileId);
    const kind = !f.upload && ['doc', 'sheet', 'diagram', 'code'].includes(p.part) ? p.part : kindOf(f);
    const action = String(p.action || `save-${args.node.id}`).slice(0, 60);
    const saving = page.action === action, form = page.form || {};
    const lf = v => String(v ?? '').replace(/\r\n?/g, '\n');
    let saved = false, block, out;
    if (kind === 'sheet') {
      const sh = sheetOf(f, p.sheet);
      sh.cells ||= {};
      if (saving) {
        // Only the cells the grid showed: c_<address> for each; an emptied cell is cleared.
        for (const [k, v] of Object.entries(form)) {
          const m = /^c_([A-Z]{1,2}\d{1,4})$/.exec(k);
          if (!m) continue;
          const val = String(v ?? '');
          if (val === '') delete sh.cells[m[1]]; else sh.cells[m[1]] = val;
        }
        const e = extent(sh.cells);
        sh.rows = Math.max(sh.rows || 100, e.rows + 20); sh.cols = Math.max(sh.cols || 26, e.cols);
        await args.ctx.files.save(f); saved = true;
      }
      const e = extent(sh.cells);
      // What's there, plus room to add: 3 more rows and 1 more column (at most 200 × 26).
      const rows = Math.min(200, Math.max(e.rows + 3, 6)), cols = Math.min(26, Math.max(e.cols + 1, 3));
      const grid = Array.from({ length: rows }, (_, r) => Array.from({ length: cols }, (_, c) => { const a = `${COL(c)}${r + 1}`; return { a, v: sh.cells[a] ?? '' }; }));
      block = { part: 'sheet', grid, cols: Array.from({ length: cols }, (_, c) => COL(c)), label: `Sheet · ${sh.name}` };
      out = asFile(`${f.title}${(f.sheets || []).length > 1 ? ` - ${sh.name}` : ''}.csv`, 'text/csv', toCsv(sh.cells));
    } else if (kind === 'code') {
      const files = Array.isArray(f.code?.files) ? f.code.files : [];
      if (!files.length) throw new FlowError(`“${f.title}” has no code files yet.`, 'not_found');
      // Which file: the one asked for in the link (?edit=path), else the one set here, else the one open in Workline.
      const want = String(query.edit || p.path || '').trim();
      const cf = files.find(x => x.path === want) || files.find(x => x.id === f.code.active) || files[0];
      if (saving && form.path === cf.path) { cf.text = lf(form.content); await args.ctx.files.save(f); saved = true; }
      block = { part: 'code', text: cf.text || '', label: cf.path, path: cf.path, mono: true, tabs: files.slice(0, 40).map(x => ({ path: x.path, on: x === cf })) };
      out = asFile(cf.path.split('/').pop(), mimeOf(cf.path), cf.text || '');
    } else if (kind === 'diagram') {
      f.diagrams = Array.isArray(f.diagrams) ? f.diagrams : [];
      const name = String(p.diagram || '').trim();
      let d = name ? f.diagrams.find(x => x.name === name) : (f.diagrams.find(x => String(x.code || '').trim()) || f.diagrams[0]);
      if (saving) {
        const code = lf(form.content);
        if (d) d.code = code; else { d = { id: rid('d'), type: 'architecture', name: name || 'Diagram 1', code, manual: {}, dir: 'LR', style: 'color' }; f.diagrams.push(d); }
        await args.ctx.files.save(f); saved = true;
      }
      block = { part: 'diagram', text: d?.code || '', label: `Diagram code${d ? ` · ${d.name}` : ''}`, mono: true };
      out = asFile(`${f.title}${d ? ` - ${d.name}` : ''}.txt`, 'text/plain', d?.code || '');
    } else {
      if (saving) { f.doc = lf(form.content); await args.ctx.files.save(f); saved = true; }
      block = { part: 'doc', text: f.doc || '', label: 'Doc' };
      out = asFile(`${f.title}.md`, 'text/markdown', f.doc || '');
    }
    if (f.upload) out = await exportUpload(f, kind);
    add(args, { kind: 'editor', title: f.upload ? f.upload.name : p.title || f.title, action, button: p.button || 'Save', saved, rows: Math.min(60, Math.max(8, Number(p.rows) || 18)), ...block, qs, another: !!f.upload,
      what: KIND_WORD[kind], download: { name: out.name, href: `data:${out.type};base64,${out.data}`, size: out.size } });
    return { main: [{ json: { fileId: f.id, title: f.title, kind, saved, file: out } }] };
  } },
  'ui.form': { run: args => {
    const p = first(args);
    return add(args, { kind: 'form', title: p.title || '', action: String(p.action || args.node.name || 'submit').slice(0, 60), fields: formFields(p.fields), button: p.button || 'Send', values: args.ctx?.page?.form || {} });
  } },
};

/* ---- the page ---- */
function block(b, query) {
  const head = b.title ? `<h3>${esc(b.title)}</h3>` : '';
  switch (b.kind) {
    case 'text': return `<section class="text ${b.style}">${b.html}</section>`;
    case 'cards': return `<section>${head}<div class="cards">${b.cards.map(c => `<div class="card"><span>${esc(c.label)}</span><b>${esc(fmt(c.value))}</b></div>`).join('')}</div></section>`;
    case 'table': return `<section>${head}<div class="tablewrap"><table><thead><tr>${b.columns.map(c => `<th>${esc(c)}</th>`).join('')}</tr></thead><tbody>${b.rows.length ? b.rows.map(r => `<tr>${b.columns.map(c => `<td>${esc(fmt(r && typeof r === 'object' ? r[c] : r))}</td>`).join('')}</tr>`).join('') : `<tr><td colspan="${b.columns.length || 1}" class="muted">No rows.</td></tr>`}</tbody></table></div>${b.more ? `<p class="muted">And ${b.more} more.</p>` : ''}</section>`;
    case 'chart': return `<section class="panel">${head}${b.chart}</section>`;
    case 'code': return `<section class="code"><iframe class="codeblock" src="/api/hook/code/${esc(b.id)}" sandbox="allow-scripts allow-popups allow-forms allow-modals" style="height:${Number(b.height) || 320}px" title="${esc(b.title)}" loading="lazy"></iframe></section>`;
    case 'media': {
      const one = m => (m.kind === 'video'
        ? `<video controls playsinline preload="metadata" src="${esc(m.url)}"${m.poster ? ` poster="${esc(m.poster)}"` : ''}></video>`
        : `<img src="${esc(m.url)}" alt="${esc(m.caption)}" loading="lazy">`);
      const fig = m => `<figure>${m.link ? `<a href="${esc(m.link)}">${one(m)}</a>` : one(m)}${m.caption ? `<figcaption>${esc(m.caption)}</figcaption>` : ''}</figure>`;
      return b.media.length ? `<section class="media ${b.layout}">${b.media.map(fig).join('')}</section>` : '';
    }
    case 'buttons': {
      const here = '?' + new URLSearchParams(query || {}).toString();
      return `<nav class="buttons">${b.buttons.map(x => `<a class="btn${x.href && x.href === here ? ' on' : ''}" href="${esc(x.href || '?')}">${esc(x.label)}</a>`).join('')}</nav>`;
    }
    case 'form': return `<section class="panel">${head}<form method="post"><input type="hidden" name="_action" value="${esc(b.action)}">${b.fields.map(f => `<label>${esc(f.name)}${f.required ? ' *' : ''}${f.kind === 'long'
      ? `<textarea name="${esc(f.key)}"${f.required ? ' required' : ''}>${esc(b.values[f.key] ?? '')}</textarea>`
      : `<input name="${esc(f.key)}" type="${f.kind}" value="${esc(b.values[f.key] ?? '')}"${f.required ? ' required' : ''}>`}</label>`).join('')}<button>${esc(b.button)}</button></form></section>`;
    case 'editor': {
      if (b.part === 'upload') return `<section class="panel editor"><div class="ed-top"><h3>${esc(b.title)}</h3></div>${b.error ? `<p class="ed-err" role="alert">${esc(b.error)}</p>` : ''}<form method="post" enctype="multipart/form-data" action="?"><input type="hidden" name="_action" value="${esc(b.action)}"><label>Your file <span class="muted">(text, Markdown, CSV, Excel .xlsx, JSON or code; up to 3 MB)</span><input type="file" name="upload" required></label><button>${esc(b.button)}</button></form></section>`;
      const ok = b.saved ? '<span class="ed-ok" role="status">✓ Saved</span>' : '';
      const kb = b.download.size < 1024 ? `${b.download.size} B` : `${Math.round(b.download.size / 1024)} KB`;
      const dl = `<a class="ed-dl" href="${esc(b.download.href)}" download="${esc(b.download.name)}">⬇ Download ${esc(b.download.name)} <small>${kb}</small></a>`;
      const top = `<div class="ed-top"><h3>${esc(b.title)} <span class="ed-kind">${esc(b.what)}</span></h3>${ok}</div>`;
      const link = path => `?${[b.qs, path ? `edit=${encodeURIComponent(path)}` : ''].filter(Boolean).join('&')}`;
      const tabs = b.tabs && b.tabs.length > 1 ? `<nav class="ed-tabs">${b.tabs.map(t => `<a class="btn${t.on ? ' on' : ''}" href="${esc(link(t.path))}">${esc(t.path)}</a>`).join('')}</nav>` : '';
      const hidden = `<input type="hidden" name="_action" value="${esc(b.action)}">${b.path ? `<input type="hidden" name="path" value="${esc(b.path)}">` : ''}`;
      const body = b.part === 'sheet'
        ? `<div class="ed-grid" aria-label="${esc(b.label)}"><table><thead><tr><th></th>${b.cols.map(c => `<th>${c}</th>`).join('')}</tr></thead><tbody>${b.grid.map((row, r) => `<tr><th>${r + 1}</th>${row.map(c => `<td><input name="c_${c.a}" value="${esc(c.v)}" aria-label="${c.a}"></td>`).join('')}</tr>`).join('')}</tbody></table></div>`
        : `<label>${esc(b.label)}<textarea name="content" rows="${b.rows}" class="${b.mono ? 'mono' : ''}" spellcheck="${b.mono ? 'false' : 'true'}">${esc(b.text)}</textarea></label>`;
      const action = b.path || b.qs ? ` action="${esc(link(b.path))}"` : '';
      return `<section class="panel editor">${top}${tabs}<form method="post"${action}>${hidden}${body}<div class="ed-acts"><button>${esc(b.button)}</button>${dl}${b.another ? '<a class="ed-new" href="?">Open another file</a>' : ''}</div></form></section>`;
    }
    default: return '';
  }
}

export function renderPage(params = {}, blocks = [], { query = {}, error = '' } = {}) {
  const dark = params.theme === 'dark', wide = params.width === 'wide';
  const t = dark ? { bg: '#0d1117', fg: '#e6edf3', mut: '#8b949e', card: '#161b22', line: '#30363d', acc: '#4f8cff' } : { bg: '#f6f7fb', fg: '#1d2433', mut: '#5b6475', card: '#ffffff', line: '#e3e6ef', acc: '#4f7cff' };
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(params.title || 'Page')}</title><style>
*{box-sizing:border-box}html{color-scheme:${dark ? 'dark' : 'light'}}body{margin:0;background:${t.bg};color:${t.fg};font:15px/1.55 system-ui,-apple-system,Segoe UI,sans-serif}
main{max-width:${wide ? 1180 : 820}px;margin:0 auto;padding:32px 20px 48px;display:grid;gap:18px}
header h1{margin:0;font-size:28px;letter-spacing:-.01em}header p{margin:4px 0 0;color:${t.mut}}
h2,h3,h4{margin:0 0 8px}h3{font-size:14px;color:${t.mut};font-weight:600}.muted{color:${t.mut}}
a{color:${t.acc}}code{font:13px ui-monospace,monospace;background:${t.card};border:1px solid ${t.line};border-radius:5px;padding:1px 5px}
.text p{margin:0 0 8px}.text.heading h2,.text.heading h3,.text.heading h4,.text.heading p{font-size:22px;color:${t.fg};margin:0}.text.note{background:${dark ? '#1c2230' : '#eef3ff'};border:1px solid ${t.line};border-radius:12px;padding:12px 16px}
.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px}.card,.panel{background:${t.card};border:1px solid ${t.line};border-radius:14px;padding:14px 16px}
.card span{display:block;color:${t.mut};font-size:12.5px}.card b{font-size:26px;font-weight:700}
.tablewrap{overflow:auto;background:${t.card};border:1px solid ${t.line};border-radius:14px}table{border-collapse:collapse;width:100%;font-size:14px}th,td{padding:9px 12px;text-align:left;border-bottom:1px solid ${t.line};white-space:nowrap}th{color:${t.mut};font-weight:600;font-size:12.5px}tr:last-child td{border-bottom:0}
.chart{width:100%;height:auto;display:block}.chart text{font-size:12px;fill:${t.mut}}.chart text.v{fill:${t.fg}}
.pie{display:flex;gap:20px;align-items:center;flex-wrap:wrap}.pie ul{list-style:none;margin:0;padding:0}.pie li{margin:3px 0}.pie i{display:inline-block;width:10px;height:10px;border-radius:3px;margin-right:8px}
.media.one figure{margin:0}.media.gallery{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:14px}.media figure{margin:0}
.media img,.media video{width:100%;display:block;border-radius:12px;background:#000;aspect-ratio:16/9;object-fit:cover}.media.one img{aspect-ratio:auto}figcaption{margin-top:6px;font-weight:600;font-size:14px}
.buttons{display:flex;gap:8px;flex-wrap:wrap}.btn{padding:7px 14px;border-radius:999px;border:1px solid ${t.line};background:${t.card};color:${t.fg};text-decoration:none;font-size:14px}.btn.on{background:${t.fg};color:${t.bg};border-color:${t.fg}}
form{display:grid;gap:12px}label{display:grid;gap:5px;font-weight:600;font-size:13px}input,textarea{font:inherit;padding:10px 12px;border:1px solid ${t.line};border-radius:10px;background:${t.bg};color:${t.fg}}textarea{min-height:100px}
button{justify-self:start;padding:10px 20px;border:0;border-radius:10px;background:${t.acc};color:#fff;font:600 15px system-ui;cursor:pointer}
.error{border:1px solid #f0b4b4;background:${dark ? '#2a1414' : '#fff1f1'};color:${dark ? '#ffb4b4' : '#a11'};border-radius:12px;padding:12px 16px}
.editor .ed-top{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:10px}.editor .ed-top h3{margin:0}.ed-ok{font-size:13px;font-weight:700;color:${dark ? '#7ee2b8' : '#0b7a52'};background:${dark ? '#12301f' : '#e7f7ef'};padding:4px 10px;border-radius:999px}
.ed-kind{font-size:11px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;padding:2px 8px;border-radius:999px;border:1px solid ${t.line};margin-left:6px;vertical-align:1px}
.ed-tabs{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px}.ed-tabs .btn{font:12.5px ui-monospace,monospace;padding:5px 10px}
.ed-acts{display:flex;align-items:center;gap:14px;flex-wrap:wrap}.ed-new{margin-left:auto;font-size:13px;color:${t.mut}}.ed-err{margin:0 0 10px;color:${dark ? '#ffb4b4' : '#a11'};font-weight:600}.ed-dl{font-weight:600;font-size:14px;text-decoration:none}.ed-dl small{color:${t.mut};font-weight:400}
.editor textarea{min-height:240px;line-height:1.6;resize:vertical;font-weight:400}.editor textarea.mono{font:13px/1.6 ui-monospace,monospace}
.ed-grid{overflow:auto;max-height:70vh;border:1px solid ${t.line};border-radius:10px}.ed-grid table{font-size:13px}.ed-grid th{position:sticky;top:0;background:${t.card};text-align:center;padding:6px 8px;z-index:1}.ed-grid tbody th{position:sticky;left:0;top:auto;width:42px}.ed-grid td{padding:0;border-left:1px solid ${t.line}}.ed-grid td input{width:100%;min-width:110px;border:0;border-radius:0;padding:7px 9px;background:transparent}.ed-grid td input:focus{outline:2px solid ${t.acc};outline-offset:-2px;background:${t.bg}}
footer{color:${t.mut};font-size:12px;text-align:center}.node{min-width:0}.codeblock{display:block;width:100%;border:0;border-radius:12px;background:transparent}
</style>${params.css ? `<style>${cssOf(params.css)}</style>` : ''}</head><body><main>
${params.title || params.description ? `<header>${params.title ? `<h1>${esc(params.title)}</h1>` : ''}${params.description ? `<p>${esc(params.description)}</p>` : ''}</header>` : ''}
${error ? `<div class="error">${esc(error)}</div>` : ''}
${blocks.map(b => { const html = block(b, query); return html ? `<div class="node n-${slug(b.node)}"${b.css ? ` style="${esc(b.css)}"` : ''}>${html}</div>` : ''; }).join('\n')}
<footer>Made with Workline</footer>
</main></body></html>`;
}

// The tool editor nodes: one per Workline tool, the file (or a blank one) opened in that tool.
for (const v of TOOL_VIEWS) UI_NODES[`ui.edit.${v === 'canvas' ? 'diagram' : v}`] = { run: async args => toolEditor(args, first(args), v) };
