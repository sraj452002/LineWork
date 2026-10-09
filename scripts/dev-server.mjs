import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';

/* `npm run dev`: the app with accounts, in one command on any OS. Starts the Linework server for
   the API only (restarting on changes), and Vite with /api sent to it. Settings come from server/.env;
   without Google Drive set up there, data goes to ./data so it works straight away. */

if (existsSync('server/.env')) process.loadEnvFile('server/.env');
const env = { ...process.env };
const drive = env.GOOGLE_DRIVE_REFRESH_TOKEN || env.GOOGLE_SERVICE_ACCOUNT_KEY;
if (!drive && !env.DATA_DIR) env.DATA_DIR = 'data';
const port = env.PORT || '8787';
env.LINEWORK_API = `http://localhost:${port}`;
console.log(drive ? 'Data: Google Drive (from server/.env).' : `Data: the local folder ${env.DATA_DIR} (set up Google Drive in server/.env to use it).`);

const run = (cmd, args) => {
  const p = spawn(cmd, args, { env, stdio: 'inherit' });
  p.on('exit', code => { stop(); process.exitCode = code ?? 1; });
  return p;
};
const kids = [
  run(process.execPath, ['--disable-warning=ExperimentalWarning', '--watch', 'server/index.js', '--api-only']),
  // Always 5173: if it's taken (often another `npm run dev`), say so instead of moving.
  run(process.execPath, ['node_modules/vite/bin/vite.js', '--port', '5173', '--strictPort']),
];
const stop = () => kids.forEach(k => k.exitCode === null && k.kill());
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
