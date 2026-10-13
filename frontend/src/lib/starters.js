import { dg } from './engines.js';
import { rid } from './utils.js';
import { appDoc } from './apphost.js';
import { secretPath } from './flows.js';

/* Ready-made templates: files with a workflow and a custom app built on it, offered in Templates and
   Tools. Each make() gives a new file. */

const FIND = `// The video library. Swap this list for your own: a Google Sheet, Airtable, a database or your
// video host's API (an HTTP node). Videos live on a CDN or video host (Mux, Cloudflare Stream,
// Bunny, S3 + CloudFront…), which does the streaming: MP4/WebM, or HLS (.m3u8).
const videos = [
  { id: 'bunny', title: 'Big Buck Bunny', category: 'Animation', duration: '9:56', views: 18230,
    src: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4',
    poster: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/images/BigBuckBunny.jpg' },
  { id: 'dream', title: 'Elephants Dream', category: 'Animation', duration: '10:53', views: 9411,
    src: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ElephantsDream.mp4',
    poster: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/images/ElephantsDream.jpg' },
  { id: 'sintel', title: 'Sintel', category: 'Film', duration: '14:48', views: 26802,
    src: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/Sintel.mp4',
    poster: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/images/Sintel.jpg' },
  { id: 'steel', title: 'Tears of Steel', category: 'Film', duration: '12:14', views: 12077,
    src: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/TearsOfSteel.mp4',
    poster: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/images/TearsOfSteel.jpg' },
  { id: 'live', title: 'HLS test stream', category: 'Streams', duration: 'HLS', views: 4120,
    src: 'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8',
    poster: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/images/ForBiggerBlazes.jpg' },
];
const { search = '', category = 'All' } = items[0] || {};
return videos
  .filter(v => category === 'All' || v.category === category)
  .filter(v => v.title.toLowerCase().includes(String(search).toLowerCase()));`;

const SIGN = `# Playback links. With your own CDN, set SECRET (better: keep it in a credential) and the CDN
# checks ?exp=…&sig=… so links work only for 10 minutes. Without one, the links pass through as they are.
import hmac, hashlib, time
from urllib.parse import urlparse

SECRET = b""   # e.g. b"your-cdn-signing-secret"
exp = int(time.time()) + 600
out = []
for v in items:
    src = v["src"]
    if SECRET:
        path = urlparse(src).path
        sig = hmac.new(SECRET, f"{path}:{exp}".encode(), hashlib.sha256).hexdigest()
        src += ("&" if "?" in src else "?") + f"exp={exp}&sig={sig}"
    out.append({**v, "src": src, "expires": exp})
return out`;

const PLAYER = `<style>
  :root { color-scheme: dark; }
  body { margin: 0; background: #0d1117; color: #e6edf3; font: 15px/1.5 system-ui, -apple-system, Segoe UI, sans-serif; }
  header { display: flex; align-items: center; gap: 16px; padding: 14px 24px; border-bottom: 1px solid #21262d; flex-wrap: wrap; }
  .logo { font-weight: 800; font-size: 20px; } .logo span { color: #ff4d6d; }
  header input { flex: 1; min-width: 200px; max-width: 420px; padding: 9px 14px; border-radius: 999px; border: 1px solid #30363d; background: #161b22; color: inherit; font: inherit; }
  .chips { display: flex; gap: 6px; flex-wrap: wrap; }
  .chips button { padding: 6px 12px; border-radius: 999px; border: 1px solid #30363d; background: #161b22; color: #c9d1d9; font: inherit; font-size: 13px; cursor: pointer; }
  .chips button.on { background: #e6edf3; color: #0d1117; border-color: #e6edf3; }
  main { display: grid; grid-template-columns: minmax(0, 1fr) 340px; gap: 24px; padding: 22px 24px; max-width: 1280px; margin: 0 auto; }
  video { width: 100%; aspect-ratio: 16 / 9; background: #000; border-radius: 14px; display: block; }
  h2 { margin: 14px 0 2px; font-size: 22px; }
  .meta { color: #8b949e; font-size: 13px; }
  .list { display: grid; gap: 12px; align-content: start; }
  .item { display: grid; grid-template-columns: 150px 1fr; gap: 10px; cursor: pointer; border-radius: 10px; padding: 6px; }
  .item:hover, .item.on { background: #161b22; }
  .item img { width: 150px; aspect-ratio: 16 / 9; object-fit: cover; border-radius: 8px; background: #161b22; }
  .item b { display: block; font-size: 14px; }
  .empty { color: #8b949e; }
  @media (max-width: 860px) { main { grid-template-columns: 1fr; } }
</style>
<header>
  <div class="logo">▶ Work<span>Tube</span></div>
  <input id="q" placeholder="Search videos">
  <div class="chips" id="chips"></div>
</header>
<main>
  <section>
    <video id="player" controls playsinline></video>
    <h2 id="title"></h2>
    <div class="meta" id="meta"></div>
  </section>
  <aside class="list" id="list"></aside>
</main>
<script>
  const state = { search: '', category: 'All', videos: [], current: null };
  const $ = id => document.getElementById(id), player = $('player');
  const cats = ['All', 'Animation', 'Film', 'Streams'];
  let hls;
  // MP4/WebM play as they are; HLS (.m3u8) needs hls.js outside Safari. Either way the CDN streams.
  async function play(v) {
    state.current = v;
    $('title').textContent = v.title;
    render();
    if (hls) { hls.destroy(); hls = null; }
    if (v.src.includes('.m3u8') && !player.canPlayType('application/vnd.apple.mpegurl')) {
      if (!window.Hls) await new Promise(r => { const s = document.createElement('script'); s.src = 'https://cdnjs.cloudflare.com/ajax/libs/hls.js/1.5.13/hls.min.js'; s.onload = s.onerror = r; document.head.append(s); });
      if (window.Hls && Hls.isSupported()) { hls = new Hls(); hls.loadSource(v.src); hls.attachMedia(player); }
      else { player.removeAttribute('src'); $('meta').textContent = 'This stream needs hls.js, which didn’t load.'; return; }
    } else player.src = v.src;
    player.poster = v.poster || '';
    $('meta').textContent = v.category + ' · ' + Number(v.views || 0).toLocaleString() + ' views · ' + v.duration;
  }
  function render() {
    $('chips').innerHTML = cats.map(c => '<button class="' + (c === state.category ? 'on' : '') + '" data-c="' + c + '">' + c + '</button>').join('');
    $('list').innerHTML = state.videos.length ? state.videos.map((v, i) =>
      '<div class="item' + (state.current && v.id === state.current.id ? ' on' : '') + '" data-i="' + i + '"><img src="' + (v.poster || '') + '" alt=""><div><b>' + v.title + '</b><span class="meta">' + v.category + ' · ' + v.duration + '</span></div></div>').join('')
      : '<p class="empty">No videos match.</p>';
  }
  async function load() {
    // The workflow finds the videos and hands out their playback links.
    try { state.videos = await workline.run('Video library', { search: state.search, category: state.category }); }
    catch (e) { $('list').innerHTML = '<p class="empty"></p>'; $('list').firstChild.textContent = e.message; return; }
    if (state.videos.length && (!state.current || !state.videos.some(v => v.id === state.current.id))) play(state.videos[0]); else render();
  }
  $('chips').onclick = e => { const c = e.target.dataset.c; if (c) { state.category = c; load(); } };
  $('list').onclick = e => { const it = e.target.closest('.item'); if (it) { play(state.videos[it.dataset.i]).then(() => player.play().catch(() => {})); } };
  let t; $('q').oninput = e => { clearTimeout(t); t = setTimeout(() => { state.search = e.target.value; load(); }, 250); };
  // A signed link that has expired: get fresh links and carry on from the same spot.
  player.onerror = async () => {
    if (!state.current || !state.current.expires || state.current.expires * 1000 > Date.now()) return;
    const at = player.currentTime; await load();
    const v = state.videos.find(x => x.id === state.current.id);
    if (v) { await play(v); player.currentTime = at; player.play().catch(() => {}); }
  };
  load();
</script>`;

const node = (type, name, x, params = {}, y = 160) => ({ id: rid('n'), type, name, x, y, params });
const chain = nodes => nodes.slice(1).map((n, i) => ({ id: rid('e'), from: nodes[i].id, fromPort: 'main', to: n.id, toPort: 'main' }));

// The video library as a page made only of workflow nodes (no HTML): the Page trigger and UI nodes.
const PAGE_VIDEOS = `// The videos, picked by the page's buttons (?category=…, ?video=…) and its search form.
// Swap this list for a Google Sheet, Airtable or database node: same fields.
const { query = {}, form = {} } = items[0] || {};
const videos = [
  { id: 'bunny', title: 'Big Buck Bunny', category: 'Animation', duration: '9:56',
    src: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4',
    poster: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/images/BigBuckBunny.jpg' },
  { id: 'dream', title: 'Elephants Dream', category: 'Animation', duration: '10:53',
    src: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ElephantsDream.mp4',
    poster: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/images/ElephantsDream.jpg' },
  { id: 'sintel', title: 'Sintel', category: 'Film', duration: '14:48',
    src: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/Sintel.mp4',
    poster: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/images/Sintel.jpg' },
  { id: 'steel', title: 'Tears of Steel', category: 'Film', duration: '12:14',
    src: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/TearsOfSteel.mp4',
    poster: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/images/TearsOfSteel.jpg' },
];
const search = String(form.search || '').toLowerCase();
const shown = videos
  .filter(v => !query.category || v.category === query.category)
  .filter(v => !search || v.title.toLowerCase().includes(search));
// The one picked (?video=…) goes first: the player shows the first item.
return shown.sort((a, b) => (b.id === query.video) - (a.id === query.video));`;

export const STARTERS = [
  {
    k: 'videopage', name: 'Video library page (no code UI)', note: 'A video page built only from workflow nodes: Page, Buttons, Form, a player and a gallery',
    make: () => {
      const id = rid('f'), now = Date.now();
      const nodes = [
        node('trigger.page', 'Page', 80, { path: secretPath(), title: 'WorkTube', description: 'Pick a category, search, or click a video to play it.', theme: 'dark', width: 'wide' }),
        node('core.code', 'Find videos', 340, { language: 'javascript', code: PAGE_VIDEOS }),
        node('ui.buttons', 'Categories', 600, { buttons: [{ name: 'All', value: '?' }, { name: 'Animation', value: '?category=Animation' }, { name: 'Film', value: '?category=Film' }] }),
        node('ui.form', 'Search', 860, { fields: 'Search', button: 'Search', action: 'search' }),
        node('ui.media', 'Player', 1120, { url: '{{ $json.src }}', poster: '{{ $json.poster }}', caption: '{{ $json.title }} · {{ $json.category }} · {{ $json.duration }}', kind: 'video', layout: 'one' }),
        node('ui.text', 'More videos', 1380, { text: '### More videos', style: 'text' }),
        node('ui.media', 'Gallery', 1640, { url: '{{ $json.poster }}', caption: '{{ $json.title }}', link: '?video={{ $json.id }}', kind: 'image', layout: 'gallery' }),
      ];
      return { id, title: 'Video library page', created: now, updated: now, doc: '', diagrams: [dg('architecture', 'Diagram 1', '')], active: 0, view: 'flow', flow: { active: false, nodes, edges: chain(nodes) } };
    },
  },
  {
    k: 'video', name: 'Video streaming app', note: 'A video library workflow and a player app around it: search, categories, MP4 and HLS, signed links',
    make: () => {
      const id = rid('f'), now = Date.now(), title = 'Video library';
      const nodes = [
        node('trigger.manual', 'Run by hand', 80),
        node('core.code', 'Find videos (JavaScript)', 340, { language: 'javascript', code: FIND }),
        node('core.code', 'Playback links (Python)', 600, { language: 'python', code: SIGN }),
      ];
      const edges = nodes.slice(1).map((n, i) => ({ id: rid('e'), from: nodes[i].id, fromPort: 'main', to: n.id, toPort: 'main' }));
      return {
        id, title, created: now, updated: now, doc: '', diagrams: [dg('architecture', 'Diagram 1', '')], active: 0, view: 'app',
        flow: { active: false, nodes, edges },
        ui: { html: PLAYER, flows: [id], published: false, doc: appDoc(PLAYER, { workflows: [{ id, name: title }], title }) },
      };
    },
  },
];
