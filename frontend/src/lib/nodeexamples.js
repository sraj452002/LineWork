/* A filled-in example for every workflow node: each setting with a real value, and for the nodes that
   work on items, the item that goes in and what comes out. Shown in the Workflows guide under “Set it
   up” (NodeGuide.jsx).

   exampleOf(type, d) puts it together, setting by setting:
     1. a value written here (NODE_EXAMPLE),
     2. the tool nodes' own example, made from their tested case (backend/flow-tools.js),
     3. the node's default, its hint, its first choice, or off for a switch.
   Only the settings the editor would show for those values are listed (a field's `when`).
   NODE_EXAMPLE[type]: { field: value, …, $in: [input items], $out: output items, or {port: items} }.
   '' means “leave it blank”: the row isn't listed. tests/flow-guide.spec.js checks every node has a
   value for every setting it shows, and runs the Flow and Data examples to check what they give. */

const SECRET = 'my-signing-secret-7Qx2';
const MAIL = { to: '{{ $json.email }}', subject: 'Your order {{ $json.id }} has shipped', text: 'Hi {{ $json.name }}, your order is on its way.', html: '' };

export const NODE_EXAMPLE = {
  /* ---- triggers ---- */
  'trigger.webhook': { $out: [{ method: 'POST', query: {}, headers: { 'content-type': 'application/json' }, body: { order: 42 } }] },
  'trigger.form': { description: 'We answer within a day.' },
  'trigger.typeform': { secret: SECRET },
  'trigger.urlchange': { url: 'https://example.com/product/42' },
  'trigger.error': { fileId: '“Orders to sheet” (a workflow file)' },
  'trigger.dbrow': { table: 'orders' },
  'trigger.calendar': { calendarId: 'team@example.com' },
  'trigger.sheetrow': { fileId: '“Sign-ups” (a Workline file with a sheet)', sheet: 'Sheet1' },
  'trigger.whatsapp': { verifyToken: 'my-verify-token' },
  'trigger.discord': { publicKey: '3f1c9a7e2b4d6f8a0c1e3b5d7f9a2c4e6b8d0f1a3c5e7b9d2f4a6c8e0b1d3f5a' },
  'trigger.file': { kind: 'doc', title: 'Meeting notes' },
  'trigger.drive': { folderId: 'https://drive.google.com/drive/folders/1AbCdEfGh' },
  'trigger.youtube': { channel: 'UC_x5XG1OV2P6uZZ5FSM9Ttw' },
  'trigger.reddit': { keywords: 'react, next.js' },
  'trigger.messenger': { verifyToken: 'my-verify-token' },
  'trigger.instagram': { verifyToken: 'my-verify-token' },
  'trigger.discordmsg': { channelId: '1234567890123456789' },
  'trigger.zendesk': { secret: SECRET },
  'trigger.tally': { secret: SECRET },

  /* ---- Workline ---- */
  'workline.sheet': { operation: 'append', fileId: '“Orders” (a Workline file with a sheet)', sheet: 'Sheet1', values: '{{ { "Name": $json.name, "Total": $json.total } }}' },
  'workline.doc': { fileId: '“Daily notes” (a Workline doc)', text: '## {{ $json.title }}\n{{ $json.summary }}' },
  'workline.diagram': { fileId: '“Architecture” (a Workline file)', code: 'web > api > db' },
  'workline.database': { connection: '“Shop DB” (saved in the Database view)', sql: 'SELECT id, total FROM orders WHERE status = \'paid\' LIMIT 10' },

  /* ---- flow ---- */
  'core.if': {
    left: '{{ $json.status }}', op: 'equals', right: 'paid',
    $in: [{ id: 1, status: 'paid' }, { id: 2, status: 'due' }],
    $out: { true: [{ id: 1, status: 'paid' }], false: [{ id: 2, status: 'due' }] },
  },
  'core.switch': {
    value: '{{ $json.type }}', rule1: 'billing', rule2: 'bug', rule3: 'feature', rule4: '',
    $in: [{ type: 'bug' }, { type: 'billing' }, { type: 'hello' }],
    $out: { 0: [{ type: 'billing' }], 1: [{ type: 'bug' }], 2: [], 3: [], other: [{ type: 'hello' }] },
  },
  'core.filter': {
    left: '{{ $json.total }}', op: 'gte', right: '1000',
    $in: [{ id: 1, total: 2499 }, { id: 2, total: 300 }],
    $out: [{ id: 1, total: 2499 }],
  },
  'core.merge': {
    $in: { a: [{ id: 1 }], b: [{ id: 2 }] },
    $out: [{ id: 1 }, { id: 2 }],
  },
  'core.split': {
    field: 'orders',
    $in: [{ customer: 'Asha', orders: [{ id: 1 }, { id: 2 }] }],
    $out: [{ id: 1 }, { id: 2 }],
  },
  'core.chunk': { size: 2 },
  'core.limit': {
    max: 2,
    $in: [{ n: 1 }, { n: 2 }, { n: 3 }],
    $out: [{ n: 1 }, { n: 2 }],
  },
  'core.sort': {
    field: 'total', order: 'desc',
    $in: [{ id: 1, total: 300 }, { id: 2, total: 2499 }],
    $out: [{ id: 2, total: 2499 }, { id: 1, total: 300 }],
  },
  'core.dedupe': {
    field: 'email',
    $in: [{ email: 'a@example.com', n: 1 }, { email: 'a@example.com', n: 2 }, { email: 'b@example.com', n: 3 }],
    $out: [{ email: 'a@example.com', n: 1 }, { email: 'b@example.com', n: 3 }],
  },
  'core.delay': { seconds: 5 },
  'core.subflow': { fileId: '“Send welcome email” (a workflow file)' },
  'core.stop': { message: 'Order {{ $json.id }} has no email address.' },
  'core.respond': { with: 'json', body: '{ "ok": true, "id": "{{ $json.id }}" }', headers: [{ name: 'Cache-Control', value: 'no-store' }] },
  'core.code': {
    language: 'javascript', code: 'return items.filter(i => i.total > 0);',
  },
  'core.set': {
    fields: [{ name: 'fullName', value: '{{ $json.first }} {{ $json.last }}' }], keep: true,
    $in: [{ first: 'Asha', last: 'Rao' }],
    $out: [{ first: 'Asha', last: 'Rao', fullName: 'Asha Rao' }],
  },
  'core.rename': {
    fields: [{ name: 'mail', value: 'email' }],
    $in: [{ mail: 'asha@example.com' }],
    $out: [{ email: 'asha@example.com' }],
  },
  'core.aggregate': {
    field: 'email', into: 'emails',
    $in: [{ email: 'a@example.com' }, { email: 'b@example.com' }],
    $out: [{ emails: ['a@example.com', 'b@example.com'] }],
  },
  'core.summarize': {
    op: 'sum', field: 'total', groupBy: 'city',
    $in: [{ city: 'Pune', total: 100 }, { city: 'Pune', total: 50 }, { city: 'Delhi', total: 70 }],
    $out: [{ city: 'Pune', sum: 150 }, { city: 'Delhi', sum: 70 }],
  },
  'core.datetime': { operation: 'add', value: '{{ $json.date }}', amount: 7, unit: 'days', output: 'due' },
  'core.text': {
    operation: 'replace', value: '{{ $json.title }}', find: 'Ltd', replaceWith: 'Limited', output: 'title',
    $in: [{ title: 'Acme Ltd' }],
    $out: [{ title: 'Acme Limited' }],
  },
  'core.json': {
    operation: 'parse', field: 'body', output: '',
    $in: [{ body: '{"id":7,"ok":true}' }],
    $out: [{ body: { id: 7, ok: true } }],
  },
  'core.regex': { value: '{{ $json.text }}', pattern: '(\\d+)', flags: 'g' },
  'core.csv': { operation: 'parse', text: '{{ $json.body }}', separator: ',' },
  'core.crypto': { operation: 'hash', value: '{{ $json.email }}', algorithm: 'sha256', encoding: 'hex', output: 'hash' },
  'core.note': { text: 'Sends the daily report. Ask Asha before changing it.' },
  'core.pivot': { rows: 'country', columns: 'status', value: 'amount', total: true },
  'core.textsplit': { text: '{{ $json.text }}', by: 'paragraph', size: 1000, overlap: 100 },
  'core.storage': { operation: 'save', source: 'file', file: '{{ $json.invoice }}', folder: 'Invoices/2026', replace: false, output: 'file' },
  'core.kv': { operation: 'increment', key: 'visits:{{ $json.page }}', by: 1, output: 'visits' },

  /* ---- page and UI ---- */
  'trigger.page': { description: 'Today’s orders, live from the shop.', link: 'orders', css: '' },
  'ui.cards': { title: 'Today', cards: [{ name: 'Orders', value: '{{ $items.length }}' }, { name: 'Revenue', value: '₹{{ $items.reduce((s, i) => s + i.json.total, 0) }}' }] },
  'ui.table': { title: 'Latest orders' },
  'ui.chart': { title: 'Sales by month' },
  'ui.media': { poster: '{{ $json.thumbnail }}' },
  'ui.buttons': { buttons: [{ name: 'All', value: '?' }, { name: 'Films', value: '?category=Film' }] },
  'ui.form': { title: 'Find an order', fields: 'Order number* (number)', button: 'Search', action: 'search' },
  'ui.editor': { source: 'input', input: '{{ $json.file }}', title: 'Check the file', rows: 18, button: 'Save & continue' },

  /* ---- AI ---- */
  'ai.agent': { agentId: '', task: 'Reply to this customer email: {{ $json.text }}', use_workflows: false, use_nodes: false, use_files: true, use_docs: false },
  'ai.claude': { prompt: 'Write a two-line thank-you note to {{ $json.name }} for order {{ $json.id }}.', system: 'You write short, warm messages.' },
  'ai.summarize': { text: '{{ $json.body }}', focus: 'action items' },
  'ai.extract': { text: '{{ $json.text }}', fields: [{ name: 'name', value: 'the person’s full name' }, { name: 'total', value: 'the amount, as a number' }], output: 'data' },
  'ai.classify': { text: '{{ $json.text }}', instructions: 'Refund requests count as billing.' },
  'ai.rewrite': { text: '{{ $json.draft }}', style: 'friendly', instructions: '' },
  'ai.translate': { text: '{{ $json.message }}' },
  'ai.vision': { imageUrl: '{{ $json.photoUrl }}', question: 'What product is in this photo, and is it damaged?' },
  'ai.decide': { context: 'Order {{ $json.id }}, delivered {{ $json.deliveredAt }}. Customer says: {{ $json.text }}' },
  'ai.score': { text: '{{ $json.cv }}' },
  'ai.mcp': { tool: 'search' },
  openai: { prompt: 'Summarise this review in one line: {{ $json.review }}', system: 'Be brief.' },
  gemini: { prompt: 'Suggest three subject lines for: {{ $json.topic }}', system: 'Be brief.' },

  /* ---- communication ---- */
  'app.slack': { channel: '#orders', text: 'New order {{ $json.id }} from {{ $json.name }}: ₹{{ $json.total }}' },
  'app.discord': { content: 'New order {{ $json.id }} from {{ $json.name }}', username: 'Workline' },
  'app.telegram': { chatId: '123456789', text: 'New order {{ $json.id }}: ₹{{ $json.total }}' },
  whatsapp: { to: '{{ $json.phone }}', text: 'Hi {{ $json.name }}, your order {{ $json.id }} has shipped.' },
  'app.teams': { text: 'Deploy finished: {{ $json.url }}' },
  'app.googlechat': { text: 'Deploy finished: {{ $json.url }}' },
  'app.mattermost': { text: 'Deploy finished: {{ $json.url }}' },
  'app.email': { ...MAIL },
  sendgrid: { ...MAIL },
  resend: { ...MAIL },
  mailgun: { ...MAIL, from: 'Shop <orders@mg.example.com>' },
  postmark: { ...MAIL, from: 'orders@example.com' },
  brevo: { ...MAIL, from: 'orders@example.com' },
  twilio: { to: '{{ $json.phone }}', body: 'Your order {{ $json.id }} has shipped.', from: '+15005550006' },
  mailchimp: { listId: 'a1b2c3d4e5', email: '{{ $json.email }}', firstName: '{{ $json.name }}' },
  ntfy: { topic: 'shop-orders-x7k', title: 'New order', message: '₹{{ $json.total }} from {{ $json.name }}', priority: 3, click: 'https://example.com/orders/{{ $json.id }}' },
  pushover: { title: 'New order', message: '₹{{ $json.total }} from {{ $json.name }}', url: 'https://example.com/orders/{{ $json.id }}' },

  /* ---- productivity ---- */
  'app.notion': { databaseId: '8a3b1c2d4e5f67890a1b2c3d4e5f6789', title: '{{ $json.title }}', content: '{{ $json.summary }}' },
  'google.sheets': { operation: 'append', spreadsheetId: '1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms', range: 'Sheet1', values: '{{ [$json.name, $json.email] }}' },
  'google.calendar': { calendarId: 'team@example.com', limit: 10 },
  airtable: { baseId: 'appQ1w2E3r4T5y6U7', table: 'Leads', formula: '{Status} = \'New\'', limit: 20 },
  trello: { listId: '5f2b1c9e8d7a6b5c4d3e2f1a', name: 'Call {{ $json.name }}', desc: 'Lead from the website form.' },
  asana: { projectId: '1204567890123456', name: 'Call {{ $json.name }}', notes: 'Lead from the website form.', dueOn: '2026-12-01' },
  clickup: { listId: '901234567', name: 'Call {{ $json.name }}', description: 'Lead from the website form.' },
  todoist: { content: 'Call {{ $json.name }}', description: 'Lead from the website form.' },
  wordpress: { title: '{{ $json.title }}', content: '{{ $json.html }}' },
  pagerduty: { summary: 'Checkout is failing: {{ $json.error }}', dedupKey: 'checkout-{{ $json.service }}' },

  /* ---- developer ---- */
  'core.http': { method: 'GET', query: '', url: 'https://api.github.com/repos/{{ $json.repo }}', headers: [{ name: 'Accept', value: 'application/vnd.github+json' }], body: '' },
  'app.github': { owner: 'acme', repo: 'shop', title: 'Bug from support: {{ $json.subject }}', body: '{{ $json.text }}' },
  gitlab: { projectId: 'acme/shop', title: 'Bug from support: {{ $json.subject }}', description: '{{ $json.text }}' },
  jira: { projectKey: 'APP', summary: 'Bug from support: {{ $json.subject }}', description: '{{ $json.text }}' },
  linear: { teamId: '9cfb482a-81e3-4154-b5b9-2c805e70a02d', title: 'Bug from support: {{ $json.subject }}', description: '{{ $json.text }}' },
  zendesk: { subject: '{{ $json.subject }}', body: '{{ $json.text }}', requesterEmail: '{{ $json.email }}' },
  hubspot: { email: '{{ $json.email }}', firstName: '{{ $json.first }}', lastName: '{{ $json.last }}', company: '{{ $json.company }}' },
  pipedrive: { name: '{{ $json.name }}', email: '{{ $json.email }}' },
  stripe: { email: '{{ $json.email }}', limit: 10 },
  shopify: { limit: 50 },
  bitly: { url: '{{ $json.link }}' },
  'web.page': { extract: 'fields', each: '.product', fields: [{ name: 'name', value: 'h2' }, { name: 'price', value: '.price' }, { name: 'link', value: 'a @href' }], limit: 20 },
  'web.browser': { url: 'https://example.com/search', waitFor: '.price' },
  'core.graphql': { path: 'user', headers: [{ name: 'Authorization', value: 'Bearer {{ $json.token }}' }] },
  'file.create': { name: 'output.py', content: '{{ $json.text }}', encoding: 'text', unfence: true, output: 'file' },
  'file.spreadsheet': { sheet: 'Sheet1' },
  'app.redis': { operation: 'set', value: '{{ $json }}', ttl: 3600 },
  supabase: { table: 'signups', limit: 50 },
  dropbox: { content: '' },
  'data.rss': { url: 'https://hnrss.org/frontpage', limit: 5 },

  /* ---- app actions: the settings with no hint ---- */
  'github.createPull': { body: 'Adds a dark theme. Closes #12.' },
  'github.createRelease': { body: 'Fixes and improvements.' },
  'github.getFile': { ref: 'main' },
  'github.putFile': { branch: 'main' },
  'github.gist': { description: 'Daily report' },
  'gitlab.comment': { project: 'acme/shop', body: 'Thanks, we’re on it.' },
  'gitlab.createMR': { project: 'acme/shop', title: 'Add dark mode', description: 'Closes #12.' },
  'gitlab.closeIssue': { project: 'acme/shop' },
  'gitlab.listMRs': { project: 'acme/shop' },
  'gitlab.pipeline': { project: 'acme/shop' },
  'gitlab.pipelines': { project: 'acme/shop' },
  'jira.comment': { body: 'Fixed in today’s release.' },
  'jira.update': { summary: '{{ $json.summary }} (customer report)', description: '{{ $json.text }}' },
  'linear.comment': { body: 'Fixed in today’s release.' },
  'linear.update': { title: '{{ $json.title }}', stateId: 'a1b2c3d4-0000-4c5d-9e8f-123456789abc' },
  'zendesk.reply': { body: 'Hi {{ $json.name }}, thanks for writing. We’ve sent a replacement.' },
  'stripe.product': { description: 'A year of Pro.' },
  'stripe.invoices': { customer: 'cus_Q8nZ2xYk3Lm4' },
  'stripe.invoice': { customer: 'cus_Q8nZ2xYk3Lm4' },
  'stripe.customer': { customer: 'cus_Q8nZ2xYk3Lm4' },
  'stripe.paymentLink': { price: 'price_1Pq2Rs3Tu4Vw' },
  'stripe.refund': { payment: 'pi_3Pq2Rs3Tu4Vw5X', amount: '' },
  'stripe.cancel': { subscription: 'sub_1Pq2Rs3Tu4Vw' },
  'shopify.createCustomer': { firstName: '{{ $json.first }}', lastName: '{{ $json.last }}', phone: '{{ $json.phone }}' },
  'shopify.createProduct': { title: 'Cotton tote bag', description: 'A sturdy everyday bag.', vendor: 'Acme', type: 'Bags' },
  'shopify.setPrice': { compareAt: '799' },
  'hubspot.createCompany': { name: '{{ $json.company }}', industry: 'COMPUTER_SOFTWARE' },
  'hubspot.createDeal': { name: '{{ $json.company }}: annual plan', amount: '120000' },
  'hubspot.ticket': { subject: '{{ $json.subject }}', content: '{{ $json.text }}' },
  'pipedrive.org': { name: '{{ $json.company }}' },
  'pipedrive.activity': { dealId: '{{ $json.dealId }}' },
  'pipedrive.note': { content: 'Called; they want a demo next week.', dealId: '{{ $json.dealId }}', personId: '' },
  'pipedrive.updateDeal': { stageId: '3', value: '120000' },
  'slack.reply': { channel: '#support', text: 'On it, thanks!' },
  'slack.dm': { user: 'asha@example.com', text: 'Your report is ready: {{ $json.url }}' },
  'slack.update': { channel: '#orders', text: 'Order {{ $json.id }}: shipped ✓' },
  'slack.delete': { channel: '#orders' },
  'slack.react': { channel: '#orders' },
  'slack.schedule': { channel: '#team', text: 'Stand-up in 5 minutes.' },
  'slack.invite': { channel: '#orders' },
  'slack.topic': { channel: '#orders' },
  'slack.history': { channel: 'C0123ABCD' },
  'telegram.photo': { photo: '{{ $json.imageUrl }}', caption: '{{ $json.title }}' },
  'telegram.document': { document: '{{ $json.invoiceUrl }}', caption: 'Invoice {{ $json.id }}' },
  'telegram.video': { video: '{{ $json.videoUrl }}', caption: '{{ $json.title }}' },
  'telegram.buttons': { text: 'Approve order {{ $json.id }}?' },
  'telegram.edit': { text: 'Order {{ $json.id }}: approved ✓' },
  'telegram.forward': { chatId: '-1001234567890' },
  'discord.embed': { title: '{{ $json.title }}', description: '{{ $json.summary }}', url: '{{ $json.link }}', image: '{{ $json.imageUrl }}' },
  'discord.as': { content: 'Build {{ $json.id }} passed ✓', avatar: 'https://example.com/bot.png' },
  'whatsapp.image': { link: '{{ $json.imageUrl }}', caption: 'Your order {{ $json.id }}' },
  'whatsapp.document': { link: '{{ $json.invoiceUrl }}' },
  'whatsapp.location': { name: 'Acme store', address: 'MG Road, Pune' },
  'twilio.whatsapp': { body: 'Your order {{ $json.id }} has shipped.' },
  'sendgrid.contact': { firstName: '{{ $json.first }}', lastName: '{{ $json.last }}', listIds: '' },
  'notion.search': { query: 'Roadmap' },
  'trello.move': { listId: '5f2b1c9e8d7a6b5c4d3e2f1b' },
  'trello.comment': { text: 'Done ✓' },
  'trello.createList': { boardId: '5f2b1c9e8d7a6b5c4d3e2f00' },
  'trello.lists': { boardId: '5f2b1c9e8d7a6b5c4d3e2f00' },
  'asana.comment': { text: 'Done ✓' },
  'asana.subtask': { name: 'Send the quote' },
  'asana.projects': { workspace: '1201234567890123' },
  'clickup.comment': { text: 'Done ✓' },
  'clickup.spaces': { teamId: '9012345' },
  'todoist.update': { content: 'Call {{ $json.name }} (moved)' },
  'todoist.createProject': { name: 'Launch' },
  'todoist.comment': { content: 'Left a voicemail.' },
  'wordpress.updatePost': { title: '{{ $json.title }}', content: '{{ $json.html }}' },
  'wordpress.createPage': { title: 'About us', content: '<p>We make bags.</p>' },
  'wordpress.comments': { postId: '{{ $json.id }}' },
  'wordpress.category': { name: 'News' },
  'supabase.createUser': { password: '{{ $json.password }}' },
  'supabase.files': { prefix: 'invoices/' },
  'gcal.quickAdd': { calendarId: 'team@example.com' },
  'gcal.delete': { calendarId: 'team@example.com' },
  'gcal.busy': { calendarId: 'team@example.com' },
  'notion.append': { text: '{{ $json.summary }}' },
  'airtable.get': { baseId: 'appQ1w2E3r4T5y6U7', recordId: 'recA1b2C3d4E5f6G7' },
  'airtable.delete': { baseId: 'appQ1w2E3r4T5y6U7', recordId: 'recA1b2C3d4E5f6G7' },
  'airtable.find': { baseId: 'appQ1w2E3r4T5y6U7' },
  'airtable.upsert': { baseId: 'appQ1w2E3r4T5y6U7' },
  'gdrive.list': { folderId: 'https://drive.google.com/drive/folders/1AbCdEfGh' },
  'gdrive.upload': { folderId: 'https://drive.google.com/drive/folders/1AbCdEfGh' },
  'gdrive.folder': { parentId: 'https://drive.google.com/drive/folders/1AbCdEfGh' },
  'pub.fxHistory': { end: '2025-01-31' },
  'pub.xkcd': { number: '353' },
  'pub.apod': { date: '2025-01-31', apiKey: 'DEMO_KEY' },
  'pub.universities': { name: 'Delhi' },
  'razorpay.refund': { amount: '' },
  'woocommerce.updateProduct': { salePrice: '799' },
  'reddit.search': { subreddit: 'webdev' },
};

// What to put in a setting nobody wrote a value for, by its key.
const BY_KEY = { secret: SECRET };

const blank = v => v === undefined || v === null || v === '' || (Array.isArray(v) && !v.some(p => p && p.name));
// A hint as a value: without “e.g.”, a note in brackets, or the second of two ways (“x  or  y”).
export function hintValue(hint) {
  if (!hint) return undefined;
  const s = String(hint).replace(/^e\.g\.\s*/i, '').replace(/\s{2,}\(.*$/s, '').split(/\s+or\s+/)[0].trim();
  return s || undefined;
}
export const defaultsOf = d => (typeof d.defaults === 'function' ? d.defaults() : d.defaults) || {};
export const meets = (w, p) => !w || w.slice(1).includes(p[w[0]] ?? '');

/* The example for one node: { rows: [{ f, v }] (the settings shown, in order), input, output, missing:
   [keys of shown settings with no value] }. */
export function exampleOf(type, d) {
  const hand = NODE_EXAMPLE[type] || {}, tool = d.example || {}, def = defaultsOf(d);
  const p = {};
  const missing = [];
  for (const f of d.fields || []) {
    const pick = [
      hand[f.k],
      tool.set?.[f.k],
      // A select's or agent's blank default is a real choice (“Auto”, “describe one here”).
      (f.kind === 'select' || f.kind === 'agent') && def[f.k] !== undefined ? def[f.k] : blank(def[f.k]) ? undefined : def[f.k],
      f.kind === 'pairs' ? undefined : hintValue(f.hint),
      BY_KEY[f.k],
      f.options?.[0]?.[0],
      f.kind === 'bool' ? false : undefined,
      // An AI step's model, blank: “Same as AI chat”, a real choice (not listed, like other blanks).
      f.kind === 'aimodel' ? '' : undefined,
    ];
    p[f.k] = f.k in hand ? hand[f.k] : pick.find(v => v !== undefined);
  }
  const rows = [];
  for (const f of d.fields || []) {
    if (!meets(f.when, p) || !meets(f.also, p)) continue;
    const v = p[f.k];
    if (v === undefined) { missing.push(f.k); continue; }
    // Blank on purpose, and styling the page doesn't need: not listed.
    if ((v === '' && f.kind !== 'select' && f.kind !== 'agent') || (f.k === 'css' && !(f.k in hand))) continue;
    rows.push({ f, v });
  }
  return { rows, input: hand.$in ?? (tool.in && [tool.in]), output: hand.$out ?? (tool.out && [tool.out]), missing };
}

// A value as the editor would show it: a choice's label, On/Off, name → value rows.
export function showValue(f, v) {
  if (f.kind === 'select') return (f.options || []).find(o => String(o[0]) === String(v))?.[1] ?? String(v);
  if (f.kind === 'bool') return v ? 'On' : 'Off';
  if (f.kind === 'agent') return v ? String(v) : 'None: the instructions below make the agent';
  if (f.kind === 'pairs') return (Array.isArray(v) ? v : []).filter(r => r && r.name).map(r => `${r.name} → ${r.value}`).join('\n');
  return typeof v === 'string' ? v : JSON.stringify(v);
}
