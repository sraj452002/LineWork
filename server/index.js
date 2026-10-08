import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb } from './db.js';
import { createApp } from './app.js';

// Start the Linework server. Settings come from environment variables (see server/.env.example).
const root = resolve(fileURLToPath(import.meta.url), '../..');
const env = process.env;
const num = (v, d) => (v === undefined || v === '' ? d : Number(v));

const store = openDb(resolve(root, env.DATABASE_PATH || 'data/linework.db'));
const app = createApp(store, {
  allowSignup: env.ALLOW_SIGNUP !== 'false',
  aiKey: env.ANTHROPIC_API_KEY || '',
  aiModel: env.ANTHROPIC_MODEL || 'claude-sonnet-5-5',
  aiBase: env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com',
  aiDailyLimit: num(env.AI_DAILY_LIMIT, 50),
  publicDir: env.PUBLIC_DIR === '' ? null : resolve(root, env.PUBLIC_DIR || 'dist'),
  trustProxy: env.TRUST_PROXY ? (/^\d+$/.test(env.TRUST_PROXY) ? Number(env.TRUST_PROXY) : env.TRUST_PROXY) : false,
});

const port = num(env.PORT, 8787), host = env.HOST || '0.0.0.0';
const server = app.listen(port, host, () => console.log(`Linework server on http://${host === '0.0.0.0' ? 'localhost' : host}:${port}`));
const stop = () => server.close(() => { store.close(); process.exit(0); });
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
