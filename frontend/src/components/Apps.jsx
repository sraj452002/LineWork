import { useEffect, useMemo, useState } from 'react';
import { serverInfo } from '../lib/backend.js';
import { getRun, listRuns, runFields, startRun } from '../lib/flows.js';
import EditorCard, { continueWith, editorWaiting } from './EditorCard.jsx';
import { isImage, isLink, livePages, mainText, publishedApps, resultOf, runApp, shapeOf, toCSV } from '../lib/apps.js';
import { AppIcon } from './AppIcon.jsx';
import { download } from '../lib/flowio.js';
import { confetti } from '../lib/confetti.js';
import { useUI } from './ui.jsx';
import { FileCard, filesOf, slim } from './ResultView.jsx';

/* Home → Apps: workflows published as apps, for people who just want to use them. Each opens as a form
   with a Run button; the result shows as words, a table or cards, and earlier runs are listed. Nothing
   about nodes or credentials shows here. */

const ago = t => { const s = Math.round((Date.now() - t) / 1000); return s < 60 ? 'just now' : s < 3600 ? `${Math.round(s / 60)} min ago` : s < 86400 ? `${Math.round(s / 3600)} h ago` : s < 30 * 86400 ? `${Math.round(s / 86400)} d ago` : new Date(t).toLocaleDateString(); };
const label = k => String(k).replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ').replace(/^\w/, c => c.toUpperCase());

export default function Apps({ files, q = '', onEdit, onUpdate }) {
  const { ask, toast } = useUI();
  // Removing an app unpublishes it: the workflow (and the app's settings, to publish it again) stay.
  const remove = async f => {
    const name = f.flow.app.name;
    if (!await ask({ title: `Unpublish “${name}”?`, text: 'It disappears from Apps. Its workflow stays as it is; publish it again any time from the workflow.', input: false, ok: 'Unpublish' })) return false;
    onUpdate(f.id, c => { if (c.flow && c.flow.app) c.flow.app.published = false; });
    toast('Unpublished: it’s no longer in Apps');
    return true;
  };
  const [openId, setOpenId] = useState(null);
  const [view, setView] = useState('all'), [sort, setSort] = useState('recent');
  const [server, setServer] = useState(undefined);
  useEffect(() => { serverInfo().then(i => setServer(!!(i && (i.features || []).includes('flows')))); }, []);
  const apps = publishedApps(files);
  const open = apps.find(f => f.id === openId);
  if (open) return <AppRunner file={open} server={server} onBack={() => setOpenId(null)} onEdit={onEdit} onRemove={onUpdate ? async () => { if (await remove(open)) setOpenId(null); } : null} />;
  const needle = q.trim().toLowerCase();
  const byName = (x, y) => x.localeCompare(y, undefined, { sensitivity: 'base' });
  const shown = apps.filter(f => !needle || `${f.flow.app.name} ${f.flow.app.description}`.toLowerCase().includes(needle))
    .sort((x, y) => (sort === 'az' ? byName(x.flow.app.name || '', y.flow.app.name || '') : (y.updated || 0) - (x.updated || 0)));
  // Pages (workflows published as web apps) apart from the form apps: each opens at its own link.
  const pages = livePages(files).filter(p => !needle || `${p.title} ${p.description}`.toLowerCase().includes(needle))
    .sort((x, y) => (sort === 'az' ? byName(x.title || '', y.title || '') : (y.updated || 0) - (x.updated || 0)));
  const allPages = livePages(files);
  const showApps = view !== 'pages', showPages = view !== 'apps';
  return (
    <div className="apps">
      <header className="apps-hero">
        <div className="apps-hero-text">
          <h2>Apps</h2>
          <p>Tools made from your workflows. Open one, fill in the form and press <b>Run</b>.</p>
          <div className="apps-stats">
            <span><b>{apps.length}</b> {apps.length === 1 ? 'app' : 'apps'}</span>
            <span><b>{allPages.length}</b> {allPages.length === 1 ? 'page' : 'pages'}</span>
          </div>
        </div>
        <div className="apps-hero-tip"><i aria-hidden="true">✦</i><span>To make one, open a workflow and press <b>Publish</b> in its toolbar.</span></div>
      </header>
      {(apps.length > 0 || allPages.length > 0) && (
        <div className="apps-bar">
          <div className="apps-chips" role="tablist" aria-label="Show">
            {[['all', 'All', apps.length + allPages.length], ['apps', 'Workflows', apps.length], ['pages', 'Pages', allPages.length]].map(([k, l, n]) => (
              <button key={k} role="tab" aria-selected={view === k} className={view === k ? 'on' : ''} onClick={() => setView(k)}>{l} <small>{n}</small></button>
            ))}
          </div>
          <label className="apps-sort"><span>Sort</span>
            <select value={sort} onChange={e => setSort(e.target.value)} aria-label="Sort apps"><option value="recent">Recently updated</option><option value="az">A–Z</option></select>
          </label>
        </div>
      )}
      {showApps && (!apps.length ? (
        <div className="nofiles apps-empty">
          <svg className="nofiles-art" viewBox="0 0 160 110" aria-hidden="true"><rect x="22" y="24" width="70" height="56" rx="10" /><rect x="68" y="38" width="70" height="56" rx="10" /><path d="M80 56h44M80 66h30M80 76h38" /><circle cx="40" cy="42" r="6" /><path d="M34 64h40" /></svg>
          <div>No apps yet. Build a workflow, then press <b>Publish</b> in its toolbar to turn it into an app anyone can run.</div>
        </div>
      ) : !shown.length ? <div className="nofiles">No apps match “{q.trim()}”.</div> : (
        <>
          {view === 'all' && <h3 className="apps-sec">Workflows <small>{shown.length}</small></h3>}
          <div className="app-grid">
            {shown.map((f, i) => {
              const a = f.flow.app, inputs = (a.inputs || []).slice(0, 3);
              return (
                <div key={f.id} className="app-wrap" style={{ animationDelay: `${Math.min(i, 8) * 40}ms` }}>
                  <button className={'app-card t-' + (a.tone || 'blue')} onClick={() => setOpenId(f.id)} aria-label={`Open the app ${a.name}`}>
                    <span className="app-card-top">
                      <i className="app-icon" aria-hidden="true"><AppIcon icon={a.icon} /></i>
                      <span className="app-kind">Workflow</span>
                    </span>
                    <b>{a.name}</b>
                    {a.description ? <small>{a.description}</small> : <small className="muted">No description</small>}
                    {inputs.length > 0 && (
                      <span className="app-asks" aria-hidden="true">{inputs.map(x => <em key={x.key}><i>{KIND_ICON[x.kind] || 'Aa'}</i>{x.label}</em>)}{(a.inputs || []).length > 3 && <em>+{a.inputs.length - 3}</em>}</span>
                    )}
                    <span className="app-foot">
                      <span className="app-when">{f.updated ? `Updated ${ago(f.updated)}` : ''}</span>
                      <span className="app-go">▶ Open</span>
                    </span>
                  </button>
                  {onUpdate && <button className="app-x" aria-label={`Unpublish the app ${a.name}`} title="Unpublish: take it out of Apps (the workflow stays)" onClick={() => remove(f)}>
                    <svg width="15" height="15" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3" /></svg>
                  </button>}
                </div>
              );
            })}
          </div>
        </>
      ))}
      {showPages && pages.length > 0 && (<>
        <h3 className="apps-sec">Pages <small>{pages.length}</small></h3>
        <p className="apps-sec-note">Workflows published as web pages: each opens at its own link, for anyone.</p>
        <div className="app-grid">
          {pages.map((p, i) => (
            <div key={p.id} className="app-wrap" style={{ animationDelay: `${Math.min(i, 8) * 40}ms` }}>
              <a className="app-card t-sky" href={p.url} target="_blank" rel="noreferrer" aria-label={`Open the page ${p.title}`}>
                <span className="app-card-top">
                  <i className="app-icon" aria-hidden="true"><AppIcon icon={p.icon} fallback="🌐" /></i>
                  <span className="app-kind">Page</span>
                </span>
                <b>{p.title}</b>
                {p.description ? <small>{p.description}</small> : <small className="muted">A web page</small>}
                <span className="app-foot">
                  <span className="app-when">{p.updated ? `Updated ${ago(p.updated)}` : ''}</span>
                  <span className="app-go">Open ↗</span>
                </span>
              </a>
            </div>
          ))}
        </div>
      </>)}
      {showPages && view === 'pages' && !pages.length && <div className="nofiles">No pages yet. Add a Page trigger to a workflow and turn it Active.</div>}
    </div>
  );
}

// The kind of a question, as a tiny mark on the card.
const KIND_ICON = { file: '📎', number: '#', long: '¶', text: 'Aa', email: '@', date: '📅', choice: '☰', yesno: '✓' };

// runner (optional): runs the app some other way (the public store), answering {status, items | error}, or
// {status: 'edit', nodeId, card} when it stopped at an Editor; continuer(nodeId, edited) goes on from there.
export function AppRunner({ file, server, onBack, onEdit, onRemove, runner, continuer, backLabel = '← Apps' }) {
  const { toast } = useUI();
  const a = file.flow.app;
  // A question whose Run by hand field is a (file) asks for a file (even in an app published before files).
  const start = file.flow.nodes.find(n => n.id === a.startId) || file.flow.nodes.find(n => n.type === 'trigger.manual');
  const fileKeys = new Set(start && start.type === 'trigger.manual' ? runFields(start.params?.fields).filter(f => f.kind === 'file').map(f => f.key) : []);
  const inputs = (a.inputs || []).map(f => (fileKeys.has(f.key) ? { ...f, kind: 'file' } : f));
  const [form, setForm] = useState(() => Object.fromEntries(inputs.map(f => [f.key, f.kind === 'yesno' ? false : f.kind === 'choice' ? (f.options || [])[0] || '' : ''])));
  const [run, setRun] = useState(null), [busy, setBusy] = useState(false), [history, setHistory] = useState([]);
  const [editing, setEditing] = useState(null); // an Editor's card: the run stopped there, waiting for the edit
  const [lastCard, setLastCard] = useState(null); // the card closed without saving, to open again
  const [resTab, setResTab] = useState('result'); // the right side: the result, or the earlier runs
  const refresh = () => { if (server && !runner) listRuns(file.id).then(r => setHistory(r.filter(x => x.trigger === 'app').slice(0, 10)), () => {}); };
  useEffect(refresh, [server, file.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const cheer = r => { if (r.status === 'success') { const b = document.querySelector('.app-run')?.getBoundingClientRect(); if (b) confetti({ x: b.left + b.width / 2, y: b.top }); } };
  const poll = async id => {
    let r = { id, status: 'running', nodes: {} };
    for (let i = 0; i < 400 && r.status === 'running'; i++) { await new Promise(res => setTimeout(res, i < 10 ? 300 : 900)); r = await getRun(id); }
    return r;
  };
  // A finished run that stopped at an Editor opens its card instead of showing a result.
  const settle = r => {
    const w = r.status === 'edit' ? { nodeId: r.nodeId, card: r.card } : runner ? null : editorWaiting(file.flow, r);
    if (w) { setEditing(w); setLastCard(w); setRun({ status: 'waiting', name: w.card.name }); return; }
    setRun(r); cheer(r);
  };
  const keepGoing = async edit => {
    const w = editing; setEditing(null); setLastCard(null);
    setBusy(true); setRun({ status: 'running', nodes: {} });
    try {
      if (continuer) settle(await continuer(w.nodeId, { ...w.card, ...edit }));
      else settle(await poll(await startRun(file.id, file.flow, w.nodeId, continueWith(w.card, edit))));
      refresh();
    } catch (err) { setRun({ status: 'error', error: err.message || 'It couldn’t go on.' }); }
    setBusy(false);
  };
  const go = async e => {
    e.preventDefault();
    setBusy(true); setRun({ status: 'running', nodes: {} }); setEditing(null); setLastCard(null);
    try {
      settle(runner ? await runner(form) : await poll(await runApp(file.id, form)));
      if (!runner) refresh();
    } catch (err) { setRun({ status: 'error', error: err.message || 'It couldn’t run.' }); }
    setBusy(false);
  };
  const items = useMemo(() => (run && run.status === 'success' ? run.items || resultOf(file.flow, run) : []), [run, file.flow]);

  return (
    <div className={'app-run-page t-' + (a.tone || 'blue') + (runner ? '' : ' desk')}>
      {!runner && (
        // On the desktop: one compact header, back, the app and its actions in a row.
        <header className="app-head">
          <button className="btn app-back" onClick={onBack} aria-label={backLabel} title={backLabel}>←</button>
          <i className="app-icon" aria-hidden="true"><AppIcon icon={a.icon} /></i>
          <div className="app-head-text">
            <h2>{a.name}</h2>
            <p>{a.description || 'A workflow app'}<span className="app-head-meta"> · {inputs.length ? `${inputs.length} ${inputs.length === 1 ? 'question' : 'questions'}` : 'no questions'}{history[0] ? ` · last run ${ago(history[0].started)}` : ''}</span></p>
          </div>
          <span className="grow" />
          {onEdit && <button className="btn app-edit" onClick={() => onEdit(file.id)}><svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4" /></svg>Edit the workflow</button>}
          {onRemove && <button className="btn danger-text" onClick={onRemove}>Unpublish</button>}
        </header>
      )}
      {runner && <div className="app-top">
        <button className="btn app-back" onClick={onBack}>{backLabel}</button>
        <span className="grow" />
        {onEdit && <button className="btn app-edit" onClick={() => onEdit(file.id)}><svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4" /></svg>Edit the workflow</button>}
        {onRemove && <button className="btn danger-text" onClick={onRemove}>Unpublish</button>}
      </div>}
      {runner && <header className={'app-hero t-' + (a.tone || 'blue')}>
        <i className="app-icon" aria-hidden="true"><AppIcon icon={a.icon} /></i>
        <div className="app-hero-text">
          <h2>{a.name}</h2>{a.description && <p>{a.description}</p>}
          <div className="app-hero-chips">
            <span>Workflow app</span>
            <span>{inputs.length ? `${inputs.length} ${inputs.length === 1 ? 'question' : 'questions'}` : 'No questions'}</span>
            {history[0] && <span>Last run {ago(history[0].started)}</span>}
          </div>
        </div>
      </header>}
      {server === false && !runner && <p className="fv-note">Apps run on the Workline server. Sign in to your account to run this one.</p>}
      <div className="app-body">
        <form className="app-form" onSubmit={go} onKeyDown={e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && !busy) go(e); }}>
          <div className="app-sec-h"><i>1</i>Fill in</div>
          {inputs.map(f => <Input key={f.key} f={f} value={form[f.key]} onChange={v => setForm(x => ({ ...x, [f.key]: v }))} />)}
          {!inputs.length && <p className="muted">This app needs nothing from you: just press Run.</p>}
          <button className="btn primary app-run" disabled={busy || (!server && !runner)}>{busy ? <><i className="spin" />Working…</> : <><svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4l13 8-13 8z" /></svg>Run{!runner && <kbd aria-hidden="true">Ctrl ↵</kbd>}</>}</button>
        </form>
        <section className="app-result" aria-live="polite" aria-label="Result">
          {runner || !history.length ? <div className="app-sec-h"><i>2</i>Result</div> : (
            <div className="app-res-tabs" role="tablist">
              <button type="button" role="tab" aria-selected={resTab === 'result'} className={resTab === 'result' ? 'on' : ''} onClick={() => setResTab('result')}><i>2</i>Result</button>
              <button type="button" role="tab" aria-selected={resTab === 'history'} className={resTab === 'history' ? 'on' : ''} onClick={() => setResTab('history')}>Earlier runs <small>{history.length}</small></button>
            </div>
          )}
          {!runner && history.length > 0 && resTab === 'history' ? (
            <ul className="app-hist">{history.map(h => (
              <li key={h.id}><button onClick={async () => { try { setRun(await getRun(h.id)); setResTab('result'); } catch (e) { toast('That run is gone.'); } }}>
                <i className={'dot ' + h.status} /><b>{h.status === 'success' ? 'Done' : h.status === 'error' ? 'Failed' : 'Running'}</b><span>{ago(h.started)}</span><em>View →</em>
              </button></li>
            ))}</ul>
          ) : <>
          {!run ? <div className="app-wait"><span className="app-wait-art" aria-hidden="true"><i /><i /><i /></span><p className="muted">The result shows here.</p><small className="muted">Fill in the form and press Run.</small></div>
            : run.status === 'running' ? (runner ? <div className="app-working"><i className="spin" /><span>Working on it… this can take a little while.</span></div>
              : <div className="app-skel" role="status"><div className="app-skel-row"><i /><i /><i /></div><span><i className="spin" />Working on it…</span></div>)
            : run.status === 'error' ? <div className="app-error"><b>It didn’t work.</b><p>{run.error || 'Something went wrong.'}</p></div>
            : run.status === 'waiting' ? <div className="app-waiting"><b>✎ Your turn</b><p>Edit {run.name}, then Save &amp; continue.</p><button type="button" className="btn primary" onClick={() => setEditing(lastCard)} disabled={!!editing || !lastCard}>✎ Open the editor</button></div>
            : <Result items={items} show={a.show} name={a.name} toast={toast} />}
          {runner && history.length > 0 && (
            <div className="app-history">
              <h4>Earlier runs</h4>
              <ul>{history.map(h => (
                <li key={h.id}><button onClick={async () => { try { setRun(await getRun(h.id)); } catch (e) { toast('That run is gone.'); } }}>
                  <i className={'dot ' + h.status} />{ago(h.started)}<small>{h.status === 'success' ? 'Done' : h.status === 'error' ? 'Failed' : 'Running'}</small>
                </button></li>
              ))}</ul>
            </div>
          )}
          </>}
        </section>
      </div>
      {editing && <EditorCard card={editing.card} onClose={() => { setLastCard(editing); setEditing(null); }} onSave={keepGoing} />}
    </div>
  );
}

const FILE_MAX = 4 * 2 ** 20;
function Input({ f, value, onChange }) {
  if (f.kind === 'file') return <FileInput f={f} value={value} onChange={onChange} />;
  const name = <span><i className="app-k" aria-hidden="true">{KIND_ICON[f.kind] || 'Aa'}</i>{f.label}{f.required ? ' *' : ''}</span>;
  const hint = f.hint ? <small className="muted">{f.hint}</small> : null;
  if (f.kind === 'yesno') return <label className="app-f app-check"><input type="checkbox" checked={!!value} onChange={e => onChange(e.target.checked)} />{f.label}</label>;
  if (f.kind === 'choice') return <label className="app-f">{name}<select value={value} onChange={e => onChange(e.target.value)}>{(f.options || []).map(o => <option key={o}>{o}</option>)}</select>{hint}</label>;
  if (f.kind === 'long') return <label className="app-f">{name}<textarea rows={4} required={f.required} value={value} onChange={e => onChange(e.target.value)} placeholder={f.placeholder || ''} />{hint}</label>;
  return <label className="app-f">{name}<input type={{ number: 'number', email: 'email', date: 'date' }[f.kind] || 'text'} required={f.required} value={value} onChange={e => onChange(e.target.value)} placeholder={f.placeholder || ''} />{hint}</label>;
}

// A file to send with the form: read here, sent as {name, type, size, data} (data in base64).
function FileInput({ f, value, onChange }) {
  const [err, setErr] = useState('');
  const pick = file => {
    setErr('');
    if (!file) { onChange(''); return; }
    if (file.size > FILE_MAX) { onChange(''); setErr(`“${file.name}” is ${(file.size / 2 ** 20).toFixed(1)} MB: a file can be at most 4 MB.`); return; }
    const r = new FileReader();
    r.onload = () => onChange({ name: file.name, type: file.type || 'application/octet-stream', size: file.size, data: String(r.result).replace(/^data:[^,]*,/, '') });
    r.onerror = () => setErr('That file couldn’t be read.');
    r.readAsDataURL(file);
  };
  return (
    <label className="app-f">
      <span>{f.label}{f.required ? ' *' : ''}</span>
      <input type="file" required={f.required && !value} aria-label={f.label} onChange={e => pick(e.target.files[0])} />
      {value && value.name && <small className="muted">{value.name} · {value.size < 1024 ? `${value.size} B` : `${Math.round(value.size / 1024)} KB`}</small>}
      {err && <small className="err">{err}</small>}
      {f.hint && <small className="muted">{f.hint}</small>}
    </label>
  );
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
        {shape === 'cards' && items.length === 1 && <button className="link" onClick={() => copy(keys.filter(k => typeof items[0][k] !== 'object').map(k => `${label(k)}: ${items[0][k]}`).join('\n'))}>Copy all</button>}
        {(shape === 'table' || shape === 'cards') && <button className="link" onClick={saveCSV}>Download CSV</button>}
        {items.length > 0 && <button className="link" onClick={() => download(name, JSON.stringify(items, null, 2), 'result')}>Download JSON</button>}
      </div>
      {filesOf(items).length > 0 && (
        <section className="rv-files" aria-label="Files">
          <h4>{filesOf(items).length === 1 ? 'Your file is ready' : `${filesOf(items).length} files are ready`}</h4>
          {filesOf(items).slice(0, 10).map((f, i) => <FileCard key={i} f={f} big />)}
        </section>
      )}
      {shape === 'empty' && <p className="muted">It finished, with nothing to show.</p>}
      {shape === 'text' && <div className="app-text">{mainText(items[0])}</div>}
      {shape === 'table' && (
        <div className="app-table"><table><thead><tr>{keys.map(k => <th key={k}>{label(k)}</th>)}</tr></thead>
          <tbody>{items.map((i, n) => <tr key={n}>{keys.map(k => <td key={k}><Value v={i[k]} /></td>)}</tr>)}</tbody></table></div>
      )}
      {shape === 'cards' && <div className="app-cards">{items.map((i, n) => (
        <dl key={n} className="app-item">{keys.filter(k => i[k] !== undefined).map(k => <div key={k} title="Click to copy" onClick={() => typeof i[k] !== 'object' && copy(String(i[k]))}><dt>{label(k)}</dt><dd><Value v={i[k]} /></dd></div>)}</dl>
      ))}</div>}
      {shape === 'json' && !(filesOf(items).length && items.length === 1) && <pre className="app-json">{JSON.stringify(items, slim, 2)}</pre>}
      {items.length >= 20 && <p className="muted">Showing the first 20. Download for everything the run kept.</p>}
    </div>
  );
}
