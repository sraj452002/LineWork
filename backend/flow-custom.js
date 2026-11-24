import { FlowError, items as toItems } from './flow-engine.js';
import { runLocal } from './flow-code.js';

/* Custom nodes: nodes people make themselves (My nodes in the editor). Each is a definition kept in the
   account's settings (userdata "customNodes", {id: def}), and a workflow node of type "custom.<id>":

     { id, name, note, icon, tone, language: 'javascript' | 'python', code,
       fields: [{ k, label, kind: text | textarea | number | select | bool, hint, options, d }] }

   It runs like the Code node, in the same sandbox, with two more names its code can read:
     settings       the node's settings, filled in (expressions worked out) for the first item;
     itemSettings   (JavaScript) / item_settings (Python): the same for each item, in order.
   Workflows always run the account's latest version; a workflow file carries copies of the custom nodes it
   uses (flow.customNodes) so it still runs where they aren't saved. */

export const CUSTOM_LANGS = ['javascript', 'python'];
const ID = /^[A-Za-z0-9_-]{1,40}$/;

// A definition as it may be saved: known keys only, within limits; null if it can't be one.
export function cleanCustom(def) {
  if (!def || typeof def !== 'object' || !ID.test(String(def.id || ''))) return null;
  const kinds = ['text', 'textarea', 'number', 'select', 'bool'];
  const fields = (Array.isArray(def.fields) ? def.fields : []).slice(0, 30)
    .filter(f => f && /^[A-Za-z_][\w]{0,39}$/.test(String(f.k || '')))
    .map(f => ({
      k: f.k, label: String(f.label || f.k).slice(0, 80), kind: kinds.includes(f.kind) ? f.kind : 'text',
      ...(f.hint ? { hint: String(f.hint).slice(0, 200) } : {}),
      ...(f.kind === 'select' ? { options: (Array.isArray(f.options) ? f.options : []).slice(0, 50).map(o => (Array.isArray(o) ? [String(o[0]), String(o[1] ?? o[0])] : [String(o), String(o)])) } : {}),
      ...(f.d !== undefined ? { d: f.kind === 'bool' ? !!f.d : f.kind === 'number' ? Number(f.d) || 0 : String(f.d).slice(0, 2000) } : {}),
    }));
  return {
    id: def.id, name: String(def.name || 'My node').slice(0, 60), note: String(def.note || '').slice(0, 200),
    icon: String(def.icon || 'code').slice(0, 30), tone: String(def.tone || 'teal').slice(0, 20),
    language: CUSTOM_LANGS.includes(def.language) ? def.language : 'javascript',
    code: String(def.code || '').slice(0, 100_000), fields, updated: Number(def.updated) || 0,
  };
}

// The names the code reads, put before it.
function prelude(lang, settings, each) {
  if (lang === 'python') {
    const lit = v => JSON.stringify(JSON.stringify(v)); // a JSON string, as a Python string literal
    return `import json as __json\nsettings = __json.loads(${lit(settings)})\nitem_settings = __json.loads(${lit(each)})\n`;
  }
  return `const settings = ${JSON.stringify(settings)};\nconst itemSettings = ${JSON.stringify(each)};\n`;
}

export function customType(def) {
  return {
    run: async args => {
      if (!String(def.code || '').trim()) throw new FlowError(`The custom node “${def.name}” has no code yet. Edit it in My nodes.`, 'missing');
      const each = args.items.map((item, i) => args.params(item, i));
      const settings = each[0] || args.params();
      const input = args.items.map(x => structuredClone(x.json));
      let got;
      try { got = await runLocal(def.language, prelude(def.language, settings, each) + def.code, input); } catch (e) {
        throw new FlowError(/doesn't parse/.test(e.message) ? `${def.name}: ${e.message}` : `${def.name} failed: ${e.message}`, 'code');
      }
      let result = got.result;
      if (result === undefined) result = input;
      const out = toItems(Array.isArray(result) ? result.map(r => (r && r.json && Object.keys(r).length === 1 ? r.json : r)) : result);
      if (got.logs.length && out[0]) out[0].json = { ...out[0].json, _logs: got.logs };
      return { main: out };
    },
  };
}

// The node types for a set of definitions ({id: def}): "custom.<id>" → its runner.
export function customTypes(defs) {
  const out = {};
  for (const raw of Object.values(defs && typeof defs === 'object' ? defs : {})) {
    const def = cleanCustom(raw);
    if (def) out[`custom.${def.id}`] = customType(def);
  }
  return out;
}
