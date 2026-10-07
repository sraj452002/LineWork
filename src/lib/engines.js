import { esc, trunc, rid } from './utils.js';
import { COLOR_NAMES, colorOf, icons, resolveLinks, shapeBounds, shapesMarkup, unionBox } from './shapes.js';
import { packIcon } from './iconpacks.js';
import { parseAttrs } from './erdcode.js';

/* ===================== Colors ===================== */
export const C = {}; export let PAL = [];
const PAL_L = ['#2E62C9','#17836A','#B5601B','#7A45B8','#B8344F','#55731A'];
const PAL_D = ['#86A9F2','#5CC8A8','#EDA266','#B996EA','#EE869C','#A9CB6A'];
export function readColors(){
  const cs = getComputedStyle(document.documentElement), g = n => cs.getPropertyValue(n).trim();
  Object.assign(C, {paper:g('--paper'), surface:g('--surface'), ink:g('--ink'), ink2:g('--ink2'), edge:g('--edge'), hi:g('--hi'), line:g('--line')});
  PAL = cs.colorScheme === 'dark' ? PAL_D : PAL_L;
}

/* ===================== Glyphs ===================== */
export const GLYPH = {
  user:'<circle cx="10" cy="7" r="3.5"/><path d="M3.5 18c.8-3.5 3.4-5 6.5-5s5.7 1.5 6.5 5"/>',
  client:'<rect x="2" y="3" width="16" height="11" rx="1.5"/><path d="M7 17.5h6M10 14v3.5"/>',
  mobile:'<rect x="6" y="2" width="8" height="16" rx="2"/><path d="M9 15h2"/>',
  api:'<path d="M7 3c-2 0-2.5 1-2.5 3v1.5C4.5 9 3.5 10 2.5 10c1 0 2 1 2 2.5V14c0 2 .5 3 2.5 3M13 3c2 0 2.5 1 2.5 3v1.5c0 1.5 1 2.5 2 2.5-1 0-2 1-2 2.5V14c0 2-.5 3-2.5 3"/>',
  lb:'<circle cx="4" cy="10" r="2"/><circle cx="16" cy="4" r="2"/><circle cx="16" cy="10" r="2"/><circle cx="16" cy="16" r="2"/><path d="M6 10h8M6 9l8-4.2M6 11l8 4.2"/>',
  server:'<rect x="3" y="3" width="14" height="6" rx="1.5"/><rect x="3" y="11" width="14" height="6" rx="1.5"/><path d="M6.2 6h.01M6.2 14h.01"/>',
  function:'<path d="M13.5 3c-2.5 0-3 1.5-3.4 4L8.9 14c-.4 2.3-1 3-3.4 3M6.5 8.5h7"/>',
  database:'<ellipse cx="10" cy="5" rx="6.5" ry="2.5"/><path d="M3.5 5v10c0 1.4 2.9 2.5 6.5 2.5s6.5-1.1 6.5-2.5V5M3.5 10c0 1.4 2.9 2.5 6.5 2.5s6.5-1.1 6.5-2.5"/>',
  cache:'<path d="M11 2 4.5 11H10l-1 7 6.5-9H10z"/>',
  queue:'<rect x="2" y="6" width="16" height="8" rx="1.5"/><path d="M6 6v8M10 6v8M14 6v8"/>',
  storage:'<path d="M4 5h12l-1.5 12h-9z"/><path d="M4 5c0-1.2 2.7-2 6-2s6 .8 6 2"/>',
  cloud:'<path d="M6 16h8.5a3.5 3.5 0 0 0 .4-7A5 5 0 0 0 5.3 8.6 3.7 3.7 0 0 0 6 16z"/>',
  external:'<rect x="3" y="5" width="12" height="12" rx="1.5"/><path d="M11 3h6v6M17 3l-7 7"/>',
  service:'<path d="M10 2.5 16.5 6v8L10 17.5 3.5 14V6z"/>',
  table:'<rect x="2.5" y="3.5" width="15" height="13" rx="1.5"/><path d="M2.5 8h15M7.5 8v8.5"/>'
};
const ALIAS = {web:'client',browser:'client',frontend:'client',app:'client',db:'database',sql:'database',bucket:'storage',s3:'storage',blob:'storage',lambda:'function',fn:'function',gateway:'api',person:'user',actor:'user',phone:'mobile',ios:'mobile',android:'mobile',balancer:'lb',loadbalancer:'lb',topic:'queue',stream:'queue',redis:'cache',saas:'external',thirdparty:'external',vm:'server',container:'server',k8s:'server'};
const glyph = k => GLYPH[ALIAS[k] || k] || GLYPH.service;
const glyphG = (k, color, x, y) => `<g transform="translate(${x} ${y})" fill="none" stroke="${color}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${glyph(k)}</g>`;

/* ===================== Graph engine (architecture + flowchart) ===================== */
const W = 196, H = 60, PAD = 18, HEAD = 30, BANDGAP = 28;
const GRAPH = {
  draggable:true, directional:true,
  parse(src){
    const nodes = new Map(), groups = [], edges = [], errors = [];
    let title = '', cur = null;
    const touch = id => { if(!nodes.has(id)) nodes.set(id,{id,label:id,sub:'',kind:'',group:null}); return nodes.get(id); };
    src.split('\n').forEach((raw,i) => {
      const l = raw.replace(/(^|\s)#.*$/,'').trim();
      if(!l) return;
      let m;
      if((m = l.match(/^title\s*:\s*(.+)$/i))){ title = m[1].trim(); return; }
      if((m = l.match(/^group\s+([\w-]+)\s*(?:"([^"]*)")?\s*\{$/i))){
        cur = groups.find(g => g.id === m[1]);
        if(!cur){ cur = {id:m[1], label:(m[2]||m[1]).trim()}; groups.push(cur); }
        return;
      }
      if(l === '}'){ cur = null; return; }
      if((m = l.match(/^([\w-]+)\s*\[([^\]]*)\]\s*([\w-]+)?$/))){
        const [lab, sub] = m[2].split('|').map(s => (s||'').trim());
        Object.assign(touch(m[1]), {label:lab||m[1], sub:sub||'', kind:(m[3]||'').toLowerCase(), group:cur?cur.id:null});
        return;
      }
      if(/^[\w-]+$/.test(l)){ const n = touch(l); if(cur) n.group = cur.id; return; }
      const ci = l.indexOf(':');
      const lhs = ci >= 0 ? l.slice(0,ci) : l, label = ci >= 0 ? l.slice(ci+1).trim() : '';
      const parts = lhs.split(/\s*(<>|--|>|<)\s*/);
      if(parts.length >= 3 && parts.length % 2 === 1){
        const lists = [];
        for(let p = 0; p < parts.length; p += 2){
          const ids = parts[p].split(',').map(s => s.trim()).filter(Boolean);
          if(!ids.length || ids.some(id => !/^[\w-]+$/.test(id))){ errors.push({line:i+1, text:raw.trim()}); return; }
          lists.push(ids);
        }
        for(let s = 0; s < lists.length-1; s++){
          const op = parts[s*2+1], last = s === lists.length-2;
          lists[s].forEach(a => lists[s+1].forEach(b => {
            touch(a); touch(b);
            let from = a, to = b;
            if(op === '<'){ from = b; to = a; }
            edges.push({from, to, arrow: op === '<>' ? 'both' : op === '--' ? 'none' : 'end', label: last ? label : ''});
          }));
        }
        return;
      }
      errors.push({line:i+1, text:raw.trim()});
    });
    return {title, nodes, groups, edges, errors, count:nodes.size};
  },
  layout(m, d){
    const res = new Map(), ids = [...m.nodes.keys()];
    if(!ids.length) return res;
    const LR = d.dir !== 'TB', nodeC = LR ? H : W;
    const rankPitch = LR ? W + 84 : H + 80, crossPitch = LR ? H + 26 : W + 28;
    const out = new Map(ids.map(i => [i,[]]));
    m.edges.forEach(e => { if(e.from !== e.to) out.get(e.from).push(e.to); });
    const st = {}, back = new Set();
    const visit = u => { st[u] = 1; for(const v of out.get(u)){ if(st[v] === 1) back.add(u+'\0'+v); else if(!st[v]) visit(v); } st[u] = 2; };
    ids.forEach(i => { if(!st[i]) visit(i); });
    const fwd = u => out.get(u).filter(v => !back.has(u+'\0'+v));
    const rank = {}, indeg = {};
    ids.forEach(i => { rank[i] = 0; indeg[i] = 0; });
    ids.forEach(u => fwd(u).forEach(v => indeg[v]++));
    const q = ids.filter(i => !indeg[i]);
    while(q.length){ const u = q.shift(); fwd(u).forEach(v => { rank[v] = Math.max(rank[v], rank[u]+1); if(--indeg[v] === 0) q.push(v); }); }
    const hasIn = new Set(); ids.forEach(u => fwd(u).forEach(v => hasIn.add(v)));
    ids.forEach(u => { const ch = fwd(u); if(!hasIn.has(u) && ch.length) rank[u] = Math.max(0, Math.min(...ch.map(v => rank[v])) - 1); });
    const bk = id => m.nodes.get(id).group || ('~' + id);
    const bands = new Map();
    ids.forEach(id => { const k = bk(id); if(!bands.has(k)) bands.set(k,[]); bands.get(k).push(id); });
    const cols = new Map(), info = new Map(), placed = [];
    [...bands.keys()].forEach(b => {
      const mp = new Map();
      bands.get(b).forEach(id => { const r = rank[id]; if(!mp.has(r)) mp.set(r,[]); mp.get(r).push(id); });
      cols.set(b, mp);
      const rs = [...mp.keys()], r1 = Math.min(...rs), r2 = Math.max(...rs);
      const max = Math.max(...[...mp.values()].map(a => a.length));
      const head = (LR && b[0] !== '~') ? HEAD : 0, inner = max*crossPitch - (crossPitch - nodeC), size = inner + 2*PAD + head;
      const cands = [0, ...placed.map(p => p.s + p.size + BANDGAP)].sort((a,b) => a-b);
      const s0 = cands.find(c => placed.every(p => p.r2 < r1 || p.r1 > r2 || c >= p.s + p.size + BANDGAP || p.s >= c + size + BANDGAP));
      placed.push({s:s0, size, r1, r2});
      info.set(b, {s:s0, head, inner});
    });
    const center = id => {
      const b = bk(id), bi = info.get(b), arr = cols.get(b).get(rank[id]), i = arr.indexOf(id);
      return bi.s + PAD + bi.head + bi.inner/2 + (i - (arr.length-1)/2)*crossPitch;
    };
    const nb = new Map(ids.map(i => [i,[]]));
    m.edges.forEach(e => { if(e.from !== e.to){ nb.get(e.from).push(e.to); nb.get(e.to).push(e.from); } });
    for(let it = 0; it < 6; it++){
      const c = new Map(ids.map(i => [i, center(i)]));
      cols.forEach(mp => mp.forEach(arr => {
        const bc = new Map(arr.map(id => { const ns = nb.get(id); return [id, ns.length ? ns.reduce((s,v) => s + c.get(v), 0)/ns.length : c.get(id)]; }));
        arr.sort((a,b) => bc.get(a) - bc.get(b));
      }));
    }
    ids.forEach(id => { const cc = center(id), rr = rank[id]*rankPitch; res.set(id, LR ? {x:rr, y:cc - H/2} : {x:cc - W/2, y:rr}); });
    return res;
  },
  hues(ctx){
    const map = new Map(); let i = 0;
    ctx.m.groups.forEach(g => { if([...ctx.m.nodes.values()].some(n => n.group === g.id)) map.set(g.id, ctx.d.style === 'mono' ? C.ink2 : PAL[i++ % PAL.length]); });
    return map;
  },
  boxes(ctx){
    const boxes = [];
    ctx.m.groups.forEach(g => {
      const mem = [...ctx.m.nodes.values()].filter(n => n.group === g.id);
      if(!mem.length) return;
      let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
      mem.forEach(n => { const p = ctx.P(n.id); x1 = Math.min(x1,p.x); y1 = Math.min(y1,p.y); x2 = Math.max(x2,p.x+W); y2 = Math.max(y2,p.y+H); });
      boxes.push({g, x:x1-PAD, y:y1-PAD-HEAD, w:x2-x1+2*PAD, h:y2-y1+2*PAD+HEAD});
    });
    return boxes;
  },
  markup(ctx, sel){
    const flow = ctx.d.type === 'flowchart', hues = GRAPH.hues(ctx);
    const side = (a,b) => {
      const ax = a.x+W/2, ay = a.y+H/2, bx = b.x+W/2, by = b.y+H/2, dx = bx-ax, dy = by-ay;
      if(Math.abs(dx)*H > Math.abs(dy)*W) return dx > 0 ? {x:a.x+W, y:ay, nx:1, ny:0} : {x:a.x, y:ay, nx:-1, ny:0};
      return dy > 0 ? {x:ax, y:a.y+H, nx:0, ny:1} : {x:ax, y:a.y, nx:0, ny:-1};
    };
    let s = markers(ctx);
    GRAPH.boxes(ctx).forEach(b => {
      const hue = hues.get(b.g.id);
      s += `<rect x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" rx="14" fill="${hue}" fill-opacity=".08" stroke="${hue}" stroke-opacity=".55" stroke-width="1.2" stroke-dasharray="6 5"/><text x="${b.x+14}" y="${b.y+21}" fill="${hue}" font-size="12.5" font-weight="600">${esc(trunc(b.g.label,40))}</text>`;
    });
    let labels = '';
    ctx.m.edges.forEach(e => {
      if(e.from === e.to) return;
      const a = ctx.P(e.from), b = ctx.P(e.to); if(!a || !b) return;
      let p0 = side(a,b), p3 = side(b,a);
      const LRd = ctx.d.dir !== 'TB', ddx = Math.abs(a.x-b.x), ddy = Math.abs(a.y-b.y);
      let skip = false;
      if(!LRd && ddx < W/2 && ddy > (H+80)*1.5){ skip = true; p0 = {x:a.x+W, y:a.y+H/2, nx:1, ny:0}; p3 = {x:b.x+W, y:b.y+H/2, nx:1, ny:0}; }
      if(LRd && ddy < H/2 && ddx > (W+84)*1.5){ skip = true; p0 = {x:a.x+W/2, y:a.y+H, nx:0, ny:1}; p3 = {x:b.x+W/2, y:b.y+H, nx:0, ny:1}; }
      const dd = Math.hypot(p3.x-p0.x, p3.y-p0.y), c = skip ? 70 : Math.max(28, Math.min(110, dd*.42));
      const p1 = {x:p0.x+p0.nx*c, y:p0.y+p0.ny*c}, p2 = {x:p3.x+p3.nx*c, y:p3.y+p3.ny*c};
      const hot = sel && (e.from === sel || e.to === sel), col = hot ? C.ink : C.edge, mk = ctx.mk + (hot ? 'ah2' : 'ah');
      s += `<path d="M${p0.x} ${p0.y}C${p1.x} ${p1.y} ${p2.x} ${p2.y} ${p3.x} ${p3.y}" fill="none" stroke="${col}" stroke-width="${hot?2.2:1.5}"${e.arrow!=='none'?` marker-end="url(#${mk})"`:''}${e.arrow==='both'?` marker-start="url(#${mk})"`:''}/>`;
      if(e.label){
        const t = trunc(e.label,28), mx = (p0.x+3*p1.x+3*p2.x+p3.x)/8, my = (p0.y+3*p1.y+3*p2.y+p3.y)/8, tw = t.length*6.3+12;
        labels += `<rect x="${mx-tw/2}" y="${my-10}" width="${tw}" height="20" rx="5" fill="${C.paper}" stroke="${C.line}" stroke-width=".8"/><text x="${mx}" y="${my+4}" text-anchor="middle" font-size="11.5" fill="${C.ink2}">${esc(t)}</text>`;
      }
    });
    s += labels;
    ctx.m.nodes.forEach(n => {
      const p = ctx.P(n.id); if(!p) return;
      const hue = n.group ? hues.get(n.group) : C.ink2, isSel = sel === n.id;
      s += `<g data-node="${esc(n.id)}" transform="translate(${p.x} ${p.y})"><title>${esc(n.label + (n.sub ? ' — ' + n.sub : ''))}</title>`;
      if(isSel) s += `<rect x="-6" y="-6" width="${W+12}" height="${H+12}" rx="13" fill="${C.hi}" fill-opacity=".85"/>`;
      const stroke = isSel ? C.ink : (flow ? hue : C.line);
      if(flow){
        const k = n.kind;
        if(k === 'decision') s += `<polygon points="${W/2},-4 ${W+4},${H/2} ${W/2},${H+4} -4,${H/2}" fill="${C.hi}" fill-opacity=".32" stroke="${stroke}" stroke-width="1.4"/>`;
        else if(k === 'io') s += `<polygon points="16,0 ${W},0 ${W-16},${H} 0,${H}" fill="${C.surface}" stroke="${stroke}" stroke-width="1.4"/>`;
        else if(k === 'start' || k === 'end') s += `<rect width="${W}" height="${H}" rx="${H/2}" fill="${hue}" fill-opacity=".16" stroke="${stroke}" stroke-width="1.4"/>`;
        else s += `<rect width="${W}" height="${H}" rx="7" fill="${C.surface}" stroke="${stroke}" stroke-width="1.4"/>`;
        const lim = k === 'decision' ? 18 : 24;
        s += `<text x="${W/2}" y="${n.sub?28:35}" text-anchor="middle" font-size="13.5" font-weight="600" fill="${C.ink}">${esc(trunc(n.label,lim))}</text>`;
        if(n.sub) s += `<text x="${W/2}" y="44" text-anchor="middle" font-size="11.5" fill="${C.ink2}">${esc(trunc(n.sub,26))}</text>`;
      } else {
        s += `<rect width="${W}" height="${H}" rx="9" fill="${C.surface}" stroke="${stroke}" stroke-width="${isSel?1.6:1.2}"/>`;
        s += `<rect x="11" y="12" width="36" height="36" rx="8" fill="${hue}" fill-opacity=".14"/>` + glyphG(n.kind, hue, 19, 20);
        s += `<text x="58" y="${n.sub?27:35}" font-size="13.5" font-weight="600" fill="${C.ink}">${esc(trunc(n.label,19))}</text>`;
        if(n.sub) s += `<text x="58" y="44" font-size="11.5" fill="${C.ink2}">${esc(trunc(n.sub,22))}</text>`;
      }
      s += `</g>`;
    });
    return s;
  },
  bounds(ctx){
    let b = null;
    const add = (x,y,w,h) => { if(!b) b = {x1:x,y1:y,x2:x+w,y2:y+h}; else { b.x1 = Math.min(b.x1,x); b.y1 = Math.min(b.y1,y); b.x2 = Math.max(b.x2,x+w); b.y2 = Math.max(b.y2,y+h); } };
    ctx.m.nodes.forEach(n => { const p = ctx.P(n.id); if(p) add(p.x-8, p.y-8, W+16, H+16); });
    GRAPH.boxes(ctx).forEach(x => add(x.x, x.y, x.w, x.h));
    return b && {x:b.x1, y:b.y1, w:b.x2-b.x1, h:b.y2-b.y1};
  },
  label(m, id){ const n = m.nodes.get(id); return n ? n.label : id; },
  rect(ctx, id){ const p = ctx.m.nodes.has(id) && ctx.P(id); return p ? {x:p.x, y:p.y, w:W, h:H} : null; }
};
function markers(ctx){
  const p = ctx.mk;
  return `<defs><marker id="${p}ah" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0 10 5 0 10z" fill="${C.edge}"/></marker><marker id="${p}ah2" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0 10 5 0 10z" fill="${C.ink}"/></marker></defs>`;
}

/* ===================== Sequence engine ===================== */
const SPW = 158, SGX = 46, SHH = 50;
const SEQ = {
  draggable:false, directional:false,
  parse(src){
    const parts = new Map(), items = [], errors = []; let title = '';
    const touch = id => { if(!parts.has(id)) parts.set(id,{id,label:id,kind:''}); return parts.get(id); };
    src.split('\n').forEach((raw,i) => {
      const l = raw.replace(/(^|\s)#.*$/,'').trim(); if(!l) return;
      let m;
      if((m = l.match(/^title\s*:\s*(.+)$/i))){ title = m[1].trim(); return; }
      if((m = l.match(/^==\s*(.*?)\s*==$/))){ items.push({t:'div', label:m[1]}); return; }
      if((m = l.match(/^note\s+([\w-]+)\s*:\s*(.+)$/i))){ touch(m[1]); items.push({t:'note', on:m[1], label:m[2].trim()}); return; }
      if((m = l.match(/^([\w-]+)\s*\[([^\]]*)\]\s*([\w-]+)?$/))){ Object.assign(touch(m[1]), {label:m[2].trim()||m[1], kind:(m[3]||'').toLowerCase()}); return; }
      if((m = l.match(/^([\w-]+)\s*(-->|->|>)\s*([\w-]+)\s*(?::\s*(.*))?$/))){ touch(m[1]); touch(m[3]); items.push({t:'msg', from:m[1], to:m[3], dashed:m[2]==='-->', label:(m[4]||'').trim()}); return; }
      errors.push({line:i+1, text:raw.trim()});
    });
    return {title, parts, items, errors, count:parts.size};
  },
  layout(){ return new Map(); },
  geom(m){
    const ids = [...m.parts.keys()], cx = id => ids.indexOf(id)*(SPW+SGX) + SPW/2;
    let y = SHH + 42; const rows = [];
    m.items.forEach(it => {
      if(it.t === 'msg' && it.from === it.to){ rows.push({it, y}); y += 66; }
      else if(it.t === 'msg'){ rows.push({it, y}); y += 50; }
      else if(it.t === 'note'){ rows.push({it, y}); y += 50; }
      else { rows.push({it, y}); y += 46; }
    });
    return {ids, cx, rows, end:y, width:Math.max(SPW, ids.length*(SPW+SGX) - SGX)};
  },
  markup(ctx){
    const m = ctx.m, g = SEQ.geom(m); let s = markers(ctx), n = 0;
    g.ids.forEach((id,i) => {
      const p = m.parts.get(id), x = g.cx(id);
      s += `<line x1="${x}" y1="${SHH}" x2="${x}" y2="${g.end}" stroke="${C.line}" stroke-width="1.4" stroke-dasharray="4 5"/>`;
    });
    g.rows.forEach(({it,y}) => {
      if(it.t === 'div'){
        const t = trunc(it.label,40), tw = t.length*6.6+20;
        s += `<line x1="-14" y1="${y}" x2="${g.width+14}" y2="${y}" stroke="${C.ink2}" stroke-width="1" stroke-dasharray="2 4"/><rect x="${g.width/2-tw/2}" y="${y-11}" width="${tw}" height="22" rx="11" fill="${C.surface}" stroke="${C.line}"/><text x="${g.width/2}" y="${y+4}" text-anchor="middle" font-size="12" font-weight="600" fill="${C.ink}">${esc(t)}</text>`;
      } else if(it.t === 'note'){
        const x = g.cx(it.on), t = trunc(it.label,24), w = Math.max(110, t.length*6.8+22);
        s += `<rect x="${x-w/2}" y="${y-15}" width="${w}" height="32" rx="6" fill="${C.hi}" fill-opacity=".38" stroke="${C.hi}"/><text x="${x}" y="${y+5}" text-anchor="middle" font-size="12.5" fill="${C.ink}">${esc(t)}</text>`;
      } else {
        n++;
        const x1 = g.cx(it.from), x2 = g.cx(it.to), dash = it.dashed ? ' stroke-dasharray="6 4"' : '';
        if(it.from === it.to){
          s += `<path d="M${x1} ${y}h40v24h-38" fill="none" stroke="${C.edge}" stroke-width="1.5"${dash} marker-end="url(#${ctx.mk}ah)"/>`;
          s += `<text x="${x1+50}" y="${y+16}" font-size="12" fill="${C.ink}">${esc(trunc(it.label,30))}</text>`;
        } else {
          const dir = x2 > x1 ? 1 : -1;
          s += `<line x1="${x1}" y1="${y}" x2="${x2 - dir*2}" y2="${y}" stroke="${C.edge}" stroke-width="1.5"${dash} marker-end="url(#${ctx.mk}ah)"/>`;
          const t = trunc(it.label, Math.max(12, Math.floor(Math.abs(x2-x1)/6.8) - 2));
          s += `<text x="${(x1+x2)/2}" y="${y-8}" text-anchor="middle" font-size="12" fill="${C.ink}">${esc(t)}</text>`;
        }
        s += `<circle cx="${x1}" cy="${y}" r="9" fill="${C.ink}"/><text x="${x1}" y="${y+3.5}" text-anchor="middle" font-size="9.5" font-weight="700" fill="${C.paper}">${n}</text>`;
      }
    });
    g.ids.forEach((id,i) => {
      const p = m.parts.get(id), x = g.cx(id) - SPW/2, hue = ctx.d.style === 'mono' ? C.ink2 : PAL[i % PAL.length];
      s += `<g transform="translate(${x} 0)"><rect width="${SPW}" height="${SHH}" rx="9" fill="${C.surface}" stroke="${C.line}" stroke-width="1.2"/><rect x="0" y="${SHH-4}" width="${SPW}" height="4" fill="${hue}" fill-opacity=".7"/>`;
      if(p.kind){ s += `<rect x="9" y="9" width="32" height="32" rx="7" fill="${hue}" fill-opacity=".14"/>` + glyphG(p.kind, hue, 15, 15) + `<text x="50" y="30" font-size="13" font-weight="600" fill="${C.ink}">${esc(trunc(p.label,14))}</text>`; }
      else s += `<text x="${SPW/2}" y="30" text-anchor="middle" font-size="13" font-weight="600" fill="${C.ink}">${esc(trunc(p.label,20))}</text>`;
      s += `</g>`;
    });
    return s;
  },
  bounds(ctx){ if(!ctx.m.parts.size) return null; const g = SEQ.geom(ctx.m); return {x:-18, y:-8, w:g.width+36, h:g.end+16}; }
};

/* ===================== ERD engine ===================== */
const TW = 210, TH = 34, RH = 24;
const ERD = {
  draggable:true, directional:false,
  parse(src){
    const tables = new Map(), rels = [], errors = []; let title = '', notation = 'crows-foot', cur = null;
    const touch = id => { if(!tables.has(id)) tables.set(id,{id,label:id,fields:[]}); return tables.get(id); };
    src.split('\n').forEach((raw,i) => {
      const l = raw.replace(/(^|\s)#.*$/,'').trim(); if(!l) return;
      let m;
      if(!cur && (m = l.match(/^title\s*:\s*(.+)$/i))){ title = m[1].trim(); return; }
      if(!cur && (m = l.match(/^notation\s+([\w-]+)$/i))){ notation = /^chen$/i.test(m[1]) ? 'chen' : 'crows-foot'; return; }
      if(!cur && (m = l.match(/^([\w-]+)\s*(?:\[([^\]]*)\])?\s*\{$/))){
        cur = touch(m[1]); cur.fields = [];
        const a = parseAttrs(m[2]);
        cur.label = a.label || m[1]; cur.icon = a.icon || ''; cur.color = a.color || '';
        return;
      }
      if(l === '}'){ cur = null; return; }
      if(cur){
        const tk = l.split(/\s+/);
        if(!/^[\w-]+$/.test(tk[0])){ errors.push({line:i+1, text:raw.trim()}); return; }
        let type = tk[1] || '', rest = tk.slice(2).join(' ').toLowerCase();
        if(/^(pk|fk|unique|pk,fk)$/i.test(type)){ rest = type.toLowerCase() + ' ' + rest; type = ''; }
        cur.fields.push({name:tk[0], type, key: /\bpk\b/.test(rest) ? 'pk' : /\bfk\b/.test(rest) ? 'fk' : /unique/.test(rest) ? 'uq' : ''});
        return;
      }
      if((m = l.match(/^([\w-]+)(?:\.([\w-]+))?\s*(<>|>|<|-)\s*([\w-]+)(?:\.([\w-]+))?\s*(?::\s*(.*))?$/))){
        touch(m[1]); touch(m[4]);
        rels.push({a:m[1], af:m[2]||'', b:m[4], bf:m[5]||'', card:m[3], label:(m[6]||'').trim()});
        return;
      }
      errors.push({line:i+1, text:raw.trim()});
    });
    return {title, notation, tables, rels, errors, count:tables.size};
  },
  h: t => TH + Math.max(1, t.fields.length)*RH + 8,
  layout(m){
    const res = new Map(), ids = [...m.tables.keys()]; if(!ids.length) return res;
    const adj = new Map(ids.map(i => [i, new Set()]));
    m.rels.forEach(r => { if(r.a !== r.b){ adj.get(r.a).add(r.b); adj.get(r.b).add(r.a); } });
    const deg = id => adj.get(id).size, seen = new Set(), order = [];
    const rest = [...ids].sort((a,b) => deg(b) - deg(a));
    rest.forEach(s => {
      if(seen.has(s)) return;
      const q = [s]; seen.add(s);
      while(q.length){ const u = q.shift(); order.push(u); [...adj.get(u)].sort((a,b) => deg(b)-deg(a)).forEach(v => { if(!seen.has(v)){ seen.add(v); q.push(v); } }); }
    });
    const cols = order.length <= 3 ? order.length : Math.ceil(Math.sqrt(order.length*1.3));
    let y = 0;
    for(let r = 0; r*cols < order.length; r++){
      const row = order.slice(r*cols, r*cols+cols);
      row.forEach((id,c) => res.set(id, {x:c*(TW+120), y}));
      y += Math.max(...row.map(id => ERD.h(m.tables.get(id)))) + 70;
    }
    return res;
  },
  // selField: {t, f}, a selected column, drawn highlighted along with its relationship lines.
  markup(ctx, sel, selField){
    const m = ctx.m; let s = markers(ctx);
    const ids = [...m.tables.keys()];
    const hue = id => tableHue(m.tables.get(id), ids.indexOf(id), ctx.d.style === 'mono');
    const rowY = (t, f) => { const i = f ? t.fields.findIndex(x => x.name === f) : -1; return i < 0 ? TH/2 : TH + RH*i + RH/2; };
    const chen = m.notation === 'chen';
    // Crow's foot: three prongs for "many", two bars for "one". Chen: a "*" or "1" beside the end.
    const mark = (x, y, nx, many) => chen
      ? `<text x="${x + nx*7}" y="${y - 5}" text-anchor="${nx > 0 ? 'start' : 'end'}" font-size="11" font-weight="600" fill="${C.ink2}">${many ? '*' : '1'}</text>`
      : many
        ? `<path d="M${x+nx*11} ${y}L${x} ${y-6}M${x+nx*11} ${y}L${x} ${y+6}M${x+nx*15} ${y-6}v12" fill="none" stroke="${C.edge}" stroke-width="1.3"/>`
        : `<path d="M${x+nx*8} ${y-6}v12M${x+nx*12} ${y-6}v12" fill="none" stroke="${C.edge}" stroke-width="1.3"/>`;
    // Route each relationship: out of one side, along, and into the other side, with rounded corners.
    const routes = [];
    m.rels.forEach(r => {
      const ta = m.tables.get(r.a), tb = m.tables.get(r.b), pa = ctx.P(r.a), pb = ctx.P(r.b); if(!pa || !pb) return;
      const ay = pa.y + rowY(ta, r.af), by = pb.y + rowY(tb, r.bf);
      let x1, n1, x2, n2;
      if(pb.x > pa.x + TW + 20){ x1 = pa.x+TW; n1 = 1; x2 = pb.x; n2 = -1; }
      else if(pb.x + TW + 20 < pa.x){ x1 = pa.x; n1 = -1; x2 = pb.x+TW; n2 = 1; }
      else { x1 = pa.x+TW; n1 = 1; x2 = pb.x+TW; n2 = 1; }
      const mx = n1 === n2 ? (n1 > 0 ? Math.max(x1, x2) + 34 : Math.min(x1, x2) - 34) : (x1 + x2) / 2;
      routes.push({r, ay, by, x1, n1, x2, n2, mx, straight: Math.abs(ay - by) < 1 && n1 !== n2});
    });
    // Runs that would land on (nearly) the same x get spread 12px apart, so lines don't sit on top of each other.
    const lanes = new Map();
    routes.filter(o => !o.straight).forEach(o => { const k = Math.round(o.mx / 24); if(!lanes.has(k)) lanes.set(k, []); lanes.get(k).push(o); });
    lanes.forEach(group => {
      group.sort((u, v) => Math.min(u.ay, u.by) - Math.min(v.ay, v.by));
      group.forEach((o, i) => {
        let x = o.mx + (i - (group.length - 1) / 2) * 12;
        if(o.n1 !== o.n2){ const lo = Math.min(o.x1, o.x2) + 22, hi = Math.max(o.x1, o.x2) - 22; if(lo < hi) x = Math.max(lo, Math.min(hi, x)); }
        o.mx = Math.round(x);
      });
    });
    // Tables a line must not pass through (all but its own two ends), padded a little.
    const boxes = new Map(ids.map(id => { const p = ctx.P(id), t = m.tables.get(id); return [id, p && {x:p.x - 10, y:p.y - 10, w:TW + 20, h:ERD.h(t) + 20}]; }));
    routes.forEach(o => { o.pts = o.straight ? [[o.x1, o.ay], [o.x2, o.by]] : [[o.x1, o.ay], [o.mx, o.ay], [o.mx, o.by], [o.x2, o.by]]; });
    routes.forEach(o => {
      const obstacles = ids.filter(id => id !== o.r.a && id !== o.r.b).map(id => boxes.get(id)).filter(Boolean);
      if(!obstacles.length || !hits(o.pts, obstacles)) return;
      o.pts = detour(o, obstacles);
    });
    routes.forEach(({r, ay, by, x1, n1, x2, n2, mx, straight, pts}) => {
      const hot = selField ? (r.a === selField.t && r.af === selField.f) || (r.b === selField.t && r.bf === selField.f) : sel && (r.a === sel || r.b === sel);
      s += `<path d="${roundPath(pts, 8)}" fill="none" stroke="${hot?C.ink:C.edge}" stroke-width="${hot?2:1.3}"/>`;
      const manyA = r.card === '>' || r.card === '<>', manyB = r.card === '<' || r.card === '<>';
      s += mark(x1, ay, n1, manyA) + mark(x2, by, n2, manyB);
      if(r.label){ const mid = pts[Math.floor((pts.length - 1) / 2)], nxt = pts[Math.floor((pts.length - 1) / 2) + 1], lx = (mid[0] + nxt[0]) / 2, ly = (mid[1] + nxt[1]) / 2, t = trunc(r.label,24), tw = t.length*6+12; s += `<rect x="${lx-tw/2}" y="${ly-9}" width="${tw}" height="18" rx="5" fill="${C.paper}" stroke="${C.line}" stroke-width=".8"/><text x="${lx}" y="${ly+4}" text-anchor="middle" font-size="11" fill="${C.ink2}">${esc(t)}</text>`; }
    });
    m.tables.forEach(t => {
      const p = ctx.P(t.id); if(!p) return;
      const h = ERD.h(t), hu = hue(t.id), isSel = sel === t.id, ic = tableIcon(t.icon);
      s += `<g data-node="${esc(t.id)}" transform="translate(${p.x} ${p.y})"><title>${esc(t.label)}</title>`;
      if(isSel) s += `<rect x="-6" y="-6" width="${TW+12}" height="${h+12}" rx="14" fill="none" stroke="${C.hi}" stroke-width="3"/>`;
      s += `<rect width="${TW}" height="${h}" rx="10" fill="${C.surface}"/><rect width="${TW}" height="${h}" rx="10" fill="${hu}" fill-opacity=".07" stroke="${hu}" stroke-opacity=".9" stroke-width="1.4"/>`;
      s += `<path d="M0 10a10 10 0 0 1 10-10h${TW-20}a10 10 0 0 1 10 10v${TH-10}H0z" fill="${hu}" fill-opacity=".16"/><path d="M0 ${TH}h${TW}" stroke="${hu}" stroke-opacity=".45"/>`;
      s += `<text x="11" y="22" font-size="12.5" font-weight="700" fill="${C.ink}">${esc(trunc(t.label,22))}</text>`;
      const k = 16 / ic.vb;
      s += `<g transform="translate(${TW-27} 9) scale(${k})" ${ic.fill ? `fill="${hu}" stroke="none"` : `fill="none" stroke="${hu}" stroke-width="${(1.6/k).toFixed(2)}" stroke-linecap="round" stroke-linejoin="round"`}>${ic.body}</g>`;
      t.fields.forEach((f,i) => {
        const y = TH + RH*i, on = selField && selField.t === t.id && selField.f === f.name;
        s += `<g data-field="${esc(f.name)}"><rect x="1" y="${y}" width="${TW-2}" height="${RH}" fill="transparent"/>`;
        if(i) s += `<path d="M10 ${y}h${TW-20}" stroke="${C.line}" stroke-opacity=".6"/>`;
        if(on) s += `<rect x="3" y="${y+1.5}" width="${TW-6}" height="${RH-3}" rx="5" fill="${hu}" fill-opacity=".22" stroke="${C.hi}" stroke-width="1.6"/>`;
        s += `<text x="11" y="${y+16}" font-size="11.5" font-weight="${f.key==='pk'?600:400}" fill="${C.ink}">${esc(trunc(f.name,19))}</text>`;
        const flag = f.key === 'pk' ? 'pk' : f.key === 'fk' ? 'fk' : f.key === 'uq' ? 'unique' : '';
        if(f.type || flag) s += `<text x="${TW-11}" y="${y+16}" text-anchor="end" font-size="10.5" fill="${hu}" font-family="JetBrains Mono, ui-monospace, monospace">${esc(trunc(f.type,14))}${flag ? `<tspan dx="${f.type ? 6 : 0}" font-weight="700">${flag}</tspan>` : ''}</text>`;
        s += `</g>`;
      });
      if(!t.fields.length) s += `<text x="11" y="${TH+16}" font-size="11.5" fill="${C.ink2}" font-style="italic">no columns</text>`;
      s += `</g>`;
    });
    return s;
  },
  bounds(ctx){
    let b = null;
    ctx.m.tables.forEach(t => { const p = ctx.P(t.id); if(!p) return; const h = ERD.h(t); if(!b) b = {x1:p.x, y1:p.y, x2:p.x+TW, y2:p.y+h}; else { b.x1 = Math.min(b.x1,p.x); b.y1 = Math.min(b.y1,p.y); b.x2 = Math.max(b.x2,p.x+TW); b.y2 = Math.max(b.y2,p.y+h); } });
    return b && {x:b.x1-46, y:b.y1-14, w:b.x2-b.x1+92, h:b.y2-b.y1+28};
  },
  label(m, id){ const t = m.tables.get(id); return t ? t.label : id; },
  rect(ctx, id){ const t = ctx.m.tables.get(id), p = t && ctx.P(id); return p ? {x:p.x, y:p.y, w:TW, h:ERD.h(t)} : null; }
};

// A table's colour: its `color:` (a palette name or #hex), else the next palette colour.
const COLOR_ALIAS = {gray:'grey', black:'ink', default:'', none:''};
export function tableHue(t, i, mono){
  const c = t && t.color ? (COLOR_ALIAS[t.color.toLowerCase()] ?? t.color.toLowerCase()) : '';
  if(/^#[0-9a-f]{6}$/i.test(c)) return c;
  const n = COLOR_NAMES.findIndex(x => x.toLowerCase() === c);
  if(n >= 0) return colorOf(n);
  return mono ? C.ink2 : PAL[i % PAL.length];
}
// A table's icon: a built-in icon, or any icon from the big sets once they've loaded.
export function tableIcon(name){
  const k = (name || '').trim().toLowerCase();
  const own = k && icons()[k];
  if(own) return {body:own, vb:20};
  const p = k && (packIcon(k.includes(':') ? k : 'lu:' + k) || packIcon('si:' + k.replace(/[^a-z0-9]/g, '')));
  if(p) return {body:p.body, vb:p.vb, fill:p.fill};
  return {body:GLYPH.table, vb:20};
}
// Does a right-angled path cross any of the rectangles?
function hits(pts, rects){
  for(let i = 1; i < pts.length; i++){
    const [ax, ay] = pts[i - 1], [bx, by] = pts[i];
    const x0 = Math.min(ax, bx), x1 = Math.max(ax, bx), y0 = Math.min(ay, by), y1 = Math.max(ay, by);
    if(rects.some(r => x1 > r.x && x0 < r.x + r.w && y1 > r.y && y0 < r.y + r.h)) return true;
  }
  return false;
}
const pathLen = pts => pts.reduce((n, p, i) => n + (i ? Math.abs(p[0] - pts[i-1][0]) + Math.abs(p[1] - pts[i-1][1]) : 0), 0);
const crossings = (pts, rects) => rects.filter(r => hits(pts, [r])).length;
// Find a route around the tables in the way: try other vertical runs, then going over or under them.
function detour(o, rects){
  const {x1, n1, x2, n2, ay, by} = o, out1 = x1 + n1 * 26, out2 = x2 + n2 * 26;
  const cands = [];
  // A different vertical run: just outside either end, or beside any obstacle.
  const xs = [out1, out2, ...rects.flatMap(r => [r.x - 12, r.x + r.w + 12])];
  xs.forEach(x => cands.push([[x1, ay], [x, ay], [x, by], [x2, by]]));
  // Over or under: out, along a clear horizontal channel, and back in.
  const ys = [...rects.flatMap(r => [r.y - 14, r.y + r.h + 14])];
  ys.forEach(y => cands.push([[x1, ay], [out1, ay], [out1, y], [out2, y], [out2, by], [x2, by]]));
  let best = o.pts, bestK = crossings(o.pts, rects), bestL = pathLen(o.pts);
  cands.forEach(c => {
    // Lines must leave and enter in the right direction.
    if((c[1][0] - x1) * n1 < 0 || (c[c.length - 2][0] - x2) * n2 < 0) return;
    const k = crossings(c, rects), l = pathLen(c);
    if(k < bestK || (k === bestK && l < bestL)){ best = c; bestK = k; bestL = l; }
  });
  return best.filter((p, i) => !i || p[0] !== best[i-1][0] || p[1] !== best[i-1][1]);
}
// SVG path through points with rounded corners.
function roundPath(pts, r){
  let d = `M${pts[0][0]} ${pts[0][1]}`;
  for(let i = 1; i < pts.length; i++){
    const q = pts[i], nx = pts[i + 1];
    if(!nx){ d += `L${q[0]} ${q[1]}`; break; }
    const pr = pts[i - 1], l1 = Math.hypot(q[0] - pr[0], q[1] - pr[1]), l2 = Math.hypot(nx[0] - q[0], nx[1] - q[1]), k = Math.min(r, l1 / 2, l2 / 2);
    const a = [q[0] + (pr[0] - q[0]) * k / (l1 || 1), q[1] + (pr[1] - q[1]) * k / (l1 || 1)], b = [q[0] + (nx[0] - q[0]) * k / (l2 || 1), q[1] + (nx[1] - q[1]) * k / (l2 || 1)];
    d += `L${a[0].toFixed(1)} ${a[1].toFixed(1)}Q${q[0]} ${q[1]} ${b[0].toFixed(1)} ${b[1].toFixed(1)}`;
  }
  return d;
}

export const TYPES = {
  architecture:{name:'Architecture', E:GRAPH},
  flowchart:{name:'Flowchart', E:GRAPH},
  sequence:{name:'Sequence', E:SEQ},
  erd:{name:'Database schema', E:ERD}
};
export const engineOf = d => (TYPES[d.type] || TYPES.architecture).E;
export function prep(d){
  const E = engineOf(d), m = E.parse(d.code || ''), base = E.layout(m, d);
  return {E, m, d, base, mk:'k' + Math.random().toString(36).slice(2,8), P: id => (d.manual && d.manual[id]) || base.get(id)};
}
export function svgDoc(ctx, {title=true, margin=36} = {}){
  const sh = resolveLinks(ctx.d.shapes || [], id => ctx.E.rect && ctx.E.rect(ctx, id)).filter(s => s.t !== 'comment'), L = shapesMarkup(sh);
  const b = unionBox(ctx.m.count ? ctx.E.bounds(ctx) : null, shapeBounds(sh)); if(!b) return null;
  const T = title && ctx.m.title ? 34 : 0, w = Math.ceil(b.w + 2*margin), h = Math.ceil(b.h + 2*margin + T);
  const tt = T ? `<text x="${margin}" y="${margin+8}" font-size="18" font-weight="700" fill="${C.ink}">${esc(ctx.m.title)}</text>` : '';
  return {w, h, text:`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" font-family="Bricolage Grotesque, system-ui, -apple-system, Segoe UI, sans-serif"><rect width="100%" height="100%" fill="${C.paper}"/>${tt}<g transform="translate(${margin-b.x} ${margin+T-b.y})">${L.under}${ctx.E.markup(ctx, null)}${L.over}</g></svg>`};
}
export function thumb(d){
  if(!d) return '<span class="blank-thumb">+</span>';
  const ctx = prep(d), doc = svgDoc(ctx, {title:false, margin:24});
  if(!doc) return '<span class="blank-thumb">+</span>';
  return doc.text.replace('<svg ', '<svg preserveAspectRatio="xMidYMid meet" aria-hidden="true" ').replace(/ width="\d+" height="\d+"/, '');
}

/* ===================== Templates ===================== */
export const CODE = {
aws:`title: Photo sharing app
user [Visitor] user
group edge "Edge" {
  cdn [CDN | CloudFront] cloud
  lb [Load balancer | ALB] lb
}
group app "Application VPC" {
  api [API | Node on ECS] api
  jobs [Job queue | SQS] queue
  worker [Thumbnailer | Lambda] function
}
group data "Data" {
  db [Photos DB | Postgres] database
  cache [Sessions | Redis] cache
  media [Media | S3] storage
}
user > cdn : HTTPS
cdn > lb
cdn > media : static files
lb > api
api > db, cache
api > jobs : new upload
jobs > worker
worker > media : thumbnails`,
flow:`title: Password reset
start [Forgot password] start
enter [Enter email] io
known [Account exists?] decision
send [Email reset link] step
confirm [Show confirmation] step
done [Done] end
start > enter > known
known > send : yes
known > confirm : no
send > confirm > done`,
seq:`title: Sign in with OAuth
user [Person] user
app [Web app] client
api [API] api
idp [Identity provider] external
user > app : Click sign in
app > idp : Redirect to authorize
idp > user : Ask for consent
user > idp : Approve
idp --> app : Auth code
== Token exchange ==
app > api : Exchange code
api > idp : Verify code
idp --> api : Tokens
note api : Create session
api --> app : Session cookie
app --> user : Signed in`,
erd:`title: Project tracker schema
teams [icon: users, color: blue] {
  id uuid pk
  name text
  created_at timestamptz
}
users [icon: user, color: blue] {
  id uuid pk
  team_id uuid fk
  email text unique
  name text
}
projects [icon: folder, color: green] {
  id uuid pk
  team_id uuid fk
  title text
  status text
}
tasks [icon: check, color: orange] {
  id uuid pk
  project_id uuid fk
  assignee_id uuid fk
  title text
  due_date date
}
users.team_id > teams.id
projects.team_id > teams.id
tasks.project_id > projects.id
tasks.assignee_id > users.id`
};
const DOC_TEMPLATE = `# Design doc: Untitled

## Context
What is happening today, and why does it need to change?

## Goals
- 

## Non-goals
- 

## Proposal
Describe the design. Reference the diagrams on the canvas.

## Alternatives considered

## Risks and open questions
- 
`;
export const dg = (type, name, code) => ({id:rid('d'), type, name, code, manual:{}, dir: (type === 'flowchart' || innerWidth < 640) ? 'TB' : 'LR', style:'color'});
export const TEMPLATES = [
  {key:'blank', name:'Blank file', note:'Empty doc and canvas', make:() => ({title:'Untitled', doc:'', diagrams:[dg('architecture','Diagram 1','')]})},
  {key:'aws', name:'Cloud architecture', note:'Web app on AWS', make:() => ({title:'Photo sharing app', doc:'', diagrams:[dg('architecture','Architecture',CODE.aws)]})},
  {key:'flow', name:'Flowchart', note:'Steps and decisions', make:() => ({title:'Password reset flow', doc:'', diagrams:[dg('flowchart','Flow',CODE.flow)]})},
  {key:'seq', name:'Sequence diagram', note:'Calls between services', make:() => ({title:'OAuth sign-in', doc:'', diagrams:[dg('sequence','Sequence',CODE.seq)]})},
  {key:'erd', name:'Database schema', note:'Tables and relationships', make:() => ({title:'Project tracker schema', doc:'', diagrams:[dg('erd','Schema',CODE.erd)]})},
  {key:'doc', name:'Design doc', note:'Sections to fill in, plus a canvas', make:() => ({title:'Design doc', doc:DOC_TEMPLATE, diagrams:[dg('architecture','Architecture','')], view:'doc'})}
];
export function newFile(t){
  const now = Date.now(), base = t.make();
  return {id:rid('f'), title:base.title, created:now, updated:now, doc:base.doc, diagrams:base.diagrams, active:0, view:base.view || (base.doc ? 'both' : 'canvas')};
}

