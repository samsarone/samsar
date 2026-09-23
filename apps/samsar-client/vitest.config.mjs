import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  // Tests must not inherit credentials or endpoints from developers' .env files.
  envDir: false,
  plugins: [react()],
  test: {
    environment: 'jsdom',
    include: ['test/unit/**/*.test.{js,jsx}'],
    setupFiles: ['./test/setup.js'],
    reporters: process.env.CI ? ['default', 'junit'] : ['default'],
    outputFile: { junit: 'test-results/unit.xml' },
    clearMocks: true,
    restoreMocks: true,
    forbidOnly: Boolean(process.env.CI),
  },
});
