import { defineConfig } from '@playwright/test';
import * as path from 'node:path';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  reporter: [['html', { outputFolder: 'playwright-report', open: 'never' }]],
  use: {
    baseURL: 'http://127.0.0.1:4000',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'node apps/api/dist/main.js',
    url: 'http://127.0.0.1:4000/api/health',
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
    env: {
      PORT: '4000',
      DATABASE_URL: process.env.DATABASE_URL ?? 'postgres://enis:enis@127.0.0.1:5432/enis_timetable',
      NODE_PATH: path.join(__dirname, 'apps', 'api', 'node_modules'),
    },
  },
});
