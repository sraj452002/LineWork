import { useCallback, useEffect, useRef, useState } from 'react';
import { addShare, api, getVersion, listShares, listVersions, openShared, removeShare, saveShared, sharedToken } from '../lib/backend.js';
import { clone, rid } from '../lib/utils.js';
import { useUI } from './ui.jsx';
import Editor from './Editor.jsx';

/* What the Linework server (server/) adds: share links, version history, and the page a share link opens. */

function Modal({ title, onClose, children, wide }) {
  const ref = useRef(null);
  useEffect(() => { ref.current?.querySelector('button, input, select')?.focus(); }, []);
  return (
    <div className="modal" onClick={e => { if (e.target === e.currentTarget) onClose(); }} onKeyDown={e => { if (e.key === 'Escape') onClose(); }}>
      <div className={'mbox srv-box' + (wide ? ' wide' : '')} role="dialog" aria-modal="true" aria-labelledby="srvTitle" ref={ref}>
        <h3 id="srvTitle">{title}</h3>
        {children}
      </div>
    </div>
  );
}

const when = t => new Date(t).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
const ago = t => {
  const m = Math.round((Date.now() - t) / 60000);
  return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : when(t);
};

// Share: make links that open this file read-only or editable, copy them, and turn them off.
export function ShareDialog({ file, saving, onClose }) {
  const { toast } = useUI();
  const [links, setLinks] = useState(null);
  const [err, setErr] = useState('');
  const [mode, setMode] = useState('view');
  const load = useCallback(() => listShares(file.id).then(setLinks, e => setErr(e.message || 'Couldn’t load the links.')), [file.id]);
  useEffect(() => { load(); }, [load]);
  const copy = url => navigator.clipboard?.writeText(url).then(() => toast('Link copied'), () => toast('Copy the link from the box'));
  const make = async () => {
    setErr('');
    // A brand-new file may still be on its way to the account: give it a moment, once.
    const add = () => addShare(file.id, mode).catch(e => (e.code === 'not_found' ? new Promise(r => setTimeout(r, 1500)).then(() => addShare(file.id, mode)) : Promise.reject(e)));
    try { const l = await add(); await load(); copy(l.url); }
    catch (e) { setErr(e.code === 'not_found' ? 'This file hasn’t reached your account yet. Wait for “Saved”, then try again.' : e.message || 'Couldn’t make a link.'); }
  };
  return (
    <Modal title={`Share “${file.title || 'Untitled'}”`} onClose={onClose}>
      <p>Anyone with a link can open this file{saving ? ' as it was last saved' : ''}. An edit link also lets them change it; their changes are saved to your account.</p>
      <div className="srv-row">
        <div className="seg" role="group" aria-label="Link access">
          <button aria-pressed={mode === 'view'} onClick={() => setMode('view')}>Can view</button>
          <button aria-pressed={mode === 'edit'} onClick={() => setMode('edit')}>Can edit</button>
        </div>
        <button className="btn dark" onClick={make}>Create link</button>
      </div>
      {err && <p className="err" role="alert">{err}</p>}
      {links && links.length > 0 && (
        <ul className="srv-list" aria-label="Links">
          {links.map(l => (
            <li key={l.token}>
              <span className={'srv-tag ' + l.mode}>{l.mode === 'edit' ? 'Can edit' : 'Can view'}</span>
              <input readOnly value={l.url} aria-label="Link" onFocus={e => e.target.select()} />
              <button className="btn" onClick={() => copy(l.url)}>Copy</button>
              <button className="btn" onClick={() => removeShare(l.token).then(load)} aria-label="Turn off this link">Turn off</button>
            </li>
          ))}
        </ul>
      )}
      {links && !links.length && <p className="srv-empty">No links yet.</p>}
      <div className="mact"><button className="btn" onClick={onClose}>Done</button></div>
    </Modal>
  );
}

// Version history: the file as it stood after each stretch of editing; restore one.
export function HistoryDialog({ file, onRestore, onClose }) {
  const [list, setList] = useState(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(null);
  useEffect(() => { listVersions(file.id).then(setList, e => setErr(e.code === 'offline' ? e.message : 'Couldn’t load the history.')); }, [file.id]);
  const restore = async v => {
    setBusy(v.id);
    try { const { file: old, saved } = await getVersion(file.id, v.id); onRestore(old, saved); onClose(); }
    catch (e) { setErr(e.message || 'Couldn’t restore that version.'); setBusy(null); }
  };
  return (
    <Modal title="Version history" onClose={onClose} wide>
      <p>A version is kept for each stretch of editing (the last 100). Restoring one keeps the current version in this list too.</p>
      {err && <p className="err" role="alert">{err}</p>}
      {!list && !err && <p className="srv-empty">Loading…</p>}
      {list && !list.length && <p className="srv-empty">No versions yet. They appear once the file is saved to your account.</p>}
      {list && list.length > 0 && (
        <ol className="srv-list" aria-label="Versions">
          {list.map((v, i) => (
            <li key={v.id}>
              <span className="srv-when"><b>{i === 0 ? 'Current version' : when(v.saved)}</b><small>{i === 0 ? ago(v.saved) : v.title || 'Untitled'} · {Math.max(1, Math.round(v.size / 1024))} KB</small></span>
              {i > 0 && <button className="btn" disabled={busy != null} onClick={() => restore(v)}>{busy === v.id ? 'Restoring…' : 'Restore'}</button>}
            </li>
          ))}
        </ol>
      )}
      <div className="mact"><button className="btn" onClick={onClose}>Close</button></div>
    </Modal>
  );
}

// The page a share link opens (/s/<token>): the file in the editor. Edit links save back to the owner's
// account; view links can be changed on screen but aren't saved, and can be copied.
export function SharedFile({ onGuide }) {
  const { toast } = useUI();
  const token = sharedToken();
  const [state, setState] = useState(null); // {mode, owner, file} | {error}
  const [file, setFile] = useState(null);
  const [saveState, setSaveState] = useState('');
  useEffect(() => {
    openShared(token).then(s => { setState(s); setFile(s.file); setSaveState(s.mode === 'edit' ? 'Saved' : 'View only'); },
      e => setState({ error: e.code === 'not_found' ? 'This link has been turned off, or the file was deleted.' : e.message || 'Couldn’t open this link.' }));
  }, [token]);

  // Edit links: save shortly after each change; retry what fails.
  const latest = useRef(null), timer = useRef(0);
  const save = useCallback(async () => {
    const f = latest.current;
    if (!f) return;
    try { await saveShared(token, f); if (latest.current === f) setSaveState('Saved'); }
    catch (e) { setSaveState('Not saved'); if (e.code === 'view_only' || e.code === 'not_found') toast('This link no longer allows editing.'); else timer.current = setTimeout(save, 15000); }
  }, [token, toast]);
  const update = useCallback(fn => setFile(f => {
    const c = clone(f);
    fn(c);
    c.updated = Date.now();
    if (state && state.mode === 'edit') {
      latest.current = c;
      setSaveState('Saving');
      clearTimeout(timer.current);
      timer.current = setTimeout(save, 900);
    }
    return c;
  }), [state, save]);
  useEffect(() => () => clearTimeout(timer.current), []);

  // Keep a copy: in the visitor's account when signed in to this server, else in this browser.
  const copy = async () => {
    const c = clone(file);
    c.id = rid('f'); c.title = (file.title || 'Untitled') + ' (copy)'; c.created = c.updated = Date.now();
    try { await api('/files/' + c.id, { method: 'PUT', body: c }); toast('Copied to your files'); return; }
    catch (e) { if (e.status !== 401) { toast('Couldn’t copy it. Try again.'); return; } }
    const { loadFiles, saveFiles } = await import('../lib/storage.js');
    saveFiles([...loadFiles(), c]) ? toast('Copied to the files in this browser') : toast('Browser storage is full.');
  };

  if (!state) return <div className="boot" aria-busy="true" />;
  if (state.error) {
    return (
      <main className="login"><form onSubmit={e => e.preventDefault()}>
        <h1>Link unavailable</h1><p>{state.error}</p>
        <a className="btn dark wide" href="/">Open Linework</a>
      </form></main>
    );
  }
  return (
    <>
      <div className={'shared-bar ' + state.mode} role="status">
        {state.mode === 'edit'
          ? <>Editing <b>{state.owner}</b>’s file. Your changes are saved for everyone with the link.</>
          : <>Viewing <b>{state.owner}</b>’s file. Changes you make here aren’t saved; make a copy to keep them.</>}
      </div>
      <Editor key={file.id} file={file} update={update} saveState={saveState}
        onBack={() => { location.href = '/'; }} onDuplicate={copy} duplicateLabel="Make a copy for me" onGuide={onGuide} />
    </>
  );
}
