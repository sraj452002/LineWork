import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useUI } from './ui.jsx';
import { serverInfo } from '../lib/backend.js';
import { clone, rid } from '../lib/utils.js';
import {
  CRED_TYPES, GROUPS, ICON, NODES, createCredential, deleteCredential, emptyFlow, getRun, inputsOf, listCredentials,
  listRuns, newNode, nodeDef, outputsOf, outsOf, startRun, updateCredential,
} from '../lib/flows.js';
import { LOGOS } from '../lib/flowlogos.js';
import { listFiles } from '../lib/cloud.js';
import { loadConnections } from '../lib/dbclient.js';
import { besides, download, exportFlow, exportRun, importFlow, templateOf } from '../lib/flowio.js';
import { getData, setData } from '../lib/userdata.js';
import { confetti } from '../lib/confetti.js';
import { NodeCard } from './NodeGuide.jsx';
import { APP_ICONS, INPUT_KINDS, SHOW, emptyApp, keyOf } from '../lib/apps.js';

/* The Workflow view: an n8n-style editor for file.flow. Nodes sit on a canvas you can pan (drag the
   background) and zoom (Ctrl + wheel); drag from a node's output dot to another's input to connect them,
   or let go on empty canvas to add a node there. The panel on the right edits the selected node, shows
   what it produced in the last run, or (with nothing selected) the workflow's runs. Runs happen on the
   Workline server (backend/flows.js). */

const W = 64, H = 64;
// Nodes with many ports (Switch) grow taller, 24 px a port.
const heightOf = n => (n.type === 'core.note' ? Math.max(H, 24 + Math.ceil(String(n.params?.text || '').length / 34) * 18) : Math.max(H, Math.max(inputsOf(n.type).length, outsOf(n).length) * 22 + 10));
const portY = (ports, i, h = H) => (ports.length === 1 ? h / 2 : (h / (ports.length + 1)) * (i + 1));
const Ico = ({ d, size = 18 }) => <svg className="fv-ico" width={size} height={size} viewBox="0 0 24 24" aria-hidden="true"><path d={d} /></svg>;
// A node's mark: the app's own logo in its colour (very dark ones take the text colour, to show on dark
// backgrounds), or its line icon.
const dim = hex => { const n = parseInt(hex.slice(1), 16); return ((n >> 16) * 299 + ((n >> 8) & 255) * 587 + (n & 255) * 114) / 1000 < 60; };
function Mark({ d, size = 18 }) {
  const logo = d.logo && LOGOS[d.logo];
  if (!logo) return <Ico d={d.icon} size={size} />;
  return <svg className="fv-logo" width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" style={{ fill: dim(logo.color) ? 'var(--ink)' : logo.color }}><path d={logo.d} /></svg>;
}
const badge = d => 'fv-badge' + (d.logo && LOGOS[d.logo] ? ' logo' : '');
const curve = (x1, y1, x2, y2) => { const dx = Math.max(40, Math.abs(x2 - x1) / 2); return `M${x1} ${y1}C${x1 + dx} ${y1} ${x2 - dx} ${y2} ${x2} ${y2}`; };
const typing = e => /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName) || e.target.isContentEditable;
const ago = t => { const s = Math.round((Date.now() - t) / 1000); return s < 60 ? `${s}s ago` : s < 3600 ? `${Math.round(s / 60)} min ago` : s < 86400 ? `${Math.round(s / 3600)} h ago` : new Date(t).toLocaleDateString(); };

const TRIGGER_NAME = { manual: 'By hand', app: 'App', webhook: 'Webhook', schedule: 'Schedule', poll: 'Something new', form: 'Form', github: 'GitHub', stripe: 'Stripe', shopify: 'Shopify', slack: 'Slack', typeform: 'Typeform', calendly: 'Calendly' };

export default function FlowView({ file, update, visible, saveState = 'Saved', onGuide }) {
  const { toast, ask } = useUI();
  useEffect(() => { if (!file.flow) update(c => { c.flow = emptyFlow(); }); }, [file.flow, update]);
  const flow = file.flow || { nodes: [], edges: [] };
  const change = useCallback(fn => update(c => { fn(c.flow); }), [update]);

  const [server, setServer] = useState(undefined); // can this server run workflows?
  useEffect(() => { serverInfo().then(i => setServer(!!(i && (i.features || []).includes('flows')))); }, []);
  const [creds, setCreds] = useState([]);
  const loadCreds = useCallback(() => listCredentials().then(setCreds, () => setCreds([])), []);
  useEffect(() => { if (server) loadCreds(); }, [server, loadCreds]);

  const [view, setView] = useState({ x: 60, y: 60, k: 1 });
  const [sel, setSel] = useState(null);       // {kind: 'node' | 'edge', id}
  const [drag, setDrag] = useState(null);     // a node being moved: {id, x, y}
  const [wire, setWire] = useState(null);     // a connection being drawn: {from, port, x1, y1, x2, y2}
  const [pan, setPan] = useState(null);
  const [palette, setPalette] = useState(null); // {x, y, from?: {id, port}} in canvas coordinates
  const [run, setRun] = useState(null);
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState('settings');
  const [credDlg, setCredDlg] = useState(null); // {types, pick?: id => void}
  const [help, setHelp] = useState(null);       // a node type explained in a popup
  const [publish, setPublish] = useState(false);
  const [runs, setRuns] = useState([]);
  const stage = useRef(null), runBtn = useRef(null), importRef = useRef(null);
  const pref = (k, d) => { try { const v = localStorage.getItem('linework:flow-' + k); return v == null ? d : v === '1'; } catch (e) { return d; } };
  const [libOpen, setLibOpenS] = useState(() => pref('lib', true));
  const [sideOpen, setSideOpenS] = useState(() => pref('side', true));
  const setLibOpen = v => { setLibOpenS(v); try { localStorage.setItem('linework:flow-lib', v ? '1' : '0'); } catch (e) {} };
  const setSideOpen = v => { setSideOpenS(v); try { localStorage.setItem('linework:flow-side', v ? '1' : '0'); } catch (e) {} };

  const nodes = flow.nodes || [], edges = flow.edges || [];
  const pos = n => (drag && drag.id === n.id ? drag : n);
  const byId = useMemo(() => new Map(nodes.map(n => [n.id, n])), [nodes]);
  const selected = sel && sel.kind === 'node' ? byId.get(sel.id) : null;
  const refreshRuns = useCallback(() => { if (server) listRuns(file.id).then(setRuns, () => {}); }, [server, file.id]);
  useEffect(() => { if (visible) refreshRuns(); }, [visible, refreshRuns]);

  // Screen → canvas coordinates.
  const toCanvas = (cx, cy) => { const r = stage.current.getBoundingClientRect(); return { x: (cx - r.left - view.x) / view.k, y: (cy - r.top - view.y) / view.k }; };
  const center = () => { const r = stage.current.getBoundingClientRect(); return toCanvas(r.left + r.width / 2 - W / 2 * view.k, r.top + r.height / 2 - H / 2 * view.k); };

  /* ---- adding, connecting and removing ---- */
  // Where a new node goes: right of the node it follows, else where asked; moved down past any node there.
  const freeSpot = (at, from) => {
    const src = from && byId.get(from.id);
    const p = src ? { x: src.x + W + 130, y: src.y } : { x: at.x, y: at.y };
    const h = H + 60; // a node and the name under it
    while (nodes.some(n => Math.abs(n.x - p.x) < 150 && p.y < n.y + heightOf(n) + 60 && n.y < p.y + h)) p.y += 30;
    return p;
  };
  const addNode = (type, at, from) => {
    const n = newNode(type, flow, at.dropped ? at : freeSpot(at, from));
    change(f => {
      f.nodes.push(n);
      if (from && inputsOf(type).length) f.edges.push({ id: rid('e'), from: from.id, fromPort: from.port, to: n.id, toPort: inputsOf(type)[0] });
    });
    setSel({ kind: 'node', id: n.id }); setTab('settings'); setPalette(null);
  };
  const connect = (from, port, to, toPort) => {
    if (from === to || edges.some(e => e.from === from && e.fromPort === port && e.to === to && e.toPort === toPort)) return;
    change(f => { f.edges.push({ id: rid('e'), from, fromPort: port, to, toPort }); });
  };
  const remove = useCallback(s => {
    if (!s) return;
    change(f => {
      if (s.kind === 'edge') f.edges = f.edges.filter(e => e.id !== s.id);
      else { f.nodes = f.nodes.filter(n => n.id !== s.id); f.edges = f.edges.filter(e => e.from !== s.id && e.to !== s.id); }
    });
    setSel(null);
  }, [change]);
  useEffect(() => {
    if (!visible) return undefined;
    const key = e => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); save(); return; }
      if (e.key === 'Escape' && help) { setHelp(null); return; }
      if (typing(e)) return;
      if ((e.key === 'Delete' || e.key === 'Backspace') && sel) { e.preventDefault(); remove(sel); }
      if (e.key === 'Escape') { setPalette(null); setSel(null); }
    };
    document.addEventListener('keydown', key);
    return () => document.removeEventListener('keydown', key);
  }); // eslint-disable-line react-hooks/exhaustive-deps

  /* ---- pointer: panning, moving nodes, drawing connections ---- */
  useEffect(() => {
    if (!drag && !wire && !pan) return undefined;
    const move = e => {
      if (pan) setView(v => ({ ...v, x: pan.vx + e.clientX - pan.sx, y: pan.vy + e.clientY - pan.sy }));
      if (drag) { const p = toCanvas(e.clientX, e.clientY); setDrag(d => ({ ...d, x: Math.round(p.x - d.ox), y: Math.round(p.y - d.oy), moved: true })); }
      if (wire) { const p = toCanvas(e.clientX, e.clientY); setWire(w => ({ ...w, x2: p.x, y2: p.y })); }
    };
    const up = e => {
      if (drag && drag.moved) change(f => { const n = f.nodes.find(x => x.id === drag.id); if (n) { n.x = drag.x; n.y = drag.y; } });
      if (wire) {
        const target = document.elementFromPoint(e.clientX, e.clientY)?.closest('[data-in]');
        if (target) connect(wire.from, wire.port, target.dataset.node, target.dataset.in);
        else if (Math.hypot(wire.x2 - wire.x1, wire.y2 - wire.y1) > 30) setPalette({ x: wire.x2, y: wire.y2 - H / 2, dropped: true, from: { id: wire.from, port: wire.port } });
      }
      setDrag(null); setWire(null); setPan(null);
    };
    addEventListener('pointermove', move);
    addEventListener('pointerup', up);
    return () => { removeEventListener('pointermove', move); removeEventListener('pointerup', up); };
  }); // eslint-disable-line react-hooks/exhaustive-deps

  const onWheel = e => {
    if (e.ctrlKey || e.metaKey) {
      const r = stage.current.getBoundingClientRect(), mx = e.clientX - r.left, my = e.clientY - r.top;
      setView(v => { const k = Math.min(2, Math.max(.3, v.k * (e.deltaY < 0 ? 1.1 : 1 / 1.1))); return { k, x: mx - (mx - v.x) * (k / v.k), y: my - (my - v.y) * (k / v.k) }; });
    } else setView(v => ({ ...v, x: v.x - e.deltaX, y: v.y - e.deltaY }));
  };
  useEffect(() => {
    const el = stage.current;
    if (!el) return undefined;
    const stop = e => { if (e.ctrlKey || e.metaKey) e.preventDefault(); };
    el.addEventListener('wheel', stop, { passive: false });
    return () => el.removeEventListener('wheel', stop);
  }, []);
  const fit = () => {
    if (!nodes.length || !stage.current) return;
    const r = stage.current.getBoundingClientRect();
    const minX = Math.min(...nodes.map(n => n.x)), minY = Math.min(...nodes.map(n => n.y));
    const maxX = Math.max(...nodes.map(n => n.x + W)), maxY = Math.max(...nodes.map(n => n.y + H));
    const k = Math.min(1, Math.max(.3, Math.min((r.width - 80) / (maxX - minX || 1), (r.height - 80) / (maxY - minY || 1))));
    setView({ k, x: (r.width - (maxX - minX) * k) / 2 - minX * k, y: (r.height - (maxY - minY) * k) / 2 - minY * k });
  };

  /* ---- running ---- */
  const go = async startId => {
    if (!server) { toast('Workflows run on the Workline server. Sign in to run them.'); return; }
    const first = startId || nodes.find(n => n.type === 'trigger.manual')?.id || nodes.find(n => nodeDef(n.type).trigger)?.id;
    if (!first) { toast('Add a trigger first: Run by hand, Webhook or Schedule.'); return; }
    setBusy(true);
    try {
      const id = await startRun(file.id, clone(flow), first);
      let r = { id, status: 'running', nodes: {} };
      setRun(r);
      for (let i = 0; i < 400 && r.status === 'running'; i++) {
        await new Promise(res => setTimeout(res, i < 10 ? 300 : 900));
        r = await getRun(id);
        setRun(r);
      }
      if (r.status === 'success') {
        toast('The workflow ran');
        const b = runBtn.current?.getBoundingClientRect();
        if (b) confetti({ x: b.left + b.width / 2, y: b.top + b.height });
      }
      else if (r.status === 'error') { toast(r.error || 'The workflow failed'); if (r.failed) { setSel({ kind: 'node', id: r.failed }); setTab('output'); } }
      refreshRuns();
      dispatchEvent(new Event('workline:pull'));
    } catch (e) { toast(e.message || 'Couldn’t run the workflow.'); }
    setBusy(false);
  };
  const openRun = async id => { try { setRun(await getRun(id)); setSel(null); } catch (e) { toast('That run is gone.'); } };
  const status = id => run && run.nodes && run.nodes[id];
  const toggleActive = () => {
    change(f => { f.active = !f.active; });
    toast(flow.active ? 'Inactive: its webhooks and schedules are off' : 'Active: its webhooks and schedules start it now');
  };

  /* ---- saving, export, import, templates ---- */
  const save = () => { dispatchEvent(new Event('workline:save')); toast('Saved'); };
  const doExport = () => { download(file.title, exportFlow(file)); toast('Exported, without credentials'); };
  const doImport = async f => {
    if (!f) return;
    try {
      const got = importFlow(await f.text());
      if (!got.flow.nodes.length) { toast('That workflow has no nodes we know.'); return; }
      // An untouched new workflow (one Run by hand node) is replaced; otherwise the import goes beside it.
      const fresh = !nodes.length || (nodes.length === 1 && nodes[0].type === 'trigger.manual' && !edges.length);
      const placed = fresh ? got.flow : besides(nodes, got.flow);
      change(fl => { if (fresh) { fl.nodes = placed.nodes; fl.edges = placed.edges; } else { fl.nodes.push(...placed.nodes); fl.edges.push(...placed.edges); } });
      if (fresh && got.name && /^(Workflow|Untitled)/.test(file.title || '')) update(c => { c.title = got.name; });
      setSel(null);
      fitSoon.current = true;
      const creds = placed.nodes.filter(n => nodeDef(n.type).credential && !nodeDef(n.type).optionalCredential).length;
      toast(got.skipped.length ? `Imported. ${got.skipped.length} kind${got.skipped.length === 1 ? '' : 's'} of n8n node became placeholders: ${got.skipped.slice(0, 3).map(t => t.split('.').pop()).join(', ')}${got.skipped.length > 3 ? '…' : ''}`
        : creds ? `Imported. Pick credentials for ${creds} node${creds === 1 ? '' : 's'}.` : 'Imported');
    } catch (e) { toast(e.message || 'Couldn’t read that file.'); }
  };
  const fitSoon = useRef(false);
  useEffect(() => { if (fitSoon.current) { fitSoon.current = false; fit(); } }, [nodes]); // eslint-disable-line react-hooks/exhaustive-deps
  const saveTemplate = async () => {
    const name = await ask({ title: 'Save as a template', text: 'It appears in Templates on the home page, to start new workflows from. Credentials and secrets aren’t kept.', value: file.title || 'My workflow', ok: 'Save template' });
    if (!name || !String(name).trim()) return;
    const list = getData('flow-templates', []).filter(t => t.name !== String(name).trim());
    setData('flow-templates', [{ id: rid('t'), name: String(name).trim().slice(0, 60), note: `${nodes.length} node${nodes.length === 1 ? '' : 's'} · saved ${new Date().toLocaleDateString()}`, flow: templateOf(file), saved: Date.now() }, ...list].slice(0, 40));
    toast('Saved to Templates (on the home page)');
  };
  const doExportRun = () => { if (run) download(`${file.title || 'workflow'} results`, exportRun(file, run), 'results'); };

  const triggers = nodes.filter(n => nodeDef(n.type).trigger);
  return (
    <div className="fv" hidden={!visible}>
      <div className="fv-bar">
        <button className="fv-tool" aria-pressed={libOpen} title={libOpen ? 'Hide the nodes' : 'Show the nodes'} onClick={() => setLibOpen(!libOpen)}>
          <Ico d="M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM16.5 13v7M13 16.5h7" size={15} />Nodes
        </button>
        <span className="fv-sep" />
        <label className={'fv-active' + (flow.active ? ' on' : '')} title="While active and saved, its webhooks and schedules start it">
          <input type="checkbox" checked={!!flow.active} onChange={toggleActive} disabled={!server} /><i />{flow.active ? 'Active' : 'Inactive'}
        </label>
        <span className="fv-sep" />
        <button className={'fv-tool fv-save' + (saveState === 'Saved' ? ' done' : '')} onClick={save} title="Save now (Ctrl+S). Changes also save by themselves.">
          <Ico d={saveState === 'Saved' ? 'M5 12l5 5L20 7' : 'M5 4h11l3 3v13H5zM8 4v5h7V4M8 20v-6h8v6'} size={15} />{saveState === 'Saved' ? 'Saved' : saveState === 'Saving' || saveState === 'Syncing' ? 'Saving…' : 'Save'}
        </button>
        <button className="fv-tool" onClick={doExport} title="Download this workflow as a .json file (no credentials)">
          <Ico d="M12 4v11M7 10l5 5 5-5M5 20h14" size={15} />Export
        </button>
        <button className="fv-tool" onClick={() => importRef.current?.click()} title="Add a workflow from a .json file: Workline’s or n8n’s">
          <Ico d="M12 15V4M7 9l5-5 5 5M5 20h14" size={15} />Import
        </button>
        <button className="fv-tool" onClick={saveTemplate} title="Keep this workflow as a template in Tools">
          <Ico d="M6 3h12v18l-6-4-6 4z" size={15} />Template
        </button>
        <button className={'fv-tool' + (flow.app?.published ? ' fv-save done' : '')} onClick={() => setPublish(true)} title="Turn this workflow into an app with a simple form, in Home → Apps">
          <Ico d="M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM16.5 13v7M13 16.5h7" size={15} />{flow.app?.published ? 'Published' : 'Publish'}
        </button>
        <input ref={importRef} type="file" accept=".json,application/json" hidden onChange={e => { doImport(e.target.files[0]); e.target.value = ''; }} />
        <span className="grow" />
        {onGuide && <button className="fv-tool" onClick={() => onGuide('flow')} title="How workflows work, and every node explained">
          <Ico d="M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6V14M12 17h.01" size={15} />Guide
        </button>}
        <button className="fv-tool" disabled={!server} onClick={() => setCredDlg({ types: Object.keys(CRED_TYPES) })}>
          <Ico d="M14 10a4 4 0 1 0-1.2 2.8L20 20M17 17l2-2" size={15} />Credentials
        </button>
        <button ref={runBtn} className="btn primary fv-run" disabled={busy || !server} onClick={() => go()}>{busy ? <><i className="spin" />Running</> : <><Ico d={ICON.play} size={13} />Run workflow</>}</button>
        <button className="fv-tool icon" aria-label={sideOpen ? 'Hide the side panel' : 'Show the side panel'} title={sideOpen ? 'Hide the side panel' : 'Show the side panel'} aria-pressed={sideOpen} onClick={() => setSideOpen(!sideOpen)}>
          <Ico d="M4 5h16v14H4zM15 5v14" size={15} />
        </button>
      </div>
      {server === false && <p className="fv-note">Workflows run on the Workline server, so running, webhooks and schedules need you signed in to it. You can still build one here.</p>}

      <div className="fv-body">
        <Library open={libOpen} onToggle={() => setLibOpen(!libOpen)}
          onPick={type => addNode(type, center(), selected && outputsOf(selected.type).length && inputsOf(type).length ? { id: selected.id, port: outputsOf(selected.type)[0] } : null)} />
        <div className={'fv-stage' + (pan ? ' panning' : '')} ref={stage} onWheel={onWheel}
          onDragOver={e => { if (e.dataTransfer.types.includes('application/x-workline-node')) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; } }}
          onDrop={e => { const type = e.dataTransfer.getData('application/x-workline-node'); if (!type) return; e.preventDefault(); const c = toCanvas(e.clientX, e.clientY); addNode(type, { x: c.x - W / 2, y: c.y - H / 2, dropped: true }); }}
          onPointerDown={e => { if (e.target === stage.current || e.target.classList.contains('fv-bg')) { setSel(null); setPalette(null); setPan({ sx: e.clientX, sy: e.clientY, vx: view.x, vy: view.y }); } }}
          style={{ backgroundPosition: `${view.x}px ${view.y}px`, backgroundSize: `${22 * view.k}px ${22 * view.k}px` }}>
          <div className="fv-bg" />
          <div className="fv-layer" style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.k})` }}>
            <svg className="fv-edges" width="1" height="1">
              {edges.map(e => {
                const a = byId.get(e.from), b = byId.get(e.to);
                if (!a || !b) return null;
                const pa = pos(a), pb = pos(b);
                const outs = outsOf(a), ins = inputsOf(b.type);
                const d = curve(pa.x + W, pa.y + portY(outs, Math.max(0, outs.indexOf(e.fromPort)), heightOf(a)), pb.x, pb.y + portY(ins, Math.max(0, ins.indexOf(e.toPort)), heightOf(b)));
                const on = sel && sel.kind === 'edge' && sel.id === e.id;
                const lit = status(e.from)?.status === 'success' && (status(e.from).output?.[e.fromPort]?.length ?? 1) > 0 && status(e.to)?.status === 'success';
                return (
                  <g key={e.id} className={'fv-edge' + (on ? ' on' : '') + (lit ? ' lit' : '')} onPointerDown={ev => { ev.stopPropagation(); setSel({ kind: 'edge', id: e.id }); }}>
                    <path className="hit" d={d} /><path className="line" d={d} /><path className="flow" d={d} pathLength="100" style={{ animationDelay: `${-(e.id.charCodeAt(e.id.length - 1) % 10) * .22}s` }} />
                  </g>
                );
              })}
              {wire && <path className="fv-wire" d={curve(wire.x1, wire.y1, wire.x2, wire.y2)} />}
            </svg>
            {nodes.map(n => {
              const d = nodeDef(n.type), p = pos(n), st = status(n.id), ins = inputsOf(n.type), outs = outsOf(n), h = heightOf(n);
              if (n.type === 'core.note') return (
                <div key={n.id} className={'fv-node fv-note' + (sel?.id === n.id ? ' on' : '')} style={{ left: p.x, top: p.y, width: 220, minHeight: h }}
                  onPointerDown={e => { if (e.button !== 0) return; e.stopPropagation(); const c = toCanvas(e.clientX, e.clientY); setSel({ kind: 'node', id: n.id }); setSideOpen(true); setDrag({ id: n.id, x: n.x, y: n.y, ox: c.x - n.x, oy: c.y - n.y }); }}
                  onDoubleClick={() => { setSel({ kind: 'node', id: n.id }); setTab('settings'); }}>
                  <p>{n.params?.text || 'Note'}</p>
                </div>
              );
              const waiting = run && run.status === 'running' && !st;
              return (
                <div key={n.id} className={['fv-node', 't-' + d.tone, sel?.id === n.id && 'on', st && 's-' + st.status, waiting && 'waiting', d.trigger && 'trigger'].filter(Boolean).join(' ')}
                  style={{ left: p.x, top: p.y, width: W, height: h }}
                  onPointerDown={e => { if (e.button !== 0 || e.target.closest('.fv-port')) return; e.stopPropagation(); const c = toCanvas(e.clientX, e.clientY); setSel({ kind: 'node', id: n.id }); setSideOpen(true); setDrag({ id: n.id, x: n.x, y: n.y, ox: c.x - n.x, oy: c.y - n.y }); }}
                  onDoubleClick={() => { setSel({ kind: 'node', id: n.id }); setTab('settings'); }}>
                  <i className={badge(d)}><Mark d={d} size={28} /></i>
                  <span className="fv-name fv-label"><b>{n.name}</b>{d.credential && !d.optionalCredential && !n.credential
                    ? <small className="warn">Needs a credential</small>
                    : <small>{n.name !== d.label ? d.label : { Triggers: 'Trigger', 'Sales & payments': 'Sales', 'Storage & feeds': 'Data source' }[d.group] || d.group}{(n.type === 'trigger.webhook' || nodeDef(n.type).hook || nodeDef(n.type).poll) && flow.active ? (nodeDef(n.type).poll ? ' · watching' : ' · listening') : ''}</small>}</span>
                  {st && <em className="fv-st" title={st.error || ''}>{st.status === 'success' ? `✓ ${st.items}` : st.status === 'error' ? '!' : '–'}</em>}
                  {ins.map((pt, i) => <span key={pt} className="fv-port in" data-in={pt} data-node={n.id} style={{ top: portY(ins, i, h) }} title={ins.length > 1 ? `Input ${pt}` : 'Input'}>{ins.length > 1 && <small>{pt}</small>}</span>)}
                  {outs.map((pt, i) => (
                    <span key={pt} className={'fv-port out' + (pt === 'false' || pt === 'error' ? ' no' : pt === 'true' ? ' yes' : '')} style={{ top: portY(outs, i, h) }} title={outs.length > 1 ? pt : 'Drag to connect'}
                      onPointerDown={e => { e.stopPropagation(); const y = p.y + portY(outs, i, h); setWire({ from: n.id, port: pt, x1: p.x + W, y1: y, x2: p.x + W, y2: y }); }}>
                      {outs.length > 1 && <small>{d.portLabels?.[pt] ?? pt}</small>}
                    </span>
                  ))}
                </div>
              );
            })}
          </div>
          <div className="fv-zoom" onPointerDown={e => e.stopPropagation()}>
            <button aria-label="Zoom out" title="Zoom out" onClick={() => setView(v => ({ ...v, k: Math.max(.3, v.k / 1.2) }))}><Ico d="M5 12h14" size={14} /></button>
            <span>{Math.round(view.k * 100)}%</span>
            <button aria-label="Zoom in" title="Zoom in" onClick={() => setView(v => ({ ...v, k: Math.min(2, v.k * 1.2) }))}><Ico d="M12 5v14M5 12h14" size={14} /></button>
            <i />
            <button aria-label="Fit" title="Fit the workflow to the view" onClick={fit}><Ico d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" size={14} /></button>
          </div>
          {!nodes.length && <div className="fv-empty"><p>Start with a trigger.</p><button className="btn primary" onClick={() => setPalette(center())}>+ Add a trigger</button></div>}
          {!triggers.length && nodes.length > 0 && <p className="fv-hint">Add a trigger (Run by hand, Webhook or Schedule) to start the workflow from.</p>}
          {palette && <Palette at={palette} view={view} onPick={type => addNode(type, palette, palette.from)} onClose={() => setPalette(null)} />}
        </div>

        {sideOpen && <aside className="fv-panel">
          {selected ? (
            <NodePanel key={selected.id} node={selected} flow={flow} change={change} creds={creds} tab={tab} setTab={setTab} result={status(selected.id)} active={!!flow.active}
              onHelp={setHelp} onCred={(types, pick) => setCredDlg({ types, pick })} onRun={() => go(selected.id)} onDelete={() => remove({ kind: 'node', id: selected.id })} canRun={!!server && !busy} />
          ) : (
            <div className="fv-over">
              <h3>Workflow</h3>
              <p>Drag from a node’s right-hand dot to another node to connect them; let go on empty canvas to add a node there. Select a node to set it up.</p>
              <p>In fields, <code>{'{{ $json.name }}'}</code> reads the item coming in, and <code>{'{{ $node["Name"].json.x }}'}</code> an earlier node’s output.</p>
              <h4>Runs{run && run.status !== 'running' && <button className="fv-link" onClick={doExportRun} title="Download what each node gave in this run">Download results</button>}</h4>
              {!server ? <p className="muted">Sign in to the Workline server to run workflows.</p> : !runs.length ? <p className="muted">No runs yet. Press Run workflow.</p> : (
                <ul className="fv-runs">
                  {runs.map(r => (
                    <li key={r.id}><button className={run && run.id === r.id ? 'on' : ''} onClick={() => openRun(r.id)}>
                      <i className={'dot ' + r.status} /><span>{TRIGGER_NAME[r.trigger] || 'By hand'}</span><small>{ago(r.started)}{r.finished ? ` · ${((r.finished - r.started) / 1000).toFixed(1)} s` : ''}</small>
                    </button></li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </aside>}
      </div>
      {help && (
        <div className="fv-help-back" onPointerDown={e => { if (e.target === e.currentTarget) setHelp(null); }}>
          <div className="fv-help-pop" role="dialog" aria-modal="true" aria-label={`How ${nodeDef(help).label} works`}>
            <button className="fv-help-x" aria-label="Close" onClick={() => setHelp(null)}>×</button>
            <NodeCard type={help} d={nodeDef(help)} />
            {onGuide && <footer><button className="btn" onClick={() => { const t = help; setHelp(null); onGuide('flow:' + t); }}>Open the full workflows guide</button></footer>}
          </div>
        </div>
      )}
      {publish && <PublishDialog file={file} flow={flow} change={change} onClose={() => setPublish(false)} />}
      {credDlg && <Credentials types={credDlg.types} creds={creds} onChanged={loadCreds} onPick={credDlg.pick} onClose={() => setCredDlg(null)} ask={ask} toast={toast} />}
    </div>
  );
}

// The node library on the left: every node by group, searchable; click one to add it (after the selected
// node), or drag it onto the canvas.
function Library({ open, onToggle, onPick }) {
  const [q, setQ] = useState('');
  const [shut, setShut] = useState({});
  if (!open) return <aside className="fv-lib closed"><button className="btn icon-only" aria-label="Show the nodes" title="Nodes" onClick={onToggle}><Ico d="M9 6l6 6-6 6" size={16} /></button></aside>;
  const needle = q.trim().toLowerCase();
  const list = Object.entries(NODES).filter(([, d]) => !needle || `${d.label} ${d.note} ${d.group}`.toLowerCase().includes(needle));
  return (
    <aside className="fv-lib" aria-label="Nodes">
      <div className="fv-lib-head">
        <b>Nodes</b><small>{Object.keys(NODES).length}</small>
        <button className="btn icon-only" aria-label="Hide the nodes" title="Hide" onClick={onToggle}><Ico d="M15 6l-6 6 6 6" size={16} /></button>
      </div>
      <label className="fv-lib-search"><Ico d="M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM20 20l-4-4" size={14} /><input className="fv-lib-q" type="search" placeholder="Search nodes" value={q} onChange={e => setQ(e.target.value)} /></label>
      <div className="fv-lib-list">
        {GROUPS.map(g => {
          const items = list.filter(([, d]) => d.group === g);
          if (!items.length) return null;
          const closed = shut[g] && !needle;
          return (
            <section key={g}>
              <button className="fv-lib-g" aria-expanded={!closed} onClick={() => setShut(x => ({ ...x, [g]: !x[g] }))}>
                <Ico d={closed ? 'M9 6l6 6-6 6' : 'M6 9l6 6 6-6'} size={13} />{g}<small>{items.length}</small>
              </button>
              {!closed && items.map(([k, d]) => (
                <button key={k} className={'fv-lib-item t-' + d.tone} draggable title={d.note}
                  onDragStart={e => { e.dataTransfer.setData('application/x-workline-node', k); e.dataTransfer.effectAllowed = 'copy'; }}
                  onClick={() => onPick(k)}>
                  <i className={badge(d)}><Mark d={d} size={14} /></i><span>{d.label}</span>
                </button>
              ))}
            </section>
          );
        })}
        {!list.length && <p className="muted">No node matches.</p>}
      </div>
    </aside>
  );
}

// The list of node types, searchable, shown where the node will go.
function Palette({ at, view, onPick, onClose }) {
  const [q, setQ] = useState('');
  const ref = useRef(null);
  useEffect(() => { ref.current?.querySelector('input')?.focus(); }, []);
  const needle = q.trim().toLowerCase();
  const list = Object.entries(NODES).filter(([, d]) => !needle || `${d.label} ${d.note} ${d.group}`.toLowerCase().includes(needle));
  return (
    <div className="fv-pal" ref={ref} style={{ left: Math.max(8, at.x * view.k + view.x), top: Math.max(8, at.y * view.k + view.y) }} onPointerDown={e => e.stopPropagation()}>
      <input placeholder="Search nodes" value={q} onChange={e => setQ(e.target.value)} onKeyDown={e => { if (e.key === 'Escape') onClose(); if (e.key === 'Enter' && list[0]) onPick(list[0][0]); }} />
      <div className="fv-pal-list">
        {GROUPS.map(g => {
          const items = list.filter(([, d]) => d.group === g);
          return items.length ? (
            <div key={g}><h5>{g}</h5>
              {items.map(([k, d]) => <button key={k} className={'t-' + d.tone} onClick={() => onPick(k)}><i className={badge(d)}><Mark d={d} size={15} /></i><span><b>{d.label}</b><small>{d.note}</small></span></button>)}
            </div>
          ) : null;
        })}
        {!list.length && <p className="muted">No node matches.</p>}
      </div>
    </div>
  );
}

// Settings for one node, and what it produced in the last run.
function NodePanel({ node, flow, change, creds, tab, setTab, result, active, onCred, onRun, onDelete, canRun, onHelp }) {
  const d = nodeDef(node.type);
  const set = (k, v) => change(f => { const n = f.nodes.find(x => x.id === node.id); (n.params ||= {})[k] = v; });
  const p = node.params || {};
  const meets = w => !w || w.slice(1).includes(p[w[0]] ?? '');
  const shown = f => meets(f.when) && meets(f.also);
  const hookUrl = node.type === 'trigger.webhook' || d.hook ? `${location.origin}/api/hook/${p.path}` : '';
  return (
    <div className="fv-np">
      <div className={'fv-np-head t-' + d.tone}>
        <i className={badge(d)}><Mark d={d} size={20} /></i>
        <div>
          <input aria-label="Node name" value={node.name} onChange={e => { const v = e.target.value.slice(0, 60); change(f => { f.nodes.find(x => x.id === node.id).name = v; }); }} />
          <small>{node.name !== d.label ? `${d.label} · ` : ''}{d.note}</small>
        </div>
        <button className="fv-np-help" aria-label={`How ${d.label} works`} title="How this node works" onClick={() => onHelp(node.type)}>?</button>
      </div>
      <div className="fv-tabs" role="tablist">
        <button role="tab" aria-selected={tab === 'settings'} onClick={() => setTab('settings')}>Settings</button>
        <button role="tab" aria-selected={tab === 'output'} onClick={() => setTab('output')}>Output{result ? (result.status === 'error' ? ' !' : ` (${result.items})`) : ''}</button>
      </div>
      {tab === 'settings' ? (
        <div className="fv-fields">
          {d.credential && (
            <label className="fv-f"><span>Credential{d.optionalCredential ? ' (optional)' : ''}</span>
              <div className="fv-row">
                <select value={node.credential || ''} onChange={e => change(f => { f.nodes.find(x => x.id === node.id).credential = e.target.value || undefined; })}>
                  <option value="">{d.optionalCredential ? 'None' : 'Choose…'}</option>
                  {creds.filter(c => d.credential.includes(c.type)).map(c => <option key={c.id} value={c.id}>{c.name} ({CRED_TYPES[c.type]?.label})</option>)}
                </select>
                <button type="button" className="btn" onClick={() => onCred(d.credential, id => change(f => { f.nodes.find(x => x.id === node.id).credential = id; }))}>New</button>
              </div>
            </label>
          )}
          {node.type === 'trigger.webhook' && (
            <div className="fv-f"><span>Webhook URL</span>
              <div className="fv-row"><input readOnly value={hookUrl} onFocus={e => e.target.select()} /><button type="button" className="btn" onClick={() => navigator.clipboard?.writeText(hookUrl)}>Copy</button></div>
              <small className={active ? 'ok' : 'muted'}>{active ? 'Listening: calls to this URL start the workflow.' : 'Turn the workflow Active to listen. Run workflow tests it by hand.'}</small>
            </div>
          )}
          {d.hook && (
            <div className="fv-f"><span>{d.hook}</span>
              <div className="fv-row"><input readOnly value={hookUrl} onFocus={e => e.target.select()} /><button type="button" className="btn" onClick={() => { navigator.clipboard?.writeText(hookUrl); }}>Copy</button>
                {node.type === 'trigger.form' && <a className="btn" href={hookUrl} target="_blank" rel="noreferrer">Open</a>}</div>
              <small className={active ? 'ok' : 'muted'}>{active ? 'Listening. ' : 'Turn the workflow Active (and let it save) to listen. '}{d.hookHelp}</small>
            </div>
          )}
          {d.poll && <small className={active ? 'ok' : 'muted'}>{active ? `Watching: checks every ${Math.max(1, Number(p.every) || 5)} min while the server is awake.` : 'Turn the workflow Active to start watching. The first check only notes what’s there now.'}</small>}
          {d.help && <small className="muted fv-help">{d.help}</small>}
          {node.type === 'trigger.schedule' && <small className={active ? 'ok' : 'muted'}>{active ? 'Scheduled. Runs while the server is awake.' : 'Turn the workflow Active to run on schedule.'}</small>}
          {node.type === 'trigger.manual' && <small className="muted">Press Run workflow to start here.</small>}
          {d.fields.filter(shown).map(f => <Field key={f.k} f={f} value={p[f.k]} onChange={v => set(f.k, v)} />)}
          {!d.trigger && node.type !== 'core.note' && (
            <label className="fv-f"><span>If it fails</span>
              <select aria-label="If it fails" value={node.onError || 'stop'} onChange={e => { const v = e.target.value; change(f => {
                const x = f.nodes.find(y => y.id === node.id);
                if (v === 'stop') delete x.onError; else x.onError = v;
                if (v !== 'output') f.edges = f.edges.filter(ed => !(ed.from === node.id && ed.fromPort === 'error'));
              }); }}>
                <option value="stop">Stop the workflow</option>
                <option value="continue">Carry on, with the error on each item</option>
                <option value="output">Send the items out of an “error” output (try / catch)</option>
              </select>
            </label>
          )}
          <div className="fv-np-act">
            <button className="btn" disabled={!canRun} onClick={onRun} title="Run the workflow starting at this node">Run from here</button>
            <button className="btn danger-text" onClick={onDelete}>Delete node</button>
          </div>
        </div>
      ) : (
        <div className="fv-out">
          {!result ? <p className="muted">Run the workflow to see what this node gives.</p>
            : result.status === 'error' ? <p className="err">{result.error}</p>
            : result.status === 'skipped' ? <p className="muted">Skipped: no items reached it.</p>
            : (<>
              <p className="muted">{result.items} item{result.items === 1 ? '' : 's'} · {result.ms} ms{result.more ? ' · first 20 shown' : ''}</p>
              {Object.entries(result.output || {}).map(([port, list]) => (
                <div key={port}>{Object.keys(result.output).length > 1 && <h5>{port}</h5>}<pre>{JSON.stringify(list, null, 2)}</pre></div>
              ))}
            </>)}
        </div>
      )}
    </div>
  );
}

// One of the account's files: any, or those with a workflow ('flow') or sheets ('sheets').
function FilePick({ value, onChange, has }) {
  const [list, setList] = useState(null);
  useEffect(() => { listFiles().then(fs => setList(fs.filter(f => !f.archived && (!has || (Array.isArray(f[has]) ? f[has].length : f[has])))), () => setList([])); }, [has]);
  return (
    <select value={value || ''} onChange={e => onChange(e.target.value)}>
      <option value="">{list ? (list.length ? 'Choose a file…' : has === 'sheets' ? 'No file has a sheet yet' : 'No files yet') : 'Loading…'}</option>
      {(list || []).map(f => <option key={f.id} value={f.id}>{f.title || 'Untitled'}</option>)}
    </select>
  );
}

function Field({ f, value, onChange }) {
  if (f.kind === 'workflow') return <label className="fv-f"><span>{f.label}</span><FilePick value={value} onChange={onChange} has="flow" /><small className="muted">{f.help || 'It runs from its trigger with these items; what its last steps give comes back.'}</small></label>;
  if (f.kind === 'file') return <label className="fv-f"><span>{f.label}</span><FilePick value={value} onChange={onChange} has={f.has} /></label>;
  if (f.kind === 'dbconn') {
    const conns = loadConnections().filter(c => c.type !== 'sqlite');
    return (
      <label className="fv-f"><span>{f.label}</span>
        <select value={value || ''} onChange={e => onChange(e.target.value)}>
          <option value="">{conns.length ? 'Choose a connection…' : 'None saved: add one in the Database view'}</option>
          {conns.map(c => <option key={c.id} value={c.id}>{c.name || c.host || c.type}{c.remember ? '' : ' (password not remembered)'}</option>)}
        </select>
        <small className="muted">Workflows can use a connection whose password is remembered.</small>
      </label>
    );
  }
  const label = <span>{f.label}</span>;
  if (f.kind === 'select') return <label className="fv-f">{label}<select value={value ?? f.options[0][0]} onChange={e => onChange(e.target.value)}>{f.options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>;
  if (f.kind === 'bool') return <label className="fv-f fv-check"><input type="checkbox" checked={value !== false} onChange={e => onChange(e.target.checked)} />{f.label}</label>;
  if (f.kind === 'number') return <label className="fv-f">{label}<input type="number" value={value ?? ''} onChange={e => onChange(e.target.value === '' ? '' : Number(e.target.value))} /></label>;
  if (f.kind === 'pairs') {
    const rows = Array.isArray(value) ? value : [];
    const put = (i, k, v) => onChange(rows.map((r, j) => (j === i ? { ...r, [k]: v } : r)));
    return (
      <div className="fv-f">{label}
        {rows.map((r, i) => (
          <div key={i} className="fv-pair">
            <input placeholder="name" value={r.name || ''} onChange={e => put(i, 'name', e.target.value)} />
            <input placeholder="value" value={r.value ?? ''} onChange={e => put(i, 'value', e.target.value)} />
            <button type="button" className="btn" aria-label="Remove" onClick={() => onChange(rows.filter((_, j) => j !== i))}>×</button>
          </div>
        ))}
        <button type="button" className="btn fv-addrow" onClick={() => onChange([...rows, { name: '', value: '' }])}>+ Add</button>
        {f.hint && <small className="muted">{f.hint}</small>}
      </div>
    );
  }
  const area = f.kind === 'textarea' || f.kind === 'code';
  return (
    <label className="fv-f">{label}
      {area
        ? <textarea className={f.kind === 'code' ? 'code' : ''} rows={f.kind === 'code' ? 8 : 4} spellCheck={f.kind !== 'code'} value={typeof value === 'string' ? value : value == null ? '' : JSON.stringify(value, null, 2)} placeholder={f.hint || ''} onChange={e => onChange(e.target.value)} />
        : <input type={f.secret ? 'password' : 'text'} autoComplete="off" value={value ?? ''} placeholder={f.hint || ''} onChange={e => onChange(e.target.value)} />}
    </label>
  );
}

// The account's credentials: add, change (secrets left empty are kept) and remove.
// Publish as an app: how it looks in Home → Apps, what it asks for, where it starts and what it shows.
// Changes go straight into flow.app (saved with the workflow); the app always runs the saved version.
const TONES = ['blue', 'violet', 'green', 'amber', 'pink', 'sky', 'orange', 'slate'];
function PublishDialog({ file, flow, change, onClose }) {
  const app = flow.app || emptyApp(file, flow);
  const set = patch => change(f => { f.app = { ...(f.app || emptyApp(file, f)), ...patch }; });
  const setInput = (i, patch) => set({ inputs: app.inputs.map((x, j) => (j === i ? { ...x, ...patch, ...(patch.label !== undefined ? { key: keyOf(patch.label) } : {}) } : x)) });
  const triggers = flow.nodes.filter(n => nodeDef(n.type).trigger);
  const others = flow.nodes.filter(n => !nodeDef(n.type).trigger);
  const keys = app.inputs.map(x => x.key);
  const dup = keys.find((k, i) => keys.indexOf(k) !== i);
  return (
    <div className="modal" onPointerDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="mbox fv-pub" role="dialog" aria-modal="true" aria-label="Publish as an app">
        <h3>Publish as an app</h3>
        <p className="muted">Anyone using Workline here can run it from <b>Apps</b> on the home page: a simple form and a Run button, no nodes. It always runs the saved workflow, with your credentials.</p>
        <label className={'fv-active' + (app.published ? ' on' : '')}><input type="checkbox" checked={!!app.published} onChange={e => set({ published: e.target.checked })} /><i />{app.published ? 'Published: it’s in Apps' : 'Not published'}</label>

        <h4>How it looks</h4>
        <div className="fv-pub-look">
          <label className="fv-f"><span>Name</span><input value={app.name} onChange={e => set({ name: e.target.value.slice(0, 60) })} /></label>
          <label className="fv-f"><span>What it does (one line)</span><input value={app.description} placeholder="Checks the weather in any city" onChange={e => set({ description: e.target.value.slice(0, 160) })} /></label>
          <div className="fv-f"><span>Icon</span><div className="fv-pub-icons">{APP_ICONS.map(ic => <button key={ic} type="button" aria-pressed={app.icon === ic} onClick={() => set({ icon: ic })}>{ic}</button>)}</div></div>
          <div className="fv-f"><span>Colour</span><div className="fv-pub-tones">{TONES.map(t => <button key={t} type="button" className={'t-' + t} aria-label={t} aria-pressed={app.tone === t} onClick={() => set({ tone: t })} />)}</div></div>
        </div>

        <h4>What it asks for</h4>
        <p className="muted">Each answer reaches the workflow as <code>{'{{ $json.<name> }}'}</code> on the trigger it starts from.</p>
        {app.inputs.map((f, i) => (
          <div key={i} className="fv-pub-in">
            <input aria-label="Question" placeholder="Question, e.g. City" value={f.label} onChange={e => setInput(i, { label: e.target.value.slice(0, 60) })} />
            <select aria-label="Kind of answer" value={f.kind} onChange={e => setInput(i, { kind: e.target.value })}>{INPUT_KINDS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
            <label className="fv-check"><input type="checkbox" checked={!!f.required} onChange={e => setInput(i, { required: e.target.checked })} />Required</label>
            <button type="button" className="btn" aria-label="Remove" onClick={() => set({ inputs: app.inputs.filter((_, j) => j !== i) })}>×</button>
            {f.kind === 'choice' && <input className="wide" aria-label="Choices" placeholder="Choices, separated by commas" value={(f.options || []).join(', ')} onChange={e => setInput(i, { options: e.target.value.split(',').map(s => s.trim()).filter(Boolean) })} />}
            <small className="wide muted">In the workflow: <code>{`{{ $json.${f.key} }}`}</code></small>
          </div>
        ))}
        {dup && <p className="err">Two questions give the same name ({dup}). Make them different.</p>}
        <button type="button" className="btn fv-addrow" onClick={() => set({ inputs: [...app.inputs, { label: '', key: 'field', kind: 'text', required: false }] })}>+ Add a question</button>

        <h4>Running and the result</h4>
        <label className="fv-f"><span>Start from</span>
          <select value={app.startId} onChange={e => set({ startId: e.target.value })}>{triggers.map(n => <option key={n.id} value={n.id}>{n.name}</option>)}</select></label>
        <label className="fv-f"><span>Show what this gives</span>
          <select value={app.outputId} onChange={e => set({ outputId: e.target.value })}><option value="">The last steps</option>{others.map(n => <option key={n.id} value={n.id}>{n.name}</option>)}</select></label>
        <label className="fv-f"><span>Show it as</span>
          <select value={app.show} onChange={e => set({ show: e.target.value })}>{SHOW.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
        <div className="mact"><button className="btn dark" onClick={onClose}>Done</button></div>
      </div>
    </div>
  );
}

function Credentials({ types, creds, onChanged, onPick, onClose, ask, toast }) {
  const [form, setForm] = useState(onPick ? { type: types[0], name: '', data: {} } : null);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try {
      const c = form.id ? await updateCredential(form.id, form.name, form.data) : await createCredential(form.type, form.name || CRED_TYPES[form.type].label, form.data);
      await onChanged();
      toast(form.id ? 'Credential saved' : 'Credential added');
      if (onPick && !form.id) { onPick(c.id); onClose(); return; }
      setForm(null);
    } catch (e) { toast(e.message || 'Couldn’t save it.'); }
    setBusy(false);
  };
  const del = async c => {
    if (!(await ask({ title: `Delete “${c.name}”?`, text: 'Nodes using it stop working until you pick another.', input: false, ok: 'Delete' }))) return;
    await deleteCredential(c.id).catch(() => {});
    onChanged();
  };
  const t = form && CRED_TYPES[form.type];
  return (
    <div className="modal" onPointerDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="mbox fv-creds" role="dialog" aria-modal="true" aria-label="Credentials">
        <h3>{form ? (form.id ? `Edit “${form.name}”` : 'New credential') : 'Credentials'}</h3>
        {!form ? (<>
          <p className="muted">Keys and tokens for the apps your workflows use. They’re kept encrypted on the server and never shown again.</p>
          {creds.length ? <ul className="fv-credlist">{creds.map(c => (
            <li key={c.id}><b>{c.name}</b><small>{CRED_TYPES[c.type]?.label || c.type}</small>
              <button className="btn" onClick={() => setForm({ id: c.id, type: c.type, name: c.name, data: {} })}>Edit</button>
              <button className="btn" onClick={() => del(c)}>Delete</button></li>
          ))}</ul> : <p className="muted">None yet.</p>}
          <div className="mact"><button className="btn" onClick={onClose}>Close</button><button className="btn dark" onClick={() => setForm({ type: types[0], name: '', data: {} })}>Add credential</button></div>
        </>) : (<>
          {!form.id && <label className="fv-f"><span>App</span>
            <select value={form.type} onChange={e => setForm({ ...form, type: e.target.value, data: {} })}>{types.map(k => <option key={k} value={k}>{CRED_TYPES[k].label}</option>)}</select></label>}
          <p className="muted">{t.help}</p>
          <label className="fv-f"><span>Name</span><input value={form.name} placeholder={t.label} onChange={e => setForm({ ...form, name: e.target.value })} /></label>
          {t.fields.map(f => (
            <label key={f.k} className="fv-f"><span>{f.label}</span>
              {f.options
                ? <select value={form.data[f.k] || ''} onChange={e => setForm({ ...form, data: { ...form.data, [f.k]: e.target.value } })}><option value="">{form.id ? 'Keep' : 'Choose…'}</option>{f.options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
                : f.area
                  ? <textarea rows={6} className="code" spellCheck="false" value={form.data[f.k] || ''} placeholder={form.id ? 'Leave empty to keep' : '{ "type": "service_account", … }'} onChange={e => setForm({ ...form, data: { ...form.data, [f.k]: e.target.value } })} />
                  : <input type={f.secret ? 'password' : 'text'} autoComplete="off" value={form.data[f.k] || ''} placeholder={form.id && f.secret ? 'Leave empty to keep' : f.hint || ''} onChange={e => setForm({ ...form, data: { ...form.data, [f.k]: e.target.value } })} />}
            </label>
          ))}
          <div className="mact"><button className="btn" onClick={() => (onPick ? onClose() : setForm(null))}>Cancel</button><button className="btn dark" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save'}</button></div>
        </>)}
      </div>
    </div>
  );
}
