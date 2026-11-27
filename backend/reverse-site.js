import { parse } from 'node-html-parser';
import { request } from './flow-util.js';

/* Reverse engineer → a website: read one page as a visitor would (no logging in, no crawling past it)
   and say what's on it: its title and description, the technologies it shows signs of, the pages it
   links to, its forms, the API addresses its own scripts call, and whether it has robots.txt and a
   sitemap. Private addresses are refused like everywhere else (request() checks the host). */

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36 Workline';
// [name, kind, test on the page's html / script and link addresses / response headers]
const SIGNS = [
  ['React', 'Framework', h => /data-reactroot|__REACT_DEVTOOLS|react-dom|_reactListening/.test(h)],
  ['Next.js', 'Framework', h => /__NEXT_DATA__|\/_next\//.test(h)],
  ['Vue', 'Framework', h => /data-v-[0-9a-f]{6,}|vue(\.runtime)?(\.global)?(\.prod)?\.js|__VUE__/.test(h)],
  ['Nuxt', 'Framework', h => /__NUXT__|\/_nuxt\//.test(h)],
  ['Angular', 'Framework', h => /ng-version=|ng-app|angular(\.min)?\.js/.test(h)],
  ['Svelte', 'Framework', h => /svelte-[a-z0-9]{5,}|__sveltekit/.test(h)],
  ['Gatsby', 'Framework', h => /___gatsby|gatsby-/.test(h)],
  ['Astro', 'Framework', h => /astro-island|data-astro-cid/.test(h)],
  ['WordPress', 'Framework', h => /wp-content|wp-includes|wp-json/.test(h)],
  ['Shopify', 'Framework', h => /cdn\.shopify\.com|Shopify\.theme/.test(h)],
  ['Wix', 'Framework', h => /static\.wixstatic\.com|wix-bolt/.test(h)],
  ['Webflow', 'Framework', h => /webflow\.(js|css)|data-wf-page/.test(h)],
  ['Squarespace', 'Framework', h => /static1\.squarespace\.com/.test(h)],
  ['jQuery', 'Library', h => /jquery([.-][\d.]+)?(\.min)?\.js/.test(h)],
  ['Bootstrap', 'Library', h => /bootstrap(\.min)?\.(css|js)/.test(h)],
  ['Tailwind CSS', 'Library', h => /tailwind|class="[^"]*\b(?:px|py|mt|mb|flex|grid)-[0-9]/.test(h)],
  ['Font Awesome', 'Library', h => /font-?awesome/.test(h)],
  ['Google Fonts', 'Library', h => /fonts\.googleapis\.com/.test(h)],
  ['Google Analytics', 'Analytics', h => /googletagmanager\.com\/gtag|google-analytics\.com|gtag\(/.test(h)],
  ['Google Tag Manager', 'Analytics', h => /googletagmanager\.com\/gtm\.js|GTM-[A-Z0-9]+/.test(h)],
  ['Meta Pixel', 'Analytics', h => /connect\.facebook\.net\/[^"]*fbevents|fbq\(/.test(h)],
  ['Hotjar', 'Analytics', h => /static\.hotjar\.com|hj\(/.test(h)],
  ['Plausible', 'Analytics', h => /plausible\.io\/js/.test(h)],
  ['Segment', 'Analytics', h => /cdn\.segment\.com/.test(h)],
  ['Stripe', 'Payments', h => /js\.stripe\.com/.test(h)],
  ['Razorpay', 'Payments', h => /checkout\.razorpay\.com/.test(h)],
  ['PayPal', 'Payments', h => /paypal\.com\/sdk|paypalobjects/.test(h)],
  ['reCAPTCHA', 'Security', h => /google\.com\/recaptcha|grecaptcha/.test(h)],
  ['hCaptcha', 'Security', h => /hcaptcha\.com/.test(h)],
  ['Cloudflare Turnstile', 'Security', h => /challenges\.cloudflare\.com\/turnstile/.test(h)],
  ['Intercom', 'Support', h => /widget\.intercom\.io|intercomSettings/.test(h)],
  ['Crisp', 'Support', h => /client\.crisp\.chat/.test(h)],
  ['Firebase', 'Backend', h => /firebaseapp\.com|firebase(-app)?\.js|firebaseConfig/.test(h)],
  ['Supabase', 'Backend', h => /supabase\.co/.test(h)],
  ['Algolia', 'Search', h => /algolia(net)?\.(com|net)|algoliasearch/.test(h)],
  ['YouTube embed', 'Media', h => /youtube\.com\/embed/.test(h)],
  ['Cloudinary', 'Media', h => /res\.cloudinary\.com/.test(h)],
];
const HEADER_SIGNS = [
  ['cloudflare', 'Cloudflare', 'CDN'], ['vercel', 'Vercel', 'Hosting'], ['netlify', 'Netlify', 'Hosting'], ['github.com', 'GitHub Pages', 'Hosting'],
  ['amazons3', 'Amazon S3', 'Hosting'], ['cloudfront', 'CloudFront', 'CDN'], ['fastly', 'Fastly', 'CDN'], ['akamai', 'Akamai', 'CDN'], ['nginx', 'nginx', 'Server'], ['apache', 'Apache', 'Server'],
  ['express', 'Express', 'Server'], ['php', 'PHP', 'Server'], ['asp.net', 'ASP.NET', 'Server'], ['gws', 'Google', 'Server'], ['envoy', 'Envoy', 'Server'], ['litespeed', 'LiteSpeed', 'Server'],
];

export async function analyseSite(url, { allowPrivate = false } = {}) {
  let u = String(url || '').trim();
  if (!/^https?:\/\//i.test(u)) u = 'https://' + u;
  const r = await request(u, { headers: { 'user-agent': UA, accept: 'text/html,application/xhtml+xml,*/*;q=0.8', 'accept-language': 'en' } }, { allowPrivate, timeout: 20_000 });
  const html = typeof r.body === 'string' ? r.body.slice(0, 3_000_000) : JSON.stringify(r.body).slice(0, 200_000);
  const root = parse(html, { lowerCaseTagName: true, comment: false });
  const base = new URL(u);
  const abs = href => { try { return new URL(href, base); } catch (e) { return null; } };
  const meta = n => root.querySelector(`meta[name="${n}"]`)?.getAttribute('content') || root.querySelector(`meta[property="${n}"]`)?.getAttribute('content') || '';
  const scripts = root.querySelectorAll('script'), srcs = scripts.map(s => s.getAttribute('src')).filter(Boolean);
  const hay = html + '\n' + srcs.join('\n');
  const tech = [];
  for (const [name, kind, test] of SIGNS) if (test(hay)) tech.push({ name, kind, evidence: 'the page' });
  const hdr = Object.entries(r.headers || {}).map(([k, v]) => `${k}: ${v}`).join('\n').toLowerCase();
  for (const [needle, name, kind] of HEADER_SIGNS) if (hdr.includes(needle) && !tech.some(t => t.name === name)) tech.push({ name, kind, evidence: 'response headers' });
  const gen = meta('generator');
  if (gen && !tech.some(t => gen.toLowerCase().includes(t.name.toLowerCase()))) tech.push({ name: gen, kind: 'Framework', evidence: 'generator tag' });
  // Links: this site's pages (once each), and other sites.
  const links = [], seen = new Set();
  for (const a of root.querySelectorAll('a[href]')) {
    const h = abs(a.getAttribute('href'));
    if (!h || !/^https?:$/.test(h.protocol)) continue;
    const internal = h.host === base.host, key = internal ? h.pathname : h.host;
    if (seen.has(key)) continue;
    seen.add(key);
    links.push({ href: h.href, path: internal ? h.pathname : h.href, text: a.text.replace(/\s+/g, ' ').trim().slice(0, 60), internal });
    if (links.length >= 200) break;
  }
  const forms = root.querySelectorAll('form').slice(0, 20).map(f => ({
    action: f.getAttribute('action') || '', method: (f.getAttribute('method') || 'GET').toUpperCase(),
    fields: f.querySelectorAll('input,select,textarea').map(i => i.getAttribute('name') || i.getAttribute('id') || i.getAttribute('type') || i.tagName.toLowerCase()).filter(n => n && n !== 'hidden').slice(0, 15),
  }));
  // API addresses the page's own (inline) scripts call: fetch('…'), axios.get('…'), '/api/…'.
  const inline = scripts.filter(s => !s.getAttribute('src')).map(s => s.text).join('\n').slice(0, 1_000_000);
  const apis = [...new Set([...inline.matchAll(/(?:fetch|axios(?:\.\w+)?|\$\.(?:get|post|ajax))\(\s*['"`]([^'"`\s]{2,120})['"`]/g), ...inline.matchAll(/['"`]((?:https?:\/\/[^'"`\s]+)?\/(?:api|graphql|v\d)\/[^'"`\s]{0,100})['"`]/g)].map(m => m[1]))].slice(0, 30);
  // robots.txt and sitemap.xml, quickly; they're extras.
  const peek = async p => { try { const x = await request(new URL(p, base).href, { headers: { 'user-agent': UA } }, { allowPrivate, timeout: 6000 }); return x.ok && typeof x.body === 'string' ? x.body : ''; } catch (e) { return ''; } };
  const [robots, sitemap] = await Promise.all([peek('/robots.txt'), peek('/sitemap.xml')]);
  return {
    url: u, status: r.status, server: r.headers?.server || r.headers?.['x-powered-by'] || '',
    title: (root.querySelector('title')?.text || meta('og:title')).trim().slice(0, 140), description: (meta('description') || meta('og:description')).slice(0, 300),
    lang: root.querySelector('html')?.getAttribute('lang') || '',
    headings: root.querySelectorAll('h1,h2').map(h => h.text.replace(/\s+/g, ' ').trim()).filter(Boolean).slice(0, 12),
    tech, links, forms, apis,
    scripts: scripts.length, styles: root.querySelectorAll('link[rel="stylesheet"],style').length, images: root.querySelectorAll('img').length,
    robots: !!robots, sitemap: sitemap ? (sitemap.match(/<loc>/g) || []).length : 0,
  };
}
