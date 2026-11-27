import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { rid } from '../lib/utils.js';
import { useUI } from './ui.jsx';
import { ObjArt, Thumb, boxStyle, defaultsOf, lookOf } from './CourseArt.jsx';
import { storyDetails, storyNote } from './CourseStudio.jsx';
import {
  ACTIONS, ANIMS, BUILTIN_VARS, EVENTS, KINDS, OPS, QTYPES, STATES, allSlides, cloneSlide, courseHtml, findSlide, interpolate,
  TRANSITIONS, appendCourse, courseFile, newCourse, newLayer, newObject, newScene, newSlide, pictureUrl, readCourse, scormZip,
} from '../lib/course.js';

/* The Course view: e-learning made of scenes and slides (see lib/course.js), laid out like a desktop authoring
   tool: a ribbon (FILE, HOME, INSERT, SLIDES, DESIGN, TRANSITIONS, ANIMATIONS, VIEW, HELP); Story View (every
   scene and its slides) and Slide View (the slide list, the slide, Timeline / States / Format / Notes below,
   Triggers and Slide Layers on the right); a status bar with the zoom. Preview runs the course; Publish gives a
   web page or a SCORM package; FILE imports and exports course files. */

const SLIDE_KINDS = [['blank', 'Blank'], ['title', 'Title slide'], ['content', 'Title and content'], ['question', 'Question'], ['result', 'Results']];
const STATE_LABEL = { normal: 'Normal', hover: 'Hover', down: 'Down', selected: 'Selected', visited: 'Visited', disabled: 'Disabled', hidden: 'Hidden' };
const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
const hex = c => (/^#[0-9a-f]{6}$/i.test(c || '') ? c : /^#[0-9a-f]{3}$/i.test(c || '') ? '#' + c.slice(1).split('').map(x => x + x).join('') : '#ffffff');
const download = (blob, name) => { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 4000); };
const safeName = t => (t || 'course').replace(/[\\/:*?"<>|]+/g, '-').slice(0, 80);

// The ribbon's big buttons: an icon over a label (with ▾ when it opens a menu).
const ICO = {
  paste: '<rect x="7" y="5" width="18" height="23" rx="2" fill="#eef1f8" stroke="#6b7591"/><rect x="11" y="3" width="10" height="5" rx="1.5" fill="#c9d0e4" stroke="#6b7591"/><rect x="14" y="13" width="14" height="16" rx="1.5" fill="#fff" stroke="#3d6fd6"/><path d="M17 18h8M17 22h8M17 26h5" stroke="#3d6fd6"/>',
  scene: '<rect x="3" y="6" width="11" height="8" rx="1.5" fill="#dfe8fb" stroke="#3d6fd6"/><rect x="18" y="6" width="11" height="8" rx="1.5" fill="#dfe8fb" stroke="#3d6fd6"/><rect x="10" y="20" width="12" height="8" rx="1.5" fill="#fff" stroke="#3d6fd6"/><path d="M8.5 14v3h15v-3M16 17v3" stroke="#6b7591"/><path d="M26 19v8M22 23h8" stroke="#17a05b" stroke-width="2"/>',
  flag: '<path d="M8 4v25" stroke="#6b7591" stroke-width="2"/><path d="M9 5h16l-4 5.5 4 5.5H9z" fill="#e5484d" stroke="#c0353a"/>',
  slide: '<rect x="3" y="6" width="22" height="16" rx="1.5" fill="#fff" stroke="#3d6fd6"/><path d="M3 10h22" stroke="#3d6fd6"/><rect x="6" y="13" width="9" height="6" fill="#dfe8fb"/><circle cx="25" cy="23" r="6" fill="#17a05b"/><path d="M25 20v6M22 23h6" stroke="#fff" stroke-width="2"/>',
  dup: '<rect x="4" y="4" width="16" height="12" rx="1.5" fill="#dfe8fb" stroke="#3d6fd6"/><rect x="11" y="13" width="17" height="13" rx="1.5" fill="#fff" stroke="#3d6fd6"/>',
  del: '<path d="M7 9h18l-1.5 18h-15z" fill="#fde2e2" stroke="#c0353a"/><path d="M5 9h22M12 9V5h8v4M13 14v9M19 14v9" stroke="#c0353a"/>',
  player: '<rect x="3" y="5" width="26" height="19" rx="2" fill="#fff" stroke="#6b7591"/><path d="M3 20h26" stroke="#6b7591"/><path d="M13 9.5l7 4-7 4z" fill="#3d6fd6"/><rect x="6" y="21.5" width="9" height="1.2" fill="#3d6fd6"/><circle cx="24" cy="26" r="4.5" fill="#f5b400" stroke="#b07d00"/>',
  preview: '<circle cx="14" cy="14" r="9" fill="#eef4ff" stroke="#3d6fd6" stroke-width="2"/><path d="M21 21l7 7" stroke="#6b7591" stroke-width="3" stroke-linecap="round"/><path d="M11.5 10l6 4-6 4z" fill="#3d6fd6"/>',
  publish: '<rect x="4" y="6" width="24" height="17" rx="2" fill="#fff" stroke="#6b7591"/><path d="M16 26V12M11 16l5-5 5 5" stroke="#17a05b" stroke-width="2.2" fill="none"/><path d="M10 29h12" stroke="#6b7591" stroke-width="2"/>',
  text: '<rect x="4" y="5" width="24" height="22" rx="2" fill="#fff" stroke="#6b7591" stroke-dasharray="3 2"/><path d="M10 10h12M16 10v13" stroke="#1f2433" stroke-width="2.6"/>',
  shape: '<rect x="3" y="12" width="14" height="14" rx="2" fill="#dfe8fb" stroke="#3d6fd6"/><circle cx="21" cy="11" r="8" fill="#ffe9b8" stroke="#d99a00"/>',
  button: '<rect x="3" y="9" width="26" height="14" rx="7" fill="#4f5bd5"/><path d="M10 16h12" stroke="#fff" stroke-width="2"/><path d="M21 19l4 8 1.5-3.5 3.5-1.5z" fill="#1f2433" stroke="#fff"/>',
  picture: '<rect x="3" y="6" width="26" height="20" rx="2" fill="#e8f3ff" stroke="#3d6fd6"/><path d="M3 22l8-8 6 6 4-4 8 8" fill="#7bc47f" stroke="#2f8a3c"/><circle cx="22" cy="12" r="3" fill="#f5b400"/>',
  hotspot: '<circle cx="16" cy="16" r="11" fill="rgba(61,111,214,.12)" stroke="#3d6fd6" stroke-dasharray="3 2.5" stroke-width="1.6"/><path d="M15 12l3 13 2-5 5-2z" fill="#1f2433" stroke="#fff"/>',
  input: '<rect x="3" y="10" width="26" height="12" rx="2" fill="#fff" stroke="#6b7591"/><path d="M8 13v6" stroke="#3d6fd6" stroke-width="2"/><path d="M12 16h10" stroke="#c3c8d8" stroke-width="2"/>',
  video: '<rect x="3" y="7" width="19" height="18" rx="2" fill="#2b2f3a"/><path d="M22 13l7-4v14l-7-4z" fill="#6b7591"/><path d="M10 12l6 4-6 4z" fill="#fff"/>',
  audio: '<path d="M6 12h5l7-6v20l-7-6H6z" fill="#dfe8fb" stroke="#3d6fd6"/><path d="M22 11a7 7 0 0 1 0 10M25 8a11 11 0 0 1 0 16" stroke="#3d6fd6" fill="none" stroke-width="1.8"/>',
  question: '<rect x="4" y="4" width="24" height="24" rx="3" fill="#fff4dc" stroke="#d99a00"/><path d="M12.5 12a3.5 3.5 0 1 1 5.5 2.9c-1.2.8-2 1.5-2 3.1" stroke="#b07d00" stroke-width="2.4" fill="none"/><circle cx="16" cy="22.5" r="1.6" fill="#b07d00"/>',
  result: '<rect x="4" y="4" width="24" height="24" rx="3" fill="#e6f6ef" stroke="#17a05b"/><path d="M9 20l4-5 4 3 6-8" stroke="#17a05b" stroke-width="2.4" fill="none"/>',
  vars: '<rect x="4" y="6" width="24" height="20" rx="2" fill="#fff" stroke="#6b7591"/><text x="16" y="21" font-size="12" font-family="monospace" font-weight="700" text-anchor="middle" fill="#7a45b8">%x%</text>',
  size: '<rect x="4" y="8" width="24" height="15" rx="1.5" fill="#fff" stroke="#3d6fd6"/><path d="M8 27h16M8 25v4M24 25v4" stroke="#6b7591"/>',
  bg: '<rect x="4" y="6" width="24" height="18" rx="2" fill="url(#g)" stroke="#6b7591"/><defs><linearGradient id="g" x1="0" x2="1"><stop offset="0" stop-color="#cfe0ff"/><stop offset="1" stop-color="#f3d9ff"/></linearGradient></defs><path d="M9 28l14-14 3 3-14 14z" fill="#f5b400" stroke="#b07d00"/>',
  theme: '<circle cx="11" cy="12" r="6" fill="#4f5bd5"/><circle cx="21" cy="12" r="6" fill="#e5484d" opacity=".85"/><circle cx="16" cy="20" r="6" fill="#17a05b" opacity=".85"/>',
  font: '<text x="16" y="23" font-size="20" font-family="Georgia,serif" font-weight="700" text-anchor="middle" fill="#1f2433">Aa</text>',
  story: '<rect x="3" y="4" width="11" height="8" rx="1.5" fill="#dfe8fb" stroke="#3d6fd6"/><rect x="18" y="4" width="11" height="8" rx="1.5" fill="#dfe8fb" stroke="#3d6fd6"/><rect x="3" y="20" width="11" height="8" rx="1.5" fill="#fff" stroke="#3d6fd6"/><rect x="18" y="20" width="11" height="8" rx="1.5" fill="#fff" stroke="#3d6fd6"/><path d="M8.5 12v8M23.5 12v8M14 8h4" stroke="#6b7591"/>',
  slideview: '<rect x="3" y="5" width="26" height="18" rx="2" fill="#fff" stroke="#3d6fd6"/><rect x="7" y="9" width="10" height="2" fill="#1f2433"/><rect x="7" y="13" width="14" height="6" fill="#dfe8fb"/><path d="M3 26h26" stroke="#6b7591" stroke-width="2"/>',
  zoomin: '<circle cx="14" cy="14" r="9" fill="#fff" stroke="#3d6fd6" stroke-width="2"/><path d="M21 21l7 7" stroke="#6b7591" stroke-width="3"/><path d="M10 14h8M14 10v8" stroke="#3d6fd6" stroke-width="2"/>',
  zoomout: '<circle cx="14" cy="14" r="9" fill="#fff" stroke="#3d6fd6" stroke-width="2"/><path d="M21 21l7 7" stroke="#6b7591" stroke-width="3"/><path d="M10 14h8" stroke="#3d6fd6" stroke-width="2"/>',
  fit: '<path d="M4 11V4h7M21 4h7v7M28 21v7h-7M11 28H4v-7" stroke="#3d6fd6" stroke-width="2.2" fill="none"/><rect x="10" y="10" width="12" height="12" rx="1.5" fill="#dfe8fb" stroke="#3d6fd6"/>',
  keys: '<rect x="3" y="9" width="26" height="15" rx="2" fill="#fff" stroke="#6b7591"/><path d="M7 13h2M11 13h2M15 13h2M19 13h2M23 13h2M7 17h2M23 17h2M11 20h10" stroke="#3d6fd6" stroke-width="2"/>',
  help: '<circle cx="16" cy="16" r="12" fill="#eef4ff" stroke="#3d6fd6" stroke-width="2"/><path d="M12.5 12.5a3.5 3.5 0 1 1 5 3.2c-1 .5-1.5 1.2-1.5 2.6" stroke="#3d6fd6" stroke-width="2.4" fill="none"/><circle cx="16" cy="22.5" r="1.5" fill="#3d6fd6"/>',
  layer: '<path d="M16 5l12 6-12 6-12-6z" fill="#dfe8fb" stroke="#3d6fd6"/><path d="M4 16l12 6 12-6M4 21l12 6 12-6" stroke="#3d6fd6" fill="none"/>',
  import: '<path d="M6 4h13l7 7v17H6z" fill="#fff" stroke="#6b7591"/><path d="M16 12v11M11 18l5 5 5-5" stroke="#3d6fd6" stroke-width="2.2" fill="none"/>',
  export: '<path d="M6 4h13l7 7v17H6z" fill="#fff" stroke="#6b7591"/><path d="M16 23V12M11 17l5-5 5 5" stroke="#17a05b" stroke-width="2.2" fill="none"/>',
};
const TR_ICON = { none: '<rect x="4" y="7" width="24" height="18" rx="2" fill="#fff" stroke="#6b7591"/><path d="M8 25L24 7" stroke="#c0353a" stroke-width="2"/>', fade: '<rect x="4" y="7" width="24" height="18" rx="2" fill="url(#f)" stroke="#6b7591"/><defs><linearGradient id="f" x1="0" x2="1"><stop offset="0" stop-color="#3d6fd6" stop-opacity=".1"/><stop offset="1" stop-color="#3d6fd6"/></linearGradient></defs>', push: '<rect x="4" y="7" width="14" height="18" fill="#dfe8fb" stroke="#3d6fd6"/><rect x="18" y="7" width="10" height="18" fill="#3d6fd6"/><path d="M8 16h6M12 13l3 3-3 3" stroke="#3d6fd6" stroke-width="1.6" fill="none"/>', pushUp: '<rect x="4" y="7" width="24" height="11" fill="#dfe8fb" stroke="#3d6fd6"/><rect x="4" y="18" width="24" height="7" fill="#3d6fd6"/>', cover: '<rect x="4" y="7" width="24" height="18" fill="#dfe8fb" stroke="#6b7591"/><rect x="4" y="7" width="15" height="18" fill="#3d6fd6"/>', zoom: '<rect x="4" y="7" width="24" height="18" rx="2" fill="#fff" stroke="#6b7591"/><rect x="11" y="12" width="10" height="8" fill="#3d6fd6"/><path d="M7 10l3 3M25 10l-3 3M7 22l3-3M25 22l-3-3" stroke="#3d6fd6"/>' };
const AN_ICON = { none: TR_ICON.none, fade: '<circle cx="16" cy="16" r="10" fill="#3d6fd6" opacity=".35"/><circle cx="16" cy="16" r="6" fill="#3d6fd6"/>', 'fly-left': '<rect x="15" y="10" width="12" height="12" rx="2" fill="#3d6fd6"/><path d="M4 16h8M9 13l3 3-3 3" stroke="#6b7591" stroke-width="2" fill="none"/>', 'fly-right': '<rect x="5" y="10" width="12" height="12" rx="2" fill="#3d6fd6"/><path d="M28 16h-8M23 13l-3 3 3 3" stroke="#6b7591" stroke-width="2" fill="none"/>', 'fly-up': '<rect x="10" y="5" width="12" height="12" rx="2" fill="#3d6fd6"/><path d="M16 28v-8M13 23l3-3 3 3" stroke="#6b7591" stroke-width="2" fill="none"/>', 'fly-down': '<rect x="10" y="15" width="12" height="12" rx="2" fill="#3d6fd6"/><path d="M16 4v8M13 9l3 3 3-3" stroke="#6b7591" stroke-width="2" fill="none"/>', zoom: '<rect x="11" y="11" width="10" height="10" rx="2" fill="#3d6fd6"/><rect x="6" y="6" width="20" height="20" rx="3" fill="none" stroke="#3d6fd6" stroke-dasharray="3 2"/>', spin: '<rect x="10" y="10" width="12" height="12" rx="2" fill="#3d6fd6" transform="rotate(25 16 16)"/><path d="M6 12a11 11 0 0 1 16-6" stroke="#6b7591" stroke-width="2" fill="none"/>', bounce: '<circle cx="16" cy="9" r="5" fill="#3d6fd6"/><path d="M6 27h20M12 21q4-6 8 0" stroke="#6b7591" stroke-width="2" fill="none"/>' };
const Svg = ({ d, s = 32 }) => <svg viewBox="0 0 32 32" width={s} height={s} fill="none" strokeWidth="1.4" aria-hidden="true" dangerouslySetInnerHTML={{ __html: d }} />;
function Big({ icon, label, onClick, menu, on, disabled, small }) {
  return (
    <button type="button" className={'sl-big' + (on ? ' on' : '') + (small ? ' small' : '')} onClick={e => onClick?.(e.currentTarget)} disabled={disabled} aria-haspopup={menu ? 'menu' : undefined} aria-pressed={on === undefined ? undefined : !!on}>
      <Svg d={icon} s={small ? 20 : 26} />
      <span>{label}{menu && <i aria-hidden="true"> ▾</i>}</span>
    </button>
  );
}
const Group = ({ label, children }) => <div className="sl-group" role="group" aria-label={label}><div className="sl-gbody">{children}</div><span className="sl-glabel">{label}</span></div>;
const TABS = ['HOME', 'INSERT', 'SLIDES', 'DESIGN', 'TRANSITIONS', 'ANIMATIONS', 'VIEW', 'HELP'];
const readPref = (k, d) => { try { return localStorage.getItem(k) || d; } catch (e) { return d; } };
const savePref = (k, v) => { try { localStorage.setItem(k, v); } catch (e) { /* private window */ } };

export default function CourseView({ file, update, visible = true }) {
  const { popup, ask, toast } = useUI();
  const course = file.course;
  useEffect(() => { if (!file.course) update(c => { c.course = newCourse(c.title || 'Course'); }); }, [file.course, update]);

  const [mode, setMode] = useState(() => readPref('linework:course-mode', 'story')); // 'story' | 'slide'
  const [ribbon, setRibbon] = useState('HOME');
  const [slideId, setSlideId] = useState(null);
  const [layerId, setLayerId] = useState(null);
  const [sel, setSel] = useState(null);
  const [bottom, setBottom] = useState('timeline'); // timeline | states | format | notes
  const [editState, setEditState] = useState('normal');
  const [editing, setEditing] = useState(null);
  const [openTrig, setOpenTrig] = useState(null);
  const [dialog, setDialog] = useState(null); // 'vars' | 'player' | 'keys' | {preview}
  const [storyZoom, setStoryZoom] = useState(100);
  const [zoom, setZoom] = useState(0); // the slide's zoom (0: fit)
  const undo = useRef([]), redo = useRef([]);
  const picRef = useRef(null), picFor = useRef(null), importRef = useRef(null);
  const go = m => { setMode(m); savePref('linework:course-mode', m); };
  // The ribbon can fold down to its tabs, and each panel can be hidden (kept for next time).
  const [ribbonOpen, setRibbonOpen] = useState(() => readPref('linework:course-ribbon', 'open') === 'open');
  const foldRibbon = v => { setRibbonOpen(v); savePref('linework:course-ribbon', v ? 'open' : 'closed'); };
  const [panels, setPanels] = useState(() => { try { return { slides: true, right: true, bottom: true, ...JSON.parse(readPref('linework:course-panels', '{}')) }; } catch (e) { return { slides: true, right: true, bottom: true }; } });
  const togglePanel = (key, v) => setPanels(p => { const n = { ...p, [key]: v ?? !p[key] }; savePref('linework:course-panels', JSON.stringify(n)); return n; });
  const focusMode = !panels.slides && !panels.right && !panels.bottom;
  const setFocus = on => setPanels(() => { const n = { slides: !on, right: !on, bottom: !on }; savePref('linework:course-panels', JSON.stringify(n)); return n; });

  const flat = course ? allSlides(course) : [];
  const here = course && (findSlide(course, slideId) || flat[0]);
  const slide = here?.s;
  const layer = slide && (slide.layers.find(l => l.id === layerId) || slide.layers[0]);
  const obj = layer && sel ? (layer.objects.find(o => o.id === sel) || null) : null;
  useEffect(() => { if (obj?.id !== sel) setSel(obj?.id || null); setEditState('normal'); }, [slide?.id, layer?.id]); // eslint-disable-line

  // A change to the course: one step to undo. (The snapshot is taken here: React may run an updater twice.)
  const now = useRef(course); now.current = course;
  const write = useCallback(fn => {
    if (now.current) { undo.current.push(JSON.stringify(now.current)); if (undo.current.length > 60) undo.current.shift(); }
    redo.current = [];
    update(c => { if (!c.course) c.course = newCourse(c.title); fn(c.course); });
  }, [update]);
  const back = (from, to) => { const s = from.current.pop(); if (!s) return; to.current.push(JSON.stringify(now.current)); now.current = JSON.parse(s); update(c => { c.course = JSON.parse(s); }); };
  const inSlide = (c, id = slide.id) => findSlide(c, id)?.s;
  const inLayer = (c, sid = slide.id, lid = layer.id) => inSlide(c, sid)?.layers.find(l => l.id === lid);
  const inObj = (c, id = sel) => inLayer(c)?.objects.find(o => o.id === id);
  const editObj = fn => write(c => { const o = inObj(c); if (o) fn(o); });
  const setLook = (k, v) => editObj(o => {
    const t = editState === 'normal' ? (o.style ||= {}) : ((o.states ||= {})[editState] ||= {});
    if (v === undefined) delete t[k]; else t[k] = v;
    // Imported rich text: a change of size, color or weight applies to all of it.
    const RUN = { size: 'size', color: 'color', bold: 'bold', italic: 'italic' }[k];
    for (const rich of [editState === 'normal' ? o.rich : t.rich]) if (Array.isArray(rich)) for (const b of rich) { if (k === 'align') b.align = v; if (RUN) for (const r of b.spans) { delete r[RUN]; if (k === 'bold') delete r.weight; } }
  });
  const openSlide = id => { setSlideId(id); setLayerId(null); setSel(null); go('slide'); };

  /* ---- inserting ---- */
  const insert = (kind, extra = {}) => {
    if (mode !== 'slide') go('slide');
    const o = newObject(kind, extra);
    write(c => { inLayer(c).objects.push(o); });
    setSel(o.id); setBottom('format');
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
    const url = await ask({ title: kind === 'video' ? 'Video link' : 'Audio link', text: 'A link to an .mp4 / .webm / .mp3 file on the web.', value: 'https://', ok: 'Insert' });
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
  const addScene = () => { const sc = newScene(`Scene ${course.scenes.length + 1}`, [newSlide('Untitled slide', 'blank')]); write(c => { c.scenes.push(sc); }); setSlideId(sc.slides[0].id); };
  const dupSlide = x => { const n = cloneSlide(x.s); n.title += ' copy'; write(c => { const sc = c.scenes.find(s => s.id === x.sc.id); sc.slides.splice(sc.slides.findIndex(s => s.id === x.s.id) + 1, 0, n); }); setSlideId(n.id); };
  const delSlide = x => { if (flat.length <= 1) return toast('A course needs at least one slide.'); write(c => { const sc = c.scenes.find(s => s.id === x.sc.id); sc.slides = sc.slides.filter(s => s.id !== x.s.id); c.scenes = c.scenes.filter(s => s.slides.length); if (c.start && !c.scenes.some(s => s.id === c.start)) delete c.start; }); setSlideId(null); };

  /* ---- clipboard, keys ---- */
  const clip = useRef(null);
  const copyObj = () => { if (obj) { clip.current = JSON.stringify(obj); toast('Copied'); } };
  const cutObj = () => { if (!obj) return; clip.current = JSON.stringify(obj); write(c => { const l = inLayer(c); l.objects = l.objects.filter(o => o.id !== obj.id); }); setSel(null); };
  const pasteObj = () => { if (!clip.current) return toast('Copy or cut an object first.'); if (mode !== 'slide') go('slide'); const o = { ...JSON.parse(clip.current), id: rid('o') }; o.x += 20; o.y += 20; write(c => { inLayer(c).objects.push(o); }); setSel(o.id); };
  const duplicate = o => { const n = { ...JSON.parse(JSON.stringify(o)), id: rid('o'), x: o.x + 20, y: o.y + 20, name: o.name + ' copy' }; write(c => { inLayer(c).objects.push(n); }); setSel(n.id); };
  useEffect(() => {
    if (!visible || !course) return undefined;
    const key = e => {
      if (e.target.closest?.('input,textarea,select,[contenteditable="true"]') || document.querySelector('.modal,.menu')) return;
      const mod = e.ctrlKey || e.metaKey, k = e.key.toLowerCase();
      if (mod && k === 'z') { e.preventDefault(); e.shiftKey ? back(redo, undo) : back(undo, redo); return; }
      if (mod && k === 'y') { e.preventDefault(); back(redo, undo); return; }
      if (e.key === 'F12') { e.preventDefault(); setDialog({ preview: 'all' }); return; }
      if (mode === 'story') {
        if (e.key === 'Enter' && slide) { e.preventDefault(); openSlide(slide.id); }
        if (e.key === 'Delete' && slide) { e.preventDefault(); delSlide(here); }
        return;
      }
      if (mod && k === 'v') { e.preventDefault(); pasteObj(); return; }
      if (!obj) return;
      if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); write(c => { const l = inLayer(c); l.objects = l.objects.filter(o => o.id !== obj.id); }); setSel(null); }
      else if (e.key.startsWith('Arrow')) {
        e.preventDefault(); const d = e.shiftKey ? 10 : 1;
        editObj(o => { if (e.key === 'ArrowLeft') o.x -= d; if (e.key === 'ArrowRight') o.x += d; if (e.key === 'ArrowUp') o.y -= d; if (e.key === 'ArrowDown') o.y += d; });
      } else if (mod && k === 'd') { e.preventDefault(); duplicate(obj); }
      else if (mod && k === 'c') copyObj();
      else if (mod && k === 'x') { e.preventDefault(); cutObj(); }
    };
    addEventListener('keydown', key);
    return () => removeEventListener('keydown', key);
  });

  /* ---- the stage ---- */
  const holder = useRef(null);
  const [fitK, setFitK] = useState(0.6);
  useLayoutEffect(() => {
    const el = holder.current; if (!el || !course) return undefined;
    const fit = () => { const r = el.getBoundingClientRect(); if (r.width && r.height) setFitK(Math.max(0.15, Math.min((r.width - 24) / course.size.w, (r.height - 20) / course.size.h, 2))); };
    fit(); const ro = new ResizeObserver(fit); ro.observe(el); return () => ro.disconnect();
  }, [course?.size?.w, course?.size?.h, visible, mode, panels.slides, panels.right, panels.bottom, ribbonOpen]); // eslint-disable-line
  const k = zoom ? zoom / 100 : fitK;
  const drag = (e, o, how) => {
    e.stopPropagation(); e.preventDefault();
    setSel(o.id);
    if (editing) return;
    const sx = e.clientX, sy = e.clientY, start = { x: o.x, y: o.y, w: o.w, h: o.h };
    let moved = false, snap = null;
    const box = e.currentTarget.closest('.cv-o');
    const mv = m => {
      const dx = (m.clientX - sx) / k, dy = (m.clientY - sy) / k;
      if (!moved && Math.abs(dx) + Math.abs(dy) < 2) return;
      moved = true;
      const g = m.altKey ? 1 : 5, r = v => Math.round(v / g) * g;
      snap = { ...start };
      if (how === 'move') { snap.x = r(start.x + dx); snap.y = r(start.y + dy); }
      if (how.includes('e')) snap.w = Math.max(10, r(start.w + dx));
      if (how.includes('s')) snap.h = Math.max(10, r(start.h + dy));
      if (how.includes('w')) { snap.w = Math.max(10, r(start.w - dx)); snap.x = start.x + start.w - snap.w; }
      if (how.includes('n')) { snap.h = Math.max(10, r(start.h - dy)); snap.y = start.y + start.h - snap.h; }
      Object.assign(box.style, { left: snap.x + 'px', top: snap.y + 'px', width: snap.w + 'px', height: snap.h + 'px' });
    };
    const up = () => { removeEventListener('pointermove', mv); removeEventListener('pointerup', up); if (moved && snap) editObj(x => { if (x.id === o.id) Object.assign(x, snap); }); };
    addEventListener('pointermove', mv); addEventListener('pointerup', up);
  };

  if (!course || !slide) return <div className="cv"><p className="muted" style={{ padding: 20 }}>Making the course…</p></div>;
  const vars = defaultsOf(course);
  const baseUnder = layer !== slide.layers[0];
  const lookState = o => (o.id === sel ? editState : 'normal');
  const sceneNo = course.scenes.findIndex(sc => sc.id === here.sc.id) + 1;

  /* ---- files: import, export, publish ---- */
  const exportFile = () => download(new Blob([courseFile(course)], { type: 'application/json' }), safeName(course.title) + '.course.json');
  const importInto = async (f, how) => {
    if (!f) return;
    try {
      const { imported, ...c } = await readCourse(f);
      if (how === 'replace') { write(x => { Object.keys(x).forEach(key => delete x[key]); Object.assign(x, c); if (imported) { x.importNote = storyNote(imported); x.importDetails = storyDetails(imported); } }); setSlideId(null); if (!imported) toast(`Opened “${c.title}”`); }
      else { const n = c.scenes.reduce((a, sc) => a + sc.slides.length, 0); write(x => { appendCourse(x, c); if (imported) { x.importNote = storyNote(imported); x.importDetails = storyDetails(imported); } }); if (!imported) toast(`Added ${n} slide${n === 1 ? '' : 's'} from “${c.title}”`); }
    } catch (e) { toast(e.message || 'That file couldn’t be opened.'); }
  };
  const pickImport = how => { importRef.current.dataset.how = how; importRef.current.click(); };
  const fileMenu = btn => popup(btn, [
    { label: 'Import slides…', note: 'From a Storyline .story or published zip, a course file, a page or a SCORM zip', act: () => pickImport('append') },
    { label: 'Open a course over this one…', note: 'Replace this course with one from a file', act: () => pickImport('replace') },
    { label: 'Export course file (.course.json)', note: 'Everything, to open again here or share', act: exportFile },
    '-',
    { label: 'Publish: web page (.html)', act: () => download(new Blob([courseHtml({ ...course, id: file.id }, 'web')], { type: 'text/html' }), safeName(course.title) + '.html') },
    { label: 'Publish: SCORM 1.2 (.zip)', note: 'For an LMS: completion, score, resume', act: async () => download(await scormZip({ ...course, id: file.id }), safeName(course.title) + '-scorm.zip') },
    '-',
    { label: 'Player…', act: () => setDialog('player') },
    { label: 'Variables…', act: () => setDialog('vars') },
  ]);
  const publish = btn => popup(btn, [
    { label: 'Web page (.html)', note: 'One file: put it on any website, or open it', act: () => download(new Blob([courseHtml({ ...course, id: file.id }, 'web')], { type: 'text/html' }), safeName(course.title) + '.html') },
    { label: 'SCORM 1.2 package (.zip)', note: 'For an LMS (Moodle, TalentLMS, Docebo…): completion, score, resume', act: async () => download(await scormZip({ ...course, id: file.id }), safeName(course.title) + '-scorm.zip') },
    { label: 'Course file (.course.json)', note: 'To open again in Workline', act: exportFile },
  ]);
  const previewMenu = btn => popup(btn, [{ label: 'This slide', act: () => setDialog({ preview: slide.id }) }, { label: 'This scene', act: () => setDialog({ preview: 'scene:' + here.sc.id }) }, { label: 'Entire project', act: () => setDialog({ preview: 'all' }) }]);
  const slideMenu = (btn, x) => popup(btn, [
    { label: 'Open in slide view', act: () => openSlide(x.s.id) },
    { label: 'Duplicate', act: () => dupSlide(x) },
    { label: 'Rename', act: async () => { const v = await ask({ title: 'Rename slide', value: x.s.title, ok: 'Rename' }); if (v?.trim()) write(c => { inSlide(c, x.s.id).title = v.trim(); }); } },
    { label: 'Move up', act: () => write(c => { const sc = c.scenes.find(s => s.id === x.sc.id), i = sc.slides.findIndex(s => s.id === x.s.id); if (i > 0) [sc.slides[i - 1], sc.slides[i]] = [sc.slides[i], sc.slides[i - 1]]; }) },
    { label: 'Move down', act: () => write(c => { const sc = c.scenes.find(s => s.id === x.sc.id), i = sc.slides.findIndex(s => s.id === x.s.id); if (i < sc.slides.length - 1) [sc.slides[i + 1], sc.slides[i]] = [sc.slides[i], sc.slides[i + 1]]; }) },
    ...(course.scenes.length > 1 ? [{ label: 'Move to scene', items: course.scenes.filter(s => s.id !== x.sc.id).map(s => ({ label: s.name, act: () => write(c => { const from = c.scenes.find(z => z.id === x.sc.id), to = c.scenes.find(z => z.id === s.id); const [m] = from.slides.splice(from.slides.findIndex(z => z.id === x.s.id), 1); to.slides.push(m); c.scenes = c.scenes.filter(z => z.slides.length); }) })) }] : []),
    { label: 'Preview this slide', act: () => setDialog({ preview: x.s.id }) },
    { label: 'Delete', danger: true, act: () => delSlide(x) },
  ]);
  const sceneMenu = (btn, sc) => popup(btn, [
    { label: 'New slide here', items: SLIDE_KINDS.map(([kd, l]) => ({ label: l, act: () => addSlide(kd, sc.id) })) },
    { label: course.start === sc.id || (!course.start && course.scenes[0].id === sc.id) ? '✓ Starting scene' : 'Make it the starting scene', act: () => write(c => { c.start = sc.id; }) },
    { label: 'Rename scene', act: async () => { const v = await ask({ title: 'Rename scene', value: sc.name, ok: 'Rename' }); if (v?.trim()) write(c => { c.scenes.find(s => s.id === sc.id).name = v.trim(); }); } },
    { label: 'Preview this scene', act: () => setDialog({ preview: 'scene:' + sc.id }) },
    { label: 'Delete scene', danger: true, act: async () => { if (course.scenes.length <= 1) return toast('A course needs at least one scene.'); if (await ask({ title: `Delete “${sc.name}”?`, text: `Its ${sc.slides.length} slide${sc.slides.length === 1 ? '' : 's'} go too.`, input: false, ok: 'Delete' })) { write(c => { c.scenes = c.scenes.filter(s => s.id !== sc.id); if (c.start === sc.id) delete c.start; }); setSlideId(null); } } },
  ]);
  const startScene = course.start && course.scenes.some(s => s.id === course.start) ? course.start : course.scenes[0].id;
  const shapeMenu = btn => popup(btn, [['Rectangle', {}], ['Rounded', { radius: 24 }], ['Oval', { shape: 'ellipse' }], ['Circle', { shape: 'ellipse' }, 160]].map(([l, x, d]) => ({ label: l, act: () => insert('shape', { name: l, ...(d ? { w: d, h: d } : {}), style: { ...newObject('shape').style, ...x } }) })));
  const questionMenu = btn => popup(btn, QTYPES.map(([t, l]) => ({ label: l, act: () => { const o = newObject('question'); o.q.type = t; if (t === 'tf') o.q.choices = [{ id: rid('c'), text: 'True', correct: true }, { id: rid('c'), text: 'False', correct: false }]; if (t === 'fill') { o.q.answer = 'answer'; o.q.choices = []; } insert('question', { q: o.q }); } })));
  const newSlideMenu = btn => popup(btn, SLIDE_KINDS.map(([kd, l]) => ({ label: l, act: () => addSlide(kd) })));
  const setSlideProp = (key, v) => write(c => { inSlide(c)[key] = v; });

  /* ---- the ribbon ---- */
  const ribbonBody = {
    HOME: <>
      <Group label="Clipboard"><Big icon={ICO.paste} label="Paste" onClick={pasteObj} /><div className="sl-col"><button className="sl-sm" onClick={cutObj} disabled={!obj}>✂ Cut</button><button className="sl-sm" onClick={copyObj} disabled={!obj}>⧉ Copy</button></div></Group>
      <Group label="Scenes"><Big icon={ICO.scene} label="New Scene" onClick={addScene} /><Big icon={ICO.flag} label="Starting Scene" on={false} onClick={btn => popup(btn, course.scenes.map(sc => ({ label: (sc.id === startScene ? '✓ ' : '') + sc.name, act: () => write(c => { c.start = sc.id; }) })))} menu /></Group>
      <Group label="Slide"><Big icon={ICO.slide} label="New Slide" onClick={newSlideMenu} menu /><div className="sl-col"><button className="sl-sm" onClick={() => dupSlide(here)}>⧉ Duplicate</button><button className="sl-sm" onClick={() => delSlide(here)}>🗑 Delete</button></div></Group>
      <Group label="Triggers"><Big icon={ICO.vars} label="Variables" onClick={() => setDialog('vars')} /></Group>
      <Group label="Publish"><Big icon={ICO.player} label="Player" onClick={() => setDialog('player')} /><Big icon={ICO.preview} label="Preview" onClick={previewMenu} menu /><Big icon={ICO.publish} label="Publish" onClick={publish} menu /></Group>
    </>,
    INSERT: <>
      <Group label="Text"><Big icon={ICO.text} label="Text Box" onClick={() => insert('text')} /></Group>
      <Group label="Objects"><Big icon={ICO.shape} label="Shape" onClick={shapeMenu} menu /><Big icon={ICO.button} label="Button" onClick={() => insert('button')} /><Big icon={ICO.hotspot} label="Hotspot" onClick={() => insert('hotspot')} /><Big icon={ICO.input} label="Text Entry" onClick={() => insert('input')} /></Group>
      <Group label="Media"><Big icon={ICO.picture} label="Picture" onClick={() => { picFor.current = null; picRef.current?.click(); }} /><Big icon={ICO.video} label="Video" onClick={() => insertMedia('video')} /><Big icon={ICO.audio} label="Audio" onClick={() => insertMedia('audio')} /></Group>
      <Group label="Quiz"><Big icon={ICO.question} label="Question" onClick={questionMenu} menu /><Big icon={ICO.result} label="Result" onClick={() => insert('result')} /></Group>
    </>,
    SLIDES: <>
      <Group label="Slides"><Big icon={ICO.slide} label="New Slide" onClick={newSlideMenu} menu /><Big icon={ICO.question} label="Question Slide" onClick={() => addSlide('question')} /><Big icon={ICO.result} label="Results Slide" onClick={() => addSlide('result')} /></Group>
      <Group label="Edit"><Big icon={ICO.dup} label="Duplicate" onClick={() => dupSlide(here)} /><Big icon={ICO.del} label="Delete" onClick={() => delSlide(here)} /><Big icon={ICO.layer} label="New Layer" onClick={() => { go('slide'); const l = newLayer(`Layer ${slide.layers.length}`); write(c => { inSlide(c).layers.push(l); }); setLayerId(l.id); setSel(null); }} /></Group>
      <Group label="Import & export"><Big icon={ICO.import} label="Import" onClick={btn => popup(btn, [{ label: 'Import slides…', act: () => pickImport('append') }, { label: 'Open a course over this one…', act: () => pickImport('replace') }])} menu /><Big icon={ICO.export} label="Export" onClick={exportFile} /></Group>
    </>,
    DESIGN: <>
      <Group label="Setup"><Big icon={ICO.size} label="Slide Size" onClick={btn => popup(btn, [['960x540', '16:9 (960 × 540)'], ['720x540', '4:3 (720 × 540)'], ['1280x720', '16:9 large (1280 × 720)'], ['1920x1080', 'Full HD (1920 × 1080)'], ['540x960', 'Phone, portrait (540 × 960)']].map(([v, l]) => ({ label: (v === `${course.size.w}x${course.size.h}` ? '✓ ' : '') + l, act: () => { const [w, h] = v.split('x').map(Number); write(c => { c.size = { w, h }; }); } })))} menu /></Group>
      <Group label="Background"><label className="sl-colorbig"><Svg d={ICO.bg} /><span>Slide color</span><input type="color" value={hex(slide.bg)} onChange={e => setSlideProp('bg', e.target.value)} aria-label="Slide background color" /></label><Big icon={ICO.dup} label="Apply to All" onClick={() => write(c => { allSlides(c).forEach(x => { x.s.bg = slide.bg; }); })} /></Group>
      <Group label="Theme"><label className="sl-colorbig"><Svg d={ICO.theme} /><span>Accent</span><input type="color" value={hex(course.accent)} onChange={e => write(c => { c.accent = e.target.value; })} aria-label="Accent color" /></label>
        <Big icon={ICO.font} label="Fonts" onClick={btn => popup(btn, [['Inter, system-ui, sans-serif', 'Inter'], ['Georgia, serif', 'Georgia'], ['"Trebuchet MS", sans-serif', 'Trebuchet'], ['"Segoe UI", Roboto, sans-serif', 'Segoe UI'], ['"Courier New", monospace', 'Courier']].map(([v, l]) => ({ label: (course.font === v ? '✓ ' : '') + l, act: () => write(c => { c.font = v; }) })))} menu /></Group>
    </>,
    TRANSITIONS: <>
      <Group label="Transition to This Slide"><div className="sl-gallery">{TRANSITIONS.map(([v, l]) => <Big key={v} small icon={TR_ICON[v]} label={l} on={(slide.transition?.type || 'none') === v} onClick={() => setSlideProp('transition', { type: v, dur: slide.transition?.dur || 0.6 })} />)}</div></Group>
      <Group label="Timing"><label className="sl-field">Duration (s)<input type="number" step="0.1" min="0.1" value={slide.transition?.dur || 0.6} onChange={e => setSlideProp('transition', { type: slide.transition?.type || 'fade', dur: Number(e.target.value) || 0.6 })} aria-label="Transition duration" /></label><Big icon={ICO.dup} label="Apply to All" onClick={() => write(c => { allSlides(c).forEach(x => { x.s.transition = { ...(slide.transition || { type: 'none' }) }; }); toast('Applied to every slide'); })} /></Group>
    </>,
    ANIMATIONS: obj ? <>
      <Group label={`Entrance: ${obj.name}`}><div className="sl-gallery">{ANIMS.map(([v, l]) => <Big key={v} small icon={AN_ICON[v]} label={l} on={(obj.anim || 'none') === v} onClick={() => editObj(o => { o.anim = v; })} />)}</div></Group>
      <Group label="Timing"><label className="sl-field">Start (s)<input type="number" step="0.25" min="0" value={obj.start || 0} onChange={e => editObj(o => { o.start = Math.max(0, Number(e.target.value) || 0); })} aria-label="Animation start" /></label><label className="sl-field">Shown for (s)<input type="number" step="0.25" min="0" value={obj.dur ?? ''} placeholder="to the end" onChange={e => editObj(o => { o.dur = Number(e.target.value) || null; })} aria-label="Shown for" /></label></Group>
    </> : <p className="sl-hint">Select an object on a slide to give it an entrance animation.</p>,
    VIEW: <>
      <Group label="Views"><Big icon={ICO.story} label="Story View" on={mode === 'story'} onClick={() => go('story')} /><Big icon={ICO.slideview} label="Slide View" on={mode === 'slide'} onClick={() => go('slide')} /></Group>
      <Group label="Panels">
        <Big small icon={ICO.slideview} label="Slides" on={panels.slides} onClick={() => togglePanel('slides')} />
        <Big small icon={ICO.layer} label="Triggers & Layers" on={panels.right} onClick={() => togglePanel('right')} />
        <Big small icon={ICO.keys} label="Timeline & Format" on={panels.bottom} onClick={() => togglePanel('bottom')} />
        <Big small icon={ICO.fit} label="Focus" on={focusMode} onClick={() => setFocus(!focusMode)} />
      </Group>
      <Group label="Zoom"><Big icon={ICO.zoomin} label="Zoom In" onClick={() => (mode === 'story' ? setStoryZoom(z => Math.min(200, z + 10)) : setZoom(z => Math.min(300, (z || Math.round(fitK * 100)) + 10)))} /><Big icon={ICO.zoomout} label="Zoom Out" onClick={() => (mode === 'story' ? setStoryZoom(z => Math.max(40, z - 10)) : setZoom(z => Math.max(15, (z || Math.round(fitK * 100)) - 10)))} /><Big icon={ICO.fit} label="Fit" onClick={() => (mode === 'story' ? setStoryZoom(100) : setZoom(0))} /></Group>
    </>,
    HELP: <>
      <Group label="Help"><Big icon={ICO.keys} label="Shortcuts" onClick={() => setDialog('keys')} /><Big icon={ICO.help} label="How It Works" onClick={() => setDialog('help')} /></Group>
    </>,
  };

  /* ---- views ---- */
  const storyView = (
    <div className="sl-story" style={{ '--z': storyZoom / 100 }} onPointerDown={e => { if (e.target === e.currentTarget) setSlideId(slide.id); }}>
      {course.scenes.map((sc, si) => (
        <section key={sc.id} className={'sl-scene' + (sc.id === here.sc.id ? ' on' : '')} aria-label={`Scene ${si + 1}: ${sc.name}`}>
          <header>{sc.id === startScene && <Svg d={ICO.flag} s={16} />}<b>{si + 1} {sc.name}</b><button aria-label={`Actions for scene ${sc.name}`} onClick={e => sceneMenu(e.currentTarget, sc)}>▾</button></header>
          <div className="sl-scene-body">
            {sc.slides.map((s, i) => {
              const jumps = s.layers.some(l => l.triggers.some(t => t.action === 'jump' && !['next', 'prev'].includes(t.target)));
              return (
                <div key={s.id} className="sl-node">
                  <button className={'sl-card' + (s.id === slide.id ? ' on' : '')} aria-label={`Slide ${si + 1}.${i + 1}: ${s.title}`} onClick={() => setSlideId(s.id)} onDoubleClick={() => openSlide(s.id)} onContextMenu={e => { e.preventDefault(); slideMenu(e.currentTarget, { s, sc }); }}>
                    <Thumb slide={s} course={course} />
                    <span>{si + 1}.{i + 1} {s.title}</span>
                    {jumps && <i className="sl-jump" title="Has triggers that jump to other slides">↪</i>}
                  </button>
                  {i < sc.slides.length - 1 && <span className="sl-arrow" aria-hidden="true">↓</span>}
                </div>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
  const slideList = (
    <aside className="cv-slides" aria-label="Slides">
      {course.scenes.map((sc, si) => (
        <section key={sc.id} className="cv-scene">
          <header><b>{si + 1} {sc.name}</b><button className="rs-ib" aria-label={`Actions for scene ${sc.name}`} onClick={e => sceneMenu(e.currentTarget, sc)}>⋯</button></header>
          {sc.slides.map((s, i) => (
            <div key={s.id} className={'cv-sl' + (s.id === slide.id ? ' on' : '')}>
              <button className="cv-sl-b" aria-label={`Slide ${si + 1}.${i + 1}: ${s.title}`} aria-current={s.id === slide.id ? 'true' : undefined} onClick={() => { setSlideId(s.id); setLayerId(null); setSel(null); }}>
                <i>{si + 1}.{i + 1}</i><Thumb slide={s} course={course} /><span>{s.title}</span>
              </button>
              <button className="cv-sl-m" aria-label={`Actions for slide ${s.title}`} onClick={e => slideMenu(e.currentTarget, { s, sc })}>⋯</button>
            </div>
          ))}
        </section>
      ))}
    </aside>
  );
  const stage = (
    <div className="cv-center">
      {editState !== 'normal' && obj && <div className="cv-stbar">Editing the <b>{STATE_LABEL[editState] || editState}</b> state of “{obj.name}”: Format changes apply to this state only.<button className="btn" onClick={() => setEditState('normal')}>Done</button></div>}
      <div className={'cv-holder' + (zoom ? ' zoomed' : '')} ref={holder} onPointerDown={() => { setSel(null); setEditing(null); }}>
        <div className="cv-stage-box" style={{ width: course.size.w * k, height: course.size.h * k }}>
          <div className="cv-stage" style={{ width: course.size.w, height: course.size.h, transform: `scale(${k})`, background: slide.bg, fontFamily: course.font }} aria-label={`Slide: ${slide.title}`} role="region">
            {baseUnder && <div className="cv-under">{slide.layers[0].objects.map(o => <div key={o.id} className={'cv-o k-' + o.kind} style={boxStyle(o, lookOf(o))}><ObjArt o={o} vars={vars} assets={course.assets} /></div>)}</div>}
            {layer.objects.map(o => {
              const st = lookState(o), s = lookOf(o, st);
              return (
                <div key={o.id} className={'cv-o k-' + o.kind + (o.id === sel ? ' sel' : '') + (o.initial === 'hidden' && st === 'normal' ? ' ghost' : '')} style={boxStyle(o, s)}
                  data-name={o.name} onPointerDown={e => drag(e, o, 'move')} onDoubleClick={() => ['text', 'shape', 'button', 'result'].includes(o.kind) && setEditing(o.id)}>
                  {editing === o.id
                    ? <textarea className="cv-edit" autoFocus defaultValue={s.text != null ? s.text : o.text} aria-label="Edit the text" style={{ textAlign: s.align, color: s.color, fontSize: s.size, fontWeight: s.bold ? 700 : 400 }}
                      onPointerDown={e => e.stopPropagation()} onKeyDown={e => { if (e.key === 'Escape') e.currentTarget.blur(); }}
                      onBlur={e => { const v = e.target.value.replace(/\r\n?/g, '\n'); setEditing(null); editObj(x => { if (editState === 'normal') { if (v !== x.text) { x.text = v; delete x.rich; } } else { const st = ((x.states ||= {})[editState] ||= {}); if (v !== st.text) { st.text = v; delete st.rich; } } }); }} />
                    : <ObjArt o={o} st={st} vars={vars} assets={course.assets} />}
                  {o.id === sel && !editing && ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'].map(h => <i key={h} className={'cv-h h-' + h} onPointerDown={e => drag(e, o, h)} />)}
                </div>
              );
            })}
          </div>
        </div>
      </div>
      {panels.bottom && <div className="sl-bottom">
        <div className="sl-btabs" role="tablist" aria-label="Slide panels">
          {[['timeline', 'Timeline'], ['states', 'States'], ['format', 'Format'], ['notes', 'Notes']].map(([t, l]) => <button key={t} role="tab" aria-selected={bottom === t} className={bottom === t ? 'on' : ''} onClick={() => setBottom(t)}>{l}</button>)}
          <span className="sl-btabs-sp">{obj ? `${KINDS[obj.kind]}: ${obj.name}` : `Slide: ${slide.title}`}</span>
          <button className="sl-x" aria-label="Hide the Timeline panel" title="Hide this panel" onClick={() => togglePanel('bottom', false)}>×</button>
        </div>
        <div className="sl-bbody">
          {bottom === 'timeline' && <Timeline slide={slide} layer={layer} sel={sel} setSel={setSel} write={write} inLayer={inLayer} inSlide={inSlide} />}
          {bottom === 'states' && <States o={obj} editState={editState} setEditState={setEditState} editObj={editObj} />}
          {bottom === 'format' && (obj ? <ObjFormat o={obj} course={course} layer={layer} editState={editState} setLook={setLook} editObj={editObj} write={write} inLayer={inLayer} setSel={setSel} duplicate={duplicate}
            onPicture={() => { picFor.current = obj.id; picRef.current?.click(); }} onTrigger={() => { const t = { id: rid('t'), event: 'click', source: obj.id, action: 'jump', target: 'next', conds: [] }; write(c => { inLayer(c).triggers.push(t); }); setOpenTrig(t.id); togglePanel('right', true); }} />
            : <SlideFormat slide={slide} write={write} inSlide={inSlide} />)}
          {bottom === 'notes' && <textarea className="sl-notes" value={slide.notes || ''} onChange={e => setSlideProp('notes', e.target.value)} aria-label="Slide notes" placeholder="Notes for this slide (not shown to learners)" />}
        </div>
      </div>}
    </div>
  );
  const layersPane = (
    <section className="sl-pane sl-layers" aria-label="Slide Layers">
      <header><h4>Slide Layers</h4><button className="sl-ico" title="New layer" aria-label="New layer" onClick={() => { const l = newLayer(`Layer ${slide.layers.length}`); write(c => { inSlide(c).layers.push(l); }); setLayerId(l.id); setSel(null); }}>＋</button></header>
      <div className="sl-plist" role="tablist" aria-label="Layers">
        {[...slide.layers].reverse().map(l => {
          const base = l === slide.layers[0];
          return (
            <div key={l.id} className={'sl-lrow' + (l.id === layer.id ? ' on' : '')}>
              <button role="tab" aria-selected={l.id === layer.id} onClick={() => { setLayerId(l.id); setSel(null); }}><Svg d={ICO.layer} s={18} /><span>{base ? `${slide.title} (base layer)` : l.name}</span><small>{l.objects.length}</small></button>
              {!base && <button className="rs-ib" aria-label={`Actions for layer ${l.name}`} onClick={e => popup(e.currentTarget, [
                { label: 'Rename layer', act: async () => { const v = await ask({ title: 'Rename layer', value: l.name, ok: 'Rename' }); if (v?.trim()) write(c => { inSlide(c).layers.find(x => x.id === l.id).name = v.trim(); }); } },
                { label: l.hideOthers ? '✓ Hide other layers when shown' : 'Hide other layers when shown', act: () => write(c => { const x = inSlide(c).layers.find(y => y.id === l.id); x.hideOthers = !x.hideOthers; }) },
                { label: 'Duplicate layer', act: () => { const n = { ...JSON.parse(JSON.stringify(l)), id: rid('l'), name: l.name + ' copy' }; n.objects.forEach(o => { o.id = rid('o'); }); n.triggers = []; write(c => { inSlide(c).layers.push(n); }); setLayerId(n.id); } },
                { label: 'Delete layer', danger: true, act: () => { write(c => { const s = inSlide(c); s.layers = s.layers.filter(x => x.id !== l.id); }); setLayerId(null); } },
              ])}>⋯</button>}
            </div>
          );
        })}
      </div>
    </section>
  );
  const slideProps = (
    <section className="sl-pane" aria-label="Slide Properties">
      <header><h4>Slide Properties</h4></header>
      <div className="sl-pbody">
        <label className="cv-f"><span>Title</span><input value={slide.title} onChange={e => setSlideProp('title', e.target.value)} aria-label="Slide title" /></label>
        <label className="cv-f"><span>Slide advances</span><select value={slide.next} onChange={e => setSlideProp('next', e.target.value)} aria-label="Slide advances"><option value="user">By the learner (Next)</option><option value="auto">Automatically</option><option value="question">When the question is answered</option></select></label>
        <label className="cv-f"><span>Timeline (s)</span><input type="number" min="0" step="0.5" value={slide.duration} onChange={e => setSlideProp('duration', Math.max(0, Number(e.target.value) || 0))} aria-label="Slide timeline" /></label>
        <label className="cv-f"><span>Transition</span><select value={slide.transition?.type || 'none'} onChange={e => setSlideProp('transition', { type: e.target.value, dur: slide.transition?.dur || 0.6 })} aria-label="Transition">{TRANSITIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
        <p className="cv-kind">{slide.layers.length - 1} layer{slide.layers.length === 2 ? '' : 's'} · {slide.layers.reduce((n, l) => n + l.triggers.length, 0)} triggers · double-click to edit</p>
      </div>
    </section>
  );

  return (
    <div className="cv sl" data-course>
      <div className="sl-tabs" role="tablist" aria-label="Ribbon">
        <button className="sl-file" aria-haspopup="menu" onClick={e => fileMenu(e.currentTarget)}>FILE</button>
        {TABS.map(t => <button key={t} role="tab" aria-selected={ribbon === t} className={ribbon === t ? 'on' : ''} onClick={() => { if (!ribbonOpen || ribbon !== t) foldRibbon(true); setRibbon(t); }} onDoubleClick={() => foldRibbon(!ribbonOpen)}>{t}</button>)}
        <span className="sl-qa">
          <button aria-label={ribbonOpen ? 'Collapse the ribbon' : 'Expand the ribbon'} aria-expanded={ribbonOpen} title={ribbonOpen ? 'Collapse the ribbon (double-click a tab)' : 'Expand the ribbon'} onClick={() => foldRibbon(!ribbonOpen)}>{ribbonOpen ? '⌃' : '⌄'}</button>
          <button aria-label="Undo" title="Undo (Ctrl Z)" disabled={!undo.current.length} onClick={() => back(undo, redo)}>↶</button>
          <button aria-label="Redo" title="Redo (Ctrl Y)" disabled={!redo.current.length} onClick={() => back(redo, undo)}>↷</button>
        </span>
      </div>
      {ribbonOpen && <div className="sl-ribbon" role="toolbar" aria-label="Course tools">{ribbonBody[ribbon]}</div>}
      <input ref={picRef} type="file" accept="image/*" hidden aria-label="Picture to insert" onChange={e => { insertPicture(e.target.files[0]); e.target.value = ''; }} />
      <input ref={importRef} type="file" accept=".json,.html,.htm,.zip,.story,application/json,text/html,application/zip" hidden aria-label="Course file to import" onChange={e => { importInto(e.target.files[0], e.target.dataset.how); e.target.value = ''; }} />
      <div className="sl-viewbar">
        <button className={mode === 'story' ? 'on' : ''} onClick={() => go('story')}><Svg d={ICO.story} s={16} />STORY VIEW</button>
        <button className={mode === 'slide' ? 'on' : ''} onClick={() => go('slide')}><Svg d={ICO.slideview} s={16} />{here.sc.name.toUpperCase()} · {sceneNo}.{here.i + 1} {slide.title}</button>
        <span className="sl-toggles" role="group" aria-label="Panels">
          {mode === 'slide' && <button className={panels.slides ? 'on' : ''} aria-pressed={panels.slides} title="Slide list" aria-label="Slide list panel" onClick={() => togglePanel('slides')}><svg viewBox="0 0 20 20" aria-hidden="true"><rect x="2" y="3" width="16" height="14" rx="2" /><path d="M7 3v14" /></svg></button>}
          {mode === 'slide' && <button className={panels.bottom ? 'on' : ''} aria-pressed={panels.bottom} title="Timeline, States, Format, Notes" aria-label="Timeline panel" onClick={() => togglePanel('bottom')}><svg viewBox="0 0 20 20" aria-hidden="true"><rect x="2" y="3" width="16" height="14" rx="2" /><path d="M2 12h16" /></svg></button>}
          <button className={panels.right ? 'on' : ''} aria-pressed={panels.right} title="Triggers and layers" aria-label="Right panel" onClick={() => togglePanel('right')}><svg viewBox="0 0 20 20" aria-hidden="true"><rect x="2" y="3" width="16" height="14" rx="2" /><path d="M13 3v14" /></svg></button>
          {mode === 'slide' && <button className={focusMode ? 'on' : ''} aria-pressed={focusMode} title="Focus: only the slide" aria-label="Focus on the slide" onClick={() => setFocus(!focusMode)}><svg viewBox="0 0 20 20" aria-hidden="true"><path d="M3 7V3h4M13 3h4v4M17 13v4h-4M7 17H3v-4" /></svg></button>}
        </span>
      </div>
      {course.importNote && <div className="sl-import" role="status"><b>Storyline import</b><span>{course.importNote}</span>{course.importDetails?.length > 0 && <button className="btn" onClick={() => setDialog('import')}>Details</button>}<button className="rs-ib" aria-label="Dismiss the import note" onClick={() => write(c => { delete c.importNote; delete c.importDetails; })}>×</button></div>}
      {mode === 'story' ? (
        <div className="sl-main story" style={{ gridTemplateColumns: panels.right ? undefined : 'minmax(0,1fr)' }}>
          {storyView}
          {panels.right && <aside className="sl-right" aria-label="Properties">
            <section className="sl-pane sl-trigpane" aria-label="Triggers">
              <header><h4>Triggers</h4><span className="sl-hbtns"><button className="sl-ico" aria-label="Variables" title="Variables" onClick={() => setDialog('vars')}>%x%</button><button className="sl-x" aria-label="Hide the right panel" title="Hide this panel" onClick={() => togglePanel('right', false)}>×</button></span></header>
              <div className="sl-pbody"><Triggers course={course} slide={slide} layer={slide.layers[0]} write={write} inLayer={(c) => inLayer(c, slide.id, slide.layers[0].id)} open={openTrig} setOpen={setOpenTrig} /></div>
            </section>
            {slideProps}
          </aside>}
        </div>
      ) : (
        <div className="sl-main slide" style={{ gridTemplateColumns: `${panels.slides ? 'var(--sl-left) ' : ''}minmax(0,1fr)${panels.right ? ' var(--sl-rightw)' : ''}` }}>
          {panels.slides && slideList}
          {stage}
          {panels.right && <aside className="sl-right" aria-label="Properties">
            <section className="sl-pane sl-trigpane" aria-label="Triggers">
              <header><h4>Triggers</h4><span className="sl-hbtns"><button className="sl-ico" aria-label="Variables" title="Variables" onClick={() => setDialog('vars')}>%x%</button><button className="sl-x" aria-label="Hide the right panel" title="Hide this panel" onClick={() => togglePanel('right', false)}>×</button></span></header>
              <div className="sl-pbody"><Triggers course={course} slide={slide} layer={layer} write={write} inLayer={inLayer} open={openTrig} setOpen={setOpenTrig} /></div>
            </section>
            {layersPane}
          </aside>}
        </div>
      )}
      <footer className="sl-status">
        <span>Scene {sceneNo} of {course.scenes.length}</span><span>{course.size.w} × {course.size.h}</span><span>“{slide.title}”</span>
        <span>{flat.length} slides · {course.vars.length} variables</span>
        <span className="sl-zoom">
          <button aria-label="Zoom out" onClick={() => (mode === 'story' ? setStoryZoom(z => Math.max(40, z - 10)) : setZoom(z => Math.max(15, (z || Math.round(fitK * 100)) - 10)))}>−</button>
          <input type="range" min={mode === 'story' ? 40 : 15} max={mode === 'story' ? 200 : 300} value={mode === 'story' ? storyZoom : (zoom || Math.round(fitK * 100))} onChange={e => (mode === 'story' ? setStoryZoom(Number(e.target.value)) : setZoom(Number(e.target.value)))} aria-label="Zoom" />
          <button aria-label="Zoom in" onClick={() => (mode === 'story' ? setStoryZoom(z => Math.min(200, z + 10)) : setZoom(z => Math.min(300, (z || Math.round(fitK * 100)) + 10)))}>＋</button>
          <b>{mode === 'story' ? storyZoom : (zoom || Math.round(fitK * 100))}%</b>
          <button aria-label="Fit" title="Fit" onClick={() => (mode === 'story' ? setStoryZoom(100) : setZoom(0))}>⤢</button>
        </span>
      </footer>
      {dialog === 'vars' && <VarsDialog course={course} write={write} onClose={() => setDialog(null)} />}
      {dialog === 'player' && <PlayerDialog course={course} write={write} onClose={() => setDialog(null)} />}
      {dialog === 'keys' && <InfoDialog title="Keyboard shortcuts" onClose={() => setDialog(null)} rows={[['Ctrl Z / Ctrl Y', 'Undo / redo'], ['Ctrl C, Ctrl X, Ctrl V', 'Copy, cut, paste an object'], ['Ctrl D', 'Duplicate the object'], ['Arrows (Shift: 10 px)', 'Nudge the object'], ['Delete', 'Delete the object (Story View: the slide)'], ['Double-click', 'Edit text · open a slide from Story View'], ['Enter', 'Story View: open the slide'], ['Alt while dragging', 'Move without snapping'], ['F12', 'Preview the entire project']]} />}
      {dialog === 'import' && <InfoDialog title="What didn’t come over" onClose={() => setDialog(null)} rows={course.importDetails || []} />}
      {dialog === 'help' && <InfoDialog title="How it works" onClose={() => setDialog(null)} rows={[['Story View', 'Every scene and its slides. Double-click a slide to edit it.'], ['Slide View', 'The slide, its layers (right), triggers (right) and the Timeline, States, Format and Notes (below).'], ['Layers', 'Extra parts of a slide shown and hidden by triggers — pop-ups, feedback, details.'], ['States', 'How an object looks when hovered, pressed, selected, visited, disabled, or a state of your own.'], ['Triggers', '“Do this when that happens, if…”: jump, show a layer, change a state, adjust a variable…'], ['Variables', 'Remember things while the course runs; show one in text as %Name%.'], ['Publish', 'One web page, or a SCORM 1.2 zip for an LMS. Export saves a course file to open again.']]} />}
      {dialog?.preview && <Preview course={course} fileId={file.id} what={dialog.preview} onClose={() => setDialog(null)} />}
    </div>
  );
}
function InfoDialog({ title, rows, onClose }) {
  return (
    <div className="modal" onPointerDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="mbox cv-dlg" role="dialog" aria-modal="true" aria-label={title} onKeyDown={e => { if (e.key === 'Escape') onClose(); }}>
        <header><h3>{title}</h3><button className="rs-ib" aria-label="Close" onClick={onClose}>×</button></header>
        <dl className="sl-info">{rows.map(([a, b]) => <div key={a}><dt>{a}</dt><dd>{b}</dd></div>)}</dl>
        <footer className="cv-dlg-f"><button className="btn primary" onClick={onClose}>Done</button></footer>
      </div>
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
      {textual && <Field label="Text" wide><textarea rows={3} value={s.text != null ? s.text : o.text || ''} onChange={e => (editState === 'normal' ? editObj(x => { x.text = e.target.value; delete x.rich; }) : editObj(x => { const st = ((x.states ||= {})[editState] ||= {}); st.text = e.target.value; delete st.rich; }))} aria-label="Text" /><small>Show a variable with %Name%.</small></Field>}
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
  const objName = id => ({ 'player:next': 'the Next button', 'player:prev': 'the Prev button', freeform: 'the slide’s question' }[id] || slide.layers.flatMap(l => l.objects).find(o => o.id === id)?.name || '(gone)');
  const slideName = id => ({ next: 'next slide', prev: 'previous slide', first: 'first slide', last: 'last slide' }[id] || allSlides(course).find(x => x.s.id === id)?.s.title || '(gone)');
  const layerName = id => (id === 'this' ? 'this layer' : slide.layers.find(l => l.id === id)?.name || '(gone)');
  const a = t.action, act = ACTIONS.find(x => x[0] === a)?.[1] || a;
  const what = a === 'jump' ? `${act} ${slideName(t.target)}` : a === 'showLayer' || a === 'hideLayer' ? `${act} ${layerName(t.target)}` : a === 'state' ? `Change ${objName(t.target)} to ${STATE_LABEL[t.value] || t.value || 'Normal'}`
    : a === 'setVar' ? `Set ${t.target || '?'} ${{ set: '=', add: '+', subtract: '−', multiply: '×', divide: '÷', toggle: 'toggle' }[t.op || 'set']} ${t.op === 'toggle' ? '' : t.value ?? ''}` : a === 'media' ? `${cap(t.value || 'play')} ${objName(t.target)}`
      : a === 'timeline' ? `${cap(t.value || 'pause')} the timeline` : a === 'submit' ? `Submit ${objName(t.target)}` : a === 'url' ? `Open ${t.value || '?'}` : act;
  const ev = EVENTS.find(x => x[0] === t.event);
  const on = t.on !== undefined ? t.on : t.value;
  const when = ev?.[2] === 'object' ? `${ev[1].toLowerCase()} ${objName(t.source)}${t.event === 'drop' && on ? ' on ' + objName(on) : ''}${t.event === 'stateChange' && on ? ' ' + (STATE_LABEL[on] || on) : ''}` : ev?.[2] === 'var' ? `${t.source || '?'} changes` : t.event === 'key' ? `the learner presses ${on || '?'}` : (ev?.[1] || t.event).toLowerCase();
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
  const stateOpts = id => { if (String(id).startsWith('player:')) return ['normal', 'disabled', 'hidden'].map(st => <option key={st} value={st}>{STATE_LABEL[st]}</option>); const o = objs.find(x => x.id === id); return [...new Set(['normal', 'hidden', 'disabled', ...STATES.filter(s => o?.states?.[s]), ...Object.keys(o?.states || {})])].map(s => <option key={s} value={s}>{STATE_LABEL[s] || s}</option>); };
  const setAction = a => edit(x => { x.action = a; const kd = ACTIONS.find(y => y[0] === a)?.[2]; x.target = kd === 'slide' ? 'next' : kd === 'layer' ? (slide.layers[1]?.id || 'this') : kd === 'object' ? (objs.find(o => (a === 'media' ? ['video', 'audio'].includes(o.kind) : a === 'submit' ? o.kind === 'question' : true))?.id || '') : kd === 'var' ? (varNames[0] || '') : ''; x.value = a === 'state' ? 'normal' : a === 'media' ? 'play' : a === 'timeline' ? 'pause' : ''; x.op = 'set'; });
  const setEvent = ev => edit(x => { x.event = ev; const kd = EVENTS.find(y => y[0] === ev)?.[2]; x.source = kd === 'object' ? (objs[0]?.id || '') : kd === 'var' ? (varNames[0] || '') : ''; x.on = ev === 'key' ? 'Enter' : ''; });
  const def = course.vars.find(v => v.name === t.target);
  const condLeft = [...varNames, ...BUILTIN_VARS];
  return (
    <div className="cv-tform">
      <Field label="Action" wide><select value={t.action} onChange={e => setAction(e.target.value)} aria-label="Action">{ACTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></Field>
      {kind === 'slide' && <Field label="Slide" wide><select value={t.target} onChange={e => edit(x => { x.target = e.target.value; })} aria-label="Slide"><option value="next">Next slide</option><option value="prev">Previous slide</option><option value="first">First slide</option><option value="last">Last slide</option>{course.scenes.map(sc => <optgroup key={sc.id} label={sc.name}>{sc.slides.map(s => <option key={s.id} value={s.id}>{s.title}</option>)}</optgroup>)}</select></Field>}
      {kind === 'layer' && <Field label="Layer" wide><select value={t.target} onChange={e => edit(x => { x.target = e.target.value; })} aria-label="Layer"><option value="this">This layer</option>{slide.layers.slice(1).map(l => <option key={l.id} value={l.id}>{l.name}</option>)}</select>{slide.layers.length < 2 && <small>Add a layer below the slide first.</small>}</Field>}
      {kind === 'object' && <Field label="Object" wide><select value={t.target} onChange={e => edit(x => { x.target = e.target.value; })} aria-label="Target object"><option value="">(pick one)</option>{objOpts(t.action === 'media' ? objs.filter(o => ['video', 'audio'].includes(o.kind)) : t.action === 'submit' ? objs.filter(o => o.kind === 'question') : objs)}
        {t.action === 'state' && <optgroup label="Player"><option value="player:next">Next button</option><option value="player:prev">Prev button</option></optgroup>}
        {t.action === 'submit' && slide.freeform && <option value="freeform">The slide’s question</option>}</select></Field>}
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
      {t.event === 'drop' && <Field label="Dropped on" wide><select value={(t.on ?? t.value) || ''} onChange={e => edit(x => { x.on = e.target.value; })} aria-label="Dropped on"><option value="">(anything)</option>{objOpts(objs.filter(o => o.id !== t.source))}</select></Field>}
      {t.event === 'stateChange' && <Field label="State" wide><select value={(t.on ?? t.value) || ''} onChange={e => edit(x => { x.on = e.target.value; })} aria-label="Becomes the state"><option value="">(any)</option>{stateOpts(t.source)}</select></Field>}
      {evKind === 'var' && <Field label="Variable" wide><select value={t.source} onChange={e => edit(x => { x.source = e.target.value; })} aria-label="Watched variable"><option value="">(pick one)</option>{varNames.map(v => <option key={v}>{v}</option>)}</select></Field>}
      {t.event === 'key' && <Field label="Key" wide><input value={(t.on ?? t.value) || ''} onChange={e => edit(x => { x.on = e.target.value; })} aria-label="Key" placeholder="Enter, a, ArrowRight…" /></Field>}
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
            <Field label="Goes out with" wide><select value={o.out || 'none'} onChange={e => set(o.id, 'out', e.target.value === 'none' ? undefined : e.target.value)} aria-label="Exit animation"><option value="none">Nothing (just goes)</option><option value="fade">Fade out</option></select></Field>
          </div>
        );
      })()}
      {!sel && <p className="cv-empty">Pick an object to set when it appears, for how long, and how it comes in.</p>}
    </div>
  );
}

/* ---- dialogs ---- */
function Modal({ title, onClose, children, wide, full, tools, boxRef }) {
  return (
    <div className={'modal' + (full ? ' cv-full' : '')} onPointerDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div ref={boxRef} className={'mbox cv-dlg' + (wide ? ' wide' : '') + (full ? ' full' : '')} role="dialog" aria-modal="true" aria-label={title} onKeyDown={e => { if (e.key === 'Escape' && !document.fullscreenElement) onClose(); }}>
        <header><h3>{title}</h3>{tools}<button className="rs-ib" aria-label="Close" onClick={onClose}>×</button></header>
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
  // The preview fills the window; Full screen hides the browser's own bars too.
  const box = useRef(null);
  const [fs, setFs] = useState(false);
  const toggleFs = () => { if (document.fullscreenElement) document.exitFullscreen?.(); else box.current?.requestFullscreen?.().catch(() => {}); };
  useEffect(() => {
    const on = () => setFs(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', on);
    return () => { document.removeEventListener('fullscreenchange', on); if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {}); };
  }, []);
  return (
    <Modal title="Preview" onClose={onClose} full boxRef={box} tools={<button className="btn cv-fs" onClick={toggleFs} aria-pressed={fs}>{fs ? '⤡ Exit full screen' : '⤢ Full screen'}</button>}>
      <iframe key={n} className="cv-preview" title="Course preview" srcDoc={html} sandbox="allow-scripts allow-popups" allow="fullscreen" />
      <footer className="cv-dlg-f"><span className="cv-note">{what === 'all' ? 'The whole course' : what.startsWith('scene:') ? 'This scene' : 'This slide'}, as learners will see it.</span><button className="btn" onClick={() => setN(x => x + 1)}>Replay</button><button className="btn primary" onClick={onClose}>Close preview</button></footer>
    </Modal>
  );
}
