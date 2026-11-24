import { test, expect } from '@playwright/test';
import { importFlow } from '../frontend/src/lib/flowio.js';
import { appNode } from '../frontend/src/lib/flowimport.js';
import { NODES, inputsOf, outputsOf } from '../frontend/src/lib/flows.js';
import { runFlow } from '../backend/flow-engine.js';
import { NODE_TYPES } from '../backend/flow-nodes.js';

// Workflows exported from other automation apps come in as Workline workflows: their steps as our nodes,
// their links as edges, their expressions rewritten, and what we have no node for kept as a placeholder.

const byName = (r, name) => r.flow.nodes.find(n => n.name === name);
const linked = (r, a, b, port) => r.flow.edges.some(e => e.from === byName(r, a).id && e.to === byName(r, b).id && (!port || e.fromPort === port));
// Every imported flow is well formed: known node types, edges between real nodes on real ports.
function wellFormed(r) {
  const ids = new Set(r.flow.nodes.map(n => n.id));
  for (const n of r.flow.nodes) { expect(NODES[n.type], n.type).toBeTruthy(); expect(typeof n.x).toBe('number'); expect(n.note, n.name).toMatch(/^From /); }
  for (const e of r.flow.edges) {
    expect(ids.has(e.from) && ids.has(e.to)).toBe(true);
    const a = r.flow.nodes.find(n => n.id === e.from), b = r.flow.nodes.find(n => n.id === e.to);
    expect(outputsOf(a.type)).toContain(e.fromPort);
    expect(inputsOf(b.type)).toContain(e.toPort);
  }
}
const runCode = async (code, items) => {
  const flow = { nodes: [{ id: 't', type: 'trigger.manual', name: 'Start' }, { id: 'c', type: 'core.code', name: 'Code', params: { language: 'javascript', code } }], edges: [{ from: 't', to: 'c' }] };
  const r = await runFlow(flow, { startId: 't', input: items.map(json => ({ json })), types: NODE_TYPES });
  if (r.status !== 'success') throw new Error(r.error);
  return r.nodes.c.output.main;
};

test('apps are matched by name', () => {
  expect(appNode('slack:CreateMessage')).toBe('app.slack');
  expect(appNode('GoogleSheetsV2CLIAPI')).toBe('google.sheets');
  expect(appNode('shared_teams')).toBe('app.teams');
  expect(appNode('gmail', true)).toBe('trigger.email');
  expect(appNode('github', true)).toBe('trigger.github');
  expect(appNode('somethingRare')).toBe(null);
});

test('n8n: more file shapes, apps by name, IF conditions and $() expressions', () => {
  const wf = name => ({ name, nodes: [
    { name: 'Slack Trigger', type: 'n8n-nodes-base.slackTrigger', position: [0, 0], parameters: {} },
    { name: 'Paid?', type: 'n8n-nodes-base.if', position: [300, 0], parameters: { conditions: { conditions: [{ leftValue: '={{ $json.status }}', rightValue: 'paid', operator: { type: 'string', operation: 'equals' } }] } } },
    { name: 'Notify', type: 'n8n-nodes-base.pushover', position: [600, 0], parameters: { message: '={{ $(\'Slack Trigger\').item.json.text }}' } },
    { name: 'Odd', type: 'n8n-nodes-base.mqttTrigger', position: [0, 300], parameters: { topics: 'a/b' } },
  ], connections: { 'Slack Trigger': { main: [[{ node: 'Paid?', type: 'main', index: 0 }]] }, 'Paid?': { main: [[{ node: 'Notify', type: 'main', index: 0 }], []] } } });
  // A list of workflows (n8n's CLI export), wrapped in {data}: the first, and a note about the rest.
  const r = importFlow(JSON.stringify({ data: [wf('One'), wf('Two')] }));
  expect(r.app).toBe('n8n');
  expect(r.name).toBe('One');
  expect(r.more).toMatch('2 workflows');
  wellFormed(r);
  expect(byName(r, 'Slack Trigger').type).toBe('trigger.slack');
  expect(byName(r, 'Paid?').params).toMatchObject({ left: '{{ $json.status }}', op: 'equals', right: 'paid' });
  expect(byName(r, 'Notify').type).toBe('pushover');
  expect(byName(r, 'Notify').params.message).toBe('{{ $node["Slack Trigger"].json.text }}');
  expect(linked(r, 'Paid?', 'Notify', 'true')).toBe(true);
  // A trigger we don't have: Run by hand, saying what it was.
  expect(byName(r, 'Odd').type).toBe('trigger.manual');
  expect(byName(r, 'Odd').note).toMatch('mqttTrigger');
  expect(byName(r, 'Odd').note).toMatch('a/b');
  expect(r.skipped).toEqual(['n8n-nodes-base.mqttTrigger']);
});

test('Make: a scenario blueprint, with a router, a filter and {{1.x}} mappings', () => {
  const r = importFlow(JSON.stringify({ name: 'Orders', flow: [
    { id: 1, module: 'gateway:CustomWebHook', version: 1, parameters: { hook: 123 }, mapper: {}, metadata: { designer: { x: 0, y: 0 } } },
    { id: 2, module: 'builtin:BasicRouter', version: 1, mapper: null, metadata: { designer: { x: 300, y: 0 } }, routes: [
      { flow: [{ id: 3, module: 'slack:CreateMessage', version: 4, parameters: {}, mapper: { channel: 'C123', text: 'New order {{1.id}} from {{1.customer.name}}' }, metadata: { designer: { x: 600, y: -150 } },
        filter: { name: 'Big orders', conditions: [[{ a: '{{1.total}}', o: 'number:greater', b: '1000' }]] } }] },
      { flow: [{ id: 4, module: 'google-sheets:addRow', version: 2, parameters: {}, mapper: { spreadsheetId: '1Bx', values: { 0: '{{1.id}}' } }, metadata: { designer: { x: 600, y: 150 } } },
        { id: 5, module: 'pdfco:convert', version: 1, parameters: {}, mapper: { url: '{{4.link}}' }, metadata: { designer: { x: 900, y: 150 } } }] },
    ] },
  ], metadata: { version: 1 } }));
  expect(r.app).toBe('Make');
  expect(r.name).toBe('Orders');
  wellFormed(r);
  const types = r.flow.nodes.map(n => n.type);
  expect(types).toEqual(['trigger.webhook', 'core.filter', 'app.slack', 'google.sheets', 'core.noop']);
  const hook = r.flow.nodes[0], filter = r.flow.nodes[1], slack = r.flow.nodes[2], sheets = r.flow.nodes[3], pdf = r.flow.nodes[4];
  // The router's routes: both from the webhook; the filter sits before Slack.
  expect(filter.params).toEqual({ left: `{{ $node["${hook.name}"].json.total }}`, op: 'gt', right: '1000' });
  expect(slack.params.channel).toBe('C123');
  expect(slack.params.text).toBe(`New order {{ $node["${hook.name}"].json.id }} from {{ $node["${hook.name}"].json.customer.name }}`);
  expect(sheets.params.spreadsheetId).toBe('1Bx');
  const from = n => r.flow.edges.filter(e => e.to === n.id).map(e => e.from);
  expect(from(filter)).toEqual([hook.id]);
  expect(from(slack)).toEqual([filter.id]);
  expect(from(sheets)).toEqual([hook.id]);
  expect(from(pdf)).toEqual([sheets.id]);
  expect(pdf.note).toMatch('pdfco:convert');
  expect(r.skipped).toEqual(['pdfco:convert']);
});

test('Zapier: a Zap export, steps in a line, {{id__field}} mappings, and a Code step that runs', async () => {
  const code = 'const total = Number(inputData.total) * 2;\nreturn { ...inputData, total };';
  const r = importFlow(JSON.stringify({ metadata: { version: 2 }, zaps: [{ id: 9, title: 'Leads', nodes: {
    1: { id: 1, parent_id: null, root_id: null, type_of: 'read', selected_api: 'WebHookCLIAPI@1.0.0', action: 'hook_v2', params: {}, title: 'Catch hook' },
    2: { id: 2, parent_id: 1, root_id: 1, type_of: 'filter', selected_api: 'FilterAPI', action: 'filter', params: { filter_criteria: [[{ key: '{{1__body__plan}}', match: 'text_exactly_matches', value: 'pro' }]] }, title: null },
    3: { id: 3, parent_id: 2, root_id: 1, type_of: 'write', selected_api: 'CodeCLIAPI@1.0.0', action: 'run_javascript', params: { code }, title: 'Double it' },
    4: { id: 4, parent_id: 3, root_id: 1, type_of: 'write', selected_api: 'SlackCLIAPI@1.26.4', action: 'channel_message', params: { channel: '#leads', text: 'Lead {{1__body__email}}: {{3__total}}' }, title: 'Tell sales' },
  } }, { id: 10, title: 'Other', nodes: {} }] }));
  expect(r.app).toBe('Zapier');
  expect(r.name).toBe('Leads');
  expect(r.more).toMatch('2 Zaps');
  wellFormed(r);
  expect(r.flow.nodes.map(n => n.type)).toEqual(['trigger.webhook', 'core.filter', 'core.code', 'app.slack']);
  expect(linked(r, 'Catch hook', r.flow.nodes[1].name)).toBe(true);
  expect(linked(r, 'Double it', 'Tell sales')).toBe(true);
  expect(r.flow.nodes[1].params).toEqual({ left: '{{ $node["Catch hook"].json.body.plan }}', op: 'equals', right: 'pro' });
  expect(byName(r, 'Tell sales').params).toMatchObject({ channel: '#leads', text: 'Lead {{ $node["Catch hook"].json.body.email }}: {{ $node["Double it"].json.total }}' });
  // Zapier's code reads inputData and returns an object: it runs as is.
  expect(await runCode(byName(r, 'Double it').params.code, [{ total: 5, n: 1 }])).toEqual([{ total: 10, n: 1 }]);
});

test('Node-RED: flows.json, with wires, a switch and a function node that runs', async () => {
  const r = importFlow(JSON.stringify([
    { id: 'tab1', type: 'tab', label: 'Orders' },
    { id: 'a', z: 'tab1', type: 'http in', name: 'Order hook', url: '/order', method: 'post', x: 100, y: 100, wires: [['b']] },
    { id: 'b', z: 'tab1', type: 'function', name: 'Add tax', func: 'msg.payload.tax = msg.payload.total * 0.18;\nreturn msg;', outputs: 1, x: 300, y: 100, wires: [['c']] },
    { id: 'c', z: 'tab1', type: 'switch', name: 'Size', property: 'payload.size', rules: [{ t: 'eq', v: 'big' }, { t: 'eq', v: 'small' }], x: 500, y: 100, wires: [['d'], ['e']] },
    { id: 'd', z: 'tab1', type: 'http response', name: 'Reply', statusCode: '201', x: 700, y: 60, wires: [] },
    { id: 'e', z: 'tab1', type: 'mqtt out', name: 'Publish', topic: 'orders/small', x: 700, y: 140, wires: [] },
    { id: 'cfg', type: 'mqtt-broker', name: 'broker', broker: 'localhost' },
  ]));
  expect(r.app).toBe('Node-RED');
  expect(r.name).toBe('Orders');
  wellFormed(r);
  expect(r.flow.nodes.map(n => [n.name, n.type])).toEqual([['Order hook', 'trigger.webhook'], ['Add tax', 'core.code'], ['Size', 'core.switch'], ['Reply', 'core.respond'], ['Publish', 'core.noop']]);
  expect(byName(r, 'Size').params).toMatchObject({ value: '{{ $json.size }}', rule1: 'big', rule2: 'small' });
  expect(linked(r, 'Size', 'Reply', '0')).toBe(true);
  expect(linked(r, 'Size', 'Publish', '1')).toBe(true);
  expect(byName(r, 'Reply').params.status).toBe(201);
  expect(byName(r, 'Publish').note).toMatch('orders/small');
  // The function runs on each item as msg.payload.
  expect(await runCode(byName(r, 'Add tax').params.code, [{ total: 100 }])).toEqual([{ total: 100, tax: 18 }]);
});

test('Power Automate / Logic Apps: triggers, runAfter, If with both branches, and @{} expressions', () => {
  const r = importFlow(JSON.stringify({ properties: { displayName: 'Approvals', definition: {
    triggers: { manual: { type: 'Request', kind: 'Http', inputs: { schema: {} } } },
    actions: {
      Check_amount: { type: 'If', runAfter: {}, expression: { and: [{ greater: ["@triggerBody()?['amount']", 1000] }] },
        actions: { Post_to_Teams: { type: 'OpenApiConnection', runAfter: {}, inputs: { host: { connectionName: 'shared_teams', operationId: 'PostMessageToConversation' }, parameters: { 'body/messageBody': "Big request: @{triggerBody()?['amount']}" } } } },
        else: { actions: { Approve: { type: 'Compose', runAfter: {}, inputs: 'auto-approved' } } } },
      Reply: { type: 'Response', runAfter: { Check_amount: ['Succeeded'] }, inputs: { statusCode: 200, body: "@{body('Approve')}" } },
      Save_file: { type: 'OpenApiConnection', runAfter: { Reply: ['Succeeded'] }, inputs: { host: { connectionName: 'shared_onedriveforbusiness', operationId: 'CreateFile' } } },
    },
  } } }));
  expect(r.app).toBe('Power Automate');
  expect(r.name).toBe('Approvals');
  wellFormed(r);
  expect(r.flow.nodes.map(n => [n.name, n.type])).toEqual([['manual', 'trigger.webhook'], ['Check amount', 'core.if'], ['Post to Teams', 'app.teams'], ['Approve', 'core.set'], ['Reply', 'core.respond'], ['Save file', 'core.noop']]);
  expect(byName(r, 'Check amount').params).toEqual({ left: '{{ $json.body.amount }}', op: 'gt', right: '1000' });
  expect(linked(r, 'Check amount', 'Post to Teams', 'true')).toBe(true);
  expect(linked(r, 'Check amount', 'Approve', 'false')).toBe(true);
  // What runs after the If follows both branches' ends.
  expect(linked(r, 'Post to Teams', 'Reply')).toBe(true);
  expect(linked(r, 'Approve', 'Reply')).toBe(true);
  expect(byName(r, 'Reply').params.body).toBe('{{ $node["Approve"].json }}');
  expect(byName(r, 'Save file').note).toMatch('shared_onedriveforbusiness');
});

test('a file from somewhere else is refused, saying what can be read', () => {
  expect(() => importFlow('{"hello": 1}')).toThrow('Make, Zapier, Node-RED and Power Automate');
  expect(() => importFlow('not json')).toThrow('isn’t JSON');
});
