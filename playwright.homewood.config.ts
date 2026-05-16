import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright config for the Homewood launch workflow tests.
 *
 * Runs tests/homewood-launch/*.spec.ts against the dev/staging Supabase
 * project using one canonical test account per role (the same accounts the
 * Sprint 2 auth verifier exercises). Set BASE_URL to point at a running
 * Next.js server, e.g.:
 *
 *   BASE_URL=http://127.0.0.1:4310 npm run homewood:test-launch
 */
const BASE_URL = process.env.BASE_URL ?? "http://127.0.0.1:4310";

export default defineConfig({
  testDir: "./tests/homewood-launch",
  outputDir: "./test-results/homewood-launch-output",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: process.env.CI
    ? [
        ["list"],
        ["html", { outputFolder: "test-results/homewood-launch-html", open: "never" }],
        ["json", { outputFile: "test-results/homewood-launch.json" }],
      ]
    : [["list"], ["html", { outputFolder: "test-results/homewood-launch-html", open: "never" }]],
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  use: {
    baseURL: BASE_URL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    actionTimeout: 10_000,
    navigationTimeout: 20_000,
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
