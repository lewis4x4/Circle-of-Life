import { defineConfig } from "@playwright/test";
/** Synthetic component browser evidence for /admin/document-intake/accuracy; no hosted auth, database, or credentials. */
export default defineConfig({
  testDir: "./tests/jev-accuracy-fixture",
  testMatch: "*.spec.ts",
  outputDir: "test-results/jev-accuracy-fixture",
  reporter: [["list"]],
  use: { baseURL: "http://127.0.0.1:4417", browserName: "chromium", screenshot: "only-on-failure", trace: "retain-on-failure" },
  webServer: { command: "npx vite --config tests/jev-accuracy-fixture/vite.config.ts", url: "http://127.0.0.1:4417", reuseExistingServer: false, timeout: 60_000 },
});
