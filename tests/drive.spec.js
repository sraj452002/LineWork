import { test, expect } from '@playwright/test';
import { createServer } from 'node:http';
import { openStore } from '../backend/store.js';
import { memoryBackend } from '../backend/storage.js';
import { createApp } from '../backend/app.js';
import { PART, createDrive, signS3 } from '../backend/drive.js';

const J = { 'content-type': 'application/json' };
const post = (url, body) => fetch(url, { method: 'POST', headers: J, body: JSON.stringify(body) });

// AWS's own example (S3 docs, "GET Object"): the same signature comes out.
test('S3 requests are signed like AWS’s example', () => {
  const h = signS3({ method: 'GET', url: 'https://examplebucket.s3.amazonaws.com/test.txt', headers: { range: 'bytes=0-9' }, region: 'us-east-1',
    accessKeyId: 'AKIAIOSFODNN7EXAMPLE', secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY', now: new Date('2013-05-24T00:00:00Z') });
  expect(h.authorization).toBe('AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request, SignedHeaders=host;range;x-amz-content-sha256;x-amz-date, Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41');
});

// Storage over the API: a big file goes up in parts and comes back the same; folders, renames, moves, deletes.
test('files go into Storage in parts, in folders, and come back the same', async () => {
  const app = createApp(await openStore(memoryBackend()), { noAccounts: true });
  const srv = app.listen(0), base = `http://localhost:${srv.address().port}/api`;
  try {
    const big = Buffer.alloc(PART * 2 + 1234); for (let i = 0; i < big.length; i++) big[i] = (i * 7) % 251;
    const up = await (await post(`${base}/drive/uploads`, { name: 'video.mp4', folder: 'Media/Clips', size: big.length })).json();
    expect(up.parts).toBe(3);
    for (let n = 0; n < up.parts; n++) expect((await post(`${base}/drive/uploads/${up.id}/${n}`, { data: big.subarray(n * PART, (n + 1) * PART).toString('base64') })).ok).toBe(true);
    // A part of the wrong size is turned away.
    const small = await (await post(`${base}/drive/uploads`, { name: 'a.txt', size: 5 })).json();
    expect((await post(`${base}/drive/uploads/${small.id}/0`, { data: Buffer.from('abc').toString('base64') })).status).toBe(400);
    expect((await post(`${base}/drive/uploads/${small.id}`, {})).status).toBe(400); // not all parts
    const done = await (await post(`${base}/drive/uploads/${up.id}`, {})).json();
    expect(done).toMatchObject({ name: 'video.mp4', folder: 'Media/Clips', type: 'video/mp4', size: big.length });

    let list = await (await fetch(`${base}/drive`)).json();
    expect(list.files.map(f => f.name)).toEqual(['video.mp4']);
    expect(list.folders).toEqual(['Media', 'Media/Clips']);
    expect(list).toMatchObject({ used: big.length, where: 'memory', persistent: false });

    const raw = await fetch(`${base}/drive/files/${done.id}/raw?download=1`);
    expect(raw.headers.get('content-type')).toBe('video/mp4');
    expect(raw.headers.get('content-disposition')).toMatch(/^attachment; filename="video.mp4"/);
    expect(raw.headers.get('content-security-policy')).toMatch(/sandbox/);
    expect(Buffer.from(await raw.arrayBuffer()).equals(big)).toBe(true);

    // Same name in the same folder: the second one gets “(2)”.
    const again = await (await post(`${base}/drive/uploads`, { name: 'video.mp4', folder: 'Media/Clips', size: 3 })).json();
    await post(`${base}/drive/uploads/${again.id}/0`, { data: Buffer.from('abc').toString('base64') });
    const second = await (await post(`${base}/drive/uploads/${again.id}`, {})).json();
    expect(second.name).toBe('video (2).mp4');

    // Rename and move one file; rename the folder (its files go with it); delete.
    const moved = await (await post(`${base}/drive/files/${second.id}`, { name: 'notes.txt', folder: 'Docs' })).json();
    expect(moved).toMatchObject({ name: 'notes.txt', folder: 'Docs', type: 'video/mp4' });
    expect((await post(`${base}/drive/folders/move`, { from: 'Media', to: 'Media/Inside' })).status).toBe(400);
    await post(`${base}/drive/folders/move`, { from: 'Media', to: 'Videos' });
    list = await (await fetch(`${base}/drive`)).json();
    expect(list.files.find(f => f.id === done.id).folder).toBe('Videos/Clips');
    expect(list.folders).toEqual(['Docs', 'Videos', 'Videos/Clips']);
    await post(`${base}/drive/folders`, { path: 'Empty/../One' });
    expect((await (await fetch(`${base}/drive`)).json()).folders).toContain('Empty/One');
    expect((await fetch(`${base}/drive/files/${second.id}`, { method: 'DELETE' })).ok).toBe(true);
    expect((await fetch(`${base}/drive/files/${second.id}/raw`)).status).toBe(404);
    expect(await (await post(`${base}/drive/folders/remove`, { path: 'Videos' })).json()).toMatchObject({ removed: 1 });
    list = await (await fetch(`${base}/drive`)).json();
    expect(list.files).toEqual([]);
    expect(list.used).toBe(0);

    // Too big for one file.
    expect((await post(`${base}/drive/uploads`, { name: 'huge.bin', size: 51 * 1024 * 1024 })).status).toBe(413);
  } finally { srv.close(); app.flows.close(); }
});

// With a bucket (here a stand-in S3 on this machine): the files and their list are in the bucket, so a
// new server (after a restart, with empty memory) still has them.
test('with a bucket, Storage survives a restart', async () => {
  const objects = new Map(), seen = [];
  const s3 = createServer((req, res) => {
    const chunks = []; req.on('data', c => chunks.push(c));
    req.on('end', () => {
      seen.push({ method: req.method, url: req.url, auth: req.headers.authorization || '' });
      if (req.method === 'PUT') { objects.set(req.url, Buffer.concat(chunks)); return res.end(); }
      if (req.method === 'DELETE') { objects.delete(req.url); res.statusCode = 204; return res.end(); }
      if (!objects.has(req.url)) { res.statusCode = 404; return res.end('<Error><Code>NoSuchKey</Code></Error>'); }
      res.end(objects.get(req.url));
    });
  }).listen(0);
  const env = { S3_BUCKET: 'files', S3_ENDPOINT: `http://localhost:${s3.address().port}`, S3_ACCESS_KEY_ID: 'id', S3_SECRET_ACCESS_KEY: 'secret' };
  try {
    const one = createDrive({ store: await openStore(memoryBackend()), env }).forUser('u1');
    const saved = await one.put({ name: 'hello.txt', folder: 'Notes', buf: Buffer.from('Hello there') });
    expect(seen.every(r => r.auth.startsWith('AWS4-HMAC-SHA256 Credential=id/') && r.url.startsWith('/files/workline/u-'))).toBe(true);

    const two = createDrive({ store: await openStore(memoryBackend()), env });
    const list = await two.forUser('u1').list();
    expect(list).toMatchObject({ where: 'bucket', persistent: true });
    expect(list.files.map(f => `${f.folder}/${f.name}`)).toEqual(['Notes/hello.txt']);
    expect((await two.forUser('u1').read(saved.id)).buf.toString()).toBe('Hello there');
    expect((await two.forUser('someone else').list()).files).toEqual([]);
  } finally { s3.close(); }
});

// The Storage node: save text and a file, list the folder, read one back, delete it.
test('the Storage node saves, lists, reads and deletes files', async () => {
  const app = createApp(await openStore(memoryBackend()), { noAccounts: true });
  const srv = app.listen(0), base = `http://localhost:${srv.address().port}/api`;
  const run = async (nodes, input) => {
    const flow = { nodes: [{ id: 't', type: 'trigger.manual', name: 'Start', params: {} }, ...nodes.map((n, i) => ({ id: 's' + i, type: 'core.storage', name: 'S' + i, params: n }))],
      edges: nodes.map((n, i) => ({ id: 'e' + i, from: i ? 's' + (i - 1) : 't', to: 's' + i, fromPort: 'main', toPort: 'main' })) };
    const { runId } = await (await post(`${base}/flows/wfstore/run`, { flow, startId: 't', input })).json();
    let r;
    for (let i = 0; i < 50; i++) { ({ run: r } = await (await fetch(`${base}/runs/${runId}`)).json()); if (r.status !== 'running') break; await new Promise(res => setTimeout(res, 100)); }
    expect(r.error || '').toBe('');
    return r.nodes['s' + (nodes.length - 1)].output.main;
  };
  try {
    const cv = { name: 'cv.pdf', type: 'application/pdf', size: 4, data: Buffer.from('%PDF').toString('base64') };
    await run([
      { operation: 'save', source: 'text', text: 'Hi {{ $json.who }}', name: 'note.txt', folder: 'Inbox' },
      { operation: 'save', source: 'file', file: '{{ $json.cv }}', folder: 'Inbox', output: 'saved' },
    ], [{ who: 'Asha', cv }]);
    const listed = await run([{ operation: 'list', folder: 'Inbox', each: true }], [{}]);
    expect(listed.map(i => i.path).sort()).toEqual(['Inbox/cv.pdf', 'Inbox/note.txt']);
    const [read] = await run([{ operation: 'read', path: 'Inbox/note.txt', as: 'text', output: 'text' }], [{}]);
    expect(read.text).toBe('Hi Asha');
    const [file] = await run([{ operation: 'read', path: 'inbox/CV.pdf', as: 'file' }], [{}]);
    expect(file.file).toMatchObject({ name: 'cv.pdf', type: 'application/pdf', size: 4 });
    await run([{ operation: 'delete', path: 'Inbox/cv.pdf' }], [{}]);
    expect((await (await fetch(`${base}/drive`)).json()).files.map(f => f.name)).toEqual(['note.txt']);
  } finally { srv.close(); app.flows.close(); }
});
