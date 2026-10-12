/* The Word-like doc in and out:
   - toMarkdown: the doc's text as Markdown, kept in file.doc so AI, search, exports and the Workline Doc
     workflow node keep working (tracked deletions left out, images as [image]).
   - hashOf: a short hash of that Markdown, to notice when something else (AI, a workflow) changed it.
   - toDocx / fromDocx: Word files (the docx and mammoth libraries, loaded when first used).
   - diffWords: what changed between two texts, for comparing versions. */

export const hashOf = s => { let h = 5381; for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0; return (h >>> 0).toString(36) + ':' + s.length; };

/* ---- Markdown ---- */
const markOf = (n, name) => (n.marks || []).find(m => m.type === name);
function inline(nodes = []) {
  return nodes.map(n => {
    if (n.type === 'hardBreak') return '  \n';
    if (n.type === 'image') return '[image]';
    if (n.type !== 'text' || markOf(n, 'deletion')) return '';
    let t = n.text;
    if (markOf(n, 'code')) return '`' + t + '`';
    if (markOf(n, 'bold')) t = `**${t}**`;
    if (markOf(n, 'italic')) t = `*${t}*`;
    if (markOf(n, 'strike')) t = `~~${t}~~`;
    const link = markOf(n, 'link');
    return link ? `[${t}](${link.attrs.href})` : t;
  }).join('');
}
function block(n, depth = 0) {
  const pad = '  '.repeat(depth);
  switch (n.type) {
    case 'heading': return '#'.repeat(n.attrs.level) + ' ' + inline(n.content);
    case 'paragraph': return inline(n.content);
    case 'blockquote': return (n.content || []).map(c => block(c)).join('\n\n').split('\n').map(l => '> ' + l).join('\n');
    case 'codeBlock': return '```' + (n.attrs?.language || '') + '\n' + (n.content || []).map(c => c.text).join('') + '\n```';
    case 'horizontalRule': case 'pageBreak': return '---';
    case 'image': return '[image]';
    case 'bulletList': case 'orderedList': case 'taskList':
      return (n.content || []).map((item, i) => {
        const mark = n.type === 'orderedList' ? `${(n.attrs?.start || 1) + i}.` : n.type === 'taskList' ? (item.attrs?.checked ? '- [x]' : '- [ ]') : '-';
        const [first, ...rest] = item.content || [];
        const head = pad + mark + ' ' + (first ? block(first, depth + 1).trimStart() : '');
        return [head, ...rest.map(c => block(c, depth + 1).split('\n').map(l => (l ? '  '.repeat(depth + 1) + l.trimStart() : l)).join('\n'))].join('\n');
      }).join('\n');
    case 'table': {
      const rows = (n.content || []).map(r => (r.content || []).map(c => (c.content || []).map(p => block(p)).join(' ').replace(/\|/g, '\\|').replace(/\n/g, ' ')));
      if (!rows.length) return '';
      return [`| ${rows[0].join(' | ')} |`, `| ${rows[0].map(() => '---').join(' | ')} |`, ...rows.slice(1).map(r => `| ${r.join(' | ')} |`)].join('\n');
    }
    default: return (n.content || []).map(c => block(c, depth)).join('\n\n');
  }
}
export const toMarkdown = json => ((json.content || []).map(n => block(n)).filter(s => s.trim() !== '' || false).join('\n\n').replace(/\n{3,}/g, '\n\n').trim() + '\n');

/* ---- Word files ---- */
const PAGE = { A4: [11906, 16838], Letter: [12240, 15840], Legal: [12240, 20160] }; // twips
const ALIGN = { left: 'left', center: 'center', right: 'right', justify: 'both' };
const hex = c => (c ? String(c).replace('#', '').slice(0, 6) : undefined);
const dataBytes = src => { const b = atob(src.split(',')[1] || ''); const a = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) a[i] = b.charCodeAt(i); return a; };
const sizeOf = src => new Promise(res => { const i = new window.Image(); i.onload = () => res([i.naturalWidth, i.naturalHeight]); i.onerror = () => res([400, 300]); i.src = src; });

export async function toDocx(json, { layout = {}, title = 'Document' } = {}) {
  const D = await import('docx');
  const [w0, h0] = PAGE[layout.size] || PAGE.A4;
  const land = layout.orientation === 'landscape';
  const m = Math.round((layout.margin ?? 1) * 1440);
  const textWidthPx = ((land ? h0 : w0) - 2 * m) / 15; // twips → px
  const runs = async (nodes = [], base = {}) => {
    const out = [];
    for (const n of nodes) {
      if (n.type === 'hardBreak') { out.push(new D.TextRun({ break: 1 })); continue; }
      if (n.type === 'image') { out.push(...(await image(n))); continue; }
      if (n.type !== 'text' || markOf(n, 'deletion')) continue;
      const style = markOf(n, 'textStyle')?.attrs || {};
      const hl = markOf(n, 'highlight');
      const size = parseFloat(style.fontSize);
      const opts = {
        text: n.text, bold: !!markOf(n, 'bold') || base.bold, italics: !!markOf(n, 'italic') || base.italics,
        underline: markOf(n, 'underline') ? {} : undefined, strike: !!markOf(n, 'strike'),
        superScript: !!markOf(n, 'superscript'), subScript: !!markOf(n, 'subscript'),
        color: hex(style.color), font: markOf(n, 'code') || base.mono ? 'Courier New' : style.fontFamily ? String(style.fontFamily).split(',')[0].replace(/["']/g, '') : undefined,
        size: size ? Math.round((/px$/.test(style.fontSize) ? size * 0.75 : size) * 2) : undefined,
        shading: hl ? { type: D.ShadingType.CLEAR, fill: hex(hl.attrs.color) || 'FFF59D', color: 'auto' } : undefined,
      };
      const link = markOf(n, 'link');
      out.push(link ? new D.ExternalHyperlink({ link: link.attrs.href, children: [new D.TextRun({ ...opts, style: 'Hyperlink' })] }) : new D.TextRun(opts));
    }
    return out;
  };
  const image = async n => {
    const src = n.attrs?.src || '';
    if (!src.startsWith('data:image/')) return [new D.TextRun({ text: '[image]', italics: true })];
    const [w, h] = await sizeOf(src);
    const pct = parseFloat(n.attrs.width) || 100;
    const width = Math.min(textWidthPx, w, textWidthPx * pct / 100);
    const type = (/^data:image\/(png|jpe?g|gif|bmp)/.exec(src) || [])[1]?.replace('jpeg', 'jpg') || 'png';
    return [new D.ImageRun({ type, data: dataBytes(src), transformation: { width: Math.round(width), height: Math.round(width * h / w) } })];
  };
  const para = async (n, extra = {}) => {
    const a = n.attrs || {};
    return new D.Paragraph({
      children: await runs(n.content, extra.run),
      heading: n.type === 'heading' ? D.HeadingLevel[`HEADING_${a.level}`] : undefined,
      alignment: a.textAlign ? ALIGN[a.textAlign] : undefined,
      indent: a.indent || extra.indent ? { left: (a.indent || 0) * 720 + (extra.indent || 0) } : undefined,
      spacing: { ...(a.lineHeight ? { line: Math.round(parseFloat(a.lineHeight) * 240) } : {}), ...(a.spaceAfter != null ? { after: a.spaceAfter * 20 } : {}) },
      numbering: extra.numbering,
      border: extra.border,
    });
  };
  const blocks = async (list = [], ctx = {}) => {
    const out = [];
    for (const n of list) {
      if (n.type === 'paragraph' || n.type === 'heading') out.push(await para(n, ctx));
      else if (n.type === 'blockquote') out.push(...await blocks(n.content, { ...ctx, indent: (ctx.indent || 0) + 720, run: { italics: true } }));
      else if (n.type === 'codeBlock') for (const line of (n.content || []).map(c => c.text).join('').split('\n')) out.push(new D.Paragraph({ children: [new D.TextRun({ text: line, font: 'Courier New', size: 20 })], spacing: { after: 0 } }));
      else if (n.type === 'horizontalRule') out.push(new D.Paragraph({ border: { bottom: { style: 'single', size: 6, color: 'AAAAAA', space: 1 } } }));
      else if (n.type === 'pageBreak') out.push(new D.Paragraph({ children: [new D.PageBreak()] }));
      else if (n.type === 'image') out.push(new D.Paragraph({ children: await image(n), alignment: n.attrs?.align ? ALIGN[n.attrs.align] : undefined }));
      else if (n.type === 'bulletList' || n.type === 'orderedList' || n.type === 'taskList') {
        const level = ctx.level ?? 0;
        for (const item of n.content || []) {
          const [first, ...rest] = item.content || [];
          if (first) {
            const prefix = n.type === 'taskList' ? [{ type: 'text', text: item.attrs?.checked ? '☑ ' : '☐ ' }] : [];
            out.push(await para({ ...first, content: [...prefix, ...(first.content || [])] }, n.type === 'taskList' ? { indent: 360 * (level + 1) } : { numbering: { reference: n.type === 'orderedList' ? 'numbers' : 'bullets', level: Math.min(8, level) } }));
          }
          out.push(...await blocks(rest, { ...ctx, level: level + 1 }));
        }
      } else if (n.type === 'table') {
        const rows = [];
        for (const r of n.content || []) {
          const cells = [];
          for (const c of r.content || []) cells.push(new D.TableCell({ children: (await blocks(c.content)).filter(x => x instanceof D.Paragraph).concat([]).slice(0) || [new D.Paragraph('')], columnSpan: c.attrs?.colspan || 1, rowSpan: c.attrs?.rowspan || 1, shading: c.type === 'tableHeader' ? { type: D.ShadingType.CLEAR, fill: 'F2F2F2', color: 'auto' } : undefined }));
          rows.push(new D.TableRow({ children: cells }));
        }
        out.push(new D.Table({ rows, width: { size: 100, type: D.WidthType.PERCENTAGE } }));
        out.push(new D.Paragraph(''));
      } else if (n.content) out.push(...await blocks(n.content, ctx));
    }
    return out;
  };
  const levels = (fmt, texts) => Array.from({ length: 9 }, (_, i) => ({ level: i, format: fmt, text: texts(i), alignment: 'left', style: { paragraph: { indent: { left: 720 * (i + 1), hanging: 360 } } } }));
  const footerKids = [];
  if (layout.footer) footerKids.push(new D.TextRun(layout.footer + (layout.pageNumbers !== false ? '    ' : '')));
  if (layout.pageNumbers !== false) footerKids.push(new D.TextRun({ children: ['Page ', D.PageNumber.CURRENT, ' of ', D.PageNumber.TOTAL_PAGES] }));
  const doc = new D.Document({
    title, creator: 'Workline',
    numbering: { config: [{ reference: 'bullets', levels: levels(D.LevelFormat.BULLET, i => ['•', '◦', '▪'][i % 3]) }, { reference: 'numbers', levels: levels(D.LevelFormat.DECIMAL, i => `%${i + 1}.`) }] },
    sections: [{
      properties: { page: { size: { width: w0, height: h0, orientation: land ? D.PageOrientation.LANDSCAPE : D.PageOrientation.PORTRAIT }, margin: { top: m, bottom: m, left: m, right: m } } },
      headers: layout.header ? { default: new D.Header({ children: [new D.Paragraph({ children: [new D.TextRun({ text: layout.header, color: '777777', size: 18 })] })] }) } : undefined,
      footers: footerKids.length ? { default: new D.Footer({ children: [new D.Paragraph({ alignment: 'center', children: footerKids.map(r => r) })] }) } : undefined,
      children: await blocks(json.content),
    }],
  });
  return D.Packer.toBlob(doc);
}

// A Word file → HTML the editor reads (pictures kept inside it).
export async function fromDocx(file) {
  const mod = await import('mammoth');
  const mammoth = mod.default || mod;
  const r = await mammoth.convertToHtml({ arrayBuffer: await file.arrayBuffer() }, {
    convertImage: mammoth.images.imgElement(img => img.read('base64').then(b => ({ src: `data:${img.contentType};base64,${b}` }))),
  });
  return { html: r.value, warnings: r.messages.filter(x => x.type === 'warning').length };
}

/* ---- comparing two texts, word by word (Myers' diff) ---- */
export function diffWords(a, b) {
  const A = String(a).match(/\s+|[^\s]+/g) || [], B = String(b).match(/\s+|[^\s]+/g) || [];
  const n = A.length, m = B.length, max = n + m, v = new Int32Array(2 * max + 2), trace = [];
  let found = false;
  for (let d = 0; d <= max && !found; d++) {
    trace.push(v.slice());
    for (let k = -d; k <= d; k += 2) {
      let x = k === -d || (k !== d && v[max + k - 1] < v[max + k + 1]) ? v[max + k + 1] : v[max + k - 1] + 1;
      let y = x - k;
      while (x < n && y < m && A[x] === B[y]) { x++; y++; }
      v[max + k] = x;
      if (x >= n && y >= m) { found = true; break; }
    }
    if (d > 4000) break; // very different texts: good enough
  }
  // Walk back through the trace to list the edits.
  const out = [];
  let x = n, y = m;
  for (let d = trace.length - 1; d > 0 && (x > 0 || y > 0); d--) {
    const vv = trace[d], k = x - y;
    const down = k === -d || (k !== d && vv[max + k - 1] < vv[max + k + 1]);
    const pk = down ? k + 1 : k - 1, px = vv[max + pk], py = px - pk;
    while (x > px && y > py) out.push(['=', A[--x]]), y--;
    if (down) out.push(['+', B[--y]]); else out.push(['-', A[--x]]);
  }
  while (x > 0 && y > 0) out.push(['=', A[--x]]), y--;
  while (x > 0) out.push(['-', A[--x]]);
  while (y > 0) out.push(['+', B[--y]]);
  out.reverse();
  // Join runs of the same kind.
  const runs = [];
  for (const [k, t] of out) { const last = runs[runs.length - 1]; if (last && last[0] === k) last[1] += t; else runs.push([k, t]); }
  return runs;
}
