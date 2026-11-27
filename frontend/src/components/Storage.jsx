import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../lib/backend.js';
import { useUI } from './ui.jsx';

/* Storage: one common place for any files — PDFs, pictures, audio, video, documents, zips — in folders.
   Drag files in (or Upload), open them to preview, download, rename, move (drag a file onto a folder) and
   delete. The Storage workflow node reads and writes the same files. The server keeps them in a bucket
   (S3 / Cloudflare R2) when it has one set, else in its own storage (see backend/drive.js). */

const raw = (id, download) => `/api/drive/files/${encodeURIComponent(id)}/raw${download ? '?download=1' : ''}`;
export const fmtSize = b => (b < 1024 ? `${b} B` : b < 1024 ** 2 ? `${(b / 1024).toFixed(b < 10240 ? 1 : 0)} KB` : b < 1024 ** 3 ? `${(b / 1024 ** 2).toFixed(1)} MB` : `${(b / 1024 ** 3).toFixed(2)} GB`);
const ago = t => { const s = (Date.now() - t) / 1000; return s < 60 ? 'just now' : s < 3600 ? `${Math.floor(s / 60)} min ago` : s < 86400 ? `${Math.floor(s / 3600)} h ago` : s < 86400 * 30 ? `${Math.floor(s / 86400)} d ago` : new Date(t).toLocaleDateString(); };
const extOf = n => (n.includes('.') ? n.split('.').pop().slice(0, 4).toUpperCase() : 'FILE');
const TEXTY = /^text\/|json|xml|javascript|yaml|csv|markdown|x-sh|sql/;
// What a file is, for its look: [kind, accent].
export function kindOf(f) {
  const t = f.type || '';
  if (t.startsWith('image/')) return ['image', 'c-purple'];
  if (t.startsWith('video/')) return ['video', 'err'];
  if (t.startsWith('audio/')) return ['audio', 'c-orange'];
  if (t === 'application/pdf') return ['pdf', 'err'];
  if (/sheet|excel|csv/.test(t)) return ['sheet', 'c-green'];
  if (/word|document|rtf/.test(t)) return ['doc', 'c-blue'];
  if (/presentation|powerpoint/.test(t)) return ['slides', 'c-orange'];
  if (/zip|compressed|tar|rar|7z/.test(t)) return ['zip', 'c-ink'];
  if (TEXTY.test(t)) return ['text', 'c-blue'];
  return ['file', 'c-ink'];
}
const ICON = {
  image: 'M4 5h16v14H4zM4 16l5-5 4 4 3-3 4 4M15 9.5a1.5 1.5 0 1 0 0-.01',
  video: 'M4 6h12v12H4zM16 10l4-2v8l-4-2',
  audio: 'M9 18V6l10-2v12M9 18a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0zM19 16a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0z',
  pdf: 'M7 3h7l5 5v13H7zM14 3v5h5M9.5 14h5M9.5 17h3',
  sheet: 'M5 4h14v16H5zM5 9h14M5 14h14M10 4v16',
  doc: 'M7 3h7l5 5v13H7zM14 3v5h5M10 12h6M10 15h6M10 18h4',
  slides: 'M4 5h16v11H4zM12 16v4M8 20h8',
  zip: 'M7 3h10v18H7zM12 3v2M12 7v2M12 11v2M11 15h2v3h-2z',
  text: 'M7 3h7l5 5v13H7zM14 3v5h5M10 12h6M10 15h6',
  file: 'M7 3h7l5 5v13H7zM14 3v5h5',
  folder: 'M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z',
};
const Ico = ({ d, size = 18 }) => <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={d} /></svg>;
const parentOf = p => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '');
const baseOf = p => p.slice(p.lastIndexOf('/') + 1);
const b64 = buf => { const a = new Uint8Array(buf); let s = ''; for (let i = 0; i < a.length; i += 0x8000) s += String.fromCharCode.apply(null, a.subarray(i, i + 0x8000)); return btoa(s); };
const readPref = (k, d) => { try { return localStorage.getItem(k) || d; } catch (e) { return d; } };
const savePref = (k, v) => { try { localStorage.setItem(k, v); } catch (e) { /* private window */ } };

export default function Storage({ q = '' }) {
  const { toast, popup, ask } = useUI();
  const [data, setData] = useState(undefined); // undefined: loading; null: no server
  const [err, setErr] = useState('');
  const [folder, setFolder] = useState('');
  const [ups, setUps] = useState([]); // uploads: {key, name, pct, err}
  const [shown, setShown] = useState(null); // the file being previewed
  const [drag, setDrag] = useState(false);
  const [layout, setLayout] = useState(() => readPref('linework:storage-layout', 'grid'));
  const [sort, setSort] = useState(() => readPref('linework:storage-sort', 'recent'));
  const pick = useRef(null), depth = useRef(0);

  const load = useCallback(async () => {
    try { setData(await api('/drive')); setErr(''); }
    catch (e) { if (e.status === 0 || e.status === 404) setData(null); else setErr(e.message || 'Storage couldn’t be opened.'); }
  }, []);
  useEffect(() => { load(); }, [load]);
  const call = async (path, body, method = 'POST') => {
    try { const r = await api(path, { method, body }); await load(); return r; }
    catch (e) { toast(e.message || 'That didn’t work.'); return null; }
  };

  // Files go up one part at a time (each a small request), one file after another.
  const upload = async list => {
    const files = [...(list || [])].filter(f => f.size !== undefined);
    if (!files.length || !data) return;
    const into = folder;
    for (const f of files) {
      const key = Math.random().toString(36).slice(2);
      const set = patch => setUps(u => u.map(x => (x.key === key ? { ...x, ...patch } : x)));
      setUps(u => [...u, { key, name: f.name, pct: 0 }]);
      try {
        const up = await api('/drive/uploads', { method: 'POST', body: { name: f.name, folder: into, type: f.type, size: f.size } });
        for (let n = 0; n < up.parts; n++) {
          await api(`/drive/uploads/${up.id}/${n}`, { method: 'POST', body: { data: b64(await f.slice(n * up.part, (n + 1) * up.part).arrayBuffer()) } });
          set({ pct: Math.round(((n + 1) / up.parts) * 100) });
        }
        await api(`/drive/uploads/${up.id}`, { method: 'POST', body: {} });
        setUps(u => u.filter(x => x.key !== key));
      } catch (e) { set({ err: e.message || 'Upload failed.' }); }
      await load();
    }
  };

  const ql = q.trim().toLowerCase();
  const view = useMemo(() => {
    if (!data) return { folders: [], files: [] };
    const order = (a, b) => (sort === 'name' ? a.name.localeCompare(b.name) : sort === 'size' ? b.size - a.size : b.updated - a.updated);
    if (ql) return { folders: data.folders.filter(p => baseOf(p).toLowerCase().includes(ql)), files: data.files.filter(f => f.name.toLowerCase().includes(ql)).sort(order) };
    return { folders: data.folders.filter(p => parentOf(p) === folder), files: data.files.filter(f => f.folder === folder).sort(order) };
  }, [data, folder, ql, sort]);
  const inside = p => data.files.filter(f => f.folder === p || f.folder.startsWith(p + '/'));

  const newFolder = async () => {
    const v = await ask({ title: 'New folder', value: '', ok: 'Create' });
    if (v && v.trim()) await call('/drive/folders', { path: (folder ? folder + '/' : '') + v.trim().replace(/\//g, '-') });
  };
  const rename = async f => {
    const v = await ask({ title: 'Rename file', value: f.name, ok: 'Rename' });
    if (v && v.trim() && v.trim() !== f.name) await call(`/drive/files/${f.id}`, { name: v.trim() });
  };
  const move = (f, to) => (f.folder === to ? null : call(`/drive/files/${f.id}`, { folder: to }).then(r => r && toast(`Moved to ${to || 'Storage'}`)));
  const remove = async f => {
    if (await ask({ title: `Delete “${f.name}”?`, text: 'It’s deleted from Storage for good.', input: false, ok: 'Delete' })) {
      if (await call(`/drive/files/${f.id}`, undefined, 'DELETE')) { toast('Deleted'); if (shown?.id === f.id) setShown(null); }
    }
  };
  const copyPath = f => { const p = (f.folder ? f.folder + '/' : '') + f.name; navigator.clipboard?.writeText(p).then(() => toast('Path copied: use it in the Storage node'), () => toast(p)); };
  const fileMenu = (btn, f) => popup(btn, [
    { label: 'Open', act: () => setShown(f) },
    { label: 'Download', act: () => { const a = document.createElement('a'); a.href = raw(f.id, true); a.download = f.name; a.click(); } },
    { label: 'Rename', act: () => rename(f) },
    { label: 'Move to', items: [['', 'Storage (top)'], ...data.folders.map(p => [p, p])].filter(([p]) => p !== f.folder).map(([p, l]) => ({ label: l, act: () => move(f, p) })) },
    { label: 'Copy path', act: () => copyPath(f) },
    { label: 'Delete', danger: true, act: () => remove(f) },
  ]);
  const folderMenu = (btn, p) => popup(btn, [
    { label: 'Open', act: () => setFolder(p) },
    { label: 'Rename', act: async () => {
      const v = await ask({ title: 'Rename folder', value: baseOf(p), ok: 'Rename' });
      if (v && v.trim() && v.trim() !== baseOf(p)) await call('/drive/folders/move', { from: p, to: (parentOf(p) ? parentOf(p) + '/' : '') + v.trim().replace(/\//g, '-') });
    } },
    { label: 'Delete', danger: true, act: async () => {
      const n = inside(p).length;
      if (await ask({ title: `Delete the folder “${baseOf(p)}”?`, text: n ? `The ${n} file${n === 1 ? '' : 's'} in it go too, for good.` : 'It’s empty.', input: false, ok: 'Delete' })) {
        if (await call('/drive/folders/remove', { path: p })) { toast('Folder deleted'); if (folder === p || folder.startsWith(p + '/')) setFolder(parentOf(p)); }
      }
    } },
  ]);

  // Dragging files in from the computer (anywhere on the page), or a file onto a folder.
  const fromOutside = e => [...(e.dataTransfer?.types || [])].includes('Files');
  const dnd = {
    onDragEnter: e => { if (fromOutside(e)) { e.preventDefault(); depth.current++; setDrag(true); } },
    onDragOver: e => { if (fromOutside(e)) e.preventDefault(); },
    onDragLeave: e => { if (fromOutside(e) && --depth.current <= 0) { depth.current = 0; setDrag(false); } },
    onDrop: e => { if (!fromOutside(e)) return; e.preventDefault(); depth.current = 0; setDrag(false); upload(e.dataTransfer.files); },
  };
  const dropOn = p => ({
    onDragOver: e => { if ([...e.dataTransfer.types].includes('text/x-drive-file')) { e.preventDefault(); e.currentTarget.classList.add('st-over'); } },
    onDragLeave: e => e.currentTarget.classList.remove('st-over'),
    onDrop: e => {
      const id = e.dataTransfer.getData('text/x-drive-file');
      e.currentTarget.classList.remove('st-over');
      if (!id) return;
      e.preventDefault(); e.stopPropagation();
      const f = data.files.find(x => x.id === id);
      if (f) move(f, p);
    },
  });

  if (data === undefined && !err) return <section className="st"><p className="muted">Opening Storage…</p></section>;
  if (data === null) {
    return (
      <section className="st">
        <div className="st-empty"><span className="st-empty-ic"><Ico d={ICON.folder} size={30} /></span><h3>Storage needs the server</h3><p>Files in Storage are kept by the Workline server, and it can’t be reached right now. Try again in a minute.</p><button className="btn" onClick={load}>Try again</button></div>
      </section>
    );
  }
  if (err && !data) return <section className="st"><p className="rev-err" role="alert">{err}</p><button className="btn" onClick={load}>Try again</button></section>;

  const pct = Math.min(100, (data.used / data.limit) * 100);
  const crumbs = folder ? folder.split('/') : [];
  return (
    <section className={'st' + (drag ? ' st-drag' : '')} aria-label="Storage" {...dnd}>
      <header className="st-hero">
        <div>
          <h2>Storage</h2>
          <p>One place for all your files — PDFs, pictures, audio, video, documents. Workflows can save and read them too, with the <b>Storage</b> node.</p>
          <div className="st-use" title={`${fmtSize(data.used)} of ${fmtSize(data.limit)}`}>
            <div className="st-bar" role="meter" aria-label="Storage used" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pct)}><i style={{ width: `${Math.max(pct, data.used ? 1 : 0)}%` }} /></div>
            <span>{fmtSize(data.used)} of {fmtSize(data.limit)} used · {data.files.length} file{data.files.length === 1 ? '' : 's'}</span>
          </div>
        </div>
        <div className="st-acts">
          <button className="btn" onClick={newFolder}><Ico d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zM12 10v6M9 13h6" size={16} />New folder</button>
          <button className="btn primary" onClick={() => pick.current?.click()}><Ico d="M12 16V4M7 9l5-5 5 5M5 20h14" size={16} />Upload</button>
          <input ref={pick} type="file" multiple hidden aria-label="Files to upload" onChange={e => { upload(e.target.files); e.target.value = ''; }} />
        </div>
      </header>

      {data.where === 'bucket'
        ? <p className="st-where ok"><i aria-hidden="true">✓</i>Kept for good in {data.describe}.</p>
        : data.where === 'folder'
          ? <p className="st-where ok"><i aria-hidden="true">✓</i>Kept in the server’s data folder.</p>
          : <details className="st-where warn"><summary><i aria-hidden="true">!</i>Files are kept in the server’s memory: when the server restarts (free hosting does this after it’s idle), they’re gone. <b>Keep them for good</b></summary>
              <p>Connect a bucket: Cloudflare R2 has 10 GB free (Amazon S3, Backblaze B2 and MinIO work too). On the server (Render → Environment) set <code>S3_BUCKET</code>, <code>S3_ENDPOINT</code> (for R2: <code>https://&lt;account id&gt;.r2.cloudflarestorage.com</code>), <code>S3_ACCESS_KEY_ID</code> and <code>S3_SECRET_ACCESS_KEY</code>, then redeploy. The keys stay on the server; never put them in the code.</p>
            </details>}

      <div className="st-bar2">
        <nav className="st-crumbs" aria-label="Folder">
          {ql ? <span>Search: “{q.trim()}”</span> : <>
            <button className={folder ? '' : 'on'} onClick={() => setFolder('')} {...dropOn('')}>Storage</button>
            {crumbs.map((c, i) => { const p = crumbs.slice(0, i + 1).join('/'); return <span key={p}><i aria-hidden="true">›</i><button className={p === folder ? 'on' : ''} onClick={() => setFolder(p)} {...dropOn(p)}>{c}</button></span>; })}
          </>}
        </nav>
        <div className="st-tools">
          <select value={sort} onChange={e => { setSort(e.target.value); savePref('linework:storage-sort', e.target.value); }} aria-label="Sort files">
            <option value="recent">Newest</option><option value="name">Name</option><option value="size">Largest</option>
          </select>
          <div className="apps-chips" role="group" aria-label="Layout">
            {[['grid', 'Grid'], ['list', 'List']].map(([k, l]) => <button key={k} className={layout === k ? 'on' : ''} aria-pressed={layout === k} onClick={() => { setLayout(k); savePref('linework:storage-layout', k); }}>{l}</button>)}
          </div>
        </div>
      </div>

      {ups.length > 0 && (
        <ul className="st-ups" aria-label="Uploads">
          {ups.map(u => (
            <li key={u.key} className={u.err ? 'bad' : ''}>
              <span className="st-up-n">{u.name}</span>
              {u.err ? <><em role="alert">{u.err}</em><button className="rs-ib" aria-label={`Dismiss ${u.name}`} onClick={() => setUps(x => x.filter(y => y.key !== u.key))}>×</button></>
                : <><div className="st-bar"><i style={{ width: `${u.pct}%` }} /></div><b>{u.pct}%</b></>}
            </li>
          ))}
        </ul>
      )}

      {!view.folders.length && !view.files.length ? (
        <div className="st-empty st-drop" onClick={() => !ql && pick.current?.click()}>
          <span className="st-empty-ic"><Ico d="M12 16V4M7 9l5-5 5 5M5 20h14" size={28} /></span>
          <h3>{ql ? 'Nothing matches' : folder ? 'This folder is empty' : 'Your Storage is empty'}</h3>
          <p>{ql ? 'Try another name.' : 'Drop files here, or click to pick some. Any kind of file works.'}</p>
        </div>
      ) : (
        <div className={'st-grid' + (layout === 'list' ? ' st-list' : '')}>
          {view.folders.map(p => (
            <div key={p} className="st-item st-folder" {...dropOn(p)}>
              <button className="st-open" onClick={() => { setFolder(p); }} aria-label={`Open folder ${baseOf(p)}`}>
                <span className="st-ic"><Ico d={ICON.folder} size={layout === 'list' ? 18 : 26} /></span>
                <span className="st-name">{baseOf(p)}</span>
                <small>{ql && parentOf(p) ? parentOf(p) + ' · ' : ''}{inside(p).length} file{inside(p).length === 1 ? '' : 's'}</small>
              </button>
              <button className="st-more" aria-label={`Actions for folder ${baseOf(p)}`} onClick={e => folderMenu(e.currentTarget, p)}>⋯</button>
            </div>
          ))}
          {view.files.map(f => {
            const [k, acc] = kindOf(f);
            return (
              <div key={f.id} className={`st-item st-file k-${k}`} style={{ '--acc': `var(--${acc})` }} draggable onDragStart={e => { e.dataTransfer.setData('text/x-drive-file', f.id); e.dataTransfer.effectAllowed = 'move'; }}>
                <button className="st-open" onClick={() => setShown(f)} aria-label={`Open ${f.name}`}>
                  <span className="st-thumb">{k === 'image' && layout === 'grid' ? <img src={raw(f.id)} alt="" loading="lazy" /> : <><Ico d={ICON[k]} size={layout === 'list' ? 18 : 28} />{layout === 'grid' && <em>{extOf(f.name)}</em>}</>}</span>
                  <span className="st-name" title={f.name}>{f.name}</span>
                  <small>{ql && f.folder ? f.folder + ' · ' : ''}{fmtSize(f.size)} · {ago(f.updated)}</small>
                </button>
                <button className="st-more" aria-label={`Actions for ${f.name}`} onClick={e => fileMenu(e.currentTarget, f)}>⋯</button>
              </div>
            );
          })}
        </div>
      )}
      {drag && <div className="st-dropzone" aria-hidden="true"><div><Ico d="M12 16V4M7 9l5-5 5 5M5 20h14" size={34} /><b>Drop to upload{folder ? ` into ${baseOf(folder)}` : ''}</b></div></div>}
      {shown && <Preview f={shown} onClose={() => setShown(null)} onMenu={btn => fileMenu(btn, shown)} />}
    </section>
  );
}

// A file opened: shown as itself where the browser can (pictures, video, audio, PDFs, text).
function Preview({ f, onClose, onMenu }) {
  const [k] = kindOf(f);
  const [text, setText] = useState(null);
  const texty = k === 'text' || /csv/.test(f.type);
  useEffect(() => {
    if (!texty) return;
    let on = true;
    fetch(raw(f.id)).then(r => (r.ok ? r.text() : Promise.reject())).then(t => on && setText(t.length > 300_000 ? t.slice(0, 300_000) + '\n…' : t), () => on && setText(''));
    return () => { on = false; };
  }, [f.id, texty]);
  return (
    <div className="modal" onPointerDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="mbox st-prev" role="dialog" aria-modal="true" aria-label={f.name} onKeyDown={e => { if (e.key === 'Escape') onClose(); }}>
        <header>
          <div><h3>{f.name}</h3><small>{f.folder ? f.folder + ' · ' : ''}{fmtSize(f.size)} · {f.type}</small></div>
          <a className="btn" href={raw(f.id, true)} download={f.name}>Download</a>
          <button className="rs-ib" aria-label="More actions" onClick={e => onMenu(e.currentTarget)}>⋯</button>
          <button className="rs-ib" aria-label="Close" autoFocus onClick={onClose}>×</button>
        </header>
        <div className="st-prev-body">
          {k === 'image' ? <img src={raw(f.id)} alt={f.name} />
            : k === 'video' ? <video src={raw(f.id)} controls />
              : k === 'audio' ? <audio src={raw(f.id)} controls />
                : k === 'pdf' ? <iframe src={raw(f.id)} title={f.name} />
                  : texty ? (text === null ? <p className="muted">Loading…</p> : <pre>{text || '(empty)'}</pre>)
                    : <div className="st-empty"><span className="st-empty-ic"><Ico d={ICON[k]} size={30} /></span><h3>No preview for this kind of file</h3><p>Download it to open it on your computer.</p></div>}
        </div>
      </div>
    </div>
  );
}
