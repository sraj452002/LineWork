import { useMemo, useState } from 'react';

/* The Editor node's card, in the app (Run and the workflow editor): when a run reaches an Editor, it stops
   there and gives what to edit. A sheet shows as a grid of cells (with + Row / + Column); text, a doc, a
   diagram's code or a code file in a box. “Save & continue” hands the edit back ({_edited}) and the run
   goes on from the Editor, which gives the whole file, edited, to the next steps. */
const COL = n => { let s = ''; for (n += 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s; return s; };
const addr = a => { const m = /^([A-Z]+)(\d+)$/.exec(a); if (!m) return null; let c = 0; for (const ch of m[1]) c = c * 26 + ch.charCodeAt(0) - 64; return { c: c - 1, r: Number(m[2]) - 1 }; };
const KIND = { sheet: 'Sheet', doc: 'Doc', code: 'Code', diagram: 'Diagram' };

export default function EditorCard({ card, onSave, onClose }) {
  const sheet = card.kind === 'sheet';
  const size = useMemo(() => {
    let rows = 0, cols = 0;
    for (const [a, v] of Object.entries(card.cells || {})) { const p = addr(a); if (p && v !== '') { rows = Math.max(rows, p.r + 1); cols = Math.max(cols, p.c + 1); } }
    return { rows: Math.max(rows + 2, 5), cols: Math.min(26, Math.max(cols + 1, 3)) };
  }, [card]);
  const [rows, setRows] = useState(size.rows), [cols, setCols] = useState(size.cols);
  const [cells, setCells] = useState(() => ({ ...(card.cells || {}) }));
  const [text, setText] = useState(card.text || '');
  const save = e => { e.preventDefault(); onSave(sheet ? { cells } : { text }); };
  return (
    <div className="modal" onPointerDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <form className="mbox ed-card" role="dialog" aria-modal="true" aria-label={`Edit ${card.name}`} onSubmit={save} onKeyDown={e => { if (e.key === 'Escape') onClose(); }}>
        <header className="ed-card-head">
          <div><h3>{card.heading || card.title || card.name}</h3><small>{card.name} · <b className="ed-card-kind">{KIND[card.kind] || 'File'}</b></small></div>
          <button type="button" className="rs-ib" aria-label="Close" onClick={onClose}>×</button>
        </header>
        {sheet ? (
          <>
            <div className="ed-card-grid">
              <table>
                <thead><tr><th />{Array.from({ length: cols }, (_, c) => <th key={c}>{COL(c)}</th>)}</tr></thead>
                <tbody>{Array.from({ length: rows }, (_, r) => (
                  <tr key={r}><th>{r + 1}</th>{Array.from({ length: cols }, (_, c) => {
                    const a = `${COL(c)}${r + 1}`;
                    return <td key={a}><input aria-label={a} value={cells[a] ?? ''} onChange={e => setCells(x => ({ ...x, [a]: e.target.value }))} /></td>;
                  })}</tr>
                ))}</tbody>
              </table>
            </div>
            <div className="ed-card-more">
              <button type="button" className="btn" onClick={() => setRows(r => Math.min(2000, r + 1))}>+ Row</button>
              <button type="button" className="btn" disabled={cols >= 26} onClick={() => setCols(c => Math.min(26, c + 1))}>+ Column</button>
            </div>
          </>
        ) : (
          <textarea className={'ed-card-text' + (card.kind === 'doc' ? '' : ' mono')} aria-label={card.name} spellCheck={card.kind === 'doc'} value={text} onChange={e => setText(e.target.value)} autoFocus />
        )}
        <footer className="ed-card-foot">
          <span className="muted">{card.fileId ? `Saves back to “${card.title}”, then the workflow goes on.` : 'The workflow goes on with the edited file.'}</span>
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button className="btn primary">{card.button || 'Save & continue'}</button>
        </footer>
      </form>
    </div>
  );
}

// The card a finished run is waiting on: an Editor node that stopped it (its “editor” output).
export function editorWaiting(flow, run) {
  if (!run || run.status !== 'success' || !flow) return null;
  for (const n of flow.nodes || []) {
    const got = n.type === 'ui.editor' && run.nodes?.[n.id]?.output?.editor;
    if (got && got[0]) return { nodeId: n.id, card: got[0], runId: run.id };
  }
  return null;
}
// What “Save & continue” starts the run with, from the Editor.
export const continueWith = (card, edit) => [{ _edited: { ...card, ...edit } }];
