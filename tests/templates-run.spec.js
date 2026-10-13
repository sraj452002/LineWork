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
  expect(READY.length).toBeGreaterThanOrEqual(20);
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
    // A visual app: its steps go to pages it has, and read data sources it has.
    if (f.ui && f.ui.mode === 'visual') {
      const pages = new Set(f.ui.spec.pages.map(p => p.id)), sources = new Set(f.ui.spec.data.map(d => d.name));
      for (const pg of f.ui.spec.pages) for (const c of pg.components) for (const st of c.props.steps || []) {
        if (st.kind === 'go') expect(pages.has(st.page), `${t.k}: ${c.name} goes to ${st.page}`).toBe(true);
        if (st.kind === 'run') expect(sources.has(st.source), `${t.k}: ${c.name} runs ${st.source}`).toBe(true);
      }
      expect(f.ui.html, t.k).toContain('wl-root');
    }
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

  test('StarPlay 2: a streaming page made only of nodes', async () => {
    const { createServer } = await import('node:http');
    const { readFileSync } = await import('node:fs');
    const list = createServer((req, res) => { res.writeHead(200, { 'content-type': 'text/plain' }); res.end(readFileSync('samples/videos.json')); }).listen(0);
    const app2 = createApp(await openStore(memoryBackend()), { requireVerified: false, dbAllowPrivate: true }), srv2 = app2.listen(0);
    try {
      const b2 = `http://localhost:${srv2.address().port}/api`;
      const up = await fetch(`${b2}/auth/signup`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'sp2@example.com', password: 'a long password' }) });
      const ck = up.headers.get('set-cookie').split(';')[0];
      const f = READY.find(t => t.k === 'p-ott').make();
      expect(f.flow.nodes.every(n => n.type.startsWith('trigger.') || n.type.startsWith('core.') || n.type.startsWith('ui.'))).toBe(true);
      f.flow.nodes.find(n => n.type === 'core.http').params.url = `http://localhost:${list.address().port}/samples/videos.json`;
      const open = async input => {
        const r = await fetch(`${b2}/flows/${f.id}/page`, { method: 'POST', headers: { 'content-type': 'application/json', cookie: ck }, body: JSON.stringify({ flow: f.flow, input }) });
        const j = await r.json(); expect(r.status, JSON.stringify(j).slice(0, 300)).toBe(200); return j.html;
      };
      const home = await open({});
      expect(home).toContain('<h1>StarPlay 2</h1>');
      expect(home).toMatch(/<video[^>]+src="https:\/\/storage\.googleapis\.com\/[^"]+\.mp4"/); // MP4 only: no scripts on a page
      expect(home).toContain('Code Red: Delhi');
      for (const h of ['Episodes', 'Latest Releases', 'Top 10 in India Today', '🔴 Live Sports', 'Choose your plan']) expect(home, h).toContain(h);
      expect(home).toContain('href="?video=code-red&amp;ep=1"');
      expect(home).toMatch(/<span>Super<\/span><b>₹149 \/ month<\/b>/);
      expect(home).toContain('<td>India vs Australia</td>');
      expect(home).toContain('<svg class="chart"');
      expect(home).toContain('name="_action" value="subscribe"');
      // A movie, from a tab: it plays, with more like it.
      const movie = await open({ query: { tab: 'movies', video: 'kaveri' } });
      expect(movie).toMatch(/<h3>Kaveri Blues<\/h3>/);
      expect(movie).toContain('More Like This');
      const movies = await open({ query: { tab: 'movies' } });
      expect(movies).toContain('<a class="btn on" href="?tab=movies">');
      expect(movies).toContain('href="?video=kaveri&amp;tab=movies"');
      // An episode, a search, and the subscribe form's answer.
      expect(await open({ query: { video: 'mumbai-nights', ep: '7' } })).toContain('Mumbai Nights · S2 E2 · The Offer');
      expect(await open({ action: 'search', form: { search: 'kaveri' } })).toContain('1 results for “kaveri”');
      expect(await open({ action: 'subscribe', form: { name: 'Riya', mobileNumber: '9999999999', plan: 'Super' } })).toContain('Thanks, Riya!');
    } finally { srv2.close(); app2.flows.close(); list.close(); }
  });

  // The app templates' workflows, run as their published apps run them.
  const publish = async (k, token, access = 'public') => {
    const f = READY.find(t => t.k === k).make();
    f.ui = { ...f.ui, published: true, token, access };
    expect((await call('PUT', `/files/${f.id}`, f)).status).toBe(200);
    return f;
  };
  const run = async (token, input, session) => {
    const r = await fetch(`${base}/ui/${token}/run`, { method: 'POST', headers: { 'content-type': 'text/plain' }, body: JSON.stringify({ input, session }) });
    return { status: r.status, json: await r.json().catch(() => null) };
  };

  test('the OTT app’s workflow fetches the video files and builds the whole catalogue', async () => {
    const { createServer } = await import('node:http');
    const { readFileSync } = await import('node:fs');
    // The list of video files, as GitHub hands it over (JSON as plain text).
    const list = createServer((req, res) => { res.writeHead(200, { 'content-type': 'text/plain' }); res.end(readFileSync('samples/videos.json')); }).listen(0);
    const ott = createApp(await openStore(memoryBackend()), { requireVerified: false, dbAllowPrivate: true }), osrv = ott.listen(0);
    try {
      const obase = `http://localhost:${osrv.address().port}/api`;
      const f = READY.find(t => t.k === 'a-ott').make();
      expect(f.flow.nodes.map(n => n.type)).toEqual(['trigger.manual', 'core.http', 'core.code']);
      expect(f.flow.nodes[1].params.url).toMatch(/samples\/videos\.json$/);
      f.flow.nodes[1].params.url = `http://localhost:${list.address().port}/samples/videos.json`;
      f.ui = { ...f.ui, published: true, token: 'starplay' + 'x'.repeat(24) };
      const up = await fetch(`${obase}/auth/signup`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'ott@example.com', password: 'a long password' }) });
      const ck = up.headers.get('set-cookie').split(';')[0];
      expect((await fetch(`${obase}/files/${f.id}`, { method: 'PUT', headers: { 'content-type': 'application/json', cookie: ck }, body: JSON.stringify(f) })).status).toBe(200);
      const r = await fetch(`${obase}/ui/${'starplay' + 'x'.repeat(24)}/run`, { method: 'POST', headers: { 'content-type': 'text/plain' }, body: JSON.stringify({ input: {} }) });
      const cat = (await r.json()).items;
      const files = JSON.parse(readFileSync('samples/videos.json', 'utf8')).map(v => v.src);
      const titles = cat.filter(t => !['Live', 'Plan'].includes(t.kind)), live = cat.filter(t => t.kind === 'Live'), plans = cat.filter(t => t.kind === 'Plan');
      expect(titles.length).toBeGreaterThanOrEqual(25);
      for (const t of [...titles, ...live]) expect(files, t.id).toContain(t.src);
      expect(titles.filter(t => t.rows.includes('spotlight')).length).toBeGreaterThanOrEqual(4);
      expect(titles.filter(t => t.rank).map(t => t.rank).sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
      const show = titles.find(t => t.id === 'code-red');
      expect(show.episodes).toHaveLength(12);
      for (const e of show.episodes) expect(files).toContain(e.src);
      expect(live.filter(l => l.status === 'LIVE')).toHaveLength(3);
      expect(live.find(l => l.status === 'UPCOMING').startsAt).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d$/);
      expect(plans.map(p => p.plan)).toEqual(['Mobile', 'Super', 'Premium']);
      // The app reads it as data.cat, from this workflow.
      expect(f.ui.spec.data).toEqual([expect.objectContaining({ name: 'cat', workflow: 'StarPlay', auto: true })]);
    } finally { osrv.close(); ott.flows.close(); list.close(); }
  });
});
