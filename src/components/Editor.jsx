import { useCallback, useEffect, useRef, useState } from 'react';
import { TYPES, dg, prep, svgDoc } from '../lib/engines.js';
import { downloads } from '../lib/ai.js';
import { imageKeys, loadImages } from '../lib/images.js';
import { clone, rid, slug, trunc } from '../lib/utils.js';
import DocPane from './DocPane.jsx';
import Canvas from './Canvas.jsx';
import { useUI } from './ui.jsx';

const narrow = () => innerWidth <= 760;

export default function Editor({ file, update, saveState, onBack, onRename, onDuplicate, onDelete }) {
  const { popup, ask, toast } = useUI();
  const history = useRef(new Map()).current;
  const [isNarrow, setNarrow] = useState(narrow);
  useEffect(() => {
    const r = () => setNarrow(narrow());
    addEventListener('resize', r);
    return () => removeEventListener('resize', r);
  }, []);

  const active = Math.max(0, Math.min(file.active || 0, file.diagrams.length - 1));
  const d = file.diagrams[active];
  let view = file.view || 'both';
  if (isNarrow && view === 'both') view = 'canvas';

  const setView = v => update(c => { c.view = v; });
  const activate = i => update(c => { c.active = i; });

  const updateDiagramById = useCallback((id, fn) => update(c => {
    const x = c.diagrams.find(y => y.id === id);
    if (x) fn(x);
  }), [update]);
  const updateDiagram = useCallback(fn => updateDiagramById(d.id, fn), [d.id, updateDiagramById]);

  const addDiagram = (type, name, code = '') => update(c => {
    const n = c.diagrams.filter(x => x.type === type).length;
    c.diagrams.push(dg(type, name || TYPES[type].name + (n ? ' ' + (n + 1) : ''), code));
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
    downloads.save({ filename: slug(file.title) + '.md', data: out });
  };
  const copy = async (text, ok) => {
    try { await navigator.clipboard.writeText(text); toast(ok); }
    catch (e) { toast('Copy isn’t allowed here.'); }
  };
  const exportMenu = btn => popup(btn, [
    { label: 'Diagram as PNG', note: 'High resolution, for slides and docs', act: () => exportDiagram('png') },
    { label: 'Diagram as SVG', note: 'Vector, edit in design tools', act: () => exportDiagram('svg') },
    { label: 'Doc as Markdown', note: 'Includes the diagram code', act: exportMarkdown },
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
        </div>
        <button className="btn" aria-haspopup="menu" onClick={e => exportMenu(e.currentTarget)}>Export</button>
        <button className="btn" aria-haspopup="menu" aria-label="More actions" onClick={e => popup(e.currentTarget, [
          { label: 'Rename file', act: onRename },
          { label: 'Duplicate file', act: onDuplicate },
          '-',
          { label: 'Delete file', danger: true, act: onDelete },
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
          <Canvas key={d.id} file={file} d={d} visible={view !== 'doc'} updateDiagram={updateDiagram} history={history} onAddDiagram={addDiagram} />
        </div>
      </div>
    </section>
  );
}
