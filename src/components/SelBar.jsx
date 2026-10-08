import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { BOX_KINDS, COLOR_NAMES, WIDTHS, colorOf, hasText, isBox, isLink, measure, routeOf, shapeIcon } from '../lib/shapes.js';
import { TYPES } from '../lib/engines.js';
import { IC, Ico } from './Toolbar.jsx';
import { useUI } from './ui.jsx';

const ROUTES = [['curve', 'Curved', 'rCurve'], ['elbow', 'Elbow', 'rElbow'], ['straight', 'Straight', 'rStraight']];
const FILLS = [['tint', 'Tinted fill'], ['solid', 'Solid fill'], ['none', 'No fill']];
const EFFECTS = [
  ['plain', 'Plain', '<circle cx="12" cy="12" r="7"/>'],
  ['shadow', 'Shadow', '<circle cx="14" cy="14" r="7" fill="currentColor" stroke="none" opacity=".35"/><circle cx="11" cy="11" r="7" fill="var(--surface)"/>'],
  ['watercolor', 'Watercolor', '<path d="M12 4.5c3.8-.3 7.6 2.6 7.4 7.1-.1 4.2-3.2 7.4-7.6 7.3C7.6 18.8 4.4 15.6 4.6 11.7 4.8 7.6 8 4.8 12 4.5z" fill="currentColor" fill-opacity=".3"/>'],
];

// Toolbar button; with `caret` it opens a panel or menu.
export function B({ icon, label, pressed, caret, onClick, children, open }) {
  return (
    <button className={'sbtn ico' + (open ? ' open' : '')} aria-label={label} title={label} aria-pressed={pressed}
      aria-haspopup={caret ? 'true' : undefined} aria-expanded={caret ? !!open : undefined} onClick={onClick}>
      {children || <Ico d={IC[icon]} />}{caret && <Ico d={IC.caret} className="caret" />}
    </button>
  );
}
const dot = (c, hollow) => <i className={'sdot' + (hollow ? ' hollow' : '')} style={hollow ? { borderColor: colorOf(c) } : { background: colorOf(c) }} />;

export function Palette({ value, onPick, none, noneOn }) {
  const custom = typeof value === 'string' && value !== 'none';
  return (
    <div className="pal">
      {COLOR_NAMES.map((n, i) => (
        <button key={n} className="pal-sw" title={n} aria-label={n} aria-pressed={!noneOn && (value || 0) === i}
          style={{ '--sw': colorOf(i) }} onClick={() => onPick(i)} />
      ))}
      <label className={'pal-sw custom' + (custom ? ' on' : '')} title="Custom colour" style={custom ? { '--sw': value } : undefined}>
        <input type="color" aria-label="Custom colour" value={custom ? value : '#3b82f6'} onChange={e => onPick(e.target.value)} />
      </label>
      {none && <button className="pal-sw none" title="None" aria-label="None" aria-pressed={!!noneOn} onClick={() => onPick('none')} />}
    </div>
  );
}

// The toolbar for the current selection, with pop-up panels for shape, colour and stroke.
// `act` holds the canvas actions (patch, comment, order, copy, export and so on).
export default function SelBar({ shapes, single, act }) {
  const { popup } = useUI();
  const [pop, setPop] = useState(null); // {k: 'shape' | 'color' | 'stroke', x}
  const [strokePal, setStrokePal] = useState(false);
  const barRef = useRef(null), popRef = useRef(null);

  const all = f => shapes.every(f);
  const links = all(isLink), boxes = all(isBox), first = shapes[0];
  const colorable = shapes.some(x => x.t !== 'image');
  // Group unless the selection is already exactly one group; ungroup if anything selected is grouped.
  const grouped = shapes.some(x => x.gid), canGroup = shapes.length > 1 && !(first.gid && all(x => x.gid === first.gid));
  const toggle = (k, e) => { const b = e.currentTarget; setStrokePal(false); setPop(p => (p && p.k === k ? null : { k, x: b.offsetLeft })); };

  // Close the panel on a click elsewhere (menus opened from it don't count) or Escape.
  useEffect(() => {
    if (!pop) return;
    const down = e => { if (!barRef.current?.contains(e.target) && !e.target.closest('.menu')) setPop(null); };
    const key = e => { if (e.key === 'Escape' && !document.querySelector('.menu')) { e.stopPropagation(); setPop(null); } };
    document.addEventListener('pointerdown', down);
    addEventListener('keydown', key, true);
    return () => { document.removeEventListener('pointerdown', down); removeEventListener('keydown', key, true); };
  }, [pop]);
  // Keep the panel on screen.
  useLayoutEffect(() => {
    const el = popRef.current;
    if (!el) return;
    el.style.transform = '';
    const r = el.getBoundingClientRect();
    const dx = r.left < 8 ? 8 - r.left : r.right > innerWidth - 8 ? innerWidth - 8 - r.right : 0;
    if (dx) el.style.transform = `translateX(${dx}px)`;
  }, [pop, strokePal]);

  const more = btn => popup(btn, [
    ...(single && hasText(single) ? [{ label: links ? 'Edit label' : 'Edit text', kbd: 'Enter', act: () => act.edit(single) }] : []),
    ...(links ? [
      { label: 'Animate', on: all(x => !!x.anim), act: () => act.patch({ anim: all(x => !!x.anim) ? 0 : 1 }) },
      ...(shapes.some(x => x.anim) ? [{ label: 'Fast animation', on: all(x => x.anim === 'fast'), act: () => act.patch({ anim: all(x => x.anim === 'fast') ? 1 : 'fast' }) }] : []),
      ...(shapes.some(x => x.pts.length > 2) ? [{ label: 'Remove bends', act: act.straighten }] : []),
    ] : []),
    ...((single && hasText(single)) || links ? ['-'] : []),
    { label: 'Copy/Paste As', icon: IC.copy, items: [
      { label: 'Copy as PNG', kbd: '⇧ Alt C', act: act.copyPng },
      { label: 'Copy as SVG', act: act.copySvg },
      '-',
      { label: 'Copy styles', kbd: 'Ctrl Alt C', act: act.copyStyles },
      { label: 'Paste styles', kbd: 'Ctrl Alt V', act: act.pasteStyles },
    ] },
    { label: 'Export selection', icon: IC.download, act: act.exportPng },
    ...(act.convert ? (() => {
      const { hasCode, type, run } = act.convert;
      const kinds = Object.keys(TYPES).map(k => ({ label: TYPES[k].name, act: () => run(k, hasCode) }));
      return hasCode
        ? [{ label: `Add to the ${TYPES[type].name.toLowerCase()} code`, note: 'Boxes become nodes, arrows connections', icon: IC.braces, act: () => run(type) },
           { label: 'Convert to a new diagram', icon: IC.diagram, items: kinds }]
        : [{ label: 'Convert to code', note: 'Boxes become nodes, arrows connections', icon: IC.braces, items: kinds.map((x, i) => (Object.keys(TYPES)[i] === type ? { ...x, on: true } : x)) }];
    })() : []),
    '-',
    ...(canGroup ? [{ label: 'Group', icon: IC.group, kbd: 'Ctrl G', act: act.group }] : []),
    ...(grouped ? [{ label: 'Ungroup', icon: IC.ungroup, kbd: 'Ctrl ⇧ G', act: act.ungroup }] : []),
    { label: 'Create Figure', icon: IC.figurePlus, kbd: '⇧ F', act: act.figure },
    '-',
    { label: 'Change Order', icon: IC.layers, items: [
      { label: 'Send backward', kbd: 'Ctrl [', act: () => act.step(false) },
      { label: 'Bring forward', kbd: 'Ctrl ]', act: () => act.step(true) },
      { label: 'Send to back', kbd: '[', act: () => act.order(false) },
      { label: 'Bring to front', kbd: ']', act: () => act.order(true) },
    ] },
    '-',
    { label: 'Duplicate', kbd: 'Ctrl D', act: act.duplicate },
    { label: 'Delete', kbd: 'Del', danger: true, act: act.remove },
  ]);

  const fm = first.fm || 'tint', fx = first.fx || 'plain', sw = first.sw;
  const widthKey = links ? (WIDTHS.find(w => w.v === (sw || 2)) || {}).k : (WIDTHS.find(w => w.v === sw) || (sw ? {} : { k: 'M' })).k;

  let panel = null;
  if (pop && pop.k === 'shape') {
    panel = (
      <div className="spop-grid">
        {BOX_KINDS.map(t => (
          <button key={t} className="spop-cell" aria-label={t} title={t[0].toUpperCase() + t.slice(1)} aria-pressed={all(x => x.t === t)}
            onClick={() => act.patch({ t })}><Ico d={shapeIcon(t)} /></button>
        ))}
      </div>
    );
  } else if (pop && pop.k === 'color') {
    panel = (<>
      {boxes && (
        <div className="spop-row">
          {FILLS.map(([v, n]) => (
            <button key={v} className={'spop-cell fill-' + v} aria-label={n} title={n} aria-pressed={all(x => (x.fm || 'tint') === v)}
              onClick={() => act.patch({ fm: v })}><i style={{ '--sw': colorOf(first.c) }} /></button>
          ))}
          <button className="spop-cell wide" aria-label="Style" title="Style" aria-haspopup="menu"
            onClick={e => popup(e.currentTarget, EFFECTS.map(([v, n, svg]) => ({
              label: n, icon: svg, on: all(x => (x.fx || 'plain') === v), act: () => act.patch({ fx: v === 'plain' ? undefined : v }),
            })))}>
            <Ico d={EFFECTS.find(x => x[0] === fx)[2]} /><Ico d={IC.caret} className="caret" />
          </button>
        </div>
      )}
      <Palette value={first.c} none={boxes} noneOn={boxes && all(x => x.fm === 'none')}
        onPick={v => act.patch(v === 'none' ? { fm: 'none' } : boxes && fm === 'none' ? { c: v, fm: 'tint' } : { c: v })} />
    </>);
  } else if (pop && pop.k === 'stroke') {
    const sc = first.sc;
    panel = (<>
      <div className="spop-row top">
        <button className="spop-cell" aria-label="Dashed" title="Dashed" aria-pressed={all(x => !!x.dash)}
          onClick={() => act.patch({ dash: !all(x => !!x.dash) })}><Ico d={IC.dash} /></button>
        {boxes && (
          <button className="spop-cell wide" aria-label="Stroke colour" title="Stroke colour" aria-expanded={strokePal} onClick={() => setStrokePal(o => !o)}>
            {sc === 'none' ? <i className="sdot none" /> : dot(sc != null ? sc : first.c)}<Ico d={IC.caret} className="caret" />
          </button>
        )}
      </div>
      {strokePal && boxes && (
        <Palette value={sc == null ? first.c : sc} none noneOn={sc === 'none'} onPick={v => act.patch({ sc: v })} />
      )}
      <div className="spop-widths">
        {WIDTHS.map(w => (
          <button key={w.k} aria-pressed={widthKey === w.k} onClick={() => act.patch({ sw: w.v })}>
            <b>{w.k}</b><i style={{ height: Math.max(1, w.v) }} />
          </button>
        ))}
      </div>
    </>);
  }

  return (
    <div className="sbar" ref={barRef} role="toolbar" aria-label={shapes.length > 1 ? `${shapes.length} objects selected` : 'Selected object'}>
      {panel && <div className={'spop spop-' + pop.k} ref={popRef} style={{ left: pop.x }}>{panel}</div>}
      {shapes.length > 1 && <span className="scount">{shapes.length}</span>}
      {boxes && <B label="Shape" icon="shapes" caret open={pop?.k === 'shape'} onClick={e => toggle('shape', e)} />}
      {colorable && (
        <B label={boxes ? 'Fill and style' : 'Colour'} caret open={pop?.k === 'color'} onClick={e => toggle('color', e)}>
          {dot(first.c, boxes && fm === 'none')}
        </B>
      )}
      {links && (
        <B label="Line style" icon={ROUTES.find(r => r[0] === routeOf(first))[2]} caret onClick={e => { setPop(null); popup(e.currentTarget, ROUTES.map(([v, n, ic]) => ({
          label: n, icon: IC[ic], on: all(x => routeOf(x) === v), act: () => act.route(v),
        }))); }} />
      )}
      {(boxes || links) && <B label="Stroke" icon="width" caret open={pop?.k === 'stroke'} onClick={e => toggle('stroke', e)} />}
      {links && (<>
        <span className="sep" />
        <B label="Arrow at start" icon="headL" pressed={all(x => !!x.h0)} onClick={() => act.patch({ h0: !all(x => !!x.h0) })} />
        <B label="Arrow at end" icon="headR" pressed={all(x => x.t === 'arrow')} onClick={() => act.patch({ t: all(x => x.t === 'arrow') ? 'line' : 'arrow' })} />
        <B label="Dashed" icon="dash" pressed={all(x => !!x.dash)} onClick={() => act.patch({ dash: !all(x => !!x.dash) })} />
      </>)}
      {single && single.t === 'text' && (<>
        <span className="sep" />
        <B label="Smaller text" icon="textSm" onClick={() => { const fs = Math.max(8, (single.fs || 20) - 4); act.patch({ fs, ...measure(single.text, fs) }); }} />
        <B label="Larger text" icon="textLg" onClick={() => { const fs = Math.min(200, (single.fs || 20) + 4); act.patch({ fs, ...measure(single.text, fs) }); }} />
        <B label="Bold" icon="bold" pressed={!!single.bold} onClick={() => act.patch({ bold: !single.bold })} />
      </>)}
      <span className="sep" />
      <B label="Add comment" icon="comment" onClick={() => { setPop(null); act.comment(); }} />
      <B label="More" icon="more" onClick={e => { setPop(null); more(e.currentTarget); }} />
    </div>
  );
}
