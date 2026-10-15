// Points the Android app at a WorkLine site: node set-site.mjs https://your-site.netlify.app
import { readFileSync, writeFileSync } from 'node:fs';
const site = String(process.argv[2] || '').trim().replace(/\/+$/, '');
if (!/^https:\/\/[\w.-]+(:\d+)?$/.test(site)) { console.error('Give the site as https://name.example.com'); process.exit(1); }
const cfg = JSON.parse(readFileSync('capacitor.config.json', 'utf8'));
cfg.server.url = `${site}/mobile`;
writeFileSync('capacitor.config.json', JSON.stringify(cfg, null, 2) + '\n');
writeFileSync('www/offline.html', readFileSync('www/offline.html', 'utf8').replace(/https:\/\/[^']+\/mobile/, `${site}/mobile`));
console.log(`The app opens ${cfg.server.url}`);
