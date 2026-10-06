import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { TEMPLATES, TYPES, engineOf, prep } from '../lib/engines.js';
import { NO_AI, copyFor, langFor, sampleP } from '../lib/ai.js';
import { HELP } from '../lib/help.js';
import { saveImage, useImages } from '../lib/images.js';
import { esc, rid, trunc } from '../lib/utils.js';
import {
  COLOR_NAMES, DEVICES, KEEP_RATIO, SHAPE_LIST, bbox, colorOf, contains, drawn, dropDeadLinks, editBox, handlesMarkup,
  hasText, icons, isLink, make, marqueeMarkup, measure, moved, outlinesMarkup, overlaps, resized, resolveLinks, selKey,
  shapeAt, shapeBounds, shapeIcon, shapesMarkup, targetMarkup, unionBox,
} from '../lib/shapes.js';
import { IC, Ico, InsertPanel, TOOL_KEYS, Toolbar } from './Toolbar.jsx';
import { useUI } from './ui.jsx';

const PLACEHOLDER = {
  architecture: 'Describe a system, paste Terraform, or ask for a change',
  flowchart: 'Describe a process, or ask for a change',
  sequence: 'Describe an interaction between services',
  erd: 'Describe your data, paste SQL, or ask for a change',
};
const NO_SHAPES = [];
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
const SHORTCUTS = [
  ['Tools', [['V', 'Select'], ['H', 'Hand'], ['R', 'Rectangle'], ['O', 'Ellipse'], ['A', 'Arrow'], ['L', 'Line'], ['D', 'Draw'], ['T', 'Text'], ['I', 'Icon'], ['F', 'Frame'], ['C', 'Comment']]],
  ['Canvas', [['/', 'Insert menu'], ['Ctrl J', 'Ask AI'], ['Space + drag', 'Pan'], ['+  −', 'Zoom in / out'], ['Shift 1', 'Zoom to fit'], ['Shift 0', 'Zoom to 100%'], ['Ctrl Z', 'Undo'], ['Ctrl Y', 'Redo']]],
  ['Selection', [['Shift + drag', 'Select an area'], ['Shift + click', 'Add or remove'], ['Ctrl A', 'Select all'], ['Ctrl D', 'Duplicate'], ['Delete', 'Delete'], ['Enter', 'Edit text'], ['Arrow keys', 'Nudge (Shift: 10px)'], ['Esc', 'Deselect / cancel']]],
];

// One canvas per diagram. The parent keys it by diagram id, so switching tabs starts fresh.
export default function Canvas({ file, d, visible, updateDiagram, history, onAddDiagram }) {
  const { toast, theme, popup } = useUI();
  const svgRef = useRef(null), stageRef = useRef(null), dockRef = useRef(null), promptRef = useRef(null), fileRef = useRef(null);
  const dRef = useRef(d);
  dRef.current = d;

  const [view, setView] = useState({ x: 0, y: 0, k: 1 });
  const viewRef = useRef(view);
  viewRef.current = view;
  const [dragManual, setDragManual] = useState(null);
  const [drawer, setDrawer] = useState(false);
  const [log, setLog] = useState([]);
  const [prompt, setPrompt] = useState('');
  const [status, setStatus] = useState({ text: '', busy: false });
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

  const markup = useMemo(() => ctx.E.markup(ctx, sel), [ctx, sel]);
  const layers = useMemo(() => shapesMarkup(shapes, { editing }), [shapes, editing, theme, imgV]); // eslint-disable-line react-hooks/exhaustive-deps
  const overlay = (() => {
    if (editing) return '';
    const k = view.k;
    let m = selS ? handlesMarkup(selS, k)
      : selection.length > 1 ? outlinesMarkup([...selShapes.map(bbox), ...selNodes.map(nodeRect).filter(Boolean)], k) : '';
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
    next = dropDeadLinks(next);
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
    const left = drawer && wide ? 410 : 66, right = 62, top = 54;
    const bottom = (dockRef.current?.offsetHeight || 80) + 26 + (drawer && !wide ? r.height * 0.66 : 0);
    const aw = Math.max(80, r.width - left - right), ah = Math.max(80, r.height - top - bottom);
    const k = Math.max(0.15, Math.min(1.2, aw / b.w, ah / b.h));
    moveView({ k, x: left + (aw - b.w * k) / 2 - b.x * k, y: top + (ah - b.h * k) / 2 - b.y * k }, smooth === true);
  }, [ctx, drawer, shapes, moveView]);

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
    if (s.t === 'text') Object.assign(n, measure(text, s.fs || 20));
    putShapes(base.map(x => (x.id === id ? n : x)));
  };
  const place = (t, extra, at) => {
    const c = at || center(), s = make(t, c.x, c.y, extra);
    putShapes([...(dRef.current.shapes || []), s]);
    setSelection([s.id]); setTool('select');
    return s;
  };
  const patchSel = p => {
    if (!selShapes.length) return;
    putShapes(baseShapes().map(s => (selSet.has(s.id) ? { ...s, ...p } : s)));
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
    const copies = src.map(s => {
      const c = { ...moved(s, 24, 24), id: map.get(s.id) };
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
  const startMove = (keys, key, w, at) => {
    drag.current = {
      t: 'move', key, keys: new Set(keys), a: w, shapes: baseShapes(),
      nodes: keys.filter(k => k.startsWith(NODE)).map(k => k.slice(NODE.length)).filter(id => ids.has(id)).map(id => ({ id, p: ctx.P(id) })),
      ...at,
    };
    setGrabbing(true);
  };
  // Click (or shift-click) on a shape or node.
  const pickItem = (key, e, w, at) => {
    if (e.shiftKey) {
      const next = selSet.has(key) ? selection.filter(k => k !== key) : [...selection, key];
      setSelection(next);
      if (next.includes(key)) startMove(next, null, w, at);
      return;
    }
    const keys = selSet.has(key) ? selection : [key];
    if (!selSet.has(key)) setSelection(keys);
    startMove(keys, key, w, at);
  };

  const onPointerDown = e => {
    if (e.button > 1) return;
    cancelAnimationFrame(animRef.current);
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
      const now = Date.now(), lt = lastTap.current;
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
    if (n) { pickItem(NODE + n.dataset.node, e, w, at); return; }

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
      setSelection([...new Set([...dr.keep, ...hit])]);
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
        } else if (dr.key && selection.length > 1) setSelection([dr.key]); // plain click inside a group picks one
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
  const focusAI = () => { setPanel(null); promptRef.current?.focus(); };

  /* ---- keyboard ---- */
  useEffect(() => {
    if (!visible) return;
    const key = e => {
      if (document.querySelector('.modal')) return;
      const inField = e.target.closest && e.target.closest('textarea,input,button,select');
      const typing = e.target.closest && e.target.closest('textarea,input');
      const mod = e.metaKey || e.ctrlKey, k = e.key.toLowerCase();
      if (mod && k === 'j') { e.preventDefault(); focusAI(); return; }
      if (e.key === ' ' && !inField) { e.preventDefault(); if (!spaceRef.current) { spaceRef.current = true; setSpace(true); } return; }
      if (typing) return;
      if (mod && k === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
      if (mod && k === 'y') { e.preventDefault(); redo(); return; }
      if (mod && k === 'a') { e.preventDefault(); selectAll(); return; }
      if (mod && k === 'd' && selShapes.length) { e.preventDefault(); duplicateSel(); return; }
      if (mod || e.altKey) return;
      if (e.key === '/') { e.preventDefault(); setPanel(p => (p == null ? '' : null)); return; }
      if (e.key === '?') { e.preventDefault(); setShowKeys(true); return; }
      if (e.key === '+' || e.key === '=') { e.preventDefault(); zoomCenter(1.25); return; }
      if (e.key === '-' || e.key === '_') { e.preventDefault(); zoomCenter(0.8); return; }
      if (e.shiftKey && e.code === 'Digit1') { e.preventDefault(); fit(true); return; }
      if (e.shiftKey && e.code === 'Digit0') { e.preventDefault(); zoomTo(1); return; }
      if (e.key === 'Escape') { setSelection([]); setTool('select'); setPanel(null); return; }
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

  /* ---- AI ---- */
  const addLog = (cls, text) => setLog(l => [...l, { cls, text, id: Math.random() }].slice(-12));
  const logRef = useRef(null);
  useEffect(() => { if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight; }, [log]);

  const generate = async () => {
    if (ctl.current) { ctl.current.abort(); return; }
    const text = prompt.trim();
    if (!text) return;
    const sample = await sampleP;
    if (!sample) { setStatus({ text: NO_AI }); return; }
    addLog('u', trunc(text, 240));
    setPrompt('');
    ctl.current = new AbortController();
    setBusy(true); setStatus({ text: 'Drawing', busy: true });
    const name = TYPES[d.type].name.toLowerCase();
    const others = file.diagrams.filter(x => x.id !== d.id && x.code && x.code.trim())
      .map(x => `"${x.name}" (${TYPES[x.type]?.name}):\n${x.code}`).join('\n\n');
    const selLabel = sel && E.label ? E.label(ctx.m, sel) : '';
    let p = `You draw ${name} diagrams in Linework.\n\n${langFor(d.type)}\n\nIf the input is code or config (Terraform, SQL, YAML, source code), diagram what it defines. When changing an existing diagram, keep existing ids and everything the request doesn't touch.\n\n`;
    p += d.code.trim() ? `Current diagram code:\n<<<\n${d.code}\n>>>\n\n` : 'There is no diagram yet. Create a new one.\n\n';
    if (selLabel) p += `The user has selected "${sel}" (${selLabel}); the request most likely refers to it.\n\n`;
    if (file.doc && file.doc.trim()) p += `The file's design doc, for context:\n<<<\n${file.doc.slice(0, 6000)}\n>>>\n\n`;
    if (others) p += `Other diagrams in this file, for context:\n${others.slice(0, 6000)}\n\n`;
    p += `Request:\n<<<\n${text}\n>>>\n\nReply with ONLY a JSON object, no markdown fences: {"reply": "<one short sentence saying what you drew or changed>", "code": "<the complete diagram code>"}`;
    try {
      const res = await sample.json(p, { signal: ctl.current.signal, cache: false, modelTier: 'default' });
      if (!res || typeof res.code !== 'string' || !engineOf(d).parse(res.code).count) throw { code: 'empty' };
      setCode(res.code.trim(), { fit: true });
      addLog('a', typeof res.reply === 'string' && res.reply ? res.reply : 'Diagram updated.');
      setStatus({ text: '' });
    } catch (e) {
      addLog('e', copyFor(e && e.code));
      setStatus({ text: '' });
    } finally {
      ctl.current = null; setBusy(false);
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
  const tree = [
    { key: 'ai', icon: 'ai', label: 'AI chat', note: 'Ask AI to draw or change this diagram', act: focusAI },
    { key: 'code', icon: 'diagram', label: 'Diagram as code', note: 'Create diagrams using code', children: Object.entries(TYPES).map(([k, v]) => ({
      key: 'code-' + k, icon: 'diagram', label: v.name,
      note: k === d.type ? 'Open the code for this diagram' : isBlank ? 'Switch this diagram and open its code' : 'Add a new diagram tab',
      act: () => (k === d.type ? setDrawer(true) : loadDiagram(k, v.name, '')),
    })) },
    { key: 'catalog', icon: 'catalog', label: 'Diagram catalog', note: 'Start from a ready-made diagram', children: TEMPLATES.filter(t => t.key !== 'blank' && t.key !== 'doc').map(t => ({
      key: 'cat-' + t.key, icon: 'catalog', label: t.name, note: t.note,
      act: () => { const x = t.make().diagrams[0]; loadDiagram(x.type, x.name, x.code); },
    })) },
    { key: 'shape', icon: 'shapes', label: 'Shape', note: 'Explore shapes', children: SHAPE_LIST.map(s => ({
      key: 'sh-' + s.t, svg: shapeIcon(s.t), label: s.name, act: () => place(s.t),
    })) },
    { key: 'icon', icon: 'smile', label: 'Icon', note: `${Object.keys(iconSet).length} icons available`, grid: true, children: Object.keys(iconSet).map(k => ({
      key: 'ic-' + k, glyph: iconSet[k], label: k, act: () => place('icon', { v: k }),
    })) },
    { key: 'device', icon: 'device', label: 'Device frame', note: 'Phone, tablet, browser frames', children: DEVICES.map(x => ({
      key: 'dev-' + x.v, svg: DEVICE_ICON[x.v], label: x.name, act: () => place('device', { v: x.v }),
    })) },
    { key: 'figure', icon: 'frame', label: 'Figure', note: 'A labeled frame to group things', tile: true, act: () => place('frame', { text: 'Figure' }) },
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
          paddingTop: (b.pad || 0) * k, paddingLeft: (b.padX || 0) * k, paddingRight: (b.padX || 0) * k,
        }}
        onFocus={e => { const t = e.target; t.selectionStart = t.selectionEnd = t.value.length; }}
        onChange={e => setDraft(e.target.value)}
        onBlur={finishEdit}
        onKeyDown={e => {
          if (e.key === 'Escape' || (e.key === 'Enter' && (e.metaKey || e.ctrlKey))) { e.preventDefault(); e.target.blur(); }
          else if (e.key === 'Enter' && !e.shiftKey && editS.t !== 'text' && editS.t !== 'code' && editS.t !== 'sticky' && editS.t !== 'comment') { e.preventDefault(); e.target.blur(); }
          else if (e.key === 'Tab' && editS.t === 'code') {
            e.preventDefault();
            const t = e.target, s = t.selectionStart, v = t.value.slice(0, s) + '  ' + t.value.slice(t.selectionEnd);
            setDraft(v); requestAnimationFrame(() => { t.selectionStart = t.selectionEnd = s + 2; });
          }
        }} />
    );
  }

  return (
    <div className={'cwrap' + (drawer ? ' has-drawer' : '')}
      onDragOver={e => { if ([...e.dataTransfer.types].includes('Files')) e.preventDefault(); }}
      onDrop={e => {
        const f = [...e.dataTransfer.files].find(x => /^image\//.test(x.type));
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

      <Toolbar tool={tool} onTool={pickTool} panelOpen={panel != null} onInsert={() => setPanel(p => (p == null ? '' : null))} onAI={focusAI} />
      {panel != null && <InsertPanel tree={tree} start={panel} onClose={closePanel} />}
      <input ref={fileRef} type="file" accept="image/*" hidden onChange={e => { addImageFile(e.target.files[0]); e.target.value = ''; }} />

      <div className="ctools">
        <button className="btn" aria-pressed={drawer} onClick={() => setDrawer(o => !o)}>Code</button>
        {E.directional && <button className="btn" onClick={toggleDir} aria-label={'Layout direction: ' + (d.dir === 'TB' ? 'Vertical' : 'Horizontal')}>{d.dir === 'TB' ? 'Vertical' : 'Horizontal'}</button>}
        {E.draggable && <button className="btn" onClick={tidy}>Tidy layout</button>}
        <button className="btn" onClick={toggleStyle} aria-label={'Diagram style: ' + (d.style === 'mono' ? 'Mono' : 'Color')}>{d.style === 'mono' ? 'Mono' : 'Color'}</button>
      </div>

      {selShapes.length > 0 && !editing && (
        <div className="sbar" role="toolbar" aria-label={selShapes.length > 1 ? `${selShapes.length} objects selected` : 'Selected object'}>
          {selShapes.length > 1 && <span className="scount">{selShapes.length} selected</span>}
          {selShapes.some(s => s.t !== 'image') && COLOR_NAMES.map((n, i) => (
            <button key={n} className="sw" style={{ background: colorOf(i) }} aria-label={n + ' color'} title={n}
              aria-pressed={selShapes.every(s => (s.c || 0) === i)} onClick={() => patchSel({ c: i })} />
          ))}
          {selS && selS.t === 'text' && (<>
            <span className="sep" />
            <button className="sbtn" aria-label="Smaller text" onClick={() => { const fs = Math.max(8, (selS.fs || 20) - 4); patchSel({ fs, ...measure(selS.text, fs) }); }}>A−</button>
            <button className="sbtn" aria-label="Larger text" onClick={() => { const fs = Math.min(200, (selS.fs || 20) + 4); patchSel({ fs, ...measure(selS.text, fs) }); }}>A+</button>
            <button className="sbtn" aria-pressed={!!selS.bold} onClick={() => patchSel({ bold: !selS.bold })}><b>B</b></button>
          </>)}
          {selS && (selS.t === 'line' || selS.t === 'arrow' || selS.t === 'rect' || selS.t === 'ellipse' || selS.t === 'diamond') && (
            <button className="sbtn" aria-pressed={!!selS.dash} onClick={() => patchSel({ dash: !selS.dash })}>Dashed</button>
          )}
          {selS && isLink(selS) && (
            <>{selS.pts.length > 2 && (<>
              <button className="sbtn" aria-pressed={!!selS.sharp} onClick={() => patchSel({ sharp: !selS.sharp })} title="Sharp corners at bend points">Sharp</button>
              <button className="sbtn" onClick={() => patchSel({ pts: [selS.pts[0], selS.pts[selS.pts.length - 1]] })} title="Remove all bend points">Straighten</button>
            </>)}
            <button className="sbtn" aria-pressed={!!selS.anim} onClick={() => patchSel({ anim: selS.anim ? 0 : 1 })} title="Flowing dashes along the line">Animate</button>
            {!!selS.anim && <button className="sbtn" aria-pressed={selS.anim === 'fast'} onClick={() => patchSel({ anim: selS.anim === 'fast' ? 1 : 'fast' })}>Fast</button>}
            <button className="sbtn" onClick={() => patchSel({ t: selS.t === 'line' ? 'arrow' : 'line' })}>{selS.t === 'line' ? 'Add arrow' : 'No arrow'}</button></>
          )}
          <span className="sep" />
          {selS && hasText(selS) && <button className="sbtn" onClick={() => startEdit(selS)}>Edit text</button>}
          <button className="sbtn" onClick={() => reorder(true)} title="Bring to front">Front</button>
          <button className="sbtn" onClick={() => reorder(false)} title="Send to back">Back</button>
          <button className="sbtn" onClick={duplicateSel} title="Duplicate (Ctrl D)">Duplicate</button>
          <button className="sbtn danger" onClick={removeSel} title="Delete (Del)">Delete</button>
        </div>
      )}

      <div className="zoom" role="group" aria-label="Zoom">
        <button onClick={() => zoomCenter(1.2)} aria-label="Zoom in">+</button>
        <button onClick={() => zoomCenter(1 / 1.2)} aria-label="Zoom out">−</button>
        <button className="pct" onClick={e => zoomMenu(e.currentTarget)} aria-haspopup="menu" aria-label={`Zoom ${Math.round(view.k * 100)}%, zoom options`}>{Math.round(view.k * 100)}%</button>
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
        <aside className="drawer" aria-label="Diagram code">
          <div className="dhead">
            <strong>Diagram code</strong>
            <button className="link" onClick={copyCode}>Copy</button>
            <button className="link" onClick={() => setDrawer(false)}>Close</button>
          </div>
          <textarea id="code" value={d.code} spellCheck="false" autoCapitalize="off" autoComplete="off" aria-label="Diagram code" autoFocus
            onChange={e => onCodeInput(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Tab') {
                e.preventDefault();
                const t = e.target, s = t.selectionStart;
                onCodeInput(t.value.slice(0, s) + '  ' + t.value.slice(t.selectionEnd));
                requestAnimationFrame(() => { t.selectionStart = t.selectionEnd = s + 2; });
              }
            }} />
          {errs.length > 0 && (
            <div className="errs" role="status"
              dangerouslySetInnerHTML={{ __html: errs.map(x => `Line ${x.line} isn’t recognized: <code>${esc(trunc(x.text, 60))}</code>`).join('<br>') }} />
          )}
          <details className="help"><summary>How the code works</summary><pre>{helpText}</pre></details>
        </aside>
      )}

      <div className="dock" ref={dockRef}>
        {log.length > 0 && (
          <div className="log" ref={logRef} aria-live="polite">
            {log.map(l => <p key={l.id} className={l.cls}><span>{l.text}</span></p>)}
          </div>
        )}
        {selLabel && (
          <span className="chip">Editing {selLabel}<button onClick={() => setSelection([])} aria-label="Clear selection">×</button></span>
        )}
        <div className="row">
          <textarea id="prompt" ref={promptRef} rows={1} value={prompt} placeholder={PLACEHOLDER[d.type] || 'Describe a diagram'} aria-label="Ask AI to draw or change the diagram"
            style={{ height: Math.min(140, 22 + 20 * Math.max(1, prompt.split('\n').length)) }}
            onChange={e => setPrompt(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); generate(); } }} />
          <button className={'go' + (busy ? ' stop' : '')} onClick={generate}>{busy ? 'Stop' : empty ? 'Generate' : 'Update'}</button>
        </div>
        <div className="meta">
          <button className="link" onClick={undo} disabled={hist.i <= 0}>Undo</button>
          <button className="link" onClick={redo} disabled={hist.i >= hist.stack.length - 1}>Redo</button>
          <span className={'status' + (status.busy ? ' busy' : '')}>{status.text}</span>
        </div>
      </div>
    </div>
  );
}
