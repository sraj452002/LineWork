import { useEffect, useMemo, useState } from 'react';
import { audioSupported, sound, startMusic, stopMusic } from '../lib/guideAudio.js';

/* Animated video guides: a little film of the app, drawn here (no video file), with a cursor that moves
   and clicks, captions, chapters and play / pause. Each guide is a stage of parts (a node, a string, a
   panel…) placed in percent of a 16:9 stage, and steps that turn parts on or off, move the cursor, light
   nodes up and make data run along the strings. Sizes are in container units, so it scales with its box.

   A step: { cap, ms, cur: [x, y], click, on: [ids], off: [ids], st: {nodeId: 'run' | 'ok'}, flow: [wireIds], chapter } */

const P = (x, y) => ({ x, y });

/* ---- the guides ---- */
const WORKFLOW = {
  id: 'workflow', title: 'Build a workflow in 60 seconds', blurb: 'Add nodes, connect them, run them, see the output and publish.',
  parts: {
    lib: { kind: 'lib', x: 1.5, y: 12, w: 19, h: 85, items: [['play', 'Run by hand'], ['star', 'Sample person'], ['T', 'Uppercase'], ['∑', 'GST / tax'], ['🌐', 'HTTP request'], ['✳', 'Claude'], ['#', 'Slack']] },
    n1: { kind: 'node', x: 30, y: 40, label: 'Run by hand', sub: 'Trigger', icon: '▶', tone: 'green' },
    n2: { kind: 'node', x: 51, y: 40, label: 'Sample person', sub: 'Generate', icon: '☆', tone: 'pink' },
    n3: { kind: 'node', x: 72, y: 40, label: 'Uppercase', sub: 'Text', icon: 'T', tone: 'teal' },
    w12: { kind: 'wire', from: P(38.4, 47.5), to: P(51, 47.5) },
    w23: { kind: 'wire', from: P(59.4, 47.5), to: P(72, 47.5) },
    cfg: { kind: 'card', x: 62, y: 62, w: 33, h: 26, title: 'Uppercase', rows: [['Text', '{{ $json.person.name }}'], ['Put the result in', 'shout']] },
    out: { kind: 'card', x: 56, y: 58, w: 39, h: 36, title: 'Output (1)', code: '{\n  "person": { "name": "Isha Mehta", "city": "Pune" },\n  "shout": "ISHA MEHTA"\n}' },
    toast: { kind: 'toast', x: 50, y: 15, text: 'The workflow ran' },
    pub: { kind: 'dialog', x: 22, y: 24, w: 44, h: 46, title: 'Publish as a web app', lines: ['Custom link name', 'hello-world'], link: 'workline.app/p/hello-world', ok: 'Yours: the link works.' },
    hlLib: { kind: 'ring', x: 1.2, y: 11.5, w: 19.6, h: 86 },
  },
  steps: [
    { chapter: 'Nodes', cap: 'A workflow is a row of steps, called nodes. Every workflow starts with a trigger.', ms: 3600, cur: [50, 70], on: ['n1'] },
    { cap: 'The Nodes library on the left has 650 nodes, in sections: Start, Build, Tools, Apps…', ms: 3800, cur: [11, 30], on: ['hlLib'] },
    { cap: 'Click a node to add it. Here: Sample person (it makes a test person).', ms: 3400, cur: [11, 26.5], click: true, on: ['n2'], off: ['hlLib'] },
    { chapter: 'Connect', cap: 'Drag from a node’s right dot to the next node. That string carries the data.', ms: 3600, cur: [51, 47.5], on: ['w12'] },
    { cap: 'Add Uppercase too, and connect it.', ms: 3000, cur: [11, 33], click: true, on: ['n3', 'w23'] },
    { cap: 'Set it up on the right: which value to change, and where to put the result.', ms: 4200, cur: [80, 72], click: true, on: ['cfg'] },
    { chapter: 'Run', cap: 'Press Run workflow.', ms: 2400, cur: [88.5, 6.5], click: true, off: ['cfg'] },
    { cap: 'Each node lights up while it runs, and data runs along the strings…', ms: 2200, cur: [88.5, 6.5], st: { n1: 'ok', n2: 'run' }, flow: ['w12'] },
    { cap: '…from one node to the next.', ms: 2200, st: { n2: 'ok', n3: 'run' }, flow: ['w23'] },
    { cap: 'Every node got a ✓: the workflow ran.', ms: 2600, st: { n3: 'ok' }, on: ['toast'] },
    { chapter: 'Output', cap: 'Click a node to see what it gave: its Output.', ms: 4200, cur: [76, 47], click: true, on: ['out'], off: ['toast'] },
    { chapter: 'Publish', cap: 'Publish turns it into a web app at your own link.', ms: 3800, cur: [77.5, 6.5], click: true, on: ['pub'], off: ['out'] },
    { cap: 'Done! Share the link. That’s a workflow.', ms: 3600, cur: [44, 64], click: true },
  ],
};

const TOUR = {
  id: 'tour', title: 'A tour of WorkLine', blurb: 'Docs, diagrams, sheets, databases, workflows and apps, in one place.',
  parts: {
    side: { kind: 'side', x: 1.5, y: 12, w: 15, h: 85, items: ['Home', 'Doc', 'Diagram', 'Sheet', 'Database', 'Workflow', 'App'] },
    home: { kind: 'files', x: 19, y: 12, w: 79, h: 85, files: [['Launch plan', 'Doc · 2 min ago'], ['Sales 2025', 'Sheet · today'], ['Orders DB', 'Database · today'], ['Video pipeline', 'Workflow · yesterday'], ['StarPlay', 'App · yesterday']] },
    doc: { kind: 'doc', x: 19, y: 12, w: 79, h: 85, title: 'Launch plan', lines: ['## Goals', 'Ship the beta to 100 shops by March.', '## Plan', '- Week 1: onboarding flow', '- Week 2: payments with Stripe'] },
    diagram: { kind: 'diagram', x: 19, y: 12, w: 79, h: 85, boxes: [['Web app', 12, 40], ['API', 42, 40], ['Database', 72, 22], ['Queue', 72, 60]] },
    sheet: { kind: 'sheet', x: 19, y: 12, w: 79, h: 85 },
    db: { kind: 'db', x: 19, y: 12, w: 79, h: 85 },
    flow: { kind: 'miniflow', x: 19, y: 12, w: 79, h: 85 },
    app: { kind: 'phone', x: 19, y: 12, w: 79, h: 85 },
    ai: { kind: 'card', x: 62, y: 46, w: 34, h: 46, title: '✨ AI chat', chat: [['you', 'Make a sales dashboard from this sheet'], ['ai', 'Done: 3 charts and a summary.']] },
  },
  steps: [
    { chapter: 'Home', cap: 'This is home: every file you make is here. Docs, sheets, databases, workflows and apps.', ms: 4200, cur: [40, 30], on: ['side', 'home'], sel: 0 },
    { chapter: 'Doc', cap: 'Write a doc in Markdown, with headings, lists and links.', ms: 4200, cur: [8, 24.5], click: true, on: ['doc'], off: ['home'], sel: 1 },
    { chapter: 'Diagram', cap: 'Draw diagrams by dragging, or by writing them as code.', ms: 4200, cur: [8, 30.5], click: true, on: ['diagram'], off: ['doc'], sel: 2 },
    { chapter: 'Sheet', cap: 'Sheets work like Excel: formulas, charts, and .xlsx files in and out.', ms: 4200, cur: [8, 36.5], click: true, on: ['sheet'], off: ['diagram'], sel: 3 },
    { chapter: 'Database', cap: 'Connect a database, browse tables and run SQL.', ms: 4200, cur: [8, 42.5], click: true, on: ['db'], off: ['sheet'], sel: 4 },
    { chapter: 'Workflow', cap: 'Workflows do the work: 650 nodes for apps, AI, data and tools.', ms: 4400, cur: [8, 48.5], click: true, on: ['flow'], off: ['db'], sel: 5, flow: ['mf'] },
    { chapter: 'App', cap: 'Build an app on top: drag and drop, or only nodes. Then publish it at your own link.', ms: 4600, cur: [8, 54.5], click: true, on: ['app'], off: ['flow'], sel: 6 },
    { chapter: 'AI', cap: 'And AI helps in every view: ask it to write, build or explain.', ms: 4400, cur: [79, 70], click: true, on: ['ai'] },
    { cap: 'One workspace, from idea to live app. Welcome to WorkLine!', ms: 3600, cur: [50, 50], off: ['ai'], sel: 0, on: ['home'] },
  ],
};

export const VIDEO_GUIDES = [WORKFLOW, TOUR];

/* ---- drawing the parts ---- */
const pos = p => ({ left: `${p.x}%`, top: `${p.y}%`, ...(p.w ? { width: `${p.w}%` } : {}), ...(p.h ? { height: `${p.h}%` } : {}) });

function Part({ id, p, st, flowing, sel, typed }) {
  switch (p.kind) {
    case 'lib': return (
      <div className="vg-panel vg-lib" style={pos(p)}>
        <b>Nodes <small>650</small></b>
        <i className="vg-search">Search nodes or apps</i>
        {p.items.map(([ic, t]) => <span key={t} className="vg-li"><em>{ic}</em>{t}</span>)}
      </div>
    );
    case 'node': return (
      <div className={`vg-node t-${p.tone} ${st || ''}`} style={pos(p)}>
        <div className="vg-nbox"><span>{p.icon}</span>{st === 'ok' && <i className="vg-ok">✓ 1</i>}</div>
        <b>{p.label}</b><small>{p.sub}</small>
      </div>
    );
    case 'wire': {
      // The stage is 16:9, so a y in percent is y × 0.5625 in this 100-wide box.
      const Y = y => (y * 0.5625).toFixed(2), mx = (p.from.x + p.to.x) / 2;
      const d = `M${p.from.x} ${Y(p.from.y)} C${mx} ${Y(p.from.y)} ${mx} ${Y(p.to.y)} ${p.to.x} ${Y(p.to.y)}`;
      return (
        <svg className="vg-wire" viewBox="0 0 100 56.25" preserveAspectRatio="none" style={{ left: 0, top: 0, width: '100%', height: '100%' }}>
          <path id={`vgp-${id}`} d={d} pathLength="1" />
          {flowing && [0, 0.12, 0.24].map((b, i) => (
            <circle key={i} r={[0.9, 0.65, 0.45][i]} className="vg-bead" style={{ opacity: [1, 0.6, 0.35][i] }}>
              <animateMotion dur="1.1s" begin={`${b}s`} repeatCount="indefinite"><mpath href={`#vgp-${id}`} /></animateMotion>
            </circle>
          ))}
        </svg>
      );
    }
    case 'card': return (
      <div className="vg-panel vg-card" style={pos(p)}>
        <b>{p.title}</b>
        {p.rows && p.rows.map(([k, v]) => <label key={k}><small>{k}</small><span className="vg-input">{v}</span></label>)}
        {p.code && <pre>{p.code}</pre>}
        {p.chat && p.chat.map(([who, t], i) => <p key={i} className={`vg-msg ${who}`}>{t}</p>)}
      </div>
    );
    case 'toast': return <div className="vg-toast" style={pos(p)}><i />{p.text}</div>;
    case 'dialog': return (
      <div className="vg-panel vg-dialog" style={pos(p)}>
        <b>{p.title}</b>
        <small>{p.lines[0]}</small><span className="vg-input">{typed ?? p.lines[1]}</span>
        <span className="vg-good">{p.ok}</span>
        <span className="vg-link">{p.link}</span>
        <span className="vg-btns"><i>Unpublish</i><i className="on">Copy link</i></span>
      </div>
    );
    case 'ring': return <div className="vg-ring" style={pos(p)} />;
    case 'side': return (
      <div className="vg-panel vg-side" style={pos(p)}>
        {p.items.map((t, i) => <span key={t} className={i === sel ? 'on' : ''}>{t}</span>)}
      </div>
    );
    case 'files': return (
      <div className="vg-panel vg-files" style={pos(p)}>
        <b>Your files</b><span className="vg-new">+ Create a Blank File</span>
        {p.files.map(([n, m]) => <span key={n} className="vg-file"><em />{n}<small>{m}</small></span>)}
      </div>
    );
    case 'doc': return (
      <div className="vg-panel vg-doc" style={pos(p)}>
        <h3>{p.title}</h3>
        {p.lines.map((l, i) => (l.startsWith('## ') ? <h4 key={i}>{l.slice(3)}</h4> : <p key={i}>{l}</p>))}
      </div>
    );
    case 'diagram': return (
      <div className="vg-panel vg-diagram" style={pos(p)}>
        <svg viewBox="0 0 100 60" className="vg-dlines"><path d="M27 43 H42 M57 43 C64 43 66 26 72 26 M57 43 C64 43 66 63 72 63" pathLength="1" /></svg>
        {p.boxes.map(([t, x, y]) => <span key={t} className="vg-box" style={{ left: `${x}%`, top: `${y}%` }}>{t}</span>)}
      </div>
    );
    case 'sheet': return (
      <div className="vg-panel vg-sheet" style={pos(p)}>
        <span className="vg-fx">fx <code>=SUM(B2:B5)</code></span>
        <table><tbody>
          {[['', 'A', 'B'], ['1', 'Month', 'Sales'], ['2', 'Jan', '42,000'], ['3', 'Feb', '51,500'], ['4', 'Mar', '63,200'], ['5', 'Apr', '70,100'], ['6', 'Total', '2,26,800']].map((r, i) => (
            <tr key={i}>{r.map((c, j) => <td key={j} className={i === 0 || j === 0 ? 'h' : i === 6 && j === 2 ? 'sel' : ''}>{c}</td>)}</tr>
          ))}
        </tbody></table>
        <span className="vg-bars">{[42, 51, 63, 70].map((h, i) => <i key={i} style={{ height: `${h}%` }} />)}</span>
      </div>
    );
    case 'db': return (
      <div className="vg-panel vg-db" style={pos(p)}>
        <code className="vg-sql">SELECT name, city, total FROM orders ORDER BY total DESC;</code>
        <table><tbody>
          {[['name', 'city', 'total'], ['Ananya', 'Pune', '₹4,999'], ['Kabir', 'Delhi', '₹3,250'], ['Meera', 'Chennai', '₹2,100']].map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j} className={i === 0 ? 'h' : ''}>{c}</td>)}</tr>)}
        </tbody></table>
      </div>
    );
    case 'miniflow': return (
      <div className="vg-panel vg-miniflow" style={pos(p)}>
        {[['▶', 'Webhook', 'green'], ['✳', 'Claude', 'violet'], ['#', 'Slack', 'pink']].map(([ic, t, tone], i) => (
          <span key={t} className={`vg-mnode t-${tone}`} style={{ left: `${10 + i * 32}%` }}><em>{ic}</em>{t}</span>
        ))}
        <svg viewBox="0 0 100 60" preserveAspectRatio="none"><path id="vgp-mf" d="M24 30 H42 M56 30 H74" pathLength="1" />
          {flowing && <circle r="1.4" className="vg-bead"><animateMotion dur="1.4s" repeatCount="indefinite"><mpath href="#vgp-mf" /></animateMotion></circle>}
        </svg>
      </div>
    );
    case 'phone': return (
      <div className="vg-panel vg-appv" style={pos(p)}>
        <div className="vg-phone">
          <b>StarPlay</b>
          <span className="vg-hero">Code Red: Delhi<small>▶ Watch now</small></span>
          <span className="vg-row">{[0, 1, 2].map(i => <i key={i} />)}</span>
        </div>
        <div className="vg-publish"><b>Publish web app</b><span className="vg-link">workline.app/p/starplay</span><span className="vg-good">Live on the web</span></div>
      </div>
    );
    default: return null;
  }
}

/* ---- the player ---- */
const SOUND_KEY = 'linework:guide-sound';
export function AnimatedGuide({ guide, autoPlay = false }) {
  const [i, setI] = useState(0);
  const [playing, setPlaying] = useState(autoPlay);
  const [typed, setTyped] = useState(null);
  // Music and sound (on unless turned off; remembered).
  const [audio, setAudio] = useState(() => { try { return localStorage.getItem(SOUND_KEY) !== 'off'; } catch (e) { return true; } });
  const loud = audio && playing && audioSupported();
  const steps = guide.steps;
  const step = steps[i];
  // Everything turned on (and node states) up to this step.
  const { visible, states } = useMemo(() => {
    const v = new Set(), s = {};
    for (const st of steps.slice(0, i + 1)) { (st.on || []).forEach(x => v.add(x)); (st.off || []).forEach(x => v.delete(x)); Object.assign(s, st.st || {}); }
    return { visible: v, states: s };
  }, [steps, i]);
  const sel = useMemo(() => { for (let k = i; k >= 0; k--) if (steps[k].sel !== undefined) return steps[k].sel; return 0; }, [steps, i]);
  const cur = useMemo(() => { for (let k = i; k >= 0; k--) if (steps[k].cur) return steps[k].cur; return [50, 50]; }, [steps, i]);
  const chapters = useMemo(() => steps.map((s, k) => [s.chapter, k]).filter(([c]) => c), [steps]);
  const total = steps.reduce((t, s) => t + s.ms, 0), done = steps.slice(0, i).reduce((t, s) => t + s.ms, 0);

  useEffect(() => {
    if (!playing) return undefined;
    const t = setTimeout(() => { if (i < steps.length - 1) setI(i + 1); else setPlaying(false); }, step.ms);
    return () => clearTimeout(t);
  }, [playing, i, step, steps.length]);
  // Music while it plays; it fades out on pause, at the end, or when the guide goes away.
  useEffect(() => { if (loud) startMusic(guide.id); else stopMusic(guide.id); }, [loud, guide.id]);
  useEffect(() => () => stopMusic(guide.id), [guide.id]);
  // Each step's sounds, timed to the picture: the cursor lands and clicks at 0.9s.
  useEffect(() => {
    if (!loud) return;
    if (step.chapter && i > 0) sound('whoosh');
    if (step.click) sound('click', 900);
    if ((step.on || []).some(id => guide.parts[id] && guide.parts[id].kind !== 'ring')) sound('pop', step.click ? 1050 : 300);
    const st = Object.values(step.st || {});
    if (st.includes('run')) sound('blip', 250);
    if (st.includes('ok') && !st.includes('run')) sound('chime', 300);
    if (i === steps.length - 1) sound('chime', step.ms - 400);
  }, [i, loud]); // eslint-disable-line react-hooks/exhaustive-deps
  const toggleAudio = () => setAudio(a => { try { localStorage.setItem(SOUND_KEY, a ? 'off' : 'on'); } catch (e) {} return !a; });
  // The publish dialog types its link name.
  useEffect(() => {
    const dlg = Object.entries(guide.parts).find(([id, p]) => p.kind === 'dialog' && (step.on || []).includes(id));
    if (!dlg) { setTyped(null); return undefined; }
    const word = dlg[1].lines[1]; let n = 0;
    setTyped('');
    const t = setInterval(() => { n++; setTyped(word.slice(0, n)); if (loud) sound('tick'); if (n >= word.length) clearInterval(t); }, 90);
    return () => clearInterval(t);
  }, [i, guide, step]); // eslint-disable-line react-hooks/exhaustive-deps

  const go = k => { setI(Math.max(0, Math.min(steps.length - 1, k))); };
  return (
    <figure className="vg" aria-label={`Animated guide: ${guide.title}`} data-sound={loud ? 'on' : 'off'}>
      <div className="vg-stage" onClick={() => setPlaying(x => !x)}>
        <div className="vg-bar"><span className="vg-dots"><i /><i /><i /></span><b>{guide.id === 'tour' ? 'WorkLine' : 'My first workflow'}</b>
          {guide.id === 'workflow' && <span className="vg-tools"><i className={step.cur && step.cur[0] > 75 && step.cur[0] < 82 && step.click ? 'press' : ''}>Publish web app</i><i className={`run ${step.cur && step.cur[0] > 84 && step.click ? 'press' : ''}`}>▶ Run workflow</i></span>}
        </div>
        {Object.entries(guide.parts).map(([id, p]) => (visible.has(id) ? <Part key={id} id={id} p={p} st={states[id]} flowing={(step.flow || []).includes(id) || (p.kind === 'miniflow' && (step.flow || []).includes('mf'))} sel={sel} typed={p.kind === 'dialog' ? typed : undefined} /> : null))}
        <span className={`vg-cursor ${step.click ? 'click' : ''}`} key={`c${i}`} style={{ left: `${cur[0]}%`, top: `${cur[1]}%` }} aria-hidden="true">
          <svg viewBox="0 0 24 24"><path d="M4 2l15 9-6.5 1.5L9 19z" /></svg>
        </span>
        <figcaption className="vg-cap" key={`cap${i}`}>{step.cap}</figcaption>
        {!playing && (i === 0 || i === steps.length - 1
          ? <span className="vg-play" aria-hidden="true">{i === 0 ? '▶' : '↺'}</span>
          : <span className="vg-paused" aria-hidden="true">❚❚ Paused</span>)}
      </div>
      <div className="vg-controls">
        <button className="btn" aria-label={playing ? 'Pause' : 'Play'} onClick={() => { if (!playing && i === steps.length - 1) setI(0); setPlaying(x => !x); }}>{playing ? '❚❚ Pause' : i === steps.length - 1 && done > 0 ? '↺ Replay' : '▶ Play'}</button>
        <button className="btn" aria-label="Previous step" onClick={() => go(i - 1)}>‹</button>
        <button className="btn" aria-label="Next step" onClick={() => go(i + 1)}>›</button>
        <div className="vg-progress" role="progressbar" aria-valuemin={0} aria-valuemax={steps.length} aria-valuenow={i + 1}>
          <i style={{ width: `${((done + (playing ? step.ms : 0)) / total) * 100}%`, transitionDuration: playing ? `${step.ms}ms` : '0ms' }} key={`p${i}${playing}`} />
        </div>
        <span className="vg-count">{i + 1} / {steps.length}</span>
        {audioSupported() && <button className="btn vg-sound" aria-label="Music and sound" aria-pressed={audio} title={audio ? 'Turn music and sound off' : 'Turn music and sound on'} onClick={toggleAudio}>{audio ? '🔊' : '🔇'}</button>}
      </div>
      <div className="vg-chapters" role="group" aria-label="Chapters">
        {chapters.map(([c, k]) => {
          const next = chapters.find(([, kk]) => kk > k)?.[1] ?? steps.length;
          return <button key={c} aria-pressed={i >= k && i < next} onClick={() => { go(k); setPlaying(true); }}>{c}</button>;
        })}
      </div>
    </figure>
  );
}

/* The video guides: each one animated here, or as a recorded video of the real app. */
export default function VideoGuides() {
  const [mode, setMode] = useState({});
  return (
    <div className="vgs">
      {VIDEO_GUIDES.map(g => {
        const m = mode[g.id] || 'animated';
        return (
          <section key={g.id} className="vg-item">
            <header>
              <div><h3>{g.title}</h3><p>{g.blurb}</p></div>
              <div className="seg" role="group" aria-label={`How to watch ${g.title}`}>
                <button aria-pressed={m === 'animated'} onClick={() => setMode(x => ({ ...x, [g.id]: 'animated' }))}>Animated</button>
                <button aria-pressed={m === 'video'} onClick={() => setMode(x => ({ ...x, [g.id]: 'video' }))}>Video</button>
              </div>
            </header>
            {m === 'animated'
              ? <AnimatedGuide guide={g} />
              : <video className="vg-video" controls playsInline preload="metadata" poster={`/guides/${g.id}.jpg`} src={`/guides/${g.id}.mp4`} aria-label={`Video: ${g.title}`} />}
          </section>
        );
      })}
    </div>
  );
}
