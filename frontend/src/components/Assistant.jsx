import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { IC, Ico } from './Toolbar.jsx';
import { md } from '../lib/markdown.js';
import { ago } from '../lib/utils.js';
import { aiProvider, aiProviders, prepImage, sampleP, setAIProvider } from '../lib/ai.js';
import { ask, errorText, loadChats, newChatId, saveChats, titleOf, toolLabel } from '../lib/assistant.js';

/* The AI assistant, like a chat with Claude: past chats on the side, answers in Markdown that stream in,
   copy / retry / edit, pictures and text files attached, and the account's own tools (workflows, nodes,
   files) used along the way, each shown as a card that opens to what went in and what came back.
   compact: the phone layout (WorkLine Apps), with the chats in a sheet instead of a side bar. */

const SUGGEST = [
  ['What can you do?', 'What can you do with my WorkLine account? Give me a few examples.'],
  ['Run a workflow', 'Show me my workflows, then help me run one.'],
  ['Make text uppercase', 'Use the Uppercase node on “hello from workline” and show me what it gives.'],
  ['Write a doc', 'Write a one-page launch plan for a small online shop and save it as a doc.'],
];
const TEXT_FILES = '.txt,.md,.csv,.json,.sql,.yaml,.yml,.xml,.js,.ts,.py,.html,.css,.log';
const greet = () => { const h = new Date().getHours(); return h < 5 ? 'Up late' : h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'; };
const copy = t => navigator.clipboard?.writeText(t).catch(() => {});

function Markdown({ text, live }) {
  const ref = useRef(null);
  // Code blocks get a Copy button once the answer has finished.
  useEffect(() => {
    if (live || !ref.current) return;
    ref.current.querySelectorAll('pre').forEach(pre => {
      if (pre.parentElement.classList.contains('as-code')) return;
      const box = document.createElement('div'), head = document.createElement('div'), b = document.createElement('button');
      box.className = 'as-code'; head.className = 'as-codehead';
      head.textContent = pre.dataset.lang || 'code';
      b.className = 'as-copy'; b.type = 'button'; b.textContent = 'Copy';
      b.onclick = () => { copy(pre.innerText); b.textContent = 'Copied'; setTimeout(() => { b.textContent = 'Copy'; }, 1400); };
      head.append(b);
      pre.replaceWith(box); box.append(head, pre);
    });
  }, [text, live]);
  return <div ref={ref} className="as-md" dangerouslySetInnerHTML={{ __html: md(text) }} />;
}

function ToolCard({ p, onOpenFile }) {
  const [open, setOpen] = useState(false);
  const made = p.name === 'create_doc' && p.ok && /"id":"([\w-]+)"/.exec(p.result || '');
  return (
    <div className={'as-tool' + (p.done ? (p.ok ? ' ok' : ' bad') : ' busy')}>
      <button className="as-tool-head" aria-expanded={open} onClick={() => setOpen(o => !o)}>
        <i aria-hidden="true">{p.done ? (p.ok ? '✓' : '!') : <span className="as-spin" />}</i>
        <span>{toolLabel(p)}</span>
        <Ico d={IC.chev} className={'as-chev' + (open ? ' on' : '')} />
      </button>
      {made && onOpenFile && <button className="btn as-open" onClick={() => { dispatchEvent(new Event('workline:pull')); setTimeout(() => onOpenFile(made[1]), 400); }}>Open the doc</button>}
      {open && (
        <div className="as-tool-body">
          <b>Asked</b><pre>{JSON.stringify(p.input || {}, null, 2)}</pre>
          {p.done && <><b>{p.ok ? 'Got' : 'Error'}</b><pre>{p.result}</pre></>}
        </div>
      )}
    </div>
  );
}

function Thinking({ text, live }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="as-think">
      <button onClick={() => setOpen(o => !o)} aria-expanded={open}>{live ? 'Thinking…' : 'Thought process'} <Ico d={IC.chev} className={'as-chev' + (open ? ' on' : '')} /></button>
      {open && <p>{text}</p>}
    </div>
  );
}

const THUMB = 'M7 11v9H4v-9zM7 11l4-7a2 2 0 0 1 2 2v4h5.5a2 2 0 0 1 2 2.3l-1.2 6A2 2 0 0 1 17.3 20H7';
const Thumb = ({ down }) => <svg viewBox="0 0 24 24" style={down ? { transform: 'rotate(180deg)' } : undefined} aria-hidden="true"><path d={THUMB} /></svg>;
// Nemo's mark: under the newest answer, turning while it writes.
const Mark = ({ live }) => <span className={'as-mark' + (live ? ' live' : '')} aria-hidden="true"><Ico d={IC.ai} /></span>;

function Answer({ m, live, last, onRetry, onRate, onOpenFile }) {
  const [copied, setCopied] = useState(false);
  const parts = m.parts || [];
  const text = parts.filter(p => p.type === 'text').map(p => p.text).join('');
  return (
    <div className="as-msg ai">
      {parts.map((p, i) => (p.type === 'thinking' ? <Thinking key={i} text={p.text} live={live && i === parts.length - 1} />
        : p.type === 'tool' ? <ToolCard key={p.id || i} p={p} onOpenFile={onOpenFile} />
          : <Markdown key={i} text={p.text} live={live} />))}
      {m.error && <p className="as-err">{m.error}</p>}
      {!live && (
        <div className="as-acts">
          {text && <button aria-label="Copy the answer" title={copied ? 'Copied' : 'Copy'} onClick={() => { copy(text); setCopied(true); setTimeout(() => setCopied(false), 1400); }}><Ico d={IC.copy} /></button>}
          <button aria-label="Good answer" title="Good answer" aria-pressed={m.rating === 'up'} onClick={() => onRate(m.rating === 'up' ? null : 'up')}><Thumb /></button>
          <button aria-label="Bad answer" title="Bad answer" aria-pressed={m.rating === 'down'} onClick={() => onRate(m.rating === 'down' ? null : 'down')}><Thumb down /></button>
          {last && <button className="as-retry" aria-label="Retry" title="Retry" onClick={onRetry}><Ico d={IC.undo} /><span>Retry</span></button>}
        </div>
      )}
      {last && <Mark live={live} />}
    </div>
  );
}

export default function Assistant({ user, compact = false, onOpenFile }) {
  const uid = user && (user.id || user.email);
  const [chats, setChats] = useState(() => loadChats(uid));
  const [id, setId] = useState(null);
  const [text, setText] = useState('');
  const [files, setFiles] = useState([]); // [{name, text} | {name, image}]
  const [busy, setBusy] = useState(false);
  const [side, setSide] = useState(!compact);
  const [models, setModels] = useState(aiProviders), [model, setModel] = useState(() => aiProvider()?.id || '');
  const stop = useRef(null), logRef = useRef(null), boxRef = useRef(null), fileRef = useRef(null);
  const chat = chats.find(c => c.id === id) || null;
  const msgs = chat ? chat.msgs : [];

  useEffect(() => { sampleP.then(() => { setModels(aiProviders); setModel(aiProvider()?.id || ''); }); }, []);
  useEffect(() => { if (!busy) saveChats(uid, chats); }, [chats, busy, uid]);
  useEffect(() => { const el = logRef.current; if (el) el.scrollTop = el.scrollHeight; }, [msgs]);
  // The box grows with what's typed, up to a point.
  useLayoutEffect(() => { const el = boxRef.current; if (el) { el.style.height = 'auto'; el.style.height = `${Math.min(el.scrollHeight, 220)}px`; } }, [text]);

  const edit = (cid, fn) => setChats(cs => cs.map(c => (c.id === cid ? fn(c) : c)));
  const editLast = (cid, fn) => edit(cid, c => ({ ...c, msgs: [...c.msgs.slice(0, -1), fn(c.msgs[c.msgs.length - 1])] }));

  // Runs the answer for the chat as it is (its last message is the user's).
  const answer = async (cid, history, images) => {
    const ctl = new AbortController();
    stop.current = ctl; setBusy(true);
    edit(cid, c => ({ ...c, msgs: [...c.msgs, { id: newChatId(), role: 'assistant', parts: [] }] }));
    const add = ev => editLast(cid, m => {
      const parts = [...(m.parts || [])], end = parts[parts.length - 1];
      if (ev.type === 'text' || ev.type === 'thinking') {
        if (end && end.type === ev.type) parts[parts.length - 1] = { ...end, text: end.text + ev.delta };
        else parts.push({ type: ev.type, text: ev.delta });
      } else if (ev.type === 'tool') parts.push({ type: 'tool', id: ev.id, name: ev.name, input: ev.input });
      else if (ev.type === 'tool_done') { const k = parts.findIndex(p => p.type === 'tool' && p.id === ev.id); if (k >= 0) parts[k] = { ...parts[k], done: true, ok: ev.ok, result: ev.result }; }
      else if (ev.type === 'error') return { ...m, parts, error: ev.message };
      return { ...m, parts };
    });
    try { await ask(history, { images, signal: ctl.signal, onEvent: add }); }
    catch (e) { if (e.code !== 'cancelled') editLast(cid, m => ({ ...m, error: errorText(e) })); }
    editLast(cid, m => ({ ...m, parts: (m.parts || []).map(p => (p.type === 'tool' && !p.done ? { ...p, done: true, ok: false, result: 'Stopped.' } : p)) }));
    setBusy(false); stop.current = null;
  };

  const send = async (raw = text) => {
    const t = raw.trim();
    if ((!t && !files.length) || busy) return;
    const docs = files.filter(f => f.text), pics = files.filter(f => f.image).map(f => f.image);
    const full = [t || (pics.length ? 'What’s in this picture?' : 'Read the attached file.'), ...docs.map(f => `\n\nAttached file “${f.name}”:\n\`\`\`\n${f.text}\n\`\`\``)].join('');
    const um = { id: newChatId(), role: 'user', text: full, shown: t, files: files.map(f => f.name), ...(pics.length ? { images: pics.map(p => p.preview) } : {}) };
    let cid = id;
    if (!chat) { cid = newChatId(); setChats(cs => [{ id: cid, title: titleOf(t || files[0].name), at: Date.now(), msgs: [um] }, ...cs]); setId(cid); }
    else edit(cid, c => ({ ...c, at: Date.now(), msgs: [...c.msgs, um] }));
    setText(''); setFiles([]);
    await answer(cid, [...msgs, um], pics);
  };
  const retry = () => {
    if (busy || !chat) return;
    const upTo = chat.msgs.slice(0, -1);
    edit(chat.id, c => ({ ...c, msgs: upTo }));
    answer(chat.id, upTo, []);
  };
  const editMsg = k => {
    if (busy || !chat) return;
    const m = chat.msgs[k];
    setText(m.shown ?? m.text);
    edit(chat.id, c => ({ ...c, msgs: c.msgs.slice(0, k) }));
    boxRef.current?.focus();
  };
  const remove = cid => { setChats(cs => cs.filter(c => c.id !== cid)); if (cid === id) setId(null); };
  const fresh = () => { if (busy) stop.current?.abort(); setId(null); setText(''); setFiles([]); if (compact) setSide(false); setTimeout(() => boxRef.current?.focus(), 0); };
  const attach = list => {
    for (const f of list) {
      if (/^image\//.test(f.type)) prepImage(f).then(image => setFiles(x => [...x, { name: f.name, image }]), () => {});
      else if (f.size < 300_000) f.text().then(t => setFiles(x => [...x, { name: f.name, text: t }]));
    }
  };
  const first = (user && (user.name || user.email || '').split(/[\s@]/)[0]) || '';
  const lastUser = msgs.map(m => m.role).lastIndexOf('user');

  const composer = (
    <form className="as-box" onSubmit={e => { e.preventDefault(); send(); }}
      onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); attach([...e.dataTransfer.files]); }}>
      {files.length > 0 && (
        <div className="as-files">
          {files.map((f, i) => (
            <span key={i} className="as-file">{f.image ? <img src={f.image.preview} alt="" /> : <Ico d={IC.doc} />}<span>{f.name}</span>
              <button type="button" aria-label={`Remove ${f.name}`} onClick={() => setFiles(x => x.filter((_, j) => j !== i))}>×</button></span>
          ))}
        </div>
      )}
      <textarea ref={boxRef} rows={1} value={text} aria-label="Message" placeholder={msgs.length ? 'Reply to Nemo…' : 'How can Nemo help you today?'}
        onChange={e => setText(e.target.value)} onPaste={e => { const f = [...(e.clipboardData?.files || [])]; if (f.length) { e.preventDefault(); attach(f); } }}
        onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing && !(compact && 'ontouchstart' in window)) { e.preventDefault(); send(); } }} />
      <div className="as-row">
        <button type="button" className="as-ib" aria-label="Attach a file or picture" title="Attach a file or picture" onClick={() => fileRef.current?.click()}><Ico d={IC.plus} /></button>
        <span className="grow" />
        {models.length > 1 && (
          <select className="as-model" aria-label="AI model" value={model} onChange={e => { setAIProvider(e.target.value); setModel(e.target.value); }}>
            {models.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
          </select>
        )}
        {busy ? <button type="button" className="as-send stop" aria-label="Stop" onClick={() => stop.current?.abort()}><i /></button>
          : <button className="as-send" aria-label="Send" disabled={!text.trim() && !files.length}><Ico d={IC.send} /></button>}
      </div>
      <input ref={fileRef} type="file" multiple hidden accept={`image/*,${TEXT_FILES}`} onChange={e => { attach([...e.target.files]); e.target.value = ''; }} />
    </form>
  );

  return (
    <div className={'as' + (compact ? ' compact' : '') + (side ? ' side-open' : '')}>
      {side && (
        <aside className="as-side" aria-label="Chats">
          <button className="as-new" onClick={fresh}><Ico d={IC.plus} />New chat</button>
          <h2>Recents</h2>
          <nav className="as-list">
            {chats.length ? chats.map(c => (
              <div key={c.id} className="as-item" aria-current={c.id === id ? 'true' : undefined}>
                <button className="as-pick" onClick={() => { setId(c.id); if (compact) setSide(false); }}><span>{c.title}</span><small>{ago(c.at)}</small></button>
                <button className="as-del" aria-label={`Delete chat ${c.title}`} title="Delete" onClick={() => remove(c.id)}>×</button>
              </div>
            )) : <p className="as-none">Your chats show here.</p>}
          </nav>
        </aside>
      )}
      <section className="as-main" aria-label="Nemo, the AI assistant">
        <header className="as-top">
          <button className="as-ib" aria-label={side ? 'Hide chats' : 'Show chats'} title="Chats" onClick={() => setSide(s => !s)}><Ico d={IC.clock} /></button>
          <b className="as-title">{chat ? chat.title : ''}</b>
          {chat && <button className="as-ib" aria-label="New chat" title="New chat" onClick={fresh}><Ico d={IC.plus} /></button>}
        </header>
        {!msgs.length ? (
          <div className="as-hero">
            <h1><span className="as-star" aria-hidden="true"><Ico d={IC.ai} /></span>{greet()}{first ? `, ${first}` : ''}</h1>
            <p className="as-intro">Hi, I am <b>Nemo</b>! How can I help you?</p>
            {composer}
            <div className="as-chips">{SUGGEST.map(([label, q]) => <button key={label} onClick={() => send(q)}>{label}</button>)}</div>
            <p className="as-fine">It can run your workflows and nodes, read your files and write docs. It asks before sending or changing anything in other apps.</p>
          </div>
        ) : (<>
          <div className="as-log" ref={logRef} aria-live="polite">
            <div className="as-col">
              {msgs.map((m, k) => (m.role === 'user' ? (
                <div key={m.id} className="as-msg you">
                  <div className="as-bubble">
                    {m.images && <div className="as-pics">{m.images.map((src, i) => <img key={i} src={src} alt="Attached" />)}</div>}
                    {m.pictures > 0 && <small className="muted">{m.pictures} picture{m.pictures > 1 ? 's' : ''}</small>}
                    <p>{m.shown ?? m.text}</p>
                    {m.files && m.files.length > 0 && <small className="as-att">{m.files.map(n => `📎 ${n}`).join('  ')}</small>}
                  </div>
                  {!busy && <div className="as-acts you">
                    <button aria-label="Copy the message" title="Copy" onClick={() => copy(m.shown ?? m.text)}><Ico d={IC.copy} /></button>
                    {k === lastUser && <button aria-label="Edit the message" title="Edit" onClick={() => editMsg(k)}><Ico d={IC.text} /></button>}
                  </div>}
                </div>
              ) : <Answer key={m.id} m={m} live={busy && k === msgs.length - 1} last={k === msgs.length - 1} onRetry={retry} onOpenFile={onOpenFile}
                onRate={r => edit(chat.id, c => ({ ...c, msgs: c.msgs.map(x => (x.id === m.id ? { ...x, rating: r } : x)) }))} />))}
            </div>
          </div>
          <div className="as-foot">{composer}<p className="as-fine">Nemo can make mistakes. Check what matters.</p></div>
        </>)}
      </section>
    </div>
  );
}
