/* Importing Articulate Storyline courses, as far as can be read from the file:

   .story          A zip of XML files and media. Its format isn't published, so this reads it generously:
                   scenes and slides (by their elements and names), the text on each slide, and the pictures
                   each slide refers to. Triggers, states, layers and animations aren't carried over.
   published zip   What Storyline's Publish → Web / LMS makes (story.html, html5/data/js/*.js). Its data is
                   JSON (globalProvideData), so scenes, slide titles, text and pictures read more reliably.

   Either way you get a Workline course with one slide per slide: its title, its text and its pictures, ready
   to rebuild the interactions with this editor's triggers, states and layers. */

import { newCourse, newObject, newScene, newSlide } from './course.js';

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
  if (/\.svg$/i.test(path)) return blob.size < 300_000 ? `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(await blob.text())))}` : null;
  const url = URL.createObjectURL(blob);
  try {
    const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
    const k = Math.min(1, max / Math.max(img.width, img.height)), c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(img.width * k)); c.height = Math.max(1, Math.round(img.height * k));
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    return { src: c.toDataURL('image/jpeg', 0.8), w: c.width, h: c.height };
  } catch (e) { return null; } finally { URL.revokeObjectURL(url); }
}
export async function storyToCourse(zip, fileName) {
  const files = Object.values(zip.files).filter(f => !f.dir);
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
