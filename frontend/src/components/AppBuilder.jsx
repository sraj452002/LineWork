import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { api, hasFeature } from '../lib/backend.js';
import { secretPath } from '../lib/flows.js';
import { APP_STARTERS, appDoc } from '../lib/apphost.js';
import { COMPONENTS, STEP_KINDS, builderHtml, newVisualApp } from '../lib/appbuilder.js';
import { useUI } from './ui.jsx';

const VisualBuilder = lazy(() => import('./VisualBuilder.jsx'));

/* The App view: a custom app with its own UI. You write its page (HTML, CSS, JavaScript), pick which of
   your workflows it may run, and see it live beside the code. Published, it has a link of its own that
   anyone can open: a page that runs those workflows (with your credentials, like a webhook) and shows
   what they return however the page likes. Saved in file.ui: {html, doc, flows, published, token}.
   Two ways to make the page (file.ui.mode): Visual, by placing components (VisualBuilder, with its
   design in file.ui.spec, made into html by lib/appbuilder.js), or Code, by writing it. A visual app can
   ask people to sign in first (file.ui.access, file.ui.allow). */

const hasFlow = f => !!(f && f.flow && Array.isArray(f.flow.nodes) && f.flow.nodes.length);

export default function AppBuilder({ file, update, files = [], onGuide, assist }) {
  const { toast, popup, ask } = useUI();
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
    // A visual app's page is made from its design.
    if (next.mode === 'visual' && next.spec) next.html = builderHtml(next.spec, { access: next.access || 'public' });
    const names = (next.flows || []).map(id => { const f = id === c.id ? c : files.find(x => x.id === id); return f ? { id, name: f.title } : null; }).filter(Boolean);
    next.doc = appDoc(next.html, { workflows: names, title: c.title || 'App' });
    c.ui = next;
  });
  // A new app starts in the visual builder, with this file's workflow if it has one.
  useEffect(() => { if (!file.ui) write({ mode: 'visual', spec: newVisualApp(file.title || 'My app', hasFlow(file) ? file.title : ''), flows: hasFlow(file) ? [file.id] : [] }); }, [file.ui]); // eslint-disable-line react-hooks/exhaustive-deps
  const visual = !!(file.ui && file.ui.mode === 'visual' && file.ui.spec);
  const [previewing, setPreviewing] = useState(false);

  const [server, setServer] = useState(undefined);
  useEffect(() => { hasFeature('flows').then(setServer); }, []);

  // The preview runs the code as it is now (a moment after typing stops).
  const html = ui ? ui.html : '';
  const [shown, setShown] = useState(html);
  useEffect(() => { const t = setTimeout(() => setShown(html), 400); return () => clearTimeout(t); }, [html]);
  const [reload, setReload] = useState(0);
  const preview = useMemo(() => appDoc(shown, { mode: 'preview', workflows, title }), [shown, JSON.stringify(workflows), title, reload]); // eslint-disable-line react-hooks/exhaustive-deps

  // The preview's workline.run comes here: run the saved workflow as the signed-in user.
  const frame = useRef(null), rootRef = useRef(null), me = useRef(null);
  useEffect(() => {
    const on = async e => {
      const m = e.data;
      // From the preview, or the visual builder's canvas.
      const ours = rootRef.current && [...rootRef.current.querySelectorAll('iframe')].some(f => f.contentWindow === e.source);
      if (!ours || !m || (m.workline !== 'run' && m.workline !== 'me')) return;
      const reply = r => e.source.postMessage({ workline: 'result', id: m.id, ...r }, '*');
      // In the editor you're the signed-in user.
      if (m.workline === 'me') {
        me.current ||= server ? api('/auth/me').then(r => ({ email: r.user.email, name: r.user.name || r.user.email.split('@')[0] }), () => null) : Promise.resolve({ email: 'you@example.com', name: 'You' });
        return reply({ user: await me.current });
      }
      const w = workflows.find(x => x.id === m.workflow || x.name === m.workflow) || (!m.workflow && workflows[0]);
      if (!w) return reply({ error: m.workflow ? `This app can’t run “${m.workflow}”. Add it under Workflows.` : 'This app has no workflows yet. Add one under Workflows.' });
      if (!server) return reply({ error: 'Workflows run on the Workline server. Sign in to run them.' });
      try {
        // The workflow as it is in the editor (saved or not yet), so a new or just-changed one works at once.
        const f = w.id === file.id ? file : files.find(x => x.id === w.id);
        let input = m.input;
        if ((file.ui || {}).access && file.ui.access !== 'public') {
          me.current ||= api('/auth/me').then(r => ({ email: r.user.email, name: r.user.name || r.user.email.split('@')[0] }), () => null);
          const user = await me.current;
          input = (Array.isArray(input) ? input : [input || {}]).map(x => ({ ...(x && typeof x === 'object' ? x : { value: x }), user }));
        }
        const got = f && f.flow
          ? await api(`/flows/${encodeURIComponent(w.id)}/data`, { method: 'POST', body: { flow: f.flow, input, trigger: 'app' } })
          : await api(`/flows/${encodeURIComponent(w.id)}/call`, { method: 'POST', body: { input } });
        reply(got.pending ? { error: 'The workflow is taking more than a minute. Try again in a while.' } : { items: got.items || [] });
      } catch (err) { reply({ error: err.message || 'The workflow failed.' }); }
    };
    addEventListener('message', on);
    return () => removeEventListener('message', on);
  }, [workflows, server, file, files]);

  // The AI panel (Editor): it sees the page's code and the workflows, and can rewrite the page.
  const catalog = () => Object.entries(COMPONENTS).map(([k, d]) => `- ${k} (${d.label}, default ${d.w}×${d.h}): props ${JSON.stringify(d.props)}${d.events ? '; props.steps run when used' : ''}${d.holds ? `; vars.<name> holds ${d.holds}` : ''}`).join('\n');
  if (assist) assist.current = visual ? {
    section: 'App', placeholder: 'Describe the app, or what to change in it.',
    intro: 'I can see this app’s pages, components, data sources and workflows. Ask me to build the app, add a page, connect a table or chart to a workflow, or change the look.',
    chips: [
      { label: 'Build an app that…', prompt: 'Build an app that ', fill: true },
      { label: 'Add a details page for the clicked row', prompt: 'Add a details page: clicking a row in the table should open a page that shows that row’s fields, with a Back button.' },
      { label: 'Make it look modern and polished', prompt: 'Restyle this app so it looks modern and polished (theme, cards, spacing), keeping everything it does.' },
      { label: 'Explain how this app works', prompt: 'Explain how this app works, briefly.' },
    ],
    context: () => `The App view, in Visual mode: an app made of pages; each page has components placed on a 12-column grid (x 0–11, w 1–12 columns; y and h in rows of ${8}px), filled with data from Workline workflows.
Data sources: {id, name, workflow (a workflow's name), input: [{name, value}], auto (run when the app opens)}; their output (a list of objects) is data.<name>.
Text in props can hold {{ JavaScript }} with: data, vars (inputs, clicked rows, set values), user ({email, name} when signed in), item (the clicked row or form answers), page. "{{ x }}" alone gives x itself (a list for rows).
Steps (props.steps) for buttons, forms, tables and lists: ${STEP_KINDS.map(([k, l]) => `${k} (${l})`).join(', ')}: {kind:'run', source}, {kind:'workflow', workflow, input:[{name,value}], into}, {kind:'set', name, value}, {kind:'go', page: pageId}, {kind:'toast', text}, {kind:'open', url}, {kind:'logout'}.
Components:
${catalog()}
Theme: {primary, bg, surface, text, radius, font: system|rounded|serif|mono, dark}. nav: top|side|none.
The workflows it may run: ${choices.map(c => `"${c.title}"`).join(', ') || '(none yet: they can build one in the Workflow view)'}.

The app now (JSON):
${JSON.stringify(ui && ui.spec)}`,
    rules: `{"type": "app", "spec": the complete new app JSON (same shape as above: name, theme, nav, pages with components {id, type, name, x, y, w, h, props}, data), replacing the current one. Keep ids of things you keep; new ids can be any short unique strings. Components on a page shouldn't overlap.}`,
    applyLabel: () => 'Update the app',
    apply: a => {
      const sp = a.spec;
      if (!sp || !Array.isArray(sp.pages) || !sp.pages.length) throw new Error('The answer had no app.');
      for (const pg of sp.pages) { pg.id ||= Math.random().toString(36).slice(2, 9); pg.components = (pg.components || []).filter(c => COMPONENTS[c.type]).map(c => ({ ...c, id: c.id || Math.random().toString(36).slice(2, 9), props: { ...COMPONENTS[c.type].props, ...(c.props || {}) } })); }
      for (const d of sp.data || []) { d.id ||= Math.random().toString(36).slice(2, 9); const ch = choices.find(c => c.title === d.workflow); if (ch && !granted.includes(ch.id)) granted.push(ch.id); }
      write({ spec: { theme: ui.spec.theme, nav: 'top', ...sp }, flows: [...granted] });
      return 'App updated';
    },
  } : {
    section: 'App', placeholder: 'Describe the page, or what to change on it.',
    intro: 'I can see this app’s code and the workflows it may run. Ask me to build the page, change how it looks, add a chart or form, or fix an error.',
    chips: [
      { label: 'Build a page that…', prompt: 'Build a page that ', fill: true },
      { label: 'Make it look modern and polished', prompt: 'Restyle this page so it looks modern and polished, keeping everything it does.' },
      { label: 'Show the results as a chart and cards', prompt: 'Change the page to show the workflow’s results as summary cards and a chart, with the table below.' },
      { label: 'Explain how this page works', prompt: 'Explain how this page works, briefly.' },
    ],
    context: () => `The App view: a custom app page (HTML, CSS and JavaScript in one document body) that runs Workline workflows.
In the page's script: await workline.run('Workflow name', inputObject) runs a workflow and resolves to a list of objects (its output); it throws on failure. workline.workflows lists {id, name}.
Helpers: cards(el, [[label, value], …]), bars(el, rows, labelKey, valueKey), line(…), pie(…), table(el, rows, [cols]). el is an element or a CSS selector. Chart libraries can be loaded from a CDN with <script src>.
The workflows it may run: ${workflows.map(w => `"${w.name}"`).join(', ') || '(none yet: they can add one under Workflows)'}.

The page's current code:
${ui ? ui.html : ''}`,
    rules: `{"type": "html", "html": "the complete new page code (style, markup and script), replacing the current one"}`,
    applyLabel: () => 'Replace the page code',
    apply: a => { if (!a.html || typeof a.html !== 'string') throw new Error('The answer had no page code.'); write({ html: a.html }); setShown(a.html); return 'Page updated'; },
  };
  if (!ui) return null;
  const link = ui.published && ui.token ? `${location.origin}/api/ui/${ui.token}` : '';
  const toggle = id => write({ flows: granted.includes(id) ? granted.filter(x => x !== id) : [...granted, id] });
  const pickFlows = el => popup(el, choices.length
    ? choices.map(c => ({ label: c.name, on: granted.includes(c.id), act: () => toggle(c.id) }))
    : [{ label: 'No workflows yet: build one in the Workflow view', act: () => {} }]);
  // Visual ⇄ Code. The design is kept, so going back to Visual makes the page from it again.
  const toVisual = async () => {
    if (visual) return;
    if (ui.spec) {
      if (!await ask({ title: 'Back to the visual builder?', text: 'The page is made from the visual design again; changes made in the code are replaced.', input: false, ok: 'Use Visual' })) return;
      write({ mode: 'visual' });
    } else write({ mode: 'visual', spec: newVisualApp(title, workflows[0] ? workflows[0].name : '') });
  };
  const toCode = async () => {
    if (!visual) return;
    if (!await ask({ title: 'Edit the code instead?', text: 'You get the page’s code (made from the design) to change by hand. Going back to Visual later replaces code changes with the design.', input: false, ok: 'Edit code' })) return;
    write({ mode: 'code' }); setShown(ui.html);
  };
  const startFrom = el => popup(el, APP_STARTERS.map(s => ({ label: s.label, act: () => { write({ html: s.html }); setShown(s.html); } })));

  return (
    <div className="ab" ref={rootRef}>
      <div className="ab-bar">
        <button className="btn" aria-haspopup="menu" onClick={e => pickFlows(e.currentTarget)} title="The workflows this app may run">
          Workflows: {workflows.length ? workflows.map(w => w.name).join(', ') : 'none'} ▾
        </button>
        <div className="vb-seg" role="group" aria-label="Build with">
          <button className={visual ? 'on' : ''} aria-pressed={visual} onClick={toVisual}>Visual</button>
          <button className={!visual ? 'on' : ''} aria-pressed={!visual} onClick={toCode}>Code</button>
        </div>
        {visual
          ? <button className={'btn' + (previewing ? ' dark' : '')} aria-pressed={previewing} onClick={() => { setShown(ui.html); setPreviewing(v => !v); setReload(n => n + 1); }}>{previewing ? '✎ Edit' : '▶ Preview'}</button>
          : <button className="btn" aria-haspopup="menu" onClick={e => startFrom(e.currentTarget)}>Start from ▾</button>}
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
      {visual && !previewing && (
        <Suspense fallback={<p className="ab-note">Loading the builder…</p>}>
          <VisualBuilder spec={ui.spec} onChange={sp => write({ spec: sp })} access={ui.access || 'public'} allow={ui.allow || []}
            onAccess={patch => write(patch)} workflows={workflows} choices={choices} title={title} fileId={file.id} server={server}
            grant={id => { if (!granted.includes(id)) write({ flows: [...granted, id] }); }} />
        </Suspense>
      )}
      {visual && previewing && <iframe ref={frame} className="ab-preview full" title="App preview" sandbox="allow-scripts allow-forms allow-modals" srcDoc={preview} />}
      {!visual && <div className="ab-main">
        <textarea className="ab-code" aria-label="App code" spellCheck={false} value={ui.html}
          onChange={e => write({ html: e.target.value })}
          onKeyDown={e => {
            if (e.key !== 'Tab') return;
            e.preventDefault();
            const t = e.target, s = t.selectionStart, v = t.value.slice(0, s) + '  ' + t.value.slice(t.selectionEnd);
            write({ html: v }); requestAnimationFrame(() => { t.selectionStart = t.selectionEnd = s + 2; });
          }} />
        <iframe ref={frame} className="ab-preview" title="App preview" sandbox="allow-scripts allow-forms allow-modals" srcDoc={preview} />
      </div>}
      {!visual && <p className="ab-help">In the page’s script, <code>await workline.run('Workflow name', {'{ … }'})</code> runs one of its workflows with that input and gives back what the workflow’s last steps output (a list). <code>workline.workflows</code> lists them. <code>cards</code>, <code>bars</code>, <code>line</code>, <code>pie</code> and <code>table</code> draw results.{onGuide && <> <button className="link" onClick={() => onGuide('apps')}>More in the guide</button></>}</p>}
    </div>
  );
}
