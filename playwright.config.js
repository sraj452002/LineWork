import { defineConfig } from '@playwright/test';

// Browser smoke tests. They drive the installed Microsoft Edge, so no browser download is needed.
// Run with: npm test
export default defineConfig({
  testDir: 'tests',
  timeout: 30_000,
  fullyParallel: true,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:5199',
    channel: 'msedge',
    viewport: { width: 1440, height: 900 },
    acceptDownloads: true,
  },
  webServer: {
    command: 'npx vite --port 5199 --strictPort',
    cwd: 'frontend',
    url: 'http://localhost:5199',
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
