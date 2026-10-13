import { test, expect } from '@playwright/test';
import { createServer } from 'node:http';
import { runFlow } from '../backend/flow-engine.js';
import { NODE_TYPES } from '../backend/flow-nodes.js';
import { stopSandboxes } from '../backend/flow-code.js';

// The Code node's languages: the ones run in the server's sandbox process (and that the sandbox keeps
// the server's files and secrets out of reach), and the ones sent to a Piston or Judge0 code runner.

test.describe.configure({ mode: 'serial' });
test.setTimeout(120_000);
let fake, url, calls = [];

test.beforeAll(async () => {
  fake = createServer((req, res) => {
    let body = '';
    req.on('data', c => { body += c; });
    req.on('end', () => {
      const b = JSON.parse(body || '{}'), json = o => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)); };
      calls.push({ url: req.url, headers: req.headers, body: b });
      const items = JSON.parse(b.stdin || '[]');
      // Piston: compile errors, run errors, and output with the JSON last.
      if (req.url === '/api/v2/execute') {
        const src = b.files[0].content;
        if (src.includes('BROKEN')) return json({ compile: { code: 1, stderr: 'main.go:3: syntax error' }, run: {} });
        if (src.includes('PANIC')) return json({ run: { code: 2, stdout: '', stderr: 'panic: boom' } });
        return json({ language: b.language, run: { code: 0, stdout: `working…\n${JSON.stringify(items.map(i => ({ ...i, via: b.language })))}\n`, stderr: '' } });
      }
      // Judge0
      if (req.url.startsWith('/judge0/submissions')) return json({ stdout: JSON.stringify({ count: items.length, lang: b.language_id }) + '\n', status: { id: 3, description: 'Accepted' } });
      res.writeHead(404); res.end();
    });
  }).listen(0);
  url = `http://localhost:${fake.address().port}`;
});
test.afterAll(() => { fake?.close(); stopSandboxes(); });

const code = async (language, src, items = [{ name: 'a', price: 2, qty: 3 }, { name: 'b', price: 5, qty: 1 }], cred) => {
  const flow = { nodes: [{ id: 't', type: 'trigger.manual', name: 'Start' }, { id: 'n', type: 'core.code', name: 'Code', params: { language, code: src }, ...(cred ? { credential: 'c' } : {}) }], edges: [{ from: 't', to: 'n', fromPort: 'main', toPort: 'main' }] };
  const r = await runFlow(flow, { startId: 't', input: items.map(json => ({ json })), types: NODE_TYPES, ctx: { cred: async () => cred } });
  if (r.status !== 'success') throw new Error(r.error);
  return r.nodes.n.output.main;
};

test('JavaScript (the default), TypeScript, Python, Lua and SQL run in the sandbox', async () => {
  const totals = [{ name: 'a', total: 6 }, { name: 'b', total: 5 }];
  expect(await code(undefined, 'return items.map(i => ({ name: i.name, total: i.price * i.qty }));')).toEqual(totals);
  expect(await code('typescript', 'type I = { name: string; price: number; qty: number };\nreturn items.map((i: I) => ({ name: i.name, total: i.price * i.qty }));')).toEqual(totals);
  expect(await code('python', 'print("hello from python")\nreturn [{"name": i["name"], "total": i["price"] * i["qty"]} for i in items]'))
    .toEqual([{ ...totals[0], _logs: ['hello from python'] }, totals[1]]);
  expect(await code('python', 'import statistics\nreturn {"mean": statistics.mean(i["price"] for i in items)}')).toEqual([{ mean: 3.5 }]);
  expect(await code('lua', 'local out = {}\nfor i, it in ipairs(items) do out[i] = { name = it.name, total = it.price * it.qty } end\nreturn out')).toEqual(totals);
  expect(await code('sql', 'SELECT name, price * qty AS total FROM items ORDER BY name')).toEqual(totals);
  // No answer: the items go on as they were.
  expect(await code('python', 'x = 1', [{ id: 1 }])).toEqual([{ id: 1 }]);
  // Errors say what went wrong, on the user's own line.
  await expect(code('python', 'x = 1\nraise ValueError("bad row")')).rejects.toThrow('The code failed: ValueError: bad row (line 2)');
  await expect(code('sql', 'SELEC 1')).rejects.toThrow(/syntax error/);
});

test('the sandbox keeps the server’s files and secrets out of reach, and stops runaway code', async () => {
  process.env.LW_SECRET_FOR_TEST = 'do not leak';
  const [env] = await code('javascript', 'return this.constructor.constructor("return process")().env;', [{}]);
  expect(JSON.stringify(env)).not.toContain('do not leak');
  await expect(code('javascript', 'const p = this.constructor.constructor("return process")(); return p.getBuiltinModule("fs").readFileSync("/etc/hostname", "utf8");', [{}]))
    .rejects.toThrow(/restricted|ERR_ACCESS_DENIED|allow-fs-read/);
  await expect(code('javascript', 'const p = this.constructor.constructor("return process")(); return p.getBuiltinModule("child_process").execSync("id").toString();', [{}]))
    .rejects.toThrow(/restricted|ERR_ACCESS_DENIED|allow-child-process/);
  const [py] = await code('python', 'import os\nreturn {"secret": os.environ.get("LW_SECRET_FOR_TEST"), "root": sorted(os.listdir("/"))}', [{}]);
  expect(py.secret).toBeNull();
  expect(py.root).not.toContain('etc'); // Python sees its own in-memory files only
  await expect(code('javascript', 'while (true) {}', [{}])).rejects.toThrow('it ran for more than 10 seconds');
  expect(await code('javascript', 'return { ok: true };', [{}])).toEqual([{ ok: true }]); // and the next run works
});

test('other languages run on a Piston or Judge0 code runner', async () => {
  await expect(code('go', 'package main')).rejects.toThrow(/pick a Code runner credential/);
  const piston = { service: 'piston', url, apiKey: 'tok' };
  expect(await code('go', 'package main', [{ id: 1 }], piston)).toEqual([{ id: 1, via: 'go', _logs: ['working…'] }]);
  expect(calls.at(-1)).toMatchObject({ url: '/api/v2/execute', body: { language: 'go', version: '*', files: [{ name: 'main.go' }], stdin: '[{"id":1}]' } });
  expect(calls.at(-1).headers.authorization).toBe('tok');
  expect((await code('cpp', 'int main(){}', [{ id: 2 }], piston))[0].via).toBe('c++');
  await expect(code('rust', 'BROKEN', [{}], piston)).rejects.toThrow('main.go:3: syntax error');
  await expect(code('ruby', 'PANIC', [{}], piston)).rejects.toThrow('panic: boom');

  const judge0 = { service: 'judge0', url: url + '/judge0', apiKey: 'secret' };
  expect(await code('java', 'class Main {}', [{ a: 1 }, { a: 2 }], judge0)).toEqual([{ count: 2, lang: 62 }]);
  expect(calls.at(-1).url).toBe('/judge0/submissions?base64_encoded=false&wait=true');
  expect(calls.at(-1).headers['x-auth-token']).toBe('secret');
});
