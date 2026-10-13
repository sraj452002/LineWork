import { test, expect } from '@playwright/test';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { runFlow } from '../backend/flow-engine.js';
import { NODE_TYPES } from '../backend/flow-nodes.js';
import { EXTRA_NODES } from '../backend/flow-extra.js';
import { openStore } from '../backend/store.js';
import { memoryBackend } from '../backend/drive.js';
import { createApp } from '../backend/app.js';

// The newer generic workflow nodes: AI helpers (against a stand-in for Claude), MCP, GraphQL, spreadsheet
// files, pivot, text splitter, key-value store, Redis, per-node error handling, Respond to webhook, On error,
// and New database row. Live Redis and PostgreSQL tests run when LINEWORK_TEST_REDIS / LINEWORK_TEST_PG are set.

const ExcelJS = createRequire(new URL('../backend/package.json', import.meta.url))('exceljs');
const TYPES = { ...NODE_TYPES, ...EXTRA_NODES };
let fake, url, claudeCalls = [], mcpCalls = [];

test.beforeAll(async () => {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Sales');
  ws.addRows([['Region', 'Amount', 'When'], ['North', 120, new Date(Date.UTC(2026, 0, 2))], ['South', 80.5, new Date(Date.UTC(2026, 0, 3))]]);
  const xlsx = Buffer.from(await wb.xlsx.writeBuffer());
  fake = createServer((req, res) => {
    let body = '';
    req.on('data', c => { body += c; });
    req.on('end', () => {
      const json = (status, o, headers = {}) => { res.writeHead(status, { 'content-type': 'application/json', ...headers }); res.end(JSON.stringify(o)); };
      if (req.url === '/v1/messages') {
        const b = JSON.parse(body), sys = b.system || '', content = b.messages[0].content;
        claudeCalls.push(b);
        const text = Array.isArray(content) ? 'A cat on a mat. Text: HELLO'
          : /^Summarise/.test(sys) ? 'A short summary.'
          : /^Pull these fields/.test(sys) ? 'Sure: {"name": "Ada Lovelace", "total": 42}'
          : /^Sort the text/.test(sys) ? (/any of/.test(sys) ? '{"categories": ["billing", "Bug", "nope"], "confidence": 0.7}' : '```json\n{"category": "billing", "confidence": 0.9}\n```')
          : /^Rewrite/.test(sys) ? 'Dear team, thank you.'
          : /^Translate/.test(sys) ? 'नमस्ते'
          : /^Decide/.test(sys) ? '{"decision": "NO", "reasoning": "The order shipped."}'
          : /^Score/.test(sys) ? JSON.stringify({ score: content.length, reason: 'longer is better' }) : '?';
        return json(200, { content: [{ type: 'text', text }] });
      }
      if (req.url === '/mcp') {
        const m = JSON.parse(body);
        mcpCalls.push({ method: m.method, session: req.headers['mcp-session-id'] || null, auth: req.headers.authorization || null });
        if (!('id' in m)) { res.writeHead(202); return res.end(); }
        if (m.method === 'initialize') return json(200, { jsonrpc: '2.0', id: m.id, result: { protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'fake' } } }, { 'mcp-session-id': 'sess-1' });
        if (m.method === 'tools/list') return json(200, { jsonrpc: '2.0', id: m.id, result: { tools: [{ name: 'add', description: 'Adds numbers', inputSchema: { type: 'object' } }] } });
        if (m.method === 'tools/call') {
          const { a, b } = m.params.arguments;
          const result = m.params.name === 'add' ? { content: [{ type: 'text', text: JSON.stringify({ sum: a + b }) }] } : { content: [{ type: 'text', text: 'no such tool' }], isError: true };
          res.writeHead(200, { 'content-type': 'text/event-stream' });
          return res.end(`event: message\ndata: ${JSON.stringify({ jsonrpc: '2.0', id: m.id, result })}\n\n`);
        }
      }
      if (req.url === '/graphql') {
        const { query, variables } = JSON.parse(body);
        if (/broken/.test(query)) return json(200, { errors: [{ message: 'Cannot query field "broken"' }] });
        return json(200, { data: { user: { id: variables.id, name: 'Ada', repos: [{ name: 'one' }, { name: 'two' }] } } });
      }
      if (req.url === '/report.xlsx') { res.writeHead(200, { 'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }); return res.end(xlsx); }
      if (req.url === '/report.csv') { res.writeHead(200, { 'content-type': 'text/csv' }); return res.end('name,city\n"Lovelace, Ada",London\nGrace,"New\nYork"\n'); }
      json(404, { error: 'nope' });
    });
  }).listen(0);
  url = `http://localhost:${fake.address().port}`;
});
test.afterAll(() => fake?.close());

const memoryKv = () => { const m = {}; return { get: k => m[k], set: (k, v) => { m[k] = v; }, del: k => { delete m[k]; }, list: p => Object.fromEntries(Object.entries(m).filter(([k]) => k.startsWith(p))) }; };
const ctx = (extra = {}) => ({ allowPrivate: true, ai: { key: 'k', base: url, model: 'test-model', allow: () => true }, kv: memoryKv(), ...extra });
const one = async (type, params, items, c = ctx(), extra = {}) => {
  const flow = { nodes: [{ id: 't', type: 'trigger.manual', name: 'Start' }, { id: 'n', type, name: 'Node', params, ...extra }], edges: [{ from: 't', to: 'n', fromPort: 'main', toPort: 'main' }] };
  const r = await runFlow(flow, { startId: 't', input: items.map(json => ({ json })), types: TYPES, ctx: c });
  if (r.status !== 'success') throw new Error(r.error);
  return r.nodes.n.output;
};

test('AI helpers: summarize, extract, classify, rewrite, translate, read an image, decide, score', async () => {
  expect((await one('ai.summarize', { text: '{{ $json.body }}', length: 'bullets' }, [{ body: 'Long text', id: 1 }])).main).toEqual([{ body: 'Long text', id: 1, summary: 'A short summary.' }]);
  expect(claudeCalls.at(-1).system).toMatch(/bullet points/);
  expect(claudeCalls.at(-1).model).toBe('test-model');
  expect((await one('ai.extract', { text: 'Ada paid 42', fields: [{ name: 'name', value: 'full name' }, { name: 'total', value: 'a number' }, { name: 'missing' }] }, [{ id: 7 }])).main)
    .toEqual([{ id: 7, name: 'Ada Lovelace', total: 42, missing: null }]);
  expect((await one('ai.classify', { text: 'Please refund me', categories: 'Billing, Bug, Other' }, [{}])).main).toEqual([{ category: 'Billing', categoryConfidence: 0.9 }]);
  expect((await one('ai.classify', { text: 'x', categories: 'Billing, Bug', multiple: true, output: 'labels' }, [{}])).main).toEqual([{ labels: ['Billing', 'Bug'], labelsConfidence: 0.7 }]);
  await expect(one('ai.classify', { text: 'x', categories: 'only one' }, [{}])).rejects.toThrow(/at least two/);
  expect((await one('ai.rewrite', { text: 'thx', style: 'formal' }, [{}])).main[0].text).toBe('Dear team, thank you.');
  expect(claudeCalls.at(-1).system).toMatch(/formal and professional/);
  expect((await one('ai.translate', { text: 'Hello', language: 'Hindi' }, [{}])).main[0].translation).toBe('नमस्ते');
  expect((await one('ai.vision', { imageUrl: 'https://example.com/cat.png' }, [{}])).main[0].answer).toMatch(/HELLO/);
  expect(claudeCalls.at(-1).messages[0].content[0]).toEqual({ type: 'image', source: { type: 'url', url: 'https://example.com/cat.png' } });
  await expect(one('ai.vision', { imageUrl: 'http://example.com/cat.png' }, [{}])).rejects.toThrow(/https/);
  expect((await one('ai.decide', { question: 'Refund?', options: 'yes, no' }, [{ order: 1 }])).main).toEqual([{ order: 1, decision: 'no', reasoning: 'The order shipped.' }]);
  const ranked = (await one('ai.score', { criteria: 'detail', text: '{{ $json.text }}', max: 10 }, [{ text: 'ab' }, { text: 'abcdefgh' }, { text: 'abcdefghijklmnop' }])).main;
  expect(ranked.map(r => r.score)).toEqual([10, 8, 2]); // capped at the maximum, best first
  // No AI key, or no allowance left.
  await expect(one('ai.summarize', { text: 'x' }, [{}], ctx({ ai: {} }))).rejects.toThrow(/AI is off/);
  await expect(one('ai.summarize', { text: 'x' }, [{}], ctx({ ai: { key: 'k', base: url, allow: () => false } }))).rejects.toThrow(/allowance/);
});

test('MCP tool: lists tools and calls one, keeping the session, over a streamed answer', async () => {
  expect((await one('ai.mcp', { operation: 'list', url: `${url}/mcp` }, [{}])).main).toEqual([{ name: 'add', description: 'Adds numbers', inputSchema: { type: 'object' } }]);
  mcpCalls = [];
  const got = (await one('ai.mcp', { url: `${url}/mcp`, tool: 'add', arguments: '{ "a": {{ $json.a }}, "b": 3 }' }, [{ a: 2 }])).main[0];
  expect(got.data).toEqual({ sum: 5 });
  expect(mcpCalls.map(c => [c.method, c.session])).toEqual([['initialize', null], ['notifications/initialized', 'sess-1'], ['tools/call', 'sess-1']]);
  await expect(one('ai.mcp', { url: `${url}/mcp`, tool: 'nope', arguments: '{"a":1,"b":2}' }, [{}])).rejects.toThrow(/The tool failed: no such tool/);
});

test('GraphQL, spreadsheet files, pivot, text splitter, key-value store and sticky note', async () => {
  expect((await one('core.graphql', { url: `${url}/graphql`, query: 'query ($id: ID!) { user(id: $id) { name } }', variables: '{ "id": "{{ $json.id }}" }' }, [{ id: 'u1' }])).main[0])
    .toMatchObject({ user: { id: 'u1', name: 'Ada' } });
  expect((await one('core.graphql', { url: `${url}/graphql`, query: '{ user { repos { name } } }', variables: '{}', path: 'user.repos' }, [{}])).main).toEqual([{ name: 'one' }, { name: 'two' }]);
  await expect(one('core.graphql', { url: `${url}/graphql`, query: '{ broken }' }, [{}])).rejects.toThrow(/Cannot query field/);

  expect((await one('file.spreadsheet', { url: `${url}/report.xlsx` }, [{}])).main).toEqual([
    { Region: 'North', Amount: 120, When: '2026-01-02T00:00:00.000Z' }, { Region: 'South', Amount: 80.5, When: '2026-01-03T00:00:00.000Z' }]);
  expect((await one('file.spreadsheet', { url: `${url}/report.csv` }, [{}])).main).toEqual([{ name: 'Lovelace, Ada', city: 'London' }, { name: 'Grace', city: 'New\nYork' }]);
  await expect(one('file.spreadsheet', { url: `${url}/report.xlsx`, sheet: 'Nope' }, [{}])).rejects.toThrow(/no sheet called “Nope”/);
  await expect(one('file.spreadsheet', { url: 'http://localhost:1/x.xlsx' }, [{}], ctx({ allowPrivate: false }))).rejects.toThrow(/private or local/);

  const sales = [{ country: 'IN', status: 'paid', amount: 10 }, { country: 'IN', status: 'paid', amount: 5 }, { country: 'IN', status: 'refunded', amount: 3 }, { country: 'US', status: 'paid', amount: 7 }];
  expect((await one('core.pivot', { rows: 'country', columns: 'status' }, sales)).main).toEqual([{ country: 'IN', paid: 2, refunded: 1, total: 3 }, { country: 'US', paid: 1, refunded: 0, total: 1 }]);
  expect((await one('core.pivot', { rows: 'country', columns: 'status', value: 'amount', total: false }, sales)).main).toEqual([{ country: 'IN', paid: 15, refunded: 3 }, { country: 'US', paid: 7, refunded: 0 }]);

  const text = Array.from({ length: 6 }, (_, i) => `Paragraph ${i + 1} ` + 'word '.repeat(30)).join('\n\n');
  const chunks = (await one('core.textsplit', { text: '{{ $json.doc }}', by: 'paragraph', size: 400, overlap: 0 }, [{ doc: text, id: 'd1' }])).main;
  expect(chunks.length).toBe(3);
  expect(chunks.every(c => c.chunk.length <= 400 && c.chunkCount === 3 && c.id === undefined)).toBe(true);
  expect(chunks.map(c => c.chunk).join(' ').replace(/\s+/g, ' ')).toBe(text.replace(/\s+/g, ' ').trim()); // nothing lost
  const words = (await one('core.textsplit', { text: 'one two three four five six seven eight nine ten '.repeat(20), by: 'word', size: 60, overlap: 10, keep: true }, [{ id: 'd2' }])).main;
  expect(words.every(c => c.chunk.length <= 60 && c.id === 'd2')).toBe(true);

  const c = ctx();
  await one('core.kv', { operation: 'set', key: 'last', value: '{{ $json.id }}' }, [{ id: 41 }], c);
  expect((await one('core.kv', { operation: 'increment', key: 'last', by: 1 }, [{}], c)).main[0].value).toBe(42);
  expect((await one('core.kv', { operation: 'get', key: 'last', output: 'seen' }, [{}], c)).main[0].seen).toBe(42);
  expect((await one('core.kv', { operation: 'get', key: 'none', default: 'x' }, [{}], c)).main[0].value).toBe('x');
  expect((await one('core.kv', { operation: 'list', prefix: 'la' }, [{}], c)).main[0].value).toEqual({ last: 42 });
  await one('core.kv', { operation: 'delete', key: 'last' }, [{}], c);
  expect((await one('core.kv', { operation: 'get', key: 'last' }, [{}], c)).main[0].value).toBeNull();
  expect((await one('core.note', { text: 'hi' }, [{ a: 1 }])).main).toEqual([{ a: 1 }]);
});

test('a node that fails can stop the run, carry on, or send its items out of an error output', async () => {
  const flow = onError => ({
    nodes: [{ id: 't', type: 'trigger.manual', name: 'Start' }, { id: 'c', type: 'core.code', name: 'Risky', params: { code: 'throw new Error("boom")' }, ...(onError ? { onError } : {}) },
      { id: 'ok', type: 'core.set', name: 'After', params: { fields: [{ name: 'went', value: 'main' }] } }, { id: 'bad', type: 'core.set', name: 'Caught', params: { fields: [{ name: 'went', value: 'error' }] } }],
    edges: [{ from: 't', to: 'c' }, { from: 'c', to: 'ok', fromPort: 'main' }, { from: 'c', to: 'bad', fromPort: 'error' }],
  });
  const run = onError => runFlow(flow(onError), { startId: 't', input: [{ json: { id: 1 } }], types: TYPES, ctx: ctx() });
  expect(await run()).toMatchObject({ status: 'error', failed: 'c' });
  const cont = await run('continue');
  expect(cont.status).toBe('success');
  expect(cont.nodes.ok.output.main).toEqual([{ id: 1, error: 'The code failed: boom', went: 'main' }]);
  expect(cont.nodes.bad.status).toBe('skipped');
  const caught = await run('output');
  expect(caught.nodes.c).toMatchObject({ status: 'success', handled: true });
  expect(caught.nodes.ok.status).toBe('skipped');
  expect(caught.nodes.bad.output.main).toEqual([{ id: 1, error: 'The code failed: boom', went: 'error' }]);
});

test('Redis: set with expiry, get JSON back, increment, lists and keys', async () => {
  const redisUrl = process.env.LINEWORK_TEST_REDIS;
  test.skip(!redisUrl, 'set LINEWORK_TEST_REDIS=redis://localhost:6379 to run');
  const c = ctx({ cred: async () => ({ url: redisUrl }) });
  const r = (params, items = [{}]) => one('app.redis', params, items, c, { credential: 'r' });
  const k = `lw-test-${Date.now()}`;
  await r({ operation: 'set', key: `${k}:user`, value: '{{ $json }}', ttl: 60 }, [{ name: 'Ada', n: 1 }]);
  expect((await r({ operation: 'get', key: `${k}:user` })).main[0].value).toEqual({ name: 'Ada', n: 1 });
  expect((await r({ operation: 'increment', key: `${k}:count`, by: 5 })).main[0].value).toBe(5);
  await r({ operation: 'push', key: `${k}:list`, value: 'a' });
  await r({ operation: 'push', key: `${k}:list`, value: 'b' });
  expect((await r({ operation: 'range', key: `${k}:list` })).main[0].value).toEqual(['a', 'b']);
  expect((await r({ operation: 'keys', key: `${k}:*` })).main[0].value.sort()).toEqual([`${k}:count`, `${k}:list`, `${k}:user`]);
  for (const s of ['user', 'count', 'list']) await r({ operation: 'delete', key: `${k}:${s}` });
  expect((await r({ operation: 'get', key: `${k}:user` })).main[0].value).toBeNull();
  await expect(one('app.redis', { key: 'x' }, [{}], ctx({ allowPrivate: false, cred: async () => ({ url: redisUrl }) }), { credential: 'r' })).rejects.toThrow(/private or local/);
});

test('New database row: the first look notes the newest row, later looks give the rows after it', async () => {
  const pg = process.env.LINEWORK_TEST_PG;
  test.skip(!pg, 'set LINEWORK_TEST_PG to run');
  const { handle } = await import('../backend/dbconnect.js');
  const conn = { type: 'postgres', url: pg, ssl: 'off' };
  const q = sql => handle({ op: 'query', conn, sql }, { allowPrivate: true });
  await q('DROP TABLE IF EXISTS lw_events; CREATE TABLE lw_events (id serial primary key, what text); INSERT INTO lw_events (what) VALUES (\'old 1\'), (\'old 2\')');
  const poll = state => EXTRA_NODES['trigger.dbrow'].poll({ params: { table: 'public.lw_events', column: 'id' }, node: { credential: 'db' }, state, ctx: { allowPrivate: true, cred: async () => conn } });
  const first = await poll({});
  expect(first).toEqual({ items: [], state: { last: 2 } });
  await q('INSERT INTO lw_events (what) VALUES (\'new 1\'), (\'new 2\')');
  const next = await poll(first.state);
  expect(next.items.map(r => r.what)).toEqual(['new 1', 'new 2']);
  expect(next.state.last).toBe(4);
  expect((await poll(next.state)).items).toEqual([]);
  await q('DROP TABLE lw_events');
});

test.describe('through the server', () => {
  test.describe.configure({ mode: 'serial' });
  let app, srv, base, cookie = '';
  test.beforeAll(async () => {
    const store = await openStore(memoryBackend());
    app = createApp(store, { requireVerified: false, flowSecret: 'test secret', dbAllowPrivate: true });
    srv = app.listen(0);
    base = `http://localhost:${srv.address().port}/api`;
  });
  test.afterAll(() => { srv?.close(); app?.flows.close(); });
  const call = async (method, path, body) => {
    const r = await fetch(base + path, { method, headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    const set = r.headers.get('set-cookie'); if (set) cookie = set.split(';')[0];
    return { status: r.status, json: await r.json().catch(() => null) };
  };
  const save = (id, flow) => call('PUT', `/files/${id}`, { id, title: id, diagrams: [], doc: '', updated: Date.now(), flow });

  test('a webhook can wait for the workflow, and answer with a Respond node or its last items', async () => {
    await call('POST', '/auth/signup', { email: 'extra@example.com', password: 'a long password' });
    expect((await save('f_api', { active: true, nodes: [
      { id: 'h', type: 'trigger.webhook', name: 'Hook', params: { path: 'respondrespond12', method: 'POST', respond: 'end' } },
      { id: 's', type: 'core.set', name: 'Double', params: { fields: [{ name: 'double', value: '{{ $json.body.n * 2 }}' }], keep: false } },
      { id: 'r', type: 'core.respond', name: 'Answer', params: { with: 'json', body: '{{ { "result": $json.double, "ok": true } }}', status: 201, headers: [{ name: 'x-made-by', value: 'Workline' }] } },
    ], edges: [{ from: 'h', to: 's' }, { from: 's', to: 'r' }] })).status).toBe(200);
    const hit = await fetch(`${base}/hook/respondrespond12`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"n": 21}' });
    expect(hit.status).toBe(201);
    expect(hit.headers.get('x-made-by')).toBe('Workline');
    expect(await hit.json()).toEqual({ result: 42, ok: true });
    // Without a Respond node: the last step's item.
    await save('f_api2', { active: true, nodes: [
      { id: 'h', type: 'trigger.webhook', name: 'Hook', params: { path: 'respondrespond34', method: 'POST', respond: 'end' } },
      { id: 's', type: 'core.set', name: 'Echo', params: { fields: [{ name: 'got', value: '{{ $json.body.n }}' }], keep: false } },
    ], edges: [{ from: 'h', to: 's' }] });
    const echo = await fetch(`${base}/hook/respondrespond34`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"n": 5}' });
    expect(await echo.json()).toEqual({ got: 5 });
  });

  test('On error: a failing workflow starts the account’s On error workflows', async () => {
    await save('f_alarm', { active: true, nodes: [
      { id: 'e', type: 'trigger.error', name: 'On error', params: { fileId: 'f_fragile' } },
      { id: 'k', type: 'core.kv', name: 'Remember', params: { operation: 'set', key: 'lastFailure', value: '{{ $json.failedNode + ": " + $json.error }}' } },
    ], edges: [{ from: 'e', to: 'k' }] });
    await save('f_fragile', { active: true, nodes: [
      { id: 'h', type: 'trigger.webhook', name: 'Hook', params: { path: 'fragilefragile12', method: 'POST' } },
      { id: 'c', type: 'core.stop', name: 'Break', params: { message: 'Out of stock' } },
    ], edges: [{ from: 'h', to: 'c' }] });
    expect((await fetch(`${base}/hook/fragilefragile12`, { method: 'POST' })).status).toBe(202);
    let seen = null;
    for (let i = 0; i < 100 && !seen; i++) {
      await new Promise(r => setTimeout(r, 50));
      const runs = (await call('GET', '/flows/f_alarm/runs')).json.runs;
      if (runs.length && runs[0].status !== 'running') seen = runs[0];
    }
    expect(seen).toMatchObject({ status: 'success', trigger: 'error' });
    const run = (await call('GET', `/runs/${seen.id}`)).json.run;
    expect(run.nodes.k.output.main[0]).toMatchObject({ workflowId: 'f_fragile', workflow: 'f_fragile', failedNode: 'Break', error: 'Break: Out of stock', value: 'Break: Break: Out of stock' });
  });
});
