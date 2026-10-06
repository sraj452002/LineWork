// AI calls go to /api/ai (a Netlify edge function that holds the API key).
function createSample(){
  const sample = async (input, opts = {}) => {
    const prompt = typeof input === 'string' ? input : input.map(t => t.content).join('\n\n');
    let res;
    try{ res = await fetch('/api/ai', {method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify({prompt, tier:opts.modelTier || 'default'}), signal:opts.signal}); }
    catch(e){ throw {code: e && e.name === 'AbortError' ? 'cancelled' : 'unavailable'}; }
        if(res.status === 429) throw {code:'rate_limited'};
    if(res.status === 413) throw {code:'prompt_too_large'};
    if(!res.ok) throw {code:'unavailable'};
    const reader = res.body.getReader(), dec = new TextDecoder();
    let buf = '', text = '';
    try{
      for(;;){
        const {value, done} = await reader.read();
        if(done) break;
        buf += dec.decode(value, {stream:true});
        let i;
        while((i = buf.indexOf('\n')) >= 0){
          const line = buf.slice(0, i).trim(); buf = buf.slice(i+1);
          if(!line.startsWith('data:')) continue;
          let ev; try{ ev = JSON.parse(line.slice(5)); }catch(_){ continue; }
          if(ev.type === 'content_block_delta' && ev.delta && ev.delta.type === 'text_delta'){ text += ev.delta.text; if(opts.onText) opts.onText({text, delta:ev.delta.text}); }
          else if(ev.type === 'error') throw {code: ev.error && ev.error.type === 'overloaded_error' ? 'rate_limited' : 'unavailable', text};
        }
      }
    }catch(e){
      if(e && e.code) throw e;
      throw {code: opts.signal && opts.signal.aborted ? 'cancelled' : 'unavailable', text};
    }
    return {text, truncated:false};
  };
  sample.json = async (input, opts) => {
    const {text} = await sample(input, opts);
    const t = text.replace(/^\s*```(?:json)?\s*/, '').replace(/```\s*$/, '').trim();
    const a = t.indexOf('{'), b = t.lastIndexOf('}');
    try{ return JSON.parse(a >= 0 ? t.slice(a, b+1) : t); }catch(_){ throw {code:'empty'}; }
  };
  return fetch('/api/ai/status', {cache:'no-store'}).then(r => r.ok ? r.json() : null).then(j => j && j.enabled ? sample : null).catch(() => null);
}
export const downloads = {
  async save({filename, data}){
    const blob = data instanceof Blob ? data : new Blob([data], {type: filename.endsWith('.svg') ? 'image/svg+xml' : 'text/plain'});
    const u = URL.createObjectURL(blob), a = document.createElement('a');
    a.href = u; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(u), 3000);
  }
};

export const sampleP = createSample();

export const LANG = {
graph:`Diagram language for architecture diagrams and flowcharts:
title: <diagram title>
group <id> "<Group label>" {
  <nodeId> [<Label> | <optional sublabel>] <kind>
}
<nodeId> [<Label> | <optional sublabel>] <kind>     (nodes may sit outside groups)
a > b : optional edge label     (arrow a to b)
a <> b                          (two-way)
a -- b                          (plain line)
a > b > c                       (chain)
a > b, c                        (fan-out)
Ids: lowercase letters, digits, dashes. Groups cannot nest. Labels under 19 characters, sublabels under 22, edge labels under 26.`,
architecture:`Architecture kinds: user, client, mobile, api, lb, server, function, database, cache, queue, storage, cloud, external, service. Use groups for real boundaries (tiers, networks, accounts, teams). Sublabels usually name the technology. Prefer 4 to 18 nodes; every node connects to something.`,
flowchart:`Flowchart kinds: start, end, decision, step, io. Begin with one start node and end with end nodes. Use decision for yes/no questions and label its outgoing edges (yes / no). Groups may act as swimlanes for who does each step. Prefer 5 to 16 nodes.`,
sequence:`Diagram language for sequence diagrams:
title: <title>
<id> [<Label>] <kind>       declare participants in left-to-right order; kind optional (user, client, mobile, api, server, function, database, cache, queue, storage, cloud, external, service)
a > b : message             call
b --> a : message           reply (dashed)
a > a : message             self call
note a : text               note on a's lifeline
== Section label ==         divider between phases
Ids: lowercase letters, digits, dashes. Use 3 to 7 participants and 5 to 20 messages; messages under 34 characters.`,
erd:`Diagram language for database schemas:
title: <title>
<table> {
  <column> <type> [pk|fk|unique]
}
a.col > b.col       many-to-one (a holds the foreign key)
a < b               one-to-many
a - b               one-to-one
a <> b              many-to-many
Use snake_case names and realistic SQL types. Use 3 to 10 tables, and draw a relationship line for every foreign key column.`
};
export const langFor = t => t === 'sequence' ? LANG.sequence : t === 'erd' ? LANG.erd : LANG.graph + '\n' + LANG[t === 'flowchart' ? 'flowchart' : 'architecture'];
export function copyFor(code){
  return ({
    not_granted:'AI is off for this view. You can still edit everything by hand.',
    rate_limited:'Too many requests right now. Wait a moment, then try again.',
    prompt_too_large:'That input is too long. Paste a smaller excerpt.',
    cancelled:'Stopped.',
    empty:'The reply had no usable diagram. Try describing it differently.'
  })[code] || 'That didn\u2019t work. Try rephrasing your request.';
}

export const NO_AI = 'AI is off. Add ANTHROPIC_API_KEY in Netlify to turn it on. Everything else works.';
