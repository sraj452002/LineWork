/* Importing Articulate Storyline courses, as far as can be read from the file:

   .story          A zip of XML files and media. Its format isn't published, so this reads it generously:
                   scenes and slides (by their elements and names), the text on each slide, and the pictures
                   each slide refers to. Triggers, states, layers and animations aren't carried over.
   published zip   What Storyline's Publish → Web / LMS makes (story.html, html5/data/js/*.js). Its data is
                   JSON (globalProvideData), so scenes, slide titles, text and pictures read more reliably.

   Either way you get a Workline course with one slide per slide: its title, its text and its pictures, ready
   to rebuild the interactions with this editor's triggers, states and layers. */

import { newCourse, newLayer, newObject, newScene, newSlide } from './course.js';

const MEDIA = /\.(png|jpe?g|gif|svg|webp|bmp)$/i;
const SHAPE_NAME = /^(rectangle|rounded rectangle|oval|ellipse|text ?box|picture|image|button|hotspot|group|line|placeholder|title|shape|marker|slider|dial|character|caption|arrow|star|triangle|freeform|content placeholder|text placeholder|subtitle|slide number|footer|date)\s*\d*$/i;
const base = p => p.split('/').pop().toLowerCase();
const stem = p => base(p).replace(/\.[^.]+$/, '');

// Is this string something a person wrote (not an id, a path, a style, a number)?
export function human(s) {
  s = String(s || '').replace(/\s+/g, ' ').trim();
  if (s.length < 2 || s.length > 600) return false;
  if (!/[\p{L}]{2,}/u.test(s)) return false;
  if (/^[0-9a-f]{8}-?[0-9a-f]{4}|^[0-9a-z_-]{20,}$/i.test(s)) return false;
  if (/^[\w./\\-]+\.(png|jpe?g|gif|svg|mp3|mp4|wav|xml|js|css|json|ttf|woff2?|otf|xaml|webp)$/i.test(s)) return false;
  if (/^(https?:|data:|file:|[a-z]+:\/\/)/i.test(s)) return false;
  if (/^(true|false|null|none|auto|normal|bold|italic|left|right|center|top|bottom|solid|hidden|visible|inherit|default|arial|calibri|segoe ui|open sans|articulate)$/i.test(s)) return false;
  if (/^[A-Za-z]+(\.[A-Za-z]+){1,}$/.test(s) || /^[a-z]+([A-Z][a-z]+)+$/.test(s) || /^[a-z_]+$/.test(s) && !s.includes(' ') && s.length > 12) return false;
  if (/[{};]|:\s*\d|px\b|^#?[0-9a-f]{3,8}$/i.test(s)) return false;
  if (SHAPE_NAME.test(s)) return false;
  return true;
}
// Text inside rich-text markup (XAML runs, HTML, RTF-ish) kept in an attribute or a text node.
const unmark = s => {
  const runs = [...String(s).matchAll(/\bText="([^"]{1,600})"/g)].map(m => m[1]);
  if (runs.length) return [runs.join('')];
  if (/<\w[^>]*>/.test(s)) return String(s).replace(/<br\s*\/?>|<\/p>|<\/div>/gi, '\n').replace(/<[^>]+>/g, '').split(/\n+/);
  return [s];
};
const decode = s => s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&#(\d+);/g, (m, n) => String.fromCharCode(Number(n)));

/* ---- .story (XML) ---- */
const TEXT_ATTRS = /^(text|title|alt|alttext|alt-text|caption|label|content|value|tooltip|feedback|prompt|choice|answer|description|notes?)$/i;
function textsOf(el) {
  const out = [];
  const visit = n => {
    if (n.nodeType === 3 || n.nodeType === 4) { for (const t of unmark(decode(n.nodeValue))) out.push(t); return; }
    if (n.nodeType !== 1) return;
    for (const a of n.attributes || []) if (TEXT_ATTRS.test(a.name)) for (const t of unmark(decode(a.value))) out.push(t);
    for (const c of n.childNodes) visit(c);
  };
  visit(el);
  return out.map(t => t.replace(/\s+/g, ' ').trim()).filter(human);
}
const attr = (el, ...names) => { for (const n of names) for (const a of el.attributes || []) if (a.name.toLowerCase() === n) return a.value; return ''; };
const mediaRefs = (el, media) => {
  const found = new Set(), hay = new XMLSerializer().serializeToString(el).toLowerCase();
  for (const [b, path] of media) if (hay.includes(b) || hay.includes(stem(b) + '"') || hay.includes(stem(b) + '<')) found.add(path);
  return [...found];
};
async function fromStoryXml(zip, files) {
  const media = new Map(files.filter(f => MEDIA.test(f.name)).map(f => [base(f.name), f.name]));
  const docs = [];
  for (const f of files.filter(x => /\.(xml|xaml)$/i.test(x.name)).slice(0, 2000)) {
    const text = await f.async('string');
    const doc = new DOMParser().parseFromString(text, 'application/xml');
    if (!doc.querySelector('parsererror')) docs.push({ name: f.name, doc });
  }
  if (!docs.length) throw new Error('No readable XML was found inside that .story file. In Storyline, use Publish → Web, zip the output folder and import the zip instead.');
  const byStem = new Map(docs.map(d => [stem(d.name), d.doc.documentElement]));
  const all = el => [...el.getElementsByTagName('*')];
  const isTag = (el, re) => re.test(el.localName || el.nodeName);
  const resolve = el => {
    // A slide that only points at its own file: read that file instead.
    if (textsOf(el).length > 1 || el.children.length > 2) return el;
    for (const a of el.attributes || []) { const ref = byStem.get(String(a.value).toLowerCase()) || byStem.get(stem(String(a.value))); if (ref && ref !== el) return ref; }
    return el;
  };
  const slideOf = el => {
    const body = resolve(el);
    const texts = [...new Set(textsOf(body))];
    const title = [attr(el, 'title', 'name', 'displayname'), attr(body, 'title', 'name')].find(human) || texts[0] || 'Slide';
    return { title: title.slice(0, 120), texts: texts.filter(t => t !== title), images: mediaRefs(body, media) };
  };
  const scenes = [];
  const sceneEls = docs.flatMap(d => all(d.doc).filter(e => isTag(e, /^scene$/i)));
  for (const sc of sceneEls) {
    const slides = all(sc).filter(e => isTag(e, /^(slide|sld)$/i) && !all(sc).some(o => o !== e && isTag(o, /^(slide|sld)$/i) && o.contains(e)));
    if (slides.length) scenes.push({ name: attr(sc, 'title', 'name') || `Scene ${scenes.length + 1}`, slides: slides.map(slideOf) });
  }
  if (!scenes.length) {
    const slideEls = docs.flatMap(d => all(d.doc).filter(e => isTag(e, /^(slide|sld)$/i)));
    const outer = slideEls.filter(e => !slideEls.some(o => o !== e && o.contains(e)));
    if (outer.length) scenes.push({ name: 'Scene 1', slides: outer.map(slideOf) });
  }
  if (!scenes.length) {
    // No slide elements: one slide per XML file in a slides folder (or with text in it).
    const pick = docs.filter(d => /slide/i.test(d.name)).length ? docs.filter(d => /slide/i.test(d.name)) : docs;
    const slides = pick.map(d => ({ ...slideOf(d.doc.documentElement), title: slideOf(d.doc.documentElement).title || stem(d.name) })).filter(s => s.texts.length || s.images.length);
    if (slides.length) scenes.push({ name: 'Scene 1', slides });
  }
  const title = docs.map(d => attr(d.doc.documentElement, 'title', 'name')).find(human) || '';
  return { title, scenes, media };
}

/* ---- published Storyline output (story.html, html5/data/js/*.js) ---- */
const provided = text => [...String(text).matchAll(/globalProvideData\(\s*'(\w+)'\s*,\s*'((?:\\.|[^'\\])*)'\s*\)/g)].map(m => {
  try { return { kind: m[1], data: JSON.parse(JSON.parse('"' + m[2].replace(/\\'/g, "'").replace(/"/g, '\\"').replace(/\\\\"/g, '\\"') + '"')) }; } catch (e) {
    try { return { kind: m[1], data: JSON.parse(m[2].replace(/\\'/g, "'").replace(/\\\\/g, '\\')) }; } catch (e2) { return null; }
  }
}).filter(Boolean);
function jsonTexts(v, out = [], key = '') {
  if (typeof v === 'string') { if (/^(text|title|alttext|accText|caption|label|value|html|displaytext)$/i.test(key)) for (const t of unmark(decode(v))) if (human(t)) out.push(t.replace(/\s+/g, ' ').trim()); }
  else if (Array.isArray(v)) v.forEach(x => jsonTexts(x, out, key));
  else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) jsonTexts(x, out, k);
  return out;
}
async function fromPublished(zip, files) {
  const media = new Map(files.filter(f => MEDIA.test(f.name)).map(f => [base(f.name), f.name]));
  const payloads = [];
  for (const f of files.filter(x => /html5\/data\/js\/.*\.js$/i.test(x.name))) for (const p of provided(await f.async('string'))) payloads.push({ ...p, file: f.name });
  const data = payloads.find(p => p.kind === 'data')?.data;
  const slideData = new Map(payloads.filter(p => p.kind === 'slide').map(p => [String(p.data?.id || stem(p.file)), p.data]));
  const sceneList = [];
  const walk = v => { if (Array.isArray(v)) v.forEach(walk); else if (v && typeof v === 'object') { if (Array.isArray(v.slides) && v.slides.some(s => s && typeof s === 'object')) sceneList.push(v); else Object.values(v).forEach(walk); } };
  walk(data);
  const slideOf = s => {
    const full = slideData.get(String(s.id)) || slideData.get(String(s.id || '').split('.').pop()) || s;
    const texts = [...new Set(jsonTexts(full))];
    const title = (human(s.title) && s.title) || texts[0] || 'Slide';
    const hay = JSON.stringify(full).toLowerCase();
    const images = [...media].filter(([b]) => hay.includes(b)).map(([, p]) => p);
    return { title: String(title).slice(0, 120), texts: texts.filter(t => t !== title), images };
  };
  const scenes = sceneList.map((sc, i) => ({ name: (human(sc.title) && sc.title) || `Scene ${i + 1}`, slides: sc.slides.filter(s => s && typeof s === 'object').map(slideOf) }));
  if (!scenes.length && slideData.size) scenes.push({ name: 'Scene 1', slides: [...slideData.values()].map(slideOf) });
  return { title: (data && human(data.title) && data.title) || '', scenes, media };
}

/* ---- turning what was read into a course ---- */
async function pictureFrom(zip, path, max = 1000) {
  const blob = await zip.file(path)?.async('blob');
  if (!blob) return null;
  if (/\.svg$/i.test(path)) return blob.size < 300_000 ? { src: `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(await blob.text())))}`, w: 0, h: 0 } : null;
  const url = URL.createObjectURL(blob);
  try {
    const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
    const k = Math.min(1, max / Math.max(img.width, img.height)), c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(img.width * k)); c.height = Math.max(1, Math.round(img.height * k));
    const g = c.getContext('2d');
    g.drawImage(img, 0, 0, c.width, c.height);
    // See-through pictures (icons, cut-outs) stay PNG; photos become JPEG, which is much smaller.
    let alpha = false;
    if (/\.png$/i.test(path)) { const d = g.getImageData(0, 0, c.width, c.height).data; for (let i = 3; i < d.length; i += 4 * 7) if (d[i] < 250) { alpha = true; break; } }
    // WebP where the browser can write it (small, and keeps see-through parts); else PNG or JPEG.
    const webp = c.toDataURL('image/webp', 0.72);
    const src = webp.startsWith('data:image/webp') ? webp : alpha ? c.toDataURL('image/png') : c.toDataURL('image/jpeg', 0.7);
    return { src, w: c.width, h: c.height };
  } catch (e) { return null; } finally { URL.revokeObjectURL(url); }
}
export async function storyToCourse(zip, fileName) {
  const files = Object.values(zip.files).filter(f => !f.dir);
  // A Storyline 360 package (story/story.xml with scenes): read it by its structure.
  if (zip.file('story/story.xml')) {
    const head = (await zip.file('story/story.xml').async('string')).slice(0, 400000);
    if (/<sceneLst[\s>]/.test(head)) return fromStoryPackage(zip, fileName);
  }
  const published = files.some(f => /html5\/data\/js\/data\.js$/i.test(f.name));
  const read = published ? await fromPublished(zip, files) : await fromStoryXml(zip, files);
  const scenes = read.scenes.filter(sc => sc.slides.length);
  if (!scenes.length) throw new Error(published ? 'No slides were found in that published course.' : 'No slides could be read from that .story file. In Storyline, use Publish → Web, zip the output folder and import the zip — that format reads more fully.');
  const c = newCourse(read.title || fileName.replace(/\.[^.]+$/, ''));
  let budget = 2_400_000, pics = 0, texts = 0;
  const cache = new Map();
  c.scenes = [];
  for (const sc of scenes) {
    const slides = [];
    for (const s of sc.slides.slice(0, 300)) {
      const slide = newSlide(s.title, 'blank');
      const b = slide.layers[0];
      b.objects.push(newObject('text', { name: 'Title', text: s.title, x: 50, y: 30, w: 860, h: 64, style: { fill: 'transparent', color: '#1f2433', size: 30, bold: true, align: 'left', valign: 'top' } }));
      const imgs = [];
      for (const path of s.images.slice(0, 3)) {
        if (!cache.has(path)) cache.set(path, budget > 0 ? await pictureFrom(zip, path) : null);
        const p = cache.get(path);
        if (p && (budget -= p.src.length) > 0) imgs.push(p);
      }
      const body = s.texts.slice(0, 14);
      texts += s.texts.length;
      const textW = imgs.length ? 470 : 860;
      if (body.length) b.objects.push(newObject('text', { name: 'Text', text: body.map(t => (body.length > 1 ? '• ' : '') + t).join('\n'), x: 50, y: 110, w: textW, h: 400, style: { fill: 'transparent', color: '#1f2433', size: body.length > 6 ? 16 : 20, align: 'left', valign: 'top' } }));
      imgs.forEach((p, i) => {
        const boxW = body.length ? 380 : 600, boxH = imgs.length > 1 ? 400 / imgs.length - 10 : 380;
        const k = Math.min(boxW / p.w, boxH / p.h, 1.5);
        const w = Math.round(p.w * k), h = Math.round(p.h * k);
        b.objects.push(newObject('image', { name: `Picture ${i + 1}`, src: p.src, x: body.length ? 560 + Math.round((boxW - w) / 2) : Math.round((960 - w) / 2), y: 110 + i * (boxH + 10), w, h }));
        pics++;
      });
      slide.notes = ['Imported from ' + (published ? 'a published Storyline course' : 'a Storyline .story file') + '.', ...(s.texts.length > 14 ? ['More text from this slide:', ...s.texts.slice(14)] : [])].join('\n');
      slides.push(slide);
    }
    c.scenes.push(newScene(sc.name, slides));
  }
  const n = c.scenes.reduce((a, sc) => a + sc.slides.length, 0);
  return { course: c, report: { from: published ? 'published' : 'story', scenes: c.scenes.length, slides: n, texts, pictures: pics } };
}


// MD5 of bytes (Storyline records each media file's MD5): to find a picture whose size changed.
export function md5(bytes) {
  const K = new Uint32Array(64), S = [7, 12, 17, 22, 5, 9, 14, 20, 4, 11, 16, 23, 6, 10, 15, 21];
  for (let i = 0; i < 64; i++) K[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 2 ** 32) >>> 0;
  const n = bytes.length, total = ((n + 8) >>> 6) + 1, M = new Uint32Array(total * 16);
  for (let i = 0; i < n; i++) M[i >> 2] |= bytes[i] << ((i % 4) * 8);
  M[n >> 2] |= 0x80 << ((n % 4) * 8);
  M[total * 16 - 2] = (n * 8) >>> 0; M[total * 16 - 1] = Math.floor(n / 0x20000000);
  let a0 = 0x67452301, b0 = 0xefcdab89, c0 = 0x98badcfe, d0 = 0x10325476;
  for (let o = 0; o < M.length; o += 16) {
    let A = a0, B = b0, C = c0, D = d0;
    for (let i = 0; i < 64; i++) {
      let F, g;
      if (i < 16) { F = (B & C) | (~B & D); g = i; } else if (i < 32) { F = (D & B) | (~D & C); g = (5 * i + 1) % 16; } else if (i < 48) { F = B ^ C ^ D; g = (3 * i + 5) % 16; } else { F = C ^ (B | ~D); g = (7 * i) % 16; }
      const t = D; D = C; C = B;
      const x = (A + F + K[i] + M[o + g]) >>> 0, r = S[(i >> 4) * 4 + (i % 4)];
      B = (B + ((x << r) | (x >>> (32 - r)))) >>> 0; A = t;
    }
    a0 = (a0 + A) >>> 0; b0 = (b0 + B) >>> 0; c0 = (c0 + C) >>> 0; d0 = (d0 + D) >>> 0;
  }
  return [a0, b0, c0, d0].map(v => [0, 8, 16, 24].map(sh => ((v >>> sh) & 255).toString(16).padStart(2, '0')).join('')).join('');
}

/* ---- the .story package itself (Storyline 360: OPC parts story/story.xml, story/slides/*.xml) ----
   Read by its structure: scenes (story.xml sceneLst → sldId → the slide part, through story.xml.rels),
   each slide's shapes (position, size, fill, text and font), pictures (the shape's assetG → the media entry
   in story.xml → the media part of that size), layers (sldLayerLst), object states, the timeline and entrance
   animations, project variables, and triggers (show / hide layer, change state, jump, adjust variable, pause /
   resume the timeline) with their variable and state conditions. */
const kids = (el, tag) => (el ? [...el.children].filter(c => c.localName === tag) : []);
const kid = (el, tag) => kids(el, tag)[0] || null;
const desc = (el, tag) => (el ? [...el.getElementsByTagName(tag)] : []);
const num = v => (v == null || v === '' ? 0 : Number(v) || 0);
const SHAPE_TAGS = new Set(['rect', 'roundRect', 'pic', 'textBox', 'line', 'clkAreaRect', 'oval', 'roundSameSideCorner', 'table', 'triangle', 'rtTriangle', 'ellipse', 'svgimage', 'freeform', 'star5', 'rightArrow', 'leftArrow', 'chevron', 'pentagon', 'hexagon', 'octagon', 'diamond', 'parallelogram', 'trapezoid', 'snip1Rect', 'round1Rect', 'round2SameRect', 'plaque', 'cloud', 'heart', 'donut']);
const BUILTIN_STATE = { normal: 'normal', hover: 'hover', down: 'down', selected: 'selected', visited: 'visited', disabled: 'disabled', hidden: 'hidden' };
const stateKey = n => BUILTIN_STATE[String(n || '').toLowerCase()] || String(n || '').trim();

function themeColors(zip, texts) {
  const out = { lt1: '#ffffff', dk1: '#000000', lt2: '#eeece1', dk2: '#1f497d', accent1: '#4f81bd', accent2: '#c0504d', accent3: '#9bbb59', accent4: '#8064a2', accent5: '#4bacc6', accent6: '#f79646', hlink: '#0000ff', windowtext: '#000000', window: '#ffffff' };
  for (const t of texts) {
    const doc = new DOMParser().parseFromString(t, 'application/xml');
    for (const k of Object.keys(out)) {
      const el = doc.getElementsByTagName(k)[0] || doc.getElementsByTagNameNS('*', k)[0];
      const c = el && (el.getElementsByTagName('srgbClr')[0] || el.getElementsByTagNameNS('*', 'srgbClr')[0] || el.getElementsByTagNameNS('*', 'sysClr')[0]);
      const v = c && (c.getAttribute('val') || c.getAttribute('lastClr'));
      if (v && /^[0-9a-f]{6}$/i.test(v)) out[k] = '#' + v;
    }
  }
  return out;
}
const colorOf = (clr, theme) => {
  if (!clr) return null;
  const rgb = desc(clr, 'srgbClr')[0], sch = desc(clr, 'schemeClr')[0];
  if (rgb && /^[0-9a-f]{6}$/i.test(rgb.getAttribute('val'))) return '#' + rgb.getAttribute('val');
  if (sch) { const v = sch.getAttribute('val'); return theme[v] || theme[{ bg1: 'lt1', tx1: 'dk1', bg2: 'lt2', tx2: 'dk2' }[v]] || null; }
  return null;
};
// The fill of a shape (its bG), or of a slide (its bg): solid, the first stop of a gradient, or none.
const fillOf = (bg, theme) => {
  if (!bg) return null;
  if (kid(bg, 'noFill')) return 'transparent';
  const solid = kid(bg, 'solidFill');
  if (solid) return colorOf(solid, theme);
  const grad = kid(bg, 'gradFill');
  if (grad) return colorOf(desc(grad, 'clr')[0], theme);
  return null;
};
// Text and its look, from the shape's rich text (an XML document kept as text) or its plain text.
function textOf(el, theme) {
  const xmlEl = kid(el, 'fmtText') || kid(el, 'text') || desc(el, 'fmtText')[0] || desc(el, 'text')[0];
  const plain = (kid(el, 'plain') || desc(el, 'plain')[0])?.textContent || '';
  let lines = [], look = {};
  if (xmlEl && xmlEl.textContent.includes('<')) {
    const doc = new DOMParser().parseFromString(xmlEl.textContent, 'application/xml');
    for (const block of doc.getElementsByTagName('Block')) {
      const style = block.getElementsByTagName('Style')[0], list = block.getElementsByTagName('ListStyle')[0];
      const spans = [...block.getElementsByTagName('Span')];
      const line = spans.map(s => s.getAttribute('Text') || '').join('');
      const bullet = list && list.getAttribute('ListType') && list.getAttribute('ListType') !== 'None' ? (list.getAttribute('ListType') === 'Number' ? `${lines.filter(Boolean).length + 1}. ` : '• ') : '';
      lines.push(line ? bullet + line : '');
      if (!look.size) {
        const first = spans.find(s => s.getAttribute('Text')) || spans[0];
        const st = first && [...first.children].find(c => c.localName === 'Style');
        if (st) {
          const fc = st.getAttribute('ForegroundColor') || '';
          const fs = Number(st.getAttribute('FontSize'));
          look = { size: fs ? Math.round(fs * 1.333) : undefined, bold: st.getAttribute('FontIsBold') === 'True', italic: st.getAttribute('FontIsItalic') === 'True',
            color: /^#[0-9a-f]{6}/i.test(fc) ? fc.slice(0, 7) : theme[fc] || theme[{ windowtext: 'dk1' }[fc]] || undefined, font: st.getAttribute('FontFamily') };
        }
        const j = style?.getAttribute('Justification');
        if (j) look.align = /center/i.test(j) ? 'center' : /right/i.test(j) ? 'right' : 'left';
      }
    }
    while (lines.length && !lines[lines.length - 1]) lines.pop();
  }
  const text = lines.some(Boolean) ? lines.join('\n') : plain.trim();
  return { text, look };
}

// A state's own drawing (its shapeLst, in a frame of its own): the background (a shape or picture covering the
// frame), the text on it and its look, scaled to the object's box.
function stateDrawing(st, w, h, theme) {
  const shapes = kid(st, 'shapeLst') ? [...kid(st, 'shapeLst').children] : [];
  const boxes = shapes.map(c => { const l = kid(c, 'loc'); return l ? { c, l: num(l.getAttribute('l')), t: num(l.getAttribute('t')), r: num(l.getAttribute('r')), b: num(l.getAttribute('b')) } : null; }).filter(Boolean);
  if (!boxes.length) return null;
  const fw = Math.max(...boxes.map(b => b.r)) || w, fh = Math.max(...boxes.map(b => b.b)) || h, k = Math.min(w / fw, h / fh) || 1;
  const covers = b => (b.r - b.l) >= fw * 0.9 && (b.b - b.t) >= fh * 0.9;
  const out = {};
  const bgBox = boxes.find(b => covers(b) && b.c.localName !== 'pic' && fillOf(kid(b.c, 'bG'), theme) && fillOf(kid(b.c, 'bG'), theme) !== 'transparent');
  if (bgBox) { out.fill = fillOf(kid(bgBox.c, 'bG'), theme); if (bgBox.c.localName === 'roundRect') out.radius = Math.round(Math.min(w, h) * 0.18); if (bgBox.c.localName === 'oval') out.shape = 'ellipse'; }
  const picBox = boxes.find(b => b.c.localName === 'pic' && (b.r - b.l) * (b.b - b.t) >= fw * fh * 0.25);
  if (picBox) out.assetG = picBox.c.getAttribute('assetG');
  const texts = boxes.map(b => ({ b, ...textOf(b.c, theme) })).filter(x => x.text);
  if (texts.length) {
    out.text = texts.map(x => x.text).join('\n');
    const L = texts[0].look;
    if (L.color) out.color = L.color;
    if (L.size) out.size = Math.max(8, Math.round(L.size * k));
    if (L.bold != null) out.bold = L.bold;
    if (L.align) out.align = L.align;
    const v = texts[0].b.c.getAttribute('vertAlign'); out.valign = { ctr: 'middle', b: 'bottom' }[v] || 'middle';
  }
  return out;
}

export async function fromStoryPackage(zip, fileName) {
  const read = p => zip.file(p.replace(/^\//, ''))?.async('string');
  const parse = t => new DOMParser().parseFromString(String(t || '').replace(/^﻿/, ''), 'application/xml');
  const rels = async p => { const t = await read(p.replace(/([^/]+)$/, '_rels/$1.rels')); const m = new Map(); if (t) for (const r of parse(t).getElementsByTagName('Relationship')) m.set(r.getAttribute('Id'), r.getAttribute('Target').replace(/^\//, '')); return m; };
  const story = parse(await read('story/story.xml')).documentElement;
  const storyRels = await rels('story/story.xml');
  const themes = [];
  for (const f of Object.keys(zip.files).filter(n => /^story\/theme\/.*\.xml$/i.test(n))) themes.push(await read(f));
  const theme = themeColors(zip, themes);
  const sz = desc(story, 'sz')[0];
  const W = Math.round(num(sz?.getAttribute('w')) || 960), H = Math.round(num(sz?.getAttribute('h')) || 540);

  // Variables (the project's own; the player's built-in ones are left out).
  const varName = new Map(), vars = [];
  for (const v of desc(kid(story, 'varLst'), 'var')) {
    if (v.getAttribute('type') === 'builtIn') continue;
    const name = (v.getAttribute('name') || '').replace(/[^\w]/g, '') || 'Variable';
    const type = v.getAttribute('dataType') === 'num' ? 'number' : v.getAttribute('dataType') === 'bool' ? 'bool' : 'text';
    const raw = v.getAttribute('val') || '';
    varName.set(v.getAttribute('g'), name);
    vars.push({ id: 'v' + vars.length + Math.random().toString(36).slice(2, 7), name, type, value: type === 'number' ? Number(raw) || 0 : type === 'bool' ? /^true$/i.test(raw) : raw });
  }
  // Pictures: the media entries (by id) and the media parts (by size).
  const mediaByG = new Map(desc(story, 'media').map(m => [m.getAttribute('g'), { bytes: num(m.getAttribute('bytes')), type: (m.getAttribute('type') || '').toLowerCase(), sums: [desc(m, 'stream')[0]?.textContent, desc(m, 'source')[0]?.textContent].filter(Boolean) }]));
  let sums = null; // MD5 → media part, made the first time a picture's size doesn't match
  const bySum = async () => { if (!sums) { sums = new Map(); for (const n of partSize.keys()) sums.set(md5(await zip.file(n).async('uint8array')), n); } return sums; };
  const partSize = new Map();
  for (const [n, f] of Object.entries(zip.files)) if (/^story\/media\//i.test(n) && MEDIA.test(n)) partSize.set(n, f._data?.uncompressedSize ?? -1);
  const pictureOf = async (assetG, prefer) => {
    const m = mediaByG.get(assetG);
    if (!m) return null;
    const hits = [...partSize].filter(([, s]) => s === m.bytes).map(([n]) => n);
    if (hits.length) return hits.find(n => prefer.includes(n)) || hits[0];
    if (!m.sums.length) return null;
    const map = await bySum();
    for (const sum of m.sums) if (map.has(sum)) return map.get(sum);
    return null;
  };

  const report = { slides: 0, layers: 0, objects: 0, triggers: 0, skipped: 0, pictures: 0, picturesSkipped: 0 };
  // Each picture is kept once, in course.assets, and objects point at it ("asset:<id>"). A file holds about
  // 1.5 MB of pictures (browsers keep about 5 MB for the whole app); past that, the rest are left out (and counted).
  let budget = 1_500_000;
  const assets = {}, assetOf = new Map();
  const loadPic = async (path, w, h) => {
    if (!assetOf.has(path)) {
      const p = budget > 20_000 ? await pictureFrom(zip, path, Math.min(720, Math.max(200, Math.round(Math.max(w, h) * 1.05)))) : null;
      if (p && p.src.length <= budget) { const id = 'a' + assetOf.size.toString(36); assets[id] = p.src; budget -= p.src.length; assetOf.set(path, 'asset:' + id); } else assetOf.set(path, null);
    }
    return assetOf.get(path);
  };
  const course = newCourse(story.getAttribute('name') || fileName.replace(/\.[^.]+$/, ''));
  course.size = { w: W, h: H }; course.vars = vars; course.scenes = []; course.assets = assets;
  const pendingTrig = []; // resolved once every id is known
  const objId = new Map(), layerId = new Map(), slideIdOf = new Map();

  const buildObjects = async (shapeLst, prefer) => {
    const out = [];
    // In stacking order (zOrder), bottom first.
    const els = shapeLst ? [...shapeLst.children].map((e, i) => ({ e, z: e.hasAttribute('zOrder') ? num(e.getAttribute('zOrder')) : i, i })).sort((a, b) => a.z - b.z || a.i - b.i).map(x => x.e) : [];
    for (const el of els) {
      if (!SHAPE_TAGS.has(el.localName)) continue;
      const loc = kid(el, 'loc');
      if (!loc) continue;
      const x = num(loc.getAttribute('l')), y = num(loc.getAttribute('t')), w = Math.max(2, num(loc.getAttribute('r')) - x), h = Math.max(2, num(loc.getAttribute('b')) - y);
      const tag = el.localName, name = el.getAttribute('name') || tag;
      const { text, look } = textOf(el, theme);
      const fill = fillOf(kid(el, 'bG'), theme);
      const style = { fill: fill || 'transparent', color: look.color || '#1f2433', size: look.size || 18, bold: look.bold, italic: look.italic, align: look.align || ({ c: 'center', r: 'right' }[el.getAttribute('horzAlign')] || 'left'), valign: { ctr: 'middle', b: 'bottom' }[el.getAttribute('vertAlign')] || 'top' };
      if (tag === 'roundRect' || tag === 'roundSameSideCorner') style.radius = Math.round(Math.min(w, h) * 0.18);
      if (tag === 'oval' || tag === 'ellipse') style.shape = 'ellipse';
      let o;
      if (tag === 'pic' || tag === 'svgimage') {
        const path = await pictureOf(el.getAttribute('assetG'), prefer);
        const src = path ? await loadPic(path, w, h) : null;
        if (path && src) report.pictures++; else if (path) report.picturesSkipped++;
        o = newObject('image', { name, x, y, w, h, src: src || '', alt: (kid(el, 'alt') || desc(el, 'alt')[0])?.getAttribute('text') || '', style: { fill: src ? 'transparent' : '#e9ebf3', fit: 'fill' } });
      } else if (tag === 'clkAreaRect') o = newObject('hotspot', { name, x, y, w, h });
      else if (tag === 'line') o = newObject('shape', { name, x, y: y + h / 2 - 1, w, h: 2, text: '', style: { fill: fill && fill !== 'transparent' ? fill : '#9aa3b5' } });
      else o = newObject(text && (!fill || fill === 'transparent') ? 'text' : 'shape', { name, x, y, w, h, text, style });
      o.style = { ...o.style, ...(o.kind === 'image' || o.kind === 'hotspot' ? {} : style), ...(o.kind === 'image' ? o.style : {}) };
      if (o.kind === 'shape' && !text) o.text = '';
      // States: each one's own drawing (background, text, picture), or just its fill. The Normal state's drawing
      // is the object's own look.
      for (const st of kids(kid(el, 'stateLst'), 'state')) {
        const key = stateKey(st.getAttribute('name'));
        if (!key) continue;
        const dr = stateDrawing(st, w, h, theme);
        const f = fillOf(kid(st, 'bg') || kid(st, 'bG'), theme);
        const look = {};
        if (dr) {
          if (dr.fill) look.fill = dr.fill;
          for (const k2 of ['color', 'size', 'bold', 'align', 'valign', 'radius', 'shape']) if (dr[k2] != null) look[k2] = dr[k2];
          if (dr.text != null) look.text = dr.text;
          if (dr.assetG) { const path = await pictureOf(dr.assetG, prefer); const src = path ? await loadPic(path, w, h) : null; if (src) { look.src = src; report.pictures++; } else if (path) report.picturesSkipped++; }
        } else if (f && f !== 'transparent') look.fill = f;
        if (key === 'normal') {
          if (look.src && o.kind !== 'image') { const keep = { id: o.id, name: o.name, states: o.states, start: o.start, dur: o.dur, anim: o.anim }; Object.assign(o, newObject('image', { x, y, w, h }), keep); o.src = look.src; o.style = { fill: 'transparent', fit: 'fill' }; }
          if (look.text != null && o.kind === 'text' && look.fill) o.kind = 'shape';
          if (look.text != null) { o.text = look.text; if (o.kind === 'image' && look.text) o.kind = 'shape'; }
          if (o.kind === 'text' && look.fill) o.kind = 'shape';
          const { text: _t, src: _s, ...rest } = look;
          o.style = { ...o.style, ...rest };
          continue;
        }
        if (key === 'hidden') { o.states.hidden = {}; continue; }
        if (key === 'disabled' && !look.fill) look.opacity = 0.5;
        o.states[key] = look;
      }
      const init = stateKey(el.getAttribute('initState'));
      if (init && init !== 'normal') { o.initial = init; if (!['hidden', 'disabled'].includes(init) && !o.states[init]) o.states[init] = {}; }
      // The timeline: when it appears and for how long; its entrance animation.
      const tm = kid(el, 'tmCtxLst')?.firstElementChild; // tmCtx, or txtTmCtx in newer files
      if (tm) { o.start = num(tm.getAttribute('start')) / 1000; o.dur = tm.getAttribute('untilEnd') === 'true' ? null : num(tm.getAttribute('dur')) / 1000 || null; }
      const entr = desc(el, 'entr')[0];
      if (entr && entr.children[0]) { const a = entr.children[0].localName.toLowerCase(); o.anim = /fade/.test(a) ? 'fade' : /fly|wipe|float/.test(a) ? 'fly-up' : /zoom|grow/.test(a) ? 'zoom' : /spin/.test(a) ? 'spin' : /bounce/.test(a) ? 'bounce' : 'fade'; }
      const sh = kid(kid(el, 'bG'), 'shdw');
      if (sh && kid(sh, 'preset')?.getAttribute('val') !== 'none') o._shdw = true;
      objId.set(el.getAttribute('g'), o.id);
      for (const t of kids(kid(el, 'trigLst'), 'trig')) pendingTrig.push({ t, owner: o.id, ownerKind: 'object' });
      out.push(o);
      report.objects++;
    }
    return out;
  };

  for (const sc of kids(kid(story, 'sceneLst'), 'scene')) {
    const slides = [];
    for (const ref of desc(sc, 'sldId')) {
      const path = storyRels.get(ref.textContent.trim());
      if (!path) continue;
      const sld = parse(await read(path)).documentElement;
      if (!sld || sld.localName !== 'sld') continue;
      const prefer = [...(await rels(path)).values()];
      const s = newSlide(sld.getAttribute('name') || 'Slide', 'blank');
      s.bg = fillOf(kid(sld, 'bg'), theme) || '#ffffff';
      if (s.bg === 'transparent') s.bg = '#ffffff';
      s.layers[0].objects = await buildObjects(kid(sld, 'shapeLst'), prefer);
      // A card the same color as the slide shows by its shadow.
      const card = o => { if (o._shdw && o.kind === 'shape' && String(o.style.fill).toLowerCase() === String(s.bg).toLowerCase()) o.style.shadow = true; delete o._shdw; };
      slideIdOf.set(sld.getAttribute('g'), s.id);
      for (const t of kids(kid(sld, 'trigLst'), 'trig')) pendingTrig.push({ t, layer: s.layers[0], slide: s, ownerKind: 'layer' });
      for (const t of pendingTrig.filter(p => !p.layer && !p.slide)) { t.layer = s.layers[0]; t.slide = s; }
      for (const ly of kids(kid(sld, 'sldLayerLst'), 'sldLayer')) {
        const L = newLayer(ly.getAttribute('name') || `Layer ${s.layers.length}`);
        L.objects = await buildObjects(kid(ly, 'shapeLst'), prefer);
        L.objects.forEach(card);
        layerId.set(ly.getAttribute('g'), L.id);
        for (const t of kids(kid(ly, 'trigLst'), 'trig')) pendingTrig.push({ t, layer: L, slide: s, ownerKind: 'layer' });
        for (const t of pendingTrig.filter(p => !p.layer && !p.slide)) { t.layer = L; t.slide = s; }
        s.layers.push(L);
        report.layers++;
      }
      s.layers[0].objects.forEach(card);
      const ends = s.layers[0].objects.map(o => o.start + (o.dur || 0));
      s.duration = Math.max(1, Math.round(Math.max(num(kid(sld, 'tmProps')?.getAttribute('min')) / 1000, ...ends) * 2) / 2);
      s.next = 'user';
      s.notes = 'Imported from a Storyline .story file.';
      slides.push(s);
      report.slides++;
    }
    if (slides.length) course.scenes.push(newScene(sc.getAttribute('name') || `Scene ${course.scenes.length + 1}`, slides));
  }

  // Triggers, now that every object, layer and slide has its id here.
  const OPS = { eq: '==', noteq: '!=', gt: '>', lt: '<', gte: '>=', lte: '<=', ge: '>=', le: '<=', contains: 'contains' };
  for (const p of pendingTrig) {
    const d = kid(p.t, 'data');
    if (!d || d.getAttribute('enabled') === 'false' || !p.layer) { report.skipped++; continue; }
    const ev = d.getAttribute('event'), act = d.getAttribute('action'), sub = d.getAttribute('actSubType');
    const shape = kid(d, 'shape'), ly = kid(d, 'sldLayer'), other = kid(d, 'other');
    const t = { id: 'tr' + Math.random().toString(36).slice(2, 10), conds: [] };
    // When
    if (ev === 'OnClick' && p.ownerKind === 'object') { t.event = 'click'; t.source = p.owner; }
    else if (ev === 'OnStart') t.event = 'timelineStart';
    else if (ev === 'OnEnd') t.event = 'timelineEnd';
    else if (ev === 'OnVariableValueChange' && varName.has(other?.getAttribute('varChangeG'))) { t.event = 'varChange'; t.source = varName.get(other.getAttribute('varChangeG')); }
    else if (ev === 'OnStateChange' && p.ownerKind === 'object') { t.event = 'stateChange'; t.source = p.owner; t.value = stateKey(shape?.getAttribute('stateName')) || ''; }
    else { report.skipped++; continue; }
    // Do
    if (act === 'showSubSlide' && layerId.has(ly?.getAttribute('showG'))) { t.action = 'showLayer'; t.target = layerId.get(ly.getAttribute('showG')); }
    else if (act === 'hideSubSlide') { t.action = 'hideLayer'; t.target = sub === 'me' || !layerId.has(ly?.getAttribute('hideG')) ? 'this' : layerId.get(ly.getAttribute('hideG')); }
    else if (act === 'changeShapeState' && shape?.getAttribute('setStateName')) {
      const target = objId.get(shape.getAttribute('setStateG')) || (p.ownerKind === 'object' && !shape.getAttribute('setStateG') ? p.owner : null);
      if (!target) { report.skipped++; continue; }
      t.action = 'state'; t.target = target; t.value = stateKey(shape.getAttribute('setStateName'));
    } else if (act === 'jumpToSlide') {
      const dest = kid(d, 'slide')?.getAttribute('g') || d.getAttribute('slideG');
      t.action = 'jump'; t.target = sub === 'prev' ? 'prev' : sub === 'spec' && slideIdOf.has(dest) ? slideIdOf.get(dest) : 'next';
    } else if (act === 'PauseTimeline' || act === 'ResumeTimeline') { t.action = 'timeline'; t.value = act === 'PauseTimeline' ? 'pause' : 'resume'; }
    else if (act === 'adjustVar' && varName.has(other?.getAttribute('varG'))) {
      const name = varName.get(other.getAttribute('varG')), def = vars.find(v => v.name === name);
      const op = other.getAttribute('op');
      t.action = 'setVar'; t.target = name;
      t.op = { add: 'add', sub: 'subtract', mul: 'multiply', div: 'divide', not: 'toggle' }[op] || 'set';
      t.value = def?.type === 'bool' ? String(/^true$/i.test(other.getAttribute('boolVal') || '')) : def?.type === 'number' ? String(num(other.getAttribute('dblVal')) || num(other.getAttribute('varVal1'))) : other.getAttribute('varVal1') || '';
    } else { report.skipped++; continue; }
    // If
    let ok = true;
    for (const c of desc(kid(p.t, 'condLst'), 'trigCond')) {
      const ss = kid(c, 'shapeState');
      if (ss && objId.has(ss.getAttribute('shapeG'))) { t.conds.push({ left: 'state:' + objId.get(ss.getAttribute('shapeG')), op: c.getAttribute('op') === 'noteq' ? '!=' : '==', right: stateKey(ss.getAttribute('stateName') || ss.getAttribute('state')) }); continue; }
      const name = varName.get(c.getAttribute('varG'));
      if (!name) { ok = false; break; }
      const def = vars.find(v => v.name === name);
      t.conds.push({ left: name, op: OPS[c.getAttribute('op')] || '==', right: def?.type === 'bool' ? String(/^true$/i.test(c.getAttribute('boolVal') || '')) : def?.type === 'number' ? String(num(c.getAttribute('floatVal1'))) : c.getAttribute('strVal1') || '' });
    }
    if (!ok) { report.skipped++; continue; }
    p.layer.triggers.push(t);
    report.triggers++;
  }
  if (!course.scenes.length) throw new Error('No slides could be read from that .story file.');
  return { course, report: { from: 'story', scenes: course.scenes.length, slides: report.slides, texts: report.objects, pictures: report.pictures, ...report, bytes: JSON.stringify(course).length } };
}
