import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // src/lib/icondata.js (2,000+ icons) is a ~800 KB chunk loaded only when the icon picker opens.
  build: { chunkSizeWarningLimit: 900 },
});
