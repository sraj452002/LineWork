import { FlowError } from './flow-engine.js';
import { rid } from './flow-workline.js';

/* The “Workline Course” node: makes a course for Course Studio (the Course view) from an outline or from
   JSON (an AI node's answer, say), as a new file or as slides added to a course file. The course is the
   same shape the editor makes (frontend/src/lib/course.js): scenes → slides → a base layer of objects.

   An outline, one thing a line:
     Course: Workplace safety           the course's title (or set Title)
     Scene: Basics                      a new scene
     # Why safety matters               a slide; the lines under it are its text (a leading - or • is a bullet)
     Notes: Say hello first             the slide's notes
     Q: Which one is safe?              a question slide; then its choices:
     * Wear a helmet                      * marks a right answer
     - Skip the helmet                    - a wrong one
   JSON: { title, scenes: [{ name, slides: […] }] } or { title, slides: […] }, or just the list of slides.
   A slide: { title, text | body | bullets: [..], notes, image } or a question
   { question | prompt, choices: ["a", "b"] | [{ text, correct }], answer: 0 | "a" | [0, 2], type }. */

const W = 960, H = 540;
const TEXT = { fill: 'transparent', color: '#1f2433', size: 24, align: 'left', valign: 'top' };
const SHAPE = { fill: '#e8ecfb', color: '#1f2433', size: 20, align: 'center', valign: 'middle', radius: 14, border: '#c9d1f2', borderW: 1 };
const obj = (kind, extra) => ({ id: rid('o'), kind, name: extra.name || ({ text: 'Text', shape: 'Shape', question: 'Question', result: 'Result', image: 'Picture' })[kind], states: {}, start: 0, dur: null, anim: 'none', ...extra });
const layer = objects => ({ id: rid('l'), name: 'Base layer', hideOthers: false, objects, triggers: [] });
const str = (v, max = 4000) => String(v ?? '').replace(/\r\n?/g, '\n').trim().slice(0, max);
const heading = (text, y = 40, size = 34, extra = {}) => obj('text', { name: 'Title', text, x: 60, y, w: 840, h: Math.round(size * 1.8), style: { ...TEXT, size, bold: true, ...extra } });

function titleSlide(title, sub) {
  return { id: rid('s'), title, bg: '#f3f5ff', duration: 5, next: 'user', notes: '', layers: [layer([
    obj('shape', { name: 'Band', text: '', x: 0, y: 380, w: W, h: 160, style: { ...SHAPE, fill: '#4f5bd5', border: 'transparent', radius: 0 } }),
    { ...heading(title, 150, 48, { align: 'center' }), anim: 'fade' },
    ...(sub ? [obj('text', { name: 'Subtitle', text: sub, x: 60, y: 250, w: 840, h: 50, style: { ...TEXT, size: 22, color: '#5b6178', align: 'center' }, start: 0.5, anim: 'fly-up' })] : []),
  ])] };
}
function contentSlide(s) {
  const lines = Array.isArray(s.bullets) ? s.bullets.map(b => `• ${str(b, 400)}`) : str(s.text ?? s.body ?? s.content).split('\n').map(l => l.replace(/^\s*[-*•]\s+/, '• '));
  const body = lines.join('\n').trim();
  const pic = typeof s.image === 'string' && /^(https?:|data:image\/)/.test(s.image) ? s.image : '';
  const objects = [heading(str(s.title, 200) || 'Untitled slide')];
  if (body) objects.push(obj('text', { name: 'Body', text: body, x: 60, y: 130, w: pic ? 520 : 840, h: 360, style: { ...TEXT, size: 22, autofit: 'shrink' }, start: 0.3, anim: 'fade' }));
  if (pic) objects.push(obj('image', { name: 'Picture', src: pic, x: 610, y: 130, w: 290, h: 360, style: { fill: 'transparent', radius: 8, fit: 'cover' }, start: 0.5, anim: 'fade' }));
  return { id: rid('s'), title: str(s.title, 200) || 'Untitled slide', bg: '#ffffff', duration: 5, next: 'user', notes: str(s.notes), layers: [layer(objects)] };
}
function questionSlide(s, points) {
  const prompt = str(s.question ?? s.prompt ?? s.title, 600) || 'Which one is right?';
  const raw = Array.isArray(s.choices) ? s.choices : Array.isArray(s.options) ? s.options : [];
  const ans = s.answer ?? s.correct;
  const right = (c, i) => (c && typeof c === 'object' ? !!(c.correct ?? c.right) : Array.isArray(ans) ? ans.some(a => a === i || String(a) === String(c)) : ans === i || (typeof ans === 'string' && ans.trim() === String(c).trim()));
  const choices = raw.slice(0, 10).map((c, i) => ({ id: rid('c'), text: str(c && typeof c === 'object' ? c.text ?? c.label : c, 300), correct: right(c, i) })).filter(c => c.text);
  let type = ['mc', 'mr', 'tf', 'fill'].includes(s.type) ? s.type : choices.filter(c => c.correct).length > 1 ? 'mr' : 'mc';
  if (!choices.length && type !== 'fill') type = 'fill';
  if (type !== 'fill' && choices.length && !choices.some(c => c.correct)) choices[0].correct = true;
  const q = { type, prompt, choices: type === 'fill' ? [] : choices, answer: type === 'fill' ? str(ans ?? '', 200) : '', points, attempts: Number(s.attempts) > 0 ? Number(s.attempts) : 1,
    right: str(s.right ?? s.feedback?.correct, 300) || 'That’s right!', wrong: str(s.wrong ?? s.feedback?.incorrect, 300) || 'Not quite.', shuffle: !!s.shuffle };
  const title = str(s.slideTitle ?? s.heading, 200) || 'Question';
  return { id: rid('s'), title, bg: '#ffffff', duration: 5, next: 'question', notes: str(s.notes), layers: [layer([heading(title, 30, 30), obj('question', { x: 160, y: 110, w: 640, h: 390, q, style: { fill: '#ffffff', color: '#1f2433', size: 18, radius: 16, border: '#dfe3f0', borderW: 1 } })])] };
}
const resultSlide = () => ({ id: rid('s'), title: 'Results', bg: '#ffffff', duration: 5, next: 'user', notes: '', layers: [layer([heading('Results', 30, 30), obj('result', { text: 'Your score: %Quiz.Percent%%', x: 220, y: 120, w: 520, h: 300, style: { fill: '#ffffff', color: '#1f2433', size: 20, radius: 16, border: '#dfe3f0', borderW: 1, align: 'center' } })])] });
const isQuestion = s => s && typeof s === 'object' && (s.question != null || s.prompt != null || Array.isArray(s.choices) || Array.isArray(s.options));

// An outline (see the top) as { title, scenes: [{ name, slides: [plain slides] }] }.
export function parseOutline(text) {
  const out = { title: '', scenes: [] };
  let scene = null, slide = null;
  const sceneOf = () => (scene ||= (out.scenes.push({ name: 'Scene 1', slides: [] }), out.scenes[out.scenes.length - 1]));
  for (const raw of String(text || '').replace(/\r\n?/g, '\n').split('\n')) {
    const line = raw.trim();
    if (!line) { if (slide && !slide.choices) slide.text += '\n'; continue; }
    let m;
    if ((m = /^course\s*:\s*(.+)$/i.exec(line))) out.title = m[1].trim();
    else if ((m = /^scene\s*:\s*(.+)$/i.exec(line))) { scene = { name: m[1].trim(), slides: [] }; out.scenes.push(scene); slide = null; }
    else if ((m = /^#{1,3}\s+(.+)$/.exec(line))) { slide = { title: m[1].trim(), text: '' }; sceneOf().slides.push(slide); }
    else if ((m = /^(?:q|question)\s*[:.)]\s*(.+)$/i.exec(line))) { slide = { question: m[1].trim(), choices: [] }; sceneOf().slides.push(slide); }
    else if ((m = /^notes?\s*:\s*(.+)$/i.exec(line)) && slide) slide.notes = (slide.notes ? slide.notes + '\n' : '') + m[1].trim();
    else if (slide?.choices && (m = /^([*+]|-|\[x\]|\[ \])\s*(.+)$/i.exec(line))) slide.choices.push({ text: m[2].trim(), correct: m[1] === '*' || m[1] === '+' || m[1].toLowerCase() === '[x]' });
    else if (slide && !slide.choices) slide.text += (slide.text && !slide.text.endsWith('\n') ? '\n' : '') + line;
    else { slide = { title: line, text: '' }; sceneOf().slides.push(slide); }
  }
  return out;
}

// JSON (an object, a list, or text holding one, maybe in a ```json block) as { title, scenes }.
export function parseCourseJson(v) {
  let x = v;
  if (typeof x === 'string') {
    const t = x.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
    try { x = JSON.parse(t); } catch (e) { throw new FlowError('The course JSON isn’t valid JSON. Check the step before (an AI node can be asked for “JSON only”).', 'bad_param'); }
  }
  if (Array.isArray(x)) return { title: '', scenes: [{ name: 'Scene 1', slides: x }] };
  if (!x || typeof x !== 'object') throw new FlowError('The course JSON should be { title, slides: [...] } or a list of slides.', 'bad_param');
  const c = x.course && typeof x.course === 'object' ? x.course : x;
  const scenes = Array.isArray(c.scenes) && c.scenes.length ? c.scenes.map((s, i) => ({ name: str(s.name ?? s.title, 120) || `Scene ${i + 1}`, slides: Array.isArray(s.slides) ? s.slides : [] }))
    : [{ name: 'Scene 1', slides: Array.isArray(c.slides) ? c.slides : Array.isArray(c.lessons) ? c.lessons : [] }];
  return { title: str(c.title, 120), subtitle: str(c.subtitle ?? c.description, 300), scenes };
}

// The scenes of a course, from a parsed spec: question slides scored, a title and a results slide if asked.
export function buildScenes(spec, { titleSlide: withTitle = true, results = 'auto', points = 10 } = {}) {
  const scenes = spec.scenes.filter(s => s.slides.length).map(s => ({ id: rid('sc'), name: s.name, slides: s.slides.slice(0, 300).map(x => (isQuestion(x) ? questionSlide(x, points) : contentSlide(x && typeof x === 'object' ? x : { title: str(x, 200) }))) }));
  if (!scenes.length) throw new FlowError('The outline has no slides. Start each slide with “# Its title” (or give JSON with slides).', 'missing');
  const questions = scenes.reduce((n, s) => n + s.slides.filter(x => x.next === 'question').length, 0);
  if (withTitle && spec.title) scenes[0].slides.unshift(titleSlide(spec.title, spec.subtitle));
  if (results === true || (results === 'auto' && questions)) scenes[scenes.length - 1].slides.push(resultSlide());
  return { scenes, questions };
}

export function newCourseFile(title, scenes, pass = 80) {
  const now = Date.now();
  return {
    id: rid('f'), title, created: now, updated: now, doc: '', diagrams: [{ id: rid('d'), type: 'architecture', name: 'Diagram 1', code: '', manual: {}, dir: 'LR', style: 'color' }], active: 0, view: 'course',
    course: { v: 1, title, size: { w: W, h: H }, font: 'Inter, system-ui, sans-serif', accent: '#4f5bd5', player: { menu: true, seekbar: true, prevNext: true, title: true, resume: true, freeNav: true }, quiz: { pass }, complete: 'viewed', vars: [], scenes },
  };
}

const truthy = v => v === true || v === 'true';
export const COURSE_NODES = {
  'workline.course': { run: async args => {
    const p = args.params(), op = p.operation || 'create';
    const spec = (p.source || 'outline') === 'json' ? parseCourseJson(p.json) : parseOutline(p.outline);
    if (p.title) spec.title = str(p.title, 120);
    const points = Math.max(0, Number(p.points) || 10);
    if (op === 'append') {
      const f = await args.ctx.files.read(String(p.fileId || ''));
      if (!f) throw new FlowError('That Workline file wasn’t found. Pick it again.', 'not_found');
      if (!f.course?.scenes) throw new FlowError(`“${f.title}” isn’t a course. Pick a course file, or make a new course.`, 'bad_param');
      const { scenes, questions } = buildScenes(spec, { titleSlide: false, results: truthy(p.results) ? true : false, points });
      // Into the last scene, or as scenes of their own when the outline names them.
      if (spec.scenes.length > 1 || /^scene\s*:/im.test(String(p.outline || ''))) f.course.scenes.push(...scenes);
      else f.course.scenes[f.course.scenes.length - 1].slides.push(...scenes[0].slides);
      await args.ctx.files.save(f);
      const added = scenes.reduce((n, s) => n + s.slides.length, 0);
      return { main: [{ json: { fileId: f.id, title: f.title, added, questions, slides: f.course.scenes.reduce((n, s) => n + s.slides.length, 0) } }] };
    }
    const title = spec.title || 'Course from a workflow';
    const { scenes, questions } = buildScenes({ ...spec, title }, { titleSlide: p.titleSlide !== false && p.titleSlide !== 'false', results: p.results == null || p.results === '' ? 'auto' : truthy(p.results), points });
    const f = newCourseFile(title, scenes, Math.min(100, Math.max(0, Number(p.pass) || 80)));
    await args.ctx.files.save(f);
    return { main: [{ json: { fileId: f.id, title, scenes: scenes.length, slides: scenes.reduce((n, s) => n + s.slides.length, 0), questions } }] };
  } },
};
