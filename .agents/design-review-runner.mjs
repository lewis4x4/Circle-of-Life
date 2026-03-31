/**
 * Playwright design review: multi-viewport snapshots for critical routes.
 *
 * Env:
 *   BASE_URL          — default http://127.0.0.1:3000
 *   DESIGN_REVIEW_ROUTES — comma-separated paths, default "/"
 */

import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const root = process.cwd();
const baseUrl = process.env.BASE_URL ?? "http://127.0.0.1:3000";
const routes = (process.env.DESIGN_REVIEW_ROUTES ?? "/")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const viewports = [
  { width: 375, height: 812, name: "375" },
  { width: 768, height: 1024, name: "768" },
  { width: 1024, height: 900, name: "1024" },
  { width: 1440, height: 900, name: "1440" },
];

const outDir = path.join(root, "test-results", "design-review");
const shotDir = path.join(outDir, "screenshots");

async function main() {
  fs.mkdirSync(shotDir, { recursive: true });

  const browser = await chromium.launch({ headless: true });
  const report = {
    timestamp: new Date().toISOString(),
    baseUrl,
    routes,
    viewports: viewports.map((v) => v.name),
    shots: [],
    errors: [],
  };

  try {
    for (const route of routes) {
      const url = new URL(route, baseUrl).toString();
      for (const vp of viewports) {
        const context = await browser.newContext({
          viewport: { width: vp.width, height: vp.height },
        });
        const page = await context.newPage();
        try {
          const res = await page.goto(url, {
            waitUntil: "domcontentloaded",
            timeout: 30_000,
          });
          const status = res?.status() ?? 0;
          const title = await page.title();
          const fileSafe = `${route.replace(/\//g, "_") || "root"}-${vp.name}.png`.replace(
            /_+/g,
            "_",
          );
          const shotPath = path.join(shotDir, fileSafe);
          await page.screenshot({ path: shotPath, fullPage: true });
          report.shots.push({
            route,
            viewport: vp.name,
            url,
            status,
            title,
            screenshot: path.relative(root, shotPath),
          });
        } catch (e) {
          report.errors.push({
            route,
            viewport: vp.name,
            message: e instanceof Error ? e.message : String(e),
          });
        } finally {
          await context.close();
        }
      }
    }
  } finally {
    await browser.close();
  }

  const outFile = path.join(outDir, "report.json");
  fs.writeFileSync(outFile, JSON.stringify(report, null, 2), "utf8");

  if (report.errors.length > 0) {
    console.error(
      `[design:review] FAIL: ${report.errors.length} viewport/route error(s). See ${outFile}`,
    );
    process.exit(1);
  }

  console.log(`[design:review] PASS: ${report.shots.length} screenshot(s) -> ${outFile}`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
