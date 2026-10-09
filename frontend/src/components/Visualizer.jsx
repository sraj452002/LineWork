import { useEffect, useMemo, useRef, useState } from 'react';
import { dg, prep, svgDoc } from '../lib/engines.js';
import { PythonProject, isolated } from '../lib/runtime.js';
import { analyzeJS, classCode, flowchartCode, importGraphCode, langOf, traceJS } from '../lib/codeviz.js';
import { useUI } from './ui.jsx';

/* The Visualize pane beside the code editor.
   Structure: a flowchart of a function, the classes, or how the files import each other, drawn
   with Workline's diagram engines (and openable on the canvas).
   Step through: record a run of the open file, then move through it line by line: the line is
   highlighted in the editor, with the call stack, variables and output at that moment. */

const VIEWS = [['flow', 'Flowchart'], ['classes', 'Classes'], ['imports', 'Imports']];

// Structure of every code file, re-read shortly after edits. Python is read by Python itself (in the worker).
function useAnalyses(fileId, files) {
  const [map, setMap] = useState(() => new Map());
  const [pending, setPending] = useState(false);
  const cache = useRef(new Map()), py = useRef(null);
  useEffect(() => {
    const code = files.filter(f => langOf(f.path));
    const t = setTimeout(async () => {
      const next = new Map();
      let waiting = false;
      for (const f of code) {
        const key = f.path + '\0' + (f.text || '');
        if (cache.current.has(key)) { next.set(f.path, cache.current.get(key)); continue; }
        if (langOf(f.path) === 'js') { const a = analyzeJS(f.path, f.text || ''); cache.current.set(key, a); next.set(f.path, a); continue; }
        if (!isolated()) { next.set(f.path, { error: 'Reading Python needs Chrome, Edge or Firefox on a computer.', imports: [], classes: [], functions: [] }); continue; }
        waiting = true;
        if (!py.current) py.current = new PythonProject(fileId);
        setPending(true);
        try { const a = await py.current.analyze(f.text || ''); cache.current.set(key, a); next.set(f.path, a); }
        catch (e) { next.set(f.path, { error: String(e.message || e), imports: [], classes: [], functions: [] }); }
      }
      if (cache.current.size > 200) cache.current.clear();
      setMap(next);
      if (waiting) setPending(false);
    }, 350);
    return () => clearTimeout(t);
  }, [files, fileId]);
  return [map, pending];
}

function Diagram({ type, name, code, theme, onOpenCanvas }) {
  const [zoom, setZoom] = useState('fit');
  const doc = useMemo(() => {
    try { const d = { ...dg(type, name, code), dir: type === 'flowchart' ? 'TB' : 'LR' }; return svgDoc(prep(d), { margin: 24 }); }
    catch (e) { return null; }
  }, [type, name, code, theme]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!doc) return <p className="viz-empty">Nothing to draw yet.</p>;
  return (
    <>
      <div className="viz-tools">
        <div className="seg" role="group" aria-label="Zoom">
          <button aria-pressed={zoom === 'fit'} onClick={() => setZoom('fit')}>Fit</button>
          <button aria-pressed={zoom === 'full'} onClick={() => setZoom('full')}>100%</button>
        </div>
        <span className="grow" />
        <button className="btn" onClick={() => onOpenCanvas(type, name, code)} title="Add this diagram to the file as a canvas tab, to edit and annotate">Open on canvas</button>
      </div>
      <div className={'viz-svg' + (zoom === 'fit' ? ' fit' : '')} role="img" aria-label={name}
        style={zoom === 'full' ? { width: doc.w } : undefined} dangerouslySetInnerHTML={{ __html: doc.text }} />
    </>
  );
}

function Structure({ fileId, files, activeFile, cursorLine, theme, onOpenCanvas, onJump }) {
  const [view, setView] = useState('flow');
  const [pick, setPick] = useState(null); // a function chosen by hand, else the one at the cursor
  const [map, pending] = useAnalyses(fileId, files);
  const a = activeFile && map.get(activeFile.path);
  const fns = (a && a.functions) || [];
  useEffect(() => { setPick(null); }, [activeFile && activeFile.path]);
  const atCursor = fns.filter(f => f.name !== '(whole file)' && f.line <= cursorLine && cursorLine <= (f.endLine || f.line)).sort((x, y) => y.line - x.line)[0];
  const fn = fns.find(f => f.name === pick) || atCursor || fns.find(f => f.name !== '(whole file)') || fns[0];
  const classes = [...map.values()].flatMap(x => x.classes || []);

  let body;
  if (view === 'flow') {
    if (!activeFile) body = <p className="viz-empty">Open a file to see a flowchart of its functions.</p>;
    else if (!langOf(activeFile.path)) body = <p className="viz-empty">Flowcharts are drawn for Python, JavaScript and TypeScript files.</p>;
    else if (!a) body = <p className="viz-empty">Reading the code…</p>;
    else if (a.error && !fns.length) body = <p className="viz-empty err">Can’t read this file yet: {a.error}</p>;
    else if (!fn) body = <p className="viz-empty">This file has no functions or statements to chart.</p>;
    else body = (<>
      <div className="viz-pick">
        <label htmlFor="viz-fn">Function</label>
        <select id="viz-fn" value={fn.name} onChange={e => { setPick(e.target.value); const f = fns.find(x => x.name === e.target.value); if (f) onJump(activeFile.path, f.line); }}>
          {fns.map(f => <option key={f.name + f.line} value={f.name}>{f.name}{f.name === '(whole file)' ? '' : `  · line ${f.line}`}</option>)}
        </select>
      </div>
      <Diagram type="flowchart" name={`Flow: ${fn.name === '(whole file)' ? activeFile.path.split('/').pop() : fn.name}`} code={flowchartCode(fn)} theme={theme} onOpenCanvas={onOpenCanvas} />
    </>);
  } else if (view === 'classes') {
    body = classes.length
      ? <Diagram type="erd" name="Classes" code={classCode(classes)} theme={theme} onOpenCanvas={onOpenCanvas} />
      : <p className="viz-empty">{pending ? 'Reading the code…' : 'No classes in this project’s Python, JavaScript or TypeScript files yet.'}</p>;
  } else {
    const code = files.filter(f => langOf(f.path));
    body = code.length
      ? <Diagram type="architecture" name="Imports" code={importGraphCode(files, map)} theme={theme} onOpenCanvas={onOpenCanvas} />
      : <p className="viz-empty">No Python, JavaScript or TypeScript files yet.</p>;
  }
  return (
    <div className="viz-body">
      <div className="viz-tools">
        <div className="seg" role="group" aria-label="Diagram">
          {VIEWS.map(([k, n]) => <button key={k} aria-pressed={view === k} onClick={() => setView(k)}>{n}</button>)}
        </div>
        {pending && <span className="viz-note">Reading Python…</span>}
      </div>
      {body}
    </div>
  );
}

function StepThrough({ fileId, files, folders, activeFile, shown, onHighlight }) {
  const [run, setRun] = useState(null); // {path, steps, out, error, truncated, files}
  const [busy, setBusy] = useState(false);
  const [i, setI] = useState(0);
  const [frame, setFrame] = useState(0);
  const py = useRef(null);
  const lang = activeFile && langOf(activeFile.path);

  const record = async () => {
    if (!activeFile || !lang) return;
    setBusy(true); setRun(null); setI(0); setFrame(0);
    try {
      if (lang === 'python') {
        if (!isolated()) { setRun({ path: activeFile.path, steps: [], out: '', error: 'Stepping through Python needs Chrome, Edge or Firefox on a computer.' }); return; }
        if (!py.current) py.current = new PythonProject(fileId);
        const r = await py.current.trace(activeFile.path, { files, folders });
        setRun({ ...r, path: activeFile.path, steps: r.steps.map(s => ({ ...s, path: activeFile.path })) });
      } else {
        const r = await traceJS(files, activeFile.path);
        setRun({ ...r, path: activeFile.path, steps: r.steps.map(s => ({ ...s, path: r.files[s.file] })) });
      }
    } catch (e) {
      setRun({ path: activeFile.path, steps: [], out: '', error: String(e.message || e) });
    } finally { setBusy(false); }
  };

  const steps = run ? run.steps : [];
  const s = steps[i];
  useEffect(() => { onHighlight(shown && s ? s.path : null, shown && s ? s.line : null); }, [shown, s && s.path, s && s.line, i]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => onHighlight(null, null), []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setFrame(0); }, [i]);
  const go = n => setI(Math.max(0, Math.min(steps.length - 1, n)));
  const keys = e => {
    if (e.target.closest('input,select')) return;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { e.preventDefault(); go(i + 1); }
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { e.preventDefault(); go(i - 1); }
    else if (e.key === 'Home') { e.preventDefault(); go(0); }
    else if (e.key === 'End') { e.preventDefault(); go(steps.length - 1); }
  };
  const fr = s && s.stack && (s.stack[frame] || s.stack[0]);
  const vars = fr && fr.vars ? Object.entries(fr.vars) : [];
  const stale = run && activeFile && run.path !== activeFile.path;

  return (
    <div className="viz-body" tabIndex={-1} onKeyDown={keys} hidden={!shown}>
      <div className="viz-tools">
        <button className="btn primary" onClick={record} disabled={busy || !lang}>{busy ? 'Recording…' : run ? 'Record again' : 'Record a run'}</button>
        <span className="viz-note">{lang ? `Runs ${activeFile.path.split('/').pop()} and records each line` : 'Open a Python, JavaScript or TypeScript file'}</span>
      </div>
      {!run && !busy && <p className="viz-empty">Record a run of the open file, then step through it: the editor highlights each line as it runs, with the call stack, the variables and the output at that moment. Up to 2,000 steps; Python needs a moment to start the first time.</p>}
      {run && (<>
        {stale && <p className="viz-note warn">This recording is of {run.path}. Record again for the open file.</p>}
        {steps.length > 0 && (
          <div className="viz-steps">
            <div className="viz-ctrl" role="group" aria-label="Step">
              <button className="btn" onClick={() => go(0)} disabled={i === 0} aria-label="First step">⏮</button>
              <button className="btn" onClick={() => go(i - 1)} disabled={i === 0} aria-label="Previous step">◀</button>
              <input type="range" min="0" max={steps.length - 1} value={i} onChange={e => go(+e.target.value)} aria-label="Step" />
              <button className="btn" onClick={() => go(i + 1)} disabled={i >= steps.length - 1} aria-label="Next step">▶</button>
              <button className="btn" onClick={() => go(steps.length - 1)} disabled={i >= steps.length - 1} aria-label="Last step">⏭</button>
            </div>
            <p className="viz-where"><b>Step {i + 1}</b> of {steps.length}{run.truncated ? ' (stopped at the limit)' : ''} · {s.path.split('/').pop()} line {s.line}{s.event === 'return' ? ` · returns ${s.ret}` : s.event === 'exception' ? ' · raises' : ''}</p>
            <div className="viz-grid">
              <section aria-label="Call stack">
                <h3>Call stack</h3>
                <ol className="viz-stack">
                  {s.stack.map((f, k) => (
                    <li key={k}><button aria-pressed={k === frame} onClick={() => setFrame(k)} disabled={!f.vars}>{f.fn}{f.line ? <small> line {f.line}</small> : null}</button></li>
                  ))}
                </ol>
              </section>
              <section aria-label="Variables">
                <h3>Variables{fr ? <small> in {fr.fn}</small> : null}</h3>
                {vars.length ? (
                  <table className="viz-vars"><tbody>
                    {vars.map(([k, v]) => <tr key={k}><th>{k}</th><td><code>{v}</code></td></tr>)}
                  </tbody></table>
                ) : <p className="viz-note">None yet.</p>}
              </section>
            </div>
          </div>
        )}
        <section aria-label="Output" className="viz-out">
          <h3>Output</h3>
          <pre>{(run.out || '').slice(0, s && i < steps.length - 1 ? s.out : undefined) || ' '}</pre>
          {run.error && (!s || i === steps.length - 1) && <pre className="err">{run.error}</pre>}
        </section>
      </>)}
    </div>
  );
}

export default function Visualizer({ fileId, files, folders, activeFile, cursorLine, onHighlight, onOpenCanvas, onJump, onClose }) {
  const { theme } = useUI();
  const [tab, setTab] = useState('structure');
  return (
    <aside className="cw-viz" aria-label="Visualize">
      <div className="rp-head" role="tablist" aria-label="Visualize">
        <button role="tab" aria-selected={tab === 'structure'} className={tab === 'structure' ? 'on' : ''} onClick={() => setTab('structure')}>Structure</button>
        <button role="tab" aria-selected={tab === 'step'} className={tab === 'step' ? 'on' : ''} onClick={() => setTab('step')}>Step through</button>
        <span className="grow" />
        <button className="rp-act" onClick={onClose} aria-label="Close Visualize" title="Close">×</button>
      </div>
      {tab === 'structure' && <Structure fileId={fileId} files={files} activeFile={activeFile} cursorLine={cursorLine} theme={theme} onOpenCanvas={onOpenCanvas} onJump={onJump} />}
      {/* Kept mounted so a recording survives a look at the diagrams. */}
      <StepThrough fileId={fileId} files={files} folders={folders} activeFile={activeFile} shown={tab === 'step'} onHighlight={onHighlight} />
    </aside>
  );
}
