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

const MAX_BLOCKS = 60, MAX_ROWS = 500;
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const show = v => (v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v));
const num = v => (typeof v === 'number' ? v : Number(String(v ?? '').replace(/[, ]/g, '')) || 0);
const fmt = v => (typeof v === 'number' ? v.toLocaleString('en-US', { maximumFractionDigits: 2 }) : show(v));
// Only web addresses and links within the page (?…, #…) become links and media.
const safeUrl = u => { const s = String(u ?? '').trim(); return /^https?:\/\//i.test(s) || /^[?#]/.test(s) ? s : ''; };
const add = (args, block) => {
  const page = args.ctx && args.ctx.page;
  if (page && page.blocks.length < MAX_BLOCKS) page.blocks.push({ node: args.node.name, ...block });
  return { main: args.items };
};
const first = args => args.params(args.items[0], 0);

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
footer{color:${t.mut};font-size:12px;text-align:center}
</style></head><body><main>
${params.title || params.description ? `<header>${params.title ? `<h1>${esc(params.title)}</h1>` : ''}${params.description ? `<p>${esc(params.description)}</p>` : ''}</header>` : ''}
${error ? `<div class="error">${esc(error)}</div>` : ''}
${blocks.map(b => block(b, query)).join('\n')}
<footer>Made with Workline</footer>
</main></body></html>`;
}
