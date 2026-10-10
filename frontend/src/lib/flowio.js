import { rid } from './utils.js';
import { NODES, inputsOf, nodeDef, outputsOf, secretPath } from './flows.js';

/* Workflows in and out of Workline: a .json file of our own, and n8n's exported workflows coming in.
   An export carries no credentials (only which kind each node needs); an import gets fresh ids. */

// A workflow as a file to keep or share.
export function exportFlow(file) {
  const flow = file.flow || { nodes: [], edges: [] };
  return JSON.stringify({
    workline: 'workflow', version: 1, name: file.title || 'Workflow', exported: new Date().toISOString(),
    flow: {
      nodes: flow.nodes.map(({ credential, ...n }) => ({ ...n, params: bare(n), ...(credential ? { credentialType: nodeDef(n.type).credential?.[0] } : {}) })),
      edges: flow.edges,
    },
  }, null, 2);
}
// A node's params without its secrets: signing secrets, and a webhook's URL (a new one is made on import).
const bare = n => {
  const secret = new Set(['path', ...(nodeDef(n.type).fields || []).filter(f => f.secret).map(f => f.k)]);
  return Object.fromEntries(Object.entries(n.params || {}).filter(([k]) => !secret.has(k)));
};
// Fresh secrets for nodes that listen at a URL.
const rekey = n => (NODES[n.type]?.defaults?.().path ? { ...n, params: { ...n.params, path: secretPath() } } : n);
// A workflow's nodes and edges, as a template (Home → Templates) (no credentials, secrets or URLs); and a new flow from one.
export const templateOf = file => JSON.parse(exportFlow(file)).flow;
export const fromTemplate = flow => importFlow(JSON.stringify({ workline: 'workflow', flow })).flow;
// What a finished run gave: each node's items, by name.
export function exportRun(file, run) {
  const names = new Map((file.flow?.nodes || []).map(n => [n.id, n.name]));
  return JSON.stringify({
    workflow: file.title || 'Workflow', run: run.id, status: run.status,
    started: run.started ? new Date(run.started).toISOString() : undefined, finished: run.finished ? new Date(run.finished).toISOString() : undefined, error: run.error || undefined,
    nodes: Object.fromEntries(Object.entries(run.nodes || {}).map(([id, r]) => [names.get(id) || id, r.status === 'error' ? { error: r.error } : r.output?.main || r.output || []])),
  }, null, 2);
}
export function download(name, text, ext = 'workflow') {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  a.download = `${String(name || 'workflow').replace(/[\\/:*?"<>|]+/g, ' ').trim() || 'workflow'}.${ext}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// n8n node types we have a node for, and how their params map onto ours.
const N8N = {
  manualTrigger: { type: 'trigger.manual' },
  start: { type: 'trigger.manual' },
  webhook: { type: 'trigger.webhook', params: p => ({ method: p.httpMethod || 'POST' }) },
  scheduleTrigger: { type: 'trigger.schedule' },
  cron: { type: 'trigger.schedule' },
  formTrigger: { type: 'trigger.form', params: p => ({ title: p.formTitle || '' }) },
  rssFeedReadTrigger: { type: 'trigger.rss', params: p => ({ url: p.feedUrl || '' }) },
  githubTrigger: { type: 'trigger.github' },
  stripeTrigger: { type: 'trigger.stripe' },
  shopifyTrigger: { type: 'trigger.shopify' },
  telegramTrigger: { type: 'trigger.telegram' },
  if: { type: 'core.if' },
  switch: { type: 'core.switch' },
  filter: { type: 'core.filter' },
  merge: { type: 'core.merge' },
  splitOut: { type: 'core.split', params: p => ({ field: p.fieldToSplitOut || '' }) },
  itemLists: { type: 'core.split' },
  splitInBatches: { type: 'core.chunk', params: p => ({ size: p.batchSize || 10 }) },
  limit: { type: 'core.limit', params: p => ({ max: p.maxItems || 1 }) },
  sort: { type: 'core.sort' },
  removeDuplicates: { type: 'core.dedupe' },
  aggregate: { type: 'core.aggregate' },
  summarize: { type: 'core.summarize' },
  set: { type: 'core.set', params: p => ({ fields: (p.assignments?.assignments || p.values?.string || []).map(a => ({ name: a.name, value: n8nExpr(a.value) })), keep: true }) },
  renameKeys: { type: 'core.rename' },
  dateTime: { type: 'core.datetime' },
  crypto: { type: 'core.crypto' },
  wait: { type: 'core.delay', params: p => ({ seconds: Math.min(60, Number(p.amount) || 5) }) },
  noOp: { type: 'core.noop' },
  stopAndError: { type: 'core.stop', params: p => ({ message: p.errorMessage || '' }) },
  executeWorkflow: { type: 'core.subflow' },
  code: { type: 'core.code', params: p => ({ code: n8nCode(p.jsCode || '') }) },
  function: { type: 'core.code', params: p => ({ code: n8nCode(p.functionCode || '') }) },
  httpRequest: { type: 'core.http', params: p => ({ method: p.method || p.requestMethod || 'GET', url: n8nExpr(p.url || ''), query: [], headers: [], bodyType: 'json', body: '', failOnError: true }) },
  rssFeedRead: { type: 'data.rss', params: p => ({ url: p.url || '' }) },
  slack: { type: 'app.slack', params: p => ({ channel: p.channelId?.value || p.channel || '', text: n8nExpr(p.text || '') }) },
  discord: { type: 'app.discord', params: p => ({ content: n8nExpr(p.content || p.text || '') }) },
  telegram: { type: 'app.telegram', params: p => ({ chatId: n8nExpr(p.chatId || ''), text: n8nExpr(p.text || '') }) },
  github: { type: 'app.github' },
  gitlab: { type: 'gitlab' },
  notion: { type: 'app.notion' },
  emailSend: { type: 'app.email', params: p => ({ to: n8nExpr(p.toEmail || ''), subject: n8nExpr(p.subject || ''), text: n8nExpr(p.text || '') }) },
  gmail: { type: 'app.email' },
  postgres: { type: 'app.database', params: p => ({ sql: n8nExpr(p.query || '') }) },
  mySql: { type: 'app.database', params: p => ({ sql: n8nExpr(p.query || '') }) },
  microsoftSql: { type: 'app.database', params: p => ({ sql: n8nExpr(p.query || '') }) },
  mongoDb: { type: 'app.database' },
  googleSheets: { type: 'google.sheets' },
  googleCalendar: { type: 'google.calendar' },
  airtable: { type: 'airtable' },
  trello: { type: 'trello' },
  asana: { type: 'asana' },
  clickUp: { type: 'clickup' },
  todoist: { type: 'todoist' },
  hubspot: { type: 'hubspot' },
  pipedrive: { type: 'pipedrive' },
  stripe: { type: 'stripe' },
  shopify: { type: 'shopify' },
  twilio: { type: 'twilio' },
  sendGrid: { type: 'sendgrid' },
  mailchimp: { type: 'mailchimp' },
  jira: { type: 'jira' },
  supabase: { type: 'supabase' },
  dropbox: { type: 'dropbox' },
  microsoftTeams: { type: 'app.teams' },
  googleChat: { type: 'app.googlechat' },
  mattermost: { type: 'app.mattermost' },
  whatsApp: { type: 'whatsapp' },
  zendesk: { type: 'zendesk' },
  wordpress: { type: 'wordpress' },
  openAi: { type: 'openai', params: p => ({ prompt: n8nExpr(p.prompt || p.text || '') }) },
  lmChatOpenAi: { type: 'openai' },
  anthropic: { type: 'ai.claude' },
  mailgun: { type: 'mailgun' },
  postmark: { type: 'postmark' },
  deepL: { type: 'deepl' },
  bitly: { type: 'bitly' },
  pushover: { type: 'pushover' },
};
// n8n writes expressions as ={{ $json.x }}; ours are the same without the leading "=".
const n8nExpr = v => (typeof v === 'string' && v.startsWith('=') ? v.slice(1) : v);
// n8n's Code node reads $input.all() (items with .json); ours gets the json objects themselves.
const n8nCode = code => `// Imported from n8n: \`items\` here are the items' JSON (n8n's $input.all().map(i => i.json)).\nconst $input = { all: () => items.map(json => ({ json })), first: () => ({ json: items[0] }) };\n${code}`;

// Read a workflow file (ours or n8n's) into {flow, name, skipped: [n8n types we don't have]}.
export function importFlow(text) {
  let data;
  try { data = JSON.parse(text); } catch (e) { throw new Error('That file isn’t JSON.'); }
  if (data && data.workline === 'workflow' && data.flow) {
    const ids = new Map();
    const nodes = (data.flow.nodes || []).filter(n => NODES[n.type]).map(({ credentialType, ...n }) => { const id = rid('n'); ids.set(n.id, id); return rekey({ ...n, id, params: n.params || {} }); });
    const edges = (data.flow.edges || []).filter(e => ids.has(e.from) && ids.has(e.to)).map(e => ({ ...e, id: rid('e'), from: ids.get(e.from), to: ids.get(e.to) }));
    return { flow: { active: false, nodes, edges }, name: data.name, skipped: [] };
  }
  if (data && Array.isArray(data.nodes) && data.connections) {
    const skipped = [], byName = new Map();
    const nodes = data.nodes.filter(n => !/stickyNote/i.test(n.type || '')).map(n => {
      const short = String(n.type || '').split('.').pop();
      const m = N8N[short];
      const [x = 0, y = 0] = Array.isArray(n.position) ? n.position : [];
      const node = m && NODES[m.type]
        ? { id: rid('n'), type: m.type, name: n.name, x, y, params: { ...(NODES[m.type].defaults ? NODES[m.type].defaults() : {}), ...(m.params ? m.params(n.parameters || {}) : {}) } }
        : (skipped.push(n.type), { id: rid('n'), type: 'core.noop', name: n.name, x, y, params: {}, note: `From n8n: ${n.type}` });
      byName.set(n.name, node);
      return node;
    });
    const edges = [];
    for (const [from, outs] of Object.entries(data.connections)) {
      const a = byName.get(from);
      if (!a) continue;
      (outs.main || []).forEach((targets, i) => (targets || []).forEach(t => {
        const b = byName.get(t.node);
        if (!b) return;
        const ports = outputsOf(a.type), ins = inputsOf(b.type);
        if (!ins.length) return;
        edges.push({ id: rid('e'), from: a.id, fromPort: ports[Math.min(i, ports.length - 1)], to: b.id, toPort: ins[Math.min(t.index || 0, ins.length - 1)] });
      }));
    }
    // n8n's canvas is larger: bring it nearer our scale.
    const minX = Math.min(...nodes.map(n => n.x)), minY = Math.min(...nodes.map(n => n.y));
    for (const n of nodes) { n.x = Math.round((n.x - minX) * .8 + 80); n.y = Math.round((n.y - minY) * .8 + 120); }
    return { flow: { active: false, nodes, edges }, name: data.name, skipped: [...new Set(skipped)] };
  }
  throw new Error('That isn’t a Workline or n8n workflow file.');
}

// A flow ready to sit beside (not on top of) the nodes already there.
export function besides(existing, flow) {
  if (!existing.length) return flow;
  const right = Math.max(...existing.map(n => n.x)) + 260;
  const left = Math.min(...flow.nodes.map(n => n.x));
  return { ...flow, nodes: flow.nodes.map(n => ({ ...n, x: n.x - left + right })) };
}
