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
    {
      // Spec 07A section 9 item 3: the three-tap capture on a phone viewport.
      // Runs on Chromium (the only browser installed on the gate hosts) with the
      // iPhone 13 screen, scale factor, touch, and user agent.
      name: "care-events",
      testDir: "./tests/care-events",
      timeout: 120_000,
      use: {
        ...devices["iPhone 13"],
        browserName: "chromium",
        actionTimeout: 30_000,
        navigationTimeout: 60_000,
      },
    },
    {
      // Spec 25A section 12: the Smart Rounding acceptance items that need a
      // real database and a real session. Desktop Chrome, because the surfaces
      // under test are the five operator tabs and the settings tier; the
      // caregiver capture spec drives the same phone-first component and does
      // not need the phone viewport to prove what it asserts.
      //
      // Off unless SMART_ROUNDING_E2E is set, and once it is set nothing in the
      // project skips: a missing credential throws. See tests/smart-rounding/_helpers.ts.
      name: "smart-rounding",
      testDir: "./tests/smart-rounding",
      timeout: 120_000,
      use: {
        ...devices["Desktop Chrome"],
        actionTimeout: 30_000,
        navigationTimeout: 60_000,
      },
    },
    {
      // Spec 40 section 10 items 1, 3, 4, 5 and 7 and the DESIGN.md section 6
      // fidelity gate: the shared floor tablets and the front-door kiosk on an
      // iPad (A16), against the fidelity demo on Haven HFO Staging. Every spec
      // runs in both orientations (1180 x 820 and 820 x 1180, see ORIENTATIONS
      // in tests/floor-kiosk/_helpers.ts), so `--project=floor-kiosk` covers both.
      //
      // Off unless FLOOR_KIOSK_E2E is set; once it is, nothing skips. The setup
      // project re-seeds staging first (scripts/floor/seed-prototype-demo.mjs).
      name: "floor-kiosk-setup",
      testDir: "./tests/floor-kiosk",
      testMatch: /seed\.setup\.ts/,
      timeout: 300_000,
    },
    {
      name: "floor-kiosk",
      testDir: "./tests/floor-kiosk",
      testMatch: /.*\.spec\.ts/,
      dependencies: ["floor-kiosk-setup"],
      timeout: 240_000,
      use: {
        browserName: "chromium",
        viewport: { width: 1180, height: 820 },
        deviceScaleFactor: 2,
        hasTouch: true,
        isMobile: false,
        locale: "en-US",
        timezoneId: "America/New_York",
        actionTimeout: 30_000,
        navigationTimeout: 60_000,
      },
    },
  ],
});
