import { test, expect } from '@playwright/test';
import { createServer } from 'node:http';
import { openStore } from '../backend/store.js';
import { memoryBackend } from '../backend/storage.js';
import { createApp } from '../backend/app.js';

// Missions: a goal Nemo works through by itself in the background. It plans, remembers, waits for the
// user's yes before running a workflow, asks a question when it needs to, and ends with a summary. Memory
// is kept for later chats; agents can hand work to each other.

// A stand-in for NVIDIA's OpenAI-style API that plays a mission: what it does depends on what came back.
function fakeModel() {
  const seen = [];
  const srv = createServer((req, res) => {
    let b = ''; req.on('data', c => { b += c; });
    req.on('end', () => {
      const body = JSON.parse(b), msgs = body.messages; seen.push(body);
      const tools = msgs.filter(m => m.role === 'tool').map(m => m.content);
      const last = tools[tools.length - 1] || '';
      const chunk = d => res.write(`data: ${JSON.stringify({ choices: [{ delta: d }] })}\n\n`);
      const call = (id, name, args) => ({ index: 0, id, type: 'function', function: { name, arguments: JSON.stringify(args) } });
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      const sys = msgs[0].content;
      if (/You are Helper/.test(sys)) chunk({ content: 'Helper says: 42.' }); // an agent asked by another
      else if (!/Work on this goal|mission/i.test(sys + JSON.stringify(msgs.slice(1)))) chunk({ content: 'Hi!' });
      else if (!tools.length) {
        chunk({ content: 'Planning. ' });
        chunk({ tool_calls: [call('c1', 'update_plan', { steps: [{ title: 'Run the greeting workflow' }, { title: 'Report' }] })] });
        chunk({ tool_calls: [{ ...call('c2', 'remember', { text: 'The user likes short reports' }), index: 1 }] });
      } else if (tools.length === 2) chunk({ tool_calls: [call('c3', 'run_workflow', { workflow_id: 'wf1', input: { name: 'Asha' } })] });
      else if (tools.length === 3) chunk({ tool_calls: [call('c4', 'ask_agent', { agent_id: msgs[0].content.match(/id ([\w-]+)\)/)?.[1] || 'none', task: 'What is the answer?' })] });
      else if (tools.length === 4) chunk({ tool_calls: [call('c5', 'ask_user', { question: 'Which channel should I post to?' })] });
      else if (tools.length === 5) {
        chunk({ tool_calls: [call('c6', 'finish_step', { step: 1, result: 'Greeted Asha' })] });
        chunk({ tool_calls: [{ ...call('c7', 'finish_step', { step: 2, result: last }), index: 1 }] });
      } else chunk({ content: 'Mission complete: greeted Asha, the helper said 42, and the user chose #general.' });
      res.end('data: [DONE]\n\n');
    });
  }).listen(0);
  return { srv, seen };
}

test('a mission plans, remembers, waits for a yes and an answer, uses another agent, and finishes', async () => {
  test.setTimeout(60_000);
  const { srv: nv, seen } = fakeModel();
  const app = createApp(await openStore(memoryBackend()), { noAccounts: true, nvidiaKey: 'nvapi-test', nvidiaBase: `http://localhost:${nv.address().port}/v1` });
  const srv = app.listen(0), base = `http://localhost:${srv.address().port}/api`;
  const call = async (method, path, body) => { const r = await fetch(base + path, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }); return { status: r.status, json: r.status === 204 ? null : await r.json().catch(() => null) }; };
  const until = async (id, ok) => { for (let i = 0; i < 200; i++) { const m = (await call('GET', `/missions/${id}`)).json.mission; if (ok(m)) return m; await new Promise(r => setTimeout(r, 50)); } throw new Error('the mission did not get there'); };
  try {
    const now = Date.now();
    const flow = { active: false, nodes: [{ id: 't', type: 'trigger.manual', name: 'Run by hand', x: 0, y: 0, params: {} }, { id: 's', type: 'core.set', name: 'Greet', x: 0, y: 0, params: { fields: [{ name: 'msg', value: 'Hi {{ $json.name }}' }], keep: true } }], edges: [{ id: 'e', from: 't', to: 's', fromPort: 'main', toPort: 'main' }] };
    expect((await call('PUT', '/files/wf1', { id: 'wf1', title: 'Greet', created: now, updated: now, doc: '', diagrams: [], view: 'flow', flow })).status).toBeLessThan(300);
    const helper = (await call('POST', '/agents', { name: 'Helper', icon: '🧮', description: 'Knows the answer', instructions: 'Answer briefly.' })).json.agent;

    const made = await call('POST', '/missions', { goal: 'Greet Asha with my workflow and report back', team: [helper.id] });
    expect(made.status).toBe(201);
    const id = made.json.mission.id;
    // It plans and remembers, then waits for a yes before running the workflow.
    let m = await until(id, x => x.status === 'waiting');
    expect(m.plan.map(st => st.title)).toEqual(['Run the greeting workflow', 'Report']);
    expect(m.pending).toMatchObject({ kind: 'approve', name: 'run_workflow' });
    expect((await call('GET', '/memory')).json.memory.map(x => x.text)).toContain('The user likes short reports');
    // Yes: it runs the workflow, asks the helper agent, then asks the user a question.
    expect((await call('POST', `/missions/${id}/answer`, { ok: true })).status).toBe(200);
    m = await until(id, x => x.status === 'waiting' && x.pending?.kind === 'question');
    expect(m.pending.question).toBe('Which channel should I post to?');
    const ran = m.log.find(e => e.type === 'tool_done' && e.tool === 'run_workflow');
    expect(ran.ok).toBe(true); expect(ran.result).toContain('Hi Asha');
    expect(m.log.find(e => e.type === 'tool_done' && e.tool === 'ask_agent').result).toContain('Helper says: 42.');
    // The answer: it ticks the steps off and finishes with a summary.
    await call('POST', `/missions/${id}/answer`, { note: '#general' });
    m = await until(id, x => x.status === 'done');
    expect(m.result).toContain('Mission complete');
    expect(m.plan.map(st => st.status)).toEqual(['done', 'done']);
    expect(m.runs).toHaveLength(1);
    // The remembered note reaches Nemo's chats.
    const chatRes = await fetch(base + '/ai/chat', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ messages: [{ role: 'user', text: 'hi' }] }) });
    await chatRes.text();
    expect(seen.at(-1).messages[0].content).toContain('The user likes short reports');

    // Saying no: the mission is told, and goes on without it.
    const two = (await call('POST', '/missions', { goal: 'Greet again', approve: 'risky' })).json.mission.id;
    await until(two, x => x.status === 'waiting');
    await call('POST', `/missions/${two}/answer`, { ok: false, note: 'not now' });
    m = await until(two, x => x.log.some(e => e.type === 'no'));
    expect(m.log.find(e => e.type === 'no').text).toBe('not now');
    await call('POST', `/missions/${two}/stop`);
    // Schedules and deleting; memory can be removed.
    expect((await call('PUT', `/missions/${id}`, { schedule: 'day' })).json.mission).toMatchObject({ schedule: 'day' });
    const mem = (await call('GET', '/memory')).json.memory[0];
    expect((await call('DELETE', `/memory/${mem.id}`)).status).toBe(204);
    expect((await call('GET', '/memory')).json.memory).toHaveLength(0);
    expect((await call('DELETE', `/missions/${id}`)).status).toBe(204);
    expect((await call('GET', `/missions/${id}`)).status).toBe(404);
  } finally { srv.close(); nv.close(); app.flows.close(); }
});

test('Missions in Nemo: start one, say yes, answer it, see the plan and result; Memory', async ({ browser }) => {
  test.setTimeout(120_000);
  const { spawn, spawnSync } = await import('node:child_process');
  const { srv: nv } = fakeModel();
  const app = createApp(await openStore(memoryBackend()), { noAccounts: true, nvidiaKey: 'nvapi-test', nvidiaBase: `http://localhost:${nv.address().port}/v1` });
  const srv = app.listen(0), api = `http://localhost:${srv.address().port}/api`;
  const port = 5261;
  const vite = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--port', String(port), '--strictPort'], { cwd: 'frontend', env: { ...process.env, LINEWORK_API: `http://localhost:${srv.address().port}` }, stdio: 'ignore', detached: process.platform !== 'win32' });
  try {
    const now = Date.now();
    const flow = { active: false, nodes: [{ id: 't', type: 'trigger.manual', name: 'Run by hand', x: 0, y: 0, params: {} }, { id: 's', type: 'core.set', name: 'Greet', x: 0, y: 0, params: { fields: [{ name: 'msg', value: 'Hi {{ $json.name }}' }], keep: true } }], edges: [{ id: 'e', from: 't', to: 's', fromPort: 'main', toPort: 'main' }] };
    await fetch(api + '/files/wf1', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: 'wf1', title: 'Greet', created: now, updated: now, doc: '', diagrams: [], view: 'flow', flow }) });
    await fetch(api + '/agents', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Helper', icon: '🧮', description: 'Knows the answer', instructions: 'Answer briefly.' }) });
    const url = `http://localhost:${port}`;
    for (let i = 0; i < 60; i++) { try { if ((await fetch(url)).ok) break; } catch (e) {} await new Promise(r => setTimeout(r, 500)); }
    const ctx = await browser.newContext({ baseURL: url, viewport: { width: 1360, height: 860 } });
    await ctx.addInitScript(() => { if (!sessionStorage.getItem('s')) { sessionStorage.setItem('s', '1'); localStorage.clear(); localStorage.setItem('linework:ai-open', '0'); } });
    const page = await ctx.newPage();
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    await page.goto('/');
    await page.getByRole('button', { name: 'Nemo AI' }).click();
    await page.getByRole('button', { name: 'Missions' }).click();
    await page.getByRole('button', { name: '＋ New mission' }).click();
    const form = page.getByRole('form', { name: 'New mission' });
    await form.getByLabel('The goal').fill('Greet Asha with my workflow and report back');
    await form.getByLabel('Team: Helper').check();
    await form.getByRole('button', { name: '🎯 Start the mission' }).click();
    // It plans, then waits for a yes.
    const wait = page.getByRole('alert', { name: 'It needs you' });
    await expect(wait).toContainText('It wants to: ran a workflow', { timeout: 20_000 });
    await expect(page.getByRole('region', { name: 'The plan' })).toContainText('Run the greeting workflow');
    await page.screenshot({ path: 'test-results/mission-waiting.png' });
    await wait.getByRole('button', { name: 'Yes, go ahead' }).click();
    // Then it asks a question.
    await expect(wait).toContainText('Which channel should I post to?', { timeout: 20_000 });
    await wait.getByLabel('Your answer').fill('#general');
    await wait.getByRole('button', { name: 'Send the answer' }).click();
    await expect(page.locator('.ms-result')).toContainText('Mission complete', { timeout: 20_000 });
    await expect(page.locator('.ms-chip.s-done')).toBeVisible();
    await expect(page.getByRole('region', { name: 'What it did' })).toContainText('Asked an agent');
    await page.screenshot({ path: 'test-results/mission-done.png' });
    // Memory shows what it remembered, and forgets on request.
    await page.getByRole('button', { name: 'Memory' }).click();
    await expect(page.locator('.ms-mem')).toContainText('The user likes short reports');
    await page.getByRole('button', { name: 'Forget: The user likes short reports' }).click();
    await expect(page.locator('.ms-mem')).toHaveCount(0);
    expect(errors).toEqual([]);
  } finally { srv.close(); nv.close(); app.flows.close(); try { process.kill(-vite.pid); } catch (e) { spawnSync('true'); } }
});
