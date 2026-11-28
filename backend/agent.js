import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { nvidiaContent, nvidiaParams } from './nvidia.js';

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

// Memory, the team and building: what makes it agentic. Remember things across chats and missions; hand a
// task to another of the user's agents; make a workflow out of steps.
TOOLS.push(
  { name: 'remember', description: 'Saves something worth keeping for later chats and missions: a fact about the user, a preference, a decision, where something is. One short sentence each. Don’t save secrets or passwords.',
    input_schema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] } },
  { name: 'recall', description: 'Looks through what was remembered before (all of it, or what matches the words given).',
    input_schema: { type: 'object', properties: { query: { type: 'string' } } } },
  { name: 'forget', description: 'Removes one remembered thing (by its id from recall), when it is wrong or the user asks.',
    input_schema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] } },
  { name: 'list_agents', description: 'Lists the user’s AI agents: id, name, what each does and what it may use. Use it to find who on the team should do a part of a job.',
    input_schema: { type: 'object', properties: {} } },
  { name: 'ask_agent', description: 'Hands a task to another of the user’s agents and returns its answer. Say exactly what you need back. Use it when an agent is made for that kind of work (its own instructions and knowledge).',
    input_schema: { type: 'object', properties: { agent_id: { type: 'string' }, task: { type: 'string' } }, required: ['agent_id', 'task'] } },
  { name: 'create_workflow', description: 'Makes a new workflow file on the user’s account from steps in order (each a node type from find_nodes with its settings; later steps read earlier ones with {{ $json.field }}). It starts with Run by hand unless the first step is a trigger. Returns its id, to run with run_workflow. It is made inactive; say so.',
    input_schema: { type: 'object', properties: { title: { type: 'string' }, steps: { type: 'array', items: { type: 'object', properties: { type: { type: 'string' }, name: { type: 'string' }, settings: { type: 'object' }, credential_id: { type: 'string' } }, required: ['type'] } } }, required: ['title', 'steps'] } },
);

// What an agent may use, by group (an agent's `tools`), and the tool only Nemo has: making an agent.
export const TOOL_GROUPS = { workflows: ['list_workflows', 'run_workflow'], nodes: ['find_nodes', 'run_node', 'list_credentials'], files: ['list_files', 'read_file'], docs: ['create_doc'],
  memory: ['remember', 'recall', 'forget'], team: ['list_agents', 'ask_agent'], build: ['find_nodes', 'create_workflow'] };
const CREATE_AGENT = { name: 'create_agent', description: 'Makes a new AI agent on the user’s account: a named helper with its own instructions, which the user can chat with and use in workflows (the AI Agent node). Use it when the user asks for an agent, assistant or bot for a job. Write clear instructions in the second person (“You are… You…”).',
  input_schema: { type: 'object', properties: { name: { type: 'string' }, icon: { type: 'string', description: 'One emoji.' }, description: { type: 'string', description: 'One line: what it does.' }, instructions: { type: 'string', description: 'How it behaves: its role, steps, tone, rules, the form of its answers.' }, tools: { type: 'array', items: { type: 'string', enum: Object.keys(TOOL_GROUPS) }, description: 'What it may use: workflows (list and run the user’s workflows), nodes (run any of the 650 nodes), files (read the user’s files), docs (write docs).' }, starters: { type: 'array', items: { type: 'string' }, description: 'Up to 4 example requests to show the user.' } }, required: ['name', 'instructions'] } };
const toolsFor = agent => TOOLS.filter(t => (agent.tools || []).some(g => (TOOL_GROUPS[g] || []).includes(t.name)));

// An agent the user made: its own name and instructions, and what it was given to know.
const AGENT_SYSTEM = (agent, user, today, inWorkflow, memory = '') => `You are ${agent.name || 'an AI agent'}, an AI agent made in WorkLine${agent.description ? `: ${agent.description}` : ''}. You work for ${user.name || 'the user'}.

Your instructions:
${agent.instructions || 'Be helpful, clear and brief.'}
${agent.knowledge ? `\nWhat you were given to know (rely on it, and say when something isn’t in it):\n<knowledge>\n${agent.knowledge}\n</knowledge>\n` : ''}
${toolsFor(agent).length ? 'You can use tools on the user’s WorkLine account; use them when they give a better answer than guessing, and say briefly what you did. Ask before sending, posting, paying, deleting or changing anything in another app.' : 'You have no tools: answer from your instructions and knowledge.'}
${memory}${inWorkflow ? 'You are running as a step inside a workflow, with nobody to answer questions: do the task with what you have, and reply with the result only (no greeting, no questions back).' : 'Answer in the language the user writes in. Use Markdown when it helps.'}
Today is ${today}.`;

const SYSTEM = (user, today, memory = '') => `You are Nemo, the AI built into WorkLine (docs, diagrams, sheets, databases, workflows and apps in one place). Your name is Nemo. When the user greets you (hi, hello, namaste, hey…) or starts with small talk, answer warmly and briefly in their language, starting like: “Hi, I am Nemo! How can I help you?”. If asked your name, you are Nemo. You talk with ${user.name || 'the user'} in a chat, like Claude: warm, direct and clear. Answer in the language the user writes in (Hindi or Hinglish too). Use Markdown: short paragraphs, lists, tables and fenced code blocks with a language when they help; no headings for short answers.

You can act on the user's WorkLine account with tools: list and run their workflows, find and run any of the 650 workflow nodes (text, numbers, dates, AI, apps such as Slack, Gmail, GitHub, Sheets, Stripe, with their saved credentials), list and read their files, write a new doc, and make new AI agents (create_agent) when the user wants a helper for a job. Use a tool when it gives a better answer than guessing (for example, run the Uppercase or Date nodes instead of doing it in your head when exactness matters, or read a file before talking about it). Say briefly what you did and what came back. Before anything that sends a message or email, posts, pays, deletes or changes data in another app, ask the user to confirm first, unless they already clearly asked for exactly that. Never invent ids: look them up. If a tool fails, explain why in plain words and what the user can do. Remember (remember) what is worth keeping for next time: the user's preferences, decisions, where things are; never secrets. For a bigger job you can hand parts to the user's agents (list_agents, ask_agent), make a workflow (create_workflow), or suggest a mission (a goal Nemo works through step by step in the background, under Missions).
${memory}
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
  /* memory: short notes kept on the account (flows.js), shared by Nemo and the agents, or one agent's own */
  const MEMORY_MAX = 300;
  const memOf = uid => flows.agent.memory(uid);
  run.remember = async (uid, { text } = {}, ctx = {}) => {
    const t = String(text || '').replace(/\s+/g, ' ').trim().slice(0, 400);
    if (!t) throw new Error('Say what to remember.');
    if (/\b(password|passcode|api[ _-]?key|secret|token)\b\s*[:=]/i.test(t)) throw new Error('That looks like a secret: secrets aren’t kept in memory.');
    const list = memOf(uid);
    const same = list.find(x => x.text.toLowerCase() === t.toLowerCase());
    if (same) { same.at = Date.now(); flows.agent.touch(); return { id: same.id, note: 'Already remembered.' }; }
    const item = { id: `m_${randomBytes(4).toString('hex')}`, text: t, at: Date.now(), ...(ctx.agent?.id ? { agent: ctx.agent.id } : {}), ...(ctx.mission ? { mission: ctx.mission } : {}) };
    list.unshift(item); list.splice(MEMORY_MAX);
    flows.agent.touch();
    return { id: item.id, note: 'Remembered.' };
  };
  run.recall = async (uid, { query } = {}, ctx = {}) => {
    const words = String(query || '').toLowerCase().split(/\W+/).filter(w => w.length > 2);
    const mine = memOf(uid).filter(x => !x.agent || x.agent === ctx.agent?.id);
    const hits = words.length ? mine.filter(x => words.some(w => x.text.toLowerCase().includes(w))) : mine;
    return hits.slice(0, 40).map(x => ({ id: x.id, text: x.text, when: new Date(x.at).toISOString().slice(0, 10) }));
  };
  run.forget = async (uid, { id } = {}) => {
    const list = memOf(uid), i = list.findIndex(x => x.id === String(id));
    if (i < 0) throw new Error('Nothing remembered with that id. Use recall.');
    list.splice(i, 1); flows.agent.touch();
    return { note: 'Forgotten.' };
  };
  // What's remembered, for the system prompt: the newest shared notes and this agent's own.
  const memoryNote = (uid, agent) => {
    const mine = memOf(uid).filter(x => !x.agent || x.agent === agent?.id).slice(0, 25);
    return mine.length ? `\nWhat you remember from before (use it; recall finds more; forget what is wrong):\n${mine.map(x => `- ${x.text}`).join('\n')}\n` : '';
  };
  /* the team: the user's other agents */
  run.list_agents = async uid => flows.agent.listAgents(uid).map(a => ({ id: a.id, name: a.name, icon: a.icon, does: a.description || '', may_use: a.tools || [] }));
  run.ask_agent = async (uid, { agent_id, task } = {}, ctx = {}) => {
    const depth = (ctx.depth || 0) + 1;
    if (depth > 2) throw new Error('Agents can hand work on only twice in a row: do this part yourself.');
    if (ctx.agent?.id && ctx.agent.id === String(agent_id)) throw new Error('That is you: do it yourself.');
    const got = await runTask({ uid, agentId: String(agent_id || ''), task: String(task || ''), depth, signal: ctx.signal });
    return { agent: got.agent, answer: got.text, used: got.steps.map(x => x.tool) };
  };
  /* building: a workflow made of steps */
  run.create_workflow = async (uid, { title, steps } = {}) => {
    const list = (Array.isArray(steps) ? steps : []).slice(0, 40);
    if (!list.length) throw new Error('Give the steps: node types (find_nodes) with their settings.');
    const nodes = [];
    const first = CATALOG[list[0]?.type];
    if (!first?.trigger) nodes.push({ id: 'n0', type: 'trigger.manual', name: 'Run by hand', x: 80, y: 160, params: {} });
    for (const [i, st] of list.entries()) {
      const c = CATALOG[st?.type];
      if (!c) throw new Error(`There is no node “${st?.type}”. Use find_nodes.`);
      if (c.trigger && (i > 0 || nodes.length)) throw new Error(`${c.label} is a trigger: only the first step can be one.`);
      nodes.push({ id: `n${nodes.length}`, type: st.type, name: String(st.name || c.label).slice(0, 60), x: 80 + nodes.length * 260, y: 160, params: { ...c.defaults, ...(st.settings && typeof st.settings === 'object' ? st.settings : {}) }, ...(st.credential_id ? { credential: String(st.credential_id) } : {}) });
    }
    const edges = nodes.slice(1).map((n, i) => ({ id: `e${i}`, from: nodes[i].id, fromPort: 'main', to: n.id, toPort: 'main' }));
    const id = `f_${randomBytes(6).toString('hex')}`, now = Date.now();
    const file = { id, title: String(title || 'Workflow').slice(0, 120), created: now, updated: now, doc: '', diagrams: [{ id: 'd1', type: 'architecture', name: 'Diagram 1', code: '', manual: {}, dir: 'LR', style: 'color' }], active: 0, view: 'flow', flow: { active: false, nodes, edges } };
    await flows.agent.saveFile(uid, file);
    return { id, title: file.title, steps: nodes.map(n => `${n.name} (${n.type})`), note: 'Made (inactive). It shows on the home page; run it with run_workflow.' };
  };
  run.create_agent = async (uid, input = {}) => {
    const a = flows.agent.saveAgent(uid, input);
    return { id: a.id, name: a.name, note: 'Made. The user can chat with it from Agents in Nemo’s side bar, and use it in workflows with the AI Agent node.' };
  };
  const useTool = async (uid, name, input, allowed, agent, ctx = {}) => {
    if (!run[name] || !allowed.some(t => t.name === name)) return { ok: false, result: `There is no tool “${name}” here.` };
    if (name === 'run_workflow' && agent && (agent.workflows || []).length && !agent.workflows.includes(String(input?.workflow_id))) return { ok: false, result: 'This agent may only run the workflows it was given.' };
    if (name === 'list_workflows' && agent && (agent.workflows || []).length) { const all = await run.list_workflows(uid, input || {}); return { ok: true, result: all.filter(w => agent.workflows.includes(w.id)) }; }
    try { return { ok: true, result: await run[name](uid, input || {}, { ...ctx, agent }) }; }
    catch (e) { return { ok: false, result: e.message || 'It failed.' }; }
  };

  /* ---- the models ---- */
  // One round with an OpenAI-style API (NVIDIA): streams text and thinking, gathers the tool calls.
  // withTools false: a plain chat, for models (or endpoints) that refuse function calling.
  async function roundOpenAI(model, messages, send, signal, withTools = true, toolList = TOOLS) {
    withTools = withTools && toolList.length > 0;
    const up = await fetchRetry(`${nvidiaBase.replace(/\/+$/, '')}/chat/completions`, {
      method: 'POST', signal,
      headers: { authorization: `Bearer ${nvidiaKey}`, 'content-type': 'application/json', accept: 'text/event-stream' },
      body: JSON.stringify({ model, messages, stream: true, ...nvidiaParams(model), ...(withTools ? { tools: toolList.map(t => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.input_schema } })), tool_choice: 'auto' } : {}) }),
    });
    if (!up.ok || !up.body) throw Object.assign(new Error(`The AI service answered ${up.status}.`), { status: up.status, detail: await up.text().catch(() => ''), toolsRefused: withTools && [400, 404, 422, 500].includes(up.status) });
    let text = '';
    const calls = [];
    await readSSE(up.body, data => {
      if (data === '[DONE]') return;
      let chunk; try { chunk = JSON.parse(data); } catch (e) { return; }
      if (chunk.error) throw Object.assign(new Error(String(chunk.error.message || chunk.error)), { upstream: String(chunk.error.message || chunk.error).slice(0, 200) });
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
  async function roundClaude(model, system, messages, send, signal, toolList = TOOLS) {
    const up = await fetchRetry(`${aiBase}/v1/messages`, {
      method: 'POST', signal,
      headers: { 'x-api-key': aiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model, max_tokens: 8000, stream: true, system, messages, ...(toolList.length ? { tools: toolList } : {}) }),
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
      } else if (ev.type === 'error') throw Object.assign(new Error(ev.error?.message || 'The AI service failed.'), { upstream: String(ev.error?.message || '').slice(0, 200) });
    });
    const content = blocks.filter(b => b && (b.type === 'text' ? b.text : b.type === 'tool_use')).map(b => (b.type === 'tool_use' ? { type: 'tool_use', id: b.id, name: b.name, input: parseArgs(b.json) } : { type: 'text', text: b.text }));
    return { content, calls: content.filter(b => b.type === 'tool_use') };
  }

  /* ---- one answer: the model, and the tools it asks for, round after round ---- */
  async function answer({ uid, pick, system, history, images = [], send, signal, toolList, agent, depth = 0 }) {
    if (pick.nvidia) {
      const last = history.length - 1;
      const messages = [{ role: 'system', content: system }, ...history.map((m, i) => ({ role: m.role, content: i === last && pick.images ? nvidiaContent(m.text, images) : m.text }))];
      let tools = true;
      for (let turn = 0; turn < MAX_TURNS; turn++) {
        let r;
        try { r = await roundOpenAI(pick.model, messages, send, signal, tools, toolList); }
        catch (e) {
          // The model wouldn't take the tools: answer without them (once it has started, never mind).
          if (!e.toolsRefused || turn > 0) throw e;
          console.log('AI chat: tools refused, answering without them', e.status, String(e.detail || '').slice(0, 300));
          tools = false;
          r = await roundOpenAI(pick.model, [{ role: 'system', content: `${system}\n\n(Your tools are not available right now: answer from what you know, and say so if the user asks you to run something.)` }, ...messages.slice(1)], send, signal, false);
        }
        if (!tools || !r.calls.length) break;
        messages.push({ role: 'assistant', content: r.text || null, tool_calls: r.calls.map(c => ({ id: c.id, type: 'function', function: { name: c.name, arguments: JSON.stringify(c.input) } })) });
        for (const c of r.calls) {
          send({ type: 'tool', id: c.id, name: c.name, input: c.input });
          const got = await useTool(uid, c.name, c.input, toolList, agent, { depth, signal });
          send({ type: 'tool_done', id: c.id, ok: got.ok, result: cut(got.result, 4000) });
          messages.push({ role: 'tool', tool_call_id: c.id, content: cut(got.ok ? got.result : `Error: ${got.result}`) });
        }
        if (turn === MAX_TURNS - 1) send({ type: 'text', delta: '\n\n(I stopped after many steps. Ask me to go on if you want more.)' });
      }
    } else {
      const last = history.length - 1;
      const messages = history.map((m, i) => ({ role: m.role, content: i === last && images.length ? [...images.map(im => ({ type: 'image', source: { type: 'base64', media_type: im.media_type, data: im.data } })), { type: 'text', text: m.text }] : m.text }));
      for (let turn = 0; turn < MAX_TURNS; turn++) {
        const r = await roundClaude(pick.model, system, messages, send, signal, toolList);
        if (!r.calls.length) break;
        messages.push({ role: 'assistant', content: r.content });
        const results = [];
        for (const c of r.calls) {
          send({ type: 'tool', id: c.id, name: c.name, input: c.input });
          const got = await useTool(uid, c.name, c.input, toolList, agent, { depth, signal });
          send({ type: 'tool_done', id: c.id, ok: got.ok, result: cut(got.result, 4000) });
          results.push({ type: 'tool_result', tool_use_id: c.id, content: cut(got.result), ...(got.ok ? {} : { is_error: true }) });
        }
        messages.push({ role: 'user', content: results });
      }
    }
  }

  /* ---- an agent as a workflow step (the AI Agent node): the task in, its answer out ---- */
  async function runTask({ uid, agentId, inline, task, signal, model = '', chatModel = '', depth = 0 }) {
    if (!providers.length) throw Object.assign(new Error('AI is off on this server (set NVIDIA_API_KEY or ANTHROPIC_API_KEY).'), { code: 'ai_off' });
    const agent = agentId ? flows.agent.getAgent(uid, String(agentId)) : { name: 'Agent', instructions: inline?.instructions || '', tools: inline?.tools || [] };
    if (!agent) throw Object.assign(new Error('That agent was deleted. Pick another in the node.'), { code: 'no_agent' });
    if (!store.useAi(uid, dailyLimit)) throw Object.assign(new Error('Today’s AI allowance is used up.'), { code: 'ai_limit' });
    let text = '';
    const steps = [];
    const send = ev => { if (ev.type === 'text') text += ev.delta; else if (ev.type === 'tool') steps.push({ tool: ev.name, input: ev.input }); else if (ev.type === 'tool_done') Object.assign(steps[steps.length - 1] || {}, { ok: ev.ok }); };
    // The step's own AI model when it picked one (and the server has it), else the default.
    const first = (model && providers.find(p => p.id === model)) || (chatModel && providers.find(p => p.id === chatModel)) || defaultProvider;
    if (model && !providers.some(p => p.id === model)) throw Object.assign(new Error(`This step’s AI model (${model}) isn’t on this server. Pick another in the step.`), { code: 'ai_off' });
    await withFallback(first, () => text === '', pick => answer({ uid, pick, system: AGENT_SYSTEM(agent, { name: '' }, new Date().toISOString().slice(0, 10), true, (agent.tools || []).includes('memory') ? memoryNote(uid, agent) : ''), history: [{ role: 'user', text: String(task || '').slice(0, 100_000) || 'Do your task.' }], send, signal, toolList: toolsFor(agent), agent, depth }));
    return { text: text.trim(), steps, agent: agent.name };
  }

  /* ---- the route ---- */
  const chat = async function chat(req, res) {
    const b = req.body || {};
    const provider = providers.find(p => p.id === b.provider) || defaultProvider;
    const history = (Array.isArray(b.messages) ? b.messages : []).filter(m => m && (m.role === 'user' || m.role === 'assistant') && typeof m.text === 'string' && m.text.trim()).slice(-30);
    if (!history.length || history[history.length - 1].role !== 'user') return res.status(400).json({ error: 'bad_request' });
    if (JSON.stringify(history).length > 400_000) return res.status(413).json({ error: 'too_large' });
    const images = (Array.isArray(b.images) ? b.images : []).slice(0, 4).filter(im => ['image/png', 'image/jpeg', 'image/gif', 'image/webp'].includes(im?.media_type) && typeof im.data === 'string' && im.data.length < 6_000_000);
    const pick = images.length && !provider.images ? providers.find(p => p.images) || provider : provider;
    if (images.length && !pick.images) return res.status(400).json({ error: 'bad_image', message: `${provider.label} doesn't read pictures.` });
    if (b.agentId && !flows.agent.getAgent(req.user.id, String(b.agentId))) return res.status(404).json({ error: 'no_agent', message: 'That agent was deleted.' });
    if (!store.useAi(req.user.id, dailyLimit)) return res.status(429).json({ error: 'daily_limit' });

    const ctl = new AbortController();
    res.on('close', () => ctl.abort());
    res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
    res.flushHeaders?.();
    let started = false;
    const send = ev => { if (ev.type === 'text' || ev.type === 'tool') started = true; if (!res.writableEnded) res.write(`data: ${JSON.stringify(ev)}\n\n`); };
    const uid = req.user.id, today = new Date().toISOString().slice(0, 10);
    // Nemo, or one of the user's agents.
    const agent = b.agentId ? flows.agent.getAgent(uid, String(b.agentId)) : null;
    const system = agent ? AGENT_SYSTEM(agent, req.user, today, false, (agent.tools || []).includes('memory') ? memoryNote(uid, agent) : '') : SYSTEM(req.user, today, memoryNote(uid, null));
    const toolList = agent ? toolsFor(agent) : [...TOOLS, CREATE_AGENT];
    try {
      // If the picked model fails before it has said anything, the next one answers (pictures only go to one that reads them).
      await withFallback(pick, () => !started && !ctl.signal.aborted, p => answer({ uid, pick: p, system, history, images, send, signal: ctl.signal, toolList, agent }), images.length > 0);
      send({ type: 'done' });
    } catch (e) {
      if (!ctl.signal.aborted) {
        console.log('AI chat error', e.status, String(e.detail || e.upstream || e.message || '').slice(0, 500));
        send({ type: 'error', message: errorMessage(e) });
      }
    }
    res.end();
  };
  // Runs fn with the picked model; when it fails and canRetry() says nothing was shown yet, tries the other models.
  async function withFallback(first, canRetry, fn, needImages = false) {
    const order = [first, ...providers.filter(p => p !== first && (!needImages || p.images))];
    let err;
    for (const p of order) {
      try { return await fn(p); }
      catch (e) {
        err = e;
        if (!canRetry() || e.code === 'cancelled') throw e;
        console.log(`AI: ${p.label} failed (${e.status || e.upstream || e.message}), trying the next model`);
      }
    }
    throw err;
  }

  /* ---- missions: a goal an agent works through by itself, in the background ----
     It writes a plan (update_plan), does the steps with the tools (and the user's agents: ask_agent), ticks
     them off (finish_step) and ends with a summary. It stops for the user where it matters: before a tool
     that sends, changes or runs something (approve: 'risky', or every tool: 'all'), and when it needs an
     answer (ask_user); approving runs the tool and it goes on. A mission can repeat on a schedule. It keeps
     its conversation, so it carries on where it stopped, also after the server restarts. */
  const MISSION_TURNS = 30, MISSIONS_MAX = 40, LOG_MAX = 400;
  const MISSION_TOOLS = [
    { name: 'update_plan', description: 'Writes (or rewrites) the mission’s plan: the steps in order, each a short title, and who does it (agent_id of one of the user’s agents, or none for you). Call it first, and again when the plan changes.',
      input_schema: { type: 'object', properties: { steps: { type: 'array', items: { type: 'object', properties: { title: { type: 'string' }, agent_id: { type: 'string' } }, required: ['title'] } } }, required: ['steps'] } },
    { name: 'finish_step', description: 'Marks a step of the plan done (its number, from 1), with what it gave in a line or two. Use skipped: true for a step that turned out not to be needed.',
      input_schema: { type: 'object', properties: { step: { type: 'number' }, result: { type: 'string' }, skipped: { type: 'boolean' } }, required: ['step'] } },
    { name: 'ask_user', description: 'Stops and asks the user something you can’t decide or find out yourself (a choice, a missing detail). The mission waits for the answer.',
      input_schema: { type: 'object', properties: { question: { type: 'string' } }, required: ['question'] } },
  ];
  const SAFE = new Set(['update_plan', 'finish_step', 'list_workflows', 'find_nodes', 'list_credentials', 'list_files', 'read_file', 'recall', 'remember', 'list_agents']);
  // Does this tool need the user's yes first?
  const needsYes = (m, c) => {
    if (c.name === 'ask_user') return 'question';
    if (m.approve === 'never' || SAFE.has(c.name)) return null;
    if (m.approve === 'all') return 'approve';
    if (c.name === 'run_workflow' || c.name === 'forget') return 'approve';
    if (c.name === 'run_node') { const cat = CATALOG[c.input?.type]; return cat && (cat.credential || /^(core\.http|web\.|app\.)/.test(c.input?.type || '')) ? 'approve' : null; }
    return null;
  };
  const missionsOf = uid => flows.agent.missions(uid);
  const runningMissions = new Map(); // id → AbortController
  const pub = x => { const { messages, queue, ...rest } = x; return rest; };
  const logIt = (x, ev) => { x.log.push({ t: Date.now(), ...ev }); if (x.log.length > LOG_MAX) x.log.splice(0, x.log.length - LOG_MAX); x.updated = Date.now(); };
  const MISSION_SYSTEM = (x, uid, today) => {
    const team = (x.team || []).map(id => flows.agent.getAgent(uid, id)).filter(Boolean);
    return `You are Nemo, working on a mission for ${x.userName || 'the user'} in WorkLine, by yourself in the background. The goal:
<goal>
${x.goal}
</goal>

How to work:
1. First call update_plan with the steps you will take (3 to 8, short titles), and who does each.
2. Do the steps one by one with your tools. After each, call finish_step with what it gave. Change the plan with update_plan when you learn something.
3. ${team.length ? `Your team (hand them their parts with ask_agent): ${team.map(a => `${a.icon} ${a.name} (id ${a.id}): ${a.description || 'no description'}`).join('; ')}.` : 'You can hand parts to the user’s agents with ask_agent (list_agents shows them).'}
4. You can build what the job needs: find_nodes and create_workflow to make a workflow, run_workflow / run_node to run things, create_doc for a report.
5. When you can’t decide something or a detail is missing, ask_user. Some tools wait for the user’s yes first: that’s expected; just call them.
6. remember what will matter next time (decisions, preferences, where things are).
7. When the goal is reached, answer with a short summary of what you did and what came of it (no question at the end).
${x.runs?.length ? `\nThis mission runs on a schedule; the last run ended: ${String(x.runs[x.runs.length - 1].result || '').slice(0, 600)}\n` : ''}${memoryNote(uid, null)}
Today is ${today}.`;
  };
  // The conversation, in the provider's own form.
  const toOpenAI = (system, msgs) => [{ role: 'system', content: system }, ...msgs.map(m2 => m2.role === 'assistant'
    ? { role: 'assistant', content: m2.text || null, ...(m2.calls?.length ? { tool_calls: m2.calls.map(c => ({ id: c.id, type: 'function', function: { name: c.name, arguments: JSON.stringify(c.input || {}) } })) } : {}) }
    : m2.role === 'tool' ? { role: 'tool', tool_call_id: m2.id, content: m2.content } : { role: 'user', content: m2.text })];
  const toClaude = msgs => {
    const out = [];
    for (const m2 of msgs) {
      if (m2.role === 'tool') {
        const block = { type: 'tool_result', tool_use_id: m2.id, content: m2.content, ...(m2.error ? { is_error: true } : {}) };
        const prev = out[out.length - 1];
        if (prev && prev.role === 'user' && Array.isArray(prev.content) && prev.content[0]?.type === 'tool_result') prev.content.push(block); else out.push({ role: 'user', content: [block] });
      } else if (m2.role === 'assistant') out.push({ role: 'assistant', content: [...(m2.text ? [{ type: 'text', text: m2.text }] : []), ...(m2.calls || []).map(c => ({ type: 'tool_use', id: c.id, name: c.name, input: c.input || {} }))] });
      else out.push({ role: 'user', content: m2.text });
    }
    return out;
  };
  const missionTool = async (uid, x, c, signal) => {
    if (c.name === 'update_plan') {
      const old = x.plan || [];
      x.plan = (Array.isArray(c.input?.steps) ? c.input.steps : []).slice(0, 15).map((st, i) => {
        const was = old.find(o => o.title === String(st.title || '').slice(0, 160));
        return { title: String(st.title || `Step ${i + 1}`).slice(0, 160), agent: st.agent_id ? String(st.agent_id) : '', status: was?.status || 'todo', result: was?.result || '' };
      });
      const next = x.plan.find(st => st.status === 'todo'); if (next) next.status = 'doing';
      logIt(x, { type: 'plan', steps: x.plan.length });
      return { ok: true, result: { steps: x.plan.length, note: 'Plan saved.' } };
    }
    if (c.name === 'finish_step') {
      const st = (x.plan || [])[Number(c.input?.step) - 1];
      if (!st) return { ok: false, result: 'There is no step with that number.' };
      st.status = c.input?.skipped ? 'skipped' : 'done'; st.result = String(c.input?.result || '').slice(0, 600);
      const next = x.plan.find(s2 => s2.status === 'todo'); if (next && !x.plan.some(s2 => s2.status === 'doing')) next.status = 'doing';
      logIt(x, { type: 'step', step: Number(c.input.step), title: st.title, status: st.status });
      return { ok: true, result: { note: 'Ticked off.', left: x.plan.filter(s2 => s2.status === 'todo' || s2.status === 'doing').length } };
    }
    const allowed = [...TOOLS, ...MISSION_TOOLS];
    return useTool(uid, c.name, c.input, allowed, null, { mission: x.id, signal });
  };
  // Runs the queued tool calls; stops at one that needs the user. true: all done.
  const drainQueue = async (uid, x, signal) => {
    while (x.queue?.length) {
      const c = x.queue[0];
      const why = needsYes(x, c);
      if (why && x.allowed !== c.id) {
        x.status = 'waiting';
        x.pending = { kind: why, id: c.id, name: c.name, input: c.input, ...(why === 'question' ? { question: String(c.input?.question || '').slice(0, 1000) } : {}) };
        logIt(x, { type: 'wait', kind: why, tool: c.name, input: c.input });
        return false;
      }
      x.allowed = null;
      logIt(x, { type: 'tool', tool: c.name, input: c.input });
      const got = await missionTool(uid, x, c, signal);
      logIt(x, { type: 'tool_done', tool: c.name, ok: got.ok, result: cut(got.result, 1500) });
      x.messages.push({ role: 'tool', id: c.id, content: cut(got.ok ? got.result : `Error: ${got.result}`, 12_000), ...(got.ok ? {} : { error: true }) });
      x.queue.shift();
      flows.agent.touch();
    }
    return true;
  };
  async function runMission(uid, id) {
    const x = missionsOf(uid)[id];
    if (!x || runningMissions.has(id)) return;
    const ctl = new AbortController();
    runningMissions.set(id, ctl);
    x.status = 'running'; x.pending = null; flows.agent.touch();
    try {
      if (!providers.length) throw Object.assign(new Error('AI is off on this server (set NVIDIA_API_KEY or ANTHROPIC_API_KEY).'), { code: 'ai_off' });
      if (!(await drainQueue(uid, x, ctl.signal))) return;
      const pick = providers.find(p => p.id === x.provider) || defaultProvider;
      const toolList = [...TOOLS, ...MISSION_TOOLS];
      for (; x.turns < MISSION_TURNS; x.turns++) {
        if (ctl.signal.aborted) throw Object.assign(new Error('Stopped.'), { code: 'cancelled' });
        const system = MISSION_SYSTEM(x, uid, new Date().toISOString().slice(0, 10));
        let text = '';
        const send = ev => { if (ev.type === 'text') text += ev.delta; };
        let calls;
        if (pick.nvidia) { const r = await roundOpenAI(pick.model, toOpenAI(system, x.messages), send, ctl.signal, true, toolList); calls = r.calls; text = r.text || text; }
        else { const r = await roundClaude(pick.model, system, toClaude(x.messages), send, ctl.signal, toolList); calls = r.calls.map(b => ({ id: b.id, name: b.name, input: b.input })); text = r.content.filter(b => b.type === 'text').map(b => b.text).join('') || text; }
        x.messages.push({ role: 'assistant', text, calls });
        if (text.trim()) logIt(x, { type: 'text', text: text.trim().slice(0, 4000) });
        if (!calls.length) { x.result = text.trim(); break; }
        x.queue = calls.map(c => ({ id: c.id, name: c.name, input: c.input }));
        flows.agent.touch();
        if (!(await drainQueue(uid, x, ctl.signal))) return;
      }
      if (!x.result) x.result = 'I stopped after many steps without finishing. Run it again to carry on.';
      for (const st of x.plan || []) if (st.status === 'doing') st.status = x.result ? 'done' : st.status;
      x.status = 'done';
      logIt(x, { type: 'done' });
    } catch (e) {
      x.status = e.code === 'cancelled' ? 'stopped' : 'failed';
      x.error = e.code === 'cancelled' ? 'Stopped.' : errorMessage(e);
      logIt(x, { type: x.status, text: x.error });
    } finally {
      runningMissions.delete(id);
      if (x.status === 'done' || x.status === 'failed') {
        x.runs = [...(x.runs || []), { at: Date.now(), status: x.status, result: String(x.result || x.error || '').slice(0, 1200) }].slice(-10);
        if (x.schedule) x.nextAt = Date.now() + ({ hour: 36e5, day: 864e5, week: 6048e5 }[x.schedule] || 864e5);
      }
      x.updated = Date.now();
      flows.agent.touch();
    }
  }
  const startFresh = (uid, x) => {
    Object.assign(x, { status: 'running', plan: [], messages: [{ role: 'user', text: `Work on this goal now: ${x.goal}` }], queue: [], pending: null, result: '', error: '', turns: 0, allowed: null });
    logIt(x, { type: 'start' });
    runMission(uid, x.id);
  };
  // Scheduled missions start again when they're due; ones a restart cut off are marked stopped.
  for (const { mission: x } of flows.agent.allMissions()) if (x.status === 'running') { x.status = 'stopped'; x.error = 'The server restarted while it ran. Run it again to carry on.'; }
  const missionTimer = setInterval(() => {
    for (const { uid, mission: x } of flows.agent.allMissions()) {
      if (x.schedule && x.nextAt && x.nextAt <= Date.now() && !['running', 'waiting'].includes(x.status) && !runningMissions.has(x.id)) startFresh(uid, x);
    }
  }, 60_000);
  missionTimer.unref?.();

  chat.routes = (api, signedIn) => {
    api.get('/missions', signedIn, (req, res) => res.json({ missions: Object.values(missionsOf(req.user.id)).map(x => ({ ...pub(x), log: undefined })).sort((a, b) => b.updated - a.updated) }));
    api.get('/missions/:id', signedIn, (req, res) => { const x = missionsOf(req.user.id)[req.params.id]; return x ? res.json({ mission: pub(x) }) : res.status(404).json({ error: 'not_found' }); });
    api.post('/missions', signedIn, (req, res) => {
      const b = req.body || {}, mine = missionsOf(req.user.id);
      const goal = String(b.goal || '').trim().slice(0, 4000);
      if (!goal) return res.status(400).json({ error: 'bad_request', message: 'Write the goal.' });
      if (Object.keys(mine).length >= MISSIONS_MAX) return res.status(400).json({ error: 'too_many', message: `That’s ${MISSIONS_MAX} missions: delete some first.` });
      if (!providers.length) return res.status(503).json({ error: 'not_configured', message: 'AI is off on this server.' });
      if (!store.useAi(req.user.id, dailyLimit)) return res.status(429).json({ error: 'daily_limit', message: 'Today’s AI allowance is used up.' });
      const now = Date.now();
      const x = { id: `ms_${randomBytes(5).toString('hex')}`, goal, title: String(b.title || goal.split('\n')[0]).slice(0, 80), userName: req.user.name || '',
        team: (Array.isArray(b.team) ? b.team : []).map(String).filter(id => flows.agent.getAgent(req.user.id, id)).slice(0, 8),
        approve: ['all', 'risky', 'never'].includes(b.approve) ? b.approve : 'risky', schedule: ['hour', 'day', 'week'].includes(b.schedule) ? b.schedule : null,
        provider: providers.some(p => p.id === b.provider) ? b.provider : '', created: now, updated: now, log: [], runs: [] };
      mine[x.id] = x;
      startFresh(req.user.id, x);
      res.status(201).json({ mission: pub(x) });
    });
    // The user's answer where it waits: yes / no for a tool (with a note), or the answer to its question.
    api.post('/missions/:id/answer', signedIn, (req, res) => {
      const x = missionsOf(req.user.id)[req.params.id], b = req.body || {};
      if (!x) return res.status(404).json({ error: 'not_found' });
      if (x.status !== 'waiting' || !x.pending || !x.queue?.length) return res.status(409).json({ error: 'not_waiting', message: 'It isn’t waiting for you.' });
      const p2 = x.pending, note = String(b.note || '').slice(0, 2000);
      if (p2.kind === 'question') {
        x.messages.push({ role: 'tool', id: p2.id, content: `The user answered: ${note || '(no answer)'}` });
        x.queue.shift();
        logIt(x, { type: 'answer', text: note });
      } else if (b.ok) { x.allowed = p2.id; logIt(x, { type: 'yes', tool: p2.name }); }
      else {
        x.messages.push({ role: 'tool', id: p2.id, content: `The user said no${note ? `: ${note}` : '.'} Don’t do that; find another way or leave it out.`, error: true });
        x.queue.shift();
        logIt(x, { type: 'no', tool: p2.name, text: note });
      }
      x.pending = null; x.status = 'running';
      runMission(req.user.id, x.id);
      res.json({ mission: pub(x) });
    });
    api.post('/missions/:id/stop', signedIn, (req, res) => {
      const x = missionsOf(req.user.id)[req.params.id];
      if (!x) return res.status(404).json({ error: 'not_found' });
      runningMissions.get(x.id)?.abort();
      if (x.status === 'waiting') { x.status = 'stopped'; x.pending = null; logIt(x, { type: 'stopped', text: 'Stopped.' }); flows.agent.touch(); }
      res.json({ mission: pub(x) });
    });
    api.post('/missions/:id/run', signedIn, (req, res) => {
      const x = missionsOf(req.user.id)[req.params.id];
      if (!x) return res.status(404).json({ error: 'not_found' });
      if (runningMissions.has(x.id) || x.status === 'waiting') return res.status(409).json({ error: 'busy', message: 'It’s already going.' });
      if (!store.useAi(req.user.id, dailyLimit)) return res.status(429).json({ error: 'daily_limit', message: 'Today’s AI allowance is used up.' });
      // Carry on where it stopped (stopped / failed part-way), or start again (done).
      if (x.status === 'done' || !x.messages?.length) startFresh(req.user.id, x);
      else { x.turns = 0; logIt(x, { type: 'resume' }); runMission(req.user.id, x.id); }
      res.json({ mission: pub(x) });
    });
    api.put('/missions/:id', signedIn, (req, res) => {
      const x = missionsOf(req.user.id)[req.params.id], b = req.body || {};
      if (!x) return res.status(404).json({ error: 'not_found' });
      if ('schedule' in b) { x.schedule = ['hour', 'day', 'week'].includes(b.schedule) ? b.schedule : null; x.nextAt = x.schedule ? Date.now() + ({ hour: 36e5, day: 864e5, week: 6048e5 }[x.schedule]) : null; }
      if ('approve' in b && ['all', 'risky', 'never'].includes(b.approve)) x.approve = b.approve;
      x.updated = Date.now(); flows.agent.touch();
      res.json({ mission: pub(x) });
    });
    api.delete('/missions/:id', signedIn, (req, res) => {
      runningMissions.get(req.params.id)?.abort();
      delete missionsOf(req.user.id)[req.params.id]; flows.agent.touch();
      res.status(204).end();
    });
    // Memory: what Nemo and the agents remember.
    api.get('/memory', signedIn, (req, res) => res.json({ memory: memOf(req.user.id).map(x => ({ ...x, agentName: x.agent ? flows.agent.getAgent(req.user.id, x.agent)?.name || '' : '' })) }));
    api.post('/memory', signedIn, async (req, res) => { try { res.status(201).json(await run.remember(req.user.id, req.body || {})); } catch (e) { res.status(400).json({ error: 'bad_request', message: e.message }); } });
    api.delete('/memory/:id', signedIn, (req, res) => { const l = memOf(req.user.id), i = l.findIndex(x => x.id === req.params.id); if (i >= 0) { l.splice(i, 1); flows.agent.touch(); } res.status(204).end(); });
  };
  chat.closeMissions = () => { clearInterval(missionTimer); for (const c of runningMissions.values()) c.abort(); };
  chat.runTask = runTask;
  return chat;
}

// What the chat shows when the AI fails: the service's own reason when there is one.
function errorMessage(e) {
  if (e.status === 429) return 'The AI service is busy right now. Try again in a moment.';
  if (e.status === 401 || e.status === 403) return 'The AI key on the server was refused (NVIDIA_API_KEY / ANTHROPIC_API_KEY). Check it on Render.';
  let why = '';
  try { why = JSON.parse(e.detail || '{}').detail || JSON.parse(e.detail || '{}').error?.message || ''; } catch (x) { why = ''; }
  why = String(why || e.upstream || (e.status ? '' : e.message) || '').replace(/\s+/g, ' ').slice(0, 160);
  return `The AI didn’t answer${e.status ? ` (the AI service said ${e.status}${why ? `: ${why}` : ''})` : why ? ` (${why})` : ''}. Try again.`;
}

/* A request to the AI service, tried again (up to 3 more times, waiting 1, 2, then 4 s, or what Retry-After
   asks, at most 10 s) when it says it's busy (429, 503, 529) or the connection fails, so a quick
   second question doesn't fail. */
export async function fetchRetry(url, opts, tries = 3) {
  for (let n = 0; ; n++) {
    let up;
    try { up = await fetch(url, opts); }
    catch (e) { if (opts.signal?.aborted || n >= tries) throw Object.assign(e, { upstream: `couldn’t reach the AI service: ${e.cause?.code || e.message}` }); await wait(1000 * 2 ** n, opts.signal); continue; }
    if (![429, 503, 529].includes(up.status) || n >= tries) return up;
    const after = Number(up.headers.get('retry-after'));
    await up.body?.cancel().catch(() => {});
    await wait(Math.min(10_000, after > 0 ? after * 1000 : 1000 * 2 ** n), opts.signal);
  }
}
const wait = (ms, signal) => new Promise(ok => { const t = setTimeout(ok, ms); signal?.addEventListener('abort', () => { clearTimeout(t); ok(); }, { once: true }); });

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
