import { useEffect, useRef, useState } from 'react';
import { ICON } from '../lib/flows.js';
import { download } from '../lib/flowio.js';
import {
  CUSTOM_ICONS, CUSTOM_TONES, FIELD_KINDS, STARTER, blankNode, deleteCustom, exportNode, importNode, keyOf, listCustom, onCustomNodes, saveCustom,
} from '../lib/customnodes.js';

/* My nodes: make and edit custom nodes. A node is a name, a description, an icon and colour, the settings
   it asks for (shown in its panel like any node's) and its code, which gets the items and the settings
   filled in. Saving updates every workflow that uses it. */

const Svg = ({ d, size = 16 }) => <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={d} /></svg>;
const copy = v => JSON.parse(JSON.stringify(v));

export default function CustomNodes({ startId, onClose, toast, ask }) {
  const [list, setList] = useState(listCustom);
  const [draft, setDraft] = useState(() => copy(list.find(d => d.id === startId) || list[0] || blankNode()));
  const [touched, setTouched] = useState(false); // unsaved changes
  const [err, setErr] = useState('');
  const fileRef = useRef(null);
  useEffect(() => onCustomNodes(setList), []);
  const saved = list.some(d => d.id === draft.id);

  const edit = patch => { setDraft(d => ({ ...d, ...patch })); setTouched(true); setErr(''); };
  const setField = (i, patch) => edit({ fields: draft.fields.map((f, j) => (j === i ? { ...f, ...patch } : f)) });
  // Unsaved changes are only dropped once you say so; true when it's fine to go on.
  const okToLeave = async () => !touched || !!(await ask({ title: 'Leave without saving?', text: `Your changes to “${draft.name}” aren’t saved.`, ok: 'Leave', input: false }));
  const leave = async next => {
    if (!(await okToLeave())) return false;
    setDraft(copy(next)); setTouched(false); setErr('');
    return true;
  };
  const close = async () => { if (await okToLeave()) onClose(); };
  const save = () => {
    try { const d = saveCustom({ ...draft, fields: draft.fields.map(({ keyEdited, ...f }) => f) }); setDraft(copy(d)); setTouched(false); toast(`Saved “${d.name}”. Workflows that use it now run this version.`); } catch (e) { setErr(e.message); }
  };
  const remove = async () => {
    if (!(await ask({ title: `Delete “${draft.name}”?`, text: 'Workflows that use it keep the node, but it won’t run until you make it again or import a workflow file that carries it.', ok: 'Delete', input: false }))) return;
    deleteCustom(draft.id);
    const rest = listCustom();
    setDraft(copy(rest[0] || blankNode())); setTouched(false);
    toast('Deleted');
  };
  const setLanguage = language => {
    // Swap the starter code too, unless it was changed.
    const starter = Object.values(STARTER).some(s => s.trim() === String(draft.code).trim());
    edit({ language, ...(starter ? { code: STARTER[language] } : {}) });
  };
  const doImport = async f => {
    if (!f) return;
    try { const d = importNode(await f.text()); if (await leave(d)) { setTouched(true); toast(`“${d.name}” is ready: check it, then Create node.`); } } catch (e) { toast(e.message); }
  };

  return (
    <div className="modal" onPointerDown={e => { if (e.target === e.currentTarget) close(); }}>
      <div className="mbox cn" role="dialog" aria-modal="true" aria-label="My nodes" onKeyDown={e => { if (e.key === 'Escape' && e.target.tagName !== 'TEXTAREA') close(); }}>
        <button type="button" className="cn-close" aria-label="Close My nodes" title="Close" onClick={close}><Svg d="M6 6l12 12M18 6L6 18" size={16} /></button>
        <aside className="cn-list">
          <h3>My nodes</h3>
          <button className="btn primary" onClick={() => leave(blankNode())}>+ New node</button>
          <button className="btn" onClick={() => fileRef.current.click()}>Import a node…</button>
          <input ref={fileRef} type="file" accept=".json,application/json" hidden onChange={e => { doImport(e.target.files[0]); e.target.value = ''; }} />
          <nav aria-label="Your nodes">
            {list.map(d => (
              <button key={d.id} className={'cn-item t-' + d.tone + (d.id === draft.id ? ' on' : '')} aria-current={d.id === draft.id} onClick={() => d.id !== draft.id && leave(d)}>
                <i><Svg d={ICON[d.icon] || ICON.code} size={14} /></i><span>{d.name}</span>
              </button>
            ))}
            {!saved && <span className={'cn-item t-' + draft.tone + ' on'}><i><Svg d={ICON[draft.icon] || ICON.code} size={14} /></i><span>{draft.name || 'New node'} <small>(not saved)</small></span></span>}
          </nav>
        </aside>

        <form className="cn-edit" onSubmit={e => { e.preventDefault(); save(); }}>
          <div className="cn-row2">
            <label className="fv-f"><span>Name</span><input value={draft.name} maxLength={60} onChange={e => edit({ name: e.target.value })} /></label>
            <label className="fv-f"><span>Language</span>
              <select value={draft.language} onChange={e => setLanguage(e.target.value)}><option value="javascript">JavaScript</option><option value="python">Python</option></select>
            </label>
          </div>
          <label className="fv-f"><span>What it does (shown under its name)</span><input value={draft.note} maxLength={200} onChange={e => edit({ note: e.target.value })} /></label>
          <div className="fv-f"><span>Icon and colour</span>
            <div className="cn-icons" role="radiogroup" aria-label="Icon">
              {CUSTOM_ICONS.map(k => <button type="button" key={k} role="radio" aria-checked={draft.icon === k} aria-label={k} title={k} className={draft.icon === k ? 'on' : ''} onClick={() => edit({ icon: k })}><Svg d={ICON[k]} size={15} /></button>)}
            </div>
            <div className="cn-tones" role="radiogroup" aria-label="Colour">
              {CUSTOM_TONES.map(t => <button type="button" key={t} role="radio" aria-checked={draft.tone === t} aria-label={t} title={t} className={'t-' + t + (draft.tone === t ? ' on' : '')} onClick={() => edit({ tone: t })}><i /></button>)}
            </div>
          </div>

          <div className="fv-f"><span>Settings it asks for</span>
            {draft.fields.length > 0 && (
              <table className="cn-fields"><thead><tr><th>Label</th><th>Key (in code)</th><th>Kind</th><th>Default</th><th /></tr></thead><tbody>
                {draft.fields.map((f, i) => (
                  <tr key={i}>
                    <td><input aria-label={`Setting ${i + 1} label`} value={f.label} onChange={e => setField(i, { label: e.target.value, ...(f.keyEdited ? {} : { k: keyOf(e.target.value) }) })} /></td>
                    <td><input aria-label={`Setting ${i + 1} key`} value={f.k} onChange={e => setField(i, { k: e.target.value.replace(/\W/g, ''), keyEdited: true })} /></td>
                    <td><select aria-label={`Setting ${i + 1} kind`} value={f.kind} onChange={e => setField(i, { kind: e.target.value, d: e.target.value === 'bool' ? false : e.target.value === 'number' ? 0 : '' })}>{FIELD_KINDS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></td>
                    <td>{f.kind === 'bool'
                      ? <label className="cn-check"><input type="checkbox" aria-label={`Setting ${i + 1} default`} checked={!!f.d} onChange={e => setField(i, { d: e.target.checked })} /> On</label>
                      : f.kind === 'select'
                        ? <input aria-label={`Setting ${i + 1} choices`} placeholder="Choices, comma-separated" value={(f.options || []).map(o => (Array.isArray(o) ? o[0] : o)).join(', ')} onChange={e => { const options = e.target.value.split(',').map(x => x.trim()).filter(Boolean).map(x => [x, x]); setField(i, { options, d: options[0]?.[0] ?? '' }); }} />
                        : <input aria-label={`Setting ${i + 1} default`} type={f.kind === 'number' ? 'number' : 'text'} value={f.d ?? ''} onChange={e => setField(i, { d: f.kind === 'number' ? Number(e.target.value) : e.target.value })} />}</td>
                    <td><button type="button" className="cn-x" aria-label={`Remove setting ${i + 1}`} onClick={() => edit({ fields: draft.fields.filter((_, j) => j !== i) })}>×</button></td>
                  </tr>
                ))}
              </tbody></table>
            )}
            <button type="button" className="btn" onClick={() => edit({ fields: [...draft.fields, { k: `setting${draft.fields.length + 1}`, label: `Setting ${draft.fields.length + 1}`, kind: 'text', d: '' }] })}>+ Add a setting</button>
            <small className="muted">Each setting shows in the node’s panel; a text setting can hold expressions like <code>{'{{ $json.email }}'}</code>. The code reads it as <code>{draft.language === 'python' ? "settings['key']" : 'settings.key'}</code>.</small>
          </div>

          <label className="fv-f"><span>Code ({draft.language === 'python' ? 'Python' : 'JavaScript'})</span>
            <textarea className="cn-code" spellCheck={false} rows={14} value={draft.code} onChange={e => edit({ code: e.target.value })}
              onKeyDown={e => { if (e.key === 'Tab') { e.preventDefault(); const t = e.target, s = t.selectionStart; edit({ code: t.value.slice(0, s) + '  ' + t.value.slice(t.selectionEnd) }); requestAnimationFrame(() => { t.selectionStart = t.selectionEnd = s + 2; }); } }} />
          </label>
          <small className="muted">Gets <code>items</code> (the items reaching it), <code>settings</code> and <code>{draft.language === 'python' ? 'item_settings' : 'itemSettings'}</code> (the settings for each item); return the items to pass on. To try it, add it to a workflow and press <b>Run from here</b>.</small>

          {err && <p className="fv-rf-err" role="alert">{err}</p>}
          <footer className="cn-foot">
            {saved && <button type="button" className="btn danger" onClick={remove}>Delete</button>}
            {saved && <button type="button" className="btn" onClick={() => download(draft.name, exportNode(draft), 'node')}>Export</button>}
            <span className="grow" />
            <button type="button" className="btn" onClick={close}>Close</button>
            <button className="btn primary" disabled={saved && !touched}>{saved ? 'Save' : 'Create node'}</button>
          </footer>
        </form>
      </div>
    </div>
  );
}
