import vm from 'node:vm';

/* Running a workflow (a file's `flow`: {nodes: [{id, type, name, params, credential}], edges: [{from, fromPort,
   to, toPort}]}), the way n8n does: data moves between nodes as a list of items, each {json: {...}}.

   A run starts at one trigger node with its input items, and visits the nodes reachable from it in
   order: a node runs once the nodes before it have, on the items that reached its input. A node that no
   items reach is skipped (an IF's unused branch). A node's params may hold expressions, {{ … }}, which
   read the item ($json), earlier nodes ($node["Name"].json), and $now; a param that is only an
   expression keeps its value's type. The first error stops the run, unless the node says otherwise
   (node.onError: 'continue' passes its items on with the error, 'output' sends them out of its error port). */

export class FlowError extends Error {
  constructor(message, code = 'flow_error') { super(message); this.code = code; }
}

export const LIMITS = { steps: 200, items: 5000, exprMs: 250, runMs: 120_000 };
const EXPR = /\{\{([\s\S]+?)\}\}/g;
const ONLY = /^\s*\{\{([\s\S]+?)\}\}\s*$/;

// Fill in a param's expressions for one item. ctx: {$json, $node, $now, $index}.
export function evaluate(value, ctx) {
  if (typeof value === 'string') {
    const only = value.match(ONLY);
    if (only) return run(only[1], ctx);
    if (!value.includes('{{')) return value;
    return value.replace(EXPR, (_, expr) => {
      const v = run(expr, ctx);
      return v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v);
    });
  }
  if (Array.isArray(value)) return value.map(v => evaluate(v, ctx));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, evaluate(v, ctx)]));
  return value;
}
function run(expr, ctx) {
  try {
    return vm.runInNewContext(`(${expr})`, {
      $json: ctx.$json || {}, $node: ctx.$node || {}, $now: ctx.$now, $index: ctx.$index || 0,
      JSON, Math, Date, String, Number, Boolean, Array, Object, parseInt, parseFloat, encodeURIComponent, decodeURIComponent,
    }, { timeout: LIMITS.exprMs });
  } catch (e) {
    throw new FlowError(`The expression {{${expr}}} failed: ${e.message}`, 'expression');
  }
}

// A dot path into an object: "user.address.city", "items.0.name".
export const getPath = (obj, path) => String(path || '').split('.').filter(Boolean).reduce((o, k) => (o == null ? undefined : o[k]), obj);
export function setPath(obj, path, value) {
  const keys = String(path || '').split('.').filter(Boolean);
  if (!keys.length) return obj;
  let o = obj;
  for (const k of keys.slice(0, -1)) o = (o[k] && typeof o[k] === 'object') ? o[k] : (o[k] = {});
  o[keys[keys.length - 1]] = value;
  return obj;
}
export const items = list => (Array.isArray(list) ? list : [list]).map(j => ({ json: j && typeof j === 'object' && !Array.isArray(j) ? j : { value: j } }));

/* Run `flow` from `startId` with `input` items. `types` maps a node type to {run(args) → {portName: items}};
   `ctx` is passed to every node (account, credentials, the AI…). onStep(nodeId, result) reports progress.
   Returns {status: 'success' | 'error', nodes: {id: {status, ms, items, output, error}}, error}. */
export async function runFlow(flow, { startId, input = [{ json: {} }], types, ctx = {}, onStep = () => {} }) {
  const nodes = new Map((flow?.nodes || []).map(n => [n.id, n]));
  const edges = (flow?.edges || []).filter(e => nodes.has(e.from) && nodes.has(e.to));
  if (!nodes.has(startId)) throw new FlowError('That workflow has no such starting node.', 'no_start');

  // The nodes reachable from the start, in an order where each comes after everything feeding it.
  const reach = new Set([startId]);
  for (let grew = true; grew;) { grew = false; for (const e of edges) if (reach.has(e.from) && !reach.has(e.to)) { reach.add(e.to); grew = true; } }
  const inner = edges.filter(e => reach.has(e.from) && reach.has(e.to));
  const waiting = new Map([...reach].map(id => [id, inner.filter(e => e.to === id && e.from !== id).length]));
  const order = [], ready = [startId];
  waiting.set(startId, 0);
  while (ready.length) {
    const id = ready.shift();
    order.push(id);
    for (const e of inner.filter(x => x.from === id)) {
      const left = waiting.get(e.to) - 1;
      waiting.set(e.to, left);
      if (left === 0) ready.push(e.to);
    }
  }
  if (order.length < reach.size) throw new FlowError('The workflow loops back on itself. Remove the connection that makes the loop.', 'cycle');
  if (order.length > LIMITS.steps) throw new FlowError(`The workflow has more than ${LIMITS.steps} steps.`, 'too_big');

  const outputs = new Map(); // node id → {port: items}
  const results = {};
  const byName = {}; // for $node["Name"]
  const deadline = Date.now() + LIMITS.runMs;
  const now = new Date().toISOString();

  for (const id of order) {
    const node = nodes.get(id);
    const type = types[node.type];
    const started = Date.now();
    // Items arriving at each input port.
    const inputs = {};
    if (id === startId) inputs.main = input;
    for (const e of inner.filter(x => x.to === id)) {
      const from = outputs.get(e.from);
      const got = from ? from[e.fromPort || 'main'] || [] : [];
      (inputs[e.toPort || 'main'] ||= []).push(...got);
    }
    const all = Object.values(inputs).flat();
    if (id !== startId && !all.length) { results[id] = { status: 'skipped', ms: 0, items: 0 }; onStep(id, results[id]); continue; }
    if (all.length > LIMITS.items) throw new FlowError(`Too many items reached “${node.name}” (over ${LIMITS.items}).`, 'too_many_items');
    if (!type) {
      results[id] = { status: 'error', ms: 0, items: 0, error: `Unknown node type “${node.type}”.` };
      onStep(id, results[id]);
      return { status: 'error', nodes: results, error: results[id].error, failed: id };
    }
    try {
      if (Date.now() > deadline) throw new FlowError('The run took too long and was stopped.', 'timeout');
      const expr = (item, i) => ({ $json: item?.json || {}, $node: byName, $now: now, $index: i });
      const out = await type.run({
        node, items: inputs.main || all, inputs, ctx,
        // The node's params, filled in for one item (or the first, for nodes that run once).
        params: (item = all[0], i = 0) => evaluate(node.params || {}, expr(item, i)),
      }) || { main: [] };
      outputs.set(id, out);
      const main = out.main || Object.values(out).flat();
      byName[node.name] = { json: main[0]?.json || {}, items: main.map(x => x.json) };
      results[id] = { status: 'success', ms: Date.now() - started, items: main.length, output: Object.fromEntries(Object.entries(out).map(([p, list]) => [p, list.map(x => x.json)])) };
      onStep(id, results[id]);
    } catch (e) {
      const message = e.message || String(e);
      // Try/catch, per node: “continue” passes its items on with the error; “output” sends them out of an error port.
      if (node.onError === 'continue' || node.onError === 'output') {
        const failed = (inputs.main || all).map(x => ({ json: { ...x.json, error: message } }));
        const out = node.onError === 'output' ? { main: [], error: failed } : { main: failed };
        outputs.set(id, out);
        byName[node.name] = { json: failed[0]?.json || {}, items: failed.map(x => x.json) };
        results[id] = { status: 'success', handled: true, error: message, ms: Date.now() - started, items: failed.length, output: Object.fromEntries(Object.entries(out).map(([p, list]) => [p, list.map(x => x.json)])) };
        onStep(id, results[id]);
        continue;
      }
      results[id] = { status: 'error', ms: Date.now() - started, items: 0, error: message };
      onStep(id, results[id]);
      return { status: 'error', nodes: results, error: `${node.name}: ${results[id].error}`, failed: id };
    }
  }
  return { status: 'success', nodes: results };
}
