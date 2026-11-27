import { useCallback, useEffect, useState } from 'react';
import Editor from './Editor.jsx';
import { clone } from '../lib/utils.js';
import { blankOf, exportWorkline, fromUpload } from '../lib/toolfile.js';

/* The full Workline tool for a file, when a run stops at an Editor set to “the full Workline tool” or at a
   tool editor node (Course, Doc, Sheet, Diagram, Code, Workflow editor). The file opens in the tool it belongs
   to, with everything the tool has (the Course editor's ribbon and timeline, the Sheet's formulas…); pictures,
   PDFs, audio and video are shown. Save & continue gives the file back in its own kind and the run goes on. */
export default function ToolEditor({ card, onSave, onClose }) {
  const [file, setFile] = useState(null);
  const [opened, setOpened] = useState(null); // { view, back, viewOnly, src, note }
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        let o;
        if (card.wfile) o = { view: card.wfile.view, file: card.wfile, back: exportWorkline };
        else if (card.upload) o = await fromUpload(card.upload, card.view || 'auto');
        else o = { view: card.view, file: await blankOf(card.view === 'auto' ? 'doc' : card.view, card.heading || card.name || 'Untitled'), back: exportWorkline };
        if (!live) return;
        setOpened(o); setFile(o.file);
      } catch (e) { if (live) setErr(e.message || 'That file couldn’t be opened.'); }
    })();
    return () => { live = false; };
  }, [card]);

  const update = useCallback(fn => setFile(f => { const c = clone(f); fn(c); c.updated = Date.now(); return c; }), []);
  const save = async () => {
    setBusy(true); setErr('');
    try {
      const out = await opened.back(file);
      onSave({ file: out, view: opened.view, ...(card.wfile ? { wfile: file } : {}) });
    } catch (e) { setErr(e.message || 'Couldn’t make the file.'); setBusy(false); }
  };
  useEffect(() => { const k = e => { if (e.key === 'Escape' && !document.querySelector('.menu,.modal .mbox:not(.tl-host)')) onClose(); }; addEventListener('keydown', k); return () => removeEventListener('keydown', k); }, [onClose]);

  const label = { course: 'Course', doc: 'Doc', sheet: 'Sheet', canvas: 'Diagram', code: 'Code', flow: 'Workflow', viewer: 'View' }[opened?.view] || 'Editor';
  return (
    <div className="te" role="dialog" aria-modal="true" aria-label={`Edit ${card.name || 'the file'}`}>
      <header className="te-bar">
        <span className="te-badge" aria-hidden="true">{label}</span>
        <div className="te-ttl"><b>{card.heading || card.name || 'Edit the file'}</b><small>{card.wfile ? `Saves back to “${card.wfile.title}”, then the workflow goes on.` : opened?.viewOnly ? 'Shown as it is; the workflow goes on with it.' : opened?.note || 'Edit it here; the workflow goes on with the edited file.'}</small></div>
        {err && <span className="te-err" role="alert">{err}</span>}
        <button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn primary" disabled={!opened || busy} onClick={save}>{busy ? 'Saving…' : card.button || 'Save & continue'}</button>
      </header>
      <div className="te-body">
        {!opened && !err && <p className="te-wait"><i className="ws-spin" /> Opening {card.name || 'the file'}…</p>}
        {!opened && err && <p className="te-wait">{err}</p>}
        {opened?.viewOnly === 'image' && <div className="te-view"><img src={opened.src} alt={card.name} /></div>}
        {opened?.viewOnly === 'pdf' && <iframe className="te-pdf" title={card.name} src={opened.src} />}
        {opened?.viewOnly === 'audio' && <div className="te-view"><audio controls src={opened.src} /></div>}
        {opened?.viewOnly === 'video' && <div className="te-view"><video controls src={opened.src} /></div>}
        {file && !opened?.viewOnly && <Editor key={file.id} file={file} update={update} saveState="Not saved yet" onBack={onClose} />}
      </div>
    </div>
  );
}
