import { Extension } from '@tiptap/core';
import { Plugin, PluginKey, TextSelection } from '@tiptap/pm/state';
import { ReplaceStep } from '@tiptap/pm/transform';
import { Fragment, Slice } from '@tiptap/pm/model';

/* Track changes, as in Word: while it's on, typed text is kept as an insertion and removed text as a
   deletion (struck through, still there) until someone accepts or rejects them. Removing text that is
   itself a tracked insertion just removes it.
   It works on plain edits (typing, deleting, pasting within a paragraph); splitting or joining
   paragraphs and formatting changes go through untracked. */

const key = new PluginKey('trackChanges');
const has = (node, name) => node.marks.some(m => m.type.name === name);

// The slice with every text node marked as inserted.
function markSlice(slice, mark) {
  const walk = frag => {
    const out = [];
    frag.forEach(n => {
      if (n.isText) out.push(n.mark(mark.addToSet(n.marks.filter(m => m.type.name !== 'deletion'))));
      else out.push(n.copy(walk(n.content)));
    });
    return Fragment.fromArray(out);
  };
  return new Slice(walk(slice.content), slice.openStart, slice.openEnd);
}

// A transaction as Word would record it.
export function trackTransaction(tr, state, author) {
  if (!tr.docChanged || tr.getMeta('trackSkip') || tr.getMeta('history$') || tr.steps.length !== 1) return tr;
  const step = tr.steps[0];
  if (!(step instanceof ReplaceStep) || step.structure) return tr;
  const { from, to, slice } = step;
  if (slice.openStart > 0 || slice.openEnd > 0) return tr; // splitting a paragraph, a paste of several: as they are
  const { schema, doc } = state;
  const now = Date.now();
  // Typing on from your own insertion carries it on (one change, not one per letter).
  const near = doc.resolve(from).marks().find(m => m.type.name === 'insertion' && m.attrs.author === author);
  const ins = near || schema.marks.insertion.create({ author, time: now });
  const del = schema.marks.deletion.create({ author, time: now });
  const out = state.tr;
  if (to > from) {
    const parts = [];
    let other = false;
    doc.nodesBetween(from, to, (n, pos) => {
      if (n.isText) parts.push({ s: Math.max(from, pos), e: Math.min(to, pos + n.nodeSize), ins: has(n, 'insertion'), del: has(n, 'deletion') });
      else if (n.isInline || (n.isBlock && !n.isTextblock && pos >= from && pos + n.nodeSize <= to)) other = true;
      return true;
    });
    if (!parts.length || other) return tr; // images, whole blocks: as they are
    // Across paragraphs: only the text is marked; the paragraphs stay apart.
    for (const p of parts.reverse()) {
      if (p.ins) out.delete(p.s, p.e);
      else if (!p.del) out.addMark(p.s, p.e, del);
    }
  }
  let caret = out.mapping.map(from, -1);
  if (slice.size) {
    const at = out.mapping.map(to);
    const marked = markSlice(slice, ins);
    out.replace(at, at, marked);
    caret = at + marked.size;
  }
  out.setSelection(TextSelection.create(out.doc, Math.min(caret, out.doc.content.size)));
  out.setStoredMarks(null);
  out.scrollIntoView();
  out.setMeta('trackSkip', true);
  out.setMeta('tracked', true);
  return out;
}

// The tracked changes in a document: [{from, to, kind: 'insertion'|'deletion', author, time}], runs joined.
export function changesIn(doc) {
  const list = [];
  doc.descendants((n, pos) => {
    if (!n.isText) return true;
    for (const kind of ['insertion', 'deletion']) {
      const m = n.marks.find(x => x.type.name === kind);
      if (!m) continue;
      const last = list[list.length - 1];
      if (last && last.kind === kind && last.to === pos && last.author === m.attrs.author) last.to = pos + n.nodeSize;
      else list.push({ from: pos, to: pos + n.nodeSize, kind, author: m.attrs.author, time: m.attrs.time, text: '' });
    }
    return false;
  });
  for (const c of list) c.text = doc.textBetween(c.from, c.to, ' ');
  return list;
}

// Accept or reject the changes in [from, to] (all of them without a range).
function settle(state, dispatch, accept, range) {
  const all = changesIn(state.doc).filter(c => !range || (c.to > range.from && c.from < range.to) || (range.from === range.to && c.from <= range.from && c.to >= range.from));
  if (!all.length) return false;
  if (!dispatch) return true;
  const tr = state.tr.setMeta('trackSkip', true);
  for (const c of all.reverse()) {
    const drop = (c.kind === 'insertion') !== accept; // reject an insertion, accept a deletion: the text goes
    if (drop) tr.delete(c.from, c.to);
    else tr.removeMark(c.from, c.to, state.schema.marks[c.kind]);
  }
  dispatch(tr);
  return true;
}

export const TrackChanges = Extension.create({
  name: 'trackChanges',
  addOptions: () => ({ user: () => 'You', enabled: () => false }),
  addCommands() {
    return {
      acceptChange: () => ({ state, dispatch }) => settle(state, dispatch, true, state.selection),
      rejectChange: () => ({ state, dispatch }) => settle(state, dispatch, false, state.selection),
      acceptAllChanges: () => ({ state, dispatch }) => settle(state, dispatch, true, null),
      rejectAllChanges: () => ({ state, dispatch }) => settle(state, dispatch, false, null),
      // Move to the next (or previous) change and select it.
      goToChange: (dir = 1) => ({ state, dispatch, view }) => {
        const list = changesIn(state.doc);
        if (!list.length) return false;
        const at = dir > 0 ? state.selection.to : state.selection.from;
        const c = dir > 0 ? list.find(x => x.from >= at) || list[0] : [...list].reverse().find(x => x.to <= at) || list[list.length - 1];
        if (dispatch) { dispatch(state.tr.setSelection(TextSelection.create(state.doc, c.from, c.to)).scrollIntoView()); view?.focus(); }
        return true;
      },
    };
  },
  addProseMirrorPlugins() {
    const opts = this.options;
    return [new Plugin({
      key,
      view: view => {
        const original = view.props.dispatchTransaction || (tr => view.updateState(view.state.apply(tr)));
        view.setProps({ dispatchTransaction: tr => original.call(view, opts.enabled() && view.editable ? trackTransaction(tr, view.state, opts.user()) : tr) });
        return {};
      },
    })];
  },
});
