import { defineConfig } from "@playwright/test";
/** Synthetic component browser evidence only; no hosted auth, database, or credentials. */
export default defineConfig({
  testDir: "./tests/smart-rounding-fixture",
  testMatch: "*.spec.ts",
  outputDir: "test-results/smart-rounding-fixture",
  reporter: [["list"]],
  use: { baseURL: "http://127.0.0.1:4397", browserName: "chromium", screenshot: "only-on-failure", trace: "retain-on-failure" },
  webServer: { command: "npx vite --config tests/smart-rounding-fixture/vite.config.ts", url: "http://127.0.0.1:4397", reuseExistingServer: false, timeout: 60_000 },
});
