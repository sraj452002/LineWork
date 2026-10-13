import { rid } from './utils.js';

/* The visual app builder (App view → Visual): an app made of pages, each with components placed on a
   12-column grid, filled with data from your workflows. Saved in file.ui.spec:
     {name, theme: {primary, bg, surface, text, radius, font, dark}, nav: 'top'|'side'|'none',
      pages: [{id, name, nav, components: [{id, type, name, x, y, w, h, props}]}],
      data: [{id, name, workflow, input: [{name, value}], auto}]}
   builderHtml(spec) makes the page's HTML (file.ui.html), which the App view publishes like any custom
   app: the same link, sandbox and workflow runs. Text in a component can hold {{ … }}: JavaScript with
   data (each data source's items), vars (inputs, picked rows, values you set), user (signed in), item
   (the row or answers an event is about) and page.

   Buttons, forms, tables and lists run steps when used: run a data source again, run a workflow, set a
   value, go to a page, show a message, open a link, sign out. On a phone the components stack, top to
   bottom. */

export const ROW = 8; // px per grid row
export const COLS = 12;

const f = (k, label, kind = 'text', extra = {}) => ({ k, label, kind, ...extra });
export const COMPONENTS = {
  heading: { label: 'Heading', w: 12, h: 6, props: { text: 'Heading', size: 'lg', align: 'left' },
    fields: [f('text', 'Text'), f('size', 'Size', 'select', { options: [['lg', 'Large'], ['md', 'Medium'], ['sm', 'Small']] }), f('align', 'Align', 'select', { options: [['left', 'Left'], ['center', 'Center'], ['right', 'Right']] })] },
  text: { label: 'Text', w: 12, h: 8, props: { text: 'Some text. **Bold**, [links](https://example.com) and {{ user ? user.name : "you" }}.', align: 'left' },
    fields: [f('text', 'Text', 'textarea', { hint: '**bold**, *italic*, [link](https://…), - list, {{ data.x.length }}' }), f('align', 'Align', 'select', { options: [['left', 'Left'], ['center', 'Center'], ['right', 'Right']] })] },
  button: { label: 'Button', w: 3, h: 6, props: { label: 'Button', look: 'primary', steps: [] }, events: 'steps',
    fields: [f('label', 'Label'), f('look', 'Look', 'select', { options: [['primary', 'Filled'], ['secondary', 'Outline'], ['link', 'Link']] })] },
  input: { label: 'Input', w: 4, h: 9, props: { label: 'Label', placeholder: '', kind: 'text', value: '' }, holds: 'what was typed',
    fields: [f('label', 'Label'), f('placeholder', 'Placeholder'), f('kind', 'Kind', 'select', { options: [['text', 'Text'], ['number', 'Number'], ['email', 'Email'], ['date', 'Date'], ['long', 'Long text'], ['password', 'Password']] }), f('value', 'Starts as')] },
  select: { label: 'Dropdown', w: 4, h: 9, props: { label: 'Choose', options: 'All, North, South, East', value: 'All' }, holds: 'the choice',
    fields: [f('label', 'Label'), f('options', 'Options', 'text', { hint: 'A, B, C  or  {{ data.x.map(r => r.name) }}' }), f('value', 'Starts as')] },
  form: { label: 'Form', w: 6, h: 34, props: { title: 'Send us a message', fields: 'Name*\nEmail* (email)\nMessage (long)', button: 'Send', thanks: 'Thanks! We got it.', steps: [] }, events: 'steps', holds: 'the answers (also item)',
    fields: [f('title', 'Title'), f('fields', 'Fields, one a line', 'textarea', { hint: 'Name*\nEmail* (email)\nAge (number)\nNotes (long)' }), f('button', 'Button'), f('thanks', 'After sending')] },
  table: { label: 'Table', w: 12, h: 40, props: { rows: '{{ data.items }}', columns: '', search: true, title: '', steps: [] }, events: 'steps', holds: 'the clicked row (also item)',
    fields: [f('title', 'Title'), f('rows', 'Rows', 'text', { hint: '{{ data.orders }}' }), f('columns', 'Columns (blank: all)', 'text', { hint: 'name, email, total' }), f('search', 'Search box', 'bool')] },
  chart: { label: 'Chart', w: 6, h: 34, props: { title: 'Chart', rows: '{{ data.items }}', kind: 'bar', label: 'name', value: 'value' },
    fields: [f('title', 'Title'), f('kind', 'Kind', 'select', { options: [['bar', 'Bars'], ['line', 'Line'], ['pie', 'Pie']] }), f('rows', 'Rows', 'text', { hint: '{{ data.sales }}' }), f('label', 'Field for the labels'), f('value', 'Field for the numbers')] },
  stat: { label: 'Number', w: 3, h: 12, props: { label: 'Total', value: '{{ (data.items || []).length }}', note: '' },
    fields: [f('label', 'Label'), f('value', 'Value', 'text', { hint: '{{ data.orders.reduce((s, o) => s + o.total, 0) }}' }), f('note', 'Small note')] },
  list: { label: 'Cards list', w: 12, h: 40, props: { rows: '{{ data.items }}', title: '{{ item.name }}', subtitle: '', image: '', steps: [] }, events: 'steps', holds: 'the clicked card (also item)',
    fields: [f('rows', 'Rows', 'text', { hint: '{{ data.products }}' }), f('title', 'Card title', 'text', { hint: '{{ item.name }}' }), f('subtitle', 'Card text', 'text', { hint: '{{ item.price }}' }), f('image', 'Card image', 'text', { hint: '{{ item.photo }}' })] },
  image: { label: 'Image', w: 4, h: 24, props: { src: 'https://picsum.photos/seed/workline/640/400', fit: 'cover', alt: '' },
    fields: [f('src', 'Image URL'), f('fit', 'Fit', 'select', { options: [['cover', 'Fill the box'], ['contain', 'Show all of it']] }), f('alt', 'Description')] },
  video: { label: 'Video', w: 8, h: 40, props: { src: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4', poster: '' },
    fields: [f('src', 'Video URL (MP4, WebM or HLS .m3u8)'), f('poster', 'Poster image')] },
  divider: { label: 'Divider', w: 12, h: 3, props: {}, fields: [] },
  html: { label: 'Custom HTML', w: 6, h: 20, props: { html: '<p>Your own <b>HTML</b>. {{ vars.x }}</p>' },
    fields: [f('html', 'HTML', 'textarea')] },
};
// Every component can sit in a card.
export const COMMON_FIELDS = [f('card', 'In a card', 'bool')];

export const STEP_KINDS = [
  ['run', 'Refresh a data source'], ['workflow', 'Run a workflow'], ['set', 'Set a value'],
  ['go', 'Go to a page'], ['toast', 'Show a message'], ['open', 'Open a link'], ['logout', 'Sign out'],
];

export const THEMES = {
  light: { primary: '#4f46e5', bg: '#f6f7fb', surface: '#ffffff', text: '#1d2433', dark: false },
  dark: { primary: '#8b8cf8', bg: '#0f1117', surface: '#181b24', text: '#e7e9ee', dark: true },
  ocean: { primary: '#0e7490', bg: '#ecfeff', surface: '#ffffff', text: '#083344', dark: false },
  sunset: { primary: '#ea580c', bg: '#fff7ed', surface: '#ffffff', text: '#431407', dark: false },
};

export const newComponent = (type, comps, at = {}) => {
  const d = COMPONENTS[type];
  let n = 1;
  while (comps.some(c => c.name === `${type}${n}`)) n++;
  const y = at.y ?? comps.reduce((m, c) => Math.max(m, c.y + c.h), 0);
  return { id: rid('c'), type, name: `${type}${n}`, x: Math.min(at.x ?? 0, COLS - d.w), y, w: d.w, h: d.h, props: JSON.parse(JSON.stringify(d.props)) };
};
export const newPage = (pages, name) => ({ id: rid('p'), name: name || `Page ${pages.length + 1}`, nav: true, components: [] });

export function newVisualApp(title = 'My app', workflow = '') {
  const home = newPage([], 'Home');
  const comps = [];
  const add = (type, props, at) => { const c = newComponent(type, comps, at); Object.assign(c.props, props); comps.push(c); return c; };
  add('heading', { text: title });
  add('text', { text: 'Welcome{{ user ? ", " + user.name : "" }}! Drag components in from the left, and fill them with data from your workflows.' });
  if (workflow) {
    add('stat', { label: 'Items', value: '{{ (data.items || []).length }}' });
    add('button', { label: 'Refresh', steps: [{ kind: 'run', source: 'items' }] }, { x: 9, y: 14 });
    add('table', { rows: '{{ data.items }}', title: 'Results' });
  }
  home.components = comps;
  return {
    name: title, theme: { ...THEMES.light, radius: 12, font: 'system' }, nav: 'top',
    pages: [home],
    data: workflow ? [{ id: rid('s'), name: 'items', workflow, input: [], auto: true }] : [],
  };
}

const json = v => JSON.stringify(v).replace(/</g, '\\u003c').replace(/[\u2028\u2029]/g, c => '\\u' + c.charCodeAt(0).toString(16));

// The page: its style, a root, and the runtime with the app's spec. `design` is the editor's canvas.
export function builderHtml(spec, { design = false, access = 'public' } = {}) {
  return `<style>${CSS}</style>
<div id="wl-root"></div>
<script>(${runtime.toString()})(${json(spec)}, ${json({ design, access })});</script>`;
}

const CSS = `
:root{--p:#4f46e5;--bg:#f6f7fb;--sf:#fff;--tx:#1d2433;--mt:color-mix(in srgb,var(--tx) 60%,transparent);--ln:color-mix(in srgb,var(--tx) 14%,transparent);--r:12px}
html,body{background:var(--bg);color:var(--tx)}
body{margin:0;font:15px/1.5 var(--font,system-ui,-apple-system,Segoe UI,sans-serif)}
*{box-sizing:border-box}
a{color:var(--p)}
.wl-nav{display:flex;align-items:center;gap:6px;padding:10px 20px;background:var(--sf);border-bottom:1px solid var(--ln);position:sticky;top:0;z-index:5;overflow-x:auto}
.wl-nav b{font-size:16px;margin-right:14px;white-space:nowrap}
.wl-nav a{padding:6px 12px;border-radius:999px;text-decoration:none;color:var(--tx);white-space:nowrap;font-size:14px}
.wl-nav a.on{background:color-mix(in srgb,var(--p) 14%,transparent);color:var(--p);font-weight:600}
.wl-nav .sp{flex:1}
.wl-nav .who{font-size:13px;color:var(--mt);white-space:nowrap}
.wl-shell.side{display:flex;min-height:100vh}
.wl-shell.side .wl-nav{flex-direction:column;align-items:stretch;width:220px;height:100vh;border-bottom:0;border-right:1px solid var(--ln);padding:18px 12px}
.wl-shell.side .wl-nav b{margin:0 8px 14px}
.wl-shell.side .wl-main{flex:1;min-width:0}
.wl-main{max-width:1200px;margin:0 auto;padding:18px 14px 40px}
.wl-page{position:relative}
.wl-c{position:absolute;padding:6px}
.wl-in{height:100%;overflow:auto;border-radius:var(--r)}
.wl-in.card{background:var(--sf);border:1px solid var(--ln);padding:14px;box-shadow:0 1px 2px rgba(0,0,0,.04)}
.wl-page.stack{display:flex;flex-direction:column;height:auto!important}
.wl-page.stack .wl-c{position:static;width:100%!important;height:auto!important}
.wl-page.stack .wl-c.fixed{height:var(--h)!important}
.wl-page.stack .wl-in{height:auto}
.wl-page.stack .wl-c.fixed .wl-in{height:100%}
.wl-h{margin:0;line-height:1.2}.wl-h.lg{font-size:30px}.wl-h.md{font-size:22px}.wl-h.sm{font-size:17px}
.wl-t p{margin:0 0 8px}.wl-t ul{margin:0 0 8px;padding-left:20px}
.wl-btn{font:inherit;font-weight:600;padding:9px 16px;border-radius:calc(var(--r) * .75);border:1.5px solid var(--p);background:var(--p);color:#fff;cursor:pointer;width:100%;min-height:40px}
.wl-btn.secondary{background:transparent;color:var(--p)}
.wl-btn.link{background:none;border-color:transparent;color:var(--p);text-decoration:underline}
.wl-btn:disabled{opacity:.6;cursor:default}
.wl-f{display:grid;gap:4px;font-size:13px;color:var(--mt);font-weight:600}
.wl-f input,.wl-f textarea,.wl-f select,.wl-search{font:inherit;font-size:15px;font-weight:400;color:var(--tx);padding:9px 11px;border:1px solid var(--ln);border-radius:calc(var(--r) * .66);background:var(--sf);width:100%}
.wl-f textarea{min-height:90px;resize:vertical}
.wl-form{display:grid;gap:12px}.wl-form h3{margin:0}
.wl-ok{color:#15803d;font-weight:600}
.wl-tbl{width:100%;border-collapse:collapse;font-size:14px}
.wl-tbl th{position:sticky;top:0;background:var(--sf);text-align:left;font-size:12px;color:var(--mt);font-weight:600;text-transform:capitalize}
.wl-tbl th,.wl-tbl td{padding:8px 10px;border-bottom:1px solid var(--ln);white-space:nowrap;max-width:320px;overflow:hidden;text-overflow:ellipsis}
.wl-tbl tr.click{cursor:pointer}.wl-tbl tr.click:hover td{background:color-mix(in srgb,var(--p) 6%,transparent)}
.wl-tbl tr.on td{background:color-mix(in srgb,var(--p) 12%,transparent)}
.wl-search{margin-bottom:8px;padding:7px 10px}
.wl-title{font-weight:650;margin:0 0 8px}
.wl-stat span{display:block;font-size:13px;color:var(--mt);font-weight:600}
.wl-stat b{display:block;font-size:30px;line-height:1.15;font-weight:700;color:var(--tx)}
.wl-stat small{color:var(--mt)}
.wl-cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:12px}
.wl-card{background:var(--sf);border:1px solid var(--ln);border-radius:var(--r);overflow:hidden}
.wl-card.click{cursor:pointer}.wl-card.click:hover{border-color:var(--p)}
.wl-card img{width:100%;aspect-ratio:16/10;object-fit:cover;display:block;background:var(--ln)}
.wl-card div{padding:10px 12px}.wl-card b{display:block}.wl-card span{color:var(--mt);font-size:13px}
.wl-img{width:100%;height:100%;display:block;border-radius:var(--r)}
.wl-vid{width:100%;height:100%;background:#000;border-radius:var(--r);display:block}
.wl-hr{border:0;border-top:1px solid var(--ln);margin:10px 0}
.wl-note{color:var(--mt);font-size:13px;padding:6px 0}
.wl-err{color:#d1242f;font-size:13px}
.wl-toast{position:fixed;left:50%;bottom:24px;transform:translateX(-50%);background:var(--tx);color:var(--bg);padding:10px 16px;border-radius:10px;font-size:14px;z-index:20;max-width:90vw}
.wl-auth{max-width:380px;margin:10vh auto;background:var(--sf);border:1px solid var(--ln);border-radius:var(--r);padding:26px;display:grid;gap:14px}
.wl-auth h1{margin:0;font-size:22px}.wl-auth p{margin:0;color:var(--mt);font-size:14px}
.wl-auth .tabs{display:flex;gap:6px}.wl-auth .tabs button{flex:1;font:inherit;padding:7px;border:1px solid var(--ln);background:none;border-radius:8px;color:var(--tx);cursor:pointer}
.wl-auth .tabs button.on{border-color:var(--p);color:var(--p);font-weight:600}
.wl-design .wl-main{max-width:none;padding:12px 0 40px}
.wl-design .wl-c *{pointer-events:none}
.wl-design body{overflow:hidden}
`;

/* The app itself, run in the page (its source is copied there, so it uses nothing from this module). */
function runtime(SPEC, OPT) {
  const ROW = 8, FIXED = { table: 1, chart: 1, image: 1, video: 1, html: 1, list: 1 };
  const root = document.getElementById('wl-root');
  const S = { data: {}, vars: {}, errors: {}, loading: {}, user: null, page: null, spec: SPEC, stack: false, selected: {} };
  const fns = {};
  const fmt = v => (typeof v === 'number' ? v.toLocaleString(undefined, { maximumFractionDigits: 2 }) : v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v));
  const run = (code, item) => {
    try {
      const fn = fns[code] || (fns[code] = new Function('data', 'vars', 'user', 'item', 'page', 'fmt', '"use strict"; return (' + code + '\n);'));
      return fn(S.data, S.vars, S.user, item, S.page && S.page.name, fmt);
    } catch (e) { return undefined; }
  };
  // "{{ x }}" alone gives x itself (a list, a number…); mixed with words, text.
  const val = (v, item) => {
    if (typeof v !== 'string') return v;
    const one = /^\s*\{\{((?:(?!\}\})[\s\S])*)\}\}\s*$/.exec(v);
    if (one) return run(one[1], item);
    return v.replace(/\{\{([\s\S]+?)\}\}/g, (_, c) => fmt(run(c, item)));
  };
  const txt = (v, item) => fmt(val(v, item));
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const safeUrl = u => (/^(https?:|mailto:|\/|#|\?)/i.test(String(u || '').trim()) ? String(u).trim() : '');
  // A little Markdown: paragraphs, - lists, **bold**, *italic*, [links](https://…).
  const md = s => {
    const inline = t => esc(t).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/\*(.+?)\*/g, '<i>$1</i>')
      .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (m, a, u) => (safeUrl(u.replace(/&amp;/g, '&')) ? '<a href="' + u + '" target="_blank" rel="noopener">' + a + '</a>' : a));
    return String(s).split(/\n{2,}/).map(block => {
      const lines = block.split('\n');
      if (lines.every(l => /^\s*[-*] /.test(l))) return '<ul>' + lines.map(l => '<li>' + inline(l.replace(/^\s*[-*] /, '')) + '</li>').join('') + '</ul>';
      return '<p>' + lines.map(inline).join('<br>') + '</p>';
    }).join('');
  };
  const toast = msg => {
    const t = el('div', 'wl-toast', msg); document.body.appendChild(t);
    setTimeout(() => t.remove(), 3200);
  };
  const list = v => (Array.isArray(v) ? v : v == null || v === '' ? [] : [v]);
  const usedSources = c => [...new Set((JSON.stringify(c.props).match(/data\.(\w+)/g) || []).map(s => s.slice(5)))];
  const fields = text => String(text || '').split('\n').map(l => l.trim()).filter(Boolean).slice(0, 30).map(l => {
    const kind = ((/\((long|email|number|date|tel|url|password)\)/i.exec(l) || [])[1] || 'text').toLowerCase();
    const label = l.replace(/\((long|email|number|date|tel|url|password)\)/i, '').trim(), required = label.endsWith('*');
    const name = label.replace(/\*$/, '').trim();
    return { name, key: name.replace(/[^\w ]+/g, '').trim().replace(/\s+(\w)/g, (_, c) => c.toUpperCase()).replace(/^\w/, c => c.toLowerCase()) || 'field', kind, required };
  });

  /* ---- data ---- */
  const sourceByName = n => (S.spec.data || []).find(s => s.name === n);
  async function load(src) {
    if (!src) return;
    S.loading[src.name] = true; paint();
    try {
      const input = {};
      for (const p of src.input || []) if (p && p.name) input[p.name] = val(p.value);
      S.data[src.name] = await workline.run(src.workflow || undefined, input);
      delete S.errors[src.name];
    } catch (e) { S.errors[src.name] = e.message || String(e); }
    S.loading[src.name] = false; paint();
  }
  let loaded = '';
  function loadAuto() {
    const key = JSON.stringify([(S.spec.data || []).filter(s => s.auto), S.page && S.page.id]);
    if (key === loaded) return;
    loaded = key;
    for (const s of S.spec.data || []) if (s.auto && s.name) load(s);
  }

  /* ---- steps: what a button, form, table or list does when used ---- */
  async function steps(list, item) {
    for (const st of list || []) {
      try {
        if (st.kind === 'run') await load(sourceByName(st.source));
        else if (st.kind === 'workflow') {
          const input = {};
          for (const p of st.input || []) if (p && p.name) input[p.name] = val(p.value, item);
          const out = await workline.run(st.workflow || undefined, Object.keys(input).length ? input : item || {});
          if (st.into) S.data[st.into] = out;
          S.vars.result = out;
        } else if (st.kind === 'set') { if (st.name) S.vars[st.name] = val(st.value, item); }
        else if (st.kind === 'go') go(st.page);
        else if (st.kind === 'toast') toast(txt(st.text, item));
        else if (st.kind === 'open') { const u = safeUrl(txt(st.url, item)); if (u) window.open(u, '_blank', 'noopener'); }
        else if (st.kind === 'logout') { await workline.auth.logout(); S.user = null; start(); return; }
      } catch (e) { toast(e.message || String(e)); paint(); return; }
      paint();
    }
  }

  /* ---- components ---- */
  function make(c) {
    const p = c.props || {}, box = el('div', 'wl-in' + (p.card ? ' card' : ''));
    const failed = usedSources(c).map(n => S.errors[n]).filter(Boolean);
    const waiting = usedSources(c).some(n => S.loading[n] && S.data[n] === undefined);
    const rowsOf = () => list(val(p.rows));
    const note = (cls, t) => { box.appendChild(el('div', cls, t)); return box; };
    switch (c.type) {
      case 'heading': { const h = el(p.size === 'sm' ? 'h3' : p.size === 'md' ? 'h2' : 'h1', 'wl-h ' + (p.size || 'lg'), txt(p.text)); h.style.textAlign = p.align || 'left'; box.appendChild(h); break; }
      case 'text': { const d = el('div', 'wl-t'); d.innerHTML = md(txt(p.text)); d.style.textAlign = p.align || 'left'; box.appendChild(d); break; }
      case 'button': {
        const b = el('button', 'wl-btn ' + (p.look || 'primary'), txt(p.label));
        b.onclick = async () => { b.disabled = true; await steps(p.steps); b.disabled = false; };
        box.appendChild(b); break;
      }
      case 'input': case 'select': {
        const l = el('label', 'wl-f'); l.appendChild(el('span', '', txt(p.label)));
        let i;
        if (c.type === 'select') {
          i = el('select');
          const opts = val(p.options), items = Array.isArray(opts) ? opts : String(opts || '').split(',').map(s => s.trim()).filter(Boolean);
          for (const o of items) { const v = o && typeof o === 'object' ? o.value ?? o.label : o; const op = el('option', '', fmt(o && typeof o === 'object' ? o.label ?? o.value : o)); op.value = fmt(v); i.appendChild(op); }
        } else { i = el(p.kind === 'long' ? 'textarea' : 'input'); if (p.kind !== 'long') i.type = p.kind || 'text'; i.placeholder = txt(p.placeholder); }
        if (!(c.name in S.vars)) S.vars[c.name] = txt(p.value);
        i.value = S.vars[c.name] ?? '';
        i.dataset.name = c.name;
        const set = () => { S.vars[c.name] = p.kind === 'number' && i.value !== '' ? +i.value : i.value; paint(c.id); };
        i.oninput = set; i.onchange = set;
        l.appendChild(i); box.appendChild(l); break;
      }
      case 'form': {
        const fm = el('form', 'wl-form');
        if (p.title) fm.appendChild(el('h3', '', txt(p.title)));
        const fs = fields(p.fields);
        for (const fd of fs) {
          const l = el('label', 'wl-f'); l.appendChild(el('span', '', fd.name + (fd.required ? ' *' : '')));
          const i = el(fd.kind === 'long' ? 'textarea' : 'input'); if (fd.kind !== 'long') i.type = fd.kind; i.name = fd.key; i.required = fd.required;
          l.appendChild(i); fm.appendChild(l);
        }
        const b = el('button', 'wl-btn', txt(p.button) || 'Send'); fm.appendChild(b);
        const ok = el('div', 'wl-ok'); fm.appendChild(ok);
        fm.onsubmit = async e => {
          e.preventDefault();
          const answers = {};
          for (const fd of fs) { const v = fm.elements[fd.key].value; answers[fd.key] = fd.kind === 'number' && v !== '' ? +v : v; }
          S.vars[c.name] = answers; b.disabled = true; ok.textContent = '';
          await steps(p.steps, answers);
          b.disabled = false;
          if (p.thanks) { fm.reset(); const box2 = document.querySelector('[data-c="' + c.id + '"] .wl-ok'); if (box2) box2.textContent = txt(p.thanks, answers); }
        };
        box.appendChild(fm); break;
      }
      case 'table': {
        if (p.title) box.appendChild(el('div', 'wl-title', txt(p.title)));
        if (failed.length) return note('wl-err', failed[0]);
        if (waiting) return note('wl-note', 'Loading…');
        let rows = rowsOf();
        const q = S.vars[c.name + 'Search'] || '';
        if (p.search) {
          const s = el('input', 'wl-search'); s.placeholder = 'Search'; s.value = q; s.dataset.name = c.name + 'Search';
          s.oninput = () => { S.vars[c.name + 'Search'] = s.value; paint(); };
          box.appendChild(s);
        }
        if (q) rows = rows.filter(r => JSON.stringify(r).toLowerCase().includes(q.toLowerCase()));
        const cols = String(txt(p.columns) || '').split(',').map(s => s.trim()).filter(Boolean);
        const keys = cols.length ? cols : [...new Set(rows.flatMap(r => (r && typeof r === 'object' ? Object.keys(r) : ['value'])))].slice(0, 12);
        if (!rows.length) return note('wl-note', q ? 'Nothing matches.' : 'Nothing to show yet.');
        const t = el('table', 'wl-tbl'), hr = el('tr');
        for (const k of keys) hr.appendChild(el('th', '', k));
        const th = el('thead'); th.appendChild(hr); t.appendChild(th);
        const tb = el('tbody');
        for (const r of rows.slice(0, 300)) {
          const tr = el('tr', (p.steps && p.steps.length ? 'click' : '') + (S.selected[c.id] === r ? ' on' : ''));
          for (const k of keys) tr.appendChild(el('td', '', fmt(r && typeof r === 'object' ? r[k] : r)));
          tr.onclick = () => { S.vars[c.name] = r; S.selected[c.id] = r; steps(p.steps, r); paint(); };
          tb.appendChild(tr);
        }
        t.appendChild(tb); box.appendChild(t);
        if (rows.length > 300) box.appendChild(el('div', 'wl-note', 'Showing 300 of ' + rows.length + '. Search to narrow them.'));
        break;
      }
      case 'chart': {
        if (p.title) box.appendChild(el('div', 'wl-title', txt(p.title)));
        if (failed.length) return note('wl-err', failed[0]);
        if (waiting) return note('wl-note', 'Loading…');
        const rows = rowsOf().filter(r => r && typeof r === 'object');
        if (!rows.length) return note('wl-note', 'Nothing to show yet.');
        const d = el('div'); box.appendChild(d);
        box._draw = () => {
          const hgt = Math.max(80, (box.clientHeight || (c.h * ROW)) - (p.title ? 40 : 16) - (p.card ? 28 : 0));
          const draw = p.kind === 'line' ? window.line : p.kind === 'pie' ? window.pie : window.bars;
          if (draw) draw(d, rows, p.label, p.value, { height: hgt, color: 'var(--p)' });
        };
        break;
      }
      case 'stat': {
        const s = el('div', 'wl-stat');
        s.appendChild(el('span', '', txt(p.label)));
        s.appendChild(el('b', '', failed.length ? '—' : waiting ? '…' : txt(p.value)));
        if (p.note) s.appendChild(el('small', '', txt(p.note)));
        box.appendChild(s); break;
      }
      case 'list': {
        if (failed.length) return note('wl-err', failed[0]);
        if (waiting) return note('wl-note', 'Loading…');
        const rows = rowsOf();
        if (!rows.length) return note('wl-note', 'Nothing to show yet.');
        const g = el('div', 'wl-cards');
        for (const r of rows.slice(0, 200)) {
          const card = el('div', 'wl-card' + (p.steps && p.steps.length ? ' click' : ''));
          const img = safeUrl(txt(p.image, r));
          if (img) { const i = el('img'); i.src = img; i.alt = ''; i.loading = 'lazy'; card.appendChild(i); }
          const d = el('div'); d.appendChild(el('b', '', txt(p.title, r))); if (p.subtitle) d.appendChild(el('span', '', txt(p.subtitle, r)));
          card.appendChild(d);
          card.onclick = () => { S.vars[c.name] = r; steps(p.steps, r); };
          g.appendChild(card);
        }
        box.appendChild(g); break;
      }
      case 'image': {
        const u = safeUrl(txt(p.src));
        if (!u) return note('wl-note', 'No image yet.');
        const i = el('img', 'wl-img'); i.src = u; i.alt = txt(p.alt); i.style.objectFit = p.fit || 'cover'; box.appendChild(i); break;
      }
      case 'video': {
        const u = safeUrl(txt(p.src));
        if (!u) return note('wl-note', 'No video yet.');
        const v = el('video', 'wl-vid'); v.controls = true; v.playsInline = true; v.preload = 'metadata';
        const poster = safeUrl(txt(p.poster)); if (poster) v.poster = poster;
        if (/\.m3u8(\?|$)/i.test(u) && !v.canPlayType('application/vnd.apple.mpegurl')) {
          const attach = () => { const h = new window.Hls(); h.loadSource(u); h.attachMedia(v); };
          if (window.Hls) attach();
          else { const sc = document.createElement('script'); sc.src = 'https://cdn.jsdelivr.net/npm/hls.js@1.5.13/dist/hls.min.js'; sc.onload = attach; document.head.appendChild(sc); }
        } else v.src = u;
        box.appendChild(v); break;
      }
      case 'divider': box.appendChild(el('hr', 'wl-hr')); break;
      case 'html': { const d = el('div'); d.innerHTML = txt(p.html); box.appendChild(d); break; }
      default: box.appendChild(el('div', 'wl-note', c.type));
    }
    return box;
  }

  /* ---- the page ---- */
  let pageEl = null;
  // Draw the page again; `keep` is a component being typed into, which is left alone.
  function paint(keep) {
    if (!pageEl || !S.page) return;
    const comps = [...(S.page.components || [])].sort((a, b) => a.y - b.y || a.x - b.x);
    const focused = document.activeElement && document.activeElement.dataset && document.activeElement.dataset.name;
    const caret = focused && document.activeElement.selectionStart;
    pageEl.style.height = (comps.reduce((m, c) => Math.max(m, c.y + c.h), 0) * ROW + 24) + 'px';
    const have = new Map([...pageEl.children].map(n => [n.dataset.c, n]));
    const draws = [];
    comps.forEach((c, i) => {
      let w = have.get(c.id);
      if (!w) { w = el('div', 'wl-c'); w.dataset.c = c.id; }
      have.delete(c.id);
      w.className = 'wl-c' + (FIXED[c.type] ? ' fixed' : '');
      Object.assign(w.style, { left: (c.x / 12 * 100) + '%', width: (c.w / 12 * 100) + '%', top: (c.y * ROW) + 'px', height: (c.h * ROW) + 'px' });
      w.style.setProperty('--h', (c.h * ROW) + 'px');
      if (pageEl.children[i] !== w) pageEl.insertBefore(w, pageEl.children[i] || null);
      if (c.id === keep) return;
      // A video keeps playing while the rest of the page changes, as long as its own settings don't.
      const sig = c.type === 'video' ? JSON.stringify([c.props, val(c.props.src)]) : null;
      if (sig && w.dataset.sig === sig) return;
      if (sig) w.dataset.sig = sig;
      const box = make(c);
      w.replaceChildren(box);
      if (box._draw) draws.push(box._draw);
    });
    for (const n of have.values()) n.remove();
    for (const d of draws) d();
    if (focused) {
      const again = pageEl.querySelector('[data-name="' + focused + '"]');
      if (again && again !== document.activeElement) { again.focus(); try { again.setSelectionRange(caret, caret); } catch (e) { /* not a text box */ } }
    }
  }

  function go(id) {
    const pg = (S.spec.pages || []).find(p => p.id === id || p.name === id) || S.spec.pages[0];
    if (!pg) return;
    S.page = pg;
    if (!OPT.design) { try { history.replaceState(null, '', '#' + encodeURIComponent(pg.name)); } catch (e) { /* a frame without history */ } }
    layout();
    window.scrollTo(0, 0);
  }

  function applyTheme() {
    const t = S.spec.theme || {}, r = document.documentElement.style;
    if (t.primary) r.setProperty('--p', t.primary);
    if (t.bg) r.setProperty('--bg', t.bg);
    if (t.surface) r.setProperty('--sf', t.surface);
    if (t.text) r.setProperty('--tx', t.text);
    r.setProperty('--r', (t.radius ?? 12) + 'px');
    r.setProperty('--font', { serif: 'Georgia, "Times New Roman", serif', rounded: 'ui-rounded, "SF Pro Rounded", system-ui, sans-serif', mono: 'ui-monospace, Menlo, monospace' }[t.font] || 'system-ui, -apple-system, Segoe UI, sans-serif');
    r.colorScheme = t.dark ? 'dark' : 'light';
    document.title = S.spec.name || 'App';
  }

  function layout() {
    applyTheme();
    const pages = S.spec.pages || [];
    if (!S.page || !pages.includes(S.page)) S.page = pages.find(p => S.page && p.id === S.page.id) || pages[0];
    const narrow = OPT.design ? S.stack : window.innerWidth < 720;
    const nav = OPT.design ? 'none' : S.spec.nav || 'top';
    const shell = el('div', 'wl-shell' + (nav === 'side' && !narrow ? ' side' : ''));
    if (nav !== 'none') {
      const n = el('nav', 'wl-nav'); n.appendChild(el('b', '', S.spec.name || 'App'));
      for (const pg of pages.filter(p => p.nav !== false)) {
        const a = el('a', pg === S.page ? 'on' : '', pg.name); a.href = '#' + encodeURIComponent(pg.name);
        a.onclick = e => { e.preventDefault(); go(pg.id); };
        n.appendChild(a);
      }
      n.appendChild(el('span', 'sp'));
      if (S.user && OPT.access !== 'public') {
        n.appendChild(el('span', 'who', S.user.name || S.user.email));
        const out = el('a', '', 'Sign out'); out.href = '#'; out.onclick = e => { e.preventDefault(); steps([{ kind: 'logout' }]); };
        n.appendChild(out);
      }
      shell.appendChild(n);
    }
    const main = el('main', 'wl-main');
    pageEl = el('div', 'wl-page' + (narrow ? ' stack' : ''));
    main.appendChild(pageEl); shell.appendChild(main);
    root.replaceChildren(shell);
    paint();
    loadAuto();
  }

  /* ---- sign-in, for apps that use it ---- */
  function signInScreen(mode, error) {
    const box = el('form', 'wl-auth');
    box.appendChild(el('h1', '', S.spec.name || 'App'));
    box.appendChild(el('p', '', mode === 'up' ? 'Create your account.' : 'Sign in to continue.'));
    const tabs = el('div', 'tabs');
    for (const [k, l] of [['in', 'Sign in'], ['up', 'Create account']]) {
      const b = el('button', k === mode ? 'on' : '', l); b.type = 'button'; b.onclick = () => signInScreen(k); tabs.appendChild(b);
    }
    box.appendChild(tabs);
    const field = (label, name, type) => { const l = el('label', 'wl-f'); l.appendChild(el('span', '', label)); const i = el('input'); i.name = name; i.type = type; i.required = name !== 'name'; l.appendChild(i); box.appendChild(l); return i; };
    if (mode === 'up') field('Your name', 'name', 'text');
    field('Email', 'email', 'email');
    field('Password', 'password', 'password').minLength = mode === 'up' ? 8 : 1;
    if (error) box.appendChild(el('div', 'wl-err', error));
    const b = el('button', 'wl-btn', mode === 'up' ? 'Create account' : 'Sign in'); box.appendChild(b);
    box.onsubmit = async e => {
      e.preventDefault(); b.disabled = true;
      const v = k => (box.elements[k] ? box.elements[k].value : '');
      try {
        S.user = mode === 'up' ? await workline.auth.signup(v('email'), v('password'), v('name')) : await workline.auth.login(v('email'), v('password'));
        loaded = ''; layout();
      } catch (err) { signInScreen(mode, err.message); }
    };
    root.replaceChildren(box);
    const first = box.querySelector('input'); if (first) first.focus();
  }

  async function start() {
    applyTheme();
    if (OPT.design || OPT.access === 'public') {
      S.user = OPT.design ? await workline.auth.me().catch(() => null) : null;
    } else {
      S.user = await workline.auth.me().catch(() => null);
      if (!S.user) return signInScreen('in');
    }
    if (!OPT.design && location.hash) { const want = decodeURIComponent(location.hash.slice(1)); S.page = (S.spec.pages || []).find(p => p.name === want) || null; }
    loaded = '';
    layout();
  }

  addEventListener('workline:signedout', () => { if (OPT.access !== 'public' && !OPT.design) { S.user = null; signInScreen('in', 'Please sign in again.'); } });
  let resizeT;
  addEventListener('resize', () => { clearTimeout(resizeT); resizeT = setTimeout(() => { if (!OPT.design && pageEl) layout(); }, 150); });
  // The editor's canvas: it sends the app as it changes, the page to show, and whether it's a phone.
  if (OPT.design) {
    document.documentElement.classList.add('wl-design');
    addEventListener('message', e => {
      const m = e.data;
      if (e.source !== parent || !m || m.workline !== 'design') return;
      const changed = JSON.stringify(S.spec.data) !== JSON.stringify(m.spec.data);
      S.spec = m.spec; S.stack = !!m.stack;
      S.page = (m.spec.pages || []).find(p => p.id === m.page) || m.spec.pages[0];
      if (changed) loaded = '';
      layout();
    });
  }
  start();
}
