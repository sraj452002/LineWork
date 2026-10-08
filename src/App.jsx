import { useCallback, useEffect, useRef, useState } from 'react';
import Login from './components/Login.jsx';
import Home from './components/Home.jsx';
import Editor from './components/Editor.jsx';
import Guide from './components/Guide.jsx';
import { UIProvider, useUI } from './components/ui.jsx';
import { saveProfile, signOut, startSession } from './lib/auth.js';
import { loadFiles, loadFolders, saveFiles, saveFolders } from './lib/storage.js';
import { listFiles, loadCache, merge, putFile, removeFile, saveCache } from './lib/cloud.js';
import { listDriveFiles, loadDriveFolders, putDriveFile, removeDriveFile, saveDriveFolders } from './lib/gdrive.js';
import { tidyImages } from './lib/images.js';
import { refreshAI } from './lib/ai.js';
import { clone, rid } from './lib/utils.js';
import { dg } from './lib/engines.js';

export default function App() {
  // undefined while checking; null when nobody is signed in; else {mode: 'cloud' | 'drive' | 'local' | null, user?, pending?, notice?}
  const [session, setSession] = useState(undefined);
  // AI availability depends on being signed in, so check again whenever someone signs in or out.
  const enter = s => { refreshAI(); setSession(s); };
  useEffect(() => { startSession().then(s => (s && s.mode ? enter(s) : setSession(s)), () => setSession(null)); }, []);
  const out = async () => { await signOut(session && session.mode); enter(null); };
  return (
    <UIProvider>
      {session === undefined ? <div className="boot" aria-busy="true" />
        : session && session.mode && !session.pending
          ? <Workspace key={session.user ? session.user.id : 'local'} session={session} onSignOut={out} />
          : <Login pending={session && session.pending} notice={session && session.notice} onSignedIn={enter} />}
    </UIProvider>
  );
}

function Workspace({ session, onSignOut }) {
  const { toast, ask } = useUI();
  // cloud: files live online, either on the Linework account ('cloud') or in Google Drive ('drive').
  const drive = session.mode === 'drive', cloud = session.mode === 'cloud' || drive;
  const uid = cloud ? (drive ? 'g:' : '') + session.user.id : null, where = drive ? 'Google Drive' : 'your account';
  const store = drive
    ? { list: listDriveFiles, put: putDriveFile, remove: removeDriveFile }
    : { list: listFiles, put: putFile, remove: removeFile };
  const cache = useRef(cloud ? loadCache(uid) : null);
  const [files, setFiles] = useState(() => (cloud ? cache.current.files : loadFiles()));
  const [folders, setFolders] = useState(() => (drive ? cache.current.folders || [] : cloud ? session.user.userMetadata?.folders || [] : loadFolders()));
  const foldersReady = useRef(!drive); // Drive: don't save folders until they've been read from it
  const [openId, setOpenId] = useState(null);
  const [guide, setGuide] = useState(null); // null | 'app' | 'erd'
  const [saveState, setSaveState] = useState(cloud ? 'Syncing' : 'Saved');
  const filesRef = useRef(files);
  filesRef.current = files;
  const loaded = useRef(!cloud); // cloud: true once the account's files have arrived

  /* ---- saving ----
     Local: write to this browser shortly after each change, and right away when the page is hidden.
     Cloud: also write to this browser first, then upload changed files and send deletes; retry what fails. */
  const writeLocal = useCallback(fs => {
    if (!cloud) return saveFiles(fs);
    cache.current = { ...cache.current, files: fs };
    return saveCache(uid, cache.current);
  }, [cloud, uid]);

  const syncing = useRef(false), again = useRef(false), retry = useRef(0);
  const sync = useCallback(async () => {
    if (!cloud || !loaded.current) return;
    if (syncing.current) { again.current = true; return; }
    syncing.current = true;
    clearTimeout(retry.current);
    const c = cache.current, fs = filesRef.current, ids = new Set(fs.map(f => f.id));
    const puts = fs.filter(f => c.synced[f.id] !== f.updated);
    const dels = [...new Set([...(c.deleted || []), ...Object.keys(c.synced).filter(id => !ids.has(id))])];
    let failed = false;
    if (puts.length || dels.length) setSaveState('Saving');
    for (const f of puts) {
      try { await store.put(f); c.synced = { ...c.synced, [f.id]: f.updated }; }
      catch (e) {
        failed = true;
        if (e.code === 'signed_out') { toast(`You’ve been signed out. Sign in again to keep saving to ${where}.`); break; }
        if (e.code === 'too_large') toast(drive ? 'Your Google Drive is full. Free up space to keep saving.' : `“${f.title}” is too large to save to your account. Remove some images from it.`);
      }
    }
    for (const id of dels) {
      try { await store.remove(id); const { [id]: _, ...rest } = c.synced; c.synced = rest; c.deleted = (c.deleted || []).filter(x => x !== id); }
      catch (e) { failed = true; c.deleted = [...new Set([...(c.deleted || []), id])]; }
    }
    cache.current = { ...c, files: filesRef.current };
    saveCache(uid, cache.current);
    setSaveState(failed ? 'Offline' : 'Saved');
    syncing.current = false;
    if (again.current) { again.current = false; sync(); }
    else if (failed) retry.current = setTimeout(sync, 15000);
  }, [cloud, uid, toast]); // eslint-disable-line react-hooks/exhaustive-deps

  const first = useRef(true);
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    if (!cloud) setSaveState('Saving');
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
    document.addEventListener('visibilitychange', vis);
    return () => { removeEventListener('pagehide', flush); removeEventListener('online', sync); document.removeEventListener('visibilitychange', vis); };
  }, [writeLocal, sync]);

  // Cloud: fetch the account's files, combine them with this browser's copy, and offer to bring in
  // files that were made here without an account.
  useEffect(() => {
    if (!cloud) return;
    let live = true;
    if (drive) loadDriveFolders().then(fs => { if (!live) return; foldersReady.current = true; setFolders(fs); }, () => {});
    store.list().then(async remote => {
      if (!live) return;
      const c = cache.current;
      c.synced = Object.fromEntries(remote.map(f => [f.id, f.updated]));
      let next = merge(remote, c);
      loaded.current = true;
      const key = 'linework:imported:' + uid;
      const old = (() => { try { return localStorage.getItem(key) ? [] : loadFiles(); } catch (e) { return []; } })()
        .filter(f => !next.some(x => x.id === f.id));
      setFiles(next);
      if (old.length) {
        const ok = await ask({ title: `Add ${old.length} file${old.length === 1 ? '' : 's'} from this browser?`, text: `They were made without an account. Add them to ${where} so they’re saved online and on your other devices.`, input: false, ok: drive ? 'Add to Google Drive' : 'Add to my account' });
        try { localStorage.setItem(key, '1'); } catch (e) {}
        if (ok && live) setFiles(fs => [...fs, ...old.filter(f => !fs.some(x => x.id === f.id))]);
      }
      sync();
    }, e => {
      if (!live) return;
      loaded.current = true; // work from this browser's copy; uploads retry later
      setSaveState('Offline');
      if (e && e.code === 'signed_out') toast('Your session ended. Sign in again to see your files.');
      retry.current = setTimeout(sync, 15000);
    });
    return () => { live = false; clearTimeout(retry.current); };
  }, [cloud, uid]); // eslint-disable-line react-hooks/exhaustive-deps

  // Folders live on the account, in Google Drive (with a copy in this browser), or in this browser.
  const firstF = useRef(true);
  useEffect(() => {
    if (firstF.current) { firstF.current = false; return; }
    if (!cloud) { saveFolders(folders); return; }
    if (drive) { cache.current = { ...cache.current, folders }; saveCache(uid, cache.current); }
    if (!foldersReady.current) return;
    const t = setTimeout(() => { (drive ? saveDriveFolders(folders) : saveProfile({ folders })).catch(() => {}); }, 800);
    return () => clearTimeout(t);
  }, [folders, cloud, drive, uid]);

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
  const file = files.find(f => f.id === openId);

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
    return (
      <Editor key={file.id} file={file} update={updateOpen} saveState={saveState}
        onBack={() => setOpenId(null)}
        onRename={() => rename(file)}
        onDuplicate={() => { const c = duplicate(file); setOpenId(c.id); }}
        onDelete={() => remove(file)}
        onGuide={setGuide} />
    );
  }
  return (
    <Home files={files} folders={folders} setFolders={setFolders} account={cloud ? { ...session.user, where } : null} saveState={saveState}
      onOpen={setOpenId} onCreate={create} onUpdate={update} onRename={rename}
      onDuplicate={duplicate} onDelete={remove} onSignOut={onSignOut} onGuide={setGuide} />
  );
}
