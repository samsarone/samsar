import { defineConfig } from 'vitest/config';
import { playwright } from '@vitest/browser-playwright';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  envDir: false,
  plugins: [react(), tailwindcss()],
  // Keep React on one dependency graph when a browser test loads Home lazily.
  optimizeDeps: { include: ['react-dom/client'] },
  test: {
    include: ['test/browser/**/*.test.jsx'],
    setupFiles: ['./test/setup.js'],
    reporters: process.env.CI ? ['default', 'junit'] : ['default'],
    outputFile: { junit: 'test-results/browser.xml' },
    clearMocks: true,
    restoreMocks: true,
    forbidOnly: Boolean(process.env.CI),
    browser: {
      enabled: true,
      headless: true,
      // Use the shell installed by test:browser:install in every browser suite,
      // including coverage and watch mode. Never fall back to desktop Chrome.
      provider: playwright({ launchOptions: { channel: 'chromium-headless-shell' } }),
      instances: [{ browser: 'chromium' }],
    },
  },
});
