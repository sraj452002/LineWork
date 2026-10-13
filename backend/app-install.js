import { deflateSync } from 'node:zlib';
import { Readable } from 'node:stream';

/* Published apps as real apps:
   - Installable (a PWA): /api/ui/<token>/app is a small page of Workline's own around the app (which
     stays in its sandboxed frame), with a manifest, icons and a service worker, so a phone or computer
     can install it: Android's Chrome makes it an app in the app drawer (a WebAPK), iPhone adds it to the
     home screen, Chrome and Edge on a computer install it as a window of its own. The app's sign-in
     session is kept by this page (its storage) and handed to the frame.
   - Ready-to-run desktop apps: GET /api/electron/<platform> hands the browser Electron's official build
     (it can't fetch GitHub's releases itself), and the browser puts the app in it (lib/appexport.js). */

export const ELECTRON_VERSION = '31.7.7';
export const ELECTRON_PLATFORMS = ['win32-x64', 'linux-x64'];

// A square PNG: the app's colour, with its initial in white (a 5×7 pixel font, scaled up).
const FONT = {
  A: '01110100011000111111100011000110001', B: '11110100011000111110100011000111110', C: '01110100011000010000100001000101110',
  D: '11110100011000110001100011000111110', E: '11111100001000011110100001000011111', F: '11111100001000011110100001000010000',
  G: '01110100011000010111100011000101111', H: '10001100011000111111100011000110001', I: '01110001000010000100001000010001110',
  J: '00111000100001000010000101001001100', K: '10001100101010011000101001001010001', L: '10000100001000010000100001000011111',
  M: '10001110111010110101100011000110001', N: '10001110011010110011100011000110001', O: '01110100011000110001100011000101110',
  P: '11110100011000111110100001000010000', Q: '01110100011000110001101011001001101', R: '11110100011000111110101001001010001',
  S: '01111100001000001110000010000111110', T: '11111001000010000100001000010000100', U: '10001100011000110001100011000101110',
  V: '10001100011000110001100010101000100', W: '10001100011000110101101011101110001', X: '10001100010101000100010101000110001',
  Y: '10001100010101000100001000010000100', Z: '11111000010001000100010001000011111', 0: '01110100011001110101110011000101110',
  1: '00100011000010000100001000010001110', 2: '01110100010000100010001000100011111', 3: '11111000100010000010000011000101110',
  4: '00010001100101010010111110001000010', 5: '11111100001111000001000011000101110', 6: '00110010001000011110100011000101110',
  7: '11111000010001000100010000100001000', 8: '01110100011000101110100011000101110', 9: '01110100011000101111000010001001100',
};
const CRC = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc32 = buf => { let c = 0xffffffff; for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (type, data) => {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]), crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
};
export function iconPng(letter, color, size) {
  const hex = /^#[0-9a-f]{6}$/i.test(color) ? color : '#4f46e5';
  const bg = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
  const glyph = FONT[String(letter || 'A').toUpperCase()] || FONT.A;
  const scale = Math.floor(size * 0.5 / 7), gx = Math.floor((size - 5 * scale) / 2), gy = Math.floor((size - 7 * scale) / 2);
  const raw = Buffer.alloc(size * (size * 3 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 3 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const cx = Math.floor((x - gx) / scale), cy = Math.floor((y - gy) / scale);
      const on = x >= gx && y >= gy && cx < 5 && cy < 7 && glyph[cy * 5 + cx] === '1';
      const o = y * (size * 3 + 1) + 1 + x * 3;
      raw[o] = on ? 255 : bg[0]; raw[o + 1] = on ? 255 : bg[1]; raw[o + 2] = on ? 255 : bg[2];
    }
  }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const nameOf = file => String((file.ui && file.ui.spec && file.ui.spec.name) || file.title || 'App').slice(0, 60);
const colorOf = file => (file.ui && file.ui.spec && file.ui.spec.theme && file.ui.spec.theme.primary) || '#4f46e5';
const bgOf = file => (file.ui && file.ui.spec && file.ui.spec.theme && file.ui.spec.theme.bg) || '#ffffff';
const letterOf = name => (String(name).match(/[a-z0-9]/i) || ['A'])[0].toUpperCase();

// The install routes, on the published apps' router (backend/flows.js). `uiOf(token)` finds the app.
export function installRoutes(ui, uiOf) {
  const app = (handler) => async (req, res) => {
    const a = await uiOf(req.params.token);
    if (!a) return res.status(404).type('text').send('This app isn’t published (or the link is wrong).');
    handler(req, res, a.file, `/api/ui/${req.params.token}`);
  };
  // The installable page: Workline's own, the app in its sandboxed frame inside.
  ui.get('/:token/app', app((req, res, file, base) => {
    const name = nameOf(file);
    res.set({ 'cache-control': 'no-cache', 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer',
      'content-security-policy': "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'unsafe-inline'; img-src 'self' data:; frame-src 'self'; manifest-src 'self'; worker-src 'self'; connect-src 'self'" });
    res.type('html').send(`<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>${esc(name)}</title>
<link rel="manifest" href="${base}/manifest.webmanifest">
<meta name="theme-color" content="${esc(colorOf(file))}">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-title" content="${esc(name)}">
<link rel="apple-touch-icon" href="${base}/icon-192.png">
<link rel="icon" href="${base}/icon-192.png">
<style>html,body{margin:0;height:100%;background:${esc(bgOf(file))}}iframe{position:fixed;inset:0;width:100%;height:100%;border:0}</style>
</head><body>
<iframe id="app" title="${esc(name)}" sandbox="allow-scripts allow-forms allow-popups allow-modals allow-downloads" allow="fullscreen; clipboard-write; geolocation; camera; microphone"></iframe>
<script>
(function () {
  var key = 'workline-app-session:${req.params.token}', frame = document.getElementById('app');
  // The app keeps its sign-in here (its own frame has no storage), so it lasts between launches.
  var s = ''; try { s = localStorage.getItem(key) || ''; } catch (e) {}
  frame.src = '${base}' + (s ? '#wls=' + encodeURIComponent(s) : '');
  addEventListener('message', function (e) {
    var m = e.data;
    if (e.source !== frame.contentWindow || !m || m.workline !== 'session') return;
    try { m.value ? localStorage.setItem(key, m.value) : localStorage.removeItem(key); } catch (err) {}
  });
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('${base}/sw.js', { scope: '${base}/' }).catch(function () {});
})();
</script>
</body></html>`);
  }));
  ui.get('/:token/manifest.webmanifest', app((req, res, file, base) => {
    const name = nameOf(file);
    res.type('application/manifest+json').set('cache-control', 'no-cache').send(JSON.stringify({
      name, short_name: name.slice(0, 12), id: `${base}/app`, start_url: `${base}/app`, scope: `${base}/`, display: 'standalone',
      background_color: bgOf(file), theme_color: colorOf(file),
      icons: [192, 512].map(size => ({ src: `${base}/icon-${size}.png`, sizes: `${size}x${size}`, type: 'image/png', purpose: 'any maskable' })),
    }));
  }));
  ui.get('/:token/icon-:size.png', app((req, res, file) => {
    const size = Number(req.params.size) === 512 ? 512 : 192;
    res.type('png').set('cache-control', 'public, max-age=86400').send(iconPng(letterOf(nameOf(file)), colorOf(file), size));
  }));
  // A service worker, so it can be installed: it passes requests on, and says so when offline.
  ui.get('/:token/sw.js', app((req, res) => {
    res.type('js').set('cache-control', 'no-cache').send(`self.addEventListener('install', function () { self.skipWaiting(); });
self.addEventListener('activate', function (e) { e.waitUntil(self.clients.claim()); });
self.addEventListener('fetch', function (e) {
  if (e.request.mode !== 'navigate') return;
  e.respondWith(fetch(e.request).catch(function () {
    return new Response('<!doctype html><meta name="viewport" content="width=device-width"><body style="font:16px system-ui;padding:40px;text-align:center">You’re offline. Connect to the internet and open the app again.</body>', { headers: { 'content-type': 'text/html' } });
  }));
});
`);
  }));
}

// Electron's official build for a platform, passed through (signed-in people only; one at a time each).
export function electronRoute(api, signedIn, { base = 'https://github.com/electron/electron/releases/download' } = {}) {
  const busy = new Set();
  api.get('/electron/:platform', signedIn, async (req, res) => {
    const p = req.params.platform;
    if (!ELECTRON_PLATFORMS.includes(p)) return res.status(404).json({ error: 'not_found', message: 'Windows (win32-x64) and Linux (linux-x64) only.' });
    if (busy.has(req.user.id)) return res.status(429).json({ error: 'busy', message: 'One app at a time: wait for the last one to finish.' });
    busy.add(req.user.id);
    try {
      const r = await fetch(`${base}/v${ELECTRON_VERSION}/electron-v${ELECTRON_VERSION}-${p}.zip`, { redirect: 'follow' });
      if (!r.ok || !r.body) return res.status(502).json({ error: 'download', message: `Couldn’t get Electron (${r.status}).` });
      res.set({ 'content-type': 'application/zip', 'cache-control': 'private, max-age=3600' });
      if (r.headers.get('content-length')) res.set('content-length', r.headers.get('content-length'));
      await new Promise((ok, fail) => { const s = Readable.fromWeb(r.body); s.on('error', fail); res.on('close', ok); s.pipe(res); });
    } catch (e) {
      if (!res.headersSent) res.status(502).json({ error: 'download', message: 'Couldn’t get Electron. Try again in a minute.' });
    } finally { busy.delete(req.user.id); }
  });
}
