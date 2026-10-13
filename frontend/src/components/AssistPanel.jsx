import { useEffect, useRef, useState } from 'react';
import { IC, Ico } from './Toolbar.jsx';
import { useUI } from './ui.jsx';
import { NO_AI, aiProvider, aiProviders, copyFor, onAIThinking, sampleP, setAIProvider } from '../lib/ai.js';
import { askAssist } from '../lib/assist.js';

/* The AI panel beside a section (Sheet, Database, Code, Workflow, App). `source.current` is the section's
   description (lib/assist.js), refreshed by the section on every render, so the AI always sees what's on
   screen now. Each answer may carry one change, made only when its button is pressed. */
export default function AssistPanel({ source, section, onClose }) {
  const { toast } = useUI();
  // The section may still be loading (or the last one's description may still be there): wait for it.
  const ready = source.current && (!section || source.current.section === section);
  const [, tick] = useState(0);
  useEffect(() => { if (ready) return undefined; const t = setInterval(() => tick(n => n + 1), 100); return () => clearInterval(t); }, [ready]);
  const cfg = ready ? source.current : { section: section || 'this view', chips: [], intro: 'Loading…' };
  const [msgs, setMsgs] = useState([]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [off, setOff] = useState('');
  const [thinking, setThinking] = useState('');
  const [models, setModels] = useState(aiProviders), [model, setModel] = useState(() => aiProvider()?.id || null);
  const ctl = useRef(null), logRef = useRef(null), inputRef = useRef(null);

  useEffect(() => { sampleP.then(s => { if (!s) setOff(NO_AI); setModels(aiProviders); setModel(aiProvider()?.id || null); }); }, []);
  useEffect(() => { setThinking(''); if (!busy) return undefined; return onAIThinking(setThinking); }, [busy]);
  useEffect(() => { if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight; }, [msgs.length, busy, thinking]);
  useEffect(() => { if (ready) inputRef.current?.focus(); }, [ready]);

  const send = async request => {
    const t = String(request || '').trim();
    if (!t || busy) return;
    const c = source.current;
    if (!c || (section && c.section !== section)) return;
    const history = msgs;
    setMsgs(m => [...m, { id: Date.now(), who: 'u', text: t }]);
    setText(''); setBusy(true);
    ctl.current = new AbortController();
    try {
      const { reply, apply } = await askAssist(c, t, history, { signal: ctl.current.signal });
      setMsgs(m => [...m, { id: Date.now() + 1, who: 'a', text: reply, apply }]);
    } catch (e) {
      if (e && e.code === 'off') setOff(NO_AI);
      setMsgs(m => [...m, { id: Date.now() + 1, who: 'a', text: e && e.code === 'off' ? NO_AI : copyFor(e && e.code), error: true }]);
    }
    setBusy(false); ctl.current = null;
  };
  const apply = async m => {
    const c = source.current;
    try {
      const done = await c.apply(m.apply);
      setMsgs(list => list.map(x => (x.id === m.id ? { ...x, applied: done || 'Done' } : x)));
    } catch (e) { toast((e && e.message) || 'That change couldn’t be made.'); }
  };
  const label = m => { try { return (source.current.applyLabel && source.current.applyLabel(m.apply)) || 'Apply'; } catch (e) { return 'Apply'; } };

  return (
    <aside className="aichat assist" aria-label={`AI for the ${cfg.section}`}
      onKeyDown={e => { if (e.key === 'Escape' && !document.querySelector('.menu,.modal')) { e.stopPropagation(); onClose(); } }}>
      <header className="ai-head">
        <h2>AI · {cfg.section}</h2>
        {models.length > 1 && (
          <select className="ai-model" aria-label="AI model" value={model || ''} onChange={e => { setAIProvider(e.target.value); setModel(e.target.value); }}>
            {models.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
          </select>
        )}
        <button className="ai-ib" aria-label="New chat" title="New chat" onClick={() => setMsgs([])}><Ico d={IC.plus} /></button>
        <button className="ai-ib" aria-label="Close AI (Esc)" title="Close  Esc" onClick={onClose}><Ico d={IC.close} /></button>
      </header>
      <div className="ai-body" ref={logRef}>
        {!msgs.length ? (
          <div className="ai-start">
            <p className="assist-intro">{cfg.intro}</p>
            <div className="assist-chips">
              {(cfg.chips || []).map(ch => <button key={ch.label} className="ai-card" disabled={!ready} onClick={() => (ch.fill ? (setText(ch.prompt), inputRef.current?.focus()) : send(ch.prompt))}><Ico d={IC.ai} /><span>{ch.label}</span></button>)}
            </div>
          </div>
        ) : (
          <div className="ai-log" aria-live="polite">
            {msgs.map(m => (
              <div key={m.id} className={'ai-msg ' + m.who + (m.error ? ' err' : '')}>
                {m.who === 'a' && <Ico d={IC.ai} />}
                <div className="assist-msg">
                  <p>{m.text}</p>
                  {m.apply && (m.applied
                    ? <span className="assist-done">✓ {m.applied}</span>
                    : <button className="btn dark assist-apply" onClick={() => apply(m)}>{label(m)}</button>)}
                </div>
              </div>
            ))}
            {busy && <div className="ai-msg a"><Ico d={IC.ai} /><p className="busy">{thinking ? 'Thinking' : 'Working'}</p></div>}
            {busy && thinking && <details className="ai-think" open><summary>Reasoning</summary><p>{thinking.length > 600 ? '…' + thinking.slice(-600) : thinking}</p></details>}
          </div>
        )}
      </div>
      <div className="ai-foot">
        {off && <p className="ai-off">{off}</p>}
        <div className="ai-box">
          <textarea ref={inputRef} rows={3} value={text} disabled={!ready} aria-label={`Ask AI about the ${cfg.section}`} placeholder={cfg.placeholder || 'Ask, or describe what to make or change.'}
            onChange={e => setText(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); send(text); } }} />
          <div className="ai-row">
            <span className="grow" />
            <button className={'ai-send' + (busy ? ' stop' : '')} aria-label={busy ? 'Stop' : 'Send'} disabled={!busy && (!text.trim() || !ready)}
              onClick={() => (busy ? ctl.current?.abort() : send(text))}>
              {busy ? <i className="ai-stopsq" /> : <Ico d={IC.send} />}
            </button>
          </div>
        </div>
      </div>
    </aside>
  );
}
