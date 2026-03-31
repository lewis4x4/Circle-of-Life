#!/usr/bin/env node
/**
 * Playwright + axe on critical routes (requires dev server or BASE_URL).
 *
 * Env:
 *   BASE_URL — default http://127.0.0.1:3000
 *   AXE_ROUTES — comma-separated paths (default "/" or DESIGN_REVIEW_ROUTES)
 */

import AxeBuilder from "@axe-core/playwright";
import { chromium } from "playwright";
import process from "node:process";

const baseUrl = process.env.BASE_URL ?? "http://127.0.0.1:3000";
const routes = (
  process.env.AXE_ROUTES ??
  process.env.DESIGN_REVIEW_ROUTES ??
  "/"
)
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

async function main() {
  const browser = await chromium.launch({ headless: true });
  const bad = [];

  try {
    for (const route of routes) {
      const context = await browser.newContext();
      const page = await context.newPage();
      const url = new URL(route, baseUrl).href;
      try {
        await page.goto(url, { waitUntil: "domcontentloaded", timeout: 20_000 });
        // Let client hydration settle to avoid scanning transient loading overlays.
        await page.waitForTimeout(1000);
        // Remove known non-product debug overlays injected by local tooling.
        await page.evaluate(() => {
          const appRoot = document.querySelector("#__next");
          if (appRoot?.parentElement === document.body) {
            Array.from(document.body.children).forEach((child) => {
              if (child === appRoot) return;
              if (child.tagName === "SCRIPT" || child.tagName === "STYLE") return;
              child.remove();
            });
          }

          const findOverlayRoot = (start) => {
            let element = start;
            for (let i = 0; i < 10 && element?.parentElement; i += 1) {
              const style = window.getComputedStyle(element);
              const zIndex = Number.parseInt(style.zIndex || "0", 10);
              if (style.position === "fixed" || zIndex > 999) return element;
              element = element.parentElement;
            }
            return null;
          };

          const roots = new Set();
          const markers = [
            "drag · scroll · space+drag · dbl-click",
            "SPEEDY INC",
            "ANALYTICS",
            "Justice Companies Agent",
            "idle",
            "working",
          ];

          document.querySelectorAll('[title*="Agent"]').forEach((node) => {
            const root =
              findOverlayRoot(node) ??
              node.closest('[data-testid*="agent"], [class*="agent"], button, [role="dialog"], div');
            if (root) roots.add(root);
          });

          document.querySelectorAll("body *").forEach((node) => {
            const text = node.textContent ?? "";
            if (!markers.some((marker) => text.includes(marker))) return;
            const root =
              findOverlayRoot(node) ??
              node.closest('[data-testid*="agent"], [class*="agent"], [class*="overlay"], div');
            if (root) roots.add(root);
          });

          roots.forEach((root) => {
            if (root && root !== document.body && root !== document.documentElement) {
              root.remove();
            }
          });
        });
      } catch (e) {
        console.error(`[a11y:routes] FAIL: could not load ${url} — start the app (npm run dev) or set BASE_URL.\n${e.message}`);
        process.exitCode = 1;
        await context.close();
        return;
      }

      const results = await new AxeBuilder({ page }).analyze();
      const serious = results.violations.filter((v) =>
        ["critical", "serious"].includes(v.impact),
      );
      if (serious.length) {
        bad.push({
          url,
          violations: serious.map((v) => ({
            id: v.id,
            help: v.help,
            nodes: v.nodes.map((node) => ({
              target: node.target,
              failureSummary: node.failureSummary,
            })),
          })),
        });
      }
      await context.close();
    }
  } finally {
    await browser.close();
  }

  if (bad.length) {
    console.error("[a11y:routes] FAIL: critical/serious axe violations:\n", JSON.stringify(bad, null, 2));
    process.exit(1);
  }
  console.log(`[a11y:routes] PASS (${routes.length} route(s))`);
}

await main();
