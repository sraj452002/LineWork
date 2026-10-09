import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb } from './db.js';
import { createApp } from './app.js';
import { createMailer } from './mail.js';

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
const server = app.listen(port, host, () => console.log(`Linework server on http://${host === '0.0.0.0' ? 'localhost' : host}:${port}`));
const stop = () => server.close(() => { store.close(); process.exit(0); });
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
