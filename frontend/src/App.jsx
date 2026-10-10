import { useCallback, useEffect, useRef, useState } from 'react';
import Login from './components/Login.jsx';
import Home from './components/Home.jsx';
import Editor from './components/Editor.jsx';
import Guide from './components/Guide.jsx';
import { UIProvider, useUI } from './components/ui.jsx';
import { saveProfile, signOut, startSession } from './lib/auth.js';
import { loadFiles, loadFolders, saveFiles, saveFolders } from './lib/storage.js';
import { listFiles, putFile, removeFile } from './lib/cloud.js';
import { imagesOnServer, tidyImages } from './lib/images.js';
import { startUserData } from './lib/userdata.js';
import { refreshAI } from './lib/ai.js';
import { clone, rid } from './lib/utils.js';
import { dg } from './lib/engines.js';
import { serverInfo, sharedToken } from './lib/backend.js';
import { AccountDialog, HistoryDialog, ShareDialog, SharedFile, StorageWarning, storageLevel } from './components/ServerDialogs.jsx';

export default function App() {
  return <UIProvider>{sharedToken() ? <Shared /> : <Main />}</UIProvider>;
}

// A share link (/s/<token>) opens just that file, with or without an account.
function Shared() {
  const [guide, setGuide] = useState(null);
  return (<>
    {guide && <Guide which={guide} onWhich={setGuide} onClose={() => setGuide(null)} onTry={() => setGuide(null)} />}
    <div hidden={!!guide} className="shared-wrap"><SharedFile onGuide={setGuide} /></div>
  </>);
}

function Main() {
  // undefined while checking; null when nobody is signed in; else {mode: 'cloud' | 'local', user?, pending?}
  const [session, setSession] = useState(undefined);
  // AI availability depends on being signed in, so check again whenever someone signs in or out.
  const enter = s => { refreshAI(); setSession(s); };
  useEffect(() => {
    const check = () => startSession().then(s => (s && s.mode ? enter(s) : setSession(s)), () => setSession(null));
    check();
    // An emailed link opened in a tab that already shows the app only changes the #fragment.
    const link = () => { if (/[#&](verify|reset|mfa|auth_error|account)=/.test(location.hash)) { setSession(undefined); check(); } };
    addEventListener('hashchange', link);
    return () => removeEventListener('hashchange', link);
  }, []);
  const out = async () => { await signOut(session && session.mode); enter(null); };
  return session === undefined ? <div className="boot" aria-busy="true" />
    : session && session.mode && !session.pending
      ? <Workspace key={session.user ? session.user.id : 'local'} session={session} onSignOut={out}
          onUser={user => setSession(s => ({ ...s, user }))} />
      : <Login pending={session && session.pending} notice={session && session.notice} onSignedIn={enter} />;
}

function Workspace({ session, onSignOut, onUser }) {
  const { toast, ask } = useUI();
  useEffect(() => { if (session.notice) toast(session.notice); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const cloud = session.mode === 'cloud', uid = cloud ? session.user.id : null;
  // Signed in, everything is on the account (in Google Drive) and nothing is kept in this browser:
  // what's been uploaded is tracked in memory only. synced: file id -> its `updated` on the account.
  const book = useRef(null);
  if (!book.current) {
    book.current = { synced: {}, deleted: [] };
    imagesOnServer(cloud);
    if (!cloud) startUserData(false);
  }
  const [files, setFiles] = useState(() => (cloud ? [] : loadFiles()));
  const [ready, setReady] = useState(!cloud), [loadError, setLoadError] = useState(null), [attempt, setAttempt] = useState(0);
  const [folders, setFolders] = useState(() => (cloud ? session.user.userMetadata?.folders || [] : loadFolders()));
  const [openId, setOpenId] = useState(null);
  const [guide, setGuide] = useState(null); // null | 'app' | 'erd'
  const [saveState, setSaveState] = useState(cloud ? 'Syncing' : 'Saved');
  // Cloud: the account's storage ({used, limit}), from each save; full once a save was refused for room.
  const [storage, setStorage] = useState(cloud ? session.user.storage : null);
  const [full, setFull] = useState(false), [warned, setWarned] = useState(false);
  // With the Workline server: share links and version history (for account files).
  const [server, setServer] = useState(null);
  useEffect(() => { if (cloud) serverInfo().then(setServer); }, [cloud]);
  const [dialog, setDialog] = useState(null); // {type: 'share' | 'history' | 'account', id?}
  const filesRef = useRef(files);
  filesRef.current = files;
  const loaded = useRef(!cloud); // cloud: true once the account's files have arrived

  /* ---- saving ----
     Local: write to this browser shortly after each change, and right away when the page is hidden.
     Cloud: upload changed files and send deletes shortly after each change; retry what fails. */
  const writeLocal = useCallback(fs => (cloud ? true : saveFiles(fs)), [cloud]);

  const syncing = useRef(false), again = useRef(false), retry = useRef(0);
  const sync = useCallback(async () => {
    if (!cloud || !loaded.current) return;
    if (syncing.current) { again.current = true; return; }
    syncing.current = true;
    clearTimeout(retry.current);
    const c = book.current, fs = filesRef.current, ids = new Set(fs.map(f => f.id));
    const puts = fs.filter(f => c.synced[f.id] !== f.updated);
    const dels = [...new Set([...(c.deleted || []), ...Object.keys(c.synced).filter(id => !ids.has(id))])];
    let failed = false, noRoom = false;
    const took = r => { if (r && r.storage) { setStorage(r.storage); setFull(false); } };
    if (puts.length || dels.length) setSaveState('Saving');
    // Deletes first: they make room in the account's storage.
    for (const id of dels) {
      try { took(await removeFile(id)); const { [id]: _, ...rest } = c.synced; c.synced = rest; c.deleted = (c.deleted || []).filter(x => x !== id); }
      catch (e) { failed = true; c.deleted = [...new Set([...(c.deleted || []), id])]; }
    }
    for (const f of puts) {
      try { took(await putFile(f)); c.synced = { ...c.synced, [f.id]: f.updated }; }
      catch (e) {
        failed = true;
        if (e.code === 'signed_out') { toast('You’ve been signed out. Sign in again to keep saving to your account.'); break; }
        if (e.code === 'storage_full') { noRoom = true; if (e.storage) setStorage(e.storage); setFull(true); break; }
        if (e.code === 'too_large') toast(`“${f.title}” is too large to save to your account. Remove some images from it.`);
      }
    }
    setSaveState(noRoom ? 'Storage full' : failed ? 'Offline' : 'Saved');
    syncing.current = false;
    if (again.current) { again.current = false; sync(); }
    else if (failed) retry.current = setTimeout(sync, 15000);
  }, [cloud, toast]);

  const first = useRef(true);
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    setSaveState('Saving');
    const t = setTimeout(() => {
      const ok = writeLocal(files);
      if (!cloud) setSaveState(ok ? 'Saved' : 'Not saved');
      if (!ok) toast('Browser storage is full. Delete some files to keep saving.');
      sync();
    }, cloud ? 900 : 500);
    return () => clearTimeout(t);
  }, [files, toast, writeLocal, sync, cloud]);
  useEffect(() => {
    const flush = () => writeLocal(filesRef.current);
    const vis = () => { if (document.hidden) { flush(); sync(); } };
    addEventListener('pagehide', flush);
    addEventListener('online', sync);
    // Save now (the Workflow view's Save and Ctrl+S).
    const now = () => { writeLocal(filesRef.current); sync(); };
    addEventListener('workline:save', now);
    document.addEventListener('visibilitychange', vis);
    return () => { removeEventListener('pagehide', flush); removeEventListener('online', sync); removeEventListener('workline:save', now); document.removeEventListener('visibilitychange', vis); };
  }, [writeLocal, sync]);
  // Cloud: changes not on the account yet would be lost with the page, so ask before it closes.
  useEffect(() => {
    if (!cloud) return;
    const warn = e => {
      const b = book.current;
      if (b.deleted.length || filesRef.current.some(f => b.synced[f.id] !== f.updated)) { sync(); e.preventDefault(); e.returnValue = ''; }
    };
    addEventListener('beforeunload', warn);
    return () => removeEventListener('beforeunload', warn);
  }, [cloud, sync]);

  // Cloud: fetch the account's files and settings, and offer to bring in files that were made in this
  // browser without an account.
  useEffect(() => {
    if (!cloud) return;
    let live = true;
    try { localStorage.removeItem('linework:cloud:' + uid); } catch (e) { /* the copy earlier versions kept here */ }
    Promise.all([listFiles(), startUserData(true)]).then(async ([remote]) => {
      if (!live) return;
      book.current.synced = Object.fromEntries(remote.map(f => [f.id, f.updated]));
      const next = remote;
      loaded.current = true;
      setReady(true);
      const key = 'linework:imported:' + uid;
      const old = (() => { try { return localStorage.getItem(key) ? [] : loadFiles(); } catch (e) { return []; } })()
        .filter(f => !next.some(x => x.id === f.id));
      setFiles(next);
      if (old.length) {
        const ok = await ask({ title: `Add ${old.length} file${old.length === 1 ? '' : 's'} from this browser?`, text: 'They were made without an account. Add them to your account so they’re saved online and on your other devices.', input: false, ok: 'Add to my account' });
        try { localStorage.setItem(key, '1'); } catch (e) {}
        if (ok && live) setFiles(fs => [...fs, ...old.filter(f => !fs.some(x => x.id === f.id))]);
      }
      sync();
    }, e => {
      if (!live) return;
      setLoadError(e && (e.code === 'signed_out' || e.code === 'unauthorized') ? 'Your session ended. Sign in again to see your files.' : 'Couldn’t reach your account. Check your connection, then try again.');
    });
    return () => { live = false; clearTimeout(retry.current); };
  }, [cloud, uid, attempt]); // eslint-disable-line react-hooks/exhaustive-deps

  // Cloud: files changed elsewhere (by a workflow, or on another device) come in when this tab is back in
  // view or a workflow run ends, unless this browser has changes to them it hasn't saved yet.
  const pull = useCallback(async () => {
    if (!cloud || !loaded.current) return;
    let remote;
    try { remote = await listFiles(); } catch (e) { return; }
    const b = book.current;
    setFiles(fs => {
      const byId = new Map(fs.map(f => [f.id, f]));
      let changed = false;
      for (const r of remote) {
        const l = byId.get(r.id);
        const fresh = l ? (r.updated || 0) > (l.updated || 0) && b.synced[l.id] === l.updated : !(b.deleted || []).includes(r.id) && !(r.id in b.synced);
        if (!fresh) continue;
        byId.set(r.id, r);
        b.synced = { ...b.synced, [r.id]: r.updated };
        changed = true;
      }
      return changed ? [...byId.values()] : fs;
    });
  }, [cloud]);
  useEffect(() => {
    if (!cloud) return undefined;
    const seen = () => { if (!document.hidden) pull(); };
    document.addEventListener('visibilitychange', seen);
    addEventListener('workline:pull', pull);
    return () => { document.removeEventListener('visibilitychange', seen); removeEventListener('workline:pull', pull); };
  }, [cloud, pull]);

  // Folders live on the account (cloud) or in this browser (local).
  const firstF = useRef(true);
  useEffect(() => {
    if (firstF.current) { firstF.current = false; return; }
    if (!cloud) { saveFolders(folders); return; }
    const t = setTimeout(() => { saveProfile({ folders }).catch(() => {}); }, 800);
    return () => clearTimeout(t);
  }, [folders, cloud]);

  // Move images saved inline by older versions into IndexedDB, and clear out unused ones.
  useEffect(() => {
    tidyImages(() => filesRef.current).then(moved => {
      if (!moved.size) return;
      setFiles(fs => fs.map(f => (f.diagrams.some(d => (d.shapes || []).some(s => moved.has(s.id))) ? {
        ...f, diagrams: f.diagrams.map(d => ({ ...d, shapes: (d.shapes || []).map(s => {
          if (!moved.has(s.id) || !s.src) return s;
          const { src, ...rest } = s;
          return { ...rest, img: moved.get(s.id) };
        }) })),
      } : f)));
    });
  }, []);

  // fn receives a copy of the file to change in place.
  const update = useCallback((id, fn) => setFiles(fs => fs.map(f => {
    if (f.id !== id) return f;
    const c = clone(f);
    fn(c);
    c.updated = Date.now();
    return c;
  })), []);

  const create = f => { setFiles(fs => [...fs, f]); setOpenId(f.id); };
  const duplicate = f => {
    const c = clone(f);
    c.id = rid('f'); c.title = (f.title || 'Untitled') + ' copy'; c.created = c.updated = Date.now();
    c.diagrams.forEach(d => { d.id = rid('d'); });
    setFiles(fs => [...fs, c]);
    toast('Duplicated');
    return c;
  };
  const rename = async f => {
    const v = await ask({ title: 'Rename file', value: f.title, ok: 'Rename' });
    if (v && v.trim()) update(f.id, c => { c.title = v.trim().slice(0, 120); });
  };
  const remove = async f => {
    const ok = await ask({ title: 'Delete this file?', text: `“${f.title}” and its diagrams will be removed for good.`, input: false, ok: 'Delete' });
    if (!ok) return;
    setFiles(fs => fs.filter(x => x.id !== f.id));
    setOpenId(id => (id === f.id ? null : id));
  };

  const updateOpen = useCallback(fn => update(openId, fn), [openId, update]);
  // Put an earlier version back. The current one stays in the history, so this can be undone the same way.
  const restore = (id, old, saved) => {
    setFiles(fs => fs.map(f => (f.id === id ? { ...old, id, updated: Date.now() } : f)));
    toast(`Restored the version from ${new Date(saved).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}`);
  };
  const dlgFile = dialog && files.find(f => f.id === dialog.id);
  const dialogs = dialog && dialog.type === 'account'
    ? <AccountDialog onUser={onUser} onClose={() => setDialog(null)} />
    : dlgFile && (dialog.type === 'share'
    ? <ShareDialog file={dlgFile} saving={saveState !== 'Saved'} onClose={() => setDialog(null)} />
    : <HistoryDialog file={dlgFile} onRestore={(old, saved) => restore(dlgFile.id, old, saved)} onClose={() => setDialog(null)} />);
  const serverProps = f => (server && cloud ? {
    onShare: () => { setDialog({ type: 'share', id: f.id }); sync(); },
    onHistory: () => { setDialog({ type: 'history', id: f.id }); sync(); },
  } : {});
  const file = files.find(f => f.id === openId);

  // Cloud: nothing to show until the account's files arrive (there's no copy in this browser).
  if (!ready) {
    return loadError
      ? <div className="boot boot-error" role="alert">
          <p>{loadError}</p>
          <div><button className="btn primary" onClick={() => { setLoadError(null); setAttempt(n => n + 1); }}>Try again</button> <button className="btn" onClick={onSignOut}>Sign out</button></div>
        </div>
      : <div className="boot" aria-busy="true" />;
  }
  // Nearly full: a notice that can be put away; full: one that stays until there's room again.
  const level = full ? 'full' : storageLevel(storage);
  const warning = cloud && (level === 'full' || (level && !warned)) && <StorageWarning storage={storage} full={full} onClose={() => setWarned(true)} />;
  if (guide) {
    return (
      <Guide which={guide} onWhich={setGuide} onClose={() => setGuide(null)}
        onTry={(code, title) => {
          const now = Date.now();
          create({ id: rid('f'), title, created: now, updated: now, doc: '', diagrams: [dg('erd', 'Schema', code)], active: 0, view: 'canvas' });
          setGuide(null);
        }} />
    );
  }
  if (file) {
    return (<>
      <Editor key={file.id} file={file} update={updateOpen} saveState={saveState} {...serverProps(file)}
        onBack={() => setOpenId(null)}
        onRename={() => rename(file)}
        onDuplicate={() => { const c = duplicate(file); setOpenId(c.id); }}
        onDelete={() => remove(file)}
        onGuide={setGuide} />
      {dialogs}
      {warning}
    </>);
  }
  return (<>
    <Home files={files} folders={folders} setFolders={setFolders} account={cloud ? session.user : null} saveState={saveState} storage={storage}
      onOpen={setOpenId} onCreate={create} onUpdate={update} onRename={rename}
      onDuplicate={duplicate} onDelete={remove} onSignOut={onSignOut} onGuide={setGuide} serverProps={serverProps}
      onAccount={server && cloud ? () => setDialog({ type: 'account' }) : null} />
    {dialogs}
    {warning}
  </>);
}
