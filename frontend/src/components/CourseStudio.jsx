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
export const storyNote = r => (r.objects != null
  ? `Imported from the .story file: ${pl(r.scenes, 'scene')}, ${pl(r.slides, 'slide')}, ${pl(r.layers, 'layer')}, ${pl(r.objects, 'object')} (with their states and timing), ${pl(r.pictures, 'picture')} and ${pl(r.triggers, 'trigger')}.${r.picturesSkipped ? ` ${pl(r.picturesSkipped, 'picture')} didn’t fit (a course keeps about 1.5 MB of pictures, so the browser can save it) — add them again with Insert → Picture.` : ''}${r.skipped ? ` ${pl(r.skipped, 'trigger')} couldn’t be carried over (quiz, media, player and built-in-variable triggers): add those again here.` : ''} Audio, video and quiz interactions don’t come over.`
  : `Imported from ${r.from === 'story' ? 'the .story file' : 'the published Storyline course'}: ${pl(r.scenes, 'scene')}, ${pl(r.slides, 'slide')}, ${r.texts} piece${r.texts === 1 ? '' : 's'} of text and ${pl(r.pictures, 'picture')}. Triggers, states, layers and animations don’t come over: add them again here.`);
const START = [
  ['blank', 'Blank course', 'One title slide, ready for your own', '<rect x="5" y="8" width="38" height="26" rx="3" fill="#fff" stroke="#2b6fd6" stroke-width="2"/><path d="M24 15v12M18 21h12" stroke="#17a05b" stroke-width="3" stroke-linecap="round"/><path d="M18 40h12M24 34v6" stroke="#6b7591" stroke-width="2"/>'],
  ['sample', 'Interactive sample', 'A typed name, click-to-reveal layers, a quiz and results', '<rect x="5" y="8" width="38" height="26" rx="3" fill="#eef3ff" stroke="#2b6fd6" stroke-width="2"/><rect x="10" y="14" width="8" height="8" rx="2" fill="#17a05b"/><rect x="20" y="14" width="8" height="8" rx="2" fill="#e5484d"/><rect x="30" y="14" width="8" height="8" rx="2" fill="#f5a623"/><path d="M18 40h12M24 34v6" stroke="#6b7591" stroke-width="2"/>'],
  ['quiz', 'Quiz', 'Question slides and a results slide, with a pass mark', '<rect x="7" y="6" width="34" height="36" rx="4" fill="#fff4dc" stroke="#d99a00" stroke-width="2"/><path d="M19 19a5 5 0 1 1 7.5 4.3c-1.6 1-2.5 2-2.5 4.2" stroke="#b07d00" stroke-width="3" fill="none" stroke-linecap="round"/><circle cx="24" cy="33.5" r="2.2" fill="#b07d00"/>'],
  ['import', 'Import a course', 'A Storyline .story file or published zip, a course file (.json), a page (.html) or a SCORM zip', '<path d="M10 5h19l9 9v29H10z" fill="#fff" stroke="#6b7591" stroke-width="2"/><path d="M24 17v15M17 25l7 7 7-7" stroke="#2b6fd6" stroke-width="3" fill="none" stroke-linecap="round"/>'],
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
      make(c.title || 'Imported course', imported ? { ...c, importNote: storyNote(imported) } : c);
    } catch (e) { setNote(''); setErr(e.message || 'That file couldn’t be opened.'); }
  };
  const ql = q.trim().toLowerCase();
  const courses = files.filter(f => f.course && !f.archived && (!ql || (f.title || '').toLowerCase().includes(ql))).sort((a, b) => b.updated - a.updated);
  return (
    <section className="cs" aria-label="Course Studio">
      <header className="cs-hero">
        <div>
          <h2>Course Studio</h2>
          <p>Interactive e-learning: scenes and slides, layers, states, triggers, variables and quizzes. Preview it in the player, publish it as a web page or a SCORM package for any LMS, and import or export course files.</p>
        </div>
      </header>
      <h3 className="cs-h">Start a course</h3>
      <div className="cs-start">
        {START.map(([k, name, note, icon]) => (
          <button key={k} className="cs-new" onClick={() => start(k)}>
            <svg viewBox="0 0 48 48" width="44" height="44" fill="none" aria-hidden="true" dangerouslySetInnerHTML={{ __html: icon }} />
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
                {first ? <Thumb slide={first} course={f.course} /> : <div className="cv-thumb" />}
                <b>{f.title || 'Untitled course'}</b>
                <span>{f.course.scenes.length} scene{f.course.scenes.length === 1 ? '' : 's'} · {n} slide{n === 1 ? '' : 's'} · {ago(f.updated)}</span>
              </button>
            );
          })}
        </div>
      ) : <p className="cs-empty">{ql ? 'No course matches that.' : 'No courses yet. Start one above, or import one.'}</p>}
    </section>
  );
}
