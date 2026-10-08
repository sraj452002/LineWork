import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const ISOLATION = { 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'credentialless' };

export default defineConfig({
  plugins: [react()],
  // Large chunks that only load when needed: src/lib/icondata.js (2,000+ icons) when the icon picker
  // opens, and Monaco with its language workers (the TypeScript one is ~7 MB) when the Code view opens.
  // The app's own entry chunk is about 400 KB.
  build: { chunkSizeWarningLimit: 7500 },
  // Same cross-origin isolation headers as netlify.toml, so running code works in development too.
  // With LINEWORK_API set (e.g. http://localhost:8787, from `npm run server`), /api goes to the Linework
  // server. The Host header is kept, so the server sees requests as coming from this page.
  server: { headers: ISOLATION, proxy: process.env.LINEWORK_API ? { '/api': { target: process.env.LINEWORK_API, changeOrigin: false } } : undefined },
  preview: { headers: ISOLATION },
});
