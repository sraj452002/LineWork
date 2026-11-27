import { useRef, useState } from 'react';
import { api } from '../lib/backend.js';
import { readZip } from '../lib/zipimport.js';
import { reverseCode, reverseData, reverseSite, reverseWorkflow } from '../lib/reverse.js';

/* Tools → Reverse engineer: take something apart and get a Workline file that explains it — a report
   (doc), diagrams on the canvas, and for data and workflows a workflow too. Four kinds: a code project
   (a .zip, files, or pasted code), a website (its address), data (JSON, CSV or an API response), and
   a workflow from n8n, Make, Zapier, Node-RED or Power Automate. */
const KINDS = [
  ['code', 'Code / project', 'A .zip of a project, some files, or code pasted in: its stack, routes, data model and how the files connect.'],
  ['site', 'Website', 'A web address: its technologies, pages, forms and the API calls its page makes (read as a visitor sees it).'],
  ['data', 'Data / JSON', 'JSON, CSV or an API response: its schema as database tables, and a workflow that takes data like it.'],
  ['flow', 'Workflow', 'An n8n, Make, Zapier, Node-RED or Power Automate export: the steps explained, and a Workline workflow to run.'],
];
const TEXTY = /\.(js|jsx|ts|tsx|mjs|cjs|py|go|rb|rs|java|kt|swift|c|h|cpp|hpp|cs|php|sh|html|css|scss|vue|svelte|yaml|yml|toml|xml|graphql|proto|prisma|sql|ddl|json|md|txt|ini|gradle)$|(^|\/)(dockerfile|makefile|gemfile|requirements\.txt|go\.mod|package\.json)$/i;

export default function ReverseDialog({ onClose, onMake, initial = 'code' }) {
  const [kind, setKind] = useState(initial);
  const [text, setText] = useState(''), [url, setUrl] = useState(''), [files, setFiles] = useState(null);
  const [busy, setBusy] = useState(false), [err, setErr] = useState('');
  const pick = useRef(null);
  const reset = k => { setKind(k); setErr(''); setText(''); setFiles(null); };
  // Files picked: a zip is opened; others are read as text (only the code-ish ones).
  const choose = async list => {
    setErr('');
    const all = [...(list || [])];
    if (!all.length) return;
    try {
      if (all.length === 1 && /\.zip$/i.test(all[0].name)) {
        const z = await readZip(all[0]);
        const got = [...z.code, ...z.schemas, ...z.docs, ...z.workflows.map(w => ({ path: w.path, text: JSON.stringify({ workline: 'workflow', flow: w.flow }) }))].filter(f => typeof f.text === 'string');
        setFiles({ name: z.name, list: got });
      } else {
        const got = [];
        for (const f of all.slice(0, 400)) if (TEXTY.test(f.webkitRelativePath || f.name) && f.size < 2e6) got.push({ path: f.webkitRelativePath || f.name, text: await f.text() });
        if (kind === 'code') setFiles({ name: (all[0].webkitRelativePath || '').split('/')[0] || all[0].name.replace(/\.\w+$/, ''), list: got });
        else setText(got[0]?.text || await all[0].text());
      }
    } catch (e) { setErr(e.message || 'Those files couldn’t be read.'); }
  };
  const go = async () => {
    setErr(''); setBusy(true);
    try {
      let made;
      if (kind === 'code') {
        const list = files?.list?.length ? files.list : text.trim() ? [{ path: guessName(text), text }] : [];
        if (!list.length) throw new Error('Pick a .zip or some files, or paste code.');
        made = reverseCode(list, files?.name || 'Pasted code');
      } else if (kind === 'site') {
        if (!url.trim()) throw new Error('Type a web address, like example.com.');
        const info = await api(`/reverse/site?url=${encodeURIComponent(url.trim())}`);
        made = reverseSite(info, info.url || url.trim());
      } else if (kind === 'data') made = reverseData(text, files?.name || 'Data');
      else made = reverseWorkflow(text);
      onMake(made);
    } catch (e) { setErr(e.message || 'That couldn’t be taken apart.'); }
    setBusy(false);
  };
  const desc = KINDS.find(k => k[0] === kind);
  return (
    <div className="modal" onPointerDown={e => { if (e.target === e.currentTarget && !busy) onClose(); }}>
      <div className="mbox rev" role="dialog" aria-modal="true" aria-label="Reverse engineer" onKeyDown={e => { if (e.key === 'Escape' && !busy) onClose(); }}>
        <header className="rev-head">
          <i aria-hidden="true">⟲</i>
          <div><h3>Reverse engineer</h3><p>Take something apart: you get a report, diagrams and (for data and workflows) a workflow, in a new file.</p></div>
          <button className="rs-ib" aria-label="Close" onClick={onClose}>×</button>
        </header>
        <div className="rev-tabs" role="tablist">
          {KINDS.map(([k, label]) => <button key={k} role="tab" aria-selected={kind === k} className={kind === k ? 'on' : ''} onClick={() => reset(k)}>{label}</button>)}
        </div>
        <p className="rev-desc">{desc[2]}</p>
        {kind === 'site' ? (
          <label className="rev-f"><span>Web address</span><input autoFocus value={url} onChange={e => setUrl(e.target.value)} placeholder="example.com" onKeyDown={e => { if (e.key === 'Enter') go(); }} aria-label="Web address" /></label>
        ) : (
          <>
            <div className="rev-pick">
              <button type="button" className="btn" onClick={() => pick.current?.click()}>{kind === 'code' ? '⬆ Pick a .zip or files' : '⬆ Pick a file'}</button>
              {files && <span className="rev-got">{files.name}: {files.list.length} file{files.list.length === 1 ? '' : 's'} read</span>}
              <input ref={pick} type="file" hidden multiple={kind === 'code'} aria-label="Files to reverse engineer"
                accept={kind === 'code' ? '.zip,application/zip,*' : kind === 'data' ? '.json,.csv,.tsv,.txt,application/json,text/csv' : '.json,application/json'}
                onChange={e => { choose(e.target.files); e.target.value = ''; }} />
            </div>
            <label className="rev-f"><span>{kind === 'code' ? 'Or paste code' : kind === 'data' ? 'Or paste JSON / CSV' : 'Or paste the workflow JSON'}</span>
              <textarea value={text} onChange={e => setText(e.target.value)} rows={9} spellCheck={false} aria-label="Paste here"
                placeholder={kind === 'code' ? 'app.get("/users", …)' : kind === 'data' ? '[{"id": 1, "name": "Ada", "orders": [{"total": 40}]}]' : '{"nodes": [...], "connections": {...}}'} />
            </label>
          </>
        )}
        {err && <p className="rev-err" role="alert">{err}</p>}
        <footer className="rev-foot">
          <button className="btn" onClick={onClose} disabled={busy}>Cancel</button>
          <button className="btn primary" onClick={go} disabled={busy}>{busy ? <><i className="spin" />Taking it apart…</> : '⟲ Reverse engineer'}</button>
        </footer>
      </div>
    </div>
  );
}
// A name for pasted code, from what it looks like.
const guessName = t => (/^\s*(import|from)\s+\w+|def\s+\w+\(|:\s*$/m.test(t) && !/[{};]\s*$/m.test(t) ? 'pasted.py' : /\bfunc\s+\w+\(|package\s+main/.test(t) ? 'pasted.go' : /<\w+[\s>]/.test(t) && /<\/\w+>/.test(t) ? 'pasted.html' : /CREATE\s+TABLE/i.test(t) ? 'pasted.sql' : 'pasted.js');
