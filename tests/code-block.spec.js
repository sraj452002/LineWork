import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { openStore } from '../backend/store.js';
import { memoryBackend } from '../backend/drive.js';
import { createApp } from '../backend/app.js';
import { CODE_BLOCKS } from '../frontend/src/lib/flows.js';

// The Code block UI node: a part of a page in React, Vue or plain HTML and JavaScript, running in a sandboxed
// frame of its own with the items reaching it. The rest of the page stays script-free.

// The CDNs the blocks load from, served from node_modules (the test machine may not reach them).
const CDN = {
  'react.production.min.js': 'node_modules/react/umd/react.production.min.js',
  'react-dom.production.min.js': 'node_modules/react-dom/umd/react-dom.production.min.js',
  'babel.min.js': 'node_modules/@babel/standalone/babel.min.js',
  'vue.global.prod.js': 'node_modules/vue/dist/vue.global.prod.js',
};

test('React, Vue and HTML code blocks draw from the items, in their own sandbox', async ({ page, context }) => {
  test.setTimeout(120_000);
  await context.route(/unpkg\.com/, route => {
    const file = Object.entries(CDN).find(([k]) => route.request().url().endsWith(k));
    return file ? route.fulfill({ contentType: 'text/javascript', body: readFileSync(file[1]) }) : route.abort();
  });
  const app = createApp(await openStore(memoryBackend()), { requireVerified: false }), srv = app.listen(0);
  const base = `http://localhost:${srv.address().port}/api`;
  try {
    const up = await fetch(`${base}/auth/signup`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'code@example.com', password: 'a long password' }) });
    const cookie = up.headers.get('set-cookie').split(';')[0];
    const block = (id, framework) => ({ id, type: 'ui.code', name: framework + ' block', params: { framework, code: CODE_BLOCKS[framework].starter, height: 200 } });
    const flow = { active: true, nodes: [
      { id: 'p', type: 'trigger.page', name: 'Page', params: { path: 'codeblocks123456789', title: 'Blocks', theme: 'dark' } },
      { id: 'c', type: 'core.code', name: 'Shows', params: { language: 'javascript', code: "return [{ title: 'Alpha' }, { title: 'Beta</script><script>alert(1)//' }];" } },
      block('r', 'react'), block('v', 'vue'), block('h', 'html'),
    ], edges: ['pc', 'cr', 'rv', 'vh'].map(([a, b]) => ({ from: a, to: b, fromPort: 'main', toPort: 'main' })) };
    const put = await fetch(`${base}/files/f_blocks`, { method: 'PUT', headers: { 'content-type': 'application/json', cookie }, body: JSON.stringify({ id: 'f_blocks', title: 'Blocks', diagrams: [], doc: '', updated: Date.now(), flow }) });
    expect(put.status).toBe(200);

    // The page: no scripts of its own, a frame per block.
    const res = await fetch(`${base}/hook/codeblocks123456789`);
    const html = await res.text();
    expect(html).not.toMatch(/<script/i);
    const srcs = [...html.matchAll(/<iframe class="codeblock" src="(\/api\/hook\/code\/[0-9a-f]{32})" sandbox="allow-scripts allow-popups allow-forms allow-modals"/g)].map(m => m[1]);
    expect(srcs).toHaveLength(3);
    expect(res.headers.get('content-security-policy')).toContain("frame-src 'self'");
    // A block's document: scripts allowed, only from the CDNs, and the items can't close its <script>.
    const doc = await fetch(`http://localhost:${srv.address().port}${srcs[0]}`);
    expect(doc.headers.get('content-security-policy')).toMatch(/^sandbox allow-scripts.*script-src 'unsafe-inline' 'unsafe-eval' https:\/\/unpkg\.com https:\/\/cdn\.jsdelivr\.net/);
    const body = await doc.text();
    expect(body).toContain('Beta\\u003c/script>\\u003cscript>alert(1)//');
    expect(body).toContain('https://unpkg.com/react@18.3.1/umd/react.production.min.js');
    expect((await fetch(`${base}/hook/code/${'0'.repeat(32)}`)).status).toBe(404);

    // In a browser: each block draws the items and reacts to clicks; nothing escapes.
    const dialogs = [];
    page.on('dialog', d => { dialogs.push(d.message()); d.dismiss(); });
    await page.goto(`${base}/hook/codeblocks123456789`);
    const frames = page.frameLocator('iframe.codeblock');
    const react = page.frameLocator('iframe.codeblock >> nth=0'), vue = page.frameLocator('iframe.codeblock >> nth=1'), plain = page.frameLocator('iframe.codeblock >> nth=2');
    await react.getByRole('button', { name: 'Alpha' }).click();
    await expect(react.getByText('You picked Alpha')).toBeVisible();
    await vue.getByRole('button', { name: 'Alpha' }).click();
    await expect(vue.getByText('You picked Alpha')).toBeVisible();
    await expect(plain.locator('.card')).toHaveCount(2);
    await expect(plain.locator('.card').nth(1)).toHaveText('Beta</script><script>alert(1)//');
    expect(frames).toBeTruthy();
    expect(dialogs).toEqual([]);
  } finally { srv.close(); app.flows.close(); }
});
