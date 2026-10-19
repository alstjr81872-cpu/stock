import { defineConfig } from "@playwright/test";
const realFirebase = process.env.NF_E2E_REAL_FIREBASE === "1";
export default defineConfig({
  testDir: "./tests/browser",
  timeout: 90000,
  workers: 1,
  fullyParallel: false,
  use: {
    baseURL: realFirebase ? "http://127.0.0.1:3000" : "http://127.0.0.1:3001",
    headless: true,
    launchOptions: {
      executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium",
      args: ["--no-sandbox"],
    },
    screenshot: "only-on-failure",
  },
  webServer: realFirebase ? [] : [
    {
      command:
        "NF_TEST_SERVER=1 .venv/bin/python -m uvicorn backend.tests.ui_server:app --host 127.0.0.1 --port 8001",
      url: "http://127.0.0.1:8001/api/health",
      reuseExistingServer: false,
      timeout: 20000,
    },
    {
      command:
        "NEXT_DIST_DIR=.next-test BACKEND_URL=http://127.0.0.1:8001 node_modules/.bin/next dev --hostname 127.0.0.1 --port 3001",
      url: "http://127.0.0.1:3001",
      reuseExistingServer: false,
      timeout: 60000,
    },
  ],
});
