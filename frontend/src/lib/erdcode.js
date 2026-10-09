/* Reading and rewriting database schema (ERD) code, so the canvas toolbars can change it.
   A table line looks like:  users [icon: user, color: blue] {
   The square brackets hold either a plain display label ("[User accounts]") or key: value pairs
   (label, icon, color). */

const TABLE = /^(\s*)([\w-]+)\s*(?:\[([^\]]*)\])?\s*\{\s*(#.*)?$/;

// "[icon: user, color: blue]" -> {icon:'user', color:'blue'}; "[User accounts]" -> {label:'User accounts'}
export function parseAttrs(raw) {
  const s = (raw || '').trim();
  if (!s) return {};
  if (!/^[\w-]+\s*:/.test(s)) return { label: s };
  const out = {};
  s.split(',').forEach(part => {
    const m = part.match(/^\s*([\w-]+)\s*:\s*(.*?)\s*$/);
    if (m) out[m[1].toLowerCase()] = m[2].replace(/^["']|["']$/g, '');
  });
  return out;
}

function formatAttrs(a) {
  const keys = Object.keys(a).filter(k => a[k] != null && a[k] !== '');
  if (!keys.length) return '';
  if (keys.length === 1 && keys[0] === 'label') return ` [${a.label}]`;
  return ' [' + keys.map(k => `${k}: ${/[,\]]/.test(a[k]) ? `"${a[k]}"` : a[k]}`).join(', ') + ']';
}

// Set (or with value null, remove) one attribute on a table's declaration line.
export function setTableAttr(code, id, key, value) {
  let inside = false;
  return code.split('\n').map(line => {
    if (inside) { if (line.trim() === '}') inside = false; return line; }
    const m = line.match(TABLE);
    if (!m) return line;
    inside = true;
    if (m[2] !== id) return line;
    const a = parseAttrs(m[3]);
    if (value == null || value === '') delete a[key]; else a[key] = value;
    return `${m[1]}${id}${formatAttrs(a)} {${m[4] ? ' ' + m[4] : ''}`;
  }).join('\n');
}

// Rename a table: its declaration and every relationship that mentions it. Columns are left alone.
export function renameTable(code, from, to) {
  const word = new RegExp(`(^|[\\s<>-])${from.replace(/[-]/g, '\\-')}(?=$|[\\s.<>:-])`, 'g');
  let inside = false;
  return code.split('\n').map(line => {
    const t = line.trim();
    if (inside) { if (t === '}') inside = false; return line; }
    const m = line.match(TABLE);
    if (m) { inside = true; return m[2] === from ? line.replace(m[2], to) : line; }
    if (!t || t.startsWith('#') || /^(title|notation)\b/i.test(t)) return line;
    return line.replace(word, (all, pre) => pre + to);
  }).join('\n');
}

export const NOTATIONS = [['crows-foot', "Crow's foot"], ['chen', 'Chen (1 and *)']];
export const notationOf = code => {
  const m = /^\s*notation\s+([\w-]+)/im.exec(code || '');
  return m && /^chen$/i.test(m[1]) ? 'chen' : 'crows-foot';
};
// Write the notation line (dropped when it's the default).
export function setNotation(code, v) {
  const rest = code.split('\n').filter(l => !/^\s*notation\b/i.test(l));
  if (v === 'chen') {
    const i = rest.findIndex(l => /^\s*title\s*:/i.test(l));
    rest.splice(i + 1, 0, 'notation chen');
  }
  return rest.join('\n');
}

// Remove a table and every relationship that mentions it.
export function deleteTable(code, id) {
  const word = new RegExp(`(^|[\\s<>-])${id.replace(/[-]/g, '\\-')}(?=$|[\\s.<>:-])`);
  let skip = false;
  return code.split('\n').filter(line => {
    if (skip) { if (line.trim() === '}') skip = false; return false; }
    const m = line.match(TABLE);
    if (m) { if (m[2] === id) { skip = true; return false; } return true; }
    const t = line.trim();
    if (!t || t.startsWith('#') || /^(title|notation)\b/i.test(t) || t === '}') return true;
    return !/(<>|>|<|\s-\s)/.test(t) || !word.test(line);
  }).join('\n');
}

/* ---- single columns ---- */
const FLAG = /^(pk|fk|unique|pk,fk|fk,pk)$/i;

// Line numbers of a table's columns: [{i, name}], plus where its closing brace is.
function columnsOf(lines, table) {
  let inside = false, out = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!inside) {
      const m = line.match(TABLE);
      if (m) { inside = true; if (m[2] === table) out = { cols: [], end: -1, indent: '  ' }; }
      continue;
    }
    if (line.trim() === '}') { inside = false; if (out && out.end < 0) { out.end = i; return out; } continue; }
    if (out) {
      const c = line.match(/^(\s*)([\w-]+)/);
      if (c) { out.cols.push({ i, name: c[2] }); out.indent = c[1] || '  '; }
    }
  }
  return out;
}

// A column's parts as written: name, type, metadata (everything after the type, e.g. "pk", "unique not null").
export function getColumn(code, table, name) {
  const lines = code.split('\n'), t = columnsOf(lines, table);
  const c = t && t.cols.find(x => x.name === name);
  if (!c) return null;
  const body = lines[c.i].replace(/(^|\s)#.*$/, '').trim().split(/\s+/);
  const typed = body[1] && !FLAG.test(body[1]);
  return { name: body[0], type: typed ? body[1] : '', meta: body.slice(typed ? 2 : 1).join(' ') };
}

// Rewrite a column. A new name also updates relationships that point at table.column.
export function setColumn(code, table, name, { name: to = name, type = '', meta = '' }) {
  const lines = code.split('\n'), t = columnsOf(lines, table);
  const c = t && t.cols.find(x => x.name === name);
  if (!c) return code;
  const comment = (lines[c.i].match(/\s#.*$/) || [''])[0];
  lines[c.i] = t.indent + [to, type.replace(/\s+/g, ''), meta.trim().replace(/\s+/g, ' ')].filter(Boolean).join(' ') + comment;
  let out = lines.join('\n');
  if (to !== name) out = renameRef(out, table, name, to);
  return out;
}
function renameRef(code, table, from, to) {
  const re = new RegExp(`(^|[\\s<>-])${table}\\.${from}(?=$|[\\s<>:-])`, 'g');
  let inside = false;
  return code.split('\n').map(line => {
    if (inside) { if (line.trim() === '}') inside = false; return line; }
    if (TABLE.test(line)) { inside = true; return line; }
    return line.replace(re, (all, pre) => `${pre}${table}.${to}`);
  }).join('\n');
}

// Add a column after `after` (or at the end); returns {code, name}.
export function addColumn(code, table, after) {
  const lines = code.split('\n'), t = columnsOf(lines, table);
  if (!t) return { code, name: null };
  let name = 'column', n = 2;
  while (t.cols.some(x => x.name === name)) name = 'column_' + n++;
  const at = after ? (t.cols.find(x => x.name === after) || {}).i : undefined;
  lines.splice(at != null ? at + 1 : t.end, 0, t.indent + name + ' string');
  return { code: lines.join('\n'), name };
}

// Remove a column. Relationships that pointed at it stay, attached to the table instead.
export function deleteColumn(code, table, name) {
  const lines = code.split('\n'), t = columnsOf(lines, table);
  const c = t && t.cols.find(x => x.name === name);
  if (!c) return code;
  lines.splice(c.i, 1);
  const re = new RegExp(`(^|[\\s<>-])${table}\\.${name}(?=$|[\\s<>:-])`, 'g');
  let inside = false;
  return lines.map(line => {
    if (inside) { if (line.trim() === '}') inside = false; return line; }
    if (TABLE.test(line)) { inside = true; return line; }
    return line.replace(re, (all, pre) => pre + table);
  }).join('\n');
}

// Move a column up (-1) or down (+1) within its table.
export function moveColumn(code, table, name, dir) {
  const lines = code.split('\n'), t = columnsOf(lines, table);
  const k = t ? t.cols.findIndex(x => x.name === name) : -1, j = k + dir;
  if (k < 0 || j < 0 || j >= t.cols.length) return code;
  const a = t.cols[k].i, b = t.cols[j].i;
  [lines[a], lines[b]] = [lines[b], lines[a]];
  return lines.join('\n');
}
