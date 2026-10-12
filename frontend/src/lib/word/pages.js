import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';

/* Pages, as in Word's print layout. The document is one editable column the width of the page's text
   area, drawn over a stack of paper sheets (WordDoc.jsx). After each change this plugin measures the
   top-level blocks and, before any block that would run past the bottom of its page (or that follows a
   page break), adds a gap so it starts at the top of the next page. A block taller than a page (a big
   table) starts a page and runs over.
   layout() gives {pageH, mTop, mBottom, gap} in px, or null for one long page (web layout). */

export const pagesKey = new PluginKey('pages');
const same = (a, b) => a.length === b.length && a.every((g, i) => g.pos === b[i].pos && Math.abs(g.h - b[i].h) < 1);

function measure(view, L) {
  const state = pagesKey.getState(view.state);
  const H = L.pageH - L.mTop - L.mBottom, stride = L.pageH + L.gap;
  const blocks = [];
  view.state.doc.forEach((node, pos) => { const el = view.nodeDOM(pos); if (el && el.nodeType === 1) blocks.push({ node, pos, el }); });
  // Where each block would be without the gaps there now.
  let gi = 0, before = 0;
  const gaps = [...state.gaps].sort((a, b) => a.pos - b.pos);
  for (const b of blocks) {
    while (gi < gaps.length && gaps[gi].pos <= b.pos) before += gaps[gi++].h;
    b.top = b.el.offsetTop - before - L.mTop;
    b.h = b.el.offsetHeight;
  }
  const out = [];
  let shift = 0, end = 0;
  blocks.forEach((b, i) => {
    const y = b.top + shift;
    const forced = i > 0 && blocks[i - 1].node.type.name === 'pageBreak';
    const page = Math.floor(y / stride);
    if ((forced && y > page * stride + 1) || (y + b.h > page * stride + H && y > page * stride + 1)) {
      const h = (page + 1) * stride - y;
      out.push({ pos: b.pos, h });
      shift += h;
    }
    end = b.top + shift + b.h;
  });
  return { gaps: out, pages: Math.max(1, Math.floor(Math.max(0, end - 1) / stride) + 1) };
}

export const Pages = Extension.create({
  name: 'pages',
  addOptions: () => ({ layout: () => null }),
  addProseMirrorPlugins() {
    const opts = this.options;
    return [new Plugin({
      key: pagesKey,
      state: {
        init: () => ({ gaps: [], pages: 1 }),
        apply(tr, prev) {
          const meta = tr.getMeta(pagesKey);
          if (meta) return meta;
          if (!tr.docChanged) return prev;
          return { ...prev, gaps: prev.gaps.map(g => ({ ...g, pos: tr.mapping.map(g.pos, -1) })) };
        },
      },
      props: {
        decorations(state) {
          const { gaps } = pagesKey.getState(state);
          if (!gaps.length) return null;
          return DecorationSet.create(state.doc, gaps.map(g => Decoration.widget(g.pos, () => {
            const d = document.createElement('div');
            d.className = 'wd-gap';
            d.style.height = `${g.h}px`;
            d.setAttribute('contenteditable', 'false');
            return d;
          }, { side: -1, key: `gap-${g.pos}-${Math.round(g.h)}`, ignoreSelection: true })));
        },
      },
      view(view) {
        let frame = 0, alive = true;
        const run = () => {
          frame = 0;
          if (!alive || !view.dom.isConnected) return;
          const L = opts.layout();
          const cur = pagesKey.getState(view.state);
          const next = L ? measure(view, L) : { gaps: [], pages: 1 };
          if (same(cur.gaps, next.gaps) && cur.pages === next.pages) return;
          view.dispatch(view.state.tr.setMeta(pagesKey, next).setMeta('addToHistory', false).setMeta('trackSkip', true));
        };
        const schedule = () => { if (!frame) frame = requestAnimationFrame(run); };
        const ro = new ResizeObserver(schedule);
        ro.observe(view.dom);
        const onLoad = () => schedule();
        view.dom.addEventListener('load', onLoad, true);
        document.fonts?.ready.then(schedule);
        view.dom.__repaginate = schedule;
        schedule();
        return {
          update: (v, prev) => { if (v.state.doc !== prev.doc || !pagesKey.getState(v.state).gaps.length) schedule(); },
          destroy: () => { alive = false; ro.disconnect(); view.dom.removeEventListener('load', onLoad, true); if (frame) cancelAnimationFrame(frame); },
        };
      },
    })];
  },
});
