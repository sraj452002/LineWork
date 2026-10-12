import { Extension, Mark, Node, mergeAttributes } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { Color, FontFamily, FontSize, TextStyle } from '@tiptap/extension-text-style';
import TextAlign from '@tiptap/extension-text-align';
import Highlight from '@tiptap/extension-highlight';
import Image from '@tiptap/extension-image';
import { TableKit } from '@tiptap/extension-table';
import { TaskItem, TaskList } from '@tiptap/extension-list';
import { CharacterCount, Placeholder } from '@tiptap/extensions';
import Subscript from '@tiptap/extension-subscript';
import Superscript from '@tiptap/extension-superscript';
import { Pages } from './pages.js';
import { Find } from './find.js';
import { TrackChanges } from './track.js';

/* The Word-like doc's building blocks: TipTap's kit, plus what Word has that it doesn't —
   page breaks, paragraph indent / line spacing / space after, image sizes, comments, and the marks
   tracked changes leave (insertions and deletions). */

// A forced page break: the next block starts a new page.
export const PageBreak = Node.create({
  name: 'pageBreak',
  group: 'block',
  atom: true,
  selectable: true,
  parseHTML: () => [{ tag: 'div[data-page-break]' }],
  renderHTML: () => ['div', { 'data-page-break': '', class: 'wd-break' }],
  addCommands() {
    return {
      // Inside a table (or a list), the break goes after it: pages break between blocks on the page.
      setPageBreak: () => ({ state, chain }) => {
        const { $from } = state.selection;
        const at = $from.depth > 1 ? $from.after(1) : null;
        const content = [{ type: 'pageBreak' }, { type: 'paragraph' }];
        return at == null ? chain().insertContent(content).run() : chain().insertContentAt(at, content).focus(at + 2).run();
      },
    };
  },
  addKeyboardShortcuts() { return { 'Mod-Enter': () => this.editor.commands.setPageBreak() }; },
});

// Paragraph-level formatting on paragraphs and headings: indent (steps of 0.5 in), line spacing,
// and space after (pt).
export const ParagraphFormat = Extension.create({
  name: 'paragraphFormat',
  addGlobalAttributes() {
    return [{
      types: ['paragraph', 'heading'],
      attributes: {
        indent: { default: 0, parseHTML: el => Number(el.getAttribute('data-indent')) || 0, renderHTML: a => (a.indent ? { 'data-indent': a.indent, style: `margin-left:${a.indent * 0.5}in` } : {}) },
        lineHeight: { default: null, parseHTML: el => el.style.lineHeight || null, renderHTML: a => (a.lineHeight ? { style: `line-height:${a.lineHeight}` } : {}) },
        spaceAfter: { default: null, parseHTML: el => (el.style.marginBottom ? parseFloat(el.style.marginBottom) : null), renderHTML: a => (a.spaceAfter != null ? { style: `margin-bottom:${a.spaceAfter}pt` } : {}) },
      },
    }];
  },
  addCommands() {
    const each = (state, fn) => {
      const { from, to } = state.selection, out = [];
      state.doc.nodesBetween(from, to, (n, pos) => { if (n.type.name === 'paragraph' || n.type.name === 'heading') { out.push([n, pos]); return false; } return true; });
      return out.map(([n, pos]) => fn(n, pos));
    };
    const setAttr = (fn) => ({ state, tr, dispatch }) => {
      each(state, (n, pos) => tr.setNodeMarkup(pos, undefined, { ...n.attrs, ...fn(n) }));
      if (dispatch) dispatch(tr);
      return true;
    };
    return {
      indent: () => ({ editor, ...p }) => (editor.isActive('listItem') || editor.isActive('taskItem') ? editor.commands.sinkListItem(editor.isActive('taskItem') ? 'taskItem' : 'listItem') : setAttr(n => ({ indent: Math.min(8, (n.attrs.indent || 0) + 1) }))(p)),
      outdent: () => ({ editor, ...p }) => (editor.isActive('listItem') || editor.isActive('taskItem') ? editor.commands.liftListItem(editor.isActive('taskItem') ? 'taskItem' : 'listItem') : setAttr(n => ({ indent: Math.max(0, (n.attrs.indent || 0) - 1) }))(p)),
      setLineHeight: v => setAttr(() => ({ lineHeight: v || null })),
      setSpaceAfter: v => setAttr(() => ({ spaceAfter: v === '' || v == null ? null : Number(v) })),
    };
  },
  // Tab indents a paragraph (in lists it nests the item; in tables it moves between cells).
  addKeyboardShortcuts() {
    const inside = () => this.editor.isActive('table') || this.editor.isActive('codeBlock');
    return {
      Tab: () => (inside() ? false : this.editor.commands.indent()),
      'Shift-Tab': () => (inside() ? false : this.editor.commands.outdent()),
    };
  },
});

// Images keep a width (a % of the text width) and an alignment.
export const WordImage = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      width: { default: null, parseHTML: el => el.getAttribute('data-width') || (el.style.width || null), renderHTML: a => (a.width ? { 'data-width': a.width, style: `width:${a.width}` } : {}) },
      align: { default: null, parseHTML: el => el.getAttribute('data-align'), renderHTML: a => (a.align ? { 'data-align': a.align } : {}) },
    };
  },
}).configure({ allowBase64: true, inline: false });

// A comment on some text: the text is marked with the comment's id; the words live in file.docComments.
export const Comment = Mark.create({
  name: 'comment',
  inclusive: false,
  excludes: '',
  addAttributes() { return { id: { default: null, parseHTML: el => el.getAttribute('data-comment'), renderHTML: a => ({ 'data-comment': a.id }) } }; },
  parseHTML: () => [{ tag: 'span[data-comment]' }],
  renderHTML: ({ HTMLAttributes }) => ['span', mergeAttributes(HTMLAttributes, { class: 'wd-comment' })],
});

// Tracked changes: what was typed (insertion) and what was removed (deletion), with who and when.
const changeAttrs = () => ({
  author: { default: '', parseHTML: el => el.getAttribute('data-author') || '', renderHTML: a => ({ 'data-author': a.author }) },
  time: { default: 0, parseHTML: el => Number(el.getAttribute('data-time')) || 0, renderHTML: a => ({ 'data-time': a.time }) },
});
export const Insertion = Mark.create({
  name: 'insertion', excludes: 'insertion deletion', inclusive: true,
  addAttributes: changeAttrs,
  parseHTML: () => [{ tag: 'ins[data-track]' }],
  renderHTML: ({ HTMLAttributes }) => ['ins', mergeAttributes(HTMLAttributes, { 'data-track': '', class: 'wd-ins' }), 0],
});
export const Deletion = Mark.create({
  name: 'deletion', excludes: 'deletion insertion', inclusive: false,
  addAttributes: changeAttrs,
  parseHTML: () => [{ tag: 'del[data-track]' }],
  renderHTML: ({ HTMLAttributes }) => ['del', mergeAttributes(HTMLAttributes, { 'data-track': '', class: 'wd-del' }), 0],
});

export const FONTS = [['', 'Default (Source Serif)'], ['Calibri, Carlito, sans-serif', 'Calibri'], ['Arial, Helvetica, sans-serif', 'Arial'], ['"Times New Roman", Times, serif', 'Times New Roman'], ['Georgia, serif', 'Georgia'], ['Cambria, Caladea, serif', 'Cambria'], ['Verdana, sans-serif', 'Verdana'], ['"Segoe UI", Roboto, sans-serif', 'Segoe UI'], ['"Courier New", monospace', 'Courier New'], ['"Bricolage Grotesque", sans-serif', 'Bricolage'], ['"JetBrains Mono", monospace', 'JetBrains Mono'], ['"Comic Sans MS", cursive', 'Comic Sans']];
export const SIZES = [8, 9, 10, 10.5, 11, 12, 14, 16, 18, 20, 24, 28, 32, 36, 48, 72];

// Everything, configured. opts: {placeholder, user: () => name, tracking: () => on, pages: () => layout|null}
export function wordExtensions(opts = {}) {
  return [
    StarterKit.configure({ link: { openOnClick: false, autolink: true, HTMLAttributes: { rel: 'noopener', target: '_blank' } }, heading: { levels: [1, 2, 3, 4] } }),
    TextStyle, Color, FontFamily, FontSize,
    Highlight.configure({ multicolor: true }),
    TextAlign.configure({ types: ['heading', 'paragraph'] }),
    Subscript, Superscript,
    TaskList, TaskItem.configure({ nested: true }),
    TableKit.configure({ table: { resizable: true } }),
    WordImage, PageBreak, ParagraphFormat, Comment, Insertion, Deletion,
    CharacterCount,
    Placeholder.configure({ placeholder: opts.placeholder || 'Start writing…' }),
    Find,
    TrackChanges.configure({ user: opts.user || (() => 'You'), enabled: opts.tracking || (() => false) }),
    Pages.configure({ layout: opts.pages || (() => null) }),
  ];
}
