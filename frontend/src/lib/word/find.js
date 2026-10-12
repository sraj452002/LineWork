import { Extension } from '@tiptap/core';
import { Plugin, PluginKey, TextSelection } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';

/* Find and replace: every match is highlighted, the current one more strongly. The plugin keeps
   {query, matchCase, wholeWord, matches: [{from, to}], index}. */

export const findKey = new PluginKey('find');
const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function search(doc, { query, matchCase, wholeWord }) {
  if (!query) return [];
  const re = new RegExp(wholeWord ? `\\b${esc(query)}\\b` : esc(query), matchCase ? 'g' : 'gi');
  const out = [];
  doc.descendants((block, pos) => {
    if (!block.isTextblock) return true;
    // The block's text, one character per position (non-text inline nodes count as one).
    let text = '';
    block.forEach(n => { text += n.isText ? n.text : '￼'; });
    for (const m of text.matchAll(re)) if (m[0]) out.push({ from: pos + 1 + m.index, to: pos + 1 + m.index + m[0].length });
    return false;
  });
  return out;
}

const empty = { query: '', matchCase: false, wholeWord: false, matches: [], index: 0 };

export const Find = Extension.create({
  name: 'find',
  addCommands() {
    const set = patch => ({ state, dispatch }) => { if (dispatch) dispatch(state.tr.setMeta(findKey, patch)); return true; };
    const go = dir => ({ state, dispatch, view }) => {
      const f = findKey.getState(state);
      if (!f.matches.length) return false;
      const at = dir > 0 ? state.selection.to : state.selection.from;
      let i = dir > 0 ? f.matches.findIndex(m => m.from >= at) : f.matches.map(m => m.to <= at).lastIndexOf(true);
      if (i < 0) i = dir > 0 ? 0 : f.matches.length - 1;
      const m = f.matches[i];
      if (dispatch) { dispatch(state.tr.setSelection(TextSelection.create(state.doc, m.from, m.to)).setMeta(findKey, { index: i }).scrollIntoView()); view?.focus(); }
      return true;
    };
    return {
      setFind: opts => set({ ...opts, index: 0 }),
      clearFind: () => set({ ...empty }),
      findNext: () => go(1),
      findPrev: () => go(-1),
      replaceMatch: text => ({ state, dispatch }) => {
        const f = findKey.getState(state), m = f.matches[f.index];
        if (!m) return false;
        if (dispatch) dispatch(state.tr.insertText(text, m.from, m.to));
        return true;
      },
      replaceAll: text => ({ state, dispatch }) => {
        const f = findKey.getState(state);
        if (!f.matches.length) return false;
        if (dispatch) { const tr = state.tr; for (const m of [...f.matches].reverse()) tr.insertText(text, m.from, m.to); dispatch(tr); }
        return true;
      },
    };
  },
  addProseMirrorPlugins() {
    return [new Plugin({
      key: findKey,
      state: {
        init: () => ({ ...empty }),
        apply(tr, prev, _old, state) {
          const meta = tr.getMeta(findKey);
          if (!meta && !tr.docChanged) return prev;
          const next = { ...prev, ...(meta || {}) };
          if (meta && 'query' in meta || tr.docChanged || (meta && ('matchCase' in meta || 'wholeWord' in meta))) next.matches = search(state.doc, next);
          next.index = Math.min(next.index || 0, Math.max(0, next.matches.length - 1));
          return next;
        },
      },
      props: {
        decorations(state) {
          const f = findKey.getState(state);
          if (!f.matches.length) return null;
          return DecorationSet.create(state.doc, f.matches.map((m, i) => Decoration.inline(m.from, m.to, { class: i === f.index ? 'wd-find on' : 'wd-find' })));
        },
      },
    })];
  },
});
