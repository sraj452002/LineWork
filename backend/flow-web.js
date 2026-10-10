import { parse } from 'node-html-parser';
import { FlowError } from './flow-engine.js';
import { checkHost } from './dbconnect.js';
import { cred, failIfBad, need, pairs, request } from './flow-util.js';

/* Reading web pages in workflows.
   - web.page: fetches a page as it is sent (no JavaScript runs) and pulls things out of it.
   - web.browser: a real browser, through Browserless (a hosted Chrome; their key in a credential):
     pages built by JavaScript, steps (click, type, wait), screenshots and PDFs.
   Both pull things out the same way: the page's text, its links, its tables, the elements a CSS
   selector finds, or named fields (each a selector). */

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36 Workline';
const clean = s => String(s || '').replace(/\s+/g, ' ').trim();
const abs = (href, base) => { try { return new URL(href, base).toString(); } catch (e) { return href || ''; } };
// "a.title @href" → the selector, and the attribute to read (else the text).
const target = spec => { const m = /^(.*?)(?:\s+@([\w:-]+))?\s*$/.exec(String(spec || '')); return { sel: m[1].trim(), attr: m[2] }; };
const valueOf = (el, attr, base) => (!el ? null : attr ? (/^(href|src|action)$/i.test(attr) ? abs(el.getAttribute(attr), base) : el.getAttribute(attr) ?? null) : clean(el.text));
const pick = (root, sel) => { try { return root.querySelectorAll(sel); } catch (e) { throw new FlowError(`“${sel}” isn’t a CSS selector this node understands.`, 'bad_param'); } };

// What to take from a page's HTML: a list of items (plain objects).
export function extract(html, url, p) {
  const root = parse(String(html || ''), { blockTextElements: { script: false, style: false, noscript: false } });
  const limit = Math.min(1000, Math.max(1, Number(p.limit) || 100));
  const what = p.extract || 'text';
  if (what === 'html') return [{ url, html: String(html).slice(0, 500_000) }];
  if (what === 'links') {
    const seen = new Set();
    return pick(root, p.selector ? `${p.selector} a[href]` : 'a[href]').map(a => ({ text: clean(a.text), url: abs(a.getAttribute('href'), url) }))
      .filter(l => /^https?:/.test(l.url) && !seen.has(l.url) && seen.add(l.url)).slice(0, limit);
  }
  if (what === 'tables') {
    const tables = pick(root, p.selector || 'table');
    const out = [];
    tables.forEach((t, ti) => {
      const rows = t.querySelectorAll('tr').map(tr => tr.querySelectorAll('th,td').map(c => clean(c.text)));
      if (!rows.length) return;
      const head = t.querySelector('thead tr, tr:first-child')?.querySelectorAll('th').length ? rows.shift() : rows[0].map((_, i) => `column${i + 1}`);
      for (const r of rows) out.push({ ...(tables.length > 1 ? { table: ti + 1 } : {}), ...Object.fromEntries(head.map((h, i) => [h || `column${i + 1}`, r[i] ?? ''])) });
    });
    return out.slice(0, limit);
  }
  if (what === 'selector') {
    const { sel, attr } = target(need(p.selector, 'the CSS selector'));
    return pick(root, sel).slice(0, limit).map(el => ({ value: valueOf(el, attr || p.attribute, url), text: clean(el.text), ...(el.getAttribute('href') ? { href: abs(el.getAttribute('href'), url) } : {}) }));
  }
  if (what === 'fields') {
    const map = pairs(p.fields);
    if (!Object.keys(map).length) throw new FlowError('Add at least one field: a name, and the CSS selector to read it from.', 'missing');
    // With "Repeat for each", one item per match of that selector, its fields read inside it.
    const blocks = p.each ? pick(root, p.each).slice(0, limit) : [root];
    return blocks.map(b => Object.fromEntries(Object.entries(map).map(([name, spec]) => {
      const { sel, attr } = target(spec);
      return [name, valueOf(sel ? b.querySelector(sel) : b, attr, url)];
    })));
  }
  // text: the readable page.
  const title = clean(root.querySelector('title')?.text);
  const description = root.querySelector('meta[name="description"], meta[property="og:description"]')?.getAttribute('content') || '';
  const body = root.querySelector(p.selector || 'main, article, body') || root;
  body.querySelectorAll('script, style, noscript, svg, nav, footer, header').forEach(n => n.remove());
  return [{ url, title, description: clean(description), text: clean(body.text).slice(0, 50_000) }];
}

/* ---- Browserless ---- */
const BROWSERLESS = 'https://production-sfo.browserless.io';
// One step a line: click <selector> · type <selector> | <text> · wait <selector> · press <key> · sleep <ms> · scroll
export function steps(text) {
  return String(text || '').split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#')).slice(0, 50).map(l => {
    const [, act = '', rest = ''] = /^(\w+)\s*(.*)$/.exec(l) || [];
    const [sel, ...more] = rest.split('|');
    const action = act.toLowerCase();
    if (!['click', 'type', 'wait', 'press', 'sleep', 'scroll', 'goto'].includes(action)) throw new FlowError(`Unknown step “${l}”. Use click, type, wait, press, sleep, scroll or goto.`, 'bad_param');
    return { action, selector: sel.trim(), text: more.join('|').trim() };
  });
}
// Runs in Browserless's Chrome (puppeteer): open the page, do the steps, give back the page.
const FUNCTION = `export default async function ({ page, context }) {
  await page.setViewport({ width: 1366, height: 900 });
  await page.goto(context.url, { waitUntil: 'networkidle2', timeout: 30000 });
  for (const s of context.steps) {
    if (s.action === 'click') { await page.waitForSelector(s.selector, { timeout: 15000 }); await page.click(s.selector); }
    else if (s.action === 'type') { await page.waitForSelector(s.selector, { timeout: 15000 }); await page.type(s.selector, s.text); }
    else if (s.action === 'wait') await page.waitForSelector(s.selector, { timeout: 20000 });
    else if (s.action === 'press') await page.keyboard.press(s.selector || s.text);
    else if (s.action === 'sleep') await new Promise(r => setTimeout(r, Math.min(15000, Number(s.selector || s.text) || 1000)));
    else if (s.action === 'scroll') await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    else if (s.action === 'goto') await page.goto(s.selector, { waitUntil: 'networkidle2', timeout: 30000 });
    if (s.action === 'click' || s.action === 'press') await new Promise(r => setTimeout(r, 800));
  }
  const shot = context.shot ? await page.screenshot({ type: 'png', fullPage: !!context.fullPage, encoding: 'base64' }) : null;
  return { data: { url: page.url(), title: await page.title(), html: await page.content(), shot }, type: 'application/json' };
}`;

async function browserless(args, c, path, body, binary = false) {
  const base = String(c.baseUrl || BROWSERLESS).replace(/\/+$/, '');
  const url = `${base}/${path}?token=${encodeURIComponent(need(c.token, 'the Browserless token'))}`;
  if (!binary) return failIfBad(await request(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }, { allowPrivate: args.ctx.allowPrivate, timeout: 90_000 }), 'Browserless');
  const u = new URL(url);
  try { await checkHost(u.hostname, args.ctx.allowPrivate); } catch (e) { throw new FlowError(e.message, 'private_host'); }
  const res = await fetch(u, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(90_000) })
    .catch(e => { throw new FlowError(`Couldn't reach Browserless: ${e.cause?.code || e.message}`, 'network'); });
  if (!res.ok) throw new FlowError(`Browserless answered ${res.status}: ${(await res.text()).slice(0, 200)}`, 'service');
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > 8_000_000) throw new FlowError('That file is over 8 MB. Take a smaller part of the page.', 'too_large');
  return buf;
}

export const WEB_NODES = {
  'web.page': { run: async args => {
    const out = [];
    for (let i = 0; i < args.items.length; i++) {
      const p = args.params(args.items[i], i), url = need(p.url, 'the page address');
      const r = await request(url, { headers: { 'user-agent': UA, accept: 'text/html,application/xhtml+xml,*/*;q=0.8', 'accept-language': 'en' } }, { allowPrivate: args.ctx.allowPrivate });
      if (!r.ok) failIfBad(r, new URL(url).host);
      const html = typeof r.body === 'string' ? r.body : JSON.stringify(r.body);
      out.push(...extract(html, url, p).map(json => ({ json })));
    }
    return { main: out };
  } },
  'web.browser': { run: async args => {
    const c = await cred(args), out = [];
    for (let i = 0; i < args.items.length; i++) {
      const p = args.params(args.items[i], i), url = need(p.url, 'the page address'), op = p.operation || 'read';
      if (op === 'screenshot' || op === 'pdf') {
        const buf = await browserless(args, c, op, op === 'pdf'
          ? { url, gotoOptions: { waitUntil: 'networkidle2' }, options: { printBackground: true, format: 'A4' } }
          : { url, gotoOptions: { waitUntil: 'networkidle2' }, options: { type: 'png', fullPage: p.fullPage !== false } }, true);
        const type = op === 'pdf' ? 'application/pdf' : 'image/png';
        out.push({ json: { url, [p.output || (op === 'pdf' ? 'pdf' : 'screenshot')]: `data:${type};base64,${buf.toString('base64')}`, bytes: buf.length } });
        continue;
      }
      const list = op === 'steps' ? steps(p.steps) : [];
      if (p.waitFor) list.push({ action: 'wait', selector: p.waitFor, text: '' });
      const page = await browserless(args, c, 'function', { code: FUNCTION, context: { url, steps: list, shot: p.screenshot === true, fullPage: false } });
      const got = typeof page === 'string' ? JSON.parse(page) : page;
      const items = extract(got.html, got.url || url, p);
      if (got.shot && items[0]) items[0].screenshot = `data:image/png;base64,${got.shot}`;
      out.push(...items.map(json => ({ json })));
    }
    return { main: out };
  } },
};
