import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { NodeProject, PythonProject, bootNode, interruptPython, isolated, onNode, onPython } from '../lib/runtime.js';

/* The panel under the editor, as in VS Code: Output (what Run prints), Terminal (a Node.js shell
   with npm, npx, yarn and pnpm), Python (an interactive prompt with pip) and Preview (a web server
   started from the code). Runs are started by the Code view through the ref: run({kind, path, ...}). */

const TABS = [['output', 'Output'], ['terminal', 'Terminal'], ['python', 'Python'], ['preview', 'Preview']];
const NOT_ISOLATED = 'Running code needs a browser that supports cross-origin isolation: Chrome, Edge or Firefox on a computer.\r\n';

function termTheme() {
  const cs = getComputedStyle(document.documentElement), v = n => cs.getPropertyValue(n).trim();
  return { background: v('--surface'), foreground: v('--ink'), cursor: v('--ink'), selectionBackground: v('--line') };
}
const crlf = s => s.replace(/\r?\n/g, '\r\n');

// One xterm per tab, created the first time the tab shows and kept while the panel lives.
function useTerm(hostRef, opts) {
  const t = useRef(null), fit = useRef(null);
  const ensure = useCallback(() => {
    if (t.current || !hostRef.current) return t.current;
    const term = new Terminal({ fontFamily: 'JetBrains Mono, ui-monospace, Menlo, Consolas, monospace', fontSize: 12.5, lineHeight: 1.2,
      cursorBlink: !opts.readOnly, disableStdin: !!opts.readOnly, convertEol: false, scrollback: 5000, theme: termTheme(), allowProposedApi: false });
    const f = new FitAddon();
    term.loadAddon(f);
    term.open(hostRef.current);
    t.current = term; fit.current = f;
    try { f.fit(); } catch (e) {}
    return term;
  }, [hostRef, opts.readOnly]);
  const refit = useCallback(() => { try { fit.current?.fit(); } catch (e) {} }, []);
  useEffect(() => () => { t.current?.dispose(); t.current = null; }, []);
  return { ensure, refit, term: t };
}

const RunPanel = forwardRef(function RunPanel({ fileId, files, folders, theme, tab, setTab, onBack, onClose, onBusy }, ref) {
  const outHost = useRef(null), shHost = useRef(null), pyHost = useRef(null), bodyRef = useRef(null);
  const out = useTerm(outHost, { readOnly: true }), sh = useTerm(shHost, {}), pyt = useTerm(pyHost, {});
  // The workspace as the runtimes see it: files plus folders (empty ones included).
  const filesRef = useRef(null);
  filesRef.current = { files, folders: folders || [] };
  const node = useRef(null), py = useRef(null);
  if (!node.current || node.current.fileId !== fileId) { node.current?.close(); node.current = Object.assign(new NodeProject(fileId), { fileId }); }
  if (!py.current || py.current.fileId !== fileId) py.current = Object.assign(new PythonProject(fileId), { fileId });
  const [server, setServer] = useState(null); // {url, path}
  const [busy, setBusyState] = useState(false);
  const setBusy = v => { setBusyState(v); onBusy?.(v); };
  const proc = useRef(null); // the running Node process, or 'python'
  const pyTarget = useRef('repl'); // where Python output goes: the Output tab while a Run is going, else the prompt
  const nodeOn = useRef(false);

  /* ---- keep each runtime's copy of the files current ---- */
  useEffect(() => { if (nodeOn.current) node.current.sync(filesRef.current); }, [files, folders]);
  const startNode = async term => {
    if (!isolated()) { term.write(NOT_ISOLATED); throw new Error('not isolated'); }
    if (!nodeOn.current) term.write('\x1b[2mStarting Node.js in your browser…\x1b[0m\r\n');
    await bootNode();
    nodeOn.current = true;
    await node.current.sync(filesRef.current);
    node.current.watch(onBack);
  };

  useEffect(() => onNode(e => {
    if (e.type === 'server') { setServer(s => ({ url: e.url, path: (s && s.port === e.port && s.path) || '', port: e.port })); setTab('preview'); }
    if (e.type === 'port-closed') setServer(s => (s && s.port === e.port ? null : s));
  }), [setTab]);
  useEffect(() => onPython(({ stream, text }) => {
    const term = pyTarget.current === 'output' ? out.ensure() : pyt.ensure();
    if (!term) return;
    term.write(stream === 'err' ? '\x1b[31m' + crlf(text) + '\x1b[0m' : crlf(text));
  }), []); // eslint-disable-line react-hooks/exhaustive-deps

  /* ---- Run ---- */
  const pipe = async (p, term) => {
    p.output.pipeTo(new WritableStream({ write: d => term.write(d) })).catch(() => {});
    return p.exit;
  };
  const run = async spec => {
    setTab('output');
    const term = out.ensure();
    if (!term) return;
    stop();
    term.clear(); term.reset();
    const shown = spec.kind === 'python' ? `python ${spec.path}` : [spec.cmd, ...spec.args].join(' ');
    term.write(`\x1b[1m> ${shown}\x1b[0m\r\n`);
    setBusy(true);
    try {
      if (spec.kind === 'python') {
        if (!isolated()) { term.write(NOT_ISOLATED); return; }
        term.write('\x1b[2m' + (py.current.started ? '' : 'Starting Python in your browser (the first time takes a few seconds)…\r\n') + '\x1b[0m');
        py.current.started = true;
        pyTarget.current = 'output';
        proc.current = 'python';
        const code = await py.current.run(spec.path, filesRef.current);
        (await py.current.changes()).forEach(onBack);
        term.write(`\r\n\x1b[2m[exited with code ${code}]\x1b[0m\r\n`);
        return;
      }
      await startNode(term);
      if (spec.server) setServer({ url: null, path: spec.server, port: spec.port });
      const p = await node.current.spawn(spec.cmd, spec.args, { terminal: { cols: term.cols, rows: term.rows } });
      proc.current = p;
      const code = await pipe(p, term);
      if (proc.current === p) term.write(`\r\n\x1b[2m[exited with code ${code}]\x1b[0m\r\n`);
    } catch (e) {
      if (e.message !== 'not isolated') term.write(`\r\n\x1b[31m${crlf(String(e.message || e))}\x1b[0m\r\n`);
    } finally {
      pyTarget.current = 'repl';
      proc.current = null;
      setBusy(false);
    }
  };
  function stop() {
    const p = proc.current;
    if (!p) return;
    if (p === 'python') interruptPython();
    else { p.kill(); out.term.current?.write('\r\n\x1b[2m[stopped]\x1b[0m\r\n'); proc.current = null; }
  }
  useImperativeHandle(ref, () => ({ run, stop }));

  /* ---- Terminal: a Node.js shell ---- */
  const shell = useRef(null), shInput = useRef(null);
  const startShell = async () => {
    const term = sh.ensure();
    if (!term || shell.current) return;
    shell.current = 'starting';
    try {
      await startNode(term);
      const p = await node.current.spawn('jsh', [], { terminal: { cols: term.cols, rows: term.rows } });
      shell.current = p;
      shInput.current = p.input.getWriter();
      p.output.pipeTo(new WritableStream({ write: d => term.write(d) })).catch(() => {});
      p.exit.then(() => { shell.current = null; shInput.current = null; term.write('\r\n\x1b[2m[shell exited; press Enter to start a new one]\x1b[0m\r\n'); });
    } catch (e) {
      shell.current = null;
      if (e.message !== 'not isolated') term.write(`\x1b[31m${crlf(String(e.message || e))}\x1b[0m\r\n`);
    }
  };
  useEffect(() => {
    if (tab !== 'terminal') return;
    const term = sh.ensure();
    if (!term) return;
    if (!term._lwBound) {
      term._lwBound = true;
      term.onData(d => { if (shInput.current) shInput.current.write(d); else if (d === '\r') startShell(); });
      term.onResize(({ cols, rows }) => { if (shell.current && shell.current.resize) shell.current.resize({ cols, rows }); });
    }
    startShell();
    term.focus();
  }, [tab]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ---- Python prompt ---- */
  const pyLine = useRef(''), pyHist = useRef([]), pyHi = useRef(0), pyMore = useRef(false), pyBusy = useRef(true);
  const ahead = useRef(''); // keys typed while Python is busy, handled when it's ready again
  const pyKeys = useRef(() => {});
  const prompt = () => pyt.term.current?.write(pyMore.current ? '... ' : '>>> ');
  const submit = async src => {
    const term = pyt.ensure();
    term.write('\r\n');
    if (src.trim()) { pyHist.current.push(src); pyHi.current = pyHist.current.length; }
    if (!isolated()) { term.write(NOT_ISOLATED); prompt(); return; }
    pyBusy.current = true;
    try {
      const m = !pyMore.current && src.trim().match(/^[%!]?pip3?\s+install\s+(.+)$/);
      const r = !pyMore.current && src.trim().match(/^python3?\s+(\S+\.py)$/);
      if (m) await py.current.pip(m[1].split(/\s+/).filter(x => x && !x.startsWith('-')), filesRef.current);
      else if (r) { await py.current.run(r[1], filesRef.current); (await py.current.changes()).forEach(onBack); }
      else if (!pyMore.current && /^(clear|cls)$/.test(src.trim())) term.clear();
      else {
        const res = await py.current.line(src, filesRef.current);
        pyMore.current = !!(res && res.more);
        if (!pyMore.current) (await py.current.changes()).forEach(onBack);
      }
    } catch (e) {
      term.write(`\x1b[31m${crlf(String(e.message || e))}\x1b[0m\r\n`);
      pyMore.current = false;
    }
    pyBusy.current = false;
    prompt();
    const rest = ahead.current;
    ahead.current = '';
    if (rest) pyKeys.current(rest);
  };
  useEffect(() => {
    if (tab !== 'python') return;
    const term = pyt.ensure();
    if (!term) return;
    if (!term._lwBound) {
      term._lwBound = true;
      term.write('Python in your browser (Pyodide). Type Python, \x1b[1mpip install <package>\x1b[0m, or \x1b[1mpython <file>.py\x1b[0m.\r\n');
      if (!isolated()) term.write(NOT_ISOLATED);
      else { term.write('\x1b[2mStarting Python…\x1b[0m\r\n'); py.current.started = true; }
      const ready = isolated() ? py.current.sync(filesRef.current).catch(e => term.write(`\x1b[31m${crlf(String(e.message || e))}\x1b[0m\r\n`)) : Promise.resolve();
      ready.then(() => { pyBusy.current = false; prompt(); const rest = ahead.current; ahead.current = ''; if (rest) pyKeys.current(rest); });
      pyKeys.current = d => {
        if (pyBusy.current) { if (d === '\x03') { ahead.current = ''; interruptPython(); } else ahead.current += d; return; }
        if (d === '\x1b[A' || d === '\x1b[B') {
          const h = pyHist.current;
          pyHi.current = Math.max(0, Math.min(h.length, pyHi.current + (d === '\x1b[A' ? -1 : 1)));
          term.write('\b \b'.repeat(pyLine.current.length));
          pyLine.current = h[pyHi.current] || '';
          term.write(pyLine.current);
          return;
        }
        if (d.startsWith('\x1b')) return;
        for (let i = 0; i < d.length; i++) {
          const ch = d[i];
          if (ch === '\r' || ch === '\n') { const s = pyLine.current; pyLine.current = ''; ahead.current = d.slice(i + 1) + ahead.current; pyBusy.current = true; submit(s); return; }
          if (ch === '\x7f' || ch === '\b') { if (pyLine.current) { pyLine.current = pyLine.current.slice(0, -1); term.write('\b \b'); } }
          else if (ch === '\x03') { pyLine.current = ''; pyMore.current = false; term.write('^C\r\n'); prompt(); }
          else if (ch >= ' ' || ch === '\t') { pyLine.current += ch === '\t' ? '    ' : ch; term.write(ch === '\t' ? '    ' : ch); }
        }
      };
      term.onData(d => pyKeys.current(d));
    }
    term.focus();
  }, [tab]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ---- layout ---- */
  useEffect(() => {
    if (tab === 'output') out.ensure();
    const fitAll = () => { out.refit(); sh.refit(); pyt.refit(); };
    fitAll();
    const ro = new ResizeObserver(fitAll);
    if (bodyRef.current) ro.observe(bodyRef.current);
    return () => ro.disconnect();
  }, [tab]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { [out, sh, pyt].forEach(x => { if (x.term.current) x.term.current.options.theme = termTheme(); }); }, [theme]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => { node.current?.close(); try { proc.current && proc.current !== 'python' && proc.current.kill(); } catch (e) {} try { shell.current?.kill?.(); } catch (e) {} }, []);

  const previewUrl = server && server.url ? server.url.replace(/\/$/, '') + '/' + (server.path || '') : null;
  const frameRef = useRef(null);
  return (
    <div className="rp">
      <div className="rp-head" role="tablist" aria-label="Panel">
        {TABS.filter(([k]) => k !== 'preview' || server).map(([k, n]) => (
          <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{n}</button>
        ))}
        <span className="grow" />
        {busy && <button className="rp-act" onClick={stop} title="Stop the running program">■ Stop</button>}
        {tab === 'output' && <button className="rp-act" onClick={() => out.term.current?.clear()} title="Clear the output">Clear</button>}
        {tab === 'terminal' && <button className="rp-act" onClick={() => { try { shell.current?.kill?.(); } catch (e) {} shell.current = null; shInput.current = null; sh.term.current?.reset(); startShell(); }} title="Start a new shell">Restart</button>}
        <button className="rp-act" onClick={onClose} aria-label="Close the panel" title="Close the panel  Ctrl `">×</button>
      </div>
      <div className="rp-body" ref={bodyRef}>
        <div className="rp-term" ref={outHost} hidden={tab !== 'output'} aria-label="Output" />
        <div className="rp-term" ref={shHost} hidden={tab !== 'terminal'} aria-label="Terminal" />
        <div className="rp-term" ref={pyHost} hidden={tab !== 'python'} aria-label="Python prompt" />
        {tab === 'preview' && server && (
          <div className="rp-preview">
            <div className="rp-url">
              <button onClick={() => { if (frameRef.current) frameRef.current.src = previewUrl; }} title="Reload" aria-label="Reload">↻</button>
              <input readOnly value={previewUrl || 'Waiting for the server…'} aria-label="Preview address" />
              {previewUrl && <a className="btn" href={previewUrl} target="_blank" rel="noreferrer">Open in new tab</a>}
            </div>
            {previewUrl ? <iframe ref={frameRef} src={previewUrl} title="Preview" allow="cross-origin-isolated; clipboard-read; clipboard-write" /> : <p className="cw-hint">Waiting for the server to start…</p>}
          </div>
        )}
      </div>
    </div>
  );
});

export default RunPanel;
