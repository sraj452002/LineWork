import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { C, TEMPLATES, TYPES, engineOf, prep, tableHue, tableIcon } from '../lib/engines.js';
import { addColumn, deleteColumn, deleteTable, getColumn, moveColumn, notationOf, renameTable, setColumn, setNotation, setTableAttr } from '../lib/erdcode.js';
import { highlight } from '../lib/highlight.js';
import { LANG, NO_AI, copyFor, downloads, langFor, sampleP } from '../lib/ai.js';
import { DIALECTS, erdToSql, readSql } from '../lib/sql.js';
import { shapesToCode } from '../lib/erdconvert.js';
import { HELP } from '../lib/help.js';
import { imageKeys, loadImages, saveImage, useImages } from '../lib/images.js';
import { isPackIcon, loadIconPacks, useIconPacks } from '../lib/iconpacks.js';
import { esc, rid, slug, trunc } from '../lib/utils.js';
import { colName, newSheet, usedRange } from '../lib/sheet.js';
import {
  DEVICES, KEEP_RATIO, SHAPE_LIST, bbox, contains, drawn, dropDeadLinks, editBox, handlesMarkup,
  brandColor, hasText, icons, isBox, shapesDoc, isLink, make, marqueeMarkup, measure, moved, outlinesMarkup, overlaps, resized, resolveLinks, selKey,
  shapeAt, shapeBounds, shapeIcon, shapesMarkup, targetMarkup, unionBox, groupMarkup, textSize,
} from '../lib/shapes.js';
import { IC, Ico, InsertPanel, TOOL_KEYS, Toolbar } from './Toolbar.jsx';
import AIChat, { KINDS } from './AIChat.jsx';
import SelBar from './SelBar.jsx';
import { DiagramBar, FieldBar, TableBar } from './DiagramBars.jsx';
import { useUI } from './ui.jsx';

const NO_SHAPES = [];
// Code editor header: [title, subtitle, icon] per diagram type.
const CODE_TITLE = {
  architecture: ['Cloud Architecture', 'Visualize your infrastructure', 'dCloud'],
  flowchart: ['Flow Chart', 'Visualize process and logic flows', 'dFlow'],
  sequence: ['Sequence', 'Visualize system flow and interactions', 'dSeq'],
  erd: ['Entity Relationship', 'Visualize data models', 'dErd'],
};
// Connection symbols the code editor's footer can insert.
const CHEATS = {
  erd: [['>', 'many-to-one'], ['<', 'one-to-many'], ['-', 'one-to-one'], ['<>', 'many-to-many']],
  architecture: [['>', 'arrow'], ['<>', 'two-way'], ['--', 'line']],
  flowchart: [['>', 'arrow'], ['<>', 'two-way'], ['--', 'line']],
  sequence: [['>', 'message'], ['-->', 'reply']],
};
const HELP_HINT = {
  erd: 'users [icon: user, color: blue] {\n  id string pk\n}',
  architecture: 'web [Storefront] client\napi [Orders API] server\nweb > api : HTTPS',
  flowchart: 'start [Begin] start\ncheck [OK?] decision\nstart > check',
  sequence: 'shop [Shopper] user\napi [API] api\nshop > api : Place order',
};
const DEVICE_ICON = { phone: '<rect x="7" y="2.5" width="10" height="19" rx="2"/><path d="M11 5.5h2"/>', tablet: '<rect x="4.5" y="2.5" width="15" height="19" rx="2"/><path d="M12 4.5h.01"/>', browser: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 8.5h18M6 6.3h.01M8.5 6.3h.01"/>', desktop: '<rect x="3" y="3.5" width="18" height="13" rx="1.5"/><path d="M9 20.5h6M12 16.5v4"/>' };

const nodeIds = (d, m) => new Set(d.type === 'erd' ? m.tables.keys() : d.type === 'sequence' ? [] : m.nodes.keys());
const pruneManual = x => {
  const keep = nodeIds(x, engineOf(x).parse(x.code || ''));
  Object.keys(x.manual || {}).forEach(id => { if (!keep.has(id)) delete x.manual[id]; });
};
// One undo entry holds the diagram code and the hand-drawn objects together.
const snap = (code, shapes) => JSON.stringify({ code, shapes: shapes || [] });
const NODE = 'n:'; // selection keys: a shape id, or NODE + a diagram node id
const reducedMotion = () => typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
const sameRect = (a, b) => (!a && !b) || (a && b && a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h);

// Shown while a drawing tool is active.
const HINTS = {
  hand: 'Drag to move around the canvas',
  rect: 'Drag to draw a rectangle, or click to drop one · Shift keeps it square',
  ellipse: 'Drag to draw an ellipse, or click to drop one · Shift keeps it round',
  arrow: 'Drag from one box to another to connect them · Shift snaps to 45°',
  line: 'Drag to draw a line · start or end on a box to attach it',
  pen: 'Drag to draw freehand · press V when you’re done',
  text: 'Click where the text should go',
  frame: 'Drag to draw a frame around a group of things',
  comment: 'Click to leave a comment',
};
// Entries in Insert → Diagram as Code. BPMN is a flowchart whose groups draw as swimlanes.
const CODE_KINDS = [
  { key: 'flowchart', type: 'flowchart', icon: 'dFlow', label: 'Flow Chart', note: 'Visualize process and logic flows' },
  { key: 'architecture', type: 'architecture', icon: 'dCloud', label: 'Cloud Architecture', note: 'Visualize your infrastructure' },
  { key: 'bpmn', type: 'flowchart', icon: 'dBpmn', label: 'BPMN', note: 'Visualize business processes with swimlanes', starter: `title: Purchase approval
group requester "Employee" {
  ask [Submit request] start
  fix [Revise request] step
}
group manager "Manager" {
  review [Within budget?] decision
}
group finance "Finance" {
  pay [Place order] step
  done [Order placed] end
}

ask > review
review > pay : yes
review > fix : no
fix > review
pay > done` },
  { key: 'erd', type: 'erd', icon: 'dErd', label: 'Entity Relationship', note: 'Visualize data models' },
  { key: 'sequence', type: 'sequence', icon: 'dSeq', label: 'Sequence', note: 'Visualize system flow and interactions' },
];

// Styles copied with Ctrl Alt C, kept across diagrams until the page reloads.
let styleClip = null;
const kindOf = s => (isLink(s) ? 'link' : isBox(s) ? 'box' : s.t);
const STYLE_KEYS = { link: ['c', 'sw', 'dash', 'route', 'h0', 'anim'], box: ['c', 'sc', 'sw', 'dash', 'fm', 'fx'], text: ['c', 'bold'] };

const SHORTCUTS = [
  ['Tools', [['V', 'Select'], ['H', 'Hand'], ['R', 'Rectangle'], ['O', 'Ellipse'], ['A', 'Arrow'], ['L', 'Line'], ['D', 'Draw'], ['T', 'Text'], ['I', 'Icon'], ['F', 'Frame'], ['C', 'Comment']]],
  ['Canvas', [['/', 'Insert menu'], ['Ctrl J', 'Ask AI'], ['Space + drag', 'Pan'], ['+  −', 'Zoom in / out'], ['Shift 1', 'Zoom to fit'], ['Shift 0', 'Zoom to 100%'], ['Ctrl Z', 'Undo'], ['Ctrl Y', 'Redo']]],
  ['Selection', [['Shift + drag', 'Select an area'], ['Shift + click', 'Add or remove'], ['Ctrl A', 'Select all'], ['Ctrl D', 'Duplicate'], ['Ctrl G', 'Group'], ['Ctrl Shift G', 'Ungroup'], ['Delete', 'Delete'], ['Enter', 'Edit text'], ['Arrow keys', 'Nudge (Shift: 10px)'], ['Esc', 'Deselect / cancel']]],
  ['Arrange and copy', [['[  ]', 'Send to back / bring to front'], ['Ctrl [  ]', 'Send backward / bring forward'], ['Shift F', 'Wrap in a figure'], ['Shift Alt C', 'Copy as PNG'], ['Ctrl Alt C', 'Copy styles'], ['Ctrl Alt V', 'Paste styles']]],
  ['Table columns', [['Click a row', 'Select a column'], ['↑  ↓', 'Previous / next column'], ['Alt ↑  ↓', 'Move the column'], ['Enter', 'Rename the column'], ['Delete', 'Delete the column'], ['Esc', 'Back to the whole table']]],
];

// One canvas per diagram. The parent keys it by diagram id, so switching tabs starts fresh.
export const AI_W = 380; // width of the AI chat panel on wide screens

export default function Canvas({ file, d, visible, updateDiagram, updateFile, history, onAddDiagram, onGuide, aiOpen, onAIOpen, onOpenSheet, placeSheet, onPlaced }) {
  const { toast, theme, popup } = useUI();
  const svgRef = useRef(null), stageRef = useRef(null), fileRef = useRef(null);
  const dRef = useRef(d);
  dRef.current = d;

  const [view, setView] = useState({ x: 0, y: 0, k: 1 });
  const viewRef = useRef(view);
  viewRef.current = view;
  const [dragManual, setDragManual] = useState(null);
  const [drawer, setDrawer] = useState(false);
  const [codeHelp, setCodeHelp] = useState(false);
  const [diagSel, setDiagSel] = useState(false);
  const [selField, setSelField] = useState(null); // {t, f}: one column of a selected table // the whole diagram is selected (its header was clicked)
  const codeRef = useRef(null), hlRef = useRef(null), gutRef = useRef(null);
  const [aiFocus, setAiFocus] = useState(0);
  const [aiOff, setAiOff] = useState('');
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const [fitReq, setFitReq] = useState(1);
  const ctl = useRef(null);

  // Hand-drawn objects. `live` previews a draw, move or resize until the pointer is released.
  const [tool, setTool] = useState('select');
  const [live, setLive] = useState(null);
  const [selection, setSelection] = useState([]);
  const [marquee, setMarquee] = useState(null);
  const [target, setTarget] = useState(null); // box an arrow end will attach to, while dragging
  const [space, setSpace] = useState(false); // Space held: drag pans
  const spaceRef = useRef(false);
  const [editing, setEditing] = useState(null);
  const [draft, setDraft] = useState('');
  const [panel, setPanel] = useState(null); // null when closed, '' for all categories, or a category key
  const [showKeys, setShowKeys] = useState(false);
  const imgV = useImages(d.shapes);
  const packs = useIconPacks(panel != null || (d.shapes || []).some(s => s.t === 'icon' && isPackIcon(s.v)) || (d.type === 'erd' && /\bicon\s*:/.test(d.code)));

  // History lives in the parent so it survives tab switches.
  if (!history.has(d.id)) history.set(d.id, { stack: [snap(d.code, d.shapes)], i: 0 });
  const hist = history.get(d.id);
  const [, bump] = useState(0);

  const ctx = useMemo(() => prep(dragManual ? { ...d, manual: { ...(d.manual || {}), ...dragManual } } : d),
    [d, dragManual, theme]);
  const ids = useMemo(() => nodeIds(d, ctx.m), [d, ctx]);
  const E = ctx.E;
  const nodeRect = useCallback(id => (ctx.E.rect ? ctx.E.rect(ctx, id) : null), [ctx]);
  // Shapes as drawn: attached arrow ends placed on whatever they point at.
  const rawShapes = live || d.shapes || NO_SHAPES;
  const shapes = useMemo(() => resolveLinks(rawShapes, nodeRect), [rawShapes, nodeRect]);
  const baseShapes = () => resolveLinks(dRef.current.shapes || [], nodeRect);

  const selSet = useMemo(() => new Set(selection), [selection]);
  const selShapes = shapes.filter(s => selSet.has(s.id));
  const selNodes = selection.filter(k => k.startsWith(NODE)).map(k => k.slice(NODE.length)).filter(id => ids.has(id));
  const selS = selection.length === 1 && selShapes.length === 1 ? selShapes[0] : null;
  const sel = selection.length === 1 && selNodes.length === 1 ? selNodes[0] : null;
  const editS = editing ? shapes.find(s => s.id === editing) || null : null;
  // Groups: shapes that share a `gid` select and move together. groupOf gives every key in key's group.
  const groupOf = key => {
    const s = shapes.find(x => x.id === key);
    return s && s.gid ? shapes.filter(x => x.gid === s.gid).map(x => x.id) : [key];
  };
  const withGroups = keys => [...new Set(keys.flatMap(groupOf))];
  useEffect(() => { if (selection.length) setDiagSel(false); }, [selection]);
  // The code editor and AI chat share the right-hand side, so opening one closes the other.
  useEffect(() => { if (drawer && aiOpen) onAIOpen(false); }, [drawer]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (aiOpen && drawer) setDrawer(false); }, [aiOpen]); // eslint-disable-line react-hooks/exhaustive-deps
  const diagBox = ctx.m.count ? ctx.E.bounds(ctx) : null;

  // A selected column only counts while its table is the selection and the column still exists.
  const field = selField && sel === selField.t && ctx.m.tables && ctx.m.tables.get(sel)?.fields.some(x => x.name === selField.f) ? selField : null;
  const markup = useMemo(() => ctx.E.markup(ctx, sel, field), [ctx, sel, packs, field && field.t, field && field.f]); // eslint-disable-line react-hooks/exhaustive-deps
  const layers = useMemo(() => shapesMarkup(shapes, { editing }), [shapes, editing, theme, imgV, packs, file.sheets]); // eslint-disable-line react-hooks/exhaustive-deps
  const overlay = (() => {
    if (editing) return '';
    const k = view.k;
    let m = selS ? handlesMarkup(selS, k)
      : selection.length > 1 ? outlinesMarkup([...selShapes.filter(s => !s.gid).map(bbox), ...selNodes.map(nodeRect).filter(Boolean)], k) : ''; // groups get one box, below
    // A light frame around the diagram, highlighted while the diagram is selected.
    // A box around each group with a selected member.
    const gids = [...new Set(selShapes.map(s => s.gid).filter(Boolean))];
    if (gids.length) m = groupMarkup(gids.map(g => shapes.filter(s => s.gid === g).map(bbox).reduce((u, r) => unionBox(u, r), null)), k) + m;
    if (diagBox) m = `<rect x="${diagBox.x - 14}" y="${diagBox.y - 14}" width="${diagBox.w + 28}" height="${diagBox.h + 28}" rx="${10 / k}" fill="none" stroke="${diagSel ? C.hi : C.line}" stroke-width="${(diagSel ? 2.5 : 1.2) / k}" pointer-events="none"/>` + m;
    if (marquee) m += marqueeMarkup(marquee, k);
    if (target) m += targetMarkup(target, k);
    return m;
  })();

  /* ---- code + history ---- */
  function pushHist(entry) {
    if (hist.stack[hist.i] === entry) return;
    hist.stack = hist.stack.slice(0, hist.i + 1);
    hist.stack.push(entry);
    if (hist.stack.length > 80) hist.stack.shift();
    hist.i = hist.stack.length - 1;
    bump(n => n + 1);
  }
  const setCode = useCallback((code, { commit = true, fit = false } = {}) => {
    updateDiagram(x => { x.code = code; pruneManual(x); });
    if (commit) pushHist(snap(code, dRef.current.shapes));
    if (fit) setFitReq(n => n + 1);
  }, [updateDiagram]); // eslint-disable-line react-hooks/exhaustive-deps

  // Save shapes; record = false skips the undo entry (used while a new text box is still empty).
  const putShapes = (next, record = true) => {
    // o0/o1 are drawing hints that resolveLinks adds to elbow lines; don't save them.
    next = dropDeadLinks(next).map(s => ('o0' in s || 'o1' in s ? (({ o0, o1, ...rest }) => rest)(s) : s));
    // A group needs two or more members; drop the gid from any left on its own.
    const members = {};
    next.forEach(s => { if (s.gid) members[s.gid] = (members[s.gid] || 0) + 1; });
    next = next.map(s => (s.gid && members[s.gid] < 2 ? (({ gid, ...rest }) => rest)(s) : s));
    // Update the ref now so a second change in the same event builds on this one.
    dRef.current = { ...dRef.current, shapes: next };
    updateDiagram(x => { x.shapes = next; });
    if (record) pushHist(snap(dRef.current.code, next));
  };
  const restore = entry => {
    const o = JSON.parse(entry);
    updateDiagram(x => { x.code = o.code; x.shapes = o.shapes; pruneManual(x); });
    setEditing(null);
  };
  const undo = () => { if (hist.i > 0) { hist.i--; restore(hist.stack[hist.i]); bump(n => n + 1); } };
  const redo = () => { if (hist.i < hist.stack.length - 1) { hist.i++; restore(hist.stack[hist.i]); bump(n => n + 1); } };

  const editT = useRef(0);
  const onCodeInput = v => {
    setCode(v, { commit: false });
    clearTimeout(editT.current);
    editT.current = setTimeout(() => pushHist(snap(v, dRef.current.shapes)), 700);
  };

  /* ---- to and from database schemas ---- */
  // Put schema code somewhere sensible: into this diagram if it has no code yet, otherwise a new tab.
  const placeSchema = (code, name, positions) => {
    if (!dRef.current.code.trim()) {
      updateDiagram(x => { x.type = 'erd'; x.manual = { ...(positions || {}) }; });
      setCode(code, { fit: true });
      return 'here';
    }
    onAddDiagram('erd', name, code, positions ? { manual: positions } : undefined);
    return 'tab';
  };
  // Drawings that can become code: boxes and sticky notes with text, and diagram icons.
  const drawn = shapes.filter(x => ((isBox(x) || x.t === 'sticky') && (x.text || '').trim()) || (x.t === 'icon' && !String(x.v).includes(':')));
  // Turn drawings into diagram code. With code already there, they're added to it (in this diagram's type);
  // otherwise this diagram becomes `type`. newTab puts them in a new diagram instead.
  const convertDrawing = (type, list, newTab) => {
    const hasCode = !!dRef.current.code.trim(), merge = hasCode && !newTab;
    const target = merge ? d.type : type;
    const r = shapesToCode(target, list, shapes, merge ? [...ids] : []);
    if (!r) { toast('Select boxes with text, or diagram icons, first. Their first line becomes the name.'); return; }
    if (newTab) {
      onAddDiagram(target, TYPES[target].name, r.code, r.positions ? { manual: r.positions } : undefined);
      toast(`Added a new ${TYPES[target].name.toLowerCase()} diagram`);
      return;
    }
    putShapes(baseShapes().filter(x => !r.used.has(x.id)));
    updateDiagram(x => {
      if (!hasCode) { x.type = target; x.manual = {}; if (target === 'flowchart') x.dir = 'TB'; }
      if (r.positions) x.manual = { ...(x.manual || {}), ...r.positions };
    });
    setCode(hasCode ? dRef.current.code.replace(/\s*$/, '\n\n') + r.code : r.code, { fit: true });
    setSelection([]);
    toast(hasCode ? 'Added to the diagram code' : 'Converted to code');
  };
  const exportSql = (dialect, copy) => {
    const sql = erdToSql(dRef.current.code, dialect);
    if (copy) navigator.clipboard.writeText(sql).then(() => toast('SQL copied'), () => toast('Copy isn’t allowed here.'));
    else downloads.save({ filename: slug(file.title) + '-' + slug(d.name) + (dialect === 'mysql' ? '.mysql' : '') + '.sql', data: sql });
  };
  const sqlFileRef = useRef(null);
  // SQL (pasted, or a .sql file: a schema, a migration or a whole database dump) becomes a database schema diagram:
  // here when this diagram is empty, else in a new tab.
  const importSqlText = (text, from) => {
    const r = readSql(text || '');
    if (!r) { toast(from ? `No CREATE TABLE statements in ${from}.` : 'No CREATE TABLE statements found.'); return; }
    const name = from ? from.replace(/\.\w+$/, '').slice(0, 40) : 'Imported schema';
    const where = placeSchema(r.code, name);
    toast(`Imported ${r.tables} table${r.tables === 1 ? '' : 's'} and ${r.rels} relationship${r.rels === 1 ? '' : 's'}${from ? ' from ' + from : ''}${where === 'tab' ? ' into a new tab' : ''}`);
  };
  const importSqlFile = f => {
    if (!f) return;
    if (f.size > 50e6) { toast('That file is too big (over 50 MB). Export just the schema, e.g. pg_dump --schema-only.'); return; }
    f.text().then(t => importSqlText(t, f.name), () => toast('That file couldn’t be read.'));
  };
  const importSql = async () => {
    const v = await ask({ title: 'Import SQL', text: 'Paste CREATE TABLE statements, a migration or a database dump (PostgreSQL, MySQL, SQLite, SQL Server). Tables, columns, types, primary keys, unique columns and foreign keys come across.', multiline: true, ok: 'Import' });
    if (v && v.trim()) importSqlText(v);
  };
  const openSqlFile = () => sqlFileRef.current?.click();
  // A schema drawn from a live database (the Database view) can be read again from it.
  const refreshLive = async () => {
    const { dbRequest, hasSecret, loadConnections, schemaToErd } = await import('../lib/dbclient.js');
    const c = loadConnections().find(x => x.id === d.live.conn);
    if (!c) { toast('That connection isn’t saved in this browser. Add it in the Database view.'); return; }
    if (!hasSecret(c)) { toast('Open the Database view and enter the password first.'); return; }
    try {
      const { tables } = await dbRequest(c, 'schema');
      setCode(schemaToErd(tables, { schemas: d.live.schemas }));
      toast(`Updated from ${c.name || 'the database'}: ${tables.length} tables`);
    } catch (e) { toast(e.message); }
  };
  const sqlMenu = [
    ...DIALECTS.map(([k, n]) => ({ label: `Download SQL (${n})`, icon: IC.download, act: () => exportSql(k) })),
    ...DIALECTS.map(([k, n]) => ({ label: `Copy SQL (${n})`, icon: IC.copy, act: () => exportSql(k, true) })),
  ];
  // Ask AI for the schema behind another kind of diagram.
  const diagramToErd = () => {
    focusAI();
    send(`Design the database schema that would store the data for the "${d.name}" ${TYPES[d.type].name.toLowerCase()} diagram: one table per stored entity, with realistic columns, keys and a relationship line for every foreign key.`, { kind: 'erd' });
  };

  /* ---- schema edits from the table and diagram toolbars ---- */
  const tableAttr = (id, key, value) => setCode(setTableAttr(dRef.current.code, id, key, value));
  const renameNode = (from, to) => {
    if (!/^[\w-]+$/.test(to)) { toast('Table names can use letters, numbers, - and _ (no spaces).'); return; }
    if (ctx.m.tables && ctx.m.tables.has(to)) { toast(`There’s already a table called “${to}”.`); return; }
    updateDiagram(x => { if (x.manual && x.manual[from]) { x.manual[to] = x.manual[from]; delete x.manual[from]; } });
    setCode(renameTable(dRef.current.code, from, to));
    setSelection([NODE + to]);
  };
  const columnSet = parts => {
    const { t, f } = field;
    if (parts.name !== f) {
      if (!/^[\w-]+$/.test(parts.name)) { toast('Column names can use letters, numbers, - and _ (no spaces).'); return; }
      if (ctx.m.tables.get(t).fields.some(x => x.name === parts.name)) { toast(`“${t}” already has a column called “${parts.name}”.`); return; }
    }
    setCode(setColumn(dRef.current.code, t, f, parts));
    setSelField({ t, f: parts.name });
  };
  const columnAdd = () => {
    const r = addColumn(dRef.current.code, field ? field.t : sel, field && field.f);
    if (!r.name) return;
    setCode(r.code);
    setSelField({ t: field ? field.t : sel, f: r.name });
    requestAnimationFrame(() => { const el = document.querySelector('.sbar.field .sbar-name'); if (el) { el.focus(); el.select(); } });
  };
  const columnDelete = () => {
    const { t, f } = field, cols = ctx.m.tables.get(t).fields.map(x => x.name), i = cols.indexOf(f);
    setCode(deleteColumn(dRef.current.code, t, f));
    const next = cols[i + 1] || cols[i - 1];
    setSelField(next ? { t, f: next } : null);
  };
  const columnMove = dir => setCode(moveColumn(dRef.current.code, field.t, field.f, dir));
  const removeTable = id => { setCode(deleteTable(dRef.current.code, id), { fit: true }); setSelection([]); };
  // Put text at the cursor in the code editor.
  const insertCode = text => {
    const t = codeRef.current, v = dRef.current.code;
    const a = t ? t.selectionStart : v.length, b = t ? t.selectionEnd : v.length;
    onCodeInput(v.slice(0, a) + text + v.slice(b));
    requestAnimationFrame(() => { if (t) { t.focus(); t.selectionStart = t.selectionEnd = a + text.length; } });
  };
  const syncCode = e => {
    const { scrollTop, scrollLeft } = e.target;
    if (hlRef.current) { hlRef.current.scrollTop = scrollTop; hlRef.current.scrollLeft = scrollLeft; }
    if (gutRef.current) gutRef.current.scrollTop = scrollTop;
  };

  /* ---- view ---- */
  // Glide to a new view (buttons, menu, keys); wheel, pinch and drag stay immediate.
  const animRef = useRef(0);
  const moveView = useCallback((to, smooth) => {
    cancelAnimationFrame(animRef.current);
    if (!smooth || reducedMotion()) { setView(to); return; }
    const from = viewRef.current, t0 = performance.now();
    const step = now => {
      const t = Math.min(1, (now - t0) / 240), e = 1 - Math.pow(1 - t, 3);
      setView({ k: from.k + (to.k - from.k) * e, x: from.x + (to.x - from.x) * e, y: from.y + (to.y - from.y) * e });
      if (t < 1) animRef.current = requestAnimationFrame(step);
    };
    animRef.current = requestAnimationFrame(step);
  }, []);
  useEffect(() => () => cancelAnimationFrame(animRef.current), []);

  const fit = useCallback(smooth => {
    const stage = stageRef.current; if (!stage) return;
    const b = unionBox(ctx.m.count ? ctx.E.bounds(ctx) : null, shapeBounds(shapes)), r = stage.getBoundingClientRect();
    if (!b || !r.width) { moveView({ x: 0, y: 0, k: 1 }, smooth === true); return; }
    const wide = r.width > 640;
    const left = 66, right = 62 + ((aiOpen || drawer) && wide ? AI_W : 0), top = 54;
    const bottom = 26 + (drawer && !wide ? r.height * 0.66 : 0);
    const aw = Math.max(80, r.width - left - right), ah = Math.max(80, r.height - top - bottom);
    const k = Math.max(0.15, Math.min(1.2, aw / b.w, ah / b.h));
    moveView({ k, x: left + (aw - b.w * k) / 2 - b.x * k, y: top + (ah - b.h * k) / 2 - b.y * k }, smooth === true);
  }, [ctx, drawer, shapes, moveView, aiOpen]);

  useLayoutEffect(() => { if (visible) fit(); }, [fitReq, visible]); // eslint-disable-line react-hooks/exhaustive-deps

  const zoomAt = (px, py, k, smooth) => {
    const v = viewRef.current;
    k = Math.max(0.15, Math.min(3, k));
    const wx = (px - v.x) / v.k, wy = (py - v.y) / v.k;
    moveView({ k, x: px - wx * k, y: py - wy * k }, smooth);
  };
  const zoomTo = k => { const r = svgRef.current.getBoundingClientRect(); zoomAt(r.width / 2, r.height / 2, k, true); };
  const zoomCenter = f => zoomTo(viewRef.current.k * f);
  const zoomMenu = btn => popup(btn, [
    { label: 'Zoom in', note: '+', act: () => zoomCenter(1.25) },
    { label: 'Zoom out', note: '−', act: () => zoomCenter(0.8) },
    { label: 'Zoom to fit', note: 'Shift 1', act: () => fit(true) },
    '-',
    { label: 'Zoom to 50%', act: () => zoomTo(0.5) },
    { label: 'Zoom to 100%', note: 'Shift 0', act: () => zoomTo(1) },
    { label: 'Zoom to 200%', act: () => zoomTo(2) },
  ]);

  useEffect(() => {
    const el = svgRef.current;
    const wheel = e => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      zoomAt(e.clientX - r.left, e.clientY - r.top, viewRef.current.k * Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015)));
    };
    el.addEventListener('wheel', wheel, { passive: false });
    return () => el.removeEventListener('wheel', wheel);
  }, []);

  const toWorld = (cx, cy) => {
    const r = svgRef.current.getBoundingClientRect(), v = viewRef.current;
    return { x: (cx - r.left - v.x) / v.k, y: (cy - r.top - v.y) / v.k };
  };
  const center = () => { const r = svgRef.current.getBoundingClientRect(); return toWorld(r.left + r.width / 2, r.top + r.height / 2); };

  // What an arrow end at world point p would attach to: a shape first, then a diagram node.
  const hitTarget = (p, other) => {
    const s = shapeAt(shapes, p, other && other.s);
    let hit = s ? { a: { s: s.id }, r: bbox(s) } : null;
    if (!hit) {
      for (const id of ids) {
        const r = nodeRect(id);
        if (r && p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h) { hit = { a: { n: id }, r }; }
      }
    }
    // Both ends on the same box would collapse the arrow.
    return hit && other && selKey(hit.a) === selKey(other) ? null : hit;
  };

  /* ---- shape actions ---- */
  const startEdit = s => { setDraft(s.text || ''); setEditing(s.id); setSelection([s.id]); };
  const finishEdit = () => {
    const id = editing; if (!id) return;
    setEditing(null);
    const base = dRef.current.shapes || [], s = base.find(x => x.id === id);
    if (!s) return;
    const text = s.t === 'code' ? draft.replace(/\s+$/, '') : draft.trim();
    if (!text && (s.t === 'text' || s.t === 'comment')) { putShapes(base.filter(x => x.id !== id)); setSelection([]); return; }
    if (text === (s.text || '')) return;
    const n = { ...s, text };
    if (s.t === 'text') Object.assign(n, textSize(s, text));
    putShapes(base.map(x => (x.id === id ? n : x)));
  };
  const place = (t, extra, at) => {
    const c = at || center(), s = make(t, c.x, c.y, extra);
    putShapes([...(dRef.current.shapes || []), s]);
    setSelection([s.id]); setTool('select');
    return s;
  };
  const placeSheetNow = id => {
    const sh = (file.sheets || []).find(x => x.id === id);
    if (!sh) return;
    const u = usedRange(sh) || { c1: 2, r1: 2 };
    const cw = Array.from({ length: Math.min(u.c1, 11) + 1 }, (_, c) => (sh.widths || {})[colName(c)] || 110).reduce((a, b) => a + b, 0);
    place('sheet', { sheet: sh.id, w: Math.round(Math.min(900, Math.max(240, cw * .85))), h: Math.round(26 + Math.min(u.r1 + 1, 30) * 26) });
  };
  // A sheet sent here from the Sheet view ("Show on canvas"), sized to its cells.
  useEffect(() => {
    if (!placeSheet || !visible) return;
    placeSheetNow(placeSheet);
    onPlaced && onPlaced();
  }, [placeSheet, visible]); // eslint-disable-line react-hooks/exhaustive-deps
  const patchSel = p => {
    if (!selShapes.length) return;
    putShapes(baseShapes().map(s => (selSet.has(s.id) ? { ...s, ...p } : s)));
  };
  // Text alignment and indent: fn(shape) gives the change for each selected shape; text objects resize to fit.
  const patchText = fn => {
    if (!selShapes.length) return;
    putShapes(baseShapes().map(s => {
      if (!selSet.has(s.id)) return s;
      const n = { ...s, ...fn(s) };
      return n.t === 'text' ? { ...n, ...textSize(n) } : n;
    }));
  };
  const removeSel = () => {
    if (!selShapes.length) return;
    putShapes(baseShapes().filter(s => !selSet.has(s.id)));
    setSelection([]);
  };
  const duplicateSel = () => {
    const src = baseShapes().filter(s => selSet.has(s.id));
    if (!src.length) return;
    const map = new Map(src.map(s => [s.id, rid('s')]));
    const gmap = new Map(src.filter(s => s.gid).map(s => [s.gid, rid('g')]));
    const copies = src.map(s => {
      const c = { ...moved(s, 24, 24), id: map.get(s.id) };
      if (c.gid) c.gid = gmap.get(c.gid); // copies form their own group
      // Copied arrows stay attached only to copied shapes.
      ['a0', 'a1'].forEach(k => { if (c[k]) { if (c[k].s && map.has(c[k].s)) c[k] = { s: map.get(c[k].s) }; else delete c[k]; } });
      return c;
    });
    putShapes([...baseShapes(), ...copies]);
    setSelection(copies.map(c => c.id));
  };
  const reorder = front => {
    if (!selShapes.length) return;
    const all = baseShapes(), picked = all.filter(s => selSet.has(s.id)), rest = all.filter(s => !selSet.has(s.id));
    putShapes(front ? [...rest, ...picked] : [...picked, ...rest]);
  };
  // Move each selected shape one place up (forward) or down the stack.
  const step = up => {
    const a = [...baseShapes()], on = x => selSet.has(x.id);
    if (up) { for (let i = a.length - 2; i >= 0; i--) if (on(a[i]) && !on(a[i + 1])) [a[i], a[i + 1]] = [a[i + 1], a[i]]; }
    else { for (let i = 1; i < a.length; i++) if (on(a[i]) && !on(a[i - 1])) [a[i - 1], a[i]] = [a[i], a[i - 1]]; }
    putShapes(a);
  };
  // Group the selected shapes (any groups among them merge into the new one), keeping them
  // together in the stack where the topmost of them was.
  const groupSel = () => {
    if (selShapes.length < 2) return;
    const gid = rid('g'), all = baseShapes(), on = x => selSet.has(x.id);
    let top = -1;
    all.forEach((x, i) => { if (on(x)) top = i; });
    putShapes([...all.slice(0, top + 1).filter(x => !on(x)), ...all.filter(on).map(x => ({ ...x, gid })), ...all.slice(top + 1)]);
  };
  // Break up every group that has a selected member; the shapes stay selected.
  const ungroupSel = () => {
    const gids = new Set(selShapes.map(s => s.gid).filter(Boolean));
    if (!gids.size) return;
    putShapes(baseShapes().map(x => (gids.has(x.gid) ? (({ gid, ...rest }) => rest)(x) : x)));
  };
  // Wrap the selection in a labelled frame.
  const createFigure = () => {
    const pick = selShapes.filter(x => x.t !== 'comment');
    if (!pick.length) return;
    const b = pick.map(bbox).reduce((u, r) => unionBox(u, r), null), pad = 28;
    const f = { id: rid('s'), t: 'frame', x: Math.round(b.x - pad), y: Math.round(b.y - pad), w: Math.round(b.w + 2 * pad), h: Math.round(b.h + 2 * pad), text: 'Figure' };
    const a = baseShapes(), i = Math.max(0, a.findIndex(x => selSet.has(x.id)));
    putShapes([...a.slice(0, i), f, ...a.slice(i)]);
    setSelection([f.id]);
  };
  const copyStyles = () => {
    const src = selShapes[0];
    if (!src) return;
    const keys = STYLE_KEYS[kindOf(src)] || ['c'];
    styleClip = { kind: kindOf(src), v: Object.fromEntries(keys.filter(k => src[k] !== undefined).map(k => [k, src[k]])) };
    toast('Styles copied');
  };
  const pasteStyles = () => {
    if (!styleClip) { toast('Copy styles from something first (Ctrl Alt C)'); return; }
    putShapes(baseShapes().map(x => {
      if (!selSet.has(x.id)) return x;
      const o = { ...x }, same = kindOf(x) === styleClip.kind;
      (STYLE_KEYS[kindOf(x)] || ['c']).forEach(k => {
        // From the same kind of object, copy styles exactly; otherwise only what they share.
        if (k in styleClip.v) o[k] = styleClip.v[k]; else if (same) delete o[k];
      });
      return o;
    }));
  };
  // The selection as a standalone SVG (and PNG), for copying and exporting.
  const selectionDoc = async () => {
    const pick = baseShapes().filter(x => selSet.has(x.id));
    await loadImages(imageKeys(pick));
    if (pick.some(x => x.t === 'icon' && isPackIcon(x.v))) await loadIconPacks().catch(() => {});
    return shapesDoc(pick);
  };
  const pngOf = doc => new Promise(res => {
    const img = new Image();
    img.onload = () => {
      const k = 2, cv = document.createElement('canvas');
      cv.width = doc.w * k; cv.height = doc.h * k;
      const g = cv.getContext('2d'); g.scale(k, k); g.drawImage(img, 0, 0);
      cv.toBlob(res, 'image/png');
    };
    img.onerror = () => res(null);
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(doc.text);
  });
  const copyPng = async () => {
    try {
      if (!navigator.clipboard?.write || typeof ClipboardItem === 'undefined') throw 0;
      const doc = await selectionDoc();
      if (!doc) return;
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': pngOf(doc).then(b => b || Promise.reject()) })]);
      toast('Copied as PNG');
    } catch (e) { toast('This browser won’t copy images. Use Export selection instead.'); }
  };
  const copySvg = async () => {
    const doc = await selectionDoc();
    if (!doc) return;
    try { await navigator.clipboard.writeText(doc.text); toast('Copied as SVG'); }
    catch (e) { toast('Copy isn’t allowed here.'); }
  };
  const exportPng = async () => {
    const doc = await selectionDoc();
    const blob = doc && await pngOf(doc);
    if (!blob) { toast('The image couldn’t be created'); return; }
    downloads.save({ filename: slug(file.title) + '-selection.png', data: blob });
  };
  const addComment = () => {
    const b = selShapes.map(bbox).reduce((u, r) => unionBox(u, r), null);
    startEdit(place('comment', undefined, { x: b.x + b.w + 18, y: b.y - 18 }));
  };
  const setRoute = v => putShapes(baseShapes().map(x => {
    if (!selSet.has(x.id)) return x;
    const { sharp, ...rest } = x;
    // Elbows route themselves, so drop any bend points.
    return { ...rest, route: v, ...(v === 'elbow' ? { pts: [x.pts[0], x.pts[x.pts.length - 1]] } : {}) };
  }));
  const selectAll = () => setSelection([...shapes.map(s => s.id), ...(E.draggable ? [...ids].map(id => NODE + id) : [])]);

  const addImageFile = (f, at) => {
    if (!f || !/^image\//.test(f.type)) { toast('Choose an image file'); return; }
    const rd = new FileReader();
    rd.onload = () => {
      const img = new Image();
      img.onload = async () => {
        const w = img.naturalWidth || 400, h = img.naturalHeight || 300;
        const shrink = (max, limit) => {
          const k = Math.min(1, max / Math.max(w, h)), cv = document.createElement('canvas');
          cv.width = Math.round(w * k); cv.height = Math.round(h * k);
          cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
          const png = cv.toDataURL('image/png');
          return png.length > limit ? cv.toDataURL('image/jpeg', 0.85) : png;
        };
        // Images go to IndexedDB, which has plenty of room; only very large ones are scaled down.
        let src = rd.result;
        if (f.size > 4e6 || Math.max(w, h) > 2400) src = shrink(2400, 3e6);
        const key = await saveImage(src);
        const dw = Math.min(480, w), size = { w: dw, h: Math.round(h * dw / w) };
        if (key) { place('image', { img: key, ...size }, at); return; }
        // No IndexedDB (some private windows): keep it inline in localStorage, kept small.
        if (f.size > 350000 || Math.max(w, h) > 1400) src = shrink(1400, 9e5);
        place('image', { src, ...size }, at);
      };
      img.onerror = () => toast('That image couldn’t be read');
      img.src = rd.result;
    };
    rd.readAsDataURL(f);
  };

  /* ---- pointer: select, marquee, move, draw, attach, pan, pinch ---- */
  const ptrs = useRef(new Map()), drag = useRef(null), pinch = useRef(null), lastTap = useRef({ id: null, t: 0 });
  const [grabbing, setGrabbing] = useState(false);
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y), mid = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

  // Start dragging the given selection (shapes and diagram nodes move together).
  const startMove = (keys, key, w, at, drill = false) => {
    drag.current = {
      t: 'move', key, drill, keys: new Set(keys), a: w, shapes: baseShapes(),
      nodes: keys.filter(k => k.startsWith(NODE)).map(k => k.slice(NODE.length)).filter(id => ids.has(id)).map(id => ({ id, p: ctx.P(id) })),
      ...at,
    };
    setGrabbing(true);
  };
  // Click (or shift-click) on a shape or node. A grouped shape brings its whole group.
  const pickItem = (key, e, w, at) => {
    const g = groupOf(key);
    if (e.shiftKey) {
      const next = selSet.has(key) ? selection.filter(k => !g.includes(k)) : [...new Set([...selection, ...g])];
      setSelection(next);
      if (next.includes(key)) startMove(next, null, w, at);
      return;
    }
    if (selSet.has(key)) { startMove(selection, key, w, at, true); return; }
    setSelection(g);
    startMove(g, key, w, at);
  };

  const onPointerDown = e => {
    if (e.button > 1) return;
    cancelAnimationFrame(animRef.current);
    setDiagSel(false);
    // Keep focus handling in our hands: blur any field (this also saves an open text edit).
    e.preventDefault();
    const ae = document.activeElement;
    if (ae && ae !== document.body && ae.blur) ae.blur();
    svgRef.current.setPointerCapture(e.pointerId);
    ptrs.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const v = viewRef.current;
    if (ptrs.current.size === 2) {
      const [a, b] = [...ptrs.current.values()];
      pinch.current = { d: dist(a, b) || 1, k: v.k, m: mid(a, b), vx: v.x, vy: v.y };
      drag.current = null;
      setLive(null); setDragManual(null); setMarquee(null); setTarget(null);
      return;
    }
    const w = toWorld(e.clientX, e.clientY), at = { sx: e.clientX, sy: e.clientY, moved: false };
    // A double-click only counts if nothing else was pressed in between.
    const prevTap = lastTap.current;
    lastTap.current = { id: null, t: 0 };
    const pan = () => { drag.current = { t: 'p', vx: v.x, vy: v.y, ...at }; setGrabbing(true); };

    if (e.button === 1 || tool === 'hand' || spaceRef.current) { pan(); return; }

    if (tool !== 'select') {
      if (tool === 'text' || tool === 'comment') {
        const s = make(tool, w.x, w.y);
        putShapes([...(dRef.current.shapes || []), s], false);
        startEdit(s); setTool('select');
        drag.current = null;
        return;
      }
      const from = tool === 'arrow' || tool === 'line' ? hitTarget(w) : null;
      drag.current = { t: 'draw', tool, a: w, a0: from && from.a, id: rid('s'), pts: [[Math.round(w.x), Math.round(w.y)]], ...at };
      return;
    }

    const hEl = e.target.closest('[data-handle]');
    if (hEl && selS) {
      let h = hEl.dataset.handle, o = selS;
      if (h[0] === 'a') {
        // "+" handle: add a bend point there and drag it.
        const i = +h.slice(1) + 1;
        o = { ...selS, pts: [...selS.pts.slice(0, i), [Math.round(w.x), Math.round(w.y)], ...selS.pts.slice(i)] };
        h = 'p' + i;
      } else if (isLink(selS)) {
        // Double-click a bend point to remove it.
        const i = +h.slice(1), now = Date.now(), lt = lastTap.current, tap = selS.id + ':' + h;
        if (i > 0 && i < selS.pts.length - 1 && lt.id === tap && now - lt.t < 400) {
          lastTap.current = { id: null, t: 0 };
          putShapes(baseShapes().map(x => (x.id === selS.id ? { ...x, pts: x.pts.filter((_, j) => j !== i) } : x)));
          return;
        }
        lastTap.current = { id: tap, t: now };
      }
      drag.current = { t: 'resize', id: selS.id, h, o, shape: o !== selS ? o : null, ...at };
      setGrabbing(true);
      return;
    }

    const sEl = e.target.closest('[data-shape]');
    if (sEl) {
      const id = sEl.dataset.shape, s = shapes.find(x => x.id === id);
      if (!s) return;
      const now = Date.now(), lt = prevTap;
      // Double-click: a sheet opens in the Sheet view; text is edited in place.
      if (!e.shiftKey && lt.id === id && now - lt.t < 400 && s.t === 'sheet') {
        lastTap.current = { id: null, t: 0 }; drag.current = null;
        onOpenSheet && onOpenSheet(s.sheet);
        return;
      }
      if (!e.shiftKey && lt.id === id && now - lt.t < 400 && hasText(s)) {
        lastTap.current = { id: null, t: 0 };
        startEdit(s); drag.current = null;
        return;
      }
      lastTap.current = { id, t: now };
      pickItem(id, e, w, at);
      return;
    }

    const n = E.draggable && e.target.closest('[data-node]');
    if (n) {
      pickItem(NODE + n.dataset.node, e, w, at);
      const fEl = e.target.closest('[data-field]');
      if (drag.current && drag.current.t === 'move') drag.current.field = !e.shiftKey && fEl ? { t: n.dataset.node, f: fEl.dataset.field } : null;
      return;
    }

    // Empty canvas: drag pans; Shift+drag draws a selection box.
    if (e.shiftKey && e.pointerType !== 'touch') { drag.current = { t: 'box', a: w, keep: selection, ...at }; return; }
    drag.current = { t: 'p', vx: v.x, vy: v.y, clear: true, ...at };
    setGrabbing(true);
  };
  const onPointerMove = e => {
    if (!ptrs.current.has(e.pointerId)) {
      // Before pressing, show which box an arrow would start from.
      if ((tool === 'arrow' || tool === 'line') && !drag.current) {
        const h = hitTarget(toWorld(e.clientX, e.clientY)), r = h ? h.r : null;
        setTarget(t => (sameRect(t, r) ? t : r));
      }
      return;
    }
    ptrs.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const pc = pinch.current;
    if (pc && ptrs.current.size >= 2) {
      const [a, b] = [...ptrs.current.values()], r = svgRef.current.getBoundingClientRect(), m = mid(a, b);
      const k = Math.max(0.15, Math.min(3, pc.k * dist(a, b) / pc.d));
      const wx = (pc.m.x - r.left - pc.vx) / pc.k, wy = (pc.m.y - r.top - pc.vy) / pc.k;
      setView({ k, x: m.x - r.left - wx * k, y: m.y - r.top - wy * k });
      return;
    }
    const dr = drag.current; if (!dr) return;
    const dx = e.clientX - dr.sx, dy = e.clientY - dr.sy;
    if (!dr.moved && Math.hypot(dx, dy) < 4) return;
    dr.moved = true;
    const k = viewRef.current.k, w = toWorld(e.clientX, e.clientY);
    if (dr.t === 'draw') {
      const base = dRef.current.shapes || [];
      if (dr.tool === 'pen') {
        const last = dr.pts[dr.pts.length - 1];
        if (Math.hypot(w.x - last[0], w.y - last[1]) * k < 2) return;
        dr.pts.push([Math.round(w.x), Math.round(w.y)]);
        dr.shape = { id: dr.id, t: 'pen', pts: dr.pts.slice() };
      } else {
        dr.shape = drawn(dr.tool, dr.a, w, e.shiftKey, dr.id);
        if (isLink(dr.shape)) {
          const to = hitTarget(w, dr.a0);
          if (dr.a0) dr.shape.a0 = dr.a0;
          if (to) dr.shape.a1 = to.a;
          setTarget(to ? to.r : null);
        }
      }
      setLive([...base, dr.shape]);
    } else if (dr.t === 'move') {
      const mx = Math.round(w.x - dr.a.x), my = Math.round(w.y - dr.a.y);
      // An arrow end stays attached only if what it points at moves with it.
      const keep = a => dr.keys.has(selKey(a));
      dr.next = dr.shapes.map(s => {
        if (!dr.keys.has(s.id)) return s;
        const n = moved(s, mx, my);
        if (n.a0 && !keep(n.a0)) delete n.a0;
        if (n.a1 && !keep(n.a1)) delete n.a1;
        return n;
      });
      setLive(dr.next);
      if (dr.nodes.length) {
        const g = dr.next.some(s => dr.keys.has(s.id)) ? 1 : 4; // snap nodes to the grid when they move alone
        dr.pos = Object.fromEntries(dr.nodes.map(({ id, p }) => [id, { x: Math.round((p.x + mx) / g) * g, y: Math.round((p.y + my) / g) * g }]));
        setDragManual(dr.pos);
      }
    } else if (dr.t === 'resize') {
      let s = resized(dr.o, dr.h, w, e.shiftKey || KEEP_RATIO.has(dr.o.t));
      const i = +dr.h.slice(1), last = dr.o.pts ? dr.o.pts.length - 1 : -1;
      if (isLink(dr.o) && dr.h[0] === 'p' && (i === 0 || i === last)) {
        // Only the two ends attach to boxes; bend points stay free.
        const k = i === 0 ? 'a0' : 'a1', to = hitTarget(w, s[i === 0 ? 'a1' : 'a0']);
        s = { ...s };
        if (to) s[k] = to.a; else delete s[k];
        setTarget(to ? to.r : null);
      }
      dr.shape = s;
      setLive(baseShapes().map(x => (x.id === dr.id ? s : x)));
    } else if (dr.t === 'box') {
      const r = { x: Math.min(dr.a.x, w.x), y: Math.min(dr.a.y, w.y), w: Math.abs(w.x - dr.a.x), h: Math.abs(w.y - dr.a.y) };
      setMarquee(r);
      const hit = shapes.filter(s => (s.t === 'frame' ? contains(r, bbox(s)) : overlaps(r, bbox(s)))).map(s => s.id);
      if (E.draggable) ids.forEach(id => { const nr = nodeRect(id); if (nr && overlaps(r, nr)) hit.push(NODE + id); });
      setSelection(withGroups([...dr.keep, ...hit]));
    } else setView(v => ({ ...v, x: dr.vx + dx, y: dr.vy + dy }));
  };
  const onPointerEnd = e => {
    ptrs.current.delete(e.pointerId);
    if (ptrs.current.size < 2) pinch.current = null;
    if (ptrs.current.size) return;
    const dr = drag.current;
    if (dr) {
      if (dr.t === 'draw') {
        let s = dr.shape;
        if (dr.tool === 'pen') s = dr.pts.length > 1 ? s : null;
        else if (!s || (s.w != null && s.w < 8 && s.h < 8)) s = make(dr.tool, dr.a.x, dr.a.y); // a click drops a default-size shape
        if (s) { putShapes([...(dRef.current.shapes || []), s]); setSelection([s.id]); }
        if (dr.tool !== 'pen') setTool('select');
      } else if (dr.t === 'move') {
        if (dr.moved) {
          if (dr.next && dr.next.some(s => dr.keys.has(s.id))) putShapes(dr.next);
          if (dr.pos) { const pos = dr.pos; updateDiagram(x => { x.manual = { ...(x.manual || {}), ...pos }; }); }
          setDragManual(null);
        } else {
          // A plain click inside a multi-selection picks that object (or its group);
          // clicking a group that's already selected picks the one object inside it.
          const g = dr.key ? groupOf(dr.key) : [];
          if (dr.key && selection.length > g.length) setSelection(g);
          else if (dr.drill && g.length > 1 && selection.length === g.length && g.every(k => selSet.has(k))) setSelection([dr.key]);
          // A click on a table row selects that column; a click on the header selects the whole table.
          if (dr.key && dr.key.startsWith(NODE)) setSelField(dr.field || null);
        }
      } else if (dr.t === 'resize') {
        if (dr.shape) putShapes(baseShapes().map(s => (s.id === dr.id ? dr.shape : s)));
      } else if (dr.t === 'p' && dr.clear && !dr.moved) setSelection([]); // click on empty canvas clears
    }
    setLive(null); setMarquee(null); setTarget(null);
    drag.current = null;
    setGrabbing(false);
  };

  const pickTool = t => {
    if (t === 'icon') { setPanel('icon'); return; }
    setTool(t); setPanel(null);
    if (t !== 'select' && t !== 'hand') setSelection([]);
  };
  const focusAI = () => { setPanel(null); onAIOpen(true); setAiFocus(n => n + 1); };
  const toggleAI = () => { if (aiOpen && document.activeElement?.closest('.aichat')) onAIOpen(false); else focusAI(); };

  /* ---- keyboard ---- */
  useEffect(() => {
    if (!visible) return;
    const key = e => {
      if (document.querySelector('.modal')) return;
      const inField = e.target.closest && e.target.closest('textarea,input,button,select');
      const typing = e.target.closest && e.target.closest('textarea,input');
      const mod = e.metaKey || e.ctrlKey, k = e.key.toLowerCase();
      if (mod && k === 'j') { e.preventDefault(); toggleAI(); return; }
      if (e.key === ' ' && !inField) { e.preventDefault(); if (!spaceRef.current) { spaceRef.current = true; setSpace(true); } return; }
      if (typing) return;
      if (mod && k === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
      if (mod && k === 'y') { e.preventDefault(); redo(); return; }
      if (mod && k === 'a') { e.preventDefault(); selectAll(); return; }
      if (mod && k === 'd' && selShapes.length) { e.preventDefault(); duplicateSel(); return; }
      if (mod && k === 'g' && selShapes.length) { e.preventDefault(); e.shiftKey ? ungroupSel() : groupSel(); return; }
      if (field) {
        const cols = ctx.m.tables.get(field.t).fields.map(x => x.name), i = cols.indexOf(field.f);
        if (e.key === 'Escape') { setSelField(null); return; }
        if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); columnDelete(); return; }
        if (e.key === 'Enter') { e.preventDefault(); document.querySelector('.sbar.field .sbar-name')?.focus(); return; }
        if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
          e.preventDefault();
          const dir = e.key === 'ArrowUp' ? -1 : 1;
          if (e.altKey) columnMove(dir);
          else if (cols[i + dir]) setSelField({ t: field.t, f: cols[i + dir] });
          return;
        }
      }
      if (selShapes.length) {
        if (mod && e.key === '[') { e.preventDefault(); step(false); return; }
        if (mod && e.key === ']') { e.preventDefault(); step(true); return; }
        if (mod && e.altKey && e.code === 'KeyC') { e.preventDefault(); copyStyles(); return; }
        if (mod && e.altKey && e.code === 'KeyV') { e.preventDefault(); pasteStyles(); return; }
        if (!mod && e.altKey && e.shiftKey && e.code === 'KeyC') { e.preventDefault(); copyPng(); return; }
      }
      if (mod || e.altKey) return;
      if (selShapes.length && e.key === '[') { e.preventDefault(); reorder(false); return; }
      if (selShapes.length && e.key === ']') { e.preventDefault(); reorder(true); return; }
      if (selShapes.length && e.shiftKey && k === 'f') { e.preventDefault(); createFigure(); return; }
      if (e.key === '/') { e.preventDefault(); setPanel(p => (p == null ? '' : null)); return; }
      if (e.key === '?') { e.preventDefault(); setShowKeys(true); return; }
      if (e.key === '+' || e.key === '=') { e.preventDefault(); zoomCenter(1.25); return; }
      if (e.key === '-' || e.key === '_') { e.preventDefault(); zoomCenter(0.8); return; }
      if (e.shiftKey && e.code === 'Digit1') { e.preventDefault(); fit(true); return; }
      if (e.shiftKey && e.code === 'Digit0') { e.preventDefault(); zoomTo(1); return; }
      if (e.key === 'Escape') { setSelection([]); setDiagSel(false); setTool('select'); setPanel(null); return; }
      if (selShapes.length && (e.key === 'Delete' || e.key === 'Backspace')) { e.preventDefault(); removeSel(); return; }
      if (selS && e.key === 'Enter' && hasText(selS)) { e.preventDefault(); startEdit(selS); return; }
      if (selShapes.length && e.key.startsWith('Arrow')) {
        e.preventDefault();
        const n = e.shiftKey ? 10 : 1, dx = e.key === 'ArrowLeft' ? -n : e.key === 'ArrowRight' ? n : 0, dy = e.key === 'ArrowUp' ? -n : e.key === 'ArrowDown' ? n : 0;
        putShapes(baseShapes().map(s => (selSet.has(s.id) ? moved(s, dx, dy) : s)));
        return;
      }
      if (TOOL_KEYS[k]) { e.preventDefault(); pickTool(TOOL_KEYS[k]); }
    };
    const up = e => { if (e.key === ' ') { spaceRef.current = false; setSpace(false); } };
    const lost = () => { spaceRef.current = false; setSpace(false); };
    const paste = e => {
      if (e.target.closest && e.target.closest('textarea,input')) return;
      const f = [...(e.clipboardData?.files || [])].find(x => /^image\//.test(x.type));
      if (f) { e.preventDefault(); addImageFile(f); }
    };
    document.addEventListener('keydown', key);
    document.addEventListener('keyup', up);
    window.addEventListener('blur', lost);
    document.addEventListener('paste', paste);
    return () => {
      document.removeEventListener('keydown', key); document.removeEventListener('keyup', up);
      window.removeEventListener('blur', lost); document.removeEventListener('paste', paste);
    };
  });

  /* ---- AI ----
     Chats belong to the file (newest first), so a conversation carries on across diagram tabs. */
  useEffect(() => { sampleP.then(x => { if (!x) setAiOff(NO_AI); }); }, []);
  const chats = file.chats || [];
  const newChat = () => ({ id: rid('c'), title: '', at: Date.now(), msgs: [] });
  const addMsg = (cls, text) => updateFile(c => {
    c.chats = c.chats || [];
    if (!c.chats.length) c.chats.unshift(newChat());
    const ch = c.chats[0];
    ch.msgs = [...ch.msgs, { id: rid('m'), cls, text }].slice(-60);
    ch.at = Date.now();
    if (!ch.title && cls === 'u') ch.title = trunc(text.split('\n')[0], 48);
  });
  const startChat = () => updateFile(c => {
    c.chats = (c.chats || []).filter(x => x.msgs.length);
    c.chats.unshift(newChat());
    c.chats = c.chats.slice(0, 20);
  });
  const loadChat = id => updateFile(c => {
    const i = (c.chats || []).findIndex(x => x.id === id);
    if (i > 0) c.chats.unshift(...c.chats.splice(i, 1));
  });

  // kind: one of KINDS (make that type), or none (draw or change the current diagram).
  const send = async (text, { kind, file: att } = {}) => {
    if (ctl.current) return;
    const sample = await sampleP;
    if (!sample) { setAiOff(NO_AI); return; }
    const K = kind ? KINDS.find(x => x.k === kind) : null;
    const convo = ((chats[0] && chats[0].msgs) || []).slice(-6).map(m => (m.cls === 'u' ? 'User: ' : 'You: ') + m.text).join('\n');
    addMsg('u', text + (att ? `\n(attached: ${att.name})` : '') + (K ? `\n(create: ${K.label})` : ''));
    ctl.current = new AbortController();
    setBusy(true);
    const others = file.diagrams.filter(x => x.code && x.code.trim())
      .map(x => `"${x.name}" (${TYPES[x.type]?.name}):\n${x.code}`).join('\n\n');
    let ctxText = '';
    if (convo) ctxText += `Earlier in this conversation:\n${convo.slice(-3000)}\n\n`;
    const pic = att && att.image, images = pic ? [{ media_type: pic.media_type, data: pic.data }] : undefined;
    if (att && !pic) ctxText += `Attached file "${att.name}":\n<<<\n${att.text.slice(0, 40000)}\n>>>\n\n`;
    if (pic) ctxText += `The attached picture ("${att.name}") shows a diagram. Read every name, label, table, column, type and connection in it, keep its order, and don't add things that aren't there. Where text is unreadable, make a sensible guess.\n\n`;
    try {
      if (K && K.k === 'doc') {
        setStatus('Writing the doc');
        let p = `You are the writing assistant in Workline, a tool for technical design docs. File title: "${file.title}".\n\n`;
        p += `Diagrams in this file:\n${others || '(none yet)'}\n\n`;
        if (file.doc && file.doc.trim()) p += `Current doc (keep anything still useful):\n<<<\n${file.doc.slice(0, 12000)}\n>>>\n\n`;
        p += ctxText + `Request:\n<<<\n${text}\n>>>\n\nWrite the design doc in markdown, 300 to 700 words, with sections: Context, Goals, Non-goals, Proposal, Alternatives considered, Risks and open questions. Start with a "# " heading. Reply with only the markdown.`;
        const { text: out } = await sample(p, { signal: ctl.current.signal, cache: false, images });
        const clean = out.replace(/^```(?:markdown|md)?\s*\n/, '').replace(/\n```\s*$/, '').trim();
        if (!clean) throw { code: 'empty' };
        updateFile(c => { c.doc = clean + '\n'; if (c.view === 'canvas') c.view = 'both'; });
        addMsg('a', 'Wrote the design doc. It’s open beside the canvas.');
        return;
      }
      // A picture with no chosen type: the AI picks the type that matches it.
      const auto = !!pic && !K;
      let type = K ? K.type : d.type;
      // A chosen type (or a picture) fills this diagram only while it's blank; otherwise it becomes a new tab.
      const here = K || pic ? isBlank : true, editing = here && !K && !pic && d.code.trim();
      setStatus(pic ? 'Reading the picture' : editing ? 'Updating the diagram' : 'Drawing');
      const tname = K && K.k === 'bpmn' ? 'BPMN-style process' : TYPES[type].name.toLowerCase();
      const selLabel = editing && sel && E.label ? E.label(ctx.m, sel) : '';
      let p = auto
        ? `You turn pictures of diagrams into Workline diagram code. First choose the type that matches the picture: "erd" for database tables and their relationships, "sequence" for messages between participants over time, "flowchart" for steps and decisions, or "architecture" for systems and services.\n\n${LANG.graph}\n${LANG.architecture}\n${LANG.flowchart}\n\n${LANG.sequence}\n\n${LANG.erd}\n\n`
        : `You draw ${tname} diagrams in Workline.\n\n${langFor(type)}\n\n`;
      if (K && K.k === 'bpmn') p += 'Draw it as a business process: put each role, team or system in its own group so the groups show as swimlanes, use start and end nodes, and decision nodes for gateways.\n\n';
      p += 'If the input is code or config (Terraform, SQL, YAML, source code), diagram what it defines. When changing an existing diagram, keep existing ids and everything the request doesn\'t touch.\n\n';
      p += editing ? `Current diagram code:\n<<<\n${d.code}\n>>>\n\n` : 'There is no diagram yet. Create a new one.\n\n';
      if (selLabel) p += `The user has selected "${sel}" (${selLabel}); the request most likely refers to it.\n\n`;
      if (!pic && file.doc && file.doc.trim()) p += `The file's design doc, for context:\n<<<\n${file.doc.slice(0, 6000)}\n>>>\n\n`;
      if (!pic && others) p += `Diagrams in this file, for context:\n${others.slice(0, 6000)}\n\n`;
      p += ctxText + `Request:\n<<<\n${text}\n>>>\n\nReply with ONLY a JSON object, no markdown fences: {${auto ? '"type": "erd" | "sequence" | "flowchart" | "architecture", ' : ''}"reply": "<one short sentence saying what you drew or changed>", "name": "<short tab name, under 24 characters>", "code": "<the complete diagram code>"}`;
      const res = await sample.json(p, { signal: ctl.current.signal, cache: false, modelTier: 'default', images });
      if (auto) type = TYPES[res && res.type] ? res.type : 'architecture';
      if (!res || typeof res.code !== 'string' || !TYPES[type].E.parse(res.code).count) throw { code: 'empty' };
      const reply = typeof res.reply === 'string' && res.reply ? res.reply : 'Done.';
      if (here) {
        if (type !== d.type) updateDiagram(x => { x.type = type; x.manual = {}; if (type === 'flowchart') x.dir = 'TB'; });
        setCode(res.code.trim(), { fit: true });
        addMsg('a', reply);
      } else {
        const name = String(res.name || (K && K.k === 'bpmn' ? 'BPMN' : TYPES[type].name)).slice(0, 40);
        onAddDiagram(type, name, res.code.trim());
        addMsg('a', `${reply} Added it as a new “${name}” tab.`);
      }
    } catch (e) {
      addMsg('e', e && (e.code === 'cancelled' || e.name === 'AbortError') ? 'Stopped.' : copyFor(e && e.code));
    } finally {
      ctl.current = null; setBusy(false); setStatus('');
    }
  };

  /* ---- tools ---- */
  const copyCode = async () => {
    try { await navigator.clipboard.writeText(d.code); toast('Code copied'); }
    catch (e) { toast('Copy isn’t allowed here. Select the code and copy it manually.'); }
  };
  const toggleDir = () => { updateDiagram(x => { x.dir = x.dir === 'TB' ? 'LR' : 'TB'; x.manual = {}; }); setFitReq(n => n + 1); };
  const tidy = () => { updateDiagram(x => { x.manual = {}; }); setFitReq(n => n + 1); toast('Layout tidied'); };
  const toggleStyle = () => updateDiagram(x => { x.style = x.style === 'mono' ? 'color' : 'mono'; });

  /* ---- insert menu ---- */
  const isBlank = !d.code.trim() && !(d.shapes || []).length;
  // Fill this diagram when it's blank, otherwise add a new tab.
  const loadDiagram = (type, name, code) => {
    if (isBlank) {
      updateDiagram(x => { x.type = type; x.manual = {}; if (type === 'flowchart') x.dir = 'TB'; });
      if (code) setCode(code, { fit: true }); else setDrawer(true);
    } else {
      onAddDiagram(type, name, code);
      toast(`Added “${name}” as a new diagram`);
    }
  };
  const iconSet = icons();
  const packTile = it => ({
    key: 'ic-' + it.key, glyph: it.body, vb: it.vb, filled: it.fill, color: it.fill ? brandColor(it.hex) || undefined : undefined,
    label: it.label, words: it.words, act: () => place('icon', { v: it.key }),
  });
  const tree = [
    { key: 'ai', icon: 'ai', label: 'AI chat', note: 'Ask AI to draw or change this diagram', act: focusAI },
    { key: 'code', icon: 'diagram', label: 'Diagram as Code', note: 'Create diagrams using code', children: [
      ...CODE_KINDS.map(c => ({
        key: 'code-' + c.key, icon: c.icon, label: c.label, note: c.note,
        act: () => {
          if (c.starter) { loadDiagram(c.type, c.label, c.starter); setDrawer(true); }
          else if (c.type === d.type) setDrawer(true);
          else loadDiagram(c.type, TYPES[c.type].name, '');
        },
      })),
      { key: 'code-free', icon: 'dFree', label: 'Freeform', note: 'Draw freely or generate with AI', act: () => {
        if (isBlank) focusAI();
        else { onAddDiagram('architecture', 'Freeform'); toast('Added a blank “Freeform” diagram. Draw with the toolbar, or describe it to AI.'); }
      } },
    ] },
    { key: 'catalog', icon: 'catalog', label: 'Diagram catalog', note: 'Start from a ready-made diagram', children: TEMPLATES.filter(t => t.key !== 'blank' && t.key !== 'doc').map(t => ({
      key: 'cat-' + t.key, icon: 'catalog', label: t.name, note: t.note,
      act: () => { const x = t.make().diagrams[0]; loadDiagram(x.type, x.name, x.code); },
    })) },
    { key: 'shape', icon: 'shapes', label: 'Shape', note: 'Explore shapes', children: SHAPE_LIST.map(s => ({
      key: 'sh-' + s.t, svg: shapeIcon(s.t), label: s.name, act: () => place(s.t),
    })) },
    { key: 'icon', icon: 'smile', label: 'Icon', grid: true,
      note: `${(Object.keys(iconSet).length + (packs ? packs.general.length + packs.tech.length + packs.cloud.length : 2100)).toLocaleString()}+ icons available`,
      children: [
        { key: 'ic-general', icon: 'smile', label: 'General Icon', note: `${packs ? packs.general.length.toLocaleString() : '1,800'}+ icons available`, grid: true, empty: 'Loading icons…', children: packs ? packs.general.map(packTile) : [] },
        { key: 'ic-tech', icon: 'bolt', label: 'Tech Logo', note: 'Popular tools and libraries', grid: true, empty: 'Loading logos…', children: packs ? packs.tech.map(packTile) : [] },
        { key: 'ic-cloud', icon: 'cloud', label: 'Cloud Provider Icon', note: 'Google Cloud, Cloudflare, Vercel and more', grid: true, empty: 'Loading logos…', children: packs ? packs.cloud.map(packTile) : [] },
        ...Object.keys(iconSet).map(k => ({ key: 'ic-' + k, glyph: iconSet[k], label: k, act: () => place('icon', { v: k }) })),
      ] },
    { key: 'device', icon: 'device', label: 'Device Frame', note: 'Phone, tablet, browser frames', grid: true, children: DEVICES.map(x => ({
      key: 'dev-' + x.v, svg: DEVICE_ICON[x.v], label: x.name, act: () => place('device', { v: x.v }),
    })) },
    { key: 'figure', icon: 'frame', label: 'Figure', note: 'A labeled frame to group things', tile: true, act: () => place('frame', { text: 'Figure' }) },
    { key: 'sql', icon: 'dErd', label: 'Database schema from SQL', note: 'Draw the tables in a .sql file or dump', children: [
      { key: 'sql-file', icon: 'upload', label: 'Open a .sql file', note: 'A schema, migration or dump (PostgreSQL, MySQL, SQLite, SQL Server)', act: openSqlFile },
      { key: 'sql-paste', icon: 'doc', label: 'Paste SQL', note: 'CREATE TABLE statements', act: importSql },
    ] },
    { key: 'sheet', icon: 'sheet', label: 'Spreadsheet', note: 'A table with formulas, like Excel', children: [
      ...(file.sheets || []).map(sh => ({ key: 'shx-' + sh.id, icon: 'sheet', label: sh.name, note: 'Show this sheet', act: () => placeSheetNow(sh.id) })),
      { key: 'sh-new', icon: 'plus', label: 'New sheet', note: 'An empty sheet; double-click it to fill it in', act: () => {
        const sh = newSheet(`Sheet ${(file.sheets || []).length + 1}`);
        updateFile(c => { c.sheets = [...(c.sheets || []), sh]; });
        place('sheet', { sheet: sh.id, w: 440, h: 26 + 6 * 26 });
      } },
    ] },
    { key: 'codeblock', icon: 'codeblock', label: 'Code block', note: 'A snippet of code', tile: true, act: () => place('code') },
    { key: 'image', icon: 'image', label: 'Image', note: 'Upload a picture', tile: true, act: () => fileRef.current?.click() },
  ];
  const closePanel = useCallback(() => setPanel(null), []);

  const big = 120 * view.k, sm = 24 * view.k;
  const stageStyle = {
    backgroundSize: `${big}px ${big}px,${big}px ${big}px,${sm}px ${sm}px,${sm}px ${sm}px`,
    backgroundPosition: `${view.x}px ${view.y}px`,
  };
  const empty = !ctx.m.count && !shapes.length;
  const selLabel = sel && E.label ? E.label(ctx.m, sel) : null;
  const helpText = d.type === 'sequence' ? HELP.sequence : d.type === 'erd' ? HELP.erd : d.type === 'flowchart' ? HELP.flowchart : HELP.graph;
  const errs = ctx.m.errors.slice(0, 3);
  const errLines = new Set(ctx.m.errors.map(x => x.line));

  // Text editor laid over the shape being edited.
  let editor = null;
  if (editS) {
    const b = editBox(editS, draft), k = view.k;
    editor = (
      <textarea className={'sedit' + (b.card ? ' card' : '')} autoFocus value={draft} spellCheck={editS.t !== 'code'} aria-label="Edit text"
        style={{
          left: view.x + b.x * k, top: view.y + b.y * k, width: b.w * k, height: b.h * k,
          fontSize: b.fs * k, textAlign: b.align, fontWeight: b.weight, color: b.color,
          fontFamily: b.mono ? 'var(--mono)' : undefined, whiteSpace: b.mono ? 'pre' : undefined,
          paddingTop: (b.pad || 0) * k, paddingLeft: (b.padL ?? b.padX ?? 0) * k, paddingRight: (b.padX || 0) * k,
        }}
        onFocus={e => { const t = e.target; t.selectionStart = t.selectionEnd = t.value.length; }}
        onChange={e => setDraft(e.target.value)}
        onBlur={finishEdit}
        onKeyDown={e => {
          if (e.key === 'Escape' || (e.key === 'Enter' && (e.metaKey || e.ctrlKey))) { e.preventDefault(); e.target.blur(); }
          // Enter starts a new line; a frame's label is one line, so there Enter finishes.
          else if (e.key === 'Enter' && editS.t === 'frame') { e.preventDefault(); e.target.blur(); }
          else if (e.key === 'Tab' && editS.t === 'code') {
            e.preventDefault();
            const t = e.target, s = t.selectionStart, v = t.value.slice(0, s) + '  ' + t.value.slice(t.selectionEnd);
            setDraft(v); requestAnimationFrame(() => { t.selectionStart = t.selectionEnd = s + 2; });
          }
        }} />
    );
  }

  return (
    <div className={'cwrap' + (drawer ? ' has-drawer side-open' : '') + (aiOpen ? ' ai-open side-open' : '')}
      onDragOver={e => { if ([...e.dataTransfer.types].includes('Files')) e.preventDefault(); }}
      onDrop={e => {
        const files = [...e.dataTransfer.files];
        const sqlFile = files.find(x => /\.(sql|ddl)$/i.test(x.name));
        if (sqlFile) { e.preventDefault(); importSqlFile(sqlFile); return; }
        const f = files.find(x => /^image\//.test(x.type));
        if (!f) return;
        e.preventDefault();
        addImageFile(f, toWorld(e.clientX, e.clientY));
      }}>
      <div id="stage" ref={stageRef} style={stageStyle}>
        <svg id="svg" ref={svgRef} className={(grabbing ? 'grabbing' : '') + (tool === 'hand' || space ? ' panning' : tool !== 'select' ? ' drawing' : '')} xmlns="http://www.w3.org/2000/svg"
          fontFamily="Bricolage Grotesque, system-ui, -apple-system, Segoe UI, sans-serif" aria-label="Diagram canvas"
          onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerEnd} onPointerCancel={onPointerEnd}
          onPointerLeave={() => { if (!drag.current) setTarget(null); }}>
          <g transform={`translate(${view.x} ${view.y}) scale(${view.k})`} dangerouslySetInnerHTML={{ __html: layers.under + markup + layers.over + overlay }} />
        </svg>
      </div>
      {editor}

      {empty && tool === 'select' && (
        <div className="cempty">
          <h3>This {(TYPES[d.type]?.name || 'diagram').toLowerCase()} is empty</h3>
          <p>Pick a starting point, or just start drawing.</p>
          <div className="qs">
            <button onClick={() => pickTool('rect')}><Ico d={IC.rect} />Draw a box<kbd>R</kbd></button>
            <button onClick={() => pickTool('arrow')}><Ico d={IC.arrow} />Draw an arrow<kbd>A</kbd></button>
            <button onClick={() => setPanel('')}><Ico d={IC.plus} />Insert something<kbd>/</kbd></button>
            <button onClick={() => setPanel('catalog')}><Ico d={IC.catalog} />Start from a template</button>
            <button onClick={() => setDrawer(true)}><Ico d={IC.codeblock} />Write diagram code</button>
            <button onClick={focusAI}><Ico d={IC.ai} />Ask AI to draw it<kbd>Ctrl J</kbd></button>
          </div>
        </div>
      )}

      <Toolbar tool={tool} onTool={pickTool} panelOpen={panel != null} onInsert={() => setPanel(p => (p == null ? '' : null))} onAI={toggleAI} />
      {panel != null && <InsertPanel tree={tree} start={panel} onClose={closePanel} />}
      <input ref={sqlFileRef} type="file" accept=".sql,.ddl,.txt,.psql,.mysql,application/sql" hidden onChange={e => { const f = e.target.files[0]; e.target.value = ''; importSqlFile(f); }} />
      <input ref={fileRef} type="file" accept="image/*" hidden onChange={e => { addImageFile(e.target.files[0]); e.target.value = ''; }} />

      <div className="ctools">
        <button className="btn" aria-pressed={drawer} onClick={() => setDrawer(o => !o)}>Code</button>
        {E.directional && <button className="btn" onClick={toggleDir} aria-label={'Layout direction: ' + (d.dir === 'TB' ? 'Vertical' : 'Horizontal')}>{d.dir === 'TB' ? 'Vertical' : 'Horizontal'}</button>}
        {E.draggable && <button className="btn" onClick={tidy}>Tidy layout</button>}
        <button className="btn" onClick={toggleStyle} aria-label={'Diagram style: ' + (d.style === 'mono' ? 'Mono' : 'Color')}>{d.style === 'mono' ? 'Mono' : 'Color'}</button>
      </div>

      {diagBox && visible && !editing && (
        <div className="dhdr" style={{ left: Math.max(66, view.x + (diagBox.x - 14) * view.k), top: Math.max(52, view.y + (diagBox.y - 14) * view.k - 34) }}>
          <button className={diagSel ? 'on' : undefined} onClick={() => { setSelection([]); setDiagSel(true); }} title="Select the diagram">
            <Ico d={IC[{ architecture: 'dCloud', flowchart: 'dFlow', sequence: 'dSeq', erd: 'dErd' }[d.type] || 'diagram']} />{trunc(d.name, 32)}
          </button>
          <button onClick={focusAI}><Ico d={IC.ai} />AI Chat</button>
          <button aria-pressed={drawer} onClick={() => setDrawer(o => !o)}><Ico d={IC.braces} />Code Editor</button>
        </div>
      )}

      {d.type === 'erd' && field && !selShapes.length && !editing && (() => {
        const col = getColumn(d.code, field.t, field.f);
        return col && (
          <FieldBar key={field.t + '.' + field.f} table={field.t} col={col}
            onChange={columnSet} onAdd={columnAdd} onDelete={columnDelete}
            onMove={columnMove} onTable={() => setSelField(null)} />
        );
      })()}

      {d.type === 'erd' && sel && !field && !selShapes.length && !editing && ctx.m.tables.get(sel) && (() => {
        const t = ctx.m.tables.get(sel), ic = tableIcon(t.icon);
        return (
          <TableBar key={sel} table={{ ...t, iconBody: ic.body, iconVb: ic.vb }} packs={packs}
            hue={tableHue(t, [...ctx.m.tables.keys()].indexOf(sel), d.style === 'mono')}
            onRename={to => renameNode(sel, to)} onAttr={(k, v) => tableAttr(sel, k, v)}
            onCode={() => setDrawer(true)} onDelete={() => removeTable(sel)} onAddColumn={columnAdd} />
        );
      })()}

      {diagSel && !selection.length && diagBox && (
        <DiagramBar name={d.name} type={d.type} notation={notationOf(d.code)} directional={E.directional} dir={d.dir} mono={d.style === 'mono'}
          onReset={tidy} onRename={v => updateDiagram(x => { x.name = v.slice(0, 40); })}
          onNotation={v => setCode(setNotation(dRef.current.code, v))} onDir={toggleDir} onMono={toggleStyle}
          onCode={() => setDrawer(true)} onAI={focusAI}
          more={d.type === 'erd'
            ? [...(d.live ? [{ label: 'Refresh from the database', note: 'Read the live schema again', icon: IC.dErd, act: refreshLive }] : []),
              { label: 'Export as SQL', icon: IC.download, items: sqlMenu }, { label: 'Import SQL…', icon: IC.upload, items: [
                { label: 'Open a .sql file…', act: openSqlFile }, { label: 'Paste SQL…', act: importSql }] }]
            : [{ label: 'Generate ER diagram from this', note: 'AI designs the tables behind it', icon: IC.dErd, act: diagramToErd },
              { label: 'Database schema from a .sql file…', note: 'Opens in a new tab', icon: IC.upload, act: openSqlFile }]} />
      )}

      {selShapes.length > 0 && !editing && (
        <SelBar shapes={selShapes} single={selS} act={{
          patch: patchSel, text: patchText, edit: startEdit, comment: addComment, route: setRoute,
          straighten: () => putShapes(baseShapes().map(x => (selSet.has(x.id) ? { ...x, pts: [x.pts[0], x.pts[x.pts.length - 1]] } : x))),
          order: reorder, step, figure: createFigure, duplicate: duplicateSel, remove: removeSel, group: groupSel, ungroup: ungroupSel,
          copyPng, copySvg, exportPng, copyStyles, pasteStyles,
          convert: selShapes.some(x => drawn.includes(x)) ? { hasCode: !!d.code.trim(), type: d.type, run: (t, newTab) => convertDrawing(t, selShapes, newTab) } : null,
        }} />
      )}

      <div className="zoom" role="group" aria-label="Zoom">
        <button onClick={() => zoomCenter(1.2)} aria-label="Zoom in">+</button>
        <button onClick={() => zoomCenter(1 / 1.2)} aria-label="Zoom out">−</button>
        <button className="pct" onClick={e => zoomMenu(e.currentTarget)} aria-haspopup="menu" aria-label={`Zoom ${Math.round(view.k * 100)}%, zoom options`}>{Math.round(view.k * 100)}%</button>
        <button onClick={undo} disabled={hist.i <= 0} aria-label="Undo (Ctrl Z)" title="Undo  Ctrl Z"><Ico d={IC.undo} /></button>
        <button onClick={redo} disabled={hist.i >= hist.stack.length - 1} aria-label="Redo (Ctrl Y)" title="Redo  Ctrl Y"><Ico d={IC.redo} /></button>
        <button className="kbtn" onClick={() => setShowKeys(true)} aria-label="Keyboard shortcuts (?)" title="Keyboard shortcuts  ?">?</button>
      </div>

      {tool !== 'select' && HINTS[tool] && !selShapes.length && (
        <div className="hint" role="status"><span>{HINTS[tool]}</span><kbd>Esc</kbd></div>
      )}

      {showKeys && (
        <div className="modal" onClick={e => { if (e.target === e.currentTarget) setShowKeys(false); }}
          onKeyDown={e => { if (e.key === 'Escape' || e.key === '?') setShowKeys(false); }}>
          <div className="mbox keys" role="dialog" aria-modal="true" aria-labelledby="keysTitle">
            <h3 id="keysTitle">Keyboard shortcuts</h3>
            <div className="kcols">
              {SHORTCUTS.map(([title, rows]) => (
                <section key={title}>
                  <h4>{title}</h4>
                  {rows.map(([k, v]) => <div className="krow" key={v}><span>{v}</span><kbd>{k}</kbd></div>)}
                </section>
              ))}
            </div>
            <div className="mact"><button className="btn dark" autoFocus onClick={() => setShowKeys(false)}>Done</button></div>
          </div>
        </div>
      )}

      {drawer && (
        <aside className="drawer" aria-label="Code editor">
          <div className="dhead">
            <Ico d={IC[CODE_TITLE[d.type]?.[2] || 'diagram']} />
            <strong>{CODE_TITLE[d.type]?.[0] || 'Diagram'}</strong>
            <span className="dsub">{CODE_TITLE[d.type]?.[1]}</span>
            <button className="ai-ib" aria-label="Copy code" title="Copy code" onClick={copyCode}><Ico d={IC.copy} /></button>
            <button className="ai-ib" aria-label="Close code editor" title="Close" onClick={() => setDrawer(false)}><Ico d={IC.close} /></button>
          </div>
          {drawn.length > 0 && (
            <div className="code-convert">
              <span>{drawn.length} drawn shape{drawn.length === 1 ? '' : 's'} on the canvas {drawn.length === 1 ? 'isn’t' : 'aren’t'} in the code yet.</span>
              <button className="btn" onClick={() => convertDrawing(d.type, drawn)}>Convert to code</button>
            </div>
          )}
          <div className="code-ed">
            <div className="code-gut" ref={gutRef} aria-hidden="true">
              {d.code.split('\n').map((_, i) => <div key={i} className={errLines.has(i + 1) ? 'err' : undefined}>{i + 1}</div>)}
            </div>
            <div className="code-area">
              <pre className="code-hl" ref={hlRef} aria-hidden="true" dangerouslySetInnerHTML={{ __html: highlight(d.code, d.type) + '\n' }} />
              <textarea id="code" ref={codeRef} value={d.code} spellCheck="false" autoCapitalize="off" autoComplete="off" aria-label="Diagram code" autoFocus wrap="off"
                placeholder={HELP_HINT[d.type]}
                onChange={e => onCodeInput(e.target.value)} onScroll={syncCode}
                onKeyDown={e => {
                  if (e.key === 'Tab') {
                    e.preventDefault();
                    const t = e.target, s = t.selectionStart;
                    onCodeInput(t.value.slice(0, s) + '  ' + t.value.slice(t.selectionEnd));
                    requestAnimationFrame(() => { t.selectionStart = t.selectionEnd = s + 2; });
                  }
                }} />
            </div>
          </div>
          {errs.length > 0 && (
            <div className="errs" role="status"
              dangerouslySetInnerHTML={{ __html: errs.map(x => `Line ${x.line} isn’t recognized: <code>${esc(trunc(x.text, 60))}</code>`).join('<br>') }} />
          )}
          {codeHelp && (
            <div className="code-help">
              <pre>{helpText}</pre>
              <button className="link" onClick={() => onGuide(d.type === 'erd' ? 'erd' : 'app')}>{d.type === 'erd' ? 'Open the full database schema guide' : 'Open the full guide'}</button>
            </div>
          )}
          <div className="code-foot">
            <button className="code-q" aria-pressed={codeHelp} aria-label="How the code works" title="How the code works" onClick={() => setCodeHelp(o => !o)}>&lt;?&gt;</button>
            <div className="code-cheat" aria-label={d.type === 'erd' ? 'Insert a relationship' : 'Insert a connection'}>
              {(CHEATS[d.type] || CHEATS.architecture).map(([op, n]) => (
                <button key={op} onClick={() => insertCode(` ${op} `)} title={`Insert “${op}” (${n})`}><code>{op}</code>{n}</button>
              ))}
            </div>
            <button className="ai-ib" aria-haspopup="menu" aria-label="Download" title="Download" onClick={e => popup(e.currentTarget, [
              { label: 'Download code', note: slug(d.name) + '.txt', act: () => downloads.save({ filename: slug(file.title) + '-' + slug(d.name) + '.txt', data: d.code }) },
              { label: 'Copy code', act: copyCode },
              ...(d.type === 'erd' ? ['-', ...sqlMenu, '-', { label: 'Open a .sql file…', icon: IC.upload, act: openSqlFile }, { label: 'Paste SQL…', icon: IC.upload, act: importSql }] : []),
            ])}><Ico d={IC.download} /><Ico d={IC.caret} className="caret" /></button>
          </div>
        </aside>
      )}

      {aiOpen && visible && (
        <AIChat chat={chats[0]} chats={chats} busy={busy} status={status} aiOff={aiOff}
          hasDoc={!!(file.doc && file.doc.trim())} selLabel={selLabel} onClearSel={() => setSelection([])}
          onSend={send} onStop={() => ctl.current?.abort()} onNew={startChat} onLoad={loadChat}
          onClose={() => onAIOpen(false)} focusKey={aiFocus} />
      )}
    </div>
  );
}
