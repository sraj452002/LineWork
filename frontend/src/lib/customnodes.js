import { rid } from './utils.js';
import { ICON, NODES } from './flows.js';
import { getData, setData } from './userdata.js';

/* Custom nodes (My nodes): nodes people make themselves, with their own name, icon, colour, settings and
   JavaScript or Python code. Kept in the account's settings ("customNodes", {id: def}; in this browser
   without an account) and run by the server (backend/flow-custom.js, which reads the same definitions).
   A workflow node of type "custom.<id>" is one; loading them adds them to NODES, so the editor, the
   library and the guide treat them like any other node. */

export const CUSTOM_ICONS = ['code', 'braces', 'ai', 'flow', 'filter', 'edit', 'text', 'table', 'mail', 'chat', 'globe', 'db', 'cal', 'chart', 'star', 'plug', 'key', 'image', 'page', 'bell', 'user', 'tag', 'lock', 'sum'];
export const CUSTOM_TONES = ['teal', 'blue', 'indigo', 'violet', 'pink', 'red', 'orange', 'amber', 'green', 'sky', 'slate'];
export const FIELD_KINDS = [['text', 'Text'], ['textarea', 'Long text'], ['number', 'Number'], ['select', 'Dropdown'], ['bool', 'On / off']];
export const LIMIT = 190_000; // the server keeps up to 200 KB per setting

export const STARTER = {
  javascript: `// items: the items reaching this node (their JSON).
// settings: this node's settings, filled in. itemSettings: the same for each item.
// Return the items to pass on.
return items.map((item, i) => ({
  ...item,
  greeting: \`\${itemSettings[i].greeting}, \${item.name ?? 'there'}!\`,
}));
`,
  python: `# items: the items reaching this node (dicts).
# settings: this node's settings, filled in. item_settings: the same for each item.
# Return the items to pass on.
return [
    {**item, "greeting": f"{item_settings[i]['greeting']}, {item.get('name', 'there')}!"}
    for i, item in enumerate(items)
]
`,
};
export const blankNode = () => ({
  id: rid('cn').replace(/[^\w-]/g, ''), name: 'My node', note: 'Adds a greeting to each item', icon: 'code', tone: 'teal', language: 'javascript',
  fields: [{ k: 'greeting', label: 'Greeting', kind: 'text', d: 'Hello' }], code: STARTER.javascript, updated: 0,
});

// A setting's key from its label: "Block prefix" → blockPrefix.
export const keyOf = label => String(label || '').replace(/[^\w ]+/g, '').trim().split(/\s+/).filter(Boolean)
  .map((w, i) => (i ? w[0].toUpperCase() + w.slice(1).toLowerCase() : w.toLowerCase())).join('').replace(/^(\d)/, '_$1') || 'setting';

// The node a definition makes, as NODES holds them.
export function nodeOf(def) {
  const fields = (def.fields || []).map(({ d, ...f }) => ({ ...f, ...(f.kind === 'select' ? { options: (f.options || []).map(o => (Array.isArray(o) ? o : [o, o])) } : {}) }));
  return {
    group: 'My nodes', label: def.name || 'My node', note: def.note || 'A node you made', icon: ICON[def.icon] || ICON.code, tone: def.tone || 'teal',
    fields, custom: def.id, language: def.language,
    defaults: () => Object.fromEntries((def.fields || []).filter(f => f.d !== undefined || f.kind === 'select').map(f => [f.k, f.d !== undefined ? f.d : (f.options?.[0]?.[0] ?? f.options?.[0] ?? '')])),
  };
}

let defs = {};
const listeners = new Set();
// Called when the nodes change, with the new list; returns the unsubscribe.
export const onCustomNodes = fn => { listeners.add(fn); return () => listeners.delete(fn); };
const apply = () => {
  for (const k of Object.keys(NODES)) if (k.startsWith('custom.')) delete NODES[k];
  for (const d of Object.values(defs)) NODES[`custom.${d.id}`] = nodeOf(d);
  listeners.forEach(fn => fn(listCustom()));
};
export const listCustom = () => Object.values(defs).sort((a, b) => a.name.localeCompare(b.name));
export const getCustom = id => defs[id];

// Read the account's nodes (after the account's settings have loaded) and add them to NODES.
export function loadCustomNodes() {
  const got = getData('customNodes', {});
  defs = got && typeof got === 'object' && !Array.isArray(got) ? got : {};
  apply();
  return listCustom();
}
// Save one (new or changed); throws with a message when it can't be kept.
export function saveCustom(def) {
  if (!String(def.name || '').trim()) throw new Error('Give the node a name.');
  const keys = (def.fields || []).map(f => f.k);
  const bad = keys.find(k => !/^[A-Za-z_]\w{0,39}$/.test(k));
  if (bad !== undefined) throw new Error(`“${bad || '(empty)'}” can’t be a setting’s key: use letters, digits and _ (not starting with a digit).`);
  const twice = keys.find((k, i) => keys.indexOf(k) !== i);
  if (twice) throw new Error(`Two settings have the key “${twice}”.`);
  const select = (def.fields || []).find(f => f.kind === 'select' && !(f.options || []).length);
  if (select) throw new Error(`Give the dropdown “${select.label}” its choices.`);
  if (!String(def.code || '').trim()) throw new Error('Write the node’s code.');
  const next = { ...defs, [def.id]: { ...def, name: def.name.trim(), updated: Date.now() } };
  if (JSON.stringify(next).length > LIMIT) throw new Error('Your custom nodes are too big to keep together (about 190 KB). Make the code shorter, or delete a node you don’t use.');
  defs = next;
  setData('customNodes', defs);
  apply();
  return defs[def.id];
}
export function deleteCustom(id) {
  const { [id]: gone, ...rest } = defs;
  defs = rest;
  setData('customNodes', defs);
  apply();
}
// Add nodes a workflow file brought ({id: def}) that the account hasn't got; returns how many were added.
export function addMissing(brought) {
  const add = Object.values(brought && typeof brought === 'object' ? brought : {}).filter(d => d && d.id && !defs[d.id] && d.code);
  if (!add.length) return 0;
  defs = { ...defs, ...Object.fromEntries(add.map(d => [d.id, d])) };
  setData('customNodes', defs);
  apply();
  return add.length;
}
// The custom nodes a flow uses, as a workflow file carries them.
export const usedBy = flow => Object.fromEntries([...new Set((flow?.nodes || []).filter(n => String(n.type).startsWith('custom.')).map(n => n.type.slice(7)))]
  .filter(id => defs[id]).map(id => [id, defs[id]]));

// One node as a file to share, and back (a fresh id, so it never replaces one of yours).
export const exportNode = def => JSON.stringify({ workline: 'node', version: 1, node: def }, null, 2);
export function importNode(text) {
  let data;
  try { data = JSON.parse(text); } catch (e) { throw new Error('That file isn’t JSON.'); }
  const d = data && data.workline === 'node' ? data.node : null;
  if (!d || !d.code) throw new Error('That isn’t a Workline node file (.node.json).');
  return { ...blankNode(), ...d, id: blankNode().id, updated: 0 };
}
