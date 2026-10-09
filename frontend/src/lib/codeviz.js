/* The code visualiser: diagrams of code structure, and step-through recordings.
   Structure: JavaScript and TypeScript are parsed here (Babel); Python in the Python worker (its own
   ast module). Both come out as the same shape:
     {imports: [{spec} | {mod, level}], classes: [{name, bases, fields, methods, line}],
      functions: [{name, line, endLine, params, flow}]}
   where flow is a small control-flow form (stmt, if, loop, return, raise, break, continue, try)
   that becomes a flowchart. Diagrams are written in Workline's own diagram languages, so they draw
   with the canvas engines and can be opened on the canvas.
   Step-through: Python is traced in the worker (sys.settrace); JavaScript is instrumented here and
   run in a throwaway worker. Both give [{file, line, stack: [{fn, vars}], out}] plus the output. */
import { parse } from '@babel/parser';
import { transform } from 'sucrase';

export const langOf = p => (/\.py$/i.test(p) ? 'python' : /\.(m|c)?(j|t)sx?$/i.test(p) ? 'js' : null);
const isTS = p => /\.(m|c)?tsx?$/i.test(p);
const oneLine = s => String(s || '').replace(/\s+/g, ' ').trim();
const cut = (s, n) => (s.length > n ? s.slice(0, n - 1) + '…' : s);
// Words safe inside a diagram node label: no brackets, bars or line breaks.
// Brackets and braces are diagram syntax, so labels use look-alikes.
const LOOK = { '[': '［', ']': '］', '{': '｛', '}': '｝', '|': '¦' };
const label = (s, n = 30) => cut(oneLine(s).replace(/[[\]|{}]/g, c => LOOK[c]).replace(/\s+/g, ' ').trim(), n) || '…';
const safeId = (s, used) => {
  let id = String(s).toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'x';
  if (/^\d/.test(id)) id = 'n' + id;
  let k = id, i = 2;
  while (used.has(k)) k = id + '-' + i++;
  used.add(k);
  return k;
};

/* ---------------- JavaScript / TypeScript structure ---------------- */
function parseJS(path, text) {
  const plugins = ['decorators-legacy', 'classProperties'];
  if (isTS(path)) plugins.push('typescript');
  if (!isTS(path) || /x$/i.test(path)) plugins.push('jsx');
  return parse(text, { sourceType: 'unambiguous', errorRecovery: true, allowReturnOutsideFunction: true, allowAwaitOutsideFunction: true, allowImportExportEverywhere: true, plugins });
}
const src = (text, n) => (n ? text.slice(n.start, n.end) : '');
const first = (text, n) => oneLine(src(text, n).split('\n')[0]);
const asList = n => (!n ? [] : n.type === 'BlockStatement' ? n.body : [n]);

function flowJS(stmts, text) {
  const out = [];
  for (const s of stmts) {
    const line = s.loc && s.loc.start.line;
    switch (s.type) {
      case 'BlockStatement': out.push(...flowJS(s.body, text)); break;
      case 'EmptyStatement': break;
      case 'IfStatement': out.push({ k: 'if', text: 'if ' + first(text, s.test), line, then: flowJS(asList(s.consequent), text), else: flowJS(asList(s.alternate), text) }); break;
      case 'ForStatement': case 'ForInStatement': case 'ForOfStatement': case 'WhileStatement':
        out.push({ k: 'loop', text: oneLine(text.slice(s.start, s.body.start)).replace(/\s*\{?$/, ''), line, body: flowJS(asList(s.body), text) }); break;
      case 'DoWhileStatement': out.push({ k: 'loop', text: 'do … while (' + first(text, s.test) + ')', line, body: flowJS(asList(s.body), text) }); break;
      case 'ReturnStatement': out.push({ k: 'return', text: first(text, s), line }); break;
      case 'ThrowStatement': out.push({ k: 'raise', text: first(text, s), line }); break;
      case 'BreakStatement': out.push({ k: 'break', line }); break;
      case 'ContinueStatement': out.push({ k: 'continue', line }); break;
      case 'TryStatement': out.push({ k: 'try', line, body: flowJS(s.block.body, text),
        handlers: s.handler ? [{ text: 'catch' + (s.handler.param ? ' (' + first(text, s.handler.param) + ')' : ''), body: flowJS(s.handler.body.body, text) }] : [],
        fin: s.finalizer ? flowJS(s.finalizer.body, text) : [] }); break;
      case 'SwitchStatement': {
        // A switch reads as a chain of decisions; each case runs until its break.
        const disc = first(text, s.discriminant);
        let chain = [];
        for (let i = s.cases.length - 1; i >= 0; i--) {
          const c = s.cases[i], body = flowJS(c.consequent.filter(x => x.type !== 'BreakStatement'), text);
          chain = c.test ? [{ k: 'if', text: `${disc} is ${first(text, c.test)}`, line: c.loc.start.line, then: body, else: chain }] : body;
        }
        out.push(...chain);
        break;
      }
      case 'FunctionDeclaration': out.push({ k: 'stmt', text: `function ${s.id ? s.id.name : ''}(…)`, line }); break;
      case 'ClassDeclaration': out.push({ k: 'stmt', text: `class ${s.id ? s.id.name : ''}`, line }); break;
      default: out.push({ k: 'stmt', text: first(text, s), line });
    }
  }
  return out;
}

function walkAll(node, fn) {
  if (!node || typeof node.type !== 'string') return;
  fn(node);
  for (const k in node) {
    if (k === 'loc' || k === 'leadingComments' || k === 'trailingComments' || k === 'extra') continue;
    const v = node[k];
    if (Array.isArray(v)) v.forEach(x => x && typeof x.type === 'string' && walkAll(x, fn));
    else if (v && typeof v.type === 'string') walkAll(v, fn);
  }
}

export function analyzeJS(path, text) {
  let ast;
  try { ast = parseJS(path, text); } catch (e) { return { error: e.message.replace(/\s*\(\d+:\d+\)$/, '') + (e.loc ? ` (line ${e.loc.line})` : ''), imports: [], classes: [], functions: [] }; }
  const imports = [], classes = [], functions = [];
  walkAll(ast.program, n => {
    if ((n.type === 'ImportDeclaration' || n.type === 'ExportNamedDeclaration' || n.type === 'ExportAllDeclaration') && n.source) imports.push({ spec: n.source.value });
    if (n.type === 'CallExpression' && n.arguments.length && n.arguments[0].type === 'StringLiteral' && ((n.callee.type === 'Identifier' && n.callee.name === 'require') || n.callee.type === 'Import')) imports.push({ spec: n.arguments[0].value });
    if ((n.type === 'ClassDeclaration' || n.type === 'ClassExpression') && n.id) {
      const fields = [], methods = [];
      n.body.body.forEach(m => {
        const name = m.key && (m.key.name || m.key.value);
        if (!name) return;
        if (m.type === 'ClassMethod' || m.type === 'ClassPrivateMethod' || m.type === 'TSDeclareMethod') methods.push({ name: String(name), params: m.params.map(p => first(text, p).replace(/[:=].*$/, '').trim()), kind: m.kind });
        else if (/Property$/.test(m.type)) fields.push({ name: String(name), type: m.typeAnnotation ? first(text, m.typeAnnotation).replace(/^:\s*/, '') : '' });
      });
      // this.x = … in the constructor are fields too.
      const ctor = n.body.body.find(m => m.kind === 'constructor');
      if (ctor) walkAll(ctor.body, a => { if (a.type === 'AssignmentExpression' && a.left.type === 'MemberExpression' && a.left.object.type === 'ThisExpression' && a.left.property.name && !fields.some(f => f.name === a.left.property.name)) fields.push({ name: a.left.property.name, type: '' }); });
      classes.push({ name: n.id.name, bases: n.superClass ? [first(text, n.superClass)] : [], fields, methods, line: n.loc.start.line });
    }
  });
  // Functions, by name: declarations, functions held in variables, class methods.
  const fn = (name, f) => functions.push({ name, line: f.loc.start.line, endLine: f.loc.end.line, params: f.params.map(p => first(text, p).replace(/[:=].*$/, '').trim()),
    flow: f.body.type === 'BlockStatement' ? flowJS(f.body.body, text) : [{ k: 'return', text: 'return ' + first(text, f.body), line: f.body.loc.start.line }] });
  walkAll(ast.program, n => {
    if (n.type === 'FunctionDeclaration' && n.id) fn(n.id.name, n);
    else if (n.type === 'VariableDeclarator' && n.id.type === 'Identifier' && n.init && /Function/.test(n.init.type)) fn(n.id.name, n.init);
    else if ((n.type === 'ClassDeclaration' || n.type === 'ClassExpression') && n.id) n.body.body.forEach(m => { if (m.type === 'ClassMethod' && m.key && (m.key.name || m.key.value)) fn(`${n.id.name}.${m.key.name || m.key.value}`, m); });
  });
  functions.sort((a, b) => a.line - b.line);
  const top = ast.program.body.filter(s => !/^(Import|Export(Named|Default|All)Declaration|FunctionDeclaration|ClassDeclaration|TS\w+)$/.test(s.type) || (s.type === 'ExportNamedDeclaration' && s.declaration && s.declaration.type === 'VariableDeclaration'));
  if (top.length) functions.unshift({ name: '(whole file)', line: 1, endLine: ast.loc.end.line, params: [], flow: flowJS(top, text) });
  return { imports, classes, functions };
}

/* ---------------- diagrams ---------------- */
// A function's flow as a flowchart (Workline's flowchart language).
export function flowchartCode(fn) {
  const nodes = [], edges = [], loops = [];
  let n = 0, capped = false;
  const add = (kind, words, line) => {
    const id = 'n' + ++n;
    nodes.push(`${id} [${label(words, 28)}${line ? ' | line ' + line : ''}] ${kind}`);
    return id;
  };
  const link = (pend, to) => pend.forEach(p => edges.push(`${p.from} > ${to}${p.label ? ' : ' + label(p.label, 22) : ''}`));
  const build = (stmts, pend) => {
    for (const s of stmts) {
      if (!pend.length) break; // what follows return/break is never reached
      if (n > 90) { if (!capped) { const id = add('step', 'more steps not shown'); link(pend, id); pend = [{ from: id }]; capped = true; } return pend; }
      if (s.k === 'stmt') {
        const id = add(/\b(print|input|console\.\w+|alert|prompt)\s*\(/.test(s.text) ? 'io' : 'step', s.text, s.line);
        link(pend, id); pend = [{ from: id }];
      } else if (s.k === 'return' || s.k === 'raise') {
        const id = add('end', s.text, s.line);
        link(pend, id); pend = [];
      } else if (s.k === 'if') {
        const id = add('decision', s.text.replace(/^if\s*/, '') + '?', s.line);
        link(pend, id);
        const yes = build(s.then, [{ from: id, label: 'yes' }]);
        const no = s.else.length ? build(s.else, [{ from: id, label: 'no' }]) : [{ from: id, label: 'no' }];
        pend = [...yes, ...no];
      } else if (s.k === 'loop') {
        const id = add('decision', s.text, s.line);
        link(pend, id);
        loops.push({ head: id, breaks: [] });
        const body = build(s.body, [{ from: id, label: 'repeat' }]);
        link(body, id); // round again
        const L = loops.pop();
        pend = [{ from: id, label: 'done' }, ...L.breaks];
      } else if (s.k === 'break') {
        if (loops.length) loops[loops.length - 1].breaks.push(...pend.map(p => ({ ...p, label: p.label || 'break' })));
        pend = [];
      } else if (s.k === 'continue') {
        if (loops.length) link(pend, loops[loops.length - 1].head);
        pend = [];
      } else if (s.k === 'try') {
        const id = add('step', 'try', s.line);
        link(pend, id);
        let merged = build(s.body, [{ from: id }]);
        for (const h of s.handlers) merged = merged.concat(build(h.body, [{ from: id, label: h.text || 'error' }]));
        pend = s.fin.length ? build(s.fin, merged) : merged;
      }
    }
    return pend;
  };
  const start = add('start', fn.name === '(whole file)' ? 'start' : `${fn.name}(${(fn.params || []).join(', ')})`, fn.line);
  const exits = build(fn.flow, [{ from: start }]);
  if (exits.length) link(exits, add('end', 'end'));
  return `title: ${label(fn.name === '(whole file)' ? 'The whole file' : fn.name, 60)}\n${nodes.join('\n')}\n${edges.join('\n')}\n`;
}

// Classes as boxes with their fields and methods; "extends" lines to their bases.
export function classCode(classes) {
  const used = new Set(), ids = new Map();
  classes.forEach(c => { if (!ids.has(c.name)) ids.set(c.name, safeId(c.name, used)); });
  const lines = ['title: Classes'];
  const colors = ['blue', 'green', 'purple', 'orange', 'red'];
  classes.forEach((c, i) => {
    if (lines.some(l => l.startsWith(ids.get(c.name) + ' ['))) return;
    lines.push(`${ids.get(c.name)} [label: ${label(c.name, 40).replace(/,/g, ' ')}, color: ${colors[i % colors.length]}] {`);
    const seen = new Set();
    c.fields.forEach(f => { const k = safeId(f.name, seen); lines.push(`  ${k}${f.type ? ' ' + label(f.type, 24).replace(/\s+/g, '') : ''}`); });
    c.methods.forEach(m => { const k = safeId(m.name === 'constructor' ? 'constructor' : m.name, seen); lines.push(`  ${k} ${('(' + m.params.join(',') + ')').replace(/\s+/g, '').slice(0, 26)}`); });
    lines.push('}');
  });
  classes.forEach(c => c.bases.forEach(b => {
    const base = b.split('.').pop().replace(/\[.*$/, '');
    if (!ids.has(base)) { ids.set(base, safeId(base, used)); lines.push(`${ids.get(base)} [label: ${label(base, 40).replace(/,/g, ' ')}, color: grey] {`, '}'); }
    lines.push(`${ids.get(c.name)} - ${ids.get(base)} : extends`);
  }));
  return lines.join('\n') + '\n';
}

// How the workspace's files import each other and which packages they use.
const JS_EXT = ['', '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.mts', '.cts', '/index.ts', '/index.tsx', '/index.js', '/index.jsx'];
const norm = parts => parts.reduce((a, x) => (x === '..' ? a.slice(0, -1) : x === '.' || x === '' ? a : [...a, x]), []).join('/');
export function resolveImport(from, imp, paths) {
  const dir = from.includes('/') ? from.slice(0, from.lastIndexOf('/')) : '';
  if (imp.spec != null) {
    const s = imp.spec;
    if (!s.startsWith('.') && !s.startsWith('/')) return { pkg: s.startsWith('@') ? s.split('/').slice(0, 2).join('/') : s.split('/')[0].replace(/^node:/, 'node:') };
    const base = norm((s.startsWith('/') ? s : dir + '/' + s).split('/'));
    const hit = JS_EXT.map(e => base + e).find(p => paths.has(p));
    return hit ? { file: hit } : null;
  }
  // Python: from .a import b (level 1 = this folder), import a.b, from a import b
  let root = dir.split('/').filter(Boolean);
  if (imp.level) root = root.slice(0, Math.max(0, root.length - (imp.level - 1)));
  const tries = [];
  const mod = (imp.mod || '').split('.').filter(Boolean);
  const bases = imp.level ? [root] : [root, []];
  for (const b of bases) {
    for (const name of imp.names && imp.names.length ? [...imp.names.map(n => [...mod, n]), mod] : [mod]) {
      const p = [...b, ...name].join('/');
      if (p) tries.push(p + '.py', p + '/__init__.py');
    }
  }
  const hit = tries.find(p => paths.has(p));
  if (hit) return { file: hit };
  return imp.level ? null : { pkg: mod[0] || (imp.names || [])[0] };
}
export function importGraphCode(files, analyses) {
  const code = files.filter(f => langOf(f.path));
  const paths = new Set(code.map(f => f.path)), used = new Set(), ids = new Map(), edges = new Set(), pkgs = new Map();
  code.forEach(f => ids.set(f.path, safeId(f.path.replace(/\.[^./]+$/, ''), used)));
  for (const f of code) {
    const a = analyses.get(f.path);
    if (!a) continue;
    for (const imp of a.imports || []) {
      const r = resolveImport(f.path, imp, paths);
      if (!r) continue;
      if (r.file && r.file !== f.path) edges.add(`${ids.get(f.path)} > ${ids.get(r.file)}`);
      if (r.pkg) { if (!pkgs.has(r.pkg) && pkgs.size < 24) pkgs.set(r.pkg, safeId('pkg-' + r.pkg, used)); if (pkgs.has(r.pkg)) edges.add(`${ids.get(f.path)} > ${pkgs.get(r.pkg)}`); }
    }
  }
  const kind = p => (/\.(jsx|tsx)$/.test(p) ? 'client' : /(^|\/)(index|main|app|server)\.\w+$/.test(p) ? 'api' : /test|spec/.test(p) ? 'function' : 'service');
  const groups = new Map();
  code.forEach(f => { const g = f.path.includes('/') ? f.path.split('/')[0] : ''; if (!groups.has(g)) groups.set(g, []); groups.get(g).push(f); });
  const lines = ['title: How the files fit together'];
  const node = f => `${ids.get(f.path)} [${label(f.path.split('/').pop(), 24)} | ${label(f.path.includes('/') ? f.path.slice(0, f.path.lastIndexOf('/') + 1) : 'top level', 24)}] ${kind(f.path)}`;
  groups.forEach((list, g) => {
    if (!g) { list.forEach(f => lines.push(node(f))); return; }
    lines.push(`group ${safeId('dir-' + g, used)} "${label(g, 30).replace(/"/g, '')}/" {`);
    list.forEach(f => lines.push('  ' + node(f)));
    lines.push('}');
  });
  if (pkgs.size) {
    lines.push(`group ${safeId('packages', used)} "Packages" {`);
    pkgs.forEach((id, name) => lines.push(`  ${id} [${label(name, 24)}] external`));
    lines.push('}');
  }
  lines.push(...edges);
  return lines.join('\n') + '\n';
}

/* ---------------- JavaScript step-through ---------------- */
// Insert a recording call before every statement, and call-stack markers in every function.
const NAMES = (p, out) => {
  if (!p) return out;
  if (p.type === 'Identifier') out.push(p.name);
  else if (p.type === 'ObjectPattern') p.properties.forEach(x => NAMES(x.type === 'RestElement' ? x.argument : x.value, out));
  else if (p.type === 'ArrayPattern') p.elements.forEach(x => NAMES(x, out));
  else if (p.type === 'RestElement') NAMES(p.argument, out);
  else if (p.type === 'AssignmentPattern') NAMES(p.left, out);
  else if (p.type === 'TSParameterProperty') NAMES(p.parameter, out);
  return out;
};
const HIDE = new Set(['__lw', 'module', 'exports', 'require', 'arguments']);
function declaredIn(stmts, kinds) {
  const out = [];
  for (const s of stmts) {
    if (s.type === 'VariableDeclaration' && kinds.includes(s.kind)) s.declarations.forEach(d => NAMES(d.id, out));
    else if ((s.type === 'FunctionDeclaration' || s.type === 'ClassDeclaration') && s.id) out.push(s.id.name);
    else if (s.type === 'ExportNamedDeclaration' && s.declaration) out.push(...declaredIn([s.declaration], kinds));
  }
  return out;
}
function varsDeep(node) {
  // var declarations anywhere in a function body (not inside nested functions)
  const out = [];
  const go = n => {
    if (!n || typeof n.type !== 'string' || /Function/.test(n.type)) return;
    if (n.type === 'VariableDeclaration' && n.kind === 'var') n.declarations.forEach(d => NAMES(d.id, out));
    for (const k in n) { if (k === 'loc') continue; const v = n[k]; if (Array.isArray(v)) v.forEach(go); else if (v && typeof v.type === 'string') go(v); }
  };
  go(node);
  return out;
}
export function instrumentJS(code, fileIndex) {
  const ast = parse(code, { sourceType: 'script', errorRecovery: false, allowReturnOutsideFunction: true, allowAwaitOutsideFunction: true, plugins: ['jsx'] });
  const ins = []; // [offset, order, text]
  let order = 0;
  const at = (pos, text) => ins.push([pos, order++, text]);
  // Variables the import conversion made (var _cart = require('./cart')) aren't the program's own.
  const made = new Set();
  ast.program.body.forEach(st => st.type === 'VariableDeclaration' && st.declarations.forEach(d => {
    const c = d.init && d.init.type === 'CallExpression' ? d.init : null;
    const callee = c && (c.callee.type === 'Identifier' ? c.callee.name : '');
    if (d.id.type === 'Identifier' && (callee === 'require' || /^_interop/.test(callee))) made.add(d.id.name);
  }));
  ast.program.body.forEach(st => st.type === 'FunctionDeclaration' && st.id && /^_interop/.test(st.id.name) && made.add(st.id.name));
  const snap = scope => '{' + [...new Set(scope)].filter(n => !HIDE.has(n) && !made.has(n)).map(n => `${JSON.stringify(n)}:()=>${n}`).join(',') + '}';
  const visitList = (stmts, scope) => {
    const here = [...scope, ...declaredIn(stmts, ['let', 'const'])];
    stmts.forEach(s => visitStmt(s, here, true));
  };
  const step = (s, scope) => `__lw.s(${s.loc.start.line},${snap(scope)},${fileIndex});`;
  const visitStmt = (s, scope, inList) => {
    if (!inList) { at(s.start, '{'); at(s.start, step(s, scope)); at(s.end, '}'); }
    else if (s.type !== 'FunctionDeclaration' && s.type !== 'ClassDeclaration') at(s.start, step(s, scope));
    visitNode(s, scope);
  };
  const fnName = (f, parent) => (f.id ? f.id.name : f.key && (f.key.name || f.key.value) ? (f.key.name || f.key.value) : parent && parent.type === 'VariableDeclarator' && parent.id.name ? parent.id.name : parent && (parent.type === 'ClassMethod' || parent.type === 'ObjectMethod' || parent.type === 'ObjectProperty') && parent.key ? (parent.key.name || parent.key.value) : '(anonymous)');
  const visitFn = (f, scope, name) => {
    const inner = [...scope.filter(x => x !== 'this'), ...(f.type === 'ArrowFunctionExpression' && scope.includes('this') ? ['this'] : []), ...(f.type !== 'ArrowFunctionExpression' && f.type !== 'FunctionDeclaration' ? ['this'] : []), ...f.params.flatMap(p => NAMES(p, [])), ...(f.id ? [f.id.name] : [])];
    if (f.body.type === 'BlockStatement') {
      const b = f.body;
      at(b.start + 1, `__lw.e(${JSON.stringify(String(name))});try{`);
      at(b.end - 1, '}finally{__lw.x()}');
      visitList(b.body, [...inner, ...varsDeep(b), ...declaredIn(b.body, ['var'])]);
    } else visitNode(f.body, inner);
  };
  const visitNode = (n, scope, parent) => {
    if (!n || typeof n.type !== 'string') return;
    if (/^(FunctionDeclaration|FunctionExpression|ArrowFunctionExpression|ClassMethod|ObjectMethod|ClassPrivateMethod)$/.test(n.type)) { visitFn(n, scope, fnName(n, parent)); return; }
    if (n.type === 'BlockStatement') { visitList(n.body, scope); return; }
    if (n.type === 'SwitchCase') { visitNode(n.test, scope); visitList(n.consequent, scope); return; }
    const bodyLike = { IfStatement: ['consequent', 'alternate'], ForStatement: ['body'], ForInStatement: ['body'], ForOfStatement: ['body'], WhileStatement: ['body'], DoWhileStatement: ['body'], LabeledStatement: ['body'] }[n.type] || [];
    let inner = scope;
    if (/^For/.test(n.type)) { const d = n.init || n.left; if (d && d.type === 'VariableDeclaration') inner = [...scope, ...d.declarations.flatMap(x => NAMES(x.id, []))]; }
    if (n.type === 'CatchClause') { inner = [...scope, ...NAMES(n.param, [])]; visitList(n.body.body, inner); return; }
    for (const k in n) {
      if (k === 'loc' || k === 'start' || k === 'end') continue;
      const v = n[k];
      if (bodyLike.includes(k) && v) { if (v.type === 'BlockStatement') visitList(v.body, inner); else visitStmt(v, inner, false); continue; }
      if (Array.isArray(v)) v.forEach(x => x && typeof x.type === 'string' && visitNode(x, inner, n));
      else if (v && typeof v.type === 'string') visitNode(v, inner, n);
    }
  };
  const top = ast.program.body;
  visitList(top, [...varsDeep(ast.program), ...declaredIn(top, ['var'])]);
  ins.sort((a, b) => b[0] - a[0] || b[1] - a[1]);
  let out = code;
  for (const [pos, , text] of ins) out = out.slice(0, pos) + text + out.slice(pos);
  return out;
}

// Prepare the files for a recorded run: TypeScript stripped, imports made require()s, all instrumented.
export function prepareJS(files) {
  const js = files.filter(f => langOf(f.path) === 'js');
  return js.map((f, i) => {
    const transforms = ['imports'];
    if (isTS(f.path)) transforms.push('typescript');
    if (/x$/i.test(f.path)) transforms.push('jsx');
    const plain = transform(f.text || '', { transforms, filePath: f.path }).code;
    return { path: f.path, code: instrumentJS(plain, i) };
  });
}

export const RUNNER = `
const MAX = 2000, steps = []; let out = '', stack = ['(file)'];
class Stop extends Error {}
const show = (v, d = 0) => {
  try {
    if (v === null) return 'null'; if (v === undefined) return 'undefined';
    const t = typeof v;
    if (t === 'string') return JSON.stringify(v.length > 120 ? v.slice(0, 117) + '…' : v);
    if (t === 'number' || t === 'boolean' || t === 'bigint') return String(v);
    if (t === 'function') return 'ƒ ' + (v.name || 'anonymous');
    if (t === 'symbol') return v.toString();
    if (d > 2) return Array.isArray(v) ? '[…]' : '{…}';
    if (Array.isArray(v)) return '[' + v.slice(0, 12).map(x => show(x, d + 1)).join(', ') + (v.length > 12 ? ', … ' + (v.length - 12) + ' more' : '') + ']';
    if (v instanceof Map) return 'Map(' + v.size + ') {' + [...v].slice(0, 8).map(([k, x]) => show(k, d + 1) + ' => ' + show(x, d + 1)).join(', ') + '}';
    if (v instanceof Set) return 'Set(' + v.size + ') {' + [...v].slice(0, 12).map(x => show(x, d + 1)).join(', ') + '}';
    if (v instanceof Date) return v.toISOString();
    if (v instanceof Error) return v.name + ': ' + v.message;
    const ks = Object.keys(v), name = v.constructor && v.constructor !== Object ? v.constructor.name + ' ' : '';
    return name + '{' + ks.slice(0, 10).map(k => k + ': ' + show(v[k], d + 1)).join(', ') + (ks.length > 10 ? ', …' : '') + '}';
  } catch (e) { return '…'; }
};
self.__lw = {
  s(line, vars, file) {
    if (steps.length >= MAX) throw new Stop('step limit');
    const v = {};
    for (const k in vars) { try { const x = vars[k](); if (typeof x !== 'function' || stack.length === 1) v[k] = show(x); } catch (e) {} }
    steps.push({ file, line, stack: stack.slice().reverse().map((fn, i) => ({ fn, vars: i === 0 ? v : null })), out: out.length });
  },
  e(n) { stack.push(n); }, x() { stack.pop(); },
};
const write = (...a) => { out += a.map(x => typeof x === 'string' ? x : show(x)).join(' ') + '\\n'; };
self.console = { log: write, info: write, warn: write, error: write, debug: write, table: write, dir: write };
onmessage = async e => {
  const { files, entry } = e.data, cache = new Map();
  const load = (i) => {
    if (cache.has(i)) return cache.get(i).exports;
    const module = { exports: {} }; cache.set(i, module);
    const f = files[i], dir = f.path.includes('/') ? f.path.slice(0, f.path.lastIndexOf('/')) : '';
    const require = spec => {
      if (!spec.startsWith('.')) throw new Error("Package '" + spec + "' can't load while stepping through; step through code that doesn't import packages.");
      const base = (dir + '/' + spec).split('/').reduce((a, x) => x === '..' ? a.slice(0, -1) : (x === '.' || !x) ? a : [...a, x], []).join('/');
      const j = files.findIndex(g => ['', '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '/index.ts', '/index.js'].some(x => g.path === base + x));
      if (j < 0) throw new Error("Can't find '" + spec + "'");
      return load(j);
    };
    new Function('module', 'exports', 'require', '__lw', f.code)(module, module.exports, require, self.__lw);
    return module.exports;
  };
  let error = null, truncated = false;
  try { load(entry); } catch (err) { if (err instanceof Stop) truncated = true; else error = (err && err.name ? err.name + ': ' : '') + (err && err.message || String(err)); }
  await new Promise(r => setTimeout(r, 150)); // let promises and short timers finish
  postMessage({ steps, out, error, truncated });
};`;

export function traceJS(files, entryPath, timeout = 8000) {
  let prepared;
  try { prepared = prepareJS(files); } catch (e) { return Promise.resolve({ steps: [], out: '', error: 'SyntaxError: ' + e.message, truncated: false, files: [] }); }
  const entry = prepared.findIndex(f => f.path === entryPath);
  const url = URL.createObjectURL(new Blob([RUNNER], { type: 'text/javascript' }));
  const w = new Worker(url);
  return new Promise(res => {
    const done = r => { clearTimeout(t); w.terminate(); URL.revokeObjectURL(url); res({ ...r, files: prepared.map(f => f.path) }); };
    const t = setTimeout(() => done({ steps: [], out: '', error: 'Stopped after 8 seconds without finishing.', truncated: true }), timeout);
    w.onmessage = e => done(e.data);
    w.onerror = e => { e.preventDefault(); done({ steps: [], out: '', error: e.message || 'The program failed to start.', truncated: false }); };
    w.postMessage({ files: prepared.map(f => ({ path: f.path, code: f.code })), entry });
  });
}
