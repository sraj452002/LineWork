import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openStore } from './store.js';
import { backendFromEnv } from './storage.js';
import { LOCAL_USER, NVIDIA_MODELS, createApp } from './app.js';

// Start the Workline API. Settings come from environment variables (see .env.example).
const root = resolve(fileURLToPath(import.meta.url), '..');
const env = process.env;
const num = (v, d) => (v === undefined || v === '' ? d : Number(v));

// No accounts and no storage: files stay in each person's browser. What the server keeps (workflows,
// credentials, runs) is in memory, or in DATA_DIR if it's set (see storage.js).
const backend = backendFromEnv(env, root);
const store = await openStore(backend, { storageLimit: 0 });
console.log(`Data is kept in ${backend.describe()}.`);
const app = createApp(store, {
  // No sign-in: every request is the one built-in user.
  noAccounts: true,
  aiKey: env.ANTHROPIC_API_KEY || '',
  aiModel: env.ANTHROPIC_MODEL || 'claude-sonnet-5-5',
  aiBase: env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com',
  nvidiaKey: env.NVIDIA_API_KEY || '',
  // Whose published apps anyone can run in the WorkLine Apps phone app (/run): the built-in user's.
  storeOwner: env.STORE_OWNER || LOCAL_USER,
  nvidiaModel: env.NVIDIA_MODEL || NVIDIA_MODELS,
  nvidiaBase: env.NVIDIA_BASE_URL || 'https://integrate.api.nvidia.com/v1',
  aiDailyLimit: num(env.AI_DAILY_LIMIT, 0),
  trustProxy: env.TRUST_PROXY ? (/^\d+$/.test(env.TRUST_PROXY) ? Number(env.TRUST_PROXY) : env.TRUST_PROXY) : false,
  appUrl: env.APP_URL || '',
  // Let the Database view reach databases on private networks (this machine, a LAN, a VPC). Off by default.
  dbAllowPrivate: env.DB_ALLOW_PRIVATE === '1' || env.DB_ALLOW_PRIVATE === 'true',
  // Workflows: the key their saved credentials are encrypted with (without it, one kept in meta.json).
  flowSecret: env.FLOW_SECRET || '',
});

const port = num(env.PORT, 8787), host = env.HOST || '0.0.0.0';
const server = app.listen(port, host, err => {
  if (err) { console.error(err.code === 'EADDRINUSE' ? `Port ${port} is already in use: stop whatever is on it, or set PORT.` : err.message); process.exit(1); }
  console.log(`Workline API on http://${host === '0.0.0.0' ? 'localhost' : host}:${port}`);
});
// Finish writing to storage before exiting.
const stop = () => server.close(() => store.close().then(() => process.exit(0), e => { console.error('Last write to storage failed:', e.message); process.exit(1); }));
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
