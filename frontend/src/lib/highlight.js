import { esc } from './utils.js';

/* Syntax colouring for the code editor. Returns HTML with <span class="tk-…"> around tokens:
   k keyword, n name (table, node or participant), f field or column, t type or kind,
   a attribute key, v attribute value, s label text, o operator, p punctuation, c comment. */

const span = (cls, s) => (s ? `<span class="tk-${cls}">${esc(s)}</span>` : '');

// "[icon: user, color: blue]" or "[Label | detail]"
function bracket(s) {
  const inner = s.slice(1, -1);
  if (!/^\s*[\w-]+\s*:/.test(inner)) return span('p', '[') + span('s', inner) + span('p', ']');
  return span('p', '[') + inner.split(',').map(part => {
    const m = part.match(/^(\s*)([\w-]+)(\s*:\s*)(.*)$/);
    return m ? esc(m[1]) + span('a', m[2]) + span('p', m[3]) + span('v', m[4]) : esc(part);
  }).join(span('p', ',')) + span('p', ']');
}

// A relationship or message: a > b.col : label
function edge(line) {
  const m = line.match(/^(\s*)(.*?)(\s*:\s*)(.*)$/);
  const body = m ? m[2] : line, tail = m ? span('p', m[3]) + span('s', m[4]) : '';
  return (m ? esc(m[1]) : '') + body.split(/(<>|-->|--|->|=>|>|<|\s-\s|,)/).map(part => {
    if (/^(<>|-->|--|->|=>|>|<|\s-\s|,)$/.test(part)) return span('o', part);
    return part.replace(/([\w-]+)(\.([\w-]+))?/g, '\u0000$1\u0001$3\u0002').split(/(\u0000[^\u0002]*\u0002)/).map(seg => {
      if (!seg.startsWith('\u0000')) return esc(seg);
      const [name, field] = seg.slice(1, -1).split('\u0001');
      return span('n', name) + (field ? span('p', '.') + span('f', field) : '');
    }).join('');
  }).join('') + tail;
}

export function highlight(code, type) {
  let inside = false;
  return code.split('\n').map(raw => {
    // Split off a trailing comment.
    const cm = raw.match(/^(.*?)((?:^|\s)#.*)$/);
    const line = cm ? cm[1] : raw, comment = cm ? span('c', cm[2]) : '';
    const t = line.trim();
    let out;
    if (!t) out = esc(line);
    else if (/^(title)\s*:/i.test(t)) { const m = line.match(/^(\s*title)(\s*:\s*)(.*)$/i); out = span('k', m[1]) + span('p', m[2]) + span('s', m[3]); }
    else if (/^notation\b/i.test(t)) { const m = line.match(/^(\s*notation)(\s+)(.*)$/i) || [0, line, '', '']; out = span('k', m[1]) + esc(m[2]) + span('v', m[3]); }
    else if (/^==.*==$/.test(t)) out = span('k', line);
    else if (type === 'erd' && inside) {
      if (t === '}') { inside = false; out = esc(line.replace('}', '')) + span('p', '}'); }
      else {
        const m = line.match(/^(\s*)([\w-]+)(\s*)(\S*)(.*)$/);
        const flagIsType = /^(pk|fk|unique|pk,fk)$/i.test(m[4]);
        out = esc(m[1]) + span('f', m[2]) + esc(m[3]) + (flagIsType ? span('k', m[4]) : span('t', m[4]))
          + m[5].replace(/\S+|\s+/g, w => (/\s/.test(w) ? esc(w) : span('k', w)));
      }
    } else {
      // A block opener: "users [icon: user] {" or "group api "Backend" {"
      const open = line.match(/^(\s*)(group\s+)?([\w-]+)(\s*)(\[[^\]]*\]|"[^"]*")?(\s*)\{\s*$/i);
      if (open) {
        if (type === 'erd') inside = true;
        const lab = open[5] ? (open[5][0] === '[' ? bracket(open[5]) : span('s', open[5])) : '';
        out = esc(open[1]) + (open[2] ? span('k', open[2]) : '') + span('n', open[3]) + esc(open[4]) + lab + esc(open[6]) + span('p', '{');
      } else if (t === '}') out = esc(line.replace('}', '')) + span('p', '}');
      else if (/^note\s/i.test(t)) { const m = line.match(/^(\s*note\s+)(.*?)(\s*:\s*)(.*)$/i); out = m ? span('k', m[1]) + span('n', m[2]) + span('p', m[3]) + span('s', m[4]) : span('k', line); }
      else {
        // A node: "id [Label | sub] kind", or an edge.
        const node = line.match(/^(\s*)([\w-]+)(\s*)(\[[^\]]*\])(\s*)([\w-]*)(\s*)$/);
        if (node) out = esc(node[1]) + span('n', node[2]) + esc(node[3]) + bracket(node[4]) + esc(node[5]) + span('t', node[6]) + esc(node[7]);
        else if (/^\s*[\w-]+\s*$/.test(line)) out = span('n', line);
        else out = edge(line);
      }
    }
    return out + comment;
  }).join('\n');
}
