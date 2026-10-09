import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { readColors } from '../lib/engines.js';
import { THEMES, setTheme, themePref } from '../lib/theme.js';

const Ctx = createContext(null);
export const useUI = () => useContext(Ctx);

export function UIProvider({ children }) {
  const [toastMsg, setToastMsg] = useState('');
  const [toastOn, setToastOn] = useState(false);
  const tRef = useRef(0);
  const toast = useCallback(t => {
    setToastMsg(t);
    setToastOn(true);
    clearTimeout(tRef.current);
    tRef.current = setTimeout(() => setToastOn(false), 2200);
  }, []);

  const [menu, setMenu] = useState(null);
  const popup = useCallback((anchor, items) => setMenu(m => (m && m.anchor === anchor ? null : { anchor, items })), []);
  const closeMenu = useCallback(() => setMenu(null), []);

  const [dialog, setDialog] = useState(null);
  const ask = useCallback(opts => new Promise(res => setDialog({ ...opts, res })), []);

  // Re-read theme colors when light/dark changes, and bump a version so diagrams redraw.
  const [theme, setTheme] = useState(0);
  useEffect(() => {
    const mq = matchMedia('(prefers-color-scheme: dark)');
    const re = () => { readColors(); setTheme(v => v + 1); };
    mq.addEventListener ? mq.addEventListener('change', re) : mq.addListener(re);
    const mo = new MutationObserver(re);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => { mq.removeEventListener ? mq.removeEventListener('change', re) : mq.removeListener(re); mo.disconnect(); };
  }, []);

  return (
    <Ctx.Provider value={{ toast, popup, closeMenu, ask, theme }}>
      {children}
      {menu && <Menu {...menu} onClose={closeMenu} />}
      {dialog && <Dialog {...dialog} onDone={v => { dialog.res(v); setDialog(null); }} />}
      <div className={'toast' + (toastOn ? ' on' : '')} role="status" aria-live="polite">{toastMsg}</div>
    </Ctx.Provider>
  );
}

function Menu({ anchor, items, onClose }) {
  const ref = useRef(null);
  const [pos, setPos] = useState({ top: -9999, left: -9999 });

  useLayoutEffect(() => {
    const r = anchor.getBoundingClientRect(), m = ref.current;
    const w = m.offsetWidth, h = m.offsetHeight;
    const top = r.bottom + 6 + h > innerHeight - 8 ? Math.max(8, r.top - h - 6) : r.bottom + 6;
    setPos({ top, left: Math.max(8, Math.min(r.right - w, innerWidth - w - 8)) });
    m.querySelector('button')?.focus();
  }, [anchor, items]);

  useEffect(() => {
    const down = e => { if (ref.current && !ref.current.contains(e.target) && !anchor.contains(e.target)) onClose(); };
    const key = e => { if (e.key === 'Escape') { onClose(); anchor.focus?.(); } };
    document.addEventListener('pointerdown', down);
    document.addEventListener('keydown', key);
    return () => { document.removeEventListener('pointerdown', down); document.removeEventListener('keydown', key); };
  }, [anchor, onClose]);

  return (
    <div className="menu" role="menu" ref={ref} style={pos}>
      <MenuItems items={items} onClose={onClose} />
    </div>
  );
}

// Menu rows. An item with `items` opens a submenu beside it (on hover, click or →).
function MenuItems({ items, onClose }) {
  const [open, setOpen] = useState(-1);
  const btns = useRef([]);
  return items.map((it, i) => it === '-' ? <hr key={i} /> : it.heading ? <div key={i} className="mhead" role="presentation">{it.heading}</div> : (
    <div key={i} className="mrow" onMouseEnter={() => setOpen(it.items ? i : -1)}>
      <button ref={el => { btns.current[i] = el; }} role={it.on === undefined ? 'menuitem' : 'menuitemradio'} aria-checked={it.on}
        aria-haspopup={it.items ? 'menu' : undefined} aria-expanded={it.items ? open === i : undefined}
        className={[it.danger && 'danger', (it.swatch || it.icon) && 'has-art', it.items && open === i && 'open'].filter(Boolean).join(' ') || undefined}
        onClick={() => { if (it.items) { setOpen(i); return; } onClose(); it.act(); }}
        onKeyDown={e => { if (it.items && (e.key === 'ArrowRight' || e.key === 'Enter')) { e.preventDefault(); setOpen(i); } }}>
        {it.swatch && <i className="mswatch" style={{ background: it.swatch }} />}
        {it.icon && <svg className="micon" viewBox="0 0 24 24" aria-hidden="true" dangerouslySetInnerHTML={{ __html: it.icon }} />}
        <span className="mlabel">{it.label}{it.note && <small>{it.note}</small>}</span>
        {it.kbd && <kbd>{it.kbd}</kbd>}
        {it.on && <span className="mcheck" aria-hidden="true">✓</span>}
        {it.items && <svg className="mchev" viewBox="0 0 24 24" aria-hidden="true"><path d="m10 6 6 6-6 6" /></svg>}
      </button>
      {it.items && open === i && (
        <SubMenu items={it.items} onClose={onClose} onBack={() => { setOpen(-1); btns.current[i]?.focus(); }} />
      )}
    </div>
  ));
}

function SubMenu({ items, onClose, onBack }) {
  const ref = useRef(null);
  const [place, setPlace] = useState({ flip: false, dy: 0, ready: false });
  useLayoutEffect(() => {
    const r = ref.current.getBoundingClientRect();
    setPlace({ flip: r.right > innerWidth - 8, dy: Math.min(0, innerHeight - 8 - r.bottom), ready: true });
  }, []);
  useEffect(() => { if (place.ready) ref.current.querySelector('button')?.focus(); }, [place.ready]);
  return (
    <div className={'menu sub' + (place.flip ? ' flip' : '')} role="menu" ref={ref}
      style={{ marginTop: place.dy, visibility: place.ready ? undefined : 'hidden' }}
      onKeyDown={e => { if (e.key === 'ArrowLeft') { e.preventDefault(); e.stopPropagation(); onBack(); } }}>
      <MenuItems items={items} onClose={onClose} />
    </div>
  );
}

function Dialog({ title, text, value = '', ok = 'OK', multiline = false, input = true, onDone }) {
  const [v, setV] = useState(value);
  const fieldRef = useRef(null), okRef = useRef(null);
  useEffect(() => {
    if (input) { fieldRef.current?.focus(); if (!multiline) fieldRef.current?.select(); }
    else okRef.current?.focus();
  }, [input, multiline]);
  const confirm = () => onDone(input ? v : true);

  return (
    <div className="modal"
      onClick={e => { if (e.target === e.currentTarget) onDone(null); }}
      onKeyDown={e => {
        if (e.key === 'Escape') onDone(null);
        if (e.key === 'Enter' && !multiline && !e.nativeEvent.isComposing) { e.preventDefault(); confirm(); }
      }}>
      <div className="mbox" role="dialog" aria-modal="true" aria-labelledby="dlgTitle">
        <h3 id="dlgTitle">{title}</h3>
        {text && <p>{text}</p>}
        {input && !multiline && <input ref={fieldRef} value={v} onChange={e => setV(e.target.value)} aria-label={title} />}
        {input && multiline && <textarea ref={fieldRef} rows={4} value={v} onChange={e => setV(e.target.value)} aria-label={title} />}
        <div className="mact">
          <button className="btn" onClick={() => onDone(null)}>Cancel</button>
          <button className="btn dark" ref={okRef} onClick={confirm}>{ok}</button>
        </div>
      </div>
    </div>
  );
}

// Light / Dark / System. Shows the theme in use; a menu picks another.
const THEME_ICON = {
  light: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  dark: '<path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/>',
  system: '<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/>',
};
export function ThemeButton({ className = 'btn icon-only', withLabel = false }) {
  const { popup } = useUI();
  const [pref, setPref] = useState(themePref);
  const name = THEMES.find(t => t[0] === pref)[1];
  return (
    <button className={className} aria-haspopup="menu" aria-label={`Theme: ${name}`} title={`Theme: ${name}`}
      onClick={e => popup(e.currentTarget, THEMES.map(([k, n]) => ({ label: n, on: pref === k, act: () => { setTheme(k); setPref(k); } })))}>
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" dangerouslySetInnerHTML={{ __html: THEME_ICON[pref] }} />
      {withLabel && <span>{name} theme</span>}
    </button>
  );
}

export function Brand() {
  return (
    <div className="brand">
      <svg width="22" height="22" viewBox="0 0 22 22" aria-hidden="true">
        <rect x="1.5" y="3" width="7" height="6" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.6" />
        <rect x="13.5" y="13" width="7" height="6" rx="1.5" fill="var(--hi)" stroke="currentColor" strokeWidth="1.6" />
        <path d="M8.5 6h3.5a2 2 0 0 1 2 2v5" fill="none" stroke="currentColor" strokeWidth="1.6" />
      </svg>
      Linework
    </div>
  );
}
