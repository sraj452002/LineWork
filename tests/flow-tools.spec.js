import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import dns from 'node:dns/promises';
import { syncBuiltinESMExports } from 'node:module';
import { isDeepStrictEqual } from 'node:util';
import { runFlow } from '../backend/flow-engine.js';
import { TOOL_META, TOOL_NODES, TOOL_TESTS } from '../backend/flow-tools.js';
import { ACTION_META, ACTION_NODES } from '../backend/flow-actions.js';
import { CRED_FIELDS } from '../backend/flows.js';
import { moreNodes, OUT } from '../scripts/more-nodes.mjs';
import { CRED_TYPES, GROUPS, NODES, NOAH_STUDIO, shelves } from '../frontend/src/lib/flows.js';
import { NODE_GUIDE } from '../frontend/src/lib/flowguide.js';

// The tool nodes (text, numbers, dates, lists…) and the one-job app actions and public data.

const TYPES = { ...TOOL_NODES, ...ACTION_NODES, 'trigger.manual': { run: a => ({ main: a.items }) } };
const run = async (type, params, json = {}, ctx = {}) => {
  const flow = { nodes: [{ id: 't', type: 'trigger.manual', name: 'Start' }, { id: 'n', type, name: 'Node', params, credential: 'c1' }], edges: [{ from: 't', to: 'n', fromPort: 'main', toPort: 'main' }] };
  const r = await runFlow(flow, { startId: 't', input: [{ json }], types: TYPES, ctx });
  if (r.status !== 'success') throw new Error(r.error);
  return r.nodes.n.output.main;
};

test('there are 500+ nodes, and the editor’s copy of the new ones is up to date', () => {
  expect(Object.keys(NODES).length).toBeGreaterThanOrEqual(500);
  expect(readFileSync(OUT, 'utf8'), 'run: node scripts/more-nodes.mjs').toBe(moreNodes());
  for (const [k, d] of Object.entries({ ...TOOL_META, ...ACTION_META })) {
    expect(GROUPS, k).toContain(d.group);
    expect(NODE_GUIDE[k]?.ex, k).toBeTruthy();
    for (const c of d.credential || []) { expect(CRED_TYPES[c], `${k} uses ${c}`).toBeTruthy(); expect(CRED_FIELDS[c]).toBeTruthy(); }
    expect(new Set(d.fields.map(f => f.k)).size, `${k} has a field twice`).toBe(d.fields.length);
  }
});

test('every tool does what its example says', async () => {
  const failed = [];
  let cases = 0;
  for (const [type, tests] of Object.entries(TOOL_TESTS)) {
    expect(tests.length, `${type} has an example`).toBeGreaterThan(0);
    for (const [value, want, params] of tests) {
      cases++;
      // The value comes from the item, the way {{ $json.x }} brings it in.
      const [out] = await run(type, { ...TOOL_META[type].defaults, ...(params || {}), value: '{{ $json.v }}' }, { v: value, keep: 1 });
      const got = out[TOOL_META[type].defaults.output];
      if (!(typeof want === 'function' ? want(got) : isDeepStrictEqual(got, want))) failed.push(`${type}: ${JSON.stringify(value)} → ${JSON.stringify(got)}, not ${JSON.stringify(want)}`);
      expect(out.keep, `${type} keeps the item’s other fields`).toBe(1);
    }
  }
  expect(failed).toEqual([]);
  expect(cases).toBeGreaterThan(300);
});

test('tools put the result where they’re told and explain bad input', async () => {
  const [a] = await run('text.upper', { value: '{{ $json.name }}', output: 'user.shout' }, { name: 'ada' });
  expect(a).toEqual({ name: 'ada', user: { shout: 'ADA' } });
  await expect(run('num.add', { value: 'ten', by: '2', output: 'r' })).rejects.toThrow('“ten” isn\'t a number');
  await expect(run('date.format', { value: 'someday', output: 'r' })).rejects.toThrow('isn\'t a date');
  await expect(run('date.format', { value: '2025-01-01', timezone: 'Mars/Base', output: 'r' })).rejects.toThrow('isn\'t a time zone');
  // A list from an expression keeps its type; from text, commas split it.
  expect((await run('num.sum', { value: '{{ $json.n }}', output: 's' }, { n: [1, 2, 3] }))[0].s).toBe(6);
  expect((await run('num.sum', { value: '4, 5', output: 's' }))[0].s).toBe(9);
});

// App actions, with the network stubbed: the request each one makes, and what it passes on.
test('app actions call the right address with the credential, and pass on the answer', async () => {
  // Every service's host looks like a public address, and no request leaves this machine.
  const real = globalThis.fetch, realLookup = dns.lookup, calls = [];
  dns.lookup = async () => [{ address: '93.184.216.34', family: 4 }];
  syncBuiltinESMExports();
  const answers = [
    [/api\.github\.com\/repos\/octo\/hello\/issues\/7\/comments/, { id: 1, html_url: 'https://github.com/octo/hello/issues/7#c1' }],
    [/api\.stripe\.com\/v1\/checkout\/sessions/, { id: 'cs_1', url: 'https://checkout.stripe.com/c/cs_1', amount_total: 49900, currency: 'inr' }],
    [/slack\.com\/api\/users\.lookupByEmail/, { ok: true, user: { id: 'U9' } }],
    [/slack\.com\/api\/conversations\.open/, { ok: true, channel: { id: 'D9' } }],
    [/slack\.com\/api\/chat\.postMessage/, { ok: true, channel: 'D9', ts: '1.2' }],
    [/api\.postalpincode\.in\/pincode\/110001/, [{ Status: 'Success', PostOffice: [{ Name: 'Connaught Place', District: 'New Delhi', State: 'Delhi', Region: 'Delhi', Division: 'New Delhi Central', DeliveryStatus: 'Delivery', Pincode: '110001' }] }]],
    [/api\.telegram\.org\/botT0K\/sendPoll/, { ok: true, result: { message_id: 5, chat: { id: 42 }, date: 1735689600 } }],
  ];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), method: init.method, headers: init.headers, body: init.body });
    const hit = answers.find(([re]) => re.test(String(url)));
    return new Response(JSON.stringify(hit ? hit[1] : { message: 'not stubbed' }), { status: hit ? 200 : 404, headers: { 'content-type': 'application/json' } });
  };
  const ctx = c => ({ cred: async () => c });
  try {
    const [gh] = await run('github.comment', { repo: 'https://github.com/octo/hello', number: '{{ $json.n }}', body: 'Thanks!' }, { n: 7 }, ctx({ token: 'ghp_x' }));
    expect(gh).toEqual({ id: 1, url: 'https://github.com/octo/hello/issues/7#c1' });
    expect(calls[0].method).toBe('POST');
    expect(calls[0].headers.authorization).toBe('Bearer ghp_x');
    expect(JSON.parse(calls[0].body)).toEqual({ body: 'Thanks!' });

    calls.length = 0;
    const [co] = await run('stripe.checkout', { name: 'Pro plan', amount: '₹499', currency: 'INR', quantity: 1, successUrl: 'https://x.io/thanks' }, {}, ctx({ secretKey: 'sk_test_1' }));
    expect(co.url).toBe('https://checkout.stripe.com/c/cs_1');
    const form = new URLSearchParams(calls[0].body);
    expect(form.get('line_items[0][price_data][unit_amount]')).toBe('49900');
    expect(form.get('line_items[0][price_data][currency]')).toBe('inr');
    expect(calls[0].headers.authorization).toBe(`Basic ${Buffer.from('sk_test_1:').toString('base64')}`);

    calls.length = 0;
    const [dm] = await run('slack.dm', { user: 'ada@example.com', text: 'Hi Ada' }, {}, ctx({ token: 'xoxb-1' }));
    expect(dm).toEqual({ channel: 'D9', ts: '1.2', user: 'U9' });
    expect(calls.map(c => new URL(c.url).pathname)).toEqual(['/api/users.lookupByEmail', '/api/conversations.open', '/api/chat.postMessage']);

    calls.length = 0;
    const poll = await run('telegram.poll', { chatId: '42', question: 'Lunch?', options: 'Pizza, Biryani', anonymous: 'true' }, {}, ctx({ botToken: 'T0K' }));
    expect(poll[0].messageId).toBe(5);
    expect(JSON.parse(calls[0].body).options).toEqual([{ text: 'Pizza' }, { text: 'Biryani' }]);

    const pin = await run('pub.pincode', { pincode: '110 001' });
    expect(pin).toEqual([{ name: 'Connaught Place', district: 'New Delhi', state: 'Delhi', region: 'Delhi', division: 'New Delhi Central', delivery: true, pincode: '110001' }]);

    await expect(run('github.comment', { repo: 'not a repo', number: 1, body: 'x' }, {}, ctx({ token: 't' }))).rejects.toThrow('owner/name');
    await expect(run('stripe.checkout', { name: 'x', amount: '-5', successUrl: 'https://x.io' }, {}, ctx({ secretKey: 'k' }))).rejects.toThrow('above 0');
  } finally { globalThis.fetch = real; dns.lookup = realLookup; syncBuiltinESMExports(); }
});

test('the library shelves every node once: each app in its own group, NOAH Studio’s nodes together', () => {
  const shelf = shelves(Object.entries(NODES));
  expect(shelf.map(s => s.section)).toEqual(['Start', 'Build', 'NOAH Studio', 'Tools', 'Apps', 'Data sources']);
  const all = shelf.flatMap(s => s.groups.flatMap(g => g.items.map(([k]) => k)));
  expect(all.length).toBe(Object.keys(NODES).length);
  expect(new Set(all).size).toBe(all.length);
  const group = (section, name) => shelf.find(s => s.section === section).groups.find(g => g.name === name).items.map(([k]) => k);
  // An app's trigger, its main node and its one-job actions sit together.
  expect(group('Apps', 'GitHub')).toEqual(expect.arrayContaining(['trigger.github', 'app.github', 'github.comment', 'github.createPull']));
  expect(group('Apps', 'Google Sheets')).toEqual(expect.arrayContaining(['google.sheets', 'gsheets.update']));
  const apps = shelf.find(s => s.section === 'Apps').groups.map(g => g.name);
  expect(apps).toEqual([...apps].sort((a, b) => a.localeCompare(b)));
  expect(shelf.find(s => s.section === 'NOAH Studio').groups.flatMap(g => g.items.map(([k]) => k)).sort()).toEqual([...NOAH_STUDIO].sort());
});
