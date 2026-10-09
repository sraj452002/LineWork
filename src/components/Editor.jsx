import { Suspense, lazy, useCallback, useEffect, useRef, useState } from 'react';
import { TYPES, dg, prep, svgDoc } from '../lib/engines.js';
import { downloads } from '../lib/ai.js';
import { imageKeys, loadImages } from '../lib/images.js';
import { isPackIcon, loadIconPacks } from '../lib/iconpacks.js';
import { clone, rid, slug, trunc } from '../lib/utils.js';
import { setSheets } from '../lib/sheet.js';
import DocPane from './DocPane.jsx';
import Canvas from './Canvas.jsx';
import { ThemeButton, useUI } from './ui.jsx';

// The code editor (Monaco) is large, so it loads the first time the Code view opens.
const CodeWorkspace = lazy(() => import('./CodeWorkspace.jsx'));
const SheetView = lazy(() => import('./SheetView.jsx'));

const narrow = () => innerWidth <= 760;
const AI_KEY = 'linework:ai-open';
const aiPref = () => { try { const v = localStorage.getItem(AI_KEY); return v == null ? innerWidth > 1000 : v === '1'; } catch (e) { return false; } };

// onShare and onHistory appear with the Linework server (server/); a shared file has no onDelete.
export default function Editor({ file, update, saveState, onBack, onRename, onDuplicate, onDelete, onGuide, onShare, onHistory, duplicateLabel = 'Duplicate file' }) {
  const { popup, ask, toast } = useUI();
  const history = useRef(new Map()).current;
  const [isNarrow, setNarrow] = useState(narrow);
  const [aiOpen, setAiOpenState] = useState(aiPref);
  const setAiOpen = useCallback(v => { setAiOpenState(v); try { localStorage.setItem(AI_KEY, v ? '1' : '0'); } catch (e) {} }, []);
  useEffect(() => {
    const r = () => setNarrow(narrow());
    addEventListener('resize', r);
    return () => removeEventListener('resize', r);
  }, []);

  const active = Math.max(0, Math.min(file.active || 0, file.diagrams.length - 1));
  const d = file.diagrams[active];
  let view = file.view || 'both';
  if (isNarrow && view === 'both') view = 'canvas';
  const onCanvas = view === 'canvas' || view === 'both';
  const [codeSeen, setCodeSeen] = useState(view === 'code'); // keep the editor mounted once opened
  useEffect(() => { if (view === 'code') setCodeSeen(true); }, [view]);
  // Spreadsheets: the Sheet view, and canvas blocks that show a sheet (drawn from this registry).
  setSheets(file.sheets);
  const [placeSheet, setPlaceSheet] = useState(null);
  const openSheet = id => update(c => { if (id) c.activeSheet = id; c.view = 'sheet'; });
  const sheetToCanvas = id => { setPlaceSheet(id); update(c => { c.view = 'canvas'; }); };

  const setView = v => update(c => { c.view = v; });
  const activate = i => update(c => { c.active = i; });

  const updateDiagramById = useCallback((id, fn) => update(c => {
    const x = c.diagrams.find(y => y.id === id);
    if (x) fn(x);
  }), [update]);
  const updateDiagram = useCallback(fn => updateDiagramById(d.id, fn), [d.id, updateDiagramById]);

  const addDiagram = (type, name, code = '', extra) => update(c => {
    const n = c.diagrams.filter(x => x.type === type).length;
    c.diagrams.push(Object.assign(dg(type, name || TYPES[type].name + (n ? ' ' + (n + 1) : ''), code), extra || {}));
    c.active = c.diagrams.length - 1;
  });

  const diagramMenu = (btn, i) => {
    const x = file.diagrams[i];
    popup(btn, [
      { label: 'Rename', act: async () => {
        const v = await ask({ title: 'Rename diagram', value: x.name, ok: 'Rename' });
        if (v && v.trim()) update(c => { c.diagrams[i].name = v.trim().slice(0, 40); });
      } },
      { label: 'Duplicate', act: () => update(c => {
        const copy = clone(c.diagrams[i]); copy.id = rid('d'); copy.name = x.name + ' copy';
        c.diagrams.splice(i + 1, 0, copy); c.active = i + 1;
      }) },
      '-',
      { label: 'Delete diagram', danger: true, act: async () => {
        const ok = await ask({ title: 'Delete this diagram?', text: `“${x.name}” will be removed from this file.`, input: false, ok: 'Delete' });
        if (!ok) return;
        update(c => {
          c.diagrams.splice(i, 1);
          if (!c.diagrams.length) c.diagrams.push(dg('architecture', 'Diagram 1', ''));
          c.active = Math.max(0, i - 1);
        });
      } },
    ]);
  };

  /* ---- export ---- */
  const exportDiagram = async kind => {
    await loadImages(imageKeys(d.shapes));
    if ((d.shapes || []).some(s => s.t === 'icon' && isPackIcon(s.v)) || (d.type === 'erd' && /\bicon\s*:/.test(d.code))) await loadIconPacks().catch(() => {});
    const doc = svgDoc(prep(d));
    if (!doc) { toast('This diagram is empty'); return; }
    const name = slug(file.title) + '-' + slug(d.name);
    if (kind === 'svg') return downloads.save({ filename: name + '.svg', data: doc.text });
    const img = new Image();
    img.onload = () => {
      const s = 2, cv = document.createElement('canvas');
      cv.width = doc.w * s; cv.height = doc.h * s;
      const g = cv.getContext('2d'); g.scale(s, s); g.drawImage(img, 0, 0);
      cv.toBlob(bl => bl ? downloads.save({ filename: name + '.png', data: bl }) : toast('The image couldn’t be created'), 'image/png');
    };
    img.onerror = () => toast('The image couldn’t be created');
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(doc.text);
  };
  const exportMarkdown = () => {
    let out = (file.doc || '').trim() + '\n';
    file.diagrams.filter(x => x.code && x.code.trim()).forEach(x => { out += `\n## Diagram: ${x.name}\n\n\`\`\`linework-${x.type}\n${x.code}\n\`\`\`\n`; });
    (file.code?.files || []).forEach(f => {
      const fence = '`'.repeat(Math.max(3, ...((f.text || '').match(/`+/g) || []).map(m => m.length + 1)));
      out += `\n## Code: ${f.path}\n\n${fence}${(f.path.match(/\.([^./]+)$/) || [])[1] || ''}\n${(f.text || '').replace(/\n$/, '')}\n${fence}\n`;
    });
    downloads.save({ filename: slug(file.title) + '.md', data: out });
  };
  const copy = async (text, ok) => {
    try { await navigator.clipboard.writeText(text); toast(ok); }
    catch (e) { toast('Copy isn’t allowed here.'); }
  };
  const exportMenu = btn => popup(btn, [
    { label: 'Diagram as PNG', note: 'High resolution, for slides and docs', act: () => exportDiagram('png') },
    { label: 'Diagram as SVG', note: 'Vector, edit in design tools', act: () => exportDiagram('svg') },
    { label: 'Doc as Markdown', note: 'Includes the diagram code and code files', act: exportMarkdown },
    '-',
    { label: 'Copy diagram code', act: () => copy(d.code, 'Code copied') },
    { label: 'Copy doc text', act: () => copy(file.doc || '', 'Doc copied') },
  ]);

  return (
    <section className="screen">
      <div className="bar">
        <button className="btn" onClick={onBack} aria-label="Back to files">Files</button>
        <input className="ftitle" aria-label="File name" maxLength={120} value={file.title}
          onChange={e => { const v = e.target.value; update(c => { c.title = v; }); }}
          onBlur={() => { if (!file.title.trim()) update(c => { c.title = 'Untitled'; }); }}
          onKeyDown={e => { if (e.key === 'Enter') e.target.blur(); }} />
        <span className="saved">{saveState}</span>
        <div className="seg" role="group" aria-label="View">
          <button aria-pressed={view === 'doc'} onClick={() => setView('doc')}>Doc</button>
          {!isNarrow && <button aria-pressed={view === 'both'} onClick={() => setView('both')}>Both</button>}
          <button aria-pressed={view === 'canvas'} onClick={() => setView('canvas')}>Canvas</button>
          <button aria-pressed={view === 'code'} onClick={() => setView('code')}>Code</button>
          <button aria-pressed={view === 'sheet'} onClick={() => setView('sheet')}>Sheet</button>
        </div>
        {onCanvas && (
          <button className={'btn ai-toggle' + (aiOpen ? ' on' : '')} aria-pressed={aiOpen} onClick={() => setAiOpen(!aiOpen)}
            title={aiOpen ? 'Close AI chat  Esc' : 'Open AI chat  Ctrl J'}>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10 3.5l1.6 4.9 4.9 1.6-4.9 1.6L10 16.5l-1.6-4.9L3.5 10l4.9-1.6z"/><path d="M18 3v4M16 5h4M17.5 15.5v4M15.5 17.5h4"/></svg>
            {aiOpen ? 'Close' : 'AI Chat'}
          </button>
        )}
        <ThemeButton />
        <button className="btn" aria-haspopup="menu" onClick={e => exportMenu(e.currentTarget)}>Export</button>
        <button className="btn" aria-haspopup="menu" aria-label="More actions" onClick={e => popup(e.currentTarget, [
          ...(onRename ? [{ label: 'Rename file', act: onRename }] : []),
          { label: duplicateLabel, act: onDuplicate },
          ...(onShare ? [{ label: 'Share…', note: 'A link to view or edit this file', act: onShare }] : []),
          ...(onHistory ? [{ label: 'Version history…', note: 'See and restore earlier versions', act: onHistory }] : []),
          '-',
          ...(onDelete ? [{ label: 'Delete file', danger: true, act: onDelete }, '-'] : []),
          { label: 'How to use Linework', note: 'Guide to the whole app', act: () => onGuide('app') },
          { label: 'Database schema guide', note: 'Tables, columns, relationships', act: () => onGuide('erd') },
        ])}>⋯</button>
      </div>

      <div className="panes" data-view={view}>
        <DocPane file={file} update={update} />
        <div className="canvaspane">
          <div className="ctabs" role="tablist" aria-label="Diagrams">
            {file.diagrams.map((x, i) => (
              <button key={x.id} className="tab" role="tab" aria-selected={i === active} onClick={() => activate(i)}>
                {trunc(x.name, 24)}
                {x.name !== TYPES[x.type]?.name && <span className="tk">{TYPES[x.type]?.name}</span>}
                {i === active && (
                  <span className="tm" role="button" tabIndex={0} aria-label="Diagram actions"
                    onClick={e => { e.stopPropagation(); diagramMenu(e.currentTarget, i); }}
                    onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); diagramMenu(e.currentTarget, i); } }}>⋯</span>
                )}
              </button>
            ))}
            <button className="addtab" aria-haspopup="menu"
              onClick={e => popup(e.currentTarget, Object.entries(TYPES).map(([k, v]) => ({ label: v.name, act: () => addDiagram(k) })))}>+ Diagram</button>
          </div>
          <Canvas key={d.id} file={file} d={d} visible={onCanvas} updateDiagram={updateDiagram} updateFile={update} history={history} onAddDiagram={addDiagram} onGuide={onGuide}
            aiOpen={aiOpen} onAIOpen={setAiOpen} onOpenSheet={openSheet} placeSheet={placeSheet} onPlaced={() => setPlaceSheet(null)} />
        </div>
        {view === 'sheet' && (
          <div className="sheetpane">
            <Suspense fallback={<div className="cw-loading">Loading…</div>}>
              <SheetView file={file} update={update} visible onAddToCanvas={sheetToCanvas} />
            </Suspense>
          </div>
        )}
        {codeSeen && (
          <div className="codepane">
            <Suspense fallback={<div className="cw-loading">Loading the code editor…</div>}>
              <CodeWorkspace file={file} update={update} visible={view === 'code'} />
            </Suspense>
          </div>
        )}
      </div>
    </section>
  );
}
