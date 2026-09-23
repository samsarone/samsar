import { defineConfig } from 'vitest/config';
import { playwright } from '@vitest/browser-playwright';
import react from '@vitejs/plugin-react';

export default defineConfig({
  envDir: false,
  plugins: [react()],
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
      provider: playwright(),
      instances: [{ browser: 'chromium' }],
    },
  },
});
