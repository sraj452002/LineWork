import { rid } from './utils.js';
import { dg } from './engines.js';

/* Any file as a Workline file, to open in the tool it belongs to (the Editor node's “Workline tool” mode and
   the tool editor nodes), and back to a file of its own kind after editing.
     Course: a Storyline .story, a published Storyline or SCORM .zip, a course page (.html), a .course.json
     Sheet: .xlsx / .xlsm (back as .xlsx), .csv / .tsv (back as the same)
     Doc: .docx (back as .docx-ready Markdown .md), .md, .markdown, .txt, .html (back as .md / .txt)
     Diagram: .sql (CREATE TABLE → a database schema), .mmd / .mermaid / .puml / .d2 (diagram code)
     Workflow: a Workline or n8n workflow .json
     Code: any other text or source file (one file in a code project; back as the same file)
     Viewed only: pictures, PDF, audio and video (Save & continue passes them on as they are).
   A file here is the run's file object { name, type, size, data } with data in base64. */

const ext = name => (/\.([a-z0-9]+)$/i.exec(name || '') || [])[1]?.toLowerCase() || '';
const stem = name => String(name || 'File').replace(/(\.course)?\.[a-z0-9]+$/i, '').slice(0, 80) || 'File';
const b64ToBytes = b64 => Uint8Array.from(atob(String(b64 || '')), c => c.charCodeAt(0));
const bytesToB64 = bytes => { let s = ''; const u = new Uint8Array(bytes); for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000)); return btoa(s); };
const textToB64 = t => bytesToB64(new TextEncoder().encode(t));
export const asUpload = (name, type, text) => { const data = typeof text === 'string' ? textToB64(text) : bytesToB64(text); return { name, type, size: Math.round(data.length * 0.75), data }; };
const toFileObj = up => new File([b64ToBytes(up.data)], up.name || 'file', { type: up.type || '' });
const blank = (title, extra = {}) => { const now = Date.now(); return { id: rid('f'), title, created: now, updated: now, doc: '', diagrams: [dg('architecture', 'Diagram 1', '')], active: 0, view: 'canvas', ...extra }; };
const TEXTISH = /^(text\/|application\/(json|xml|javascript|x-sh|sql|yaml|x-yaml|toml))/;
const VIEW_ONLY = { image: /^image\//, pdf: /^application\/pdf$/, audio: /^audio\//, video: /^video\// };

export const TOOLS = [['course', 'Course'], ['doc', 'Doc'], ['sheet', 'Sheet'], ['canvas', 'Diagram'], ['code', 'Code'], ['flow', 'Workflow']];

// A blank file of a tool (a tool editor node with nothing to open).
export async function blankOf(view, title = 'Untitled') {
  if (view === 'course') { const { newCourse } = await import('./course.js'); return blank(title, { view: 'course', course: newCourse(title) }); }
  if (view === 'sheet') { const { newSheet } = await import('./sheet.js'); const sh = newSheet('Sheet 1'); return blank(title, { view: 'sheet', sheets: [sh], activeSheet: sh.id }); }
  if (view === 'code') { const f = { id: rid('cf'), path: 'index.js', text: '' }; return blank(title, { view: 'code', code: { files: [f], folders: [], open: [f.id], active: f.id } }); }
  if (view === 'flow') return blank(title, { view: 'flow', flow: { active: false, nodes: [], edges: [] } });
  return blank(title, { view: view === 'canvas' ? 'canvas' : 'doc' });
}

/* An uploaded file → { file (a Workline file), view, back(file) → upload, viewOnly? }. */
export async function fromUpload(up, want = 'auto') {
  if (!up || typeof up.data !== 'string') throw new Error('No file reached this step.');
  const name = up.name || 'file', x = ext(name), type = up.type || '', title = stem(name);
  const is = v => want === 'auto' || want === v;
  // Viewed only
  for (const [k, re] of Object.entries(VIEW_ONLY)) if (re.test(type) || (k === 'pdf' && x === 'pdf') || (k === 'image' && /^(png|jpe?g|gif|webp|svg|bmp)$/.test(x))) {
    return { view: 'viewer', viewOnly: k, file: null, src: `data:${type || (k === 'pdf' ? 'application/pdf' : 'application/octet-stream')};base64,${up.data}`, back: () => up };
  }
  // Course
  if ((is('course') && /^(story|zip)$/.test(x)) || /\.course\.json$/i.test(name) || (want === 'course' && /^(html?|json)$/.test(x))) {
    const { readCourse, courseFile } = await import('./course.js');
    const { imported, ...course } = await readCourse(toFileObj(up));
    return { view: 'course', file: blank(course.title || title, { view: 'course', course }), back: f => asUpload(`${stem(name)}.course.json`, 'application/json', courseFile(f.course)), note: imported ? 'Opened from Storyline. It goes on as a Workline course file (.course.json).' : '' };
  }
  // Sheet
  if (/^(xlsx|xlsm)$/.test(x)) {
    const { readXlsx, writeXlsx } = await import('./xlsx.js');
    const sheets = await readXlsx(b64ToBytes(up.data).buffer);
    if (!sheets.length) throw new Error('That workbook has no sheets.');
    return { view: 'sheet', file: blank(title, { view: 'sheet', sheets, activeSheet: sheets[0].id }), back: async f => { const blob = await writeXlsx(f.sheets); const buf = blob instanceof Blob ? await blob.arrayBuffer() : blob; return asUpload(`${stem(name)}.xlsx`, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', new Uint8Array(buf)); } };
  }
  if (/^(csv|tsv)$/.test(x) || type === 'text/csv') {
    const { newSheet, fromCSV, toCSV } = await import('./sheet.js');
    const text = new TextDecoder().decode(b64ToBytes(up.data));
    const sh = Object.assign(newSheet(title), fromCSV(text));
    return { view: 'sheet', file: blank(title, { view: 'sheet', sheets: [sh], activeSheet: sh.id }), back: f => { const s = f.sheets.find(q => q.id === f.activeSheet) || f.sheets[0]; let out = toCSV(s, false, f.sheets); if (x === 'tsv') out = out.split('\n').map(l => l.replace(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/g, '\t')).join('\n'); return asUpload(name, x === 'tsv' ? 'text/tab-separated-values' : 'text/csv', out); } };
  }
  // Doc
  if (x === 'docx') {
    const { fromDocx, hashOf } = await import('./word/docio.js');
    const { html } = await fromDocx(toFileObj(up));
    return { view: 'doc', file: blank(title, { view: 'doc', doc: '', docHtml: html, docSrc: hashOf('') }), back: f => asUpload(`${stem(name)}.md`, 'text/markdown', f.doc || ''), note: 'Opened from Word. It goes on as Markdown (.md); Export → Word in the Doc saves a .docx.' };
  }
  if (/^(md|markdown|txt|html?)$/.test(x) && is('doc')) {
    const text = new TextDecoder().decode(b64ToBytes(up.data));
    const html = /^html?$/.test(x);
    const { hashOf } = await import('./word/docio.js');
    return { view: 'doc', file: blank(title, { view: 'doc', doc: html ? '' : text, ...(html ? { docHtml: text, docSrc: hashOf('') } : {}) }), back: f => asUpload(x === 'txt' ? name : `${stem(name)}.md`, x === 'txt' ? 'text/plain' : 'text/markdown', f.doc || '') };
  }
  const text = TEXTISH.test(type) || !/[\x00-\x08\x0E-\x1F]/.test(new TextDecoder().decode(b64ToBytes(up.data).slice(0, 2000))) ? new TextDecoder().decode(b64ToBytes(up.data)) : null;
  if (text == null) throw new Error(`“${name}” isn’t a kind of file Workline can open (it can open courses, Word, Excel, CSV, Markdown, workflows, diagrams, code and text, and show pictures, PDFs, audio and video).`);
  // Workflow
  if (x === 'json' && (want === 'auto' || want === 'flow')) {
    try {
      const { importFlow, exportFlow } = await import('./flowio.js');
      const r = importFlow(text);
      return { view: 'flow', file: blank(r.name || title, { view: 'flow', flow: r.flow }), back: f => asUpload(name, 'application/json', exportFlow(f)) };
    } catch (e) { /* not a workflow: code */ }
  }
  // Diagram
  if (x === 'sql' && is('canvas')) {
    const { readSql } = await import('./sql.js');
    const r = readSql(text);
    if (r) return { view: 'canvas', file: blank(title, { diagrams: [dg('erd', 'Schema', r.code)] }), back: () => up, note: 'The schema is drawn from the SQL; the SQL file goes on as it was.' };
  }
  if (/^(mmd|mermaid|puml|d2|dot)$/.test(x) || want === 'canvas') {
    const kind = x === 'mmd' || x === 'mermaid' ? 'flowchart' : 'architecture';
    return { view: 'canvas', file: blank(title, { diagrams: [dg(kind, 'Diagram 1', text)] }), back: f => asUpload(name, type || 'text/plain', f.diagrams?.[0]?.code || '') };
  }
  // Code (anything else that's text)
  const cf = { id: rid('cf'), path: name, text };
  return { view: 'code', file: blank(title, { view: 'code', code: { files: [cf], folders: [], open: [cf.id], active: cf.id } }), back: f => { const g = (f.code?.files || []).find(q => q.id === cf.id) || f.code?.files?.[0]; return asUpload(g?.path?.split('/').pop() || name, type || 'text/plain', g?.text || ''); } };
}

/* A Workline file → the file the next steps get, in the kind its tool makes. */
export async function exportWorkline(f) {
  const t = stem(f.title || 'File');
  if (f.view === 'course' && f.course) { const { courseFile } = await import('./course.js'); return asUpload(`${t}.course.json`, 'application/json', courseFile(f.course)); }
  if (f.view === 'sheet' && f.sheets?.length) { const { writeXlsx } = await import('./xlsx.js'); const blob = await writeXlsx(f.sheets); const buf = blob instanceof Blob ? await blob.arrayBuffer() : blob; return asUpload(`${t}.xlsx`, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', new Uint8Array(buf)); }
  if (f.view === 'flow' && f.flow) { const { exportFlow } = await import('./flowio.js'); return asUpload(`${t}.workflow.json`, 'application/json', exportFlow(f)); }
  if (f.view === 'code' && f.code?.files?.length) { const g = f.code.files.find(q => q.id === f.code.active) || f.code.files[0]; return asUpload(g.path.split('/').pop(), 'text/plain', g.text || ''); }
  if (f.view === 'canvas' && f.diagrams?.length) return asUpload(`${t}.txt`, 'text/plain', f.diagrams.map(d => `# ${d.name}\n${d.code || ''}`).join('\n\n'));
  return asUpload(`${t}.md`, 'text/markdown', f.doc || '');
}
