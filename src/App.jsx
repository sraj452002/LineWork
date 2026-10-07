import { useCallback, useEffect, useRef, useState } from 'react';
import Login from './components/Login.jsx';
import Home from './components/Home.jsx';
import Editor from './components/Editor.jsx';
import Guide from './components/Guide.jsx';
import { UIProvider, useUI } from './components/ui.jsx';
import { isSignedIn, signIn, signOut } from './lib/auth.js';
import { loadFiles, saveFiles } from './lib/storage.js';
import { tidyImages } from './lib/images.js';
import { clone, rid } from './lib/utils.js';
import { dg } from './lib/engines.js';

export default function App() {
  const [authed, setAuthed] = useState(isSignedIn);
  return (
    <UIProvider>
      {authed
        ? <Workspace onSignOut={() => { signOut(); setAuthed(false); }} />
        : <Login onSignedIn={() => { signIn(); setAuthed(true); }} />}
    </UIProvider>
  );
}

function Workspace({ onSignOut }) {
  const { toast, ask } = useUI();
  const [files, setFiles] = useState(loadFiles);
  const [openId, setOpenId] = useState(null);
  const [guide, setGuide] = useState(null); // null | 'app' | 'erd'
  const [saveState, setSaveState] = useState('Saved');
  const filesRef = useRef(files);
  filesRef.current = files;

  // Save to the browser shortly after each change, and right away when the page is hidden.
  const first = useRef(true);
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    setSaveState('Saving');
    const t = setTimeout(() => {
      const ok = saveFiles(files);
      setSaveState(ok ? 'Saved' : 'Not saved');
      if (!ok) toast('Browser storage is full. Delete some files to keep saving.');
    }, 500);
    return () => clearTimeout(t);
  }, [files, toast]);
  useEffect(() => {
    const flush = () => saveFiles(filesRef.current);
    const vis = () => { if (document.hidden) flush(); };
    addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', vis);
    return () => { removeEventListener('pagehide', flush); document.removeEventListener('visibilitychange', vis); };
  }, []);

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
    <Home files={files} onOpen={setOpenId} onCreate={create} onUpdate={update} onRename={rename}
      onDuplicate={duplicate} onDelete={remove} onSignOut={onSignOut} onGuide={setGuide} />
  );
}
