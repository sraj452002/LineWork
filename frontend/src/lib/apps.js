import { api } from './backend.js';
import { nodeDef, runFields } from './flows.js';

/* Apps: a workflow published for people who don't build workflows. Its file.flow.app says how it looks
   and what it asks for:
   { published, name, description, icon, tone, startId, outputId, show,
     inputs: [{ key, label, kind: text | long | number | email | date | choice | yesno, required, options, hint }] }
   The app runs the saved workflow on the server (so it's always the latest version) from startId, with
   the answers as one item ({{ $json.<key> }} in the workflow). What it shows is the output of outputId,
   or of the workflow's last steps. */

export const INPUT_KINDS = [['text', 'Short text'], ['long', 'Long text'], ['number', 'Number'], ['email', 'Email'], ['date', 'Date'], ['choice', 'A choice from a list'], ['yesno', 'Yes / no'], ['file', 'A file']];
export const SHOW = [['auto', 'Best fit'], ['text', 'Text'], ['table', 'Table'], ['cards', 'Cards'], ['json', 'Raw data']];
export const APP_ICONS = ['✨', '🚀', '📊', '📝', '📬', '🔎', '🛒', '💬', '📅', '🧾', '🌦️', '🔔', '🤖', '📈', '🗂️', '🌐'];
// An icon is an emoji, or a picture of your own: a small PNG as a data: URL.
export const isImageIcon = v => typeof v === 'string' && /^data:image\/(png|jpeg|webp);base64,/.test(v);
// An emoji drawn as a square PNG data URL (for an installed app's icon, which must be a picture).
export function emojiPng(emoji, size = 512, bg = '#ffffff') {
  const c = document.createElement('canvas'); c.width = c.height = size;
  const g = c.getContext('2d');
  g.fillStyle = bg; g.fillRect(0, 0, size, size);
  g.font = `${Math.round(size * 0.62)}px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif`;
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(String(emoji || '✨'), size / 2, size * 0.54);
  return c.toDataURL('image/png');
}
// A picture file → a square PNG data URL, size × size, the picture fitted in the middle (cropped to fill).
export function iconImage(file, size = 256) {
  return new Promise((ok, fail) => {
    if (!/^image\//.test(file.type)) return fail(new Error('Pick a picture (PNG, JPG, WebP, GIF or SVG).'));
    if (file.size > 8e6) return fail(new Error('That picture is over 8 MB.'));
    const url = URL.createObjectURL(file), img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas'); c.width = c.height = size;
      const g = c.getContext('2d'), w = img.naturalWidth || size, h = img.naturalHeight || size, k = Math.max(size / w, size / h);
      g.imageSmoothingQuality = 'high';
      g.drawImage(img, (size - w * k) / 2, (size - h * k) / 2, w * k, h * k);
      URL.revokeObjectURL(url);
      ok(c.toDataURL('image/png'));
    };
    img.onerror = () => { URL.revokeObjectURL(url); fail(new Error('That picture couldn’t be read.')); };
    img.src = url;
  });
}

// A field label → a key for {{ $json.key }}: "Your city" → yourCity.
// (Each word lowercased first, like Run by hand's fields: "GST rate" → gstRate.)
export const keyOf = label => String(label || '').replace(/[^\w ]+/g, '').trim().split(/\s+/).filter(Boolean).map((w, i) => (i ? w[0].toUpperCase() + w.slice(1).toLowerCase() : w.toLowerCase())).join('') || 'field';
// The questions a Run by hand trigger already asks (its fields), as an app's questions: the same names,
// so the workflow gets the same {{ $json.… }} either way.
const KIND_OF = { text: 'text', long: 'long', number: 'number', email: 'email', date: 'date', choice: 'choice', yesno: 'yesno', file: 'file', tel: 'text', url: 'text', time: 'text' };
export const inputsFromTrigger = node => (node && node.type === 'trigger.manual' ? runFields(node.params?.fields) : [])
  .map(f => ({ label: f.name, key: f.key, kind: KIND_OF[f.kind] || 'text', required: f.required, ...(f.options.length ? { options: f.options } : {}) }));
// The names a workflow reads from the item it starts with: {{ $json.x }} in the nodes right after its trigger,
// and {{ $node["Trigger"].json.x }} anywhere.
export function namesRead(flow, startId) {
  const start = flow.nodes.find(n => n.id === startId), out = new Set();
  if (!start) return out;
  const next = new Set(flow.edges.filter(e => e.from === startId).map(e => e.to));
  const scan = (text, re) => { for (const m of text.matchAll(re)) out.add(m[1]); };
  for (const n of flow.nodes) {
    const text = JSON.stringify(n.params || {});
    if (next.has(n.id)) scan(text, /\$json\.([A-Za-z_]\w*)/g);
    scan(text, new RegExp(`\\$node\\[\\\\?["']${start.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\\\?["']\\]\\.json\\.([A-Za-z_]\\w*)`, 'g'));
  }
  return out;
}
export const emptyApp = (file, flow) => ({
  published: false, name: file.title || 'My app', description: '', icon: '✨', tone: 'blue',
  startId: (flow.nodes.find(n => n.type === 'trigger.manual') || flow.nodes.find(n => nodeDef(n.type).trigger) || {}).id || '',
  outputId: '', show: 'auto',
  inputs: inputsFromTrigger(flow.nodes.find(n => n.type === 'trigger.manual')),
});
export const publishedApps = files => files.filter(f => !f.archived && f.flow && f.flow.app && f.flow.app.published);

export const runApp = (fileId, input) => api(`/flows/${encodeURIComponent(fileId)}/app`, { method: 'POST', body: { input } }).then(r => r.runId);

// The items an app shows from a finished run: its chosen node's, or those of the steps that ran last.
export function resultOf(flow, run) {
  const nodes = flow.nodes || [], edges = flow.edges || [], got = run.nodes || {};
  const ok = id => got[id] && got[id].status === 'success';
  let ids = flow.app && flow.app.outputId && ok(flow.app.outputId) ? [flow.app.outputId] : [];
  if (!ids.length) ids = nodes.filter(n => ok(n.id) && !edges.some(e => e.from === n.id && ok(e.to))).map(n => n.id);
  return ids.flatMap(id => Object.values(got[id].output || {}).flat());
}

// How to show some items: a few plain words, a table, cards, or raw data.
export function shapeOf(items, show = 'auto') {
  if (show !== 'auto') return show;
  if (!items.length) return 'empty';
  const flat = items.every(i => i && typeof i === 'object' && Object.values(i).every(v => v === null || typeof v !== 'object'));
  const keys = Object.keys(items[0] || {});
  if (items.length === 1 && keys.length <= 3 && ['text', 'message', 'answer', 'result', 'summary', 'translation'].some(k => typeof items[0][k] === 'string')) return 'text';
  if (flat && items.length > 1 && keys.length <= 8) return 'table';
  if (flat) return 'cards';
  return 'json';
}
export const mainText = item => ['text', 'message', 'answer', 'result', 'summary', 'translation'].map(k => item[k]).find(v => typeof v === 'string') ?? '';
export const isImage = v => typeof v === 'string' && (/^data:image\//.test(v) || /^https?:\/\/\S+\.(png|jpe?g|gif|webp|svg)(\?\S*)?$/i.test(v) || /api\.qrserver\.com\/v1\/create-qr-code/.test(v));
export const isLink = v => typeof v === 'string' && /^(https?:\/\/|data:)\S+$/.test(v);

// Items as CSV, for downloading a table.
export function toCSV(items) {
  const keys = [...new Set(items.flatMap(i => Object.keys(i || {})))];
  const cell = v => { const s = v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  return [keys.join(','), ...items.map(i => keys.map(k => cell(i[k])).join(','))].join('\n');
}

// Workflows published as web pages ("Publish web app": active, with a Page trigger), at their own link.
export const livePages = files => files.filter(f => !f.archived && f.flow && f.flow.active).flatMap(f => (f.flow.nodes || [])
  .filter(n => n.type === 'trigger.page' && n.params && n.params.path)
  .map(n => ({ id: `${f.id}:${n.id}`, title: (n.params.title && n.params.title !== 'My page' ? n.params.title : '') || f.title, description: n.params.description || '', icon: n.params.icon || '🌐', updated: f.updated || 0, url: n.params.link ? `/p/${n.params.link}` : `/api/hook/${n.params.path}` })));
