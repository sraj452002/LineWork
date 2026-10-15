import { createHash, createHmac, randomBytes, randomInt, randomUUID } from 'node:crypto';
import { FlowError, setPath } from './flow-engine.js';
import { each } from './flow-util.js';

/* Small tool nodes that work on one value of each item, all on the server and without any account:
   text, numbers, dates, lists, objects, encoding and hashes, checks, unit conversions and generators.

   Each is defined once here with T(): its group, label, note, the function, its extra fields, and test
   cases (t: [value, expected, params?]) that tests/flow-tools.spec.js runs and the guide shows as the
   example. Every tool reads `value` (usually an expression such as {{ $json.text }}) and puts its result
   on the item at `output`. TOOL_META is what the editor needs (scripts/more-nodes.mjs writes it out). */

export const TOOL_META = {};
export const TOOL_NODES = {};
export const TOOL_TESTS = {};

const GROUP = {
  Text: { icon: 'text', tone: 'teal', vl: 'Text', dv: '{{ $json.text }}' },
  Numbers: { icon: 'sum', tone: 'amber', vl: 'Number', dv: '{{ $json.amount }}' },
  Dates: { icon: 'cal', tone: 'blue', vl: 'Date', dv: '{{ $json.date }}' },
  Lists: { icon: 'stack', tone: 'indigo', vl: 'List', dv: '{{ $json.list }}' },
  Objects: { icon: 'braces', tone: 'violet', vl: 'Object', dv: '{{ $json }}' },
  'Encode & hash': { icon: 'lock', tone: 'slate', vl: 'Text', dv: '{{ $json.text }}' },
  Check: { icon: 'filter', tone: 'green', vl: 'Value', dv: '{{ $json.value }}' },
  Convert: { icon: 'scale', tone: 'orange', vl: 'Value', dv: '{{ $json.value }}' },
  Generate: { icon: 'star', tone: 'pink', vl: 'Value', dv: '' },
};
export const TOOL_GROUPS = Object.keys(GROUP);

const show = v => (typeof v === 'string' ? JSON.stringify(v) : JSON.stringify(v));
const exOf = (t, f) => {
  const [v, want, p] = t;
  const hasValue = f.some(y => y.k === 'value');
  const params = p ? Object.entries(p).map(([k, x]) => `${(f.find(y => y.k === k) || { label: k }).label}: ${show(x)}`).join(' · ') : '';
  const lead = hasValue ? `${show(v)}${params ? ` (${params})` : ''}` : params || 'Run it';
  return `${lead} → ${typeof want === 'function' ? 'e.g. ' + show(want.example) : show(want)}`;
};

function T(group, key, label, note, fn, o = {}) {
  const g = GROUP[group], type = key, out = o.out || 'result';
  const fields = [
    ...(o.nv ? [] : [{ k: 'value', label: o.vl || g.vl, kind: 'text', hint: o.dv || g.dv }]),
    ...(o.f || []),
    { k: 'output', label: 'Put the result in', kind: 'text', hint: out },
  ];
  const defaults = { ...(o.nv ? {} : { value: o.dv || g.dv }), ...Object.fromEntries((o.f || []).filter(f => f.d !== undefined).map(f => [f.k, f.d])), output: out };
  const tests = o.t || [];
  TOOL_META[type] = {
    group, label, note, icon: o.icon || g.icon, tone: g.tone,
    fields: fields.map(({ d, ...f }) => f), defaults,
    guide: { what: `${note}.`, ex: o.ex || (tests[0] ? exOf(tests[0], fields) : `${label} on ${o.dv || g.dv}`), out: `Each item as it came, with the result in “${out}” (or the field you name).` },
  };
  TOOL_NODES[type] = { run: args => each(args, (p, item) => {
    const j = structuredClone(item.json);
    setPath(j, p.output || out, fn(o.nv ? undefined : p.value, p, item.json));
    return j;
  }) };
  TOOL_TESTS[type] = tests;
}

/* ---- reading values ---- */
const bad = msg => { throw new FlowError(msg, 'bad_value'); };
const S = v => (v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v));
const N = (v, what = 'The value') => {
  if (typeof v === 'number') return v;
  if (typeof v === 'boolean') return v ? 1 : 0;
  const s = String(v ?? '').replace(/[,\s₹$€£¥_]/g, '').replace(/^Rs\.?/i, '');
  const x = s === '' ? NaN : Number(s);
  if (!Number.isFinite(x)) bad(`${what} “${S(v).slice(0, 40)}” isn't a number.`);
  return x;
};
const Nopt = (v, d) => (v === undefined || v === null || v === '' ? d : N(v));
const L = v => {
  if (Array.isArray(v)) return v;
  if (v == null || v === '') return [];
  if (typeof v === 'string') {
    const s = v.trim();
    if (s.startsWith('[')) { try { const a = JSON.parse(s); if (Array.isArray(a)) return a; } catch (e) { /* a list of words */ } }
    return s.split(/\s*[,\n]\s*/).filter(x => x !== '');
  }
  if (typeof v === 'object') return Object.values(v);
  return [v];
};
const O = v => {
  if (v && typeof v === 'object' && !Array.isArray(v)) return v;
  if (typeof v === 'string' && v.trim().startsWith('{')) { try { return JSON.parse(v); } catch (e) { bad('The object isn’t valid JSON.'); } }
  if (v == null || v === '') return {};
  bad('The value must be an object, e.g. {{ $json }}.');
};
const D = v => {
  if (v instanceof Date) return v;
  if (v === undefined || v === null || v === '') return new Date();
  let d;
  if (typeof v === 'number' || /^\d{9,13}$/.test(String(v).trim())) { const n = Number(v); d = new Date(n < 1e11 ? n * 1000 : n); } else d = new Date(String(v).trim());
  if (Number.isNaN(d.getTime())) bad(`“${S(v).slice(0, 40)}” isn't a date.`);
  return d;
};
const B = v => v === true || v === 'true' || v === 1 || v === '1' || v === 'on' || v === 'yes';
const num = (k, label, d, hint) => ({ k, label, kind: 'number', d, ...(hint ? { hint } : {}) });
const txt = (k, label, d, hint) => ({ k, label, kind: 'text', d, ...(hint ? { hint } : {}) });
const sel = (k, label, options, d) => ({ k, label, kind: 'select', options: options.map(o => (Array.isArray(o) ? o : [o, o])), d: d ?? (Array.isArray(options[0]) ? options[0][0] : options[0]) });
const bool = (k, label, d = false) => ({ k, label, kind: 'bool', d });
const round = (x, n = 2) => { const f = 10 ** n; return Math.round((x + Number.EPSILON) * f) / f; };
const words = s => S(s).trim().split(/\s+/).filter(Boolean);
const wordsOf = s => S(s).replace(/([a-z\d])([A-Z])/g, '$1 $2').replace(/[^A-Za-z\d]+/g, ' ').trim().split(/\s+/).filter(Boolean);
const cap = w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
const regexEscape = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const deaccent = s => S(s).normalize('NFD').replace(/[̀-ͯ]/g, '');

/* ================= Text ================= */
T('Text', 'text.upper', 'Uppercase', 'Turns the text into CAPITAL LETTERS', v => S(v).toUpperCase(), { t: [['hello', 'HELLO']] });
T('Text', 'text.lower', 'Lowercase', 'Turns the text into small letters', v => S(v).toLowerCase(), { t: [['HeLLo', 'hello']] });
T('Text', 'text.title', 'Title Case', 'Capitalises The First Letter Of Every Word', v => S(v).toLowerCase().replace(/(^|[\s-])(\p{L})/gu, (_, a, b) => a + b.toUpperCase()), { t: [['the quick brown fox', 'The Quick Brown Fox']] });
T('Text', 'text.sentence', 'Sentence case', 'Makes the first letter of each sentence capital, the rest small', v => S(v).toLowerCase().replace(/(^\s*|[.!?]\s+)(\p{L})/gu, (_, a, b) => a + b.toUpperCase()), { t: [['HELLO THERE. HOW ARE YOU?', 'Hello there. How are you?']] });
T('Text', 'text.capitalize', 'Capitalize first letter', 'Makes only the very first letter capital', v => { const s = S(v); return s.charAt(0).toUpperCase() + s.slice(1); }, { t: [['workline rocks', 'Workline rocks']] });
T('Text', 'text.camel', 'camelCase', 'Joins the words as camelCase (for keys and code)', v => wordsOf(v).map((w, i) => (i ? cap(w) : w.toLowerCase())).join(''), { t: [['first name', 'firstName'], ['Order ID', 'orderId']] });
T('Text', 'text.pascal', 'PascalCase', 'Joins the words as PascalCase', v => wordsOf(v).map(cap).join(''), { t: [['user profile page', 'UserProfilePage']] });
T('Text', 'text.snake', 'snake_case', 'Joins the words with underscores, in small letters', v => wordsOf(v).map(w => w.toLowerCase()).join('_'), { t: [['First Name', 'first_name'], ['orderTotal', 'order_total']] });
T('Text', 'text.kebab', 'kebab-case', 'Joins the words with dashes, in small letters', v => wordsOf(v).map(w => w.toLowerCase()).join('-'), { t: [['Hello World Again', 'hello-world-again']] });
T('Text', 'text.constant', 'CONSTANT_CASE', 'Joins the words with underscores, in capitals', v => wordsOf(v).map(w => w.toUpperCase()).join('_'), { t: [['api base url', 'API_BASE_URL']] });
T('Text', 'text.slug', 'Slug', 'Makes a URL-friendly slug: small letters, digits and dashes', v => deaccent(v).toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, ''), { t: [['Café & Bar: Top 10!', 'cafe-and-bar-top-10']] });
T('Text', 'text.trim', 'Trim', 'Removes spaces at the start and end', v => S(v).trim(), { t: [['  hi  ', 'hi']] });
T('Text', 'text.squash', 'Collapse spaces', 'Turns runs of spaces, tabs and newlines into one space', v => S(v).replace(/\s+/g, ' ').trim(), { t: [['a   b \n\n c', 'a b c']] });
T('Text', 'text.reverse', 'Reverse text', 'Writes the text backwards', v => [...S(v)].reverse().join(''), { t: [['abc', 'cba']] });
T('Text', 'text.length', 'Character count', 'Counts the characters', v => [...S(v)].length, { t: [['héllo', 5]], out: 'length' });
T('Text', 'text.words', 'Word count', 'Counts the words', v => words(v).length, { t: [['one two  three', 3]], out: 'words' });
T('Text', 'text.lines', 'Line count', 'Counts the lines', v => (S(v) === '' ? 0 : S(v).split(/\r?\n/).length), { t: [['a\nb\nc', 3]], out: 'lines' });
T('Text', 'text.truncate', 'Truncate', 'Cuts the text to a length, adding an ending such as …', (v, p) => {
  const s = S(v), max = Nopt(p.max, 100), end = p.ending ?? '…';
  if ([...s].length <= max) return s;
  let cut = [...s].slice(0, Math.max(0, max - [...end].length)).join('');
  if (B(p.words) && cut.includes(' ')) cut = cut.slice(0, cut.lastIndexOf(' '));
  return cut.trimEnd() + end;
}, { f: [num('max', 'Most characters', 100), txt('ending', 'Ending', '…'), bool('words', 'Don’t cut a word in half', true)], t: [['The quick brown fox jumps', 'The quick…', { max: 12, ending: '…', words: true }]] });
T('Text', 'text.padStart', 'Pad start', 'Adds characters in front until the text is long enough (e.g. 7 → 007)', (v, p) => S(v).padStart(Nopt(p.length, 3), p.char || '0'), { f: [num('length', 'Length', 3), txt('char', 'With', '0')], t: [[7, '007', { length: 3, char: '0' }]] });
T('Text', 'text.padEnd', 'Pad end', 'Adds characters after the text until it’s long enough', (v, p) => S(v).padEnd(Nopt(p.length, 10), p.char || ' '), { f: [num('length', 'Length', 10), txt('char', 'With', '.')], t: [['ab', 'ab...', { length: 5, char: '.' }]] });
T('Text', 'text.replace', 'Find and replace', 'Replaces words or a pattern in the text', (v, p) => {
  const find = S(p.find);
  if (!find) return S(v);
  const flags = (B(p.all) ? 'g' : '') + (B(p.ignoreCase) ? 'i' : '');
  let re;
  try { re = new RegExp(B(p.regex) ? find : regexEscape(find), flags); } catch (e) { bad(`The pattern isn't valid: ${e.message}`); }
  return S(v).replace(re, S(p.with));
}, { f: [txt('find', 'Find'), txt('with', 'Replace with'), bool('all', 'Every time (not just the first)', true), bool('ignoreCase', 'Ignore capitals'), bool('regex', 'Find is a regular expression')], t: [['red, red, blue', 'green, green, blue', { find: 'red', with: 'green', all: true }], ['a1b22', 'a#b#', { find: '\\d+', with: '#', all: true, regex: true }]] });
T('Text', 'text.removeHtml', 'Strip HTML', 'Removes HTML tags and turns entities like &amp; back into text', v => S(v).replace(/<(script|style)[\s\S]*?<\/\1>/gi, '').replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").trim(), { t: [['<p>Hi <b>there</b> &amp; you</p>', 'Hi there & you']] });
T('Text', 'text.removeEmoji', 'Remove emoji', 'Takes the emoji out of the text', v => S(v).replace(/[\p{Extended_Pictographic}\u{1F1E6}-\u{1F1FF}\u{FE0F}\u{200D}]/gu, '').replace(/ {2,}/g, ' ').trim(), { t: [['Great job 🎉🔥 team', 'Great job team']] });
T('Text', 'text.removeAccents', 'Remove accents', 'Turns é into e, ñ into n and so on', v => deaccent(v), { t: [['Crème brûlée', 'Creme brulee']] });
T('Text', 'text.digits', 'Keep digits only', 'Keeps only 0–9 (handy for phone numbers)', v => S(v).replace(/\D+/g, ''), { t: [['+91 98765-43210', '919876543210']] });
T('Text', 'text.letters', 'Keep letters only', 'Keeps only letters and spaces', v => S(v).replace(/[^\p{L}\s]+/gu, '').replace(/\s+/g, ' ').trim(), { t: [['R2-D2 is #1!', 'RD is']] });
T('Text', 'text.split', 'Split into a list', 'Splits the text at a separator into a list', (v, p) => { const parts = S(v).split(p.separator === '\\n' ? '\n' : (p.separator ?? ',')); return B(p.trim) ? parts.map(s => s.trim()).filter(Boolean) : parts; }, { f: [txt('separator', 'Separator (\\n for new line)', ','), bool('trim', 'Trim each and drop empty ones', true)], t: [['a, b,,c', ['a', 'b', 'c'], { separator: ',', trim: true }]], out: 'list' });
T('Text', 'text.between', 'Text between', 'Takes the text between two markers', (v, p) => { const s = S(v), a = s.indexOf(S(p.start)); if (a < 0) return ''; const from = a + S(p.start).length, b = p.end ? s.indexOf(S(p.end), from) : -1; return s.slice(from, b < 0 ? undefined : b); }, { f: [txt('start', 'After'), txt('end', 'Before')], t: [['Order #123 shipped', '123', { start: '#', end: ' ' }]] });
T('Text', 'text.before', 'Text before', 'Takes the text before a marker', (v, p) => { const s = S(v), i = s.indexOf(S(p.marker)); return i < 0 ? s : s.slice(0, i); }, { f: [txt('marker', 'Marker', '@')], t: [['ada@example.com', 'ada', { marker: '@' }]] });
T('Text', 'text.after', 'Text after', 'Takes the text after a marker', (v, p) => { const s = S(v), i = s.indexOf(S(p.marker)); return i < 0 ? '' : s.slice(i + S(p.marker).length); }, { f: [txt('marker', 'Marker', '@')], t: [['ada@example.com', 'example.com', { marker: '@' }]] });
T('Text', 'text.contains', 'Contains?', 'True when the text contains some words', (v, p) => (B(p.ignoreCase) ? S(v).toLowerCase().includes(S(p.find).toLowerCase()) : S(v).includes(S(p.find))), { f: [txt('find', 'Find'), bool('ignoreCase', 'Ignore capitals', true)], t: [['Urgent: server down', true, { find: 'urgent', ignoreCase: true }]], out: 'contains' });
T('Text', 'text.startsWith', 'Starts with?', 'True when the text starts with some words', (v, p) => S(v).startsWith(S(p.find)), { f: [txt('find', 'Starts with')], t: [['INV-2041', true, { find: 'INV-' }]], out: 'startsWith' });
T('Text', 'text.endsWith', 'Ends with?', 'True when the text ends with some words', (v, p) => S(v).endsWith(S(p.find)), { f: [txt('find', 'Ends with')], t: [['report.pdf', true, { find: '.pdf' }]], out: 'endsWith' });
T('Text', 'text.count', 'Count occurrences', 'Counts how many times some words appear', (v, p) => (S(p.find) ? S(v).split(S(p.find)).length - 1 : 0), { f: [txt('find', 'Find')], t: [['la la land', 2, { find: 'la ' }]], out: 'count' });
T('Text', 'text.repeat', 'Repeat text', 'Repeats the text a number of times', (v, p) => S(v).repeat(Math.min(1000, Math.max(0, Nopt(p.times, 2)))), { f: [num('times', 'Times', 2)], t: [['ha', 'hahaha', { times: 3 }]] });
T('Text', 'text.wrap', 'Wrap lines', 'Breaks long text into lines of at most N characters', (v, p) => {
  const width = Nopt(p.width, 60), out = [];
  for (const para of S(v).split('\n')) { let line = ''; for (const w of para.split(/\s+/).filter(Boolean)) { if (line && (line + ' ' + w).length > width) { out.push(line); line = w; } else line = line ? line + ' ' + w : w; } out.push(line); }
  return out.join('\n');
}, { f: [num('width', 'Line width', 60)], t: [['one two three four', 'one two\nthree four', { width: 10 }]] });
T('Text', 'text.firstLine', 'First line', 'Takes the first line of the text', v => S(v).split(/\r?\n/)[0], { t: [['Subject\nBody', 'Subject']] });
T('Text', 'text.lastLine', 'Last line', 'Takes the last line of the text', v => S(v).split(/\r?\n/).pop(), { t: [['a\nb\nlast', 'last']] });
T('Text', 'text.lineList', 'Lines into a list', 'Makes a list with one entry per non-empty line', v => S(v).split(/\r?\n/).map(s => s.trim()).filter(Boolean), { t: [['a\n\n b \nc', ['a', 'b', 'c']]], out: 'list' });
T('Text', 'text.emails', 'Find emails', 'Finds every email address in the text', v => [...new Set(S(v).match(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g) || [])], { t: [['Mail ada@x.io or tim@y.com', ['ada@x.io', 'tim@y.com']]], out: 'emails' });
T('Text', 'text.urls', 'Find links', 'Finds every web link in the text', v => [...new Set((S(v).match(/https?:\/\/[^\s<>"')]+/g) || []).map(u => u.replace(/[.,;:!?]+$/, '')))], { t: [['See https://a.com/x, and http://b.org.', ['https://a.com/x', 'http://b.org']]], out: 'links' });
T('Text', 'text.numbers', 'Find numbers', 'Finds every number in the text', v => (S(v).match(/-?\d[\d,]*(\.\d+)?/g) || []).map(x => Number(x.replace(/,/g, ''))), { t: [['2 apples cost ₹1,250.50', [2, 1250.5]]], out: 'numbers' });
T('Text', 'text.hashtags', 'Find hashtags', 'Finds every #hashtag', v => [...new Set(S(v).match(/#[\p{L}\d_]+/gu) || [])], { t: [['Loving #Workline and #nocode!', ['#Workline', '#nocode']]], out: 'hashtags' });
T('Text', 'text.mentions', 'Find @mentions', 'Finds every @mention', v => [...new Set(S(v).match(/(?<![\w.])@[\w.]+\w/g) || [])], { t: [['Thanks @ada and @tim.k! mail a@b.c', ['@ada', '@tim.k']]], out: 'mentions' });
T('Text', 'text.initials', 'Initials', 'Takes the first letter of each word (Ada Lovelace → AL)', v => words(v).map(w => w[0].toUpperCase()).join(''), { t: [['Ada Lovelace', 'AL']], out: 'initials' });
T('Text', 'text.readingTime', 'Reading time', 'Minutes it takes to read the text (200 words a minute)', (v, p) => Math.max(1, Math.ceil(words(v).length / Nopt(p.wpm, 200))), { f: [num('wpm', 'Words a minute', 200)], t: [['word '.repeat(450), 3, { wpm: 200 }]], out: 'minutes' });
T('Text', 'text.template', 'Fill a template', 'Fills {name} placeholders in the text with the item’s fields', (v, p, item) => S(v).replace(/\{([\w.]+)\}/g, (m, k) => { const x = k.split('.').reduce((o, key) => (o == null ? undefined : o[key]), item); return x == null ? m : S(x); }), { dv: 'Hi {name}, your order {order.id} is ready.', t: [['Hi {name}!', 'Hi {name}!']], ex: '“Hi {name}, order {order.id}” with the item {name: "Ada", order: {id: 7}} → "Hi Ada, order 7"' });
T('Text', 'text.mask', 'Mask', 'Hides all but the last few characters (cards, phones)', (v, p) => { const s = S(v), keep = Nopt(p.keep, 4); return s.length <= keep ? s : (p.char || '•').repeat(s.length - keep) + s.slice(-keep); }, { f: [num('keep', 'Keep the last', 4), txt('char', 'Mask with', '•')], t: [['9876543210', '******3210', { keep: 4, char: '*' }]] });
T('Text', 'text.dedupeLines', 'Remove duplicate lines', 'Keeps only the first of lines that repeat', v => [...new Set(S(v).split(/\r?\n/))].join('\n'), { t: [['a\nb\na', 'a\nb']] });
T('Text', 'text.sortLines', 'Sort lines', 'Sorts the lines A → Z (or Z → A)', (v, p) => { const l = S(v).split(/\r?\n/).sort((a, b) => a.localeCompare(b, undefined, { numeric: true })); return (p.order === 'desc' ? l.reverse() : l).join('\n'); }, { f: [sel('order', 'Order', [['asc', 'A → Z'], ['desc', 'Z → A']])], t: [['pear\napple\nfig', 'apple\nfig\npear', { order: 'asc' }]] });
const lev = (a, b) => {
  a = [...a]; b = [...b];
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) { const cur = [i]; for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); prev = cur; }
  return prev[b.length];
};
T('Text', 'text.distance', 'Edit distance', 'How many letters must change to turn one text into the other', (v, p) => lev(S(v), S(p.other)), { f: [txt('other', 'Compare with')], t: [['kitten', 3, { other: 'sitting' }]], out: 'distance' });
T('Text', 'text.similarity', 'Similarity %', 'How alike two texts are, 0–100 (ignoring capitals)', (v, p) => { const a = S(v).toLowerCase(), b = S(p.other).toLowerCase(), m = Math.max([...a].length, [...b].length); return m ? round((1 - lev(a, b) / m) * 100, 1) : 100; }, { f: [txt('other', 'Compare with')], t: [['Workline', 88.9, { other: 'workline!' }]], out: 'similarity' });
T('Text', 'text.escapeRegex', 'Escape for a pattern', 'Escapes characters like . * ? so the text can go in a regular expression', v => regexEscape(S(v)), { t: [['1+1=2?', '1\\+1=2\\?']] });
T('Text', 'text.normalize', 'Clean up text', 'Trims, collapses spaces, and fixes curly quotes and dashes', v => S(v).replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, '-').replace(/ /g, ' ').replace(/[ \t]+/g, ' ').replace(/ *\n */g, '\n').trim(), { t: [['  “Hi”  —  it’s  me ', '"Hi" - it\'s me']] });
T('Text', 'text.indent', 'Indent lines', 'Adds spaces (or any prefix) in front of every line', (v, p) => S(v).split('\n').map(l => (p.prefix ?? '  ') + l).join('\n'), { f: [txt('prefix', 'Prefix', '  ', 'two spaces, or > for a quote')], t: [['a\nb', '> a\n> b', { prefix: '> ' }]] });
T('Text', 'text.vowels', 'Count vowels', 'Counts the vowels (a, e, i, o, u)', v => (deaccent(v).match(/[aeiou]/gi) || []).length, { t: [['Workline', 3]], out: 'vowels' });
T('Text', 'text.longestWord', 'Longest word', 'Finds the longest word', v => words(S(v).replace(/[^\p{L}\d\s'-]/gu, '')).reduce((a, w) => (w.length > a.length ? w : a), ''), { t: [['a quick extraordinary fox', 'extraordinary']], out: 'word' });
T('Text', 'text.topWords', 'Top words', 'The most used words and how often (skips little words like “the”)', (v, p) => {
  const stop = new Set('a an and are as at be but by for from has have i in is it its of on or that the this to was were will with you your we our'.split(' '));
  const c = {};
  for (const w of S(v).toLowerCase().match(/[\p{L}\d']+/gu) || []) if (w.length > 1 && !stop.has(w)) c[w] = (c[w] || 0) + 1;
  return Object.entries(c).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, Nopt(p.top, 10)).map(([word, count]) => ({ word, count }));
}, { f: [num('top', 'How many', 10)], t: [['The cat and the hat. Cat!', [{ word: 'cat', count: 2 }, { word: 'hat', count: 1 }], { top: 2 }]], out: 'topWords' });
T('Text', 'text.sentences', 'Split into sentences', 'Makes a list with one entry per sentence', v => (S(v).match(/[^.!?]+[.!?]+|[^.!?]+$/g) || []).map(s => s.trim()).filter(Boolean), { t: [['Hi. How are you? Fine!', ['Hi.', 'How are you?', 'Fine!']]], out: 'sentences' });

/* ================= Numbers ================= */
const arith = (key, label, note, f, sample) => T('Numbers', key, label, note, (v, p) => f(N(v), N(p.by, 'The other number')), { f: [txt('by', label === 'Divide' ? 'By' : label === 'Subtract' ? 'Minus' : label === 'Power' ? 'To the power of' : label === 'Remainder' ? 'Divided by' : 'And', String(sample[1]))], t: [[sample[0], sample[2], { by: sample[1] }]] });
arith('num.add', 'Add', 'Adds a number', (a, b) => a + b, [5, 3, 8]);
arith('num.subtract', 'Subtract', 'Takes a number away', (a, b) => a - b, [10, 4, 6]);
arith('num.multiply', 'Multiply', 'Multiplies by a number', (a, b) => a * b, [6, 7, 42]);
arith('num.divide', 'Divide', 'Divides by a number', (a, b) => (b === 0 ? bad('Can’t divide by zero.') : a / b), [10, 4, 2.5]);
arith('num.modulo', 'Remainder', 'The remainder after dividing (10 mod 3 = 1)', (a, b) => (b === 0 ? bad('Can’t divide by zero.') : a % b), [10, 3, 1]);
arith('num.power', 'Power', 'Raises to a power (2⁸ = 256)', (a, b) => a ** b, [2, 8, 256]);
T('Numbers', 'num.sqrt', 'Square root', 'The square root', v => (N(v) < 0 ? bad('No square root of a negative number.') : Math.sqrt(N(v))), { t: [[81, 9]] });
T('Numbers', 'num.abs', 'Absolute value', 'Drops the minus sign', v => Math.abs(N(v)), { t: [[-42, 42]] });
T('Numbers', 'num.negate', 'Flip the sign', 'Turns 5 into -5 and -5 into 5', v => -N(v), { t: [[5, -5]] });
T('Numbers', 'num.round', 'Round', 'Rounds to some decimal places', (v, p) => round(N(v), Nopt(p.decimals, 0)), { f: [num('decimals', 'Decimal places', 2)], t: [[3.14159, 3.14, { decimals: 2 }]] });
T('Numbers', 'num.floor', 'Round down', 'Rounds down to a whole number', v => Math.floor(N(v)), { t: [[4.9, 4]] });
T('Numbers', 'num.ceil', 'Round up', 'Rounds up to a whole number', v => Math.ceil(N(v)), { t: [[4.1, 5]] });
T('Numbers', 'num.roundTo', 'Round to nearest', 'Rounds to the nearest step, e.g. the nearest 5 or 0.25', (v, p) => { const s = Nopt(p.step, 5); return round(Math.round(N(v) / s) * s, 10); }, { f: [num('step', 'Step', 5)], t: [[17, 15, { step: 5 }], [1.37, 1.25, { step: 0.25 }]] });
T('Numbers', 'num.clamp', 'Keep within', 'Keeps the number between a lowest and highest value', (v, p) => Math.min(Nopt(p.max, Infinity), Math.max(Nopt(p.min, -Infinity), N(v))), { f: [num('min', 'Lowest', 0), num('max', 'Highest', 100)], t: [[140, 100, { min: 0, max: 100 }]] });
T('Numbers', 'num.percentOf', 'Percentage of', 'What percent the value is of a total (25 of 200 = 12.5%)', (v, p) => round(N(v) / N(p.total, 'The total') * 100, 2), { f: [txt('total', 'Of the total', '100')], t: [[25, 12.5, { total: 200 }]], out: 'percent' });
T('Numbers', 'num.percentChange', 'Percent change', 'The change from an old value to this one, in percent', (v, p) => { const old = N(p.from, 'The old value'); return old === 0 ? bad('The old value is 0.') : round((N(v) - old) / Math.abs(old) * 100, 2); }, { f: [txt('from', 'Old value')], t: [[120, 20, { from: 100 }]], out: 'change' });
T('Numbers', 'num.addPercent', 'Add a percent', 'Adds (or with a minus, takes off) a percent', (v, p) => round(N(v) * (1 + N(p.percent) / 100), 2), { f: [txt('percent', 'Percent', '10')], t: [[200, 220, { percent: 10 }], [200, 150, { percent: -25 }]] });
T('Numbers', 'num.discount', 'Discount', 'Price after a discount: the price, what you save, and the final price', (v, p) => { const price = N(v), off = round(price * N(p.percent) / 100, 2); return { price, discount: off, final: round(price - off, 2) }; }, { f: [txt('percent', 'Discount %', '20')], t: [[1500, { price: 1500, discount: 300, final: 1200 }, { percent: 20 }]], out: 'discount' });
T('Numbers', 'num.gst', 'GST / tax', 'Adds tax to a price, or takes it out of a price that includes it', (v, p) => {
  const x = N(v), r = Nopt(p.rate, 18) / 100;
  if (p.mode === 'included') { const net = round(x / (1 + r), 2); return { net, tax: round(x - net, 2), total: x, cgst: round((x - net) / 2, 2), sgst: round((x - net) / 2, 2) }; }
  const tax = round(x * r, 2); return { net: x, tax, total: round(x + tax, 2), cgst: round(tax / 2, 2), sgst: round(tax / 2, 2) };
}, { f: [num('rate', 'Rate %', 18), sel('mode', 'The price', [['excluded', 'is before tax (add it)'], ['included', 'already includes tax']])], t: [[1000, { net: 1000, tax: 180, total: 1180, cgst: 90, sgst: 90 }, { rate: 18, mode: 'excluded' }]], out: 'tax' });
T('Numbers', 'num.emi', 'Loan EMI', 'The monthly instalment of a loan, with total interest', (v, p) => {
  const P = N(v), r = Nopt(p.rate, 10) / 12 / 100, n = Nopt(p.months, 12);
  const emi = r ? P * r * (1 + r) ** n / ((1 + r) ** n - 1) : P / n;
  return { emi: round(emi, 2), total: round(emi * n, 2), interest: round(emi * n - P, 2) };
}, { vl: 'Loan amount', f: [num('rate', 'Interest % a year', 10), num('months', 'Months', 12)], t: [[100000, { emi: 8791.59, total: 105499.06, interest: 5499.06 }, { rate: 10, months: 12 }]], out: 'loan' });
T('Numbers', 'num.compound', 'Compound interest', 'What an amount grows to with interest added each period', (v, p) => { const P = N(v), r = Nopt(p.rate, 8) / 100, n = Nopt(p.perYear, 1), t = Nopt(p.years, 5), total = P * (1 + r / n) ** (n * t); return { total: round(total, 2), interest: round(total - P, 2) }; }, { vl: 'Amount', f: [num('rate', 'Interest % a year', 8), num('years', 'Years', 5), num('perYear', 'Added times a year', 1)], t: [[10000, { total: 14693.28, interest: 4693.28 }, { rate: 8, years: 5, perYear: 1 }]], out: 'growth' });
T('Numbers', 'num.sip', 'SIP returns', 'What a monthly investment grows to at a yearly return', (v, p) => { const m = N(v), i = Nopt(p.rate, 12) / 12 / 100, n = Nopt(p.years, 10) * 12, fv = i ? m * (((1 + i) ** n - 1) / i) * (1 + i) : m * n; return { invested: round(m * n, 2), value: round(fv, 2), gain: round(fv - m * n, 2) }; }, { vl: 'Monthly amount', f: [num('rate', 'Return % a year', 12), num('years', 'Years', 10)], t: [[5000, { invested: 600000, value: 1161695.38, gain: 561695.38 }, { rate: 12, years: 10 }]], out: 'sip' });
const stats = (key, label, note, f, sample, want) => T('Numbers', key, label, note, v => { const l = L(v).map(x => N(x)); if (!l.length) bad('The list is empty.'); return f(l); }, { vl: 'Numbers (a list)', dv: '{{ $json.numbers }}', t: [[sample, want]] });
stats('num.sum', 'Sum', 'Adds up a list of numbers', l => round(l.reduce((a, b) => a + b, 0), 10), [1, 2, 3.5], 6.5);
stats('num.average', 'Average', 'The average (mean) of a list of numbers', l => round(l.reduce((a, b) => a + b, 0) / l.length, 10), [2, 4, 9], 5);
stats('num.median', 'Median', 'The middle value of a list of numbers', l => { const s = [...l].sort((a, b) => a - b), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; }, [5, 1, 9, 3], 4);
stats('num.mode', 'Most common', 'The number that appears most often', l => { const c = new Map(); l.forEach(x => c.set(x, (c.get(x) || 0) + 1)); return [...c].sort((a, b) => b[1] - a[1])[0][0]; }, [1, 2, 2, 3], 2);
stats('num.min', 'Smallest', 'The smallest number in a list', l => Math.min(...l), [4, -2, 9], -2);
stats('num.max', 'Largest', 'The largest number in a list', l => Math.max(...l), [4, -2, 9], 9);
stats('num.spread', 'Range (max − min)', 'The difference between the largest and smallest', l => Math.max(...l) - Math.min(...l), [4, -2, 9], 11);
stats('num.stddev', 'Standard deviation', 'How spread out the numbers are', l => { const m = l.reduce((a, b) => a + b, 0) / l.length; return round(Math.sqrt(l.reduce((a, b) => a + (b - m) ** 2, 0) / l.length), 4); }, [2, 4, 4, 4, 5, 5, 7, 9], 2);
stats('num.stats', 'Statistics', 'Count, sum, average, smallest, largest and median of a list', l => { const s = [...l].sort((a, b) => a - b), m = s.length >> 1, sum = round(l.reduce((a, b) => a + b, 0), 10); return { count: l.length, sum, average: round(sum / l.length, 4), min: s[0], max: s[s.length - 1], median: s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2 }; }, [3, 1, 2], { count: 3, sum: 6, average: 2, min: 1, max: 3, median: 2 });
T('Numbers', 'num.log', 'Logarithm', 'The logarithm in a base (10, 2 or e)', (v, p) => { const x = N(v); if (x <= 0) bad('Only positive numbers have a logarithm.'); return round(p.base === 'e' ? Math.log(x) : Math.log(x) / Math.log(Nopt(p.base, 10)), 10); }, { f: [sel('base', 'Base', [['10', '10'], ['2', '2'], ['e', 'e (natural)']])], t: [[1000, 3, { base: '10' }], [8, 3, { base: '2' }]] });
const gcd = (a, b) => { a = Math.abs(a); b = Math.abs(b); while (b) [a, b] = [b, a % b]; return a; };
T('Numbers', 'num.gcd', 'Greatest common divisor', 'The biggest number that divides both', (v, p) => gcd(N(v), N(p.other)), { f: [txt('other', 'And', '18')], t: [[12, 6, { other: 18 }]] });
T('Numbers', 'num.lcm', 'Least common multiple', 'The smallest number both divide into', (v, p) => { const a = N(v), b = N(p.other); return a && b ? Math.abs(a * b) / gcd(a, b) : 0; }, { f: [txt('other', 'And', '6')], t: [[4, 12, { other: 6 }]] });
T('Numbers', 'num.factorial', 'Factorial', 'n! = 1 × 2 × … × n', v => { const n = N(v); if (n < 0 || n > 170 || !Number.isInteger(n)) bad('Factorial needs a whole number from 0 to 170.'); let f = 1; for (let i = 2; i <= n; i++) f *= i; return f; }, { t: [[5, 120]] });
T('Numbers', 'num.format', 'Format number', 'Writes the number with separators: 1,234,567.8 (or 12,34,567.8 for India)', (v, p) => new Intl.NumberFormat(p.locale || 'en-US', { maximumFractionDigits: Nopt(p.decimals, 2), minimumFractionDigits: B(p.fixed) ? Nopt(p.decimals, 2) : 0 }).format(N(v)), { f: [sel('locale', 'Style', [['en-US', '1,234,567.8'], ['en-IN', '12,34,567.8 (India)'], ['de-DE', '1.234.567,8'], ['fr-FR', '1 234 567,8']]), num('decimals', 'Decimal places', 2), bool('fixed', 'Always show the decimals')], t: [[1234567.8, '12,34,567.8', { locale: 'en-IN', decimals: 2 }]], out: 'formatted' });
T('Numbers', 'num.currency', 'Format money', 'Writes an amount as money: ₹1,250.00, $1,250.00, €1.250,00…', (v, p) => new Intl.NumberFormat(p.locale || 'en-IN', { style: 'currency', currency: (p.currency || 'INR').toUpperCase() }).format(N(v)), { f: [txt('currency', 'Currency', 'INR', 'INR, USD, EUR, GBP…'), sel('locale', 'Style', [['en-IN', 'India'], ['en-US', 'US'], ['en-GB', 'UK'], ['de-DE', 'Germany'], ['ja-JP', 'Japan']])], t: [[1250, '₹1,250.00', { currency: 'INR', locale: 'en-IN' }]], out: 'formatted' });
T('Numbers', 'num.compact', 'Short number', 'Writes big numbers short: 1.2K, 3.4M (or 1.2 lakh, 3.4 crore)', (v, p) => new Intl.NumberFormat(p.locale || 'en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(N(v)), { f: [sel('locale', 'Style', [['en-US', '1.2K, 3.4M'], ['en-IN', '1.2L, 3.4Cr (India)']])], t: [[1234000, '1.2M', { locale: 'en-US' }]], out: 'short' });
T('Numbers', 'num.ordinal', 'Ordinal', 'Writes 1 as 1st, 2 as 2nd, 23 as 23rd', v => { const n = Math.trunc(N(v)), s = ['th', 'st', 'nd', 'rd'], m = Math.abs(n) % 100; return n + (s[(m - 20) % 10] || s[m] || s[0]); }, { t: [[23, '23rd'], [11, '11th']], out: 'ordinal' });
T('Numbers', 'num.parse', 'Read a number', 'Reads a number from text like “₹1,250.50” or “ 42 ”', v => N(v), { vl: 'Text', t: [['₹1,250.50', 1250.5]], out: 'number' });
T('Numbers', 'num.toFixed', 'Fixed decimals', 'Writes the number with exactly N decimals, as text (2.5 → "2.50")', (v, p) => N(v).toFixed(Nopt(p.decimals, 2)), { f: [num('decimals', 'Decimal places', 2)], t: [[2.5, '2.50', { decimals: 2 }]] });
T('Numbers', 'num.between', 'Scale', 'Maps a number from one range to another (e.g. 0–10 to 0–100)', (v, p) => { const a = Nopt(p.fromMin, 0), b = Nopt(p.fromMax, 10), c = Nopt(p.toMin, 0), d = Nopt(p.toMax, 100); return b === a ? c : round(c + (N(v) - a) * (d - c) / (b - a), 6); }, { f: [num('fromMin', 'From lowest', 0), num('fromMax', 'From highest', 10), num('toMin', 'To lowest', 0), num('toMax', 'To highest', 100)], t: [[7, 70, { fromMin: 0, fromMax: 10, toMin: 0, toMax: 100 }]] });
T('Numbers', 'num.split', 'Split a bill', 'Splits an amount between people, with a tip if you like', (v, p) => { const total = N(v) * (1 + Nopt(p.tip, 0) / 100), n = Math.max(1, Nopt(p.people, 2)); return { total: round(total, 2), each: round(total / n, 2) }; }, { vl: 'Amount', f: [num('people', 'People', 2), num('tip', 'Tip %', 0)], t: [[1200, { total: 1320, each: 330 }, { people: 4, tip: 10 }]], out: 'split' });

/* ================= Dates ================= */
const UNITS = [['minutes', 'minutes'], ['hours', 'hours'], ['days', 'days'], ['weeks', 'weeks'], ['months', 'months'], ['years', 'years'], ['seconds', 'seconds']];
const MS = { seconds: 1e3, minutes: 6e4, hours: 36e5, days: 864e5, weeks: 6048e5 };
const addTo = (d, n, unit) => {
  const x = new Date(d.getTime());
  if (unit === 'months' || unit === 'years') {
    const day = x.getUTCDate(); x.setUTCDate(1);
    x.setUTCMonth(x.getUTCMonth() + n * (unit === 'years' ? 12 : 1));
    x.setUTCDate(Math.min(day, new Date(Date.UTC(x.getUTCFullYear(), x.getUTCMonth() + 1, 0)).getUTCDate()));
    return x;
  }
  return new Date(x.getTime() + n * (MS[unit] || MS.days));
};
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
// A date's parts in a time zone (UTC when none is given).
function partsIn(d, tz) {
  let f;
  try { f = new Intl.DateTimeFormat('en-US', { timeZone: tz || 'UTC', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric', hourCycle: 'h23', weekday: 'long' }); } catch (e) { bad(`“${tz}” isn't a time zone (try Asia/Kolkata or America/New_York).`); }
  const o = Object.fromEntries(f.formatToParts(d).map(x => [x.type, x.value]));
  return { year: +o.year, month: +o.month, day: +o.day, hour: +o.hour % 24, minute: +o.minute, second: +o.second, weekday: o.weekday };
}
const pad = (n, l = 2) => String(n).padStart(l, '0');
function fmt(d, pattern, tz) {
  const p = partsIn(d, tz), h12 = p.hour % 12 || 12;
  const map = { YYYY: p.year, YY: pad(p.year % 100), MMMM: MONTHS[p.month - 1], MMM: MONTHS[p.month - 1].slice(0, 3), MM: pad(p.month), M: p.month, dddd: p.weekday, ddd: p.weekday.slice(0, 3), DD: pad(p.day), D: p.day, HH: pad(p.hour), H: p.hour, hh: pad(h12), h: h12, mm: pad(p.minute), ss: pad(p.second), A: p.hour < 12 ? 'AM' : 'PM', a: p.hour < 12 ? 'am' : 'pm' };
  return String(pattern || 'YYYY-MM-DD').replace(/\[([^\]]*)]|YYYY|YY|MMMM|MMM|MM|M|dddd|ddd|DD|D|HH|H|hh|h|mm|ss|A|a/g, (m, lit) => (lit !== undefined ? lit : String(map[m])));
}
const TZ = txt('timezone', 'Time zone', 'UTC', 'Asia/Kolkata, Europe/London… (blank: UTC)');
const iso = d => d.toISOString();
T('Dates', 'date.now', 'Now', 'The current date and time', (v, p) => (p.as === 'unix' ? Math.floor(Date.now() / 1000) : p.as === 'ms' ? Date.now() : new Date().toISOString()), { nv: true, f: [sel('as', 'As', [['iso', 'ISO text (2025-01-31T09:30:00.000Z)'], ['unix', 'Unix seconds'], ['ms', 'Milliseconds']])], t: [[null, Object.assign(x => typeof x === 'string' && !Number.isNaN(Date.parse(x)), { example: '2025-01-31T09:30:00.000Z' })]], out: 'now' });
T('Dates', 'date.today', 'Today', 'Today’s date (YYYY-MM-DD) in a time zone', (v, p) => fmt(new Date(), 'YYYY-MM-DD', p.timezone), { nv: true, f: [TZ], t: [[null, Object.assign(x => /^\d{4}-\d\d-\d\d$/.test(x), { example: '2025-01-31' })]], out: 'today' });
T('Dates', 'date.format', 'Format date', 'Writes a date the way you like: 31 Jan 2025, 09:30 AM…', (v, p) => fmt(D(v), p.pattern, p.timezone), { f: [txt('pattern', 'Pattern', 'DD MMM YYYY, hh:mm A', 'YYYY MM DD HH mm ss · MMM MMMM ddd dddd · hh A'), TZ], t: [['2025-01-31T04:00:00Z', '31 Jan 2025, 09:30 AM', { pattern: 'DD MMM YYYY, hh:mm A', timezone: 'Asia/Kolkata' }]], out: 'formatted' });
T('Dates', 'date.add', 'Add time', 'Adds minutes, hours, days, months or years to a date', (v, p) => iso(addTo(D(v), Nopt(p.amount, 1), p.unit || 'days')), { f: [num('amount', 'Amount', 7), sel('unit', 'Unit', UNITS, 'days')], t: [['2025-01-31T00:00:00Z', '2025-02-28T00:00:00.000Z', { amount: 1, unit: 'months' }]] });
T('Dates', 'date.subtract', 'Subtract time', 'Takes minutes, hours, days, months or years off a date', (v, p) => iso(addTo(D(v), -Nopt(p.amount, 1), p.unit || 'days')), { f: [num('amount', 'Amount', 7), sel('unit', 'Unit', UNITS, 'days')], t: [['2025-03-10T12:00:00Z', '2025-03-03T12:00:00.000Z', { amount: 7, unit: 'days' }]] });
T('Dates', 'date.diff', 'Time between', 'How long from one date to another, in a unit', (v, p) => {
  const a = D(v), b = D(p.other), unit = p.unit || 'days';
  if (unit === 'months' || unit === 'years') { let m = (b.getUTCFullYear() - a.getUTCFullYear()) * 12 + b.getUTCMonth() - a.getUTCMonth(); if (b.getUTCDate() < a.getUTCDate()) m -= Math.sign(m) || 0; return unit === 'years' ? Math.trunc(m / 12) : m; }
  return round((b - a) / MS[unit], 2);
}, { vl: 'From', f: [txt('other', 'To', '{{ $now }}'), sel('unit', 'In', UNITS, 'days')], t: [['2025-01-01', 30, { other: '2025-01-31', unit: 'days' }]], out: 'difference' });
const startOf = (d, unit) => { const x = new Date(d.getTime()); if (unit === 'hour') x.setUTCMinutes(0, 0, 0); else { x.setUTCHours(0, 0, 0, 0); if (unit === 'week') x.setUTCDate(x.getUTCDate() - ((x.getUTCDay() + 6) % 7)); if (unit === 'month') x.setUTCDate(1); if (unit === 'year') x.setUTCMonth(0, 1); } return x; };
const PERIODS = [['day', 'day'], ['week', 'week (Monday)'], ['month', 'month'], ['year', 'year'], ['hour', 'hour']];
T('Dates', 'date.startOf', 'Start of', 'The start of the day, week, month or year a date is in (UTC)', (v, p) => iso(startOf(D(v), p.unit || 'day')), { f: [sel('unit', 'Of the', PERIODS)], t: [['2025-05-15T10:20:00Z', '2025-05-01T00:00:00.000Z', { unit: 'month' }]] });
T('Dates', 'date.endOf', 'End of', 'The last moment of the day, week, month or year a date is in (UTC)', (v, p) => { const u = p.unit || 'day', s = startOf(D(v), u); const next = u === 'hour' ? addTo(s, 1, 'hours') : u === 'day' ? addTo(s, 1, 'days') : u === 'week' ? addTo(s, 1, 'weeks') : addTo(s, 1, u === 'month' ? 'months' : 'years'); return iso(new Date(next.getTime() - 1)); }, { f: [sel('unit', 'Of the', PERIODS)], t: [['2025-02-10T10:00:00Z', '2025-02-28T23:59:59.999Z', { unit: 'month' }]] });
T('Dates', 'date.weekday', 'Day of the week', 'The weekday’s name (Monday…)', (v, p) => partsIn(D(v), p.timezone).weekday, { f: [TZ], t: [['2025-01-31T10:00:00Z', 'Friday', {}]], out: 'weekday' });
T('Dates', 'date.monthName', 'Month name', 'The month’s name (January…)', (v, p) => MONTHS[partsIn(D(v), p.timezone).month - 1], { f: [TZ], t: [['2025-03-05', 'March', {}]], out: 'month' });
T('Dates', 'date.parts', 'Date parts', 'Splits a date into year, month, day, hour, minute, weekday', (v, p) => partsIn(D(v), p.timezone), { f: [TZ], t: [['2025-01-31T04:00:00Z', { year: 2025, month: 1, day: 31, hour: 9, minute: 30, second: 0, weekday: 'Friday' }, { timezone: 'Asia/Kolkata' }]], out: 'parts' });
T('Dates', 'date.dayOfYear', 'Day of the year', 'Which day of the year it is (1–366)', v => { const d = D(v); return Math.floor((Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - Date.UTC(d.getUTCFullYear(), 0, 1)) / 864e5) + 1; }, { t: [['2025-02-01', 32]], out: 'dayOfYear' });
T('Dates', 'date.week', 'Week number', 'The ISO week number (1–53)', v => { const d = D(v), t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())); const day = t.getUTCDay() || 7; t.setUTCDate(t.getUTCDate() + 4 - day); return Math.ceil(((t - Date.UTC(t.getUTCFullYear(), 0, 1)) / 864e5 + 1) / 7); }, { t: [['2025-01-01', 1], ['2025-12-29', 1], ['2025-06-15', 24]], out: 'week' });
T('Dates', 'date.quarter', 'Quarter', 'Which quarter of the year (1–4); or of India’s financial year from April', (v, p) => { const m = D(v).getUTCMonth(); return p.fy === 'april' ? Math.floor(((m + 9) % 12) / 3) + 1 : Math.floor(m / 3) + 1; }, { f: [sel('fy', 'Year starts in', [['january', 'January'], ['april', 'April (India’s financial year)']])], t: [['2025-05-10', 1, { fy: 'april' }], ['2025-05-10', 2, { fy: 'january' }]], out: 'quarter' });
T('Dates', 'date.financialYear', 'Financial year', 'India’s financial year a date falls in, e.g. FY 2024-25', v => { const d = D(v), y = d.getUTCFullYear(), s = d.getUTCMonth() >= 3 ? y : y - 1; return `FY ${s}-${pad((s + 1) % 100)}`; }, { t: [['2025-02-10', 'FY 2024-25']], out: 'fy' });
T('Dates', 'date.isWeekend', 'Is it the weekend?', 'True on Saturday and Sunday', (v, p) => ['Saturday', 'Sunday'].includes(partsIn(D(v), p.timezone).weekday), { f: [TZ], t: [['2025-02-01T10:00:00Z', true, {}]], out: 'weekend' });
T('Dates', 'date.toUnix', 'To Unix time', 'The date as Unix seconds (or milliseconds)', (v, p) => (p.ms === true || p.ms === 'true' ? D(v).getTime() : Math.floor(D(v).getTime() / 1000)), { f: [bool('ms', 'In milliseconds')], t: [['2025-01-01T00:00:00Z', 1735689600, {}]], out: 'unix' });
T('Dates', 'date.fromUnix', 'From Unix time', 'Turns Unix seconds or milliseconds into a date', v => iso(D(N(v))), { vl: 'Unix time', t: [[1735689600, '2025-01-01T00:00:00.000Z']], out: 'date' });
T('Dates', 'date.toIso', 'To ISO date', 'Reads a date in almost any form and writes it as ISO text', v => iso(D(v)), { t: [['31 January 2025 10:00 UTC', '2025-01-31T10:00:00.000Z']], out: 'date' });
T('Dates', 'date.ago', 'Time ago', 'Writes how long ago (or from now) a date is: “3 hours ago”', (v, p) => { const s = (D(v) - (p.now ? D(p.now) : new Date())) / 1000, a = Math.abs(s); const rt = new Intl.RelativeTimeFormat('en', { numeric: 'auto' }); const [n, u] = a < 60 ? [s, 'second'] : a < 3600 ? [s / 60, 'minute'] : a < 86400 ? [s / 3600, 'hour'] : a < 2592000 ? [s / 86400, 'day'] : a < 31536000 ? [s / 2592000, 'month'] : [s / 31536000, 'year']; return rt.format(Math.round(n), u); }, { f: [txt('now', 'Compared with (blank: now)')], t: [['2025-01-01T09:00:00Z', '3 hours ago', { now: '2025-01-01T12:00:00Z' }]], out: 'ago' });
T('Dates', 'date.age', 'Age', 'How old someone is from their birth date, in whole years', (v, p) => { const b = D(v), n = p.on ? D(p.on) : new Date(); let a = n.getUTCFullYear() - b.getUTCFullYear(); if (n.getUTCMonth() < b.getUTCMonth() || (n.getUTCMonth() === b.getUTCMonth() && n.getUTCDate() < b.getUTCDate())) a--; return a; }, { vl: 'Birth date', f: [txt('on', 'On (blank: today)')], t: [['2000-06-15', 24, { on: '2025-06-14' }]], out: 'age' });
T('Dates', 'date.daysInMonth', 'Days in the month', 'How many days the date’s month has', v => { const d = D(v); return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate(); }, { t: [['2024-02-10', 29]], out: 'days' });
T('Dates', 'date.isLeapYear', 'Leap year?', 'True when the date’s year has 29 February', v => { const y = /^\d{4}$/.test(S(v).trim()) ? Number(v) : D(v).getUTCFullYear(); return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0; }, { t: [[2024, true], [1900, false]], out: 'leap' });
T('Dates', 'date.convertZone', 'In a time zone', 'Writes a date as the clock shows it in another time zone', (v, p) => fmt(D(v), p.pattern || 'YYYY-MM-DD HH:mm', p.timezone || 'Asia/Kolkata'), { f: [txt('timezone', 'Time zone', 'Asia/Kolkata'), txt('pattern', 'Pattern', 'YYYY-MM-DD HH:mm')], t: [['2025-01-31T12:00:00Z', '2025-01-31 07:00', { timezone: 'America/New_York', pattern: 'YYYY-MM-DD HH:mm' }]], out: 'local' });
T('Dates', 'date.addWorkdays', 'Add working days', 'Adds days, skipping Saturdays and Sundays', (v, p) => { let d = D(v), n = Nopt(p.days, 5); const step = n < 0 ? -1 : 1; while (n) { d = addTo(d, step, 'days'); if (d.getUTCDay() % 6) n -= step; } return iso(d); }, { f: [num('days', 'Working days', 5)], t: [['2025-01-31T09:00:00Z', '2025-02-04T09:00:00.000Z', { days: 2 }]] });
T('Dates', 'date.workdaysBetween', 'Working days between', 'Counts Monday–Friday days from one date up to another', (v, p) => { let a = startOf(D(v), 'day'); const b = startOf(D(p.other), 'day'); let n = 0; while (a < b) { if (a.getUTCDay() % 6) n++; a = addTo(a, 1, 'days'); } return n; }, { vl: 'From', f: [txt('other', 'To')], t: [['2025-01-27', 5, { other: '2025-02-03' }]], out: 'workdays' });
T('Dates', 'date.isBefore', 'Is before?', 'True when the date is before another', (v, p) => D(v) < D(p.other), { f: [txt('other', 'Than', '{{ $now }}')], t: [['2025-01-01', true, { other: '2025-06-01' }]], out: 'before' });
T('Dates', 'date.isAfter', 'Is after?', 'True when the date is after another', (v, p) => D(v) > D(p.other), { f: [txt('other', 'Than', '{{ $now }}')], t: [['2025-01-01', false, { other: '2025-06-01' }]], out: 'after' });
T('Dates', 'date.isBetween', 'Is between?', 'True when the date is between two others', (v, p) => { const d = D(v); return d >= D(p.start) && d <= D(p.end); }, { f: [txt('start', 'From'), txt('end', 'To')], t: [['2025-03-15', true, { start: '2025-03-01', end: '2025-03-31' }]], out: 'between' });
T('Dates', 'date.next', 'Next weekday', 'The date of the next Monday (or any weekday) after a date', (v, p) => { const want = DAYS.indexOf(p.day || 'Monday'); let d = addTo(startOf(D(v), 'day'), 1, 'days'); while (d.getUTCDay() !== want) d = addTo(d, 1, 'days'); return fmt(d, 'YYYY-MM-DD'); }, { vl: 'After', f: [sel('day', 'Weekday', DAYS, 'Monday')], t: [['2025-01-31', '2025-02-03', { day: 'Monday' }]], out: 'next' });
T('Dates', 'date.daysUntil', 'Days until', 'Whole days from today (or a date) to the date: a countdown', (v, p) => Math.ceil((startOf(D(v), 'day') - startOf(p.from ? D(p.from) : new Date(), 'day')) / 864e5), { f: [txt('from', 'From (blank: today)')], t: [['2025-12-25', 10, { from: '2025-12-15' }]], out: 'days' });
T('Dates', 'date.duration', 'Readable duration', 'Writes seconds as “1h 2m 5s” (or “1 hour 2 minutes”)', (v, p) => {
  let s = Math.round(Math.abs(N(v)));
  const parts = [['d', 'day', 86400], ['h', 'hour', 3600], ['m', 'minute', 60], ['s', 'second', 1]].map(([a, w, n]) => { const k = Math.floor(s / n); s -= k * n; return k ? (p.style === 'long' ? `${k} ${w}${k > 1 ? 's' : ''}` : `${k}${a}`) : ''; }).filter(Boolean);
  return parts.join(' ') || (p.style === 'long' ? '0 seconds' : '0s');
}, { vl: 'Seconds', f: [sel('style', 'Style', [['short', '1h 2m 5s'], ['long', '1 hour 2 minutes 5 seconds']])], t: [[3725, '1h 2m 5s', { style: 'short' }]], out: 'duration' });
T('Dates', 'date.parseDuration', 'Read a duration', 'Reads “1h 30m”, “2 days”, “45s” as seconds', v => { const s = S(v).toLowerCase(); let t = 0, hit = false; for (const [, n, u] of s.matchAll(/(\d+(?:\.\d+)?)\s*(w|d|h|m(?!s)|s|ms)?[a-z]*/g)) { hit = true; t += Number(n) * ({ w: 604800, d: 86400, h: 3600, m: 60, s: 1, ms: 0.001 }[u || 's']); } if (!hit) bad(`“${s}” isn't a duration.`); return t; }, { vl: 'Duration', t: [['1h 30m', 5400], ['2 days', 172800]], out: 'seconds' });
T('Dates', 'date.calendar', 'Days of a month', 'Lists every date of the date’s month (one item per day after Split out)', v => { const d = D(v), n = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate(); return Array.from({ length: n }, (_, i) => fmt(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), i + 1)), 'YYYY-MM-DD')); }, { t: [['2025-02-10', Object.assign(x => x.length === 28 && x[0] === '2025-02-01', { example: ['2025-02-01', '…', '2025-02-28'] })]], out: 'days' });

/* ================= Lists ================= */
const field = (x, f) => (f ? String(f).split('.').reduce((o, k) => (o == null ? undefined : o[k]), x) : x);
const cmp = (a, b) => (typeof a === 'number' && typeof b === 'number' ? a - b : S(a).localeCompare(S(b), undefined, { numeric: true }));
const FIELD = txt('field', 'Field (blank: the value itself)', '', 'price  or  user.name');
const LT = (key, label, note, fn, o = {}) => T('Lists', key, label, note, (v, p) => fn(L(v), p), o);
LT('list.count', 'Count', 'How many entries the list has', l => l.length, { t: [[['a', 'b', 'c'], 3]], out: 'count' });
LT('list.first', 'First', 'The first entry', l => l[0] ?? null, { t: [[[5, 6, 7], 5]], out: 'first' });
LT('list.last', 'Last', 'The last entry', l => l[l.length - 1] ?? null, { t: [[[5, 6, 7], 7]], out: 'last' });
LT('list.nth', 'Entry at', 'The entry at a position (1 is the first, -1 the last)', (l, p) => { const i = Nopt(p.position, 1); return (i < 0 ? l[l.length + i] : l[i - 1]) ?? null; }, { f: [num('position', 'Position', 2)], t: [[['a', 'b', 'c'], 'b', { position: 2 }], [['a', 'b', 'c'], 'c', { position: -1 }]], out: 'entry' });
LT('list.slice', 'Part of a list', 'Takes entries from one position to another', (l, p) => l.slice(Math.max(0, Nopt(p.from, 1) - 1), p.to === '' || p.to == null ? undefined : Nopt(p.to, l.length)), { f: [num('from', 'From position', 1), num('to', 'To position (blank: the end)', 3)], t: [[[1, 2, 3, 4, 5], [2, 3, 4], { from: 2, to: 4 }]], out: 'list' });
LT('list.reverse', 'Reverse', 'Turns the list around', l => [...l].reverse(), { t: [[[1, 2, 3], [3, 2, 1]]], out: 'list' });
LT('list.sort', 'Sort', 'Sorts the list, by a field if its entries are objects', (l, p) => { const s = [...l].sort((a, b) => cmp(field(a, p.field), field(b, p.field))); return p.order === 'desc' ? s.reverse() : s; }, { f: [FIELD, sel('order', 'Order', [['asc', 'A → Z, 0 → 9'], ['desc', 'Z → A, 9 → 0']])], t: [[[{ n: 'b', p: 3 }, { n: 'a', p: 9 }], [{ n: 'a', p: 9 }, { n: 'b', p: 3 }], { field: 'p', order: 'desc' }], [['10', '9', '1'], ['1', '9', '10'], {}]], out: 'list' });
LT('list.unique', 'Unique', 'Removes repeated entries (by a field, if given)', (l, p) => { const seen = new Set(); return l.filter(x => { const k = JSON.stringify(field(x, p.field)); return seen.has(k) ? false : seen.add(k); }); }, { f: [FIELD], t: [[[1, 2, 2, 3, 1], [1, 2, 3], {}]], out: 'list' });
LT('list.flatten', 'Flatten', 'Turns lists inside the list into one flat list', (l, p) => l.flat(B(p.deep) ? Infinity : 1), { f: [bool('deep', 'All the way down', true)], t: [[[1, [2, [3]]], [1, 2, 3], { deep: true }]], out: 'list' });
LT('list.chunk', 'Chunk', 'Splits the list into groups of N', (l, p) => { const n = Math.max(1, Nopt(p.size, 2)), out = []; for (let i = 0; i < l.length; i += n) out.push(l.slice(i, i + n)); return out; }, { f: [num('size', 'Group size', 2)], t: [[[1, 2, 3, 4, 5], [[1, 2], [3, 4], [5]], { size: 2 }]], out: 'chunks' });
LT('list.compact', 'Remove empty', 'Drops empty entries: blank text, null, and (if you like) 0 and false', (l, p) => l.filter(x => !(x === null || x === undefined || x === '' || (Array.isArray(x) && !x.length) || (B(p.falsy) && !x))), { f: [bool('falsy', 'Also drop 0 and false')], t: [[[0, '', 'a', null, false], [0, 'a', false], {}]], out: 'list' });
LT('list.join', 'Join', 'Joins the entries into one text', (l, p) => l.map(x => S(field(x, p.field))).join(p.separator === '\\n' ? '\n' : (p.separator ?? ', ')), { f: [txt('separator', 'Separator (\\n for new lines)', ', '), FIELD], t: [[['a', 'b', 'c'], 'a, b, c', { separator: ', ' }]], out: 'text' });
LT('list.includes', 'Contains?', 'True when the list has an entry', (l, p) => l.some(x => S(x) === S(p.find)), { f: [txt('find', 'Entry')], t: [[['red', 'green'], true, { find: 'green' }]], out: 'includes' });
LT('list.indexOf', 'Position of', 'Where an entry is in the list (1 is the first; 0 if it isn’t there)', (l, p) => l.findIndex(x => S(x) === S(p.find)) + 1, { f: [txt('find', 'Entry')], t: [[['a', 'b', 'c'], 3, { find: 'c' }]], out: 'position' });
LT('list.shuffle', 'Shuffle', 'Puts the entries in a random order', l => { const a = [...l]; for (let i = a.length - 1; i > 0; i--) { const j = randomInt(i + 1); [a[i], a[j]] = [a[j], a[i]]; } return a; }, { t: [[[1, 2, 3], Object.assign(x => x.length === 3 && [...x].sort().join() === '1,2,3', { example: [3, 1, 2] })]], out: 'list' });
LT('list.sample', 'Random pick', 'Picks N random entries', (l, p) => { const a = [...l], n = Math.min(a.length, Nopt(p.count, 1)); for (let i = a.length - 1; i > 0; i--) { const j = randomInt(i + 1); [a[i], a[j]] = [a[j], a[i]]; } return n === 1 && !B(p.asList) ? a[0] ?? null : a.slice(0, n); }, { f: [num('count', 'How many', 1), bool('asList', 'Always give a list')], t: [[['x', 'y'], Object.assign(x => ['x', 'y'].includes(x), { example: 'y' }), { count: 1 }]], out: 'pick' });
LT('list.pluck', 'Pick a field', 'Takes one field from every object in the list', (l, p) => l.map(x => field(x, p.field)), { f: [txt('field', 'Field', 'name')], t: [[[{ name: 'Ada' }, { name: 'Tim' }], ['Ada', 'Tim'], { field: 'name' }]], out: 'list' });
LT('list.sumBy', 'Sum a field', 'Adds up one field of every object in the list', (l, p) => round(l.reduce((a, x) => a + (Number(field(x, p.field)) || 0), 0), 10), { f: [txt('field', 'Field', 'price')], t: [[[{ price: 10 }, { price: 5.5 }], 15.5, { field: 'price' }]], out: 'total' });
LT('list.averageBy', 'Average a field', 'The average of one field of every object in the list', (l, p) => (l.length ? round(l.reduce((a, x) => a + (Number(field(x, p.field)) || 0), 0) / l.length, 4) : 0), { f: [txt('field', 'Field', 'score')], t: [[[{ s: 4 }, { s: 5 }], 4.5, { field: 's' }]], out: 'average' });
LT('list.groupBy', 'Group by', 'Groups objects by a field: {value: [entries…]}', (l, p) => l.reduce((g, x) => { const k = S(field(x, p.field)); (g[k] ||= []).push(x); return g; }, {}), { f: [txt('field', 'Field', 'team')], t: [[[{ t: 'a', n: 1 }, { t: 'b', n: 2 }, { t: 'a', n: 3 }], { a: [{ t: 'a', n: 1 }, { t: 'a', n: 3 }], b: [{ t: 'b', n: 2 }] }, { field: 't' }]], out: 'groups' });
LT('list.countBy', 'Count by', 'Counts entries per value of a field: {value: count}', (l, p) => l.reduce((g, x) => { const k = S(field(x, p.field)); g[k] = (g[k] || 0) + 1; return g; }, {}), { f: [FIELD], t: [[['a', 'b', 'a'], { a: 2, b: 1 }, {}]], out: 'counts' });
LT('list.keyBy', 'Index by', 'Turns a list of objects into an object keyed by a field', (l, p) => Object.fromEntries(l.map(x => [S(field(x, p.field)), x])), { f: [txt('field', 'Field', 'id')], t: [[[{ id: 'a', n: 1 }], { a: { id: 'a', n: 1 } }, { field: 'id' }]], out: 'byKey' });
LT('list.find', 'Find first', 'The first object whose field equals a value', (l, p) => l.find(x => S(field(x, p.field)) === S(p.equals)) ?? null, { f: [txt('field', 'Field', 'id'), txt('equals', 'Equals')], t: [[[{ id: 1, n: 'a' }, { id: 2, n: 'b' }], { id: 2, n: 'b' }, { field: 'id', equals: '2' }]], out: 'found' });
LT('list.where', 'Keep where', 'Keeps the objects whose field equals (or contains) a value', (l, p) => l.filter(x => (p.match === 'contains' ? S(field(x, p.field)).toLowerCase().includes(S(p.equals).toLowerCase()) : S(field(x, p.field)) === S(p.equals))), { f: [txt('field', 'Field', 'status'), sel('match', 'When it', [['equals', 'equals'], ['contains', 'contains']]), txt('equals', 'Value')], t: [[[{ s: 'open' }, { s: 'closed' }], [{ s: 'open' }], { field: 's', match: 'equals', equals: 'open' }]], out: 'list' });
LT('list.minBy', 'Smallest by', 'The object with the smallest value in a field', (l, p) => l.reduce((m, x) => (m === null || cmp(field(x, p.field), field(m, p.field)) < 0 ? x : m), null), { f: [txt('field', 'Field', 'price')], t: [[[{ p: 5 }, { p: 2 }], { p: 2 }, { field: 'p' }]], out: 'smallest' });
LT('list.maxBy', 'Largest by', 'The object with the largest value in a field', (l, p) => l.reduce((m, x) => (m === null || cmp(field(x, p.field), field(m, p.field)) > 0 ? x : m), null), { f: [txt('field', 'Field', 'score')], t: [[[{ p: 5 }, { p: 2 }], { p: 5 }, { field: 'p' }]], out: 'largest' });
const other = txt('other', 'Other list', '', '{{ $json.other }}  or  a, b, c');
LT('list.difference', 'Only in the first', 'Entries in this list that aren’t in another', (l, p) => { const o = new Set(L(p.other).map(S)); return l.filter(x => !o.has(S(x))); }, { f: [other], t: [[[1, 2, 3], [1, 3], { other: [2] }]], out: 'list' });
LT('list.intersection', 'In both', 'Entries in both lists', (l, p) => { const o = new Set(L(p.other).map(S)); return [...new Set(l.filter(x => o.has(S(x))))]; }, { f: [other], t: [[['a', 'b', 'c'], ['b', 'c'], { other: ['c', 'b', 'z'] }]], out: 'list' });
LT('list.union', 'Combine lists', 'Both lists together, without repeats', (l, p) => { const seen = new Set(); return [...l, ...L(p.other)].filter(x => (seen.has(S(x)) ? false : seen.add(S(x)))); }, { f: [other], t: [[[1, 2], [1, 2, 3], { other: [2, 3] }]], out: 'list' });
LT('list.zip', 'Pair up', 'Pairs entries of two lists: [[a1, b1], [a2, b2]…] or objects with two names', (l, p) => { const o = L(p.other); return Array.from({ length: Math.max(l.length, o.length) }, (_, i) => (p.keys ? Object.fromEntries([[S(p.keys).split(',')[0].trim(), l[i] ?? null], [(S(p.keys).split(',')[1] || 'b').trim(), o[i] ?? null]]) : [l[i] ?? null, o[i] ?? null])); }, { f: [other, txt('keys', 'As objects with names (optional)', '', 'name, score')], t: [[['a', 'b'], [{ k: 'a', v: 1 }, { k: 'b', v: 2 }], { other: [1, 2], keys: 'k, v' }]], out: 'pairs' });
LT('list.toObject', 'List to object', 'Turns [{key, value}…] (or [[key, value]…]) into one object', (l, p) => Object.fromEntries(l.map(x => (Array.isArray(x) ? x : [field(x, p.key || 'key'), field(x, p.valueField || 'value')]))), { f: [txt('key', 'Key field', 'key'), txt('valueField', 'Value field', 'value')], t: [[[{ key: 'a', value: 1 }], { a: 1 }, { key: 'key', valueField: 'value' }]], out: 'object' });
LT('list.rotate', 'Rotate', 'Moves the first N entries to the end', (l, p) => { const n = ((Nopt(p.by, 1) % (l.length || 1)) + (l.length || 1)) % (l.length || 1); return [...l.slice(n), ...l.slice(0, n)]; }, { f: [num('by', 'By', 1)], t: [[[1, 2, 3, 4], [2, 3, 4, 1], { by: 1 }]], out: 'list' });
LT('list.top', 'Top N', 'The N objects with the highest (or lowest) value in a field', (l, p) => { const s = [...l].sort((a, b) => cmp(field(b, p.field), field(a, p.field))); return (p.order === 'lowest' ? s.reverse() : s).slice(0, Nopt(p.count, 3)); }, { f: [txt('field', 'Field', 'score'), num('count', 'How many', 3), sel('order', 'The', [['highest', 'highest'], ['lowest', 'lowest']])], t: [[[{ s: 1 }, { s: 9 }, { s: 5 }], [{ s: 9 }, { s: 5 }], { field: 's', count: 2, order: 'highest' }]], out: 'top' });
LT('list.wrapItems', 'List of objects', 'Turns a plain list into objects with one named field each', (l, p) => l.map(x => ({ [p.name || 'value']: x })), { f: [txt('name', 'Field name', 'value')], t: [[['a', 'b'], [{ tag: 'a' }, { tag: 'b' }], { name: 'tag' }]], out: 'list' });
LT('list.running', 'Running total', 'Adds a running total of a field to each object', (l, p) => { let t = 0; return l.map(x => { t = round(t + (Number(field(x, p.field)) || (p.field ? 0 : Number(x)) || 0), 10); return typeof x === 'object' && x ? { ...x, [p.name || 'runningTotal']: t } : t; }); }, { f: [FIELD, txt('name', 'Name for the total', 'runningTotal')], t: [[[1, 2, 3], [1, 3, 6], {}]], out: 'list' });

/* ================= Objects ================= */
const OT = (key, label, note, fn, o = {}) => T('Objects', key, label, note, (v, p, item) => fn(O(v), p, item), o);
const KEYS = txt('fields', 'Fields', '', 'name, email, address.city');
const keysOf = p => S(p.fields).split(',').map(s => s.trim()).filter(Boolean);
const flat = (o, pre = '', out = {}) => { for (const [k, v] of Object.entries(o)) { const key = pre ? `${pre}.${k}` : k; if (v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length) flat(v, key, out); else out[key] = v; } return out; };
OT('obj.keys', 'Field names', 'Lists the object’s field names', o => Object.keys(o), { t: [[{ a: 1, b: 2 }, ['a', 'b']]], out: 'keys' });
OT('obj.values', 'Field values', 'Lists the object’s values', o => Object.values(o), { t: [[{ a: 1, b: 2 }, [1, 2]]], out: 'values' });
OT('obj.entries', 'Fields as a list', 'Turns the object into a list of {key, value}', o => Object.entries(o).map(([key, value]) => ({ key, value })), { t: [[{ a: 1 }, [{ key: 'a', value: 1 }]]], out: 'entries' });
OT('obj.pick', 'Keep fields', 'Keeps only some fields (dot paths work)', (o, p) => { const out = {}; for (const k of keysOf(p)) { const x = field(o, k); if (x !== undefined) setPath(out, k, x); } return out; }, { f: [KEYS], t: [[{ a: 1, b: 2, c: { d: 3, e: 4 } }, { a: 1, c: { d: 3 } }, { fields: 'a, c.d' }]], out: 'picked' });
OT('obj.omit', 'Drop fields', 'Removes some fields', (o, p) => { const out = structuredClone(o); for (const k of keysOf(p)) { const path = k.split('.'), last = path.pop(), at = field(out, path.join('.')); if (at && typeof at === 'object') delete at[last]; } return out; }, { f: [KEYS], t: [[{ a: 1, password: 'x' }, { a: 1 }, { fields: 'password' }]], out: 'cleaned' });
OT('obj.get', 'Get a field', 'Reads a field by its path (user.address.city, items.0.name)', (o, p) => field(o, p.path) ?? (p.fallback === '' ? null : p.fallback ?? null), { f: [txt('path', 'Path', 'user.name'), txt('fallback', 'If it’s missing', '')], t: [[{ user: { tags: ['x', 'y'] } }, 'y', { path: 'user.tags.1' }]], out: 'value' });
OT('obj.set', 'Set a field', 'Sets a field by its path, making the objects in between', (o, p) => setPath(structuredClone(o), p.path, p.to), { f: [txt('path', 'Path', 'address.city'), txt('to', 'To')], t: [[{ a: 1 }, { a: 1, b: { c: 'x' } }, { path: 'b.c', to: 'x' }]], out: 'updated' });
OT('obj.merge', 'Merge objects', 'Merges another object in, nested fields too; its fields win', (o, p) => { const deep = (a, b) => { const r = { ...a }; for (const [k, v] of Object.entries(b)) r[k] = v && typeof v === 'object' && !Array.isArray(v) && a[k] && typeof a[k] === 'object' && !Array.isArray(a[k]) ? deep(a[k], v) : v; return r; }; return deep(o, O(p.other)); }, { f: [txt('other', 'Merge in', '{"status": "done"}')], t: [[{ a: 1, n: { x: 1 } }, { a: 1, n: { x: 1, y: 2 }, b: 2 }, { other: { n: { y: 2 }, b: 2 } }]], out: 'merged' });
OT('obj.defaults', 'Fill missing fields', 'Adds default values only for fields that are missing or empty', (o, p) => { const r = { ...o }; for (const [k, v] of Object.entries(O(p.defaults))) if (r[k] === undefined || r[k] === null || r[k] === '') r[k] = v; return r; }, { f: [txt('defaults', 'Defaults', '{"country": "India"}')], t: [[{ name: 'Ada', country: '' }, { name: 'Ada', country: 'India' }, { defaults: { country: 'India' } }]], out: 'filled' });
OT('obj.flatten', 'Flatten object', 'Turns nested objects into dot keys: {"a.b": 1}', o => flat(o), { t: [[{ a: { b: 1, c: { d: 2 } } }, { 'a.b': 1, 'a.c.d': 2 }]], out: 'flat' });
OT('obj.unflatten', 'Unflatten object', 'Turns dot keys back into nested objects', o => { const r = {}; for (const [k, v] of Object.entries(o)) setPath(r, k, v); return r; }, { t: [[{ 'a.b': 1, c: 2 }, { a: { b: 1 }, c: 2 }]], out: 'nested' });
OT('obj.has', 'Has a field?', 'True when the field exists and isn’t empty', (o, p) => { const x = field(o, p.path); return !(x === undefined || x === null || x === ''); }, { f: [txt('path', 'Path', 'email')], t: [[{ email: 'a@b.c' }, true, { path: 'email' }]], out: 'has' });
OT('obj.size', 'Field count', 'How many fields the object has', o => Object.keys(o).length, { t: [[{ a: 1, b: 2 }, 2]], out: 'size' });
OT('obj.invert', 'Swap keys and values', 'Turns {a: "x"} into {x: "a"}', o => Object.fromEntries(Object.entries(o).map(([k, v]) => [S(v), k])), { t: [[{ a: 'x', b: 'y' }, { x: 'a', y: 'b' }]], out: 'inverted' });
OT('obj.clean', 'Remove empty fields', 'Drops fields that are null, blank or empty lists', o => Object.fromEntries(Object.entries(o).filter(([, v]) => !(v === null || v === undefined || v === '' || (Array.isArray(v) && !v.length)))), { t: [[{ a: 1, b: '', c: null, d: [] }, { a: 1 }]], out: 'cleaned' });
OT('obj.sortKeys', 'Sort fields', 'Puts the fields in A → Z order', o => Object.fromEntries(Object.entries(o).sort(([a], [b]) => a.localeCompare(b))), { t: [[{ b: 1, a: 2 }, { a: 2, b: 1 }]], out: 'sorted' });
const renameKeys = f => o => { const go = x => (Array.isArray(x) ? x.map(go) : x && typeof x === 'object' ? Object.fromEntries(Object.entries(x).map(([k, v]) => [f(k), go(v)])) : x); return go(o); };
OT('obj.camelKeys', 'Keys to camelCase', 'Renames every field to camelCase (first_name → firstName)', renameKeys(k => wordsOf(k).map((w, i) => (i ? cap(w) : w.toLowerCase())).join('')), { t: [[{ first_name: 'Ada', Home_Address: { zip_code: 1 } }, { firstName: 'Ada', homeAddress: { zipCode: 1 } }]], out: 'renamed' });
OT('obj.snakeKeys', 'Keys to snake_case', 'Renames every field to snake_case (firstName → first_name)', renameKeys(k => wordsOf(k).map(w => w.toLowerCase()).join('_')), { t: [[{ firstName: 'Ada' }, { first_name: 'Ada' }]], out: 'renamed' });
OT('obj.lowerKeys', 'Keys to lowercase', 'Renames every field to small letters', renameKeys(k => k.toLowerCase()), { t: [[{ Name: 'Ada', EMAIL: 'x' }, { name: 'Ada', email: 'x' }]], out: 'renamed' });
OT('obj.diff', 'What changed', 'Compares with another object: the fields added, removed and changed', (o, p) => { const b = O(p.other), a = flat(o), c = flat(b), out = { added: {}, removed: {}, changed: {} }; for (const k of Object.keys(c)) if (!(k in a)) out.added[k] = c[k]; else if (JSON.stringify(a[k]) !== JSON.stringify(c[k])) out.changed[k] = { from: a[k], to: c[k] }; for (const k of Object.keys(a)) if (!(k in c)) out.removed[k] = a[k]; return out; }, { vl: 'Before', f: [txt('other', 'After', '{{ $json.after }}')], t: [[{ a: 1, b: 2 }, { added: { c: 3 }, removed: { b: 2 }, changed: { a: { from: 1, to: 9 } } }, { other: { a: 9, c: 3 } }]], out: 'changes' });
OT('obj.equal', 'Are they equal?', 'True when two objects have the same fields and values', (o, p) => { const norm = x => JSON.stringify(x && typeof x === 'object' ? (Array.isArray(x) ? x.map(y => JSON.parse(norm(y))) : Object.fromEntries(Object.entries(x).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, JSON.parse(norm(v) ?? 'null')]))) : x); return norm(o) === norm(O(p.other)); }, { f: [txt('other', 'Compare with')], t: [[{ a: 1, b: 2 }, true, { other: { b: 2, a: 1 } }]], out: 'equal' });
OT('obj.mapKeys', 'Rename fields', 'Renames fields with a map: {"old": "new"}', (o, p) => { const m = O(p.map); return Object.fromEntries(Object.entries(o).map(([k, v]) => [m[k] || k, v])); }, { f: [txt('map', 'Old → new names', '{"fname": "firstName"}')], t: [[{ fname: 'Ada', x: 1 }, { firstName: 'Ada', x: 1 }, { map: { fname: 'firstName' } }]], out: 'renamed' });
OT('obj.fromItem', 'Wrap the item', 'Puts the whole item (or the object) under one field', (o, p) => ({ [p.name || 'data']: o }), { f: [txt('name', 'Field name', 'data')], t: [[{ a: 1 }, { data: { a: 1 } }, { name: 'data' }]], out: 'wrapped' });

/* ================= Encode & hash ================= */
const E = (key, label, note, fn, o = {}) => T('Encode & hash', key, label, note, fn, o);
const HTML_ENT = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
E('enc.base64', 'Base64 encode', 'Encodes text as Base64', v => Buffer.from(S(v)).toString('base64'), { t: [['Hello', 'SGVsbG8=']] });
E('enc.unbase64', 'Base64 decode', 'Decodes Base64 back into text', v => Buffer.from(S(v), 'base64').toString('utf8'), { t: [['SGVsbG8=', 'Hello']] });
E('enc.base64url', 'Base64URL encode', 'Encodes text as URL-safe Base64 (no + / =)', v => Buffer.from(S(v)).toString('base64url'), { t: [['a?b>c', 'YT9iPmM']] });
E('enc.url', 'URL encode', 'Makes text safe to put in a link', v => encodeURIComponent(S(v)), { t: [['a b&c', 'a%20b%26c']] });
E('enc.unurl', 'URL decode', 'Turns %20 and friends back into text', v => { try { return decodeURIComponent(S(v).replace(/\+/g, ' ')); } catch (e) { bad('That isn’t valid URL-encoded text.'); } }, { t: [['a%20b%26c', 'a b&c']] });
E('enc.html', 'HTML escape', 'Escapes < > & " so text shows safely in HTML', v => S(v).replace(/[&<>"']/g, c => HTML_ENT[c]), { t: [['<b>"Hi" & bye</b>', '&lt;b&gt;&quot;Hi&quot; &amp; bye&lt;/b&gt;']] });
E('enc.unhtml', 'HTML unescape', 'Turns &amp; &lt; &#39; and friends back into characters', v => S(v).replace(/&(#x?[\da-f]+|\w+);/gi, (m, e) => (e[0] === '#' ? String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : Number(e.slice(1))) : { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', copy: '©', reg: '®', hellip: '…', rsquo: '’', lsquo: '‘', ldquo: '“', rdquo: '”', mdash: '—', ndash: '–' }[e.toLowerCase()] ?? m)), { t: [['&lt;3 &amp; &#8377;', '<3 & ₹']] });
E('enc.hex', 'Text to hex', 'Writes the text’s bytes as hex', v => Buffer.from(S(v)).toString('hex'), { t: [['Hi', '4869']] });
E('enc.unhex', 'Hex to text', 'Reads hex bytes back into text', v => Buffer.from(S(v).replace(/[^0-9a-f]/gi, ''), 'hex').toString('utf8'), { t: [['4869', 'Hi']] });
E('enc.binary', 'Text to binary', 'Writes each byte as 8 ones and zeros', v => [...Buffer.from(S(v))].map(b => b.toString(2).padStart(8, '0')).join(' '), { t: [['Hi', '01001000 01101001']] });
E('enc.rot13', 'ROT13', 'Shifts letters by 13 (doing it twice gives the text back)', v => S(v).replace(/[a-z]/gi, c => String.fromCharCode((c <= 'Z' ? 65 : 97) + ((c.charCodeAt(0) - (c <= 'Z' ? 65 : 97) + 13) % 26))), { t: [['Hello', 'Uryyb']] });
const MORSE = { a: '.-', b: '-...', c: '-.-.', d: '-..', e: '.', f: '..-.', g: '--.', h: '....', i: '..', j: '.---', k: '-.-', l: '.-..', m: '--', n: '-.', o: '---', p: '.--.', q: '--.-', r: '.-.', s: '...', t: '-', u: '..-', v: '...-', w: '.--', x: '-..-', y: '-.--', z: '--..', 0: '-----', 1: '.----', 2: '..---', 3: '...--', 4: '....-', 5: '.....', 6: '-....', 7: '--...', 8: '---..', 9: '----.', '.': '.-.-.-', ',': '--..--', '?': '..--..', '!': '-.-.--' };
const UNMORSE = Object.fromEntries(Object.entries(MORSE).map(([k, v]) => [v, k]));
E('enc.morse', 'Text to Morse', 'Writes the text in Morse code', v => S(v).toLowerCase().split(' ').filter(Boolean).map(w => [...w].map(c => MORSE[c] || '').filter(Boolean).join(' ')).join(' / '), { t: [['SOS hi', '... --- ... / .... ..']] });
E('enc.unmorse', 'Morse to text', 'Reads Morse code back into text', v => S(v).trim().split(/\s*\/\s*/).map(w => w.split(/\s+/).map(c => UNMORSE[c] || '').join('')).join(' ').toUpperCase(), { t: [['... --- ... / .... ..', 'SOS HI']] });
const HASH = (key, alg, label, sample) => E(key, label, `The ${label.replace(' hash', '')} hash of the text (hex)`, (v, p) => createHash(alg).update(S(v)).digest(p.encoding === 'base64' ? 'base64' : 'hex'), { f: [sel('encoding', 'As', [['hex', 'hex'], ['base64', 'Base64']])], t: [['hello', sample, { encoding: 'hex' }]], out: 'hash', icon: 'key' });
HASH('hash.md5', 'md5', 'MD5 hash', '5d41402abc4b2a76b9719d911017c592');
HASH('hash.sha1', 'sha1', 'SHA-1 hash', 'aaf4c61ddcc5e8a2dabede0f3b482cd9aea9434d');
HASH('hash.sha256', 'sha256', 'SHA-256 hash', '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824');
HASH('hash.sha512', 'sha512', 'SHA-512 hash', '9b71d224bd62f3785d96d46ad3ea3d73319bfbc2890caadae2dff72519673ca72323c3d99ba5c11d7c7acc6e14b8c5da0c4663475c2e5c3adef46f73bcdec043');
E('hash.hmac', 'HMAC signature', 'Signs the text with a secret (to check or make webhook signatures)', (v, p) => createHmac(p.algorithm || 'sha256', S(p.secret)).update(S(v)).digest(p.encoding === 'base64' ? 'base64' : 'hex'), { f: [{ k: 'secret', label: 'Secret', kind: 'text', secret: true }, sel('algorithm', 'Algorithm', [['sha256', 'SHA-256'], ['sha1', 'SHA-1'], ['sha512', 'SHA-512'], ['md5', 'MD5']]), sel('encoding', 'As', [['hex', 'hex'], ['base64', 'Base64']])], t: [['hello', '9307b3b915efb5171ff14d8cb55fbcc798c6c0ef1456d66ded1a6aa723a58b7b', { secret: 'key', algorithm: 'sha256', encoding: 'hex' }]], out: 'signature', icon: 'key' });
const CRC = (() => { const t = []; for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
E('hash.crc32', 'CRC32 checksum', 'A short checksum of the text (hex)', v => { let c = 0xffffffff; for (const b of Buffer.from(S(v))) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8); return ((c ^ 0xffffffff) >>> 0).toString(16).padStart(8, '0'); }, { t: [['hello', '3610a686']], out: 'checksum', icon: 'key' });
E('enc.jwt', 'Read a JWT', 'Decodes a JSON Web Token’s header and payload (without checking its signature)', v => { const [h, pl] = S(v).replace(/^Bearer\s+/i, '').split('.'); try { const dec = s => JSON.parse(Buffer.from(s, 'base64url').toString('utf8')); const payload = dec(pl); return { header: dec(h), payload, ...(payload.exp ? { expires: new Date(payload.exp * 1000).toISOString(), expired: payload.exp * 1000 < Date.now() } : {}) }; } catch (e) { bad('That isn’t a JWT (three parts separated by dots).'); } }, { vl: 'Token', t: [['eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJhZGEifQ.x', { header: { alg: 'HS256' }, payload: { sub: 'ada' } }]], out: 'jwt' });
E('enc.parseQuery', 'Read a query string', 'Turns a=1&b=two (or a whole link) into an object', v => { const s = S(v); const q = s.includes('?') ? s.slice(s.indexOf('?') + 1).split('#')[0] : s.replace(/^\?/, ''); const out = {}; for (const [k, x] of new URLSearchParams(q)) out[k] = k in out ? [].concat(out[k], x) : x; return out; }, { t: [['https://x.io/?q=hi+there&tag=a&tag=b', { q: 'hi there', tag: ['a', 'b'] }]], out: 'query' });
E('enc.buildQuery', 'Make a query string', 'Turns an object into a=1&b=two', v => { const sp = new URLSearchParams(); for (const [k, x] of Object.entries(O(v))) for (const y of [].concat(x)) if (y !== undefined && y !== null) sp.append(k, S(y)); return sp.toString(); }, { vl: 'Object', dv: '{{ $json }}', t: [[{ q: 'hi there', n: 2 }, 'q=hi+there&n=2']], out: 'query' });
E('enc.parseUrl', 'Read a link', 'Splits a web address into protocol, host, path, query and hash', v => { let u; try { u = new URL(S(v)); } catch (e) { bad(`“${S(v)}” isn't a web address.`); } return { protocol: u.protocol.replace(':', ''), host: u.host, hostname: u.hostname, port: u.port, path: u.pathname, query: Object.fromEntries(u.searchParams), hash: u.hash.replace('#', ''), origin: u.origin }; }, { vl: 'Link', t: [['https://shop.io:8080/a/b?x=1#top', { protocol: 'https', host: 'shop.io:8080', hostname: 'shop.io', port: '8080', path: '/a/b', query: { x: '1' }, hash: 'top', origin: 'https://shop.io:8080' }]], out: 'url' });
E('enc.domain', 'Domain of a link', 'The domain of a web address or email (without www.)', v => { const s = S(v).trim(); if (/^[^/\s]+@[^/\s]+$/.test(s)) return s.split('@')[1].toLowerCase(); try { return new URL(/^https?:\/\//i.test(s) ? s : `https://${s}`).hostname.replace(/^www\./, ''); } catch (e) { bad(`“${s}” has no domain.`); } }, { vl: 'Link or email', t: [['https://www.example.com/x', 'example.com'], ['ada@Work.io', 'work.io']], out: 'domain' });
E('enc.jsonParse', 'Read JSON', 'Turns JSON text into data', v => { if (typeof v !== 'string') return v; try { return JSON.parse(v); } catch (e) { bad(`That isn’t valid JSON: ${e.message}`); } }, { t: [['{"a":[1,2]}', { a: [1, 2] }]], out: 'data' });
E('enc.jsonStringify', 'Write JSON', 'Turns data into JSON text', (v, p) => JSON.stringify(v, null, B(p.pretty) ? 2 : 0), { vl: 'Data', dv: '{{ $json }}', f: [bool('pretty', 'Spread over lines')], t: [[{ a: 1 }, '{"a":1}', {}]], out: 'json' });
E('enc.unicode', 'Unicode escape', 'Writes characters outside plain ASCII as \\uXXXX', v => S(v).replace(/[^\x20-\x7e]/g, c => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`), { t: [['₹5', '\\u20b95']] });
E('enc.charCodes', 'Character codes', 'Lists each character’s Unicode number', v => [...S(v)].map(c => c.codePointAt(0)), { t: [['AB', [65, 66]]], out: 'codes' });

/* ================= Check ================= */
const C = (key, label, note, fn, o = {}) => T('Check', key, label, note, fn, { out: o.out || 'valid', ...o });
const luhn = s => { const d = s.replace(/\D/g, ''); if (d.length < 12) return false; let sum = 0; for (let i = 0; i < d.length; i++) { let n = Number(d[d.length - 1 - i]); if (i % 2) { n *= 2; if (n > 9) n -= 9; } sum += n; } return sum % 10 === 0; };
const VERHOEFF_D = [[0, 1, 2, 3, 4, 5, 6, 7, 8, 9], [1, 2, 3, 4, 0, 6, 7, 8, 9, 5], [2, 3, 4, 0, 1, 7, 8, 9, 5, 6], [3, 4, 0, 1, 2, 8, 9, 5, 6, 7], [4, 0, 1, 2, 3, 9, 5, 6, 7, 8], [5, 9, 8, 7, 6, 0, 4, 3, 2, 1], [6, 5, 9, 8, 7, 1, 0, 4, 3, 2], [7, 6, 5, 9, 8, 2, 1, 0, 4, 3], [8, 7, 6, 5, 9, 3, 2, 1, 0, 4], [9, 8, 7, 6, 5, 4, 3, 2, 1, 0]];
const VERHOEFF_P = [[0, 1, 2, 3, 4, 5, 6, 7, 8, 9], [1, 5, 7, 6, 2, 8, 3, 0, 9, 4], [5, 8, 0, 3, 7, 9, 6, 1, 4, 2], [8, 9, 1, 6, 0, 4, 3, 5, 2, 7], [9, 4, 5, 3, 1, 2, 6, 8, 7, 0], [4, 2, 8, 6, 5, 7, 3, 9, 0, 1], [2, 7, 9, 3, 8, 0, 6, 4, 1, 5], [7, 0, 4, 6, 9, 1, 3, 2, 5, 8]];
const verhoeff = s => { let c = 0; [...s].reverse().forEach((ch, i) => { c = VERHOEFF_D[c][VERHOEFF_P[i % 8][Number(ch)]]; }); return c === 0; };
C('check.email', 'Is it an email?', 'True when the text looks like an email address', v => /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/.test(S(v).trim()), { t: [['ada@example.com', true], ['ada@', false]] });
C('check.url', 'Is it a link?', 'True when the text is a web address (http or https)', v => { try { const u = new URL(S(v).trim()); return /^https?:$/.test(u.protocol) && u.hostname.includes('.'); } catch (e) { return false; } }, { t: [['https://workline.app', true], ['not a link', false]] });
C('check.phone', 'Is it a phone number?', 'True for a phone number: international (+…) or an Indian mobile', (v, p) => { const d = S(v).replace(/[\s().-]/g, ''); return p.country === 'IN' ? /^(\+?91|0)?[6-9]\d{9}$/.test(d) : /^\+?[1-9]\d{6,14}$/.test(d); }, { f: [sel('country', 'Kind', [['any', 'Any (international)'], ['IN', 'Indian mobile']])], t: [['+91 98765 43210', true, { country: 'IN' }], ['12345', false, { country: 'IN' }]] });
C('check.number', 'Is it a number?', 'True when the value is (or reads as) a number', v => typeof v === 'number' ? Number.isFinite(v) : /^\s*-?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?\s*$/i.test(S(v)), { t: [['42.5', true], ['4a', false]] });
C('check.integer', 'Is it a whole number?', 'True for whole numbers like 7 or -3', v => /^\s*-?\d+\s*$/.test(S(v)), { t: [['7', true], ['7.5', false]] });
C('check.empty', 'Is it empty?', 'True for blank text, null, an empty list or object', v => v === null || v === undefined || (typeof v === 'string' && !v.trim()) || (Array.isArray(v) && !v.length) || (typeof v === 'object' && !Array.isArray(v) && !Object.keys(v).length), { t: [['  ', true], [[1], false]], out: 'empty' });
C('check.json', 'Is it JSON?', 'True when the text is valid JSON', v => { if (typeof v !== 'string') return true; try { JSON.parse(v); return true; } catch (e) { return false; } }, { t: [['{"a":1}', true], ['{a:1}', false]] });
C('check.uuid', 'Is it a UUID?', 'True for ids like 123e4567-e89b-12d3-a456-426614174000', v => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(S(v).trim()), { t: [['123e4567-e89b-12d3-a456-426614174000', true]] });
C('check.ip', 'Is it an IP address?', 'True for an IPv4 or IPv6 address', v => { const s = S(v).trim(); return /^((25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(25[0-5]|2[0-4]\d|1?\d?\d)$/.test(s) || (s.includes(':') && /^[0-9a-f:]+$/i.test(s) && s.split(':').length <= 8); }, { t: [['192.168.1.10', true], ['300.1.1.1', false]] });
C('check.card', 'Is it a card number?', 'True when a card number passes the Luhn check', v => luhn(S(v)), { t: [['4242 4242 4242 4242', true], ['4242 4242 4242 4241', false]] });
C('check.iban', 'Is it an IBAN?', 'True when a bank IBAN passes its check digits', v => { const s = S(v).replace(/\s/g, '').toUpperCase(); if (!/^[A-Z]{2}\d{2}[A-Z\d]{10,30}$/.test(s)) return false; const r = (s.slice(4) + s.slice(0, 4)).replace(/[A-Z]/g, c => String(c.charCodeAt(0) - 55)); let m = 0; for (const ch of r) m = (m * 10 + Number(ch)) % 97; return m === 1; }, { t: [['GB82 WEST 1234 5698 7654 32', true]] });
C('check.pan', 'Is it a PAN?', 'True for an Indian PAN like ABCDE1234F', v => /^[A-Z]{5}\d{4}[A-Z]$/.test(S(v).trim().toUpperCase()), { t: [['abcde1234f', true], ['ABCD1234F', false]] });
C('check.gstin', 'Is it a GSTIN?', 'True for an Indian GST number (15 characters, with its check character)', v => { const s = S(v).trim().toUpperCase(); if (!/^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(s)) return false; const cs = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ'; let sum = 0; for (let i = 0; i < 14; i++) { const pr = cs.indexOf(s[i]) * (i % 2 ? 2 : 1); sum += Math.floor(pr / 36) + (pr % 36); } return cs[(36 - (sum % 36)) % 36] === s[14]; }, { t: [['27AAPFU0939F1ZV', true], ['27AAPFU0939F1ZX', false]] });
C('check.ifsc', 'Is it an IFSC code?', 'True for an Indian bank IFSC like SBIN0001234', v => /^[A-Z]{4}0[A-Z0-9]{6}$/.test(S(v).trim().toUpperCase()), { t: [['SBIN0001234', true]] });
C('check.aadhaar', 'Is it an Aadhaar number?', 'True for a 12-digit Aadhaar number that passes its check digit', v => { const d = S(v).replace(/\s|-/g, ''); return /^[2-9]\d{11}$/.test(d) && verhoeff(d); }, { t: [['2341 2341 2346', true], ['2341 2341 2341', false]] });
C('check.pincode', 'Is it a PIN code?', 'True for an Indian 6-digit PIN code', v => /^[1-9]\d{5}$/.test(S(v).replace(/\s/g, '')), { t: [['110001', true], ['011001', false]] });
C('check.upi', 'Is it a UPI id?', 'True for a UPI id like name@okhdfcbank', v => /^[\w.-]{2,256}@[a-zA-Z]{2,64}$/.test(S(v).trim()), { t: [['ada.k@okicici', true], ['ada@', false]] });
C('check.vehicle', 'Is it a vehicle number?', 'True for an Indian vehicle registration like MH 12 AB 1234', v => /^[A-Z]{2}\s?\d{1,2}\s?[A-Z]{0,3}\s?\d{4}$/.test(S(v).trim().toUpperCase()) || /^\d{2}\s?BH\s?\d{4}\s?[A-Z]{1,2}$/.test(S(v).trim().toUpperCase()), { t: [['MH 12 AB 1234', true]] });
C('check.zip', 'Is it a US ZIP code?', 'True for 12345 or 12345-6789', v => /^\d{5}(-\d{4})?$/.test(S(v).trim()), { t: [['94105', true]] });
C('check.hexColor', 'Is it a colour?', 'True for a hex colour like #ff8800 or #f80', v => /^#([0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(S(v).trim()), { t: [['#FF8800', true], ['ff8800', false]] });
C('check.date', 'Is it a date?', 'True when the text reads as a date', v => !Number.isNaN(new Date(S(v)).getTime()) && S(v).trim() !== '', { t: [['2025-02-28', true], ['someday', false]] });
C('check.palindrome', 'Is it a palindrome?', 'True when it reads the same backwards (ignoring spaces and capitals)', v => { const s = deaccent(v).toLowerCase().replace(/[^a-z0-9]/g, ''); return !!s && s === [...s].reverse().join(''); }, { t: [['Never odd or even', true]] });
C('check.password', 'Strong password?', 'Checks a password: length, capitals, digits, symbols; gives a score and what’s missing', v => { const s = S(v), missing = []; if (s.length < 8) missing.push('8+ characters'); if (!/[a-z]/.test(s)) missing.push('a small letter'); if (!/[A-Z]/.test(s)) missing.push('a capital'); if (!/\d/.test(s)) missing.push('a digit'); if (!/[^A-Za-z0-9]/.test(s)) missing.push('a symbol'); return { strong: !missing.length, score: 5 - missing.length, missing }; }, { vl: 'Password', t: [['Abc123!x', { strong: true, score: 5, missing: [] }], ['abc', { strong: false, score: 1, missing: ['8+ characters', 'a capital', 'a digit', 'a symbol'] }]], out: 'password' });
const isPrime = n => { if (!Number.isInteger(n) || n < 2) return false; for (let i = 2; i * i <= n; i++) if (n % i === 0) return false; return true; };
C('check.prime', 'Is it prime?', 'True for prime numbers (2, 3, 5, 7, 11…)', v => isPrime(N(v)), { t: [[97, true], [91, false]], out: 'prime' });
C('check.even', 'Is it even?', 'True for even numbers', v => N(v) % 2 === 0, { t: [[10, true]], out: 'even' });
C('check.odd', 'Is it odd?', 'True for odd numbers', v => Math.abs(N(v) % 2) === 1, { t: [[7, true]], out: 'odd' });
C('check.between', 'Is it in range?', 'True when a number is between a lowest and highest value', (v, p) => { const x = N(v); return x >= Nopt(p.min, -Infinity) && x <= Nopt(p.max, Infinity); }, { f: [num('min', 'Lowest', 0), num('max', 'Highest', 100)], t: [[42, true, { min: 0, max: 100 }]], out: 'inRange' });
C('check.matches', 'Matches a pattern?', 'True when the text matches a regular expression', (v, p) => { try { return new RegExp(S(p.pattern), B(p.ignoreCase) ? 'i' : '').test(S(v)); } catch (e) { bad(`The pattern isn't valid: ${e.message}`); } }, { f: [txt('pattern', 'Pattern', '^INV-\\d+$'), bool('ignoreCase', 'Ignore capitals')], t: [['INV-204', true, { pattern: '^INV-\\d+$' }]], out: 'matches' });
C('check.length', 'Length in range?', 'True when the text’s length is between two numbers', (v, p) => { const n = [...S(v)].length; return n >= Nopt(p.min, 0) && n <= Nopt(p.max, Infinity); }, { f: [num('min', 'At least', 1), num('max', 'At most', 280)], t: [['hello', true, { min: 1, max: 10 }]], out: 'ok' });
C('check.isbn', 'Is it an ISBN?', 'True for a valid ISBN-10 or ISBN-13', v => { const s = S(v).replace(/[\s-]/g, '').toUpperCase(); if (/^\d{9}[\dX]$/.test(s)) return [...s].reduce((a, c, i) => a + (c === 'X' ? 10 : Number(c)) * (10 - i), 0) % 11 === 0; if (/^\d{13}$/.test(s)) return [...s].reduce((a, c, i) => a + Number(c) * (i % 2 ? 3 : 1), 0) % 10 === 0; return false; }, { t: [['978-0-306-40615-7', true], ['0-306-40615-2', true]] });
C('check.domain', 'Is it a domain?', 'True for a domain name like example.co.in', v => /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i.test(S(v).trim()), { t: [['example.co.in', true], ['-bad-.com', false]] });
C('check.equal', 'Are they the same?', 'True when two values are equal (as text, or ignoring capitals and spaces)', (v, p) => (B(p.loose) ? S(v).trim().toLowerCase() === S(p.other).trim().toLowerCase() : S(v) === S(p.other)), { f: [txt('other', 'Compare with'), bool('loose', 'Ignore capitals and outer spaces', true)], t: [[' Yes', true, { other: 'yes', loose: true }]], out: 'same' });
C('check.truthy', 'Is it yes?', 'True for yes, y, true, 1, on, ✓ (any capitals); false otherwise', v => ['yes', 'y', 'true', '1', 'on', '✓', 'ok', 'haan', 'ha'].includes(S(v).trim().toLowerCase()), { t: [['Yes', true], ['no', false]], out: 'yes' });

/* ================= Convert ================= */
const V = (key, label, note, fn, o = {}) => T('Convert', key, label, note, fn, o);
const unitNode = (key, label, note, table, def, sample) => V(key, label, note, (v, p) => {
  const from = table[p.from || def[0]], to = table[p.to || def[1]];
  if (!from || !to) bad('Pick the units.');
  return round(N(v) * from[0] / to[0], Nopt(p.decimals, 4));
}, { vl: 'Amount', f: [sel('from', 'From', Object.entries(table).map(([k, x]) => [k, x[1]]), def[0]), sel('to', 'To', Object.entries(table).map(([k, x]) => [k, x[1]]), def[1]), num('decimals', 'Decimal places', 4)], t: [[sample[0], sample[2], { from: def[0], to: def[1], ...(sample[1] || {}) }]] });
unitNode('conv.length', 'Length', 'Converts lengths: km, m, cm, mm, miles, yards, feet, inches', { km: [1000, 'kilometres'], m: [1, 'metres'], cm: [0.01, 'centimetres'], mm: [0.001, 'millimetres'], mi: [1609.344, 'miles'], yd: [0.9144, 'yards'], ft: [0.3048, 'feet'], in: [0.0254, 'inches'], nmi: [1852, 'nautical miles'] }, ['km', 'mi'], [10, {}, 6.2137]);
unitNode('conv.weight', 'Weight', 'Converts weights: kg, g, mg, tonnes, pounds, ounces', { kg: [1, 'kilograms'], g: [0.001, 'grams'], mg: [1e-6, 'milligrams'], t: [1000, 'tonnes'], lb: [0.45359237, 'pounds'], oz: [0.028349523125, 'ounces'], st: [6.35029318, 'stone'] }, ['kg', 'lb'], [10, {}, 22.0462]);
unitNode('conv.volume', 'Volume', 'Converts volumes: litres, ml, gallons, cups, fluid ounces', { l: [1, 'litres'], ml: [0.001, 'millilitres'], m3: [1000, 'cubic metres'], gal: [3.785411784, 'US gallons'], qt: [0.946352946, 'US quarts'], pt: [0.473176473, 'US pints'], cup: [0.24, 'cups'], floz: [0.0295735295625, 'US fluid ounces'], tbsp: [0.01478676478125, 'tablespoons'], tsp: [0.00492892159375, 'teaspoons'] }, ['l', 'gal'], [10, {}, 2.6417]);
unitNode('conv.area', 'Area', 'Converts areas: m², km², hectares, acres, sq ft, bigha', { m2: [1, 'square metres'], km2: [1e6, 'square kilometres'], ha: [1e4, 'hectares'], acre: [4046.8564224, 'acres'], ft2: [0.09290304, 'square feet'], yd2: [0.83612736, 'square yards'], mi2: [2589988.110336, 'square miles'], gaj: [0.83612736, 'gaj (sq yard)'], bigha: [2529.285264, 'bigha (Rajasthan/UP pucca)'] }, ['acre', 'ft2'], [1, { decimals: 0 }, 43560]);
unitNode('conv.speed', 'Speed', 'Converts speeds: km/h, mph, m/s, knots', { kmh: [1 / 3.6, 'km/h'], mph: [0.44704, 'mph'], ms: [1, 'm/s'], knot: [0.514444, 'knots'], fts: [0.3048, 'ft/s'] }, ['kmh', 'mph'], [100, { decimals: 2 }, 62.14]);
unitNode('conv.data', 'Data size', 'Converts data sizes: bytes, KB, MB, GB, TB (1024 or 1000)', { B: [1, 'bytes'], KB: [1000, 'KB (1000)'], MB: [1e6, 'MB (1000²)'], GB: [1e9, 'GB (1000³)'], TB: [1e12, 'TB (1000⁴)'], KiB: [1024, 'KiB (1024)'], MiB: [1048576, 'MiB (1024²)'], GiB: [1073741824, 'GiB (1024³)'], TiB: [1099511627776, 'TiB (1024⁴)'], bit: [0.125, 'bits'] }, ['GB', 'MB'], [1.5, {}, 1500]);
unitNode('conv.time', 'Time', 'Converts time: ms, seconds, minutes, hours, days, weeks, years', { ms: [0.001, 'milliseconds'], s: [1, 'seconds'], min: [60, 'minutes'], h: [3600, 'hours'], d: [86400, 'days'], wk: [604800, 'weeks'], mo: [2629746, 'months (average)'], yr: [31556952, 'years'] }, ['h', 'min'], [2.5, {}, 150]);
unitNode('conv.energy', 'Energy', 'Converts energy: joules, kJ, calories, kcal, kWh, BTU', { J: [1, 'joules'], kJ: [1000, 'kilojoules'], cal: [4.184, 'calories'], kcal: [4184, 'kilocalories'], Wh: [3600, 'watt-hours'], kWh: [3.6e6, 'kilowatt-hours'], BTU: [1055.05585, 'BTU'] }, ['kcal', 'kJ'], [100, {}, 418.4]);
unitNode('conv.pressure', 'Pressure', 'Converts pressure: Pa, kPa, bar, psi, atm, mmHg', { Pa: [1, 'pascals'], kPa: [1000, 'kilopascals'], bar: [1e5, 'bar'], psi: [6894.757293, 'psi'], atm: [101325, 'atmospheres'], mmHg: [133.322387, 'mmHg'] }, ['psi', 'bar'], [32, { decimals: 3 }, 2.206]);
unitNode('conv.angle', 'Angle', 'Converts angles: degrees, radians, turns', { deg: [Math.PI / 180, 'degrees'], rad: [1, 'radians'], turn: [2 * Math.PI, 'turns'], grad: [Math.PI / 200, 'gradians'] }, ['deg', 'rad'], [180, {}, 3.1416]);
unitNode('conv.fuel', 'Fuel economy (km/l ↔ mpg)', 'Converts km per litre to miles per gallon and back', { kmpl: [1, 'km per litre'], mpg: [0.425143707, 'miles per US gallon'], mpgUK: [0.354006189, 'miles per UK gallon'] }, ['kmpl', 'mpg'], [15, { decimals: 2 }, 35.28]);
V('conv.temperature', 'Temperature', 'Converts between Celsius, Fahrenheit and Kelvin', (v, p) => { const x = N(v), c = { C: x, F: (x - 32) * 5 / 9, K: x - 273.15 }[p.from || 'C']; return round({ C: c, F: c * 9 / 5 + 32, K: c + 273.15 }[p.to || 'F'], Nopt(p.decimals, 2)); }, { vl: 'Temperature', f: [sel('from', 'From', [['C', '°C'], ['F', '°F'], ['K', 'K']]), sel('to', 'To', [['F', '°F'], ['C', '°C'], ['K', 'K']]), num('decimals', 'Decimal places', 2)], t: [[37, 98.6, { from: 'C', to: 'F' }]] });
V('conv.bytes', 'Readable file size', 'Writes bytes as 1.5 KB, 3.2 MB, 1.1 GB', (v, p) => { let n = N(v); const k = p.base === '1000' ? 1000 : 1024, u = ['B', 'KB', 'MB', 'GB', 'TB', 'PB']; let i = 0; while (Math.abs(n) >= k && i < u.length - 1) { n /= k; i++; } return `${i ? round(n, 1) : n} ${u[i]}`; }, { vl: 'Bytes', f: [sel('base', 'Kilobyte is', [['1024', '1024 bytes'], ['1000', '1000 bytes']])], t: [[1536, '1.5 KB', { base: '1024' }]], out: 'size' });
const hexRgb = s => { let h = S(s).trim().replace('#', ''); if (h.length === 3) h = [...h].map(c => c + c).join(''); if (!/^[0-9a-f]{6}$/i.test(h)) bad(`“${s}” isn't a hex colour.`); return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16) }; };
V('conv.hexToRgb', 'Hex to RGB', 'Turns #ff8800 into {r, g, b} and rgb(255, 136, 0)', v => { const c = hexRgb(v); return { ...c, css: `rgb(${c.r}, ${c.g}, ${c.b})` }; }, { vl: 'Colour', t: [['#ff8800', { r: 255, g: 136, b: 0, css: 'rgb(255, 136, 0)' }]], out: 'rgb' });
V('conv.rgbToHex', 'RGB to hex', 'Turns rgb(255, 136, 0) or "255,136,0" into #ff8800', v => { const n = (typeof v === 'object' && v ? [v.r, v.g, v.b] : S(v).match(/\d+/g) || []).map(Number); if (n.length < 3) bad('Give three numbers: red, green, blue.'); return '#' + n.slice(0, 3).map(x => Math.max(0, Math.min(255, x)).toString(16).padStart(2, '0')).join(''); }, { vl: 'Colour', t: [['rgb(255, 136, 0)', '#ff8800']], out: 'hex' });
V('conv.hexToHsl', 'Hex to HSL', 'Turns #ff8800 into hue, saturation and lightness', v => { const { r, g, b } = hexRgb(v), R = r / 255, G = g / 255, Bl = b / 255, mx = Math.max(R, G, Bl), mn = Math.min(R, G, Bl), l = (mx + mn) / 2; let h = 0, s = 0; if (mx !== mn) { const d = mx - mn; s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn); h = mx === R ? (G - Bl) / d + (G < Bl ? 6 : 0) : mx === G ? (Bl - R) / d + 2 : (R - G) / d + 4; h *= 60; } const o = { h: Math.round(h), s: Math.round(s * 100), l: Math.round(l * 100) }; return { ...o, css: `hsl(${o.h}, ${o.s}%, ${o.l}%)` }; }, { vl: 'Colour', t: [['#ff8800', { h: 32, s: 100, l: 50, css: 'hsl(32, 100%, 50%)' }]], out: 'hsl' });
V('conv.lighten', 'Lighten or darken a colour', 'Makes a hex colour lighter (or, with a minus, darker) by a percent', (v, p) => { const c = hexRgb(v), k = Nopt(p.percent, 20) / 100; return '#' + [c.r, c.g, c.b].map(x => Math.round(k >= 0 ? x + (255 - x) * k : x * (1 + k)).toString(16).padStart(2, '0')).join(''); }, { vl: 'Colour', f: [num('percent', 'Percent (minus: darker)', 20)], t: [['#336699', '#5c85ad', { percent: 20 }]], out: 'colour' });
const ROMAN = [[1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'], [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']];
V('conv.roman', 'To Roman numerals', 'Writes 2025 as MMXXV', v => { let n = Math.trunc(N(v)); if (n < 1 || n > 3999) bad('Roman numerals go from 1 to 3999.'); let s = ''; for (const [k, r] of ROMAN) while (n >= k) { s += r; n -= k; } return s; }, { vl: 'Number', t: [[2025, 'MMXXV']], out: 'roman' });
V('conv.unroman', 'From Roman numerals', 'Reads MMXXV as 2025', v => { const s = S(v).trim().toUpperCase(); if (!/^M{0,3}(CM|CD|D?C{0,3})(XC|XL|L?X{0,3})(IX|IV|V?I{0,3})$/.test(s) || !s) bad(`“${s}” isn't a Roman numeral.`); let n = 0, i = 0; for (const [k, r] of ROMAN) while (s.startsWith(r, i)) { n += k; i += r.length; } return n; }, { vl: 'Roman numeral', t: [['MCMXCIV', 1994]], out: 'number' });
V('conv.base', 'Number base', 'Converts between binary, octal, decimal and hex (or any base 2–36)', (v, p) => { const from = Nopt(p.from, 10), to = Nopt(p.to, 2), s = S(v).trim().toLowerCase().replace(/^0[xbo]/, ''); const n = parseInt(s, from); if (Number.isNaN(n)) bad(`“${v}” isn't a base-${from} number.`); return n.toString(to); }, { vl: 'Number', f: [num('from', 'From base', 10), num('to', 'To base', 2)], t: [['255', 'ff', { from: 10, to: 16 }], ['1010', '10', { from: 2, to: 10 }]] });
V('conv.toBoolean', 'To true/false', 'Reads yes/no, on/off, 1/0, true/false as true or false', v => ['yes', 'y', 'true', '1', 'on', 'checked', 'ok'].includes(S(v).trim().toLowerCase()), { t: [['Yes', true], ['off', false]], out: 'bool' });
V('conv.toText', 'To text', 'Turns any value into text (objects as JSON)', v => S(v), { t: [[{ a: 1 }, '{"a":1}'], [42, '42']], out: 'text' });
const ONES = ['', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
const under100 = n => (n < 20 ? ONES[n] : TENS[Math.floor(n / 10)] + (n % 10 ? '-' + ONES[n % 10] : ''));
const under1000 = n => (n >= 100 ? ONES[Math.floor(n / 100)] + ' hundred' + (n % 100 ? ' ' + under100(n % 100) : '') : under100(n));
function inWords(x, indian) {
  let n = Math.floor(Math.abs(x));
  if (n === 0) return 'zero';
  const parts = [];
  const steps = indian ? [[1e7, 'crore'], [1e5, 'lakh'], [1e3, 'thousand']] : [[1e12, 'trillion'], [1e9, 'billion'], [1e6, 'million'], [1e3, 'thousand']];
  for (const [k, w] of steps) if (n >= k) { const q = Math.floor(n / k); parts.push((indian && q >= 100 ? inWords(q, true) : under1000(q)) + ' ' + w); n %= k; }
  if (n) parts.push(under1000(n));
  return (x < 0 ? 'minus ' : '') + parts.join(' ');
}
V('conv.words', 'Number in words', 'Writes 1234 as “one thousand two hundred thirty-four” (or in lakh and crore)', (v, p) => { const x = N(v), s = inWords(x, p.system === 'indian'), paise = Math.round((Math.abs(x) % 1) * 100); return p.money === true || p.money === 'true' ? `${p.system === 'indian' ? 'Rupees' : ''} ${s}${paise ? ` and ${under100(paise)} ${p.system === 'indian' ? 'paise' : 'cents'}` : ''} only`.trim().replace(/^./, c => c.toUpperCase()) : s; }, { vl: 'Number', f: [sel('system', 'System', [['international', 'Thousand, million'], ['indian', 'Lakh, crore (India)']]), bool('money', 'As an amount (… only)')], t: [[1250000, 'twelve lakh fifty thousand', { system: 'indian' }], [1234, 'one thousand two hundred thirty-four', { system: 'international' }]], out: 'words' });
V('conv.csv', 'List to CSV', 'Turns a list of objects into CSV text (a header row, then one row each)', v => { const l = L(v).map(x => (x && typeof x === 'object' ? x : { value: x })), cols = [...new Set(l.flatMap(Object.keys))], cell = x => { const s = S(x); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; }; return [cols.join(','), ...l.map(r => cols.map(c => cell(r[c])).join(','))].join('\n'); }, { vl: 'List of objects', dv: '{{ $items }}', t: [[[{ a: 1, b: 'x, y' }, { a: 2 }], 'a,b\n1,"x, y"\n2,']], out: 'csv' });
V('conv.markdownTable', 'List to Markdown table', 'Turns a list of objects into a Markdown table', v => { const l = L(v).map(x => (x && typeof x === 'object' ? x : { value: x })), cols = [...new Set(l.flatMap(Object.keys))], c = x => S(x).replace(/\|/g, '\\|').replace(/\n/g, ' '); return [`| ${cols.join(' | ')} |`, `| ${cols.map(() => '---').join(' | ')} |`, ...l.map(r => `| ${cols.map(k => c(r[k])).join(' | ')} |`)].join('\n'); }, { vl: 'List of objects', dv: '{{ $items }}', t: [[[{ n: 'Ada', s: 9 }], '| n | s |\n| --- | --- |\n| Ada | 9 |']], out: 'markdown' });
V('conv.htmlTable', 'List to HTML table', 'Turns a list of objects into an HTML table (for emails)', v => { const l = L(v).map(x => (x && typeof x === 'object' ? x : { value: x })), cols = [...new Set(l.flatMap(Object.keys))], e = x => S(x).replace(/[&<>"']/g, ch => HTML_ENT[ch]); return `<table border="1" cellpadding="6" style="border-collapse:collapse"><thead><tr>${cols.map(k => `<th>${e(k)}</th>`).join('')}</tr></thead><tbody>${l.map(r => `<tr>${cols.map(k => `<td>${e(r[k] ?? '')}</td>`).join('')}</tr>`).join('')}</tbody></table>`; }, { vl: 'List of objects', dv: '{{ $items }}', t: [[[{ a: '<1>' }], '<table border="1" cellpadding="6" style="border-collapse:collapse"><thead><tr><th>a</th></tr></thead><tbody><tr><td>&lt;1&gt;</td></tr></tbody></table>']], out: 'html' });
V('conv.markdownToText', 'Markdown to plain text', 'Removes Markdown marks: **, #, links, lists', v => S(v).replace(/```[\s\S]*?```/g, m => m.replace(/```\w*\n?/g, '')).replace(/!\[([^\]]*)]\([^)]*\)/g, '$1').replace(/\[([^\]]+)]\([^)]*\)/g, '$1').replace(/^#{1,6}\s+/gm, '').replace(/^\s*[-*+]\s+/gm, '• ').replace(/(\*\*|__)(.*?)\1/g, '$2').replace(/(\*|_)(.*?)\1/g, '$2').replace(/`([^`]+)`/g, '$1').replace(/^>\s?/gm, '').trim(), { t: [['# Hi\n**Bold** and [a link](https://x.io)', 'Hi\nBold and a link']], out: 'text' });
V('conv.markdownToHtml', 'Markdown to HTML', 'Turns simple Markdown (headings, bold, italics, links, lists) into HTML', v => {
  const esc = s => s.replace(/[&<>"']/g, ch => HTML_ENT[ch]);
  const inline = s => esc(s).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/\*(.+?)\*/g, '<em>$1</em>').replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\[([^\]]+)]\((https?:[^)\s]+)\)/g, '<a href="$2">$1</a>');
  const out = []; let list = null;
  for (const line of S(v).split('\n')) {
    const h = line.match(/^(#{1,6})\s+(.*)/), li = line.match(/^\s*([-*+]|\d+\.)\s+(.*)/);
    if (li) { const tag = /\d/.test(li[1]) ? 'ol' : 'ul'; if (list !== tag) { if (list) out.push(`</${list}>`); out.push(`<${tag}>`); list = tag; } out.push(`<li>${inline(li[2])}</li>`); continue; }
    if (list) { out.push(`</${list}>`); list = null; }
    if (h) out.push(`<h${h[1].length}>${inline(h[2])}</h${h[1].length}>`); else if (line.trim()) out.push(`<p>${inline(line)}</p>`);
  }
  if (list) out.push(`</${list}>`);
  return out.join('\n');
}, { t: [['# Hi\n- **a**\n- b', '<h1>Hi</h1>\n<ul>\n<li><strong>a</strong></li>\n<li>b</li>\n</ul>']], out: 'html' });
V('conv.textToHtml', 'Text to HTML', 'Escapes text and turns blank lines into paragraphs and line breaks into <br>', v => S(v).split(/\n{2,}/).map(p => `<p>${p.replace(/[&<>"']/g, ch => HTML_ENT[ch]).replace(/\n/g, '<br>')}</p>`).join(''), { t: [['a\nb\n\nc', '<p>a<br>b</p><p>c</p>']], out: 'html' });
V('conv.bmi', 'BMI', 'Body mass index from weight (kg) and height (cm), with its category', (v, p) => { const b = round(N(v) / (N(p.height, 'The height') / 100) ** 2, 1); return { bmi: b, category: b < 18.5 ? 'Underweight' : b < 25 ? 'Healthy' : b < 30 ? 'Overweight' : 'Obese' }; }, { vl: 'Weight (kg)', f: [txt('height', 'Height (cm)', '170')], t: [[70, { bmi: 24.2, category: 'Healthy' }, { height: 170 }]], out: 'bmi' });
V('conv.percentToFraction', 'Fraction to percent', 'Turns 0.256 into 25.6% (or back, with “percent to fraction”)', (v, p) => (p.way === 'back' ? round(N(String(v).replace('%', '')) / 100, 6) : `${round(N(v) * 100, Nopt(p.decimals, 1))}%`), { f: [sel('way', 'Way', [['to', '0.25 → 25%'], ['back', '25% → 0.25']]), num('decimals', 'Decimal places', 1)], t: [[0.256, '25.6%', { way: 'to' }], ['25%', 0.25, { way: 'back' }]] });
V('conv.timezoneOffset', 'Time zone offset', 'The UTC offset of a time zone right now (Asia/Kolkata → +05:30)', v => { const tz = S(v).trim() || 'UTC'; const d = new Date(), p = partsIn(d, tz), asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second), m = Math.round((asUtc - Math.floor(d.getTime() / 1000) * 1000) / 60000); return `${m < 0 ? '-' : '+'}${pad(Math.floor(Math.abs(m) / 60))}:${pad(Math.abs(m) % 60)}`; }, { vl: 'Time zone', dv: 'Asia/Kolkata', t: [['Asia/Kolkata', '+05:30']], out: 'offset' });

/* ================= Generate ================= */
const G = (key, label, note, fn, o = {}) => T('Generate', key, label, note, fn, { nv: true, ...o });
const CHARS = { letters: 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ', digits: '0123456789', hex: '0123456789abcdef', alnum: 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789', lower: 'abcdefghijklmnopqrstuvwxyz0123456789' };
const randomFrom = (set, n) => Array.from({ length: n }, () => set[randomInt(set.length)]).join('');
const ofLen = (n, cs) => Object.assign(x => typeof x === 'string' && x.length === n && [...x].every(c => cs.includes(c)), { example: Array.from({ length: n }, (_, i) => cs[(i * 7 + 3) % cs.length]).join('') });
G('gen.uuid', 'UUID', 'A new random id like 3b241101-e2bb-4255-8caf-4136c566a962', () => randomUUID(), { t: [[null, Object.assign(x => /^[0-9a-f-]{36}$/.test(x), { example: '3b241101-e2bb-4255-8caf-4136c566a962' })]], out: 'id' });
G('gen.id', 'Short id', 'A short random id of letters and digits, with a prefix if you like', (v, p) => (p.prefix || '') + randomFrom(CHARS.alnum, Math.min(64, Math.max(4, Nopt(p.length, 12)))), { f: [num('length', 'Length', 12), txt('prefix', 'Prefix', '', 'ord_')], t: [[null, Object.assign(x => /^ord_[A-Za-z0-9]{8}$/.test(x), { example: 'ord_k3J9xQ2a' }), { length: 8, prefix: 'ord_' }]], out: 'id' });
G('gen.number', 'Random number', 'A random whole number between two numbers (inclusive)', (v, p) => { const a = Nopt(p.min, 1), b = Nopt(p.max, 100); return randomInt(Math.min(a, b), Math.max(a, b) + 1); }, { f: [num('min', 'From', 1), num('max', 'To', 100)], t: [[null, Object.assign(x => x >= 1 && x <= 6, { example: 4 }), { min: 1, max: 6 }]], out: 'number' });
G('gen.text', 'Random text', 'Random letters and/or digits of a length', (v, p) => randomFrom(CHARS[p.chars || 'alnum'], Math.min(1000, Nopt(p.length, 16))), { f: [num('length', 'Length', 16), sel('chars', 'Using', [['alnum', 'Letters and digits'], ['letters', 'Letters'], ['digits', 'Digits'], ['hex', 'Hex'], ['lower', 'Small letters and digits']])], t: [[null, ofLen(10, CHARS.hex), { length: 10, chars: 'hex' }]], out: 'text' });
G('gen.password', 'Password', 'A strong random password', (v, p) => { const n = Math.max(8, Nopt(p.length, 16)), sym = B(p.symbols) ? '!@#$%^&*-_=+?' : '', sets = ['abcdefghijkmnopqrstuvwxyz', 'ABCDEFGHJKLMNPQRSTUVWXYZ', '23456789', ...(sym ? [sym] : [])], all = sets.join(''); const c = [...sets.map(s => s[randomInt(s.length)]), ...Array.from({ length: n - sets.length }, () => all[randomInt(all.length)])]; for (let i = c.length - 1; i > 0; i--) { const j = randomInt(i + 1); [c[i], c[j]] = [c[j], c[i]]; } return c.join(''); }, { f: [num('length', 'Length', 16), bool('symbols', 'Include symbols', true)], t: [[null, Object.assign(x => x.length === 20 && /[A-Z]/.test(x) && /\d/.test(x) && /[^A-Za-z0-9]/.test(x), { example: 'q7K#pX2m-Rt9vW4z!BnE' }), { length: 20, symbols: true }]], out: 'password' });
G('gen.otp', 'One-time code', 'A random numeric code (OTP) like 482913', (v, p) => randomFrom(CHARS.digits, Math.min(12, Math.max(4, Nopt(p.digits, 6)))), { f: [num('digits', 'Digits', 6)], t: [[null, ofLen(6, CHARS.digits), { digits: 6 }]], out: 'otp' });
G('gen.token', 'Secret token', 'A long random secret (hex), for API keys and links', (v, p) => randomBytes(Math.min(128, Math.max(8, Nopt(p.bytes, 32)))).toString('hex'), { f: [num('bytes', 'Bytes of randomness', 32)], t: [[null, ofLen(64, CHARS.hex), { bytes: 32 }]], out: 'token' });
G('gen.pick', 'Pick one at random', 'Picks one entry at random from a list you give', (v, p) => { const l = L(p.from); if (!l.length) bad('Give a list to pick from.'); return l[randomInt(l.length)]; }, { f: [txt('from', 'From', 'Ada, Tim, Grace', 'a, b, c  or  {{ $json.list }}')], t: [[null, Object.assign(x => ['a', 'b'].includes(x), { example: 'b' }), { from: 'a, b' }]], out: 'pick' });
const LOREM = 'lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor incididunt ut labore et dolore magna aliqua ut enim ad minim veniam quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat'.split(' ');
G('gen.lorem', 'Placeholder text', 'Lorem ipsum filler text of some words', (v, p) => { const n = Math.min(2000, Nopt(p.words, 30)); const w = Array.from({ length: n }, (_, i) => LOREM[i % LOREM.length]); return w.join(' ').replace(/^./, c => c.toUpperCase()) + '.'; }, { f: [num('words', 'Words', 30)], t: [[null, 'Lorem ipsum dolor sit amet.', { words: 5 }]], out: 'text' });
G('gen.color', 'Random colour', 'A random hex colour (or a pleasant pastel one)', (v, p) => { if (p.kind === 'pastel') { const h = randomInt(360), s = 0.7, l = 0.8, k = n => (n + h / 30) % 12, a = s * Math.min(l, 1 - l), f = n => Math.round(255 * (l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1)))); return '#' + [f(0), f(8), f(4)].map(x => x.toString(16).padStart(2, '0')).join(''); } return '#' + randomBytes(3).toString('hex'); }, { f: [sel('kind', 'Kind', [['any', 'Any'], ['pastel', 'Pastel']])], t: [[null, Object.assign(x => /^#[0-9a-f]{6}$/.test(x), { example: '#7fb3e8' }), { kind: 'pastel' }]], out: 'colour' });
G('gen.coin', 'Toss a coin', 'Heads or tails', () => (randomInt(2) ? 'heads' : 'tails'), { t: [[null, Object.assign(x => ['heads', 'tails'].includes(x), { example: 'heads' })]], out: 'coin' });
G('gen.dice', 'Roll dice', 'Rolls dice and adds them up', (v, p) => { const n = Math.min(100, Math.max(1, Nopt(p.count, 1))), s = Math.max(2, Nopt(p.sides, 6)), rolls = Array.from({ length: n }, () => randomInt(1, s + 1)); return { rolls, total: rolls.reduce((a, b) => a + b, 0) }; }, { f: [num('count', 'Dice', 2), num('sides', 'Sides', 6)], t: [[null, Object.assign(x => x.rolls.length === 2 && x.total >= 2 && x.total <= 12, { example: { rolls: [3, 5], total: 8 } }), { count: 2, sides: 6 }]], out: 'dice' });
G('gen.sequence', 'Number sequence', 'A list of numbers: from, to, step (use Split out for one item each)', (v, p) => { const a = Nopt(p.from, 1), b = Nopt(p.to, 10), s = Math.abs(Nopt(p.step, 1)) || 1, out = []; for (let x = a; a <= b ? x <= b : x >= b; x += a <= b ? s : -s) { out.push(round(x, 10)); if (out.length >= 10000) break; } return out; }, { f: [num('from', 'From', 1), num('to', 'To', 10), num('step', 'Step', 1)], t: [[null, [1, 3, 5], { from: 1, to: 5, step: 2 }]], out: 'numbers' });
const FIRST = ['Aarav', 'Ananya', 'Vihaan', 'Diya', 'Arjun', 'Isha', 'Kabir', 'Meera', 'Rohan', 'Saanvi', 'Ada', 'Grace', 'Alan', 'Linus', 'Maya', 'Noah', 'Zara', 'Leo', 'Priya', 'Omar'];
const LAST = ['Sharma', 'Patel', 'Iyer', 'Khan', 'Gupta', 'Reddy', 'Singh', 'Das', 'Mehta', 'Nair', 'Lovelace', 'Hopper', 'Turing', 'Torvalds', 'Chen', 'Garcia', 'Smith', 'Okafor', 'Kim', 'Rossi'];
const pickA = a => a[randomInt(a.length)];
G('gen.person', 'Sample person', 'A made-up person for testing: name, email, phone, city', (v, p) => { const f = pickA(FIRST), l = pickA(LAST); return { name: `${f} ${l}`, firstName: f, lastName: l, email: `${f}.${l}${randomInt(10, 100)}@example.com`.toLowerCase(), phone: `+91 ${randomInt(6, 10)}${randomFrom(CHARS.digits, 4)} ${randomFrom(CHARS.digits, 5)}`, city: pickA(['Mumbai', 'Delhi', 'Bengaluru', 'Pune', 'Chennai', 'Hyderabad', 'Kolkata', 'Jaipur', 'London', 'New York']), age: randomInt(18, 70) }; }, { t: [[null, Object.assign(x => x.name && /@example\.com$/.test(x.email), { example: { name: 'Isha Mehta', email: 'isha.mehta42@example.com', phone: '+91 98123 45678', city: 'Pune', age: 31 } })]], out: 'person' });
G('gen.company', 'Sample company', 'A made-up company name and domain for testing', () => { const n = pickA(['Blue', 'Bright', 'Swift', 'Nova', 'Peak', 'Green', 'Pixel', 'Cloud', 'Iron', 'Lotus']) + pickA(['Labs', 'Works', 'Systems', 'Foods', 'Studio', 'Logistics', 'Health', 'Finance', 'Retail', 'Motors']); return { name: n.replace(/([a-z])([A-Z])/g, '$1 $2'), domain: `${n.toLowerCase()}.example` }; }, { t: [[null, Object.assign(x => x.name.includes(' ') && x.domain.endsWith('.example'), { example: { name: 'Nova Labs', domain: 'novalabs.example' } })]], out: 'company' });
G('gen.avatar', 'Avatar image link', 'A link to an avatar image with someone’s initials', (v, p) => `https://ui-avatars.com/api/?name=${encodeURIComponent(S(p.name) || 'User')}&size=${Nopt(p.size, 128)}&background=random`, { f: [txt('name', 'Name', '{{ $json.name }}'), num('size', 'Size (px)', 128)], t: [[null, 'https://ui-avatars.com/api/?name=Ada%20Lovelace&size=128&background=random', { name: 'Ada Lovelace', size: 128 }]], out: 'avatar' });
G('gen.gravatar', 'Gravatar link', 'The Gravatar picture link for an email address', (v, p) => `https://www.gravatar.com/avatar/${createHash('md5').update(S(p.email).trim().toLowerCase()).digest('hex')}?s=${Nopt(p.size, 128)}&d=identicon`, { f: [txt('email', 'Email', '{{ $json.email }}'), num('size', 'Size (px)', 128)], t: [[null, 'https://www.gravatar.com/avatar/0bc83cb571cd1c50ba6f3e8a78ef1346?s=80&d=identicon', { email: 'MyEmailAddress@example.com ', size: 80 }]], out: 'gravatar' });
G('gen.placeholderImage', 'Placeholder image link', 'A link to a placeholder image of a size, with text on it', (v, p) => `https://placehold.co/${Nopt(p.width, 600)}x${Nopt(p.height, 400)}${p.text ? `?text=${encodeURIComponent(S(p.text))}` : ''}`, { f: [num('width', 'Width', 600), num('height', 'Height', 400), txt('text', 'Text', '')], t: [[null, 'https://placehold.co/300x200?text=Hello', { width: 300, height: 200, text: 'Hello' }]], out: 'image' });
G('gen.timestamp', 'Unique stamp', 'A sortable time-based id (date, time and a random part)', () => `${new Date().toISOString().replace(/\D/g, '').slice(0, 14)}-${randomFrom(CHARS.lower, 6)}`, { t: [[null, Object.assign(x => /^\d{14}-[a-z0-9]{6}$/.test(x), { example: '20250131093000-k3j9xq' })]], out: 'stamp' });
