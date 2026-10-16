import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { openStore } from '../backend/store.js';
import { memoryBackend } from '../backend/drive.js';
import { createApp } from '../backend/app.js';

test('the AI assistant chats like Claude and uses the account’s tools: nodes, docs', async ({ browser }) => {
  test.setTimeout(180_000);
  const { createServer } = await import('node:http');
  const { spawn } = await import('node:child_process');
  // A stand-in for NVIDIA's OpenAI-style API that uses tools: asked to uppercase something, it first calls
  // run_node (its arguments streamed in pieces, like the real one), then answers with what came back.
  const seen = [];
  const nv = createServer((req, res) => {
    let b = ''; req.on('data', c => { b += c; });
    req.on('end', () => {
      const body = JSON.parse(b), msgs = body.messages;
      seen.push(body);
      const tool = [...msgs].reverse().find(m => m.role === 'tool');
      const user = [...msgs].reverse().find(m => m.role === 'user').content;
      const chunk = delta => res.write(`data: ${JSON.stringify({ choices: [{ delta }] })}\n\n`);
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      if (!tool && /uppercase/i.test(user)) {
        const args = JSON.stringify({ type: 'text.upper', settings: { value: '{{ $json.text }}' }, items: [{ text: 'hello from workline' }] });
        chunk({ content: 'Let me run the Uppercase node. ' });
        chunk({ tool_calls: [{ index: 0, id: 'call_1', type: 'function', function: { name: 'run_node', arguments: args.slice(0, 20) } }] });
        chunk({ tool_calls: [{ index: 0, function: { arguments: args.slice(20) } }] });
      } else if (!tool && /save it as a doc/i.test(user)) {
        chunk({ tool_calls: [{ index: 0, id: 'call_2', type: 'function', function: { name: 'create_doc', arguments: JSON.stringify({ title: 'Launch plan', markdown: '# Launch plan\n\n- Week 1: build\n- Week 2: ship' }) } }] });
      } else if (tool) {
        chunk({ content: `Done. The node gave:\n\n\`\`\`json\n${tool.content.slice(0, 300)}\n\`\`\`\n\n**All set.**` });
      } else chunk({ content: 'Namaste! I can run your workflows and nodes, read your files and write docs.' });
      res.end('data: [DONE]\n\n');
    });
  }).listen(0);
  const srv = createApp(await openStore(memoryBackend()), { requireVerified: false, nvidiaKey: 'nvapi-test', nvidiaBase: `http://localhost:${nv.address().port}/v1` }).listen(0);
  const port = 5218;
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
    await page.getByLabel('Email').fill('maya@example.com');
    await page.getByLabel('Password').fill('a long password');
    await page.getByRole('button', { name: 'Create account' }).click();
    await page.getByRole('button', { name: 'Nemo AI' }).click();
    await expect(page.locator('.as-intro')).toHaveText('Hi, I am Nemo! How can I help you?');
    await expect(page.getByRole('heading', { level: 1 })).toContainText(/Good (morning|afternoon|evening)|Up late/);

    // A question it answers by running a node, shown as a card that opens to what went in and came back.
    await page.getByLabel('Message').fill('Make “hello from workline” uppercase');
    await page.getByRole('button', { name: 'Send' }).click();
    const answer = page.locator('.as-msg.ai').last();
    await expect(answer).toContainText('All set.', { timeout: 20_000 });
    const card = answer.locator('.as-tool');
    await expect(card).toHaveClass(/ok/);
    await expect(card).toContainText('Ran the node text.upper');
    await card.getByRole('button', { name: /Ran the node/ }).click();
    await expect(card).toContainText('HELLO FROM WORKLINE');
    await expect(answer.locator('.as-codehead')).toContainText('json');
    await expect(answer.locator('.as-code .as-copy')).toHaveText('Copy');
    await expect(answer.getByRole('button', { name: 'Good answer' })).toBeVisible();
    // The model was given the tools, and the tool's real result.
    expect(seen[0].messages[0].content).toContain('You are Nemo');
    expect(seen[0].messages[0].content).toContain('Hi, I am Nemo! How can I help you?');
    expect(seen[0].tools.map(t => t.function.name)).toEqual(expect.arrayContaining(['list_workflows', 'run_workflow', 'find_nodes', 'run_node', 'read_file', 'create_doc']));
    expect(seen[1].messages.find(m => m.role === 'tool').content).toContain('HELLO FROM WORKLINE');

    // Retry asks again; the chat is in Recents and still there after a reload.
    await answer.getByRole('button', { name: 'Retry' }).click();
    await expect(page.locator('.as-msg.ai').last()).toContainText('All set.', { timeout: 20_000 });
    await expect(page.locator('.as-msg.ai')).toHaveCount(1);
    await expect(page.getByRole('navigation').filter({ has: page.locator('.as-pick') }).locator('.as-pick')).toContainText(['Make “hello from workline” uppercase']);

    // A new chat that writes a doc on the account.
    await page.getByRole('button', { name: 'New chat' }).first().click();
    await page.getByLabel('Message').fill('Write a launch plan and save it as a doc');
    await page.keyboard.press('Enter');
    await expect(page.locator('.as-tool').last()).toContainText('Wrote the doc “Launch plan”', { timeout: 20_000 });
    const files = await (await page.request.get('/api/files')).json();
    expect(files.files.map(f => f.title)).toContain('Launch plan');
    await page.screenshot({ path: 'test-results/assistant.png' });

    await page.reload();
    await page.getByRole('button', { name: 'Nemo AI' }).click();
    await page.locator('.as-pick', { hasText: 'uppercase' }).click();
    await expect(page.locator('.as-msg.ai').last()).toContainText('All set.');
    await page.screenshot({ path: 'test-results/assistant-answer.png' });
    expect(errors).toEqual([]);
    await ctx.close();
  } finally { try { process.kill(-vite.pid); } catch (e) {} srv.close(); nv.close(); }
});

test('the node list the assistant searches is up to date', () => {
  execFileSync(process.execPath, ['scripts/node-catalog.mjs', '--check'], { stdio: 'pipe' });
});
