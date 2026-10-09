import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ISOLATION = { 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'credentialless' };

// The app reaches the Linework API (../backend) at /api on its own site, so the session cookie is
// first-party. On Netlify, BACKEND_URL (e.g. https://linework-api.onrender.com) becomes a proxy rule in
// dist/_redirects (netlify.toml can't read environment variables).
const API = (process.env.BACKEND_URL || '').replace(/\/+$/, '');
let outDir;
const apiProxy = {
  name: 'linework-api-proxy',
  apply: 'build',
  configResolved(c) { outDir = resolve(c.root, c.build.outDir); },
  buildStart() {
    if (!API && process.env.NETLIFY) this.error('Set BACKEND_URL in Netlify (Site configuration → Environment variables) to the backend\'s address, e.g. https://linework-api.onrender.com');
  },
  closeBundle() {
    if (API) writeFileSync(resolve(outDir, '_redirects'), `/api/*  ${API}/api/:splat  200!\n`);
  },
};

export default defineConfig({
  plugins: [react(), apiProxy],
  // Large chunks that only load when needed: src/lib/icondata.js (2,000+ icons) when the icon picker
  // opens, and Monaco with its language workers (the TypeScript one is ~7 MB) when the Code view opens.
  // The app's own entry chunk is about 400 KB.
  build: { chunkSizeWarningLimit: 7500 },
  // Same cross-origin isolation headers as netlify.toml, so running code works in development too.
  // With LINEWORK_API set (e.g. http://localhost:8787, from `npm run dev` at the top), /api goes to the
  // Linework API. The Host header is kept, so the API sees requests as coming from this page.
  server: { headers: ISOLATION, proxy: process.env.LINEWORK_API ? { '/api': { target: process.env.LINEWORK_API, changeOrigin: false } } : undefined },
  preview: { headers: ISOLATION },
});
