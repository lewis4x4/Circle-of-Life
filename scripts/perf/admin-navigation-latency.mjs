#!/usr/bin/env node
/**
 * Measures authenticated admin route navigation latency with Playwright.
 * Test/support-only harness: no production code imports this file.
 *
 * Usage:
 *   BASE_URL=https://circleoflifealf.netlify.app RUNS=3 node scripts/perf/admin-navigation-latency.mjs
 *
 * Optional env:
 *   PERF_USER_EMAIL=jessica.murphy@circleoflifealf.com
 *   PHASE1_DEMO_PASSWORD=HavenDemo2026!
 *   ROUTES=/admin/staff,/admin/schedules,/admin/training
 */
import process from "node:process";
import { chromium } from "playwright";

const baseUrl = process.env.BASE_URL ?? "https://circleoflifealf.netlify.app";
const password = process.env.PHASE1_DEMO_PASSWORD ?? "HavenDemo2026!";
const email = process.env.PERF_USER_EMAIL ?? "jessica.murphy@circleoflifealf.com";
const runs = Number(process.env.RUNS ?? "3");
const routes = (process.env.ROUTES ?? "/admin/staff,/admin/schedules,/admin/training,/admin/billing,/admin/residents")
  .split(",")
  .map((route) => route.trim())
  .filter(Boolean);

function percentile(sortedValues, pct) {
  if (sortedValues.length === 0) return 0;
  const index = Math.min(sortedValues.length - 1, Math.ceil(sortedValues.length * pct) - 1);
  return sortedValues[index];
}

async function waitForAdminReady(page) {
  await page.locator("main").waitFor({ state: "visible", timeout: 30000 }).catch(() => {});
  await page.waitForLoadState("networkidle", { timeout: 30000 }).catch(() => {});
}

async function run() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  page.setDefaultTimeout(30000);

  const loginStart = performance.now();
  await page.goto(`${baseUrl}/login`, { waitUntil: "domcontentloaded" });
  await page.getByLabel("Work Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: /sign in/i }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 30000 });
  await waitForAdminReady(page);
  const loginMs = Math.round(performance.now() - loginStart);

  const samples = [];
  for (let runNumber = 1; runNumber <= runs; runNumber += 1) {
    for (const route of routes) {
      const start = performance.now();
      await page.goto(`${baseUrl}${route}`, { waitUntil: "domcontentloaded", timeout: 45000 });
      await waitForAdminReady(page);
      samples.push({ run: runNumber, route, ms: Math.round(performance.now() - start) });
    }
  }

  await browser.close();

  const values = samples.map((sample) => sample.ms).sort((a, b) => a - b);
  const byRoute = Object.fromEntries(
    routes.map((route) => {
      const routeValues = samples
        .filter((sample) => sample.route === route)
        .map((sample) => sample.ms)
        .sort((a, b) => a - b);
      return [
        route,
        {
          median: percentile(routeValues, 0.5),
          p95: percentile(routeValues, 0.95),
          samples: routeValues,
        },
      ];
    }),
  );

  console.log(
    JSON.stringify(
      {
        checkedAt: new Date().toISOString(),
        baseUrl,
        email,
        runs,
        routes,
        loginMs,
        median: percentile(values, 0.5),
        p95: percentile(values, 0.95),
        byRoute,
        samples,
      },
      null,
      2,
    ),
  );
}

run().catch((error) => {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exit(1);
});
