import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright E2E test configuration for Gird
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'html',
  use: {
    baseURL: process.env.API_BASE_URL || 'http://localhost:3000',
    trace: 'on-first-retry',
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  webServer: process.env.CI
    ? undefined
    : [
        // Optional: Start servers before running tests
        // {
        //   command: 'pnpm --filter @gird/server dev',
        //   port: 3000,
        //   timeout: 120 * 1000,
        // },
        // {
        //   command: 'pnpm --filter @gird/dashboard dev',
        //   port: 5173,
        //   timeout: 120 * 1000,
        // },
      ],
});
