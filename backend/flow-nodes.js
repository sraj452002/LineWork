import vm from 'node:vm';
import { createHash, createHmac, randomBytes, randomUUID } from 'node:crypto';
import { FlowError, getPath, items, setPath } from './flow-engine.js';
import { handle as dbHandle } from './dbconnect.js';
import { cred, each, failIfBad, json, need, obj, pairs, request } from './flow-util.js';

/* What each kind of workflow node does. A node gets its input items and returns {port: items}; most
   run once per item, reading params filled in for that item (params(item, i)). ctx (from flows.js):
   {uid, cred(id) → its fields, ai: {key, base, model, allow()}, mailer, allowPrivate}. */


const COMPARE = {
  equals: (a, b) => String(a) === String(b),
  notEquals: (a, b) => String(a) !== String(b),
  contains: (a, b) => String(a ?? '').includes(String(b)),
  notContains: (a, b) => !String(a ?? '').includes(String(b)),
  gt: (a, b) => Number(a) > Number(b),
  gte: (a, b) => Number(a) >= Number(b),
  lt: (a, b) => Number(a) < Number(b),
  lte: (a, b) => Number(a) <= Number(b),
  isEmpty: a => a === undefined || a === null || a === '' || (Array.isArray(a) && !a.length),
  isNotEmpty: a => !(a === undefined || a === null || a === '' || (Array.isArray(a) && !a.length)),
  isTrue: a => a === true || a === 'true',
  isFalse: a => a === false || a === 'false',
};

export const NODE_TYPES = {
  /* ---- triggers: the run starts with their input ---- */
  'trigger.manual': { run: ({ items: list }) => ({ main: list }) },
  'trigger.webhook': { run: ({ items: list }) => ({ main: list }) },
  'trigger.schedule': { run: ({ items: list }) => ({ main: list }) },

  /* ---- logic ---- */
  'core.set': { run: args => each(args, (p, item) => {
    const out = p.keep === false ? {} : structuredClone(item.json);
    for (const f of Array.isArray(p.fields) ? p.fields : []) if (f && f.name) setPath(out, f.name, f.value);
    return out;
  }) },
  'core.if': { run: args => {
    const yes = [], no = [];
    args.items.forEach((item, i) => {
      const p = args.params(item, i);
      const test = COMPARE[p.op || 'equals'];
      if (!test) throw new FlowError(`Unknown comparison “${p.op}”.`, 'bad_param');
      (test(p.left, p.right) ? yes : no).push(item);
    });
    return { true: yes, false: no };
  } },
  'core.merge': { run: ({ inputs }) => ({ main: [...(inputs.a || []), ...(inputs.b || []), ...(inputs.main || [])] }) },
  'core.delay': { run: async args => {
    const s = Math.min(60, Math.max(0, Number(args.params().seconds) || 0));
    await new Promise(r => setTimeout(r, s * 1000));
    return { main: args.items };
  } },
  'core.split': { run: args => each(args, (p, item) => {
    const list = getPath(item.json, need(p.field, 'the field holding the list'));
    if (!Array.isArray(list)) throw new FlowError(`“${p.field}” isn't a list.`, 'bad_param');
    return list;
  }) },
  'core.code': { run: async args => {
    const code = need(args.node.params?.code, 'the code');
    const logs = [];
    const sandbox = {
      console: { log: (...a) => logs.push(a.map(v => (typeof v === 'string' ? v : JSON.stringify(v))).join(' ')) },
      fetch, URL, URLSearchParams, JSON, Math, Date, structuredClone, setTimeout,
    };
    let fn;
    try { fn = vm.runInNewContext(`(async (items, $input) => {\n${code}\n})`, sandbox, { timeout: 1000 }); }
    catch (e) { throw new FlowError(`The code doesn't parse: ${e.message}`, 'code'); }
    const input = args.items.map(x => structuredClone(x.json));
    let result;
    try {
      result = await Promise.race([
        fn(input, { all: () => input, first: () => input[0] }),
        new Promise((_, rej) => setTimeout(() => rej(new Error('it ran for more than 10 seconds')), 10_000)),
      ]);
    } catch (e) { throw new FlowError(`The code failed: ${e.message}`, 'code'); }
    if (result === undefined) result = input;
    const out = items(Array.isArray(result) ? result.map(r => (r && r.json && Object.keys(r).length === 1 ? r.json : r)) : result);
    if (logs.length && out[0]) out[0].json = { ...out[0].json, _logs: logs };
    return { main: out };
  } },

  /* ---- calling things ---- */
  'core.http': { run: args => each(args, async p => {
    const headers = pairs(p.headers);
    if (args.node.credential) {
      const c = await args.ctx.cred(args.node.credential);
      if (c.token) headers.authorization = `Bearer ${c.token}`;
      if (c.headerName) headers[c.headerName] = c.headerValue || '';
    }
    const url = new URL(need(p.url, 'the URL'));
    for (const [k, v] of Object.entries(pairs(p.query))) url.searchParams.set(k, v);
    const method = String(p.method || 'GET').toUpperCase();
    let body;
    if (!['GET', 'HEAD'].includes(method) && p.bodyType !== 'none') {
      if (p.bodyType === 'text') body = String(p.body ?? '');
      else { body = typeof p.body === 'string' ? p.body : JSON.stringify(p.body ?? {}); headers['content-type'] ||= 'application/json'; }
    }
    const r = await request(url.toString(), { method, headers, body }, { allowPrivate: args.ctx.allowPrivate });
    if (!r.ok && p.failOnError !== false) failIfBad(r, url.host);
    return Array.isArray(r.body) ? r.body : typeof r.body === 'object' && r.body ? r.body : { status: r.status, body: r.body };
  }) },
  'ai.claude': { run: args => each(args, async p => {
    const ai = args.ctx.ai || {};
    if (!ai.key) throw new FlowError('AI is off on this server (no ANTHROPIC_API_KEY).', 'ai_off');
    if (!ai.allow()) throw new FlowError('Today’s AI allowance is used up.', 'ai_limit');
    const r = await request(`${ai.base}/v1/messages`, {
      method: 'POST', headers: { 'x-api-key': ai.key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model: ai.model, max_tokens: Math.min(4000, Number(p.maxTokens) || 1024), ...(p.system ? { system: String(p.system) } : {}), messages: [{ role: 'user', content: String(need(p.prompt, 'the prompt')) }] }),
    }, { allowPrivate: true, timeout: 90_000 });
    const body = failIfBad(r, 'Claude');
    return { text: (body.content || []).filter(c => c.type === 'text').map(c => c.text).join('') };
  }) },

  /* ---- apps (each with a credential) ---- */
  'app.slack': { run: async args => {
    const c = await cred(args);
    return each(args, async p => {
      const text = need(p.text, 'the message');
      if (c.webhookUrl) { const r = await request(c.webhookUrl, json({ text }), { allowPrivate: args.ctx.allowPrivate }); failIfBad(r, 'Slack'); return { ok: true }; }
      const r = await request('https://slack.com/api/chat.postMessage', { ...json({ channel: need(p.channel, 'the channel'), text }), headers: { 'content-type': 'application/json', authorization: `Bearer ${need(c.token, 'the bot token')}` } });
      const body = failIfBad(r, 'Slack');
      if (!body.ok) throw new FlowError(`Slack: ${body.error}`, 'service');
      return { ok: true, channel: body.channel, ts: body.ts };
    });
  } },
  'app.discord': { run: async args => {
    const c = await cred(args);
    return each(args, async p => {
      const r = await request(`${need(c.webhookUrl, 'the webhook URL')}?wait=true`, json({ content: need(p.content, 'the message'), ...(p.username ? { username: p.username } : {}) }), { allowPrivate: args.ctx.allowPrivate });
      const body = failIfBad(r, 'Discord');
      return { ok: true, id: body?.id };
    });
  } },
  'app.telegram': { run: async args => {
    const c = await cred(args);
    return each(args, async p => {
      const r = await request(`https://api.telegram.org/bot${need(c.botToken, 'the bot token')}/sendMessage`, json({ chat_id: need(p.chatId, 'the chat id'), text: need(p.text, 'the message') }));
      const body = failIfBad(r, 'Telegram');
      return { ok: true, messageId: body?.result?.message_id };
    });
  } },
  'app.github': { run: async args => {
    const c = await cred(args);
    const gh = (path, init = {}) => request(`https://api.github.com${path}`, { ...init, headers: { accept: 'application/vnd.github+json', 'user-agent': 'Workline', authorization: `Bearer ${need(c.token, 'the token')}`, ...(init.body ? { 'content-type': 'application/json' } : {}) } });
    return each(args, async p => {
      const repo = `${encodeURIComponent(need(p.owner, 'the owner'))}/${encodeURIComponent(need(p.repo, 'the repository'))}`;
      if (p.operation === 'getRepo') return failIfBad(await gh(`/repos/${repo}`), 'GitHub');
      if (p.operation === 'listIssues') return failIfBad(await gh(`/repos/${repo}/issues?state=${encodeURIComponent(p.state || 'open')}&per_page=50`), 'GitHub');
      const r = await gh(`/repos/${repo}/issues`, { method: 'POST', body: JSON.stringify({ title: need(p.title, 'the title'), body: p.body || '' }) });
      const body = failIfBad(r, 'GitHub');
      return { number: body.number, url: body.html_url, title: body.title };
    });
  } },
  'app.notion': { run: async args => {
    const c = await cred(args);
    const nt = (path, body) => request(`https://api.notion.com/v1${path}`, { ...json(body), headers: { 'content-type': 'application/json', 'notion-version': '2022-06-28', authorization: `Bearer ${need(c.token, 'the token')}` } });
    return each(args, async p => {
      const db = need(p.databaseId, 'the database id');
      if (p.operation === 'query') return (failIfBad(await nt(`/databases/${encodeURIComponent(db)}/query`, { page_size: 50 }), 'Notion').results || []);
      const page = {
        parent: { database_id: db },
        properties: { [p.titleProperty || 'Name']: { title: [{ text: { content: String(need(p.title, 'the title')) } }] } },
        ...(p.content ? { children: [{ object: 'block', type: 'paragraph', paragraph: { rich_text: [{ type: 'text', text: { content: String(p.content).slice(0, 2000) } }] } }] } : {}),
      };
      const body = failIfBad(await nt('/pages', page), 'Notion');
      return { id: body.id, url: body.url };
    });
  } },
  'app.email': { run: async args => {
    const c = args.node.credential ? await args.ctx.cred(args.node.credential) : null;
    let send;
    if (c && c.smtpUrl) {
      const { default: nodemailer } = await import('nodemailer');
      const t = nodemailer.createTransport(c.smtpUrl);
      send = m => t.sendMail({ from: c.from || undefined, ...m });
    } else if (args.ctx.mailer?.configured) send = m => args.ctx.mailer.send(m);
    else throw new FlowError('Pick an email (SMTP) credential: this server has no email set up.', 'no_credential');
    return each(args, async p => {
      await send({ to: need(p.to, 'who it goes to'), subject: String(p.subject || ''), text: String(p.text || ''), html: p.html ? String(p.html) : undefined });
      return { sent: true, to: p.to };
    });
  } },
  'app.database': { run: async args => {
    const conn = await cred(args);
    return each(args, async p => {
      const r = await dbHandle({ op: 'query', conn, sql: need(p.sql, 'the query') }, { allowPrivate: args.ctx.allowPrivate, timeout: 30_000 })
        .catch(e => { throw new FlowError(e.message, 'database'); });
      const set = (r.results || []).slice(-1)[0];
      if (!set || !set.rows) return { command: set?.command, count: set?.count ?? 0 };
      return set.rows.map(row => Object.fromEntries(set.columns.map((col, i) => [col, row[i]])));
    });
  } },
};

/* ---- more logic and data: filtering, shaping, text, dates, files and public feeds ---- */
const field = (item, f) => (f ? getPath(item.json, f) : item.json);
const put = (item, out, value) => { const j = structuredClone(item.json); setPath(j, out || 'result', value); return j; };
const csvSplit = (line, sep) => {
  const cells = [];
  let cur = '', q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) { if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; } else if (c === '"') q = false; else cur += c; }
    else if (c === '"') q = true; else if (c === sep) { cells.push(cur); cur = ''; } else cur += c;
  }
  cells.push(cur);
  return cells;
};
const DATE_UNIT = { seconds: 1e3, minutes: 6e4, hours: 36e5, days: 864e5, weeks: 6048e5 };
const toDate = v => {
  const d = v === undefined || v === '' ? new Date() : typeof v === 'number' && v < 1e11 ? new Date(v * 1000) : new Date(v);
  if (isNaN(d)) throw new FlowError(`“${v}” is not a date.`, 'bad_param');
  return d;
};
const tagText = (xml, tag) => {
  const m = xml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i'));
  return m ? m[1].replace(/^<!\[CDATA\[|\]\]>$/g, '').trim() : '';
};
const compare = p => { const t = COMPARE[p.op || 'equals']; if (!t) throw new FlowError(`Unknown comparison “${p.op}”.`, 'bad_param'); return t(p.left, p.right); };

Object.assign(NODE_TYPES, {
  'core.filter': { run: args => ({ main: args.items.filter((item, i) => compare(args.params(item, i))) }) },
  // Up to four rules; an item leaves by the first rule its value matches, else by "other".
  'core.switch': { run: args => {
    const out = { 0: [], 1: [], 2: [], 3: [], other: [] };
    args.items.forEach((item, i) => {
      const p = args.params(item, i), rules = [p.rule1, p.rule2, p.rule3, p.rule4];
      const hit = rules.findIndex(r => r !== undefined && r !== '' && String(r) === String(p.value));
      out[hit < 0 ? 'other' : hit].push(item);
    });
    return out;
  } },
  'core.sort': { run: args => {
    const p = args.params(), dir = p.order === 'desc' ? -1 : 1;
    const key = it => { const v = getPath(it.json, p.field); return typeof v === 'number' ? v : v === '' || v == null || isNaN(Number(v)) ? String(v ?? '').toLowerCase() : Number(v); };
    return { main: [...args.items].sort((a, b) => { const x = key(a), y = key(b); return (x < y ? -1 : x > y ? 1 : 0) * dir; }) };
  } },
  'core.limit': { run: args => {
    const p = args.params(), n = Math.max(0, Number(p.max) || 0);
    return { main: p.from === 'end' ? (n ? args.items.slice(-n) : []) : args.items.slice(0, n) };
  } },
  'core.dedupe': { run: args => {
    const p = args.params(), seen = new Set();
    return { main: args.items.filter(it => { const k = JSON.stringify(field(it, p.field)); if (seen.has(k)) return false; seen.add(k); return true; }) };
  } },
  'core.aggregate': { run: args => { const p = args.params(); return { main: [{ json: { [p.into || 'items']: args.items.map(it => field(it, p.field)) } }] }; } },
  'core.summarize': { run: args => {
    const p = args.params(), groups = new Map();
    for (const it of args.items) {
      const g = p.groupBy ? String(getPath(it.json, p.groupBy) ?? '') : 'all';
      if (!groups.has(g)) groups.set(g, []);
      groups.get(g).push(it);
    }
    return { main: [...groups].map(([g, list]) => {
      const nums = list.map(it => Number(getPath(it.json, p.field))).filter(n => !isNaN(n));
      const sum = nums.reduce((a, b) => a + b, 0);
      const value = p.op === 'sum' ? sum : p.op === 'avg' ? (nums.length ? sum / nums.length : null)
        : p.op === 'min' ? (nums.length ? Math.min(...nums) : null) : p.op === 'max' ? (nums.length ? Math.max(...nums) : null) : list.length;
      return { json: { ...(p.groupBy ? { [p.groupBy]: g } : {}), [p.op || 'count']: value } };
    }) };
  } },
  'core.rename': { run: args => ({ main: args.items.map((it, i) => {
    const j = structuredClone(it.json);
    for (const r of args.params(it, i).fields || []) {
      if (!r || !r.name || !r.value || getPath(j, r.name) === undefined) continue;
      setPath(j, r.value, getPath(j, r.name));
      const keys = r.name.split('.'), last = keys.pop(), parent = keys.length ? getPath(j, keys.join('.')) : j;
      if (parent) delete parent[last];
    }
    return { json: j };
  }) }) },
  'core.datetime': { run: args => each(args, (p, item) => {
    const d = toDate(p.value);
    let v;
    if (p.operation === 'add' || p.operation === 'subtract') v = new Date(d.getTime() + (p.operation === 'add' ? 1 : -1) * (Number(p.amount) || 0) * (DATE_UNIT[p.unit] || DATE_UNIT.days)).toISOString();
    else if (p.operation === 'diff') v = Math.round((toDate(p.other).getTime() - d.getTime()) / (DATE_UNIT[p.unit] || DATE_UNIT.days) * 100) / 100;
    else if (p.operation === 'toUnix') v = Math.floor(d.getTime() / 1000);
    else if (p.format === 'date') v = d.toISOString().slice(0, 10);
    else if (p.format === 'time') v = d.toISOString().slice(11, 19);
    else if (p.format === 'locale') v = d.toLocaleString('en-GB', { timeZone: p.timeZone || 'UTC' });
    else v = d.toISOString();
    return put(item, p.output || 'date', v);
  }) },
  'core.crypto': { run: args => each(args, (p, item) => {
    const text = String(p.value ?? '');
    const v = p.operation === 'uuid' ? randomUUID()
      : p.operation === 'random' ? randomBytes(Math.min(256, Number(p.length) || 16)).toString('hex')
      : p.operation === 'hmac' ? createHmac(p.algorithm || 'sha256', String(need(p.secret, 'the secret'))).update(text).digest(p.encoding || 'hex')
      : p.operation === 'base64Encode' ? Buffer.from(text).toString('base64')
      : p.operation === 'base64Decode' ? Buffer.from(text, 'base64').toString('utf8')
      : createHash(p.algorithm || 'sha256').update(text).digest(p.encoding || 'hex');
    return put(item, p.output || 'hash', v);
  }) },
  'core.text': { run: args => each(args, (p, item) => {
    const t = String(p.value ?? '');
    const ops = {
      upper: () => t.toUpperCase(), lower: () => t.toLowerCase(), trim: () => t.trim(), length: () => t.length,
      replace: () => t.split(String(p.find ?? '')).join(String(p.replaceWith ?? '')),
      split: () => t.split(p.separator === undefined || p.separator === '' ? ',' : String(p.separator)).map(s => s.trim()),
      slug: () => t.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''),
      truncate: () => (t.length > (Number(p.max) || 100) ? t.slice(0, Number(p.max) || 100) + '…' : t),
      words: () => (t.trim() ? t.trim().split(/\s+/).length : 0),
    };
    const op = ops[p.operation || 'trim'];
    if (!op) throw new FlowError(`Unknown text operation “${p.operation}”.`, 'bad_param');
    return put(item, p.output || 'text', op());
  }) },
  'core.json': { run: args => each(args, (p, item) => {
    const v = field(item, p.field);
    if (p.operation === 'stringify') return put(item, p.output || p.field || 'json', JSON.stringify(v, null, p.pretty ? 2 : 0));
    try { return put(item, p.output || p.field || 'data', typeof v === 'string' ? JSON.parse(v) : v); }
    catch (e) { throw new FlowError(`“${p.field}” is not valid JSON: ${e.message}`, 'bad_param'); }
  }) },
  'core.regex': { run: args => each(args, (p, item) => {
    let re;
    try { re = new RegExp(need(p.pattern, 'the pattern'), String(p.flags || '').replace(/[^gimsuy]/g, '')); }
    catch (e) { throw new FlowError(`That pattern does not work: ${e.message}`, 'bad_param'); }
    const text = String(p.value ?? '');
    const all = re.global ? [...text.matchAll(re)] : [text.match(re)].filter(Boolean);
    const v = all.map(m => (m.length > 1 ? (m.length === 2 ? m[1] : m.slice(1)) : m[0]));
    return put(item, p.output || 'matches', re.global ? v : v[0] ?? null);
  }) },
  'core.csv': { run: args => {
    const p = args.params(), sep = p.separator || ',';
    if (p.operation === 'build') {
      const rows = args.items.map(it => it.json), cols = [...new Set(rows.flatMap(r => Object.keys(r)))];
      const cell = v => { const s = v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v); return /[",\n\r]/.test(s) || s.includes(sep) ? `"${s.replace(/"/g, '""')}"` : s; };
      return { main: [{ json: { [p.output || 'csv']: [cols.join(sep), ...rows.map(r => cols.map(c => cell(r[c])).join(sep))].join('\n') } }] };
    }
    const out = [];
    args.items.forEach((item, i) => {
      const lines = String(args.params(item, i).text ?? '').split(/\r?\n/).filter(l => l.trim());
      if (!lines.length) return;
      const head = csvSplit(lines[0], sep).map(h => h.trim());
      for (const l of lines.slice(1)) { const cells = csvSplit(l, sep); out.push({ json: Object.fromEntries(head.map((h, k) => [h || `column${k + 1}`, cells[k] ?? ''])) }); }
    });
    return { main: out };
  } },
  'core.chunk': { run: args => {
    const n = Math.max(1, Number(args.params().size) || 10), out = [];
    for (let i = 0; i < args.items.length; i += n) out.push({ json: { items: args.items.slice(i, i + n).map(x => x.json) } });
    return { main: out };
  } },
  'core.stop': { run: args => { throw new FlowError(String(args.params().message || 'Stopped by the workflow.'), 'stopped'); } },
  'core.noop': { run: ({ items: list }) => ({ main: list }) },
  'core.subflow': { run: async args => {
    const p = args.params();
    if (!args.ctx.runFile) throw new FlowError('Running another workflow needs the server.', 'no_server');
    return { main: await args.ctx.runFile(need(p.fileId, 'the workflow to run'), args.items) };
  } },

  /* ---- public data, no credential ---- */
  'data.rss': { run: args => each(args, async p => {
    const r = await request(need(p.url, 'the feed URL'), { headers: { accept: 'application/rss+xml, application/atom+xml, text/xml' } }, { allowPrivate: args.ctx.allowPrivate });
    const xml = typeof r.body === 'string' ? r.body : '';
    const blocks = xml.match(/<item[\s>][\s\S]*?<\/item>/gi) || xml.match(/<entry[\s>][\s\S]*?<\/entry>/gi) || [];
    return blocks.slice(0, Math.min(200, Number(p.limit) || 50)).map(b => ({
      title: tagText(b, 'title'),
      link: tagText(b, 'link') || (b.match(/<link[^>]*href="([^"]+)"/i) || [])[1] || '',
      date: tagText(b, 'pubDate') || tagText(b, 'updated') || tagText(b, 'published'),
      summary: tagText(b, 'description') || tagText(b, 'summary'),
    }));
  }) },
  'data.weather': { run: args => each(args, async p => {
    const r = await request(`https://api.open-meteo.com/v1/forecast?latitude=${encodeURIComponent(need(p.latitude, 'the latitude'))}&longitude=${encodeURIComponent(need(p.longitude, 'the longitude'))}&current=temperature_2m,relative_humidity_2m,wind_speed_10m,precipitation,weather_code&timezone=auto`);
    const body = failIfBad(r, 'Open-Meteo');
    return { ...body.current, units: body.current_units, timezone: body.timezone };
  }) },
  'data.hackernews': { run: async args => {
    const p = args.params(), list = ['top', 'new', 'best', 'ask', 'show'].includes(p.list) ? p.list : 'top';
    const ids = failIfBad(await request(`https://hacker-news.firebaseio.com/v0/${list}stories.json`), 'Hacker News').slice(0, Math.min(50, Number(p.limit) || 10));
    const stories = await Promise.all(ids.map(id => request(`https://hacker-news.firebaseio.com/v0/item/${id}.json`).then(r => r.body)));
    return { main: stories.filter(Boolean).map(s => ({ json: { id: s.id, title: s.title, url: s.url || `https://news.ycombinator.com/item?id=${s.id}`, score: s.score, by: s.by, comments: s.descendants, time: new Date(s.time * 1000).toISOString() } })) };
  } },
});
