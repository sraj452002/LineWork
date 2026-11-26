import { useEffect, useState } from 'react';
import { nodeDef } from '../lib/flows.js';
import { Mark } from './RunViews.jsx';

/* A run, told for anyone (Home › Run): no tables, timings or item counts. A big badge in the middle shows
   the step being worked on, with ripples while it works; a line says what it's doing in plain words; a bar
   fills and the finished steps gather underneath as little ticks. At the end: a big tick and “All done!”, or
   “Something needs your attention” with the one thing to fix. Steps that didn't run (a branch not taken)
   aren't shown at all. “Show all steps” lists them, for the curious.
     steps: [{ n: node, i, st: idle|pending|active|success|error|skipped|unreached, r }] */

const word = n => (n === 1 ? 'step' : 'steps');
// How long it took, in words: “in under a second”, “in 1.8 seconds”.
const took = secs => { const v = parseFloat(secs); return !secs || Number.isNaN(v) ? '' : v < 1 ? ' in under a second' : ` in ${v.toFixed(1)} seconds`; };
export function FriendlyRun({ steps, run, done, title, secs, failed, onReplay, onResult, onFix, wantsInput, last, onWatch, waiting, onEdit }) {
  const [all, setAll] = useState(false);
  const doneSteps = steps.filter(s => s.st === 'success');
  const active = steps.find(s => s.st === 'active');
  const seen = steps.filter(s => s.st !== 'skipped' && s.st !== 'unreached');
  const playedTo = steps.reduce((m, s, i) => (s.st !== 'pending' && s.st !== 'idle' ? i + 1 : m), 0);
  const pct = !run ? 0 : done ? 100 : Math.round((playedTo / Math.max(1, steps.length)) * 100);
  // Step numbers: each step's place in the run (1, 2, 3…), counting only the ones that run.
  const no = new Map(seen.map((s, i) => [s.n.id, i + 1]));
  const total = seen.length, at = active ? no.get(active.n.id) || doneSteps.length + 1 : 0;
  const state = !run ? 'idle' : !done ? 'active' : run.status === 'success' ? 'success' : 'error';
  // A clock while it runs: seconds since it started, ticking.
  // (From when it started playing here, so Watch again counts from 0 too.)
  const [now, setNow] = useState(Date.now()), [t0, setT0] = useState(Date.now());
  useEffect(() => {
    if (state !== 'active') return undefined;
    setT0(Date.now()); setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 100); return () => clearInterval(t);
  }, [state, run?.id]);
  const clock = state === 'active' ? Math.max(0, (now - t0) / 1000).toFixed(1) + 's' : '';
  // The track: every step that runs as a stop on a line, a light running along it to the step at work.
  // Long workflows show a window of 9 stops around the current one.
  const stops = steps.filter(s => s.st !== 'skipped' && s.st !== 'unreached');
  const cur = Math.max(0, stops.findIndex(s => s.st === 'active' || s.st === 'error'));
  const from = stops.length <= 9 ? 0 : Math.min(Math.max(0, cur - 4), stops.length - 9);
  const shownStops = stops.slice(from, from + 9);
  const reached = state === 'success' ? shownStops.length - 1 : state === 'idle' ? -1 : shownStops.findIndex(s => s.st === 'active' || s.st === 'error' || s.st === 'pending' || s.st === 'idle');
  const fill = shownStops.length < 2 ? (state === 'success' ? 100 : 0) : (Math.max(0, reached === -1 && state !== 'idle' ? shownStops.length - 1 : reached) / (shownStops.length - 1)) * 100;
  // The step's error in words: a service's JSON answer ({"detail": "…"}) comes down to its message.
  const err = (() => {
    const e = failed && run?.nodes?.[failed.id]?.error;
    if (!e) return e;
    const m = String(e).match(/\{.*\}/s);
    if (m) { try { const j = JSON.parse(m[0]); const msg = j.detail || j.message || j.error?.message || j.error || j.title; if (typeof msg === 'string') return String(e).replace(m[0], msg).replace(/\s*answered \d{3}:\s*/, ': '); } catch (x) { /* not JSON */ } }
    return e;
  })();
  const say = state === 'idle' ? 'Ready when you are'
    : state === 'active' ? (active ? `${active.n.name}…` : 'Getting started…')
    : state === 'success' ? (waiting ? 'Your turn: edit the file' : 'All done!') : 'Something needs your attention';
  const sub = state === 'idle' ? <>Press <b>Run</b> to start “{title}”.{wantsInput ? ' It asks a few questions first.' : ''}</>
    : state === 'active' ? <><b className="fr-of">Step {at || doneSteps.length + 1} of {total}</b> · {doneSteps.length} finished{clock && <> · <span className="fr-clock">{clock}</span></>}</>
    : state === 'success' && waiting ? <>“{waiting}” is waiting for you. Save &amp; continue to finish the run.</>
    : state === 'success' ? <>Finished {doneSteps.length} {word(doneSteps.length)}{took(secs)}.</>
    : <>“{failed?.name || 'A step'}” couldn’t finish{err ? `: ${err.replace(/^[^:]+: /, '')}` : '.'}</>;
  return (
    <div className={'fr st-' + state}>
      <div className="fr-stage">
        {/* Before a run: an anime-style “READY!” moment. (Run is in the toolbar.) */}
        {state === 'idle' && <AnimeIdle />}
        {state !== 'idle' && <div className={'fr-orb st-' + state} aria-hidden="true">
          <i className="fr-ring r1" /><i className="fr-ring r2" /><i className="fr-ring r3" />
          <span className="fr-orbit"><i /><i /><i /></span>
          {state === 'active' && <span className="fr-arc" />}
          {state === 'active' && at > 0 && <em className="fr-stepno" key={'n' + at}>{at}<small>/{total}</small></em>}
          {/* a happy end: sparks flying out from the tick */}
          {state === 'success' && <span className="fr-burst" key={'b' + run?.id}>{Array.from({ length: 10 }, (_, k) => <i key={k} style={{ '--a': `${k * 36}deg`, '--d': `${(k % 3) * 40}ms` }} />)}</span>}
          <span className={'fr-core' + (state === 'active' && active?.n.type === 'core.delay' ? ' is-wait' : '')} key={state + (active?.n.id || '')}>
            {state === 'success' ? <svg className="fr-ic fr-ic-ok" viewBox="0 0 52 52"><path d="M14.5 27.5l7.5 7.5 16-17" /></svg>
              : state === 'error' ? <svg className="fr-ic fr-ic-err" viewBox="0 0 52 52"><path d="M26 13.5v16" /><path className="fr-dot" d="M26 37.5v.5" /></svg>
              : active ? <Mark type={active.n.type} size={38} /> : <i className="ws-spin" />}
          </span>
        </div>}
        <div className="rs-headline fr-text" aria-live="polite">
          <b key={say} className="fr-say">{say}</b>
          <small className="fr-sub">{sub}</small>
        </div>
        <div className={'fr-track st-' + state} role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="How far it has got" style={{ '--n': shownStops.length }}>
          <div className="fr-line"><i style={{ width: `${fill}%` }}>{state === 'active' && <b className="fr-spark" />}</i></div>
          <ol>
            {from > 0 && <li className="fr-more-l" aria-hidden="true">+{from}</li>}
            {shownStops.map(s => (
              <li key={s.n.id} className={'fr-stop st-' + s.st} title={s.n.name}>
                <span className="fr-dot"><Mark type={s.n.type} size={14} />{s.st === 'success' && <em aria-hidden="true">✓</em>}</span>
                <small>{s.n.name}</small>
              </li>
            ))}
            {from + 9 < stops.length && <li className="fr-more-r" aria-hidden="true">+{stops.length - from - 9}</li>}
          </ol>
        </div>
        {state === 'active' ? <div className="fr-ticker" /> : (state === 'success' || state === 'error') && doneSteps.length > 0 ? (
          // Over: one tidy summary of what finished; it opens the full list.
          <button className={'fr-stack' + (all ? ' on' : '')} onClick={() => setAll(!all)} aria-expanded={all} title={all ? 'Hide the steps' : 'See every step'}>
            <span className="fr-faces" aria-hidden="true">{doneSteps.slice(0, 6).map(s => <Mark key={s.n.id} type={s.n.type} size={12} />)}{doneSteps.length > 6 && <em>+{doneSteps.length - 6}</em>}</span>
            <b>{doneSteps.length} {word(doneSteps.length)} finished</b><i aria-hidden="true">{all ? '▴' : '▾'}</i>
          </button>
        ) : <div className="fr-ticker" />}
        {state === 'idle' && last && (
          // The last run, kept quiet: when, how it went and who started it, to watch again if wanted.
          <p className={'fr-last s-' + last.status}><i aria-hidden="true">{last.status === 'success' ? '✓' : last.status === 'error' ? '!' : '…'}</i>Last run {last.when} {last.status === 'success' ? 'finished' : last.status === 'error' ? 'stopped' : 'is running'} · started by {last.by}<button className="link" onClick={onWatch}>Watch it</button></p>
        )}
        <div className="fr-acts">
          {state === 'success' && waiting && <button className="btn primary" onClick={onEdit}>✎ Open the editor</button>}
          {state === 'success' && !waiting && <><button className="btn primary" onClick={onResult}>See the result</button><button className="btn" onClick={onReplay}>↺ Watch again</button></>}
          {state === 'error' && <><button className="btn primary" onClick={onFix}>Fix it</button><button className="btn" onClick={onReplay}>↺ Watch again</button></>}
        </div>
      </div>
      {state === 'idle' && <button className="fr-all link" onClick={() => setAll(!all)} aria-expanded={all}>{all ? 'Hide the steps' : `Show all ${seen.length} ${word(seen.length)}`}</button>}
      {all && (
        <ol className="fr-list">
          {seen.map(s => <li key={s.n.id} className={'st-' + s.st}><i className="fr-no">{no.get(s.n.id)}</i><Mark type={s.n.type} size={12} /><span>{s.n.name}</span><small>{nodeDef(s.n.type).label}</small><b>{s.st === 'success' ? '✓' : s.st === 'error' ? '!' : s.st === 'active' ? '…' : ''}</b></li>)}
        </ol>
      )}
    </div>
  );
}

/* Before a run: an anime-style “READY!” moment, flat 2D. Manga speed lines rush in to the middle, a
   gold comic burst with READY! pulses, kira-kira sparkles pop, sakura petals drift across, and now and
   then an impact flash. Original art, made of plain shapes. */
const BURST = (() => { const p = []; for (let i = 0; i < 24; i++) { const a = (i / 24) * Math.PI * 2, r = i % 2 ? 46 : 70; p.push(`${(140 + Math.cos(a) * r * 1.35).toFixed(1)},${(100 + Math.sin(a) * r).toFixed(1)}`); } return p.join(' '); })();
const SPEED = Array.from({ length: 44 }, (_, i) => { const a = (i / 44) * Math.PI * 2 + (i % 3) * .03, r1 = 96 + (i % 4) * 8; return { x1: 140 + Math.cos(a) * 190, y1: 100 + Math.sin(a) * 150, x2: 140 + Math.cos(a) * r1 * 1.3, y2: 100 + Math.sin(a) * r1, w: i % 3 ? 1.2 : 2.6, d: (i % 5) * .12 }; });
const KIRA = 'M0 -10 C1 -2 2 -1 10 0 C2 1 1 2 0 10 C-1 2 -2 1 -10 0 C-2 -1 -1 -2 0 -10Z';
const PETAL = 'M0 -7 C5 -6 6 2 0 7 C-6 2 -5 -6 0 -7Z';
function AnimeIdle() {
  return (
    <svg className="an" viewBox="0 0 280 200" aria-hidden="true">
      <defs><clipPath id="an-clip"><rect x="0" y="0" width="280" height="200" rx="22" /></clipPath></defs>
      <g clipPath="url(#an-clip)">
        <rect x="0" y="0" width="280" height="200" className="an-bg" />
        <g className="an-speed">{SPEED.map((l, i) => <line key={i} x1={l.x1} y1={l.y1} x2={l.x2} y2={l.y2} strokeWidth={l.w} style={{ animationDelay: `${l.d}s` }} />)}</g>
        <rect x="0" y="0" width="280" height="200" className="an-flash" />
        <g className="an-burst">
          <polygon points={BURST} className="an-burst-back" transform="translate(5 6)" />
          <polygon points={BURST} className="an-burst-front" />
          <text x="140" y="112" className="an-word an-word-back">READY!</text>
          <text x="140" y="112" className="an-word">READY!</text>
        </g>
        {[[44, 40, 0, 1], [236, 52, .5, .8], [222, 158, 1.1, 1.1], [56, 156, 1.6, .7], [140, 24, 2.1, .6]].map(([x, y, d, k], i) => (
          <g key={i} transform={`translate(${x} ${y}) scale(${k})`}><path d={KIRA} className="an-kira" style={{ animationDelay: `${d}s` }} /></g>
        ))}
        {[[0, 0], [1, 1.3], [2, 2.6], [3, .7], [4, 2]].map(([i, d]) => (
          <g key={'p' + i} className="an-petal-path" style={{ animationDelay: `-${d}s`, '--py': `${20 + i * 34}px` }}><path d={PETAL} className="an-petal" style={{ animationDelay: `-${d}s` }} /></g>
        ))}
      </g>
      <rect x="1.5" y="1.5" width="277" height="197" rx="21" className="an-frame" />
    </svg>
  );
}
