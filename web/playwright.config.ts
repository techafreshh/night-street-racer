import { defineConfig } from "@playwright/test";

// Chromium-only smoke: boots the real built app (vite preview, same as
// scripts/smoke.mjs) and fails on any console error or page error.
// Port 4173 collides with neither DEFAULT_PORT (8080) nor smoke's 8931.
export default defineConfig({
  testDir: "tests/e2e",
  timeout: 90_000,
  workers: 1,
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:4173",
  },
  projects: [
    {
      name: "chromium",
      use: { browserName: "chromium" },
    },
  ],
  webServer: {
    command: "npm run serve -- --port 4173 --host 127.0.0.1 --strictPort",
    url: "http://127.0.0.1:4173/health",
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
