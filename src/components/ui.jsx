import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { readColors } from '../lib/engines.js';

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
  }, [anchor]);

  useEffect(() => {
    const down = e => { if (ref.current && !ref.current.contains(e.target) && !anchor.contains(e.target)) onClose(); };
    const key = e => { if (e.key === 'Escape') { onClose(); anchor.focus?.(); } };
    document.addEventListener('pointerdown', down);
    document.addEventListener('keydown', key);
    return () => { document.removeEventListener('pointerdown', down); document.removeEventListener('keydown', key); };
  }, [anchor, onClose]);

  return (
    <div className="menu" role="menu" ref={ref} style={pos}>
      {items.map((it, i) => it === '-' ? <hr key={i} /> : (
        <button key={i} role="menuitem" className={it.danger ? 'danger' : undefined} onClick={() => { onClose(); it.act(); }}>
          {it.label}
          {it.note && <small>{it.note}</small>}
        </button>
      ))}
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
