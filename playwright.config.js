// @ts-check
const { defineConfig, devices } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './e2e',
  timeout: 60000,
  expect: {
    timeout: 10000,
  },
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: process.env.PLAYWRIGHT_TEST_BASE_URL || 'http://127.0.0.1:3000',
    headless: true,
  },
  webServer: [
    {
      command: 'node collaborationserver/src/server.js test',
      port: 1234,
      timeout: 60000,
      reuseExistingServer: true,
      env: {
        NODE_ENV: 'test',
        COLLAB_TEST: 'true',
        PORT: '1234',
      },
      stdout: 'ignore',
      stderr: 'ignore',
    },
    {
      command: 'npx next start -p 3000',
      port: 3000,
      timeout: 60000,
      reuseExistingServer: true,
      env: {
        AGENT_TEST_MOCK: 'true',
        COLLAB_TEST: 'true',
        PLAYWRIGHT_TEST: 'true',
      },
      stdout: 'ignore',
      stderr: 'ignore',
    },
  ],
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
