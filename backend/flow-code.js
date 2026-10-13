/* The Code node in many languages.
   - JavaScript, TypeScript, Python, Lua and SQL run here, in code-sandbox.js: a separate Node process
     locked down with Node's permission model (no files, no processes, no environment), one per
     language, kept warm between runs and restarted when code runs too long.
   - Compiled and other languages (Go, Java, C, C++, C#, Rust, Ruby, PHP…) run on a code runner the user
     connects as a credential: a Piston server or Judge0 (its own, or Judge0 on RapidAPI). The program
     gets the items as JSON on stdin and prints its new items as JSON (the last line of its output). */
import { fork } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export const LOCAL_LANGS = ['javascript', 'typescript', 'python', 'lua', 'sql'];
// Each runner language: its Piston name, its Judge0 CE language id and a file name.
export const RUNNER_LANGS = {
  go: ['go', 60, 'main.go'], java: ['java', 62, 'Main.java'], c: ['c', 50, 'main.c'], cpp: ['c++', 54, 'main.cpp'],
  csharp: ['csharp', 51, 'main.cs'], rust: ['rust', 73, 'main.rs'], ruby: ['ruby', 72, 'main.rb'], php: ['php', 68, 'main.php'],
  kotlin: ['kotlin', 78, 'main.kt'], swift: ['swift', 83, 'main.swift'], bash: ['bash', 46, 'main.sh'], r: ['rscript', 80, 'main.r'],
  perl: ['perl', 85, 'main.pl'], scala: ['scala', 81, 'main.scala'], haskell: ['haskell', 61, 'main.hs'], dart: ['dart', 90, 'main.dart'],
  elixir: ['elixir', 57, 'main.exs'],
};
const LIMIT = { javascript: 10_000, typescript: 10_000, python: 60_000, lua: 10_000, sql: 10_000 };

const here = dirname(fileURLToPath(import.meta.url));
const SANDBOX = join(here, 'code-sandbox.js');
const CACHE = join(tmpdir(), 'workline-pyodide');
// The folders the sandbox may read: its own file and the runtimes' packages (wherever npm put them).
const readable = () => {
  const req = createRequire(import.meta.url), dirs = new Set([SANDBOX, CACHE]);
  for (const p of ['pyodide', 'wasmoon', 'sucrase', 'sql.js']) {
    try { const f = req.resolve(p), i = f.lastIndexOf(sep + 'node_modules' + sep); if (i > 0) dirs.add(f.slice(0, i + 14)); } catch (e) { /* not installed */ }
  }
  return [...dirs];
};

class Sandbox {
  constructor(lang) { this.lang = lang; this.queue = []; this.busy = null; this.proc = null; }
  start() {
    try { mkdirSync(CACHE, { recursive: true }); } catch (e) { /* read-only disk: no package cache */ }
    const flags = ['--permission', ...readable().map(d => `--allow-fs-read=${d}`), `--allow-fs-write=${CACHE}`, '--max-old-space-size=384'];
    // Keep the proxy settings (where a network needs them), nothing else from this process.
    const keep = Object.fromEntries(['HTTPS_PROXY', 'HTTP_PROXY', 'NO_PROXY', 'https_proxy', 'http_proxy', 'no_proxy', 'NODE_EXTRA_CA_CERTS', 'NODE_USE_ENV_PROXY'].filter(k => process.env[k]).map(k => [k, process.env[k]]));
    const proc = fork(SANDBOX, [CACHE], { execArgv: flags, env: keep, cwd: here, stdio: ['ignore', 'ignore', 'pipe', 'ipc'], serialization: 'advanced' });
    let err = '';
    proc.stderr.on('data', d => { err = (err + d).slice(-2000); });
    proc.on('message', m => {
      if (m.ready || !this.busy || m.id !== this.busy.id) return;
      const job = this.busy; this.busy = null; clearTimeout(job.timer);
      this.idle(proc);
      if (m.error) job.reject(Object.assign(new Error(m.error), { logs: m.logs }));
      else job.resolve({ result: m.none ? undefined : m.result, logs: m.logs || [] });
      this.next();
    });
    proc.on('exit', () => {
      if (this.proc !== proc) return;
      this.proc = null;
      if (this.busy) {
        const job = this.busy; this.busy = null; clearTimeout(job.timer);
        job.reject(new Error(job.timedOut ? `it ran for more than ${Math.round(LIMIT[this.lang] / 1000)} seconds` : `the ${this.lang} sandbox stopped${/heap|memory/i.test(err) ? ' (out of memory)' : ''}`));
      }
      this.next();
    });
    this.proc = proc;
    this.idle(proc);
  }
  // A sandbox waiting for work doesn't keep the server running.
  idle(proc) { proc.unref(); proc.channel?.unref(); }
  run(code, items) {
    return new Promise((resolve, reject) => { this.queue.push({ id: Math.random().toString(36).slice(2), code, items, resolve, reject }); this.next(); });
  }
  next() {
    if (this.busy || !this.queue.length) return;
    if (!this.proc) this.start();
    const job = this.busy = this.queue.shift();
    this.proc.ref(); this.proc.channel?.ref();
    job.timer = setTimeout(() => { job.timedOut = true; this.proc && this.proc.kill('SIGKILL'); }, LIMIT[this.lang]);
    this.proc.send({ id: job.id, lang: this.lang, code: job.code, items: job.items });
  }
  stop() { this.queue = []; if (this.proc) { const p = this.proc; this.proc = null; p.kill('SIGKILL'); } }
}
const pools = {};
export const stopSandboxes = () => { for (const s of Object.values(pools)) s.stop(); };

// Run code in one of the local languages: {result, logs}. result undefined means "no answer".
export function runLocal(lang, code, items) {
  if (!LOCAL_LANGS.includes(lang)) throw new Error(`Unknown language: ${lang}`);
  return (pools[lang] ||= new Sandbox(lang)).run(code, items);
}

// Run code on a Piston or Judge0 server. The last line of output that's JSON is the result.
export async function runRemote(lang, code, items, cred) {
  const spec = RUNNER_LANGS[lang];
  if (!spec) throw new Error(`Unknown language: ${lang}`);
  if (!cred || !cred.url) throw new Error(`${lang} runs on a code runner: pick a Code runner credential (a Piston or Judge0 server).`);
  const base = String(cred.url).replace(/\/+$/, ''), stdin = JSON.stringify(items);
  const judge0 = /judge0/i.test(cred.service || '') || (!cred.service && /judge0/i.test(base));
  let stdout = '', failed = '';
  if (judge0) {
    const headers = { 'content-type': 'application/json' };
    if (cred.apiKey) {
      if (/rapidapi\.com/i.test(base)) Object.assign(headers, { 'x-rapidapi-key': cred.apiKey, 'x-rapidapi-host': new URL(base).host });
      else headers['x-auth-token'] = cred.apiKey;
    }
    const r = await fetch(`${base}/submissions?base64_encoded=false&wait=true`, { method: 'POST', headers, body: JSON.stringify({ source_code: code, language_id: spec[1], stdin }), signal: AbortSignal.timeout(60_000) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(`The code runner answered ${r.status}: ${j.error || j.message || r.statusText}`);
    stdout = j.stdout || '';
    if (j.compile_output && j.status?.id === 6) failed = j.compile_output;
    else if (j.status && j.status.id !== 3) failed = j.stderr || j.message || j.status.description;
  } else {
    const headers = { 'content-type': 'application/json' };
    if (cred.apiKey) headers.authorization = cred.apiKey;
    const r = await fetch(`${base}/api/v2/execute`, { method: 'POST', headers, body: JSON.stringify({ language: spec[0], version: '*', files: [{ name: spec[2], content: code }], stdin }), signal: AbortSignal.timeout(60_000) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(`The code runner answered ${r.status}: ${j.message || r.statusText}`);
    if (j.compile && j.compile.code) failed = j.compile.stderr || j.compile.output || 'It didn’t compile.';
    else if (j.run && (j.run.code || j.run.signal)) failed = j.run.stderr || j.run.output || `It stopped (${j.run.signal || 'exit ' + j.run.code}).`;
    stdout = (j.run && j.run.stdout) || '';
  }
  if (failed) throw new Error(String(failed).trim().slice(0, 2000));
  const lines = stdout.replace(/\s+$/, '').split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    const t = lines[i].trim();
    if (!t) continue;
    try { return { result: JSON.parse(t), logs: lines.slice(0, i).filter(Boolean) }; } catch (e) { break; }
  }
  return { result: stdout ? { output: stdout } : undefined, logs: [] };
}
