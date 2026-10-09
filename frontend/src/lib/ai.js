// AI calls go to /api/ai on the Linework API (../../backend), which holds the API key.
function createSample(){
  const sample = async (input, opts = {}) => {
    const prompt = typeof input === 'string' ? input : input.map(t => t.content).join('\n\n');
    let res;
    try{ res = await fetch('/api/ai', {method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify({prompt, tier:opts.modelTier || 'default', ...(opts.images && opts.images.length ? {images:opts.images} : {})}), signal:opts.signal}); }
    catch(e){ throw {code: e && e.name === 'AbortError' ? 'cancelled' : 'unavailable'}; }
        if(res.status === 401) throw {code:'signed_out'};
    if(res.status === 429){ const j = await res.json().catch(() => null); throw {code: j && j.error === 'daily_limit' ? 'daily_limit' : 'rate_limited'}; }
    if(res.status === 413) throw {code:'prompt_too_large'};
    if(res.status === 400 && opts.images) throw {code:'image_unsupported'};
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
  return fetch('/api/ai/status', {cache:'no-store'}).then(r => r.ok ? r.json() : null).then(j => {
    NO_AI = j && j.reason === 'signed_out' ? AI_SIGNED_OUT
      : j && j.reason === 'daily_limit' ? `You’ve used today’s ${j.limit} AI requests. They reset at midnight UTC. Everything else still works.`
      : j && j.limit !== undefined ? AI_NO_KEY_SERVER : AI_NO_KEY;
    return j && j.enabled ? sample : null;
  }).catch(() => null);
}
// Shrink a picture so its long side is at most `max` pixels, as base64 JPEG for the AI.
export function prepImage(file, max = 1568){
  return new Promise((res, rej) => {
    const url = URL.createObjectURL(file), img = new Image();
    img.onload = () => {
      const k = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
      const cv = document.createElement('canvas');
      cv.width = Math.max(1, Math.round(img.naturalWidth * k)); cv.height = Math.max(1, Math.round(img.naturalHeight * k));
      const g = cv.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, cv.width, cv.height); g.drawImage(img, 0, 0, cv.width, cv.height);
      URL.revokeObjectURL(url);
      const dataUrl = cv.toDataURL('image/jpeg', .9);
      res({media_type:'image/jpeg', data:dataUrl.split(',')[1], preview:cv.toDataURL('image/jpeg', .6)});
    };
    img.onerror = () => { URL.revokeObjectURL(url); rej(new Error('bad image')); };
    img.src = url;
  });
}
export const downloads = {
  async save({filename, data}){
    const blob = data instanceof Blob ? data : new Blob([data], {type: filename.endsWith('.svg') ? 'image/svg+xml' : 'text/plain'});
    const u = URL.createObjectURL(blob), a = document.createElement('a');
    a.href = u; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(u), 3000);
  }
};

// Live bindings: refreshAI() replaces these after signing in or out, and importers see the new values.
export let sampleP = createSample();
export function refreshAI(){ sampleP = createSample(); return sampleP; }

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
    daily_limit:'You’ve used today’s AI requests. They reset at midnight UTC. Everything else still works.',
    prompt_too_large:'That input is too long. Paste a smaller excerpt.',
    cancelled:'Stopped.',
    signed_out:'Your session ended. Sign in again to use AI.',
    empty:'The reply had no usable diagram. Try describing it differently.',
    image_unsupported:'That picture couldn’t be read. Try a PNG or JPEG screenshot.'
  })[code] || 'That didn\u2019t work. Try rephrasing your request.';
}

const AI_NO_KEY = 'AI is off. Sign in to use it, or set ANTHROPIC_API_KEY on the Linework API to turn it on. Everything else works.';
const AI_NO_KEY_SERVER = 'AI is off. Set ANTHROPIC_API_KEY on the Linework server to turn it on. Everything else works.';
const AI_SIGNED_OUT = 'AI needs an account. Sign out, then sign in or create an account to use it. Everything else works.';
export let NO_AI = AI_NO_KEY;
