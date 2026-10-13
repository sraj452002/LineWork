import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../lib/backend.js';
import { rid } from '../lib/utils.js';
import { appDoc } from '../lib/apphost.js';
import { COLS, COMMON_FIELDS, COMPONENTS, ROW, STEP_KINDS, THEMES, builderHtml, newComponent, newPage } from '../lib/appbuilder.js';
import { useUI } from './ui.jsx';

/* App view → Visual: build an app by placing components on its pages (a 12-column grid), and fill them
   with data from workflows. The canvas is the real app (lib/appbuilder.js, in "design" mode, with live
   data) under a layer that selects, moves and resizes. Preview runs it as people will see it. */

const TOP = 12; // the canvas page's top padding, as in the runtime's design mode
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const copy = v => JSON.parse(JSON.stringify(v));

function Field({ f, value, onChange }) {
  const id = useMemo(() => rid('fld'), []);
  if (f.kind === 'bool') return <label className="vb-check"><input type="checkbox" checked={!!value} onChange={e => onChange(e.target.checked)} /> {f.label}</label>;
  return (
    <label className="vb-field" htmlFor={id}>
      <span>{f.label}</span>
      {f.kind === 'select'
        ? <select id={id} value={value ?? ''} onChange={e => onChange(e.target.value)}>{f.options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
        : f.kind === 'textarea'
          ? <textarea id={id} rows={4} value={value ?? ''} placeholder={f.hint} onChange={e => onChange(e.target.value)} />
          : <input id={id} value={value ?? ''} placeholder={f.hint} onChange={e => onChange(e.target.value)} />}
    </label>
  );
}

function Pairs({ value = [], onChange, label = 'Input' }) {
  const set = (i, k, v) => onChange(value.map((p, j) => (j === i ? { ...p, [k]: v } : p)));
  return (
    <div className="vb-pairs">
      <span className="vb-sub">{label}</span>
      {value.map((p, i) => (
        <div key={i} className="vb-pair">
          <input aria-label="Field name" placeholder="name" value={p.name || ''} onChange={e => set(i, 'name', e.target.value)} />
          <input aria-label="Field value" placeholder="{{ vars.input1 }}" value={p.value || ''} onChange={e => set(i, 'value', e.target.value)} />
          <button className="vb-x" aria-label="Remove field" onClick={() => onChange(value.filter((_, j) => j !== i))}>×</button>
        </div>
      ))}
      <button className="link" onClick={() => onChange([...value, { name: '', value: '' }])}>+ Add a field</button>
    </div>
  );
}

// What a button, form, table or list does when used: steps, in order.
function Steps({ steps = [], onChange, spec, workflows }) {
  const set = (i, patch) => onChange(steps.map((s, j) => (j === i ? { ...s, ...patch } : s)));
  return (
    <div className="vb-steps" aria-label="When used">
      {steps.map((s, i) => (
        <div key={i} className="vb-step">
          <div className="vb-step-head">
            <b>{i + 1}</b>
            <select aria-label="Step" value={s.kind} onChange={e => set(i, { kind: e.target.value })}>
              {STEP_KINDS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
            <button className="vb-x" aria-label="Remove step" onClick={() => onChange(steps.filter((_, j) => j !== i))}>×</button>
          </div>
          {s.kind === 'run' && (
            <select aria-label="Data source" value={s.source || ''} onChange={e => set(i, { source: e.target.value })}>
              <option value="">Pick a data source…</option>
              {(spec.data || []).map(d => <option key={d.id} value={d.name}>{d.name}</option>)}
            </select>
          )}
          {s.kind === 'workflow' && <>
            <select aria-label="Workflow" value={s.workflow || ''} onChange={e => set(i, { workflow: e.target.value })}>
              <option value="">Pick a workflow…</option>
              {workflows.map(w => <option key={w.id} value={w.name}>{w.name}</option>)}
            </select>
            <Pairs label="Send (blank: the form’s answers or the clicked row)" value={s.input} onChange={v => set(i, { input: v })} />
            <label className="vb-field"><span>Keep the result as data.</span><input placeholder="result" value={s.into || ''} onChange={e => set(i, { into: e.target.value.replace(/\W/g, '') })} /></label>
          </>}
          {s.kind === 'set' && <div className="vb-pair">
            <input aria-label="Name" placeholder="name" value={s.name || ''} onChange={e => set(i, { name: e.target.value.replace(/\W/g, '') })} />
            <input aria-label="Value" placeholder="{{ item.id }}" value={s.value || ''} onChange={e => set(i, { value: e.target.value })} />
          </div>}
          {s.kind === 'go' && (
            <select aria-label="Page" value={s.page || ''} onChange={e => set(i, { page: e.target.value })}>
              <option value="">Pick a page…</option>
              {spec.pages.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          )}
          {s.kind === 'toast' && <input aria-label="Message" placeholder="Saved!" value={s.text || ''} onChange={e => set(i, { text: e.target.value })} />}
          {s.kind === 'open' && <input aria-label="Link" placeholder="https://…" value={s.url || ''} onChange={e => set(i, { url: e.target.value })} />}
        </div>
      ))}
      <button className="btn" onClick={() => onChange([...steps, { kind: 'workflow' }])}>+ Add a step</button>
    </div>
  );
}

function Users({ fileId, server }) {
  const { toast } = useUI();
  const [users, setUsers] = useState(null);
  const load = () => api(`/flows/${encodeURIComponent(fileId)}/app-users`).then(r => setUsers(r.users), () => setUsers([]));
  useEffect(() => { if (server) load(); }, [fileId, server]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!server) return <p className="vb-hint">Sign in to Workline to see who has an account.</p>;
  if (!users) return <p className="vb-hint">Loading…</p>;
  if (!users.length) return <p className="vb-hint">No accounts yet. People make one on the app’s sign-in screen.</p>;
  return (
    <ul className="vb-users" aria-label="People with an account">
      {users.map(u => (
        <li key={u.email}><span><b>{u.name || u.email.split('@')[0]}</b> {u.email}</span>
          <button className="link" onClick={async () => { await api(`/flows/${encodeURIComponent(fileId)}/app-users/${encodeURIComponent(u.email)}`, { method: 'DELETE' }); toast('Removed'); load(); }}>Remove</button>
        </li>
      ))}
    </ul>
  );
}

export default function VisualBuilder({ spec, onChange, access, allow, onAccess, workflows, choices, grant, fileId, server, title }) {
  const { ask } = useUI();
  const [pageId, setPageId] = useState(() => spec.pages[0]?.id);
  const page = spec.pages.find(p => p.id === pageId) || spec.pages[0];
  const [sel, setSel] = useState(null);
  const [phone, setPhone] = useState(false);
  const [drag, setDrag] = useState(null);
  const [tab, setTab] = useState('add');
  const canvas = useRef(null), frame = useRef(null), dragRef = useRef(null);
  const [W, setW] = useState(900);
  const colW = W / COLS;
  const comp = page && page.components.find(c => c.id === sel);

  // Change the app: `fn` gets a copy to edit.
  const edit = fn => { const next = copy(spec); fn(next, next.pages.find(p => p.id === page.id)); onChange(next); };
  const editComp = (id, patch) => edit((s, pg) => { const c = pg.components.find(x => x.id === id); if (c) Object.assign(c, patch); });
  const editProps = (id, patch) => edit((s, pg) => { const c = pg.components.find(x => x.id === id); if (c) c.props = { ...c.props, ...patch }; });

  // The canvas: the real app in design mode. It's made once; changes are sent to it.
  const doc = useMemo(() => appDoc(builderHtml(spec, { design: true }), { mode: 'preview', workflows, title }), [JSON.stringify(workflows)]); // eslint-disable-line react-hooks/exhaustive-deps
  const shownSpec = useMemo(() => {
    if (!drag) return spec;
    const s = copy(spec); const c = s.pages.find(p => p.id === page.id).components.find(x => x.id === drag.id);
    Object.assign(c, drag);
    return s;
  }, [spec, drag, page && page.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const send = () => frame.current?.contentWindow?.postMessage({ workline: 'design', spec: shownSpec, page: page && page.id, stack: phone }, '*');
  useEffect(send, [shownSpec, page && page.id, phone]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const el = canvas.current; if (!el) return undefined;
    const ro = new ResizeObserver(() => setW(el.clientWidth || 900));
    ro.observe(el);
    return () => ro.disconnect();
  }, [phone]);

  if (!page) return null;
  const comps = (drag ? shownSpec.pages.find(p => p.id === page.id) : page).components;
  const bottom = comps.reduce((m, c) => Math.max(m, c.y + c.h), 0);
  const height = TOP + (bottom + 30) * ROW;

  const add = (type, at) => {
    const c = newComponent(type, page.components, at);
    edit((s, pg) => { pg.components.push(c); });
    setSel(c.id); setTab('props');
  };
  const remove = id => { edit((s, pg) => { pg.components = pg.components.filter(c => c.id !== id); }); setSel(null); };
  const duplicate = c => {
    const d = { ...copy(c), id: rid('c'), y: c.y + c.h };
    let n = 1; const base = c.name.replace(/\d+$/, '');
    while (page.components.some(x => x.name === `${base}${n}`)) n++;
    d.name = `${base}${n}`;
    edit((s, pg) => { pg.components.push(d); }); setSel(d.id);
  };

  const pointer = (e, c, mode) => {
    if (phone || e.button !== 0) return;
    e.preventDefault(); e.stopPropagation();
    setSel(c.id); setTab('props');
    const sx = e.clientX, sy = e.clientY, o = { id: c.id, x: c.x, y: c.y, w: c.w, h: c.h };
    let moved = false;
    const move = ev => {
      const dx = ev.clientX - sx, dy = ev.clientY - sy;
      if (!moved && Math.abs(dx) + Math.abs(dy) < 4) return;
      moved = true;
      const n = { ...o };
      if (mode === 'move') { n.x = clamp(Math.round(o.x + dx / colW), 0, COLS - o.w); n.y = Math.max(0, Math.round(o.y + dy / ROW)); }
      if (mode.includes('e')) n.w = clamp(Math.round(o.w + dx / colW), 1, COLS - o.x);
      if (mode.includes('s')) n.h = Math.max(2, Math.round(o.h + dy / ROW));
      dragRef.current = n; setDrag(n);
    };
    const up = () => {
      removeEventListener('pointermove', move); removeEventListener('pointerup', up);
      const n = dragRef.current; dragRef.current = null; setDrag(null);
      if (moved && n) editComp(n.id, { x: n.x, y: n.y, w: n.w, h: n.h });
    };
    addEventListener('pointermove', move); addEventListener('pointerup', up);
  };
  const onKey = e => {
    if (!comp || phone || /INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return;
    const mv = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
    if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); remove(comp.id); }
    else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'd') { e.preventDefault(); duplicate(comp); }
    else if (mv) { e.preventDefault(); editComp(comp.id, { x: clamp(comp.x + mv[0], 0, COLS - comp.w), y: Math.max(0, comp.y + mv[1]) }); }
    else if (e.key === 'Escape') setSel(null);
  };
  const drop = e => {
    const type = e.dataTransfer.getData('text/x-wl-comp');
    if (!type || !COMPONENTS[type]) return;
    e.preventDefault();
    const r = canvas.current.getBoundingClientRect();
    add(type, { x: clamp(Math.floor((e.clientX - r.left) / colW), 0, COLS - 1), y: Math.max(0, Math.round((e.clientY - r.top - TOP) / ROW)) });
  };

  const renamePage = async () => {
    const name = await ask({ title: 'Rename page', value: page.name, ok: 'Rename' });
    if (name && String(name).trim()) edit((s, pg) => { pg.name = String(name).trim().slice(0, 40); });
  };
  const removePage = async () => {
    if (spec.pages.length < 2) return;
    if (!await ask({ title: `Delete the page “${page.name}”?`, text: 'Its components go with it.', input: false, ok: 'Delete' })) return;
    edit(s => { s.pages = s.pages.filter(p => p.id !== page.id); });
    setPageId(spec.pages.find(p => p.id !== page.id).id); setSel(null);
  };
  const addSource = () => edit(s => {
    let n = 1; while ((s.data || []).some(d => d.name === `data${n}`)) n++;
    (s.data ||= []).push({ id: rid('s'), name: workflows[0] ? workflows[0].name.replace(/\W+(\w)?/g, (_, c) => (c ? c.toUpperCase() : '')).replace(/^\w/, c => c.toLowerCase()) || `data${n}` : `data${n}`, workflow: workflows[0]?.name || '', input: [], auto: true });
  });
  const setSource = (id, patch) => edit(s => { const d = s.data.find(x => x.id === id); Object.assign(d, patch); });

  const t = spec.theme || {};
  const setTheme = patch => edit(s => { s.theme = { ...s.theme, ...patch }; });

  return (
    <div className="vb">
      <div className="vb-pages" role="tablist" aria-label="Pages">
        {spec.pages.map(p => (
          <button key={p.id} role="tab" aria-selected={p.id === page.id} className={'vb-page' + (p.id === page.id ? ' on' : '')}
            onClick={() => { setPageId(p.id); setSel(null); }} onDoubleClick={renamePage}>{p.name}</button>
        ))}
        <button className="vb-page add" aria-label="Add a page" onClick={() => { const p = newPage(spec.pages); edit(s => { s.pages.push(p); }); setPageId(p.id); setSel(null); }}>+ Page</button>
        <span className="vb-sp" />
        <div className="vb-seg" role="group" aria-label="Screen">
          <button className={!phone ? 'on' : ''} aria-pressed={!phone} onClick={() => setPhone(false)}>Desktop</button>
          <button className={phone ? 'on' : ''} aria-pressed={phone} onClick={() => { setPhone(true); setSel(null); }}>Phone</button>
        </div>
      </div>
      <div className="vb-main">
        <aside className="vb-left">
          <div className="vb-tabs" role="tablist">
            {[['add', 'Components'], ['data', 'Data'], ['app', 'App']].map(([k, l]) => <button key={k} role="tab" aria-selected={tab === k || (k === 'add' && tab === 'props')} className={tab === k || (k === 'add' && tab === 'props') ? 'on' : ''} onClick={() => setTab(k)}>{l}</button>)}
          </div>
          {(tab === 'add' || tab === 'props') && (
            <div className="vb-palette" aria-label="Components">
              {Object.entries(COMPONENTS).map(([k, d]) => (
                <button key={k} className="vb-tile" draggable onDragStart={e => { e.dataTransfer.setData('text/x-wl-comp', k); e.dataTransfer.effectAllowed = 'copy'; }}
                  onClick={() => add(k)} aria-label={`Add ${d.label}`} title="Click to add, or drag onto the page">{d.label}</button>
              ))}
              <p className="vb-hint">Click to add at the bottom, or drag onto the page. Drag a box to move it, its corner to resize. Delete removes, Ctrl+D copies, arrows nudge.</p>
            </div>
          )}
          {tab === 'data' && (
            <div className="vb-data">
              <p className="vb-hint">A data source runs a workflow and keeps what it returns as <code>data.name</code>, for tables, charts and text. Inputs can send what people typed: <code>{'{{ vars.input1 }}'}</code>.</p>
              {(spec.data || []).map(d => (
                <div key={d.id} className="vb-source" aria-label={`Data source ${d.name}`}>
                  <div className="vb-pair">
                    <input aria-label="Source name" value={d.name} onChange={e => setSource(d.id, { name: e.target.value.replace(/\W/g, '') })} />
                    <button className="vb-x" aria-label="Remove data source" onClick={() => edit(s => { s.data = s.data.filter(x => x.id !== d.id); })}>×</button>
                  </div>
                  <select aria-label="Workflow" value={d.workflow || ''} onChange={e => { const ch = choices.find(c => c.title === e.target.value); if (ch) grant(ch.id); setSource(d.id, { workflow: e.target.value }); }}>
                    <option value="">Pick a workflow…</option>
                    {choices.map(c => <option key={c.id} value={c.title}>{c.name}</option>)}
                  </select>
                  <Pairs label="Send" value={d.input} onChange={v => setSource(d.id, { input: v })} />
                  <label className="vb-check"><input type="checkbox" checked={!!d.auto} onChange={e => setSource(d.id, { auto: e.target.checked })} /> Run when the app opens</label>
                </div>
              ))}
              <button className="btn" onClick={addSource}>+ Add a data source</button>
              {!choices.length && <p className="vb-hint">No workflows yet: build one in the Workflow view, then pick it here.</p>}
            </div>
          )}
          {tab === 'app' && (
            <div className="vb-appset">
              <label className="vb-field"><span>App name</span><input value={spec.name || ''} onChange={e => edit(s => { s.name = e.target.value; })} /></label>
              <label className="vb-field"><span>Menu</span>
                <select value={spec.nav || 'top'} onChange={e => edit(s => { s.nav = e.target.value; })}>
                  <option value="top">Across the top</option><option value="side">Down the side</option><option value="none">None</option>
                </select>
              </label>
              <span className="vb-sub">Look</span>
              <div className="vb-themes">
                {Object.entries(THEMES).map(([k, th]) => <button key={k} title={k} aria-label={`Theme ${k}`} style={{ background: th.bg, borderColor: th.primary }} onClick={() => setTheme(th)}><i style={{ background: th.primary }} /></button>)}
              </div>
              <div className="vb-colors">
                {[['primary', 'Accent'], ['bg', 'Background'], ['surface', 'Cards'], ['text', 'Text']].map(([k, l]) => (
                  <label key={k}><input type="color" value={t[k] || '#000000'} onChange={e => setTheme({ [k]: e.target.value })} />{l}</label>
                ))}
              </div>
              <label className="vb-field"><span>Corners: {t.radius ?? 12}px</span><input type="range" min="0" max="24" value={t.radius ?? 12} onChange={e => setTheme({ radius: +e.target.value })} /></label>
              <label className="vb-field"><span>Font</span>
                <select value={t.font || 'system'} onChange={e => setTheme({ font: e.target.value })}>
                  <option value="system">System</option><option value="rounded">Rounded</option><option value="serif">Serif</option><option value="mono">Monospace</option>
                </select>
              </label>
              <span className="vb-sub">Who can use it</span>
              <div className="vb-access" role="radiogroup" aria-label="Who can use it">
                {[['public', 'Anyone with the link'], ['signin', 'People who sign in (anyone can make an account)'], ['invite', 'Only people I invite']].map(([k, l]) => (
                  <label key={k}><input type="radio" name="vb-access" checked={access === k} onChange={() => onAccess({ access: k })} /> {l}</label>
                ))}
              </div>
              {access === 'invite' && <label className="vb-field"><span>Their emails, one a line</span><textarea rows={4} value={(allow || []).join('\n')} onChange={e => onAccess({ allow: e.target.value.split(/[\n,]/).map(s => s.trim().toLowerCase()).filter(Boolean) })} /></label>}
              {access !== 'public' && <>
                <p className="vb-hint">Each workflow run gets who it is for: <code>{'{{ $json.user.email }}'}</code>. Use it to show people only their own data.</p>
                <Users fileId={fileId} server={server} />
              </>}
              <span className="vb-sub">This page</span>
              <label className="vb-check"><input type="checkbox" checked={page.nav !== false} onChange={e => edit((s, pg) => { pg.nav = e.target.checked; })} /> Show “{page.name}” in the menu</label>
              <div className="vb-row"><button className="btn" onClick={renamePage}>Rename page</button>{spec.pages.length > 1 && <button className="btn" onClick={removePage}>Delete page</button>}</div>
            </div>
          )}
        </aside>

        <div className="vb-stage" onKeyDown={onKey} tabIndex={-1} onPointerDown={e => { if (e.target === e.currentTarget) setSel(null); }}>
          <div className={'vb-canvas' + (phone ? ' phone' : '')} ref={canvas} style={{ height, background: t.bg }}
            onDragOver={e => { if (!phone && e.dataTransfer.types.includes('text/x-wl-comp')) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; } }} onDrop={drop}>
            <iframe ref={frame} title="App canvas" className="vb-frame" sandbox="allow-scripts allow-forms" srcDoc={doc} onLoad={send} style={{ height }} />
            {!phone && (
              <div className="vb-overlay" onPointerDown={e => { if (e.target === e.currentTarget) setSel(null); }}>
                {comps.map(c => (
                  <div key={c.id} className={'vb-box' + (c.id === sel ? ' on' : '')} role="button" tabIndex={0} aria-label={`${COMPONENTS[c.type]?.label || c.type} ${c.name}`}
                    style={{ left: c.x * colW, top: TOP + c.y * ROW, width: c.w * colW, height: c.h * ROW }}
                    onPointerDown={e => pointer(e, c, 'move')} onFocus={() => { setSel(c.id); setTab('props'); }}>
                    <span className="vb-tag">{c.name}</span>
                    {c.id === sel && <>
                      <i className="vb-h e" onPointerDown={e => pointer(e, c, 'e')} />
                      <i className="vb-h s" onPointerDown={e => pointer(e, c, 's')} />
                      <i className="vb-h se" aria-label="Resize" onPointerDown={e => pointer(e, c, 'se')} />
                    </>}
                  </div>
                ))}
                {!comps.length && <div className="vb-empty">Drag components here from the left.</div>}
              </div>
            )}
          </div>
          {phone && <p className="vb-hint center">On a phone the components stack, top to bottom, left to right. Arrange them on Desktop.</p>}
        </div>

        <aside className="vb-right" aria-label="Properties">
          {comp ? <>
            <div className="vb-props-head">
              <b>{COMPONENTS[comp.type]?.label}</b>
              <button className="link" onClick={() => duplicate(comp)}>Duplicate</button>
              <button className="link danger" onClick={() => remove(comp.id)}>Delete</button>
            </div>
            <label className="vb-field"><span>Name</span><input aria-label="Component name" value={comp.name} onChange={e => editComp(comp.id, { name: e.target.value.replace(/\W/g, '') || comp.name })} /></label>
            {COMPONENTS[comp.type]?.holds && <p className="vb-hint"><code>vars.{comp.name}</code> holds {COMPONENTS[comp.type].holds}.</p>}
            {[...(COMPONENTS[comp.type]?.fields || []), ...COMMON_FIELDS].map(fl => (
              <Field key={fl.k} f={fl} value={comp.props[fl.k]} onChange={v => editProps(comp.id, { [fl.k]: v })} />
            ))}
            {COMPONENTS[comp.type]?.events && <>
              <span className="vb-sub">{comp.type === 'form' ? 'When it’s sent' : comp.type === 'button' ? 'When it’s clicked' : 'When a row is clicked'}</span>
              <Steps steps={comp.props.steps || []} spec={spec} workflows={workflows.length ? workflows : choices.map(c => ({ id: c.id, name: c.title }))}
                onChange={v => { for (const s of v) { const ch = s.kind === 'workflow' && choices.find(c => c.title === s.workflow); if (ch) grant(ch.id); } editProps(comp.id, { steps: v }); }} />
            </>}
            <span className="vb-sub">Place</span>
            <div className="vb-xywh">
              {[['x', 'Column', 0, COLS - 1], ['w', 'Width', 1, COLS], ['y', 'Row', 0, 999], ['h', 'Height', 2, 200]].map(([k, l, a, b]) => (
                <label key={k}><span>{l}</span><input type="number" min={a} max={b} value={comp[k]} onChange={e => editComp(comp.id, { [k]: clamp(+e.target.value || 0, a, b) })} /></label>
              ))}
            </div>
          </> : (
            <div className="vb-none">
              <b>Nothing selected</b>
              <p className="vb-hint">Click a component on the page to change it. Text can show data: <code>{'{{ data.orders.length }}'}</code>, <code>{'{{ vars.input1 }}'}</code>, <code>{'{{ user.name }}'}</code>.</p>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
