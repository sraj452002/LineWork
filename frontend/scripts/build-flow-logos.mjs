// Builds src/lib/flowlogos.js: the brand marks of the apps workflow nodes connect to, from simple-icons.
// Run with: node scripts/build-flow-logos.mjs (from frontend/). Brands simple-icons doesn't carry use line icons.
import { writeFileSync } from 'node:fs';
import * as si from 'simple-icons';

const SLUGS = ['discord', 'telegram', 'github', 'notion', 'gmail', 'googlesheets', 'airtable', 'trello', 'jira', 'linear', 'asana',
  'clickup', 'todoist', 'hubspot', 'stripe', 'shopify', 'mailchimp', 'googlegemini', 'supabase', 'dropbox', 'googlechat', 'whatsapp',
  'zendesk', 'gitlab', 'wordpress', 'ntfy', 'resend', 'postgresql', 'rss', 'claude', 'ycombinator', 'mattermost', 'googlecalendar',
  'calendly', 'mailgun', 'brevo', 'pagerduty', 'deepl', 'bitly', 'googleforms', 'redis'];
const bySlug = new Map(Object.values(si).filter(i => i && i.slug).map(i => [i.slug, i]));
const out = {};
for (const s of SLUGS) {
  const i = bySlug.get(s);
  if (!i) { console.warn('missing', s); continue; }
  out[s] = { color: '#' + i.hex, d: i.path };
}
writeFileSync(new URL('../src/lib/flowlogos.js', import.meta.url),
  `// Brand marks for workflow app nodes, from simple-icons (CC0). Built by scripts/build-flow-logos.mjs.\nexport const LOGOS = ${JSON.stringify(out)};\n`);
console.log(Object.keys(out).length, 'logos');
