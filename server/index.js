import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openStore } from './store.js';
import { backendFromEnv } from './drive.js';
import { createApp } from './app.js';
import { createMailer } from './mail.js';

// Start the Linework server. Settings come from environment variables (see server/.env.example).
const root = resolve(fileURLToPath(import.meta.url), '../..');
const env = process.env;
const num = (v, d) => (v === undefined || v === '' ? d : Number(v));

// Data goes to Google Drive (see drive.js); DATA_DIR keeps it in a local folder instead, for development.
const backend = backendFromEnv(env, root);
if (!backend) {
  console.error('No storage set up. Set GOOGLE_DRIVE_REFRESH_TOKEN (run `npm run drive-auth`) or GOOGLE_SERVICE_ACCOUNT_KEY for Google Drive, or DATA_DIR for a local folder. See server/.env.example.');
  process.exit(1);
}
const store = await openStore(backend);
console.log(`Data is kept in ${backend.describe()}.`);
const app = createApp(store, {
  allowSignup: env.ALLOW_SIGNUP !== 'false',
  aiKey: env.ANTHROPIC_API_KEY || '',
  aiModel: env.ANTHROPIC_MODEL || 'claude-sonnet-5-5',
  aiBase: env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com',
  aiDailyLimit: num(env.AI_DAILY_LIMIT, 50),
  // --api-only (npm run server): just /api, for Vite to proxy to during development.
  publicDir: env.PUBLIC_DIR === '' || process.argv.includes('--api-only') ? null : resolve(root, env.PUBLIC_DIR || 'dist'),
  trustProxy: env.TRUST_PROXY ? (/^\d+$/.test(env.TRUST_PROXY) ? Number(env.TRUST_PROXY) : env.TRUST_PROXY) : false,
  appUrl: env.APP_URL || '',
  allowLocal: env.ALLOW_LOCAL_MODE === 'true',
  // Let the Database view reach databases on private networks (this machine, a LAN, a VPC). Off by default.
  dbAllowPrivate: env.DB_ALLOW_PRIVATE === '1' || env.DB_ALLOW_PRIVATE === 'true',
  mailer: createMailer({ resendKey: env.RESEND_API_KEY, smtpUrl: env.SMTP_URL, from: env.MAIL_FROM }),
  requireVerified: env.REQUIRE_EMAIL_VERIFICATION === undefined || env.REQUIRE_EMAIL_VERIFICATION === '' ? undefined : env.REQUIRE_EMAIL_VERIFICATION !== 'false',
  oauth: {
    google: { clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET },
    github: { clientId: env.GITHUB_CLIENT_ID, clientSecret: env.GITHUB_CLIENT_SECRET },
  },
});

const port = num(env.PORT, 8787), host = env.HOST || '0.0.0.0';
const server = app.listen(port, host, err => {
  if (err) { console.error(err.code === 'EADDRINUSE' ? `Port ${port} is already in use: stop whatever is on it, or set PORT.` : err.message); process.exit(1); }
  console.log(`Linework server on http://${host === '0.0.0.0' ? 'localhost' : host}:${port}`);
});
// Finish writing to storage before exiting.
const stop = () => server.close(() => store.close().then(() => process.exit(0), e => { console.error('Last write to storage failed:', e.message); process.exit(1); }));
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
