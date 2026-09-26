import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './test/browser',
  timeout: 30000,
  use: {
    baseURL: 'http://127.0.0.1:5180',
    channel: process.env.PLAYWRIGHT_CHANNEL || (process.platform === 'win32' ? 'msedge' : 'chromium'),
    viewport: { width: 1440, height: 1000 },
    locale: 'en-US',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'npm run dev -- --host 127.0.0.1 --port 5180 --strictPort',
    url: 'http://127.0.0.1:5180',
    reuseExistingServer: !process.env.CI,
    env: { BROWSER: 'none' },
  },
})
