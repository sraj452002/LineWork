import { useEffect, useState } from 'react';
import { CRED_TYPES } from '../lib/flows.js';
import { nodeVideos, nodeVideoUrl } from '../lib/nodevideos.js';
import { CRED_SETUP, NODE_GUIDE, NODE_SETUP } from '../lib/flowguide.js';
import { LOGOS } from '../lib/flowlogos.js';
import { defaultsOf, exampleOf, meets, showValue } from '../lib/nodeexamples.js';

/* One workflow node explained: what it does, its settings, where its credential comes from, an
   example and what it gives. Shown in the Workflows guide and as a popup from the editor. */

const X = ({ children }) => <pre className="gx-code gf-ex">{children}</pre>;
// Very dark logos take the text colour, to show on dark backgrounds.
const dark = hex => { const n = parseInt(hex.slice(1), 16); return ((n >> 16) * 299 + ((n >> 8) & 255) * 587 + (n & 255) * 114) / 1000 < 60; };
function NodeMark({ d }) {
  const logo = d.logo && LOGOS[d.logo];
  return (
    <i className={'gn-mark t-' + d.tone}>
      <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true" className={logo ? 'logo' : ''} style={logo ? { fill: dark(logo.color) ? 'var(--ink)' : logo.color } : undefined}><path d={logo ? logo.d : d.icon} /></svg>
    </i>
  );
}
// What a field asks for: its note in the guide, else its hint, else its choices.
const fieldText = (f, notes = {}) => notes[f.k] || [
  f.hint && <>e.g. <code>{f.hint.replace(/^e\.g\.?\s*/i, '')}</code></>,
  f.options && f.options.map(o => o[1]).join(' · '),
  f.kind === 'bool' && 'On or off.',
  f.kind === 'file' && 'Pick one of your Workline files.',
  f.kind === 'workflow' && 'Pick another workflow file.',
  f.kind === 'dbconn' && 'A connection saved in the Database view.',
  f.kind === 'pairs' && 'Name and value rows.',
].find(Boolean) || '';
// One setting, as an instruction: what to do with it, its choices or an example, and whether it can stay blank.
const optionalOf = f => /optional|blank|leave empty|empty:/i.test(`${f.label} ${f.hint || ''}`);
const nameOf = f => f.label.replace(/\s*\((optional|blank[^)]*)\)\s*/ig, ' ').trim();
const choiceText = (f, def) => {
  const opts = (f.options || []).map(o => o[1]);
  const list = opts.length > 7 ? `${opts.slice(0, 7).join(' · ')} · …` : opts.join(' · ');
  const start = (f.options || []).find(o => String(o[0]) === String(def ?? ''))?.[1];
  return <>{list}{start ? <> (starts on <i>{start}</i>)</> : null}</>;
};
function fieldStep(f, def, notes = {}, sample) {
  const L = <b>{nameOf(f)}</b>, note = notes[f.k];
  // An example: the field's hint, else the value the node's example setup uses.
  const egText = (f.hint && f.hint.replace(/^e\.g\.?\s*/i, '')) || (sample !== undefined && sample !== '' && f.kind !== 'select' && f.kind !== 'bool' ? showValue(f, sample) : '');
  const eg = egText ? <> e.g. <code>{String(egText).length > 90 ? String(egText).slice(0, 90) + '…' : egText}</code></> : null;
  const opt = optionalOf(f) ? <span className="gn-opt"> optional</span> : null;
  let main;
  switch (f.kind) {
    case 'select': main = <>Choose {L}: {choiceText(f, def)}.</>; break;
    case 'bool': main = <>Switch {L} {def ? 'off' : 'on'} if you need it (it starts {def ? 'on' : 'off'}).</>; break;
    case 'file': main = <>Pick the Workline file in {L}.</>; break;
    case 'workflow': main = <>Pick the workflow in {L} (save it first).</>; break;
    case 'dbconn': main = <>Pick a connection saved in the Database view in {L}.</>; break;
    case 'pairs': main = <>Add rows in {L}: a name and a value each.{eg}</>; break;
    case 'code': main = <>Write the code in {L}.{eg}</>; break;
    case 'number': main = <>Set {L} to a number{def !== undefined && def !== '' ? <> (starts at <code>{String(def)}</code>)</> : null}.{eg}</>; break;
    case 'aimodel': main = <>Pick the AI model in {L} (blank: the same as AI chat).</>; break;
    case 'agent': main = <>Pick one of your agents in {L}, or leave it on None and describe the task below.</>; break;
    default: main = <>Fill in {L}.{eg}</>;
  }
  return <>{main}{opt}{note ? <div className="gn-note">{note}</div> : null}</>;
}
// The node's settings as steps, in order. Settings that only show for a choice (Operation = Create…)
// say so; the rest are always there.
function FieldSteps({ type, d, notes }) {
  const fields = d.fields || [];
  if (!fields.length) return null;
  const def = defaultsOf(d), labelOf = k => fields.find(x => x.k === k);
  const sample = Object.fromEntries(exampleOf(type, d).rows.map(r => [r.f.k, r.v]));
  const when = f => {
    const w = f.when || f.also;
    if (!w || meets(w, def)) return null;
    const of = labelOf(w[0]);
    const vals = w.slice(1).map(v => (of?.options || []).find(o => String(o[0]) === String(v))?.[1] || v || 'blank');
    return <span className="gn-when">only when {of ? nameOf(of) : w[0]} is {vals.join(' or ')}: </span>;
  };
  return (
    <>Fill in its settings (each can use expressions, like <code>{'{{ $json.email }}'}</code>):
      <ul className="gn-fsteps">{fields.map(f => <li key={f.k}>{when(f)}{fieldStep(f, def[f.k], notes, sample[f.k])}</li>)}</ul>
    </>
  );
}
// What the next node reads from it: the fields of its example output, as expressions.
function OutStep({ type, d }) {
  const ex = exampleOf(type, d), out = Array.isArray(ex.output) ? ex.output[0] : null;
  const keys = out && typeof out === 'object' ? Object.keys(out).filter(k => !k.startsWith('_')).slice(0, 4) : [];
  if (!keys.length) return <>Use what it gives in the next node: <code>{'{{ $json.field }}'}</code> reads a field of the item it passes on (the <b>Output</b> tab shows them all).</>;
  return <>Use what it gives in the next node: {keys.map((k, i) => <span key={k}>{i ? ', ' : ''}<code>{`{{ $json.${/^[A-Za-z_]\w*$/.test(k) ? k : `["${k}"]`} }}`}</code></span>)}{keys.length < Object.keys(out).length ? ' and more' : ''} (the <b>Output</b> tab shows them all).</>;
}
// Setting a node up, step by step: add it, connect the account, what to do in the other app, the
// settings one by one, how to try it, and how the next node uses what it gives.
function Setup({ type, d }) {
  const trigger = d.trigger, listens = d.hook || type === 'trigger.webhook', watches = d.poll || type === 'trigger.schedule';
  const steps = [
    trigger
      ? <>Add it: in the <b>Nodes</b> list on the left, open <b>Triggers</b> and click <b>{d.label}</b> (or drag it onto the canvas). A workflow may have several triggers.</>
      : <>Add it after the node that gives it items: select that node, then click <b>{d.label}</b> in the <b>Nodes</b> list (under {d.group}); or drag from that node’s right-hand dot, let go on empty canvas and pick <b>{d.label}</b>.</>,
    ...(d.credential ? [<>
      {d.optionalCredential ? 'If you need it, connect' : 'Connect'} your account: beside <b>Credential</b> press <b>New</b>, {d.credential.length > 1 ? 'choose the kind, ' : ''}give it a name, fill it in and save. Next time, just pick it from the list.
      {d.credential.map(c => (
        <div key={c} className="gn-cred">
          <b>{CRED_TYPES[c]?.label}: where to find it</b>
          <ol>{(CRED_SETUP[c] || [CRED_TYPES[c]?.help]).map((t, i) => <li key={i}>{t}</li>)}</ol>
        </div>
      ))}
    </>] : []),
    // (The hand-written steps that only say which settings to fill in are left out: the settings steps say it, one by one.)
    ...(NODE_SETUP[type] || []).filter(t => !((d.fields || []).length && typeof t === 'string' && /^(Fill in|Choose |Write the fields|Write a title|Pick the language)/.test(t))),
    ...((d.fields || []).length ? [<FieldSteps key="f" type={type} d={d} notes={NODE_GUIDE[type]?.fields} />] : []),
    listens ? <>Turn the workflow <b>Active</b> and wait for <b>Saved</b>: from then on, calls to its URL start it. <b>Run workflow</b> tries the rest of the workflow by hand.</>
      : watches ? <>Turn the workflow <b>Active</b> and wait for <b>Saved</b>: it then runs by itself while the server is awake. <b>Run workflow</b> tries it now.</>
      : trigger ? <>Press <b>Run workflow</b>.</>
      : <>Try it: press <b>Run from here</b> in its settings (or <b>Run workflow</b>), then click the node and open <b>Output</b> to see what it gave.</>,
    ...((d.outputs ?? ['main']).length && !d.note_ ? [<OutStep key="o" type={type} d={d} />] : []),
  ];
  return <><h5>Set it up</h5><ol className="gn-steps">{steps.map((t, i) => <li key={i}>{t}</li>)}</ol></>;
}

// The node set up for real: each setting with an example value, then the item going in and what comes out.
const json = v => JSON.stringify(v, null, 2);
function ExampleSetup({ type, d }) {
  const ex = exampleOf(type, d);
  if (!ex.rows.length && !ex.output) return null;
  const ports = ex.output && !Array.isArray(ex.output) ? Object.entries(ex.output) : null;
  return (
    <div className="gn-example">
      <h5>Example setup</h5>
      {ex.rows.length > 0 && (
        <table className="gtable gn-fields gn-ex-set"><tbody>
          {ex.rows.map(({ f, v }) => <tr key={f.k}><td>{f.label}</td><td><code>{showValue(f, v)}</code></td></tr>)}
        </tbody></table>
      )}
      {ex.input && (Array.isArray(ex.input) ? ex.input.length > 0 && Object.keys(ex.input[0]).length > 0 : true) && <>
        <div className="gn-ex-label">Items in</div>
        {Array.isArray(ex.input) ? <X>{json(ex.input)}</X> : Object.entries(ex.input).map(([p, l]) => <X key={p}>{`input ${p.toUpperCase()}: ${json(l)}`}</X>)}
      </>}
      {ex.output && <>
        <div className="gn-ex-label">Items out</div>
        {ports ? <X>{ports.map(([p, l]) => `${p === 'other' ? 'other' : /^\d+$/.test(p) ? `dot ${Number(p) + 1}` : p}: ${JSON.stringify(l)}`).join('\n')}</X> : <X>{json(ex.output)}</X>}
      </>}
    </div>
  );
}

// The node's video (set up with an example, run, and its output), when there is one: a button, then the video.
function NodeVideo({ type, d }) {
  const [secs, setSecs] = useState(0), [open, setOpen] = useState(false);
  useEffect(() => { let on = true; nodeVideos().then(i => { if (on) setSecs(i[type] || 0); }); return () => { on = false; }; }, [type]);
  if (!secs) return null;
  return (
    <div className="gn-video">
      {open ? <video controls autoPlay playsInline src={nodeVideoUrl(type)} aria-label={`Video: ${d.label}`} />
        : <button className="btn" onClick={() => setOpen(true)}>▶ Watch the video <small className="muted">{Math.round(secs)}s, with an example</small></button>}
    </div>
  );
}

export function NodeCard({ type, d, lit }) {
  const g = NODE_GUIDE[type] || {};
  const fields = d.fields || [];
  return (
    <article className={'gn' + (lit ? ' lit' : '')} id={'g-node-' + type}>
      <header>
        <NodeMark d={d} />
        <div><h3>{d.label}</h3><small>{d.note}</small></div>
      </header>
      {g.what && <p>{g.what}</p>}
      <NodeVideo type={type} d={d} />
      <Setup type={type} d={d} />
      <ExampleSetup type={type} d={d} />
      {(fields.length > 0 || d.credential) && <h5>Settings</h5>}
      {(fields.length > 0 || d.credential) && (
        <table className="gtable gn-fields"><tbody>
          {d.credential && <tr><td>Credential{d.optionalCredential ? ' (optional)' : ''}</td><td>{d.credential.map(c => <span key={c}><b>{CRED_TYPES[c]?.label}</b>: {CRED_TYPES[c]?.help} </span>)}</td></tr>}
          {fields.map(f => <tr key={f.k}><td>{f.label}</td><td>{fieldText(f, g.fields)}</td></tr>)}
        </tbody></table>
      )}
      {g.ex && <><h5>Example</h5><X>{g.ex}</X></>}
      {g.out && <p className="gn-out"><b>Gives:</b> {g.out}</p>}
    </article>
  );
}
