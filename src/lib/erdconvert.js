import { isBox, isLink } from './shapes.js';

/* Hand-drawn shapes -> database schema (ERD) code, without AI.
   Each box (or sticky note) is a table: its first line is the table name, every other line a column,
   written "name type flags" or "name: type". Arrows and lines between those boxes become relationships:
     arrow A → B        A > B   (many A to one B: A holds the foreign key)
     arrow A ← B        A < B
     arrows both ends   A <> B
     plain line         A - B
   A label on the line becomes the relationship's label. */

const clean = s => s.trim().replace(/\s+/g, '_').replace(/[^\w-]/g, '').replace(/^[-_]+/, '') || '';

// `taken`: table names already in use, which new tables must avoid.
export function shapesToErd(shapes, all, taken = []) {
  const boxes = shapes.filter(s => (isBox(s) || s.t === 'sticky') && (s.text || '').trim());
  if (!boxes.length) return null;
  const name = new Map(), used = new Set(taken), out = [], pos = {};
  boxes.forEach(s => {
    const lines = s.text.split('\n').map(l => l.trim()).filter(Boolean);
    const base = clean(lines[0]) || 'table';
    let id = base, n = 2;
    while (used.has(id)) id = base + '_' + n++;
    used.add(id); name.set(s.id, id); pos[id] = { x: Math.round(s.x), y: Math.round(s.y) };
    out.push(`${id} {`);
    lines.slice(1).forEach(l => {
      const [col, ...rest] = l.replace(/^[-*•]\s*/, '').replace(/:/, ' ').split(/\s+/);
      const c = clean(col);
      if (c) out.push(`  ${c}${rest.length ? ' ' + rest.join(' ').replace(/[^\w(),. -]/g, '') : ''}`);
    });
    out.push('}');
  });
  // Lines between two converted boxes, whether or not they were selected themselves.
  const rels = (all || shapes).filter(s => isLink(s) && s.a0 && s.a1 && name.has(s.a0.s) && name.has(s.a1.s));
  if (rels.length) out.push('');
  rels.forEach(s => {
    const a = name.get(s.a0.s), b = name.get(s.a1.s), end = s.t === 'arrow', start = !!s.h0;
    const op = end && start ? '<>' : end ? '>' : start ? '<' : '-';
    const label = (s.text || '').trim().replace(/\s+/g, ' ');
    out.push(`${a} ${op} ${b}${label ? ' : ' + label : ''}`);
  });
  return { code: out.join('\n') + '\n', positions: pos, used: new Set([...boxes.map(s => s.id), ...rels.map(s => s.id)]) };
}

/* ---- hand-drawn shapes -> code for any diagram type ----
   Boxes (and sticky notes) with text become nodes: the first line is the label, a second line the
   sublabel. Diagram icons (server, database, user…) become nodes of that kind. Frames around nodes
   become groups. Arrows and lines between converted things become connections, keeping their labels.
   For sequence diagrams, boxes become participants (left to right) and arrows become messages (top to
   bottom); dashed arrows are replies. */

const ARCH_KINDS = ['user', 'client', 'mobile', 'api', 'lb', 'server', 'function', 'database', 'cache', 'queue', 'storage', 'cloud', 'external', 'service'];
const slugId = s => s.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30);
const center = s => ({ x: s.x + s.w / 2, y: s.y + s.h / 2 });
const inside = (p, f) => p.x >= f.x && p.x <= f.x + f.w && p.y >= f.y && p.y <= f.y + f.h;
const labelSafe = s => s.replace(/[[\]|]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 40);

function kindFor(type, s) {
  if (s.t === 'icon') return ARCH_KINDS.includes(s.v) ? s.v : '';
  if (type === 'flowchart') return s.t === 'diamond' ? 'decision' : s.t === 'para' ? 'io' : s.t === 'ellipse' || s.t === 'pill' ? 'start' : 'step';
  return s.t === 'cylinder' ? 'database' : s.t === 'doc' ? 'storage' : s.t === 'hexagon' ? 'service' : '';
}

// Returns {code, positions, used} or null when nothing in the selection can become a node.
export function shapesToCode(type, shapes, all, taken = []) {
  if (type === 'erd') return shapesToErd(shapes, all, taken);
  const nodes = shapes.filter(s => ((isBox(s) || s.t === 'sticky') && (s.text || '').trim()) || (s.t === 'icon' && !s.v.includes(':')));
  if (!nodes.length) return null;
  const id = new Map(), used = new Set(taken), info = [];
  nodes.forEach(s => {
    const lines = (s.text || '').split('\n').map(l => l.trim()).filter(Boolean);
    const label = labelSafe(lines[0] || (s.t === 'icon' ? s.v[0].toUpperCase() + s.v.slice(1) : 'Node'));
    const base = slugId(label) || 'node';
    let k = base, n = 2;
    while (used.has(k)) k = base + '-' + n++;
    used.add(k); id.set(s.id, k);
    info.push({ s, id: k, label, sub: labelSafe(lines.slice(1).join(' ')), kind: kindFor(type, s) });
  });
  // Connections between converted shapes (selected or not).
  const links = (all || shapes).filter(s => isLink(s) && s.a0 && s.a1 && id.has(s.a0.s) && id.has(s.a1.s));
  const label = s => { const t = (s.text || '').trim().replace(/\s+/g, ' '); return t ? ' : ' + t.slice(0, 40) : ''; };
  const out = [], pos = {};

  if (type === 'sequence') {
    // Participants left to right; messages top to bottom. Arrows that aren't attached use the nearest participant.
    const parts = [...info].sort((a, b) => center(a.s).x - center(b.s).x);
    parts.forEach(p => out.push(`${p.id} [${p.label}]${p.kind ? ' ' + p.kind : ''}`));
    const nearest = x => parts.reduce((best, p) => (Math.abs(center(p.s).x - x) < Math.abs(center(best.s).x - x) ? p : best)).id;
    const msgs = (all || shapes).filter(s => isLink(s)).map(s => {
      const a = s.a0 && id.has(s.a0.s) ? id.get(s.a0.s) : nearest(s.pts[0][0]);
      const b = s.a1 && id.has(s.a1.s) ? id.get(s.a1.s) : nearest(s.pts[s.pts.length - 1][0]);
      const [from, to] = s.t !== 'arrow' && s.h0 ? [b, a] : [a, b];
      return { y: (s.pts[0][1] + s.pts[s.pts.length - 1][1]) / 2, line: `${from} ${s.dash ? '-->' : '>'} ${to}${label(s)}`, sel: shapes.includes(s), id: s.id };
    }).filter(m => m.sel || links.some(l => l.id === m.id)).sort((a, b) => a.y - b.y);
    if (msgs.length) out.push('', ...msgs.map(m => m.line));
    return { code: out.join('\n') + '\n', positions: null, used: new Set([...nodes.map(s => s.id), ...msgs.map(m => m.id)]) };
  }

  // Architecture and flowchart: frames around nodes become groups.
  const frames = (all || shapes).filter(s => s.t === 'frame' && shapes.includes(s));
  const groupOf = new Map();
  frames.forEach(f => info.forEach(n => { if (!groupOf.has(n.id) && inside(center(n.s), f)) groupOf.set(n.id, f); }));
  const nodeLine = n => `${n.id} [${n.label}${n.sub ? ' | ' + n.sub : ''}]${n.kind ? ' ' + n.kind : ''}`;
  frames.forEach(f => {
    const members = info.filter(n => groupOf.get(n.id) === f);
    if (!members.length) return;
    let g = slugId(f.text || 'group') || 'group', n = 2;
    while (used.has(g)) g = slugId(f.text || 'group') + '-' + n++;
    used.add(g);
    out.push(`group ${g} "${labelSafe(f.text || 'Group').replace(/"/g, '')}" {`, ...members.map(m => '  ' + nodeLine(m)), '}');
  });
  info.filter(n => !groupOf.has(n.id)).forEach(n => out.push(nodeLine(n)));
  info.forEach(n => { pos[n.id] = { x: Math.round(n.s.x), y: Math.round(n.s.y) }; });
  if (links.length) out.push('');
  links.forEach(s => {
    const a = id.get(s.a0.s), b = id.get(s.a1.s), end = s.t === 'arrow', start = !!s.h0;
    out.push(end && start ? `${a} <> ${b}${label(s)}` : end ? `${a} > ${b}${label(s)}` : start ? `${b} > ${a}${label(s)}` : `${a} -- ${b}${label(s)}`);
  });
  return { code: out.join('\n') + '\n', positions: pos, used: new Set([...nodes.map(s => s.id), ...links.map(s => s.id), ...frames.filter(f => info.some(n => groupOf.get(n.id) === f)).map(f => f.id)]) };
}
