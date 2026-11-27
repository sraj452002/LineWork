import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { rid } from '../lib/utils.js';
import { useUI } from './ui.jsx';
import { ObjArt, Thumb, boxStyle, defaultsOf, lookOf } from './CourseArt.jsx';
import { storyDetails, storyNote } from './CourseStudio.jsx';
import {
  ACTIONS, ANIMS, BUILTIN_VARS, EVENTS, KINDS, OPS, QTYPES, STATES, allSlides, cloneSlide, courseHtml, findSlide, interpolate,
  TRANSITIONS, appendCourse, courseFile, feedbackOf, newCourse, newLayer, newObject, newScene, newSlide, pictureUrl, readCourse, scormZip,
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
Object.assign(ICO, {
  banks: '<path d="M4 12L16 5l12 7z" fill="#e9ebf3" stroke="#6b7591"/><path d="M7 13v11M12 13v11M20 13v11M25 13v11M4 26h24" stroke="#6b7591" stroke-width="1.6"/><text x="16" y="22" font-size="9" font-weight="700" text-anchor="middle" fill="#b07d00">?</text>',
  record: '<rect x="3" y="7" width="22" height="15" rx="2" fill="#fff" stroke="#6b7591"/><path d="M10 26h8M14 22v4" stroke="#6b7591"/><circle cx="25" cy="9" r="4.5" fill="#e5484d"/>',
  slideLayer: '<rect x="8" y="4" width="20" height="15" rx="1.5" fill="#fff" stroke="#6b7591"/><rect x="4" y="10" width="20" height="15" rx="1.5" fill="#dfe8fb" stroke="#3d6fd6"/>',
  freeform: '<rect x="4" y="5" width="24" height="20" rx="2" fill="#fff" stroke="#6b7591"/><path d="M11 13l4 8 1.5-3.5 3.5-1.5z" fill="#1f2433"/><path d="M20 8l1 2 2 .5-2 .5-1 2-1-2-2-.5 2-.5z" fill="#f5b400"/>',
  zoomRegion: '<rect x="3" y="6" width="26" height="19" rx="2" fill="#fff" stroke="#6b7591"/><rect x="12" y="11" width="11" height="8" fill="none" stroke="#3d6fd6" stroke-width="1.6" stroke-dasharray="2 1.5"/>',
  character: '<circle cx="16" cy="10" r="5" fill="#f2c9a5" stroke="#9a6b47"/><path d="M7 28c0-6 4-10 9-10s9 4 9 10" fill="#4f5bd5"/>',
  caption: '<path d="M4 6h24v14H14l-6 5v-5H4z" fill="#fff4dc" stroke="#d99a00"/><path d="M8 11h16M8 15h10" stroke="#b07d00"/>',
  web: '<circle cx="16" cy="16" r="11" fill="#eef4ff" stroke="#3d6fd6" stroke-width="1.6"/><path d="M5 16h22M16 5c4 4 4 18 0 22M16 5c-4 4-4 18 0 22" stroke="#3d6fd6" fill="none"/>',
  table: '<rect x="4" y="6" width="24" height="20" rx="1.5" fill="#fff" stroke="#6b7591"/><path d="M4 12h24M4 19h24M12 6v20M20 6v20" stroke="#6b7591"/>',
  slider: '<path d="M4 16h24" stroke="#6b7591" stroke-width="2.4" stroke-linecap="round"/><circle cx="13" cy="16" r="5" fill="#3d6fd6"/>',
  dial: '<circle cx="16" cy="17" r="10" fill="#fff" stroke="#6b7591" stroke-width="1.6"/><path d="M16 17l5-6" stroke="#3d6fd6" stroke-width="2.4" stroke-linecap="round"/><circle cx="16" cy="17" r="2" fill="#3d6fd6"/>',
  marker: '<path d="M16 28s9-9 9-15a9 9 0 0 0-18 0c0 6 9 15 9 15z" fill="#e5484d"/><circle cx="16" cy="13" r="3.5" fill="#fff"/>',
  templates: '<rect x="4" y="5" width="24" height="22" rx="2" fill="#fff" stroke="#6b7591"/><rect x="7" y="8" width="18" height="5" fill="#dfe8fb"/><rect x="7" y="15" width="8" height="9" fill="#dfe8fb"/><path d="M18 16h7M18 20h7M18 24h4" stroke="#6b7591"/>',
  graded: '<rect x="5" y="4" width="22" height="24" rx="2" fill="#fff" stroke="#6b7591"/><path d="M9 11l2 2 4-4M9 19l2 2 4-4" stroke="#17a05b" stroke-width="2" fill="none"/><path d="M18 11h6M18 19h6" stroke="#6b7591"/>',
  survey: '<rect x="5" y="4" width="22" height="24" rx="2" fill="#fff" stroke="#6b7591"/><circle cx="16" cy="14" r="6" fill="#eef4ff" stroke="#3d6fd6"/><text x="16" y="17.5" font-size="9" font-weight="700" text-anchor="middle" fill="#3d6fd6">?</text><path d="M10 24h12" stroke="#6b7591"/>',
  results: '<rect x="5" y="4" width="22" height="24" rx="2" fill="#fff" stroke="#6b7591"/><path d="M10 20l4-5 3 3 5-7" stroke="#e5484d" stroke-width="2" fill="none"/><path d="M9 24h14" stroke="#6b7591"/>',
  gear: '<circle cx="16" cy="16" r="4" fill="none" stroke="#6b7591" stroke-width="2"/><path d="M16 4v4M16 24v4M4 16h4M24 16h4M7.5 7.5l2.8 2.8M21.7 21.7l2.8 2.8M7.5 24.5l2.8-2.8M21.7 10.3l2.8-2.8" stroke="#6b7591" stroke-width="2"/>',
});
const TR_ICON = { none: '<rect x="4" y="7" width="24" height="18" rx="2" fill="#fff" stroke="#6b7591"/><path d="M8 25L24 7" stroke="#c0353a" stroke-width="2"/>', fade: '<rect x="4" y="7" width="24" height="18" rx="2" fill="url(#f)" stroke="#6b7591"/><defs><linearGradient id="f" x1="0" x2="1"><stop offset="0" stop-color="#3d6fd6" stop-opacity=".1"/><stop offset="1" stop-color="#3d6fd6"/></linearGradient></defs>', push: '<rect x="4" y="7" width="14" height="18" fill="#dfe8fb" stroke="#3d6fd6"/><rect x="18" y="7" width="10" height="18" fill="#3d6fd6"/><path d="M8 16h6M12 13l3 3-3 3" stroke="#3d6fd6" stroke-width="1.6" fill="none"/>', pushUp: '<rect x="4" y="7" width="24" height="11" fill="#dfe8fb" stroke="#3d6fd6"/><rect x="4" y="18" width="24" height="7" fill="#3d6fd6"/>', cover: '<rect x="4" y="7" width="24" height="18" fill="#dfe8fb" stroke="#6b7591"/><rect x="4" y="7" width="15" height="18" fill="#3d6fd6"/>', zoom: '<rect x="4" y="7" width="24" height="18" rx="2" fill="#fff" stroke="#6b7591"/><rect x="11" y="12" width="10" height="8" fill="#3d6fd6"/><path d="M7 10l3 3M25 10l-3 3M7 22l3-3M25 22l-3-3" stroke="#3d6fd6"/>' };
const AN_ICON = { none: TR_ICON.none, fade: '<circle cx="16" cy="16" r="10" fill="#3d6fd6" opacity=".35"/><circle cx="16" cy="16" r="6" fill="#3d6fd6"/>', 'fly-left': '<rect x="15" y="10" width="12" height="12" rx="2" fill="#3d6fd6"/><path d="M4 16h8M9 13l3 3-3 3" stroke="#6b7591" stroke-width="2" fill="none"/>', 'fly-right': '<rect x="5" y="10" width="12" height="12" rx="2" fill="#3d6fd6"/><path d="M28 16h-8M23 13l-3 3 3 3" stroke="#6b7591" stroke-width="2" fill="none"/>', 'fly-up': '<rect x="10" y="5" width="12" height="12" rx="2" fill="#3d6fd6"/><path d="M16 28v-8M13 23l3-3 3 3" stroke="#6b7591" stroke-width="2" fill="none"/>', 'fly-down': '<rect x="10" y="15" width="12" height="12" rx="2" fill="#3d6fd6"/><path d="M16 4v8M13 9l3 3 3-3" stroke="#6b7591" stroke-width="2" fill="none"/>', zoom: '<rect x="11" y="11" width="10" height="10" rx="2" fill="#3d6fd6"/><rect x="6" y="6" width="20" height="20" rx="3" fill="none" stroke="#3d6fd6" stroke-dasharray="3 2"/>', spin: '<rect x="10" y="10" width="12" height="12" rx="2" fill="#3d6fd6" transform="rotate(25 16 16)"/><path d="M6 12a11 11 0 0 1 16-6" stroke="#6b7591" stroke-width="2" fill="none"/>', bounce: '<circle cx="16" cy="9" r="5" fill="#3d6fd6"/><path d="M6 27h20M12 21q4-6 8 0" stroke="#6b7591" stroke-width="2" fill="none"/>' };
const Svg = ({ d, s = 32 }) => <svg viewBox="0 0 32 32" width={s} height={s} fill="none" strokeWidth="1.4" aria-hidden="true" dangerouslySetInnerHTML={{ __html: d }} />;
const SOON = 'Not in Course Studio yet';
function Big({ icon, label, onClick, menu, on, disabled, small, title }) {
  return (
    <button type="button" className={'sl-big' + (on ? ' on' : '') + (small ? ' small' : '')} onClick={e => onClick?.(e.currentTarget)} disabled={disabled} title={title || (disabled ? SOON : undefined)} aria-haspopup={menu ? 'menu' : undefined} aria-pressed={on === undefined ? undefined : !!on}>
      <Svg d={icon} s={small ? 20 : 26} />
      <span>{label}{menu && <i aria-hidden="true"> ▾</i>}</span>
    </button>
  );
}
// A small ribbon button (an icon and a word), in a column of two or three.
const Sm = ({ icon, label, onClick, disabled, menu, title }) => <button className="sl-sm" onClick={e => onClick?.(e.currentTarget)} disabled={disabled} title={title || (disabled ? SOON : undefined)} aria-haspopup={menu ? 'menu' : undefined}>{icon && <Svg d={icon} s={16} />}{label}{menu && <i aria-hidden="true"> ▾</i>}</button>;
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
  // More objects selected with the first (Shift-click, or a box dragged round them).
  const [extra, setExtra] = useState([]);
  // The Timeline's playhead (null: every object shows): objects not on the slide at that time are dimmed.
  const [tlTime, setTlTime] = useState(null);
  // Rulers, gridlines and snapping guides (kept for next time).
  const [view, setView] = useState(() => { try { return { rulers: true, grid: false, guides: true, ...JSON.parse(readPref('linework:course-view', '{}')) }; } catch (e) { return { rulers: true, grid: false, guides: true }; } });
  const toggleView = key => setView(v => { const n = { ...v, [key]: !v[key] }; savePref('linework:course-view', JSON.stringify(n)); return n; });
  // The bottom panel's height (drag its top edge), or folded down to its tabs.
  const [bottomH, setBottomH] = useState(() => Math.max(90, Number(readPref('linework:course-bottomh', '190')) || 190));
  const [bottomFold, setBottomFold] = useState(() => readPref('linework:course-bottomfold', '0') === '1');
  const foldBottom = v => { setBottomFold(v); savePref('linework:course-bottomfold', v ? '1' : '0'); };
  const guideRef = useRef(null);
  const setFocus = on => setPanels(() => { const n = { slides: !on, right: !on, bottom: !on }; savePref('linework:course-panels', JSON.stringify(n)); return n; });

  const flat = course ? allSlides(course) : [];
  const here = course && (findSlide(course, slideId) || flat[0]);
  const slide = here?.s;
  const layer = slide && (slide.layers.find(l => l.id === layerId) || slide.layers[0]);
  const obj = layer && sel ? (layer.objects.find(o => o.id === sel) || null) : null;
  useEffect(() => { if (obj?.id !== sel) setSel(obj?.id || null); setEditState('normal'); setExtra([]); setTlTime(null); }, [slide?.id, layer?.id]); // eslint-disable-line
  const chosen = new Set([sel, ...extra].filter(id => id && layer?.objects.some(o => o.id === id)));
  const pick = (id, add) => {
    if (!add) { setSel(id); setExtra([]); return; }
    if (!id) return;
    if (id === sel) { const [n, ...rest] = extra; setSel(n || null); setExtra(rest); }
    else if (extra.includes(id)) setExtra(extra.filter(x => x !== id));
    else if (sel) setExtra([...extra, id]); else setSel(id);
  };

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
  // A question slide of a kind (Graded Question), or a survey (no right answer, no points).
  const addQuestionSlide = (qt, survey) => {
    const sl = newSlide(survey ? 'Survey question' : 'Question', 'question');
    const q = sl.layers[0].objects.find(o => o.kind === 'question').q;
    q.type = qt;
    if (qt === 'tf') q.choices = [{ id: rid('c'), text: 'True', correct: true }, { id: rid('c'), text: 'False', correct: false }];
    if (qt === 'fill') { q.answer = 'answer'; q.choices = []; }
    if (survey) { q.points = 0; q.choices.forEach(c => { c.correct = true; }); q.right = 'Thanks for your answer.'; q.wrong = 'Thanks for your answer.'; q.prompt = 'How sure do you feel about this?'; }
    write(c => { const sc = c.scenes.find(x => x.id === here.sc.id); sc.slides.splice(here.i + 1, 0, sl); });
    setSlideId(sl.id); setLayerId(null); setSel(null);
  };
  const addScene = () => { const sc = newScene(`Scene ${course.scenes.length + 1}`, [newSlide('Untitled slide', 'blank')]); write(c => { c.scenes.push(sc); }); setSlideId(sc.slides[0].id); };
  const dupSlide = x => { const n = cloneSlide(x.s); n.title += ' copy'; write(c => { const sc = c.scenes.find(s => s.id === x.sc.id); sc.slides.splice(sc.slides.findIndex(s => s.id === x.s.id) + 1, 0, n); }); setSlideId(n.id); };
  const delSlide = x => { if (flat.length <= 1) return toast('A course needs at least one slide.'); write(c => { const sc = c.scenes.find(s => s.id === x.sc.id); sc.slides = sc.slides.filter(s => s.id !== x.s.id); c.scenes = c.scenes.filter(s => s.slides.length); if (c.start && !c.scenes.some(s => s.id === c.start)) delete c.start; }); setSlideId(null); };

  /* ---- clipboard, keys ---- */
  const clip = useRef(null);
  const copyObj = () => { if (obj) { clip.current = JSON.stringify(obj); toast('Copied'); } };
  const cutObj = () => { if (!obj) return; clip.current = JSON.stringify(obj); write(c => { const l = inLayer(c); l.objects = l.objects.filter(o => o.id !== obj.id); }); setSel(null); };
  const pasteObj = () => { if (!clip.current) return toast('Copy or cut an object first.'); if (mode !== 'slide') go('slide'); const o = { ...JSON.parse(clip.current), id: rid('o') }; o.x += 20; o.y += 20; write(c => { inLayer(c).objects.push(o); }); setSel(o.id); };
  const removeChosen = () => { const ids = new Set(chosen); write(c => { const l = inLayer(c); l.objects = l.objects.filter(o => !ids.has(o.id)); l.triggers = l.triggers.filter(t => !ids.has(t.source)); }); setSel(null); setExtra([]); };
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
      if (mod && k === 'a') { e.preventDefault(); const ids = layer.objects.filter(o => !o.hideEdit).map(o => o.id); setSel(ids[0] || null); setExtra(ids.slice(1)); return; }
      if (e.key === 'Escape') { setSel(null); setExtra([]); return; }
      if (!obj) return;
      if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); removeChosen(); }
      else if (e.key.startsWith('Arrow')) {
        e.preventDefault(); const d = e.shiftKey ? 10 : 1;
        write(c => { for (const o of inLayer(c).objects) if (chosen.has(o.id) && !o.locked) { if (e.key === 'ArrowLeft') o.x -= d; if (e.key === 'ArrowRight') o.x += d; if (e.key === 'ArrowUp') o.y -= d; if (e.key === 'ArrowDown') o.y += d; } });
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
    const m = view.rulers ? 52 : 28;
    const fit = () => { const r = el.getBoundingClientRect(); if (r.width && r.height) setFitK(Math.max(0.15, Math.min((r.width - m) / course.size.w, (r.height - m) / course.size.h, 2))); };
    fit(); const ro = new ResizeObserver(fit); ro.observe(el); return () => ro.disconnect();
  }, [course?.size?.w, course?.size?.h, visible, mode, panels.slides, panels.right, panels.bottom, ribbonOpen, view.rulers, bottomH, bottomFold]); // eslint-disable-line
  const k = zoom ? zoom / 100 : fitK;
  const showGuides = (xs, ys) => { const g = guideRef.current; if (g) g.innerHTML = xs.map(x => `<i class="gv" style="left:${x}px"></i>`).join('') + ys.map(y => `<i class="gh" style="top:${y}px"></i>`).join(''); };
  const drag = (e, o, how) => {
    if (e.button === 2) return; // the right-click menu
    e.stopPropagation(); e.preventDefault();
    if (how === 'move' && (e.shiftKey || e.ctrlKey || e.metaKey)) { pick(o.id, true); return; }
    const group = how === 'move' && chosen.has(o.id) ? layer.objects.filter(x => chosen.has(x.id) && !x.locked) : [o];
    if (!chosen.has(o.id)) { setSel(o.id); setExtra([]); }
    if (editing || o.locked) return;
    const stageEl = e.currentTarget.closest('.cv-stage');
    const els = group.map(g => ({ g, el: stageEl.querySelector(`.cv-o[data-id="${g.id}"]`) })).filter(x => x.el);
    const sx = e.clientX, sy = e.clientY, start = { x: o.x, y: o.y, w: o.w, h: o.h };
    const bx = Math.min(...group.map(g => g.x)), by = Math.min(...group.map(g => g.y));
    const bw = Math.max(...group.map(g => g.x + g.w)) - bx, bh = Math.max(...group.map(g => g.y + g.h)) - by;
    // What the dragged objects line up with: the slide's edges and middle, and the other objects'.
    const ids = new Set(group.map(g => g.id)), others = layer.objects.filter(x => !ids.has(x.id) && !x.hideEdit);
    const tx = [0, course.size.w / 2, course.size.w, ...others.flatMap(x => [x.x, x.x + x.w / 2, x.x + x.w])];
    const ty = [0, course.size.h / 2, course.size.h, ...others.flatMap(x => [x.y, x.y + x.h / 2, x.y + x.h])];
    const near = (lines, targets, th) => { let best = null; for (const [i, v] of lines.entries()) for (const t of targets) { const d = t - v; if (Math.abs(d) <= th && (!best || Math.abs(d) < Math.abs(best.d))) best = { d, at: t, i }; } return best; };
    let moved = false, out = null;
    const mv = m => {
      const dx = (m.clientX - sx) / k, dy = (m.clientY - sy) / k;
      if (!moved && Math.abs(dx) + Math.abs(dy) < 2) return;
      moved = true;
      const step = m.altKey ? 1 : view.grid ? 20 : 5, r = v => Math.round(v / step) * step, th = 6 / k;
      if (how === 'move') {
        let nx = bx + dx, ny = by + dy;
        const sxg = view.guides && !m.altKey ? near([nx, nx + bw / 2, nx + bw], tx, th) : null;
        const syg = view.guides && !m.altKey ? near([ny, ny + bh / 2, ny + bh], ty, th) : null;
        nx = sxg ? Math.round(nx + sxg.d) : r(nx); ny = syg ? Math.round(ny + syg.d) : r(ny);
        showGuides(sxg ? [sxg.at] : [], syg ? [syg.at] : []);
        out = group.map(g => ({ id: g.id, x: g.x + nx - bx, y: g.y + ny - by }));
        for (const { g, el } of els) { const p = out.find(q => q.id === g.id); el.style.left = p.x + 'px'; el.style.top = p.y + 'px'; }
      } else {
        const sn = { ...start };
        if (how.includes('e')) sn.w = Math.max(10, r(start.w + dx));
        if (how.includes('s')) sn.h = Math.max(10, r(start.h + dy));
        if (how.includes('w')) { sn.w = Math.max(10, r(start.w - dx)); sn.x = start.x + start.w - sn.w; }
        if (how.includes('n')) { sn.h = Math.max(10, r(start.h - dy)); sn.y = start.y + start.h - sn.h; }
        out = [{ id: o.id, ...sn }];
        Object.assign(els[0].el.style, { left: sn.x + 'px', top: sn.y + 'px', width: sn.w + 'px', height: sn.h + 'px' });
      }
    };
    const up = () => {
      removeEventListener('pointermove', mv); removeEventListener('pointerup', up); showGuides([], []);
      if (moved && out) write(c => { for (const p of out) { const x = inLayer(c).objects.find(q => q.id === p.id); if (x) Object.assign(x, p, { id: x.id }); } });
    };
    addEventListener('pointermove', mv); addEventListener('pointerup', up);
  };
  // A box dragged on the slide's background selects what it touches.
  const marquee = e => {
    if (e.button !== 0) return;
    setEditing(null);
    const add = e.shiftKey || e.ctrlKey || e.metaKey;
    if (!add) { setSel(null); setExtra([]); }
    const stageEl = holder.current?.querySelector('.cv-stage'); if (!stageEl) return;
    const sr = stageEl.getBoundingClientRect(), at = m => ({ x: (m.clientX - sr.left) / k, y: (m.clientY - sr.top) / k });
    const a = at(e); let b = a;
    const box = document.createElement('div'); box.className = 'cv-marquee'; stageEl.appendChild(box);
    const mv = m => { b = at(m); Object.assign(box.style, { left: Math.min(a.x, b.x) + 'px', top: Math.min(a.y, b.y) + 'px', width: Math.abs(b.x - a.x) + 'px', height: Math.abs(b.y - a.y) + 'px' }); };
    const up = () => {
      removeEventListener('pointermove', mv); removeEventListener('pointerup', up); box.remove();
      if (Math.abs(b.x - a.x) + Math.abs(b.y - a.y) < 4) return;
      const x1 = Math.min(a.x, b.x), x2 = Math.max(a.x, b.x), y1 = Math.min(a.y, b.y), y2 = Math.max(a.y, b.y);
      const hit = layer.objects.filter(o => !o.hideEdit && o.x < x2 && o.x + o.w > x1 && o.y < y2 && o.y + o.h > y1).map(o => o.id);
      const all = [...new Set([...(add ? [...chosen] : []), ...hit])];
      setSel(all[0] || null); setExtra(all.slice(1));
    };
    addEventListener('pointermove', mv); addEventListener('pointerup', up);
  };
  // The right-click menu: an anchor at the pointer.
  const at = e => ({ getBoundingClientRect: () => ({ left: e.clientX, right: e.clientX + 230, top: e.clientY, bottom: e.clientY }), contains: () => false });
  const order = how => write(c => {
    const l = inLayer(c), pickd = l.objects.filter(o => chosen.has(o.id)), rest = l.objects.filter(o => !chosen.has(o.id));
    if (how === 'front') l.objects = [...rest, ...pickd];
    else if (how === 'back') l.objects = [...pickd, ...rest];
    else { const arr = l.objects; const idx = arr.map((o, i) => (chosen.has(o.id) ? i : -1)).filter(i => i >= 0); (how === 'forward' ? idx.reverse() : idx).forEach(i => { const j = how === 'forward' ? i + 1 : i - 1; if (j >= 0 && j < arr.length && !chosen.has(arr[j].id)) [arr[i], arr[j]] = [arr[j], arr[i]]; }); }
  });
  const align = how => write(c => {
    const l = inLayer(c), objs = l.objects.filter(o => chosen.has(o.id));
    const one = objs.length === 1, W = c.size.w, H = c.size.h;
    const x1 = one ? 0 : Math.min(...objs.map(o => o.x)), x2 = one ? W : Math.max(...objs.map(o => o.x + o.w));
    const y1 = one ? 0 : Math.min(...objs.map(o => o.y)), y2 = one ? H : Math.max(...objs.map(o => o.y + o.h));
    for (const o of objs) {
      if (how === 'left') o.x = x1; if (how === 'center') o.x = Math.round((x1 + x2 - o.w) / 2); if (how === 'right') o.x = x2 - o.w;
      if (how === 'top') o.y = y1; if (how === 'middle') o.y = Math.round((y1 + y2 - o.h) / 2); if (how === 'bottom') o.y = y2 - o.h;
    }
    if (how === 'hspace' || how === 'vspace') {
      const h = how === 'hspace', srt = [...objs].sort((a, b) => (h ? a.x - b.x : a.y - b.y));
      if (srt.length > 2) { const total = srt.reduce((n, o) => n + (h ? o.w : o.h), 0), gap = ((h ? x2 - x1 : y2 - y1) - total) / (srt.length - 1); let p = h ? x1 : y1; for (const o of srt) { if (h) o.x = Math.round(p); else o.y = Math.round(p); p += (h ? o.w : o.h) + gap; } }
    }
  });
  const alignItems = () => [['left', 'Align left'], ['center', 'Align center'], ['right', 'Align right'], ['top', 'Align top'], ['middle', 'Align middle'], ['bottom', 'Align bottom'], ...(chosen.size > 2 ? [['hspace', 'Distribute horizontally'], ['vspace', 'Distribute vertically']] : [])].map(([v, l]) => ({ label: l + (chosen.size === 1 ? ' (to the slide)' : ''), act: () => align(v) }));
  const objMenu = (e, o) => {
    e.preventDefault(); e.stopPropagation();
    if (!chosen.has(o.id)) { setSel(o.id); setExtra([]); }
    const many = chosen.has(o.id) && chosen.size > 1;
    popup(at(e), [
      { label: 'Cut', act: () => { clip.current = JSON.stringify(o); removeChosen(); } },
      { label: 'Copy', act: () => { clip.current = JSON.stringify(o); toast('Copied'); } },
      { label: 'Paste', act: pasteObj },
      { label: 'Duplicate', act: () => duplicate(o) },
      { label: many ? `Delete ${chosen.size} objects` : 'Delete', danger: true, act: removeChosen },
      '-',
      { label: 'Bring to front', act: () => order('front') }, { label: 'Bring forward', act: () => order('forward') },
      { label: 'Send backward', act: () => order('backward') }, { label: 'Send to back', act: () => order('back') },
      { label: 'Align', items: alignItems() },
      '-',
      { label: 'Add a trigger', act: () => { const t = { id: rid('t'), event: 'click', source: o.id, action: 'jump', target: 'next', conds: [] }; write(c => { inLayer(c).triggers.push(t); }); setOpenTrig(t.id); togglePanel('right', true); } },
      { label: 'Edit states', act: () => { togglePanel('bottom', true); foldBottom(false); setBottom('states'); } },
      { label: 'Format', act: () => { togglePanel('bottom', true); foldBottom(false); setBottom('format'); } },
      { label: 'Rename', act: async () => { const v = await ask({ title: 'Rename object', value: o.name, ok: 'Rename' }); if (v?.trim()) write(c => { const x = inLayer(c).objects.find(q => q.id === o.id); if (x) x.name = v.trim(); }); } },
      { label: o.locked ? 'Unlock' : 'Lock (can’t be moved)', act: () => write(c => { const x = inLayer(c).objects.find(q => q.id === o.id); if (x) x.locked = !x.locked || undefined; }) },
      { label: 'Hide while editing', act: () => write(c => { const x = inLayer(c).objects.find(q => q.id === o.id); if (x) x.hideEdit = true; }) },
    ]);
  };
  const stageMenu = e => {
    e.preventDefault();
    popup(at(e), [
      { label: 'Paste', act: pasteObj },
      { label: 'Select all', act: () => { const ids = layer.objects.filter(o => !o.hideEdit).map(o => o.id); setSel(ids[0] || null); setExtra(ids.slice(1)); } },
      ...(layer.objects.some(o => o.hideEdit) ? [{ label: 'Show hidden objects', act: () => write(c => { inLayer(c).objects.forEach(o => { delete o.hideEdit; }); }) }] : []),
      '-',
      { label: (view.rulers ? '✓ ' : '') + 'Rulers', act: () => toggleView('rulers') },
      { label: (view.grid ? '✓ ' : '') + 'Gridlines', act: () => toggleView('grid') },
      { label: (view.guides ? '✓ ' : '') + 'Snap to objects', act: () => toggleView('guides') },
    ]);
  };
  // Drag the bottom panel's top edge to change its height.
  const resizeBottom = e => {
    e.preventDefault();
    const sy = e.clientY, h0 = bottomFold ? 40 : bottomH, max = Math.max(160, (holder.current?.parentElement?.clientHeight || 600) - 160);
    let h = h0;
    const mv = m => { h = Math.max(90, Math.min(max, h0 - (m.clientY - sy))); setBottomH(h); if (bottomFold) setBottomFold(false); };
    const up = () => { removeEventListener('pointermove', mv); removeEventListener('pointerup', up); savePref('linework:course-bottomh', String(Math.round(h))); savePref('linework:course-bottomfold', '0'); };
    addEventListener('pointermove', mv); addEventListener('pointerup', up);
  };
  // When the playhead is on the timeline: is the object on the slide at that time?
  const offAt = o => { if (tlTime == null) return false; const st = Number(o.start) || 0, end = o.dur ? st + Number(o.dur) : Infinity; return tlTime < st || tlTime >= end; };

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
      <Group label="Clipboard"><Big icon={ICO.paste} label="Paste" onClick={pasteObj} /><div className="sl-col"><Sm label="✂ Cut" onClick={cutObj} disabled={!obj} /><Sm label="⧉ Copy" onClick={copyObj} disabled={!obj} /></div></Group>
      <Group label="Scenes"><Big icon={ICO.scene} label="New Scene" onClick={addScene} /><Big icon={ICO.flag} label="Starting Scene" on={false} onClick={btn => popup(btn, course.scenes.map(sc => ({ label: (sc.id === startScene ? '✓ ' : '') + sc.name, act: () => write(c => { c.start = sc.id; }) })))} menu /><Big icon={ICO.banks} label="Question Banks" disabled menu /></Group>
      <Group label="Slide"><Big icon={ICO.slide} label="New Slide" onClick={newSlideMenu} menu /><div className="sl-col"><Sm icon={ICO.templates} label="Apply Layout" disabled menu /><Sm icon={ICO.fit} label="Reset" disabled /><Sm icon={ICO.dup} label="Duplicate" onClick={() => dupSlide(here)} /></div></Group>
      <Group label="Record"><Big icon={ICO.record} label="Record Screen" disabled menu /></Group>
      <Group label="Triggers"><Big icon={ICO.vars} label="Variables" onClick={() => setDialog('vars')} /></Group>
      <Group label="Arrange"><div className="sl-col"><Sm label="⬆ Bring to Front" onClick={() => order('front')} disabled={!obj} title={obj ? undefined : 'Select an object first'} /><Sm label="⬇ Send to Back" onClick={() => order('back')} disabled={!obj} title={obj ? undefined : 'Select an object first'} /><Sm label="⇔ Align" onClick={btn => popup(btn, alignItems())} disabled={!obj} title={obj ? undefined : 'Select an object first'} menu /></div></Group>
      <Group label="Publish"><Big icon={ICO.player} label="Player" onClick={() => setDialog('player')} /><Big icon={ICO.preview} label="Preview" onClick={previewMenu} menu /><Big icon={ICO.publish} label="Publish" onClick={publish} menu /></Group>
    </>,
    INSERT: <>
      <Group label="Slide"><Big icon={ICO.slideLayer} label="Slide Layer" onClick={() => { go('slide'); const l = newLayer(`Layer ${slide.layers.length}`); write(c => { inSlide(c).layers.push(l); }); setLayerId(l.id); setSel(null); }} /><Big icon={ICO.freeform} label="Convert to Freeform" disabled /><Big icon={ICO.zoomRegion} label="Zoom Region" disabled /></Group>
      <Group label="Media"><Big icon={ICO.character} label="Character" disabled menu /><Big icon={ICO.picture} label="Picture" onClick={() => { picFor.current = null; picRef.current?.click(); }} menu /><Big icon={ICO.shape} label="Shape" onClick={shapeMenu} menu /><Big icon={ICO.caption} label="Caption" onClick={() => insert('shape', { name: 'Caption', text: 'Caption', w: 240, h: 90, style: { ...newObject('shape').style, fill: '#fff4dc', border: '#d99a00', borderW: 1, radius: 12, color: '#5b3a00' } })} menu /><Big icon={ICO.video} label="Video" onClick={() => insertMedia('video')} menu /><Big icon={ICO.audio} label="Audio" onClick={() => insertMedia('audio')} menu /><Big icon={ICO.web} label="Web Object" disabled /></Group>
      <Group label="Text"><Big icon={ICO.text} label="Text Box" onClick={() => insert('text')} /><Big icon={ICO.table} label="Table" disabled menu /><div className="sl-col"><Sm label="Ω Symbol" onClick={btn => popup(btn, ['©', '®', '™', '•', '→', '←', '✓', '✗', '★', '°', '€', '£', '₹', '…'].map(sym => ({ label: sym, act: () => insert('text', { text: sym, name: 'Symbol', w: 80, h: 70, style: { ...newObject('text').style, size: 40, align: 'center' } }) })))} menu /></div></Group>
      <Group label="Interactive Objects"><Big icon={ICO.button} label="Button" onClick={() => insert('button')} menu /><Big icon={ICO.slider} label="Slider" disabled menu /><Big icon={ICO.dial} label="Dial" disabled menu /><Big icon={ICO.hotspot} label="Hotspot" onClick={() => insert('hotspot')} menu /><Big icon={ICO.input} label="Input" onClick={() => insert('input')} menu /><Big icon={ICO.marker} label="Marker" disabled menu />
        <div className="sl-col"><Sm label="⚡ Trigger" onClick={() => { go('slide'); togglePanel('right', true); const t = { id: rid('t'), event: 'click', source: obj?.id || layer.objects[0]?.id || '', action: 'jump', target: 'next', conds: [] }; write(c => { inLayer(c).triggers.push(t); }); setOpenTrig(t.id); }} /><Sm label="▤ Scrolling Panel" disabled /><Sm label="➚ Mouse" disabled menu /></div></Group>
      <Group label="Quiz"><Big icon={ICO.question} label="Question" onClick={questionMenu} menu /><Big icon={ICO.result} label="Result" onClick={() => insert('result')} /></Group>
      <Group label="Publish"><Big icon={ICO.preview} label="Preview" onClick={previewMenu} menu /></Group>
    </>,
    SLIDES: <>
      <Group label="Slide"><Big icon={ICO.templates} label="My Templates" onClick={newSlideMenu} /><Big icon={ICO.slide} label="New Slide" onClick={newSlideMenu} menu /><Big icon={ICO.import} label="Import" onClick={btn => popup(btn, [{ label: 'Import slides…', act: () => pickImport('append') }, { label: 'Open a course over this one…', act: () => pickImport('replace') }])} menu /></Group>
      <Group label="Quizzing"><Big icon={ICO.graded} label="Graded Question" onClick={btn => popup(btn, QTYPES.map(([qt, l]) => ({ label: l, act: () => addQuestionSlide(qt) })))} menu /><Big icon={ICO.survey} label="Survey Question" onClick={() => addQuestionSlide('mc', true)} /><Big icon={ICO.freeform} label="Freeform Question" disabled /><Big icon={ICO.results} label="Results" onClick={() => addSlide('result')} /><Big icon={ICO.banks} label="Question Banks" disabled menu /></Group>
      <Group label="Edit"><Big icon={ICO.dup} label="Duplicate" onClick={() => dupSlide(here)} /><Big icon={ICO.del} label="Delete" onClick={() => delSlide(here)} /><Big icon={ICO.export} label="Export" onClick={exportFile} /></Group>
      <Group label="Record"><Big icon={ICO.record} label="Record Screen" disabled menu /></Group>
      <Group label="Publish"><Big icon={ICO.preview} label="Preview" onClick={previewMenu} menu /></Group>
    </>,
    DESIGN: <>
      <Group label="Setup"><Big icon={ICO.size} label="Slide Size" onClick={btn => popup(btn, [['960x540', '16:9 (960 × 540)'], ['720x540', '4:3 (720 × 540)'], ['1280x720', '16:9 large (1280 × 720)'], ['1920x1080', 'Full HD (1920 × 1080)'], ['540x960', 'Phone, portrait (540 × 960)']].map(([v, l]) => ({ label: (v === `${course.size.w}x${course.size.h}` ? '✓ ' : '') + l, act: () => { const [w, h] = v.split('x').map(Number); write(c => { c.size = { w, h }; }); } })))} menu /></Group>
      <Group label="Background"><label className="sl-colorbig"><Svg d={ICO.bg} /><span>Slide color</span><input type="color" value={hex(slide.bg)} onChange={e => setSlideProp('bg', e.target.value)} aria-label="Slide background color" /></label><Big icon={ICO.dup} label="Apply to All" onClick={() => write(c => { allSlides(c).forEach(x => { x.s.bg = slide.bg; }); })} /></Group>
      <Group label="Masters"><Big icon={ICO.result} label="Feedback Master" onClick={() => setDialog('feedback')} /><Big icon={ICO.text} label="Notes Format" onClick={() => setDialog('notes')} /></Group>
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
      <Group label="Show">
        <Big small icon={ICO.size} label="Rulers" on={view.rulers} onClick={() => toggleView('rulers')} />
        <Big small icon={ICO.table} label="Gridlines" on={view.grid} onClick={() => toggleView('grid')} />
        <Big small icon={ICO.fit} label="Snap to Objects" on={view.guides} onClick={() => toggleView('guides')} />
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
      <div className={'cv-holder' + (zoom ? ' zoomed' : '') + (view.rulers ? ' rulers' : '')} ref={holder} onPointerDown={marquee} onContextMenu={stageMenu}>
        <div className="cv-stage-box" style={{ width: course.size.w * k, height: course.size.h * k }}>
          {view.rulers && <Rulers w={course.size.w} h={course.size.h} k={k} sel={obj} />}
          <div className="cv-stage" style={{ width: course.size.w, height: course.size.h, transform: `scale(${k})`, background: slide.bg, fontFamily: course.font, '--k': k }} aria-label={`Slide: ${slide.title}`} role="region">
            {baseUnder && <div className="cv-under">{slide.layers[0].objects.map(o => <div key={o.id} className={'cv-o k-' + o.kind} style={boxStyle(o, lookOf(o))}><ObjArt o={o} vars={vars} assets={course.assets} /></div>)}</div>}
            {layer.objects.map(o => {
              const st = lookState(o), s = lookOf(o, st);
              if (o.hideEdit) return null;
              return (
                <div key={o.id} className={'cv-o k-' + o.kind + (o.id === sel ? ' sel' : chosen.has(o.id) ? ' sel2' : '') + (o.initial === 'hidden' && st === 'normal' ? ' ghost' : '') + (o.locked ? ' locked' : '') + (offAt(o) ? ' tl-off' : '')} style={boxStyle(o, s)}
                  data-name={o.name} data-id={o.id} onPointerDown={e => drag(e, o, 'move')} onContextMenu={e => objMenu(e, o)} onDoubleClick={() => ['text', 'shape', 'button', 'result'].includes(o.kind) && setEditing(o.id)}>
                  {editing === o.id
                    ? <textarea className="cv-edit" autoFocus defaultValue={s.text != null ? s.text : o.text} aria-label="Edit the text" style={{ textAlign: s.align, color: s.color, fontSize: s.size, fontWeight: s.bold ? 700 : 400 }}
                      onPointerDown={e => e.stopPropagation()} onKeyDown={e => { if (e.key === 'Escape') e.currentTarget.blur(); }}
                      onBlur={e => { const v = e.target.value.replace(/\r\n?/g, '\n'); setEditing(null); editObj(x => { if (editState === 'normal') { if (v !== x.text) { x.text = v; delete x.rich; } } else { const st = ((x.states ||= {})[editState] ||= {}); if (v !== st.text) { st.text = v; delete st.rich; } } }); }} />
                    : <ObjArt o={o} st={st} vars={vars} assets={course.assets} />}
                  {o.id === sel && !editing && !o.locked && chosen.size < 2 && ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'].map(h => <i key={h} className={'cv-h h-' + h} onPointerDown={e => drag(e, o, h)} />)}
                </div>
              );
            })}
            {view.grid && <div className="cv-grid" aria-hidden="true" />}
            <div className="cv-guides" ref={guideRef} aria-hidden="true" />
          </div>
        </div>
      </div>
      {panels.bottom && <div className={'sl-bottom' + (bottomFold ? ' folded' : '')} style={bottomFold ? undefined : { height: bottomH }}>
        <div className="sl-bsplit" role="separator" aria-orientation="horizontal" aria-label="Drag to resize the Timeline panel" title="Drag to resize" onPointerDown={resizeBottom} onDoubleClick={() => foldBottom(!bottomFold)} />
        <div className="sl-btabs" role="tablist" aria-label="Slide panels">
          {[['timeline', 'Timeline'], ['states', 'States'], ['format', 'Format'], ['notes', 'Notes']].map(([t, l]) => <button key={t} role="tab" aria-selected={bottom === t} className={bottom === t ? 'on' : ''} onClick={() => { setBottom(t); if (bottomFold) foldBottom(false); }}>{l}</button>)}
          <span className="sl-btabs-sp">{chosen.size > 1 ? `${chosen.size} objects selected` : obj ? `${KINDS[obj.kind]}: ${obj.name}` : `Slide: ${slide.title}`}</span>
          <button className="sl-x" aria-label={bottomFold ? 'Open the Timeline panel' : 'Fold the Timeline panel'} aria-expanded={!bottomFold} title={bottomFold ? 'Open' : 'Fold down to the tabs'} onClick={() => foldBottom(!bottomFold)}>{bottomFold ? '⌃' : '⌄'}</button>
          <button className="sl-x" aria-label="Hide the Timeline panel" title="Hide this panel" onClick={() => togglePanel('bottom', false)}>×</button>
        </div>
        {!bottomFold && <div className="sl-bbody">
          {bottom === 'timeline' && <Timeline slide={slide} layer={layer} sel={sel} chosen={chosen} pick={pick} write={write} inLayer={inLayer} inSlide={inSlide} time={tlTime} setTime={setTlTime} />}
          {bottom === 'states' && <States o={obj} editState={editState} setEditState={setEditState} editObj={editObj} />}
          {bottom === 'format' && (obj ? <ObjFormat o={obj} course={course} layer={layer} editState={editState} setLook={setLook} editObj={editObj} write={write} inLayer={inLayer} setSel={setSel} duplicate={duplicate}
            onPicture={() => { picFor.current = obj.id; picRef.current?.click(); }} onTrigger={() => { const t = { id: rid('t'), event: 'click', source: obj.id, action: 'jump', target: 'next', conds: [] }; write(c => { inLayer(c).triggers.push(t); }); setOpenTrig(t.id); togglePanel('right', true); }} />
            : <SlideFormat slide={slide} write={write} inSlide={inSlide} />)}
          {bottom === 'notes' && <textarea className="sl-notes" style={{ fontFamily: course.notesStyle?.font, fontSize: course.notesStyle?.size, color: course.notesStyle?.color }} value={slide.notes || ''} onChange={e => setSlideProp('notes', e.target.value)} aria-label="Slide notes" placeholder="Notes for this slide (not shown to learners)" />}
        </div>}
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
  const nav = { prev: true, next: true, submit: false, ...(slide.nav || {}) }, swipe = { prev: true, next: true, ...(slide.swipe || {}) };
  const slideProps = (
    <section className="sl-pane" aria-label="Slide Properties">
      <header><h4>Slide Properties</h4></header>
      <div className="sl-pbody sl-props">
        <p className="sl-props-for">Properties for “{sceneNo}.{here.i + 1} {slide.title}”</p>
        <label className="sl-prow"><span>Slide advances:</span><select value={slide.next} onChange={e => setSlideProp('next', e.target.value)} aria-label="Slide advances"><option value="user">By user</option><option value="auto">Automatically</option><option value="question">When the question is answered</option></select></label>
        <label className="sl-prow"><span>When revisiting:</span><select value={slide.revisit || 'auto'} onChange={e => setSlideProp('revisit', e.target.value)} aria-label="When revisiting"><option value="auto">Automatically decide</option><option value="resume">Resume saved state</option><option value="reset">Reset to initial state</option></select></label>
        <h5>Slide navigation and gestures</h5>
        <div className="sl-checks"><span>Buttons:</span>{[['prev', 'Prev'], ['next', 'Next'], ['submit', 'Submit']].map(([k, l]) => <label key={k}><input type="checkbox" checked={!!nav[k]} onChange={e => setSlideProp('nav', { ...nav, [k]: e.target.checked })} aria-label={`${l} button`} />{l}</label>)}</div>
        <div className="sl-checks"><span>Swipe:</span>{[['prev', 'Prev'], ['next', 'Next']].map(([k, l]) => <label key={k}><input type="checkbox" checked={!!swipe[k]} onChange={e => setSlideProp('swipe', { ...swipe, [k]: e.target.checked })} aria-label={`Swipe ${l}`} />{l}</label>)}</div>
        <h5>Player features</h5>
        <select value="defaults" onChange={() => setDialog('player')} aria-label="Player features"><option value="defaults">Player defaults</option><option value="edit">Change the player…</option></select>
        <details className="sl-more"><summary>More</summary>
          <label className="cv-f"><span>Title</span><input value={slide.title} onChange={e => setSlideProp('title', e.target.value)} aria-label="Slide title" /></label>
          <label className="cv-f"><span>Timeline (s)</span><input type="number" min="0" step="0.5" value={slide.duration} onChange={e => setSlideProp('duration', Math.max(0, Number(e.target.value) || 0))} aria-label="Slide timeline" /></label>
          <label className="cv-f"><span>Transition</span><select value={slide.transition?.type || 'none'} onChange={e => setSlideProp('transition', { type: e.target.value, dur: slide.transition?.dur || 0.6 })} aria-label="Transition">{TRANSITIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
        </details>
      </div>
    </section>
  );
  const trigHead = <header><h4>Triggers</h4><span className="sl-hbtns"><button className="sl-x" aria-label="Hide the right panel" title="Hide this panel" onClick={() => togglePanel('right', false)}>×</button></span></header>;

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
        <span className="sl-devices" role="group" aria-label="Preview on a device">
          {[['desktop', 'Desktop', '<rect x="2" y="4" width="16" height="10" rx="1"/><path d="M7 17h6M10 14v3"/>'], ['tablet-l', 'Tablet, landscape', '<rect x="2" y="5" width="16" height="11" rx="1.5"/>'], ['tablet-p', 'Tablet, portrait', '<rect x="4.5" y="2" width="11" height="16" rx="1.5"/>'], ['phone-l', 'Phone, landscape', '<rect x="2" y="7" width="16" height="7" rx="1.5"/>'], ['phone-p', 'Phone, portrait', '<rect x="6.5" y="2" width="7" height="16" rx="1.5"/>']].map(([k, l, d]) => <button key={k} title={`Preview: ${l}`} aria-label={`Preview on ${l.toLowerCase()}`} onClick={() => setDialog({ preview: 'all', device: k })}><svg viewBox="0 0 20 20" aria-hidden="true" dangerouslySetInnerHTML={{ __html: d }} /></button>)}
          <button title="Player" aria-label="Player settings" onClick={() => setDialog('player')}><Svg d={ICO.gear} s={18} /></button>
        </span>
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
              {trigHead}
              <div className="sl-pbody"><Triggers course={course} slide={slide} layer={slide.layers[0]} write={write} inLayer={(c) => inLayer(c, slide.id, slide.layers[0].id)} open={openTrig} setOpen={setOpenTrig} onVars={() => setDialog('vars')} /></div>
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
              {trigHead}
              <div className="sl-pbody"><Triggers course={course} slide={slide} layer={layer} write={write} inLayer={inLayer} open={openTrig} setOpen={setOpenTrig} onVars={() => setDialog('vars')} /></div>
            </section>
            {layersPane}
          </aside>}
        </div>
      )}
      <footer className="sl-status">
        <span>{mode === 'slide' ? `Slide ${flat.findIndex(x => x.s.id === slide.id) + 1} of ${flat.length}` : `Scene ${sceneNo} of ${course.scenes.length}`}</span><span>{course.size.w} × {course.size.h}</span><span>“{slide.title}”</span>
        <span className="sl-views" role="group" aria-label="Views">
          <button className={mode === 'story' ? 'on' : ''} title="Story View" aria-label="Story View" onClick={() => go('story')}>▦</button>
          <button className={mode === 'slide' ? 'on' : ''} title="Slide View" aria-label="Slide View" onClick={() => go('slide')}>▭</button>
          <button title="Preview this slide" aria-label="Preview this slide" onClick={() => setDialog({ preview: slide.id })}>▶</button>
        </span>
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
      {dialog === 'feedback' && <FeedbackDialog course={course} write={write} onClose={() => setDialog(null)} />}
      {dialog === 'notes' && <NotesDialog course={course} write={write} onClose={() => setDialog(null)} />}
      {dialog === 'keys' && <InfoDialog title="Keyboard shortcuts" onClose={() => setDialog(null)} rows={[['Ctrl Z / Ctrl Y', 'Undo / redo'], ['Ctrl C, Ctrl X, Ctrl V', 'Copy, cut, paste an object'], ['Ctrl D', 'Duplicate the object'], ['Arrows (Shift: 10 px)', 'Nudge the object'], ['Delete', 'Delete the object (Story View: the slide)'], ['Double-click', 'Edit text · open a slide from Story View'], ['Enter', 'Story View: open the slide'], ['Alt while dragging', 'Move without snapping'], ['Shift-click · drag a box', 'Select several objects'], ['Ctrl A · Esc', 'Select all · select none'], ['Right-click', 'Arrange, align, lock, add a trigger…'], ['F12', 'Preview the entire project']]} />}
      {dialog === 'import' && <InfoDialog title="What didn’t come over" onClose={() => setDialog(null)} rows={course.importDetails || []} />}
      {dialog === 'help' && <InfoDialog title="How it works" onClose={() => setDialog(null)} rows={[['Story View', 'Every scene and its slides. Double-click a slide to edit it.'], ['Slide View', 'The slide, its layers (right), triggers (right) and the Timeline, States, Format and Notes (below).'], ['Layers', 'Extra parts of a slide shown and hidden by triggers — pop-ups, feedback, details.'], ['States', 'How an object looks when hovered, pressed, selected, visited, disabled, or a state of your own.'], ['Triggers', '“Do this when that happens, if…”: jump, show a layer, change a state, adjust a variable…'], ['Variables', 'Remember things while the course runs; show one in text as %Name%.'], ['Publish', 'One web page, or a SCORM 1.2 zip for an LMS. Export saves a course file to open again.']]} />}
      {dialog?.preview && <Preview course={course} fileId={file.id} what={dialog.preview} device={dialog.device} onClose={() => setDialog(null)} />}
    </div>
  );
}
function FeedbackDialog({ course, write, onClose }) {
  const fb = feedbackOf(course);
  const set = (k, key, v) => write(c => { ((c.feedback ||= {})[k] ||= {})[key] = v; });
  return (
    <Modal title="Feedback Master" onClose={onClose}>
      <p className="cv-note">How every question’s feedback looks: its title and colors. Questions can still write their own feedback text.</p>
      <label className="cv-checks"><span><input type="checkbox" checked={!!course.feedback?.theme} onChange={e => write(c => { (c.feedback ||= {}).theme = e.target.checked; if (e.target.checked) for (const k of ['correct', 'incorrect', 'tryAgain']) if (c.feedback[k]) { delete c.feedback[k].fill; delete c.feedback[k].color; } })} aria-label="Feedback theme colors" /> Use the theme’s colors (the course’s accent)</span></label>
      {[['correct', 'Correct'], ['tryAgain', 'Try again'], ['incorrect', 'Incorrect']].map(([k, l]) => (
        <div key={k} className="cv-fbrow">
          <div className="cv-fbprev" style={{ background: fb[k].fill, color: fb[k].color }}>{fb[k].title || l}</div>
          <Field label={`${l}: title`}><input value={fb[k].title || ''} placeholder={`The question’s own text (e.g. ${l})`} onChange={e => set(k, 'title', e.target.value)} aria-label={`${l} title`} /></Field>
          <Color label={`${l} fill`} value={fb[k].fill.startsWith('#') ? fb[k].fill : '#ffffff'} onChange={v => set(k, 'fill', v)} clear={false} />
          <Color label={`${l} text`} value={fb[k].color} onChange={v => set(k, 'color', v)} clear={false} />
        </div>
      ))}
      <footer className="cv-dlg-f"><button className="btn primary" onClick={onClose}>Done</button></footer>
    </Modal>
  );
}
// Global notes formatting: one look for every slide's notes (in the editor and the player's Notes).
function NotesDialog({ course, write, onClose }) {
  const ns = course.notesStyle || {};
  const set = (k, v) => write(c => { (c.notesStyle ||= {})[k] = v; });
  return (
    <Modal title="Notes Format" onClose={onClose}>
      <p className="cv-note">One format for the notes of every slide.</p>
      <div className="cv-form">
        <Field label="Font" wide><select value={ns.font || ''} onChange={e => set('font', e.target.value || undefined)} aria-label="Notes font"><option value="">The course font</option><option value="Georgia, serif">Georgia</option><option value="Inter, system-ui, sans-serif">Inter</option><option value='"Segoe UI", Roboto, sans-serif'>Segoe UI</option><option value='"Courier New", monospace'>Courier</option></select></Field>
        <div className="cv-row"><Num label="Size (px)" value={ns.size || 14} min={9} onChange={v => set('size', Math.max(9, Math.min(40, v || 14)))} /><Color label="Color" value={ns.color || '#1f2433'} onChange={v => set('color', v)} clear={false} /></div>
        <p className="cv-note" style={{ fontFamily: ns.font, fontSize: ns.size, color: ns.color, border: '1px solid var(--hair)', borderRadius: 8, padding: 10 }}>Notes will look like this.</p>
      </div>
      <footer className="cv-dlg-f"><button className="btn primary" onClick={onClose}>Done</button></footer>
    </Modal>
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
      {textual && <div className="cv-row">
        <Field label="Autofit"><select value={s.autofit || 'none'} onChange={e => setLook('autofit', e.target.value === 'none' ? undefined : e.target.value)} aria-label="Autofit"><option value="none">Do not autofit</option><option value="shrink">Shrink text on overflow</option><option value="shape">Resize shape to fit text</option></select></Field>
        <Field label="Scrollbar if it overflows"><input type="checkbox" checked={!!s.scroll} onChange={e => setLook('scroll', e.target.checked || undefined)} aria-label="Text scrollbar" /></Field>
      </div>}
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
let trigClip = null; // a copied trigger, for Paste
const TB = { new: '<path d="M6 3h7l4 4v10H6z" fill="#fff" stroke="#6b7591"/><path d="M12 10v6M9 13h6" stroke="#17a05b" stroke-width="1.6"/>', edit: '<path d="M6 3h7l4 4v10H6z" fill="#fff" stroke="#6b7591"/><path d="M8.5 14.5l1-3 5-5 2 2-5 5z" fill="#f5b400" stroke="#b07d00" stroke-width=".8"/>', copy: '<rect x="4" y="3" width="9" height="11" fill="#fff" stroke="#6b7591"/><rect x="8" y="7" width="9" height="11" fill="#fff" stroke="#6b7591"/>', paste: '<rect x="4" y="4" width="10" height="13" rx="1" fill="#e9ebf3" stroke="#6b7591"/><rect x="9" y="8" width="8" height="10" fill="#fff" stroke="#3d6fd6"/>', del: '<path d="M6 6h9l-1 11H7z" fill="#fff" stroke="#6b7591"/><path d="M5 6h11M8.5 6V4h4v2" stroke="#6b7591"/>', up: '<path d="M10 5l5 7H5z" fill="#6b7591"/>', down: '<path d="M10 15l5-7H5z" fill="#6b7591"/>', vars: '<rect x="3" y="4" width="14" height="12" rx="1.5" fill="#fff" stroke="#6b7591"/><text x="10" y="13.2" font-size="7.5" font-weight="700" font-family="monospace" text-anchor="middle" fill="#7a45b8">(x)</text>' };
const TBtn = ({ k, label, onClick, disabled }) => <button className="sl-tb" title={label} aria-label={label} onClick={onClick} disabled={disabled}><svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true" dangerouslySetInnerHTML={{ __html: TB[k] }} /></button>;
function Triggers({ course, slide, layer, write, inLayer, open, setOpen, onVars }) {
  const edit = (id, fn) => write(c => { const t = inLayer(c).triggers.find(x => x.id === id); if (t) fn(t); });
  const add = () => { const t = { id: rid('t'), event: 'click', source: layer.objects[0]?.id || '', action: 'jump', target: 'next', conds: [] }; write(c => { inLayer(c).triggers.push(t); }); setOpen(t.id); };
  const selected = layer.triggers.find(t => t.id === open);
  const idx = selected ? layer.triggers.indexOf(selected) : -1;
  const move = dir => write(c => { const l = inLayer(c), i = l.triggers.findIndex(x => x.id === open), j = i + dir; if (i >= 0 && j >= 0 && j < l.triggers.length) [l.triggers[i], l.triggers[j]] = [l.triggers[j], l.triggers[i]]; });
  const remove = () => { if (!selected) return; write(c => { const l = inLayer(c); l.triggers = l.triggers.filter(x => x.id !== open); }); setOpen(null); };
  const paste = () => { if (!trigClip) return; const t = { ...JSON.parse(trigClip), id: rid('t') }; write(c => { inLayer(c).triggers.push(t); }); setOpen(t.id); };
  // Grouped as Storyline shows them: the player's buttons, the slide (or layer), then each object.
  const objOf = id => [...slide.layers.flatMap(l => l.objects)].find(o => o.id === id);
  const groups = [];
  const put = (key, title, t) => { let g = groups.find(x => x.key === key); if (!g) groups.push(g = { key, title, list: [] }); g.list.push(t); };
  for (const t of layer.triggers) {
    if (t.event === 'nextButton' || t.event === 'prevButton' || String(t.target).startsWith('player:')) put('player', 'Player Triggers', t);
    else if (objOf(t.source) && EVENTS.find(e => e[0] === t.event)?.[2] === 'object') put('o:' + t.source, objOf(t.source).name, t);
    else put('slide', layer === slide.layers[0] ? 'Slide Triggers' : `${layer.name} Triggers`, t);
  }
  groups.sort((a, b) => (a.key === 'player' ? -1 : b.key === 'player' ? 1 : a.key === 'slide' ? -1 : b.key === 'slide' ? 1 : 0));
  const row = t => {
    const d = describeTrigger(t, course, slide), i = layer.triggers.indexOf(t);
    return (
      <div key={t.id} className={'cv-trig' + (open === t.id ? ' on' : '')}>
        <button className="cv-trig-h" aria-expanded={open === t.id} onClick={() => setOpen(open === t.id ? null : t.id)}><b>{d.what}</b><span>{d.when}{d.ifs ? ` · if ${d.ifs} condition${d.ifs === 1 ? '' : 's'}` : ''}</span></button>
        {open === t.id && <TriggerForm t={t} course={course} slide={slide} layer={layer} edit={fn => edit(t.id, fn)}
          onMove={dir => write(c => { const l = inLayer(c), j = i + dir; if (j >= 0 && j < l.triggers.length) [l.triggers[i], l.triggers[j]] = [l.triggers[j], l.triggers[i]]; })}
          onDelete={() => write(c => { const l = inLayer(c); l.triggers = l.triggers.filter(x => x.id !== t.id); })} />}
      </div>
    );
  };
  const hasPlayer = groups.some(g => g.key === 'player');
  return (
    <div className="cv-trigs">
      <div className="sl-trigbar" role="toolbar" aria-label="Trigger tools">
        <TBtn k="new" label="New trigger" onClick={add} /><TBtn k="edit" label="Edit trigger" onClick={() => selected && setOpen(open)} disabled={!selected} />
        <TBtn k="copy" label="Copy trigger" onClick={() => { if (selected) trigClip = JSON.stringify(selected); }} disabled={!selected} /><TBtn k="paste" label="Paste trigger" onClick={paste} />
        <TBtn k="del" label="Delete trigger" onClick={remove} disabled={!selected} /><TBtn k="up" label="Move trigger up" onClick={() => move(-1)} disabled={idx <= 0} /><TBtn k="down" label="Move trigger down" onClick={() => move(1)} disabled={idx < 0 || idx >= layer.triggers.length - 1} />
        <span className="sl-tb-sp" /><TBtn k="vars" label="Manage project variables" onClick={onVars} />
      </div>
      {!hasPlayer && layer === slide.layers[0] && (
        <section className="sl-tgroup"><h5>Player Triggers</h5>
          <div className="cv-trig static"><div className="cv-trig-h"><b>Jump to <u>next slide</u></b><span>When the user clicks the next button or swipes next</span></div></div>
          <div className="cv-trig static"><div className="cv-trig-h"><b>Jump to <u>previous slide</u></b><span>When the user clicks the previous button or swipes previous</span></div></div>
        </section>
      )}
      {groups.map(g => <section key={g.key} className="sl-tgroup"><h5>{g.title}</h5>{g.list.map(row)}</section>)}
      {!layer.triggers.length && <p className="cv-empty">No triggers on <b>{layer.name}</b> yet. A trigger is “do <i>this</i> when <i>that</i> happens”: click New trigger above.</p>}
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
// Rulers along the slide's top and left edges, in slide pixels; the selected object's span is marked.
function Rulers({ w, h, k, sel }) {
  const step = [10, 20, 50, 100, 200, 500].find(v => v * k >= 46) || 1000, minor = step / (step % 50 === 0 ? 5 : 2);
  const ticks = (len, horiz) => {
    const out = [];
    for (let v = 0; v <= len + 0.01; v += minor) {
      const major = Math.abs(v / step - Math.round(v / step)) < 1e-6, p = v * k, t = major ? 9 : 4;
      out.push(horiz ? <line key={v} x1={p} x2={p} y1={18 - t} y2={18} /> : <line key={v} y1={p} y2={p} x1={18 - t} x2={18} />);
      if (major && v < len) out.push(horiz ? <text key={'t' + v} x={p + 3} y={9}>{Math.round(v)}</text> : <text key={'t' + v} x={9} y={p + 3} transform={`rotate(-90 9 ${p + 3})`} textAnchor="end">{Math.round(v)}</text>);
    }
    return out;
  };
  return <>
    <svg className="cv-ruler top" width={w * k} height={18} aria-hidden="true">{sel && <rect className="mark" x={sel.x * k} width={sel.w * k} y={0} height={18} />}{ticks(w, true)}</svg>
    <svg className="cv-ruler left" width={18} height={h * k} aria-hidden="true">{sel && <rect className="mark" y={sel.y * k} height={sel.h * k} x={0} width={18} />}{ticks(h, false)}</svg>
    <i className="cv-ruler-corner" aria-hidden="true" />
  </>;
}

/* The Timeline, as in desktop authoring tools: a ruler in seconds, one row per object with its bar (drag it to
   move when it appears, drag its ends to change when it comes and goes), the slide's end (drag it), a playhead
   (click or drag the ruler; Play runs it) that dims what isn't on the slide yet, and eye / lock per object. */
const NAMEW = 230;
function Timeline({ slide, layer, sel, chosen, pick, write, inLayer, inSlide, time, setTime }) {
  const base = layer === slide.layers[0];
  const ends = layer.objects.map(o => (Number(o.start) || 0) + (o.dur ? Number(o.dur) : 0));
  const len = Math.max(0.5, base ? Number(slide.duration) || 0 : 0, ...ends, base ? 0 : 1);
  const track = useRef(null);
  const [pps, setPps] = useState(60); // pixels per second
  useLayoutEffect(() => {
    const el = track.current; if (!el) return undefined;
    const fit = () => setPps(Math.max(24, Math.min(240, (el.clientWidth - NAMEW - 24) / (len + 0.5))));
    fit(); const ro = new ResizeObserver(fit); ro.observe(el); return () => ro.disconnect();
  }, [len]);
  const snap = (v, alt) => Math.max(0, alt ? Math.round(v * 100) / 100 : Math.round(v * 4) / 4);
  const width = (len + 0.5) * pps;
  const step = pps >= 50 ? 1 : pps >= 25 ? 2 : 5;
  const ticks = [];
  for (let t = 0; t <= len + 0.5; t += step / 2) ticks.push(t);
  // Scrub: click or drag the ruler.
  const scrub = e => {
    const r = e.currentTarget.getBoundingClientRect(), to = m => setTime(Math.max(0, Math.min(len, Math.round(((m.clientX - r.left) / pps) * 20) / 20)));
    to(e);
    const up = () => { removeEventListener('pointermove', to); removeEventListener('pointerup', up); };
    addEventListener('pointermove', to); addEventListener('pointerup', up);
  };
  // Play the playhead from where it is (or the start) to the end.
  const [playing, setPlaying] = useState(false);
  const raf = useRef(0);
  useEffect(() => () => cancelAnimationFrame(raf.current), []);
  const play = () => {
    if (playing) { cancelAnimationFrame(raf.current); setPlaying(false); return; }
    const from = time != null && time < len ? time : 0, t0 = performance.now();
    setPlaying(true);
    const tick = now => { const t = from + (now - t0) / 1000; if (t >= len) { setTime(len); setPlaying(false); return; } setTime(t); raf.current = requestAnimationFrame(tick); };
    raf.current = requestAnimationFrame(tick);
  };
  // Drag a bar (move), its left end (start) or right end (how long); the slide's end (base layer).
  const dragBar = (e, o, how) => {
    e.stopPropagation(); e.preventDefault();
    pick(o.id, e.shiftKey || e.ctrlKey || e.metaKey);
    const bar = e.currentTarget.closest('.tl-bar'), sx = e.clientX;
    const st0 = Number(o.start) || 0, du0 = o.dur ? Number(o.dur) : len - st0;
    let st = st0, du = du0, moved = false;
    const mv = m => {
      const d = (m.clientX - sx) / pps; if (!moved && Math.abs(m.clientX - sx) < 3) return; moved = true;
      if (how === 'move') st = snap(st0 + d, m.altKey);
      if (how === 'start') { st = Math.min(snap(st0 + d, m.altKey), st0 + du0 - 0.1); du = du0 + st0 - st; }
      if (how === 'end') du = Math.max(0.1, snap(st0 + du0 + d, m.altKey) - st0);
      bar.style.left = st * pps + 'px'; bar.style.width = Math.max(4, du * pps) + 'px';
      bar.dataset.tip = `${st.toFixed(2)}s – ${(st + du).toFixed(2)}s`;
    };
    const up = () => {
      removeEventListener('pointermove', mv); removeEventListener('pointerup', up); delete bar.dataset.tip;
      if (!moved) return;
      write(c => {
        const x = inLayer(c).objects.find(q => q.id === o.id); if (!x) return;
        const end = st + du, slideEnd = base ? Number(inSlide(c).duration) || 0 : len;
        x.start = Math.round(st * 100) / 100;
        // To the end of the slide: no fixed length (it stays to the end if the slide gets longer).
        if (how === 'move' && !o.dur) x.dur = null; else x.dur = Math.abs(end - Math.max(slideEnd, len)) < 0.05 ? null : Math.round(du * 100) / 100;
        if (base && end > slideEnd) inSlide(c).duration = Math.round(end * 100) / 100;
      });
    };
    addEventListener('pointermove', mv); addEventListener('pointerup', up);
  };
  const dragEnd = e => {
    e.stopPropagation(); e.preventDefault();
    const sx = e.clientX, d0 = Number(slide.duration) || 0, el = e.currentTarget, min = Math.max(0.5, ...ends);
    let d = d0;
    const mv = m => { d = Math.max(min, snap(d0 + (m.clientX - sx) / pps, m.altKey)); el.style.left = d * pps + 'px'; el.dataset.tip = d.toFixed(2) + 's'; };
    const up = () => { removeEventListener('pointermove', mv); removeEventListener('pointerup', up); delete el.dataset.tip; if (d !== d0) write(c => { inSlide(c).duration = d; }); };
    addEventListener('pointermove', mv); addEventListener('pointerup', up);
  };
  const flip = (o, key) => write(c => { const x = inLayer(c).objects.find(q => q.id === o.id); if (x) { if (x[key]) delete x[key]; else x[key] = true; } });
  const set = (id, key, v) => write(c => { const o = inLayer(c).objects.find(x => x.id === id); if (o) o[key] = v; });
  const o = sel && layer.objects.find(x => x.id === sel);
  const fmt = t => (t >= 60 ? `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}` : `${Math.round(t * 100) / 100}s`);
  return (
    <div className="tl">
      <div className="tl-scroll" ref={track}>
        <div className="tl-grid" style={{ width: NAMEW + width + 16 }}>
          <div className="tl-head">
            <span className="tl-hn" style={{ width: NAMEW }}>
              <button className="tl-play" onClick={play} aria-label={playing ? 'Pause the timeline' : 'Play the timeline'} title={playing ? 'Pause' : 'Play the slide’s timeline'}>{playing ? '❚❚' : '▶'}</button>
              {time != null && <button className="tl-play" onClick={() => { cancelAnimationFrame(raf.current); setPlaying(false); setTime(null); }} aria-label="Stop the playhead" title="Stop: show every object">■</button>}
              <span className="tl-now">{time != null ? fmt(time) : '0s'} / {fmt(len)}</span>
            </span>
            <div className="tl-ruler" style={{ width }} onPointerDown={scrub} role="slider" aria-label="Playhead" aria-valuemin={0} aria-valuemax={len} aria-valuenow={time ?? 0} tabIndex={0}
              onKeyDown={e => { if (e.key === 'ArrowRight') setTime(Math.min(len, (time ?? 0) + 0.25)); if (e.key === 'ArrowLeft') setTime(Math.max(0, (time ?? 0) - 0.25)); }}>
              {ticks.map(t => <i key={t} className={Math.abs(t / step - Math.round(t / step)) < 1e-6 ? 'maj' : ''} style={{ left: t * pps }}>{Math.abs(t / step - Math.round(t / step)) < 1e-6 ? fmt(t) : ''}</i>)}
            </div>
          </div>
          <div className="tl-rows">
            {[...layer.objects].reverse().map(x => {
              const st = Number(x.start) || 0, du = x.dur ? Number(x.dur) : len - st, on = chosen.has(x.id);
              return (
                <div key={x.id} className={'tl-row' + (x.id === sel ? ' on' : on ? ' on2' : '') + (x.hideEdit ? ' hid' : '')}>
                  <span className="tl-name" style={{ width: NAMEW }}>
                    <button className={'tl-ic' + (x.hideEdit ? ' off' : '')} aria-label={`${x.hideEdit ? 'Show' : 'Hide'} “${x.name}” while editing`} aria-pressed={!x.hideEdit} onClick={() => flip(x, 'hideEdit')}>{x.hideEdit ? '◌' : '👁'}</button>
                    <button className={'tl-ic' + (x.locked ? ' lk' : ' off')} aria-label={`${x.locked ? 'Unlock' : 'Lock'} “${x.name}”`} aria-pressed={!!x.locked} onClick={() => flip(x, 'locked')}>{x.locked ? '🔒' : '🔓'}</button>
                    <button className="tl-n" onClick={e => pick(x.id, e.shiftKey || e.ctrlKey || e.metaKey)} title={x.name}><em>{KINDS[x.kind]?.[0] || '•'}</em>{x.name}</button>
                  </span>
                  <div className="tl-track" style={{ width }} onPointerDown={e => { if (e.target === e.currentTarget) pick(x.id); }}>
                    <div className={'tl-bar' + (x.anim && x.anim !== 'none' ? ' anim' : '')} style={{ left: st * pps, width: Math.max(4, du * pps) }} onPointerDown={e => dragBar(e, x, 'move')} title={`${fmt(st)} – ${fmt(st + du)}${x.anim && x.anim !== 'none' ? ` · comes in: ${x.anim}` : ''}`}>
                      <i className="tl-gl" onPointerDown={e => dragBar(e, x, 'start')} aria-hidden="true" />
                      <span>{x.anim && x.anim !== 'none' ? '★ ' : ''}{x.name}</span>
                      <i className="tl-gr" onPointerDown={e => dragBar(e, x, 'end')} aria-hidden="true" />
                    </div>
                  </div>
                </div>
              );
            })}
            {!layer.objects.length && <p className="cv-empty" style={{ marginLeft: NAMEW }}>No objects on this layer yet.</p>}
          </div>
          {base && <div className="tl-end" style={{ left: NAMEW + len * pps }} onPointerDown={dragEnd} title="End of the slide: drag to change its length" aria-hidden="true" />}
          {time != null && <div className="tl-head-line" style={{ left: NAMEW + time * pps }} aria-hidden="true" />}
        </div>
      </div>
      {o ? (
        <div className="tl-form">
          <b className="tl-fn" title={o.name}>{o.name}</b>
          <label>Appears at <input type="number" min="0" step="0.25" value={o.start || 0} onChange={e => set(o.id, 'start', Math.max(0, Number(e.target.value) || 0))} aria-label="Appears at (s)" />s</label>
          <label>Shown for <input type="number" min="0" step="0.25" value={o.dur ?? ''} placeholder="to end" onChange={e => set(o.id, 'dur', Number(e.target.value) || null)} aria-label="Shown for (s, blank: to the end)" />s</label>
          <label>Comes in <select value={o.anim || 'none'} onChange={e => set(o.id, 'anim', e.target.value)} aria-label="Entrance animation">{ANIMS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
          <label>Goes out <select value={o.out || 'none'} onChange={e => set(o.id, 'out', e.target.value === 'none' ? undefined : e.target.value)} aria-label="Exit animation"><option value="none">Just goes</option><option value="fade">Fade out</option></select></label>
          {base && <label className="tl-len">Slide length <input type="number" min="0" step="0.5" value={slide.duration} onChange={e => write(c => { inSlide(c).duration = Math.max(Math.max(0, ...ends), Number(e.target.value) || 0); })} aria-label="Slide length (s)" />s</label>}
        </div>
      ) : <div className="tl-form tl-tip"><span>{base ? <>Timeline of <b>{slide.title}</b></> : <>Layer <b>{layer.name}</b>: starts when it’s shown</>}. Drag a bar to move it, its ends to change how long it shows; click the ruler to see that moment.</span>{base && <label className="tl-len">Slide length <input type="number" min="0" step="0.5" value={slide.duration} onChange={e => write(c => { inSlide(c).duration = Math.max(Math.max(0, ...ends), Number(e.target.value) || 0); })} aria-label="Slide length (s)" />s</label>}</div>}
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
          {[['title', 'Title bar'], ['menu', 'Menu of slides'], ['freeNav', 'Learners may jump to any slide in the menu'], ['seekbar', 'Seekbar and play / pause'], ['prevNext', 'Prev and Next buttons'], ['resume', 'Offer to carry on where they left off'], ['notes', 'Notes (each slide’s notes, beside the slide)']].map(([kk, l]) => <label key={kk}><input type="checkbox" checked={p[kk] !== false && !!p[kk]} onChange={() => tog(kk)} />{l}</label>)}
          <label><input type="checkbox" checked={p.sharpText !== false} onChange={() => write(c => { c.player.sharpText = c.player.sharpText === false; })} />Better font scaling (text stays sharp at any player size)</label>
          <label><input type="checkbox" checked={!!course.quiz.lockRevisit} onChange={() => write(c => { c.quiz.lockRevisit = !c.quiz.lockRevisit; })} />Disable navigation within a question when it’s revisited (answers can’t change)</label>
        </div>
        <div className="cv-row">
          <Color label="Accent color" value={course.accent} onChange={v => write(c => { c.accent = v === 'transparent' ? '#4f5bd5' : v; })} clear={false} />
          <Num label="Pass mark (%)" value={course.quiz.pass} min={0} onChange={v => write(c => { c.quiz.pass = Math.max(0, Math.min(100, v || 0)); })} />
          <Num label="Player font scale (%)" value={p.fontScale || 100} min={50} onChange={v => write(c => { c.player.fontScale = Math.max(50, Math.min(200, v || 100)); })} />
        </div>
        <Field label="Size" wide><select value={`${course.size.w}x${course.size.h}`} onChange={e => { const [w, h] = e.target.value.split('x').map(Number); write(c => { c.size = { w, h }; }); }} aria-label="Slide size"><option value="960x540">16:9 (960 × 540)</option><option value="720x540">4:3 (720 × 540)</option><option value="1280x720">16:9 large (1280 × 720)</option><option value="540x960">Phone, portrait (540 × 960)</option></select></Field>
        <Field label="In an LMS, the course is complete when" wide><select value={course.complete} onChange={e => write(c => { c.complete = e.target.value; })} aria-label="Completion"><option value="viewed">Every slide has been seen</option><option value="quiz">The quiz is passed</option></select></Field>
      </div>
      <footer className="cv-dlg-f"><button className="btn primary" onClick={onClose}>Done</button></footer>
    </Modal>
  );
}
function Preview({ course, fileId, what, device = 'desktop', onClose }) {
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
      <div className={'cv-device dev-' + device}><iframe key={n} className="cv-preview" title="Course preview" srcDoc={html} sandbox="allow-scripts allow-popups" allow="fullscreen" /></div>
      <footer className="cv-dlg-f"><span className="cv-note">{what === 'all' ? 'The whole course' : what.startsWith('scene:') ? 'This scene' : 'This slide'}, as learners will see it.</span><button className="btn" onClick={() => setN(x => x + 1)}>Replay</button><button className="btn primary" onClick={onClose}>Close preview</button></footer>
    </Modal>
  );
}
