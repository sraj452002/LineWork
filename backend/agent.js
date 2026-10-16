import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';

/* The AI assistant (POST /api/ai/chat): a conversation with a model that can use the account's own
   WorkLine tools: list and run its workflows, find and run any of the 650 nodes (with its saved
   credentials), list and read its files, and write a new doc. The model asks for a tool, the server runs
   it and gives back the result, and so on until the model answers (at most MAX_TURNS rounds).

   It works with Claude (Anthropic's Messages API) and NVIDIA's models (an OpenAI-style API). Either
   way the answer streams to the app as server-sent events, one JSON object each:
     {type:'text', delta}  {type:'thinking', delta}  {type:'tool', id, name, input}
     {type:'tool_done', id, ok, result}  {type:'done'}  {type:'error', message} */

const CATALOG = JSON.parse(readFileSync(new URL('./node-catalog.json', import.meta.url), 'utf8'));
const MAX_TURNS = 8;
const cut = (v, n = 12_000) => { const s = typeof v === 'string' ? v : JSON.stringify(v); return s.length > n ? `${s.slice(0, n)}… (cut: ${s.length} characters in all)` : s; };
const fileKind = f => (f.view === 'flow' || (f.flow && f.flow.nodes && f.flow.nodes.length > 1) ? 'workflow' : f.view || 'diagram');

export const TOOLS = [
  { name: 'list_workflows', description: 'Lists the workflows on the user’s WorkLine account: id, title, whether it is active, whether it is published as an app (and the app’s inputs), and its nodes.',
    input_schema: { type: 'object', properties: { query: { type: 'string', description: 'Optional words to look for in the title.' } } } },
  { name: 'run_workflow', description: 'Runs one of the user’s workflows now (from its Run by hand trigger, else its first trigger) and returns what its last steps output. Give input for workflows that read {{ $json.<field> }}, such as a published app’s inputs. Before running one that sends messages or emails, or changes data in another app, ask the user.',
    input_schema: { type: 'object', properties: { workflow_id: { type: 'string' }, input: { type: 'object', description: 'Fields for the trigger, e.g. {"name": "Asha"}.' } }, required: ['workflow_id'] } },
  { name: 'find_nodes', description: 'Searches WorkLine’s 650 workflow nodes: text, numbers, dates, lists, objects, encoding and hashes, checks, unit conversions, generators, flow (IF, filter, sort…), AI, web pages, apps (Slack, Gmail, GitHub, Google Sheets, Notion, Stripe, Telegram…) and public data (holidays, PIN codes, Wikipedia…). Returns each node’s type, what it does, an example, its settings and whether it needs a saved credential.',
    input_schema: { type: 'object', properties: { query: { type: 'string', description: 'What the node should do, or an app’s name.' } }, required: ['query'] } },
  { name: 'run_node', description: 'Runs one node on the server, on the given items, with the given settings, and returns its output items. Find the node’s type and setting keys with find_nodes first. Settings can read the items with expressions like {{ $json.text }}. App nodes need a credential: give credential_id (from list_credentials); if the user has exactly one of the right kind it is used by itself. Before running a node that sends or changes something in another app, ask the user.',
    input_schema: { type: 'object', properties: { type: { type: 'string' }, settings: { type: 'object', description: 'Setting keys and values; the rest keep their defaults.' }, items: { type: 'array', items: { type: 'object' }, description: 'The items it gets, e.g. [{"text": "hello"}]. Default: one empty item.' }, credential_id: { type: 'string' } }, required: ['type'] } },
  { name: 'list_credentials', description: 'Lists the credentials (connected app accounts) saved on the user’s account: id, kind and name. Never their secrets.',
    input_schema: { type: 'object', properties: {} } },
  { name: 'list_files', description: 'Lists the user’s WorkLine files (docs, diagrams, sheets, databases, workflows, apps): id, title, kind and when it last changed, newest first.',
    input_schema: { type: 'object', properties: { query: { type: 'string', description: 'Optional words to look for in the title.' } } } },
  { name: 'read_file', description: 'Reads one of the user’s files: its doc text, its diagrams, its sheet, or its workflow’s nodes and settings (cut to about 20,000 characters).',
    input_schema: { type: 'object', properties: { file_id: { type: 'string' } }, required: ['file_id'] } },
  { name: 'create_doc', description: 'Writes a new doc (Markdown) on the user’s WorkLine account and returns its id. Use it when the user asks to save, draft or write something down as a document.',
    input_schema: { type: 'object', properties: { title: { type: 'string' }, markdown: { type: 'string' } }, required: ['title', 'markdown'] } },
];

const SYSTEM = (user, today) => `You are Nemo, the AI built into WorkLine (docs, diagrams, sheets, databases, workflows and apps in one place). If asked your name, you are Nemo. You talk with ${user.name || 'the user'} in a chat, like Claude: warm, direct and clear. Answer in the language the user writes in (Hindi or Hinglish too). Use Markdown: short paragraphs, lists, tables and fenced code blocks with a language when they help; no headings for short answers.

You can act on the user's WorkLine account with tools: list and run their workflows, find and run any of the 650 workflow nodes (text, numbers, dates, AI, apps such as Slack, Gmail, GitHub, Sheets, Stripe, with their saved credentials), list and read their files, and write a new doc. Use a tool when it gives a better answer than guessing (for example, run the Uppercase or Date nodes instead of doing it in your head when exactness matters, or read a file before talking about it). Say briefly what you did and what came back. Before anything that sends a message or email, posts, pays, deletes or changes data in another app, ask the user to confirm first, unless they already clearly asked for exactly that. Never invent ids: look them up. If a tool fails, explain why in plain words and what the user can do.

Today is ${today}.`;

export function createAgent({ store, flows, providers, defaultProvider, dailyLimit, aiKey, aiBase, nvidiaKey, nvidiaBase }) {
  /* ---- the tools ---- */
  const asItems = list => (Array.isArray(list) && list.length ? list : [{}]).slice(0, 200).map(j => ({ json: j && typeof j === 'object' && !Array.isArray(j) ? j : { value: j } }));
  const outOf = got => (got.pending ? { status: 'still running', runId: got.runId, note: 'It takes longer than a minute; its result will be in the workflow’s run history.' }
    : { status: 'success', count: got.items.length, items: got.items.slice(0, 25).map(i => (i && typeof i === 'object' && 'json' in i ? i.json : i)) });
  const flowSummary = flow => (flow.nodes || []).map(n => ({ name: n.name, type: n.type, ...(Object.keys(n.params || {}).length ? { settings: n.params } : {}) }));
  const run = {
    async list_workflows(uid, { query } = {}) {
      const q = String(query || '').toLowerCase();
      const files = (await store.listFiles(uid)).filter(f => f.flow && (f.flow.nodes || []).length && !f.archived && (!q || String(f.title).toLowerCase().includes(q)));
      return files.slice(0, 60).map(f => ({
        id: f.id, title: f.title, active: !!f.flow.active,
        ...(f.flow.app && f.flow.app.published ? { app: { name: f.flow.app.name, description: f.flow.app.description || '', inputs: (f.flow.app.inputs || []).map(i => ({ key: i.key, label: i.label, kind: i.kind, required: !!i.required })) } } : {}),
        nodes: (f.flow.nodes || []).map(n => `${n.name} (${n.type})`),
      }));
    },
    async run_workflow(uid, { workflow_id, input } = {}) {
      const flow = await flows.agent.savedFlow(uid, String(workflow_id || ''));
      if (!flow) throw new Error('There is no workflow with that id. Use list_workflows.');
      return outOf(await flows.agent.runForItems(uid, String(workflow_id), flow, asItems([input || {}]), 'ai'));
    },
    async find_nodes(uid, { query } = {}) {
      const words = String(query || '').toLowerCase().split(/\W+/).filter(w => w.length > 1);
      const score = ([type, c]) => {
        const hay = `${type} ${c.label} ${c.group} ${c.note}`.toLowerCase();
        return words.reduce((s, w) => s + (c.label.toLowerCase().includes(w) ? 3 : 0) + (type.toLowerCase().includes(w) ? 2 : 0) + (hay.includes(w) ? 1 : 0), 0);
      };
      return Object.entries(CATALOG).map(e => [e, score(e)]).filter(([, s]) => s > 0).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([[type, c]]) => ({
        type, label: c.label, group: c.group, does: c.note, ...(c.ex ? { example: c.ex } : {}), ...(c.trigger ? { trigger: true } : {}),
        ...(c.credential ? { needs_credential: c.credential, ...(c.optionalCredential ? { credential_optional: true } : {}) } : {}),
        settings: c.fields.map(f => ({ key: f.key, label: f.label, kind: f.kind, ...(f.options ? { options: f.options } : {}), ...(f.hint ? { e_g: f.hint } : {}) })),
        defaults: c.defaults,
      }));
    },
    async run_node(uid, { type, settings, items, credential_id } = {}) {
      const c = CATALOG[type];
      if (!c) throw new Error(`There is no node “${type}”. Use find_nodes.`);
      if (c.trigger) throw new Error(`${c.label} is a trigger: it starts a workflow, so it can’t run on its own.`);
      let credential = credential_id ? String(credential_id) : undefined;
      if (c.credential && !credential) {
        const mine = flows.agent.creds(uid).filter(x => c.credential.includes(x.type));
        if (mine.length === 1) credential = mine[0].id;
        else if (!c.optionalCredential) throw new Error(mine.length ? `Pick a credential (credential_id): ${mine.map(x => `${x.name} = ${x.id}`).join(', ')}.` : `${c.label} needs a ${c.credential.join(' or ')} credential, and there is none on the account. The user can add one in a workflow: click the node, then New beside Credential.`);
      }
      const node = { id: 'node', type, name: c.label, x: 300, y: 160, params: { ...c.defaults, ...(settings && typeof settings === 'object' ? settings : {}) }, ...(credential ? { credential } : {}) };
      const flow = { active: false, nodes: [{ id: 'start', type: 'trigger.manual', name: 'Run by hand', x: 60, y: 160, params: {} }, node], edges: [{ id: 'e', from: 'start', fromPort: 'main', to: 'node', toPort: 'main' }] };
      return outOf(await flows.agent.runForItems(uid, 'ai-assistant', flow, asItems(items), 'ai'));
    },
    async list_credentials(uid) { return flows.agent.creds(uid).map(({ id, type, name }) => ({ id, type, name })); },
    async list_files(uid, { query } = {}) {
      const q = String(query || '').toLowerCase();
      return (await store.listFiles(uid)).filter(f => !f.archived && (!q || String(f.title).toLowerCase().includes(q))).slice(0, 80)
        .map(f => ({ id: f.id, title: f.title, kind: fileKind(f), updated: new Date(Number(f.updated) || 0).toISOString() }));
    },
    async read_file(uid, { file_id } = {}) {
      const text = await store.readFile(uid, String(file_id || ''));
      if (!text) throw new Error('There is no file with that id. Use list_files.');
      const f = JSON.parse(text);
      const { images, flow, diagrams, ...rest } = f;
      return cut({ ...rest, kind: fileKind(f), diagrams: (diagrams || []).filter(d => d.code).map(d => ({ name: d.name, type: d.type, code: d.code })), ...(flow && flow.nodes && flow.nodes.length ? { workflow: flowSummary(flow) } : {}) }, 20_000);
    },
    async create_doc(uid, { title, markdown } = {}) {
      const id = `f_${randomBytes(6).toString('hex')}`, updated = Date.now();
      const file = { id, title: String(title || 'Untitled').slice(0, 120), diagrams: [{ id: 'd1', type: 'architecture', name: 'Diagram 1', code: '', manual: {}, dir: 'LR', style: 'color' }], active: 0, doc: String(markdown || ''), updated, view: 'doc' };
      await store.saveFile(uid, id, JSON.stringify(file), updated);
      return { id, title: file.title, note: 'Saved on the user’s account; it shows on the home page.' };
    },
  };
  const useTool = async (uid, name, input) => {
    if (!run[name]) return { ok: false, result: `There is no tool “${name}”.` };
    try { return { ok: true, result: await run[name](uid, input || {}) }; }
    catch (e) { return { ok: false, result: e.message || 'It failed.' }; }
  };

  /* ---- the models ---- */
  // One round with an OpenAI-style API (NVIDIA): streams text and thinking, gathers the tool calls.
  async function roundOpenAI(model, messages, send, signal) {
    const up = await fetch(`${nvidiaBase.replace(/\/+$/, '')}/chat/completions`, {
      method: 'POST', signal,
      headers: { authorization: `Bearer ${nvidiaKey}`, 'content-type': 'application/json', accept: 'text/event-stream' },
      body: JSON.stringify({ model, messages, stream: true, temperature: 0.5, top_p: 1, max_tokens: 8192, tools: TOOLS.map(t => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.input_schema } })), tool_choice: 'auto' }),
    });
    if (!up.ok || !up.body) throw Object.assign(new Error(`The AI service answered ${up.status}.`), { status: up.status, detail: await up.text().catch(() => '') });
    let text = '';
    const calls = [];
    await readSSE(up.body, data => {
      if (data === '[DONE]') return;
      let chunk; try { chunk = JSON.parse(data); } catch (e) { return; }
      if (chunk.error) throw new Error(String(chunk.error.message || chunk.error));
      const delta = chunk.choices?.[0]?.delta || {};
      if (delta.reasoning_content) send({ type: 'thinking', delta: delta.reasoning_content });
      if (delta.content) { text += delta.content; send({ type: 'text', delta: delta.content }); }
      for (const tc of delta.tool_calls || []) {
        const c = (calls[tc.index ?? calls.length] ||= { id: '', name: '', args: '' });
        if (tc.id) c.id = tc.id;
        if (tc.function?.name) c.name += tc.function.name;
        if (tc.function?.arguments) c.args += tc.function.arguments;
      }
    });
    return { text, calls: calls.filter(Boolean).map((c, i) => ({ id: c.id || `call_${i}`, name: c.name, input: parseArgs(c.args) })) };
  }
  // One round with Anthropic's Messages API.
  async function roundClaude(model, system, messages, send, signal) {
    const up = await fetch(`${aiBase}/v1/messages`, {
      method: 'POST', signal,
      headers: { 'x-api-key': aiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model, max_tokens: 8000, stream: true, system, messages, tools: TOOLS }),
    });
    if (!up.ok || !up.body) throw Object.assign(new Error(`The AI service answered ${up.status}.`), { status: up.status, detail: await up.text().catch(() => '') });
    const blocks = [];
    await readSSE(up.body, data => {
      let ev; try { ev = JSON.parse(data); } catch (e) { return; }
      if (ev.type === 'content_block_start') blocks[ev.index] = ev.content_block.type === 'tool_use' ? { type: 'tool_use', id: ev.content_block.id, name: ev.content_block.name, json: '' } : { type: ev.content_block.type, text: '' };
      else if (ev.type === 'content_block_delta') {
        const b = blocks[ev.index];
        if (ev.delta.type === 'text_delta') { b.text += ev.delta.text; send({ type: 'text', delta: ev.delta.text }); }
        else if (ev.delta.type === 'thinking_delta') send({ type: 'thinking', delta: ev.delta.thinking });
        else if (ev.delta.type === 'input_json_delta') b.json += ev.delta.partial_json;
      } else if (ev.type === 'error') throw new Error(ev.error?.message || 'The AI service failed.');
    });
    const content = blocks.filter(b => b && (b.type === 'text' ? b.text : b.type === 'tool_use')).map(b => (b.type === 'tool_use' ? { type: 'tool_use', id: b.id, name: b.name, input: parseArgs(b.json) } : { type: 'text', text: b.text }));
    return { content, calls: content.filter(b => b.type === 'tool_use') };
  }

  /* ---- the route ---- */
  return async function chat(req, res) {
    const b = req.body || {};
    const provider = providers.find(p => p.id === b.provider) || defaultProvider;
    const history = (Array.isArray(b.messages) ? b.messages : []).filter(m => m && (m.role === 'user' || m.role === 'assistant') && typeof m.text === 'string' && m.text.trim()).slice(-30);
    if (!history.length || history[history.length - 1].role !== 'user') return res.status(400).json({ error: 'bad_request' });
    if (JSON.stringify(history).length > 400_000) return res.status(413).json({ error: 'too_large' });
    const images = (Array.isArray(b.images) ? b.images : []).slice(0, 4).filter(im => ['image/png', 'image/jpeg', 'image/gif', 'image/webp'].includes(im?.media_type) && typeof im.data === 'string' && im.data.length < 6_000_000);
    const pick = images.length && !provider.images ? providers.find(p => p.images) || provider : provider;
    if (images.length && !pick.images) return res.status(400).json({ error: 'bad_image', message: `${provider.label} doesn't read pictures.` });
    if (!store.useAi(req.user.id, dailyLimit)) return res.status(429).json({ error: 'daily_limit' });

    const ctl = new AbortController();
    res.on('close', () => ctl.abort());
    res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
    res.flushHeaders?.();
    const send = ev => { if (!res.writableEnded) res.write(`data: ${JSON.stringify(ev)}\n\n`); };
    const uid = req.user.id, today = new Date().toISOString().slice(0, 10);
    const system = SYSTEM(req.user, today);
    try {
      if (pick.nvidia) {
        const messages = [{ role: 'system', content: system }, ...history.map(m => ({ role: m.role, content: m.text }))];
        for (let turn = 0; turn < MAX_TURNS; turn++) {
          const r = await roundOpenAI(pick.model, messages, send, ctl.signal);
          if (!r.calls.length) break;
          messages.push({ role: 'assistant', content: r.text || null, tool_calls: r.calls.map(c => ({ id: c.id, type: 'function', function: { name: c.name, arguments: JSON.stringify(c.input) } })) });
          for (const c of r.calls) {
            send({ type: 'tool', id: c.id, name: c.name, input: c.input });
            const got = await useTool(uid, c.name, c.input);
            send({ type: 'tool_done', id: c.id, ok: got.ok, result: cut(got.result, 4000) });
            messages.push({ role: 'tool', tool_call_id: c.id, content: cut(got.ok ? got.result : `Error: ${got.result}`) });
          }
          if (turn === MAX_TURNS - 1) send({ type: 'text', delta: '\n\n(I stopped after many steps. Ask me to go on if you want more.)' });
        }
      } else {
        const last = history.length - 1;
        const messages = history.map((m, i) => ({ role: m.role, content: i === last && images.length ? [...images.map(im => ({ type: 'image', source: { type: 'base64', media_type: im.media_type, data: im.data } })), { type: 'text', text: m.text }] : m.text }));
        for (let turn = 0; turn < MAX_TURNS; turn++) {
          const r = await roundClaude(pick.model, system, messages, send, ctl.signal);
          if (!r.calls.length) break;
          messages.push({ role: 'assistant', content: r.content });
          const results = [];
          for (const c of r.calls) {
            send({ type: 'tool', id: c.id, name: c.name, input: c.input });
            const got = await useTool(uid, c.name, c.input);
            send({ type: 'tool_done', id: c.id, ok: got.ok, result: cut(got.result, 4000) });
            results.push({ type: 'tool_result', tool_use_id: c.id, content: cut(got.result), ...(got.ok ? {} : { is_error: true }) });
          }
          messages.push({ role: 'user', content: results });
        }
      }
      send({ type: 'done' });
    } catch (e) {
      if (!ctl.signal.aborted) {
        if (e.detail) console.log('AI chat error', e.status, e.detail.slice(0, 500));
        send({ type: 'error', message: e.status === 429 ? 'The AI is busy right now. Try again in a moment.' : 'The AI didn’t answer. Try again.' });
      }
    }
    res.end();
  };
}

function parseArgs(s) { if (!s) return {}; try { const v = JSON.parse(s); return v && typeof v === 'object' ? v : {}; } catch (e) { return {}; } }

// Reads a server-sent event stream, calling onData with each `data:` line's text.
async function readSSE(body, onData) {
  const reader = body.getReader(), dec = new TextDecoder();
  let buf = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
      if (line.startsWith('data:')) onData(line.slice(5).trim());
    }
  }
}
