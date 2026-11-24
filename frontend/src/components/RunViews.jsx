import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { CRED_TYPES, inputPaths, nodeDef, runFields } from '../lib/flows.js';
import { LOGOS } from '../lib/flowlogos.js';

/* Ways to watch a workflow run (Home › Run, RunHub.jsx), fed the same thing:
     steps: [{ n: node, i, st: idle|pending|active|success|error|skipped|unreached, r: the run's result for it }]
   Trail    icons only: the steps wind across the stage like a trail, threaded in run order by a line a
            comet travels along as the run plays; each icon lights up as its step finishes. Hover a step
            for its name and result, click it for what it gave. Stays compact for long workflows.
   Console  a terminal: a line per step that spins, then ticks, unfolding to its output.
   HowToRun the ways a workflow starts, in plain steps, from its triggers and what it still needs. */

const dark = hex => { const n = parseInt(hex.slice(1), 16); return ((n >> 16) * 299 + ((n >> 8) & 255) * 587 + (n & 255) * 114) / 1000 < 60; };
export function Mark({ type, size = 16, title }) {
  const d = nodeDef(type), logo = d.logo && LOGOS[d.logo];
  return (
    <i className={'rh-mark t-' + d.tone} title={title}>
      <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" className={logo ? 'logo' : ''} style={logo ? { fill: dark(logo.color) ? 'var(--ink)' : logo.color } : undefined}><path d={logo ? logo.d : d.icon} /></svg>
    </i>
  );
}
export const itemsOf = r => Object.values(r?.output || {}).flat();
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
const STEP_MS = 650;

/* ---- Trail: icons only ---- */
const TILE = 58, GAP_X = 34, GAP_Y = 38, PAD = 34, TOP = 78; // TOP: room for the first row's names
function placeTrail(count, width) {
  const cols = Math.max(2, Math.floor((width - PAD * 2 + GAP_X) / (TILE + GAP_X)));
  const used = Math.min(cols, count), rows = Math.ceil(count / cols);
  const left = (width - (used * TILE + (used - 1) * GAP_X)) / 2;
  const pts = Array.from({ length: count }, (_, i) => {
    const r = Math.floor(i / cols), c = r % 2 ? cols - 1 - (i % cols) : i % cols; // back and forth, row by row
    return { x: left + c * (TILE + GAP_X) + TILE / 2, y: TOP + r * (TILE + GAP_Y) + TILE / 2, r };
  });
  // The line through them in order: straight along a row, a round bend down to the next.
  let d = pts.length ? `M${pts[0].x} ${pts[0].y}` : '';
  const ends = [];
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    if (a.r === b.r) d += `L${b.x} ${b.y}`;
    else { const out = (a.r % 2 ? -1 : 1) * (TILE / 2 + GAP_X * .9); d += `C${a.x + out * 1.6} ${a.y} ${b.x + out * 1.6} ${b.y} ${b.x} ${b.y}`; }
    ends.push(d);
  }
  return { pts, d, ends, height: TOP + PAD + rows * TILE + (rows - 1) * GAP_Y };
}
const stLabel = s => (s.st === 'success' ? `${plural(s.r?.items ?? 0, 'item')}${s.r?.ms != null ? ` · ${s.r.ms} ms` : ''}` : s.st === 'error' ? s.r?.error || 'failed' : s.st === 'active' ? 'running…' : s.st === 'skipped' ? 'skipped: nothing reached it' : s.st === 'unreached' ? 'didn’t run' : nodeDef(s.n.type).label);

export function TrailView({ steps, run, done, onPick, picked }) {
  const box = useRef(null), path = useRef(null), comet = useRef(null), at = useRef(0), measure = useRef(null);
  const [width, setWidth] = useState(800);
  useLayoutEffect(() => {
    const el = box.current; if (!el) return undefined;
    const ro = new ResizeObserver(([e]) => setWidth(Math.round(e.contentRect.width)));
    ro.observe(el); setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);
  const { pts, d, ends, height } = placeTrail(steps.length, width);
  // How far along the trail the run is: up to the step playing now (or all of it when it's over).
  const lastLit = steps.reduce((m, s, i) => (s.st === 'success' || s.st === 'error' || s.st === 'skipped' ? i : m), -1);
  const activeAt = steps.findIndex(s => s.st === 'active');
  const target = !run ? 0 : activeAt >= 0 ? activeAt : done ? steps.length - 1 : Math.max(0, lastLit);
  const [len, setLen] = useState({ total: 1, lit: 0 });
  // The comet glides along the line to the step playing now (the length of the line up to a step is
  // measured on a hidden path that stops there).
  useEffect(() => {
    const p = path.current, m = measure.current; if (!p || !m) return undefined;
    const total = p.getTotalLength() || 1;
    let to = 0;
    if (run && target > 0) { m.setAttribute('d', ends[target - 1]); to = m.getTotalLength(); }
    const from = Math.min(at.current, total);
    let raf, t0;
    const step = t => {
      t0 ??= t;
      const k = Math.min(1, (t - t0) / (STEP_MS * .9)), e = k < .5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2, now = from + (to - from) * e;
      at.current = now; setLen({ total, lit: now });
      const q = p.getPointAtLength(now); if (comet.current) comet.current.setAttribute('transform', `translate(${q.x} ${q.y})`);
      if (k < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target, run?.id, d]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className={'rv-trail' + (run ? done ? ' over s-' + run.status : ' live' : ' idle')} ref={box}>
      <svg className="rv-trail-svg" width={width} height={height} aria-hidden="true">
        <defs><radialGradient id="rvComet"><stop offset="0" stopColor="#fff" /><stop offset=".35" stopColor="var(--rv-c)" /><stop offset="1" stopColor="transparent" /></radialGradient></defs>
        <path d={d} className="rv-trail-base" />
        <path ref={path} d={d} className="rv-trail-lit" style={{ strokeDasharray: `${len.lit} ${len.total + 10}` }} />
        <path ref={measure} d="M0 0" fill="none" stroke="none" />
        {run && !done && <g ref={comet}><circle r="16" fill="url(#rvComet)" /><circle r="4" className="rv-comet-core" /></g>}
      </svg>
      <ol className="rv-tiles" style={{ height }} aria-label="Steps">
        {steps.map((s, i) => {
          const p = pts[i]; if (!p) return null;
          return (
            <li key={s.n.id} className={'rv-tile st-' + s.st + (picked === s.n.id ? ' picked' : '')} style={{ left: p.x - TILE / 2, top: p.y - TILE / 2, '--d': `${(i % 12) * 0.08}s` }}>
              <button disabled={!s.r} onClick={() => onPick(s.n.id)} aria-label={`Step ${i + 1}: ${s.n.name}, ${stLabel(s)}`}>
                <Mark type={s.n.type} size={24} />
                <span className="rv-badge" aria-hidden="true">{s.st === 'success' ? '✓' : s.st === 'error' ? '!' : s.st === 'skipped' ? '–' : ''}</span>
                <span className="rv-num" aria-hidden="true">{i + 1}</span>
              </button>
              <span className="rv-tip" role="tooltip"><b>{s.n.name}</b><small>{nodeDef(s.n.type).label}</small><em>{stLabel(s)}</em></span>
            </li>
          );
        })}
      </ol>
      {!run && <p className="rv-trail-hint">Each icon is a step, in the order they run. Hover one for its name; press Run and watch the trail light up.</p>}
    </div>
  );
}

/* ---- Console ---- */
export function ConsoleView({ steps, run, done, title, secs }) {
  const [open, setOpen] = useState({});
  const body = useRef(null);
  const shownSteps = run ? steps.filter(s => s.st !== 'pending' && s.st !== 'unreached') : [];
  useEffect(() => { if (body.current) body.current.scrollTop = body.current.scrollHeight; }, [shownSteps.length, done]);
  const pad = Math.max(12, ...steps.map(s => s.n.name.length)) + 2;
  return (
    <div className="rv-console" role="log" aria-label="Run log">
      <div className="rv-con-bar"><i /><i /><i /><span>run — {title}</span></div>
      <div className="rv-con-body" ref={body}>
        <div className="rv-line rv-prompt"><span className="rv-ps">$</span> workline run "{title}"{!run && <span className="rv-cursor" />}</div>
        {!run && <div className="rv-line rv-dim"># press Run to start</div>}
        {shownSteps.map(s => (
          <div key={s.n.id}>
            <button className={'rv-line rv-step st-' + s.st} onClick={() => s.r && setOpen(o => ({ ...o, [s.n.id]: !o[s.n.id] }))} aria-expanded={!!open[s.n.id]}>
              <span className="rv-ic">{s.st === 'success' ? '✔' : s.st === 'error' ? '✖' : s.st === 'skipped' ? '↷' : <span className="rv-spin" />}</span>
              <span className="rv-nm">{s.n.name.padEnd(pad, ' ')}</span>
              <span className="rv-meta">{s.st === 'success' ? `${plural(s.r.items, 'item')}`.padEnd(10, ' ') + `${s.r.ms ?? 0}ms` : s.st === 'error' ? 'failed' : s.st === 'skipped' ? 'skipped' : 'running…'}</span>
            </button>
            {(open[s.n.id] || s.st === 'error') && s.r && (
              <pre className={'rv-out' + (s.st === 'error' ? ' err' : '')}>{s.st === 'error' ? `  error: ${s.r.error}` : JSON.stringify(itemsOf(s.r).length === 1 ? itemsOf(s.r)[0] : itemsOf(s.r).slice(0, 20), null, 2).split('\n').map(l => '  ' + l).join('\n')}</pre>
            )}
          </div>
        ))}
        {done && <div className={'rv-line rv-final ' + (run.status === 'success' ? 'ok' : 'bad')}>{run.status === 'success' ? `✔ done in ${secs || '0.0 s'}` : `✖ failed: ${run.error || 'see above'}`}</div>}
        {run && done && <div className="rv-line"><span className="rv-ps">$</span><span className="rv-cursor" /></div>}
      </div>
    </div>
  );
}

export const VIEWS = [['trail', 'Trail'], ['console', 'Console']];

/* ---- How to run it ---- */
const every = p => (p.mode === 'daily' ? `every day at ${p.at || '09:00'} UTC` : p.mode === 'cron' ? `on the schedule “${p.cron || ''}” (UTC)` : `every ${p.every || 15} ${p.unit || 'minutes'}`);
const Copy = ({ text, onCopy }) => <button className="rv-copy" onClick={() => onCopy(text)}>Copy</button>;
const Url = ({ url, onCopy, open }) => <span className="rv-url"><code>{url}</code><Copy text={url} onCopy={onCopy} />{open && <a className="rv-copy" href={url} target="_blank" rel="noreferrer">Open</a>}</span>;
export function HowToRun({ flow, active, onCopy, onFix, onActive }) {
  const origin = typeof location !== 'undefined' ? location.origin : '';
  const triggers = flow.nodes.filter(n => nodeDef(n.type).trigger);
  // Steps that can't run yet: they need an account and have none picked.
  const needs = flow.nodes.filter(n => { const d = nodeDef(n.type); return d.credential && !d.optionalCredential && !n.credential; });
  const noLink = <>Open it in the editor once to get its address.</>;
  const ways = triggers.map(n => {
    const d = nodeDef(n.type), p = n.params || {}, url = p.path ? `${origin}/api/hook/${p.path}` : '';
    const on = <>Turn the workflow <b>Active</b> (the switch at the top).</>;
    if (n.type === 'trigger.manual') {
      const fields = runFields(p.fields);
      return { n, title: 'Run it by hand', steps: [
        <>Press <b>▶ Run</b> above.</>,
        fields.length ? <>A form asks for: <span className="rv-chips">{fields.map(f => <span key={f.key} className="rv-chip">{f.name}{f.required ? '*' : ''}{f.kind !== 'text' ? <small> {f.kind === 'yesno' ? 'yes/no' : f.kind}</small> : null}</span>)}</span> Fill it in and press <b>Run</b>.</> : <>No input needed: it starts straight away.</>,
        <>Each step fills in on the left as it runs; the result shows in the Result tab.</>,
      ] };
    }
    if (n.type === 'trigger.webhook') {
      const keys = inputPaths(flow, n.id).map(k => k.replace(/^body\./, '')).filter(k => !/[.\s]/.test(k)).slice(0, 4);
      const body = JSON.stringify(Object.fromEntries((keys.length ? keys : ['name']).map(k => [k, k === 'email' ? 'asha@example.com' : 'Asha'])));
      const curl = `curl -X ${p.method && p.method !== 'ANY' ? p.method : 'POST'} "${url}" -H "content-type: application/json" -d '${body}'`;
      return { n, title: 'Call its web address (webhook)', needsActive: true, steps: [on, url ? <>Send a request to <Url url={url} onCopy={onCopy} /></> : noLink, url && <>From a terminal, for example: <Url url={curl} onCopy={onCopy} /></>, <>Each call starts a run; it shows under Recent runs.</>].filter(Boolean) };
    }
    if (n.type === 'trigger.schedule') return { n, title: 'On a schedule', needsActive: true, steps: [on, <>It runs by itself {every(p)}, while the Workline server is running.</>, <>To try it now, press <b>▶ Run</b>.</>] };
    if (n.type === 'trigger.form') return { n, title: 'From its web form', needsActive: true, steps: [on, url ? <>Open (or share) its form: <Url url={url} onCopy={onCopy} open /></> : noLink, <>Every time someone sends the form, it runs with their answers.</>] };
    if (n.type === 'trigger.chat') return { n, title: 'From its chat page', needsActive: true, steps: [on, url ? <>Open its chat: <Url url={url} onCopy={onCopy} open /></> : noLink, <>Each message runs it; the answer shows as the reply.</>] };
    if (n.type === 'trigger.page') return { n, title: 'As a web page', needsActive: true, steps: [on, url ? <>Open the page: <Url url={url} onCopy={onCopy} open /></> : noLink, <>Each visit runs it and draws the page.</>] };
    if (n.type === 'trigger.error') return { n, title: 'When another workflow fails', needsActive: true, steps: [on, <>It runs by itself whenever one of your active workflows fails, with what went wrong.</>] };
    if (n.type === 'trigger.workflow') return { n, title: 'From another workflow', steps: [<>In another workflow, add <b>Run another workflow</b> and pick this one.</>, <>It runs with that workflow’s items and hands back what its last steps give.</>] };
    if (d.hook) return { n, title: `When ${d.label.replace(/ \(.*\)$/, '')} sends an event`, needsActive: true, steps: [on, url ? <>Paste this address into the app as its webhook: <Url url={url} onCopy={onCopy} /></> : noLink, <>The step’s <b>?</b> guide in the editor says where that goes in the app.</>] };
    if (d.poll) return { n, title: d.label, needsActive: true, steps: [on, <>It checks {p.every ? `every ${p.every} minute${Number(p.every) === 1 ? '' : 's'}` : 'every few minutes'} and runs once for each new one.</>, <>To try it now, press <b>▶ Run</b>.</>] };
    return { n, title: d.label, steps: [<>Press <b>▶ Run</b> to start it.</>] };
  });
  return (
    <div className="rv-howto">
      {!triggers.length && <p className="rv-warn">It has no trigger, so nothing starts it. Open it in the editor and add <b>Run by hand</b> (or a Webhook or Schedule).</p>}
      {ways.map(w => (
        <div key={w.n.id} className="rv-way">
          <header><Mark type={w.n.type} size={14} /><b>{w.title}</b>{w.needsActive && <button className={'rv-pill' + (active ? ' on' : '')} onClick={onActive} title={active ? 'Active: click to turn it off' : 'Click to turn it Active'}>{active ? '● Active' : '○ Not active'}</button>}</header>
          <ol>{w.steps.map((s, i) => <li key={i}>{s}</li>)}</ol>
        </div>
      ))}
      {needs.length > 0 && (
        <div className="rv-way rv-needs">
          <header><b>Before it can run</b></header>
          <ul>{needs.map(n => <li key={n.id}><Mark type={n.type} size={12} /><span>Connect an account for <b>{n.name}</b> ({nodeDef(n.type).credential.map(c => CRED_TYPES[c]?.label || c).join(' or ')}).</span><button className="rv-copy" onClick={() => onFix(n.id)}>Fix</button></li>)}</ul>
        </div>
      )}
    </div>
  );
}
