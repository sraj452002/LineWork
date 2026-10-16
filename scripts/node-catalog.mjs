// Writes backend/node-catalog.json: every workflow node as the editor knows it (frontend/src/lib/flows.js),
// for the AI assistant on the server to find and run nodes. Run it after changing nodes:
//   node scripts/node-catalog.mjs        (--check: only say whether it's up to date; tests/assistant.spec.js does)
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
Object.assign(globalThis, { window: globalThis, localStorage: { getItem: () => null, setItem() {}, removeItem() {} }, location: { origin: 'http://localhost', pathname: '/', hash: '' } });
const { NODES } = await import(join(ROOT, 'frontend/src/lib/flows.js'));
const { NODE_GUIDE } = await import(join(ROOT, 'frontend/src/lib/flowguide.js'));

export const catalog = () => Object.fromEntries(Object.entries(NODES).map(([type, d]) => {
  const g = NODE_GUIDE[type] || d.guide || {};
  // Defaults made fresh each time (a webhook's secret path) are left out, so the file stays the same.
  const make = () => (typeof d.defaults === 'function' ? d.defaults() : d.defaults) || {};
  const one = make(), two = make();
  const defaults = Object.fromEntries(Object.entries(one).filter(([k, v]) => JSON.stringify(v) === JSON.stringify(two[k])));
  return [type, {
    label: d.label, group: d.group, note: d.note || '', ...(g.ex ? { ex: String(g.ex).slice(0, 300) } : {}),
    ...(d.trigger ? { trigger: true } : {}), ...(d.credential ? { credential: d.credential, ...(d.optionalCredential ? { optionalCredential: true } : {}) } : {}),
    fields: (d.fields || []).map(f => ({ key: f.k, label: f.label, kind: f.kind, ...(f.hint ? { hint: String(f.hint).slice(0, 120) } : {}), ...(f.options ? { options: f.options.map(o => (Array.isArray(o) ? o[0] : o)) } : {}) })),
    defaults,
  }];
}));
export const catalogText = () => JSON.stringify(catalog()) + '\n';
if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  const path = join(ROOT, 'backend/node-catalog.json');
  if (process.argv.includes('--check')) {
    const same = existsSync(path) && readFileSync(path, 'utf8') === catalogText();
    console.log(same ? 'backend/node-catalog.json is up to date' : 'backend/node-catalog.json is out of date: run node scripts/node-catalog.mjs');
    process.exit(same ? 0 : 1);
  }
  writeFileSync(path, catalogText());
  console.log('backend/node-catalog.json written');
}
