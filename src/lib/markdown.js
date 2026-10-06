import { esc } from './utils.js';

/* ===================== Markdown ===================== */
function inline(s){
  return esc(s)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*\w])\*([^*\s][^*]*)\*/g, '$1<em>$2</em>')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
}
export function md(src){
  const L = src.replace(/\r/g,'').split('\n'); let out = '', i = 0;
  const para = [];
  const flush = () => { if(para.length){ out += `<p>${inline(para.join(' '))}</p>`; para.length = 0; } };
  while(i < L.length){
    const l = L[i];
    if(/^```/.test(l)){ flush(); const buf = []; i++; while(i < L.length && !/^```/.test(L[i])) buf.push(L[i++]); i++; out += `<pre><code>${esc(buf.join('\n'))}</code></pre>`; continue; }
    let m;
    if((m = l.match(/^(#{1,4})\s+(.*)$/))){ flush(); out += `<h${m[1].length}>${inline(m[2])}</h${m[1].length}>`; i++; continue; }
    if(/^\s*(-{3,}|\*{3,})\s*$/.test(l)){ flush(); out += '<hr>'; i++; continue; }
    if(/^>\s?/.test(l)){ flush(); const buf = []; while(i < L.length && /^>\s?/.test(L[i])) buf.push(L[i++].replace(/^>\s?/,'')); out += `<blockquote>${inline(buf.join(' '))}</blockquote>`; continue; }
    if(/^\s*\|/.test(l) && i+1 < L.length && /^\s*\|?\s*:?-{2,}/.test(L[i+1])){
      flush();
      const cells = r => r.trim().replace(/^\||\|$/g,'').split('|').map(c => c.trim());
      const head = cells(l); i += 2; const rows = [];
      while(i < L.length && /^\s*\|/.test(L[i])) rows.push(cells(L[i++]));
      out += `<div class="tw"><table><thead><tr>${head.map(c => `<th>${inline(c)}</th>`).join('')}</tr></thead><tbody>${rows.map(r => `<tr>${r.map(c => `<td>${inline(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
      continue;
    }
    if(/^\s*([-*]|\d+[.)])\s+/.test(l)){
      flush();
      const ordered = /^\s*\d/.test(l), tag = ordered ? 'ol' : 'ul', items = [];
      while(i < L.length && /^\s*([-*]|\d+[.)])\s+/.test(L[i])) items.push(L[i++].replace(/^\s*([-*]|\d+[.)])\s+/,''));
      out += `<${tag}>${items.map(t => { const c = t.match(/^\[( |x)\]\s*(.*)$/i); return c ? `<li><input type="checkbox" disabled${c[1].toLowerCase()==='x'?' checked':''}> ${inline(c[2])}</li>` : `<li>${inline(t)}</li>`; }).join('')}</${tag}>`;
      continue;
    }
    if(!l.trim()){ flush(); i++; continue; }
    para.push(l.trim()); i++;
  }
  flush();
  return out || '<p class="empty-doc">This doc is empty. Switch to Write, or ask AI to draft it from your diagrams.</p>';
}

