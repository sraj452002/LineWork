import { test, expect } from '@playwright/test';
import { openStore } from '../backend/store.js';
import { memoryBackend } from '../backend/storage.js';
import { createApp } from '../backend/app.js';

// A published app whose question ("Js code" → jsCode) isn't the name its workflow reads ({{ $json.code }}):
// the answer reaches the workflow under that name too.
test('an app answer reaches the name the workflow reads', async () => {
  const app = createApp(await openStore(memoryBackend()), { noAccounts: true });
  const srv = app.listen(0), api = `http://localhost:${srv.address().port}/api`;
  try {
    const flow = { nodes: [
      { id: 's', type: 'trigger.manual', name: 'Start', x: 0, y: 0, params: { fields: '' } },
      { id: 'c', type: 'core.noop', name: 'Echo', x: 300, y: 0, params: { note: '{{ $json.code }}' } }],
    edges: [{ id: 'e', from: 's', to: 'c', fromPort: 'main', toPort: 'main' }],
    app: { published: true, startId: 's', inputs: [{ key: 'jsCode', label: 'Js code', kind: 'long', required: true }] } };
    const f = { id: 'fconv1', title: 'conv', created: 1, updated: 1, doc: '', diagrams: [{ id: 'd1', type: 'architecture', name: 'D', code: '' }], active: 0, view: 'flow', flow };
    expect((await fetch(`${api}/files/fconv1`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(f) })).ok).toBe(true);
    const { runId } = await (await fetch(`${api}/flows/fconv1/app`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ input: { jsCode: 'console.log(1)' } }) })).json();
    let run;
    for (let i = 0; i < 40; i++) { run = (await (await fetch(`${api}/runs/${runId}`)).json()).run; if (run.status !== 'running') break; await new Promise(r => setTimeout(r, 250)); }
    expect(run.status).toBe('success');
    expect(Object.values(run.nodes.c.output).flat()[0]).toMatchObject({ code: 'console.log(1)', jsCode: 'console.log(1)' });
  } finally { srv.close(); app.flows.close(); }
});
