// A short video of every workflow node, recorded in the real editor (frontend/public/guides/nodes/<type>.mp4).
// For each node it makes a small workflow (Run by hand → Example data → the node), opens it, shows the
// node's settings, and, when the node can run without an account, runs it and opens its Output. Nodes that
// need an account (Slack, GitHub…), a key or the internet show their settings filled in from the guide's
// example instead. A caption names the node and its example; the guides' music and a click are added.
//
//   npm run build && node scripts/node-videos.mjs [--only=text.upper,core.if] [--workers=3] [--fresh]
//
// It skips nodes that already have a video unless --fresh. CHROMIUM=/path/to/chrome uses your own browser.
// Needs ffmpeg. Writes frontend/public/guides/nodes/index.json: { type: seconds } for the videos made.
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium } from '@playwright/test';

const ROOT = resolve(import.meta.dirname, '..');
const DIST = join(ROOT, 'frontend/dist');
// NV_OUT=<folder> makes them somewhere else first (copy them in when done).
const OUT = process.env.NV_OUT ? resolve(process.env.NV_OUT) : join(ROOT, 'frontend/public/guides/nodes');
const arg = name => (process.argv.find(a => a.startsWith(`--${name}=`)) || '').split('=').slice(1).join('=');
const flag = name => process.argv.includes(`--${name}`);
const WORKERS = Number(arg('workers')) || 3;
const W = 1280, H = 720;

/* ---- the catalog, as the editor sees it ---- */
Object.assign(globalThis, { window: globalThis, localStorage: { getItem: () => null, setItem() {}, removeItem() {} }, location: { origin: 'http://localhost', pathname: '/', hash: '' } });
const { NODES } = await import(join(ROOT, 'frontend/src/lib/flows.js'));
const { NODE_GUIDE } = await import(join(ROOT, 'frontend/src/lib/flowguide.js'));
const { TOOL_TESTS } = await import(join(ROOT, 'backend/flow-tools.js'));
const guideOf = t => NODE_GUIDE[t] || NODES[t].guide || {};
const defaultsOf = t => { const d = NODES[t].defaults; return (typeof d === 'function' ? d() : d) || {}; };

// Example items for nodes without a test case of their own: fields most nodes read ({{ $json.text }}…).
const PEOPLE = [
  { name: 'Asha Rao', email: 'asha@example.com', city: 'Pune', amount: 1250, text: 'Hello from Pune', date: '2025-03-14', list: [3, 1, 2], value: 'hello', numbers: [4, 8, 15], id: 1, status: 'paid' },
  { name: 'Ravi Kumar', email: 'ravi@example.com', city: 'Delhi', amount: 480, text: 'Order shipped today', date: '2025-04-02', list: [9, 7], value: 'world', numbers: [16, 23, 42], id: 2, status: 'pending' },
  { name: 'Meera Shah', email: 'meera@example.com', city: 'Mumbai', amount: 2300, text: 'Thanks for the quick reply', date: '2025-05-20', list: [5], value: 'again', numbers: [1, 2], id: 3, status: 'paid' },
];
// The field a tool reads its value from ({{ $json.text }} → text; {{ $json }} → the whole item).
const valueField = p => { const m = /^\{\{\s*\$json(?:\.([\w.]+))?\s*\}\}$/.exec(String(p.value || '')); return m ? (m[1] || '') : null; };

function example(type) {
  const def = NODES[type], params = defaultsOf(type);
  const tests = TOOL_TESTS[type];
  if (tests && tests.length) {
    const [v, , p] = tests[0];
    Object.assign(params, p || {});
    const f = valueField(params);
    const item = f === null ? {} : f === '' ? (v && typeof v === 'object' && !Array.isArray(v) ? v : { value: v }) : { [f]: v };
    if (f === '' && !(v && typeof v === 'object' && !Array.isArray(v))) params.value = '{{ $json.value }}';
    return { params, items: [item], tool: true };
  }
  return { params, items: def.trigger ? [] : PEOPLE, tool: false };
}

// The guide's example as "Label: value" pairs, to type into the fields of nodes that can't run here.
function exampleFills(type) {
  const ex = String(guideOf(type).ex || '').split('→')[0];
  const fields = NODES[type].fields || [];
  const fills = [];
  for (const part of ex.split(/\s·\s/)) {
    const m = /^\s*([^:]{2,60}):\s*(.+?)\s*$/.exec(part);
    if (!m) continue;
    const f = fields.find(x => x.label && x.label.toLowerCase() === m[1].trim().toLowerCase());
    if (f && ['text', 'textarea', 'number'].includes(f.kind) && !/^(from|an?|the)\b/i.test(m[2])) fills.push([f.label, m[2].replace(/^["“]|["”]$/g, '')]);
  }
  return fills.slice(0, 3);
}

const NAME = 'Example data';
function workflow(type) {
  const def = NODES[type], ex = example(type);
  const target = { id: 'node', type, name: def.label, x: 560, y: 200, params: ex.params };
  if (def.trigger) return { flow: { active: false, nodes: [{ ...target, x: 380 }], edges: [] }, ex };
  const code = `// The example this node gets\nreturn ${JSON.stringify(ex.items, null, 2)};`;
  return {
    ex,
    flow: {
      active: false,
      nodes: [
        { id: 'start', type: 'trigger.manual', name: 'Run by hand', x: 60, y: 200, params: {} },
        { id: 'data', type: 'core.code', name: NAME, x: 310, y: 200, params: { language: 'javascript', code } },
        target,
      ],
      edges: [{ id: 'e1', from: 'start', fromPort: 'main', to: 'data', toPort: 'main' }, { id: 'e2', from: 'data', fromPort: 'main', to: 'node', toPort: 'main' }],
    },
  };
}

/* ---- the server: the API and the built app, on one origin ---- */
if (!existsSync(join(DIST, 'index.html'))) execFileSync('npm', ['run', 'build'], { cwd: ROOT, stdio: 'inherit' });
const require = createRequire(join(ROOT, 'backend/package.json'));
const express = require('express');
const { createApp } = await import(join(ROOT, 'backend/app.js'));
const { openStore } = await import(join(ROOT, 'backend/store.js'));
const { memoryBackend } = await import(join(ROOT, 'backend/drive.js'));
const main = express();
main.use(express.static(DIST));
main.use(createApp(await openStore(memoryBackend()), { requireVerified: false }));
const server = main.listen(0);
const BASE = `http://localhost:${server.address().port}`;

const browser = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
const TMP = mkdtempSync(join(tmpdir(), 'node-videos-'));

// An account for each worker (open pages keep their account's file list in step, so they don't share one).
const AUTH = [];
for (let w = 0; w < WORKERS; w++) {
  const auth = join(TMP, `auth${w}.json`);
  AUTH.push(auth);
  const ctx = await browser.newContext({ baseURL: BASE });
  const page = await ctx.newPage();
  await page.goto('/');
  await page.getByRole('button', { name: 'Create an account' }).click();
  await page.getByLabel('Email').fill(`guide${w}@example.com`);
  await page.getByLabel('Password').fill('a long password for videos');
  await page.getByRole('button', { name: 'Create account' }).click();
  await page.getByRole('button', { name: 'Create a Blank File' }).waitFor();
  await ctx.storageState({ path: auth });
  await ctx.close();
}

/* ---- sound: the guides' music, a click and a chime, rendered once ---- */
const lib = readFileSync(join(ROOT, 'frontend/src/lib/guideAudio.js'), 'utf8').replace(/^export /gm, '');
async function renderWav(page, what, seconds) {
  const b64 = await page.evaluate(async ({ lib, what, seconds }) => {
    const mod = new Function(`${lib}; return { scheduleBar, barSeconds, playSfx };`)();
    const rate = 44100, ctx = new OfflineAudioContext(2, Math.ceil(seconds * rate), rate);
    const out = ctx.createGain(), comp = ctx.createDynamicsCompressor();
    out.connect(comp); comp.connect(ctx.destination);
    if (what === 'music') {
      const warm = ctx.createBiquadFilter(); warm.type = 'lowpass'; warm.frequency.value = 3800;
      out.disconnect(); out.connect(warm); warm.connect(comp); out.gain.value = 1.6;
      for (let t = 0.02, bar = 0; t < seconds; t += mod.barSeconds(), bar++) mod.scheduleBar(ctx, out, t, bar);
    } else { out.gain.value = 1.4; mod.playSfx(ctx, out, what, 0.01); }
    const buf = await ctx.startRendering();
    const n = buf.length, data = new DataView(new ArrayBuffer(44 + n * 4));
    const str = (o, s) => [...s].forEach((c, k) => data.setUint8(o + k, c.charCodeAt(0)));
    str(0, 'RIFF'); data.setUint32(4, 36 + n * 4, true); str(8, 'WAVEfmt '); data.setUint32(16, 16, true);
    data.setUint16(20, 1, true); data.setUint16(22, 2, true); data.setUint32(24, rate, true); data.setUint32(28, rate * 4, true);
    data.setUint16(32, 4, true); data.setUint16(34, 16, true); str(36, 'data'); data.setUint32(40, n * 4, true);
    const l = buf.getChannelData(0), r = buf.getChannelData(1);
    for (let k = 0; k < n; k++) { data.setInt16(44 + k * 4, Math.max(-1, Math.min(1, l[k])) * 32767, true); data.setInt16(46 + k * 4, Math.max(-1, Math.min(1, r[k])) * 32767, true); }
    let bin = ''; const bytes = new Uint8Array(data.buffer);
    for (let k = 0; k < bytes.length; k += 0x8000) bin += String.fromCharCode(...bytes.subarray(k, k + 0x8000));
    return btoa(bin);
  }, { lib, what, seconds });
  const path = join(TMP, `${what}.wav`);
  writeFileSync(path, Buffer.from(b64, 'base64'));
  return path;
}
const SOUND = {};
{
  const page = await browser.newPage();
  SOUND.music = await renderWav(page, 'music', 60);
  SOUND.click = await renderWav(page, 'click', 0.3);
  SOUND.chime = await renderWav(page, 'chime', 1.4);
  await page.close();
}

/* ---- in the page: a cursor you can see, and the caption ---- */
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const OVERLAY_CSS = `
#nv-cur{position:fixed;left:0;top:0;width:26px;height:26px;z-index:99999;pointer-events:none;transform:translate(-3px,-2px);filter:drop-shadow(0 2px 3px rgba(0,0,0,.4))}
#nv-cur.down::after{content:"";position:absolute;left:-14px;top:-14px;width:28px;height:28px;border-radius:50%;border:3px solid #F2CF3A;animation:nvc .5s ease-out forwards}
@keyframes nvc{from{opacity:1;transform:scale(.3)}to{opacity:0;transform:scale(1.6)}}
#nv-cap{position:fixed;left:var(--nv-x,50%);bottom:22px;transform:translateX(-50%);z-index:99998;width:var(--nv-w,min(720px,calc(100% - 48px)));padding:14px 18px;border-radius:16px;background:rgba(17,20,27,.92);color:#fff;font:15px/1.4 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;box-shadow:0 18px 40px -16px rgba(0,0,0,.6);pointer-events:none}
#nv-cap b{font-size:17px}#nv-cap small{display:inline-block;margin-left:8px;padding:2px 8px;border-radius:999px;background:rgba(255,255,255,.12);font-size:12px;vertical-align:2px}
#nv-cap p{margin:4px 0 0;color:rgba(255,255,255,.82)}#nv-cap code{font:13px ui-monospace,Menlo,monospace;color:#F2CF3A;white-space:pre-wrap;word-break:break-word}
#nv-cap ol{display:flex;gap:6px;margin:10px 0 0;padding:0;list-style:none}#nv-cap li{font-size:12px;padding:3px 10px;border-radius:999px;background:rgba(255,255,255,.08);color:rgba(255,255,255,.6)}
#nv-cap li.on{background:#F2CF3A;color:#11141B;font-weight:700}`;
async function overlay(page, type, steps) {
  const d = NODES[type], g = guideOf(type);
  const ex = String(g.ex || '').slice(0, 220);
  await page.addStyleTag({ content: OVERLAY_CSS });
  await page.evaluate(({ html }) => {
    const cur = document.createElement('div');
    cur.id = 'nv-cur';
    cur.innerHTML = '<svg viewBox="0 0 24 24" width="26" height="26"><path d="M4 2l15 9-6.5 1.5L9 19z" fill="#fff" stroke="#111" stroke-width="1.6" stroke-linejoin="round"/></svg>';
    document.body.append(cur);
    addEventListener('mousemove', e => { cur.style.left = e.clientX + 'px'; cur.style.top = e.clientY + 'px'; }, true);
    addEventListener('mousedown', () => { cur.classList.remove('down'); void cur.offsetWidth; cur.classList.add('down'); }, true);
    const cap = document.createElement('div');
    cap.id = 'nv-cap';
    cap.innerHTML = html;
    // Over the canvas: between the Nodes list and the settings panel.
    const lib = document.querySelector('.fv-lib'), panel = document.querySelector('.fv-panel');
    const l = lib ? lib.getBoundingClientRect().right : 0, r = panel ? panel.getBoundingClientRect().left : innerWidth;
    cap.style.setProperty('--nv-x', `${(l + r) / 2}px`);
    cap.style.setProperty('--nv-w', `${Math.min(720, r - l - 32)}px`);
    document.body.append(cap);
  }, { html: `<b>${esc(d.label)}</b><small>${esc(d.group)}</small><p>${esc(g.what || d.note || '')}</p>${ex ? `<p>Example: <code>${esc(ex)}</code></p>` : ''}<ol>${steps.map((s, i) => `<li data-i="${i}">${i + 1}. ${esc(s)}</li>`).join('')}</ol>` });
}
const step = (page, i) => page.evaluate(i => document.querySelectorAll('#nv-cap li').forEach(li => li.classList.toggle('on', Number(li.dataset.i) === i)), i);

/* ---- one node ---- */
async function preRun(request, fileId, flow) {
  const r = await request.post(`/api/flows/${fileId}/run`, { data: { flow } });
  if (!r.ok()) return null;
  const { runId } = await r.json();
  for (let i = 0; i < 40; i++) {
    await new Promise(res => setTimeout(res, 250));
    const run = (await (await request.get(`/api/runs/${runId}`)).json()).run;
    if (run && run.status && run.status !== 'running') return run;
  }
  return null;
}

async function record(type, auth) {
  const def = NODES[type];
  const { flow, ex } = workflow(type);
  const fileId = `f_nv_${type.replace(/[^a-z0-9]/gi, '_')}`;
  const title = `${def.label} — example`;
  const ctx = await browser.newContext({ baseURL: BASE, storageState: auth, viewport: { width: W, height: H }, recordVideo: { dir: join(TMP, 'raw'), size: { width: W, height: H } } });
  await ctx.addInitScript(() => { localStorage.setItem('linework:ai-open', '0'); });
  const put = () => ctx.request.put(`/api/files/${fileId}`, { data: { id: fileId, title, diagrams: [{ id: 'd1', type: 'architecture', name: 'Diagram 1', code: '', manual: {}, dir: 'LR', style: 'color' }], active: 0, doc: '', updated: Date.now(), view: 'flow', flow } });
  if (!(await put()).ok()) throw new Error('could not save the example workflow');
  // Does it run here (no account, no internet)? Then the video runs it.
  const run = def.trigger ? null : await preRun(ctx.request, fileId, flow);
  const ran = !!(run && run.status === 'success' && run.nodes && run.nodes.node && run.nodes.node.status === 'success');
  const page = await ctx.newPage();
  const born = Date.now();
  const marks = { clicks: [], chime: null, start: 0 };
  const at = () => (Date.now() - born) / 1000;
  const click = async (loc, opts) => {
    const box = await loc.boundingBox();
    if (!box) return;
    const x = box.x + box.width / 2, y = box.y + box.height / 2;
    await page.mouse.move(x, y, { steps: 18 });
    await page.waitForTimeout(150);
    marks.clicks.push(at());
    await loc.click(opts);
  };
  try {
    await page.goto('/');
    const row = page.locator('.ftable tbody tr', { hasText: title });
    await row.first().waitFor({ timeout: 6000 }).catch(() => {});
    // The home page can tidy away a file it didn't make while it loads; save it again until it shows.
    for (let i = 0; i < 5 && !(await row.count()); i++) { await put(); await page.reload(); await row.first().waitFor({ timeout: 6000 }).catch(() => {}); }
    await row.first().click();
    const nodes = page.locator('.fv-node');
    await nodes.first().waitFor({ timeout: 15000 });
    await page.waitForTimeout(600);
    const steps = ran ? ['Example data in', 'Set it up', 'Run', 'See the output'] : def.trigger ? ['Add the trigger', 'Set it up', 'Turn the workflow Active'] : ['Example data in', 'Set it up', 'Add your account, then Run'];
    await overlay(page, type, steps);
    await page.mouse.move(W / 2, H / 2 - 60);
    marks.start = at();
    const target = nodes.filter({ hasText: def.label }).last();
    await step(page, 0);
    if (!def.trigger) {
      await click(nodes.filter({ hasText: NAME }));
      await page.waitForTimeout(1300);
    } else await page.waitForTimeout(1000);
    await step(page, 1);
    await click(target);
    await page.waitForTimeout(1000);
    const panel = page.locator('.fv-panel');
    if (!ran) {
      for (const [label, value] of exampleFills(type)) {
        const input = panel.getByLabel(label, { exact: true }).first();
        if (!(await input.count()) || !(await input.isEditable().catch(() => false))) continue;
        await click(input);
        await input.fill('');
        await input.pressSequentially(value.slice(0, 60), { delay: 35 });
        await page.waitForTimeout(300);
      }
      await page.waitForTimeout(1200);
      await step(page, 2);
      await page.waitForTimeout(2600);
    } else {
      await page.waitForTimeout(900);
      await step(page, 2);
      await click(page.getByRole('button', { name: 'Run workflow' }));
      await page.locator('.fv-node.s-success, .fv-node.s-error').filter({ hasText: def.label }).last().waitFor({ timeout: 15000 }).catch(() => {});
      await page.waitForTimeout(900);
      marks.chime = at();
      await step(page, 3);
      await click(target);
      const out = panel.getByRole('tab', { name: /^Output/ });
      if (await out.count()) await click(out);
      await page.waitForTimeout(2800);
    }
    marks.end = at();
  } catch (e) {
    if (process.env.NV_DEBUG) await page.screenshot({ path: join(process.env.NV_DEBUG, `${type}.png`) }).catch(() => {});
    if (process.env.NV_DEBUG) console.log('files on server:', JSON.stringify((await (await ctx.request.get('/api/files')).json()).files?.map(f => [f.id, f.title, f.deleted, f.archived])));
    throw e;
  } finally {
    await page.close();
    const raw = await page.video().path();
    await ctx.request.delete(`/api/files/${fileId}`).catch(() => {});
    await ctx.close();
    marks.raw = raw;
  }
  return { ...marks, ran };
}

// The picture from the moment the caption shows, smaller and as H.264, with the music and the clicks.
function encode(type, m) {
  const len = Math.max(4, m.end - m.start + 0.4);
  const ss = Math.max(0, m.start - 0.2);
  const sfx = [...m.clicks.map(t => ['click', t]), ...(m.chime ? [['chime', m.chime]] : [])].filter(([, t]) => t >= ss && t < ss + len);
  const inputs = ['-ss', ss.toFixed(2), '-i', m.raw, '-ss', ((type.length * 1.7) % 20).toFixed(2), '-i', SOUND.music];
  sfx.forEach(([k]) => inputs.push('-i', SOUND[k]));
  const fades = `afade=t=in:d=0.8,afade=t=out:st=${(len - 1.2).toFixed(2)}:d=1.2,volume=0.55`;
  const parts = [`[1:a]atrim=0:${len.toFixed(2)},${fades}[m]`];
  sfx.forEach(([, t], i) => { const ms = Math.round((t - ss) * 1000); parts.push(`[${i + 2}:a]adelay=${ms}|${ms},volume=0.9[s${i}]`); });
  parts.push(`[m]${sfx.map((_, i) => `[s${i}]`).join('')}amix=inputs=${sfx.length + 1}:duration=first:normalize=0[a]`);
  parts.push(`[0:v]trim=0:${len.toFixed(2)},setpts=PTS-STARTPTS,fps=25,scale=960:-2:flags=lanczos,format=yuv420p[v]`);
  const out = join(OUT, `${type}.mp4`);
  execFileSync('ffmpeg', ['-y', '-v', 'error', ...inputs, '-filter_complex', parts.join(';'), '-map', '[v]', '-map', '[a]',
    '-c:v', 'libx264', '-preset', 'slow', '-crf', '33', '-tune', 'stillimage', '-c:a', 'aac', '-b:a', '64k', '-ac', '1', '-movflags', '+faststart', '-t', len.toFixed(2), out]);
  return Math.round(len * 10) / 10;
}

/* ---- all of them ---- */
mkdirSync(OUT, { recursive: true });
const indexPath = join(OUT, 'index.json');
const index = existsSync(indexPath) ? JSON.parse(readFileSync(indexPath, 'utf8')) : {};
const only = arg('only') ? arg('only').split(',') : null;
// Sticky notes are only words on the canvas: no video.
const SKIP = new Set(['core.note']);
const queue = Object.keys(NODES).filter(t => !SKIP.has(t) && (only ? only.includes(t) : true) && (flag('fresh') || only || !existsSync(join(OUT, `${t}.mp4`))));
console.log(`${queue.length} node videos to make, ${WORKERS} at a time`);
const failed = [];
let done = 0;
await Promise.all(Array.from({ length: WORKERS }, async (_, w) => {
  for (let type; (type = queue.shift());) {
    try {
      const m = await record(type, AUTH[w]);
      index[type] = encode(type, m);
      rmSync(m.raw, { force: true });
      done++;
      console.log(`${done} ${type} ${m.ran ? 'ran' : 'setup'} ${index[type]}s`);
      if (done % 10 === 0) writeFileSync(indexPath, JSON.stringify(index));
    } catch (e) { failed.push(type); console.log(`FAILED ${type}: ${e.message.split('\n')[0]}`); }
  }
}));
// Remove entries for nodes that no longer exist.
for (const t of Object.keys(index)) if (!NODES[t] || !existsSync(join(OUT, `${t}.mp4`))) delete index[t];
writeFileSync(indexPath, JSON.stringify(Object.fromEntries(Object.entries(index).sort())));
for (const f of readdirSync(OUT)) if (f.endsWith('.mp4') && !NODES[f.slice(0, -4)]) rmSync(join(OUT, f));
await browser.close();
server.close();
rmSync(TMP, { recursive: true, force: true });
console.log(`Done: ${done} made${failed.length ? `, failed: ${failed.join(', ')}` : ''}`);
process.exit(failed.length ? 1 : 0);
