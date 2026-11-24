import { Fragment, useEffect, useState } from 'react';
import { nodeDef } from '../lib/flows.js';
import { Mark, itemsOf } from './RunViews.jsx';

/* The run sheet (Home › Run): a run as a table of its steps, like a CI job or the browser's network panel.
     steps: [{ n: node, i, st: idle|pending|active|success|error|skipped|unreached, r: the run's result for it }]
   A heat strip on top shows where the time went (one segment per step that ran, as wide as it took, warmer
   the slower); each row sits on a rail of numbered dots and has the step, a status pill, what it passed on
   and a bar on the shared timeline in the same heat; a row unfolds to its output. Steps that didn't run fold
   into one row. While a run plays back, rows fill in one by one. RunStats sums it up above. */

const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
export const fmtMs = v => (v == null ? '' : v < 1000 ? `${v} ms` : `${(v / 1000).toFixed(1)} s`);
const ran = st => st === 'success' || st === 'error';

// When each step started on the shared timeline, how long the whole run took, and the slowest step.
function timeline(steps) {
  let t = 0, max = 0;
  const start = steps.map(s => { const at = t; if (ran(s.st)) { const m = Math.max(1, s.r?.ms || 0); t += m; max = Math.max(max, s.r?.ms || 0); } return at; });
  return { start, total: Math.max(t, 1), max: Math.max(max, 1) };
}
// A step's heat: teal when quick, amber, then coral for the slowest.
export function heat(ms, max) {
  const t = Math.min(1, Math.max(0, (ms || 0) / max));
  const h = t < .5 ? 168 - (168 - 38) * (t / .5) : 38 - (38 - 6) * ((t - .5) / .5);
  return `hsl(${Math.round(h)} 72% 56%)`;
}
// Rows to draw: steps, with runs of steps that didn't run (once it's over) folded into one.
function rowsOf(steps, done) {
  const rows = [];
  for (const s of steps) {
    const quiet = done && (s.st === 'skipped' || s.st === 'unreached');
    const last = rows[rows.length - 1];
    if (quiet && last?.group) last.steps.push(s);
    else rows.push(quiet ? { group: true, steps: [s], key: 'g' + s.n.id } : { step: s, key: s.n.id });
  }
  return rows;
}

/* The figures above the sheet: how long, how many ran, what came out, the slowest step. */
export function RunStats({ steps, run, done, total, secs, out }) {
  const ranSteps = steps.filter(s => ran(s.st));
  const slow = ranSteps.reduce((m, s) => ((s.r?.ms || 0) > (m?.r?.ms || -1) ? s : m), null);
  const { max } = timeline(steps);
  const tiles = [
    ['Duration', run ? (done ? secs || fmtMs(ranSteps.reduce((n, s) => n + (s.r?.ms || 0), 0)) : '…') : '—', 'Time'],
    ['Steps ran', run ? <>{ranSteps.length}<small> / {total}</small></> : <>0<small> / {total}</small></>, 'Steps'],
    ['Items out', run && done ? out : '—', 'Items'],
    ['Slowest step', slow && (slow.r?.ms || 0) > 0 ? <span className="ws-slow" style={{ '--h': heat(slow.r.ms, max) }}><Mark type={slow.n.type} size={12} /><b>{slow.n.name}</b><small>{fmtMs(slow.r.ms)}</small></span> : '—', 'Slow'],
  ];
  return (
    <div className="ws-stats">
      {tiles.map(([label, value, k]) => <div key={k} className={'ws-stat ws-stat-' + k.toLowerCase()}><small>{label}</small><b>{value}</b></div>)}
    </div>
  );
}

export function TimingStrip({ steps, run }) {
  const { total, max } = timeline(steps);
  return (
    <div className={'ws-strip' + (run ? '' : ' idle')} aria-hidden="true">
      {steps.map(s => {
        const ms = s.r?.ms || 0, w = ran(s.st) ? Math.max(1, ms) : s.st === 'active' ? total * .06 : 0;
        if (!w && run) return null;
        const wide = run && ran(s.st) && w / total > .12;
        return (
          <i key={s.n.id} className={'st-' + s.st} style={{ flexGrow: run ? w : 1, '--h': s.st === 'error' ? 'var(--err)' : heat(ms, max) }} title={`${s.n.name}${s.r?.ms != null ? ` · ${fmtMs(s.r.ms)}` : ''}`}>
            {wide && <span>{s.n.name} · {fmtMs(ms)}</span>}
          </i>
        );
      })}
    </div>
  );
}

export function RunSheet({ steps, run, done, onCopy }) {
  const [open, setOpen] = useState({});
  const { start, total, max } = timeline(steps);
  const rows = rowsOf(steps, done);
  const activeId = steps.find(s => s.st === 'active')?.n.id;
  const slowest = steps.filter(s => ran(s.st)).reduce((m, s) => ((s.r?.ms || 0) > (m?.r?.ms || 0) ? s : m), null)?.n.id;
  // Keep the step playing in view.
  useEffect(() => { if (activeId) document.getElementById('ws-row-' + activeId)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }, [activeId]);
  useEffect(() => { setOpen({}); }, [run?.id]);
  const toggle = k => setOpen(o => ({ ...o, [k]: !o[k] }));
  return (
    <div className="ws-sheet" role="table" aria-label="Steps">
      <div className="ws-head" role="row">
        <span role="columnheader">#</span><span role="columnheader">Step</span><span role="columnheader">Status</span><span role="columnheader">Items</span><span role="columnheader">Timeline</span><span role="columnheader" className="ws-r">Time</span>
      </div>
      <div className="ws-rows" role="rowgroup">
        {rows.map(row => {
          if (row.group) {
            const n = row.steps.length, branch = row.steps.every(s => s.st === 'skipped');
            return (
              <Fragment key={row.key}>
                <button className="ws-row ws-group" role="row" onClick={() => toggle(row.key)} aria-expanded={!!open[row.key]}>
                  <span className="ws-rail"><i className="ws-node ws-node-fold">{n}</i></span>
                  <span className="ws-step"><span className="ws-stack">{row.steps.slice(0, 5).map(s => <Mark key={s.n.id} type={s.n.type} size={11} />)}</span><b>{plural(n, 'step')} didn’t run</b><em className="ws-tag">{branch ? 'branch not taken' : 'stopped before these'}</em></span>
                  <span className="ws-sub">steps {row.steps[0].i + 1}{n > 1 ? `–${row.steps[n - 1].i + 1}` : ''}</span><span />
                  <span className="ws-track"><i className="ws-dash" /></span><span className="ws-r ws-chev">{open[row.key] ? 'Hide ▴' : 'Show ▾'}</span>
                </button>
                {open[row.key] && row.steps.map(s => <Row key={s.n.id} s={s} start={start[s.i]} total={total} max={max} quiet />)}
              </Fragment>
            );
          }
          const s = row.step;
          return <Row key={row.key} s={s} start={start[s.i]} total={total} max={max} slowest={s.n.id === slowest && done} open={!!open[row.key]} onToggle={() => s.r && toggle(row.key)} onCopy={onCopy} />;
        })}
      </div>
    </div>
  );
}

const PILL = { success: ['✓', 'Done'], error: ['✕', 'Failed'], active: [null, 'Running'], skipped: ['↷', 'Skipped'], unreached: ['·', 'Didn’t run'], pending: ['', 'Waiting'], idle: ['', ''] };
function Row({ s, start, total, max, slowest, open, onToggle = () => {}, onCopy, quiet }) {
  const d = nodeDef(s.n.type), items = itemsOf(s.r), ms = s.r?.ms || 0;
  const left = (start / total) * 100, width = ran(s.st) ? Math.max(.9, (ms / total) * 100) : 0;
  const text = s.r && s.st === 'success' ? JSON.stringify(items.length === 1 ? items[0] : items.slice(0, 50), null, 2) : '';
  const [ic, label] = PILL[s.st] || ['', ''];
  return (
    <>
      <button id={'ws-row-' + s.n.id} className={'ws-row st-' + s.st + (quiet ? ' quiet' : '') + (open ? ' open' : '')} role="row" onClick={onToggle} aria-expanded={s.r && !quiet ? open : undefined} disabled={!s.r || quiet}
        style={{ '--h': s.st === 'error' ? 'var(--err)' : heat(ms, max) }}>
        <span className="ws-rail"><i className="ws-node">{s.i + 1}</i></span>
        <span className="ws-step"><Mark type={s.n.type} size={14} /><b>{s.n.name}</b><small>{d.label}</small></span>
        <span className="ws-status">{label && <em className="ws-pill">{s.st === 'active' ? <i className="ws-spin" /> : ic && <i>{ic}</i>}{label}</em>}</span>
        <span className="ws-items">{s.st === 'success' && <em className="ws-count"><i className="ws-stackico" />{s.r.items}</em>}</span>
        <span className="ws-track">
          {ran(s.st) && <i className="ws-bar" style={{ left: `${left}%`, width: `${width}%` }} />}
          {s.st === 'active' && <i className="ws-bar ws-live" style={{ left: `${left}%` }} />}
          {slowest && ms > 0 && <em className="ws-hot" style={{ left: `calc(${left + width}% + 6px)` }}>🔥 slowest</em>}
        </span>
        <span className="ws-r ws-time">{ran(s.st) ? fmtMs(ms) : s.st === 'active' ? '…' : ''}</span>
      </button>
      {s.st === 'error' && <div className="ws-error" role="row"><span /><span>{s.r?.error}</span></div>}
      {open && s.st === 'success' && (
        <div className="ws-detail" role="row">
          <div className="ws-detail-head"><small>{plural(items.length, 'item')} passed on{items.length > 50 ? ' (the first 50 shown)' : ''}</small><button className="rv-copy" onClick={() => onCopy(JSON.stringify(items, null, 2))}>Copy</button></div>
          <pre>{text}</pre>
        </div>
      )}
    </>
  );
}
