import { useEffect, useRef, useState } from 'react';
import { FONTS, SIZES } from '../lib/word/extensions.js';

/* The Word-style ribbon: File, Home, Insert, Layout, Review and View, plus Table and Picture when one is
   selected. Every control works on the editor (TipTap); the doc-wide settings (page, tracking, panes)
   come in from WordDoc through `doc`. */

const P = {
  undo: 'M9 14 4 9l5-5M4 9h11a5 5 0 0 1 0 10h-3', redo: 'm15 14 5-5-5-5M20 9H9a5 5 0 0 0 0 10h3',
  painter: 'M4 4h12v5H4zM16 6h3v5h-8v3M11 14v6', clear: 'M4 7V4h16v3M9 20h6M12 4 8 20M3 3l18 18',
  bold: 'M7 4h6a4 4 0 0 1 0 8H7zM7 12h7a4 4 0 0 1 0 8H7z', italic: 'M19 4h-9M14 20H5M15 4 9 20', underline: 'M6 4v6a6 6 0 0 0 12 0V4M4 20h16', strike: 'M16 6a4 4 0 0 0-4-2c-3 0-5 2-4 4.5M4 12h16M8 18a5 5 0 0 0 4 2c3 0 5-2 4-5',
  sub: 'M4 5l8 8M12 5l-8 8M16 19h4l-4-4a2 2 0 1 1 4 0', sup: 'M4 9l8 8M12 9l-8 8M16 9h4l-4-4a2 2 0 1 1 4 0',
  color: 'M5 20h14M8 16l4-12 4 12M9.5 12h5', mark: 'M15 5l4 4-9 9H6v-4zM4 21h16',
  ul: 'M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01', ol: 'M10 6h10M10 12h10M10 18h10M4 4h1v4M4 10h2l-2 3h2M4 16h2v4H4M4 18h2', task: 'M4 5h4v4H4zM4 14l2 2 3-3M12 7h8M12 16h8',
  outdent: 'M8 8l-4 4 4 4M12 6h8M12 12h8M12 18h8', indent: 'M4 8l4 4-4 4M12 6h8M12 12h8M12 18h8',
  left: 'M4 6h16M4 10h10M4 14h16M4 18h10', center: 'M4 6h16M7 10h10M4 14h16M7 18h10', right: 'M4 6h16M10 10h10M4 14h16M10 18h10', justify: 'M4 6h16M4 10h16M4 14h16M4 18h16',
  spacing: 'M10 6h10M10 12h10M10 18h10M5 4v16M3 6l2-2 2 2M3 18l2 2 2-2',
  find: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM20 20l-4-4', replace: 'M4 7h12l-3-3M20 17H8l3 3',
  table: 'M4 4h16v16H4zM4 10h16M4 16h16M10 4v16', image: 'M4 5h16v14H4zM4 15l4-4 4 4 3-3 5 5M15 9h.01', link: 'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1',
  pagebreak: 'M5 3v6h14V3M5 21v-6h14v6M3 12h3M9 12h2M14 12h2M19 12h2', hr: 'M4 12h16', symbol: 'M7 20h4v-3a6 6 0 1 1 2 0v3h4', date: 'M4 6h16v14H4zM4 10h16M8 3v4M16 3v4', toc: 'M4 6h2M9 6h11M6 12h2M11 12h9M6 18h2M11 18h9', comment: 'M4 5h16v11H9l-5 4z',
  size: 'M6 3h9l4 4v14H6zM15 3v4h4', orient: 'M3 7h18v10H3zM7 3v4M17 17v4', margins: 'M4 4h16v16H4zM8 4v16M16 4v16M4 8h16M4 16h16', header: 'M4 4h16v16H4zM4 9h16', footer: 'M4 4h16v16H4zM4 15h16', pagenum: 'M6 3h9l4 4v14H6zM10 13h4M12 11v6',
  spell: 'M4 16l3-10 3 10M5 13h4M14 16V6h3a2 2 0 0 1 0 4h-3h4a2 2 0 0 1 0 4h-4M4 20l2 2 4-4', count: 'M4 6h16M4 12h10M4 18h7M17 14v6M15 17h4',
  track: 'M4 20h4L19 9l-4-4L4 16zM14 6l4 4M17 20h4', accept: 'M5 12l5 5L20 7', reject: 'M6 6l12 12M18 6 6 18', prev: 'M15 6l-6 6 6 6', next: 'M9 6l6 6-6 6', compare: 'M4 4h7v16H4zM13 4h7v16h-7zM7 9h1M16 9h1M7 13h1M16 13h1',
  read: 'M4 5c3-1 5-1 8 1 3-2 5-2 8-1v14c-3-1-5-1-8 1-3-2-5-2-8-1zM12 6v14', print: 'M6 9V3h12v6M6 18H4v-7h16v7h-2M8 14h8v7H8z', web: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM3 12h18', nav: 'M4 4h6v16H4zM13 6h7M13 10h7M13 14h5',
  zoomIn: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM20 20l-4-4M8 11h6M11 8v6', zoomOut: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM20 20l-4-4M8 11h6', fit: 'M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5',
  rowAbove: 'M4 12h16v8H4zM12 4v6M9 7h6', rowBelow: 'M4 4h16v8H4zM12 14v6M9 17h6', colLeft: 'M12 4h8v16h-8zM4 12h6M7 9v6', colRight: 'M4 4h8v16H4zM14 12h6M17 9v6', del: 'M5 7h14M9 7V4h6v3M7 7l1 13h8l1-13',
  merge: 'M4 4h16v16H4zM12 4v5M12 15v5M8 12h8', split: 'M4 4h16v16H4zM12 4v16', headRow: 'M4 4h16v16H4zM4 9h16',
  open: 'M4 7h6l2 2h8v10H4zM12 12v5M9.5 14.5 12 12l2.5 2.5', save: 'M5 4h11l3 3v13H5zM8 4v5h7V4M8 20v-6h8v6', pdf: 'M6 3h9l4 4v14H6zM9 13h6M9 17h4',
  quote: 'M7 7h4v4H7zM7 11c0 3-1 5-3 6M15 7h4v4h-4zM15 11c0 3-1 5-3 6', code: 'M8 7l-5 5 5 5M16 7l5 5-5 5',
};
const Ico = ({ d, s = 16 }) => <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={d} /></svg>;
const Btn = ({ icon, label, title, on, big, disabled, onClick, children }) => (
  <button type="button" className={'wr-b' + (big ? ' big' : '')} aria-pressed={on === undefined ? undefined : !!on} title={title || label} aria-label={title || label} disabled={disabled}
    onMouseDown={e => e.preventDefault()} onClick={onClick}>
    {icon && <Ico d={P[icon]} s={big ? 22 : 16} />}{big || children ? <span>{children || label}</span> : null}
  </button>
);
const Group = ({ label, children }) => <div className="wr-g"><div className="wr-items">{children}</div><span className="wr-gl">{label}</span></div>;

// A button that opens a small panel below it (colours, table size, symbols, menus).
function Drop({ icon, label, title, big, children, swatch, className = '' }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const away = e => { if (!ref.current?.contains(e.target)) setOpen(false); };
    const key = e => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', away); document.addEventListener('keydown', key);
    return () => { document.removeEventListener('mousedown', away); document.removeEventListener('keydown', key); };
  }, [open]);
  return (
    <div className={'wr-drop ' + className} ref={ref}>
      <button type="button" className={'wr-b' + (big ? ' big' : '')} aria-haspopup="true" aria-expanded={open} title={title || label} aria-label={title || label} onMouseDown={e => e.preventDefault()} onClick={() => setOpen(!open)}>
        {icon && <Ico d={P[icon]} s={big ? 22 : 16} />}{swatch !== undefined && <i className="wr-sw" style={{ background: swatch || 'transparent' }} />}{(big || !icon) && <span>{label}</span>}<Ico d="M7 10l5 5 5-5" s={10} />
      </button>
      {open && <div className="wr-pop" onMouseDown={e => { if (e.target.tagName !== 'INPUT') e.preventDefault(); }} onClick={e => { if (e.target.closest('[data-close]')) setOpen(false); }}>{children}</div>}
    </div>
  );
}

const COLORS = ['#000000', '#434343', '#666666', '#999999', '#cccccc', '#ffffff', '#c00000', '#e53935', '#fb8c00', '#fdd835', '#43a047', '#00897b', '#1e88e5', '#3949ab', '#8e24aa', '#d81b60', '#5d4037', '#7f6000', '#0b5394', '#38761d'];
const MARKS = ['#fff59d', '#c5e1a5', '#80deea', '#f8bbd0', '#ffcc80', '#b39ddb', '#e0e0e0', '#ef9a9a'];
const SYMBOLS = '© ® ™ ° ± × ÷ ≈ ≠ ≤ ≥ ∞ √ π Σ Δ µ € £ ¥ ₹ ¢ § ¶ † • … – — ← → ↑ ↓ ↔ ⇒ ✓ ✗ ★ ☆ ♥ ☐ ☑ α β γ λ θ Ω'.split(' ');
const SPACING = [['1', 'Single'], ['1.15', '1.15'], ['1.5', '1.5'], ['2', 'Double'], ['2.5', '2.5'], ['3', 'Triple']];
const STYLES = [['p', 'Normal'], ['h1', 'Heading 1'], ['h2', 'Heading 2'], ['h3', 'Heading 3'], ['h4', 'Heading 4'], ['quote', 'Quote'], ['code', 'Code']];

export default function WordRibbon({ editor, doc }) {
  const [tab, setTab] = useState('home');
  const [grid, setGrid] = useState([0, 0]);
  const imgRef = useRef(null), docxRef = useRef(null);
  if (!editor) return null;
  const c = () => editor.chain().focus();
  const is = (n, a) => editor.isActive(n, a);
  const ts = editor.getAttributes('textStyle');
  const para = editor.isActive('heading') ? editor.getAttributes('heading') : editor.getAttributes('paragraph');
  const inTable = is('table'), onImage = is('image');
  const style = is('heading', { level: 1 }) ? 'h1' : is('heading', { level: 2 }) ? 'h2' : is('heading', { level: 3 }) ? 'h3' : is('heading', { level: 4 }) ? 'h4' : is('blockquote') ? 'quote' : is('codeBlock') ? 'code' : 'p';
  const setStyle = s => {
    const ch = c();
    if (s === 'p') ch.setParagraph().run();
    else if (s === 'quote') ch.setParagraph().toggleBlockquote().run();
    else if (s === 'code') ch.toggleCodeBlock().run();
    else ch.setHeading({ level: Number(s[1]) }).run();
  };
  const size = parseFloat(ts.fontSize) || '';
  const bump = d => { const cur = parseFloat(ts.fontSize) || 12; const i = SIZES.findIndex(x => x >= cur); const next = d > 0 ? SIZES[Math.min(SIZES.length - 1, (SIZES[i] === cur ? i + 1 : i))] : SIZES[Math.max(0, i - 1)]; c().setFontSize(`${next}pt`).run(); };
  const tabs = [['home', 'Home'], ['insert', 'Insert'], ['layout', 'Layout'], ['review', 'Review'], ['view', 'View'], ...(inTable ? [['table', 'Table']] : []), ...(onImage ? [['picture', 'Picture']] : [])];
  const cur = tabs.some(t => t[0] === tab) ? tab : 'home';

  return (
    <div className="wr" role="toolbar" aria-label="Doc ribbon">
      <div className="wr-tabs">
        <Drop label="File" className="wr-file" title="File">
          <div className="wr-menu">
            <button data-close onClick={() => docxRef.current?.click()}><Ico d={P.open} />Open a Word file (.docx)…</button>
            <button data-close onClick={doc.exportDocx}><Ico d={P.save} />Save as Word (.docx)</button>
            <button data-close onClick={doc.print}><Ico d={P.pdf} />Print or save as PDF</button>
            <button data-close onClick={doc.exportMarkdown}><Ico d={P.save} />Save as Markdown (.md)</button>
            <button data-close onClick={() => setTab('layout')}><Ico d={P.size} />Page setup</button>
          </div>
        </Drop>
        {tabs.map(([k, l]) => <button key={k} type="button" role="tab" aria-selected={cur === k} className={'wr-tab' + (k === 'table' || k === 'picture' ? ' ctx' : '')} onClick={() => setTab(k)}>{l}</button>)}
        <span className="grow" />
        <Btn icon="find" title="Find and replace (Ctrl+F)" onClick={() => doc.openFind(false)} />
        {doc.aiButton}
      </div>

      <div className="wr-body">
        {cur === 'home' && <>
          <Group label="Clipboard">
            <Btn icon="undo" title="Undo (Ctrl+Z)" disabled={!editor.can().undo()} onClick={() => c().undo().run()} />
            <Btn icon="redo" title="Redo (Ctrl+Y)" disabled={!editor.can().redo()} onClick={() => c().redo().run()} />
            <Btn icon="painter" title="Format painter: copy this formatting, then select text to apply it" on={!!doc.painter} onClick={doc.togglePainter} />
          </Group>
          <Group label="Font">
            <div className="wr-row">
              <select className="wr-font" aria-label="Font" value={ts.fontFamily || ''} onChange={e => (e.target.value ? c().setFontFamily(e.target.value).run() : c().unsetFontFamily().run())}>
                {FONTS.map(([v, l]) => <option key={l} value={v} style={{ fontFamily: v || undefined }}>{l}</option>)}
                {ts.fontFamily && !FONTS.some(f => f[0] === ts.fontFamily) && <option value={ts.fontFamily}>{String(ts.fontFamily).split(',')[0]}</option>}
              </select>
              <input className="wr-size" aria-label="Font size" list="wr-sizes" value={size} placeholder="12" onChange={e => { const v = parseFloat(e.target.value); if (v > 0 && v < 400) c().setFontSize(`${v}pt`).run(); else if (!e.target.value) c().unsetFontSize().run(); }} />
              <datalist id="wr-sizes">{SIZES.map(s => <option key={s} value={s} />)}</datalist>
              <Btn icon="zoomIn" title="Bigger" onClick={() => bump(1)} /><Btn icon="zoomOut" title="Smaller" onClick={() => bump(-1)} />
            </div>
            <div className="wr-row">
              <Btn icon="bold" title="Bold (Ctrl+B)" on={is('bold')} onClick={() => c().toggleBold().run()} />
              <Btn icon="italic" title="Italic (Ctrl+I)" on={is('italic')} onClick={() => c().toggleItalic().run()} />
              <Btn icon="underline" title="Underline (Ctrl+U)" on={is('underline')} onClick={() => c().toggleUnderline().run()} />
              <Btn icon="strike" title="Strikethrough" on={is('strike')} onClick={() => c().toggleStrike().run()} />
              <Btn icon="sub" title="Subscript" on={is('subscript')} onClick={() => c().toggleSubscript().run()} />
              <Btn icon="sup" title="Superscript" on={is('superscript')} onClick={() => c().toggleSuperscript().run()} />
              <Drop icon="color" title="Font colour" swatch={ts.color || '#000000'}>
                <div className="wr-colors">{COLORS.map(col => <button key={col} data-close style={{ background: col }} aria-label={col} onClick={() => c().setColor(col).run()} />)}</div>
                <div className="wr-colfoot"><button data-close className="link" onClick={() => c().unsetColor().run()}>Automatic</button><label>More <input type="color" onChange={e => c().setColor(e.target.value).run()} /></label></div>
              </Drop>
              <Drop icon="mark" title="Highlight" swatch={editor.getAttributes('highlight').color || '#fff59d'}>
                <div className="wr-colors">{MARKS.map(col => <button key={col} data-close style={{ background: col }} aria-label={col} onClick={() => c().setHighlight({ color: col }).run()} />)}</div>
                <div className="wr-colfoot"><button data-close className="link" onClick={() => c().unsetHighlight().run()}>No highlight</button></div>
              </Drop>
              <Btn icon="clear" title="Clear formatting" onClick={() => c().unsetAllMarks().setParagraph().run()} />
            </div>
          </Group>
          <Group label="Paragraph">
            <div className="wr-row">
              <Btn icon="ul" title="Bullets" on={is('bulletList')} onClick={() => c().toggleBulletList().run()} />
              <Btn icon="ol" title="Numbering" on={is('orderedList')} onClick={() => c().toggleOrderedList().run()} />
              <Btn icon="task" title="Checklist" on={is('taskList')} onClick={() => c().toggleTaskList().run()} />
              <Btn icon="outdent" title="Decrease indent (Shift+Tab)" onClick={() => c().outdent().run()} />
              <Btn icon="indent" title="Increase indent (Tab)" onClick={() => c().indent().run()} />
            </div>
            <div className="wr-row">
              {['left', 'center', 'right', 'justify'].map(a => <Btn key={a} icon={a} title={`Align ${a}`} on={is({ textAlign: a })} onClick={() => c().setTextAlign(a).run()} />)}
              <Drop icon="spacing" title="Line and paragraph spacing">
                <div className="wr-menu">
                  {SPACING.map(([v, l]) => <button key={v} data-close aria-pressed={String(para.lineHeight || '') === v} onClick={() => c().setLineHeight(v).run()}>{l}</button>)}
                  <hr />
                  {[['0', 'No space after'], ['8', 'Space after: 8 pt'], ['12', 'Space after: 12 pt']].map(([v, l]) => <button key={v} data-close onClick={() => c().setSpaceAfter(v).run()}>{l}</button>)}
                </div>
              </Drop>
            </div>
          </Group>
          <Group label="Styles">
            <div className="wr-styles">{STYLES.map(([k, l]) => <button key={k} type="button" className={'wr-st st-' + k} aria-pressed={style === k} onMouseDown={e => e.preventDefault()} onClick={() => setStyle(k)}>{l}</button>)}</div>
          </Group>
          <Group label="Editing">
            <Btn icon="find" label="Find" big onClick={() => doc.openFind(false)} />
            <Btn icon="replace" label="Replace" big onClick={() => doc.openFind(true)} />
          </Group>
        </>}

        {cur === 'insert' && <>
          <Group label="Pages"><Btn icon="pagebreak" label="Page break" big title="Page break (Ctrl+Enter)" onClick={() => c().setPageBreak().run()} /></Group>
          <Group label="Tables">
            <Drop icon="table" label="Table" big>
              <div className="wr-grid" onMouseLeave={() => setGrid([0, 0])}>
                <b>{grid[0] ? `${grid[1]} × ${grid[0]} table` : 'Insert a table'}</b>
                <div>{Array.from({ length: 64 }, (_, i) => { const r = Math.floor(i / 8) + 1, col = (i % 8) + 1; return <button key={i} data-close aria-label={`${col} by ${r}`} className={r <= grid[0] && col <= grid[1] ? 'on' : ''} onMouseEnter={() => setGrid([r, col])} onClick={() => c().insertTable({ rows: r, cols: col, withHeaderRow: true }).run()} />; })}</div>
              </div>
            </Drop>
          </Group>
          <Group label="Illustrations"><Btn icon="image" label="Picture" big onClick={() => imgRef.current?.click()} /></Group>
          <Group label="Links">
            <Btn icon="link" label="Link" big on={is('link')} onClick={doc.editLink} />
            <Btn icon="comment" label="Comment" big onClick={doc.addComment} />
          </Group>
          <Group label="Text">
            <Btn icon="hr" label="Line" big onClick={() => c().setHorizontalRule().run()} />
            <Btn icon="date" label="Date" big onClick={() => c().insertContent(new Date().toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' })).run()} />
            <Drop icon="symbol" label="Symbol" big>
              <div className="wr-syms">{SYMBOLS.map(s => <button key={s} data-close onClick={() => c().insertContent(s).run()}>{s}</button>)}</div>
            </Drop>
            <Btn icon="toc" label="Contents" big title="A table of contents from the headings" onClick={doc.insertToc} />
          </Group>
        </>}

        {cur === 'layout' && <>
          <Group label="Page setup">
            <label className="wr-field"><Ico d={P.size} />Size<select value={doc.layout.size} onChange={e => doc.setLayout({ size: e.target.value })}><option>A4</option><option>Letter</option><option>Legal</option></select></label>
            <label className="wr-field"><Ico d={P.orient} />Orientation<select value={doc.layout.orientation} onChange={e => doc.setLayout({ orientation: e.target.value })}><option value="portrait">Portrait</option><option value="landscape">Landscape</option></select></label>
            <label className="wr-field"><Ico d={P.margins} />Margins<select value={doc.layout.margin} onChange={e => doc.setLayout({ margin: Number(e.target.value) })}><option value={1}>Normal (1″)</option><option value={0.5}>Narrow (0.5″)</option><option value={0.75}>Moderate (0.75″)</option><option value={1.5}>Wide (1.5″)</option></select></label>
          </Group>
          <Group label="Header & footer">
            <label className="wr-field"><Ico d={P.header} />Header<input value={doc.layout.header} placeholder="Text at the top of each page" onChange={e => doc.setLayout({ header: e.target.value.slice(0, 120) })} /></label>
            <label className="wr-field"><Ico d={P.footer} />Footer<input value={doc.layout.footer} placeholder="Text at the bottom" onChange={e => doc.setLayout({ footer: e.target.value.slice(0, 120) })} /></label>
            <label className="wr-field wr-check"><input type="checkbox" checked={doc.layout.pageNumbers !== false} onChange={e => doc.setLayout({ pageNumbers: e.target.checked })} />Page numbers</label>
          </Group>
        </>}

        {cur === 'review' && <>
          <Group label="Proofing">
            <Btn icon="spell" label="Spelling" big on={doc.spell} title="Underline spelling mistakes" onClick={doc.toggleSpell} />
            <Btn icon="count" label="Word count" big onClick={doc.wordCount} />
          </Group>
          <Group label="Comments">
            <Btn icon="comment" label="New comment" big onClick={doc.addComment} />
            <Btn icon="nav" label="Show comments" big on={doc.showComments} onClick={doc.toggleComments} />
          </Group>
          <Group label="Tracking">
            <Btn icon="track" label={doc.tracking ? 'Tracking: on' : 'Track changes'} big on={doc.tracking} onClick={doc.toggleTracking} />
          </Group>
          <Group label="Changes">
            <Btn icon="accept" label="Accept" big title="Accept this change" onClick={() => c().acceptChange().run()} />
            <Btn icon="reject" label="Reject" big title="Reject this change" onClick={() => c().rejectChange().run()} />
            <div className="wr-col">
              <Btn icon="prev" title="Previous change" onClick={() => c().goToChange(-1).run()}>Previous</Btn>
              <Btn icon="next" title="Next change" onClick={() => c().goToChange(1).run()}>Next</Btn>
            </div>
            <div className="wr-col">
              <Btn icon="accept" title="Accept all changes" onClick={() => c().acceptAllChanges().run()}>Accept all</Btn>
              <Btn icon="reject" title="Reject all changes" onClick={() => c().rejectAllChanges().run()}>Reject all</Btn>
            </div>
          </Group>
          <Group label="Compare"><Btn icon="compare" label="Compare" big title="Compare with an earlier version" onClick={doc.compare} /></Group>
        </>}

        {cur === 'view' && <>
          <Group label="Views">
            <Btn icon="read" label="Read mode" big on={doc.reading} onClick={doc.toggleReading} />
            <Btn icon="print" label="Print layout" big on={doc.layout.view !== 'web'} onClick={() => doc.setLayout({ view: 'print' })} />
            <Btn icon="web" label="Web layout" big on={doc.layout.view === 'web'} onClick={() => doc.setLayout({ view: 'web' })} />
          </Group>
          <Group label="Show"><Btn icon="nav" label="Navigation" big on={doc.showNav} onClick={doc.toggleNav} /><Btn icon="comment" label="Comments" big on={doc.showComments} onClick={doc.toggleComments} /></Group>
          <Group label="Zoom">
            <Btn icon="zoomOut" label="Out" big onClick={() => doc.setZoom(doc.zoom - 0.1)} />
            <Btn icon="zoomIn" label="In" big onClick={() => doc.setZoom(doc.zoom + 0.1)} />
            <Btn icon="fit" label="100%" big onClick={() => doc.setZoom(1)} />
            <Btn icon="fit" label="Page width" big onClick={doc.fitWidth} />
          </Group>
        </>}

        {cur === 'table' && <>
          <Group label="Rows & columns">
            <Btn icon="rowAbove" label="Row above" big onClick={() => c().addRowBefore().run()} />
            <Btn icon="rowBelow" label="Row below" big onClick={() => c().addRowAfter().run()} />
            <Btn icon="colLeft" label="Column left" big onClick={() => c().addColumnBefore().run()} />
            <Btn icon="colRight" label="Column right" big onClick={() => c().addColumnAfter().run()} />
          </Group>
          <Group label="Delete">
            <div className="wr-col">
              <Btn icon="del" onClick={() => c().deleteRow().run()}>Delete row</Btn>
              <Btn icon="del" onClick={() => c().deleteColumn().run()}>Delete column</Btn>
              <Btn icon="del" onClick={() => c().deleteTable().run()}>Delete table</Btn>
            </div>
          </Group>
          <Group label="Merge"><Btn icon="merge" label="Merge cells" big disabled={!editor.can().mergeCells()} onClick={() => c().mergeCells().run()} /><Btn icon="split" label="Split cell" big disabled={!editor.can().splitCell()} onClick={() => c().splitCell().run()} /></Group>
          <Group label="Style"><Btn icon="headRow" label="Header row" big onClick={() => c().toggleHeaderRow().run()} /></Group>
        </>}

        {cur === 'picture' && <>
          <Group label="Size">{['25%', '50%', '75%', '100%'].map(w => <Btn key={w} label={w} big on={editor.getAttributes('image').width === w} onClick={() => c().updateAttributes('image', { width: w }).run()}>{w}</Btn>)}</Group>
          <Group label="Position">{['left', 'center', 'right'].map(a => <Btn key={a} icon={a} label={a[0].toUpperCase() + a.slice(1)} big on={(editor.getAttributes('image').align || 'left') === a} onClick={() => c().updateAttributes('image', { align: a }).run()} />)}</Group>
          <Group label="Delete"><Btn icon="del" label="Remove" big onClick={() => c().deleteSelection().run()} /></Group>
        </>}
      </div>
      <input ref={imgRef} type="file" accept="image/*" hidden onChange={e => { doc.insertImage(e.target.files[0]); e.target.value = ''; }} />
      <input ref={docxRef} type="file" accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document" hidden onChange={e => { doc.openDocx(e.target.files[0]); e.target.value = ''; }} />
    </div>
  );
}
