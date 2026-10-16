import { test, expect } from '@playwright/test';
import { openStore } from '../backend/store.js';
import { memoryBackend } from '../backend/drive.js';
import { createApp } from '../backend/app.js';

// Agents: make one (its instructions, knowledge, what it may use), chat with it, have Nemo make one, and use
// one as a step in a workflow (the AI Agent node). A stand-in for NVIDIA's API answers.
test('make agents, chat with them, and use one in a workflow', async ({ browser }) => {
  test.setTimeout(180_000);
  const { createServer } = await import('node:http');
  const { spawn } = await import('node:child_process');
  const seen = [];
  const nv = createServer((req, res) => {
    let b = ''; req.on('data', c => { b += c; });
    req.on('end', () => {
      const body = JSON.parse(b), msgs = body.messages, system = msgs[0].content;
      const user = [...msgs].reverse().find(m => m.role === 'user').content, tool = msgs.find(m => m.role === 'tool');
      seen.push(body);
      const chunk = delta => res.write(`data: ${JSON.stringify({ choices: [{ delta }] })}\n\n`);
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      if (system.includes('running as a step inside a workflow')) chunk({ content: `Reply drafted for: ${user}` });
      else if (system.startsWith('You are Support bot')) chunk({ content: `Support bot here. ${system.includes('Open 8 to 8') ? 'We are open 8 to 8.' : ''}` });
      else if (!tool && /make me an agent/i.test(user)) chunk({ tool_calls: [{ index: 0, id: 'c1', type: 'function', function: { name: 'create_agent', arguments: JSON.stringify({ name: 'Recipe helper', icon: '🍞', description: 'Suggests recipes', instructions: 'You suggest recipes.', tools: ['nodes'], starters: ['A quick dinner?'] }) } }] });
      else if (tool) chunk({ content: 'Your agent is ready.' });
      else if (system.startsWith('You are Recipe helper')) chunk({ content: 'Try a paneer wrap.' });
      else chunk({ content: 'Hi, I am Nemo!' });
      res.end('data: [DONE]\n\n');
    });
  }).listen(0);
  const srv = createApp(await openStore(memoryBackend()), { requireVerified: false, nvidiaKey: 'nvapi-test', nvidiaBase: `http://localhost:${nv.address().port}/v1` }).listen(0);
  const port = 5222;
  const vite = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--port', String(port), '--strictPort'], { cwd: 'frontend', env: { ...process.env, LINEWORK_API: 'http://localhost:' + srv.address().port }, stdio: 'ignore', detached: true });
  try {
    const url = 'http://localhost:' + port;
    for (let i = 0; i < 60; i++) { try { if ((await fetch(url)).ok) break; } catch (e) {} await new Promise(r => setTimeout(r, 500)); }
    const ctx = await browser.newContext({ baseURL: url });
    await ctx.addInitScript(() => localStorage.setItem('linework:ai-open', '0'));
    const page = await ctx.newPage();
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    await page.goto('/');
    await page.getByRole('button', { name: 'Create an account' }).click();
    await page.getByLabel('Email').fill('asha@example.com');
    await page.getByLabel('Password').fill('a long password');
    await page.getByRole('button', { name: 'Create account' }).click();
    await page.getByRole('button', { name: 'Nemo AI' }).click();

    // Make an agent by hand.
    await page.getByRole('button', { name: 'New agent' }).click();
    const dlg = page.getByRole('dialog', { name: 'New agent' });
    await dlg.getByLabel('Agent name').fill('Support bot');
    await dlg.getByLabel('What it does').fill('Answers customers of the bakery');
    await dlg.getByLabel('Instructions').fill('Answer briefly and kindly.');
    await dlg.getByLabel('Knowledge').fill('Open 8 to 8, every day.');
    await dlg.getByLabel('Run nodes').check();
    await dlg.getByLabel('Example request 1').fill('When are you open?');
    await page.screenshot({ path: 'test-results/agents-editor.png' });
    await dlg.getByRole('button', { name: 'Create agent' }).click();
    // Its chat opens: its name, what it does and its example request.
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Support bot');
    await page.getByRole('button', { name: 'When are you open?' }).click();
    await expect(page.locator('.as-msg.ai').last()).toContainText('We are open 8 to 8.', { timeout: 20_000 });
    const asked = seen.at(-1);
    expect(asked.messages[0].content).toContain('Answer briefly and kindly.');
    expect(asked.tools.map(t => t.function.name).sort()).toEqual(['find_nodes', 'list_credentials', 'run_node']);
    await page.screenshot({ path: 'test-results/agents-chat.png' });

    // Nemo makes one when asked.
    await page.getByRole('button', { name: 'New chat' }).first().click();
    await page.getByLabel('Message').fill('Make me an agent for recipes');
    await page.keyboard.press('Enter');
    const card = page.locator('.as-tool').last();
    await expect(card).toContainText('Made the agent “Recipe helper”', { timeout: 20_000 });
    const agents = (await (await page.request.get('/api/agents')).json()).agents;
    expect(agents.map(a => a.name).sort()).toEqual(['Recipe helper', 'Support bot']);
    await card.getByRole('button', { name: 'Chat with it' }).click();
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Recipe helper');
    await expect(page.getByRole('navigation', { name: 'Agents' })).toContainText('Recipe helper');

    // The AI Agent node: the saved agent does the task for each item.
    const bot = agents.find(a => a.name === 'Support bot');
    const flow = { active: false, nodes: [
      { id: 't', type: 'trigger.manual', name: 'Run by hand', x: 0, y: 0, params: {} },
      { id: 'a', type: 'ai.agent', name: 'AI Agent', x: 200, y: 0, params: { agentId: bot.id, task: 'Order {{ $json.order }} is late', output: 'reply' } },
    ], edges: [{ id: 'e', from: 't', fromPort: 'main', to: 'a', toPort: 'main' }] };
    const start = await (await page.request.post('/api/flows/f_agent/run', { data: { flow, input: { order: 42 } } })).json();
    let run;
    for (let i = 0; i < 40; i++) { run = (await (await page.request.get(`/api/runs/${start.runId}`)).json()).run; if (run.status !== 'running') break; await page.waitForTimeout(250); }
    expect(run.status, JSON.stringify(run)).toBe('success');
    expect(run.nodes.a.output.main[0].reply).toBe('Reply drafted for: Order 42 is late');
    expect(seen.at(-1).messages[0].content).toContain('Answer briefly and kindly.');
    expect(errors).toEqual([]);
    await ctx.close();
  } finally { try { process.kill(-vite.pid); } catch (e) {} srv.close(); nv.close(); }
});
