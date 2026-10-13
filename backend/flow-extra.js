import { FlowError, getPath, setPath } from './flow-engine.js';
import { checkHost, handle as dbHandle } from './dbconnect.js';
import { googleToken } from './flow-apps.js';
import { api, cred, each, failIfBad, need, obj, pairs, request } from './flow-util.js';

/* More workflow nodes:
   - AI helpers on the server's Claude (summarize, extract, classify, rewrite, translate, read an image,
     decide, score) and calling a tool on an MCP server;
   - triggers: when another workflow fails, a new database row, a new email (IMAP), a new calendar event;
   - Respond to webhook, Pivot, Text splitter, Key-value store, GraphQL, Spreadsheet file, Redis, Sticky note. */

/* ---- Claude, for the AI helpers ---- */
async function claude(args, { system, content, maxTokens = 1024 }) {
  const ai = args.ctx.ai || {};
  if (!ai.key) throw new FlowError('AI is off on this server (no ANTHROPIC_API_KEY).', 'ai_off');
  if (!ai.allow()) throw new FlowError('Today’s AI allowance is used up.', 'ai_limit');
  const r = await request(`${ai.base}/v1/messages`, {
    method: 'POST', headers: { 'x-api-key': ai.key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({ model: ai.model, max_tokens: maxTokens, ...(system ? { system } : {}), messages: [{ role: 'user', content }] }),
  }, { allowPrivate: true, timeout: 90_000 });
  const body = failIfBad(r, 'Claude');
  return (body.content || []).filter(c => c.type === 'text').map(c => c.text).join('').trim();
}
// The first JSON object in Claude's answer.
function jsonIn(text) {
  const s = String(text).replace(/^```(?:json)?\s*|\s*```$/g, '');
  const i = s.indexOf('{'), j = s.lastIndexOf('}');
  try { return JSON.parse(i >= 0 && j > i ? s.slice(i, j + 1) : s); } catch (e) { throw new FlowError(`The AI didn’t answer in the expected form: ${String(text).slice(0, 200)}`, 'ai_format'); }
}
const ONLY_JSON = 'Answer with one JSON object only, no other text.';
const list = v => (Array.isArray(v) ? v : String(v ?? '').split(/[,\n]/)).map(s => String(s).trim()).filter(Boolean);
// The item, with the result put at `output` (dot paths allowed).
const put = (item, out, value) => { const j = structuredClone(item.json); setPath(j, out, value); return j; };
const textOf = p => String(need(p.text, 'the text'));

const LENGTH = { sentence: 'in one sentence', short: 'in two or three sentences', paragraph: 'in one paragraph', bullets: 'as up to five short bullet points (lines starting with "- ")' };
const STYLE = {
  clearer: 'Make it clearer and easier to read, keeping the meaning.', shorter: 'Make it shorter, keeping what matters.', longer: 'Expand it with more detail.',
  formal: 'Make it formal and professional.', friendly: 'Make it warm and friendly.', grammar: 'Fix spelling and grammar only; change nothing else.', custom: '',
};

export const EXTRA_NODES = {
  'ai.summarize': { run: args => each(args, async (p, item) => put(item, p.output || 'summary', await claude(args, {
    system: `Summarise the text the user gives ${LENGTH[p.length] || LENGTH.short}. Reply with the summary only.${p.focus ? ` Focus on: ${p.focus}.` : ''}`,
    content: textOf(p),
  }))) },
  'ai.extract': { run: args => each(args, async (p, item) => {
    const fields = Object.entries(pairs(p.fields));
    if (!fields.length) throw new FlowError('Add the fields to pull out.', 'missing');
    const got = jsonIn(await claude(args, {
      system: `Pull these fields out of the text: ${fields.map(([k, d]) => `"${k}"${d ? ` (${d})` : ''}`).join(', ')}. Use null for a field the text doesn’t give. ${ONLY_JSON}`,
      content: textOf(p),
    }));
    const out = Object.fromEntries(fields.map(([k]) => [k, got[k] ?? null]));
    return p.output ? put(item, p.output, out) : { ...item.json, ...out };
  }) },
  'ai.classify': { run: args => each(args, async (p, item) => {
    const cats = list(p.categories);
    if (cats.length < 2) throw new FlowError('Give at least two categories.', 'missing');
    const many = p.multiple === true || p.multiple === 'true';
    const got = jsonIn(await claude(args, {
      system: `Sort the text into ${many ? 'any of' : 'exactly one of'} these categories: ${cats.map(c => JSON.stringify(c)).join(', ')}.${p.instructions ? ` ${p.instructions}` : ''} ${ONLY_JSON} Form: {"${many ? 'categories' : 'category'}": ${many ? '[…]' : '"…"'}, "confidence": 0 to 1}`,
      content: textOf(p),
    }));
    const pickOne = v => cats.find(c => c.toLowerCase() === String(v ?? '').toLowerCase()) ?? null;
    const value = many ? list(got.categories).map(pickOne).filter(Boolean) : pickOne(got.category);
    const out = put(item, p.output || 'category', value);
    setPath(out, (p.output || 'category') + 'Confidence', typeof got.confidence === 'number' ? got.confidence : null);
    return out;
  }) },
  'ai.rewrite': { run: args => each(args, async (p, item) => put(item, p.output || 'text', await claude(args, {
    system: `Rewrite the text the user gives. ${STYLE[p.style] ?? STYLE.clearer} ${p.instructions || ''} Reply with the rewritten text only.`.trim(),
    content: textOf(p), maxTokens: 4000,
  }))) },
  'ai.translate': { run: args => each(args, async (p, item) => put(item, p.output || 'translation', await claude(args, {
    system: `Translate the text the user gives into ${need(p.language, 'the language')}. Keep names, numbers, links and formatting. Reply with the translation only.`,
    content: textOf(p), maxTokens: 4000,
  }))) },
  'ai.vision': { run: args => each(args, async (p, item) => {
    const url = String(need(p.imageUrl, 'the image URL'));
    if (!/^https:\/\//i.test(url) && !/^data:image\//.test(url)) throw new FlowError('The image must be an https:// URL (or a data: URL).', 'bad_url');
    const m = /^data:(image\/[\w+.-]+);base64,(.+)$/.exec(url);
    const image = m ? { type: 'image', source: { type: 'base64', media_type: m[1], data: m[2] } } : { type: 'image', source: { type: 'url', url } };
    const ask = p.question || 'Describe this image. If it contains text, give all of the text exactly as written.';
    return put(item, p.output || 'answer', await claude(args, { content: [image, { type: 'text', text: ask }], maxTokens: 2000 }));
  }) },
  'ai.decide': { run: args => each(args, async (p, item) => {
    const options = list(p.options);
    if (options.length < 2) throw new FlowError('Give at least two options to choose from.', 'missing');
    const got = jsonIn(await claude(args, {
      system: `Decide: ${need(p.question, 'the question')} Choose one of: ${options.map(o => JSON.stringify(o)).join(', ')}. ${ONLY_JSON} Form: {"decision": "…", "reasoning": "one or two sentences"}`,
      content: String(p.context ?? JSON.stringify(item.json)),
    }));
    const decision = options.find(o => o.toLowerCase() === String(got.decision ?? '').toLowerCase()) ?? null;
    return { ...item.json, decision, reasoning: got.reasoning ?? null };
  }) },
  // Score each item against the criteria; with "sort", the best come first.
  'ai.score': { run: async args => {
    const out = await each(args, async (p, item) => {
      const max = Math.max(1, Number(p.max) || 10);
      const got = jsonIn(await claude(args, {
        system: `Score the text from 0 to ${max} against these criteria: ${need(p.criteria, 'the criteria')}. ${ONLY_JSON} Form: {"score": number, "reason": "one sentence"}`,
        content: String(p.text ?? JSON.stringify(item.json)),
      }));
      return { ...item.json, score: Math.max(0, Math.min(max, Number(got.score) || 0)), reason: got.reason ?? null };
    });
    if (args.params().sort !== false) out.main.sort((a, b) => b.json.score - a.json.score);
    return out;
  } },

  /* ---- MCP: a tool on a remote MCP server (Streamable HTTP) ---- */
  'ai.mcp': { run: async args => {
    const c = args.node.credential ? await cred(args) : null;
    return each(args, async p => {
      const url = String(need(p.url, 'the MCP server URL'));
      const headers = { 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'mcp-protocol-version': '2025-06-18' };
      if (c?.token) headers.authorization = `Bearer ${c.token}`;
      if (c?.headerName) headers[c.headerName] = c.headerValue || '';
      let session = null, id = 0;
      const call = async (method, params, note = false) => {
        const r = await request(url, { method: 'POST', headers: { ...headers, ...(session ? { 'mcp-session-id': session } : {}) }, body: JSON.stringify({ jsonrpc: '2.0', method, ...(params ? { params } : {}), ...(note ? {} : { id: ++id }) }) }, { allowPrivate: args.ctx.allowPrivate, timeout: 60_000 });
        session = r.headers['mcp-session-id'] || session;
        if (note) return null;
        if (!r.ok) failIfBad(r, 'The MCP server');
        // A JSON answer, or a stream of events whose data lines hold it.
        const msgs = typeof r.body === 'object' ? [r.body] : String(r.body).split('\n').filter(l => l.startsWith('data:')).map(l => { try { return JSON.parse(l.slice(5)); } catch (e) { return null; } }).filter(Boolean);
        const m = msgs.find(x => x.id === id) || msgs[msgs.length - 1];
        if (!m) throw new FlowError('The MCP server gave no answer.', 'mcp');
        if (m.error) throw new FlowError(`The MCP server: ${m.error.message || JSON.stringify(m.error)}`, 'mcp');
        return m.result;
      };
      await call('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'Workline', version: '1.0' } });
      await call('notifications/initialized', null, true);
      if (p.operation === 'list') return ((await call('tools/list', {})).tools || []).map(t => ({ name: t.name, description: t.description || '', inputSchema: t.inputSchema || null }));
      const r = await call('tools/call', { name: need(p.tool, 'the tool'), arguments: obj(p.arguments, 'The arguments') });
      const text = (r.content || []).filter(x => x.type === 'text').map(x => x.text).join('\n');
      if (r.isError) throw new FlowError(`The tool failed: ${text || 'no message'}`, 'mcp');
      let data = r.structuredContent ?? null;
      if (data == null && text) { try { data = JSON.parse(text); } catch (e) { /* plain text */ } }
      return { text, data, content: r.content || [] };
    });
  } },

  /* ---- answering the webhook that started the run (with “Respond: when the workflow ends”) ---- */
  'core.respond': { run: args => {
    const p = args.params();
    const status = Math.min(599, Math.max(100, Number(p.status) || 200));
    const body = p.with === 'text' ? String(p.body ?? '') : p.with === 'items' ? args.items.map(x => x.json) : p.with === 'first' ? args.items[0]?.json ?? {} : obj(p.body, 'The body');
    args.ctx.respond?.({ status, type: p.with === 'text' ? (p.contentType || 'text/plain') : 'json', body, headers: pairs(p.headers) });
    return { main: args.items };
  } },

  /* ---- data ---- */
  'core.pivot': { run: args => {
    const p = args.params(), rowKey = need(p.rows, 'the field for rows'), colKey = need(p.columns, 'the field for columns');
    const table = new Map(), cols = new Set();
    for (const it of args.items) {
      const r = String(getPath(it.json, rowKey) ?? ''), col = String(getPath(it.json, colKey) ?? '');
      cols.add(col);
      if (!table.has(r)) table.set(r, new Map());
      const cell = table.get(r);
      const v = p.value ? Number(getPath(it.json, p.value)) || 0 : 1;
      cell.set(col, (cell.get(col) || 0) + v);
    }
    const all = [...cols];
    return { main: [...table].map(([r, cell]) => ({ json: { [rowKey]: r, ...Object.fromEntries(all.map(c => [c, cell.get(c) || 0])), ...(p.total !== false ? { total: all.reduce((s, c) => s + (cell.get(c) || 0), 0) } : {}) } })) };
  } },
  // Long text → pieces of about `size` characters, broken at paragraphs, sentences or words, overlapping a little.
  'core.textsplit': { run: args => {
    const out = [];
    args.items.forEach((item, i) => {
      const p = args.params(item, i), text = String(p.text ?? ''), size = Math.max(50, Number(p.size) || 1000), overlap = Math.max(0, Math.min(size / 2, Number(p.overlap) || 0));
      const pieces = p.by === 'paragraph' ? text.split(/\n\s*\n/) : p.by === 'sentence' ? text.match(/[^.!?\n]+[.!?]*\s*|\n+/g) || [] : text.split(/(\s+)/);
      const chunks = [];
      let cur = '';
      for (const piece of pieces) {
        if (cur && (cur + piece).length > size) { chunks.push(cur.trim()); cur = overlap ? cur.slice(-overlap) : ''; }
        if (piece.length > size) { for (let k = 0; k < piece.length; k += size - overlap) chunks.push(piece.slice(k, k + size).trim()); cur = ''; continue; }
        cur += p.by === 'paragraph' && cur ? '\n\n' + piece : piece;
      }
      if (cur.trim()) chunks.push(cur.trim());
      chunks.filter(Boolean).forEach((chunk, n) => out.push({ json: { ...(p.keep === true || p.keep === 'true' ? item.json : {}), [p.output || 'chunk']: chunk, chunkIndex: n, chunkCount: chunks.length } }));
    });
    return { main: out };
  } },
  // A small store of values per account that lasts between runs: counters, the last id seen, settings.
  'core.kv': { run: args => {
    const kv = args.ctx.kv;
    if (!kv) throw new FlowError('The key-value store needs the server.', 'no_server');
    return each(args, (p, item) => {
      const key = p.operation === 'list' ? '' : String(need(p.key, 'the key'));
      const out = p.output || 'value';
      if (p.operation === 'set') { kv.set(key, p.value ?? null); return put(item, out, p.value ?? null); }
      if (p.operation === 'delete') { kv.del(key); return put(item, out, null); }
      if (p.operation === 'increment') { const v = (Number(kv.get(key)) || 0) + (p.by === '' || p.by == null ? 1 : Number(p.by) || 0); kv.set(key, v); return put(item, out, v); }
      if (p.operation === 'list') return put(item, out, kv.list(String(p.prefix || '')));
      const v = kv.get(key);
      return put(item, out, v === undefined ? (p.default ?? null) : v);
    });
  } },

  /* ---- the web ---- */
  'core.graphql': { run: async args => {
    const c = args.node.credential ? await cred(args) : null;
    return each(args, async p => {
      const headers = { 'content-type': 'application/json', accept: 'application/json', ...pairs(p.headers) };
      if (c?.token) headers.authorization = `Bearer ${c.token}`;
      if (c?.headerName) headers[c.headerName] = c.headerValue || '';
      const r = await request(String(need(p.url, 'the GraphQL endpoint')), { method: 'POST', headers, body: JSON.stringify({ query: need(p.query, 'the query'), variables: obj(p.variables, 'The variables') }) }, { allowPrivate: args.ctx.allowPrivate });
      const body = failIfBad(r, new URL(p.url).host);
      if (body && Array.isArray(body.errors) && body.errors.length && p.failOnError !== false) throw new FlowError(`GraphQL: ${body.errors.map(e => e.message).join('; ')}`, 'graphql');
      const data = body?.data ?? body;
      const at = p.path ? getPath(data, p.path) : data;
      return at ?? {};
    });
  } },
  // An .xlsx or .csv file at a URL → one item per row (the first row names the fields).
  'file.spreadsheet': { run: args => each(args, async p => {
    const url = String(need(p.url, 'the file URL'));
    let u;
    try { u = new URL(url); } catch (e) { throw new FlowError(`“${url}” isn't a web address.`, 'bad_url'); }
    if (!/^https?:$/.test(u.protocol)) throw new FlowError('Only http:// and https:// files can be read.', 'bad_url');
    await checkHost(u.hostname, args.ctx.allowPrivate).catch(e => { throw new FlowError(e.message, 'private_host'); });
    const res = await fetch(u, { redirect: 'follow', signal: AbortSignal.timeout(60_000) }).catch(e => { throw new FlowError(`Couldn't reach ${u.host}: ${e.cause?.code || e.message}`, 'network'); });
    if (!res.ok) throw new FlowError(`${u.host} answered ${res.status}.`, 'service');
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > 20e6) throw new FlowError('The file is over 20 MB.', 'too_large');
    const headerRow = Math.max(1, Number(p.headerRow) || 1), limit = Math.min(5000, Number(p.limit) || 1000);
    let rows;
    if (p.format === 'csv' || (!p.format && /\.csv(\?|$)/i.test(u.pathname)) || /text\/csv/.test(res.headers.get('content-type') || '')) {
      rows = csvRows(buf.toString('utf8'), p.separator || ',');
    } else {
      const { default: ExcelJS } = await import('exceljs');
      const wb = new ExcelJS.Workbook();
      try { await wb.xlsx.load(buf); } catch (e) { throw new FlowError('That isn’t an .xlsx file. For CSV, choose CSV.', 'bad_file'); }
      const ws = p.sheet ? wb.getWorksheet(String(p.sheet)) : wb.worksheets[0];
      if (!ws) throw new FlowError(`There’s no sheet called “${p.sheet}”.`, 'bad_param');
      rows = [];
      ws.eachRow({ includeEmpty: true }, (row, n) => { rows[n - 1] = row.values.slice(1).map(cellValue); });
      rows = Array.from(rows, r => r || []);
    }
    const head = (rows[headerRow - 1] || []).map((h, i) => String(h ?? '').trim() || `column${i + 1}`);
    return rows.slice(headerRow, headerRow + limit).filter(r => r.some(v => v !== null && v !== '')).map(r => Object.fromEntries(head.map((h, i) => [h, r[i] ?? null])));
  }) },

  /* ---- Redis ---- */
  'app.redis': { run: async args => {
    const c = await cred(args);
    let u;
    try { u = new URL(String(need(c.url, 'the Redis URL'))); } catch (e) { throw new FlowError('The Redis URL looks like redis://user:password@host:6379 (rediss:// for TLS).', 'credential'); }
    if (!/^rediss?:$/.test(u.protocol)) throw new FlowError('The Redis URL starts with redis:// or rediss://.', 'credential');
    await checkHost(u.hostname, args.ctx.allowPrivate).catch(e => { throw new FlowError(e.message, 'private_host'); });
    const { createClient } = await import('redis');
    const client = createClient({ url: u.toString(), socket: { connectTimeout: 10_000, reconnectStrategy: false } });
    client.on('error', () => {});
    await client.connect().catch(e => { throw new FlowError(`Couldn't reach Redis at ${u.host}: ${e.message}`, 'network'); });
    try {
      return await each(args, async (p, item) => {
        const key = String(need(p.key, 'the key')), out = p.output || 'value';
        const val = v => (typeof v === 'string' ? v : JSON.stringify(v ?? null));
        const back = v => { if (v == null) return null; try { return JSON.parse(v); } catch (e) { return v; } };
        switch (p.operation || 'get') {
          case 'set': { const ttl = Number(p.ttl) || 0; await client.set(key, val(p.value), ttl > 0 ? { EX: ttl } : undefined); return put(item, out, p.value ?? null); }
          case 'delete': return put(item, out, await client.del(key));
          case 'increment': return put(item, out, await client.incrBy(key, p.by === '' || p.by == null ? 1 : Number(p.by) || 0));
          case 'push': return put(item, out, await client.rPush(key, val(p.value)));
          case 'range': return put(item, out, (await client.lRange(key, Number(p.start) || 0, p.stop === '' || p.stop == null ? -1 : Number(p.stop))).map(back));
          case 'keys': return put(item, out, await scan(client, key));
          default: return put(item, out, back(await client.get(key)));
        }
      });
    } finally { await client.quit().catch(() => {}); }
  } },

  /* ---- a note on the canvas: does nothing ---- */
  'core.note': { run: ({ items: list }) => ({ main: list }) },

  /* ---- triggers ---- */
  // Started by flows.js when another workflow of the account fails.
  'trigger.error': { run: ({ items: list }) => ({ main: list }) },
  // New rows in a database table: rows whose (increasing) column is past the last one seen.
  'trigger.dbrow': { run: ({ items: list }) => ({ main: list }), async poll({ params: p, node, state, ctx }) {
    if (!node.credential) throw new FlowError('Pick a database credential.', 'no_credential');
    const conn = await ctx.cred(node.credential);
    const parts = String(need(p.table, 'the table')).split('.');
    const table = { schema: parts.length > 1 ? parts[0] : undefined, name: parts[parts.length - 1] };
    const col = String(p.column || 'id');
    const rows = async (filters, desc, limit) => {
      const r = await dbHandle({ op: 'rows', conn, table, filters, sort: { col, desc }, limit, estimate: 1e9 }, { allowPrivate: ctx.allowPrivate, timeout: 30_000 }).catch(e => { throw new FlowError(e.message, 'database'); });
      return r.rows.map(row => Object.fromEntries(r.columns.map((k, i) => [k, row[i]])));
    };
    if (state.last === undefined) { const [top] = await rows([], true, 1); return { items: [], state: { last: top ? top[col] : null } }; }
    const fresh = await rows(state.last == null ? [] : [{ col, op: '>', value: state.last }], false, 100);
    return { items: fresh, state: { last: fresh.length ? fresh[fresh.length - 1][col] : state.last } };
  } },
  // New email in a mailbox (IMAP): messages that arrived since the last look.
  'trigger.email': { run: ({ items: list }) => ({ main: list }), async poll({ params: p, node, state, ctx }) {
    if (!node.credential) throw new FlowError('Pick an email (IMAP) credential.', 'no_credential');
    const c = await ctx.cred(node.credential);
    await checkHost(String(need(c.host, 'the IMAP server')), ctx.allowPrivate).catch(e => { throw new FlowError(e.message, 'private_host'); });
    const { ImapFlow } = await import('imapflow');
    const client = new ImapFlow({ host: c.host, port: Number(c.port) || 993, secure: c.secure !== false && c.secure !== 'false', auth: { user: need(c.user, 'the user'), pass: need(c.password, 'the password') }, logger: false, socketTimeout: 30_000 });
    await client.connect().catch(e => { throw new FlowError(`Couldn't sign in to ${c.host}: ${e.responseText || e.message}`, 'network'); });
    const box = String(p.mailbox || 'INBOX');
    try {
      const lock = await client.getMailboxLock(box).catch(() => { throw new FlowError(`There’s no mailbox “${box}”.`, 'bad_param'); });
      try {
        const next = client.mailbox.uidNext;
        if (!state.uid || state.validity !== String(client.mailbox.uidValidity)) return { items: [], state: { uid: next - 1, validity: String(client.mailbox.uidValidity) } };
        if (next - 1 <= state.uid) return { items: [], state };
        const { simpleParser } = await import('mailparser');
        const items = [];
        for await (const msg of client.fetch(`${state.uid + 1}:*`, { uid: true, source: true, envelope: true }, { uid: true })) {
          if (msg.uid <= state.uid || items.length >= 50) continue;
          const mail = await simpleParser(msg.source);
          if (p.unreadOnly === true && msg.flags?.has('\\Seen')) continue;
          items.push({ uid: msg.uid, messageId: mail.messageId || null, from: mail.from?.text || null, fromAddress: mail.from?.value?.[0]?.address || null, to: mail.to?.text || null, subject: mail.subject || '', date: mail.date ? mail.date.toISOString() : null,
            text: (mail.text || '').slice(0, 50_000), html: p.html ? (mail.html || '').slice(0, 200_000) : undefined, attachments: (mail.attachments || []).map(a => ({ filename: a.filename, contentType: a.contentType, size: a.size })) });
        }
        if (p.markRead && items.length) await client.messageFlagsAdd(items.map(m => m.uid), ['\\Seen'], { uid: true }).catch(() => {});
        return { items, state: { uid: Math.max(state.uid, ...items.map(m => m.uid), next - 1), validity: state.validity } };
      } finally { lock.release(); }
    } finally { await client.logout().catch(() => {}); }
  } },
  // New events in a Google calendar (shared with the service account).
  'trigger.calendar': { run: ({ items: list }) => ({ main: list }), async poll({ params: p, node, state, ctx }) {
    if (!node.credential) throw new FlowError('Pick a Google credential.', 'no_credential');
    const args = { ctx, node };
    const c = await ctx.cred(node.credential), token = await googleToken(args, c, 'https://www.googleapis.com/auth/calendar.readonly');
    const now = new Date().toISOString();
    if (!state.since) return { items: [], state: { since: now, seen: [] } };
    const r = await api(args, `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(need(p.calendarId, 'the calendar id'))}/events?updatedMin=${encodeURIComponent(state.since)}&singleEvents=true&showDeleted=false&maxResults=100`, { bearer: token });
    const events = failIfBad(r, 'Google Calendar').items || [];
    const seen = new Set(state.seen || []);
    const fresh = events.filter(e => !seen.has(e.id) && (p.changes === true || new Date(e.created) >= new Date(state.since)));
    const items = fresh.map(e => ({ id: e.id, title: e.summary || '', description: e.description || '', start: e.start?.dateTime || e.start?.date || null, end: e.end?.dateTime || e.end?.date || null, location: e.location || null, link: e.htmlLink, organizer: e.organizer?.email || null, attendees: (e.attendees || []).map(a => a.email), created: e.created, updated: e.updated }));
    return { items, state: { since: now, seen: [...fresh.map(e => e.id), ...seen].slice(0, 500) } };
  } },
};

async function scan(client, pattern) {
  const keys = [];
  for await (const k of client.scanIterator({ MATCH: pattern, COUNT: 100 })) { keys.push(...(Array.isArray(k) ? k : [k])); if (keys.length >= 1000) break; }
  return keys;
}
function cellValue(v) {
  if (v == null) return null;
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'object') return v.result ?? v.text ?? (v.richText ? v.richText.map(t => t.text).join('') : v.hyperlink ? v.text || v.hyperlink : null);
  return v;
}
function csvRows(text, sep) {
  const rows = [];
  let row = [], cur = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) { if (ch === '"' && text[i + 1] === '"') { cur += '"'; i++; } else if (ch === '"') q = false; else cur += ch; }
    else if (ch === '"') q = true;
    else if (ch === sep) { row.push(cur); cur = ''; }
    else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i++; row.push(cur); rows.push(row); row = []; cur = ''; }
    else cur += ch;
  }
  if (cur || row.length) { row.push(cur); rows.push(row); }
  return rows;
}
