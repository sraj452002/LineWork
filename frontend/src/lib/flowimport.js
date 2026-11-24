import { rid } from './utils.js';
import { NODES, inputsOf, outputsOf } from './flows.js';

/* Workflows exported from other automation apps, as Workline workflows. flowio.js's importFlow() tries
   Workline's own files and n8n's first, then readForeign() here: Make (scenario blueprints), Zapier (Zap
   exports), Node-RED (flows.json) and Power Automate / Azure Logic Apps (flow definitions).

   Each reader turns the app's steps into nodes and its links into edges:
     - a step we have a node for becomes that node, with the settings that match ours copied over and its
       expressions rewritten ({{1.email}}, {{2__email}}, @{triggerBody()?['email']} → {{ $json.… }});
     - an app we have a node for (Slack, Gmail, Sheets…) becomes that app's node, by its name;
     - anything else becomes a placeholder (No-op) that keeps the original step and its settings in its
       note, so nothing is lost; a trigger we can't match becomes Run by hand, so the workflow still runs.
   Every imported node's `note` says where it came from. Returns {flow, name, app, skipped, more}. */

/* ---- apps by name: a word in the other app's step type → our node (and its trigger, if we have one) ---- */
const APPS = [
  [/slack/, 'app.slack'], [/discord/, 'app.discord'], [/telegram/, 'app.telegram'], [/whats ?app/, 'whatsapp'],
  [/microsoft ?teams|\bteams\b/, 'app.teams'], [/google ?chat|hangouts ?chat/, 'app.googlechat'], [/mattermost/, 'app.mattermost'],
  [/gmail|outlook|office ?365|smtp|e-?mail|mailer/, 'app.email'], [/sendgrid/, 'sendgrid'], [/mailgun/, 'mailgun'], [/postmark/, 'postmark'],
  [/brevo|sendinblue/, 'brevo'], [/resend/, 'resend'], [/mailchimp/, 'mailchimp'], [/twilio|sms/, 'twilio'], [/pushover/, 'pushover'], [/ntfy/, 'ntfy'],
  [/google ?sheets?|spreadsheet/, 'google.sheets'], [/google ?calendar/, 'google.calendar'], [/notion/, 'app.notion'], [/airtable/, 'airtable'],
  [/trello/, 'trello'], [/asana/, 'asana'], [/click ?up/, 'clickup'], [/todoist/, 'todoist'], [/wordpress/, 'wordpress'],
  [/hubspot/, 'hubspot'], [/pipedrive/, 'pipedrive'], [/stripe/, 'stripe'], [/shopify/, 'shopify'], [/zendesk/, 'zendesk'], [/pagerduty/, 'pagerduty'],
  [/github/, 'app.github'], [/gitlab/, 'gitlab'], [/jira/, 'jira'], [/linear/, 'linear'], [/supabase/, 'supabase'], [/dropbox/, 'dropbox'],
  [/redis/, 'app.redis'], [/postgres|my ?sql|mssql|sql ?server|mongo|database/, 'app.database'],
  [/open ?ai|chat ?gpt|\bgpt/, 'openai'], [/anthropic|claude/, 'ai.claude'], [/gemini|google ?ai/, 'gemini'], [/deepl/, 'deepl'], [/bit\.?ly/, 'bitly'],
  [/\brss\b|feed/, 'data.rss'], [/weather/, 'data.weather'], [/hacker ?news/, 'data.hackernews'],
];
const TRIGGERS = { 'app.slack': 'trigger.slack', 'app.telegram': 'trigger.telegram', 'app.github': 'trigger.github', gitlab: 'trigger.gitlab', jira: 'trigger.jira', linear: 'trigger.linear', stripe: 'trigger.stripe', shopify: 'trigger.shopify', whatsapp: 'trigger.whatsapp', 'app.teams': 'trigger.teams', 'app.googlechat': 'trigger.googlechat', 'app.discord': 'trigger.discord', 'data.rss': 'trigger.rss', 'app.email': 'trigger.email', 'google.calendar': 'trigger.calendar', zendesk: 'trigger.zendesk', pagerduty: 'trigger.pagerduty', mailchimp: 'trigger.mailchimp', trello: 'trigger.trello', clickup: 'trigger.clickup', 'app.notion': 'trigger.notion', twilio: 'trigger.twilio', 'app.database': 'trigger.dbrow' };
// The node for an app named in `text` ("slack:CreateMessage", "GoogleSheetsV2CLIAPI", "shared_teams"); a trigger's if asked.
export function appNode(text, trigger = false) {
  const t = String(text || '').replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[_:.\-/@]+/g, ' ').toLowerCase();
  const hit = APPS.find(([re]) => re.test(t));
  if (!hit || !NODES[hit[1]]) return null;
  return trigger ? (TRIGGERS[hit[1]] && NODES[TRIGGERS[hit[1]]] ? TRIGGERS[hit[1]] : null) : hit[1];
}

/* ---- settings: the other app's values copied onto ours by name ---- */
const ALIASES = {
  text: ['text', 'message', 'content', 'body', 'msg', 'markdown'], content: ['content', 'text', 'message'], channel: ['channel', 'channelId', 'channel_id', 'conversation'],
  chatId: ['chatId', 'chat_id', 'chat'], to: ['to', 'toEmail', 'to_email', 'email', 'recipient', 'recipients', 'toRecipients'], subject: ['subject', 'title'],
  html: ['html', 'htmlBody', 'body_html'], url: ['url', 'uri', 'link', 'endpoint', 'address'], method: ['method', 'httpMethod', 'requestMethod', 'http_method'],
  prompt: ['prompt', 'message', 'text', 'input', 'question', 'messages'], system: ['system', 'instructions', 'systemMessage'], model: ['model'],
  body: ['body', 'data', 'payload', 'json'], sql: ['sql', 'query', 'statement'], spreadsheetId: ['spreadsheetId', 'spreadsheet', 'documentId', 'sheetId'],
  range: ['range', 'sheetName', 'sheet'], title: ['title', 'name', 'summary'], name: ['name', 'title'], description: ['description', 'notes', 'desc'],
  email: ['email', 'emailAddress'], phone: ['phone', 'phoneNumber'], seconds: ['seconds', 'delay', 'timeout', 'amount'], field: ['field', 'fieldToSplitOut', 'property'],
};
const flat = (o, out = {}, depth = 0) => {
  for (const [k, v] of Object.entries(o && typeof o === 'object' ? o : {})) {
    if (v && typeof v === 'object' && !Array.isArray(v) && depth < 2) flat(v, out, depth + 1);
    if (!(k.toLowerCase() in out)) out[k.toLowerCase()] = v;
  }
  return out;
};
// Our node's settings from the other app's: each of our fields from a value with its name (or a near one).
export function copyParams(type, source, expr = v => v) {
  const d = NODES[type], src = flat(source), p = { ...(typeof d.defaults === 'function' ? d.defaults() : d.defaults || {}) };
  for (const f of d.fields || []) {
    if (f.kind === 'pairs' || f.kind === 'file' || f.kind === 'workflow' || f.kind === 'agent' || f.kind === 'dbconn') continue;
    const key = (ALIASES[f.k] || [f.k]).map(k => k.toLowerCase()).find(k => src[k] !== undefined && src[k] !== null && src[k] !== '' && typeof src[k] !== 'object');
    if (key === undefined) continue;
    let v = src[key];
    if (f.kind === 'select') { const o = (f.options || []).find(x => String(x[0]).toLowerCase() === String(v).toLowerCase()); if (!o) continue; v = o[0]; }
    else if (f.kind === 'number') { v = Number(v); if (!Number.isFinite(v)) continue; }
    else if (f.kind === 'bool') v = v === true || v === 'true';
    else v = expr(String(v));
    p[f.k] = v;
  }
  return p;
}

/* ---- building the flow ---- */
const show = v => { try { const s = JSON.stringify(v); return s.length > 1500 ? s.slice(0, 1500) + '…' : s; } catch (e) { return ''; } };
function builder(app) {
  const nodes = [], edges = [], skipped = new Set();
  const names = new Set();
  const unique = name => { let n = String(name || 'Step').trim().slice(0, 60) || 'Step', i = 2; const base = n; while (names.has(n)) n = `${base} ${i++}`; names.add(n); return n; };
  return {
    nodes, edges, skipped,
    // A node of our `type`, or (type null) a placeholder keeping the original step.
    add({ type, name, params, x, y, from, settings, trigger }) {
      let node;
      if (type && NODES[type]) node = { id: rid('n'), type, name: unique(name || NODES[type].label), x: x ?? 0, y: y ?? 0, params: params || {}, note: `From ${app}: ${from}` };
      else if (trigger) { skipped.add(from); node = { id: rid('n'), type: 'trigger.manual', name: unique(name || 'Start'), x: x ?? 0, y: y ?? 0, params: {}, note: `From ${app}: ${from}, a trigger Workline doesn’t have. Run it by hand, or swap in a Webhook or Schedule trigger. Its settings: ${show(settings)}` }; }
      else { skipped.add(from); node = { id: rid('n'), type: 'core.noop', name: unique(name || from), x: x ?? 0, y: y ?? 0, params: {}, note: `From ${app}: ${from}, which Workline has no node for: put one in its place. Its settings: ${show(settings)}` }; }
      nodes.push(node);
      return node;
    },
    link(a, b, port, toPort) {
      if (!a || !b || !inputsOf(b.type).length) return;
      const outs = outputsOf(a.type), ins = inputsOf(b.type);
      edges.push({ id: rid('e'), from: a.id, fromPort: outs.includes(port) ? port : outs[0], to: b.id, toPort: ins.includes(toPort) ? toPort : ins[0] });
    },
    done(name, more = '') {
      if (nodes.some(n => !n.x && !n.y)) layout(nodes, edges);
      return { flow: { active: false, nodes, edges }, name, app, skipped: [...skipped], more };
    },
  };
}
// Left to right by steps from the start, each column's nodes one under another.
function layout(nodes, edges) {
  const depth = new Map(nodes.map(n => [n.id, 0]));
  for (let i = 0; i < nodes.length; i++) for (const e of edges) depth.set(e.to, Math.max(depth.get(e.to), depth.get(e.from) + 1));
  const rows = new Map();
  for (const n of nodes) { const d = depth.get(n.id), r = rows.get(d) || 0; rows.set(d, r + 1); n.x = 80 + d * 260; n.y = 120 + r * 150; }
}
// Another app's canvas positions, brought to our scale and corner.
function place(nodes, scale = 1) {
  const minX = Math.min(...nodes.map(n => n.x)), minY = Math.min(...nodes.map(n => n.y));
  for (const n of nodes) { n.x = Math.round((n.x - minX) * scale + 80); n.y = Math.round((n.y - minY) * scale + 120); }
}

/* ---- Make: a scenario blueprint ({name, flow: [modules]}) ---- */
const MAKE = {
  'gateway:CustomWebHook': { type: 'trigger.webhook', trigger: true },
  'gateway:WebhookRespond': { type: 'core.respond', params: (p, x) => ({ with: 'text', body: x(String(p.body ?? '')), status: Number(p.status) || 200 }) },
  'builtin:BasicFeeder': { type: 'core.split', params: (p, x) => ({ field: String(x(String(p.array || ''))).replace(/^\{\{\s*\$json\.|\s*\}\}$/g, '') }) },
  'builtin:BasicAggregator': { type: 'core.aggregate' }, 'util:TextAggregator': { type: 'core.aggregate' },
  'util:SetVariable2': { type: 'core.set', params: (p, x) => ({ fields: [{ name: p.name || 'value', value: x(String(p.value ?? '')) }], keep: true }) },
  'util:SetVariables': { type: 'core.set', params: (p, x) => ({ fields: (p.variables || []).map(v => ({ name: v.name, value: x(String(v.value ?? '')) })), keep: true }) },
  'util:FunctionSleep': { type: 'core.delay', params: p => ({ seconds: Math.min(60, Number(p.duration) || 5) }) },
  'json:ParseJSON': { type: 'core.json', params: () => ({ operation: 'parse', field: 'json' }) },
  'json:CreateJSON': { type: 'core.json', params: () => ({ operation: 'stringify', field: 'json' }) },
  'http:ActionSendData': { type: 'core.http' }, 'http:ActionSendDataBasicAuth': { type: 'core.http' }, 'http:MakeRequest': { type: 'core.http' }, 'http:ActionGetFile': { type: 'core.http' },
  'builtin:BasicRouter': { router: true },
};
// {{1.email}} → {{ $node["Name"].json.email }}; Make's functions are kept for you to check.
const makeExpr = ids => v => String(v).replace(/\{\{([\s\S]*?)\}\}/g, (_, inner) => `{{ ${inner.replace(/\b(\d+)\.([A-Za-z_$][\w$]*(?:\.[\w$]+)*)/g, (m, id, path) => (ids.has(id) ? `$node["${ids.get(id)}"].json.${path}` : `$json.${path}`)).trim()} }}`);
const MAKE_OPS = { 'text:equal': 'equals', 'text:notequal': 'notEquals', 'text:contain': 'contains', 'text:notcontain': 'notContains', 'number:greater': 'gt', 'number:greaterorequal': 'gte', 'number:less': 'lt', 'number:lessorequal': 'lte', 'number:equal': 'equals', exist: 'isNotEmpty', notexist: 'isEmpty', 'boolean:equal': 'equals' };
function readMake(data) {
  const b = builder('Make'), ids = new Map();
  // Names first (unique, so {{ $node["…"] }} points at one node), so expressions can point at any module:
  // its name in Make, else our node's (“Slack: Create message”), else the module's own words.
  const taken = new Set();
  const nameOf = m => {
    const [app, op = ''] = String(m.module || '').split(':'), words = op.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase();
    const ours = MAKE[m.module]?.type || appNode(app);
    let n = m.metadata?.designer?.name || (ours ? `${NODES[ours].label.split(':')[0]}${MAKE[m.module] ? '' : ': ' + words}` : `${app.replace(/-/g, ' ')} ${words}`.trim()), i = 2;
    const base = n; while (taken.has(n)) n = `${base} ${i++}`; taken.add(n);
    return n;
  };
  const walkNames = list => (list || []).forEach(m => { if (!MAKE[m.module]?.router) ids.set(String(m.id), nameOf(m)); (m.routes || []).forEach(r => walkNames(r.flow)); });
  walkNames(data.flow);
  const x = makeExpr(ids);
  const walk = (list, prev, first) => {
    let last = prev;
    (list || []).forEach((m, i) => {
      const def = MAKE[m.module], [appName, op = ''] = String(m.module || '').split(':');
      const isTrigger = first && i === 0;
      const params = { ...(m.parameters || {}), ...(m.mapper || {}) };
      // A filter on the link into this module: a Filter node before it.
      if (m.filter && m.filter.conditions?.[0]?.[0]) {
        const c = m.filter.conditions[0][0];
        const f = b.add({ type: 'core.filter', name: m.filter.name || 'Filter', params: { left: x(String(c.a ?? '')), op: MAKE_OPS[c.o] || 'equals', right: x(String(c.b ?? '')) }, from: `filter “${m.filter.name || ''}”` });
        b.link(last, f); last = f;
      }
      if (def?.router) { (m.routes || []).forEach(r => walk(r.flow, last, false)); return; }
      const pos = m.metadata?.designer ? { x: m.metadata.designer.x, y: m.metadata.designer.y } : {};
      let type = def?.type || (isTrigger ? appNode(appName, true) : appNode(appName));
      if (/^(watch|new|trigger)/i.test(op) && !isTrigger) type = null;
      const node = b.add({ type, name: ids.get(String(m.id)), from: m.module, settings: params, trigger: isTrigger, ...pos,
        params: type && def?.params ? { ...copyParams(type, params, x), ...def.params(params, x) } : type ? copyParams(type, params, x) : {} });
      b.link(last, node);
      last = node;
    });
  };
  walk(data.flow, null, true);
  if (b.nodes.some(n => n.x || n.y)) place(b.nodes, 0.9);
  return b.done(data.name || 'Make scenario');
}

/* ---- Zapier: a Zap export ({zaps: [{title, nodes: {id: {parent_id, selected_api, action, type_of, params}}}]}) ---- */
const zapExpr = titles => v => String(v).replace(/\{\{\s*(\d+)__([\w]+(?:__[\w]+)*)\s*\}\}/g, (_, id, path) => `{{ $node["${titles.get(id) || id}"].json.${path.split('__').join('.')} }}`);
function readZapier(data) {
  const zap = data.zaps ? data.zaps[0] : data, all = Object.values(zap.nodes || {});
  const b = builder('Zapier'), titles = new Map(), made = new Map();
  for (const n of all) titles.set(String(n.id), n.title || `${String(n.selected_api || 'Step').replace(/(CLI)?API.*$|V\d+.*$/i, '')} ${n.action || ''}`.trim());
  const x = zapExpr(titles);
  const kind = n => String(n.selected_api || '').replace(/@.*$/, '');
  const order = [...all].sort((a, c) => (a.parent_id ? 1 : 0) - (c.parent_id ? 1 : 0) || Number(a.id) - Number(c.id));
  for (const n of order) {
    const api = kind(n), p = n.params || {}, isTrigger = !n.parent_id;
    let type, params;
    if (/^WebHook/i.test(api)) type = isTrigger ? 'trigger.webhook' : 'core.http';
    else if (/^Schedule/i.test(api)) { type = 'trigger.schedule'; params = { mode: 'interval', every: 1, unit: /week|day/i.test(n.action) ? 'days' : 'hours' }; }
    else if (/^Filter/i.test(api)) { const c = (p.filter_criteria || p.filters || [])[0]?.[0] || {}; type = 'core.filter'; params = { left: x(String(c.key ?? '')), op: /contain/i.test(c.match) ? 'contains' : /greater/i.test(c.match) ? 'gt' : /less/i.test(c.match) ? 'lt' : /exist/i.test(c.match) ? 'isNotEmpty' : 'equals', right: x(String(c.value ?? '')) }; }
    else if (/^Code/i.test(api)) { const py = /python/i.test(n.action); type = 'core.code'; params = py ? { language: 'python', code: `# Imported from Zapier: input_data is each item; return a dict (or set output).\nout = []\nfor input_data in items:\n    output = None\n${String(p.code || '').split('\n').map(l => '    ' + l).join('\n')}\n    out.append(output if output is not None else input_data)\nreturn out` } : { language: 'javascript', code: `// Imported from Zapier: inputData is each item; return an object (or set output).\nreturn items.map(inputData => {\n  let output;\n  const r = (() => {\n${p.code || ''}\n  })();\n  return r ?? output ?? inputData;\n});` }; }
    else if (/^Delay/i.test(api)) { type = 'core.delay'; params = { seconds: 60 }; }
    else if (/^Branching|^Paths/i.test(api)) { made.set(String(n.id), made.get(String(n.parent_id))); continue; }
    else type = appNode(api, isTrigger) || null;
    const node = b.add({ type, name: titles.get(String(n.id)), from: `${api} ${n.action || ''}`.trim(), settings: p, trigger: isTrigger, params: type ? { ...copyParams(type, p, x), ...(params || {}) } : {} });
    made.set(String(n.id), node);
    if (n.parent_id) b.link(made.get(String(n.parent_id)), node);
  }
  return b.done(zap.title || 'Zap', data.zaps && data.zaps.length > 1 ? `${data.zaps.length} Zaps in the file: this is the first.` : '');
}

/* ---- Node-RED: flows.json (an array of nodes, each with wires to the next) ---- */
// In Node-RED a message's payload is what we call the item.
const redCode = func => `// Imported from Node-RED: each item is msg.payload. Return msg (or an array of them), or null to drop it.\nconst out = [];\nconst context = { get: () => undefined, set: () => {} }, flow = context, global = context;\nfor (const payload of items) {\n  const msg = { payload };\n  const node = { warn: console.log, log: console.log, error: console.log, send: m => keep(m) };\n  const keep = m => [].concat(m ?? []).flat().forEach(r => r && out.push(r.payload && typeof r.payload === 'object' ? r.payload : { payload: r.payload }));\n  keep((function (msg) {\n${func || 'return msg;'}\n  })(msg));\n}\nreturn out;`;
const redExpr = v => String(v).replace(/\{\{\{?\s*(?:msg\.)?payload\.?([\w.]*)\s*\}?\}\}/g, (_, p) => `{{ $json${p ? '.' + p : ''} }}`);
const RED_OPS = { eq: 'equals', neq: 'notEquals', cont: 'contains', gt: 'gt', gte: 'gte', lt: 'lt', lte: 'lte', empty: 'isEmpty', nempty: 'isNotEmpty', true: 'isTrue', false: 'isFalse' };
const redPath = p => `{{ $json${String(p || 'payload').replace(/^payload\.?/, '') ? '.' + String(p).replace(/^payload\.?/, '') : ''} }}`;
const RED = {
  inject: n => (Number(n.repeat) > 0 ? { type: 'trigger.schedule', params: { mode: 'interval', every: Math.max(1, Math.round(Number(n.repeat) / 60)), unit: 'minutes' } } : n.crontab ? { type: 'trigger.schedule', params: { mode: 'cron', cron: n.crontab } } : { type: 'trigger.manual' }),
  'http in': n => ({ type: 'trigger.webhook', params: { method: String(n.method || 'post').toUpperCase() === 'GET' ? 'GET' : 'POST', respond: 'end' } }),
  'http response': n => ({ type: 'core.respond', params: { with: 'first', status: Number(n.statusCode) || 200 } }),
  'http request': n => ({ type: 'core.http', params: { method: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(String(n.method).toUpperCase()) ? String(n.method).toUpperCase() : 'GET', url: redExpr(n.url || '') } }),
  function: n => ({ type: 'core.code', params: { language: 'javascript', code: redCode(n.func) } }),
  switch: n => ({ type: 'core.switch', params: { value: redPath(n.property), ...Object.fromEntries((n.rules || []).slice(0, 4).map((r, i) => [`rule${i + 1}`, String(r.v ?? '')])) } }),
  change: n => ({ type: 'core.set', params: { keep: true, fields: (n.rules || []).filter(r => r.t === 'set').map(r => ({ name: String(r.p || '').replace(/^payload\.?/, '') || 'value', value: r.tot === 'msg' ? redPath(r.to) : String(r.to ?? '') })) } }),
  delay: n => ({ type: 'core.delay', params: { seconds: Math.min(60, Number(n.timeout) * (n.timeoutUnits === 'minutes' ? 60 : 1) || 5) } }),
  json: () => ({ type: 'core.json', params: { operation: 'parse', field: 'payload' } }),
  csv: () => ({ type: 'core.csv', params: { operation: 'parse', text: '{{ $json.payload }}' } }),
  split: () => ({ type: 'core.split', params: { field: 'payload' } }),
  join: () => ({ type: 'core.aggregate' }),
  template: n => ({ type: 'core.set', params: { keep: true, fields: [{ name: n.field && n.field !== 'payload' ? String(n.field).replace(/^payload\.?/, '') : 'text', value: redExpr(n.template || '') }] } }),
  debug: () => ({ type: 'core.noop' }), comment: n => ({ type: 'core.note', params: { text: [n.name, n.info].filter(Boolean).join('\n') || 'Note' } }),
  catch: () => ({ type: 'trigger.error' }), 'e-mail': n => ({ type: 'app.email', params: { to: n.name && /@/.test(n.name) ? n.name : '', subject: '{{ $json.topic }}', text: '{{ $json.payload }}' } }),
};
function readNodeRed(list) {
  const b = builder('Node-RED'), byId = new Map();
  const tabs = list.filter(n => n.type === 'tab'), tabY = new Map(tabs.map((t, i) => [t.id, i * 600]));
  const steps = list.filter(n => n.type !== 'tab' && (Array.isArray(n.wires) || 'x' in n) && !/^(group|subflow|junction)$/.test(n.type));
  for (const n of steps) {
    const m = RED[n.type]?.(n), fed = list.some(o => (o.wires || []).flat().includes(n.id));
    // A start: a node nothing feeds that is a trigger (ours, or by its name: "mqtt in", "watch"…).
    const isTrigger = !fed && (m ? !!NODES[m.type]?.trigger : /in$|inject|trigger|watch|listen/i.test(n.type));
    const type = m?.type || appNode(n.type, isTrigger) || null;
    const node = b.add({ type, name: n.name || (type ? NODES[type].label : n.type), from: n.type, settings: Object.fromEntries(Object.entries(n).filter(([k]) => !['id', 'z', 'x', 'y', 'wires', 'g'].includes(k))), trigger: isTrigger,
      x: n.x || 0, y: (n.y || 0) + (tabY.get(n.z) || 0), params: type ? { ...copyParams(type, n, redExpr), ...(m?.params || {}) } : {} });
    byId.set(n.id, node);
  }
  for (const n of steps) (n.wires || []).forEach((targets, i) => (targets || []).forEach(t => { const a = byId.get(n.id); b.link(a, byId.get(t), outputsOf(a.type)[Math.min(i, outputsOf(a.type).length - 1)]); }));
  if (b.nodes.length) place(b.nodes, 1);
  return b.done(tabs[0]?.label || 'Node-RED flow', tabs.length > 1 ? `${tabs.length} Node-RED tabs, one under another.` : '');
}

/* ---- Power Automate / Logic Apps: a workflow definition ({triggers, actions} with runAfter) ---- */
const paName = k => String(k).replace(/_/g, ' ');
// @{triggerBody()?['email']} → {{ $json.body.email }}; body('Get_item')?['x'] → {{ $node["Get item"].json.x }}.
const paInner = e => String(e)
  // ?['x'] and ['x'] first, so the $node["…"] made below keeps its brackets.
  .replace(/\?\[['"]([^'"]+)['"]\]/g, '.$1').replace(/(\w|\))\[['"]([^'"]+)['"]\]/g, '$1.$2')
  .replace(/triggerBody\(\)/g, '$json.body').replace(/triggerOutputs\(\)\??(\[['"]body['"]\])?/g, (_, b) => (b ? '$json.body' : '$json'))
  .replace(/(?:body|outputs|actionBody|actionOutputs)\(\s*'([^']+)'\s*\)/g, (_, n) => `$node["${paName(n)}"].json`)
  .replace(/items\(\s*'[^']+'\s*\)/g, '$json').replace(/item\(\)/g, '$json').replace(/variables\(\s*'([^']+)'\s*\)/g, (_, v) => `$json.${v}`);
const paExpr = v => { const s = String(v); if (/^@[^{]/.test(s)) return `{{ ${paInner(s.slice(1))} }}`; return s.replace(/@\{([^}]*)\}/g, (_, e) => `{{ ${paInner(e)} }}`); };
const PA_OPS = { equals: 'equals', greater: 'gt', greaterOrEquals: 'gte', less: 'lt', lessOrEquals: 'lte', contains: 'contains' };
function paCondition(ex) {
  let c = ex && (ex.and || ex.or) ? (ex.and || ex.or)[0] : ex, neg = false;
  if (c && c.not) { c = c.not; neg = true; }
  const [op] = Object.keys(c || {}), [l, r] = (c && c[op]) || [];
  const mapped = op === 'equals' && neg ? 'notEquals' : op === 'contains' && neg ? 'notContains' : PA_OPS[op] || 'equals';
  return { left: paExpr(l ?? ''), op: mapped, right: paExpr(r ?? '') };
}
function readPowerAutomate(def, name) {
  const b = builder('Power Automate');
  const conn = a => a.inputs?.host?.connectionName || a.inputs?.host?.connection?.name || a.inputs?.host?.apiId || a.inputs?.host?.connectionReferenceName || '';
  let start = null;
  for (const [k, t] of Object.entries(def.triggers || {})) {
    const type = t.type === 'Request' ? 'trigger.webhook' : t.type === 'Recurrence' ? 'trigger.schedule' : /Connection/.test(t.type) ? appNode(conn(t), true) : null;
    const rec = t.recurrence || {}, unit = { Minute: 'minutes', Hour: 'hours', Day: 'days', Week: 'days' }[rec.frequency];
    const params = type === 'trigger.schedule' ? { mode: 'interval', every: (Number(rec.interval) || 1) * (rec.frequency === 'Week' ? 7 : 1), unit: unit || 'hours' } : type === 'trigger.webhook' ? { method: t.inputs?.method || 'POST', respond: 'end' } : {};
    start = b.add({ type, name: paName(k), from: `${t.type}${conn(t) ? ' ' + conn(t) : ''}`, settings: t.inputs, trigger: true, params: type ? { ...copyParams(type, t.inputs, paExpr), ...params } : {} });
    break;
  }
  // A set of actions after `entry` ([{node, port}]); returns the ends, which whatever runs after them follows.
  const addActions = (actions, entry) => {
    const made = new Map(), ends = new Map();
    const list = Object.entries(actions || {});
    const build = k => {
      if (made.has(k)) return;
      const a = actions[k];
      for (const dep of Object.keys(a.runAfter || {})) if (actions[dep]) build(dep);
      const from = Object.keys(a.runAfter || {}).filter(d => actions[d]).flatMap(d => ends.get(d));
      const into = from.length ? from : entry;
      let node, out;
      const t = a.type;
      if (t === 'If') {
        node = b.add({ type: 'core.if', name: paName(k), from: 'If', params: paCondition(a.expression) });
        into.forEach(e => b.link(e.node, node, e.port));
        const yes = addActions(a.actions, [{ node, port: 'true' }]), no = addActions(a.else?.actions, [{ node, port: 'false' }]);
        out = [...(yes.length ? yes : [{ node, port: 'true' }]), ...(no.length ? no : [{ node, port: 'false' }])];
      } else if (t === 'Switch') {
        const cases = Object.entries(a.cases || {});
        node = b.add({ type: 'core.switch', name: paName(k), from: 'Switch', params: { value: paExpr(a.expression ?? ''), ...Object.fromEntries(cases.slice(0, 4).map(([, c], i) => [`rule${i + 1}`, String(c.case ?? '')])) } });
        into.forEach(e => b.link(e.node, node, e.port));
        out = [];
        cases.slice(0, 4).forEach(([, c], i) => { const r = addActions(c.actions, [{ node, port: String(i) }]); out.push(...(r.length ? r : [{ node, port: String(i) }])); });
        const d = addActions(a.default?.actions, [{ node, port: 'other' }]); out.push(...(d.length ? d : [{ node, port: 'other' }]));
      } else if (t === 'Foreach') {
        node = b.add({ type: 'core.split', name: paName(k), from: 'Apply to each', params: { field: paExpr(a.foreach ?? '').replace(/^\{\{\s*\$json\.?|\s*\}\}$/g, '') } });
        into.forEach(e => b.link(e.node, node, e.port));
        const inner = addActions(a.actions, [{ node, port: 'main' }]);
        out = inner.length ? inner : [{ node, port: 'main' }];
      } else if (t === 'Scope' || t === 'Until') {
        const inner = addActions(a.actions, into);
        out = inner.length ? inner : into;
      } else {
        const host = conn(a), opId = a.inputs?.host?.operationId || '';
        const map = {
          Http: () => ({ type: 'core.http', params: { method: String(a.inputs?.method || 'GET').toUpperCase(), url: paExpr(a.inputs?.uri || ''), bodyType: a.inputs?.body ? 'json' : 'none', body: a.inputs?.body ? paExpr(typeof a.inputs.body === 'string' ? a.inputs.body : JSON.stringify(a.inputs.body)) : '' } }),
          Response: () => ({ type: 'core.respond', params: { with: 'text', status: Number(a.inputs?.statusCode) || 200, body: paExpr(typeof a.inputs?.body === 'string' ? a.inputs.body : JSON.stringify(a.inputs?.body ?? '')) } }),
          Compose: () => ({ type: 'core.set', params: { keep: true, fields: [{ name: 'output', value: paExpr(typeof a.inputs === 'string' ? a.inputs : JSON.stringify(a.inputs ?? '')) }] } }),
          InitializeVariable: () => ({ type: 'core.set', params: { keep: true, fields: (a.inputs?.variables || []).map(v => ({ name: v.name, value: paExpr(typeof v.value === 'string' ? v.value : JSON.stringify(v.value ?? '')) })) } }),
          SetVariable: () => ({ type: 'core.set', params: { keep: true, fields: [{ name: a.inputs?.name || 'value', value: paExpr(String(a.inputs?.value ?? '')) }] } }),
          Wait: () => ({ type: 'core.delay', params: { seconds: Math.min(60, Number(a.inputs?.interval?.count) * (a.inputs?.interval?.unit === 'Minute' ? 60 : 1) || 5) } }),
          Terminate: () => ({ type: 'core.stop', params: { message: a.inputs?.runError?.message || '' } }),
          ParseJson: () => ({ type: 'core.json', params: { operation: 'parse', field: 'body' } }),
        }[t];
        const got = map ? map() : /Connection/.test(t) ? { type: appNode(`${host} ${opId}`) } : { type: null };
        node = b.add({ type: got.type, name: paName(k), from: `${t}${host ? ' ' + host : ''}${opId ? ' ' + opId : ''}`, settings: a.inputs,
          params: got.type ? { ...copyParams(got.type, { ...(a.inputs?.parameters || {}), ...(typeof a.inputs === 'object' ? a.inputs : {}) }, paExpr), ...(got.params || {}) } : {} });
        into.forEach(e => b.link(e.node, node, e.port));
        out = [{ node, port: outputsOf(node.type)[0] }];
      }
      made.set(k, node); ends.set(k, out);
    };
    list.forEach(([k]) => build(k));
    // The ends: actions nothing else here runs after.
    const after = new Set(list.flatMap(([, a]) => Object.keys(a.runAfter || {})));
    return list.filter(([k]) => !after.has(k)).flatMap(([k]) => ends.get(k) || []);
  };
  addActions(def.actions, start ? [{ node: start, port: 'main' }] : []);
  return b.done(name || 'Power Automate flow');
}

/* ---- which app made the file ---- */
export function readForeign(data) {
  if (data && Array.isArray(data.flow) && data.flow.some(m => m && typeof m.module === 'string')) return readMake(data);
  if (data && Array.isArray(data.zaps) && data.zaps[0]?.nodes) return readZapier(data);
  if (data && data.nodes && !Array.isArray(data.nodes) && Object.values(data.nodes).some(n => n && n.selected_api)) return readZapier(data);
  if (Array.isArray(data) && data.length && data.every(n => n && typeof n === 'object' && typeof n.type === 'string' && 'id' in n) && data.some(n => Array.isArray(n.wires) || n.type === 'tab')) return readNodeRed(data);
  const def = data?.definition || data?.properties?.definition || (data?.triggers && data?.actions ? data : null);
  if (def && (def.triggers || def.actions)) return readPowerAutomate(def, data?.properties?.displayName || data?.name);
  return null;
}
