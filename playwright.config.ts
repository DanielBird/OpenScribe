import { defineConfig, devices } from '@playwright/test';

// Specs open the built dist/describe.html over file:// (see tests/e2e/helpers.ts), so there is no
// baseURL and no web server. `npm run test:e2e` builds first and runs the `chromium` project.
// The `perf` project (`npm run test:perf`) times a 3-hour transcript; it is kept out of the normal run
// because timings depend on the machine.
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'chromium', testMatch: '**/*.e2e.ts', use: { ...devices['Desktop Chrome'] } },
    { name: 'perf', testMatch: '**/*.perf.ts', use: { ...devices['Desktop Chrome'] } },
  ],
});
