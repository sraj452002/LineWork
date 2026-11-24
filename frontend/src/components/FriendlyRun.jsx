import { useState } from 'react';
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
export function FriendlyRun({ steps, run, done, title, secs, failed, onReplay, onResult, onFix, wantsInput, last, onWatch }) {
  const [all, setAll] = useState(false);
  const doneSteps = steps.filter(s => s.st === 'success');
  const active = steps.find(s => s.st === 'active');
  const seen = steps.filter(s => s.st !== 'skipped' && s.st !== 'unreached');
  const playedTo = steps.reduce((m, s, i) => (s.st !== 'pending' && s.st !== 'idle' ? i + 1 : m), 0);
  const pct = !run ? 0 : done ? 100 : Math.round((playedTo / Math.max(1, steps.length)) * 100);
  const state = !run ? 'idle' : !done ? 'active' : run.status === 'success' ? 'success' : 'error';
  const err = failed && run?.nodes?.[failed.id]?.error;
  const say = state === 'idle' ? 'Ready when you are'
    : state === 'active' ? (active ? `${active.n.name}…` : 'Getting started…')
    : state === 'success' ? 'All done!' : 'Something needs your attention';
  const sub = state === 'idle' ? <>Press <b>Run</b> to start “{title}”.{wantsInput ? ' It asks a few questions first.' : ''}</>
    : state === 'active' ? <>Working on it · {doneSteps.length} {word(doneSteps.length)} finished</>
    : state === 'success' ? <>Finished {doneSteps.length} {word(doneSteps.length)}{took(secs)}.</>
    : <>“{failed?.name || 'A step'}” couldn’t finish{err ? `: ${err.replace(/^[^:]+: /, '')}` : '.'}</>;
  return (
    <div className={'fr st-' + state}>
      <div className="fr-stage">
        <div className={'fr-orb st-' + state} aria-hidden="true">
          <i className="fr-ring r1" /><i className="fr-ring r2" /><i className="fr-ring r3" />
          <span className="fr-orbit"><i /><i /><i /></span>
          {state === 'active' && <span className="fr-arc" />}
          {/* a happy end: sparks flying out from the tick */}
          {state === 'success' && <span className="fr-burst" key={'b' + run?.id}>{Array.from({ length: 10 }, (_, k) => <i key={k} style={{ '--a': `${k * 36}deg`, '--d': `${(k % 3) * 40}ms` }} />)}</span>}
          <span className="fr-core" key={state + (active?.n.id || '')}>
            {state === 'success' ? <svg className="fr-ic fr-ic-ok" viewBox="0 0 52 52"><path d="M14.5 27.5l7.5 7.5 16-17" /></svg>
              : state === 'error' ? <svg className="fr-ic fr-ic-err" viewBox="0 0 52 52"><path d="M26 13.5v16" /><path className="fr-dot" d="M26 37.5v.5" /></svg>
              : state === 'idle' ? <svg className="fr-play" width="36" height="36" viewBox="0 0 24 24"><path d="M8.5 5.5l10 6.5-10 6.5z" /></svg>
              : active ? <Mark type={active.n.type} size={38} /> : <i className="ws-spin" />}
          </span>
        </div>
        <div className="rs-headline fr-text" aria-live="polite">
          <b key={say} className="fr-say">{say}</b>
          <small className="fr-sub">{sub}</small>
        </div>
        <div className="fr-bar" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="How far it has got"><i style={{ width: `${pct}%` }} /></div>
        {state === 'active' ? (
          // While it runs: one line of finished steps, the newest sliding in on the right, the oldest fading out.
          <div className="fr-ticker" aria-label="Finished steps"><ul>
            {doneSteps.slice(-8).map(s => <li key={s.n.id} className="fr-tick"><Mark type={s.n.type} size={11} /><span>{s.n.name}</span><b>✓</b></li>)}
          </ul></div>
        ) : (state === 'success' || state === 'error') && doneSteps.length > 0 ? (
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
          {state === 'success' && <><button className="btn primary" onClick={onResult}>See the result</button><button className="btn" onClick={onReplay}>↺ Watch again</button></>}
          {state === 'error' && <><button className="btn primary" onClick={onFix}>Fix it</button><button className="btn" onClick={onReplay}>↺ Watch again</button></>}
        </div>
      </div>
      {state === 'idle' && <button className="fr-all link" onClick={() => setAll(!all)} aria-expanded={all}>{all ? 'Hide the steps' : `Show all ${seen.length} ${word(seen.length)}`}</button>}
      {all && (
        <ol className="fr-list">
          {seen.map(s => <li key={s.n.id} className={'st-' + s.st}><Mark type={s.n.type} size={12} /><span>{s.n.name}</span><small>{nodeDef(s.n.type).label}</small><b>{s.st === 'success' ? '✓' : s.st === 'error' ? '!' : s.st === 'active' ? '…' : ''}</b></li>)}
        </ol>
      )}
    </div>
  );
}
