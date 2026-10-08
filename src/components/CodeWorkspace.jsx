import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { downloads } from '../lib/ai.js';
import { rid } from '../lib/utils.js';
import { useUI } from './ui.jsx';

/* A small VS Code inside each Linework file: an explorer, tabs and the Monaco editor.
   Code lives on the file as  code: {files: [{id, path, text, lang?}], folders: [path], open: [id], active: id}
   so it saves and syncs with the doc and diagrams. Folders are implied by file paths ("src/app.js");
   empty folders are kept in `folders`. */

const EMPTY = { files: [], folders: [], open: [], active: null };
const MAX_UPLOAD = 1_000_000;
const SAMPLE = [
  { path: 'README.md', text: '# Service\n\nNotes and code that go with this design.\n' },
  { path: 'src/index.ts', text: "import { greet } from './greet';\n\nconsole.log(greet('Linework'));\n" },
  { path: 'src/greet.ts', text: 'export function greet(name: string): string {\n  return `Hello, ${name}`;\n}\n' },
];
// Short badges for the explorer and tabs, by extension.
const BADGE = {
  js: ['JS', '#C9A400'], mjs: ['JS', '#C9A400'], cjs: ['JS', '#C9A400'], jsx: ['JSX', '#1E9BC2'], ts: ['TS', '#2F74C0'], tsx: ['TSX', '#1E9BC2'],
  json: ['{}', '#B08A00'], md: ['M↓', '#4C7DBF'], css: ['#', '#7B4FC2'], scss: ['#', '#C2447A'], html: ['<>', '#D2572B'], py: ['PY', '#3572A5'],
  sql: ['SQL', '#C2702B'], go: ['GO', '#00A2C7'], rs: ['RS', '#B7410E'], java: ['JV', '#B07219'], rb: ['RB', '#B5283C'], php: ['PHP', '#6F7DB8'],
  yml: ['YML', '#B5283C'], yaml: ['YML', '#B5283C'], sh: ['$', '#4E8A3E'], tf: ['TF', '#7B42BC'], graphql: ['GQL', '#D6309B'], xml: ['<>', '#3B7A57'],
  c: ['C', '#555F9F'], cpp: ['C++', '#C2447A'], cs: ['C#', '#178600'], kt: ['KT', '#A97BFF'], swift: ['SW', '#E05735'], txt: ['TXT', '#6B7280'],
};
const extOf = p => (p.match(/\.([^./]+)$/) || [])[1]?.toLowerCase() || '';
const baseOf = p => p.slice(p.lastIndexOf('/') + 1);
const dirOf = p => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '');
const Badge = ({ path }) => {
  const [t, c] = BADGE[extOf(path)] || ['•', '#6B7280'];
  return <i className="cw-badge" style={{ color: c }} aria-hidden="true">{t}</i>;
};
const cleanPath = s => String(s || '').trim().replace(/\\/g, '/').replace(/\/{2,}/g, '/').replace(/^\/|\/$/g, '');
const badPath = p => !p || p.split('/').some(x => !x || x === '.' || x === '..') || p.length > 200;

// Folders and files as a tree, folders first, each sorted by name.
function buildTree(files, folders) {
  const root = { kids: new Map() };
  const dir = path => path.split('/').reduce((n, part, i, a) => {
    const key = a.slice(0, i + 1).join('/');
    if (!n.kids.has(part)) n.kids.set(part, { type: 'dir', path: key, name: part, kids: new Map() });
    return n.kids.get(part);
  }, root);
  folders.forEach(f => dir(f));
  files.forEach(f => {
    const d = dirOf(f.path), parent = d ? dir(d) : root;
    parent.kids.set(baseOf(f.path) + '\0f', { type: 'file', path: f.path, name: baseOf(f.path), id: f.id });
  });
  const flat = n => [...n.kids.values()]
    .sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === 'dir' ? -1 : 1))
    .map(x => (x.type === 'dir' ? { ...x, kids: flat(x) } : x));
  return flat(root);
}

export default function CodeWorkspace({ file, update, visible }) {
  const { ask, popup, toast, theme } = useUI();
  const code = file.code || EMPTY;
  const files = code.files || [], folders = code.folders || [];
  const byId = useMemo(() => new Map(files.map(f => [f.id, f])), [files]);
  const open = (code.open || []).filter(id => byId.has(id));
  const active = byId.has(code.active) ? code.active : open[0] || null;
  const activeFile = active ? byId.get(active) : null;

  const [monaco, setMonaco] = useState(null);
  const [failed, setFailed] = useState(false);
  const [collapsed, setCollapsed] = useState(() => new Set());
  const [explorer, setExplorer] = useState(() => innerWidth > 760);
  const [quick, setQuick] = useState(null); // quick-open search text, or null when closed
  const [pos, setPos] = useState({ ln: 1, col: 1, sel: 0 });
  const hostRef = useRef(null), edRef = useRef(null), models = useRef(new Map()), views = useRef(new Map());
  const uploadRef = useRef(null);

  const mut = useCallback(fn => update(c => { c.code = { ...EMPTY, ...(c.code || {}) }; fn(c.code); }), [update]);

  /* ---- saving: edits are batched and written to the file shortly after typing stops ---- */
  const pending = useRef(new Map()), saveT = useRef(0);
  const flush = useCallback(() => {
    clearTimeout(saveT.current);
    if (!pending.current.size) return;
    const p = pending.current;
    pending.current = new Map();
    mut(c => { c.files = c.files.map(f => (p.has(f.id) ? { ...f, text: p.get(f.id) } : f)); });
  }, [mut]);
  const flushRef = useRef(flush);
  flushRef.current = flush;

  /* ---- Monaco ---- */
  useEffect(() => {
    let live = true;
    import('../lib/monaco.js').then(m => { if (live) setMonaco(m.default); }, () => { if (live) setFailed(true); });
    return () => { live = false; };
  }, []);

  const themeName = () => {
    const dark = getComputedStyle(document.documentElement).colorScheme === 'dark';
    const cs = getComputedStyle(document.documentElement), v = n => cs.getPropertyValue(n).trim();
    const name = dark ? 'linework-dark' : 'linework-light';
    monaco.editor.defineTheme(name, {
      base: dark ? 'vs-dark' : 'vs', inherit: true, rules: [],
      colors: { 'editor.background': v('--surface'), 'editorGutter.background': v('--surface'), 'minimap.background': v('--surface') },
    });
    return name;
  };

  useLayoutEffect(() => {
    if (!monaco || !hostRef.current) return;
    const ed = monaco.editor.create(hostRef.current, {
      model: null, automaticLayout: true, theme: themeName(), fontFamily: 'JetBrains Mono, ui-monospace, Menlo, Consolas, monospace',
      fontSize: 13, lineHeight: 20, tabSize: 2, minimap: { enabled: innerWidth > 900 }, scrollBeyondLastLine: false,
      bracketPairColorization: { enabled: true }, guides: { bracketPairs: true }, renderWhitespace: 'selection',
      smoothScrolling: true, cursorSmoothCaretAnimation: 'on', fixedOverflowWidgets: true, padding: { top: 8 },
    });
    edRef.current = ed;
    ed.onDidChangeCursorSelection(e => {
      const s = e.selection, m = ed.getModel();
      setPos({ ln: s.positionLineNumber, col: s.positionColumn, sel: m ? m.getValueInRange(s).length : 0 });
    });
    ed.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => { flushRef.current(); toast('Saved'); });
    ed.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyP, () => setQuick(''));
    return () => {
      flushRef.current();
      ed.dispose();
      models.current.forEach(x => x.model.dispose());
      models.current.clear();
      edRef.current = null;
    };
  }, [monaco]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { if (monaco) monaco.editor.setTheme(themeName()); }, [monaco, theme]); // eslint-disable-line react-hooks/exhaustive-deps

  const langOf = useCallback(f => {
    if (f.lang) return f.lang;
    const name = baseOf(f.path).toLowerCase(), ext = '.' + extOf(f.path);
    const hit = monaco.languages.getLanguages().find(l => (l.filenames || []).some(n => n.toLowerCase() === name) || (l.extensions || []).includes(ext));
    return hit ? hit.id : 'plaintext';
  }, [monaco]);

  // Keep one Monaco model per file (each keeps its own undo history), in step with the file list.
  useEffect(() => {
    if (!monaco) return;
    const seen = new Set();
    files.forEach(f => {
      seen.add(f.id);
      const cur = models.current.get(f.id);
      if (cur && cur.path === f.path) {
        const lang = langOf(f);
        if (cur.model.getLanguageId() !== lang) monaco.editor.setModelLanguage(cur.model, lang);
        return;
      }
      const text = cur ? cur.model.getValue() : f.text || '';
      const uri = monaco.Uri.file('/' + f.path);
      monaco.editor.getModel(uri)?.dispose();
      const model = monaco.editor.createModel(text, langOf(f), uri);
      model.onDidChangeContent(() => {
        pending.current.set(f.id, model.getValue());
        clearTimeout(saveT.current);
        saveT.current = setTimeout(() => flushRef.current(), 400);
      });
      if (cur) { if (edRef.current?.getModel() === cur.model) edRef.current.setModel(model); cur.model.dispose(); }
      models.current.set(f.id, { model, path: f.path });
    });
    models.current.forEach((x, id) => { if (!seen.has(id)) { x.model.dispose(); models.current.delete(id); views.current.delete(id); } });
  }, [monaco, files, langOf]);

  // Show the active file, back where it was left.
  const shown = useRef(null);
  useEffect(() => {
    const ed = edRef.current;
    if (!ed) return;
    const next = active && models.current.get(active);
    if (shown.current && shown.current !== active) views.current.set(shown.current, ed.saveViewState());
    if (!next) { ed.setModel(null); shown.current = null; return; }
    if (ed.getModel() !== next.model) {
      ed.setModel(next.model);
      const vs = views.current.get(active);
      if (vs) ed.restoreViewState(vs);
    }
    shown.current = active;
    if (visible) ed.focus();
  }, [active, monaco, files, visible]);

  useEffect(() => () => flushRef.current(), []);

  /* ---- files and folders ---- */
  const taken = (p, except) => files.some(f => f.path === p && f.id !== except) || folders.includes(p);
  const openFile = id => mut(c => { if (!c.open.includes(id)) c.open = [...c.open, id]; c.active = id; });
  const closeTab = id => mut(c => {
    const i = c.open.indexOf(id);
    c.open = c.open.filter(x => x !== id);
    if (c.active === id) c.active = c.open[Math.min(i, c.open.length - 1)] || null;
  });
  // Add files (renamed on a clash). open: 'all' opens a tab for each, 'first' just the first one.
  const addFiles = (list, open = 'all') => mut(c => {
    const made = list.map(({ path, text }) => {
      let p = path, n = 1;
      while (c.files.some(f => f.path === p)) p = path.replace(/(\.[^./]+)?$/, m => ` (${++n})${m}`);
      return { id: rid('cf'), path: p, text };
    });
    c.files = [...c.files, ...made];
    const show = open === 'first' ? made.slice(0, 1) : made;
    if (show.length) { c.open = [...c.open, ...show.map(f => f.id)]; c.active = show[show.length - 1].id; }
  });
  const newFile = async (dir = '') => {
    const v = await ask({ title: 'New file', text: dir ? `In ${dir}/. Use slashes for folders, like utils/date.ts.` : 'Use slashes for folders, like src/app.ts.', value: '', ok: 'Create' });
    const p = cleanPath((dir ? dir + '/' : '') + (v || ''));
    if (!v || !v.trim()) return;
    if (badPath(p)) { toast('That isn’t a valid file name'); return; }
    if (taken(p)) { toast(`${p} already exists`); return; }
    mut(c => { const f = { id: rid('cf'), path: p, text: '' }; c.files = [...c.files, f]; c.open = [...c.open, f.id]; c.active = f.id; });
    if (dir) setCollapsed(s => { const n = new Set(s); n.delete(dir); return n; });
  };
  const newFolder = async (dir = '') => {
    const v = await ask({ title: 'New folder', value: '', ok: 'Create' });
    const p = cleanPath((dir ? dir + '/' : '') + (v || ''));
    if (!v || !v.trim()) return;
    if (badPath(p)) { toast('That isn’t a valid folder name'); return; }
    if (taken(p) || files.some(f => f.path.startsWith(p + '/'))) { toast(`${p} already exists`); return; }
    mut(c => { c.folders = [...c.folders, p]; });
  };
  const rename = async node => {
    const v = await ask({ title: node.type === 'dir' ? 'Rename folder' : 'Rename file', value: node.name, ok: 'Rename' });
    if (!v || !v.trim() || v.trim() === node.name) return;
    const parent = dirOf(node.path), p = cleanPath((parent ? parent + '/' : '') + v);
    if (badPath(p)) { toast('That isn’t a valid name'); return; }
    if (node.type === 'file') {
      if (taken(p, node.id)) { toast(`${p} already exists`); return; }
      flush();
      mut(c => { c.files = c.files.map(f => (f.id === node.id ? { ...f, path: p } : f)); });
      return;
    }
    const from = node.path + '/';
    if (taken(p) || files.some(f => f.path.startsWith(p + '/'))) { toast(`${p} already exists`); return; }
    flush();
    mut(c => {
      c.files = c.files.map(f => (f.path.startsWith(from) ? { ...f, path: p + '/' + f.path.slice(from.length) } : f));
      c.folders = c.folders.map(d => (d === node.path ? p : d.startsWith(from) ? p + '/' + d.slice(from.length) : d));
    });
  };
  const remove = async node => {
    const inside = node.type === 'dir' ? files.filter(f => f.path.startsWith(node.path + '/')) : [];
    const ok = await ask({
      title: node.type === 'dir' ? `Delete the folder “${node.name}”?` : `Delete “${node.name}”?`,
      text: node.type === 'dir' && inside.length ? `Its ${inside.length} file${inside.length === 1 ? '' : 's'} will be deleted too.` : 'This can’t be undone.',
      input: false, ok: 'Delete',
    });
    if (!ok) return;
    const gone = new Set(node.type === 'dir' ? inside.map(f => f.id) : [node.id]);
    gone.forEach(id => pending.current.delete(id));
    mut(c => {
      c.files = c.files.filter(f => !gone.has(f.id));
      if (node.type === 'dir') c.folders = c.folders.filter(d => d !== node.path && !d.startsWith(node.path + '/'));
      c.open = c.open.filter(id => !gone.has(id));
      if (gone.has(c.active)) c.active = c.open[c.open.length - 1] || null;
    });
  };
  const download = f => {
    const m = models.current.get(f.id);
    downloads.save({ filename: baseOf(f.path), data: m ? m.model.getValue() : f.text || '' });
  };
  const upload = async list => {
    const got = [];
    for (const f of [...list]) {
      if (f.size > MAX_UPLOAD) { toast(`${f.name} is over 1 MB, so it was skipped`); continue; }
      const text = await f.text().catch(() => null);
      if (text == null || text.includes('\0')) { toast(`${f.name} isn’t a text file, so it was skipped`); continue; }
      got.push({ path: cleanPath(f.webkitRelativePath || f.name), text });
    }
    if (got.length) addFiles(got);
  };
  const nodeMenu = (anchor, node) => popup(anchor, node.type === 'dir' ? [
    { label: 'New file', act: () => newFile(node.path) },
    { label: 'New folder', act: () => newFolder(node.path) },
    '-',
    { label: 'Rename', act: () => rename(node) },
    { label: 'Delete', danger: true, act: () => remove(node) },
  ] : [
    { label: 'Open', act: () => openFile(node.id) },
    { label: 'Download', act: () => download(byId.get(node.id)) },
    '-',
    { label: 'Rename', act: () => rename(node) },
    { label: 'Delete', danger: true, act: () => remove(node) },
  ]);

  const tree = useMemo(() => buildTree(files, folders), [files, folders]);
  const toggle = p => setCollapsed(s => { const n = new Set(s); if (n.has(p)) n.delete(p); else n.add(p); return n; });
  const rows = [];
  const walk = (nodes, depth) => nodes.forEach(n => {
    rows.push({ n, depth });
    if (n.type === 'dir' && !collapsed.has(n.path)) walk(n.kids, depth + 1);
  });
  walk(tree, 0);

  /* ---- shortcuts outside the editor: Ctrl P quick open, Ctrl B explorer ---- */
  useEffect(() => {
    if (!visible) return;
    const key = e => {
      if (document.querySelector('.modal')) return;
      const mod = e.ctrlKey || e.metaKey, k = e.key.toLowerCase();
      if (mod && k === 'p') { e.preventDefault(); setQuick(''); }
      else if (mod && k === 'b' && !e.shiftKey) { e.preventDefault(); setExplorer(x => !x); }
      else if (mod && k === 's' && !e.target.closest?.('.monaco-editor')) { e.preventDefault(); flushRef.current(); toast('Saved'); }
    };
    document.addEventListener('keydown', key);
    return () => document.removeEventListener('keydown', key);
  }, [visible, toast]);

  const langName = activeFile && monaco ? (monaco.languages.getLanguages().find(l => l.id === langOf(activeFile))?.aliases?.[0] || langOf(activeFile)) : '';
  const langMenu = anchor => {
    const ids = ['plaintext', 'markdown', 'javascript', 'typescript', 'json', 'html', 'css', 'python', 'sql', 'yaml', 'shell', 'go', 'rust', 'java', 'csharp', 'cpp', 'php', 'ruby', 'kotlin', 'swift', 'graphql', 'dockerfile', 'hcl', 'xml'];
    const names = new Map(monaco.languages.getLanguages().map(l => [l.id, l.aliases?.[0] || l.id]));
    popup(anchor, [
      { label: 'Detect from the file name', on: !activeFile.lang, act: () => mut(c => { c.files = c.files.map(f => (f.id === active ? (({ lang, ...r }) => r)(f) : f)); }) },
      '-',
      ...ids.filter(id => names.has(id)).map(id => ({ label: names.get(id), on: activeFile.lang === id, act: () => mut(c => { c.files = c.files.map(f => (f.id === active ? { ...f, lang: id } : f)); }) })),
    ]);
  };

  return (
    <div className="cw" data-explorer={explorer ? 'on' : 'off'}>
      <div className="cw-main">
        {explorer && (
          <aside className="cw-explorer" aria-label="Explorer">
            <div className="cw-exhead">
              <span>Explorer</span>
              <button className="cw-ib" title="New file" aria-label="New file" onClick={() => newFile()}><svg viewBox="0 0 24 24"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8zM14 3v5h5M12 11v6M9 14h6" /></svg></button>
              <button className="cw-ib" title="New folder" aria-label="New folder" onClick={() => newFolder()}><svg viewBox="0 0 24 24"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zM12 10v6M9 13h6" /></svg></button>
              <button className="cw-ib" title="Open files from your computer" aria-label="Open files from your computer" onClick={() => uploadRef.current?.click()}><svg viewBox="0 0 24 24"><path d="M12 16V4M7 9l5-5 5 5M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3" /></svg></button>
              <button className="cw-ib" title="Collapse folders" aria-label="Collapse folders" onClick={() => setCollapsed(new Set(rows.filter(r => r.n.type === 'dir').map(r => r.n.path).concat(folders)))}><svg viewBox="0 0 24 24"><path d="M7 15l5-5 5 5" /></svg></button>
            </div>
            <div className="cw-tree" role="tree" aria-label="Files">
              {rows.map(({ n, depth }) => (
                <div key={n.type + n.path} role="treeitem" aria-expanded={n.type === 'dir' ? !collapsed.has(n.path) : undefined}
                  aria-selected={n.type === 'file' && n.id === active} tabIndex={0}
                  className={'cw-row' + (n.type === 'file' && n.id === active ? ' on' : '')} style={{ paddingLeft: 8 + depth * 14 }}
                  onClick={() => (n.type === 'dir' ? toggle(n.path) : openFile(n.id))}
                  onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); n.type === 'dir' ? toggle(n.path) : openFile(n.id); } else if (e.key === 'F2') rename(n); else if (e.key === 'Delete') remove(n); }}
                  onContextMenu={e => { e.preventDefault(); nodeMenu(e.currentTarget, n); }}>
                  {n.type === 'dir'
                    ? <i className={'cw-chev' + (collapsed.has(n.path) ? '' : ' open')} aria-hidden="true" />
                    : <Badge path={n.path} />}
                  <span className="cw-name">{n.name}</span>
                  <button className="cw-more" aria-label={`Actions for ${n.name}`} onClick={e => { e.stopPropagation(); nodeMenu(e.currentTarget, n); }}>⋯</button>
                </div>
              ))}
              {!rows.length && <p className="cw-hint">No files yet.</p>}
            </div>
          </aside>
        )}

        <section className="cw-editor">
          {open.length > 0 && (
            <div className="cw-tabs" role="tablist" aria-label="Open files">
              {open.map(id => {
                const f = byId.get(id);
                return (
                  <div key={id} role="tab" aria-selected={id === active} tabIndex={0} title={f.path}
                    className={'cw-tab' + (id === active ? ' on' : '')}
                    onClick={() => mut(c => { c.active = id; })}
                    onAuxClick={e => { if (e.button === 1) closeTab(id); }}
                    onKeyDown={e => { if (e.key === 'Enter') mut(c => { c.active = id; }); }}>
                    <Badge path={f.path} /><span>{baseOf(f.path)}</span>
                    <button className="cw-x" aria-label={`Close ${baseOf(f.path)}`} onClick={e => { e.stopPropagation(); closeTab(id); }}>×</button>
                  </div>
                );
              })}
            </div>
          )}
          {activeFile && (
            <div className="cw-crumbs" aria-label="Path">
              {activeFile.path.split('/').map((p, i, a) => <span key={i}>{p}{i < a.length - 1 && <i>›</i>}</span>)}
            </div>
          )}
          <div className="cw-host" ref={hostRef} style={{ visibility: activeFile ? 'visible' : 'hidden' }} />
          {!activeFile && (
            <div className="cw-welcome">
              <h2>Code</h2>
              <p>Keep code, configs and queries next to this design: an editor like VS Code, with syntax highlighting, IntelliSense for JavaScript and TypeScript, find and replace, multiple cursors and the command palette (F1).</p>
              {failed ? <p className="err">The editor couldn’t load. Check your connection and reopen this view.</p> : (
                <div className="cw-start">
                  <button className="btn dark" onClick={() => newFile()}>New file</button>
                  <button className="btn" onClick={() => uploadRef.current?.click()}>Open files from your computer</button>
                  {!files.length && <button className="btn" onClick={() => addFiles(SAMPLE.map(x => ({ ...x })), 'first')}>Start from a sample</button>}
                </div>
              )}
              {files.length > 0 && <p className="cw-hint">Or pick a file in the explorer. <kbd>Ctrl P</kbd> finds files by name.</p>}
            </div>
          )}
        </section>
      </div>

      <footer className="cw-status">
        <button onClick={() => setExplorer(x => !x)} title="Toggle explorer  Ctrl B" aria-pressed={explorer}>{files.length} file{files.length === 1 ? '' : 's'}</button>
        <span className="grow" />
        {activeFile && (<>
          <span>Ln {pos.ln}, Col {pos.col}{pos.sel ? ` (${pos.sel} selected)` : ''}</span>
          <span>Spaces: 2</span>
          <span>UTF-8</span>
          {monaco && <button onClick={e => langMenu(e.currentTarget)} title="Change the language">{langName}</button>}
        </>)}
        <button onClick={() => setQuick('')} title="Go to file  Ctrl P">Go to file</button>
      </footer>

      {quick != null && <QuickOpen files={files} q={quick} setQ={setQuick} onPick={id => { setQuick(null); openFile(id); }} onClose={() => { setQuick(null); edRef.current?.focus(); }} />}
      <input ref={uploadRef} type="file" multiple hidden onChange={e => { upload(e.target.files); e.target.value = ''; }} />
    </div>
  );
}

// Ctrl P: find a file by typing parts of its path.
function QuickOpen({ files, q, setQ, onPick, onClose }) {
  const [on, setOn] = useState(0);
  const needle = q.toLowerCase().replace(/\s+/g, '');
  const score = p => {
    let i = 0, s = 0, last = -1;
    const h = p.toLowerCase();
    for (const ch of needle) { const j = h.indexOf(ch, i); if (j < 0) return -1; s += j === last + 1 ? 2 : 0; last = j; i = j + 1; }
    return s + (h.endsWith(needle) || baseOf(h).startsWith(needle) ? 5 : 0);
  };
  const list = files.map(f => ({ f, s: needle ? score(f.path) : 0 })).filter(x => x.s >= 0)
    .sort((a, b) => b.s - a.s || a.f.path.localeCompare(b.f.path)).slice(0, 50);
  useEffect(() => { setOn(0); }, [q]);
  return (
    <div className="cw-quick-back" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="cw-quick" role="dialog" aria-label="Go to file">
        <input autoFocus value={q} placeholder="Search files by name" aria-label="Search files by name"
          onChange={e => setQ(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Escape') { e.preventDefault(); onClose(); }
            else if (e.key === 'ArrowDown') { e.preventDefault(); setOn(i => Math.min(list.length - 1, i + 1)); }
            else if (e.key === 'ArrowUp') { e.preventDefault(); setOn(i => Math.max(0, i - 1)); }
            else if (e.key === 'Enter' && list[on]) { e.preventDefault(); onPick(list[on].f.id); }
          }} />
        <div className="cw-qlist" role="listbox">
          {list.map(({ f }, i) => (
            <button key={f.id} role="option" aria-selected={i === on} className={i === on ? 'on' : ''} onMouseEnter={() => setOn(i)} onClick={() => onPick(f.id)}>
              <Badge path={f.path} /><b>{baseOf(f.path)}</b><small>{dirOf(f.path)}</small>
            </button>
          ))}
          {!list.length && <p className="cw-hint">No matching files.</p>}
        </div>
      </div>
    </div>
  );
}
