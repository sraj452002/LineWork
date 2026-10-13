import { useEffect, useMemo, useRef, useState } from 'react';
import { api, hasFeature } from '../lib/backend.js';
import { secretPath } from '../lib/flows.js';
import { APP_STARTERS, appDoc } from '../lib/apphost.js';
import { useUI } from './ui.jsx';

/* The App view: a custom app with its own UI. You write its page (HTML, CSS, JavaScript), pick which of
   your workflows it may run, and see it live beside the code. Published, it has a link of its own that
   anyone can open: a page that runs those workflows (with your credentials, like a webhook) and shows
   what they return however the page likes. Saved in file.ui: {html, doc, flows, published, token}. */

const hasFlow = f => !!(f && f.flow && Array.isArray(f.flow.nodes) && f.flow.nodes.length);

export default function AppBuilder({ file, update, files = [], onGuide }) {
  const { toast, popup } = useUI();
  const ui = file.ui || null;
  // Workflows this app could run: this file's own, and the account's other workflow files.
  const choices = useMemo(() => {
    const list = [file, ...files.filter(f => f.id !== file.id)].filter(hasFlow);
    return list.map(f => ({ id: f.id, name: f.id === file.id ? `${f.title} (this file)` : f.title, title: f.title }));
  }, [file, files]);
  const granted = (ui && ui.flows) || [];
  const workflows = choices.filter(c => granted.includes(c.id)).map(c => ({ id: c.id, name: c.title }));
  const title = file.title || 'App';

  // Keep the published page (doc) in step with the code and the workflows it may run.
  const write = patch => update(c => {
    const next = { html: APP_STARTERS[0].html, flows: [], published: false, ...(c.ui || {}), ...patch };
    const names = (next.flows || []).map(id => { const f = id === c.id ? c : files.find(x => x.id === id); return f ? { id, name: f.title } : null; }).filter(Boolean);
    next.doc = appDoc(next.html, { workflows: names, title: c.title || 'App' });
    c.ui = next;
  });
  // A new app starts from the form, with this file's workflow if it has one.
  useEffect(() => { if (!file.ui) write({ flows: hasFlow(file) ? [file.id] : [] }); }, [file.ui]); // eslint-disable-line react-hooks/exhaustive-deps

  const [server, setServer] = useState(undefined);
  useEffect(() => { hasFeature('flows').then(setServer); }, []);

  // The preview runs the code as it is now (a moment after typing stops).
  const html = ui ? ui.html : '';
  const [shown, setShown] = useState(html);
  useEffect(() => { const t = setTimeout(() => setShown(html), 400); return () => clearTimeout(t); }, [html]);
  const [reload, setReload] = useState(0);
  const preview = useMemo(() => appDoc(shown, { mode: 'preview', workflows, title }), [shown, JSON.stringify(workflows), title, reload]); // eslint-disable-line react-hooks/exhaustive-deps

  // The preview's workline.run comes here: run the saved workflow as the signed-in user.
  const frame = useRef(null);
  useEffect(() => {
    const on = async e => {
      const m = e.data;
      if (!frame.current || e.source !== frame.current.contentWindow || !m || m.workline !== 'run') return;
      const reply = r => frame.current && frame.current.contentWindow.postMessage({ workline: 'result', id: m.id, ...r }, '*');
      const w = workflows.find(x => x.id === m.workflow || x.name === m.workflow) || (!m.workflow && workflows[0]);
      if (!w) return reply({ error: m.workflow ? `This app can’t run “${m.workflow}”. Add it under Workflows.` : 'This app has no workflows yet. Add one under Workflows.' });
      if (!server) return reply({ error: 'Workflows run on the Workline server. Sign in to run them.' });
      try {
        // The workflow as it is in the editor (saved or not yet), so a new or just-changed one works at once.
        const f = w.id === file.id ? file : files.find(x => x.id === w.id);
        const got = f && f.flow
          ? await api(`/flows/${encodeURIComponent(w.id)}/data`, { method: 'POST', body: { flow: f.flow, input: m.input, trigger: 'app' } })
          : await api(`/flows/${encodeURIComponent(w.id)}/call`, { method: 'POST', body: { input: m.input } });
        reply(got.pending ? { error: 'The workflow is taking more than a minute. Try again in a while.' } : { items: got.items || [] });
      } catch (err) { reply({ error: err.message || 'The workflow failed.' }); }
    };
    addEventListener('message', on);
    return () => removeEventListener('message', on);
  }, [workflows, server, file, files]);

  if (!ui) return null;
  const link = ui.published && ui.token ? `${location.origin}/api/ui/${ui.token}` : '';
  const toggle = id => write({ flows: granted.includes(id) ? granted.filter(x => x !== id) : [...granted, id] });
  const pickFlows = el => popup(el, choices.length
    ? choices.map(c => ({ label: c.name, on: granted.includes(c.id), act: () => toggle(c.id) }))
    : [{ label: 'No workflows yet: build one in the Workflow view', act: () => {} }]);
  const startFrom = el => popup(el, APP_STARTERS.map(s => ({ label: s.label, act: () => { write({ html: s.html }); setShown(s.html); } })));

  return (
    <div className="ab">
      <div className="ab-bar">
        <button className="btn" aria-haspopup="menu" onClick={e => pickFlows(e.currentTarget)} title="The workflows this app may run">
          Workflows: {workflows.length ? workflows.map(w => w.name).join(', ') : 'none'} ▾
        </button>
        <button className="btn" aria-haspopup="menu" onClick={e => startFrom(e.currentTarget)}>Start from ▾</button>
        <button className="btn" onClick={() => setReload(n => n + 1)} title="Load the preview again">↻ Reload</button>
        {onGuide && <button className="btn" onClick={() => onGuide('apps')} title="How custom apps work: workline.run, helpers, publishing">? Guide</button>}
        <span className="ab-sp" />
        {link && <>
          <input className="ab-link" readOnly value={link} aria-label="App link" onFocus={e => e.target.select()} />
          <button className="btn" onClick={() => { navigator.clipboard?.writeText(link); toast('Link copied'); }}>Copy</button>
          <a className="btn" href={link} target="_blank" rel="noreferrer">Open</a>
        </>}
        <label className={'fv-active' + (ui.published ? ' on' : '')} title="Anyone with the link can use the app, and run its workflows with your credentials">
          <input type="checkbox" checked={!!ui.published} disabled={server === false} onChange={e => write({ published: e.target.checked, token: ui.token || secretPath() + secretPath().slice(0, 8) })} />
          <i />{ui.published ? 'Published' : 'Publish'}
        </label>
      </div>
      {server === false && <p className="ab-note">Apps run workflows on the Workline server: sign in to try it and to publish.</p>}
      <div className="ab-main">
        <textarea className="ab-code" aria-label="App code" spellCheck={false} value={ui.html}
          onChange={e => write({ html: e.target.value })}
          onKeyDown={e => {
            if (e.key !== 'Tab') return;
            e.preventDefault();
            const t = e.target, s = t.selectionStart, v = t.value.slice(0, s) + '  ' + t.value.slice(t.selectionEnd);
            write({ html: v }); requestAnimationFrame(() => { t.selectionStart = t.selectionEnd = s + 2; });
          }} />
        <iframe ref={frame} className="ab-preview" title="App preview" sandbox="allow-scripts allow-forms allow-modals" srcDoc={preview} />
      </div>
      <p className="ab-help">In the page’s script, <code>await workline.run('Workflow name', {'{ … }'})</code> runs one of its workflows with that input and gives back what the workflow’s last steps output (a list). <code>workline.workflows</code> lists them. <code>cards</code>, <code>bars</code>, <code>line</code>, <code>pie</code> and <code>table</code> draw results.{onGuide && <> <button className="link" onClick={() => onGuide('apps')}>More in the guide</button></>}</p>
    </div>
  );
}
