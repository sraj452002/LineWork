import { useEffect, useRef, useState } from 'react';
import { TEMPLATES, TYPES, dg, newFile, thumb } from '../lib/engines.js';
import { LANG, NO_AI, copyFor, sampleP } from '../lib/ai.js';
import { ago, rid } from '../lib/utils.js';
import { Brand, useUI } from './ui.jsx';

const IC = {
  grid: 'M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z',
  archive: 'M4 5h16v4H4zM5 9v10h14V9M10 13h4',
  folder: 'M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z',
  folderPlus: 'M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zM12 10v6M9 13h6',
  layers: 'M12 3 3 8l9 5 9-5zM3 13l9 5 9-5',
  search: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM20 20l-4-4',
  plus: 'M12 4v16M4 12h16',
  sparkle: 'M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8zM19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z',
  doc: 'M7 3h7l5 5v13H7zM14 3v5h5M10 13h6M10 17h6',
  book: 'M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2zM4 21V5M8 7h7',
  table: 'M4 5h16v14H4zM4 10h16M10 10v9',
  logout: 'M15 4h4v16h-4M10 8l-4 4 4 4M6 12h11',
  caret: 'M7 10l5 5 5-5',
  sort: 'M8 5v14M5 16l3 3 3-3M14 7h6M14 12h4M14 17h2',
};
const Ico = ({ d, size = 18 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={d} /></svg>
);

const COLS = [
  { key: 'title', label: 'Name' },
  { key: 'folder', label: 'Location', cls: 'c-loc' },
  { key: 'created', label: 'Created', cls: 'c-date' },
  { key: 'updated', label: 'Edited', cls: 'c-date' },
  { key: 'diagrams', label: 'Diagrams', cls: 'c-num' },
];
const WEEK = 7 * 864e5;
const greeting = () => { const h = new Date().getHours(); return h < 5 ? 'Working late' : h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening'; };
// A small preview of a file's first diagram, cached until the file or the theme changes.
const thumbs = new Map();
function fileThumb(f, theme) {
  const d = f.diagrams.find(x => (x.code && x.code.trim()) || (x.shapes && x.shapes.length));
  const key = f.id + ':' + f.updated + ':' + theme;
  if (!thumbs.has(key)) { try { thumbs.set(key, d ? thumb(d) : ''); } catch (e) { thumbs.set(key, ''); } }
  return thumbs.get(key);
}

const typing = e => {
  const t = e.target;
  return t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName);
};

export default function Home({ files, folders, setFolders, account, saveState, onOpen, onCreate, onUpdate, onRename, onDuplicate, onDelete, onSignOut, onGuide }) {
  const { popup, ask, toast, theme } = useUI();
  const [q, setQ] = useState('');
  const [view, setView] = useState('all'); // 'all' | 'archive' | folder id
  const [tab, setTab] = useState('all'); // 'all' | 'recent'
  const [sort, setSort] = useState({ key: 'updated', dir: -1 });
  const [busy, setBusy] = useState(false);
  const ctl = useRef(null);
  const searchRef = useRef(null);
  const newRef = useRef(null);


  const createFrom = t => {
    const f = newFile(t);
    if (folders.some(x => x.id === view)) f.folder = view;
    onCreate(f);
  };
  const newMenu = anchor => popup(anchor, TEMPLATES.map(t => ({ label: t.name, note: t.note, act: () => createFrom(t) })));

  const generate = async () => {
    if (ctl.current) { ctl.current.abort(); return; }
    const sample = await sampleP;
    if (!sample) { toast(NO_AI); return; }
    const text = ((await ask({
      title: 'Generate an AI diagram',
      text: 'Describe a system, a process, or a schema. AI writes a short design doc and draws the diagrams to go with it. You can paste Terraform, SQL, or code too.',
      multiline: true, ok: 'Generate',
    })) || '').trim();
    if (!text) return;
    ctl.current = new AbortController();
    setBusy(true);
    const p = `You are the AI in Linework, a tool for technical design docs and diagrams. Create a new file for this request.

${LANG.graph}
${LANG.architecture}
${LANG.flowchart}

${LANG.sequence}

${LANG.erd}

Request:
<<<
${text}
>>>

Produce:
- "title": a short file name (under 48 characters).
- "doc": a concise markdown design doc, 250 to 600 words, with sections: Context, Goals, Non-goals, Proposal, Risks and open questions. Refer to the diagrams by name where useful. Start with a "# " heading.
- "diagrams": 1 to 3 diagrams that best explain the request. Each is {"type": "architecture" | "flowchart" | "sequence" | "erd", "name": "<short tab name>", "code": "<diagram code>"}. Pick types that suit the request: architecture for systems, flowchart for processes, sequence for interactions over time, erd for data models.

Reply with ONLY a JSON object: {"title": "...", "doc": "...", "diagrams": [...]}`;
    try {
      const res = await sample.json(p, { signal: ctl.current.signal, cache: false, modelTier: 'default' });
      const ds = (Array.isArray(res && res.diagrams) ? res.diagrams : [])
        .filter(d => d && typeof d.code === 'string' && TYPES[d.type] && TYPES[d.type].E.parse(d.code).count > 0);
      if (!ds.length && !(res && typeof res.doc === 'string')) throw { code: 'empty' };
      const now = Date.now();
      onCreate({
        id: rid('f'), title: String(res.title || 'Untitled').slice(0, 120), created: now, updated: now,
        doc: typeof res.doc === 'string' ? res.doc : '',
        diagrams: ds.length ? ds.map(d => dg(d.type, String(d.name || TYPES[d.type].name).slice(0, 40), d.code.trim())) : [dg('architecture', 'Diagram 1', '')],
        active: 0, view: 'both',
        ...(folders.some(x => x.id === view) ? { folder: view } : {}),
      });
    } catch (e) {
      if (!(e && e.name === 'AbortError')) toast(copyFor(e && e.code));
    } finally {
      ctl.current = null;
      setBusy(false);
    }
  };

  const addFolder = async () => {
    const v = await ask({ title: 'New folder', value: '', ok: 'Create' });
    if (!v || !v.trim()) return;
    const f = { id: rid('k'), name: v.trim().slice(0, 60) };
    setFolders(fs => [...fs, f]);
    setView(f.id);
  };
  const folderMenu = (btn, k) => popup(btn, [
    { label: 'Rename', act: async () => {
      const v = await ask({ title: 'Rename folder', value: k.name, ok: 'Rename' });
      if (v && v.trim()) setFolders(fs => fs.map(x => (x.id === k.id ? { ...x, name: v.trim().slice(0, 60) } : x)));
    } },
    '-',
    { label: 'Delete folder', danger: true, act: async () => {
      const ok = await ask({ title: 'Delete this folder?', text: `Files in “${k.name}” stay in All Files.`, input: false, ok: 'Delete' });
      if (!ok) return;
      files.filter(f => f.folder === k.id).forEach(f => onUpdate(f.id, c => { delete c.folder; }));
      setFolders(fs => fs.filter(x => x.id !== k.id));
      setView(v => (v === k.id ? 'all' : v));
    } },
  ]);

  const fileMenu = (btn, f) => popup(btn, [
    { label: 'Open', act: () => onOpen(f.id) },
    { label: 'Rename', act: () => onRename(f) },
    { label: 'Duplicate', act: () => onDuplicate(f) },
    { label: 'Move to folder', act: () => popup(btn, [
      ...folders.map(k => ({ label: k.name + (f.folder === k.id ? '  ✓' : ''), act: () => onUpdate(f.id, c => { c.folder = k.id; }) })),
      ...(folders.length ? ['-'] : []),
      ...(f.folder ? [{ label: 'Remove from folder', act: () => onUpdate(f.id, c => { delete c.folder; }) }] : []),
      { label: 'New folder…', act: async () => {
        const v = await ask({ title: 'New folder', value: '', ok: 'Create' });
        if (!v || !v.trim()) return;
        const k = { id: rid('k'), name: v.trim().slice(0, 60) };
        setFolders(fs => [...fs, k]);
        onUpdate(f.id, c => { c.folder = k.id; });
      } },
    ]) },
    f.archived
      ? { label: 'Restore from archive', act: () => onUpdate(f.id, c => { delete c.archived; }) }
      : { label: 'Archive', act: () => { onUpdate(f.id, c => { c.archived = true; }); toast('Moved to Archive'); } },
    '-',
    { label: 'Delete', danger: true, act: () => onDelete(f) },
  ]);

  // Shortcuts: / search, Alt+N new file, A all files, E archive, G guide.
  useEffect(() => {
    const key = e => {
      if (e.altKey && !e.ctrlKey && !e.metaKey && e.code === 'KeyN') { e.preventDefault(); newRef.current && newMenu(newRef.current); return; }
      if (e.ctrlKey || e.metaKey || e.altKey || typing(e) || document.querySelector('.modal,.menu')) return;
      if (e.key === '/') { e.preventDefault(); searchRef.current?.focus(); }
      else if (e.key === 'a' || e.key === 'A') setView('all');
      else if (e.key === 'e' || e.key === 'E') setView('archive');
      else if (e.key === 'g' || e.key === 'G') onGuide('app');
    };
    document.addEventListener('keydown', key);
    return () => document.removeEventListener('keydown', key);
  });

  const folderName = id => (folders.find(k => k.id === id) || {}).name || '';
  const ql = q.trim().toLowerCase();
  const val = (f, k) => (k === 'title' ? (f.title || 'Untitled').toLowerCase() : k === 'folder' ? folderName(f.folder).toLowerCase() : k === 'diagrams' ? f.diagrams.length : f[k] || 0);
  const list = files
    .filter(f => (view === 'archive' ? f.archived : !f.archived && (view === 'all' || f.folder === view)))
    .filter(f => tab !== 'recent' || Date.now() - f.updated < WEEK)
    .filter(f => !ql || (f.title || '').toLowerCase().includes(ql) || (f.doc || '').toLowerCase().includes(ql))
    .sort((a, b) => {
      const x = val(a, sort.key), y = val(b, sort.key);
      return (x < y ? -1 : x > y ? 1 : 0) * sort.dir || b.updated - a.updated;
    });
  const sortBy = k => setSort(s => (s.key === k ? { key: k, dir: -s.dir } : { key: k, dir: k === 'title' || k === 'folder' ? 1 : -1 }));

  const heading = view === 'all' ? 'All Files' : view === 'archive' ? 'Archive' : folderName(view);
  const count = k => files.filter(f => !f.archived && f.folder === k).length;
  const who = account ? (account.name || account.userMetadata?.full_name || account.email || 'You') : 'This browser';
  const initial = (who[0] || '?').toUpperCase();
  const doc = TEMPLATES.find(t => t.key === 'doc');

  const empty = files.length === 0
    ? 'No files yet. Create a blank file, generate one with AI, or start from a template.'
    : ql ? `No files match “${q.trim()}”.`
    : view === 'archive' ? 'Nothing archived. Archive a file from its ⋯ menu to tuck it away here.'
    : tab === 'recent' ? 'No files edited in the last 7 days.'
    : view === 'all' ? 'Every file is archived.' : 'This folder is empty. Move a file here from its ⋯ menu.';

  return (
    <section className="screen dash">
      <aside className="side">
        <div className="side-top"><Brand /></div>
        <nav className="side-nav" aria-label="Files">
          <button className="nav" aria-current={view === 'all' ? 'page' : undefined} onClick={() => setView('all')}>
            <Ico d={IC.grid} /><span>All Files</span><kbd>A</kbd>
          </button>
          <button className="nav" aria-current={view === 'archive' ? 'page' : undefined} onClick={() => setView('archive')}>
            <Ico d={IC.archive} /><span>Archive</span><kbd>E</kbd>
          </button>
        </nav>
        <div className="side-sec">
          <h2>Folders</h2>
          <button className="icon-btn" aria-label="New folder" title="New folder" onClick={addFolder}><Ico d={IC.folderPlus} size={17} /></button>
        </div>
        <nav className="side-nav folders" aria-label="Folders">
          {folders.length ? folders.map(k => (
            <div key={k.id} className="nav-row">
              <button className="nav" aria-current={view === k.id ? 'page' : undefined} onClick={() => setView(k.id)}>
                <Ico d={IC.folder} /><span>{k.name}</span><kbd>{count(k.id) || ''}</kbd>
              </button>
              <button className="icon-btn row-more" aria-label={'Actions for folder ' + k.name} onClick={e => folderMenu(e.currentTarget, k)}>⋯</button>
            </div>
          )) : <p className="side-empty">Group files into folders.</p>}
        </nav>
        <div className="side-sec"><h2>Help</h2></div>
        <nav className="side-nav" aria-label="Guides">
          <button className="nav" onClick={() => onGuide('app')}><Ico d={IC.book} /><span>How to use Linework</span><kbd>G</kbd></button>
          <button className="nav" onClick={() => onGuide('erd')}><Ico d={IC.table} /><span>Database schema guide</span></button>
        </nav>
        <div className="side-foot">
          <div className="side-acct" title={account ? account.email : 'Files are saved in this browser only'}>
            <span className="avatar sm">{initial}</span>
            <span><b>{account ? who : 'No account'}</b><small>{account ? (saveState === 'Offline' ? 'Offline, will retry' : saveState === 'Syncing' ? 'Syncing…' : 'Saved to your account') : 'Saved in this browser only'}</small></span>
          </div>
          <button className="nav" onClick={onSignOut}><Ico d={IC.logout} /><span>{account ? 'Sign out' : 'Sign in or create an account'}</span></button>
          <button ref={newRef} className="new-btn" aria-haspopup="menu" onClick={e => newMenu(e.currentTarget)}>
            New File <small>Alt N</small><Ico d={IC.caret} size={16} />
          </button>
        </div>
      </aside>

      <main className="main">
        <div className="main-in">
          <header className="topbar">
            <div className="tabs" role="tablist" aria-label="Filter files">
              {[['all', 'All'], ['recent', 'Recents']].map(([k, l]) => (
                <button key={k} role="tab" aria-selected={tab === k} className="tab-btn" onClick={() => setTab(k)}>{l}</button>
              ))}
            </div>
            <label className="dsearch">
              <Ico d={IC.search} size={17} />
              <input ref={searchRef} type="search" placeholder="Search" aria-label="Search files" value={q}
                onChange={e => setQ(e.target.value)} onKeyDown={e => { if (e.key === 'Escape') { setQ(''); e.currentTarget.blur(); } }} />
              <kbd>/</kbd>
            </label>
            <div className="avatar" title={who}>{initial}</div>
          </header>

          <div className="hello">
            <h1>{greeting()}{account && (account.name || account.userMetadata?.full_name) ? ', ' + String(account.name || account.userMetadata.full_name).split(' ')[0] : ''}</h1>
            <p>{files.length ? 'Pick up where you left off, or start something new.' : 'Start a design: a diagram, a doc, and the code that goes with them.'}</p>
          </div>

          <div className="actions">
            <button className="action a-blue" aria-label="Create a Blank File" onClick={() => createFrom(TEMPLATES[0])}>
              <i className="a-ico"><Ico d={IC.plus} size={24} /></i><span>Create a Blank File</span><small>An empty doc and canvas</small>
            </button>
            <button className={'action a-purple' + (busy ? ' working' : '')} aria-label={busy ? 'Generating, click to stop' : 'Generate an AI Diagram'} onClick={generate}>
              <i className="a-ico"><Ico d={IC.sparkle} size={24} /></i><span className={busy ? 'busy' : undefined}>{busy ? 'Generating… click to stop' : 'Generate an AI Diagram'}</span><small>Describe a system, AI draws it</small>
            </button>
            <button className="action a-green" aria-label="Write a Design Doc" onClick={() => doc && createFrom(doc)}>
              <i className="a-ico"><Ico d={IC.doc} size={24} /></i><span>Write a Design Doc</span><small>Sections ready to fill in</small>
            </button>
            <button className="action a-orange" aria-label="Start from a Template" aria-haspopup="menu" onClick={e => popup(e.currentTarget, TEMPLATES.filter(t => t.key !== 'blank' && t.key !== 'doc').map(t => ({ label: t.name, note: t.note, act: () => createFrom(t) })))}>
              <i className="a-ico"><Ico d={IC.layers} size={24} /></i><span>Start from a Template</span><small>Architecture, flows, schemas</small>
            </button>
          </div>

          <h2 className="list-title">{heading}</h2>
          {!list.length ? <div className="nofiles">{empty}</div> : (
            <table className="ftable">
              <thead>
                <tr>
                  {COLS.map(c => (
                    <th key={c.key} className={c.cls} aria-sort={sort.key === c.key ? (sort.dir > 0 ? 'ascending' : 'descending') : undefined}>
                      <button onClick={() => sortBy(c.key)}>
                        {sort.key === c.key && <span className={'arrow' + (sort.dir > 0 ? ' up' : '')}><Ico d={IC.sort} size={14} /></span>}
                        {c.label}
                      </button>
                    </th>
                  ))}
                  <th className="c-author">Author</th>
                  <th className="c-act"><span className="sr">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {list.map(f => (
                  <tr key={f.id} tabIndex={0} onClick={() => onOpen(f.id)}
                    onKeyDown={e => { if ((e.key === 'Enter' || e.key === ' ') && e.target === e.currentTarget) { e.preventDefault(); onOpen(f.id); } }}>
                    <td className="c-name"><span className="f-cell">
                      <span className="f-thumb" aria-hidden="true" dangerouslySetInnerHTML={{ __html: fileThumb(f, theme) || '' }} />
                      <span className="f-name">{f.title || 'Untitled'}<small>{f.diagrams.map(x => TYPES[x.type]?.name).filter((v, i, a) => v && a.indexOf(v) === i).join(' · ')}{f.code?.files?.length ? ` · ${f.code.files.length} code file${f.code.files.length === 1 ? '' : 's'}` : ''}</small></span>
                    </span></td>
                    <td className="c-loc">{folderName(f.folder) || <span className="dash-mark">—</span>}</td>
                    <td className="c-date" title={new Date(f.created || f.updated).toLocaleString()}>{ago(f.created || f.updated)}</td>
                    <td className="c-date" title={new Date(f.updated).toLocaleString()}>{ago(f.updated)}</td>
                    <td className="c-num">{f.diagrams.length}</td>
                    <td className="c-author"><span className="avatar sm" title={who}>{initial}</span></td>
                    <td className="c-act">
                      <button className="icon-btn row-more" aria-label={'Actions for ' + (f.title || 'Untitled')}
                        onClick={e => { e.stopPropagation(); fileMenu(e.currentTarget, f); }}>⋯</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </main>
    </section>
  );
}
