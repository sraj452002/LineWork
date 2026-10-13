import { test, expect } from '@playwright/test';
import { openStore } from '../backend/store.js';
import { memoryBackend } from '../backend/drive.js';
import { createApp } from '../backend/app.js';
import { NODES, outsOf } from '../frontend/src/lib/flows.js';

// The ready-made templates (frontend/src/lib/readymade.js) are well formed, and the pages made of nodes
// run on the server and draw what they promise.

let READY;
test.beforeAll(async () => {
  globalThis.innerWidth ??= 1200; // dg() picks a direction by the window's width
  ({ READY } = await import('../frontend/src/lib/readymade.js'));
});

test('every template makes a well-formed file', () => {
  expect(READY.length).toBeGreaterThanOrEqual(28);
  expect(new Set(READY.map(t => t.k)).size).toBe(READY.length);
  for (const t of READY) {
    const f = t.make();
    expect(f.id, t.k).toMatch(/^f/);
    expect(f.title, t.k).toBeTruthy();
    if (f.view === 'sheet') expect(f.sheets.some(s => s.id === f.activeSheet), t.k).toBe(true);
    if (f.view === 'code') expect(f.code.files.some(c => c.id === f.code.active), t.k).toBe(true);
    if (f.view === 'doc') expect(f.doc, t.k).toMatch(/^# /);
    if (!f.flow) continue;
    const ids = new Set(f.flow.nodes.map(n => n.id));
    for (const n of f.flow.nodes) {
      expect(NODES[n.type], `${t.k}: ${n.type}`).toBeTruthy();
      const known = [...(NODES[n.type].fields || []).map(x => x.k), 'path'];
      expect(Object.keys(n.params).filter(k => !known.includes(k)), `${t.k}: ${n.name}`).toEqual([]);
    }
    for (const e of f.flow.edges) {
      expect(ids.has(e.from) && ids.has(e.to), t.k).toBe(true);
      expect(outsOf(f.flow.nodes.find(n => n.id === e.from)), `${t.k}: port ${e.fromPort}`).toContain(e.fromPort);
    }
    // Every node but the trigger is reached.
    const reached = new Set(f.flow.edges.map(e => e.to));
    for (const n of f.flow.nodes) if (!NODES[n.type].trigger) expect(reached.has(n.id), `${t.k}: ${n.name} is connected`).toBe(true);
    if (f.ui) expect(f.ui.flows, t.k).toEqual([f.id]);
  }
});

test.describe('pages made of nodes', () => {
  test.describe.configure({ mode: 'serial' });
  let app, srv, base, cookie = '';
  test.beforeAll(async () => {
    app = createApp(await openStore(memoryBackend()), { requireVerified: false });
    srv = app.listen(0);
    base = `http://localhost:${srv.address().port}/api`;
  });
  test.afterAll(() => { srv?.close(); app?.flows.close(); });
  const call = async (method, path, body) => {
    const r = await fetch(base + path, { method, headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    const set = r.headers.get('set-cookie'); if (set) cookie = set.split(';')[0];
    return { status: r.status, json: await r.json().catch(() => null) };
  };
  const page = (k, input) => {
    const f = READY.find(t => t.k === k).make();
    return call('POST', `/flows/${f.id}/page`, { flow: f.flow, input });
  };

  test('the sales dashboard page: cards, chart, buttons and table, filtered by region', async () => {
    await call('POST', '/auth/signup', { email: 'templates@example.com', password: 'a long password' });
    const all = await page('p-sales');
    expect(all.status).toBe(200);
    expect(all.json.html).toContain('<h1>Sales dashboard</h1>');
    expect(all.json.html).toMatch(/<span>Orders<\/span><b>4<\/b>/);
    expect(all.json.html).toMatch(/<span>Revenue<\/span><b>455<\/b>/);
    expect(all.json.html).toContain('<svg class="chart"');
    expect(all.json.html).toContain('<td>Margaret</td>');
    const north = await page('p-sales', { query: { region: 'North' } });
    expect(north.json.html).toMatch(/<span>Orders<\/span><b>2<\/b>/);
    expect(north.json.html).toContain('<a class="btn on" href="?region=North">North</a>');
  });

  test('the feedback page shows its form when opened', async () => {
    const r = await page('p-feedback');
    expect(r.status).toBe(200);
    expect(r.json.html).toContain('<h1>Tell us what you think</h1>');
    expect(r.json.html).toContain('name="_action" value="feedback"');
    expect(r.json.html).toMatch(/name="message"/);
  });
});
