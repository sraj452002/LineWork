import { test, expect } from '@playwright/test';
import { createServer } from 'node:http';
import { openStore } from '../backend/store.js';
import { memoryBackend } from '../backend/drive.js';
import { createApp } from '../backend/app.js';

// The AI panel in every section: Sheet, Database, Code, Workflow and App. A stand-in for Claude answers
// by section (from the prompt), and each section applies the change it proposes.
const prompts = [];
const answer = prompt => {
  const sec = (/You are the AI assistant in the (\w+) of Workline/.exec(prompt) || [])[1];
  if (sec === 'Sheet') return { reply: 'Added a total under the amounts.', apply: { type: 'cells', cells: { A20: 'Total', B20: '=SUM(B2:B10)' } } };
  const request = prompt.split('Request:\n<<<\n')[1] || '';
  if (sec === 'Code') return /Write a new file/.test(request)
    ? { reply: 'Here is a greeting module.', apply: { type: 'file', path: 'src/greet.js', code: 'export const greet = name => `Hello, ${name}`;\n' } }
    : { reply: 'Added a default name.', apply: { type: 'replace', code: 'export const greet = (name = "world") => `Hello, ${name}`;\n' } };
  if (sec === 'Workflow') return { reply: 'A workflow that checks a site and posts to Slack.', apply: { type: 'nodes', nodes: [
    { ref: 't', type: 'trigger.schedule', name: 'Every hour', params: { every: 1, unit: 'hours' } },
    { ref: 'h', type: 'core.http', name: 'Check the site', params: { url: 'https://example.com' } },
    { ref: 's', type: 'app.slack', name: 'Tell Slack', params: { text: 'Status {{ $json.status }}' } },
  ], edges: [{ from: 't', to: 'h' }, { from: 'h', to: 's' }] } };
  if (sec === 'App') return { reply: 'A new page.', apply: { type: 'html', html: '<h1>Made by AI</h1>' } };
  return { reply: 'Connect a database first, then ask me for a query.', apply: null };
};
const fakeClaude = () => createServer((req, res) => {
  let body = '';
  req.on('data', c => { body += c; });
  req.on('end', () => {
    const prompt = JSON.parse(body).messages[0].content;
    prompts.push(prompt);
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.end(`event: content_block_delta\ndata: ${JSON.stringify({ type: 'content_block_delta', delta: { type: 'text_delta', text: JSON.stringify(answer(prompt)) } })}\n\nevent: message_stop\ndata: {"type":"message_stop"}\n\n`);
  });
});

test('the AI panel helps in the Sheet, Database, Code, Workflow and App views', async ({ browser }) => {
  test.setTimeout(180_000);
  const ai = fakeClaude().listen(0);
  const { spawn } = await import('node:child_process');
  const st = await openStore(memoryBackend());
  const srv = createApp(st, { requireVerified: false, aiKey: 'sk-ant-test', aiBase: `http://localhost:${ai.address().port}` }).listen(0);
  const port = 5185;
  const vite = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--port', String(port), '--strictPort'], { cwd: 'frontend', env: { ...process.env, LINEWORK_API: `http://localhost:${srv.address().port}` }, stdio: 'ignore', detached: true });
  try {
    const url = `http://localhost:${port}`;
    for (let i = 0; i < 60; i++) { try { if ((await fetch(url)).ok) break; } catch (e) {} await new Promise(r => setTimeout(r, 500)); }
    const ctx = await browser.newContext({ baseURL: url });
    await ctx.addInitScript(() => { if (window.top === window) localStorage.setItem('linework:ai-open', '0'); });
    const page = await ctx.newPage();
    await page.goto('/');
    await page.getByRole('button', { name: 'Create an account' }).click();
    await page.getByLabel('Email').fill('assist@example.com');
    await page.getByLabel('Password').fill('a long password');
    await page.getByRole('button', { name: 'Create account' }).click();
    const tool = async name => {
      if (await page.getByRole('button', { name: 'Back to files' }).count()) await page.getByRole('button', { name: 'Back to files' }).click();
      await page.getByRole('button', { name: 'Tools' }).click();
      await page.locator('.tool-card').filter({ has: page.locator('b', { hasText: new RegExp(`^${name}$`) }) }).click();
    };
    const openAI = async section => {
      await page.getByRole('button', { name: 'AI Chat' }).click();
      const panel = page.getByRole('complementary', { name: `AI for the ${section}` });
      await expect(panel).toBeVisible();
      return panel;
    };
    const ask = async (panel, text) => {
      await panel.getByRole('textbox').fill(text);
      await panel.getByRole('textbox').press('Enter');
    };

    // Sheet: it sees the cells and fills in a formula.
    await tool('Budget sheet');
    let panel = await openAI('Sheet');
    await panel.getByRole('button', { name: 'Add totals and averages' }).click();
    await expect(panel.locator('.ai-msg.a').last()).toContainText('Added a total');
    expect(prompts.at(-1)).toContain('A1: ');
    await panel.getByRole('button', { name: 'Fill 2 cells' }).click();
    await expect(panel).toContainText('✓ Filled 2 cells');
    await expect(page.locator('[data-a="A20"]')).toHaveText('Total');
    await panel.getByRole('button', { name: 'Close AI (Esc)' }).click();

    // Code: a new file, then a change to it (through the editor, so it can be undone).
    await tool('Code editor');
    panel = await openAI('Code');
    await ask(panel, 'Write a new file that greets people');
    await panel.getByRole('button', { name: 'Create src/greet.js' }).click();
    await expect(page.locator('.cw-tab', { hasText: 'greet.js' })).toBeVisible();
    await ask(panel, 'Give the name a default');
    await panel.getByRole('button', { name: 'Replace greet.js' }).waitFor();
    expect(prompts.at(-1)).toContain('Open file: src/greet.js');
    await panel.getByRole('button', { name: 'Replace greet.js' }).click();
    await expect(page.locator('.monaco-editor .view-lines')).toContainText('name = "world"');
    await panel.getByRole('button', { name: 'Close AI (Esc)' }).click();

    // Workflow: built from a description.
    await tool('Workflow');
    panel = await openAI('Workflow');
    await ask(panel, 'Check example.com every hour and tell Slack');
    await panel.getByRole('button', { name: 'Add 3 nodes' }).waitFor();
    expect(prompts.at(-1)).toContain('core.http: HTTP request');
    await panel.getByRole('button', { name: 'Add 3 nodes' }).click();
    await expect(page.locator('.fv-node')).toHaveCount(4); // Run by hand + 3
    await expect(page.locator('.fv-node', { hasText: 'Tell Slack' })).toBeVisible();
    await expect(page.locator('.fv-edge')).toHaveCount(2);

    // App, in the same file: the page rewritten.
    await page.getByRole('button', { name: /^View:/ }).click();
    await page.getByRole('menuitemradio', { name: /^App/ }).click();
    panel = page.getByRole('complementary', { name: 'AI for the App' });
    await expect(panel).toBeVisible(); // still open, now for the App
    // A new app starts in Visual; here, its code.
    await page.getByRole('button', { name: 'Code', exact: true }).click();
    await page.getByRole('button', { name: 'Edit code' }).click();
    await ask(panel, 'Make a simple heading');
    await panel.getByRole('button', { name: 'Replace the page code' }).click();
    await expect(page.getByLabel('App code')).toHaveValue('<h1>Made by AI</h1>');

    // Database: with no connection, it says so.
    await page.getByRole('button', { name: /^View:/ }).click();
    await page.getByRole('menuitemradio', { name: /^Database/ }).click();
    panel = page.getByRole('complementary', { name: 'AI for the Database' });
    await expect(panel).toContainText('Connect a database');
    await ask(panel, 'How many orders were there last week?');
    await expect(panel.locator('.ai-msg.a').last()).toContainText('Connect a database first');
    expect(prompts.at(-1)).toContain('no connection chosen yet');
    await ctx.close();
  } finally {
    try { process.kill(-vite.pid); } catch (e) {}
    srv.close(); ai.close();
  }
});
