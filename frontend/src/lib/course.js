/* Courses: interactive e-learning made of scenes and slides (the Course view, CourseView.jsx).

   A slide has layers (the first is the base layer; others are shown and hidden by triggers), and each layer
   has objects and triggers. Objects: text, shape, button, image, hotspot, text entry, video, audio, a
   question and a result block. An object has states (Normal, Hover, Down, Selected, Visited, Disabled,
   Hidden and any of your own), each changing its look, and a place on the timeline (when it appears, for how
   long, and how it comes in). Triggers: "do ACTION when EVENT happens on OBJECT, if CONDITIONS". Variables
   (text, number, true/false) are shown in text as %Name%. Questions are scored (Quiz.Score, Quiz.Percent,
   Quiz.Passed) and a result block shows how it went.

   The same player runs the preview and the published course (a web page, or a SCORM 1.2 package for an LMS,
   which reports completion, the score and where the learner was). It's `player` below, turned into text
   for the page, so it uses nothing from outside itself. */

import { rid } from './utils.js';

export const SIZE = { w: 960, h: 540 };
export const STATES = ['normal', 'hover', 'down', 'selected', 'visited', 'disabled', 'hidden'];
export const ANIMS = [['none', 'None'], ['fade', 'Fade'], ['fly-left', 'Fly in from left'], ['fly-right', 'Fly in from right'], ['fly-up', 'Fly in from bottom'], ['fly-down', 'Fly in from top'], ['zoom', 'Grow'], ['spin', 'Spin'], ['bounce', 'Bounce']];
export const KINDS = {
  text: 'Text', shape: 'Shape', button: 'Button', image: 'Picture', hotspot: 'Hotspot', input: 'Text entry', video: 'Video', audio: 'Audio', question: 'Question', result: 'Result',
};
export const EVENTS = [
  ['click', 'User clicks', 'object'], ['hover', 'Mouse goes over', 'object'], ['leave', 'Mouse leaves', 'object'], ['drop', 'Object is dropped on', 'object'],
  ['timelineStart', 'Timeline starts', 'none'], ['timelineEnd', 'Timeline ends', 'none'], ['varChange', 'Variable changes', 'var'], ['stateChange', 'State becomes', 'object'],
  ['mediaEnd', 'Media ends', 'object'], ['correct', 'Answered right', 'object'], ['incorrect', 'Answered wrong', 'object'], ['key', 'User presses a key', 'none'],
];
export const ACTIONS = [
  ['jump', 'Jump to slide', 'slide'], ['showLayer', 'Show layer', 'layer'], ['hideLayer', 'Hide layer', 'layer'], ['state', 'Change state of', 'object'],
  ['setVar', 'Adjust variable', 'var'], ['media', 'Play / pause media', 'object'], ['timeline', 'Pause / resume timeline', 'none'], ['submit', 'Submit question', 'object'],
  ['resetQuiz', 'Reset the quiz', 'none'], ['url', 'Open a web page', 'none'], ['restart', 'Restart the course', 'none'], ['exit', 'Exit the course', 'none'],
];
export const OPS = [['==', 'is equal to'], ['!=', 'is not equal to'], ['>', 'is greater than'], ['<', 'is less than'], ['>=', 'is at least'], ['<=', 'is at most'], ['contains', 'contains'], ['empty', 'is empty'], ['notEmpty', 'is not empty']];
export const QTYPES = [['mc', 'Multiple choice'], ['mr', 'Multiple response'], ['tf', 'True / false'], ['fill', 'Fill in the blank'], ['order', 'Put in order']];
export const TRANSITIONS = [['none', 'None'], ['fade', 'Fade'], ['push', 'Push'], ['pushUp', 'Push up'], ['cover', 'Cover'], ['zoom', 'Zoom']];
export const BUILTIN_VARS = ['Quiz.Score', 'Quiz.MaxScore', 'Quiz.Percent', 'Quiz.Passed', 'Slide.Number', 'Slide.Count', 'Slide.Title', 'Course.Progress'];

/* ---- making things ---- */
const STYLE = {
  text: { fill: 'transparent', color: '#1f2433', size: 24, align: 'left', valign: 'top' },
  shape: { fill: '#e8ecfb', color: '#1f2433', size: 20, align: 'center', valign: 'middle', radius: 14, border: '#c9d1f2', borderW: 1 },
  button: { fill: '#4f5bd5', color: '#ffffff', size: 18, bold: true, align: 'center', valign: 'middle', radius: 12 },
  hotspot: { fill: 'transparent' }, image: { fill: 'transparent', radius: 8, fit: 'cover' },
  input: { fill: '#ffffff', color: '#1f2433', size: 18, radius: 10, border: '#c3c8d8', borderW: 1 },
  video: { fill: '#000000', radius: 10 }, audio: { fill: 'transparent' },
  question: { fill: '#ffffff', color: '#1f2433', size: 18, radius: 16, border: '#dfe3f0', borderW: 1 },
  result: { fill: '#ffffff', color: '#1f2433', size: 20, radius: 16, border: '#dfe3f0', borderW: 1, align: 'center' },
};
const SIZES = { text: [420, 70], shape: [260, 150], button: [200, 56], hotspot: [160, 120], image: [320, 220], input: [320, 50], video: [480, 270], audio: [320, 54], question: [640, 380], result: [520, 300] };
export function newObject(kind, extra = {}) {
  const [w, h] = SIZES[kind] || [200, 100];
  const o = { id: rid('o'), kind, name: KINDS[kind] || kind, x: Math.round((SIZE.w - w) / 2), y: Math.round((SIZE.h - h) / 2), w, h, style: { ...(STYLE[kind] || {}) }, states: {}, start: 0, dur: null, anim: 'none', ...extra };
  if (kind === 'text') o.text = extra.text ?? 'Type your text here';
  if (kind === 'shape') o.text = extra.text ?? '';
  if (kind === 'button') { o.text = extra.text ?? 'Button'; o.states = { hover: { fill: '#3d48c0' }, down: { fill: '#2f39a3' }, ...(extra.states || {}) }; }
  if (kind === 'input') { o.text = ''; o.placeholder = extra.placeholder ?? 'Type here'; o.var = extra.var ?? ''; }
  if (kind === 'question') o.q = extra.q || { type: 'mc', prompt: 'Which one is right?', choices: [{ id: rid('c'), text: 'This one', correct: true }, { id: rid('c'), text: 'That one', correct: false }, { id: rid('c'), text: 'Neither', correct: false }], answer: '', points: 10, attempts: 1, right: 'That’s right!', wrong: 'Not quite.', shuffle: false };
  if (kind === 'result') o.text = extra.text ?? 'Your score: %Quiz.Percent%%';
  return o;
}
export const newLayer = (name = 'Base layer') => ({ id: rid('l'), name, hideOthers: false, objects: [], triggers: [] });
export function newSlide(title = 'Untitled slide', kind = 'blank') {
  const s = { id: rid('s'), title, bg: '#ffffff', duration: 5, next: 'user', layers: [newLayer()], notes: '' };
  const base = s.layers[0];
  const title1 = (text, y = 40, size = 34) => newObject('text', { text, x: 60, y, w: 840, h: size * 1.8, style: { ...STYLE.text, size, bold: true } });
  if (kind === 'title') {
    s.bg = '#f3f5ff';
    base.objects.push(newObject('shape', { x: 0, y: 380, w: 960, h: 160, style: { ...STYLE.shape, fill: '#4f5bd5', border: 'transparent', radius: 0 } }),
      { ...title1(title, 150, 48), style: { ...STYLE.text, size: 48, bold: true, align: 'center' }, anim: 'fade' },
      newObject('text', { text: 'A short line about what you’ll learn', x: 60, y: 250, w: 840, h: 50, style: { ...STYLE.text, size: 22, color: '#5b6178', align: 'center' }, start: 0.5, anim: 'fly-up' }));
  } else if (kind === 'question') {
    s.title = title === 'Untitled slide' ? 'Question' : title; s.next = 'question';
    base.objects.push(title1(s.title, 30, 30), newObject('question', { x: 160, y: 110, w: 640, h: 390 }));
  } else if (kind === 'result') {
    s.title = title === 'Untitled slide' ? 'Results' : title;
    base.objects.push(title1(s.title, 30, 30), newObject('result', { x: 220, y: 120 }));
  } else if (kind === 'content') {
    base.objects.push(title1(title), newObject('text', { text: 'Write the main points here.\n• First point\n• Second point', x: 60, y: 130, w: 520, h: 260, style: { ...STYLE.text, size: 22 }, start: 0.4, anim: 'fade' }),
      newObject('shape', { x: 620, y: 130, w: 280, h: 260, text: 'Picture or diagram', style: { ...STYLE.shape, color: '#7a809a' } }));
  }
  return s;
}
export const newScene = (name = 'Scene 1', slides = [newSlide('Welcome', 'title')]) => ({ id: rid('sc'), name, slides });
export function newCourse(title = 'Untitled course') {
  return {
    v: 1, title, size: { ...SIZE }, font: 'Inter, system-ui, sans-serif', accent: '#4f5bd5',
    player: { menu: true, seekbar: true, prevNext: true, title: true, resume: true, freeNav: true },
    quiz: { pass: 80 }, complete: 'viewed', vars: [], scenes: [newScene()],
  };
}
// Every slide in order, with where it is.
export const allSlides = c => c.scenes.flatMap((sc, si) => sc.slides.map((s, i) => ({ s, sc, si, i })));
export const findSlide = (c, id) => allSlides(c).find(x => x.s.id === id);
// Copies with new ids (objects, layers, triggers that point inside get the new ids).
export function cloneSlide(s) {
  const map = new Map(), copy = JSON.parse(JSON.stringify(s));
  const nid = (old, p) => { const n = rid(p); map.set(old, n); return n; };
  copy.id = rid('s');
  for (const l of copy.layers) { l.id = nid(l.id, 'l'); for (const o of l.objects) { o.id = nid(o.id, 'o'); if (o.q) for (const ch of o.q.choices || []) ch.id = rid('c'); } }
  for (const l of copy.layers) for (const t of l.triggers) { t.id = rid('t'); for (const k of ['target', 'source']) if (map.has(t[k])) t[k] = map.get(t[k]); }
  return copy;
}

/* ---- a sample course: what the builder can do, in five slides ---- */
export function sampleCourse() {
  const c = newCourse('Workplace safety basics');
  c.vars = [{ id: rid('v'), name: 'Name', type: 'text', value: '' }, { id: rid('v'), name: 'Explored', type: 'number', value: 0 }];
  const s1 = newSlide('Workplace safety basics', 'title');
  const go = newObject('button', { text: 'Start', x: 380, y: 420, w: 200, h: 60, start: 1, anim: 'zoom', style: { ...STYLE.button, fill: '#ffffff', color: '#4f5bd5' }, states: { hover: { fill: '#eef0ff' }, down: { fill: '#dfe3ff' } } });
  s1.layers[0].objects.push(go);
  s1.layers[0].triggers.push({ id: rid('t'), event: 'click', source: go.id, action: 'jump', target: 'next', conds: [] });
  s1.duration = 3;

  const s2 = newSlide('What’s your name?', 'blank');
  const b2 = s2.layers[0];
  const ask = newObject('text', { text: 'Before we begin, what should we call you?', x: 60, y: 60, w: 840, h: 60, style: { ...STYLE.text, size: 30, bold: true } });
  const entry = newObject('input', { x: 60, y: 160, w: 420, h: 56, var: 'Name', placeholder: 'Your first name' });
  const hi = newObject('text', { text: 'Nice to meet you, %Name%! Click Next to go on.', x: 60, y: 250, w: 840, h: 50, style: { ...STYLE.text, size: 22, color: '#4f5bd5' }, initial: 'hidden' });
  b2.objects.push(ask, entry, hi);
  b2.triggers.push({ id: rid('t'), event: 'varChange', source: 'Name', action: 'state', target: hi.id, value: 'normal', conds: [{ left: 'Name', op: 'notEmpty', right: '' }] });

  const s3 = newSlide('Explore the hazards', 'blank');
  const b3 = s3.layers[0];
  b3.objects.push(newObject('text', { text: 'Click each tile to learn more, %Name%. (%Explored% of 3 seen)', x: 60, y: 40, w: 840, h: 50, style: { ...STYLE.text, size: 26, bold: true } }));
  const tiles = [['Slips & trips', '#e8f6f0', '#17836a', 'Keep walkways clear and wipe spills at once.'], ['Fire', '#fdecec', '#c0392b', 'Know your nearest exit and where the extinguishers are.'], ['Lifting', '#fff4e5', '#b5601b', 'Bend your knees, keep the load close, and ask for help.']];
  tiles.forEach(([name, fill, color, info], i) => {
    const t = newObject('button', { name, text: name, x: 60 + i * 290, y: 140, w: 260, h: 150, start: 0.3 * i, anim: 'fly-up', style: { ...STYLE.button, fill, color, size: 22, border: color, borderW: 2, radius: 18 }, states: { hover: { fill: '#ffffff' }, visited: { fill, text: '✓ ' + name } } });
    const layer = newLayer(name);
    layer.hideOthers = true;
    const card = newObject('shape', { x: 160, y: 320, w: 640, h: 170, text: info, style: { ...STYLE.shape, fill: '#ffffff', border: color, borderW: 2, size: 22 }, anim: 'zoom' });
    const close = newObject('button', { text: 'Close', x: 670, y: 440, w: 110, h: 40, style: { ...STYLE.button, fill: color, size: 15 } });
    layer.objects.push(card, close);
    layer.triggers.push({ id: rid('t'), event: 'click', source: close.id, action: 'hideLayer', target: 'this', conds: [] });
    b3.objects.push(t);
    s3.layers.push(layer);
    b3.triggers.push({ id: rid('t'), event: 'click', source: t.id, action: 'setVar', target: 'Explored', op: 'add', value: '1', conds: [{ left: `state:${t.id}`, op: '!=', right: 'visited' }] });
    b3.triggers.push({ id: rid('t'), event: 'click', source: t.id, action: 'showLayer', target: layer.id, conds: [] });
  });

  const s4 = newSlide('Quick check', 'question');
  s4.layers[0].objects[1].q = { type: 'mc', prompt: 'You see a spill in the corridor. What do you do first?', choices: [{ id: rid('c'), text: 'Walk around it', correct: false }, { id: rid('c'), text: 'Wipe it up or put up a warning sign', correct: true }, { id: rid('c'), text: 'Tell someone at the end of the day', correct: false }], answer: '', points: 10, attempts: 2, right: 'Exactly — deal with it straight away.', wrong: 'Not quite: a spill should be dealt with at once.', shuffle: false };
  const s5 = newSlide('True or false?', 'question');
  s5.layers[0].objects[1].q = { type: 'tf', prompt: 'You should lift heavy boxes with your back straight and knees bent.', choices: [{ id: rid('c'), text: 'True', correct: true }, { id: rid('c'), text: 'False', correct: false }], answer: '', points: 10, attempts: 1, right: 'Correct!', wrong: 'It’s true: knees bent, back straight.', shuffle: false };
  const s6 = newSlide('Results', 'result');
  c.scenes = [newScene('Introduction', [s1, s2]), newScene('Learn', [s3]), newScene('Quiz', [s4, s5, s6])];
  return c;
}

// A quiz: a title, three kinds of question and the results, scored with a pass mark.
export function quizCourse() {
  const c = newCourse('Quiz');
  const t = newSlide('Quiz', 'title');
  const go = newObject('button', { text: 'Start the quiz', x: 360, y: 420, w: 240, h: 60, start: 0.8, anim: 'zoom', style: { ...STYLE.button, fill: '#ffffff', color: '#4f5bd5' }, states: { hover: { fill: '#eef0ff' } } });
  t.layers[0].objects.push(go);
  t.layers[0].triggers.push({ id: rid('t'), event: 'click', source: go.id, action: 'jump', target: 'next', conds: [] });
  const q1 = newSlide('Question 1', 'question');
  const q2 = newSlide('Question 2', 'question');
  q2.layers[0].objects[1].q = { type: 'mr', prompt: 'Which of these are colours of the rainbow? (pick all)', choices: [{ id: rid('c'), text: 'Red', correct: true }, { id: rid('c'), text: 'Brown', correct: false }, { id: rid('c'), text: 'Green', correct: true }, { id: rid('c'), text: 'Violet', correct: true }], answer: '', points: 10, attempts: 1, right: 'All right!', wrong: 'Red, green and violet are; brown isn’t.', shuffle: true };
  const q3 = newSlide('Question 3', 'question');
  q3.layers[0].objects[1].q = { type: 'fill', prompt: 'What is the capital of France?', choices: [], answer: 'Paris', points: 10, attempts: 2, right: 'Yes, Paris.', wrong: 'It’s Paris.', shuffle: false };
  c.scenes = [newScene('Quiz', [t, q1, q2, q3, newSlide('Results', 'result')])];
  c.complete = 'quiz';
  return c;
}

/* ---- conditions and text, shared by the editor's labels ---- */
export const interpolate = (text, vars) => String(text ?? '').replace(/%([\w.]+)%/g, (m, k) => (k in vars ? String(vars[k]) : m));

/* ---- the player: runs a course in a page. Self-contained (it's sent as text). ---- */
export function player(C, env) {
  const W = C.size.w, H = C.size.h, doc = document;
  const flat = []; C.scenes.forEach(sc => sc.slides.forEach(s => flat.push({ s, sc })));
  const byId = id => flat.findIndex(x => x.s.id === id);
  const STATES = ['normal', 'hover', 'down', 'selected', 'visited', 'disabled', 'hidden'];
  const vars = {}; for (const v of C.vars || []) vars[v.name] = v.type === 'number' ? Number(v.value) || 0 : v.type === 'bool' ? v.value === true || v.value === 'true' : String(v.value ?? '');
  const results = {}; // question id → {correct, points, max, tries}
  const objState = {}; // object id → state name (kept when you come back to a slide)
  const visited = new Set();
  let cur = -1, layerOn = [], t0 = 0, paused = false, pausedAt = 0, raf = 0, ended = false, live = {};
  const q = (sel, el = doc) => el.querySelector(sel);
  const h = (tag, cls, txt) => { const e = doc.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; };
  const allQuestions = () => flat.flatMap(x => x.s.layers.flatMap(l => l.objects.filter(o => o.kind === 'question')));
  const builtins = () => {
    const qs = allQuestions(), max = qs.reduce((n, o) => n + (Number(o.q.points) || 0), 0);
    const score = qs.reduce((n, o) => n + (results[o.id]?.correct ? Number(o.q.points) || 0 : 0), 0);
    const pct = max ? Math.round((score / max) * 100) : 0;
    return { 'Quiz.Score': score, 'Quiz.MaxScore': max, 'Quiz.Percent': pct, 'Quiz.Passed': max > 0 && pct >= (Number(C.quiz?.pass) || 0), 'Slide.Number': cur + 1, 'Slide.Count': flat.length, 'Slide.Title': flat[cur]?.s.title || '', 'Course.Progress': Math.round((visited.size / flat.length) * 100) };
  };
  const allVars = () => ({ ...vars, ...builtins() });
  const fill = t => String(t ?? '').replace(/%([\w.]+)%/g, (m, k) => { const v = allVars(); return k in v ? String(v[k]) : m; });

  /* the page */
  doc.body.innerHTML = '';
  const root = h('div', 'cp'); doc.body.appendChild(root);
  root.style.setProperty('--acc', C.accent || '#4f5bd5');
  root.style.fontFamily = C.font || 'system-ui, sans-serif';
  const top = h('header', 'cp-top'); const ttl = h('b', '', C.title || 'Course'); top.appendChild(ttl);
  const menuBtn = h('button', 'cp-ib', '☰'); menuBtn.setAttribute('aria-label', 'Menu'); top.prepend(menuBtn);
  const body = h('div', 'cp-body'); const menu = h('nav', 'cp-menu'); menu.setAttribute('aria-label', 'Course menu');
  const wrap = h('main', 'cp-wrap'); const stage = h('div', 'cp-stage'); stage.style.width = W + 'px'; stage.style.height = H + 'px'; stage.setAttribute('role', 'region'); stage.setAttribute('aria-label', 'Slide');
  wrap.appendChild(stage); body.append(menu, wrap);
  const bar = h('footer', 'cp-bar');
  const play = h('button', 'cp-ib', '❚❚'); play.setAttribute('aria-label', 'Pause');
  const seek = h('div', 'cp-seek'); const seekIn = h('i'); seek.appendChild(seekIn); seek.setAttribute('role', 'progressbar');
  const count = h('span', 'cp-count');
  const prev = h('button', 'cp-btn', '‹ Prev'); const next = h('button', 'cp-btn cp-next', 'Next ›');
  bar.append(play, seek, count, prev, next);
  root.append(top, body, bar);
  if (C.player?.title === false) top.style.display = 'none';
  if (!C.player?.menu) { menu.style.display = 'none'; menuBtn.style.display = 'none'; }
  if (C.player?.seekbar === false) { seek.style.visibility = 'hidden'; play.style.visibility = 'hidden'; }
  if (C.player?.prevNext === false) { prev.style.display = 'none'; next.style.display = 'none'; }
  menuBtn.onclick = () => root.classList.toggle('cp-nomenu');
  const fit = () => { const r = wrap.getBoundingClientRect(); if (!r.width || !r.height) return; const k = Math.min(r.width / W, r.height / H); stage.style.transform = `translate(-50%,-50%) scale(${k})`; };
  addEventListener('resize', fit);
  if (window.ResizeObserver) new ResizeObserver(fit).observe(wrap);
  const drawMenu = () => {
    menu.innerHTML = '';
    C.scenes.forEach(sc => {
      menu.appendChild(h('h4', '', sc.name));
      sc.slides.forEach(s => {
        const i = byId(s.id), b = h('button', (i === cur ? 'on ' : '') + (visited.has(s.id) ? 'seen' : ''), s.title || 'Slide');
        b.disabled = !C.player?.freeNav && !visited.has(s.id) && i !== cur;
        b.onclick = () => go(i);
        menu.appendChild(b);
      });
    });
  };

  /* how an object looks in a state */
  const looks = o => { const st = stateOf(o); return { ...o.style, ...(st !== 'normal' ? o.states?.[st] || {} : {}) }; };
  const stateOf = o => objState[o.id] || o.initial || 'normal';
  const paint = (el, o, extra) => {
    const s = { ...looks(o), ...(extra || {}) };
    const st = el.style;
    st.left = o.x + 'px'; st.top = o.y + 'px'; st.width = o.w + 'px'; st.height = o.h + 'px';
    st.background = s.fill && s.fill !== 'transparent' ? s.fill : 'transparent';
    st.color = s.color || ''; st.fontSize = (s.size || 18) + 'px'; st.fontWeight = s.bold ? '700' : '400'; st.fontStyle = s.italic ? 'italic' : '';
    st.textAlign = s.align || 'left'; st.borderRadius = s.shape === 'ellipse' ? '50%' : (s.radius || 0) + 'px';
    st.border = s.borderW ? `${s.borderW}px solid ${s.border || 'transparent'}` : '0'; st.opacity = s.opacity == null ? '' : s.opacity;
    st.boxShadow = s.shadow ? '0 10px 30px rgba(20,24,60,.18)' : '';
    st.justifyContent = s.valign === 'middle' ? 'center' : s.valign === 'bottom' ? 'flex-end' : 'flex-start';
    st.display = stateOf(o) === 'hidden' ? 'none' : '';
    el.classList.toggle('cp-disabled', stateOf(o) === 'disabled');
    if (o.kind === 'image') { const img = el.firstChild; if (img) { const src = s.src || o.src || ''; img.src = src.startsWith('asset:') ? (C.assets || {})[src.slice(6)] || '' : src; img.style.objectFit = s.fit || 'cover'; } }
    const label = el.querySelector(':scope > .cp-t');
    if (label) label.textContent = fill(s.text != null ? s.text : o.text);
  };

  /* triggers */
  const visibleLayers = () => flat[cur].s.layers.filter((l, i) => i === 0 || layerOn.includes(l.id));
  const findObj = id => { for (const l of flat[cur].s.layers) { const o = l.objects.find(x => x.id === id); if (o) return o; } return null; };
  const cmp = (a, op, b) => {
    const n = x => (x === '' || x == null || isNaN(Number(x)) ? null : Number(x));
    const A = typeof a === 'boolean' ? String(a) : a, B = b;
    if (op === 'empty') return A === '' || A == null || A === 0 || A === 'false';
    if (op === 'notEmpty') return !(A === '' || A == null || A === 0 || A === 'false');
    if (op === 'contains') return String(A).toLowerCase().includes(String(B).toLowerCase());
    if (['>', '<', '>=', '<='].includes(op)) { const x = n(A), y = n(B); if (x == null || y == null) return false; return op === '>' ? x > y : op === '<' ? x < y : op === '>=' ? x >= y : x <= y; }
    const eq = n(A) != null && n(B) != null ? n(A) === n(B) : String(A).toLowerCase() === String(B).toLowerCase();
    return op === '!=' ? !eq : eq;
  };
  const passes = conds => (conds || []).every(c => {
    const left = String(c.left || '').startsWith('state:') ? stateOf(findObj(c.left.slice(6)) || {}) : allVars()[c.left];
    return cmp(left, c.op || '==', fill(c.right ?? ''));
  });
  const fire = (event, source, value) => {
    if (cur < 0) return;
    for (const l of visibleLayers()) for (const t of l.triggers || []) {
      if (t.event !== event) continue;
      if (['click', 'hover', 'leave', 'drop', 'stateChange', 'mediaEnd', 'correct', 'incorrect', 'varChange'].includes(event) && t.source !== source) continue;
      if ((event === 'timelineStart' || event === 'timelineEnd') && source !== l.id) continue;
      if (event === 'drop' && t.value && t.value !== value) continue;
      if (event === 'stateChange' && t.value && t.value !== value) continue;
      if (event === 'key' && String(t.value || '').toLowerCase() !== String(value).toLowerCase()) continue;
      if (!passes(t.conds)) continue;
      act(t, l);
      if (t.action === 'jump' || t.action === 'restart') return;
    }
  };
  const setVar = (name, v) => { if (vars[name] === v) return; vars[name] = v; refresh(); fire('varChange', name); save(); };
  const setState = (o, st) => { if (!o || stateOf(o) === st) return; objState[o.id] = st; refresh(); fire('stateChange', o.id, st); };
  const act = (t, l) => {
    const a = t.action;
    if (a === 'jump') { const i = t.target === 'next' ? cur + 1 : t.target === 'prev' ? cur - 1 : t.target === 'first' ? 0 : t.target === 'last' ? flat.length - 1 : byId(t.target); if (i >= 0 && i < flat.length) setTimeout(() => go(i)); }
    else if (a === 'showLayer') showLayer(t.target === 'this' ? l.id : t.target);
    else if (a === 'hideLayer') hideLayer(t.target === 'this' ? l.id : t.target);
    else if (a === 'state') setState(findObj(t.target), t.value || 'normal');
    else if (a === 'setVar') {
      const def = (C.vars || []).find(v => v.name === t.target); if (!def) return;
      const val = fill(t.value ?? ''), old = vars[t.target];
      const op = t.op || 'set';
      if (def.type === 'number') setVar(t.target, op === 'add' ? old + (Number(val) || 0) : op === 'subtract' ? old - (Number(val) || 0) : op === 'multiply' ? old * (Number(val) || 0) : op === 'divide' ? (Number(val) ? old / Number(val) : old) : Number(val) || 0);
      else if (def.type === 'bool') setVar(t.target, op === 'toggle' ? !old : val === 'true' || val === true);
      else setVar(t.target, op === 'add' ? old + val : val);
    }
    else if (a === 'media') { const m = live[t.target]?.querySelector('video,audio'); if (m) (t.value === 'pause' ? m.pause() : t.value === 'stop' ? (m.pause(), m.currentTime = 0) : m.play().catch(() => {})); }
    else if (a === 'timeline') { t.value === 'resume' ? resume() : pause(); }
    else if (a === 'submit') { const fn = live[t.target]?._submit; if (fn) fn(); }
    else if (a === 'resetQuiz') { for (const k in results) delete results[k]; refresh(); save(); }
    else if (a === 'url') { if (/^https?:\/\//i.test(t.value || '')) window.open(t.value, '_blank', 'noopener'); }
    else if (a === 'restart') { for (const k in results) delete results[k]; for (const k in objState) delete objState[k]; visited.clear(); for (const v of C.vars || []) vars[v.name] = v.type === 'number' ? Number(v.value) || 0 : v.type === 'bool' ? v.value === true || v.value === 'true' : String(v.value ?? ''); go(0); }
    else if (a === 'exit') { env.exit?.(); }
  };

  /* drawing a slide */
  const layerEls = {};
  const build = (o, layer) => {
    const el = h('div', 'cp-o cp-' + o.kind); el.dataset.id = o.id;
    if (o.kind === 'image') { const img = h('img'); img.alt = o.alt || ''; el.appendChild(img); }
    else if (o.kind === 'input') {
      const inp = h('input'); inp.placeholder = o.placeholder || ''; inp.value = o.var && vars[o.var] != null ? vars[o.var] : '';
      inp.setAttribute('aria-label', o.placeholder || o.name || 'Text entry');
      inp.onchange = () => { if (o.var) { const def = (C.vars || []).find(v => v.name === o.var); setVar(o.var, def?.type === 'number' ? Number(inp.value) || 0 : inp.value); } };
      inp.onkeydown = e => { if (e.key === 'Enter') inp.onchange(); };
      el.appendChild(inp);
    } else if (o.kind === 'video' || o.kind === 'audio') {
      const m = h(o.kind); m.src = o.src || ''; m.controls = o.controls !== false; m.onended = () => fire('mediaEnd', o.id);
      el.appendChild(m);
    } else if (o.kind === 'question') buildQuestion(el, o);
    else if (o.kind === 'result') buildResult(el, o);
    else el.appendChild(h('div', 'cp-t'));
    if (o.kind === 'button' || o.kind === 'hotspot' || o.kind === 'shape' || o.kind === 'image' || o.kind === 'text') {
      if (o.kind === 'button' || o.kind === 'hotspot') { el.setAttribute('role', 'button'); el.tabIndex = 0; el.setAttribute('aria-label', o.kind === 'hotspot' ? o.name : (o.text || o.name)); }
      const has = s => o.states && o.states[s];
      const base = () => !['disabled', 'hidden', 'selected'].includes(stateOf(o));
      el.onmouseenter = () => { if (stateOf(o) === 'disabled') return; if (has('hover') && base()) paint(el, o, o.states.hover); fire('hover', o.id); };
      el.onmouseleave = () => { if (stateOf(o) === 'disabled') return; paint(el, o); fire('leave', o.id); };
      el.onmousedown = () => { if (has('down') && base()) paint(el, o, o.states.down); };
      el.onmouseup = () => paint(el, o);
      const click = () => {
        if (stateOf(o) === 'disabled' || el._dragged) return;
        if (has('selected')) setState(o, stateOf(o) === 'selected' ? 'normal' : 'selected');
        else if (has('visited') && stateOf(o) === 'normal') { fire('click', o.id); setState(o, 'visited'); return; }
        fire('click', o.id);
      };
      el.onclick = click;
      el.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); click(); } };
    }
    if (o.drag) dragify(el, o);
    paint(el, o);
    return el;
  };
  const dragify = (el, o) => {
    el.style.cursor = 'grab';
    el.onpointerdown = e => {
      if (stateOf(o) === 'disabled') return;
      const k = stage.getBoundingClientRect().width / W, sx = e.clientX, sy = e.clientY, ox = o.x, oy = o.y;
      el._dragged = false; el.setPointerCapture(e.pointerId);
      el.onpointermove = m => { const dx = (m.clientX - sx) / k, dy = (m.clientY - sy) / k; if (Math.abs(dx) + Math.abs(dy) > 3) el._dragged = true; o.x = ox + dx; o.y = oy + dy; el.style.left = o.x + 'px'; el.style.top = o.y + 'px'; };
      el.onpointerup = () => {
        el.onpointermove = null;
        if (!el._dragged) return;
        const cx = o.x + o.w / 2, cy = o.y + o.h / 2;
        const target = visibleLayers().flatMap(l => l.objects).find(t => t.id !== o.id && cx >= t.x && cx <= t.x + t.w && cy >= t.y && cy <= t.y + t.h);
        if (target) fire('drop', o.id, target.id);
        if (o.snap && (!target || (o.dropOn && target.id !== o.dropOn))) { o.x = ox; o.y = oy; el.style.left = ox + 'px'; el.style.top = oy + 'px'; }
        setTimeout(() => { el._dragged = false; });
      };
    };
  };
  const shuffle = a => { const b = a.slice(); for (let i = b.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [b[i], b[j]] = [b[j], b[i]]; } return b; };
  const buildQuestion = (el, o) => {
    const Q = o.q || {}; const r = results[o.id] || { tries: 0 };
    el.innerHTML = '';
    el.appendChild(h('p', 'cp-qp', fill(Q.prompt)));
    const list = h('div', 'cp-qc'); el.appendChild(list);
    let order = Q.type === 'order' ? shuffle(Q.choices || []) : Q.shuffle ? shuffle(Q.choices || []) : (Q.choices || []);
    const name = 'q' + o.id;
    const drawOrder = () => {
      list.innerHTML = '';
      order.forEach((ch, i) => {
        const row = h('div', 'cp-qo'); row.appendChild(h('span', 'cp-qn', String(i + 1))); row.appendChild(h('span', '', fill(ch.text)));
        const up = h('button', 'cp-ib', '↑'), dn = h('button', 'cp-ib', '↓'); up.setAttribute('aria-label', 'Move up: ' + ch.text); dn.setAttribute('aria-label', 'Move down: ' + ch.text);
        up.disabled = i === 0; dn.disabled = i === order.length - 1;
        up.onclick = () => { order = order.slice(); [order[i - 1], order[i]] = [order[i], order[i - 1]]; drawOrder(); };
        dn.onclick = () => { order = order.slice(); [order[i + 1], order[i]] = [order[i], order[i + 1]]; drawOrder(); };
        row.append(up, dn); list.appendChild(row);
      });
    };
    let input;
    if (Q.type === 'fill') { input = h('input', 'cp-qf'); input.setAttribute('aria-label', 'Your answer'); input.placeholder = 'Type your answer'; list.appendChild(input); }
    else if (Q.type === 'order') drawOrder();
    else order.forEach(ch => {
      const lab = h('label', 'cp-qo'); const inp = h('input'); inp.type = Q.type === 'mr' ? 'checkbox' : 'radio'; inp.name = name; inp.value = ch.id;
      lab.append(inp, h('span', '', fill(ch.text))); list.appendChild(lab);
    });
    const foot = h('div', 'cp-qa'); const sub = h('button', 'cp-btn cp-next', 'Submit'); foot.appendChild(sub); el.appendChild(foot);
    const fb = h('div', 'cp-fb'); el.appendChild(fb);
    const max = Number(Q.attempts) || 1;
    const submit = () => {
      let ok;
      if (Q.type === 'fill') { const want = String(Q.answer || '').split('|').map(s => s.trim().toLowerCase()).filter(Boolean); ok = want.includes(String(input.value).trim().toLowerCase()); }
      else if (Q.type === 'order') ok = order.every((ch, i) => ch.id === Q.choices[i].id);
      else {
        const picked = [...list.querySelectorAll('input:checked')].map(i => i.value);
        if (!picked.length) { fb.className = 'cp-fb on warn'; fb.textContent = 'Pick an answer first.'; return; }
        const right = (Q.choices || []).filter(c => c.correct).map(c => c.id);
        ok = picked.length === right.length && picked.every(id => right.includes(id));
      }
      r.tries = (r.tries || 0) + 1; r.correct = ok; results[o.id] = r;
      const left = max - r.tries;
      fb.className = 'cp-fb on ' + (ok ? 'ok' : 'bad');
      fb.innerHTML = '';
      fb.appendChild(h('b', '', ok ? '✓ ' + fill(Q.right || 'Correct') : '✗ ' + fill(Q.wrong || 'Incorrect')));
      if (!ok && left > 0) { fb.appendChild(h('span', '', ` You have ${left} more ${left === 1 ? 'try' : 'tries'}.`)); const again = h('button', 'cp-btn', 'Try again'); again.onclick = () => buildQuestion(el, o); fb.appendChild(again); }
      else { sub.disabled = true; list.querySelectorAll('input,button').forEach(x => { x.disabled = true; }); const cont = h('button', 'cp-btn cp-next', 'Continue ›'); cont.onclick = () => go(cur + 1); fb.appendChild(cont); }
      refresh(); save(); lockNext();
      fire(ok ? 'correct' : 'incorrect', o.id);
    };
    sub.onclick = submit; el._submit = submit;
    if (r.tries >= max) { sub.disabled = true; list.querySelectorAll('input,button').forEach(x => { x.disabled = true; }); fb.className = 'cp-fb on ' + (r.correct ? 'ok' : 'bad'); fb.textContent = r.correct ? '✓ Answered correctly' : '✗ Answered'; }
  };
  const buildResult = (el, o) => {
    el.innerHTML = '';
    const b = builtins();
    const ring = h('div', 'cp-ring ' + (b['Quiz.Passed'] ? 'ok' : 'bad')); ring.style.setProperty('--p', b['Quiz.Percent']);
    ring.appendChild(h('b', '', b['Quiz.Percent'] + '%'));
    el.appendChild(ring);
    el.appendChild(h('p', 'cp-rt', fill(o.text || '')));
    el.appendChild(h('p', 'cp-rs', b['Quiz.MaxScore'] ? `${b['Quiz.Score']} of ${b['Quiz.MaxScore']} points · ${b['Quiz.Passed'] ? 'Passed' : `You need ${C.quiz?.pass || 0}% to pass`}` : 'There are no questions in this course.'));
    const retry = h('button', 'cp-btn', 'Retry the quiz');
    retry.onclick = () => { for (const k in results) delete results[k]; const first = flat.findIndex(x => x.s.layers.some(l => l.objects.some(ob => ob.kind === 'question'))); save(); go(first < 0 ? 0 : first); };
    if (o.retry !== false && b['Quiz.MaxScore']) el.appendChild(retry);
    report();
  };
  const refresh = () => {
    for (const id in live) {
      const o = findObj(id); if (!o) continue;
      if (o.kind === 'result') buildResult(live[id], o);
      else if (o.kind !== 'question') paint(live[id], o);
    }
  };
  const ANIM = { fade: 'cp-a-fade', 'fly-left': 'cp-a-fl', 'fly-right': 'cp-a-fr', 'fly-up': 'cp-a-fu', 'fly-down': 'cp-a-fd', zoom: 'cp-a-zoom', spin: 'cp-a-spin', bounce: 'cp-a-bounce' };
  const drawLayer = l => {
    const box = h('div', 'cp-layer'); box.dataset.layer = l.id; layerEls[l.id] = { box, t: now(), shown: {}, ended: false };
    for (const o of l.objects) { const el = build(o, l); el.style.visibility = 'hidden'; live[o.id] = el; box.appendChild(el); }
    stage.appendChild(box);
  };
  const showLayer = id => {
    const s = flat[cur].s, l = s.layers.find(x => x.id === id); if (!l || layerOn.includes(id)) return;
    if (l.hideOthers) for (const other of layerOn.slice()) hideLayer(other);
    layerOn.push(id); drawLayer(l); tick(); fire('timelineStart', id);
  };
  const hideLayer = id => { if (!layerOn.includes(id)) return; layerOn = layerOn.filter(x => x !== id); const e = layerEls[id]; if (e) { for (const o of flat[cur].s.layers.find(x => x.id === id).objects) delete live[o.id]; e.box.remove(); delete layerEls[id]; } };
  const now = () => (paused ? pausedAt : performance.now());
  const pause = () => { if (paused) return; paused = true; pausedAt = performance.now(); play.textContent = '▶'; play.setAttribute('aria-label', 'Play'); root.classList.add('cp-paused'); stage.querySelectorAll('video,audio').forEach(m => m.pause()); };
  const resume = () => { if (!paused) return; const d = performance.now() - pausedAt; paused = false; t0 += d; for (const k in layerEls) layerEls[k].t += d; play.textContent = '❚❚'; play.setAttribute('aria-label', 'Pause'); root.classList.remove('cp-paused'); loop(); };
  play.onclick = () => (paused ? resume() : pause());
  const tick = () => {
    const s = flat[cur].s;
    for (const l of visibleLayers()) {
      const e = layerEls[l.id]; if (!e) continue;
      const t = (now() - e.t) / 1000;
      for (const o of l.objects) {
        const el = live[o.id]; if (!el) continue;
        const on = t >= (Number(o.start) || 0) && (o.dur == null || o.dur === '' || t < (Number(o.start) || 0) + Number(o.dur));
        if (on && !e.shown[o.id]) { e.shown[o.id] = true; el.style.visibility = ''; if (ANIM[o.anim]) { el.classList.remove(ANIM[o.anim]); void el.offsetWidth; el.classList.add(ANIM[o.anim]); } if (o.kind === 'video' || o.kind === 'audio') { if (o.autoplay) el.querySelector('video,audio')?.play().catch(() => {}); } }
        else if (!on && e.shown[o.id] && t > (Number(o.start) || 0)) { el.style.visibility = 'hidden'; }
      }
      const dur = l === s.layers[0] ? Number(s.duration) || 0 : Math.max(0, ...l.objects.map(o => (Number(o.start) || 0) + (o.dur ? Number(o.dur) : 0)));
      if (!e.ended && t >= dur) { e.ended = true; fire('timelineEnd', l.id); if (l === s.layers[0] && s.next === 'auto' && !ended) { ended = true; setTimeout(() => go(cur + 1)); } }
      if (l === s.layers[0]) { const p = dur ? Math.min(1, t / dur) : 1; seekIn.style.width = p * 100 + '%'; seek.setAttribute('aria-valuenow', String(Math.round(p * 100))); }
    }
  };
  const loop = () => { cancelAnimationFrame(raf); const step = () => { if (cur < 0 || paused) return; tick(); raf = requestAnimationFrame(step); }; raf = requestAnimationFrame(step); };
  seek.onclick = e => { const s = flat[cur].s, dur = Number(s.duration) || 0, r = seek.getBoundingClientRect(), p = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)); const base = layerEls[s.layers[0].id]; if (!base) return; base.t = now() - p * dur * 1000; base.shown = {}; for (const o of s.layers[0].objects) if (live[o.id]) live[o.id].style.visibility = 'hidden'; base.ended = p < 1 ? false : base.ended; tick(); };
  const go = i => {
    if (i < 0 || i >= flat.length) { if (i >= flat.length) { finish(); } return; }
    cancelAnimationFrame(raf);
    cur = i; ended = false; layerOn = []; live = {};
    for (const k in layerEls) delete layerEls[k];
    stage.innerHTML = '';
    const s = flat[i].s; visited.add(s.id);
    stage.style.background = s.bg || '#fff';
    drawLayer(s.layers[0]);
    const tr = s.transition?.type; const box0 = layerEls[s.layers[0].id]?.box;
    if (tr && tr !== 'none' && box0) { box0.style.animationDuration = (Number(s.transition.dur) || 0.6) + 's'; box0.classList.add('cp-tr-' + tr); }
    t0 = now(); if (paused) { paused = false; play.textContent = '❚❚'; root.classList.remove('cp-paused'); }
    count.textContent = `${i + 1} / ${flat.length}`;
    prev.disabled = i === 0;
    lockNext();
    next.textContent = i === flat.length - 1 ? 'Finish' : 'Next ›';
    drawMenu(); fit(); tick(); loop();
    fire('timelineStart', s.layers[0].id);
    save(); report();
    env.onSlide?.(i, s);
  };
  // On a question slide, Next waits until its questions are answered.
  const lockNext = () => { const s = flat[cur].s; next.disabled = s.next === 'question' && !s.layers[0].objects.filter(o => o.kind === 'question').every(o => results[o.id] && (results[o.id].correct || results[o.id].tries >= (Number(o.q.attempts) || 1))); };
  const finish = () => { report(true); env.exit?.(); const done = h('div', 'cp-done'); done.appendChild(h('b', '', 'You’ve reached the end of the course.')); const again = h('button', 'cp-btn', 'Start again'); again.onclick = () => { done.remove(); act({ action: 'restart' }); }; done.appendChild(again); stage.appendChild(done); };
  prev.onclick = () => go(cur - 1);
  next.onclick = () => (cur === flat.length - 1 ? finish() : go(cur + 1));
  addEventListener('keydown', e => {
    if (e.target.closest && e.target.closest('input,textarea')) return;
    fire('key', null, e.key);
  });
  const snapshot = () => ({ slide: flat[cur]?.s.id, vars, results, objState, visited: [...visited] });
  const save = () => { try { env.save?.(JSON.stringify(snapshot())); } catch (e) { /* storage off */ } };
  const report = (end) => env.report?.({ ...builtins(), end: !!end, viewed: visited.size, total: flat.length, location: flat[cur]?.s.id });
  // Where the learner was: carry on, if they want to.
  let saved = null; try { saved = C.player?.resume && env.load ? JSON.parse(env.load() || 'null') : null; } catch (e) { saved = null; }
  const start = from => {
    if (from) { Object.assign(vars, from.vars || {}); Object.assign(results, from.results || {}); Object.assign(objState, from.objState || {}); (from.visited || []).forEach(v => visited.add(v)); }
    const at = from ? byId(from.slide) : -1;
    const first = C.start ? flat.findIndex(x => x.sc.id === C.start) : 0;
    go(at >= 0 ? at : Math.max(0, first));
  };
  if (saved && saved.slide && byId(saved.slide) > 0) {
    const box = h('div', 'cp-done'); box.appendChild(h('b', '', 'Carry on where you left off?'));
    const yes = h('button', 'cp-btn cp-next', 'Yes, resume'), no = h('button', 'cp-btn', 'Start over');
    yes.onclick = () => { box.remove(); start(saved); }; no.onclick = () => { box.remove(); start(null); };
    box.append(yes, no); stage.appendChild(box); fit();
  } else start(null);
  return { go, get index() { return cur; }, vars, results, fire };
}

export const PLAYER_CSS = `
*{box-sizing:border-box}html,body{margin:0;height:100%;background:#e9ebf2}
.cp{height:100%;display:flex;flex-direction:column;color:#1f2433}
.cp-top{display:flex;align-items:center;gap:10px;padding:8px 14px;background:#fff;border-bottom:1px solid #e1e4ee;font-size:15px}
.cp-body{flex:1;display:flex;min-height:0}
.cp-menu{width:230px;flex:none;overflow:auto;background:#fff;border-right:1px solid #e1e4ee;padding:8px}
.cp-nomenu .cp-menu{display:none}
.cp-menu h4{margin:12px 8px 4px;font-size:11px;text-transform:uppercase;letter-spacing:.08em;color:#7a809a}
.cp-menu button{display:block;width:100%;text-align:left;border:0;background:none;padding:8px 10px;border-radius:8px;font:inherit;font-size:13.5px;color:inherit;cursor:pointer}
.cp-menu button:hover{background:#f1f3fa}.cp-menu button.on{background:color-mix(in srgb,var(--acc) 14%,#fff);color:var(--acc);font-weight:700}
.cp-menu button.seen::after{content:" ✓";color:#17836a}.cp-menu button:disabled{opacity:.45;cursor:default}
.cp-wrap{flex:1;position:relative;overflow:hidden;min-width:0}
.cp-stage{position:absolute;left:50%;top:50%;transform-origin:center;overflow:hidden;box-shadow:0 12px 40px rgba(20,24,60,.18);border-radius:6px;background:#fff}
.cp-layer{position:absolute;inset:0}
.cp-o{position:absolute;display:flex;flex-direction:column;overflow:hidden;white-space:pre-wrap;line-height:1.3}
.cp-o .cp-t{padding:6px 10px}
.cp-button,.cp-hotspot{cursor:pointer;user-select:none;transition:background .15s,color .15s}.cp-button:focus-visible,.cp-hotspot:focus-visible{outline:3px solid color-mix(in srgb,var(--acc) 50%,transparent);outline-offset:2px}
.cp-disabled{opacity:.5;cursor:not-allowed!important}
.cp-image img,.cp-video video{width:100%;height:100%;display:block}
.cp-audio audio{width:100%;height:100%}
.cp-input input{width:100%;height:100%;border:0;background:transparent;font:inherit;color:inherit;padding:0 12px;outline:none}
.cp-question{padding:20px 22px;gap:10px;overflow:auto}
.cp-qp{margin:0;font-weight:700;font-size:1.1em}
.cp-qc{display:flex;flex-direction:column;gap:8px}
.cp-qo{display:flex;align-items:center;gap:10px;padding:10px 12px;border:1px solid #dfe3f0;border-radius:10px;cursor:pointer;background:#fafbff}
.cp-qo:hover{border-color:var(--acc)}.cp-qo input{accent-color:var(--acc);width:18px;height:18px}
.cp-qn{display:grid;place-items:center;width:24px;height:24px;border-radius:50%;background:color-mix(in srgb,var(--acc) 14%,#fff);color:var(--acc);font-weight:700;font-size:13px}
.cp-qo span:nth-child(2){flex:1}
.cp-qf{padding:10px 12px;border:1px solid #c3c8d8;border-radius:10px;font:inherit}
.cp-qa{display:flex;justify-content:flex-end}
.cp-fb{display:none;align-items:center;gap:10px;flex-wrap:wrap;padding:10px 12px;border-radius:10px;font-size:.95em}
.cp-fb.on{display:flex}.cp-fb.ok{background:#e6f6ef;color:#0f6b52}.cp-fb.bad{background:#fdecec;color:#a8322a}.cp-fb.warn{background:#fff4e5;color:#8a4a12}
.cp-fb .cp-btn{margin-left:auto}
.cp-result{align-items:center;justify-content:center;padding:20px;gap:6px;text-align:center}
.cp-ring{--p:0;width:130px;height:130px;border-radius:50%;display:grid;place-items:center;background:conic-gradient(var(--c) calc(var(--p)*1%),#eceef5 0)}
.cp-ring.ok{--c:#17836a}.cp-ring.bad{--c:#c0392b}
.cp-ring b{display:grid;place-items:center;width:100px;height:100px;border-radius:50%;background:#fff;font-size:28px}
.cp-rt{margin:6px 0 0;font-weight:700}.cp-rs{margin:0;color:#5b6178;font-size:.85em}
.cp-bar{display:flex;align-items:center;gap:10px;padding:8px 14px;background:#fff;border-top:1px solid #e1e4ee}
.cp-seek{flex:1;height:8px;border-radius:99px;background:#eceef5;cursor:pointer;overflow:hidden}.cp-seek i{display:block;height:100%;width:0;background:var(--acc)}
.cp-count{font-size:12.5px;color:#5b6178;font-variant-numeric:tabular-nums;min-width:52px;text-align:center}
.cp-ib{border:0;background:#f1f3fa;width:34px;height:34px;border-radius:9px;cursor:pointer;font-size:15px;color:inherit}
.cp-ib:disabled{opacity:.4;cursor:default}
.cp-btn{border:1px solid #d5d9e6;background:#fff;padding:8px 16px;border-radius:10px;font:inherit;font-size:14px;font-weight:600;cursor:pointer;color:inherit}
.cp-btn:disabled{opacity:.45;cursor:default}
.cp-next{background:var(--acc);border-color:var(--acc);color:#fff}
.cp-done{position:absolute;inset:0;z-index:20;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;background:rgba(245,246,251,.94);font-size:22px}
.cp-done .cp-btn{font-size:16px}
.cp-paused .cp-stage *{animation-play-state:paused!important}
@keyframes cpFade{from{opacity:0}}@keyframes cpFl{from{opacity:0;transform:translateX(-60px)}}@keyframes cpFr{from{opacity:0;transform:translateX(60px)}}
@keyframes cpFu{from{opacity:0;transform:translateY(50px)}}@keyframes cpFd{from{opacity:0;transform:translateY(-50px)}}@keyframes cpZoom{from{opacity:0;transform:scale(.6)}}
@keyframes cpSpin{from{opacity:0;transform:rotate(-180deg) scale(.5)}}@keyframes cpBounce{0%{opacity:0;transform:scale(.3)}55%{opacity:1;transform:scale(1.08)}75%{transform:scale(.96)}100%{transform:scale(1)}}
.cp-a-fade{animation:cpFade .6s ease both}.cp-a-fl{animation:cpFl .6s cubic-bezier(.2,.8,.2,1) both}.cp-a-fr{animation:cpFr .6s cubic-bezier(.2,.8,.2,1) both}
.cp-a-fu{animation:cpFu .6s cubic-bezier(.2,.8,.2,1) both}.cp-a-fd{animation:cpFd .6s cubic-bezier(.2,.8,.2,1) both}.cp-a-zoom{animation:cpZoom .5s cubic-bezier(.2,.8,.2,1) both}
.cp-a-spin{animation:cpSpin .7s ease both}.cp-a-bounce{animation:cpBounce .7s ease both}
@keyframes cpPushL{from{transform:translateX(100%)}}@keyframes cpPushU{from{transform:translateY(100%)}}@keyframes cpCover{from{transform:translateX(-100%)}}@keyframes cpTZoom{from{opacity:0;transform:scale(.85)}}
.cp-tr-fade{animation:cpFade ease both}.cp-tr-push{animation:cpPushL cubic-bezier(.2,.8,.2,1) both}.cp-tr-pushUp{animation:cpPushU cubic-bezier(.2,.8,.2,1) both}.cp-tr-cover{animation:cpCover cubic-bezier(.2,.8,.2,1) both}.cp-tr-zoom{animation:cpTZoom ease both}
@media (max-width:700px){.cp-menu{position:absolute;z-index:30;height:calc(100% - 100px);box-shadow:0 10px 30px rgba(0,0,0,.2)}.cp:not(.cp-nomenu) .cp-menu{display:none}.cp.cp-nomenu .cp-menu{display:block}}
`;

const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
// What the player is given, per where it runs: the preview, a web page, or an LMS (SCORM 1.2).
const ENV = {
  preview: `{ save: s => { window.__saved = s; }, load: () => null, report: r => { window.__report = r; parent.postMessage({ courseReport: r }, '*'); }, onSlide: (i, s) => parent.postMessage({ courseSlide: s.id }, '*') }`,
  web: `(() => { const key = 'course:' + COURSE.id; return { save: s => { try { localStorage.setItem(key, s); } catch (e) {} }, load: () => { try { return localStorage.getItem(key); } catch (e) { return null; } }, report: () => {} }; })()`,
  scorm: `(() => {
    const find = w => { for (let n = 0; w && n < 12; n++) { if (w.API) return w.API; if (w === w.parent) break; w = w.parent; } return null; };
    const api = find(window) || (window.opener && find(window.opener));
    const set = (k, v) => api && api.LMSSetValue(k, String(v));
    let done = false;
    if (api) { api.LMSInitialize(''); if (api.LMSGetValue('cmi.core.lesson_status') === 'not attempted') set('cmi.core.lesson_status', 'incomplete'); }
    const close = () => { if (api && !done) { done = true; api.LMSCommit(''); api.LMSFinish(''); } };
    addEventListener('pagehide', close); addEventListener('beforeunload', close);
    return {
      save: s => { if (api) { set('cmi.suspend_data', s.slice(0, 4000)); api.LMSCommit(''); } },
      load: () => (api ? api.LMSGetValue('cmi.suspend_data') : null),
      report: r => {
        if (!api) return;
        if (r.location) set('cmi.core.lesson_location', r.location);
        if (r['Quiz.MaxScore']) { set('cmi.core.score.min', 0); set('cmi.core.score.max', 100); set('cmi.core.score.raw', r['Quiz.Percent']); }
        const byQuiz = COURSE.complete === 'quiz' && r['Quiz.MaxScore'];
        if (byQuiz) { if (r['Quiz.Passed']) set('cmi.core.lesson_status', 'passed'); else if (r.end) set('cmi.core.lesson_status', 'failed'); }
        else if (r.viewed >= r.total || r.end) set('cmi.core.lesson_status', 'completed');
        api.LMSCommit('');
      },
      exit: close,
    };
  })()`,
};
// The whole course as one web page.
export function courseHtml(course, mode = 'web') {
  const data = JSON.stringify({ ...course, id: course.id || 'course' }).replace(/</g, '\\u003c').split(String.fromCharCode(0x2028)).join('\\u2028').split(String.fromCharCode(0x2029)).join('\\u2029');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(course.title || 'Course')}</title><style>${PLAYER_CSS}</style></head>
<body><script>const COURSE = ${data};
(${player.toString()})(COURSE, ${ENV[mode] || ENV.web});
</script></body></html>`;
}
// A SCORM 1.2 package: imsmanifest.xml and the course page, zipped, for any LMS.
export async function scormZip(course) {
  const { default: JSZip } = await import('jszip');
  const id = String(course.id || 'course').replace(/[^\w-]/g, '');
  const zip = new JSZip();
  zip.file('imsmanifest.xml', `<?xml version="1.0" encoding="UTF-8"?>
<manifest identifier="workline-${id}" version="1.0" xmlns="http://www.imsproject.org/xsd/imscp_rootv1p1p2" xmlns:adlcp="http://www.adlnet.org/xsd/adlcp_rootv1p2" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://www.imsproject.org/xsd/imscp_rootv1p1p2 imscp_rootv1p1p2.xsd http://www.imsglobal.org/xsd/imsmd_rootv1p2p1 imsmd_rootv1p2p1.xsd http://www.adlnet.org/xsd/adlcp_rootv1p2 adlcp_rootv1p2.xsd">
  <metadata><schema>ADL SCORM</schema><schemaversion>1.2</schemaversion></metadata>
  <organizations default="org-${id}"><organization identifier="org-${id}"><title>${esc(course.title || 'Course')}</title>
    <item identifier="item-${id}" identifierref="res-${id}" isvisible="true"><title>${esc(course.title || 'Course')}</title>${course.complete === 'quiz' ? `<adlcp:masteryscore>${Number(course.quiz?.pass) || 80}</adlcp:masteryscore>` : ''}</item>
  </organization></organizations>
  <resources><resource identifier="res-${id}" type="webcontent" adlcp:scormtype="sco" href="index.html"><file href="index.html"/></resource></resources>
</manifest>`);
  zip.file('index.html', courseHtml(course, 'scorm'));
  return zip.generateAsync({ type: 'blob', mimeType: 'application/zip' });
}

// A picture picked from the computer, made small enough to keep in the file (a data: URL).
export function pictureUrl(file, max = 1400) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onerror = () => rej(new Error('That picture couldn’t be read.'));
    r.onload = () => {
      if (/svg|gif/.test(file.type) && file.size < 400_000) return res(r.result);
      const img = new Image();
      img.onerror = () => rej(new Error('That isn’t a picture the browser can open.'));
      img.onload = () => {
        const k = Math.min(1, max / Math.max(img.width, img.height)), c = document.createElement('canvas');
        c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        res(c.toDataURL(file.type === 'image/png' ? 'image/png' : 'image/jpeg', 0.85));
      };
      img.src = r.result;
    };
    r.readAsDataURL(file);
  });
}

/* ---- course files: export, and import from a course file, a published page or a SCORM package ---- */
export const courseFile = course => JSON.stringify({ workline: 'course', v: 1, course }, null, 1);
const fromPage = html => {
  const m = String(html).match(/const COURSE = (\{[\s\S]*?\});\n\(/);
  if (!m) throw new Error('That page isn’t a course published from Workline.');
  return JSON.parse(m[1]);
};
// A course from a picked file: .json (a course file), .html (a published course) or .zip (a SCORM package).
export async function readCourse(file) {
  const name = file.name.toLowerCase();
  let c;
  if (/\.(story|zip)$/.test(name)) {
    const { default: JSZip } = await import('jszip');
    let z;
    try { z = await JSZip.loadAsync(file); } catch (e) { throw new Error(/\.story$/.test(name) ? 'That .story file couldn’t be opened (it may be from an old Storyline version or damaged). In Storyline, use Publish → Web, zip the output folder and import the zip.' : 'That zip couldn’t be opened.'); }
    const files = Object.keys(z.files);
    // A Storyline file or a Storyline-published course.
    if (/\.story$/.test(name) || files.some(f => /html5\/data\/js\/data\.js$/i.test(f) || /(^|\/)story\.html$/i.test(f))) {
      const { storyToCourse } = await import('./storyimport.js');
      const { course, report } = await storyToCourse(z, file.name);
      course.imported = report;
      return course;
    }
    const page = z.file('index.html') || z.file(/(^|\/)index\.html$/i)[0] || z.file(/\.html$/i)[0];
    if (!page) throw new Error('There’s no course page (index.html) in that zip.');
    c = fromPage(await page.async('string'));
  } else {
    const text = await file.text();
    if (/^\s*</.test(text)) c = fromPage(text);
    else { let j; try { j = JSON.parse(text); } catch (e) { throw new Error('That file isn’t a course file.'); } c = j && j.workline === 'course' ? j.course : j; }
  }
  if (!c || !Array.isArray(c.scenes) || !c.scenes.length) throw new Error('That file has no slides in it.');
  const base = newCourse(c.title || file.name.replace(/\.\w+$/, ''));
  const out = { ...base, ...c, player: { ...base.player, ...(c.player || {}) }, quiz: { ...base.quiz, ...(c.quiz || {}) }, size: c.size || base.size, vars: Array.isArray(c.vars) ? c.vars : [] };
  delete out.id;
  return out;
}
// Another course's scenes and variables added to this one (with new ids, so nothing clashes).
export function appendCourse(into, other) {
  for (const v of other.vars || []) if (!into.vars.some(x => x.name === v.name)) into.vars.push({ ...v, id: rid('v') });
  // Its pictures come too, under new names, and its objects point at those.
  const rename = new Map();
  for (const [k, v] of Object.entries(other.assets || {})) { const n = rid('a'); (into.assets ||= {})[n] = v; rename.set('asset:' + k, 'asset:' + n); }
  const fix = o => { if (rename.has(o.src)) o.src = rename.get(o.src); for (const st of Object.values(o.states || {})) if (rename.has(st.src)) st.src = rename.get(st.src); };
  for (const sc of other.scenes) {
    const slides = sc.slides.map(cloneSlide);
    slides.forEach(sl => sl.layers.forEach(l => l.objects.forEach(fix)));
    into.scenes.push({ id: rid('sc'), name: sc.name, slides });
  }
  return into;
}
// A picture's address: kept in the course (asset:<id>) or written out (a data: or web address).
export const srcOf = (course, src) => (String(src || '').startsWith('asset:') ? (course?.assets || {})[src.slice(6)] || '' : src || '');
