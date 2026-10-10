import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests/browser",
  timeout: 60000,
  workers: 1,
  use: {
    baseURL: "http://127.0.0.1:3100",
    headless: true,
    launchOptions: {
      executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium",
      args: ["--no-sandbox"],
    },
    screenshot: "only-on-failure",
  },
  webServer: [
    {
      command: "node tests/browser-server.mjs",
      url: "http://127.0.0.1:3100/api/health",
      reuseExistingServer: false,
      timeout: 30000,
    },
    {
      command: "node tests/public-browser-server.mjs",
      url: "http://127.0.0.1:3102/api/health",
      reuseExistingServer: false,
      timeout: 30000,
    },
  ],
});
