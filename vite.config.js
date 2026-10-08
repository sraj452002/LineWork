import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // Large chunks that only load when needed: src/lib/icondata.js (2,000+ icons) when the icon picker
  // opens, and Monaco with its language workers (the TypeScript one is ~7 MB) when the Code view opens.
  // The app's own entry chunk is about 400 KB.
  build: { chunkSizeWarningLimit: 7500 },
});
