import { useState } from 'react';
import { ICON, inputPaths, itemRows, nodeDef, rowsItem, runFields, runValues } from '../lib/flows.js';

// Used by the workflow editor (FlowView.jsx) and Home's Run section (RunHub.jsx).
const FILE_MAX = 10 * 2 ** 20; // a (file) field's file, read here and sent with the run
const Ico = ({ d, size = 18 }) => <svg className="fv-ico" width={size} height={size} viewBox="0 0 24 24" aria-hidden="true"><path d={d} /></svg>;

/* The form before a run. A Run by hand trigger asks for its own fields. Any other start (Run from here
   on a node, or Run with input…) gets a box for each item field the node reads ({{ $json.x }}; for a
   trigger, what the next steps read), and more can be added. Or the first item as JSON. What was
   entered last time is filled in again (kept in this browser). */
export default function RunForm({ fileId, flow, node, onRun, onClose }) {
  const fields = node && node.type === 'trigger.manual' ? runFields(node.params?.fields) : [];
  const store = `linework:run-input:${fileId}:${node ? node.id : ''}`;
  const saved = (() => { try { return JSON.parse(localStorage.getItem(store) || 'null') || {}; } catch (e) { return {}; } })();
  // Free fields (when the start doesn't declare its own): what the node reads, then what was added last time.
  const reads = fields.length ? [] : inputPaths(flow, node?.id);
  const [rows, setRows] = useState(() => {
    if (fields.length) return [];
    const last = Array.isArray(saved.rows) ? saved.rows.filter(r => r && r.name) : [];
    return [...reads.map(name => ({ name, value: last.find(r => r.name === name)?.value ?? '', read: true })), ...last.filter(r => !reads.includes(r.name)).map(r => ({ name: r.name, value: r.value ?? '' }))];
  });
  const [mode, setMode] = useState(fields.length || reads.length || saved.mode !== 'json' ? 'form' : 'json');
  // A file isn't kept for next time (too big for this browser's storage): it's picked again.
  const [vals, setVals] = useState(() => Object.fromEntries(fields.map(f => [f.key, f.kind === 'file' ? null : saved.vals?.[f.key] ?? (f.kind === 'yesno' ? false : f.kind === 'choice' ? f.options[0] || '' : '')])));
  const [json, setJson] = useState(saved.json || '{\n  \n}');
  const [err, setErr] = useState('');
  const set = (k, v) => { setVals(x => ({ ...x, [k]: v })); setErr(''); };
  const setRow = (i, patch) => { setRows(list => list.map((r, j) => (j === i ? { ...r, ...patch } : r))); setErr(''); };
  const formItem = () => (fields.length ? runValues(fields, vals) : rowsItem(rows));
  // In JSON a file's contents would be megabytes of text: they're shown as a note, and only the Form tab sends files.
  const toJson = () => {
    const item = formItem();
    for (const f of fields) if (f.kind === 'file' && item[f.key]) item[f.key] = { ...item[f.key], data: `(${Math.round(item[f.key].size / 1024)} KB: files are sent from the Form tab)` };
    setMode('json'); setErr(''); setJson(JSON.stringify(item, null, 2));
  };
  const pickFile = async (f, file) => {
    if (!file) { set(f.key, null); return; }
    if (file.size > FILE_MAX) { set(f.key, null); setErr(`“${file.name}” is ${(file.size / 2 ** 20).toFixed(1)} MB: a file can be at most 10 MB.`); return; }
    const data = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).replace(/^data:[^,]*,/, '')); r.onerror = () => rej(r.error); r.readAsDataURL(file); });
    set(f.key, { name: file.name, type: file.type || 'application/octet-stream', size: file.size, data });
  };
  const toForm = () => {
    setErr('');
    if (!fields.length) {
      // What the JSON says, back as rows, keeping the boxes for what the node reads.
      let v; try { v = JSON.parse(json || '{}'); } catch (e) { v = null; }
      const item = Array.isArray(v) ? v[0] : v;
      if (item && typeof item === 'object') {
        const got = itemRows(item);
        setRows([...reads.map(name => ({ name, value: got.find(r => r.name === name)?.value ?? '', read: true })), ...got.filter(r => !reads.includes(r.name))]);
      }
    }
    setMode('form');
  };
  const submit = e => {
    e.preventDefault();
    let input;
    if (mode === 'form') {
      const missing = fields.filter(f => f.required && f.kind !== 'yesno' && (f.kind === 'file' ? !vals[f.key] : !String(vals[f.key] ?? '').trim()));
      if (missing.length) { setErr(`Fill in ${missing.map(f => f.name).join(', ')}.`); return; }
      if (rows.some(r => !r.read && !String(r.name).trim() && String(r.value).trim())) { setErr('Give each added field a name.'); return; }
      input = [formItem()];
    } else {
      try { const v = JSON.parse(json || '{}'); input = Array.isArray(v) ? v : [v]; } catch (x) { setErr('That isn’t valid JSON. Example: {"name": "Asha", "amount": 1200}'); return; }
      if (input.some(x => !x || typeof x !== 'object' || Array.isArray(x))) { setErr('Give an object, or a list of objects (one item each).'); return; }
    }
    const keep = Object.fromEntries(Object.entries(vals).filter(([k]) => fields.find(f => f.key === k)?.kind !== 'file'));
    try { localStorage.setItem(store, JSON.stringify({ vals: keep, json, mode, rows: rows.filter(r => String(r.name).trim()).map(({ name, value }) => ({ name, value })) })); } catch (x) { /* only a convenience */ }
    onRun(input);
  };
  const box = f => {
    const common = { id: `rf-${f.key}`, value: vals[f.key] ?? '', onChange: e => set(f.key, e.target.value), required: f.required };
    if (f.kind === 'long') return <textarea {...common} rows={3} />;
    if (f.kind === 'choice') return <select {...common}>{f.options.map(o => <option key={o} value={o}>{o}</option>)}</select>;
    if (f.kind === 'file') {
      const v = vals[f.key];
      return (
        <div className="fv-rf-file">
          <input id={`rf-${f.key}`} type="file" onChange={e => pickFile(f, e.target.files[0])} />
          {v && <small>{v.name} · {v.size < 1024 * 1024 ? `${Math.max(1, Math.round(v.size / 1024))} KB` : `${(v.size / 2 ** 20).toFixed(1)} MB`}</small>}
        </div>
      );
    }
    if (f.kind === 'yesno') return <label className="fv-rf-check"><input type="checkbox" id={`rf-${f.key}`} checked={!!vals[f.key]} onChange={e => set(f.key, e.target.checked)} /> Yes</label>;
    return <input {...common} type={f.kind === 'text' ? 'text' : f.kind} inputMode={f.kind === 'number' ? 'decimal' : undefined} step={f.kind === 'number' ? 'any' : undefined} />;
  };
  const freeForm = (
    <>
      {rows.map((r, i) => (r.read
        ? <div className="fv-rf-field" key={'r' + r.name}>
          <label htmlFor={`rf-row-${i}`}>{r.name}<code>{`{{ $json.${r.name} }}`}</code></label>
          <input id={`rf-row-${i}`} value={r.value} onChange={e => setRow(i, { value: e.target.value })} />
        </div>
        : <div className="fv-rf-row" key={'a' + i}>
          <input aria-label={`Field ${i + 1} name`} placeholder="name" value={r.name} onChange={e => setRow(i, { name: e.target.value })} />
          <input aria-label={`Field ${i + 1} value`} placeholder="value" value={r.value} onChange={e => setRow(i, { value: e.target.value })} />
          <button type="button" className="fv-rf-del" aria-label={`Remove field ${i + 1}`} title="Remove" onClick={() => setRows(list => list.filter((_, j) => j !== i))}>×</button>
        </div>))}
      {!rows.length && <p className="fv-rf-none">{node && !nodeDef(node.type).trigger ? 'This node doesn’t read any fields of the item.' : 'The next steps don’t read any fields of the item.'} Add the fields the item should have.</p>}
      <button type="button" className="btn fv-rf-add" onClick={() => setRows(list => [...list, { name: '', value: '' }])}>+ Add a field</button>
      <p className="fv-rf-tip">Numbers, true/false and JSON (<code>{'{…}'}</code>, <code>[…]</code>) are read as such; a name with dots (<code>customer.email</code>) makes a nested field.</p>
    </>
  );
  return (
    <div className="modal" onPointerDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <form className="mbox fv-runform" role="dialog" aria-modal="true" aria-label="Run with input" noValidate onSubmit={submit} onKeyDown={e => { if (e.key === 'Escape') onClose(); }}>
        <h3>Run {node ? `from “${node.name}”` : 'the workflow'}</h3>
        <p>{mode === 'form' ? `What you fill in is the item ${node && !nodeDef(node.type).trigger ? 'this node gets' : 'the workflow gets'}.` : 'The first item, as JSON: an object, or a list of objects for one item each.'}</p>
        <div className="seg fv-rf-tabs" role="tablist">
          <button type="button" role="tab" aria-selected={mode === 'form'} onClick={toForm}>Form</button>
          <button type="button" role="tab" aria-selected={mode === 'json'} onClick={toJson}>JSON</button>
        </div>
        {mode === 'form'
          ? (fields.length ? fields.map((f, i) => (
            <div className="fv-rf-field" key={f.key + i}>
              <label htmlFor={`rf-${f.key}`}>{f.name}{f.required && <b aria-hidden="true"> *</b>}<code>{`{{ $json.${f.key} }}`}</code></label>
              {box(f)}
            </div>)) : freeForm)
          : <textarea className="fv-rf-json" aria-label="Input as JSON" spellCheck={false} rows={8} value={json} onChange={e => setJson(e.target.value)} />}
        {err && <p className="fv-rf-err" role="alert">{err}</p>}
        <footer className="fv-rf-foot">
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button className="btn primary" autoFocus={mode === 'json'}><Ico d={ICON.play} size={13} />Run</button>
        </footer>
      </form>
    </div>
  );
}
