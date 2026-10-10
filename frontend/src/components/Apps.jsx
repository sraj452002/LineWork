import { useEffect, useMemo, useState } from 'react';
import { serverInfo } from '../lib/backend.js';
import { getRun, listRuns } from '../lib/flows.js';
import { isImage, isLink, mainText, publishedApps, resultOf, runApp, shapeOf, toCSV } from '../lib/apps.js';
import { download } from '../lib/flowio.js';
import { confetti } from '../lib/confetti.js';
import { useUI } from './ui.jsx';

/* Home → Apps: workflows published as apps, for people who just want to use them. Each opens as a form
   with a Run button; the result shows as words, a table or cards, and earlier runs are listed. Nothing
   about nodes or credentials shows here. */

const ago = t => { const s = Math.round((Date.now() - t) / 1000); return s < 60 ? 'just now' : s < 3600 ? `${Math.round(s / 60)} min ago` : s < 86400 ? `${Math.round(s / 3600)} h ago` : new Date(t).toLocaleDateString(); };
const label = k => String(k).replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ').replace(/^\w/, c => c.toUpperCase());

export default function Apps({ files, q = '', onEdit }) {
  const [openId, setOpenId] = useState(null);
  const [server, setServer] = useState(undefined);
  useEffect(() => { serverInfo().then(i => setServer(!!(i && (i.features || []).includes('flows')))); }, []);
  const apps = publishedApps(files);
  const open = apps.find(f => f.id === openId);
  if (open) return <AppRunner file={open} server={server} onBack={() => setOpenId(null)} onEdit={onEdit} />;
  const needle = q.trim().toLowerCase();
  const shown = apps.filter(f => !needle || `${f.flow.app.name} ${f.flow.app.description}`.toLowerCase().includes(needle));
  return (
    <div className="apps">
      <header className="tpl-head">
        <h2>Apps</h2>
        <p>Tools made from workflows: fill in the form and press Run. To make one, open a workflow and press <b>Publish</b>.</p>
      </header>
      {!apps.length ? (
        <div className="nofiles">
          <svg className="nofiles-art" viewBox="0 0 160 110" aria-hidden="true"><rect x="22" y="24" width="70" height="56" rx="10" /><rect x="68" y="38" width="70" height="56" rx="10" /><path d="M80 56h44M80 66h30M80 76h38" /><circle cx="40" cy="42" r="6" /><path d="M34 64h40" /></svg>
          <div>No apps yet. Build a workflow, then press <b>Publish</b> in its toolbar to turn it into an app anyone can run.</div>
        </div>
      ) : !shown.length ? <div className="nofiles">No apps match “{q.trim()}”.</div> : (
        <div className="app-grid">
          {shown.map(f => {
            const a = f.flow.app;
            return (
              <button key={f.id} className={'app-card t-' + (a.tone || 'blue')} onClick={() => setOpenId(f.id)} aria-label={`Open the app ${a.name}`}>
                <i className="app-icon" aria-hidden="true">{a.icon || '✨'}</i>
                <b>{a.name}</b>
                {a.description && <small>{a.description}</small>}
                <span className="app-go">Open →</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function AppRunner({ file, server, onBack, onEdit }) {
  const { toast } = useUI();
  const a = file.flow.app;
  const inputs = a.inputs || [];
  const [form, setForm] = useState(() => Object.fromEntries(inputs.map(f => [f.key, f.kind === 'yesno' ? false : f.kind === 'choice' ? (f.options || [])[0] || '' : ''])));
  const [run, setRun] = useState(null), [busy, setBusy] = useState(false), [history, setHistory] = useState([]);
  const refresh = () => { if (server) listRuns(file.id).then(r => setHistory(r.filter(x => x.trigger === 'app').slice(0, 10)), () => {}); };
  useEffect(refresh, [server, file.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const go = async e => {
    e.preventDefault();
    setBusy(true); setRun({ status: 'running', nodes: {} });
    try {
      const id = await runApp(file.id, form);
      let r = { id, status: 'running', nodes: {} };
      for (let i = 0; i < 400 && r.status === 'running'; i++) {
        await new Promise(res => setTimeout(res, i < 10 ? 300 : 900));
        r = await getRun(id);
      }
      setRun(r);
      if (r.status === 'success') { const b = document.querySelector('.app-run')?.getBoundingClientRect(); if (b) confetti({ x: b.left + b.width / 2, y: b.top }); }
      refresh();
    } catch (err) { setRun({ status: 'error', error: err.message || 'It couldn’t run.' }); }
    setBusy(false);
  };
  const items = useMemo(() => (run && run.status === 'success' ? resultOf(file.flow, run) : []), [run, file.flow]);

  return (
    <div className="app-run-page">
      <div className="app-top">
        <button className="btn" onClick={onBack}>← Apps</button>
        <span className="grow" />
        {onEdit && <button className="link" onClick={() => onEdit(file.id)}>Edit the workflow</button>}
      </div>
      <header className={'app-hero t-' + (a.tone || 'blue')}>
        <i className="app-icon" aria-hidden="true">{a.icon || '✨'}</i>
        <div><h2>{a.name}</h2>{a.description && <p>{a.description}</p>}</div>
      </header>
      {server === false && <p className="fv-note">Apps run on the Workline server. Sign in to your account to run this one.</p>}
      <div className="app-body">
        <form className="app-form" onSubmit={go}>
          {inputs.map(f => <Input key={f.key} f={f} value={form[f.key]} onChange={v => setForm(x => ({ ...x, [f.key]: v }))} />)}
          {!inputs.length && <p className="muted">This app needs nothing from you: just press Run.</p>}
          <button className="btn primary app-run" disabled={busy || !server}>{busy ? <><i className="spin" />Working…</> : 'Run'}</button>
        </form>
        <section className="app-result" aria-live="polite" aria-label="Result">
          {!run ? <p className="muted app-wait">The result shows here.</p>
            : run.status === 'running' ? <div className="app-working"><i className="spin" /><span>Working on it… this can take a little while.</span></div>
            : run.status === 'error' ? <div className="app-error"><b>It didn’t work.</b><p>{run.error || 'Something went wrong.'}</p></div>
            : <Result items={items} show={a.show} name={a.name} toast={toast} />}
          {history.length > 0 && (
            <div className="app-history">
              <h4>Earlier runs</h4>
              <ul>{history.map(h => (
                <li key={h.id}><button onClick={async () => { try { setRun(await getRun(h.id)); } catch (e) { toast('That run is gone.'); } }}>
                  <i className={'dot ' + h.status} />{ago(h.started)}<small>{h.status === 'success' ? 'Done' : h.status === 'error' ? 'Failed' : 'Running'}</small>
                </button></li>
              ))}</ul>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

function Input({ f, value, onChange }) {
  const name = <span>{f.label}{f.required ? ' *' : ''}</span>;
  const hint = f.hint ? <small className="muted">{f.hint}</small> : null;
  if (f.kind === 'yesno') return <label className="app-f app-check"><input type="checkbox" checked={!!value} onChange={e => onChange(e.target.checked)} />{f.label}</label>;
  if (f.kind === 'choice') return <label className="app-f">{name}<select value={value} onChange={e => onChange(e.target.value)}>{(f.options || []).map(o => <option key={o}>{o}</option>)}</select>{hint}</label>;
  if (f.kind === 'long') return <label className="app-f">{name}<textarea rows={4} required={f.required} value={value} onChange={e => onChange(e.target.value)} placeholder={f.placeholder || ''} />{hint}</label>;
  return <label className="app-f">{name}<input type={{ number: 'number', email: 'email', date: 'date' }[f.kind] || 'text'} required={f.required} value={value} onChange={e => onChange(e.target.value)} placeholder={f.placeholder || ''} />{hint}</label>;
}

function Value({ v }) {
  if (isImage(v)) return <img className="app-img" src={v} alt="" />;
  if (isLink(v)) return <a href={v} target="_blank" rel="noreferrer">{v.startsWith('data:') ? 'Download' : v.replace(/^https?:\/\//, '').slice(0, 60)}</a>;
  if (v && typeof v === 'object') return <code>{JSON.stringify(v)}</code>;
  return <>{v == null ? '' : String(v)}</>;
}

function Result({ items, show, name, toast }) {
  const shape = shapeOf(items, show);
  const keys = [...new Set(items.flatMap(i => Object.keys(i || {})))].filter(k => !k.startsWith('_'));
  const saveCSV = () => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([toCSV(items)], { type: 'text/csv' })); a.download = `${name}.csv`; a.click(); };
  const copy = text => { navigator.clipboard?.writeText(text); toast('Copied'); };
  return (
    <div className="app-out">
      <div className="app-out-head"><b>✓ Done</b>
        <span className="grow" />
        {shape === 'text' && <button className="link" onClick={() => copy(mainText(items[0]))}>Copy</button>}
        {(shape === 'table' || shape === 'cards') && <button className="link" onClick={saveCSV}>Download CSV</button>}
        {items.length > 0 && <button className="link" onClick={() => download(name, JSON.stringify(items, null, 2), 'result')}>Download JSON</button>}
      </div>
      {shape === 'empty' && <p className="muted">It finished, with nothing to show.</p>}
      {shape === 'text' && <div className="app-text">{mainText(items[0])}</div>}
      {shape === 'table' && (
        <div className="app-table"><table><thead><tr>{keys.map(k => <th key={k}>{label(k)}</th>)}</tr></thead>
          <tbody>{items.map((i, n) => <tr key={n}>{keys.map(k => <td key={k}><Value v={i[k]} /></td>)}</tr>)}</tbody></table></div>
      )}
      {shape === 'cards' && <div className="app-cards">{items.map((i, n) => (
        <dl key={n} className="app-item">{keys.filter(k => i[k] !== undefined).map(k => <div key={k}><dt>{label(k)}</dt><dd><Value v={i[k]} /></dd></div>)}</dl>
      ))}</div>}
      {shape === 'json' && <pre className="app-json">{JSON.stringify(items, null, 2)}</pre>}
      {items.length >= 20 && <p className="muted">Showing the first 20. Download for everything the run kept.</p>}
    </div>
  );
}
