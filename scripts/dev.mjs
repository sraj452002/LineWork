import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/* `npm run dev`: the backend and the frontend together, in one command on any OS. Starts the Linework
   API from backend/ (restarting on changes) and Vite from frontend/ with /api sent to it. Settings come
   from backend/.env. Files stay in the browser; what the backend keeps goes to backend/data (DATA_DIR), so
   workflows and their credentials last across restarts while developing. */

const dir = p => fileURLToPath(new URL(`../${p}`, import.meta.url));
const backend = dir('backend'), frontend = dir('frontend');
if (!existsSync(`${backend}/node_modules`) || !existsSync(`${frontend}/node_modules`)) {
  console.error('Install first: `npm install` here installs frontend/ and backend/ too.');
  process.exit(1);
}
if (existsSync(`${backend}/.env`)) process.loadEnvFile(`${backend}/.env`);
const env = { ...process.env };
if (!env.DATA_DIR) env.DATA_DIR = 'data';
const port = env.PORT || '8787';
env.LINEWORK_API = `http://localhost:${port}`;
console.log(`The backend keeps its data in ${env.DATA_DIR}, in backend/.`);

const run = (args, cwd) => {
  const p = spawn(process.execPath, args, { env, cwd, stdio: 'inherit' });
  p.on('exit', code => { stop(); process.exitCode = code ?? 1; });
  return p;
};
const kids = [
  run(['--disable-warning=ExperimentalWarning', '--watch', 'index.js'], backend),
  // Always 5173: if it's taken (often another `npm run dev`), say so instead of moving.
  run(['node_modules/vite/bin/vite.js', '--port', '5173', '--strictPort'], frontend),
];
const stop = () => kids.forEach(k => k.exitCode === null && k.kill());
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
