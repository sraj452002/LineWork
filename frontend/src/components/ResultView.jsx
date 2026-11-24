import { useState } from 'react';
import { Mark } from './RunViews.jsx';

/* What a run gave (Home › Run › Result), two ways: View, readable for anyone (an item as a card of fields,
   several as a list of cards; links clickable, pictures shown, yes/no as ticks, lists as chips, files by
   name), or the JSON as it is. results: [{ id, name, type, items }]. */

const MAX_CARDS = 20, MAX_FIELDS = 5;
// A key as words: releaseDate → Release date, top_10 → Top 10.
const label = k => String(k).replace(/[_-]+/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').replace(/\s+/g, ' ').trim().replace(/^./, c => c.toUpperCase());
const isUrl = v => typeof v === 'string' && /^https?:\/\/\S+$/i.test(v);
const isImg = v => isUrl(v) && /\.(png|jpe?g|gif|webp|svg|avif)(\?|#|$)/i.test(v) || (typeof v === 'string' && /^data:image\//.test(v));
const isFile = v => v && typeof v === 'object' && typeof v.name === 'string' && 'data' in v && ('size' in v || 'type' in v);
const size = n => (n < 1024 ? `${n} B` : n < 1048576 ? `${Math.round(n / 1024)} KB` : `${(n / 1048576).toFixed(1)} MB`);
// The item's title: a name-like field, else its first short text.
function titleOf(it) {
  if (!it || typeof it !== 'object') return null;
  const k = ['title', 'name', 'label', 'subject', 'heading', 'email', 'id'].find(x => typeof it[x] === 'string' || typeof it[x] === 'number');
  if (k) return [k, String(it[k])];
  const e = Object.entries(it).find(([, v]) => typeof v === 'string' && v.length && v.length < 80 && !isUrl(v));
  return e ? [e[0], e[1]] : null;
}

function Value({ v, depth = 0 }) {
  const [open, setOpen] = useState(false);
  if (v === null || v === undefined || v === '') return <span className="rv-v-empty">—</span>;
  if (typeof v === 'boolean') return <span className={'rv-v-bool ' + (v ? 'yes' : 'no')}>{v ? '✓ Yes' : '✕ No'}</span>;
  if (typeof v === 'number') return <span className="rv-v-num">{v.toLocaleString()}</span>;
  if (isImg(v)) return <a className="rv-v-img" href={v} target="_blank" rel="noreferrer"><img src={v} alt="" loading="lazy" /></a>;
  if (isUrl(v)) return <a className="rv-v-link" href={v} target="_blank" rel="noreferrer">{v.replace(/^https?:\/\/(www\.)?/, '').slice(0, 60)}{v.length > 70 ? '…' : ''} ↗</a>;
  if (typeof v === 'string') return <span className="rv-v-text">{v.length > 280 && !open ? <>{v.slice(0, 280)}… <button className="link" onClick={() => setOpen(true)}>more</button></> : v}</span>;
  if (isFile(v)) return <span className="rv-v-file">📎 {v.name}{v.size ? <small> · {size(v.size)}</small> : null}</span>;
  if (Array.isArray(v)) {
    if (!v.length) return <span className="rv-v-empty">none</span>;
    if (v.every(x => x === null || typeof x !== 'object')) return <span className="rv-v-chips">{v.slice(0, 12).map((x, i) => <em key={i}>{String(x)}</em>)}{v.length > 12 && <small>+{v.length - 12}</small>}</span>;
    return depth > 1 ? <span className="rv-v-empty">{v.length} items</span> : (
      <span className="rv-v-nest"><button className="link" onClick={() => setOpen(!open)}>{v.length} item{v.length === 1 ? '' : 's'} {open ? '▴' : '▾'}</button>
        {open && v.slice(0, 10).map((x, i) => <Fields key={i} it={x} depth={depth + 1} />)}</span>
    );
  }
  if (typeof v === 'object') {
    const n = Object.keys(v).length;
    return depth > 1 ? <span className="rv-v-empty">{n} fields</span> : (
      <span className="rv-v-nest"><button className="link" onClick={() => setOpen(!open)}>{n} field{n === 1 ? '' : 's'} {open ? '▴' : '▾'}</button>{open && <Fields it={v} depth={depth + 1} />}</span>
    );
  }
  return <span>{String(v)}</span>;
}

function Fields({ it, depth = 0, skip, limit }) {
  const [all, setAll] = useState(false);
  if (!it || typeof it !== 'object') return <div className="rv-fields"><div className="rv-f"><span /><Value v={it} depth={depth} /></div></div>;
  const rows = Object.entries(it).filter(([k]) => !k.startsWith('_') && k !== skip);
  const shown = limit && !all ? rows.slice(0, limit) : rows;
  return (
    <div className="rv-fields">
      {shown.map(([k, v]) => <div key={k} className="rv-f"><span title={k}>{label(k)}</span><Value v={v} depth={depth} /></div>)}
      {limit && rows.length > limit && <button className="link rv-more" onClick={() => setAll(!all)}>{all ? 'Show fewer fields' : `Show ${rows.length - limit} more field${rows.length - limit === 1 ? '' : 's'}`}</button>}
    </div>
  );
}

function Items({ items }) {
  const [n, setN] = useState(MAX_CARDS);
  if (items.length === 1) return <div className="rv-card1"><Fields it={items[0]} /></div>;
  return (
    <div className="rv-cards">
      {items.slice(0, n).map((it, i) => {
        const t = titleOf(it);
        return (
          <article key={i} className="rv-icard">
            <header><em>{i + 1}</em><b>{t ? t[1] : `Item ${i + 1}`}</b></header>
            <Fields it={it} skip={t?.[0]} limit={MAX_FIELDS} />
          </article>
        );
      })}
      {items.length > n && <button className="btn rv-showmore" onClick={() => setN(n + MAX_CARDS)}>Show {Math.min(MAX_CARDS, items.length - n)} more of {items.length - n}</button>}
    </div>
  );
}

export function ResultView({ results, onCopy }) {
  const [mode, setModeS] = useState(() => { try { return localStorage.getItem('linework:result-mode') === 'json' ? 'json' : 'view'; } catch (e) { return 'view'; } });
  const setMode = m => { setModeS(m); try { localStorage.setItem('linework:result-mode', m); } catch (e) { /* only a convenience */ } };
  return (
    <div className="rv-result">
      <div className="rv-mode" role="tablist" aria-label="Show the result as">
        <button role="tab" aria-selected={mode === 'view'} className={mode === 'view' ? 'on' : ''} onClick={() => setMode('view')}>View</button>
        <button role="tab" aria-selected={mode === 'json'} className={mode === 'json' ? 'on' : ''} onClick={() => setMode('json')}>JSON</button>
      </div>
      {!results.length && <p className="ws-empty">It finished without passing anything on.</p>}
      {results.map(r => {
        const text = JSON.stringify(r.items.length === 1 ? r.items[0] : r.items, null, 2);
        return (
          <section key={r.id} className="rv-res">
            <header className="rv-res-head"><Mark type={r.type} size={12} /><b>{r.name}</b><small>{r.items.length} item{r.items.length === 1 ? '' : 's'}</small><button className="rh-copy" onClick={() => onCopy(JSON.stringify(r.items, null, 2))}>Copy JSON</button></header>
            {mode === 'json' ? <pre className="rv-json">{text}</pre> : r.items.length ? <Items items={r.items} /> : <p className="ws-empty">No items.</p>}
          </section>
        );
      })}
    </div>
  );
}
