import { useRef, useState } from 'react';
import { rid } from '../lib/utils.js';
import { dg } from '../lib/engines.js';
import { allSlides, newCourse, quizCourse, readCourse, sampleCourse } from '../lib/course.js';
import { Thumb } from './CourseArt.jsx';

/* Home → Course Studio: e-learning courses in one place. Start a course (blank, the sample or a quiz), import
   one (a course file, a published course page or a SCORM zip), and open the courses you've made. */

const ago = t => { const s = (Date.now() - t) / 1000; return s < 60 ? 'just now' : s < 3600 ? `${Math.floor(s / 60)} min ago` : s < 86400 ? `${Math.floor(s / 3600)} h ago` : `${Math.floor(s / 86400)} d ago`; };
// What a Storyline import brought over.
const pl = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
export const storyNote = r => {
  if (r.objects == null) return `Imported from ${r.from === 'story' ? 'the .story file' : 'the published Storyline course'}: ${pl(r.scenes, 'scene')}, ${pl(r.slides, 'slide')}, ${r.texts} piece${r.texts === 1 ? '' : 's'} of text and ${pl(r.pictures, 'picture')}. Triggers, states, layers and animations don’t come over: add them again here.`;
  const dropped = Object.values(r.dropped || {}).reduce((a, b) => a + b, 0);
  const parts = [`${pl(r.scenes, 'scene')}, ${pl(r.slides, 'slide')}, ${pl(r.layers, 'layer')}, ${pl(r.objects, 'object')} with their states, timing and text formatting, ${pl(r.pictures, 'picture')}, ${pl(r.triggers, 'trigger')}${r.questions ? `, ${pl(r.questions, 'quiz question')}` : ''}${r.notes ? ` and the notes of ${pl(r.notes, 'slide')}` : ''}`];
  const left = [];
  if (r.dead) left.push(`${pl(r.dead, 'trigger')} that do nothing in Storyline either (turned off, or pointing at something no longer in the file) were left out`);
  if (r.unsupported) left.push(`${pl(r.unsupported, 'trigger')} this player can’t run yet`);
  if (dropped) left.push(`${pl(dropped, 'object')} of a kind not supported yet`);
  if (r.picturesSkipped) left.push(`${pl(r.picturesSkipped, 'picture')} that didn’t fit (a course keeps about 1.5 MB of pictures)`);
  const check = r.total != null ? (r.accounted ? ` All ${r.total} triggers in the file are accounted for.` : ` Check: ${r.total} triggers in the file, ${r.triggers + (r.copies || 0) + r.dead + r.unsupported} accounted for.`) : '';
  return `Imported: ${parts[0]}.${left.length ? ' Not imported: ' + left.join('; ') + '.' : ' Everything in the file came over.'}${check}`;
};
// The details of what didn't come over, for the editor's Details dialog.
export const storyDetails = r => [
  ...Object.entries(r.skips || {}).map(([k, n]) => [k.replace(/^dead: /, 'Left out — ').replace(/^unsupported: /, 'Not supported yet — '), `${n} trigger${n === 1 ? '' : 's'}`]),
  ...Object.entries(r.dropped || {}).map(([k, n]) => [`Object kind “${k}”`, `${n} not imported`]),
  ...(r.picturesSkipped ? [['Pictures over the size limit', `${r.picturesSkipped}`]] : []),
  ...Object.entries(r.where || {}).map(([slide, kinds]) => [`On “${slide}”`, kinds.map(k => k.replace(/^dead: /, 'left out: ').replace(/^unsupported: /, 'not supported: ')).join('; ')]),
];
// The ways to start: a tone and a simple glyph each (drawn white on a tile in that tone).
const START = [
  ['blank', 'Blank course', 'One title slide, ready for your own', '#4f7cf7', '<rect x="3" y="5" width="18" height="12" rx="2"/><path d="M12 8.5v5M9.5 11h5M9 21h6M12 17v4"/>'],
  ['sample', 'Interactive sample', 'A typed name, click-to-reveal layers, a quiz and results', '#14a37f', '<rect x="3" y="5" width="18" height="12" rx="2"/><path d="M7 9h3v3H7zM14 9h3v3h-3zM9 21h6M12 17v4"/>'],
  ['quiz', 'Quiz', 'Question slides and a results slide, with a pass mark', '#f08a24', '<circle cx="12" cy="12" r="9"/><path d="M9.6 9.3a2.5 2.5 0 1 1 3.4 2.3c-.7.3-1 .8-1 1.6v.4M12 17h.01"/>'],
  ['import', 'Import a course', 'Storyline .story or zip, SCORM zip, a course file or a published page', '#7c5cf6', '<path d="M12 3v12M7 10l5 5 5-5M5 21h14"/>'],
];

export default function CourseStudio({ files, q = '', onCreate, onOpen }) {
  const [err, setErr] = useState('');
  const [note, setNote] = useState('');
  const pick = useRef(null);
  const make = (title, course) => { const now = Date.now(); onCreate({ id: rid('f'), title, created: now, updated: now, doc: '', diagrams: [dg('architecture', 'Diagram 1', '')], active: 0, view: 'course', course }); };
  const start = k => {
    setErr('');
    if (k === 'blank') make('Course', newCourse('Course'));
    else if (k === 'sample') make('Workplace safety basics', sampleCourse());
    else if (k === 'quiz') make('Quiz', quizCourse());
    else pick.current?.click();
  };
  const importFile = async f => {
    if (!f) return;
    setErr('');
    setNote('Reading the file…');
    try {
      const { imported, ...c } = await readCourse(f);
      setNote('');
      make(c.title || 'Imported course', imported ? { ...c, importNote: storyNote(imported), importDetails: storyDetails(imported) } : c);
    } catch (e) { setNote(''); setErr(e.message || 'That file couldn’t be opened.'); }
  };
  const ql = q.trim().toLowerCase();
  const courses = files.filter(f => f.course && !f.archived && (!ql || (f.title || '').toLowerCase().includes(ql))).sort((a, b) => b.updated - a.updated);
  return (
    <section className="cs" aria-label="Course Studio">
      <header className="cs-hero">
        <div className="cs-hero-txt">
          <span className="cs-kicker">Course Studio</span>
          <h2>Build e-learning that people enjoy</h2>
          <p>Scenes and slides, layers, states, triggers, variables and quizzes. Preview it in the player, publish a web page or a SCORM package for any LMS, and bring in your Storyline courses.</p>
          <div className="cs-hero-acts">
            <button className="btn cs-hero-go" onClick={() => start('blank')}>＋ New course</button>
            <button className="btn cs-hero-alt" onClick={() => start('import')}>Import .story or SCORM</button>
          </div>
        </div>
        <div className="cs-hero-stats" aria-label="Your courses in numbers">
          <div><b>{courses.length}</b><span>course{courses.length === 1 ? '' : 's'}</span></div>
          <div><b>{courses.reduce((a, f) => a + allSlides(f.course).length, 0)}</b><span>slides</span></div>
        </div>
        <svg className="cs-hero-art" viewBox="0 0 220 150" aria-hidden="true"><rect x="20" y="18" width="150" height="96" rx="12" /><rect x="50" y="40" width="150" height="96" rx="12" /><path d="M70 64h70M70 80h100M70 96h54" /><circle cx="178" cy="112" r="14" /><path d="M172 112l4 4 8-8" /></svg>
      </header>
      <h3 className="cs-h">Start a course</h3>
      <div className="cs-start">
        {START.map(([k, name, note, tone, icon]) => (
          <button key={k} className="cs-new" style={{ '--tone': tone }} onClick={() => start(k)}>
            <i className="cs-ico"><svg viewBox="0 0 24 24" width="24" height="24" fill="none" aria-hidden="true" dangerouslySetInnerHTML={{ __html: icon }} /></i>
            <b>{name}</b><span>{note}</span>
          </button>
        ))}
        <input ref={pick} type="file" hidden accept=".json,.html,.htm,.zip,.story,application/json,text/html,application/zip" aria-label="Course to import" onChange={e => { importFile(e.target.files[0]); e.target.value = ''; }} />
      </div>
      {err && <p className="rev-err" role="alert">{err}</p>}
      {note && !err && <p className="cs-note" role="status">{note}</p>}
      <h3 className="cs-h">Your courses <small>{courses.length}</small></h3>
      {courses.length ? (
        <div className="cs-grid">
          {courses.map(f => {
            const first = allSlides(f.course)[0]?.s;
            const n = allSlides(f.course).length;
            return (
              <button key={f.id} className="cs-card" onClick={() => onOpen(f.id)} aria-label={`Open the course ${f.title}`}>
                <span className="cs-thumb">{first ? <Thumb slide={first} course={f.course} /> : <div className="cv-thumb" />}<em>{n} slide{n === 1 ? '' : 's'}</em><i className="cs-open" aria-hidden="true">Open ›</i></span>
                <b>{f.title || 'Untitled course'}</b>
                <span>{f.course.scenes.length} scene{f.course.scenes.length === 1 ? '' : 's'} · edited {ago(f.updated)}</span>
              </button>
            );
          })}
        </div>
      ) : <p className="cs-empty">{ql ? 'No course matches that.' : 'No courses yet. Start one above, or import one.'}</p>}
    </section>
  );
}
