import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { EditorContent, useEditor } from '@tiptap/react';
import { TextSelection } from '@tiptap/pm/state';
import { md } from '../lib/markdown.js';
import { NO_AI, copyFor, sampleP } from '../lib/ai.js';
import { TYPES } from '../lib/engines.js';
import { api, getVersion, listVersions } from '../lib/backend.js';
import { rid } from '../lib/utils.js';
import { wordExtensions } from '../lib/word/extensions.js';
import { pagesKey } from '../lib/word/pages.js';
import { findKey } from '../lib/word/find.js';
import { changesIn } from '../lib/word/track.js';
import { diffWords, fromDocx, hashOf, toDocx, toMarkdown } from '../lib/word/docio.js';
import WordRibbon from './WordRibbon.jsx';
import { useUI } from './ui.jsx';

/* The doc, as in Microsoft Word: a ribbon, pages with header, footer and page numbers, a navigation
   pane, comments, tracked changes, find and replace, version compare, .docx in and out, and printing.
   The doc is kept as HTML (file.docHtml) and, alongside, as Markdown (file.doc) for AI, search, exports
   and workflows; file.docSrc is the Markdown's hash when the HTML was saved, so a Markdown changed
   elsewhere (AI, a workflow) is read in again. Layout: file.docLayout; comments: file.docComments. */

const PAPER = { A4: [794, 1123], Letter: [816, 1056], Legal: [816, 1344] }; // px at 96 dpi
const GAP = 24;
const DEFAULT_LAYOUT = { size: 'A4', orientation: 'portrait', margin: 1, header: '', footer: '', pageNumbers: true, view: 'print' };
const TASKS = {
  draft: 'Write the full design doc for this file in markdown, 300 to 700 words, grounded in the diagrams above. Use sections: Context, Goals, Non-goals, Proposal, Alternatives considered, Risks and open questions. Keep any useful content from the current doc. Start with a "# " heading. Reply with only the markdown.',
  cont: 'Continue the doc from where it ends. Add the next section or two that it is missing. Reply with only the new markdown to append, without repeating existing text.',
  tight: 'Edit the doc for clarity and concision: cut filler, prefer active voice, keep all facts, structure and headings. Reply with only the full revised markdown.',
};
const pref = (k, d) => { try { const v = localStorage.getItem('linework:doc-' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } };
const keep = (k, v) => { try { localStorage.setItem('linework:doc-' + k, JSON.stringify(v)); } catch (e) { /* fine */ } };
const ago = t => { const s = Math.round((Date.now() - t) / 1000); return s < 60 ? 'just now' : s < 3600 ? `${Math.round(s / 60)} min ago` : s < 86400 ? `${Math.round(s / 3600)} h ago` : new Date(t).toLocaleDateString(); };
const save = (name, blob) => { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000); };
const safe = s => String(s || 'Document').replace(/[\\/:*?"<>|]+/g, ' ').trim() || 'Document';

// A picture as a data URL, at most 1600 px wide.
const readImage = f => new Promise((res, rej) => {
  const r = new FileReader();
  r.onerror = () => rej(new Error('Couldn’t read that picture.'));
  r.onload = () => {
    const src = r.result;
    if (f.size < 400_000 || !/^data:image\/(png|jpe?g|webp)/.test(src)) return res(src);
    const img = new window.Image();
    img.onload = () => {
      const k = Math.min(1, 1600 / img.naturalWidth), c = document.createElement('canvas');
      c.width = Math.round(img.naturalWidth * k); c.height = Math.round(img.naturalHeight * k);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      res(c.toDataURL(/png/.test(src) ? 'image/png' : 'image/jpeg', 0.86));
    };
    img.onerror = () => res(src);
    img.src = src;
  };
  r.readAsDataURL(f);
});

export default function WordDoc({ file, update }) {
  const { popup, ask, toast } = useUI();
  const layout = { ...DEFAULT_LAYOUT, ...(file.docLayout || {}) };
  const comments = file.docComments || [];
  const [userZoom, setZoomS] = useState(() => pref('zoom', 1));
  const [room, setRoom] = useState(0); // the desk's width, to shrink the page when it doesn't fit
  const [showNav, setShowNav] = useState(() => pref('nav', false));
  const [showComments, setShowComments] = useState(() => pref('comments', true));
  const [spell, setSpell] = useState(() => pref('spell', true));
  const [reading, setReading] = useState(false);
  const [find, setFind] = useState(null); // {replace: bool}
  const [painter, setPainter] = useState(null);
  const [compare, setCompare] = useState(false);
  const [busy, setBusy] = useState(false), [status, setStatus] = useState(''), [preview, setPreview] = useState(null);
  const [author, setAuthor] = useState('You');
  const scrollRef = useRef(null), ctl = useRef(null), lastMd = useRef(file.doc || ''), lastHtml = useRef(null), timer = useRef(0);
  const tracking = !!file.docTrack;

  // Live values the editor's extensions read.
  const [pw, ph] = PAPER[layout.size] || PAPER.A4;
  const land = layout.orientation === 'landscape';
  const pageW = land ? ph : pw, pageH = land ? pw : ph, margin = Math.round(layout.margin * 96);
  // The page never overflows the desk: in a narrow pane (Doc + Canvas) it shrinks to fit.
  const zoom = room ? Math.max(0.3, Math.min(userZoom, Math.floor(((room - 48) / pageW) * 100) / 100)) : userZoom;
  const live = useRef({});
  live.current = { layout: layout.view === 'web' ? null : { pageH, mTop: margin, mBottom: margin, gap: GAP }, tracking, author };

  useEffect(() => { api('/auth/me').then(r => setAuthor(r?.user?.name || (r?.user?.email || '').split('@')[0] || 'You'), () => {}); }, []);

  const initial = useMemo(() => (file.docHtml && file.docSrc === hashOf(file.doc || '') ? file.docHtml : md(file.doc || '')), [file.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const editor = useEditor({
    extensions: wordExtensions({
      placeholder: 'Start writing. Use the ribbon above for styles, tables, pictures and more.',
      user: () => live.current.author, tracking: () => live.current.tracking, pages: () => live.current.layout,
    }),
    content: initial,
    shouldRerenderOnTransaction: true,
    editorProps: { attributes: { class: 'wd-doc', spellcheck: String(spell), 'aria-label': 'Design doc' } },
    // What the doc looks like when opened: only real changes after that are saved.
    onCreate: ({ editor: ed }) => { lastHtml.current = ed.getHTML(); },
    onUpdate: ({ editor: ed }) => {
      clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        const html = ed.getHTML();
        if (html === lastHtml.current) return;
        lastHtml.current = html;
        const m = toMarkdown(ed.getJSON());
        lastMd.current = m;
        update(c => { c.docHtml = html; c.doc = m; c.docSrc = hashOf(m); });
      }, 250);
    },
  }, [file.id]);
  useEffect(() => () => clearTimeout(timer.current), []);

  // Something else changed the doc (AI, a workflow, another device): read it in.
  useEffect(() => {
    if (!editor) return;
    const cur = file.doc || '';
    if (cur === lastMd.current) return;
    lastMd.current = cur;
    editor.commands.setContent(file.docHtml && file.docSrc === hashOf(cur) ? file.docHtml : md(cur), { emitUpdate: false });
    lastHtml.current = editor.getHTML();
  }, [file.doc, file.docHtml, file.docSrc, editor]);

  useEffect(() => { if (editor) editor.setEditable(!reading && !busy); }, [editor, reading, busy]);
  useEffect(() => { if (editor) editor.view.dom.spellcheck = spell; keep('spell', spell); }, [editor, spell]);
  // Page size, margins or view changed: lay the pages out again.
  useEffect(() => { editor?.view.dom.__repaginate?.(); }, [editor, layout.view, layout.size, layout.orientation, layout.margin, zoom]);

  const setLayout = patch => update(c => { c.docLayout = { ...DEFAULT_LAYOUT, ...(c.docLayout || {}), ...patch }; });
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return undefined;
    const ro = new ResizeObserver(() => setRoom(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, [editor]);
  const setZoom = z => { const v = Math.round(Math.min(2.5, Math.max(0.3, z)) * 100) / 100; setZoomS(v); keep('zoom', v); };
  const fitWidth = () => { const el = scrollRef.current; if (el) setZoom((el.clientWidth - 64) / pageW); };

  /* ---- pages ---- */
  const pstate = editor ? pagesKey.getState(editor.state) : { pages: 1 };
  const pages = layout.view === 'web' ? 1 : pstate.pages;
  const stride = pageH + GAP;
  const curPage = (() => {
    if (!editor || layout.view === 'web') return 1;
    try {
      const top = editor.view.coordsAtPos(editor.state.selection.head).top - editor.view.dom.getBoundingClientRect().top;
      return Math.min(pages, Math.max(1, Math.floor(top / zoom / stride) + 1));
    } catch (e) { return 1; }
  })();

  /* ---- keys: find, replace, print ---- */
  useEffect(() => {
    const key = e => {
      if (!(e.ctrlKey || e.metaKey) || !scrollRef.current?.closest('.wd')?.isConnected) return;
      const k = e.key.toLowerCase();
      if (k === 'f' || k === 'h') { e.preventDefault(); setFind({ replace: k === 'h' }); }
      else if (k === 'p' && !e.shiftKey) { e.preventDefault(); print(); }
    };
    document.addEventListener('keydown', key);
    return () => document.removeEventListener('keydown', key);
  });

  /* ---- format painter: copy the formatting at the cursor, apply it to the next selection ---- */
  const togglePainter = () => {
    if (painter) { setPainter(null); return; }
    const { $from } = editor.state.selection;
    setPainter({ marks: $from.marks().filter(m => !['comment', 'insertion', 'deletion', 'link'].includes(m.type.name)), attrs: $from.parent.attrs });
    toast('Now select the text to format');
  };
  useEffect(() => {
    if (!painter || !editor) return undefined;
    const up = () => setTimeout(() => {
      if (editor.state.selection.empty) return;
      const ch = editor.chain().focus().unsetAllMarks();
      for (const m of painter.marks) ch.setMark(m.type.name, m.attrs);
      const { textAlign, lineHeight, indent } = painter.attrs;
      ch.updateAttributes('paragraph', { textAlign, lineHeight, indent }).updateAttributes('heading', { textAlign, lineHeight, indent }).run();
      setPainter(null);
    }, 0);
    document.addEventListener('mouseup', up);
    return () => document.removeEventListener('mouseup', up);
  }, [painter, editor]);

  /* ---- comments ---- */
  const setComments = fn => update(c => { c.docComments = fn(c.docComments || []); });
  const addComment = async () => {
    if (editor.state.selection.empty) { toast('Select the text to comment on first'); return; }
    const text = await ask({ title: 'New comment', multiline: true, ok: 'Comment' });
    if (!text || !text.trim()) return;
    const id = rid('cm');
    editor.chain().focus().setMark('comment', { id }).run();
    setComments(l => [...l, { id, author, time: Date.now(), text: text.trim(), replies: [], resolved: false }]);
    setShowComments(true); keep('comments', true);
  };
  const ranges = useCallback(id => {
    const out = [];
    editor?.state.doc.descendants((n, pos) => { if (n.isText && n.marks.some(m => m.type.name === 'comment' && m.attrs.id === id)) out.push([pos, pos + n.nodeSize]); });
    return out;
  }, [editor]);
  const removeComment = id => {
    const tr = editor.state.tr;
    for (const [a, b] of ranges(id)) tr.removeMark(a, b, editor.schema.marks.comment);
    editor.view.dispatch(tr.setMeta('trackSkip', true));
    setComments(l => l.filter(c => c.id !== id));
  };
  const goTo = (from, to = from) => {
    editor.chain().focus().command(({ tr }) => { tr.setSelection(TextSelection.create(tr.doc, from, to)).scrollIntoView(); return true; }).run();
  };

  /* ---- insert ---- */
  const editLink = async () => {
    const was = editor.getAttributes('link').href || '';
    const href = await ask({ title: was ? 'Edit link' : 'Insert link', text: 'The web address (leave it empty to remove the link).', value: was || 'https://' });
    if (href === null || href === undefined) return;
    const v = String(href).trim();
    if (!v || v === 'https://') { editor.chain().focus().extendMarkRange('link').unsetLink().run(); return; }
    if (editor.state.selection.empty && !was) editor.chain().focus().insertContent({ type: 'text', text: v, marks: [{ type: 'link', attrs: { href: v } }] }).run();
    else editor.chain().focus().extendMarkRange('link').setLink({ href: v }).run();
  };
  const insertImage = async f => {
    if (!f) return;
    try { const src = await readImage(f); editor.chain().focus().setImage({ src, alt: f.name }).run(); }
    catch (e) { toast(e.message); }
  };
  const insertToc = () => {
    const heads = [];
    editor.state.doc.descendants(n => { if (n.type.name === 'heading') heads.push(n); return n.type.name !== 'heading'; });
    if (!heads.length) { toast('Add some headings first: the contents list them'); return; }
    editor.chain().focus().insertContent([
      { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Contents' }] },
      ...heads.map(h => ({ type: 'paragraph', attrs: { indent: Math.max(0, h.attrs.level - 1) }, content: [{ type: 'text', text: h.textContent || ' ' }] })),
      { type: 'pageBreak' }, { type: 'paragraph' },
    ]).run();
  };

  /* ---- files out and in ---- */
  const exportDocx = async () => {
    try { toast('Making the Word file…'); save(`${safe(file.title)}.docx`, await toDocx(editor.getJSON(), { layout, title: file.title })); }
    catch (e) { console.error(e); toast('Couldn’t make the Word file.'); }
  };
  const exportMarkdown = () => save(`${safe(file.title)}.md`, new Blob([toMarkdown(editor.getJSON())], { type: 'text/markdown' }));
  const openDocx = async f => {
    if (!f) return;
    if (!editor.isEmpty && !await ask({ title: `Open “${f.name}”?`, text: 'It replaces what’s in this doc now (Undo brings it back).', input: false, ok: 'Replace' })) return;
    try {
      const { html, warnings } = await fromDocx(f);
      editor.chain().focus().setContent(html, { emitUpdate: true }).run();
      toast(warnings ? `Opened. ${warnings} thing${warnings === 1 ? '' : 's'} Word had couldn’t come across.` : 'Opened');
    } catch (e) { console.error(e); toast('That doesn’t look like a Word (.docx) file.'); }
  };
  const print = () => {
    const w = window.open('', '_blank');
    if (!w) { toast('Allow pop-ups for this site to print.'); return; }
    const sz = `${layout.size} ${layout.orientation}`;
    w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${safe(file.title)}</title><style>
      @page{size:${sz};margin:${layout.margin}in}
      body{margin:0;font:12pt/1.5 "Source Serif 4",Georgia,serif;color:#111}
      h1{font-size:22pt}h2{font-size:17pt}h3{font-size:14pt}h4{font-size:12pt}
      h1,h2,h3,h4{font-family:"Bricolage Grotesque",Arial,sans-serif;margin:14pt 0 6pt;break-after:avoid}
      p{margin:0 0 8pt}table{border-collapse:collapse;width:100%;margin:6pt 0}td,th{border:1px solid #999;padding:4pt 6pt;vertical-align:top}th{background:#f2f2f2}
      img{max-width:100%}img[data-align=center]{display:block;margin:auto}img[data-align=right]{display:block;margin-left:auto}
      blockquote{margin:0 0 8pt;padding-left:12pt;border-left:3pt solid #ccc;color:#444}pre{font:10pt "Courier New",monospace;background:#f5f5f5;padding:6pt;white-space:pre-wrap}
      .wd-break{break-after:page;height:0}del{display:none}ins{text-decoration:none}.wd-comment{background:none}
      ul[data-type=taskList]{list-style:none;padding-left:0}ul[data-type=taskList] li{display:flex;gap:6pt}ul[data-type=taskList] p{margin:0}
      .hd,.ft{position:fixed;left:0;right:0;font:9pt Arial,sans-serif;color:#777}.hd{top:-0.6in}.ft{bottom:-0.6in;text-align:center}
    </style></head><body>${layout.header ? `<div class="hd">${layout.header.replace(/</g, '&lt;')}</div>` : ''}${layout.footer ? `<div class="ft">${layout.footer.replace(/</g, '&lt;')}</div>` : ''}${editor.getHTML()}</body></html>`);
    w.document.close();
    w.onload = () => setTimeout(() => { w.focus(); w.print(); }, 250);
  };

  /* ---- AI (as before: draft, continue, tighten, anything) ---- */
  const run = async (kind, custom) => {
    const sample = await sampleP;
    if (!sample) { setStatus(NO_AI); return; }
    const before = toMarkdown(editor.getJSON()).trim() === '' ? '' : toMarkdown(editor.getJSON());
    const diagrams = (file.diagrams || []).filter(d => d.code && d.code.trim()).map(d => `Diagram "${d.name}" (${TYPES[d.type]?.name || 'Architecture'}):\n${d.code}`).join('\n\n') || '(no diagrams yet)';
    const task = kind === 'custom' ? `Apply this request to the doc: "${custom}". Reply with only the full revised markdown.` : TASKS[kind];
    const prompt = `You are the writing assistant in Workline, a tool for technical design docs. File title: "${file.title}".\n\nDiagrams in this file:\n${diagrams}\n\nCurrent doc (markdown):\n<<<\n${before || '(empty)'}\n>>>\n\n${task}`;
    const join = t => (kind === 'cont' ? before.replace(/\s*$/, '\n\n') + t : t);
    ctl.current = new AbortController();
    setBusy(true); setStatus('Writing'); setPreview(join(''));
    try {
      const { text } = await sample(prompt, { signal: ctl.current.signal, cache: false, onText: ({ text: t }) => setPreview(join(t)) });
      const clean = text.replace(/^```(?:markdown|md)?\s*\n/, '').replace(/\n```\s*$/, '').trim();
      if (kind === 'cont') editor.chain().focus('end').insertContent(md(clean)).run();
      else editor.chain().setContent(md(clean), { emitUpdate: true }).run();
      setStatus('');
    } catch (e) {
      setStatus(e && e.code === 'cancelled' ? 'Stopped. Your doc wasn’t changed.' : copyFor(e && e.code));
    } finally { ctl.current = null; setBusy(false); setPreview(null); }
  };
  const openAI = e => {
    if (ctl.current) { ctl.current.abort(); return; }
    popup(e.currentTarget, [
      { label: 'Draft from diagrams', note: 'Writes a full design doc', act: () => run('draft') },
      { label: 'Continue writing', note: 'Adds the next missing sections', act: () => run('cont') },
      { label: 'Tighten wording', note: 'Shorter and clearer, same content', act: () => run('tight') },
      { label: 'Something else', note: 'Tell AI what to change', act: async () => { const v = await ask({ title: 'What should AI change?', multiline: true, ok: 'Apply' }); if (v && v.trim()) run('custom', v.trim()); } },
    ]);
  };

  if (!editor) return <div className="docpane" />;
  const words = editor.storage.characterCount.words(), chars = editor.storage.characterCount.characters();
  const changes = changesIn(editor.state.doc);
  const wordCount = () => ask({ title: 'Word count', text: `Pages: ${pages} · Words: ${words.toLocaleString()} · Characters: ${chars.toLocaleString()} · Paragraphs: ${editor.state.doc.childCount}`, input: false, ok: 'OK' });
  const doc = {
    layout, setLayout, zoom, setZoom, fitWidth, spell, toggleSpell: () => setSpell(!spell), reading, toggleReading: () => setReading(!reading),
    showNav, toggleNav: () => { setShowNav(!showNav); keep('nav', !showNav); }, showComments, toggleComments: () => { setShowComments(!showComments); keep('comments', !showComments); },
    tracking, toggleTracking: () => { update(c => { c.docTrack = !c.docTrack; }); toast(tracking ? 'Track changes is off' : 'Track changes is on: edits are marked until accepted'); },
    painter, togglePainter, addComment, editLink, insertImage, insertToc, exportDocx, exportMarkdown, openDocx, print, wordCount,
    compare: () => setCompare(true), openFind: replace => setFind({ replace }),
    aiButton: <button className={'btn ' + (busy ? 'dark' : 'primary') + ' wr-ai'} aria-haspopup="menu" onClick={openAI}>{busy ? 'Stop' : 'Ask AI'}</button>,
  };

  const heads = [];
  editor.state.doc.descendants((n, pos) => { if (n.type.name === 'heading') { heads.push({ pos, level: n.attrs.level, text: n.textContent }); return false; } return true; });
  const here = editor.state.selection.from;
  const activeHead = [...heads].reverse().find(h => h.pos <= here);
  const activeComment = editor.getAttributes('comment').id;
  const placed = comments.map(cm => ({ ...cm, at: ranges(cm.id) })).sort((a, b) => (a.at[0]?.[0] ?? 1e9) - (b.at[0]?.[0] ?? 1e9));
  const sheetStyle = { '--pw': `${pageW}px`, '--ph': `${pageH}px`, '--m': `${margin}px`, '--gap': `${GAP}px` };
  const total = layout.view === 'web' ? null : pages * stride - GAP;

  return (
    <div className={'docpane wd' + (reading ? ' reading' : '')}>
      {reading ? (
        <div className="wd-readbar"><b>Read mode</b><span className="grow" /><button className="btn" onClick={() => setReading(false)}>Edit the doc</button></div>
      ) : <WordRibbon editor={editor} doc={doc} />}
      {status && <div className={'dstat' + (busy ? ' busy' : '')}>{status}</div>}
      <div className="wd-main">
        {showNav && !reading && (
          <aside className="wd-nav" aria-label="Navigation">
            <header><b>Navigation</b><button className="link" onClick={doc.toggleNav}>Close</button></header>
            {heads.length ? heads.map(h => <button key={h.pos} className={'lv' + h.level + (activeHead?.pos === h.pos ? ' on' : '')} onClick={() => goTo(h.pos + 1)}>{h.text || '(empty heading)'}</button>)
              : <p className="muted">Headings appear here. Use the Heading styles on the Home tab.</p>}
          </aside>
        )}
        {find && <FindBar editor={editor} toast={toast} replace={find.replace} onReplace={() => setFind({ replace: true })} onClose={() => { setFind(null); editor.commands.clearFind(); editor.commands.focus(); }} />}
        <div className="wd-scroll" ref={scrollRef}>
          {preview != null ? <div className="wd-stack" style={sheetStyle}><div className="wd-web prose" dangerouslySetInnerHTML={{ __html: md(preview) }} /></div> : (
            <div className="wd-zoomwrap" style={{ width: pageW * zoom, height: total ? total * zoom : undefined }}>
              <div className={'wd-stack' + (layout.view === 'web' ? ' web' : '') + (painter ? ' painting' : '')} style={{ ...sheetStyle, transform: `scale(${zoom})`, minHeight: total || undefined }}>
                {layout.view !== 'web' && Array.from({ length: pages }, (_, i) => (
                  <div key={i} className="wd-sheet" style={{ top: i * stride }} aria-hidden="true">
                    {layout.header && <div className="wd-hd">{layout.header}</div>}
                    {(layout.footer || layout.pageNumbers !== false) && <div className="wd-ft"><span>{layout.footer}</span>{layout.pageNumbers !== false && <span>Page {i + 1} of {pages}</span>}</div>}
                  </div>
                ))}
                <EditorContent editor={editor} className="wd-content" />
              </div>
            </div>
          )}
        </div>
        {showComments && !reading && (comments.length > 0 || changes.length > 0) && (
          <aside className="wd-side" aria-label="Comments and changes">
            {changes.length > 0 && (
              <section className="wd-changes">
                <header><b>Changes</b><small>{changes.length}</small></header>
                {changes.slice(0, 50).map((ch, i) => (
                  <div key={i} className={'wd-chg ' + ch.kind}>
                    <button className="wd-chg-t" onClick={() => goTo(ch.from, ch.to)}><b>{ch.author || 'Someone'}</b> {ch.kind === 'insertion' ? 'added' : 'deleted'} <q>{ch.text.slice(0, 60)}</q></button>
                    <span><button className="link" onClick={() => { goTo(ch.from, ch.to); editor.commands.acceptChange(); }}>Accept</button><button className="link" onClick={() => { goTo(ch.from, ch.to); editor.commands.rejectChange(); }}>Reject</button></span>
                  </div>
                ))}
              </section>
            )}
            {placed.length > 0 && <header><b>Comments</b><small>{placed.filter(c => !c.resolved).length} open</small></header>}
            {placed.map(cm => (
              <Comment key={cm.id} cm={cm} active={activeComment === cm.id} quote={cm.at.length ? editor.state.doc.textBetween(cm.at[0][0], cm.at[cm.at.length - 1][1], ' ') : ''}
                author={author} onGo={() => cm.at.length && goTo(cm.at[0][0], cm.at[cm.at.length - 1][1])}
                onChange={patch => setComments(l => l.map(x => (x.id === cm.id ? { ...x, ...patch } : x)))} onDelete={() => removeComment(cm.id)} />
            ))}
          </aside>
        )}
      </div>
      <footer className="wd-status">
        <span>Page {curPage} of {pages}</span><span>{words.toLocaleString()} words</span><span className="wd-hide-s">{chars.toLocaleString()} characters</span>
        {tracking && <button className="wd-trk" onClick={doc.toggleTracking}>Track changes: On</button>}
        {changes.length > 0 && <span className="wd-hide-s">{changes.length} change{changes.length === 1 ? '' : 's'}</span>}
        <span className="grow" />
        <button className="wr-b" aria-label="Zoom out" onClick={() => setZoom(zoom - 0.1)}>−</button>
        <input type="range" min="30" max="250" step="5" value={Math.round(zoom * 100)} aria-label="Zoom" onChange={e => setZoom(Number(e.target.value) / 100)} />
        <button className="wr-b" aria-label="Zoom in" onClick={() => setZoom(zoom + 0.1)}>+</button>
        <button className="wd-zoomv" onClick={() => setZoom(1)} title="Back to 100%">{Math.round(zoom * 100)}%</button>
      </footer>
      {compare && <Compare file={file} current={toMarkdown(editor.getJSON())} onClose={() => setCompare(false)} />}
    </div>
  );
}

function Comment({ cm, active, quote, author, onGo, onChange, onDelete }) {
  const [reply, setReply] = useState('');
  const send = () => { if (!reply.trim()) return; onChange({ replies: [...(cm.replies || []), { author, time: Date.now(), text: reply.trim() }] }); setReply(''); };
  return (
    <div className={'wd-cm' + (active ? ' on' : '') + (cm.resolved ? ' done' : '')} onClick={onGo}>
      <div className="wd-cm-h"><b>{cm.author}</b><small>{ago(cm.time)}</small></div>
      {quote ? <q>{quote.slice(0, 80)}{quote.length > 80 ? '…' : ''}</q> : <q className="gone">The commented text was removed</q>}
      <p>{cm.text}</p>
      {(cm.replies || []).map((r, i) => <div key={i} className="wd-rep"><b>{r.author}</b> <small>{ago(r.time)}</small><p>{r.text}</p></div>)}
      {!cm.resolved && <div className="wd-cm-r" onClick={e => e.stopPropagation()}><input value={reply} placeholder="Reply…" aria-label="Reply" onChange={e => setReply(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') send(); }} />{reply && <button className="btn" onClick={send}>Reply</button>}</div>}
      <div className="wd-cm-a" onClick={e => e.stopPropagation()}>
        <button className="link" onClick={() => onChange({ resolved: !cm.resolved })}>{cm.resolved ? 'Reopen' : 'Resolve'}</button>
        <button className="link" onClick={onDelete}>Delete</button>
      </div>
    </div>
  );
}

function FindBar({ editor, toast, replace, onReplace, onClose }) {
  const [q, setQ] = useState(''), [w, setW] = useState(''), [mc, setMc] = useState(false), [ww, setWw] = useState(false);
  const ref = useRef(null);
  useEffect(() => { ref.current?.focus(); const sel = editor.state.doc.textBetween(editor.state.selection.from, editor.state.selection.to, ' '); if (sel && sel.length < 80) setQ(sel); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { editor.commands.setFind({ query: q, matchCase: mc, wholeWord: ww }); }, [q, mc, ww, editor]);
  const f = findKey.getState(editor.state);
  const key = e => { if (e.key === 'Escape') onClose(); if (e.key === 'Enter') { e.preventDefault(); e.shiftKey ? editor.commands.findPrev() : editor.commands.findNext(); } };
  return (
    <div className="wd-find-bar" role="search">
      <div className="wd-fr">
        <input ref={ref} value={q} placeholder="Find" aria-label="Find" onChange={e => setQ(e.target.value)} onKeyDown={key} />
        <small>{q ? (f.matches.length ? `${f.index + 1} of ${f.matches.length}` : 'No results') : ''}</small>
        <button className="wr-b" aria-label="Previous match" onClick={() => editor.commands.findPrev()}>↑</button>
        <button className="wr-b" aria-label="Next match" onClick={() => editor.commands.findNext()}>↓</button>
        {!replace && <button className="link" onClick={onReplace}>Replace</button>}
        <button className="wr-b" aria-label="Close find" onClick={onClose}>×</button>
      </div>
      <div className="wd-fr opts">
        <label><input type="checkbox" checked={mc} onChange={e => setMc(e.target.checked)} />Match case</label>
        <label><input type="checkbox" checked={ww} onChange={e => setWw(e.target.checked)} />Whole words</label>
      </div>
      {replace && (
        <div className="wd-fr">
          <input value={w} placeholder="Replace with" aria-label="Replace with" onChange={e => setW(e.target.value)} onKeyDown={e => { if (e.key === 'Escape') onClose(); }} />
          <button className="btn" disabled={!f.matches.length} onClick={() => { editor.commands.replaceMatch(w); editor.commands.findNext(); }}>Replace</button>
          <button className="btn" disabled={!f.matches.length} onClick={() => { const n = f.matches.length; editor.commands.replaceAll(w); toast(`Replaced ${n}`); }}>Replace all</button>
        </div>
      )}
    </div>
  );
}

// Compare the doc with an earlier version (account files keep versions on the server).
function Compare({ file, current, onClose }) {
  const [list, setList] = useState(null), [err, setErr] = useState(''), [pick, setPick] = useState(null), [diff, setDiff] = useState(null);
  useEffect(() => { listVersions(file.id).then(setList, () => setErr('Version history is kept for files in your account. Sign in to compare versions.')); }, [file.id]);
  const choose = async v => {
    setPick(v); setDiff(null);
    try { const { file: old } = await getVersion(file.id, v.id); setDiff(diffWords(old.doc || '', current)); }
    catch (e) { setErr('Couldn’t load that version.'); }
  };
  const added = diff ? diff.filter(d => d[0] === '+').reduce((n, d) => n + (d[1].match(/\S+/g) || []).length, 0) : 0;
  const removed = diff ? diff.filter(d => d[0] === '-').reduce((n, d) => n + (d[1].match(/\S+/g) || []).length, 0) : 0;
  return (
    <div className="modal" onPointerDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="mbox wd-cmp" role="dialog" aria-modal="true" aria-label="Compare versions">
        <h3>Compare with an earlier version</h3>
        {err ? <p className="muted">{err}</p> : !list ? <p className="muted">Loading versions…</p> : !list.length ? <p className="muted">No earlier versions yet.</p> : (
          <div className="wd-cmp-body">
            <ul className="wd-cmp-list">{list.map(v => <li key={v.id}><button aria-pressed={pick?.id === v.id} onClick={() => choose(v)}>{new Date(v.saved).toLocaleString()}</button></li>)}</ul>
            <div className="wd-cmp-diff">
              {!pick ? <p className="muted">Pick a version to see what changed since then.</p> : !diff ? <p className="muted">Comparing…</p> : (<>
                <p className="wd-cmp-sum"><span className="add">+{added} words</span> <span className="rem">−{removed} words</span></p>
                <div className="wd-cmp-text">{diff.map(([k, t], i) => (k === '=' ? <span key={i}>{t}</span> : k === '+' ? <ins key={i}>{t}</ins> : <del key={i}>{t}</del>))}</div>
              </>)}
            </div>
          </div>
        )}
        <div className="mact"><button className="btn dark" onClick={onClose}>Close</button></div>
      </div>
    </div>
  );
}
