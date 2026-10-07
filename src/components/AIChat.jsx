import { useEffect, useRef, useState } from 'react';
import { IC, Ico } from './Toolbar.jsx';
import { useUI } from './ui.jsx';
import { ago } from '../lib/utils.js';
import { prepImage } from '../lib/ai.js';

// What the chat can make. `type` is the diagram type it uses; BPMN is a flowchart with swimlanes.
export const KINDS = [
  { k: 'architecture', type: 'architecture', label: 'Architecture Diagram', icon: 'dCloud', hint: 'Describe a system, or paste Terraform or YAML' },
  { k: 'flowchart', type: 'flowchart', label: 'Flow Chart', icon: 'dFlow', hint: 'Describe a process, with its steps and decisions' },
  { k: 'erd', type: 'erd', label: 'Entity Relationship', icon: 'dErd', hint: 'Describe your data, or paste SQL' },
  { k: 'sequence', type: 'sequence', label: 'Sequence Diagram', icon: 'dSeq', hint: 'Describe who calls whom, in order' },
  { k: 'bpmn', type: 'flowchart', label: 'BPMN Diagram', icon: 'dBpmn', hint: 'Describe a business process and who does each step' },
  { k: 'doc', type: null, label: 'Document', icon: 'doc', hint: 'Describe what the design doc should cover' },
];
const TEXT_FILES = '.txt,.md,.sql,.tf,.hcl,.yaml,.yml,.json,.xml,.csv,.js,.jsx,.ts,.tsx,.py,.go,.java,.rb,.rs,.cs,.php,.kt,.swift,.c,.cpp,.h,.sh,.proto,.graphql,.prisma';
const MAX_FILE = 200_000, MAX_IMAGE = 15_000_000;

export default function AIChat({ chat, chats, busy, status, aiOff, hasDoc, selLabel, onClearSel, onSend, onStop, onNew, onLoad, onClose, focusKey }) {
  const { popup, toast } = useUI();
  const [text, setText] = useState('');
  const [kind, setKind] = useState(null);
  const [file, setFile] = useState(null); // {name, text} or {name, image: {media_type, data, preview}}
  const [hint, setHint] = useState('');
  const inputRef = useRef(null), fileRef = useRef(null), imageRef = useRef(null), logRef = useRef(null);
  const msgs = chat ? chat.msgs : [];

  useEffect(() => { inputRef.current?.focus(); }, [focusKey]);
  useEffect(() => { if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight; }, [msgs.length, busy]);

  const K = kind && KINDS.find(x => x.k === kind);
  const pickKind = k => { setKind(k); setHint(''); inputRef.current?.focus(); };
  const send = () => {
    if (busy) { onStop(); return; }
    const t = text.trim();
    if (!t && !file) return;
    onSend(t || (file.image ? 'Recreate the diagram in this picture.' : `Diagram the attached file “${file.name}”.`), { kind, file });
    setText(''); setKind(null); setFile(null); setHint('');
  };
  const attach = f => {
    if (!f) return;
    if (/^image\//.test(f.type)) {
      if (f.size > MAX_IMAGE) { toast('That picture is too large. Use one under 15 MB.'); return; }
      prepImage(f).then(image => { setFile({ name: f.name, image }); inputRef.current?.focus(); }, () => toast('That picture couldn’t be opened. Try a PNG or JPEG.'));
      return;
    }
    if (f.size > MAX_FILE) { toast('That file is too large. Attach one under 200 KB.'); return; }
    f.text().then(t => { setFile({ name: f.name, text: t }); inputRef.current?.focus(); }, () => toast('That file couldn’t be read.'));
  };
  const options = anchor => popup(anchor, [
    { label: 'Attach a file', note: 'SQL, Terraform, YAML, JSON, code or text', act: () => fileRef.current?.click() },
    { label: 'Attach a picture', note: 'A screenshot or photo of a diagram', act: () => imageRef.current?.click() },
    ...(hasDoc ? [{ label: 'Draw from the design doc', note: 'Turns this file’s doc into a diagram', act: () => onSend('Draw a diagram of the system described in the design doc.', {}) }] : []),
    '-',
    ...KINDS.map(x => ({ label: 'Create: ' + x.label, on: kind === x.k, act: () => pickKind(kind === x.k ? null : x.k) })),
  ]);
  const history = anchor => {
    const old = chats.filter(c => c.msgs.length);
    popup(anchor, old.length
      ? old.map(c => ({ label: c.title || 'Untitled chat', note: ago(c.at) + ' · ' + c.msgs.length + ' messages', on: chat && c.id === chat.id ? true : undefined, act: () => onLoad(c.id) }))
      : [{ label: 'No earlier chats', note: 'Chats in this file appear here', act: () => {} }]);
  };

  const placeholder = file && file.image ? 'Press Enter to recreate the pictured diagram, or say what to change.'
    : K ? K.hint + '.' : hint || 'Describe what to create or edit.\nPress / for files and options.';

  return (
    <aside className="aichat" aria-label="AI chat"
      onKeyDown={e => { if (e.key === 'Escape' && !document.querySelector('.menu,.modal')) { e.stopPropagation(); onClose(); } }}>
      <header className="ai-head">
        <h2>{chat && chat.title ? chat.title : 'New Chat'}</h2>
        <button className="ai-ib" aria-label="New chat" title="New chat" onClick={() => { onNew(); setText(''); setKind(null); setFile(null); }}><Ico d={IC.plus} /></button>
        <button className="ai-ib" aria-label="Chat history" title="Chat history" aria-haspopup="menu" onClick={e => history(e.currentTarget)}><Ico d={IC.clock} /></button>
        <button className="ai-ib" aria-label="Close AI chat (Esc)" title="Close  Esc" onClick={onClose}><Ico d={IC.close} /></button>
      </header>

      <div className="ai-body" ref={logRef}>
        {!msgs.length ? (
          <div className="ai-start">
            <h3>What would you like to create?</h3>
            <div className="ai-grid">
              {KINDS.map(x => (
                <button key={x.k} className="ai-card" aria-pressed={kind === x.k} onClick={() => pickKind(kind === x.k ? null : x.k)}>
                  <Ico d={IC[x.icon]} /><span>{x.label}</span>
                </button>
              ))}
            </div>
            <h3>Already have something to start with?</h3>
            <div className="ai-grid">
              <button className="ai-card" onClick={() => { setHint('Paste Terraform, SQL, YAML or code, then press Enter.'); inputRef.current?.focus(); }}>
                <Ico d={IC.codeblock} /><span>Paste code or SQL</span>
              </button>
              <button className="ai-card" onClick={() => fileRef.current?.click()}>
                <Ico d={IC.upload} /><span>Upload a file</span>
              </button>
              <button className="ai-card" onClick={() => imageRef.current?.click()}>
                <Ico d={IC.image} /><span>From a picture</span>
              </button>
              <button className="ai-card" disabled={!hasDoc} title={hasDoc ? undefined : 'This file’s design doc is empty'}
                onClick={() => onSend('Draw a diagram of the system described in the design doc.', {})}>
                <Ico d={IC.doc} /><span>From the design doc</span>
              </button>
            </div>
          </div>
        ) : (
          <div className="ai-log" aria-live="polite">
            {msgs.map(m => (
              <div key={m.id} className={'ai-msg ' + m.cls}>
                {m.cls === 'a' && <Ico d={IC.ai} />}
                <p>{m.text}</p>
              </div>
            ))}
            {busy && <div className="ai-msg a"><Ico d={IC.ai} /><p className="busy">{status || 'Working'}</p></div>}
          </div>
        )}
      </div>

      <div className="ai-foot">
        {aiOff && <p className="ai-off">{aiOff}</p>}
        {(K || file || selLabel) && (
          <div className="ai-chips">
            {K && <span className="chip">Create: {K.label}<button onClick={() => setKind(null)} aria-label="Don’t create a specific type">×</button></span>}
            {file && <span className="chip">{file.image && <img className="chip-img" src={file.image.preview} alt="" />}{file.name}<button onClick={() => setFile(null)} aria-label="Remove attached file">×</button></span>}
            {selLabel && <span className="chip">Editing {selLabel}<button onClick={onClearSel} aria-label="Clear selection">×</button></span>}
          </div>
        )}
        <div className="ai-box">
          <textarea ref={inputRef} rows={3} value={text} placeholder={placeholder} aria-label="Describe what to create or edit"
            onChange={e => setText(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); send(); }
              else if (e.key === '/' && !text) { e.preventDefault(); options(e.currentTarget); }
            }} />
          <div className="ai-row">
            <button className="ai-ib" aria-label="Files and options" title="Files and options  /" aria-haspopup="menu" onClick={e => options(e.currentTarget)}><Ico d={IC.plus} /></button>
            <button className={'ai-send' + (busy ? ' stop' : '')} aria-label={busy ? 'Stop' : 'Send'} title={busy ? 'Stop' : 'Send  Enter'}
              disabled={!busy && !text.trim() && !file} onClick={send}>
              {busy ? <i className="ai-stopsq" /> : <Ico d={IC.send} />}
            </button>
          </div>
        </div>
      </div>
      <input ref={fileRef} type="file" accept={TEXT_FILES + ',image/*'} hidden onChange={e => { attach(e.target.files[0]); e.target.value = ''; }} />
      <input ref={imageRef} type="file" accept="image/*" hidden onChange={e => { attach(e.target.files[0]); e.target.value = ''; }} />
    </aside>
  );
}
