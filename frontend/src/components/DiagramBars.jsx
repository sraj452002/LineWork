import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { COLOR_NAMES, icons } from '../lib/shapes.js';
import { NOTATIONS } from '../lib/erdcode.js';
import { B, Palette } from './SelBar.jsx';
import { IC, Ico } from './Toolbar.jsx';
import { useUI } from './ui.jsx';

// A field that commits on Enter or blur, and puts the old value back on Escape.
function NameField({ value, label, onCommit, placeholder, className = 'sbar-name', allowEmpty }) {
  const [v, setV] = useState(value);
  useEffect(() => { setV(value); }, [value]);
  const commit = () => { const t = v.trim(); if ((t || allowEmpty) && t !== value) onCommit(t); else setV(value); };
  return (
    <input className={className} aria-label={label} value={v} spellCheck={false} placeholder={placeholder}
      onChange={e => setV(e.target.value)} onBlur={commit}
      onKeyDown={e => {
        if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur(); }
        else if (e.key === 'Escape') { e.stopPropagation(); setV(value); requestAnimationFrame(() => e.target.blur()); }
      }} />
  );
}

// A toolbar panel that closes on an outside click or Escape and stays on screen.
function usePanel(barRef, popRef) {
  const [pop, setPop] = useState(null);
  useEffect(() => {
    if (!pop) return;
    const down = e => { if (!barRef.current?.contains(e.target) && !e.target.closest('.menu')) setPop(null); };
    const key = e => { if (e.key === 'Escape' && !document.querySelector('.menu')) { e.stopPropagation(); setPop(null); } };
    document.addEventListener('pointerdown', down);
    addEventListener('keydown', key, true);
    return () => { document.removeEventListener('pointerdown', down); removeEventListener('keydown', key, true); };
  }, [pop]); // eslint-disable-line react-hooks/exhaustive-deps
  useLayoutEffect(() => {
    const el = popRef.current;
    if (!el) return;
    el.style.transform = '';
    const r = el.getBoundingClientRect();
    const dx = r.left < 8 ? 8 - r.left : r.right > innerWidth - 8 ? innerWidth - 8 - r.right : 0;
    if (dx) el.style.transform = `translateX(${dx}px)`;
  });
  const toggle = (k, e) => { const x = e.currentTarget.offsetLeft; setPop(p => (p && p.k === k ? null : { k, x })); };
  return [pop, setPop, toggle];
}

// Toolbar for a selected database table: its name, icon and colour.
export function TableBar({ table, hue, packs, onRename, onAttr, onCode, onDelete, onAddColumn }) {
  const { popup } = useUI();
  const barRef = useRef(null), popRef = useRef(null);
  const [pop, setPop, toggle] = usePanel(barRef, popRef);
  const [q, setQ] = useState('');
  const own = icons();

  const colorIdx = (() => {
    const c = (table.color || '').toLowerCase();
    if (/^#[0-9a-f]{6}$/i.test(c)) return c;
    const i = COLOR_NAMES.findIndex(n => n.toLowerCase() === (c === 'gray' ? 'grey' : c));
    return i >= 0 ? i : null;
  })();

  let panel = null;
  if (pop && pop.k === 'icon') {
    const needle = q.trim().toLowerCase();
    const builtIn = Object.keys(own).filter(k => !needle || k.includes(needle)).map(k => ({ k, body: own[k], vb: 20 }));
    const more = needle && packs ? packs.general.filter(x => x.label.includes(needle) || (x.words || '').includes(needle)).slice(0, 60)
      .map(x => ({ k: x.label, body: x.body, vb: 24 })) : [];
    const list = [...builtIn, ...more.filter(x => !own[x.k])];
    panel = (<>
      <input className="spop-search" placeholder={packs ? 'Search 1,800+ icons' : 'Search icons'} value={q} autoFocus
        aria-label="Search icons" onChange={e => setQ(e.target.value)} />
      <div className="spop-grid icons">
        <button className="spop-cell" title="Default" aria-label="Default icon" aria-pressed={!table.icon} onClick={() => onAttr('icon', null)}>
          <Ico d={own.table} vb={20} />
        </button>
        {list.slice(0, 120).map(x => (
          <button key={x.k} className="spop-cell" title={x.k} aria-label={x.k} aria-pressed={table.icon === x.k} onClick={() => onAttr('icon', x.k)}>
            <Ico d={x.body} vb={x.vb} />
          </button>
        ))}
      </div>
      {!list.length && <p className="spop-none">No icons match “{q.trim()}”.</p>}
    </>);
  } else if (pop && pop.k === 'color') {
    panel = (<>
      <Palette value={colorIdx} none noneOn={colorIdx == null}
        onPick={v => onAttr('color', v === 'none' ? null : typeof v === 'string' ? v : COLOR_NAMES[v].toLowerCase())} />
      <p className="spop-note">⧄ uses the next colour automatically.</p>
    </>);
  }

  return (
    <div className="sbar" ref={barRef} role="toolbar" aria-label={'Table ' + table.id}>
      {panel && <div className={'spop spop-' + pop.k} ref={popRef} style={{ left: pop.x }}>{panel}</div>}
      <NameField value={table.id} label="Table name" onCommit={onRename} />
      <B label="Icon" caret open={pop?.k === 'icon'} onClick={e => { setQ(''); toggle('icon', e); }}>
        <span className="sbar-ic" style={{ color: hue }} dangerouslySetInnerHTML={{ __html: `<svg viewBox="0 0 ${table.iconVb} ${table.iconVb}">${table.iconBody}</svg>` }} />
      </B>
      <B label="Colour" caret open={pop?.k === 'color'} onClick={e => toggle('color', e)}>
        <i className="sdot" style={{ background: hue }} />
      </B>
      <span className="sep" />
      <B label="More" icon="more" onClick={e => { setPop(null); popup(e.currentTarget, [
        { label: 'Add column', icon: IC.plus, act: onAddColumn },
        { label: 'Edit columns in code', icon: IC.codeblock, act: onCode },
        '-',
        { label: 'Delete table', danger: true, act: onDelete },
      ]); }} />
    </div>
  );
}

// Toolbar for one selected column: name, type and metadata (keys and anything else after the type).
export function FieldBar({ table, col, onChange, onAdd, onDelete, onMove, onTable }) {
  const { popup } = useUI();
  const set = patch => onChange({ ...col, ...patch });
  const meta = col.meta.split(/\s+/).filter(Boolean);
  const toggle = flag => {
    const has = meta.some(x => x.toLowerCase() === flag);
    set({ meta: (has ? meta.filter(x => x.toLowerCase() !== flag) : [flag, ...meta]).join(' ') });
  };
  return (
    <div className="sbar field" role="toolbar" aria-label={`Column ${table}.${col.name}`}>
      <NameField value={col.name} label="Column name" onCommit={v => set({ name: v })} />
      <NameField value={col.type} label="Column type" placeholder="type" className="sbar-name type" allowEmpty onCommit={v => set({ type: v })} />
      <NameField value={col.meta} label="Column metadata" placeholder="metadata" className="sbar-name meta" allowEmpty onCommit={v => set({ meta: v })} />
      <span className="sep" />
      {['pk', 'fk'].map(k => (
        <button key={k} className="sbtn ico text key" aria-pressed={meta.some(x => x.toLowerCase() === k)} title={k === 'pk' ? 'Primary key' : 'Foreign key'} onClick={() => toggle(k)}>{k}</button>
      ))}
      <B label="More" icon="more" onClick={e => popup(e.currentTarget, [
        { label: 'Add column below', icon: IC.plus, act: onAdd },
        { label: 'Move up', kbd: 'Alt ↑', act: () => onMove(-1) },
        { label: 'Move down', kbd: 'Alt ↓', act: () => onMove(1) },
        { label: 'Select the whole table', kbd: 'Esc', act: onTable },
        '-',
        { label: 'Delete column', kbd: 'Del', danger: true, act: onDelete },
      ])} />
    </div>
  );
}

// Toolbar for the whole diagram: reset layout, name, and (for schemas) notation.
export function DiagramBar({ name, type, notation, directional, dir, mono, onReset, onRename, onNotation, onDir, onMono, onCode, onAI, more }) {
  const { popup } = useUI();
  return (
    <div className="sbar diag" role="toolbar" aria-label="Diagram">
      <button className="sbar-reset" onClick={onReset}>Reset Layout</button>
      <span className="sep" />
      <NameField value={name} label="Diagram name" onCommit={onRename} />
      {type === 'erd' && (
        <button className="sbtn ico text" aria-haspopup="menu" title="Relationship notation" onClick={e => popup(e.currentTarget, NOTATIONS.map(([v, n]) => ({
          label: n, on: notation === v, act: () => onNotation(v),
        })))}>{notation === 'chen' ? 'Chen' : "Crow's foot"}<Ico d={IC.caret} className="caret" /></button>
      )}
      {directional && <button className="sbtn ico text" onClick={onDir} title="Layout direction">{dir === 'TB' ? 'Vertical' : 'Horizontal'}</button>}
      <B label={mono ? 'Colour: mono' : 'Colour: palette'} onClick={onMono}>
        <i className="sdot" style={{ background: mono ? 'var(--ink2)' : 'conic-gradient(#86A9F2,#5CC8A8,#EDA266,#EE869C,#86A9F2)' }} />
      </B>
      <span className="sep" />
      <B label="Code Editor" icon="codeblock" onClick={onCode} />
      <B label="AI Chat" icon="ai" onClick={onAI} />
      {more && more.length > 0 && <B label="More" icon="more" onClick={e => popup(e.currentTarget, more)} />}
    </div>
  );
}
