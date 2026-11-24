import { useEffect, useMemo, useState } from 'react';
import { serverInfo } from '../lib/backend.js';
import { listRuns } from '../lib/flows.js';
import { KIND, liveList, stopThing } from '../lib/live.js';
import { useUI } from './ui.jsx';

/* Home › Live: everything published or switched on, in one place: apps, custom apps, web pages, forms,
   chats, webhooks, schedules and watchers. Each workflow is a card with its links (copy, open), when it
   last ran, and a way to take each thing offline. Filter by kind with the chips at the top. */

const ago = t => { const s = Math.round((Date.now() - t) / 1000); return s < 60 ? 'just now' : s < 3600 ? `${Math.round(s / 60)} min ago` : s < 86400 ? `${Math.round(s / 3600)} h ago` : new Date(t).toLocaleDateString(); };
const short = url => url.replace(/^https?:\/\//, '');

export default function Live({ files, q = '', onEdit, onUpdate, onApps }) {
  const { ask, toast } = useUI();
  const [kind, setKind] = useState('all');
  const [server, setServer] = useState(undefined);
  const [last, setLast] = useState({}); // fileId → its latest run
  useEffect(() => { serverInfo().then(i => setServer(!!(i && (i.features || []).includes('flows'))), () => setServer(false)); }, []);
  const all = useMemo(() => liveList(files), [files]);
  const ids = all.map(x => x.file.id).join(',');
  useEffect(() => {
    if (!server) return;
    for (const x of all) if (x.file.flow) listRuns(x.file.id).then(r => r && r[0] && setLast(l => ({ ...l, [x.file.id]: r[0] })), () => {});
  }, [server, ids]); // eslint-disable-line react-hooks/exhaustive-deps

  const counts = {};
  for (const x of all) for (const t of x.things) counts[t.kind] = (counts[t.kind] || 0) + 1;
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  const needle = q.trim().toLowerCase();
  const shown = all.map(x => ({ ...x, things: x.things.filter(t => kind === 'all' || t.kind === kind) }))
    .filter(x => x.things.length && (!needle || `${x.file.title} ${x.things.map(t => `${t.label} ${KIND[t.kind].label}`).join(' ')}`.toLowerCase().includes(needle)));

  const copy = url => navigator.clipboard?.writeText(url).then(() => toast('Link copied'), () => toast('Couldn’t copy: select the link instead'));
  const stop = async (f, t) => {
    const k = KIND[t.kind], whole = !['app', 'ui'].includes(t.kind);
    const others = whole ? liveList([f])[0]?.things.filter(o => !['app', 'ui'].includes(o.kind)).length || 0 : 0;
    if (!await ask({ title: `${k.stop}: “${t.label}”?`, input: false, ok: k.stop,
      text: whole ? `This turns the workflow “${f.title}” off${others > 1 ? `, so its ${others} triggers stop` : ''}. Turn it Active again any time in the editor.` : 'It stops being available. Its workflow stays; publish it again any time.' })) return;
    onUpdate(f.id, c => stopThing(c, t.kind));
    toast(whole ? 'Turned off' : 'Unpublished');
  };

  return (
    <div className="lv">
      <header className="tpl-head">
        <h2>Live <span className="lv-count">{total}</span></h2>
        <p>Everything people or other apps can reach right now: published apps, web pages, forms, chats, webhooks and schedules.</p>
      </header>
      {server === false && total > 0 && <p className="lv-note">Not connected to a Workline server: links and schedules only work once your workflows are on one. Apps still work here.</p>}
      {total > 0 && (
        <div className="lv-chips" role="tablist" aria-label="Show">
          <button role="tab" aria-selected={kind === 'all'} onClick={() => setKind('all')}>All <b>{total}</b></button>
          {Object.keys(KIND).filter(k => counts[k]).map(k => (
            <button key={k} role="tab" aria-selected={kind === k} className={'t-' + KIND[k].tone} onClick={() => setKind(k)}><span aria-hidden="true">{KIND[k].icon}</span>{KIND[k].label} <b>{counts[k]}</b></button>
          ))}
        </div>
      )}
      {!total ? (
        <div className="nofiles">
          <svg className="nofiles-art" viewBox="0 0 160 110" aria-hidden="true"><circle cx="80" cy="55" r="9" /><path d="M62 37a26 26 0 0 0 0 36M98 37a26 26 0 0 1 0 36M50 25a42 42 0 0 0 0 60M110 25a42 42 0 0 1 0 60" /></svg>
          <div>Nothing is live yet. Open a workflow and press <b>Publish</b> to make it an app, or turn it <b>Active</b> to put its page, form, chat or webhook online.</div>
        </div>
      ) : !shown.length ? <div className="nofiles">Nothing live matches{needle ? ` “${q.trim()}”` : ''}.</div> : (
        <div className="lv-list">
          {shown.map(({ file: f, things }) => {
            const r = last[f.id];
            return (
              <article key={f.id} className="lv-card" aria-label={f.title}>
                <header>
                  <span className="lv-dot" aria-hidden="true" />
                  <b className="lv-title">{f.title || 'Untitled'}</b>
                  <small className="lv-run">{r ? <><i className={'s-' + r.status}>{r.status === 'success' ? '✓' : r.status === 'error' ? '!' : '…'}</i>Last ran {ago(r.started)}</> : f.flow ? 'No runs yet' : ''}</small>
                  <button className="btn" onClick={() => onEdit(f.id)}>Edit</button>
                </header>
                <ul>
                  {things.map((t, i) => {
                    const k = KIND[t.kind];
                    return (
                      <li key={t.kind + (t.node?.id || i)} className={'t-' + k.tone}>
                        <span className="lv-kind"><i aria-hidden="true">{k.icon}</i>{k.label}</span>
                        <span className="lv-what">
                          <b>{t.label}</b>
                          {t.url ? <a href={t.url} target="_blank" rel="noreferrer" title={t.url}>{short(t.url)}</a> : t.detail ? <small>{t.detail}</small> : null}
                        </span>
                        <span className="lv-acts">
                          {t.url && <button className="btn" onClick={() => copy(t.url)} aria-label={`Copy the link of ${t.label}`}>Copy link</button>}
                          {t.url && ['page', 'form', 'chat', 'ui'].includes(t.kind) && <a className="btn" href={t.url} target="_blank" rel="noreferrer">Open ↗</a>}
                          {t.kind === 'app' && onApps && <button className="btn" onClick={onApps}>Open in Apps</button>}
                          <button className="btn lv-stop" onClick={() => stop(f, t)}>{k.stop}</button>
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
