import { C, PAL, GLYPH } from './engines.js';
import { esc, rid, trunc } from './utils.js';
import { imageMissing, imageSrc } from './images.js';

/* Freehand objects drawn on top of a diagram: shapes, lines, text, icons, frames, images.
   Box objects have {x,y,w,h}; lines, arrows and pen strokes have pts:[[x,y],...].
   Colors are stored as an index (0 = ink, 1.. = palette) so they follow light/dark. */

const LH = 1.3, CW = .56, MIN = 12;

const EXTRA_ICONS = {
  lock:'<rect x="4" y="9" width="12" height="9" rx="1.5"/><path d="M7 9V6.5a3 3 0 0 1 6 0V9"/>',
  key:'<circle cx="6.5" cy="13.5" r="3.5"/><path d="M9 11 17 3M14 6l2 2M12 8l2 2"/>',
  mail:'<rect x="2.5" y="4.5" width="15" height="11" rx="1.5"/><path d="m3 5.5 7 5.5 7-5.5"/>',
  globe:'<circle cx="10" cy="10" r="7.5"/><path d="M2.5 10h15M10 2.5c2.2 2.3 3 4.8 3 7.5s-.8 5.2-3 7.5c-2.2-2.3-3-4.8-3-7.5s.8-5.2 3-7.5"/>',
  settings:'<circle cx="10" cy="10" r="2.5"/><path d="M10 2.5v2M10 15.5v2M2.5 10h2M15.5 10h2M4.7 4.7l1.4 1.4M13.9 13.9l1.4 1.4M4.7 15.3l1.4-1.4M13.9 6.1l1.4-1.4"/>',
  search:'<circle cx="8.5" cy="8.5" r="5"/><path d="m12.5 12.5 5 5"/>',
  bell:'<path d="M5 14V9a5 5 0 0 1 10 0v5l1.5 2h-13zM8.5 18h3"/>',
  chart:'<path d="M3 17h14M5.5 14V9M10 14V4.5M14.5 14v-7"/>',
  file:'<path d="M5 2.5h6.5l4 4v11H5z"/><path d="M11.5 2.5v4h4"/>',
  folder:'<path d="M2.5 5.5a1 1 0 0 1 1-1h4l2 2h7a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1h-13a1 1 0 0 1-1-1z"/>',
  cpu:'<rect x="5" y="5" width="10" height="10" rx="1.5"/><rect x="8" y="8" width="4" height="4"/><path d="M8 2.5V5M12 2.5V5M8 15v2.5M12 15v2.5M2.5 8H5M2.5 12H5M15 8h2.5M15 12h2.5"/>',
  wifi:'<path d="M2.5 7.5a10.5 10.5 0 0 1 15 0M5 10.5a7 7 0 0 1 10 0M7.5 13.3a3.5 3.5 0 0 1 5 0M10 16h.01"/>',
  shield:'<path d="M10 2.5 16 5v5c0 3.6-2.6 6.4-6 7.5-3.4-1.1-6-3.9-6-7.5V5z"/>',
  star:'<path d="m10 2.8 2.2 4.6 5 .7-3.6 3.5.9 5-4.5-2.4-4.5 2.4.9-5L2.8 8.1l5-.7z"/>',
  heart:'<path d="M10 16.5S3 12.5 3 7.5a3.5 3.5 0 0 1 7-1 3.5 3.5 0 0 1 7 1c0 5-7 9-7 9z"/>',
  check:'<path d="m4 10.5 4 4 8-9"/>',
  x:'<path d="m5 5 10 10M15 5 5 15"/>',
  alert:'<path d="M10 3 17.5 16.5h-15z"/><path d="M10 8v4M10 14.5h.01"/>',
  clock:'<circle cx="10" cy="10" r="7.5"/><path d="M10 5.5V10l3 2"/>',
  home:'<path d="M3 9.5 10 3.5l7 6M5 8v8.5h10V8"/>',
  terminal:'<rect x="2.5" y="3.5" width="15" height="13" rx="1.5"/><path d="m6 8 2.5 2L6 12M10.5 12.5H14"/>',
  branch:'<circle cx="6" cy="4.5" r="1.8"/><circle cx="6" cy="15.5" r="1.8"/><circle cx="14" cy="7" r="1.8"/><path d="M6 6.3v7.4M14 8.8c0 3-3 3.5-8 4.9"/>',
  code:'<path d="m7 6-4 4 4 4M13 6l4 4-4 4"/>',
  message:'<path d="M3 4.5h14v9H8l-4 3v-3H3z"/>',
  camera:'<path d="M2.5 6.5h3l1.5-2h6l1.5 2h3v9.5h-15z"/><circle cx="10" cy="11" r="3"/>',
  cart:'<path d="M2.5 3.5h2l2 9.5h9l1.5-7H6"/><circle cx="8" cy="16" r="1"/><circle cx="14.5" cy="16" r="1"/>',
  card:'<rect x="2.5" y="4.5" width="15" height="11" rx="1.5"/><path d="M2.5 8.5h15M5.5 12.5h3"/>',
  users:'<circle cx="7.5" cy="7" r="3"/><path d="M2 17c.6-3 2.7-4.5 5.5-4.5S12.4 14 13 17"/><circle cx="14" cy="6" r="2.4"/><path d="M14.5 11c2 .3 3.2 1.7 3.5 4"/>',
  box:'<path d="M10 2.5 17 6.5v7l-7 4-7-4v-7z"/><path d="m3 6.5 7 4 7-4M10 10.5v7"/>',
  network:'<rect x="8" y="2.5" width="4" height="4" rx=".8"/><rect x="2.5" y="13.5" width="4" height="4" rx=".8"/><rect x="13.5" y="13.5" width="4" height="4" rx=".8"/><path d="M10 6.5V10M4.5 13.5V10h11v3.5"/>',
  bot:'<rect x="4" y="6.5" width="12" height="9.5" rx="2"/><path d="M10 3.5v3M7.5 11h.01M12.5 11h.01M8 13.5h4"/>',
  download:'<path d="M10 3v10M6 9l4 4 4-4M3.5 16.5h13"/>',
  upload:'<path d="M10 13V3M6 7l4-4 4 4M3.5 16.5h13"/>',
  link:'<path d="M8.5 11.5a3 3 0 0 0 4.2 0l2.5-2.5a3 3 0 0 0-4.2-4.2l-1 1M11.5 8.5a3 3 0 0 0-4.2 0L4.8 11a3 3 0 0 0 4.2 4.2l1-1"/>',
};
// GLYPH lives in engines.js, which imports this file, so build the icon set on first use.
let _icons = null;
export const icons = () => _icons || (_icons = { ...GLYPH, ...EXTRA_ICONS });

export const SHAPE_LIST = [
  {t:'rect', name:'Rectangle'}, {t:'ellipse', name:'Ellipse'}, {t:'diamond', name:'Diamond'},
  {t:'triangle', name:'Triangle'}, {t:'hexagon', name:'Hexagon'}, {t:'para', name:'Parallelogram'},
  {t:'cylinder', name:'Cylinder'}, {t:'sticky', name:'Sticky note'},
  {t:'arrow', name:'Arrow'}, {t:'line', name:'Line'},
];
export const DEVICES = [
  {v:'phone', name:'Phone', w:300, h:610}, {v:'tablet', name:'Tablet', w:560, h:760},
  {v:'browser', name:'Browser', w:880, h:560}, {v:'desktop', name:'Desktop', w:900, h:640},
];
const SIZE = {rect:[160,90], ellipse:[140,100], diamond:[150,110], triangle:[140,110], hexagon:[160,96], para:[170,90],
  cylinder:[120,130], sticky:[180,160], frame:[480,320], code:[380,210], icon:[56,56]};
const CODE_SAMPLE = 'function greet(name) {\n  return `Hello, ${name}`;\n}';

export const COLOR_NAMES = ['Ink', 'Blue', 'Green', 'Orange', 'Purple', 'Red', 'Olive'];
export const colorOf = c => (!c ? C.ink : PAL[(c - 1) % PAL.length]);

export const isPath = s => !!s.pts;
const TEXT_KINDS = new Set(['rect','ellipse','diamond','triangle','hexagon','para','cylinder','sticky','frame','code','text','comment','line','arrow']);
export const hasText = s => TEXT_KINDS.has(s.t);
// Resizing these keeps their proportions.
export const KEEP_RATIO = new Set(['icon','image','text']);

/* ---- text ---- */
export function wrap(text, width, fs){
  const max = Math.max(1, Math.floor(width / (fs * CW))), out = [];
  String(text || '').split('\n').forEach(p => {
    let line = '';
    p.split(' ').forEach(w => {
      while(w.length > max){ if(line){ out.push(line); line = ''; } out.push(w.slice(0, max)); w = w.slice(max); }
      const t = line ? line + ' ' + w : w;
      if(t.length > max){ out.push(line); line = w; } else line = t;
    });
    out.push(line);
  });
  return out;
}
export function measure(text, fs){
  const ls = String(text || '').split('\n');
  return {w: Math.max(fs, Math.ceil(Math.max(...ls.map(l => l.length)) * fs * CW) + 6), h: Math.ceil(ls.length * fs * LH)};
}
function lines(ls, {x, y, fs, fill, anchor, weight, mono}){
  return ls.map((l, i) => `<text x="${x}" y="${(y + fs * .95 + i * fs * LH).toFixed(1)}" font-size="${fs}" fill="${fill}"`
    + (anchor ? ` text-anchor="${anchor}"` : '') + (weight ? ` font-weight="${weight}"` : '')
    + (mono ? ` font-family="JetBrains Mono, ui-monospace, monospace" xml:space="preserve" style="white-space:pre"` : '')
    + `>${esc(l)}</text>`).join('');
}
// Where text sits inside a box shape, relative to the shape.
const TF = {ellipse:.72, diamond:.56, triangle:.56, hexagon:.74, para:.76};
function inner(s, text){
  const fs = s.fs || 15, tw = Math.max(24, s.w * (TF[s.t] || 1) - 20), ls = wrap(text, tw, fs);
  const cy = s.t === 'triangle' ? s.h * .64 : s.h / 2;
  return {fs, tw, ls, top: cy - ls.length * fs * LH / 2};
}
const COMMENT_W = 220, COMMENT_FS = 13;
function commentCard(s, text){
  const ls = wrap(text, COMMENT_W, COMMENT_FS);
  return {ls, w: Math.min(COMMENT_W + 20, Math.max(...ls.map(l => l.length)) * COMMENT_FS * CW + 22), h: ls.length * COMMENT_FS * LH + 14};
}

/* ---- create ---- */
const r0 = n => Math.round(n);
export function make(t, cx, cy, extra = {}){
  const id = rid('s');
  if(t === 'line' || t === 'arrow') return {id, t, pts:[[r0(cx - 80), r0(cy)], [r0(cx + 80), r0(cy)]], ...extra};
  if(t === 'text'){ const fs = extra.fs || 20, text = extra.text || ''; return {id, t, x:r0(cx), y:r0(cy - fs * .65), fs, text, ...measure(text || ' ', fs)}; }
  if(t === 'comment') return {id, t, x:r0(cx), y:r0(cy - 28), w:28, h:28, text:''};
  const dev = t === 'device' && DEVICES.find(x => x.v === extra.v);
  const [w, h] = extra.w ? [extra.w, extra.h] : dev ? [dev.w, dev.h] : SIZE[t] || SIZE.rect;
  const s = {id, t, x:r0(cx - w / 2), y:r0(cy - h / 2), w, h, ...extra};
  if(t === 'frame' && !s.text) s.text = 'Frame';
  if(t === 'code' && s.text == null) s.text = CODE_SAMPLE;
  return s;
}
// A shape dragged out from a to b. Shift keeps squares square and lines on 45° steps.
export function drawn(t, a, b, shift, id){
  if(t === 'line' || t === 'arrow'){
    let x = b.x, y = b.y;
    if(shift){ const ang = Math.round(Math.atan2(y - a.y, x - a.x) / (Math.PI / 4)) * Math.PI / 4, d = Math.hypot(x - a.x, y - a.y); x = a.x + d * Math.cos(ang); y = a.y + d * Math.sin(ang); }
    return {id, t, pts:[[r0(a.x), r0(a.y)], [r0(x), r0(y)]]};
  }
  let w = Math.abs(b.x - a.x), h = Math.abs(b.y - a.y);
  if(shift) w = h = Math.max(w, h);
  const s = {id, t, x:r0(b.x < a.x ? a.x - w : a.x), y:r0(b.y < a.y ? a.y - h : a.y), w:r0(w), h:r0(h)};
  if(t === 'frame') s.text = 'Frame';
  return s;
}

/* ---- geometry ---- */
/* A line or arrow runs through all its pts: the two ends plus any bend points in between.
   It's drawn as a smooth curve through them, or with sharp corners when s.sharp is set. */
const lerp = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
// Cubic segments [from, c1, c2, to] of the path (Catmull-Rom, so the curve passes through every point).
export function segments(s){
  const p = s.pts, out = [];
  for(let i = 0; i < p.length - 1; i++){
    const a = p[i], b = p[i + 1];
    if(s.sharp || p.length === 2){ out.push([a, lerp(a, b, 1/3), lerp(a, b, 2/3), b]); continue; }
    const pa = p[i - 1] || a, pb = p[i + 2] || b;
    out.push([a, [a[0] + (b[0] - pa[0]) / 6, a[1] + (b[1] - pa[1]) / 6], [b[0] - (pb[0] - a[0]) / 6, b[1] - (pb[1] - a[1]) / 6], b]);
  }
  return out;
}
const bez = ([a, c1, c2, b], t) => {
  const u = 1 - t;
  return [u*u*u*a[0] + 3*u*u*t*c1[0] + 3*u*t*t*c2[0] + t*t*t*b[0], u*u*u*a[1] + 3*u*u*t*c1[1] + 3*u*t*t*c2[1] + t*t*t*b[1]];
};
// Middle of each segment, where the "add a bend" handles sit.
export const segMids = s => segments(s).map(g => bez(g, .5));
// Point halfway along the path (by segment count), for the label.
export function pathMid(s){
  const g = segments(s), n = g.length;
  return n % 2 ? bez(g[(n - 1) / 2], .5) : g[n / 2][0];
}
const f1 = n => +n.toFixed(1);
// SVG path data; endBack pulls the last point in so a line doesn't poke through its arrowhead.
function pathD(s, endBack){
  const g = segments(s), last = g[g.length - 1], straight = s.sharp || s.pts.length === 2;
  let d = `M${s.pts[0][0]} ${s.pts[0][1]}`;
  g.forEach((x, i) => {
    let b = x[3];
    if(i === g.length - 1 && endBack){
      const a = Math.atan2(b[1] - x[2][1], b[0] - x[2][0]);
      b = [f1(b[0] - endBack * Math.cos(a)), f1(b[1] - endBack * Math.sin(a))];
    }
    d += straight ? `L${b[0]} ${b[1]}` : `C${f1(x[1][0])} ${f1(x[1][1])} ${f1(x[2][0])} ${f1(x[2][1])} ${b[0]} ${b[1]}`;
  });
  return {d, from:last[2], to:last[3]};
}
// The previous version stored one sideways `bend`; turn it into a bend point.
function unbend(s){
  if(!s.bend || s.pts.length !== 2) return s;
  const [[x1, y1], [x2, y2]] = s.pts, len = Math.hypot(x2 - x1, y2 - y1) || 1;
  const m = [r0((x1 + x2) / 2 - (y2 - y1) / len * s.bend), r0((y1 + y2) / 2 + (x2 - x1) / len * s.bend)];
  const { bend, ...rest } = s;
  return {...rest, pts:[s.pts[0], m, s.pts[1]]};
}
export function bbox(s){
  if(s.pts){
    const pts = s.pts;
    const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
    const x = Math.min(...xs), y = Math.min(...ys);
    return {x, y, w:Math.max(...xs) - x, h:Math.max(...ys) - y};
  }
  return {x:s.x, y:s.y, w:s.w, h:s.h};
}
export function unionBox(a, b){
  if(!a) return b || null; if(!b) return a;
  const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y);
  return {x, y, w:Math.max(a.x + a.w, b.x + b.w) - x, h:Math.max(a.y + a.h, b.y + b.h) - y};
}
export function shapeBounds(shapes){
  let b = null;
  (shapes || []).forEach(s => {
    let r = bbox(s);
    if(s.t === 'frame') r = {x:r.x, y:r.y - 30, w:r.w, h:r.h + 30};
    if(s.t === 'comment' && s.text){ const c = commentCard(s, s.text); r = unionBox(r, {x:s.x + 36, y:s.y - 2, w:c.w, h:c.h}); }
    b = unionBox(b, {x:r.x - 10, y:r.y - 10, w:r.w + 20, h:r.h + 20});
  });
  return b;
}
export function moved(s, dx, dy){
  return s.pts ? {...s, pts:s.pts.map(([x, y]) => [x + dx, y + dy])} : {...s, x:s.x + dx, y:s.y + dy};
}
// Resize from a handle: corner handles keep the opposite corner fixed; p0/p1 move a line end.
export function resized(o, handle, p, ratio){
  if(/^p\d+$/.test(handle)){ const pts = o.pts.map(q => [...q]); pts[+handle.slice(1)] = [r0(p.x), r0(p.y)]; return {...o, pts}; }
  const b = bbox(o);
  const fx = handle.includes('w') ? b.x + b.w : b.x, fy = handle.includes('n') ? b.y + b.h : b.y;
  let w = Math.max(MIN, Math.abs(p.x - fx)), h = Math.max(MIN, Math.abs(p.y - fy));
  if(ratio && b.w && b.h){ const r = b.w / b.h; if(w / h > r) h = w / r; else w = h * r; }
  const x = r0(p.x < fx ? fx - w : fx), y = r0(p.y < fy ? fy - h : fy);
  w = r0(w); h = r0(h);
  if(o.pts){
    const sx = w / (b.w || 1), sy = h / (b.h || 1);
    return {...o, pts:o.pts.map(([px, py]) => [r0(x + (px - b.x) * sx), r0(y + (py - b.y) * sy)])};
  }
  if(o.t === 'text'){
    const fs = Math.max(8, Math.min(200, Math.round((o.fs || 20) * h / (b.h || 1)))), m = measure(o.text || ' ', fs);
    return {...o, fs, w:m.w, h:m.h, x:r0(p.x < fx ? fx - m.w : fx), y:r0(p.y < fy ? fy - m.h : fy)};
  }
  return {...o, x, y, w, h};
}

/* ---- connected arrows ----
   A line or arrow end can attach to a box shape ({s:id}) or a diagram node ({n:id}) via a0/a1.
   Attached ends are recomputed from the target's position, so they follow it when it moves. */
const NO_ATTACH = new Set(['frame', 'comment']);
export const attachable = s => !s.pts && !NO_ATTACH.has(s.t);
export const isLink = s => s.t === 'line' || s.t === 'arrow';
// Topmost shape under a world point that an arrow end can attach to.
export function shapeAt(shapes, p, skip){
  for(let i = shapes.length - 1; i >= 0; i--){
    const s = shapes[i];
    if(s.id === skip || !attachable(s)) continue;
    if(p.x >= s.x - 4 && p.x <= s.x + s.w + 4 && p.y >= s.y - 4 && p.y <= s.y + s.h + 4) return s;
  }
  return null;
}
// Point on the outline of target t (rect r, kind) in the direction of `to`, with a small gap.
function edgePoint(r, kind, to){
  const cx = r.x + r.w / 2, cy = r.y + r.h / 2, dx = to[0] - cx, dy = to[1] - cy, hw = r.w / 2 || 1, hh = r.h / 2 || 1;
  const len = Math.hypot(dx, dy);
  if(len < 1) return [r0(cx), r0(cy)];
  const ax = Math.abs(dx), ay = Math.abs(dy);
  const t = kind === 'ellipse' ? 1 / Math.hypot(dx / hw, dy / hh)
    : kind === 'diamond' ? 1 / (ax / hw + ay / hh)
    : Math.min(ax ? hw / ax : Infinity, ay ? hh / ay : Infinity);
  const k = Math.min(1, t + 6 / len);
  return [r0(cx + dx * k), r0(cy + dy * k)];
}
// Returns the shapes with attached ends placed on their targets. nodeRect(id) gives a diagram node's box.
export function resolveLinks(shapes, nodeRect){
  if(!shapes.some(s => s.a0 || s.a1 || s.bend)) return shapes;
  shapes = shapes.map(s => (s.bend ? unbend(s) : s));
  const byId = new Map(shapes.map(s => [s.id, s]));
  const target = a => {
    if(!a) return null;
    if(a.s){ const t = byId.get(a.s); return t && attachable(t) ? {r:bbox(t), kind:t.t} : null; }
    const r = a.n && nodeRect ? nodeRect(a.n) : null;
    return r ? {r, kind:'rect'} : null;
  };
  const mid = x => [x.r.x + x.r.w / 2, x.r.y + x.r.h / 2];
  return shapes.map(s => {
    if(!isLink(s) || (!s.a0 && !s.a1)) return s;
    const A = target(s.a0), B = target(s.a1);
    if(!A && !B) return s;
    const n = s.pts.length, inner = s.pts.slice(1, -1);
    const ref0 = A ? mid(A) : s.pts[0], ref1 = B ? mid(B) : s.pts[n - 1];
    // Each attached end points toward its nearest bend point, or the other end.
    const p0 = A ? edgePoint(A.r, A.kind, inner.length ? inner[0] : ref1) : s.pts[0];
    const p1 = B ? edgePoint(B.r, B.kind, inner.length ? inner[inner.length - 1] : ref0) : s.pts[n - 1];
    return {...s, pts:[p0, ...inner, p1]};
  });
}
// Drop attachments to shapes that no longer exist (diagram nodes may come back, so keep those).
export function dropDeadLinks(shapes){
  const ids = new Set(shapes.map(s => s.id));
  return shapes.map(s => {
    const dead0 = s.a0 && s.a0.s && !ids.has(s.a0.s), dead1 = s.a1 && s.a1.s && !ids.has(s.a1.s);
    if(!dead0 && !dead1) return s;
    const n = {...s};
    if(dead0) delete n.a0;
    if(dead1) delete n.a1;
    return n;
  });
}
export const selKey = a => (a.s ? a.s : 'n:' + a.n);

// Dashed outlines for a multi-selection, the marquee, and an arrow's attach target.
export function outlinesMarkup(rects, k){
  return rects.map(r => `<rect x="${r.x - 5/k}" y="${r.y - 5/k}" width="${r.w + 10/k}" height="${r.h + 10/k}" rx="${4/k}" fill="none" stroke="${C.ink}" stroke-width="${1.4/k}" stroke-dasharray="${4/k} ${3/k}" pointer-events="none"/>`).join('');
}
export function marqueeMarkup(r, k){
  return `<rect x="${r.x}" y="${r.y}" width="${r.w}" height="${r.h}" fill="${C.hi}" fill-opacity=".1" stroke="${C.hi}" stroke-width="${1.2/k}" pointer-events="none"/>`;
}
export function targetMarkup(r, k){
  return `<rect x="${r.x - 4/k}" y="${r.y - 4/k}" width="${r.w + 8/k}" height="${r.h + 8/k}" rx="${8/k}" fill="${C.hi}" fill-opacity=".12" stroke="${C.hi}" stroke-width="${2.5/k}" pointer-events="none"/>`;
}
export const overlaps = (a, b) => a.x <= b.x + b.w && b.x <= a.x + a.w && a.y <= b.y + b.h && b.y <= a.y + a.h;
export const contains = (a, b) => b.x >= a.x && b.y >= a.y && b.x + b.w <= a.x + a.w && b.y + b.h <= a.y + a.h;

/* ---- render ---- */
const P = a => a.map(p => p.join(',')).join(' ');
const STILL = () => typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
function outline(t, w, h, attr, stroke){
  switch(t){
    case 'ellipse': return `<ellipse cx="${w/2}" cy="${h/2}" rx="${w/2}" ry="${h/2}" ${attr}/>`;
    case 'diamond': return `<polygon points="${P([[w/2,0],[w,h/2],[w/2,h],[0,h/2]])}" ${attr}/>`;
    case 'triangle': return `<polygon points="${P([[w/2,0],[w,h],[0,h]])}" ${attr}/>`;
    case 'hexagon': { const i = Math.min(w * .25, h * .45); return `<polygon points="${P([[i,0],[w-i,0],[w,h/2],[w-i,h],[i,h],[0,h/2]])}" ${attr}/>`; }
    case 'para': { const i = Math.min(w * .2, 22); return `<polygon points="${P([[i,0],[w,0],[w-i,h],[0,h]])}" ${attr}/>`; }
    case 'cylinder': { const r = Math.min(14, h * .18); return `<path d="M0 ${r}A${w/2} ${r} 0 0 1 ${w} ${r}V${h-r}A${w/2} ${r} 0 0 1 0 ${h-r}Z" ${attr}/><path d="M0 ${r}A${w/2} ${r} 0 0 0 ${w} ${r}" fill="none" ${stroke}/>`; }
    default: return `<rect width="${w}" height="${h}" rx="8" ${attr}/>`;
  }
}
// Small preview for menus, drawn with currentColor in a 24px box.
export function shapeIcon(t){
  if(t === 'line') return '<path d="M5 19 19 5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>';
  if(t === 'arrow') return '<path d="M5 19 19 5M10 5h9v9" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>';
  if(t === 'sticky') return '<path d="M4 4h16v11l-5 5H4z M15 20v-5h5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>';
  const st = 'stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"';
  return `<g transform="translate(3 5)">${outline(t, 18, 14, `fill="none" ${st}`, st)}</g>`;
}
function smooth(pts){
  if(pts.length < 3) return 'M' + pts.map(p => p.join(' ')).join('L');
  let d = `M${pts[0][0]} ${pts[0][1]}`;
  for(let i = 1; i < pts.length - 1; i++){
    const [x, y] = pts[i], [nx, ny] = pts[i + 1];
    d += `Q${x} ${y} ${(x + nx) / 2} ${(y + ny) / 2}`;
  }
  const l = pts[pts.length - 1];
  return d + `L${l[0]} ${l[1]}`;
}
function head(x1, y1, x2, y2, col){
  const a = Math.atan2(y2 - y1, x2 - x1), L = 13, W = 6, c = Math.cos(a), s = Math.sin(a);
  return `<polygon points="${x2},${y2} ${(x2 - L*c + W*s).toFixed(1)},${(y2 - L*s - W*c).toFixed(1)} ${(x2 - L*c - W*s).toFixed(1)},${(y2 - L*s + W*c).toFixed(1)}" fill="${col}"/>`;
}
function device(s, col){
  const {w, h} = s, st = `stroke="${col}" stroke-width="2"`;
  if(s.v === 'phone' || s.v === 'tablet'){
    const r = s.v === 'phone' ? Math.min(40, w * .14) : Math.min(30, w * .06), i = s.v === 'phone' ? Math.max(8, w * .04) : Math.max(12, w * .035);
    let m = `<rect width="${w}" height="${h}" rx="${r}" fill="${C.surface}" ${st}/><rect x="${i}" y="${i}" width="${w-2*i}" height="${h-2*i}" rx="${Math.max(4, r-i)}" fill="${C.paper}" stroke="${C.line}"/>`;
    m += s.v === 'phone' ? `<rect x="${w*.35}" y="${i+8}" width="${w*.3}" height="${Math.max(6, w*.05)}" rx="${Math.max(3, w*.025)}" fill="${col}"/>` : `<circle cx="${w/2}" cy="${i/2}" r="${Math.max(2, i/5)}" fill="${col}"/>`;
    return m;
  }
  if(s.v === 'desktop'){
    const sh = h * .84;
    return `<rect width="${w}" height="${sh}" rx="12" fill="${C.surface}" ${st}/><rect x="12" y="12" width="${w-24}" height="${sh-24}" rx="4" fill="${C.paper}" stroke="${C.line}"/>`
      + `<path d="M${w*.43} ${sh}L${w*.4} ${h-6}H${w*.6}L${w*.57} ${sh}" fill="${C.surface}" ${st}/><rect x="${w*.32}" y="${h-7}" width="${w*.36}" height="7" rx="3.5" fill="${C.surface}" ${st}/>`;
  }
  return `<rect width="${w}" height="${h}" rx="10" fill="${C.paper}" ${st}/><path d="M1 10a9 9 0 0 1 9-9h${w-20}a9 9 0 0 1 9 9v26H1z" fill="${C.surface}"/><path d="M0 36H${w}" stroke="${C.line}"/>`
    + [18, 34, 50].map(x => `<circle cx="${x}" cy="18" r="5" fill="${C.line}"/>`).join('')
    + `<rect x="70" y="9" width="${Math.max(20, w - 90)}" height="18" rx="9" fill="${C.paper}" stroke="${C.line}"/>`;
}
function one(s, opt){
  const col = colorOf(s.c), open = `<g data-shape="${esc(s.id)}"`, text = opt.editing === s.id ? '' : (s.text || '');
  if(s.t === 'line' || s.t === 'arrow'){
    const full = pathD(s, 0), line = pathD(s, s.t === 'arrow' ? 8 : 0), [mx, my] = pathMid(s);
    let m = `<path d="${full.d}" stroke="transparent" stroke-width="16" fill="none"/>`;
    // Animated lines show dashes flowing from start to end (still when the viewer prefers less motion).
    const flow = s.anim && !STILL();
    m += `<path d="${line.d}" stroke="${col}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none"${s.anim ? ' stroke-dasharray="9 7"' : s.dash ? ' stroke-dasharray="7 6"' : ''}>`
      + (flow ? `<animate attributeName="stroke-dashoffset" from="32" to="0" dur="${s.anim === 'fast' ? .45 : .9}s" repeatCount="indefinite"/>` : '') + `</path>`;
    if(s.t === 'arrow') m += head(line.from[0], line.from[1], full.to[0], full.to[1], col);
    if(text){
      const ls = wrap(text, 160, 13), tw = Math.max(...ls.map(l => l.length)) * 13 * CW + 14, th = ls.length * 13 * LH + 6;
      m += `<rect x="${mx - tw/2}" y="${my - th/2}" width="${tw}" height="${th}" rx="5" fill="${C.paper}"/>` + lines(ls, {x:mx, y:my - th/2 + 3, fs:13, fill:C.ink2, anchor:'middle'});
    }
    return `${open}>${m}</g>`;
  }
  if(s.t === 'pen'){
    const d = smooth(s.pts);
    return `${open}><path d="${d}" stroke="transparent" stroke-width="14" fill="none" stroke-linecap="round"/><path d="${d}" stroke="${col}" stroke-width="${s.sw || 2.5}" fill="none" stroke-linecap="round" stroke-linejoin="round"/></g>`;
  }
  const {w, h} = s;
  let m = '';
  switch(s.t){
    case 'frame': {
      const label = trunc(text, 60), lw = label.length * 13 * CW + 12;
      m = `<rect width="${w}" height="${h}" rx="12" fill="none" stroke="transparent" stroke-width="14"/><rect width="${w}" height="${h}" rx="12" fill="${col}" fill-opacity=".03" pointer-events="none" stroke="${col}" stroke-opacity=".7" stroke-width="1.5" stroke-dasharray="8 6"/>`;
      if(label) m += `<rect y="-28" width="${lw}" height="22" fill="transparent"/><text x="2" y="-11" font-size="13" font-weight="600" fill="${col}">${esc(label)}</text>`;
      break;
    }
    case 'text':
      m = `<rect width="${w}" height="${h}" fill="transparent"/>` + lines(text.split('\n'), {x:0, y:0, fs:s.fs || 20, fill:col, weight:s.bold ? 700 : 500});
      break;
    case 'sticky': {
      const fill = s.c ? col : C.hi, f = 22;
      m = `<path d="M0 0H${w}V${h-f}L${w-f} ${h}H0z" fill="${fill}" fill-opacity="${s.c ? .22 : .6}" stroke="${fill}" stroke-opacity=".5"/><path d="M${w} ${h-f}H${w-f}V${h}" fill="${fill}" fill-opacity=".35" stroke="${fill}" stroke-opacity=".5"/>`;
      m += lines(wrap(text, w - 28, s.fs || 15), {x:14, y:14, fs:s.fs || 15, fill:C.ink});
      break;
    }
    case 'code': {
      const fs = 12.5, max = Math.max(0, Math.floor((h - 40) / (fs * LH))), cw = Math.max(1, Math.floor((w - 24) / (fs * .6)));
      m = `<rect width="${w}" height="${h}" rx="10" fill="${C.surface}" stroke="${s.c ? col : C.line}" stroke-width="1.2"/><path d="M0 28H${w}" stroke="${C.line}"/>`
        + [14, 28, 42].map(x => `<circle cx="${x}" cy="14" r="4" fill="${C.line}"/>`).join('');
      m += lines(text.split('\n').slice(0, max).map(l => l.length > cw ? l.slice(0, cw - 1) + '…' : l), {x:12, y:34, fs, fill:C.ink, mono:true});
      break;
    }
    case 'image':
      m = imageSrc(s) ? `<image href="${esc(imageSrc(s))}" width="${w}" height="${h}" preserveAspectRatio="none"/>`
        : `<rect width="${w}" height="${h}" rx="6" fill="${C.surface}" stroke="${C.line}" stroke-dasharray="6 5"/><text x="${w/2}" y="${h/2 + 5}" text-anchor="middle" font-size="13" fill="${C.ink2}">${imageMissing(s) ? 'Image not found in this browser' : 'Loading image…'}</text>`;
      break;
    case 'device':
      m = device(s, col);
      break;
    case 'icon': {
      const k = Math.min(w, h) / 20, sw = Math.max(1, 3.2 / k);
      m = `<rect width="${w}" height="${h}" fill="transparent"/><g transform="translate(${(w - 20*k)/2} ${(h - 20*k)/2}) scale(${k})" fill="none" stroke="${col}" stroke-width="${sw.toFixed(2)}" stroke-linecap="round" stroke-linejoin="round">${icons()[s.v] || GLYPH.service}</g>`;
      break;
    }
    case 'comment': {
      m = `<path d="M14 0a14 14 0 1 1 0 28H0V14A14 14 0 0 1 14 0z" fill="${C.hi}" stroke="${C.ink}" stroke-width="1.2"/>` + [8, 14, 20].map(x => `<circle cx="${x}" cy="14" r="1.6" fill="${C.ink}"/>`).join('');
      if(text){ const c = commentCard(s, text); m += `<g transform="translate(36 -2)"><rect width="${c.w}" height="${c.h}" rx="8" fill="${C.surface}" stroke="${C.line}"/>${lines(c.ls, {x:10, y:7, fs:COMMENT_FS, fill:C.ink})}</g>`; }
      break;
    }
    default: {
      const st = `stroke="${col}" stroke-width="1.8" stroke-linejoin="round"`;
      m = outline(s.t, w, h, `fill="${col}" fill-opacity=".07" ${st}${s.dash ? ' stroke-dasharray="7 6"' : ''}`, st);
      if(text){ const t = inner(s, text); m += lines(t.ls, {x:w/2, y:t.top, fs:t.fs, fill:C.ink, anchor:'middle', weight:500}); }
    }
  }
  return `${open} transform="translate(${s.x} ${s.y})">${m}</g>`;
}

// Frames draw under the diagram; everything else draws over it, in list order.
export function shapesMarkup(shapes, opt = {}){
  let under = '', over = '';
  (shapes || []).forEach(s => {
    if(opt.comments === false && s.t === 'comment') return;
    if(s.t === 'frame') under += one(s, opt); else over += one(s, opt);
  });
  return {under, over};
}

export function handlesMarkup(s, k){
  const sw = 1.4 / k, hs = 9 / k, pad = 5 / k, frame = `stroke="${C.ink}" stroke-width="${sw}"`;
  if(s.t === 'line' || s.t === 'arrow'){
    const last = s.pts.length - 1, r = 5.5 / k;
    let m = segMids(s).map(([x, y], i) => `<g data-handle="a${i}" style="cursor:copy"><title>Drag to add a bend</title><circle cx="${x}" cy="${y}" r="${r}" fill="${C.surface}" fill-opacity=".85" stroke="${C.ink2}" stroke-width="${sw}"/><path d="M${x - r*.5} ${y}h${r}M${x} ${y - r*.5}v${r}" stroke="${C.ink2}" stroke-width="${sw}"/></g>`).join('');
    m += s.pts.map((p, i) => (i === 0 || i === last)
      ? `<circle data-handle="p${i}" cx="${p[0]}" cy="${p[1]}" r="${r}" fill="${C.surface}" ${frame} style="cursor:grab"/>`
      : `<rect data-handle="p${i}" x="${p[0] - r*.9}" y="${p[1] - r*.9}" width="${r*1.8}" height="${r*1.8}" transform="rotate(45 ${p[0]} ${p[1]})" fill="${C.hi}" ${frame} style="cursor:move"><title>Drag to move · double-click to remove</title></rect>`).join('');
    return m;
  }
  const b = bbox(s);
  let m = `<rect x="${b.x - pad}" y="${b.y - pad}" width="${b.w + 2*pad}" height="${b.h + 2*pad}" fill="none" ${frame} stroke-dasharray="${4/k} ${3/k}" pointer-events="none"/>`;
  if(s.t === 'comment') return m;
  [['nw', b.x - pad, b.y - pad, 'nwse'], ['ne', b.x + b.w + pad, b.y - pad, 'nesw'], ['sw', b.x - pad, b.y + b.h + pad, 'nesw'], ['se', b.x + b.w + pad, b.y + b.h + pad, 'nwse']]
    .forEach(([h, x, y, cur]) => { m += `<rect data-handle="${h}" x="${x - hs/2}" y="${y - hs/2}" width="${hs}" height="${hs}" rx="${2/k}" fill="${C.surface}" ${frame} style="cursor:${cur}-resize"/>`; });
  return m;
}

// Where the text editor sits for a shape, in world units, so it lines up with the drawn text.
export function editBox(s, text){
  switch(s.t){
    case 'text': { const fs = s.fs || 20, m = measure(text || ' ', fs); return {x:s.x, y:s.y, w:m.w + fs * 2, h:m.h + 4, fs, align:'left', color:colorOf(s.c), weight:s.bold ? 700 : 500}; }
    case 'comment': { const c = commentCard(s, text || ' '); return {x:s.x + 36, y:s.y - 2, w:COMMENT_W + 20, h:Math.max(40, c.h + COMMENT_FS * LH), fs:COMMENT_FS, align:'left', pad:7, padX:10, card:true}; }
    case 'frame': return {x:s.x, y:s.y - 30, w:Math.max(200, s.w), h:24, fs:13, align:'left', weight:600, color:colorOf(s.c)};
    case 'code': return {x:s.x + 12, y:s.y + 34, w:s.w - 24, h:s.h - 40, fs:12.5, align:'left', mono:true};
    case 'sticky': return {x:s.x + 14, y:s.y + 14, w:s.w - 28, h:s.h - 28, fs:s.fs || 15, align:'left'};
    case 'line': case 'arrow': { const [mx, my] = pathMid(s); return {x:mx - 90, y:my - 12, w:180, h:Math.max(24, wrap(text, 160, 13).length * 13 * LH + 6), fs:13, align:'center', card:true}; }
    default: { const t = inner(s, text || ' '); return {x:s.x + (s.w - t.tw) / 2, y:s.y, w:t.tw, h:s.h, fs:t.fs, align:'center', pad:Math.max(0, t.top), weight:500}; }
  }
}
