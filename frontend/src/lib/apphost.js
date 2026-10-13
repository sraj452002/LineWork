import { ERRORS, HELPERS, widgetStyle } from './dashboard.js';

/* Custom apps (the App view): a page of your own HTML, CSS and JavaScript that runs your workflows.
   appDoc() wraps the page's HTML with:
     - workline.run(workflow, input): runs one of the workflows the app was given (by name or id) with
       `input` (an object, or a list of them) and resolves to what its last steps output (a list).
     - workline.workflows: [{id, name}] of those workflows.
     - the dashboard helpers: cards, bars, line, pie and table.
   Published, the page is served by the server at /api/ui/<token> (backend/flows.js) as a sandbox, and
   workline.run calls /api/ui/<token>/run. In the editor's preview it asks the editor, by postMessage. */

const json = v => JSON.stringify(v).replace(/</g, '\\u003c');

const SDK = mode => `window.workline = (() => {
  const preview = ${mode === 'preview'};
  const waiting = {}; let n = 0;
  if (preview) addEventListener('message', e => { const m = e.data; if (e.source === parent && m && m.workline === 'result' && waiting[m.id]) { waiting[m.id](m); delete waiting[m.id]; } });
  async function run(workflow, input) {
    if (workflow && typeof workflow === 'object' && input === undefined) { input = workflow; workflow = undefined; }
    if (workflow === undefined && workline.workflows[0]) workflow = workline.workflows[0].name;
    if (preview) {
      const m = await new Promise(res => { const id = ++n; waiting[id] = res; parent.postMessage({ workline: 'run', id, workflow, input }, '*'); });
      if (m.error) throw new Error(m.error);
      return m.items;
    }
    const r = await fetch(location.pathname.replace(/\\/+$/, '') + '/run', { method: 'POST', headers: { 'content-type': 'text/plain' }, body: JSON.stringify({ workflow, input }) }); // text/plain: no preflight
    const j = await r.json().catch(() => ({}));
    if (r.status === 202 || j.pending) throw new Error('The workflow is taking more than a minute. Try again in a while.');
    if (!r.ok) throw new Error(j.message || 'The workflow failed.');
    return j.items;
  }
  return { run, workflows: [] };
})();`;

const THEME = { ink: '#1f2328', ink2: '#57606a', surface: '#f6f8fa', line: '#d0d7de', bg: '#ffffff' };

export function appDoc(html, { mode = 'live', workflows = [], title = 'App' } = {}) {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${String(title).replace(/[<&]/g, c => (c === '<' ? '&lt;' : '&amp;'))}</title>
<style>${widgetStyle(THEME)}</style>
<script>
${SDK(mode)}
workline.workflows = ${json(workflows)};
${HELPERS}
${ERRORS}
</script></head><body>
${html || ''}
</body></html>`;
}

// Pages to start from.
const BASE_CSS = `<style>
  body { max-width: 860px; margin: 0 auto; padding: 32px 20px; font: 15px/1.5 system-ui, -apple-system, Segoe UI, sans-serif; }
  h1 { font-size: 26px; margin: 0 0 4px; }
  .muted { color: #57606a; margin: 0 0 20px; }
  form, .panel { display: flex; gap: 8px; flex-wrap: wrap; align-items: end; padding: 16px; border: 1px solid #d0d7de; border-radius: 12px; background: #f6f8fa; }
  label { display: grid; gap: 4px; font-size: 13px; color: #57606a; flex: 1; min-width: 180px; }
  input, textarea, select { font: inherit; padding: 8px 10px; border: 1px solid #d0d7de; border-radius: 8px; background: #fff; }
  button { font: inherit; font-weight: 600; padding: 9px 16px; border: 0; border-radius: 8px; background: #1f6feb; color: #fff; cursor: pointer; }
  button:disabled { opacity: .6; cursor: default; }
  #out { margin-top: 20px; }
</style>`;

export const APP_STARTERS = [
  { k: 'form', label: 'Form → results', html: `${BASE_CSS}
<h1>My app</h1>
<p class="muted">Fill this in and press Run: it runs a workflow and shows what comes back.</p>

<form id="form">
  <label>Your question <input name="question" placeholder="What should it do?" required></label>
  <button>Run</button>
</form>
<div id="out"></div>

<script>
  const form = document.getElementById('form'), out = document.getElementById('out');
  form.addEventListener('submit', async e => {
    e.preventDefault();
    const button = form.querySelector('button');
    button.disabled = true; out.textContent = 'Running…';
    try {
      // Runs this app's first workflow (or name one: workline.run('Workflow name', input)).
      const items = await workline.run(Object.fromEntries(new FormData(form)));
      table(out, items);
    } catch (err) {
      out.textContent = err.message;
    }
    button.disabled = false;
  });
</script>` },
  { k: 'dashboard', label: 'Dashboard (runs on open)', html: `${BASE_CSS}
<h1>Dashboard</h1>
<p class="muted">Runs the workflow when the page opens, and every minute.</p>
<div id="cards"></div>
<div id="chart"></div>
<div id="rows"></div>

<script>
  async function refresh() {
    const rows = await workline.run({});
    const first = rows[0] || {};
    const label = Object.keys(first).find(k => typeof first[k] === 'string');
    const value = Object.keys(first).find(k => typeof first[k] === 'number');
    if (value) {
      const vals = rows.map(r => +r[value] || 0);
      cards('#cards', [['Total ' + value, vals.reduce((a, b) => a + b, 0)], ['Rows', rows.length], ['Highest', Math.max(...vals)]]);
      if (label) bars('#chart', rows.slice(0, 24), label, value);
    }
    table('#rows', rows);
  }
  refresh();
  setInterval(refresh, 60_000);
</script>` },
  { k: 'chat', label: 'Chat', html: `${BASE_CSS}
<style>
  #log { display: grid; gap: 8px; margin-bottom: 12px; }
  .msg { padding: 10px 14px; border-radius: 12px; max-width: 80%; white-space: pre-wrap; }
  .me { background: #1f6feb; color: #fff; justify-self: end; }
  .bot { background: #f6f8fa; border: 1px solid #d0d7de; }
</style>
<h1>Assistant</h1>
<p class="muted">Each message runs the workflow with { message }; it answers with the first text field it gives back.</p>
<div id="log"></div>
<form id="form"><label>Message <input name="message" autocomplete="off" required></label><button>Send</button></form>

<script>
  const log = document.getElementById('log'), form = document.getElementById('form');
  const say = (text, who) => { const d = document.createElement('div'); d.className = 'msg ' + who; d.textContent = text; log.appendChild(d); };
  form.addEventListener('submit', async e => {
    e.preventDefault();
    const message = form.message.value; form.reset(); say(message, 'me');
    try {
      const [first = {}] = await workline.run({ message });
      say(Object.values(first).find(v => typeof v === 'string') || JSON.stringify(first), 'bot');
    } catch (err) { say(err.message, 'bot'); }
  });
</script>` },
];
