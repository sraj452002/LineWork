import { CRED_TYPES } from '../lib/flows.js';
import { CRED_SETUP, NODE_GUIDE, NODE_SETUP } from '../lib/flowguide.js';
import { LOGOS } from '../lib/flowlogos.js';

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
  f.hint && <>e.g. <code>{f.hint}</code></>,
  f.options && f.options.map(o => o[1]).join(' · '),
  f.kind === 'bool' && 'On or off.',
  f.kind === 'file' && 'Pick one of your Workline files.',
  f.kind === 'workflow' && 'Pick another workflow file.',
  f.kind === 'dbconn' && 'A connection saved in the Database view.',
  f.kind === 'pairs' && 'Name and value rows.',
].find(Boolean) || '';
// Setting a node up, step by step: add it, connect the account, what to do in the other app, the
// settings, and how to try it.
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
    ...(NODE_SETUP[type] || []),
    ...((d.fields || []).length && !NODE_SETUP[type] ? [<>Fill in the settings (explained below). Any of them can use expressions, like <code>{'{{ $json.email }}'}</code>.</>] : []),
    listens ? <>Turn the workflow <b>Active</b> and wait for <b>Saved</b>: from then on, calls to its URL start it. <b>Run workflow</b> tries the rest of the workflow by hand.</>
      : watches ? <>Turn the workflow <b>Active</b> and wait for <b>Saved</b>: it then runs by itself while the server is awake. <b>Run workflow</b> tries it now.</>
      : trigger ? <>Press <b>Run workflow</b>.</>
      : <>Try it: press <b>Run from here</b> in its settings (or <b>Run workflow</b>), then click the node and open <b>Output</b> to see what it gave.</>,
  ];
  return <><h5>Set it up</h5><ol className="gn-steps">{steps.map((t, i) => <li key={i}>{t}</li>)}</ol></>;
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
      <Setup type={type} d={d} />
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
