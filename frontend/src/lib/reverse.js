/* Reverse engineer (Tools): take something apart and make a Workline file that explains it. Each one
   returns { title, doc, diagrams, view, flow? }: a report as a doc, diagrams for the canvas (architecture,
   database schema, flowchart), and for data and workflows a ready workflow too.
     reverseCode(files, name): a code project ([{path, text}]): languages, stack, routes, data model, modules.
     reverseData(text, name): JSON, CSV or an API response: its schema as tables, and a workflow for it.
     reverseWorkflow(text, name): an n8n / Make / Zapier / Node-RED / Power Automate / Workline workflow.
     reverseSite(info, url): what the server found on a web page (backend /api/reverse/site). */
import { importFlow } from './flowio.js';
import { readSql } from './sql.js';
import { nodeDef } from './flows.js';

const rid = p => p + Math.random().toString(36).slice(2, 10);
const dg = (type, name, code) => ({ id: rid('d'), type, name, code, manual: {}, dir: type === 'flowchart' ? 'TB' : 'LR', style: 'color' });
const ident = s => (String(s).replace(/[^\w]+/g, '_').replace(/^_+|_+$/g, '') || 'x').replace(/^(\d)/, '_$1').slice(0, 40);
const esc = s => String(s ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
const table = (head, rows) => (rows.length ? [`| ${head.join(' | ')} |`, `| ${head.map(() => '---').join(' | ')} |`, ...rows.map(r => `| ${r.map(esc).join(' | ')} |`)].join('\n') : '_None found._');
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

/* ---------------- code ---------------- */
const LANG = { js: 'JavaScript', jsx: 'JavaScript (JSX)', mjs: 'JavaScript', cjs: 'JavaScript', ts: 'TypeScript', tsx: 'TypeScript (TSX)', py: 'Python', go: 'Go', rb: 'Ruby', rs: 'Rust', java: 'Java', kt: 'Kotlin', swift: 'Swift', c: 'C', h: 'C', cpp: 'C++', hpp: 'C++', cs: 'C#', php: 'PHP', sh: 'Shell', html: 'HTML', css: 'CSS', scss: 'SCSS', vue: 'Vue', svelte: 'Svelte', sql: 'SQL', prisma: 'Prisma', yaml: 'YAML', yml: 'YAML', json: 'JSON', md: 'Markdown', graphql: 'GraphQL', proto: 'Protobuf' };
const extOf = p => (p.toLowerCase().match(/\.([a-z0-9]+)$/) || [])[1] || '';
// Frameworks and services, from dependencies and imports.
const STACK = [
  ['react', 'React', 'Frontend'], ['next', 'Next.js', 'Frontend'], ['vue', 'Vue', 'Frontend'], ['nuxt', 'Nuxt', 'Frontend'], ['svelte', 'Svelte', 'Frontend'], ['@angular/core', 'Angular', 'Frontend'], ['vite', 'Vite', 'Build'], ['webpack', 'webpack', 'Build'], ['tailwindcss', 'Tailwind CSS', 'Frontend'],
  ['express', 'Express', 'Backend'], ['fastify', 'Fastify', 'Backend'], ['koa', 'Koa', 'Backend'], ['@nestjs/core', 'NestJS', 'Backend'], ['flask', 'Flask', 'Backend'], ['django', 'Django', 'Backend'], ['fastapi', 'FastAPI', 'Backend'], ['gin-gonic/gin', 'Gin', 'Backend'], ['spring-boot', 'Spring Boot', 'Backend'], ['rails', 'Rails', 'Backend'], ['laravel', 'Laravel', 'Backend'],
  ['pg', 'PostgreSQL', 'Database'], ['postgres', 'PostgreSQL', 'Database'], ['psycopg2', 'PostgreSQL', 'Database'], ['mysql', 'MySQL', 'Database'], ['mysql2', 'MySQL', 'Database'], ['mongodb', 'MongoDB', 'Database'], ['mongoose', 'MongoDB (Mongoose)', 'Database'], ['sqlite3', 'SQLite', 'Database'], ['better-sqlite3', 'SQLite', 'Database'], ['@prisma/client', 'Prisma ORM', 'Database'], ['prisma', 'Prisma ORM', 'Database'], ['sequelize', 'Sequelize ORM', 'Database'], ['typeorm', 'TypeORM', 'Database'], ['sqlalchemy', 'SQLAlchemy', 'Database'], ['redis', 'Redis', 'Cache'], ['ioredis', 'Redis', 'Cache'],
  ['stripe', 'Stripe', 'Service'], ['@aws-sdk', 'AWS SDK', 'Service'], ['aws-sdk', 'AWS SDK', 'Service'], ['boto3', 'AWS SDK', 'Service'], ['firebase', 'Firebase', 'Service'], ['@supabase/supabase-js', 'Supabase', 'Service'], ['openai', 'OpenAI', 'Service'], ['@anthropic-ai/sdk', 'Anthropic', 'Service'], ['nodemailer', 'Email (SMTP)', 'Service'], ['twilio', 'Twilio', 'Service'], ['socket.io', 'Socket.IO', 'Realtime'], ['ws', 'WebSockets', 'Realtime'], ['jsonwebtoken', 'JWT auth', 'Auth'], ['passport', 'Passport auth', 'Auth'], ['bcrypt', 'Password hashing', 'Auth'],
  ['jest', 'Jest', 'Testing'], ['vitest', 'Vitest', 'Testing'], ['mocha', 'Mocha', 'Testing'], ['@playwright/test', 'Playwright', 'Testing'], ['pytest', 'pytest', 'Testing'], ['cypress', 'Cypress', 'Testing'],
];
function depsOf(files) {
  const deps = new Map(); // name -> {version, from}
  const add = (n, v, from) => { if (n && !deps.has(n)) deps.set(n, { version: v || '', from }); };
  for (const f of files) {
    const name = f.path.split('/').pop().toLowerCase();
    if (name === 'package.json') { try { const j = JSON.parse(f.text); for (const k of ['dependencies', 'devDependencies']) for (const [n, v] of Object.entries(j[k] || {})) add(n, v, 'package.json'); } catch (e) { /* not JSON */ } }
    else if (name === 'requirements.txt') for (const l of f.text.split('\n')) { const m = l.trim().match(/^([A-Za-z0-9_.-]+)\s*([=<>!~]=?\s*[\w.*]+)?/); if (m && !l.trim().startsWith('#')) add(m[1].toLowerCase(), (m[2] || '').replace(/\s/g, ''), 'requirements.txt'); }
    else if (name === 'pyproject.toml') for (const m of f.text.matchAll(/^\s*"?([A-Za-z0-9_.-]+)\s*[>=<~^]/gm)) add(m[1].toLowerCase(), '', 'pyproject.toml');
    else if (name === 'go.mod') for (const m of f.text.matchAll(/^\s*(?:require\s+)?([\w.-]+\.[\w./-]+)\s+(v[\w.-]+)/gm)) add(m[1], m[2], 'go.mod');
    else if (name === 'gemfile') for (const m of f.text.matchAll(/^\s*gem\s+['"]([\w-]+)['"]/gm)) add(m[1], '', 'Gemfile');
    else if (name === 'composer.json') { try { for (const [n, v] of Object.entries(JSON.parse(f.text).require || {})) add(n, v, 'composer.json'); } catch (e) { /* not JSON */ } }
    else if (name === 'pom.xml') for (const m of f.text.matchAll(/<artifactId>([\w.-]+)<\/artifactId>/g)) add(m[1], '', 'pom.xml');
  }
  return deps;
}
function stackOf(deps, files) {
  const hay = new Set([...deps.keys()]);
  for (const f of files) for (const m of f.text.matchAll(/(?:from|import)\s+['"]?([@\w/.-]+)/g)) hay.add(m[1].replace(/^['"]|['"]$/g, ''));
  const found = new Map();
  for (const [key, name, kind] of STACK) if ([...hay].some(h => h === key || h.startsWith(key + '/') || h.includes(key) && key.includes('/'))) found.set(name, kind);
  if (files.some(f => /(^|\/)dockerfile$/i.test(f.path))) found.set('Docker', 'Deploy');
  if (files.some(f => /docker-compose\.ya?ml$/i.test(f.path))) found.set('Docker Compose', 'Deploy');
  if (files.some(f => /\.github\/workflows\//.test(f.path))) found.set('GitHub Actions', 'CI');
  if (files.some(f => /(^|\/)netlify\.toml$/.test(f.path))) found.set('Netlify', 'Deploy');
  if (files.some(f => /(^|\/)vercel\.json$/.test(f.path))) found.set('Vercel', 'Deploy');
  return [...found].map(([name, kind]) => ({ name, kind }));
}
// HTTP routes: Express/Fastify/Koa-style, Flask, FastAPI, Django urls, Next.js / file routes.
function routesOf(files) {
  const out = [];
  for (const f of files) {
    const t = f.text;
    for (const m of t.matchAll(/\b(?:app|router|server|api|fastify)\.(get|post|put|patch|delete|all|use)\(\s*['"`]([^'"`]+)['"`]/g)) if (m[1] !== 'use' || m[2].startsWith('/')) out.push({ method: m[1].toUpperCase(), path: m[2], file: f.path });
    for (const m of t.matchAll(/@(?:\w+)\.route\(\s*['"]([^'"]+)['"](?:[^)]*methods\s*=\s*\[([^\]]+)\])?/g)) out.push({ method: m[2] ? m[2].replace(/['"\s]/g, '').toUpperCase() : 'GET', path: m[1], file: f.path });
    for (const m of t.matchAll(/@(?:app|router|api)\.(get|post|put|patch|delete)\(\s*['"]([^'"]+)['"]/g)) out.push({ method: m[1].toUpperCase(), path: m[2], file: f.path });
    for (const m of t.matchAll(/\b(?:re_)?path\(\s*r?['"]([^'"]*)['"]\s*,\s*([\w.]+)/g)) if (/urls\.py$/.test(f.path)) out.push({ method: 'ANY', path: '/' + m[1], file: f.path });
    const page = f.path.match(/(?:^|\/)(?:pages|app)\/(api\/[^.]+)\.(js|ts|jsx|tsx)$/) || f.path.match(/(?:^|\/)app\/(api\/.+)\/route\.(js|ts)$/);
    if (page) out.push({ method: 'ANY', path: '/' + page[1].replace(/\/index$/, '').replace(/\[(\w+)\]/g, ':$1'), file: f.path });
  }
  const seen = new Set();
  return out.filter(r => { const k = r.method + r.path; if (seen.has(k)) return false; seen.add(k); return true; }).slice(0, 200);
}
// The data model, as database-schema code: SQL, Prisma, Django models, Mongoose schemas.
function modelOf(files) {
  const sql = files.filter(f => /\.(sql|ddl)$/i.test(f.path)).map(f => f.text).join('\n;\n');
  const r = sql ? readSql(sql) : null;
  if (r && r.tables) return { code: r.code, tables: r.tables, from: 'SQL' };
  const tables = [], rels = [];
  for (const f of files.filter(x => /\.prisma$/i.test(x.path))) {
    const names = new Set([...f.text.matchAll(/^\s*model\s+(\w+)\s*\{/gm)].map(m => m[1]));
    for (const m of f.text.matchAll(/^\s*model\s+(\w+)\s*\{([\s\S]*?)^\s*\}/gm)) {
      const cols = [];
      for (const l of m[2].split('\n')) {
        const c = l.trim().match(/^(\w+)\s+(\w+)(\[\])?(\?)?(.*)$/);
        if (!c || c[1].startsWith('@@')) continue;
        if (names.has(c[2])) { const rel = c[5].match(/fields:\s*\[(\w+)\][^\]]*references:\s*\[(\w+)\]/); if (rel) rels.push(`${m[1]}.${rel[1]} > ${c[2]}.${rel[2]}`); continue; }
        cols.push(`  ${c[1]} ${c[2].toLowerCase()}${/@id\b/.test(c[5]) ? ' pk' : /@unique\b/.test(c[5]) ? ' unique' : ''}`);
      }
      tables.push(`${m[1]} {\n${cols.join('\n')}\n}`);
    }
  }
  for (const f of files.filter(x => /models?\.py$/i.test(x.path))) {
    for (const m of f.text.matchAll(/^class\s+(\w+)\((?:[\w.]*Model|db\.Model|Base)\):([\s\S]*?)(?=^class\s|\Z)/gm)) {
      const cols = ['  id int pk'];
      for (const c of m[2].matchAll(/^\s+(\w+)\s*=\s*(?:models|db|Column)?\.?(\w+)\(([^)]*)\)/gm)) {
        if (/ForeignKey|OneToOne/.test(c[2])) { const to = (c[3].match(/['"]?(\w+)['"]?/) || [])[1] || 'x'; cols.push(`  ${c[1]}_id int fk`); rels.push(`${m[1]}.${c[1]}_id > ${to}.id`); }
        else if (!/ManyToMany|relationship/.test(c[2])) cols.push(`  ${c[1]} ${c[2].replace(/Field$/, '').toLowerCase() || 'text'}`);
      }
      tables.push(`${m[1]} {\n${cols.join('\n')}\n}`);
    }
  }
  for (const f of files.filter(x => /\.(js|ts)$/.test(x.path) && /mongoose/.test(x.text))) {
    for (const m of f.text.matchAll(/(?:const|let|var)\s+(\w+?)Schema\s*=\s*new\s+(?:mongoose\.)?Schema\(\s*\{([\s\S]*?)\}\s*(?:,|\))/g)) {
      const cols = ['  _id objectid pk'];
      for (const c of m[2].matchAll(/^\s*(\w+)\s*:\s*\{?\s*(?:type\s*:\s*)?\[?\s*(\w+(?:\.\w+)*)/gm)) {
        if (/ObjectId/.test(c[2])) { const ref = (m[2].slice(c.index).match(/ref\s*:\s*['"](\w+)['"]/) || [])[1]; cols.push(`  ${c[1]} objectid fk`); if (ref) rels.push(`${m[1]}.${c[1]} > ${ref}._id`); }
        else cols.push(`  ${c[1]} ${c[2].split('.').pop().toLowerCase()}`);
      }
      tables.push(`${m[1].replace(/^\w/, x => x.toUpperCase())} {\n${cols.join('\n')}\n}`);
    }
  }
  if (!tables.length) return null;
  return { code: tables.join('\n') + (rels.length ? '\n\n' + [...new Set(rels)].join('\n') : '') + '\n', tables: tables.length, from: 'models' };
}
// Which local file uses which: JS/TS imports and requires, Python imports.
function importsOf(files) {
  const byPath = new Map(files.map(f => [f.path, f]));
  const resolve = (from, spec) => {
    if (!spec.startsWith('.')) return null;
    const dir = from.split('/').slice(0, -1);
    for (const part of spec.split('/')) { if (part === '..') dir.pop(); else if (part !== '.') dir.push(part); }
    const base = dir.join('/');
    for (const c of [base, ...['.js', '.jsx', '.ts', '.tsx', '.mjs', '.vue', '.svelte'].map(e => base + e), ...['/index.js', '/index.ts', '/index.jsx', '/index.tsx'].map(e => base + e)]) if (byPath.has(c)) return c;
    return null;
  };
  const pyMods = new Map(files.filter(f => f.path.endsWith('.py')).map(f => [f.path.replace(/\.py$/, '').replace(/\//g, '.').replace(/\.__init__$/, ''), f.path]));
  const edges = [];
  for (const f of files) {
    if (/\.(m?[jt]sx?|vue|svelte|cjs)$/.test(f.path)) for (const m of f.text.matchAll(/(?:import\s[^'"]*?from\s*|import\s*\(\s*|require\(\s*|import\s+)['"]([^'"]+)['"]/g)) { const to = resolve(f.path, m[1]); if (to && to !== f.path) edges.push([f.path, to]); }
    if (f.path.endsWith('.py')) for (const m of f.text.matchAll(/^\s*(?:from\s+([\w.]+)\s+import|import\s+([\w.]+))/gm)) {
      const name = (m[1] || m[2]).replace(/^\.+/, '');
      const to = [...pyMods].find(([k]) => k === name || k.endsWith('.' + name))?.[1];
      if (to && to !== f.path) edges.push([f.path, to]);
    }
  }
  return edges;
}
const kindOfFile = p => (/(^|\/)(routes?|controllers?|api|handlers?|views?)\//i.test(p) ? 'api' : /(^|\/)(models?|schema|entities|db|database|migrations?)\//i.test(p) || /models?\.(py|js|ts)$/.test(p) ? 'database' : /(^|\/)(components?|pages?|app|ui|screens?)\//i.test(p) || /\.(jsx|tsx|vue|svelte)$/.test(p) ? 'client' : /(^|\/)(services?|lib|utils?|helpers?)\//i.test(p) ? 'service' : /test|spec/i.test(p) ? 'function' : 'service');

export function reverseCode(files, name = 'Project') {
  files = files.filter(f => typeof f.text === 'string' && f.text.length < 2e6);
  if (!files.length) throw new Error('No code files to look at.');
  const langs = new Map();
  let lines = 0;
  for (const f of files) { const l = LANG[extOf(f.path)]; const n = f.text.split('\n').length; lines += n; if (l) { const x = langs.get(l) || { files: 0, lines: 0 }; x.files++; x.lines += n; langs.set(l, x); } }
  const deps = depsOf(files), stack = stackOf(deps, files), routes = routesOf(files), model = modelOf(files), edges = importsOf(files);
  const entries = files.filter(f => /(^|\/)(index|main|app|server|manage|wsgi|asgi)\.(js|ts|mjs|py|go|jsx|tsx)$/i.test(f.path) || /(^|\/)main\.go$/.test(f.path)).map(f => f.path).slice(0, 10);
  // Modules for the diagram: the most connected files, grouped by their top folder.
  const degree = new Map();
  for (const [a, b] of edges) { degree.set(a, (degree.get(a) || 0) + 1); degree.set(b, (degree.get(b) || 0) + 1); }
  const top = [...degree].sort((x, y) => y[1] - x[1]).slice(0, 28).map(([p]) => p), keep = new Set(top);
  const groups = new Map();
  for (const p of top) { const g = p.includes('/') ? p.split('/')[0] : '(root)'; (groups.get(g) || groups.set(g, []).get(g)).push(p); }
  const nid = p => ident(p.replace(/\.\w+$/, ''));
  const arch = [`title: ${name}: modules`];
  for (const [g, ps] of groups) {
    if (g !== '(root)') arch.push(`group ${ident(g)} "${g}" {`);
    for (const p of ps) arch.push(`${g !== '(root)' ? '  ' : ''}${nid(p)} [${p.split('/').pop()} | ${p.split('/').slice(0, -1).join('/') || 'root'}] ${kindOfFile(p)}`);
    if (g !== '(root)') arch.push('}');
  }
  for (const [a, b] of [...new Set(edges.map(e => e.join('>')))].map(e => e.split('>'))) if (keep.has(a) && keep.has(b)) arch.push(`${nid(a)} > ${nid(b)}`);
  // The system at a glance: client, server, data and services, from the stack.
  const kinds = k => stack.filter(s => s.kind === k).map(s => s.name);
  const sys = [`title: ${name}: system`, 'user [People] user'];
  if (kinds('Frontend').length) sys.push(`web [Frontend | ${kinds('Frontend').join(', ')}] client`);
  if (kinds('Backend').length || routes.length) sys.push(`api [Backend | ${kinds('Backend').join(', ') || 'HTTP API'}] api`);
  if (kinds('Database').length) sys.push(`db [Database | ${kinds('Database').join(', ')}] database`);
  if (kinds('Cache').length) sys.push(`cache [Cache | ${kinds('Cache').join(', ')}] cache`);
  kinds('Service').forEach((s, i) => sys.push(`svc${i} [${s}] external`));
  const has = id => sys.some(l => l.startsWith(id + ' '));
  if (has('web')) sys.push('user > web'); else if (has('api')) sys.push('user > api');
  if (has('web') && has('api')) sys.push('web > api : HTTP');
  const back = has('api') ? 'api' : has('web') ? 'web' : null;
  if (back && has('db')) sys.push(`${back} > db`);
  if (back && has('cache')) sys.push(`${back} > cache`);
  if (back) kinds('Service').forEach((s, i) => sys.push(`${back} > svc${i}`));
  const diagrams = [dg('architecture', 'System', sys.join('\n'))];
  if (top.length > 1) diagrams.push(dg('architecture', 'Modules', arch.join('\n')));
  if (model) diagrams.push(dg('erd', 'Data model', model.code));
  const langRows = [...langs].sort((a, b) => b[1].lines - a[1].lines).map(([l, x]) => [l, x.files, x.lines.toLocaleString()]);
  const doc = [
    `# Reverse engineered: ${name}`,
    '',
    `**${plural(files.length, 'file')}**, about **${lines.toLocaleString()} lines**${langRows[0] ? `, mostly **${langRows[0][0]}**` : ''}. The canvas has the diagrams: the system at a glance${top.length > 1 ? ', how the files use each other' : ''}${model ? ' and the data model' : ''}.`,
    '',
    '## Tech stack',
    stack.length ? table(['Part', 'What'], stack.map(s => [s.kind, s.name])) : '_Nothing well-known found in the dependencies._',
    '',
    '## Languages',
    table(['Language', 'Files', 'Lines'], langRows),
    '',
    '## Entry points',
    entries.length ? entries.map(p => `- \`${p}\``).join('\n') : '_No obvious entry file (index, main, app, server)._',
    '',
    `## HTTP routes${routes.length ? ` (${routes.length})` : ''}`,
    table(['Method', 'Path', 'File'], routes.map(r => [r.method, `\`${r.path}\``, r.file])),
    '',
    '## Data model',
    model ? `${plural(model.tables, 'table')} found (from ${model.from}); see **Data model** on the canvas.` : '_No SQL, Prisma, Django, SQLAlchemy or Mongoose models found._',
    '',
    '## Most connected files',
    top.length ? table(['File', 'Links'], top.slice(0, 12).map(p => [`\`${p}\``, degree.get(p)])) : '_No imports between the files found._',
    '',
    `## Dependencies${deps.size ? ` (${deps.size})` : ''}`,
    deps.size ? table(['Package', 'Version', 'From'], [...deps].slice(0, 80).map(([n, d]) => [n, d.version, d.from])) : '_No dependency file (package.json, requirements.txt, go.mod…)._',
  ].join('\n');
  return { title: `${name} (reverse engineered)`, doc, diagrams, view: 'doc' };
}

/* ---------------- data ---------------- */
const typeOf = v => (v === null || v === undefined ? 'text' : typeof v === 'boolean' ? 'boolean' : typeof v === 'number' ? (Number.isInteger(v) ? 'int' : 'float') : typeof v === 'string' ? (/^\d{4}-\d{2}-\d{2}T/.test(v) ? 'timestamp' : /^\d{4}-\d{2}-\d{2}$/.test(v) ? 'date' : /^[^@\s]+@[^@\s]+\.\w+$/.test(v) ? 'email' : /^https?:\/\//.test(v) ? 'url' : 'text') : 'json');
const csvRows = (text, sep) => {
  const rows = []; let row = [], cur = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) { if (ch === '"' && text[i + 1] === '"') { cur += '"'; i++; } else if (ch === '"') q = false; else cur += ch; }
    else if (ch === '"') q = true; else if (ch === sep) { row.push(cur); cur = ''; }
    else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i++; row.push(cur); rows.push(row); row = []; cur = ''; }
    else cur += ch;
  }
  if (cur || row.length) { row.push(cur); rows.push(row); }
  return rows.filter(r => r.some(c => c !== ''));
};
const parseCell = c => (c === '' ? null : /^-?\d+$/.test(c) ? Number(c) : /^-?\d*\.\d+$/.test(c) ? Number(c) : /^(true|false)$/i.test(c) ? c.toLowerCase() === 'true' : c);

export function reverseData(text, name = 'Data') {
  const raw = String(text || '').trim();
  if (!raw) throw new Error('Paste some JSON or CSV first.');
  let data, format;
  try { data = JSON.parse(raw); format = 'JSON'; } catch (e) {
    const sep = raw.split('\n')[0].includes('\t') ? '\t' : raw.split('\n')[0].includes(';') && !raw.split('\n')[0].includes(',') ? ';' : ',';
    const rows = csvRows(raw, sep);
    if (rows.length < 2 || rows[0].length < 2) throw new Error('That isn’t JSON, and it doesn’t look like CSV (a header line and rows) either.');
    const head = rows[0].map((h, i) => h.trim() || `column${i + 1}`);
    data = rows.slice(1).map(r => Object.fromEntries(head.map((h, i) => [h, parseCell((r[i] ?? '').trim())])));
    format = sep === '\t' ? 'TSV' : 'CSV';
  }
  // The records: an array, or the first array inside the object (an API's {data: [...]}), else the object itself.
  let records = Array.isArray(data) ? data : null, path = '';
  if (!records && data && typeof data === 'object') for (const [k, v] of Object.entries(data)) if (Array.isArray(v) && v.length && typeof v[0] === 'object') { records = v; path = k; break; }
  if (!records) records = [data];
  records = records.filter(r => r && typeof r === 'object' && !Array.isArray(r)).slice(0, 2000);
  if (!records.length) throw new Error('No records (objects) found in it.');
  // Tables: the records, and one more for each nested object or list of objects (with a link back).
  const tables = new Map(), rels = [];
  const walk = (tname, list, parent) => {
    const t = tables.get(tname) || { cols: new Map(), parent: null, rows: list.length };
    tables.set(tname, t);
    if (parent && !t.parent) { t.parent = parent; t.cols.set(`${ident(parent)}_id`, 'int fk'); rels.push(`${ident(tname)}.${ident(parent)}_id > ${ident(parent)}.id`); }
    for (const rec of list) for (const [k, v] of Object.entries(rec)) {
      const key = ident(k);
      if (Array.isArray(v) && v.length && v.every(x => x && typeof x === 'object' && !Array.isArray(x))) walk(`${tname}_${key}`, v, tname);
      else if (v && typeof v === 'object' && !Array.isArray(v)) walk(`${tname}_${key}`, [v], tname);
      else if (Array.isArray(v)) { if (!t.cols.has(key)) t.cols.set(key, `${typeOf(v[0])}[]`); }
      else if (!t.cols.has(key) || t.cols.get(key) === 'text') t.cols.set(key, typeOf(v));
    }
  };
  const root = ident(path || name).toLowerCase() || 'records';
  walk(root, records, null);
  const erd = [];
  for (const [tn, t] of tables) {
    erd.push(`${ident(tn)} {`);
    if (!t.cols.has('id')) erd.push('  id int pk');
    for (const [c, ty] of t.cols) erd.push(`  ${c} ${ty}${c === 'id' ? ' pk' : ''}`);
    erd.push('}');
  }
  if (rels.length) erd.push('', ...rels);
  const rootCols = [...tables.get(root).cols.keys()].filter(c => !c.endsWith('_id') || c === 'id');
  // A workflow for it: a webhook that takes this data, picks its fields, and a place to send it on.
  const n = (id, type, nm, x, params) => ({ id, type, name: nm, x, y: 160, params });
  const flow = {
    active: false,
    nodes: [
      n('t', 'trigger.webhook', 'Receive the data', 80, { path: rid('').slice(0, 12) + rid('').slice(0, 8), method: 'POST', respond: 'now' }),
      ...(path ? [n('sp', 'core.split', `Split ${path}`, 340, { field: `body.${path}` })] : []),
      n('s', 'core.set', 'Pick the fields', path ? 600 : 340, { fields: rootCols.slice(0, 12).map(c => ({ name: c, value: `{{ $json${path ? '' : '.body'}.${c} }}` })), keep: false }),
    ],
    edges: [],
  };
  for (let i = 1; i < flow.nodes.length; i++) flow.edges.push({ id: 'e' + i, from: flow.nodes[i - 1].id, to: flow.nodes[i].id, fromPort: 'main', toPort: 'main' });
  const sample = records.slice(0, 5);
  const doc = [
    `# Reverse engineered: ${name}`,
    '',
    `**${format}**, **${plural(records.length, 'record')}**${path ? ` (inside \`${path}\`)` : ''}, made into **${plural(tables.size, 'table')}**. The canvas shows them as a database schema; the workflow (Workflow view) takes data like this at a webhook and picks its fields.`,
    '',
    ...[...tables].flatMap(([tn, t]) => [`## ${tn}`, t.parent ? `Belongs to **${t.parent}** (one row per item).` : `${plural(t.rows, 'record')}.`, '', table(['Field', 'Type'], [...t.cols].map(([c, ty]) => [c, ty])), '']),
    '## Sample',
    '```json',
    JSON.stringify(sample, null, 2).slice(0, 4000),
    '```',
  ].join('\n');
  return { title: `${name} (reverse engineered)`, doc, diagrams: [dg('erd', 'Schema', erd.join('\n') + '\n')], view: 'doc', flow };
}

/* ---------------- workflows ---------------- */
export function reverseWorkflow(text, name) {
  let got;
  try { got = importFlow(String(text || '')); } catch (e) { throw new Error(e.message || 'That isn’t a workflow Workline can read (n8n, Make, Zapier, Node-RED, Power Automate or Workline).'); }
  const flow = got.flow, title = name || got.name || 'Workflow';
  const byId = new Map(flow.nodes.map(x => [x.id, x]));
  const def = x => nodeDef(x.type);
  const triggers = flow.nodes.filter(x => def(x).trigger), apps = [...new Set(flow.nodes.map(x => def(x).group).filter(Boolean))];
  // A flowchart of it: triggers start, branches are decisions, the rest are steps.
  const kind = x => (def(x).trigger ? 'start' : (def(x).outputs || []).length > 1 ? 'decision' : x.type === 'core.noop' ? 'io' : 'step');
  const fc = [`title: ${title}`, ...flow.nodes.map(x => `${ident(x.id)} [${String(x.name).replace(/[[\]]/g, '')}] ${kind(x)}`)];
  for (const e of flow.edges) if (byId.has(e.from) && byId.has(e.to)) fc.push(`${ident(e.from)} > ${ident(e.to)}${e.fromPort && e.fromPort !== 'main' ? ` : ${e.fromPort}` : ''}`);
  // The steps in order, from the triggers.
  const order = [], seen = new Set(), q = [...triggers.map(x => x.id)];
  while (q.length) { const id = q.shift(); if (seen.has(id)) continue; seen.add(id); order.push(byId.get(id)); flow.edges.filter(e => e.from === id).forEach(e => q.push(e.to)); }
  flow.nodes.forEach(x => { if (!seen.has(x.id)) order.push(x); });
  const placeholders = flow.nodes.filter(x => x.type === 'core.noop' && x.note);
  const doc = [
    `# Reverse engineered: ${title}`,
    '',
    `A **${got.app || 'workflow'}** workflow with **${plural(flow.nodes.length, 'step')}**, made into a Workline workflow (open the **Workflow** view to run it). It starts from ${triggers.length ? triggers.map(x => `**${x.name}**`).join(', ') : 'no trigger (add Run by hand)'}.`,
    '',
    '## Steps',
    table(['#', 'Step', 'Kind', 'Does'], order.map((x, i) => [i + 1, x.name, def(x).label || x.type, def(x).note || ''])),
    '',
    '## Uses',
    apps.length ? apps.map(a => `- ${a}`).join('\n') : '_Nothing._',
    '',
    `## To redo by hand${placeholders.length ? ` (${placeholders.length})` : ''}`,
    placeholders.length ? placeholders.map(x => `- **${x.name}**: ${x.note.split('\n')[0]}`).join('\n') : 'Nothing: every step has a Workline node.',
    ...(got.skipped && got.skipped.length ? ['', '## Left out', got.skipped.map(s => `- ${s}`).join('\n')] : []),
  ].join('\n');
  return { title: `${title} (reverse engineered)`, doc, diagrams: [dg('flowchart', 'Flow', fc.join('\n'))], view: 'doc', flow };
}

/* ---------------- websites ---------------- */
export function reverseSite(info, url) {
  const host = (() => { try { return new URL(url).host; } catch (e) { return url; } })();
  const pages = (info.links || []).filter(l => l.internal).slice(0, 24);
  const ext = [...new Set((info.links || []).filter(l => !l.internal).map(l => { try { return new URL(l.href).host; } catch (e) { return ''; } }).filter(Boolean))].slice(0, 12);
  // A map of the site: the page, the pages it links to, then the outside services it uses.
  const sm = [`title: ${host}`, `home [${String(info.title || host).replace(/[[\]]/g, '').slice(0, 40)}] start`];
  pages.forEach((p, i) => { sm.push(`p${i} [${(p.path || '/').slice(0, 40)}] step`); sm.push(`home > p${i}`); });
  const arch = [`title: ${host}: what it runs on`, 'user [Visitor] user', `site [${host} | ${(info.tech || []).filter(t => t.kind === 'Framework' || t.kind === 'Server').map(t => t.name).join(', ') || 'website'}] client`, 'user > site'];
  (info.tech || []).filter(t => !['Framework', 'Server'].includes(t.kind)).slice(0, 10).forEach((t, i) => { arch.push(`t${i} [${t.name} | ${t.kind}] external`); arch.push(`site > t${i}`); });
  (info.apis || []).slice(0, 6).forEach((a, i) => { arch.push(`a${i} [${a.slice(0, 40)} | API call] api`); arch.push(`site > a${i}`); });
  const doc = [
    `# Reverse engineered: ${host}`,
    '',
    `**${info.title || host}**${info.description ? `: ${info.description}` : ''}`,
    '',
    `Looked at ${url} (status ${info.status}${info.server ? `, server ${info.server}` : ''}). The canvas has a map of its pages and what it runs on. Only the page itself was read, as a visitor sees it.`,
    '',
    '## Technologies',
    table(['Kind', 'What', 'Seen in'], (info.tech || []).map(t => [t.kind, t.name, t.evidence])),
    '',
    `## Pages it links to (${pages.length})`,
    table(['Page', 'Link text'], pages.map(p => [`\`${p.path}\``, p.text])),
    '',
    `## Forms (${(info.forms || []).length})`,
    table(['Action', 'Method', 'Fields'], (info.forms || []).map(f => [f.action || '(this page)', f.method, f.fields.join(', ')])),
    '',
    `## API calls in its scripts (${(info.apis || []).length})`,
    (info.apis || []).length ? info.apis.map(a => `- \`${a}\``).join('\n') : '_None seen in the page’s own scripts._',
    '',
    '## Outside sites it uses',
    ext.length ? ext.map(h => `- ${h}`).join('\n') : '_None._',
    '',
    '## Page facts',
    table(['What', 'Value'], [['Scripts', info.scripts], ['Stylesheets', info.styles], ['Images', info.images], ['Headings', (info.headings || []).slice(0, 6).join(' · ')], ['Language', info.lang || ''], ['robots.txt', info.robots ? 'yes' : 'no'], ['Sitemap', info.sitemap ? `${info.sitemap} URLs` : 'no']]),
  ].join('\n');
  return { title: `${host} (reverse engineered)`, doc, diagrams: [dg('flowchart', 'Site map', sm.join('\n')), dg('architecture', 'Tech', arch.join('\n'))], view: 'doc' };
}
