import { useState } from 'react';
import { dg } from '../lib/engines.js';
import { rid } from '../lib/utils.js';
import { nodeDef } from '../lib/flows.js';
import { fromTemplate } from '../lib/flowio.js';
import { getData, setData } from '../lib/userdata.js';
import { LOGOS } from '../lib/flowlogos.js';
import { useUI } from './ui.jsx';

/* Home → Templates: the workflows saved as templates (the Template button in the Workflow view), kept
   apart from Tools so a long list doesn't crowd it. Each one starts a new workflow; they can be renamed
   and removed. Searched with the home page's search box. */

const fmt = t => new Date(t).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });

const dark = hex => { const n = parseInt(hex.slice(1), 16); return ((n >> 16) * 299 + ((n >> 8) & 255) * 587 + (n & 255) * 114) / 1000 < 60; };

// The first few node marks of a template, as a small strip.
function Marks({ flow }) {
  const types = [...new Set((flow.nodes || []).map(n => n.type))].slice(0, 5);
  return (
    <span className="tpl-marks" aria-hidden="true">
      {types.map(t => {
        const d = nodeDef(t), logo = d.logo && LOGOS[d.logo];
        return <i key={t} className={'t-' + d.tone}><svg width="15" height="15" viewBox="0 0 24 24" className={logo ? 'logo' : ''} style={logo ? { fill: dark(logo.color) ? 'var(--ink)' : logo.color } : undefined}><path d={logo ? logo.d : d.icon} /></svg></i>;
      })}
    </span>
  );
}

export default function Templates({ q = '', onCreate }) {
  const { ask, toast } = useUI();
  const [list, setList] = useState(() => getData('flow-templates', []));
  const put = next => { setList(next); setData('flow-templates', next); };
  const needle = q.trim().toLowerCase();
  const shown = list.filter(t => !needle || t.name.toLowerCase().includes(needle));

  const use = t => {
    const now = Date.now();
    onCreate({ id: rid('f'), title: t.name, created: now, updated: now, doc: '', diagrams: [dg('architecture', 'Diagram 1', '')], active: 0, view: 'flow', flow: fromTemplate(t.flow) });
  };
  const rename = async t => {
    const name = await ask({ title: 'Rename template', value: t.name, ok: 'Rename' });
    if (!name || !String(name).trim()) return;
    put(list.map(x => (x.id === t.id ? { ...x, name: String(name).trim().slice(0, 60) } : x)));
  };
  const remove = async t => {
    if (!await ask({ title: `Remove the template “${t.name}”?`, text: 'Workflows made from it stay as they are.', input: false, ok: 'Remove' })) return;
    put(list.filter(x => x.id !== t.id));
    toast('Template removed');
  };

  return (
    <div className="tpl">
      <header className="tpl-head">
        <h2>Templates</h2>
        <p>Workflows you saved as templates. Open one to start a new workflow from it; credentials and secrets aren’t kept, so pick them again.</p>
      </header>
      {!list.length ? (
        <div className="nofiles">
          <svg className="nofiles-art" viewBox="0 0 160 110" aria-hidden="true"><rect x="22" y="24" width="70" height="56" rx="10" /><rect x="68" y="38" width="70" height="56" rx="10" /><path d="M80 56h44M80 66h30M80 76h38" /><circle cx="40" cy="42" r="6" /><path d="M34 64h40" /></svg>
          <div>No templates yet. In a workflow, press <b>Template</b> in its toolbar to keep it here.</div>
        </div>
      ) : !shown.length ? <div className="nofiles">No templates match “{q.trim()}”.</div> : (
        <div className="tpl-grid">
          {shown.map(t => (
            <div key={t.id} className="tpl-card">
              <button className="tpl-open" onClick={() => use(t)} aria-label={`Use the template ${t.name}`}>
                <Marks flow={t.flow} />
                <b>{t.name}</b>
                <small>{(t.flow.nodes || []).length} node{(t.flow.nodes || []).length === 1 ? '' : 's'} · saved {fmt(t.saved || Date.now())}</small>
              </button>
              <div className="tpl-act">
                <button className="link" onClick={() => rename(t)}>Rename</button>
                <button className="link" onClick={() => remove(t)}>Remove</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
