import { test, expect } from '@playwright/test';
import { runFlow } from '../backend/flow-engine.js';
import { NODE_TYPES } from '../backend/flow-nodes.js';
import { APP_NODES } from '../backend/flow-apps.js';
import { WORKLINE_NODES } from '../backend/flow-workline.js';
import { TRIGGER_TYPES } from '../backend/flow-triggers.js';
import { WEB_NODES } from '../backend/flow-web.js';
import { CRED_FIELDS } from '../backend/flows.js';
import { CRED_TYPES, NODES } from '../frontend/src/lib/flows.js';

// The workflow nodes: the app and the server agree on them, and the data nodes do what they say.

const TYPES = { ...NODE_TYPES, ...APP_NODES, ...WORKLINE_NODES, ...TRIGGER_TYPES, ...WEB_NODES };

test('every node in the app has a server side, and credentials ask for the fields the server keeps', () => {
  expect(Object.keys(NODES).length).toBeGreaterThan(60);
  expect(Object.keys(NODES).filter(k => !TYPES[k])).toEqual([]);
  for (const [k, d] of Object.entries(NODES)) {
    for (const c of d.credential || []) {
      expect(CRED_TYPES[c], `${k} uses credential ${c}`).toBeTruthy();
      expect(CRED_FIELDS[c], `the server keeps ${c}`).toBeTruthy();
    }
  }
  for (const [k, t] of Object.entries(CRED_TYPES)) expect(t.fields.map(f => f.k).filter(f => !CRED_FIELDS[k].includes(f)), k).toEqual([]);
});

// Run one node on some items; the output of its ports.
const one = async (type, params, items, extra = {}) => {
  const flow = { nodes: [{ id: 't', type: 'trigger.manual', name: 'Start' }, { id: 'n', type, name: 'Node', params }], edges: [{ from: 't', to: 'n', fromPort: 'main', toPort: 'main' }] };
  const r = await runFlow(flow, { startId: 't', input: items.map(json => ({ json })), types: TYPES, ctx: extra });
  if (r.status !== 'success') throw new Error(r.error);
  return r.nodes.n.output;
};
const people = [{ name: 'Ada', age: 36, team: 'eng' }, { name: 'Tim', age: 9, team: 'kids' }, { name: 'Grace', age: 85, team: 'eng' }, { name: 'Ada', age: 36, team: 'eng' }];

test('flow nodes: filter, switch, sort, limit, remove duplicates, batch, stop', async () => {
  expect((await one('core.filter', { left: '{{ $json.age }}', op: 'gte', right: '18' }, people)).main.map(p => p.name)).toEqual(['Ada', 'Grace', 'Ada']);
  const sw = await one('core.switch', { value: '{{ $json.team }}', rule1: 'eng', rule2: 'design' }, people);
  expect(sw[0].map(p => p.name)).toEqual(['Ada', 'Grace', 'Ada']);
  expect(sw[1]).toEqual([]);
  expect(sw.other.map(p => p.name)).toEqual(['Tim']);
  expect((await one('core.sort', { field: 'age', order: 'desc' }, people)).main.map(p => p.age)).toEqual([85, 36, 36, 9]);
  expect((await one('core.sort', { field: 'name' }, people)).main.map(p => p.name)).toEqual(['Ada', 'Ada', 'Grace', 'Tim']);
  expect((await one('core.limit', { max: 2, from: 'end' }, people)).main.map(p => p.name)).toEqual(['Grace', 'Ada']);
  expect((await one('core.dedupe', {}, people)).main).toHaveLength(3);
  expect((await one('core.dedupe', { field: 'team' }, people)).main.map(p => p.name)).toEqual(['Ada', 'Tim']);
  expect((await one('core.chunk', { size: 3 }, people)).main.map(b => b.items.length)).toEqual([3, 1]);
  await expect(one('core.stop', { message: 'No orders today' }, people)).rejects.toThrow('Node: No orders today');
});

test('data nodes: aggregate, summarize, rename, dates, crypto, text, JSON, regex, CSV', async () => {
  expect((await one('core.aggregate', { field: 'name', into: 'names' }, people)).main).toEqual([{ names: ['Ada', 'Tim', 'Grace', 'Ada'] }]);
  expect((await one('core.summarize', { op: 'avg', field: 'age', groupBy: 'team' }, people)).main).toEqual([{ team: 'eng', avg: (36 + 85 + 36) / 3 }, { team: 'kids', avg: 9 }]);
  expect((await one('core.summarize', { op: 'count' }, people)).main).toEqual([{ count: 4 }]);
  expect((await one('core.rename', { fields: [{ name: 'name', value: 'person.first' }] }, [{ name: 'Ada', x: 1 }])).main).toEqual([{ x: 1, person: { first: 'Ada' } }]);

  const day = '2026-01-31T09:30:00.000Z';
  expect((await one('core.datetime', { operation: 'add', value: day, amount: 2, unit: 'days' }, [{}])).main[0].date).toBe('2026-02-02T09:30:00.000Z');
  expect((await one('core.datetime', { operation: 'format', value: day, format: 'date', output: 'd' }, [{}])).main[0].d).toBe('2026-01-31');
  expect((await one('core.datetime', { operation: 'diff', value: day, other: '2026-02-07T09:30:00.000Z', unit: 'weeks' }, [{}])).main[0].date).toBe(1);
  expect((await one('core.datetime', { operation: 'toUnix', value: '1970-01-02T00:00:00Z' }, [{}])).main[0].date).toBe(86400);

  expect((await one('core.crypto', { operation: 'hash', algorithm: 'sha256', value: 'abc' }, [{}])).main[0].hash).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  expect((await one('core.crypto', { operation: 'hmac', algorithm: 'sha256', secret: 'key', value: 'The quick brown fox jumps over the lazy dog' }, [{}])).main[0].hash).toBe('f7bc83f430538424b13298e6aa6fb143ef4d59a14946175997479dbc2d1a3cd8');
  expect((await one('core.crypto', { operation: 'base64Encode', value: 'hi', output: 'b' }, [{}])).main[0].b).toBe('aGk=');
  expect((await one('core.crypto', { operation: 'uuid' }, [{}])).main[0].hash).toMatch(/^[0-9a-f-]{36}$/);

  expect((await one('core.text', { operation: 'slug', value: 'Héllo, World!' }, [{}])).main[0].text).toBe('hello-world');
  expect((await one('core.text', { operation: 'split', value: 'a, b ,c' }, [{}])).main[0].text).toEqual(['a', 'b', 'c']);
  expect((await one('core.text', { operation: 'replace', value: 'a-b-c', find: '-', replaceWith: '+' }, [{}])).main[0].text).toBe('a+b+c');
  expect((await one('core.json', { operation: 'parse', field: 'raw' }, [{ raw: '{"a":[1,2]}' }])).main[0].raw).toEqual({ a: [1, 2] });
  expect((await one('core.json', { operation: 'stringify', field: 'o', output: 's' }, [{ o: { a: 1 } }])).main[0].s).toBe('{"a":1}');
  expect((await one('core.regex', { value: 'Order 42 and 7', pattern: '(\\d+)', flags: 'g' }, [{}])).main[0].matches).toEqual(['42', '7']);
  expect((await one('core.regex', { value: 'ada@example.com', pattern: '@(.+)$' }, [{}])).main[0].matches).toBe('example.com');

  const csv = 'name,city\nAda,"London, UK"\n"Grace ""Amazing"" Hopper",NYC';
  const rows = (await one('core.csv', { operation: 'parse', text: '{{ $json.csv }}' }, [{ csv }])).main;
  expect(rows).toEqual([{ name: 'Ada', city: 'London, UK' }, { name: 'Grace "Amazing" Hopper', city: 'NYC' }]);
  expect((await one('core.csv', { operation: 'build' }, rows)).main[0].csv).toBe('name,city\nAda,"London, UK"\n"Grace ""Amazing"" Hopper",NYC');
});

test('run another workflow: its items come back from its last steps', async () => {
  const runFile = async (id, input) => (id === 'other' ? input.map(i => ({ json: { ...i.json, seen: true } })) : []);
  expect((await one('core.subflow', { fileId: 'other' }, [{ a: 1 }], { runFile })).main).toEqual([{ a: 1, seen: true }]);
});

test('export leaves out credentials and secrets; import reads it back, and n8n workflows too', async () => {
  const { exportFlow, importFlow } = await import('../frontend/src/lib/flowio.js');
  const file = { title: 'Orders', flow: { active: true, nodes: [
    { id: 'a', type: 'trigger.github', name: 'GitHub', x: 0, y: 0, params: { path: 'secretsecret1234', secret: 'hush', events: 'push' } },
    { id: 'b', type: 'app.slack', name: 'Slack', x: 200, y: 0, params: { text: 'hi' }, credential: 'cred_1' },
  ], edges: [{ id: 'e', from: 'a', fromPort: 'main', to: 'b', toPort: 'main' }] } };
  const text = exportFlow(file);
  expect(text).not.toMatch(/hush|secretsecret1234|cred_1/);
  const back = importFlow(text);
  expect(back.name).toBe('Orders');
  expect(back.flow.active).toBe(false);
  expect(back.flow.nodes.map(n => n.type)).toEqual(['trigger.github', 'app.slack']);
  expect(back.flow.nodes[0].params).toMatchObject({ events: 'push' });
  expect(back.flow.nodes[0].params.path).toMatch(/^[a-z0-9]{24}$/); // a new URL
  expect(back.flow.edges[0]).toMatchObject({ from: back.flow.nodes[0].id, to: back.flow.nodes[1].id });

  const n8n = importFlow(JSON.stringify({ name: 'From n8n', nodes: [
    { name: 'Webhook', type: 'n8n-nodes-base.webhook', position: [100, 300], parameters: { httpMethod: 'POST' } },
    { name: 'IF', type: 'n8n-nodes-base.if', position: [400, 300], parameters: {} },
    { name: 'Slack', type: 'n8n-nodes-base.slack', position: [700, 200], parameters: { text: '={{ $json.body.msg }}' } },
    { name: 'Odd', type: 'n8n-nodes-base.somethingRare', position: [700, 400], parameters: {} },
    { name: 'Note', type: 'n8n-nodes-base.stickyNote', position: [0, 0], parameters: {} },
  ], connections: { Webhook: { main: [[{ node: 'IF', type: 'main', index: 0 }]] }, IF: { main: [[{ node: 'Slack', type: 'main', index: 0 }], [{ node: 'Odd', type: 'main', index: 0 }]] } } }));
  expect(n8n.flow.nodes.map(n => n.type)).toEqual(['trigger.webhook', 'core.if', 'app.slack', 'core.noop']);
  expect(n8n.flow.nodes[2].params.text).toBe('{{ $json.body.msg }}');
  expect(n8n.skipped).toEqual(['n8n-nodes-base.somethingRare']);
  expect(n8n.flow.edges.map(e => e.fromPort)).toEqual(['main', 'true', 'false']);
  expect(() => importFlow('{"hello": 1}')).toThrow(/isn’t a Workline or n8n/);
});

test('web nodes: a page’s text, links, tables, selectors and fields; the browser through Browserless', async () => {
  const { createServer } = await import('node:http');
  const html = `<html><head><title>Shop</title><meta name="description" content="Things to buy"></head><body>
    <nav>Menu</nav><main><h1>Products</h1>
    <div class="product"><h2>Pen</h2><span class="price">10</span><a href="/pen">more</a></div>
    <div class="product"><h2>Book</h2><span class="price">250</span><a href="/book">more</a></div>
    <table><tr><th>Size</th><th>Stock</th></tr><tr><td>S</td><td>3</td></tr><tr><td>M</td><td>0</td></tr></table></main>
    <script>var hidden = 1</script></body></html>`;
  const calls = [];
  const srv = createServer((req, res) => {
    let body = ''; req.on('data', c => { body += c; });
    req.on('end', () => {
      if (req.url.startsWith('/function')) { calls.push(JSON.parse(body)); res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ url: 'http://shop.test/', title: 'Shop', html })); return; }
      if (req.url.startsWith('/screenshot')) { res.writeHead(200, { 'content-type': 'image/png' }); res.end(Buffer.from([137, 80, 78, 71])); return; }
      res.writeHead(200, { 'content-type': 'text/html' }); res.end(html);
    });
  }).listen(0);
  const base = `http://localhost:${srv.address().port}`;
  const ctx = { allowPrivate: true, cred: async () => ({ token: 't0k', baseUrl: base }) };
  const page = async params => (await one('web.page', { url: `${base}/shop`, ...params }, [{}], ctx)).main;
  try {
    const [t] = await page({ extract: 'text' });
    expect(t).toMatchObject({ title: 'Shop', description: 'Things to buy' });
    expect(t.text).toContain('Pen');
    expect(t.text).not.toMatch(/Menu|hidden/);
    expect((await page({ extract: 'links' })).map(l => l.url)).toEqual([`${base}/pen`, `${base}/book`]);
    expect(await page({ extract: 'tables' })).toEqual([{ Size: 'S', Stock: '3' }, { Size: 'M', Stock: '0' }]);
    expect((await page({ extract: 'selector', selector: '.price' })).map(x => x.value)).toEqual(['10', '250']);
    expect(await page({ extract: 'fields', each: '.product', fields: [{ name: 'name', value: 'h2' }, { name: 'price', value: '.price' }, { name: 'link', value: 'a @href' }] }))
      .toEqual([{ name: 'Pen', price: '10', link: `${base}/pen` }, { name: 'Book', price: '250', link: `${base}/book` }]);

    const flow = { nodes: [{ id: 't', type: 'trigger.manual', name: 'Start' }, { id: 'n', type: 'web.browser', name: 'Browser', credential: 'c1', params: { operation: 'steps', url: 'http://shop.test/', steps: 'type #q | pens\npress Enter\n# a note\nwait .product', extract: 'selector', selector: 'h2' } }], edges: [{ from: 't', to: 'n', fromPort: 'main', toPort: 'main' }] };
    const r = await runFlow(flow, { startId: 't', input: [{ json: {} }], types: TYPES, ctx });
    expect(r.status).toBe('success');
    expect(r.nodes.n.output.main.map(x => x.value)).toEqual(['Pen', 'Book']);
    expect(calls[0].context.steps).toEqual([{ action: 'type', selector: '#q', text: 'pens' }, { action: 'press', selector: 'Enter', text: '' }, { action: 'wait', selector: '.product', text: '' }]);
    flow.nodes[1].params = { operation: 'screenshot', url: 'http://shop.test/' };
    const shot = await runFlow(flow, { startId: 't', input: [{ json: {} }], types: TYPES, ctx });
    expect(shot.nodes.n.output.main[0]).toMatchObject({ screenshot: 'data:image/png;base64,iVBORw==', bytes: 4 });
  } finally { srv.close(); }
});
