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
  input: { label: 'Input', w: 4, h: 9, props: { label: 'Label', placeholder: '', kind: 'text', value: '', steps: [] }, events: 'steps', holds: 'what was typed',
    fields: [f('label', 'Label'), f('placeholder', 'Placeholder'), f('kind', 'Kind', 'select', { options: [['text', 'Text'], ['number', 'Number'], ['email', 'Email'], ['tel', 'Phone'], ['url', 'Web address'], ['date', 'Date'], ['time', 'Time'], ['long', 'Long text'], ['password', 'Password']] }), f('value', 'Starts as')] },
  select: { label: 'Dropdown', w: 4, h: 9, props: { label: 'Choose', options: 'All, North, South, East', value: 'All', steps: [] }, events: 'steps', holds: 'the choice',
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

  hero: { label: 'Hero banner', w: 12, h: 30, props: { kicker: 'New', title: 'A big, bold headline', subtitle: 'One line about what this app does and who it’s for.', button: 'Get started', image: '', align: 'left', steps: [] }, events: 'steps',
    fields: [f('kicker', 'Small label above'), f('title', 'Headline'), f('subtitle', 'Below it', 'textarea'), f('button', 'Button (blank: none)'), f('image', 'Background photo URL (blank: a gradient)'), f('align', 'Align', 'select', { options: [['left', 'Left'], ['center', 'Center']] })] },

  /* ---- more inputs ---- */
  checkbox: { label: 'Checkbox', w: 4, h: 5, props: { label: 'I agree', value: false, steps: [] }, events: 'steps', holds: 'true or false',
    fields: [f('label', 'Label'), f('value', 'Ticked at first', 'bool')] },
  switch: { label: 'Switch', w: 4, h: 5, props: { label: 'Notifications', value: true, steps: [] }, events: 'steps', holds: 'true or false',
    fields: [f('label', 'Label'), f('value', 'On at first', 'bool')] },
  radio: { label: 'Radio buttons', w: 4, h: 12, props: { label: 'Size', options: 'Small, Medium, Large', value: 'Medium', inline: false, steps: [] }, events: 'steps', holds: 'the choice',
    fields: [f('label', 'Label'), f('options', 'Options', 'text', { hint: 'A, B, C  or  {{ data.x.map(r => r.name) }}' }), f('value', 'Starts as'), f('inline', 'Side by side', 'bool')] },
  multiselect: { label: 'Tags picker', w: 6, h: 9, props: { label: 'Topics', options: 'Sales, Support, Product, Design', value: '', steps: [] }, events: 'steps', holds: 'a list of the chosen ones',
    fields: [f('label', 'Label'), f('options', 'Options'), f('value', 'Chosen at first (A, B)')] },
  slider: { label: 'Slider', w: 4, h: 9, props: { label: 'Budget', min: 0, max: 100, step: 1, value: 50, unit: '', steps: [] }, events: 'steps', holds: 'the number',
    fields: [f('label', 'Label'), f('min', 'Lowest', 'number'), f('max', 'Highest', 'number'), f('step', 'Step', 'number'), f('value', 'Starts at', 'number'), f('unit', 'Unit', 'text', { hint: '%, $, kg…' })] },
  rating: { label: 'Rating', w: 4, h: 8, props: { label: 'How was it?', max: 5, value: 0, steps: [] }, events: 'steps', holds: 'the number of stars',
    fields: [f('label', 'Label'), f('max', 'Stars', 'number'), f('value', 'Starts at', 'number')] },
  date: { label: 'Date picker', w: 4, h: 9, props: { label: 'Date', kind: 'date', value: '', steps: [] }, events: 'steps', holds: 'the date (YYYY-MM-DD)',
    fields: [f('label', 'Label'), f('kind', 'Pick', 'select', { options: [['date', 'A date'], ['time', 'A time'], ['datetime-local', 'Date and time'], ['month', 'A month'], ['week', 'A week']] }), f('value', 'Starts as', 'text', { hint: '{{ new Date().toISOString().slice(0, 10) }}' })] },
  color: { label: 'Colour picker', w: 3, h: 9, props: { label: 'Colour', value: '#4f46e5', steps: [] }, events: 'steps', holds: 'the colour (#rrggbb)',
    fields: [f('label', 'Label'), f('value', 'Starts as', 'color')] },
  file: { label: 'File upload', w: 6, h: 12, props: { label: 'Upload a file', accept: '', read: 'dataurl', steps: [] }, events: 'steps', holds: '{name, type, size, content}',
    fields: [f('label', 'Label'), f('accept', 'Kinds of file', 'text', { hint: 'image/*, .pdf, .csv' }), f('read', 'Read it as', 'select', { options: [['dataurl', 'Data (images, PDFs: base64)'], ['text', 'Text (CSV, JSON, notes)']] })] },
  search: { label: 'Search box', w: 6, h: 6, props: { placeholder: 'Search…', value: '', steps: [] }, events: 'steps', holds: 'what was typed',
    fields: [f('placeholder', 'Placeholder')] },
  chat: { label: 'AI chat', w: 6, h: 44, props: { title: 'Ask me anything', workflow: '', field: 'reply', greeting: 'Hi! How can I help?', placeholder: 'Type a message…' }, holds: 'the conversation',
    fields: [f('title', 'Title'), f('workflow', 'Workflow that answers', 'workflow'), f('field', 'Field with the answer', 'text', { hint: 'reply (it gets {message, history})' }), f('greeting', 'First message'), f('placeholder', 'Placeholder')] },

  thread: { label: 'Message thread', w: 8, h: 50, props: { rows: '{{ data.messages }}', from: '{{ item.from }}', text: '{{ item.text }}', time: '{{ item.at ? new Date(item.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "" }}', mine: '{{ user && item.email === user.email }}', empty: 'No messages yet. Say hi!' },
    fields: [f('rows', 'Messages', 'text', { hint: '{{ data.messages }}' }), f('from', 'Who', 'text', { hint: '{{ item.from }}' }), f('text', 'Message', 'text', { hint: '{{ item.text }}' }), f('time', 'When'), f('mine', 'Mine (on the right) when', 'text', { hint: '{{ user && item.email === user.email }}' }), f('empty', 'With none yet')] },

  /* ---- more to show ---- */
  badge: { label: 'Badge', w: 2, h: 5, props: { text: 'New', tone: 'blue' },
    fields: [f('text', 'Text'), f('tone', 'Colour', 'select', { options: [['blue', 'Blue'], ['green', 'Green'], ['amber', 'Amber'], ['red', 'Red'], ['gray', 'Grey'], ['purple', 'Purple']] })] },
  alert: { label: 'Alert', w: 12, h: 9, props: { tone: 'info', title: 'Heads up', text: 'Something you should know.' },
    fields: [f('tone', 'Kind', 'select', { options: [['info', 'Info'], ['success', 'Success'], ['warning', 'Warning'], ['error', 'Error']] }), f('title', 'Title'), f('text', 'Text', 'textarea')] },
  progress: { label: 'Progress bar', w: 6, h: 7, props: { label: 'Progress', value: '{{ 65 }}', max: 100 },
    fields: [f('label', 'Label'), f('value', 'Value', 'text', { hint: '{{ data.x.length }}' }), f('max', 'Out of', 'number')] },
  gauge: { label: 'Gauge', w: 3, h: 18, props: { label: 'Score', value: '{{ 72 }}', max: 100, unit: '%' },
    fields: [f('label', 'Label'), f('value', 'Value'), f('max', 'Out of', 'number'), f('unit', 'Unit')] },
  avatar: { label: 'Profile', w: 4, h: 8, props: { image: '', name: '{{ user ? user.name : "Ada Lovelace" }}', subtitle: '{{ user ? user.email : "Analyst" }}' },
    fields: [f('image', 'Photo URL (blank: initials)'), f('name', 'Name'), f('subtitle', 'Below the name')] },
  link: { label: 'Link', w: 3, h: 4, props: { text: 'Open the docs', url: 'https://example.com', newTab: true },
    fields: [f('text', 'Text'), f('url', 'Address'), f('newTab', 'Open in a new tab', 'bool')] },
  code: { label: 'Code block', w: 6, h: 16, props: { title: '', code: 'const total = items.reduce((s, i) => s + i.price, 0);' },
    fields: [f('title', 'Title'), f('code', 'Code', 'textarea')] },
  json: { label: 'JSON viewer', w: 6, h: 24, props: { value: '{{ data.items }}' },
    fields: [f('value', 'What to show', 'text', { hint: '{{ vars.table1 }}' })] },
  details: { label: 'Details', w: 6, h: 20, props: { title: 'Details', value: '{{ vars.table1 || (data.items || [])[0] }}', fields: '' },
    fields: [f('title', 'Title'), f('value', 'The record', 'text', { hint: '{{ vars.table1 }}' }), f('fields', 'Fields (blank: all)', 'text', { hint: 'name, email, total' })] },
  timeline: { label: 'Timeline', w: 6, h: 30, props: { rows: '{{ [{ when: "Today", what: "Order shipped" }, { when: "Yesterday", what: "Order packed" }] }}', time: '{{ item.when }}', title: '{{ item.what }}', text: '' },
    fields: [f('rows', 'Rows'), f('time', 'When', 'text', { hint: '{{ item.date }}' }), f('title', 'What', 'text', { hint: '{{ item.title }}' }), f('text', 'More (optional)')] },
  stepper: { label: 'Steps', w: 12, h: 9, props: { stages: 'Ordered, Packed, Shipped, Delivered', current: '{{ 2 }}' },
    fields: [f('stages', 'Steps', 'text', { hint: 'A, B, C' }), f('current', 'How many are done', 'text', { hint: '{{ 2 }}' })] },
  countdown: { label: 'Countdown', w: 6, h: 12, props: { label: 'Launch in', to: '2026-12-31T00:00', done: 'We’re live!' },
    fields: [f('label', 'Label'), f('to', 'Until', 'text', { hint: '2026-12-31T09:00  or  {{ data.event[0].starts }}' }), f('done', 'When it’s over')] },
  qr: { label: 'QR code', w: 3, h: 22, props: { text: 'https://example.com', caption: 'Scan me' },
    fields: [f('text', 'What it holds (link or text)'), f('caption', 'Caption')] },

  /* ---- more for lists of data ---- */
  items: { label: 'Simple list', w: 4, h: 24, props: { title: '', rows: '{{ data.items }}', text: '{{ item.name }}', note: '', steps: [] }, events: 'steps', holds: 'the clicked item (also item)',
    fields: [f('title', 'Title'), f('rows', 'Rows'), f('text', 'Each line', 'text', { hint: '{{ item.name }}' }), f('note', 'On the right', 'text', { hint: '{{ item.total }}' })] },
  kanban: { label: 'Kanban board', w: 12, h: 40, props: { rows: '{{ data.items }}', group: 'status', columns: 'To do, Doing, Done', title: '{{ item.title || item.name }}', subtitle: '', steps: [] }, events: 'steps', holds: 'the clicked card (also item)',
    fields: [f('rows', 'Rows'), f('group', 'Column field', 'text', { hint: 'status' }), f('columns', 'Columns (blank: from the data)'), f('title', 'Card title'), f('subtitle', 'Card text')] },
  calendar: { label: 'Calendar', w: 12, h: 52, props: { rows: '{{ data.items }}', date: 'date', title: '{{ item.title || item.name }}', steps: [] }, events: 'steps', holds: 'the clicked event, or day (also item)',
    fields: [f('rows', 'Events'), f('date', 'Date field', 'text', { hint: 'date (YYYY-MM-DD…)' }), f('title', 'Event title')] },
  accordion: { label: 'Accordion (FAQ)', w: 8, h: 26, props: { items: 'What is this? | An app built with Workline.\nIs it free? | Yes.\nHow do I start? | Press the button above.', rows: '' },
    fields: [f('items', 'Question | answer, one a line', 'textarea'), f('rows', 'Or from data', 'text', { hint: '{{ data.faq.map(r => [r.q, r.a]) }}' })] },
  tabs: { label: 'Tabs', w: 8, h: 24, props: { tabs: 'Overview | What it is and **why**.\nDetails | More to read.\nPricing | {{ "$" + 49 }} a month.' },
    fields: [f('tabs', 'Tab | text, one a line', 'textarea')] },

  /* ---- more media ---- */
  audio: { label: 'Audio', w: 6, h: 8, props: { src: 'https://commondatastorage.googleapis.com/codeskulptor-demos/DDR_assets/Kangaroo_MusiQue_-_The_Neverwritten_Role_Playing_Game.mp3', title: 'Listen' },
    fields: [f('title', 'Title'), f('src', 'Audio URL (MP3, OGG…)')] },
  carousel: { label: 'Slideshow', w: 8, h: 34, props: { images: 'https://picsum.photos/seed/a/900/500\nhttps://picsum.photos/seed/b/900/500\nhttps://picsum.photos/seed/c/900/500', every: 4 },
    fields: [f('images', 'Images, one a line (or {{ list }})', 'textarea'), f('every', 'Seconds each (0: by hand)', 'number')] },
  embed: { label: 'Embed', w: 8, h: 40, props: { url: 'https://www.youtube.com/watch?v=aqz-KE-bpKQ', title: 'Embedded page' },
    fields: [f('url', 'Address (YouTube, Google Maps/Docs, Figma, any page)'), f('title', 'Description')] },
  map: { label: 'Map', w: 6, h: 34, props: { lat: '28.6139', lon: '77.2090', zoom: 12 },
    fields: [f('lat', 'Latitude', 'text', { hint: '{{ vars.table1.lat }}' }), f('lon', 'Longitude'), f('zoom', 'Zoom (1–18)', 'number')] },

  /* ---- layout ---- */
  box: { label: 'Panel', w: 6, h: 30, props: { title: '', tint: '' }, behind: true,
    fields: [f('title', 'Title'), f('tint', 'Background', 'color')] },
  spacer: { label: 'Spacer', w: 12, h: 4, props: {}, fields: [] },
};

// Where each sits in the palette.
export const GROUPS = [
  ['Basics', ['hero', 'heading', 'text', 'button', 'link', 'image', 'divider']],
  ['Inputs', ['input', 'search', 'select', 'radio', 'checkbox', 'switch', 'multiselect', 'slider', 'rating', 'date', 'color', 'file', 'form']],
  ['Data', ['table', 'chart', 'stat', 'list', 'items', 'kanban', 'calendar', 'details', 'json', 'timeline']],
  ['Status', ['badge', 'alert', 'progress', 'gauge', 'stepper', 'countdown', 'avatar']],
  ['Media', ['video', 'audio', 'carousel', 'embed', 'map', 'qr']],
  ['Layout', ['box', 'spacer', 'accordion', 'tabs', 'code', 'html']],
  ['Chat', ['thread', 'chat']],
];
const EVENT_LABEL = { hero: 'When its button is clicked', button: 'When it’s clicked', form: 'When it’s sent', table: 'When a row is clicked', list: 'When a card is clicked', items: 'When an item is clicked', kanban: 'When a card is clicked', calendar: 'When an event or day is clicked', search: 'When Enter is pressed', input: 'When Enter is pressed' };
export const eventLabel = type => EVENT_LABEL[type] || 'When it changes';
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
  midnight: { primary: '#a78bfa', bg: '#0b0b14', surface: '#151527', text: '#ecebff', dark: true },
  forest: { primary: '#15803d', bg: '#f3f7f2', surface: '#ffffff', text: '#14261a', dark: false },
  rose: { primary: '#e11d48', bg: '#fff5f7', surface: '#ffffff', text: '#3b0a17', dark: false },
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
.wl-in.card{background:var(--sf);border:1px solid var(--ln);padding:12px 14px;box-shadow:0 1px 2px rgba(0,0,0,.04)}
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
.wl-stat b{display:block;font-size:28px;line-height:1.15;font-weight:700;color:var(--tx);letter-spacing:-.01em}
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
.wl-c{z-index:1}.wl-c.behind{z-index:0}
.wl-thread{display:flex;flex-direction:column;gap:4px;padding:6px 4px}
.wl-tm{max-width:78%;align-self:flex-start;display:grid;gap:1px;padding:7px 12px;border-radius:16px 16px 16px 4px;background:color-mix(in srgb,var(--tx) 7%,var(--sf));margin-top:2px}
.wl-tm b{font-size:12px;color:var(--p)}.wl-tm span{white-space:pre-wrap;overflow-wrap:anywhere}
.wl-tm small{font-size:11px;opacity:.6;justify-self:end}
.wl-tm.mine{align-self:flex-end;background:var(--p);color:#fff;border-radius:16px 16px 4px 16px}
.wl-in{padding-left:2px;padding-right:2px}
.wl-c.inpanel .wl-in{padding-left:14px;padding-right:14px}
.lw-chart text{fill:var(--mt)}.lw-chart text.v{fill:var(--tx)}
.lw-pie li{color:var(--tx)}
.wl-in.flush{padding:0;border:0;overflow:hidden}
.wl-hero{height:100%;min-height:180px;border-radius:var(--r);padding:clamp(20px,4vw,48px);display:flex;flex-direction:column;justify-content:center;align-items:flex-start;gap:10px;color:#fff;background-size:cover;background-position:center;box-sizing:border-box}
.wl-hero.grad{background:radial-gradient(1200px 400px at 0% 0%,color-mix(in srgb,var(--p) 55%,#fff) 0%,transparent 55%),linear-gradient(135deg,var(--p),color-mix(in srgb,var(--p) 45%,#000))}
.wl-hero.center{align-items:center;text-align:center}
.wl-hero h1{margin:0;font-size:clamp(26px,4vw,46px);line-height:1.08;letter-spacing:-.02em;max-width:22ch}
.wl-hero p{margin:0;font-size:clamp(15px,1.6vw,19px);opacity:.92;max-width:52ch}
.wl-kicker{font-size:12px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;background:rgba(255,255,255,.18);padding:4px 10px;border-radius:999px;backdrop-filter:blur(4px)}
.wl-btn.hero-b{width:auto;background:#fff;color:#111;border-color:#fff;margin-top:6px;padding:11px 22px}
.wl-panel{background:var(--sf);border:1px solid var(--ln);padding:14px}
.wl-check{display:flex;align-items:center;gap:10px;font-size:15px;cursor:pointer;min-height:36px}
.wl-check input{width:18px;height:18px;accent-color:var(--p)}
.wl-check.sw input{position:absolute;opacity:0;width:1px;height:1px}
.wl-check.sw i{width:42px;height:24px;border-radius:999px;background:var(--ln);position:relative;flex:none;transition:background .2s}
.wl-check.sw i::after{content:"";position:absolute;top:3px;left:3px;width:18px;height:18px;border-radius:50%;background:#fff;box-shadow:0 1px 2px rgba(0,0,0,.3);transition:left .2s}
.wl-check.sw input:checked+i{background:var(--p)}.wl-check.sw input:checked+i::after{left:21px}
.wl-check.sw input:focus-visible+i{outline:2px solid var(--p);outline-offset:2px}
.wl-radio{border:0;margin:0;padding:0;display:grid;gap:6px}.wl-radio.inline{display:flex;flex-wrap:wrap;gap:6px 16px}
.wl-radio legend{font-size:13px;color:var(--mt);font-weight:600;margin-bottom:4px;padding:0}
.wl-radio label{display:flex;gap:8px;align-items:center;cursor:pointer}.wl-radio input{accent-color:var(--p);width:17px;height:17px}
.wl-chips{display:flex;flex-wrap:wrap;gap:6px}
.wl-chip{font:inherit;font-size:14px;padding:5px 12px;border-radius:999px;border:1px solid var(--ln);background:var(--sf);color:var(--tx);cursor:pointer}
.wl-chip.on{background:var(--p);border-color:var(--p);color:#fff}
.wl-sl{display:flex;justify-content:space-between;gap:8px}.wl-sl b{color:var(--tx)}
.wl-f input[type=range]{padding:0;border:0;accent-color:var(--p);background:none}
.wl-f input[type=color]{padding:2px;height:42px}
.wl-stars{display:flex;gap:2px}.wl-stars button{font-size:28px;line-height:1;border:0;background:none;color:var(--ln);cursor:pointer;padding:0 2px}
.wl-stars button.on{color:#f5a524}
.wl-searchbox input{padding-left:36px;background:var(--sf) url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' fill='none' stroke='%23888' stroke-width='2'%3E%3Ccircle cx='7' cy='7' r='5'/%3E%3Cpath d='m11 11 4 4'/%3E%3C/svg%3E") 12px center no-repeat}
.wl-file{display:grid;place-items:center;text-align:center;gap:4px;height:100%;min-height:80px;border:2px dashed var(--ln);border-radius:var(--r);cursor:pointer;padding:12px;position:relative}
.wl-file:hover{border-color:var(--p)}.wl-file span{color:var(--mt);font-size:13px}
.wl-file input{position:absolute;inset:0;opacity:0;cursor:pointer}
.wl-chat{display:flex;flex-direction:column;height:100%;min-height:240px}
.wl-chatlog{flex:1;overflow:auto;display:flex;flex-direction:column;gap:8px;padding:4px 2px 10px}
.wl-msg{max-width:85%;padding:8px 12px;border-radius:14px;white-space:pre-wrap;font-size:14px;line-height:1.45}
.wl-msg.bot{align-self:flex-start;background:color-mix(in srgb,var(--tx) 7%,var(--sf))}
.wl-msg.you{align-self:flex-end;background:var(--p);color:#fff}
.wl-msg.err{color:#d1242f}.wl-msg.wait{opacity:.6}
.wl-chatin{display:flex;gap:6px}.wl-chatin input{flex:1;font:inherit;padding:9px 12px;border:1px solid var(--ln);border-radius:999px;background:var(--sf);color:var(--tx)}
.wl-chatin .wl-btn{width:auto;border-radius:999px}
.wl-badge{display:inline-block;padding:2px 10px;border-radius:999px;font-size:13px;font-weight:600;line-height:1.4}
.wl-badge.blue{background:#dbeafe;color:#1e40af}.wl-badge.green{background:#dcfce7;color:#166534}.wl-badge.amber{background:#fef3c7;color:#92400e}
.wl-badge.red{background:#fee2e2;color:#991b1b}.wl-badge.gray{background:#e5e7eb;color:#374151}.wl-badge.purple{background:#ede9fe;color:#5b21b6}
.wl-alert{border-radius:var(--r);padding:12px 14px;border:1px solid;display:grid;gap:2px}
.wl-alert p{margin:0}
.wl-alert.info{background:#eff6ff;border-color:#bfdbfe;color:#1e3a8a}.wl-alert.success{background:#f0fdf4;border-color:#bbf7d0;color:#14532d}
.wl-alert.warning{background:#fffbeb;border-color:#fde68a;color:#78350f}.wl-alert.error{background:#fef2f2;border-color:#fecaca;color:#7f1d1d}
.wl-prog{display:grid;gap:6px;font-size:13px;color:var(--mt);font-weight:600}
.wl-bar{height:10px;border-radius:999px;background:var(--ln);overflow:hidden}.wl-bar i{display:block;height:100%;background:var(--p);border-radius:inherit;transition:width .4s}
.wl-gauge{display:grid;justify-items:center;text-align:center;height:100%;align-content:center}
.wl-gauge svg{width:100%;max-width:220px}.wl-gauge path{fill:none;stroke-width:12;stroke-linecap:round}
.wl-gauge .bg{stroke:var(--ln)}.wl-gauge .fg{stroke:var(--p)}
.wl-gauge b{font-size:24px;margin-top:-18px}.wl-gauge span{color:var(--mt);font-size:13px}
.wl-avatar{display:flex;align-items:center;gap:12px}
.wl-avatar img,.wl-avatar>i{width:48px;height:48px;border-radius:50%;object-fit:cover;flex:none}
.wl-avatar>i{display:grid;place-items:center;background:var(--p);color:#fff;font-style:normal;font-weight:700}
.wl-avatar b{display:block}.wl-avatar span{color:var(--mt);font-size:13px}
.wl-link{font-weight:600}
.wl-code{margin:0;padding:12px;border-radius:calc(var(--r) * .75);background:#0f172a;color:#e2e8f0;font:12.5px/1.5 ui-monospace,Menlo,monospace;overflow:auto;white-space:pre}
.wl-dl{display:grid;grid-template-columns:minmax(90px,max-content) 1fr;gap:6px 14px;margin:0}
.wl-dl dt{color:var(--mt);font-size:13px;text-transform:capitalize}.wl-dl dd{margin:0;overflow-wrap:anywhere}
.wl-tl{list-style:none;margin:0;padding:0 0 0 18px;border-left:2px solid var(--ln)}
.wl-tl li{position:relative;padding:0 0 16px 10px;display:grid}.wl-tl li::before{content:"";position:absolute;left:-25px;top:4px;width:10px;height:10px;border-radius:50%;background:var(--p);border:2px solid var(--sf)}
.wl-tl small{color:var(--mt)}.wl-tl span{color:var(--mt);font-size:14px}
.wl-stepper{list-style:none;margin:0;padding:0;display:flex;gap:4px}
.wl-stepper li{flex:1;display:flex;flex-direction:column;align-items:center;gap:6px;text-align:center;font-size:13px;color:var(--mt);position:relative}
.wl-stepper li::before{content:"";position:absolute;top:15px;left:-50%;right:50%;height:2px;background:var(--ln);z-index:-1}
.wl-stepper li:first-child::before{display:none}.wl-stepper li.done::before,.wl-stepper li.now::before{background:var(--p)}
.wl-stepper i{width:30px;height:30px;border-radius:50%;display:grid;place-items:center;font-style:normal;font-weight:700;background:var(--sf);border:2px solid var(--ln)}
.wl-stepper li.done i{background:var(--p);border-color:var(--p);color:#fff}.wl-stepper li.now i{border-color:var(--p);color:var(--p)}.wl-stepper li.now{color:var(--tx);font-weight:600}
.wl-count{display:grid;gap:2px}.wl-count span{color:var(--mt);font-size:13px;font-weight:600}.wl-count b{font-size:32px;font-variant-numeric:tabular-nums}
.wl-qr{display:block;width:100%;max-width:240px;aspect-ratio:1;margin:0 auto;border-radius:8px;background:#fff}
.wl-note.center{text-align:center}
.wl-items{list-style:none;margin:0;padding:0}
.wl-items li{display:flex;justify-content:space-between;gap:10px;padding:9px 4px;border-bottom:1px solid var(--ln)}
.wl-items li.click{cursor:pointer}.wl-items li.click:hover,.wl-items li.on{background:color-mix(in srgb,var(--p) 8%,transparent)}
.wl-kanban{display:grid;grid-auto-flow:column;grid-auto-columns:minmax(200px,1fr);gap:12px;height:100%;overflow-x:auto}
.wl-lane{background:color-mix(in srgb,var(--tx) 5%,transparent);border-radius:var(--r);padding:10px;display:flex;flex-direction:column;gap:8px;overflow:auto}
.wl-lane-h{display:flex;justify-content:space-between;font-size:14px}.wl-lane-h span{color:var(--mt)}
.wl-card.kb div{padding:10px 12px}
.wl-cal-h{display:flex;align-items:center;justify-content:space-between;margin-bottom:8px}
.wl-cal-nav{font:inherit;font-size:20px;border:1px solid var(--ln);background:var(--sf);color:var(--tx);border-radius:8px;width:34px;height:32px;cursor:pointer}
.wl-cal{display:grid;grid-template-columns:repeat(7,1fr);gap:4px}
.wl-cal-wd{font-size:12px;color:var(--mt);text-align:center;font-weight:600}
.wl-cal-d{min-height:64px;border:1px solid var(--ln);border-radius:8px;padding:4px;background:var(--sf);cursor:pointer;overflow:hidden;display:flex;flex-direction:column;gap:2px}
.wl-cal-d.off{background:none;border-color:transparent;cursor:default}.wl-cal-d.today{border-color:var(--p)}
.wl-cal-d small{color:var(--mt);font-size:12px}
.wl-cal-ev{font-size:11.5px;background:color-mix(in srgb,var(--p) 15%,transparent);color:var(--tx);border-radius:5px;padding:1px 5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.wl-acc{border:1px solid var(--ln);border-radius:calc(var(--r) * .75);background:var(--sf);margin-bottom:6px}
.wl-acc summary{padding:11px 14px;cursor:pointer;font-weight:600}.wl-acc>div{padding:0 14px 10px}.wl-acc p{margin:0 0 6px}
.wl-tabs{display:flex;gap:2px;border-bottom:1px solid var(--ln);margin-bottom:10px;overflow-x:auto}
.wl-tabs button{font:inherit;border:0;background:none;padding:8px 14px;color:var(--mt);cursor:pointer;border-bottom:2px solid transparent;white-space:nowrap}
.wl-tabs button.on{color:var(--p);border-bottom-color:var(--p);font-weight:600}
.wl-audio{width:100%}
.wl-car{position:relative;height:100%;min-height:160px;border-radius:var(--r);overflow:hidden;background:#000}
.wl-car img{width:100%;height:100%;object-fit:cover;display:block}
.wl-car-b{position:absolute;top:50%;transform:translateY(-50%);width:36px;height:36px;border-radius:50%;border:0;background:rgba(255,255,255,.85);font-size:22px;cursor:pointer;color:#111}
.wl-car-b.l{left:10px}.wl-car-b.r{right:10px}
.wl-dots{position:absolute;bottom:10px;left:0;right:0;display:flex;justify-content:center;gap:6px}
.wl-dots button{width:9px;height:9px;border-radius:50%;border:0;background:rgba(255,255,255,.55);padding:0;cursor:pointer}.wl-dots button.on{background:#fff}
.wl-embed{width:100%;height:100%;min-height:200px;border:0;border-radius:var(--r);display:block;background:var(--ln)}
.wl-design .wl-main{max-width:none;padding:12px 0 40px}
.wl-design .wl-c *{pointer-events:none}
.wl-design body{overflow:hidden}
`;

/* The app itself, run in the page (its source is copied there, so it uses nothing from this module). */
function runtime(SPEC, OPT) {
  const ROW = 8, FIXED = { thread: 1, hero: 1, table: 1, chart: 1, image: 1, video: 1, html: 1, list: 1, chat: 1, kanban: 1, calendar: 1, embed: 1, map: 1, carousel: 1, json: 1, items: 1, box: 1, spacer: 1, gauge: 1, qr: 1 };
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

  // Options from "A, B, C" or a list ({{ data.x.map(…) }}): [{label, value}].
  const options = v => {
    const o = val(v), list = Array.isArray(o) ? o : String(o || '').split(',').map(x => x.trim()).filter(Boolean);
    return list.map(x => (x && typeof x === 'object' ? { label: fmt(x.label ?? x.name ?? x.value), value: fmt(x.value ?? x.label ?? x.name) } : { label: fmt(x), value: fmt(x) }));
  };

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
  let loaded = '', timers = [];
  function loadAuto() {
    const key = JSON.stringify([(S.spec.data || []).filter(s => s.auto || +s.every > 0), S.page && S.page.id, !!S.user]);
    if (key === loaded) return;
    loaded = key;
    for (const s of S.spec.data || []) if (s.auto && s.name) load(s);
    // Sources that refresh by themselves (a chat, a live dashboard), quietly: no "Loading…" in between.
    timers.forEach(clearInterval);
    timers = (S.spec.data || []).filter(s => s.name && +s.every > 0).map(s => setInterval(() => { if (!document.hidden && !S.loading[s.name]) load(s); }, Math.max(2, +s.every) * 1000));
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
        i.oninput = set; i.onchange = () => { set(); if (c.type === 'select') steps(p.steps, S.vars[c.name]); };
        if (c.type === 'input' && p.kind !== 'long') i.onkeydown = e => { if (e.key === 'Enter' && p.steps && p.steps.length) { e.preventDefault(); set(); steps(p.steps, S.vars[c.name]); } };
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
        if (!rows.length || !keys.length) return note('wl-note', q ? 'Nothing matches.' : 'Nothing to show yet.');
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
      case 'hero': {
        const h = el('section', 'wl-hero ' + (p.align === 'center' ? 'center' : ''));
        const img = safeUrl(txt(p.image));
        if (img) h.style.backgroundImage = 'linear-gradient(90deg, rgba(0,0,0,.62), rgba(0,0,0,.18)), url("' + img.replace(/"/g, '%22') + '")';
        else h.classList.add('grad');
        if (p.kicker) h.appendChild(el('span', 'wl-kicker', txt(p.kicker)));
        h.appendChild(el('h1', '', txt(p.title)));
        if (p.subtitle) h.appendChild(el('p', '', txt(p.subtitle)));
        if (p.button) { const b = el('button', 'wl-btn hero-b', txt(p.button)); b.onclick = () => steps(p.steps); h.appendChild(b); }
        box.appendChild(h); box.classList.add('flush'); break;
      }

      /* ---- inputs that hold a value, and run their steps when it changes ---- */
      case 'checkbox': case 'switch': {
        if (!(c.name in S.vars)) S.vars[c.name] = !!val(p.value);
        const l = el('label', 'wl-check' + (c.type === 'switch' ? ' sw' : ''));
        const i = el('input'); i.type = 'checkbox'; i.checked = !!S.vars[c.name]; i.dataset.name = c.name;
        i.onchange = () => { S.vars[c.name] = i.checked; paint(c.id); steps(p.steps, i.checked); };
        l.appendChild(i); if (c.type === 'switch') l.appendChild(el('i')); l.appendChild(el('span', '', txt(p.label)));
        box.appendChild(l); break;
      }
      case 'radio': {
        const opts = options(p.options);
        if (!(c.name in S.vars)) S.vars[c.name] = txt(p.value) || (opts[0] && opts[0].value) || '';
        const fs = el('fieldset', 'wl-radio' + (p.inline ? ' inline' : ''));
        fs.appendChild(el('legend', '', txt(p.label)));
        for (const o of opts) {
          const l = el('label'), i = el('input'); i.type = 'radio'; i.name = c.id; i.value = o.value; i.checked = String(S.vars[c.name]) === o.value;
          i.onchange = () => { S.vars[c.name] = o.value; paint(c.id); steps(p.steps, o.value); };
          l.appendChild(i); l.appendChild(el('span', '', o.label)); fs.appendChild(l);
        }
        box.appendChild(fs); break;
      }
      case 'multiselect': {
        const opts = options(p.options);
        if (!Array.isArray(S.vars[c.name])) S.vars[c.name] = String(txt(p.value) || '').split(',').map(x => x.trim()).filter(Boolean);
        const l = el('div', 'wl-f'); l.appendChild(el('span', '', txt(p.label)));
        const chips = el('div', 'wl-chips');
        for (const o of opts) {
          const on = S.vars[c.name].includes(o.value), b = el('button', 'wl-chip' + (on ? ' on' : ''), o.label);
          b.type = 'button'; b.setAttribute('aria-pressed', on);
          b.onclick = () => { const cur = S.vars[c.name]; S.vars[c.name] = cur.includes(o.value) ? cur.filter(x => x !== o.value) : [...cur, o.value]; paint(); steps(p.steps, S.vars[c.name]); };
          chips.appendChild(b);
        }
        l.appendChild(chips); box.appendChild(l); break;
      }
      case 'slider': {
        if (!(c.name in S.vars)) S.vars[c.name] = +val(p.value) || 0;
        const l = el('label', 'wl-f'), head = el('span', 'wl-sl'), out = el('b', '', fmt(S.vars[c.name]) + (p.unit || ''));
        head.appendChild(el('span', '', txt(p.label))); head.appendChild(out); l.appendChild(head);
        const i = el('input'); i.type = 'range'; i.min = +p.min || 0; i.max = p.max === '' || p.max == null ? 100 : +p.max; i.step = +p.step || 1; i.value = S.vars[c.name]; i.dataset.name = c.name;
        i.oninput = () => { S.vars[c.name] = +i.value; out.textContent = fmt(+i.value) + (p.unit || ''); paint(c.id); };
        i.onchange = () => steps(p.steps, +i.value);
        l.appendChild(i); box.appendChild(l); break;
      }
      case 'rating': {
        if (!(c.name in S.vars)) S.vars[c.name] = +val(p.value) || 0;
        const l = el('div', 'wl-f'); l.appendChild(el('span', '', txt(p.label)));
        const stars = el('div', 'wl-stars');
        for (let n = 1; n <= Math.min(10, +p.max || 5); n++) {
          const b = el('button', n <= S.vars[c.name] ? 'on' : '', '★'); b.type = 'button'; b.setAttribute('aria-label', n + ' star' + (n > 1 ? 's' : ''));
          b.onclick = () => { S.vars[c.name] = S.vars[c.name] === n ? 0 : n; paint(); steps(p.steps, S.vars[c.name]); };
          stars.appendChild(b);
        }
        l.appendChild(stars); box.appendChild(l); break;
      }
      case 'date': case 'color': case 'search': {
        if (!(c.name in S.vars)) S.vars[c.name] = txt(p.value);
        const l = el('label', 'wl-f' + (c.type === 'search' ? ' wl-searchbox' : ''));
        if (c.type !== 'search') l.appendChild(el('span', '', txt(p.label)));
        const i = el('input'); i.type = c.type === 'date' ? (p.kind || 'date') : c.type; i.value = S.vars[c.name] || ''; i.dataset.name = c.name;
        if (c.type === 'search') { i.placeholder = txt(p.placeholder); i.setAttribute('aria-label', txt(p.placeholder) || 'Search'); }
        i.oninput = () => { S.vars[c.name] = i.value; paint(c.id); };
        if (c.type === 'search') i.onkeydown = e => { if (e.key === 'Enter') steps(p.steps, i.value); };
        else i.onchange = () => steps(p.steps, i.value);
        l.appendChild(i); box.appendChild(l); break;
      }
      case 'file': {
        const l = el('label', 'wl-file');
        const i = el('input'); i.type = 'file'; if (p.accept) i.accept = p.accept;
        const got = S.vars[c.name];
        l.appendChild(el('b', '', txt(p.label)));
        l.appendChild(el('span', '', got ? got.name + ' · ' + Math.ceil(got.size / 1024) + ' KB' : 'Choose a file, or drop it here'));
        i.onchange = () => {
          const fl = i.files && i.files[0]; if (!fl) return;
          if (fl.size > 5 * 1024 * 1024) { toast('That file is over 5 MB.'); return; }
          const r = new FileReader();
          r.onload = () => { S.vars[c.name] = { name: fl.name, type: fl.type, size: fl.size, content: r.result }; paint(); steps(p.steps, S.vars[c.name]); };
          if (p.read === 'text') r.readAsText(fl); else r.readAsDataURL(fl);
        };
        l.appendChild(i); box.appendChild(l); break;
      }
      case 'chat': {
        if (!Array.isArray(S.vars[c.name])) S.vars[c.name] = p.greeting ? [{ from: 'bot', text: txt(p.greeting) }] : [];
        const wrap = el('div', 'wl-chat');
        if (p.title) wrap.appendChild(el('div', 'wl-title', txt(p.title)));
        const log = el('div', 'wl-chatlog');
        for (const m of S.vars[c.name]) log.appendChild(el('div', 'wl-msg ' + m.from, m.text));
        if (S.loading[c.id]) log.appendChild(el('div', 'wl-msg bot wait', '…'));
        wrap.appendChild(log);
        const fm = el('form', 'wl-chatin'), i = el('input'); i.placeholder = txt(p.placeholder) || 'Type a message…'; i.dataset.name = c.name + 'Draft'; i.value = S.vars[c.name + 'Draft'] || '';
        i.setAttribute('aria-label', 'Message'); i.oninput = () => { S.vars[c.name + 'Draft'] = i.value; };
        const b = el('button', 'wl-btn', 'Send'); b.disabled = !!S.loading[c.id];
        fm.appendChild(i); fm.appendChild(b);
        fm.onsubmit = async e => {
          e.preventDefault();
          const msg = i.value.trim(); if (!msg || S.loading[c.id]) return;
          const history = S.vars[c.name].slice(-12);
          S.vars[c.name] = [...S.vars[c.name], { from: 'you', text: msg }]; S.vars[c.name + 'Draft'] = ''; S.loading[c.id] = true; paint();
          try {
            const out = await workline.run(p.workflow || undefined, { message: msg, history });
            const r = out && out[0], ans = r == null ? '' : typeof r !== 'object' ? r : r[p.field || 'reply'] ?? r.reply ?? r.text ?? r.answer ?? r.output ?? JSON.stringify(r);
            S.vars[c.name] = [...S.vars[c.name], { from: 'bot', text: fmt(ans) || '(no answer)' }];
          } catch (err) { S.vars[c.name] = [...S.vars[c.name], { from: 'bot err', text: err.message || String(err) }]; }
          S.loading[c.id] = false; paint();
        };
        wrap.appendChild(fm); box.appendChild(wrap);
        box._draw = () => { log.scrollTop = log.scrollHeight; };
        break;
      }

      case 'thread': {
        if (failed.length) return note('wl-err', failed[0]);
        const rows = rowsOf();
        if (!rows.length) return note('wl-note center', waiting ? 'Loading…' : txt(p.empty));
        const log = el('div', 'wl-thread'); log.setAttribute('role', 'log');
        let last = null;
        for (const r of rows.slice(-300)) {
          const mine = !!val(p.mine, r), who = txt(p.from, r);
          const m = el('div', 'wl-tm' + (mine ? ' mine' : ''));
          if (!mine && who !== last) m.appendChild(el('b', '', who));
          m.appendChild(el('span', '', txt(p.text, r)));
          const t = txt(p.time, r); if (t) m.appendChild(el('small', '', t));
          log.appendChild(m); last = mine ? null : who;
        }
        box.appendChild(log);
        box._draw = () => { if (box.dataset.n !== String(rows.length)) box.scrollTop = box.scrollHeight; box.dataset.n = rows.length; };
        break;
      }

      /* ---- things to show ---- */
      case 'badge': box.appendChild(el('span', 'wl-badge ' + (p.tone || 'blue'), txt(p.text))); break;
      case 'alert': {
        const a = el('div', 'wl-alert ' + (p.tone || 'info')); a.setAttribute('role', p.tone === 'error' ? 'alert' : 'status');
        if (p.title) a.appendChild(el('b', '', txt(p.title)));
        const t = el('div'); t.innerHTML = md(txt(p.text)); a.appendChild(t);
        box.appendChild(a); break;
      }
      case 'progress': {
        const v = +val(p.value) || 0, max = +p.max || 100, pct = Math.max(0, Math.min(100, v / max * 100));
        const d = el('div', 'wl-prog'), head = el('div', 'wl-sl'); head.appendChild(el('span', '', txt(p.label))); head.appendChild(el('b', '', Math.round(pct) + '%'));
        const bar = el('div', 'wl-bar'), fill = el('i'); fill.style.width = pct + '%'; bar.appendChild(fill);
        bar.setAttribute('role', 'progressbar'); bar.setAttribute('aria-valuenow', Math.round(pct)); bar.setAttribute('aria-valuemin', 0); bar.setAttribute('aria-valuemax', 100);
        d.appendChild(head); d.appendChild(bar); box.appendChild(d); break;
      }
      case 'gauge': {
        const v = +val(p.value) || 0, max = +p.max || 100, f = Math.max(0, Math.min(1, v / max));
        const a = Math.PI * (1 - f), x = 60 + 50 * Math.cos(a), y = 60 - 50 * Math.sin(a);
        const g = el('div', 'wl-gauge');
        g.innerHTML = '<svg viewBox="0 0 120 70" aria-hidden="true"><path d="M10 60 A50 50 0 0 1 110 60" class="bg"/>' + (f > 0 ? '<path d="M10 60 A50 50 0 0 1 ' + x.toFixed(2) + ' ' + y.toFixed(2) + '" class="fg"/>' : '') + '</svg>';
        g.appendChild(el('b', '', fmt(v) + (p.unit || ''))); g.appendChild(el('span', '', txt(p.label)));
        box.appendChild(g); break;
      }
      case 'avatar': {
        const a = el('div', 'wl-avatar'), img = safeUrl(txt(p.image)), name = txt(p.name);
        if (img) { const i = el('img'); i.src = img; i.alt = ''; a.appendChild(i); }
        else a.appendChild(el('i', '', name.split(/\s+/).map(w => w[0] || '').join('').slice(0, 2).toUpperCase()));
        const t = el('div'); t.appendChild(el('b', '', name)); if (p.subtitle) t.appendChild(el('span', '', txt(p.subtitle)));
        a.appendChild(t); box.appendChild(a); break;
      }
      case 'link': {
        const u = safeUrl(txt(p.url)), a = el('a', 'wl-link', txt(p.text) || u);
        if (u) a.href = u; if (p.newTab) { a.target = '_blank'; a.rel = 'noopener'; }
        box.appendChild(a); break;
      }
      case 'code': case 'json': {
        if (p.title) box.appendChild(el('div', 'wl-title', txt(p.title)));
        if (c.type === 'json' && failed.length) return note('wl-err', failed[0]);
        if (c.type === 'json' && waiting) return note('wl-note', 'Loading…');
        const v = c.type === 'json' ? val(p.value) : txt(p.code);
        box.appendChild(el('pre', 'wl-code', c.type === 'json' ? (v === undefined ? '(nothing)' : JSON.stringify(v, null, 2)) : v));
        break;
      }
      case 'details': {
        if (p.title) box.appendChild(el('div', 'wl-title', txt(p.title)));
        if (failed.length) return note('wl-err', failed[0]);
        const r = val(p.value);
        if (!r || typeof r !== 'object') return note('wl-note', waiting ? 'Loading…' : 'Nothing picked yet.');
        const keys = String(txt(p.fields) || '').split(',').map(x => x.trim()).filter(Boolean);
        const dl = el('dl', 'wl-dl');
        for (const k of keys.length ? keys : Object.keys(r).slice(0, 40)) { dl.appendChild(el('dt', '', k)); dl.appendChild(el('dd', '', fmt(r[k]))); }
        box.appendChild(dl); break;
      }
      case 'timeline': {
        if (failed.length) return note('wl-err', failed[0]);
        const rows = rowsOf(); if (!rows.length) return note('wl-note', waiting ? 'Loading…' : 'Nothing yet.');
        const ol = el('ol', 'wl-tl');
        for (const r of rows.slice(0, 200)) { const li = el('li'); li.appendChild(el('small', '', txt(p.time, r))); li.appendChild(el('b', '', txt(p.title, r))); if (p.text) li.appendChild(el('span', '', txt(p.text, r))); ol.appendChild(li); }
        box.appendChild(ol); break;
      }
      case 'stepper': {
        const st = String(txt(p.stages) || '').split(',').map(x => x.trim()).filter(Boolean), done = +val(p.current) || 0;
        const ol = el('ol', 'wl-stepper');
        st.forEach((name, i) => { const li = el('li', i < done ? 'done' : i === done ? 'now' : ''); li.appendChild(el('i', '', i < done ? '✓' : String(i + 1))); li.appendChild(el('span', '', name)); ol.appendChild(li); });
        box.appendChild(ol); break;
      }
      case 'countdown': {
        const d = el('div', 'wl-count'); d.appendChild(el('span', '', txt(p.label)));
        const out = el('b'); d.appendChild(out); box.appendChild(d);
        const to = new Date(txt(p.to)).getTime();
        const tick = () => {
          const ms = to - Date.now();
          if (isNaN(to)) { out.textContent = '—'; return false; }
          if (ms <= 0) { out.textContent = txt(p.done) || '0s'; return false; }
          const dd = Math.floor(ms / 864e5), hh = Math.floor(ms / 36e5) % 24, mm = Math.floor(ms / 6e4) % 60, ss = Math.floor(ms / 1e3) % 60;
          out.textContent = (dd ? dd + 'd ' : '') + String(hh).padStart(2, '0') + ':' + String(mm).padStart(2, '0') + ':' + String(ss).padStart(2, '0');
          return true;
        };
        if (tick()) { const t = setInterval(() => { if (!out.isConnected || !tick()) clearInterval(t); }, 1000); }
        break;
      }
      case 'qr': {
        const t = txt(p.text);
        const i = el('img', 'wl-qr'); i.alt = 'QR code' + (t ? ': ' + t : ''); i.src = 'https://api.qrserver.com/v1/create-qr-code/?size=300x300&margin=8&data=' + encodeURIComponent(t);
        box.appendChild(i); if (p.caption) box.appendChild(el('div', 'wl-note center', txt(p.caption)));
        break;
      }

      /* ---- lists of data ---- */
      case 'items': {
        if (p.title) box.appendChild(el('div', 'wl-title', txt(p.title)));
        if (failed.length) return note('wl-err', failed[0]);
        const rows = rowsOf(); if (!rows.length) return note('wl-note', waiting ? 'Loading…' : 'Nothing to show yet.');
        const ul = el('ul', 'wl-items');
        for (const r of rows.slice(0, 300)) {
          const li = el('li', (p.steps && p.steps.length ? 'click' : '') + (S.selected[c.id] === r ? ' on' : ''));
          li.appendChild(el('span', '', txt(p.text, r))); if (p.note) li.appendChild(el('b', '', txt(p.note, r)));
          li.onclick = () => { S.vars[c.name] = r; S.selected[c.id] = r; steps(p.steps, r); paint(); };
          ul.appendChild(li);
        }
        box.appendChild(ul); break;
      }
      case 'kanban': {
        if (failed.length) return note('wl-err', failed[0]);
        const rows = rowsOf(); if (waiting && !rows.length) return note('wl-note', 'Loading…');
        const key = p.group || 'status';
        let cols = String(txt(p.columns) || '').split(',').map(x => x.trim()).filter(Boolean);
        if (!cols.length) cols = [...new Set(rows.map(r => fmt(r && r[key])))];
        const board = el('div', 'wl-kanban');
        for (const col of cols) {
          const these = rows.filter(r => fmt(r && r[key]) === col), lane = el('div', 'wl-lane');
          const h = el('div', 'wl-lane-h'); h.appendChild(el('b', '', col)); h.appendChild(el('span', '', String(these.length))); lane.appendChild(h);
          for (const r of these.slice(0, 100)) {
            const card = el('div', 'wl-card kb' + (p.steps && p.steps.length ? ' click' : ''));
            const d = el('div'); d.appendChild(el('b', '', txt(p.title, r))); if (p.subtitle) d.appendChild(el('span', '', txt(p.subtitle, r)));
            card.appendChild(d); card.onclick = () => { S.vars[c.name] = r; steps(p.steps, r); };
            lane.appendChild(card);
          }
          board.appendChild(lane);
        }
        box.appendChild(board); break;
      }
      case 'calendar': {
        if (failed.length) return note('wl-err', failed[0]);
        const rows = rowsOf().filter(r => r && typeof r === 'object');
        const now = new Date(), m = S.vars[c.name + 'Month'] || (now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0'));
        const [yy, mo] = m.split('-').map(Number), first = new Date(yy, mo - 1, 1), days = new Date(yy, mo, 0).getDate();
        const head = el('div', 'wl-cal-h');
        const shift = n => { const d = new Date(yy, mo - 1 + n, 1); S.vars[c.name + 'Month'] = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'); paint(); };
        const prev = el('button', 'wl-cal-nav', '‹'), next = el('button', 'wl-cal-nav', '›');
        prev.setAttribute('aria-label', 'Previous month'); next.setAttribute('aria-label', 'Next month'); prev.onclick = () => shift(-1); next.onclick = () => shift(1);
        head.appendChild(prev); head.appendChild(el('b', '', first.toLocaleDateString(undefined, { month: 'long', year: 'numeric' }))); head.appendChild(next);
        box.appendChild(head);
        const grid = el('div', 'wl-cal');
        for (const wd of ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']) grid.appendChild(el('div', 'wl-cal-wd', wd));
        for (let i = 0; i < (first.getDay() + 6) % 7; i++) grid.appendChild(el('div', 'wl-cal-d off'));
        const today = now.toISOString().slice(0, 10);
        for (let d = 1; d <= days; d++) {
          const iso = yy + '-' + String(mo).padStart(2, '0') + '-' + String(d).padStart(2, '0');
          const cell = el('div', 'wl-cal-d' + (iso === today ? ' today' : ''));
          cell.appendChild(el('small', '', String(d)));
          cell.onclick = () => { S.vars[c.name] = { date: iso }; steps(p.steps, { date: iso }); };
          for (const r of rows.filter(r => String(r[p.date || 'date'] || '').slice(0, 10) === iso).slice(0, 4)) {
            const ev = el('div', 'wl-cal-ev', txt(p.title, r));
            ev.onclick = e => { e.stopPropagation(); S.vars[c.name] = r; steps(p.steps, r); };
            cell.appendChild(ev);
          }
          grid.appendChild(cell);
        }
        box.appendChild(grid); break;
      }
      case 'accordion': {
        let pairs = val(p.rows);
        if (!Array.isArray(pairs) || !pairs.length) pairs = String(p.items || '').split('\n').filter(l => l.trim()).map(l => l.split('|').map(x => x.trim()));
        for (const [q, a] of pairs) {
          const d = el('details', 'wl-acc'); d.appendChild(el('summary', '', fmt(val(q))));
          const t = el('div'); t.innerHTML = md(txt(a == null ? '' : String(a))); d.appendChild(t); box.appendChild(d);
        }
        break;
      }
      case 'tabs': {
        const tabs = String(p.tabs || '').split('\n').filter(l => l.trim()).map(l => { const i = l.indexOf('|'); return i < 0 ? [l.trim(), ''] : [l.slice(0, i).trim(), l.slice(i + 1).trim()]; });
        const at = Math.min(+S.vars[c.name + 'Tab'] || 0, Math.max(0, tabs.length - 1));
        const bar = el('div', 'wl-tabs'); bar.setAttribute('role', 'tablist');
        tabs.forEach(([name], i) => { const b = el('button', i === at ? 'on' : '', txt(name)); b.setAttribute('role', 'tab'); b.setAttribute('aria-selected', i === at); b.onclick = () => { S.vars[c.name + 'Tab'] = i; S.vars[c.name] = name; paint(); }; bar.appendChild(b); });
        box.appendChild(bar);
        const body = el('div', 'wl-t wl-tabbody'); body.setAttribute('role', 'tabpanel'); body.innerHTML = md(txt(tabs[at] ? tabs[at][1] : ''));
        box.appendChild(body); break;
      }

      /* ---- more media ---- */
      case 'audio': {
        if (p.title) box.appendChild(el('div', 'wl-title', txt(p.title)));
        const u = safeUrl(txt(p.src)); if (!u) return note('wl-note', 'No audio yet.');
        const a = el('audio', 'wl-audio'); a.controls = true; a.preload = 'metadata'; a.src = u; box.appendChild(a); break;
      }
      case 'carousel': {
        const v = val(p.images), imgs = (Array.isArray(v) ? v : String(v || '').split(/\n|,(?=\s*https?:)/)).map(x => safeUrl(fmt(x).trim())).filter(Boolean);
        if (!imgs.length) return note('wl-note', 'No images yet.');
        const at = (+S.vars[c.name] || 0) % imgs.length;
        const car = el('div', 'wl-car'), img = el('img'); img.src = imgs[at]; img.alt = 'Slide ' + (at + 1) + ' of ' + imgs.length; car.appendChild(img);
        const go = n => { S.vars[c.name] = (n + imgs.length) % imgs.length; paint(); };
        const prev = el('button', 'wl-car-b l', '‹'), next = el('button', 'wl-car-b r', '›');
        prev.setAttribute('aria-label', 'Previous'); next.setAttribute('aria-label', 'Next'); prev.onclick = () => go(at - 1); next.onclick = () => go(at + 1);
        car.appendChild(prev); car.appendChild(next);
        const dots = el('div', 'wl-dots'); imgs.forEach((_, i) => { const d = el('button', i === at ? 'on' : ''); d.setAttribute('aria-label', 'Slide ' + (i + 1)); d.onclick = () => go(i); dots.appendChild(d); });
        car.appendChild(dots); box.appendChild(car);
        if (+p.every > 0 && !OPT.design) { const t = setTimeout(() => { if (car.isConnected) go(at + 1); }, +p.every * 1000); car._t = t; }
        break;
      }
      case 'embed': case 'map': {
        let u;
        if (c.type === 'map') {
          const lat = +txt(p.lat), lon = +txt(p.lon), z = Math.max(1, Math.min(18, +p.zoom || 12)), d = 180 / Math.pow(2, z);
          if (isNaN(lat) || isNaN(lon)) return note('wl-note', 'No place yet.');
          u = 'https://www.openstreetmap.org/export/embed.html?bbox=' + [lon - d, lat - d / 2, lon + d, lat + d / 2].map(n => n.toFixed(5)).join(',') + '&layer=mapnik&marker=' + lat + ',' + lon;
        } else {
          u = safeUrl(txt(p.url));
          const yt = /(?:youtube\.com\/watch\?v=|youtu\.be\/)([\w-]{6,})/.exec(u || '');
          if (yt) u = 'https://www.youtube.com/embed/' + yt[1];
        }
        if (!u || !/^https:/.test(u)) return note('wl-note', 'Add an https:// address.');
        const fr = el('iframe', 'wl-embed'); fr.src = u; fr.title = txt(p.title) || (c.type === 'map' ? 'Map' : 'Embedded page');
        fr.setAttribute('allow', 'fullscreen; picture-in-picture; encrypted-media'); fr.setAttribute('loading', 'lazy'); fr.setAttribute('referrerpolicy', 'no-referrer');
        box.appendChild(fr); break;
      }

      /* ---- layout ---- */
      case 'box': {
        box.classList.add('wl-panel'); if (p.tint) box.style.background = p.tint;
        if (p.title) box.appendChild(el('div', 'wl-title', txt(p.title)));
        break;
      }
      case 'spacer': break;
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
    const panels = comps.filter(c => c.type === 'box');
    const focused = document.activeElement && document.activeElement.dataset && document.activeElement.dataset.name;
    const caret = focused && document.activeElement.selectionStart;
    pageEl.style.height = (comps.reduce((m, c) => Math.max(m, c.y + c.h), 0) * ROW + 24) + 'px';
    const have = new Map([...pageEl.children].map(n => [n.dataset.c, n]));
    const draws = [];
    comps.forEach((c, i) => {
      let w = have.get(c.id);
      if (!w) { w = el('div', 'wl-c'); w.dataset.c = c.id; }
      have.delete(c.id);
      const inPanel = c.type !== 'box' && panels.some(b => c.x >= b.x && c.x + c.w <= b.x + b.w && c.y >= b.y && c.y + c.h <= b.y + b.h);
      w.className = 'wl-c' + (FIXED[c.type] ? ' fixed' : '') + (c.type === 'box' ? ' behind' : '') + (inPanel ? ' inpanel' : '');
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
    const narrow = OPT.design ? S.stack : isNarrow();
    S.narrow = narrow;
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
  // Phone or not, by the page's own width (a frame may get its size after the page starts).
  function isNarrow() { return (document.documentElement.clientWidth || window.innerWidth) < 720; }
  let resizeT, lastW = 0;
  new ResizeObserver(() => {
    const w = document.documentElement.clientWidth;
    if (w === lastW) return; // only the width matters (the page's own height changes as it's drawn)
    lastW = w;
    clearTimeout(resizeT);
    resizeT = setTimeout(() => { if (!pageEl) return; if (!OPT.design && isNarrow() !== S.narrow) layout(); else paint(); }, 120);
  }).observe(document.documentElement);
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
