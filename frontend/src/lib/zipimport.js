/* Reading a .zip to import: what's inside, sorted by what Workline can make of it.
   workflows: .json files that are Workline or n8n workflows. sheets: .csv, .tsv, .xlsx. schemas: .sql
   with CREATE TABLE. docs: .md and .txt. code: source files (kept with their folders, as one code
   project). Everything else is listed as skipped. */
import { importFlow } from './flowio.js';

const MAX = 100e6, MAX_FILES = 500;
const CODE = /\.(js|jsx|ts|tsx|mjs|cjs|py|go|rb|rs|java|kt|swift|c|h|cpp|hpp|cs|php|sh|html|css|scss|vue|svelte|yaml|yml|toml|xml|graphql|proto|prisma|ini|env\.example|dockerfile|gitignore)$/i;
const base = p => p.split('/').pop();
const stem = p => base(p).replace(/(\.workflow)?\.\w+$/i, '').slice(0, 40) || 'Imported';

export async function readZip(file) {
  if (file.size > MAX) throw new Error('That zip is too big (over 100 MB).');
  const { default: JSZip } = await import('jszip');
  let zip;
  try { zip = await JSZip.loadAsync(await file.arrayBuffer()); } catch (e) { throw new Error('That isn’t a zip file Workline can open.'); }
  const entries = Object.values(zip.files).filter(e => !e.dir && !/(^|\/)(__MACOSX|\.DS_Store|Thumbs\.db)/.test(e.name));
  if (entries.length > MAX_FILES) throw new Error(`That zip has ${entries.length} files; Workline opens zips of up to ${MAX_FILES}.`);
  // Folders all the files share (a zip of “project/…”) are dropped from the paths.
  const parts = entries.map(e => e.name.split('/').slice(0, -1));
  let common = parts[0] || [];
  for (const p of parts) { let i = 0; while (i < common.length && p[i] === common[i]) i++; common = common.slice(0, i); }
  const rel = name => name.split('/').slice(common.length).join('/');
  const got = { name: file.name.replace(/\.zip$/i, '') || 'Imported', workflows: [], sheets: [], schemas: [], docs: [], code: [], skipped: [] };
  for (const e of entries) {
    const path = rel(e.name), n = path.toLowerCase();
    if (n.endsWith('.json')) {
      const text = await e.async('string');
      try { const f = importFlow(text); got.workflows.push({ path, title: f.name || stem(path), flow: f.flow, skipped: f.skipped }); continue; } catch (err) { /* not a workflow */ }
      got.code.push({ path, text });
    } else if (/\.(csv|tsv)$/.test(n)) got.sheets.push({ path, title: stem(path), text: await e.async('string') });
    else if (/\.(xlsx|xlsm)$/.test(n)) got.sheets.push({ path, title: stem(path), buffer: await e.async('arraybuffer') });
    else if (/\.(sql|ddl)$/.test(n)) got.schemas.push({ path, title: stem(path), text: await e.async('string') });
    else if (/\.(md|markdown|txt)$/.test(n)) got.docs.push({ path, title: stem(path), text: await e.async('string') });
    else if (CODE.test(n) || /(^|\/)(dockerfile|makefile)$/i.test(n)) got.code.push({ path, text: await e.async('string') });
    else got.skipped.push(path);
  }
  return got;
}

// “2 workflows, 1 sheet and 3 docs”.
export function zipSummary(z) {
  const bits = [[z.workflows.length, 'workflow'], [z.sheets.length, 'sheet'], [z.schemas.length, 'database schema'], [z.docs.length, 'doc'], [z.code.length ? 1 : 0, `code project (${z.code.length} file${z.code.length === 1 ? '' : 's'})`]]
    .filter(([k]) => k).map(([k, w]) => (w.startsWith('code') ? `1 ${w}` : `${k} ${w}${k === 1 ? '' : 's'}`));
  return bits.length > 1 ? `${bits.slice(0, -1).join(', ')} and ${bits[bits.length - 1]}` : bits[0] || 'nothing Workline can open';
}
