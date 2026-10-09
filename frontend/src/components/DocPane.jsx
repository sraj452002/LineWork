import { useMemo, useRef, useState } from 'react';
import { md } from '../lib/markdown.js';
import { NO_AI, copyFor, sampleP } from '../lib/ai.js';
import { TYPES } from '../lib/engines.js';
import { useUI } from './ui.jsx';

const TASKS = {
  draft: 'Write the full design doc for this file in markdown, 300 to 700 words, grounded in the diagrams above. Use sections: Context, Goals, Non-goals, Proposal, Alternatives considered, Risks and open questions. Keep any useful content from the current doc. Start with a "# " heading. Reply with only the markdown.',
  cont: 'Continue the doc from where it ends. Add the next section or two that it is missing. Reply with only the new markdown to append, without repeating existing text.',
  tight: 'Edit the doc for clarity and concision: cut filler, prefer active voice, keep all facts, structure and headings. Reply with only the full revised markdown.',
};

export default function DocPane({ file, update }) {
  const { popup, ask } = useUI();
  const [mode, setMode] = useState(() => (file.doc && file.doc.trim() ? 'read' : 'edit'));
  const [preview, setPreview] = useState(null);
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const ctl = useRef(null);

  const html = useMemo(() => md(preview ?? (file.doc || '')), [preview, file.doc]);

  const run = async (kind, custom) => {
    const sample = await sampleP;
    if (!sample) { setStatus(NO_AI); return; }
    const before = file.doc || '';
    const diagrams = file.diagrams.filter(d => d.code && d.code.trim())
      .map(d => `Diagram "${d.name}" (${TYPES[d.type]?.name || 'Architecture'}):\n${d.code}`).join('\n\n') || '(no diagrams yet)';
    const task = kind === 'custom' ? `Apply this request to the doc: "${custom}". Reply with only the full revised markdown.` : TASKS[kind];
    const prompt = `You are the writing assistant in Linework, a tool for technical design docs. File title: "${file.title}".\n\nDiagrams in this file:\n${diagrams}\n\nCurrent doc (markdown):\n<<<\n${before || '(empty)'}\n>>>\n\n${task}`;
    const join = t => (kind === 'cont' ? before.replace(/\s*$/, '\n\n') + t : t);

    ctl.current = new AbortController();
    setBusy(true); setStatus('Writing'); setMode('read'); setPreview(join(''));
    try {
      const { text } = await sample(prompt, { signal: ctl.current.signal, cache: false, onText: ({ text }) => setPreview(join(text)) });
      const clean = text.replace(/^```(?:markdown|md)?\s*\n/, '').replace(/\n```\s*$/, '').trim();
      update(c => { c.doc = kind === 'cont' ? before.replace(/\s*$/, '\n\n') + clean + '\n' : clean + '\n'; });
      setStatus('');
    } catch (e) {
      setStatus(e && e.code === 'cancelled' ? 'Stopped. Your doc wasn’t changed.' : copyFor(e && e.code));
    } finally {
      ctl.current = null; setBusy(false); setPreview(null);
    }
  };

  const openAI = e => {
    if (ctl.current) { ctl.current.abort(); return; }
    popup(e.currentTarget, [
      { label: 'Draft from diagrams', note: 'Writes a full design doc', act: () => run('draft') },
      { label: 'Continue writing', note: 'Adds the next missing sections', act: () => run('cont') },
      { label: 'Tighten wording', note: 'Shorter and clearer, same content', act: () => run('tight') },
      { label: 'Something else', note: 'Tell AI what to change', act: async () => {
        const v = await ask({ title: 'What should AI change?', multiline: true, ok: 'Apply' });
        if (v && v.trim()) run('custom', v.trim());
      } },
    ]);
  };

  return (
    <div className="docpane">
      <div className="dtools">
        <div className="seg" role="group" aria-label="Doc mode">
          <button aria-pressed={mode === 'edit'} onClick={() => setMode('edit')} disabled={busy}>Write</button>
          <button aria-pressed={mode === 'read'} onClick={() => setMode('read')}>Read</button>
        </div>
        <span className="grow" />
        <button className={'btn ' + (busy ? 'dark' : 'primary')} aria-haspopup="menu" onClick={openAI}>{busy ? 'Stop' : 'Ask AI'}</button>
      </div>
      {status && <div className={'dstat' + (busy ? ' busy' : '')}>{status}</div>}
      <div className="dscroll">
        {mode === 'edit' ? (
          <textarea id="docText" value={file.doc || ''} spellCheck aria-label="Design doc"
            placeholder="Write your design doc here. Markdown works: # headings, - lists, **bold**, `code`, tables."
            onChange={e => { const v = e.target.value; update(c => { c.doc = v; }); }}
            onKeyDown={e => {
              if (e.key === 'Tab') {
                e.preventDefault();
                const t = e.target, s = t.selectionStart, v = t.value.slice(0, s) + '  ' + t.value.slice(t.selectionEnd);
                update(c => { c.doc = v; });
                requestAnimationFrame(() => { t.selectionStart = t.selectionEnd = s + 2; });
              }
            }} />
        ) : (
          <div className="prose" dangerouslySetInnerHTML={{ __html: html }} />
        )}
      </div>
    </div>
  );
}
