// Writes frontend/src/lib/morenodes.js: what the editor needs to show the tool and app-action nodes
// (backend/flow-tools.js and backend/flow-actions.js, where they're defined and run). Run it after
// changing either: node scripts/more-nodes.mjs (tests/flow-tools.spec.js checks it's up to date).
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { TOOL_GROUPS, TOOL_META } from '../backend/flow-tools.js';
import { ACTION_GROUPS, ACTION_META } from '../backend/flow-actions.js';

export const moreNodes = () => `// Made by scripts/more-nodes.mjs from backend/flow-tools.js and flow-actions.js: don't edit by hand.\nexport const MORE = ${JSON.stringify({ groups: [...TOOL_GROUPS, ...ACTION_GROUPS], nodes: { ...TOOL_META, ...ACTION_META } })};\n`;
export const OUT = fileURLToPath(new URL('../frontend/src/lib/morenodes.js', import.meta.url));
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  writeFileSync(OUT, moreNodes());
  console.log(`Wrote ${Object.keys(TOOL_META).length + Object.keys(ACTION_META).length} nodes to frontend/src/lib/morenodes.js`);
}
