import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { rid } from '../lib/utils.js';
import { useUI } from './ui.jsx';
import {
  ACTIONS, ANIMS, BUILTIN_VARS, EVENTS, KINDS, OPS, QTYPES, STATES, allSlides, cloneSlide, courseHtml, findSlide, interpolate,
  newCourse, newLayer, newObject, newScene, newSlide, pictureUrl, scormZip,
} from '../lib/course.js';

/* The Course view: e-learning made of scenes and slides (see lib/course.js). The slides on the left, the
   slide in the middle with its layers below it, and on the right: Format (the object, or the slide),
   States, Triggers and Timeline. Preview runs the course; Publish gives a web page or a SCORM package. */

const SLIDE_KINDS = [['blank', 'Blank'], ['title', 'Title slide'], ['content', 'Title and content'], ['question', 'Question'], ['result', 'Results']];
const STATE_LABEL = { normal: 'Normal', hover: 'Hover', down: 'Down', selected: 'Selected', visited: 'Visited', disabled: 'Disabled', hidden: 'Hidden' };
const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
const hex = c => (/^#[0-9a-f]{6}$/i.test(c || '') ? c : /^#[0-9a-f]{3}$/i.test(c || '') ? '#' + c.slice(1).split('').map(x => x + x).join('') : '#ffffff');
const download = (blob, name) => { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 4000); };
const safeName = t => (t || 'course').replace(/[\\/:*?"<>|]+/g, '-').slice(0, 80);

// How an object looks (the same as the player draws it).
export function lookOf(o, st = 'normal') { return { ...o.style, ...(st !== 'normal' ? o.states?.[st] || {} : {}) }; }
function boxStyle(o, s) {
  return {
    left: o.x, top: o.y, width: o.w, height: o.h, background: s.fill && s.fill !== 'transparent' ? s.fill : 'transparent', color: s.color, fontSize: s.size || 18,
    fontWeight: s.bold ? 700 : 400, fontStyle: s.italic ? 'italic' : undefined, textAlign: s.align || 'left', borderRadius: s.shape === 'ellipse' ? '50%' : (s.radius || 0),
    border: s.borderW ? `${s.borderW}px solid ${s.border || 'transparent'}` : 0, opacity: s.opacity ?? undefined, boxShadow: s.shadow ? '0 10px 30px rgba(20,24,60,.18)' : undefined,
    justifyContent: s.valign === 'middle' ? 'center' : s.valign === 'bottom' ? 'flex-end' : 'flex-start',
  };
}
function ObjArt({ o, st = 'normal', vars = {} }) {
  const s = lookOf(o, st);
  const text = s.text != null ? s.text : o.text;
  if (o.kind === 'image') return (s.src || o.src) ? <img src={s.src || o.src} alt="" style={{ objectFit: s.fit || 'cover' }} draggable={false} /> : <span className="cv-ph">Picture</span>;
  if (o.kind === 'input') return <span className="cv-input">{o.var ? `${o.placeholder || ''}  → %${o.var}%` : o.placeholder}</span>;
  if (o.kind === 'video') return <span className="cv-ph dark">▶ Video{o.src ? '' : ' (add a link)'}</span>;
  if (o.kind === 'audio') return <span className="cv-ph">♪ Audio{o.src ? '' : ' (add a link)'}</span>;
  if (o.kind === 'hotspot') return <span className="cv-hot" />;
  if (o.kind === 'question') {
    const Q = o.q || {};
    return (
      <div className="cv-q">
        <b>{interpolate(Q.prompt, vars)}</b>
        {Q.type === 'fill' ? <span className="cv-qf">Type your answer</span> : (Q.choices || []).map((c, i) => <span key={c.id} className="cv-qo"><i className={Q.type === 'mr' ? 'sq' : Q.type === 'order' ? 'num' : ''}>{Q.type === 'order' ? i + 1 : ''}</i>{c.text}{c.correct && Q.type !== 'order' && <em>✓</em>}</span>)}
        <span className="cv-qs">Submit</span>
      </div>
    );
  }
  if (o.kind === 'result') return <div className="cv-r"><span className="cv-ring"><b>80%</b></span><b>{interpolate(text, { ...vars, 'Quiz.Percent': 80 })}</b><small>Score, pass or fail, and Retry</small></div>;
  return <div className="cv-t">{interpolate(text, vars)}</div>;
}
const defaultsOf = c => Object.fromEntries((c.vars || []).map(v => [v.name, v.value === '' ? `%${v.name}%` : v.value]));

// A slide drawn small (the slide list).
function Thumb({ slide, course }) {
  const vars = defaultsOf(course);
  const ref = useRef(null), [k, setK] = useState(0.17);
  useLayoutEffect(() => { const el = ref.current; if (!el) return undefined; const f = () => el.clientWidth && setK(el.clientWidth / course.size.w); f(); const ro = new ResizeObserver(f); ro.observe(el); return () => ro.disconnect(); }, [course.size.w]);
  return (
    <div className="cv-thumb" ref={ref} style={{ background: slide.bg, aspectRatio: `${course.size.w} / ${course.size.h}` }}>
      <div className="cv-thumb-in" style={{ width: course.size.w, height: course.size.h, transform: `scale(${k})` }}>
        {slide.layers[0].objects.filter(o => o.initial !== 'hidden').map(o => <div key={o.id} className={'cv-o k-' + o.kind} style={boxStyle(o, lookOf(o, o.initial || 'normal'))}><ObjArt o={o} st={o.initial || 'normal'} vars={vars} /></div>)}
      </div>
    </div>
  );
}

export default function CourseView({ file, update, visible = true }) {
  const { popup, ask, toast } = useUI();
  const course = file.course;
  useEffect(() => { if (!file.course) update(c => { c.course = newCourse(c.title || 'Course'); }); }, [file.course, update]);

  const [slideId, setSlideId] = useState(null);
  const [layerId, setLayerId] = useState(null);
  const [sel, setSel] = useState(null);
  const [tab, setTab] = useState('format');
  const [editState, setEditState] = useState('normal');
  const [editing, setEditing] = useState(null);
  const [openTrig, setOpenTrig] = useState(null); // the trigger opened in Triggers
  const [dialog, setDialog] = useState(null); // 'vars' | 'player' | {preview}
  const undo = useRef([]), redo = useRef([]);
  const picRef = useRef(null), picFor = useRef(null);

  const flat = course ? allSlides(course) : [];
  const here = course && (findSlide(course, slideId) || flat[0]);
  const slide = here?.s;
  const layer = slide && (slide.layers.find(l => l.id === layerId) || slide.layers[0]);
  const obj = layer && sel ? (layer.objects.find(o => o.id === sel) || null) : null;
  useEffect(() => { if (obj?.id !== sel) setSel(obj?.id || null); setEditState('normal'); }, [slide?.id, layer?.id]); // eslint-disable-line

  // A change to the course: one step to undo.
  // (The snapshot is taken here, not inside update(): React may run an updater twice.)
  const now = useRef(course); now.current = course;
  const write = useCallback(fn => {
    if (now.current) { undo.current.push(JSON.stringify(now.current)); if (undo.current.length > 60) undo.current.shift(); }
    redo.current = [];
    update(c => { if (!c.course) c.course = newCourse(c.title); fn(c.course); });
  }, [update]);
  const back = (from, to) => { const s = from.current.pop(); if (!s) return; to.current.push(JSON.stringify(now.current)); now.current = JSON.parse(s); update(c => { c.course = JSON.parse(s); }); };
  // Work on the live slide / layer / object inside a change.
  const inSlide = (c, id = slide.id) => findSlide(c, id)?.s;
  const inLayer = (c, sid = slide.id, lid = layer.id) => inSlide(c, sid)?.layers.find(l => l.id === lid);
  const inObj = (c, id = sel) => inLayer(c)?.objects.find(o => o.id === id);
  const editObj = fn => write(c => { const o = inObj(c); if (o) fn(o); });
  // Format edits go to the state being edited (Normal: the object's own look).
  const setLook = (k, v) => editObj(o => { const t = editState === 'normal' ? (o.style ||= {}) : ((o.states ||= {})[editState] ||= {}); if (v === undefined) delete t[k]; else t[k] = v; });

  /* ---- inserting ---- */
  const insert = (kind, extra = {}) => {
    const o = newObject(kind, extra);
    write(c => { inLayer(c).objects.push(o); });
    setSel(o.id); setTab('format');
  };
  const insertPicture = async f => {
    if (!f) return;
    try {
      const src = await pictureUrl(f);
      if (picFor.current) { const id = picFor.current; picFor.current = null; editObj(o => { if (o.id === id) { if (editState === 'normal') o.src = src; else ((o.states ||= {})[editState] ||= {}).src = src; } }); return; }
      const img = await new Promise(res => { const i = new Image(); i.onload = () => res(i); i.onerror = () => res(null); i.src = src; });
      const k = img ? Math.min(1, 520 / img.width, 360 / img.height) : 1;
      insert('image', { src, name: f.name.replace(/\.\w+$/, '').slice(0, 40) || 'Picture', ...(img ? { w: Math.round(img.width * k), h: Math.round(img.height * k), x: Math.round((course.size.w - img.width * k) / 2), y: Math.round((course.size.h - img.height * k) / 2) } : {}) });
    } catch (e) { toast(e.message); }
  };
  const insertMedia = async kind => {
    const url = await ask({ title: kind === 'video' ? 'Video link' : 'Audio link', text: 'A link to an .mp4 / .webm / .mp3 file (for example a file in Storage you made public, or any web address).', value: 'https://', ok: 'Insert' });
    if (url && url.trim() && url.trim() !== 'https://') insert(kind, { src: url.trim() });
  };
  const addSlide = (kind, sceneId) => {
    const s = newSlide('Untitled slide', kind);
    write(c => {
      const sc = c.scenes.find(x => x.id === (sceneId || here.sc.id)) || c.scenes[0];
      const at = sc.id === here.sc.id ? here.i + 1 : sc.slides.length;
      sc.slides.splice(at, 0, s);
    });
    setSlideId(s.id); setLayerId(null); setSel(null);
  };

  /* ---- keys: delete, nudge, duplicate, copy / paste, undo / redo ---- */
  const clip = useRef(null);
  useEffect(() => {
    if (!visible || !course) return undefined;
    const key = e => {
      if (e.target.closest?.('input,textarea,select,[contenteditable="true"]') || document.querySelector('.modal,.menu')) return;
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? back(redo, undo) : back(undo, redo); return; }
      if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); back(redo, undo); return; }
      if (!obj) return;
      if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); write(c => { const l = inLayer(c); l.objects = l.objects.filter(o => o.id !== obj.id); }); setSel(null); }
      else if (e.key.startsWith('Arrow')) {
        e.preventDefault(); const d = e.shiftKey ? 10 : 1;
        editObj(o => { if (e.key === 'ArrowLeft') o.x -= d; if (e.key === 'ArrowRight') o.x += d; if (e.key === 'ArrowUp') o.y -= d; if (e.key === 'ArrowDown') o.y += d; });
      } else if (mod && e.key.toLowerCase() === 'd') { e.preventDefault(); duplicate(obj); }
      else if (mod && e.key.toLowerCase() === 'c') clip.current = JSON.stringify(obj);
      else if (mod && e.key.toLowerCase() === 'v' && clip.current) { e.preventDefault(); const o = { ...JSON.parse(clip.current), id: rid('o') }; o.x += 20; o.y += 20; write(c => { inLayer(c).objects.push(o); }); setSel(o.id); }
    };
    addEventListener('keydown', key);
    return () => removeEventListener('keydown', key);
  });
  const duplicate = o => { const n = { ...JSON.parse(JSON.stringify(o)), id: rid('o'), x: o.x + 20, y: o.y + 20, name: o.name + ' copy' }; write(c => { inLayer(c).objects.push(n); }); setSel(n.id); };

  /* ---- the stage: fit it, select, move and resize objects ---- */
  const holder = useRef(null);
  const [k, setK] = useState(0.6);
  useLayoutEffect(() => {
    const el = holder.current; if (!el || !course) return undefined;
    const fit = () => { const r = el.getBoundingClientRect(); setK(Math.max(0.2, Math.min((r.width - 40) / course.size.w, (r.height - 30) / course.size.h, 1.4))); };
    fit(); const ro = new ResizeObserver(fit); ro.observe(el); return () => ro.disconnect();
  }, [course?.size?.w, visible]); // eslint-disable-line
  const drag = (e, o, mode) => {
    e.stopPropagation(); e.preventDefault();
    setSel(o.id);
    if (editing) return;
    const sx = e.clientX, sy = e.clientY, start = { x: o.x, y: o.y, w: o.w, h: o.h };
    let moved = false, snap = null;
    const el = e.currentTarget.closest('.cv-o'), box = el;
    const mv = m => {
      const dx = (m.clientX - sx) / k, dy = (m.clientY - sy) / k;
      if (!moved && Math.abs(dx) + Math.abs(dy) < 2) return;
      moved = true;
      const g = m.altKey ? 1 : 5, r = v => Math.round(v / g) * g;
      snap = { ...start };
      if (mode === 'move') { snap.x = r(start.x + dx); snap.y = r(start.y + dy); }
      if (mode.includes('e')) snap.w = Math.max(10, r(start.w + dx));
      if (mode.includes('s')) snap.h = Math.max(10, r(start.h + dy));
      if (mode.includes('w')) { snap.w = Math.max(10, r(start.w - dx)); snap.x = start.x + start.w - snap.w; }
      if (mode.includes('n')) { snap.h = Math.max(10, r(start.h - dy)); snap.y = start.y + start.h - snap.h; }
      Object.assign(box.style, { left: snap.x + 'px', top: snap.y + 'px', width: snap.w + 'px', height: snap.h + 'px' });
    };
    const up = () => { removeEventListener('pointermove', mv); removeEventListener('pointerup', up); if (moved && snap) editObj(x => { if (x.id === o.id) Object.assign(x, snap); }); };
    addEventListener('pointermove', mv); addEventListener('pointerup', up);
  };

  if (!course || !slide) return <div className="cv"><p className="muted" style={{ padding: 20 }}>Making the course…</p></div>;
  const vars = defaultsOf(course);
  const baseUnder = layer !== slide.layers[0];
  const lookState = o => (o.id === sel ? editState : 'normal');

  /* ---- menus ---- */
  const slideMenu = (btn, x) => popup(btn, [
    { label: 'Duplicate slide', act: () => { const n = cloneSlide(x.s); n.title += ' copy'; write(c => { const sc = c.scenes.find(s => s.id === x.sc.id); sc.slides.splice(sc.slides.findIndex(s => s.id === x.s.id) + 1, 0, n); }); setSlideId(n.id); } },
    { label: 'Rename slide', act: async () => { const v = await ask({ title: 'Rename slide', value: x.s.title, ok: 'Rename' }); if (v?.trim()) write(c => { inSlide(c, x.s.id).title = v.trim(); }); } },
    { label: 'Move up', act: () => write(c => { const sc = c.scenes.find(s => s.id === x.sc.id), i = sc.slides.findIndex(s => s.id === x.s.id); if (i > 0) [sc.slides[i - 1], sc.slides[i]] = [sc.slides[i], sc.slides[i - 1]]; }) },
    { label: 'Move down', act: () => write(c => { const sc = c.scenes.find(s => s.id === x.sc.id), i = sc.slides.findIndex(s => s.id === x.s.id); if (i < sc.slides.length - 1) [sc.slides[i + 1], sc.slides[i]] = [sc.slides[i], sc.slides[i + 1]]; }) },
    ...(course.scenes.length > 1 ? [{ label: 'Move to scene', items: course.scenes.filter(s => s.id !== x.sc.id).map(s => ({ label: s.name, act: () => write(c => { const from = c.scenes.find(z => z.id === x.sc.id), to = c.scenes.find(z => z.id === s.id); const [m] = from.slides.splice(from.slides.findIndex(z => z.id === x.s.id), 1); to.slides.push(m); }) })) }] : []),
    { label: 'Preview this slide', act: () => setDialog({ preview: x.s.id }) },
    { label: 'Delete slide', danger: true, act: () => { if (flat.length <= 1) return toast('A course needs at least one slide.'); write(c => { const sc = c.scenes.find(s => s.id === x.sc.id); sc.slides = sc.slides.filter(s => s.id !== x.s.id); c.scenes = c.scenes.filter(s => s.slides.length); }); setSlideId(null); } },
  ]);
  const sceneMenu = (btn, sc) => popup(btn, [
    { label: 'New slide here', items: SLIDE_KINDS.map(([kd, l]) => ({ label: l, act: () => addSlide(kd, sc.id) })) },
    { label: 'Rename scene', act: async () => { const v = await ask({ title: 'Rename scene', value: sc.name, ok: 'Rename' }); if (v?.trim()) write(c => { c.scenes.find(s => s.id === sc.id).name = v.trim(); }); } },
    { label: 'Delete scene', danger: true, act: async () => { if (course.scenes.length <= 1) return toast('A course needs at least one scene.'); if (await ask({ title: `Delete “${sc.name}”?`, text: `Its ${sc.slides.length} slide${sc.slides.length === 1 ? '' : 's'} go too.`, input: false, ok: 'Delete' })) { write(c => { c.scenes = c.scenes.filter(s => s.id !== sc.id); }); setSlideId(null); } } },
  ]);
  const layerMenu = (btn, l) => popup(btn, [
    { label: 'Rename layer', act: async () => { const v = await ask({ title: 'Rename layer', value: l.name, ok: 'Rename' }); if (v?.trim()) write(c => { inSlide(c).layers.find(x => x.id === l.id).name = v.trim(); }); } },
    { label: l.hideOthers ? '✓ Hide other layers when shown' : 'Hide other layers when shown', act: () => write(c => { const x = inSlide(c).layers.find(y => y.id === l.id); x.hideOthers = !x.hideOthers; }) },
    { label: 'Duplicate layer', act: () => { const n = { ...JSON.parse(JSON.stringify(l)), id: rid('l'), name: l.name + ' copy' }; n.objects.forEach(o => { o.id = rid('o'); }); n.triggers = []; write(c => { inSlide(c).layers.push(n); }); setLayerId(n.id); } },
    { label: 'Delete layer', danger: true, act: () => { write(c => { const s = inSlide(c); s.layers = s.layers.filter(x => x.id !== l.id); }); setLayerId(null); } },
  ]);
  const publish = btn => popup(btn, [
    { label: 'Web page (.html)', note: 'One file: put it on any website, or open it', act: () => download(new Blob([courseHtml({ ...course, id: file.id }, 'web')], { type: 'text/html' }), safeName(course.title) + '.html') },
    { label: 'SCORM 1.2 package (.zip)', note: 'For an LMS (Moodle, TalentLMS, Docebo…): completion, score, resume', act: async () => download(await scormZip({ ...course, id: file.id }), safeName(course.title) + '-scorm.zip') },
  ]);

  return (
    <div className="cv" data-course>
      <div className="cv-ribbon" role="toolbar" aria-label="Course tools">
        <div className="cv-grp"><span>Slide</span>
          <button className="btn" aria-haspopup="menu" onClick={e => popup(e.currentTarget, SLIDE_KINDS.map(([kd, l]) => ({ label: l, act: () => addSlide(kd) })))}>＋ New slide</button>
        </div>
        <div className="cv-grp"><span>Insert</span>
          <button className="btn" onClick={() => insert('text')}>Text</button>
          <button className="btn" aria-haspopup="menu" onClick={e => popup(e.currentTarget, [['Rectangle', {}], ['Rounded', { radius: 24 }], ['Oval', { shape: 'ellipse' }], ['Circle', { shape: 'ellipse' }, 160]].map(([l, x, d]) => ({ label: l, act: () => insert('shape', { name: l, ...(d ? { w: d, h: d } : {}), style: { ...newObject('shape').style, ...x } }) })))}>Shape</button>
          <button className="btn" onClick={() => insert('button')}>Button</button>
          <button className="btn" onClick={() => { picFor.current = null; picRef.current?.click(); }}>Picture</button>
          <button className="btn" onClick={() => insert('hotspot')}>Hotspot</button>
          <button className="btn" onClick={() => insert('input')}>Text entry</button>
          <button className="btn" aria-haspopup="menu" onClick={e => popup(e.currentTarget, [{ label: 'Video', act: () => insertMedia('video') }, { label: 'Audio', act: () => insertMedia('audio') }])}>Media</button>
          <button className="btn" onClick={() => insert('question')}>Question</button>
          <button className="btn" onClick={() => insert('result')}>Result</button>
          <input ref={picRef} type="file" accept="image/*" hidden aria-label="Picture to insert" onChange={e => { insertPicture(e.target.files[0]); e.target.value = ''; }} />
        </div>
        <div className="cv-grp"><span>Course</span>
          <button className="btn" onClick={() => setDialog('vars')}>Variables{course.vars.length ? ` (${course.vars.length})` : ''}</button>
          <button className="btn" onClick={() => setDialog('player')}>Player</button>
          <button className="btn icon-only" aria-label="Undo" title="Undo (Ctrl Z)" disabled={!undo.current.length} onClick={() => back(undo, redo)}>↶</button>
          <button className="btn icon-only" aria-label="Redo" title="Redo (Ctrl Y)" disabled={!redo.current.length} onClick={() => back(redo, undo)}>↷</button>
        </div>
        <div className="cv-grp cv-end">
          <button className="btn" aria-haspopup="menu" onClick={e => popup(e.currentTarget, [{ label: 'This slide', act: () => setDialog({ preview: slide.id }) }, { label: 'This scene', act: () => setDialog({ preview: 'scene:' + here.sc.id }) }, { label: 'The whole course', act: () => setDialog({ preview: 'all' }) }])}>▶ Preview</button>
          <button className="btn primary" aria-haspopup="menu" onClick={e => publish(e.currentTarget)}>Publish</button>
        </div>
      </div>

      <div className="cv-main">
        <aside className="cv-slides" aria-label="Slides">
          {course.scenes.map(sc => (
            <section key={sc.id} className="cv-scene">
              <header><b>{sc.name}</b><button className="rs-ib" aria-label={`Actions for scene ${sc.name}`} onClick={e => sceneMenu(e.currentTarget, sc)}>⋯</button></header>
              {sc.slides.map(s => {
                const n = flat.findIndex(x => x.s.id === s.id) + 1;
                return (
                  <div key={s.id} className={'cv-sl' + (s.id === slide.id ? ' on' : '')}>
                    <button className="cv-sl-b" aria-label={`Slide ${n}: ${s.title}`} aria-current={s.id === slide.id ? 'true' : undefined} onClick={() => { setSlideId(s.id); setLayerId(null); setSel(null); }}>
                      <i>{n}</i><Thumb slide={s} course={course} /><span>{s.title}</span>
                    </button>
                    <button className="cv-sl-m" aria-label={`Actions for slide ${s.title}`} onClick={e => slideMenu(e.currentTarget, { s, sc })}>⋯</button>
                  </div>
                );
              })}
            </section>
          ))}
          <button className="btn cv-addscene" onClick={() => { const sc = newScene(`Scene ${course.scenes.length + 1}`, [newSlide('Untitled slide', 'blank')]); write(c => { c.scenes.push(sc); }); setSlideId(sc.slides[0].id); }}>＋ New scene</button>
        </aside>

        <div className="cv-center">
          {editState !== 'normal' && obj && <div className="cv-stbar">Editing the <b>{STATE_LABEL[editState] || editState}</b> state of “{obj.name}”: Format changes apply to this state only.<button className="btn" onClick={() => setEditState('normal')}>Done</button></div>}
          <div className="cv-holder" ref={holder} onPointerDown={() => { setSel(null); setEditing(null); }}>
            <div className="cv-stage-box" style={{ width: course.size.w * k, height: course.size.h * k }}>
              <div className="cv-stage" style={{ width: course.size.w, height: course.size.h, transform: `scale(${k})`, background: slide.bg }} aria-label={`Slide: ${slide.title}`} role="region">
                {baseUnder && <div className="cv-under">{slide.layers[0].objects.map(o => <div key={o.id} className={'cv-o k-' + o.kind} style={boxStyle(o, lookOf(o))}><ObjArt o={o} vars={vars} /></div>)}</div>}
                {layer.objects.map(o => {
                  const st = lookState(o), s = lookOf(o, st);
                  return (
                    <div key={o.id} className={'cv-o k-' + o.kind + (o.id === sel ? ' sel' : '') + (o.initial === 'hidden' && st === 'normal' ? ' ghost' : '')} style={boxStyle(o, s)}
                      data-name={o.name} onPointerDown={e => drag(e, o, 'move')} onDoubleClick={() => ['text', 'shape', 'button', 'result'].includes(o.kind) && setEditing(o.id)}>
                      {editing === o.id
                        ? <textarea className="cv-edit" autoFocus defaultValue={s.text != null ? s.text : o.text} aria-label="Edit the text" style={{ textAlign: s.align, color: s.color, fontSize: s.size, fontWeight: s.bold ? 700 : 400 }}
                          onPointerDown={e => e.stopPropagation()} onKeyDown={e => { if (e.key === 'Escape') e.currentTarget.blur(); }}
                          onBlur={e => { const v = e.target.value.replace(/\r\n?/g, '\n'); setEditing(null); editObj(x => { if (editState === 'normal') x.text = v; else ((x.states ||= {})[editState] ||= {}).text = v; }); }} />
                        : <ObjArt o={o} st={st} vars={vars} />}
                      {o.id === sel && !editing && ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'].map(h => <i key={h} className={'cv-h h-' + h} onPointerDown={e => drag(e, o, h)} />)}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
          <div className="cv-layers" role="tablist" aria-label="Layers">
            {slide.layers.map((l, i) => (
              <div key={l.id} className={'cv-ly' + (l.id === layer.id ? ' on' : '')}>
                <button role="tab" aria-selected={l.id === layer.id} onClick={() => { setLayerId(l.id); setSel(null); }}>{i === 0 ? '▣ ' : '◧ '}{l.name}<small>{l.objects.length}</small></button>
                {i > 0 && <button className="rs-ib" aria-label={`Actions for layer ${l.name}`} onClick={e => layerMenu(e.currentTarget, l)}>⋯</button>}
              </div>
            ))}
            <button className="btn" onClick={() => { const l = newLayer(`Layer ${slide.layers.length}`); write(c => { inSlide(c).layers.push(l); }); setLayerId(l.id); setSel(null); }}>＋ Layer</button>
          </div>
        </div>

        <aside className="cv-panel" aria-label="Properties">
          <div className="cv-tabs" role="tablist">
            {[['format', 'Format'], ['states', 'States'], ['triggers', 'Triggers'], ['timeline', 'Timeline']].map(([t, l]) => <button key={t} role="tab" aria-selected={tab === t} className={tab === t ? 'on' : ''} onClick={() => setTab(t)}>{l}{t === 'triggers' && layer.triggers.length ? <small>{layer.triggers.length}</small> : null}</button>)}
          </div>
          <div className="cv-pbody">
            {tab === 'format' && (obj ? <ObjFormat o={obj} course={course} layer={layer} editState={editState} setLook={setLook} editObj={editObj} write={write} inLayer={inLayer} setSel={setSel} duplicate={duplicate}
              onPicture={() => { picFor.current = obj.id; picRef.current?.click(); }} onTrigger={() => { const t = { id: rid('t'), event: 'click', source: obj.id, action: 'jump', target: 'next', conds: [] }; write(c => { inLayer(c).triggers.push(t); }); setOpenTrig(t.id); setTab('triggers'); }} />
              : <SlideFormat slide={slide} write={write} inSlide={inSlide} />)}
            {tab === 'states' && <States o={obj} editState={editState} setEditState={setEditState} editObj={editObj} />}
            {tab === 'triggers' && <Triggers course={course} slide={slide} layer={layer} write={write} inLayer={inLayer} open={openTrig} setOpen={setOpenTrig} />}
            {tab === 'timeline' && <Timeline slide={slide} layer={layer} sel={sel} setSel={setSel} write={write} inLayer={inLayer} inSlide={inSlide} />}
          </div>
        </aside>
      </div>
      {dialog === 'vars' && <VarsDialog course={course} write={write} onClose={() => setDialog(null)} />}
      {dialog === 'player' && <PlayerDialog course={course} write={write} onClose={() => setDialog(null)} />}
      {dialog?.preview && <Preview course={course} fileId={file.id} what={dialog.preview} onClose={() => setDialog(null)} />}
    </div>
  );
}

/* ---- Format: the selected object ---- */
function Field({ label, children, wide }) { return <label className={'cv-f' + (wide ? ' wide' : '')}><span>{label}</span>{children}</label>; }
function Color({ label, value, onChange, clear = true }) {
  const none = !value || value === 'transparent';
  return (
    <Field label={label}>
      <span className="cv-color">
        <input type="color" value={none ? '#ffffff' : hex(value)} onChange={e => onChange(e.target.value)} aria-label={label} />
        {clear && <button type="button" className={'cv-none' + (none ? ' on' : '')} title="None" aria-label={`No ${label.toLowerCase()}`} onClick={() => onChange('transparent')}>⊘</button>}
      </span>
    </Field>
  );
}
function Num({ label, value, onChange, step = 1, min }) { return <Field label={label}><input type="number" value={value ?? ''} step={step} min={min} onChange={e => onChange(e.target.value === '' ? null : Number(e.target.value))} aria-label={label} /></Field>; }
function ObjFormat({ o, course, layer, editState, setLook, editObj, write, inLayer, setSel, duplicate, onPicture, onTrigger }) {
  const s = lookOf(o, editState);
  const textual = ['text', 'shape', 'button', 'result'].includes(o.kind);
  const set = (k, v) => editObj(x => { x[k] = v; });
  const others = layer.objects.filter(x => x.id !== o.id);
  return (
    <div className="cv-form">
      <div className="cv-row"><Field label="Name" wide><input value={o.name} onChange={e => set('name', e.target.value)} aria-label="Object name" /></Field></div>
      <p className="cv-kind">{KINDS[o.kind]}{editState !== 'normal' && <> · <b>{STATE_LABEL[editState] || editState} state</b></>}</p>
      {editState === 'normal' && <div className="cv-row4"><Num label="X" value={Math.round(o.x)} onChange={v => set('x', v || 0)} /><Num label="Y" value={Math.round(o.y)} onChange={v => set('y', v || 0)} /><Num label="Width" value={Math.round(o.w)} onChange={v => set('w', Math.max(10, v || 10))} /><Num label="Height" value={Math.round(o.h)} onChange={v => set('h', Math.max(10, v || 10))} /></div>}
      {textual && <Field label="Text" wide><textarea rows={3} value={s.text != null ? s.text : o.text || ''} onChange={e => (editState === 'normal' ? set('text', e.target.value) : setLook('text', e.target.value))} aria-label="Text" /><small>Show a variable with %Name%.</small></Field>}
      {(textual || ['input', 'question'].includes(o.kind)) && (
        <>
          <div className="cv-row">
            <Num label="Font size" value={s.size} onChange={v => setLook('size', v || 12)} min={6} />
            <Color label="Text color" value={s.color} onChange={v => setLook('color', v)} clear={false} />
          </div>
          <div className="cv-seg" role="group" aria-label="Text style">
            <button className={s.bold ? 'on' : ''} aria-pressed={!!s.bold} onClick={() => setLook('bold', !s.bold)}><b>B</b></button>
            <button className={s.italic ? 'on' : ''} aria-pressed={!!s.italic} onClick={() => setLook('italic', !s.italic)}><i>I</i></button>
            {['left', 'center', 'right'].map(a => <button key={a} className={(s.align || 'left') === a ? 'on' : ''} aria-label={`Align ${a}`} onClick={() => setLook('align', a)}>{a === 'left' ? '⇤' : a === 'center' ? '≡' : '⇥'}</button>)}
            {['top', 'middle', 'bottom'].map(a => <button key={a} className={(s.valign || 'top') === a ? 'on' : ''} aria-label={`Align ${a}`} onClick={() => setLook('valign', a)}>{a === 'top' ? '⤒' : a === 'middle' ? '↕' : '⤓'}</button>)}
          </div>
        </>
      )}
      {o.kind !== 'audio' && (
        <div className="cv-row">
          <Color label="Fill" value={s.fill} onChange={v => setLook('fill', v)} />
          <Color label="Border" value={s.borderW ? s.border : 'transparent'} onChange={v => { setLook('border', v); if (v !== 'transparent' && !s.borderW) setLook('borderW', 2); if (v === 'transparent') setLook('borderW', 0); }} />
        </div>
      )}
      {o.kind !== 'audio' && <div className="cv-row"><Num label="Border width" value={s.borderW || 0} onChange={v => setLook('borderW', v || 0)} min={0} /><Num label="Corners" value={s.radius || 0} onChange={v => setLook('radius', v || 0)} min={0} /></div>}
      <div className="cv-row">
        <Num label="Opacity %" value={Math.round((s.opacity ?? 1) * 100)} onChange={v => setLook('opacity', v == null ? undefined : Math.max(0, Math.min(100, v)) / 100)} min={0} />
        <Field label="Shadow"><input type="checkbox" checked={!!s.shadow} onChange={e => setLook('shadow', e.target.checked)} aria-label="Shadow" /></Field>
      </div>
      {o.kind === 'shape' && <Field label="Shape" wide><select value={s.shape || 'rect'} onChange={e => setLook('shape', e.target.value === 'rect' ? undefined : e.target.value)} aria-label="Shape"><option value="rect">Rectangle</option><option value="ellipse">Oval</option></select></Field>}
      {o.kind === 'image' && <><button className="btn" onClick={onPicture}>{editState === 'normal' ? 'Change picture…' : 'Picture for this state…'}</button><Field label="Fit" wide><select value={s.fit || 'cover'} onChange={e => setLook('fit', e.target.value)} aria-label="Fit"><option value="cover">Fill the box</option><option value="contain">Fit inside</option><option value="fill">Stretch</option></select></Field><Field label="Alt text (for screen readers)" wide><input value={o.alt || ''} onChange={e => set('alt', e.target.value)} aria-label="Alt text" /></Field></>}
      {o.kind === 'input' && editState === 'normal' && <>
        <Field label="Saves into the variable" wide><select value={o.var || ''} onChange={e => set('var', e.target.value)} aria-label="Variable"><option value="">(none)</option>{course.vars.map(v => <option key={v.id} value={v.name}>{v.name}</option>)}</select>{!course.vars.length && <small>Make one in Variables first.</small>}</Field>
        <Field label="Placeholder" wide><input value={o.placeholder || ''} onChange={e => set('placeholder', e.target.value)} aria-label="Placeholder" /></Field>
      </>}
      {(o.kind === 'video' || o.kind === 'audio') && editState === 'normal' && <>
        <Field label="Link to the file" wide><input value={o.src || ''} onChange={e => set('src', e.target.value)} aria-label="Media link" placeholder="https://…/clip.mp4" /></Field>
        <div className="cv-row"><Field label="Play when it appears"><input type="checkbox" checked={!!o.autoplay} onChange={e => set('autoplay', e.target.checked)} aria-label="Autoplay" /></Field><Field label="Show controls"><input type="checkbox" checked={o.controls !== false} onChange={e => set('controls', e.target.checked)} aria-label="Show controls" /></Field></div>
      </>}
      {o.kind === 'question' && editState === 'normal' && <QuestionForm o={o} editObj={editObj} />}
      {o.kind === 'result' && editState === 'normal' && <Field label="Retry button"><input type="checkbox" checked={o.retry !== false} onChange={e => set('retry', e.target.checked)} aria-label="Retry button" /></Field>}
      {editState === 'normal' && <>
        <Field label="Starts as" wide><select value={o.initial || 'normal'} onChange={e => set('initial', e.target.value === 'normal' ? undefined : e.target.value)} aria-label="Initial state">{[...new Set(['normal', 'hidden', 'disabled', ...Object.keys(o.states || {})])].map(st => <option key={st} value={st}>{STATE_LABEL[st] || st}</option>)}</select></Field>
        {['shape', 'image', 'button', 'text'].includes(o.kind) && <>
          <div className="cv-row"><Field label="Learner can drag it"><input type="checkbox" checked={!!o.drag} onChange={e => set('drag', e.target.checked)} aria-label="Draggable" /></Field>{o.drag && <Field label="Snap back if wrong"><input type="checkbox" checked={!!o.snap} onChange={e => set('snap', e.target.checked)} aria-label="Snap back" /></Field>}</div>
          {o.drag && <Field label="Right drop target" wide><select value={o.dropOn || ''} onChange={e => set('dropOn', e.target.value)} aria-label="Drop target"><option value="">(any)</option>{others.map(x => <option key={x.id} value={x.id}>{x.name}</option>)}</select><small>Add a trigger “when this is dropped on…” to react.</small></Field>}
        </>}
      </>}
      <div className="cv-acts">
        <button className="btn" onClick={onTrigger}>＋ Trigger</button>
        <button className="btn" onClick={() => duplicate(o)}>Duplicate</button>
        <button className="btn" aria-label="Bring forward" title="Bring forward" onClick={() => write(c => { const l = inLayer(c), i = l.objects.findIndex(x => x.id === o.id); if (i < l.objects.length - 1) [l.objects[i], l.objects[i + 1]] = [l.objects[i + 1], l.objects[i]]; })}>⬆</button>
        <button className="btn" aria-label="Send backward" title="Send backward" onClick={() => write(c => { const l = inLayer(c), i = l.objects.findIndex(x => x.id === o.id); if (i > 0) [l.objects[i], l.objects[i - 1]] = [l.objects[i - 1], l.objects[i]]; })}>⬇</button>
        <button className="btn danger" onClick={() => { write(c => { const l = inLayer(c); l.objects = l.objects.filter(x => x.id !== o.id); }); setSel(null); }}>Delete</button>
      </div>
    </div>
  );
}
function QuestionForm({ o, editObj }) {
  const Q = o.q;
  const setQ = (k, v) => editObj(x => { x.q[k] = v; });
  const setType = t => editObj(x => {
    x.q.type = t;
    if (t === 'tf') x.q.choices = [{ id: rid('c'), text: 'True', correct: true }, { id: rid('c'), text: 'False', correct: false }];
    if (t === 'mc' && x.q.choices.filter(c => c.correct).length !== 1) x.q.choices.forEach((c, i) => { c.correct = i === 0; });
  });
  return (
    <div className="cv-qform">
      <Field label="Kind of question" wide><select value={Q.type} onChange={e => setType(e.target.value)} aria-label="Kind of question">{QTYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></Field>
      <Field label="Question" wide><textarea rows={2} value={Q.prompt} onChange={e => setQ('prompt', e.target.value)} aria-label="Question" /></Field>
      {Q.type === 'fill'
        ? <Field label="Right answers (separate with |)" wide><input value={Q.answer || ''} onChange={e => setQ('answer', e.target.value)} aria-label="Right answers" placeholder="Paris | paris, france" /></Field>
        : (
          <div className="cv-choices">
            <span>{Q.type === 'order' ? 'Items, in the right order' : 'Choices (tick the right one' + (Q.type === 'mr' ? 's' : '') + ')'}</span>
            {Q.choices.map((c, i) => (
              <div key={c.id} className="cv-choice">
                {Q.type !== 'order' && <input type={Q.type === 'mr' ? 'checkbox' : 'radio'} name={'right' + o.id} checked={!!c.correct} aria-label={`${c.text} is right`}
                  onChange={() => editObj(x => { x.q.choices.forEach(y => { if (Q.type === 'mr') { if (y.id === c.id) y.correct = !y.correct; } else y.correct = y.id === c.id; }); })} />}
                {Q.type === 'order' && <i>{i + 1}</i>}
                <input value={c.text} onChange={e => editObj(x => { x.q.choices.find(y => y.id === c.id).text = e.target.value; })} aria-label={`Choice ${i + 1}`} disabled={Q.type === 'tf'} />
                {Q.type !== 'tf' && <button className="rs-ib" aria-label={`Remove choice ${i + 1}`} onClick={() => editObj(x => { x.q.choices = x.q.choices.filter(y => y.id !== c.id); })}>×</button>}
              </div>
            ))}
            {Q.type !== 'tf' && <button className="btn" onClick={() => editObj(x => { x.q.choices.push({ id: rid('c'), text: `Choice ${x.q.choices.length + 1}`, correct: false }); })}>＋ Choice</button>}
          </div>
        )}
      <div className="cv-row"><Num label="Points" value={Q.points} onChange={v => setQ('points', v || 0)} min={0} /><Num label="Attempts" value={Q.attempts} onChange={v => setQ('attempts', Math.max(1, v || 1))} min={1} /></div>
      {Q.type !== 'order' && Q.type !== 'tf' && Q.type !== 'fill' && <Field label="Shuffle the choices"><input type="checkbox" checked={!!Q.shuffle} onChange={e => setQ('shuffle', e.target.checked)} aria-label="Shuffle" /></Field>}
      <Field label="When right" wide><input value={Q.right} onChange={e => setQ('right', e.target.value)} aria-label="Feedback when right" /></Field>
      <Field label="When wrong" wide><input value={Q.wrong} onChange={e => setQ('wrong', e.target.value)} aria-label="Feedback when wrong" /></Field>
    </div>
  );
}
function SlideFormat({ slide, write, inSlide }) {
  const set = (k, v) => write(c => { inSlide(c)[k] = v; });
  return (
    <div className="cv-form">
      <p className="cv-kind">Slide · select an object to format it</p>
      <Field label="Title" wide><input value={slide.title} onChange={e => set('title', e.target.value)} aria-label="Slide title" /></Field>
      <Color label="Background" value={slide.bg} onChange={v => set('bg', v === 'transparent' ? '#ffffff' : v)} clear={false} />
      <div className="cv-row"><Num label="Timeline (seconds)" value={slide.duration} onChange={v => set('duration', Math.max(0, v || 0))} step={0.5} min={0} /></div>
      <Field label="When the timeline ends" wide>
        <select value={slide.next} onChange={e => set('next', e.target.value)} aria-label="When the timeline ends">
          <option value="user">Wait for the learner (Next)</option><option value="auto">Go on by itself</option><option value="question">Wait until the question is answered</option>
        </select>
      </Field>
      <Field label="Notes (for you; not shown)" wide><textarea rows={4} value={slide.notes || ''} onChange={e => set('notes', e.target.value)} aria-label="Slide notes" /></Field>
    </div>
  );
}

/* ---- States ---- */
function States({ o, editState, setEditState, editObj }) {
  const { ask } = useUI();
  if (!o) return <p className="cv-empty">Select an object to give it states: how it looks when the mouse is over it, when it’s clicked, picked, visited, turned off — or any state of your own.</p>;
  const has = st => st === 'normal' || !!o.states?.[st];
  const all = [...STATES, ...Object.keys(o.states || {}).filter(s => !STATES.includes(s))];
  return (
    <div className="cv-states">
      <p className="cv-kind">States of “{o.name}”</p>
      {all.map(st => (
        <div key={st} className={'cv-st' + (editState === st ? ' on' : '') + (has(st) ? '' : ' off')}>
          <span><b>{STATE_LABEL[st] || st}</b><small>{st === 'normal' ? 'How it starts' : st === 'hover' ? 'Mouse over it' : st === 'down' ? 'While pressed' : st === 'selected' ? 'Clicked on (toggles)' : st === 'visited' ? 'After it’s clicked' : st === 'disabled' ? 'Can’t be clicked' : st === 'hidden' ? 'Not shown' : 'Your own state'}</small></span>
          {has(st)
            ? <>{st !== 'hidden' && <button className="btn" aria-label={`Edit the ${STATE_LABEL[st] || st} state`} onClick={() => setEditState(editState === st ? 'normal' : st)}>{editState === st ? 'Done' : 'Edit'}</button>}
              {st !== 'normal' && <button className="rs-ib" aria-label={`Remove the ${STATE_LABEL[st] || st} state`} onClick={() => { editObj(x => { delete x.states[st]; }); if (editState === st) setEditState('normal'); }}>×</button>}</>
            : <button className="btn" aria-label={`Add the ${STATE_LABEL[st]} state`} onClick={() => { editObj(x => { (x.states ||= {})[st] = st === 'disabled' ? { opacity: 0.5 } : st === 'hidden' ? {} : {}; }); if (st !== 'hidden') setEditState(st); }}>Add</button>}
        </div>
      ))}
      <button className="btn" onClick={async () => { const name = await ask({ title: 'New state', text: 'A state of your own, like “Done” or “Wrong”: change to it with a trigger.', value: 'Done', ok: 'Add' }); const n = (name || '').trim(); if (n && !all.includes(n)) { editObj(x => { (x.states ||= {})[n] = {}; }); setEditState(n); } }}>＋ State of your own</button>
    </div>
  );
}

/* ---- Triggers ---- */
export function describeTrigger(t, course, slide) {
  const objName = id => slide.layers.flatMap(l => l.objects).find(o => o.id === id)?.name || '(gone)';
  const slideName = id => ({ next: 'next slide', prev: 'previous slide', first: 'first slide', last: 'last slide' }[id] || allSlides(course).find(x => x.s.id === id)?.s.title || '(gone)');
  const layerName = id => (id === 'this' ? 'this layer' : slide.layers.find(l => l.id === id)?.name || '(gone)');
  const a = t.action, act = ACTIONS.find(x => x[0] === a)?.[1] || a;
  const what = a === 'jump' ? `${act} ${slideName(t.target)}` : a === 'showLayer' || a === 'hideLayer' ? `${act} ${layerName(t.target)}` : a === 'state' ? `Change ${objName(t.target)} to ${STATE_LABEL[t.value] || t.value || 'Normal'}`
    : a === 'setVar' ? `Set ${t.target || '?'} ${{ set: '=', add: '+', subtract: '−', multiply: '×', divide: '÷', toggle: 'toggle' }[t.op || 'set']} ${t.op === 'toggle' ? '' : t.value ?? ''}` : a === 'media' ? `${cap(t.value || 'play')} ${objName(t.target)}`
      : a === 'timeline' ? `${cap(t.value || 'pause')} the timeline` : a === 'submit' ? `Submit ${objName(t.target)}` : a === 'url' ? `Open ${t.value || '?'}` : act;
  const ev = EVENTS.find(x => x[0] === t.event);
  const when = ev?.[2] === 'object' ? `${ev[1].toLowerCase()} ${objName(t.source)}${t.event === 'drop' && t.value ? ' on ' + objName(t.value) : ''}${t.event === 'stateChange' && t.value ? ' ' + (STATE_LABEL[t.value] || t.value) : ''}` : ev?.[2] === 'var' ? `${t.source || '?'} changes` : t.event === 'key' ? `the learner presses ${t.value || '?'}` : (ev?.[1] || t.event).toLowerCase();
  return { what, when: 'When ' + when, ifs: (t.conds || []).length };
}
function Triggers({ course, slide, layer, write, inLayer, open, setOpen }) {
  const edit = (id, fn) => write(c => { const t = inLayer(c).triggers.find(x => x.id === id); if (t) fn(t); });
  const add = () => { const t = { id: rid('t'), event: 'click', source: layer.objects[0]?.id || '', action: 'jump', target: 'next', conds: [] }; write(c => { inLayer(c).triggers.push(t); }); setOpen(t.id); };
  return (
    <div className="cv-trigs">
      <p className="cv-kind">Triggers on <b>{layer.name}</b>: do something when something happens.</p>
      {!layer.triggers.length && <p className="cv-empty">No triggers yet. A trigger is “do <i>this</i> when <i>that</i> happens” — for example, jump to the next slide when the learner clicks a button.</p>}
      {layer.triggers.map((t, i) => {
        const d = describeTrigger(t, course, slide);
        return (
          <div key={t.id} className={'cv-trig' + (open === t.id ? ' on' : '')}>
            <button className="cv-trig-h" aria-expanded={open === t.id} onClick={() => setOpen(open === t.id ? null : t.id)}><b>{d.what}</b><span>{d.when}{d.ifs ? ` · if ${d.ifs} condition${d.ifs === 1 ? '' : 's'}` : ''}</span></button>
            {open === t.id && <TriggerForm t={t} course={course} slide={slide} layer={layer} edit={fn => edit(t.id, fn)}
              onMove={dir => write(c => { const l = inLayer(c), j = i + dir; if (j >= 0 && j < l.triggers.length) [l.triggers[i], l.triggers[j]] = [l.triggers[j], l.triggers[i]]; })}
              onDelete={() => write(c => { const l = inLayer(c); l.triggers = l.triggers.filter(x => x.id !== t.id); })} />}
          </div>
        );
      })}
      <button className="btn primary" onClick={add}>＋ New trigger</button>
    </div>
  );
}
function TriggerForm({ t, course, slide, layer, edit, onMove, onDelete }) {
  const objs = [...new Map([...layer.objects, ...slide.layers[0].objects].map(o => [o.id, o])).values()];
  const varNames = course.vars.map(v => v.name);
  const kind = ACTIONS.find(a => a[0] === t.action)?.[2];
  const evKind = EVENTS.find(e => e[0] === t.event)?.[2];
  const objOpts = (list = objs) => list.map(o => <option key={o.id} value={o.id}>{o.name}</option>);
  const stateOpts = id => { const o = objs.find(x => x.id === id); return [...new Set(['normal', 'hidden', 'disabled', ...STATES.filter(s => o?.states?.[s]), ...Object.keys(o?.states || {})])].map(s => <option key={s} value={s}>{STATE_LABEL[s] || s}</option>); };
  const setAction = a => edit(x => { x.action = a; const kd = ACTIONS.find(y => y[0] === a)?.[2]; x.target = kd === 'slide' ? 'next' : kd === 'layer' ? (slide.layers[1]?.id || 'this') : kd === 'object' ? (objs.find(o => (a === 'media' ? ['video', 'audio'].includes(o.kind) : a === 'submit' ? o.kind === 'question' : true))?.id || '') : kd === 'var' ? (varNames[0] || '') : ''; x.value = a === 'state' ? 'normal' : a === 'media' ? 'play' : a === 'timeline' ? 'pause' : ''; x.op = 'set'; });
  const setEvent = ev => edit(x => { x.event = ev; const kd = EVENTS.find(y => y[0] === ev)?.[2]; x.source = kd === 'object' ? (objs[0]?.id || '') : kd === 'var' ? (varNames[0] || '') : ''; x.value = ev === 'key' ? 'Enter' : ''; });
  const def = course.vars.find(v => v.name === t.target);
  const condLeft = [...varNames, ...BUILTIN_VARS];
  return (
    <div className="cv-tform">
      <Field label="Action" wide><select value={t.action} onChange={e => setAction(e.target.value)} aria-label="Action">{ACTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></Field>
      {kind === 'slide' && <Field label="Slide" wide><select value={t.target} onChange={e => edit(x => { x.target = e.target.value; })} aria-label="Slide"><option value="next">Next slide</option><option value="prev">Previous slide</option><option value="first">First slide</option><option value="last">Last slide</option>{course.scenes.map(sc => <optgroup key={sc.id} label={sc.name}>{sc.slides.map(s => <option key={s.id} value={s.id}>{s.title}</option>)}</optgroup>)}</select></Field>}
      {kind === 'layer' && <Field label="Layer" wide><select value={t.target} onChange={e => edit(x => { x.target = e.target.value; })} aria-label="Layer"><option value="this">This layer</option>{slide.layers.slice(1).map(l => <option key={l.id} value={l.id}>{l.name}</option>)}</select>{slide.layers.length < 2 && <small>Add a layer below the slide first.</small>}</Field>}
      {kind === 'object' && <Field label="Object" wide><select value={t.target} onChange={e => edit(x => { x.target = e.target.value; })} aria-label="Target object"><option value="">(pick one)</option>{objOpts(t.action === 'media' ? objs.filter(o => ['video', 'audio'].includes(o.kind)) : t.action === 'submit' ? objs.filter(o => o.kind === 'question') : objs)}</select></Field>}
      {t.action === 'state' && <Field label="To the state" wide><select value={t.value || 'normal'} onChange={e => edit(x => { x.value = e.target.value; })} aria-label="To the state">{stateOpts(t.target)}</select></Field>}
      {kind === 'var' && <>
        <Field label="Variable" wide><select value={t.target} onChange={e => edit(x => { x.target = e.target.value; })} aria-label="Variable"><option value="">(pick one)</option>{varNames.map(v => <option key={v}>{v}</option>)}</select>{!varNames.length && <small>Make one in Variables first.</small>}</Field>
        <div className="cv-row">
          <Field label="Operation"><select value={t.op || 'set'} onChange={e => edit(x => { x.op = e.target.value; })} aria-label="Operation">{(def?.type === 'number' ? [['set', '= Assign'], ['add', '+ Add'], ['subtract', '− Subtract'], ['multiply', '× Multiply'], ['divide', '÷ Divide']] : def?.type === 'bool' ? [['set', '= Assign'], ['toggle', 'Toggle']] : [['set', '= Assign'], ['add', '+ Add text']]).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></Field>
          {t.op !== 'toggle' && <Field label="Value">{def?.type === 'bool' ? <select value={String(t.value)} onChange={e => edit(x => { x.value = e.target.value; })} aria-label="Value"><option value="true">True</option><option value="false">False</option></select> : <input value={t.value ?? ''} onChange={e => edit(x => { x.value = e.target.value; })} aria-label="Value" placeholder="1 or %Other%" />}</Field>}
        </div>
      </>}
      {t.action === 'media' && <Field label="Do" wide><select value={t.value || 'play'} onChange={e => edit(x => { x.value = e.target.value; })} aria-label="Media action"><option value="play">Play</option><option value="pause">Pause</option><option value="stop">Stop</option></select></Field>}
      {t.action === 'timeline' && <Field label="Do" wide><select value={t.value || 'pause'} onChange={e => edit(x => { x.value = e.target.value; })} aria-label="Timeline action"><option value="pause">Pause</option><option value="resume">Resume</option></select></Field>}
      {t.action === 'url' && <Field label="Web address" wide><input value={t.value || ''} onChange={e => edit(x => { x.value = e.target.value; })} aria-label="Web address" placeholder="https://…" /></Field>}
      <Field label="When" wide><select value={t.event} onChange={e => setEvent(e.target.value)} aria-label="When">{EVENTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></Field>
      {evKind === 'object' && <Field label="Object" wide><select value={t.source} onChange={e => edit(x => { x.source = e.target.value; })} aria-label="Source object"><option value="">(pick one)</option>{objOpts(t.event === 'mediaEnd' ? objs.filter(o => ['video', 'audio'].includes(o.kind)) : ['correct', 'incorrect'].includes(t.event) ? objs.filter(o => o.kind === 'question') : objs)}</select></Field>}
      {t.event === 'drop' && <Field label="Dropped on" wide><select value={t.value || ''} onChange={e => edit(x => { x.value = e.target.value; })} aria-label="Dropped on"><option value="">(anything)</option>{objOpts(objs.filter(o => o.id !== t.source))}</select></Field>}
      {t.event === 'stateChange' && <Field label="State" wide><select value={t.value || ''} onChange={e => edit(x => { x.value = e.target.value; })} aria-label="Becomes the state"><option value="">(any)</option>{stateOpts(t.source)}</select></Field>}
      {evKind === 'var' && <Field label="Variable" wide><select value={t.source} onChange={e => edit(x => { x.source = e.target.value; })} aria-label="Watched variable"><option value="">(pick one)</option>{varNames.map(v => <option key={v}>{v}</option>)}</select></Field>}
      {t.event === 'key' && <Field label="Key" wide><input value={t.value || ''} onChange={e => edit(x => { x.value = e.target.value; })} aria-label="Key" placeholder="Enter, a, ArrowRight…" /></Field>}
      <div className="cv-conds">
        <span>Only if</span>
        {(t.conds || []).map((c, i) => (
          <div key={i} className="cv-cond">
            <select value={c.left} onChange={e => edit(x => { x.conds[i].left = e.target.value; })} aria-label="Condition: what">
              <option value="">(pick)</option>
              <optgroup label="Variables">{condLeft.map(v => <option key={v} value={v}>{v}</option>)}</optgroup>
              <optgroup label="State of">{objs.map(o => <option key={o.id} value={'state:' + o.id}>{o.name}’s state</option>)}</optgroup>
            </select>
            <select value={c.op} onChange={e => edit(x => { x.conds[i].op = e.target.value; })} aria-label="Condition: test">{OPS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
            {!['empty', 'notEmpty'].includes(c.op) && (String(c.left).startsWith('state:')
              ? <select value={c.right} onChange={e => edit(x => { x.conds[i].right = e.target.value; })} aria-label="Condition: state">{stateOpts(c.left.slice(6))}</select>
              : <input value={c.right ?? ''} onChange={e => edit(x => { x.conds[i].right = e.target.value; })} aria-label="Condition: value" />)}
            <button className="rs-ib" aria-label="Remove the condition" onClick={() => edit(x => { x.conds.splice(i, 1); })}>×</button>
          </div>
        ))}
        <button className="btn" onClick={() => edit(x => { (x.conds ||= []).push({ left: varNames[0] || 'Quiz.Percent', op: '==', right: '' }); })}>＋ Condition</button>
      </div>
      <div className="cv-acts"><button className="btn" aria-label="Move trigger up" onClick={() => onMove(-1)}>↑</button><button className="btn" aria-label="Move trigger down" onClick={() => onMove(1)}>↓</button><button className="btn danger" onClick={onDelete}>Delete trigger</button></div>
    </div>
  );
}

/* ---- Timeline ---- */
function Timeline({ slide, layer, sel, setSel, write, inLayer, inSlide }) {
  const base = layer === slide.layers[0];
  const len = Math.max(base ? Number(slide.duration) || 1 : 1, ...layer.objects.map(o => (Number(o.start) || 0) + (o.dur ? Number(o.dur) : 0))) || 1;
  const set = (id, k, v) => write(c => { const o = inLayer(c).objects.find(x => x.id === id); if (o) o[k] = v; });
  return (
    <div className="cv-tl">
      <p className="cv-kind">Timeline of <b>{layer.name}</b>{base ? '' : ' (starts when the layer is shown)'}</p>
      {base && <div className="cv-row"><Num label="Slide length (s)" value={slide.duration} step={0.5} min={0} onChange={v => write(c => { inSlide(c).duration = Math.max(0, v || 0); })} /></div>}
      <div className="cv-tl-rows">
        {[...layer.objects].reverse().map(o => {
          const st = Number(o.start) || 0, du = o.dur ? Number(o.dur) : len - st;
          return (
            <div key={o.id} className={'cv-tl-r' + (o.id === sel ? ' on' : '')} onClick={() => setSel(o.id)}>
              <span className="cv-tl-n">{o.name}</span>
              <div className="cv-tl-bar"><i style={{ left: `${(st / len) * 100}%`, width: `${Math.max(2, (du / len) * 100)}%` }} /></div>
            </div>
          );
        })}
      </div>
      {sel && layer.objects.find(o => o.id === sel) && (() => {
        const o = layer.objects.find(x => x.id === sel);
        return (
          <div className="cv-form">
            <p className="cv-kind">“{o.name}”</p>
            <div className="cv-row"><Num label="Appears at (s)" value={o.start || 0} step={0.25} min={0} onChange={v => set(o.id, 'start', Math.max(0, v || 0))} /><Num label="Shown for (s, blank: to the end)" value={o.dur ?? ''} step={0.25} min={0} onChange={v => set(o.id, 'dur', v || null)} /></div>
            <Field label="Comes in with" wide><select value={o.anim || 'none'} onChange={e => set(o.id, 'anim', e.target.value)} aria-label="Entrance animation">{ANIMS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></Field>
          </div>
        );
      })()}
      {!sel && <p className="cv-empty">Pick an object to set when it appears, for how long, and how it comes in.</p>}
    </div>
  );
}

/* ---- dialogs ---- */
function Modal({ title, onClose, children, wide }) {
  return (
    <div className="modal" onPointerDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={'mbox cv-dlg' + (wide ? ' wide' : '')} role="dialog" aria-modal="true" aria-label={title} onKeyDown={e => { if (e.key === 'Escape') onClose(); }}>
        <header><h3>{title}</h3><button className="rs-ib" aria-label="Close" onClick={onClose}>×</button></header>
        {children}
      </div>
    </div>
  );
}
function VarsDialog({ course, write, onClose }) {
  const edit = (id, k, v) => write(c => { const x = c.vars.find(y => y.id === id); if (x) x[k] = v; });
  return (
    <Modal title="Variables" onClose={onClose}>
      <p className="cv-note">Variables remember things while the course runs: a name typed in, a score, whether something was seen. Show one in any text with <code>%Name%</code>; change them with triggers. Built in: {BUILTIN_VARS.map(v => <code key={v}>{v}</code>)}</p>
      <div className="cv-vars">
        {course.vars.map(v => (
          <div key={v.id} className="cv-var">
            <input value={v.name} onChange={e => edit(v.id, 'name', e.target.value.replace(/[^\w]/g, ''))} aria-label="Variable name" />
            <select value={v.type} onChange={e => edit(v.id, 'type', e.target.value)} aria-label="Type"><option value="text">Text</option><option value="number">Number</option><option value="bool">True / false</option></select>
            {v.type === 'bool' ? <select value={String(v.value)} onChange={e => edit(v.id, 'value', e.target.value === 'true')} aria-label="Starts as"><option value="false">False</option><option value="true">True</option></select>
              : <input value={v.value ?? ''} onChange={e => edit(v.id, 'value', v.type === 'number' ? Number(e.target.value) || 0 : e.target.value)} aria-label="Starts as" placeholder="Starts as" />}
            <button className="rs-ib" aria-label={`Delete ${v.name}`} onClick={() => write(c => { c.vars = c.vars.filter(x => x.id !== v.id); })}>×</button>
          </div>
        ))}
      </div>
      <footer className="cv-dlg-f"><button className="btn" onClick={() => write(c => { let n = 1; while (c.vars.some(v => v.name === `Variable${n}`)) n++; c.vars.push({ id: rid('v'), name: `Variable${n}`, type: 'text', value: '' }); })}>＋ Variable</button><button className="btn primary" onClick={onClose}>Done</button></footer>
    </Modal>
  );
}
function PlayerDialog({ course, write, onClose }) {
  const p = course.player;
  const tog = k => write(c => { c.player[k] = !c.player[k]; });
  return (
    <Modal title="Player" onClose={onClose}>
      <div className="cv-form">
        <Field label="Course title" wide><input value={course.title} onChange={e => write(c => { c.title = e.target.value; })} aria-label="Course title" /></Field>
        <div className="cv-checks">
          {[['title', 'Title bar'], ['menu', 'Menu of slides'], ['freeNav', 'Learners may jump to any slide in the menu'], ['seekbar', 'Seekbar and play / pause'], ['prevNext', 'Prev and Next buttons'], ['resume', 'Offer to carry on where they left off']].map(([kk, l]) => <label key={kk}><input type="checkbox" checked={p[kk] !== false && !!p[kk]} onChange={() => tog(kk)} />{l}</label>)}
        </div>
        <div className="cv-row">
          <Color label="Accent color" value={course.accent} onChange={v => write(c => { c.accent = v === 'transparent' ? '#4f5bd5' : v; })} clear={false} />
          <Num label="Pass mark (%)" value={course.quiz.pass} min={0} onChange={v => write(c => { c.quiz.pass = Math.max(0, Math.min(100, v || 0)); })} />
        </div>
        <Field label="Size" wide><select value={`${course.size.w}x${course.size.h}`} onChange={e => { const [w, h] = e.target.value.split('x').map(Number); write(c => { c.size = { w, h }; }); }} aria-label="Slide size"><option value="960x540">16:9 (960 × 540)</option><option value="720x540">4:3 (720 × 540)</option><option value="1280x720">16:9 large (1280 × 720)</option><option value="540x960">Phone, portrait (540 × 960)</option></select></Field>
        <Field label="In an LMS, the course is complete when" wide><select value={course.complete} onChange={e => write(c => { c.complete = e.target.value; })} aria-label="Completion"><option value="viewed">Every slide has been seen</option><option value="quiz">The quiz is passed</option></select></Field>
      </div>
      <footer className="cv-dlg-f"><button className="btn primary" onClick={onClose}>Done</button></footer>
    </Modal>
  );
}
function Preview({ course, fileId, what, onClose }) {
  const html = useMemo(() => {
    let c = { ...course, id: 'preview-' + fileId };
    if (what !== 'all') {
      const sc = what.startsWith('scene:') ? course.scenes.find(s => s.id === what.slice(6)) : null;
      c = { ...c, scenes: sc ? [sc] : [{ id: 'p', name: 'Preview', slides: [findSlide(course, what)?.s].filter(Boolean) }] };
    }
    return courseHtml(c, 'preview');
  }, [course, fileId, what]);
  const [n, setN] = useState(0);
  return (
    <Modal title="Preview" onClose={onClose} wide>
      <iframe key={n} className="cv-preview" title="Course preview" srcDoc={html} sandbox="allow-scripts allow-popups" />
      <footer className="cv-dlg-f"><span className="cv-note">{what === 'all' ? 'The whole course' : what.startsWith('scene:') ? 'This scene' : 'This slide'}, as learners will see it.</span><button className="btn" onClick={() => setN(x => x + 1)}>Replay</button><button className="btn primary" onClick={onClose}>Close preview</button></footer>
    </Modal>
  );
}
