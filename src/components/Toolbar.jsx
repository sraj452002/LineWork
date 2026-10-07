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
  dFlow: '<rect x="9" y="3" width="6" height="4.5" rx="1"/><rect x="3" y="16.5" width="6" height="4.5" rx="1"/><rect x="15" y="16.5" width="6" height="4.5" rx="1"/><path d="M12 7.5v4.5M6 16.5V12h12v4.5"/>',
  dCloud: '<rect x="8.5" y="3.5" width="9" height="17" rx="1.5"/><path d="M5.5 7v10M3.5 9v6"/><circle cx="13" cy="8" r=".6"/><circle cx="13" cy="12" r=".6"/><circle cx="13" cy="16" r=".6"/>',
  dBpmn: '<rect x="3.5" y="3.5" width="17" height="17" rx="1.5"/><path d="M8 3.5v17M8 12h12.5"/><rect x="11" y="6" width="6" height="3.5" rx=".8"/><rect x="11" y="14.5" width="6" height="3.5" rx=".8"/>',
  dErd: '<rect x="3" y="8.5" width="7" height="7" rx="1"/><rect x="15" y="3" width="6" height="6" rx="1"/><rect x="15" y="15" width="6" height="6" rx="1"/><path d="M10 12h2.5M12.5 6v12M12.5 6H15M12.5 18H15"/>',
  dSeq: '<rect x="3" y="3" width="6" height="4" rx="1"/><rect x="15" y="3" width="6" height="4" rx="1"/><rect x="3" y="17" width="6" height="4" rx="1"/><rect x="15" y="17" width="6" height="4" rx="1"/><path d="M6 7v10M18 7v10M6 12h12M15.5 10l2.5 2-2.5 2"/>',
  dFree: '<rect x="3" y="3.5" width="11" height="9" rx="2"/><ellipse cx="15.5" cy="13" rx="5.5" ry="2"/><path d="M10 13v6c0 1.1 2.5 2 5.5 2s5.5-.9 5.5-2v-6"/>',
  bolt: '<path d="M13 2.5 4.5 13.5H11l-1 8 8.5-11H12z"/>',
  cloud: '<path d="M7 18.5a4.5 4.5 0 0 1-.6-9 6 6 0 0 1 11.4 1.6A3.8 3.8 0 0 1 17.5 18.5z"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  upload: '<path d="M12 15V4M7.5 8.5 12 4l4.5 4.5M4.5 15v4.5h15V15"/>',
  doc: '<path d="M7 3h7l5 5v13H7zM14 3v5h5M10 13h6M10 17h6"/>',
  send: '<path d="M12 19V5M6 11l6-6 6 6"/>',
  undo: '<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>',
  redo: '<path d="m15 14 5-5-5-5"/><path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13"/>',
  copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5.5A1.5 1.5 0 0 0 14.5 4h-9A1.5 1.5 0 0 0 4 5.5v9A1.5 1.5 0 0 0 5.5 16H8"/>',
  download: '<path d="M12 4v11M7.5 10.5 12 15l4.5-4.5M4.5 19.5h15"/>',
  figurePlus: '<path d="M4 8V5.5A1.5 1.5 0 0 1 5.5 4H8M12 4h1M4 12v1M4 17v1.5A1.5 1.5 0 0 0 5.5 20H8M12 20h1M17 4h1.5A1.5 1.5 0 0 1 20 5.5V8M20 12v1"/><path d="M18 16v6M15 19h6"/>',
  layers: '<path d="M12 3 3 8l9 5 9-5zM3 12.5l9 5 9-5M3 17l9 5 9-5"/>',
  braces: '<path d="M8.5 4C6.5 4 6 5 6 7v2c0 1.6-1 2.6-2.2 3 1.2.4 2.2 1.4 2.2 3v2c0 2 .5 3 2.5 3M15.5 4c2 0 2.5 1 2.5 3v2c0 1.6 1 2.6 2.2 3-1.2.4-2.2 1.4-2.2 3v2c0 2-.5 3-2.5 3"/>',
  caret: '<path d="m8 10 4 4 4-4"/>',
  rCurve: '<path d="M5 19c0-8 14-6 14-14"/>',
  rElbow: '<path d="M6 4v6a3 3 0 0 0 3 3h6a3 3 0 0 1 3 3v4"/>',
  rStraight: '<path d="M5 19 19 5"/>',
  width: '<path d="M4 6h16" stroke-width="1.2"/><path d="M4 11.5h16" stroke-width="2.2"/><path d="M4 18h16" stroke-width="3.6"/>',
  wThin: '<path d="M4 12h16" stroke-width="1.2"/>',
  wMed: '<path d="M4 12h16" stroke-width="2.2"/>',
  wThick: '<path d="M4 12h16" stroke-width="3.8"/>',
  headL: '<path d="M20 12H5M10 7l-5 5 5 5"/>',
  headR: '<path d="M4 12h15M14 7l5 5-5 5"/>',
  dash: '<path d="M3 12h3.5M10.25 12h3.5M17.5 12H21"/>',
  more: '<circle cx="5.5" cy="12" r="1.4" fill="currentColor"/><circle cx="12" cy="12" r="1.4" fill="currentColor"/><circle cx="18.5" cy="12" r="1.4" fill="currentColor"/>',
  textSm: '<path d="M4 18 8.5 6 13 18M5.7 14h5.6M16 15h5"/>',
  textLg: '<path d="M3 18 8 5l5 13M4.8 14h6.4M15 15h6M18 12v6"/>',
  bold: '<path d="M7 5h6a3.5 3.5 0 0 1 0 7H7zM7 12h7a3.5 3.5 0 0 1 0 7H7z"/>',
  search: '<circle cx="10.5" cy="10.5" r="6"/><path d="m15 15 5 5"/>',
  back: '<path d="m14 6-6 6 6 6"/>',
  chev: '<path d="m10 6 6 6-6 6"/>',
};
export const Ico = ({ d, vb = 24, className, style }) => (
  <svg viewBox={`0 0 ${vb} ${vb}`} className={className} style={style} aria-hidden="true" dangerouslySetInnerHTML={{ __html: d }} />
);

const TOOLS = [
  { t: 'select', k: 'v', label: 'Select' },
  { t: 'hand', k: 'h', label: 'Hand' },
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

function TBtn({ icon, k, label, pressed, onClick, onTip, ...rest }) {
  const show = e => { const r = e.currentTarget.getBoundingClientRect(); onTip({ label, k: k.toUpperCase(), x: r.right + 10, y: r.top + r.height / 2 }); };
  return (
    <button className="tbtn" aria-label={`${label} (${k.toUpperCase()})`}
      aria-pressed={pressed} onClick={e => { onTip(null); onClick(e); }}
      onMouseEnter={show} onFocus={show} onMouseLeave={() => onTip(null)} onBlur={() => onTip(null)} {...rest}>
      <Ico d={IC[icon]} /><kbd>{k.toUpperCase()}</kbd>
    </button>
  );
}

export function Toolbar({ tool, onTool, panelOpen, onInsert, onAI }) {
  // The toolbar scrolls on short screens, which would clip a CSS tooltip, so it's drawn outside it.
  const [tip, setTip] = useState(null);
  const btn = x => <TBtn key={x.t} icon={x.t} k={x.k} label={x.label} pressed={tool === x.t} onClick={() => onTool(x.t)} onTip={setTip} />;
  return (<>
    <div className="tbar" role="toolbar" aria-label="Drawing tools" aria-orientation="vertical">
      <div className="tgroup">
        <TBtn icon={panelOpen ? 'close' : 'plus'} k="/" label="Insert" pressed={panelOpen} onClick={onInsert} onTip={setTip} data-insert-toggle="" />
      </div>
      <div className="tgroup"><TBtn icon="ai" k="Ctrl J" label="Ask AI" onClick={onAI} onTip={setTip} /></div>
      <div className="tgroup">{TOOLS.map(btn)}</div>
      <div className="tgroup">{TOOLS2.map(btn)}</div>
    </div>
    {tip && <div className="ttip" role="presentation" style={{ left: tip.x, top: tip.y }}>{tip.label}<kbd>{tip.k}</kbd></div>}
  </>);
}

// Every item that can be inserted, however deeply it's nested.
const leaves = list => list.flatMap(x => (x.children ? leaves(x.children) : [x]));
const norm = s => s.toLowerCase().replace(/[-_.]+/g, ' ');
const PAGE = 150;

// tree: [{key, label, note, words, icon | svg | glyph (+vb, filled, color), act?, children?, tile?, grid?, empty?}]
// A group's children that have children of their own show as rows; the rest show as rows,
// or as a grid of tiles when the group has `grid` (or, at the top level, the item has `tile`).
export function InsertPanel({ tree, start, onClose }) {
  const [path, setPath] = useState(start ? [start] : []);
  const [q, setQ] = useState('');
  const [on, setOn] = useState(0);
  const [limit, setLimit] = useState(PAGE);
  const ref = useRef(null), inputRef = useRef(null), bodyRef = useRef(null), moreRef = useRef(null);

  useEffect(() => { setPath(start ? [start] : []); setQ(''); setOn(0); }, [start]);
  useEffect(() => { inputRef.current?.focus(); bodyRef.current?.scrollTo(0, 0); setLimit(PAGE); }, [path]);
  useEffect(() => {
    const down = e => { if (ref.current && !ref.current.contains(e.target) && !e.target.closest('[data-insert-toggle]')) onClose(); };
    document.addEventListener('pointerdown', down);
    return () => document.removeEventListener('pointerdown', down);
  }, [onClose]);

  // Walk the path; stop early if a group has gone away.
  const trail = [];
  let level = tree;
  for (const k of path) {
    const g = level.find(x => x.key === k);
    if (!g || !g.children) break;
    trail.push(g);
    level = g.children;
  }
  const group = trail[trail.length - 1] || null;
  const needle = norm(q.trim());

  let rows, tiles, gridCols;
  if (needle) {
    const words = needle.split(/\s+/);
    const hits = leaves(level).filter(x => { const t = norm(x.label + ' ' + (x.note || '') + ' ' + (x.words || '')); return words.every(w => t.includes(w)); });
    rows = hits.filter(x => !x.glyph);
    tiles = hits.filter(x => x.glyph);
    gridCols = 5;
  } else if (group) {
    rows = level.filter(x => x.children || !group.grid);
    tiles = group.grid ? level.filter(x => !x.children) : [];
    gridCols = 5;
  } else {
    rows = level.filter(x => !x.tile);
    tiles = level.filter(x => x.tile);
    gridCols = 3;
  }
  const shown = tiles.slice(0, limit);
  const list = [...rows, ...shown];
  const cur = list[Math.min(on, list.length - 1)];

  // Load more tiles as the end of the grid scrolls into view.
  useEffect(() => {
    const el = moreRef.current;
    if (!el) return;
    const io = new IntersectionObserver(es => { if (es.some(e => e.isIntersecting)) setLimit(l => l + PAGE); }, { root: bodyRef.current, rootMargin: '200px' });
    io.observe(el);
    return () => io.disconnect();
  }, [shown.length < tiles.length, path, needle]);
  useEffect(() => { bodyRef.current?.querySelector('[data-on="true"]')?.scrollIntoView({ block: 'nearest' }); }, [on]);

  const go = p => { setPath(p); setQ(''); setOn(0); };
  const pick = it => {
    if (!it) return;
    if (it.children) { go([...trail.map(x => x.key), it.key]); return; }
    onClose();
    it.act();
  };
  const back = () => go(trail.slice(0, -1).map(x => x.key));
  const move = i => {
    const n = Math.max(0, Math.min(list.length - 1, i));
    if (n >= list.length - gridCols && shown.length < tiles.length) setLimit(l => l + PAGE);
    setOn(n);
  };
  const key = e => {
    const r = rows.length, inGrid = on >= r;
    if (e.key === 'ArrowDown') { e.preventDefault(); move(inGrid ? on + gridCols : on + 1); }
    else if (e.key === 'ArrowUp') {
      e.preventDefault();
      // In the grid, go up a row; from the grid's top row, step back into the list above it.
      if (!inGrid) move(on - 1);
      else if (on - gridCols >= r) move(on - gridCols);
      else if (r) move(r - 1);
    }
    else if (inGrid && e.key === 'ArrowRight' && !q) { e.preventDefault(); move(on + 1); }
    else if (inGrid && e.key === 'ArrowLeft' && !q) { e.preventDefault(); move(Math.max(r, on - 1)); }
    else if (e.key === 'Enter') { e.preventDefault(); pick(cur); }
    else if (e.key === 'Escape') { e.preventDefault(); q ? setQ('') : group ? back() : onClose(); }
    else if (e.key === 'Backspace' && !q && group) { e.preventDefault(); back(); }
  };

  const art = it => it.glyph
    ? <Ico d={it.glyph} vb={it.vb || 20} className={'glyph' + (it.filled ? ' filled' : '')} style={it.color ? { color: it.color } : undefined} />
    : it.svg ? <Ico d={it.svg} /> : <Ico d={IC[it.icon || 'plus']} />;
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

  return (
    <div className="ins" ref={ref} role="dialog" aria-label="Insert">
      <div className="ins-q">
        {group && !needle
          ? <button className="ins-back" onClick={back} aria-label="Back"><Ico d={IC.back} /></button>
          : <Ico d={IC.search} />}
        <input ref={inputRef} value={q} placeholder={group ? `Search ${group.label.toLowerCase()}` : 'Insert item'} aria-label="Search items"
          onChange={e => { setQ(e.target.value); setOn(0); setLimit(PAGE); }} onKeyDown={key} />
      </div>
      <div className="ins-body" ref={bodyRef}>
        {needle ? null : group ? (
          <h4 className="ins-crumb">
            <button onClick={() => go([])}>All Categories</button>
            {trail.map((g, i) => (
              <span key={g.key} className="ins-crumb-step">
                <span aria-hidden="true">/</span>
                {i < trail.length - 1 ? <button onClick={() => go(trail.slice(0, i + 1).map(x => x.key))}>{g.label}</button> : g.label}
              </span>
            ))}
          </h4>
        ) : <h4>All Categories</h4>}
        {rows.map(row)}
        {shown.length > 0 && <div className={gridCols === 3 ? 'ins-tiles' : 'ins-grid'}>{shown.map((it, j) => tile(it, rows.length + j))}</div>}
        {shown.length < tiles.length && <div ref={moreRef} className="ins-more">Loading more…</div>}
        {!list.length && <p className="ins-none">{needle ? `Nothing matches “${q.trim()}”.` : (group && group.empty) || 'Nothing here yet.'}</p>}
      </div>
      <div className="ins-foot"><span>{cur ? cur.label : ''}</span><span><b>↑↓</b> to navigate · <b>enter</b> to insert</span></div>
    </div>
  );
}
