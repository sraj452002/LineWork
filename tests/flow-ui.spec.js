import { test, expect } from '@playwright/test';
import { openStore } from '../backend/store.js';
import { memoryBackend } from '../backend/drive.js';
import { createApp } from '../backend/app.js';
import { markdown, renderPage } from '../backend/flow-ui.js';

// Pages made of workflow nodes: the Page trigger's link runs the workflow and shows what its UI nodes
// draw; buttons and forms run it again. Drawn without scripts, everything escaped.

test('Markdown and blocks are escaped; only web links and page links are kept', () => {
  expect(markdown('# Hi **there**\n- one\n- [two](https://example.com)\n\n<script>x</script> [bad](javascript:alert)'))
    .toBe('<h2>Hi <b>there</b></h2><ul><li>one</li><li><a href="https://example.com">two</a></li></ul><p>&lt;script&gt;x&lt;/script&gt; bad</p>');
  const html = renderPage({ title: '<b>T</b>' }, [
    { kind: 'buttons', buttons: [{ label: 'Evil', href: '' }, { label: 'Film', href: '?category=Film' }] },
    { kind: 'table', title: '', columns: ['name'], rows: [{ name: '<img src=x onerror=alert(1)>' }], more: 0 },
  ], { query: { category: 'Film' } });
  expect(html).toContain('<title>&lt;b&gt;T&lt;/b&gt;</title>');
  expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
  expect(html).toContain('<a class="btn on" href="?category=Film">Film</a>');
  expect(html).not.toMatch(/<script/i);
});

test.describe('a page made of nodes', () => {
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
  // Page → Orders (Code) → Heading → Cards → Chart → Buttons → Search form → Table → a gallery.
  const flow = active => ({ active, nodes: [
    { id: 'p', type: 'trigger.page', name: 'Page', params: { path: 'salespage1234567', title: 'Sales', description: 'Orders by region', theme: 'light' } },
    { id: 'c', type: 'core.code', name: 'Orders', params: { language: 'javascript', code: `const { query = {}, form = {} } = items[0];
const all = [
  { customer: 'Ada', region: 'North', total: 120, pic: 'https://example.com/a.png' },
  { customer: 'Grace', region: 'South', total: 80, pic: 'javascript:alert(1)' },
  { customer: '<b>Tim</b>', region: 'North', total: 45, pic: 'https://example.com/t.png' },
];
return all.filter(o => !query.region || o.region === query.region)
  .filter(o => !form.customer || o.customer.toLowerCase().includes(form.customer.toLowerCase()));` } },
    { id: 't', type: 'ui.text', name: 'Heading', params: { text: '## Hello {{ $node["Page"].json.form.customer || "everyone" }}', style: 'text' } },
    { id: 'k', type: 'ui.cards', name: 'Cards', params: { cards: [{ name: 'Orders', value: '{{ $items.length }}' }, { name: 'Revenue', value: '{{ $items.reduce((s, i) => s + i.total, 0) }}' }] } },
    { id: 'g', type: 'ui.chart', name: 'Chart', params: { title: 'By customer', type: 'bar', label: 'customer', value: 'total' } },
    { id: 'b', type: 'ui.buttons', name: 'Regions', params: { buttons: [{ name: 'All', value: '?' }, { name: 'North', value: '?region=North' }, { name: 'South', value: '?region=South' }] } },
    { id: 'f', type: 'ui.form', name: 'Search', params: { fields: 'Customer', button: 'Search', action: 'search' } },
    { id: 'r', type: 'ui.table', name: 'Table', params: { title: 'Orders', columns: 'customer, region, total' } },
    { id: 'm', type: 'ui.media', name: 'Pictures', params: { url: '{{ $json.pic }}', caption: '{{ $json.customer }}', layout: 'gallery', kind: 'auto' } },
  ], edges: ['pc', 'ct', 'tk', 'kg', 'gb', 'bf', 'fr', 'rm'].map(([a, b]) => ({ from: a, to: b, fromPort: 'main', toPort: 'main' })) });

  test('opening the link runs the workflow and draws the page; buttons and forms run it again', async () => {
    await call('POST', '/auth/signup', { email: 'pages@example.com', password: 'a long password' });
    // Not Active: no page.
    expect((await call('PUT', '/files/f_page', { id: 'f_page', title: 'Sales', diagrams: [], doc: '', updated: Date.now(), flow: flow(false) })).status).toBe(200);
    expect((await fetch(`${base}/hook/salespage1234567`)).status).toBe(404);
    // The editor's preview works anyway, from the flow as it is.
    const pre = await call('POST', '/flows/f_page/page', { flow: flow(false) });
    expect(pre.json.html).toContain('<h1>Sales</h1>');

    expect((await call('PUT', '/files/f_page', { id: 'f_page', title: 'Sales', diagrams: [], doc: '', updated: Date.now(), flow: flow(true) })).status).toBe(200);
    const res = await fetch(`${base}/hook/salespage1234567`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/text\/html/);
    expect(res.headers.get('content-security-policy')).toMatch(/^sandbox allow-forms/);
    const html = await res.text();
    expect(html).toContain('<h3>Hello everyone</h3>');
    expect(html).toMatch(/<span>Orders<\/span><b>3<\/b>/);
    expect(html).toMatch(/<span>Revenue<\/span><b>245<\/b>/);
    expect(html).toContain('<svg class="chart"');
    expect(html).toContain('<td>&lt;b&gt;Tim&lt;/b&gt;</td>');
    expect(html).toContain('<a class="btn on" href="?">All</a>');
    expect(html).toContain('src="https://example.com/a.png"');
    expect(html).not.toContain('javascript:');
    expect(html).not.toMatch(/<script/i);
    // The order of the blocks is the order of the nodes.
    const order = ['<h3>Hello', 'class="cards"', 'class="chart"', 'class="buttons"', '<form', '<table', 'class="media gallery"'].map(s => html.indexOf(s));
    expect(order).toEqual([...order].sort((a, b) => a - b));

    // A button: ?region=North.
    const north = await (await fetch(`${base}/hook/salespage1234567?region=North`)).text();
    expect(north).toMatch(/<span>Orders<\/span><b>2<\/b>/);
    expect(north).toContain('<a class="btn on" href="?region=North">North</a>');
    // The form: the workflow runs with { action: 'search', form }; the answer stays filled in.
    const found = await (await fetch(`${base}/hook/salespage1234567`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: '_action=search&customer=ada' })).text();
    expect(found).toContain('<h3>Hello ada</h3>');
    expect(found).toMatch(/<span>Orders<\/span><b>1<\/b>/);
    expect(found).toContain('value="ada"');
  });

  test('in a browser: the page works with its buttons and form, with no scripts at all', async ({ page }) => {
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(`${base}/hook/salespage1234567`);
    await expect(page.getByRole('heading', { name: 'Sales', level: 1 })).toBeVisible();
    await expect(page.locator('table tbody tr')).toHaveCount(3);
    await page.getByRole('link', { name: 'South' }).click();
    await expect(page).toHaveURL(/region=South$/);
    await expect(page.locator('table tbody tr')).toHaveCount(1);
    await expect(page.locator('table tbody')).toContainText('Grace');
    await page.getByLabel('Customer').fill('gra');
    await page.getByRole('button', { name: 'Search' }).click();
    await expect(page.getByRole('heading', { name: 'Hello gra' })).toBeVisible();
    await expect(page.getByLabel('Customer')).toHaveValue('gra');
    expect(errors).toEqual([]);
  });

  test('a failing workflow shows its error on the page', async () => {
    const bad = flow(true);
    bad.nodes[1].params.code = 'throw new Error("the database is down")';
    await call('PUT', '/files/f_page', { id: 'f_page', title: 'Sales', diagrams: [], doc: '', updated: Date.now(), flow: bad });
    const html = await (await fetch(`${base}/hook/salespage1234567`)).text();
    expect(html).toContain('class="error">Something went wrong:');
    expect(html).toContain('the database is down');
  });
});
