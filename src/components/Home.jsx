import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { TEMPLATES, TYPES, dg, newFile, thumb } from '../lib/engines.js';
import { LANG, NO_AI, copyFor, sampleP } from '../lib/ai.js';
import { ago, rid } from '../lib/utils.js';
import { useImages } from '../lib/images.js';
import { Brand, useUI } from './ui.jsx';

const DocThumb = () => (
  <div className="doc-thumb"><i style={{ width: '70%' }} /><i /><i style={{ width: '85%' }} /><i style={{ width: '40%' }} /><i /><i style={{ width: '60%' }} /></div>
);

const Thumb = memo(function Thumb({ d, theme }) {
  const imgs = useImages(d && d.shapes);
  const html = useMemo(() => thumb(d && ((d.code && d.code.trim()) || (d.shapes && d.shapes.length)) ? d : null), [d && d.code, d && d.type, d && d.dir, d && d.style, d && d.manual, d && d.shapes, imgs, theme]);
  return <div className="thumb" dangerouslySetInnerHTML={{ __html: html }} />;
});

const DEFAULT_NOTE = 'You can paste Terraform, SQL, or code too.';

export default function Home({ files, onOpen, onCreate, onRename, onDuplicate, onDelete, onSignOut }) {
  const { popup, theme } = useUI();
  const [q, setQ] = useState('');
  const [prompt, setPrompt] = useState('');
  const [note, setNote] = useState(DEFAULT_NOTE);
  const [busy, setBusy] = useState(false);
  const ctl = useRef(null);

  useEffect(() => { sampleP.then(s => { if (!s) setNote(NO_AI); }); }, []);

  const createFrom = t => onCreate(newFile(t));

  const generate = async () => {
    if (ctl.current) { ctl.current.abort(); return; }
    const text = prompt.trim();
    if (!text) return;
    const sample = await sampleP;
    if (!sample) { setNote(NO_AI); return; }
    ctl.current = new AbortController();
    setBusy(true);
    setNote('Writing the doc and drawing diagrams');
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
      });
      setPrompt('');
      setNote(DEFAULT_NOTE);
    } catch (e) {
      setNote(copyFor(e && e.code));
    } finally {
      ctl.current = null;
      setBusy(false);
    }
  };

  const ql = q.trim().toLowerCase();
  const list = files
    .filter(f => !ql || (f.title || '').toLowerCase().includes(ql) || (f.doc || '').toLowerCase().includes(ql))
    .sort((a, b) => b.updated - a.updated);

  const fileMenu = (btn, f) => popup(btn, [
    { label: 'Open', act: () => onOpen(f.id) },
    { label: 'Rename', act: () => onRename(f) },
    { label: 'Duplicate', act: () => onDuplicate(f) },
    '-',
    { label: 'Delete', danger: true, act: () => onDelete(f) },
  ]);

  return (
    <section className="screen">
      <div className="bar">
        <Brand />
        <input className="search" type="search" placeholder="Search files" aria-label="Search files" value={q} onChange={e => setQ(e.target.value)} />
        <button className="btn primary" aria-haspopup="menu"
          onClick={e => popup(e.currentTarget, TEMPLATES.map(t => ({ label: t.name, note: t.note, act: () => createFrom(t) })))}>New file</button>
        <button className="btn" onClick={onSignOut}>Sign out</button>
      </div>
      <div className="home-body">
        <div className="home-in">
          <div className="hero">
            <h1>What are you designing?</h1>
            <p>Describe a system, a process, or a schema. AI writes a short design doc and draws the diagrams to go with it, all of which you can edit.</p>
            <div className="ask">
              <textarea value={prompt} onChange={e => setPrompt(e.target.value)} aria-label="Describe what you're designing"
                placeholder="A ride-sharing backend: riders request trips, drivers get matched by location, payments settle after the ride"
                onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); generate(); } }} />
              <div className="arow">
                <span className={'note' + (busy ? ' busy' : '')}>{note}</span>
                <button className={'go' + (busy ? ' stop' : '')} onClick={generate}>{busy ? 'Stop' : 'Create file'}</button>
              </div>
            </div>
          </div>

          <div className="sec"><h2>Start from a template</h2></div>
          <div className="tgrid">
            {TEMPLATES.map(t => <TemplateCard key={t.key} t={t} theme={theme} onClick={() => createFrom(t)} />)}
          </div>

          <div className="sec"><h2>Your files</h2><span>Saved in this browser</span></div>
          {!files.length ? (
            <div className="nofiles">No files yet. Describe what you&rsquo;re designing above, or pick a template to start.</div>
          ) : !list.length ? (
            <div className="nofiles">No files match &ldquo;{q.trim()}&rdquo;.</div>
          ) : (
            <div className="fgrid">
              {list.map(f => {
                const d = f.diagrams.find(x => (x.code && x.code.trim()) || (x.shapes && x.shapes.length));
                const kinds = [...new Set(f.diagrams.filter(x => x.code && x.code.trim()).map(x => (TYPES[x.type] || TYPES.architecture).name))].join(', ');
                return (
                  <div key={f.id} className="card" role="button" tabIndex={0} onClick={() => onOpen(f.id)}
                    onKeyDown={e => { if ((e.key === 'Enter' || e.key === ' ') && e.target === e.currentTarget) { e.preventDefault(); onOpen(f.id); } }}>
                    {d ? <Thumb d={d} theme={theme} /> : <div className="thumb"><DocThumb /></div>}
                    <div className="cbody">
                      <strong>{f.title || 'Untitled'}</strong>
                      <small>{ago(f.updated)}{kinds ? ', ' + kinds : ''}</small>
                    </div>
                    <button className="more" aria-label={'Actions for ' + (f.title || 'Untitled')}
                      onClick={e => { e.stopPropagation(); fileMenu(e.currentTarget, f); }}>⋯</button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

function TemplateCard({ t, theme, onClick }) {
  const d = useMemo(() => t.make().diagrams[0], [t]);
  return (
    <button className="card" onClick={onClick}>
      {t.key === 'doc' ? <div className="thumb"><DocThumb /></div> : <Thumb d={d} theme={theme} />}
      <div className="cbody"><strong>{t.name}</strong><small>{t.note}</small></div>
    </button>
  );
}
