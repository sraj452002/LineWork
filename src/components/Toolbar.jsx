import { useEffect, useRef, useState } from 'react';

// 24px line icons for the toolbar and insert panel.
export const IC = {
  plus: '<path d="M12 5v14M5 12h14"/>',
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
  ai: '<path d="M10 3.5l1.6 4.9 4.9 1.6-4.9 1.6L10 16.5l-1.6-4.9L3.5 10l4.9-1.6z"/><path d="M18 3v4M16 5h4M17.5 15.5v4M15.5 17.5h4"/>',
  select: '<path d="M6 3.5 18.5 11l-5.6 1.4L10.5 18z"/>',
  hand: '<path d="M8 12.5V5.5a1.5 1.5 0 0 1 3 0V11m0-6.5a1.5 1.5 0 0 1 3 0V11m0-5a1.5 1.5 0 0 1 3 0V14c0 4-2.5 6.5-6 6.5-2.4 0-4-1-5.5-3.2L3.8 13a1.5 1.5 0 0 1 2.5-1.6L8 13.5"/>',
  rect: '<rect x="5" y="5" width="14" height="14" rx="1"/>',
  ellipse: '<circle cx="12" cy="12" r="7.5"/>',
  arrow: '<path d="M6 18 18 6M9 6h9v9"/>',
  line: '<path d="M6 18 18 6"/>',
  pen: '<path d="M15.5 4.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4z"/>',
  text: '<path d="M3.5 10V8h7v2M7 8v10M12.5 7V5h8v2M16.5 5v13"/>',
  icon: '<path d="m9 3 1.6 3.5 3.9.5-2.8 2.7.7 3.9L9 11.8l-3.4 1.8.7-3.9L3.5 7l3.9-.5z"/><circle cx="16.5" cy="16.5" r="3"/><path d="m18.7 18.7 2.3 2.3"/>',
  frame: '<rect x="5" y="5" width="14" height="14" rx="1" stroke-dasharray="3 3"/>',
  comment: '<path d="M4 5h16v11h-9l-4 3.5V16H4z"/>',
  diagram: '<rect x="3" y="3.5" width="7" height="5" rx="1"/><rect x="14" y="3.5" width="7" height="5" rx="1"/><rect x="3" y="15.5" width="7" height="5" rx="1"/><rect x="14" y="15.5" width="7" height="5" rx="1"/><path d="M6.5 8.5v7M17.5 8.5v7M10 6h4"/>',
  catalog: '<rect x="4" y="4" width="6.5" height="6.5" rx="1"/><rect x="13.5" y="4" width="6.5" height="6.5" rx="1"/><rect x="4" y="13.5" width="6.5" height="6.5" rx="1"/><rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1"/>',
  shapes: '<circle cx="7.5" cy="7.5" r="3.5"/><path d="M16.5 3.5l4 7h-8z"/><path d="M8 13l4 4-4 4-4-4z"/>',
  smile: '<circle cx="12" cy="12" r="8.5"/><path d="M8.5 14c.8 1.3 2 2 3.5 2s2.7-.7 3.5-2M9 9.5h.01M15 9.5h.01"/>',
  device: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 8.5h18M6 6.3h.01M8.5 6.3h.01"/>',
  codeblock: '<rect x="3.5" y="3.5" width="17" height="17" rx="2"/><path d="m10 9-3 3 3 3M14 9l3 3-3 3"/>',
  image: '<rect x="3.5" y="4" width="17" height="16" rx="2"/><circle cx="15" cy="9" r="2"/><path d="m3.5 17 5-5.5 4.5 4.5 2.5-2 5 4"/>',
  search: '<circle cx="10.5" cy="10.5" r="6"/><path d="m15 15 5 5"/>',
  back: '<path d="m14 6-6 6 6 6"/>',
  chev: '<path d="m10 6 6 6-6 6"/>',
};
export const Ico = ({ d, vb = 24, className }) => (
  <svg viewBox={`0 0 ${vb} ${vb}`} className={className} aria-hidden="true" dangerouslySetInnerHTML={{ __html: d }} />
);

const TOOLS = [
  { t: 'select', k: 'v', label: 'Select' },
  { t: 'hand', k: 'h', label: 'Hand (drag empty canvas also pans)' },
  { t: 'rect', k: 'r', label: 'Rectangle' },
  { t: 'ellipse', k: 'o', label: 'Ellipse' },
  { t: 'arrow', k: 'a', label: 'Arrow' },
  { t: 'line', k: 'l', label: 'Line' },
  { t: 'pen', k: 'd', label: 'Draw' },
  { t: 'text', k: 't', label: 'Text' },
  { t: 'icon', k: 'i', label: 'Icon' },
];
const TOOLS2 = [
  { t: 'frame', k: 'f', label: 'Frame' },
  { t: 'comment', k: 'c', label: 'Comment' },
];
export const TOOL_KEYS = Object.fromEntries([...TOOLS, ...TOOLS2].map(x => [x.k, x.t]));

function TBtn({ icon, k, label, pressed, onClick, ...rest }) {
  return (
    <button className="tbtn" aria-label={`${label} (${k.toUpperCase()})`} title={`${label}  ${k.toUpperCase()}`}
      aria-pressed={pressed} onClick={onClick} {...rest}>
      <Ico d={IC[icon]} /><kbd>{k.toUpperCase()}</kbd>
    </button>
  );
}

export function Toolbar({ tool, onTool, panelOpen, onInsert, onAI }) {
  const btn = x => <TBtn key={x.t} icon={x.t} k={x.k} label={x.label} pressed={tool === x.t} onClick={() => onTool(x.t)} />;
  return (
    <div className="tbar" role="toolbar" aria-label="Drawing tools" aria-orientation="vertical">
      <div className="tgroup">
        <TBtn icon={panelOpen ? 'close' : 'plus'} k="/" label="Insert" pressed={panelOpen} onClick={onInsert} data-insert-toggle="" />
      </div>
      <div className="tgroup"><TBtn icon="ai" k="Ctrl J" label="AI" onClick={onAI} /></div>
      <div className="tgroup">{TOOLS.map(btn)}</div>
      <div className="tgroup">{TOOLS2.map(btn)}</div>
    </div>
  );
}

const flat = tree => tree.flatMap(x => (x.children ? [x, ...x.children] : [x]));

// tree: [{key, label, note, icon | svg | glyph, act?, children?, tile?, grid?}]
export function InsertPanel({ tree, start, onClose }) {
  const [cat, setCat] = useState(start || null);
  const [q, setQ] = useState('');
  const [on, setOn] = useState(0);
  const ref = useRef(null), inputRef = useRef(null);

  useEffect(() => { setCat(start || null); setQ(''); setOn(0); }, [start]);
  useEffect(() => { inputRef.current?.focus(); }, [cat]);
  useEffect(() => {
    const down = e => { if (ref.current && !ref.current.contains(e.target) && !e.target.closest('[data-insert-toggle]')) onClose(); };
    document.addEventListener('pointerdown', down);
    return () => document.removeEventListener('pointerdown', down);
  }, [onClose]);

  const group = cat && tree.find(x => x.key === cat);
  const needle = q.trim().toLowerCase();
  const list = needle
    ? flat(tree).filter(x => !x.children && (x.label + ' ' + (x.note || '')).toLowerCase().includes(needle))
    : group ? group.children : tree;
  const cur = list[Math.min(on, list.length - 1)];

  const pick = it => {
    if (!it) return;
    if (it.children) { setCat(it.key); setQ(''); setOn(0); return; }
    onClose();
    it.act();
  };
  const back = () => { setCat(null); setQ(''); setOn(0); };
  const key = e => {
    const cols = !needle && group && group.grid ? 4 : 1;
    if (e.key === 'ArrowDown') { e.preventDefault(); setOn(i => Math.min(list.length - 1, i + cols)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setOn(i => Math.max(0, i - cols)); }
    else if (cols > 1 && e.key === 'ArrowRight' && !q) { e.preventDefault(); setOn(i => Math.min(list.length - 1, i + 1)); }
    else if (cols > 1 && e.key === 'ArrowLeft' && !q) { e.preventDefault(); setOn(i => Math.max(0, i - 1)); }
    else if (e.key === 'Enter') { e.preventDefault(); pick(cur); }
    else if (e.key === 'Escape') { e.preventDefault(); group ? back() : onClose(); }
    else if (e.key === 'Backspace' && !q && group) { e.preventDefault(); back(); }
  };

  const art = it => it.glyph ? <Ico d={it.glyph} vb={20} className="glyph" /> : it.svg ? <Ico d={it.svg} /> : <Ico d={IC[it.icon || 'plus']} />;
  const row = (it, i) => (
    <button key={it.key} className="ins-item" data-on={i === on} onMouseEnter={() => setOn(i)} onClick={() => pick(it)}>
      {art(it)}
      <span><b>{it.label}</b>{it.note && <small>{it.note}</small>}</span>
      {it.children && <Ico d={IC.chev} className="chev" />}
    </button>
  );
  const tile = (it, i) => (
    <button key={it.key} className="ins-tile" data-on={i === on} onMouseEnter={() => setOn(i)} onClick={() => pick(it)} title={it.note || it.label}>
      {art(it)}<span>{it.label}</span>
    </button>
  );

  let body;
  if (needle) body = list.length ? list.map(row) : <p className="ins-none">Nothing matches “{q.trim()}”.</p>;
  else if (group && group.grid) body = <div className="ins-grid">{list.map(tile)}</div>;
  else if (group) body = list.map(row);
  else {
    const n = tree.filter(x => !x.tile).length;
    body = (<>
      <h4>All categories</h4>
      {tree.slice(0, n).map(row)}
      <div className="ins-tiles">{tree.slice(n).map((it, j) => tile(it, n + j))}</div>
    </>);
  }

  return (
    <div className="ins" ref={ref} role="dialog" aria-label="Insert">
      <div className="ins-q">
        {group && !needle
          ? <button className="ins-back" onClick={back} aria-label="Back to all categories"><Ico d={IC.back} /></button>
          : <Ico d={IC.search} />}
        <input ref={inputRef} value={q} placeholder={group ? `Search ${group.label.toLowerCase()}` : 'Insert item'} aria-label="Search items"
          onChange={e => { setQ(e.target.value); setOn(0); }} onKeyDown={key} />
      </div>
      <div className="ins-body">
        {group && !needle && <h4>{group.label}</h4>}
        {body}
      </div>
      <div className="ins-foot"><span>{cur ? cur.label : ''}</span><span><b>↑↓</b> to navigate · <b>enter</b> to insert</span></div>
    </div>
  );
}
