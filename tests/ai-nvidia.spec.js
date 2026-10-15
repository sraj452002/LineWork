import { test, expect } from '@playwright/test';
import { createServer } from 'node:http';
import { openStore } from '../backend/store.js';
import { memoryBackend } from '../backend/drive.js';
import { createApp } from '../backend/app.js';

// NVIDIA's models in the AI section, against a stand-in for integrate.api.nvidia.com: the server streams
// them back as Anthropic-style events (reasoning as thinking), and the AI chat offers a model picker.
const calls = [];
const fakeNvidia = () => createServer((req, res) => {
  let body = '';
  req.on('data', c => { body += c; });
  req.on('end', async () => {
    const b = JSON.parse(body);
    calls.push({ url: req.url, auth: req.headers.authorization, body: b });
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    const chunk = delta => res.write(`data: ${JSON.stringify({ choices: [{ delta }] })}\n\n`);
    for (const t of ['The user wants a design doc. ', 'I will write a short one.']) { chunk({ reasoning_content: t }); await new Promise(r => setTimeout(r, 150)); }
    for (const t of ['# Rate limiter\n\n## Context\n', 'Requests need limits.\n']) { chunk({ content: t }); await new Promise(r => setTimeout(r, 100)); }
    res.end('data: [DONE]\n\n');
  });
});

test('NVIDIA models (GLM 5.3 Flash, Nemotron): the API streams its answer and reasoning; the AI chat picks it and shows its thinking', async ({ browser }) => {
  test.setTimeout(150_000);
  const nv = fakeNvidia().listen(0);
  const { spawn } = await import('node:child_process');
  const st = await openStore(memoryBackend());
  const srv = createApp(st, { requireVerified: false, aiKey: 'sk-ant-test', nvidiaKey: 'nvapi-test', nvidiaBase: `http://localhost:${nv.address().port}/v1` }).listen(0);
  const api = `http://localhost:${srv.address().port}/api`;
  const port = 5187;
  const vite = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--port', String(port), '--strictPort'], { cwd: 'frontend', env: { ...process.env, LINEWORK_API: `http://localhost:${srv.address().port}` }, stdio: 'ignore', detached: true });
  try {
    const url = `http://localhost:${port}`;
    for (let i = 0; i < 60; i++) { try { if ((await fetch(url)).ok) break; } catch (e) {} await new Promise(r => setTimeout(r, 500)); }
    const ctx = await browser.newContext({ baseURL: url });
    await ctx.addInitScript(() => { if (window.top === window) localStorage.setItem('linework:ai-open', '1'); });
    const page = await ctx.newPage();
    await page.goto('/');
    await page.getByRole('button', { name: 'Create an account' }).click();
    await page.getByLabel('Email').fill('nv@example.com');
    await page.getByLabel('Password').fill('a long password');
    await page.getByRole('button', { name: 'Create account' }).click();

    // The API: both models offered; an NVIDIA request becomes a chat completion with thinking on.
    const status = await page.evaluate(() => fetch('/api/ai/status').then(r => r.json()));
    expect(status.providers.map(p => [p.id, p.label])).toEqual([['claude', 'Claude'], ['nvidia:z-ai/glm-5.3-flash', 'GLM 5.3 Flash'], ['nvidia', 'NVIDIA Nemotron']]);
    // GLM 5.3 Flash: the same API, with NVIDIA's suggested settings for it.
    const glm = await page.evaluate(() => fetch('/api/ai', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ prompt: 'Which is larger, 9.11 or 9.8?', provider: 'nvidia:z-ai/glm-5.3-flash' }) }).then(r => r.text()));
    expect(glm).toContain('"type":"text_delta","text":"# Rate limiter');
    expect(calls.at(-1).body).toMatchObject({ model: 'z-ai/glm-5.3-flash', temperature: 0.5, top_p: 1, stream: true, messages: [{ role: 'user', content: 'Which is larger, 9.11 or 9.8?' }] });
    expect(calls.at(-1).body.chat_template_kwargs).toBeUndefined();
    const raw = await page.evaluate(() => fetch('/api/ai', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ prompt: 'Hi', provider: 'nvidia' }) }).then(r => r.text()));
    expect(raw).toContain('"type":"thinking_delta","thinking":"The user wants a design doc. "');
    expect(raw).toContain('"type":"text_delta","text":"# Rate limiter');
    expect(calls.at(-1)).toMatchObject({ url: '/v1/chat/completions', auth: 'Bearer nvapi-test', body: { model: 'nvidia/nemotron-3.5-lightning-30b-a3b', stream: true, chat_template_kwargs: { enable_thinking: true }, messages: [{ role: 'user', content: 'Hi' }] } });
    // Pictures are Claude's job.
    const pic = await page.evaluate(() => fetch('/api/ai', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ prompt: 'Read', provider: 'nvidia', images: [{ media_type: 'image/png', data: 'AAAA' }] }) }).then(r => r.status));
    expect(pic).toBe(400);

    // The chat: pick NVIDIA, ask for a doc, watch it think, get the doc.
    await page.getByRole('button', { name: 'Create a Blank File' }).click();
    const chat = page.getByRole('complementary', { name: 'AI chat' });
    const picker = chat.getByLabel('AI model');
    await expect(picker).toHaveValue('claude');
    await picker.selectOption('nvidia');
    await chat.getByRole('button', { name: 'Document' }).click();
    await chat.getByLabel('Describe what to create or edit').fill('A rate limiter');
    await chat.getByLabel('Describe what to create or edit').press('Enter');
    await expect(chat.locator('.ai-think')).toContainText('I will write a short one.');
    await expect(chat.locator('.ai-msg.a').last()).toContainText('Wrote the design doc', { timeout: 20_000 });
    expect(calls.at(-1).body.messages[0].content).toContain('A rate limiter');
    // The choice is remembered.
    await page.reload();
    await page.getByRole('button', { name: 'Create a Blank File' }).click();
    await expect(page.getByRole('complementary', { name: 'AI chat' }).getByLabel('AI model')).toHaveValue('nvidia');
    await ctx.close();
  } finally {
    try { process.kill(-vite.pid); } catch (e) {}
    srv.close(); nv.close();
  }
});
