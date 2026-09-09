#!/usr/bin/env node
/** Real Chromium source-component rendering. Auth/navigation/API fixtures only; no live connection. */
import { mkdir, readFile, writeFile, realpath, lstat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { createServer } from "vite";
import react from "@vitejs/plugin-react";
import { chromium } from "playwright";
import AxeBuilder from "@axe-core/playwright";
const repo = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const requestedRun = process.env.INSURANCE_BROWSER_RUN_DIR;
assert(
  requestedRun,
  "INSURANCE_BROWSER_RUN_DIR must explicitly identify the current owned run.",
);
const runsRoot = await realpath(
  path.join(os.homedir(), ".hermes/tmp/agent-runs"),
);
const run = await realpath(path.resolve(requestedRun));
assert(
  path.dirname(run) === runsRoot,
  "Browser run must be a real directory directly beneath the agent-runs root.",
);
const runId = path.basename(run);
const manifest = path.join(run, "manifest.json");
const manifestStat = await lstat(manifest);
assert(
  manifestStat.isFile() &&
    !manifestStat.isSymbolicLink() &&
    (manifestStat.mode & 0o077) === 0,
  "Run manifest must be a private regular file.",
);
function validateManifest(value) {
  assert(
    value.schema_version === 1 &&
      value.created_by === "codex" &&
      value.run_id === runId &&
      Array.isArray(value.artifacts),
    "Run manifest must match this codex-owned run directory.",
  );
  return value;
}
validateManifest(JSON.parse(await readFile(manifest, "utf8")));
const startedAt = new Date().toISOString();
const invocation = `${startedAt.replace(/[:.]/g, "-")}-${process.pid}`;
const harness = path.join(run, `agency-browser-${invocation}`);
const evidenceRoot = path.join(
  repo,
  "test-results/insurance/agency-summary-browser",
);
const output = path.join(evidenceRoot, `${invocation}-${runId}`);
async function writeReport() {
  const reportPath = path.join(output, "report.json");
  await writeFile(reportPath, JSON.stringify(report, null, 2) + "\n");
  await writeFile(
    path.join(evidenceRoot, "latest.json"),
    JSON.stringify(
      {
        run_id: runId,
        started_at: startedAt,
        passed: report.passed,
        report: path.relative(evidenceRoot, reportPath),
      },
      null,
      2,
    ) + "\n",
  );
}
async function recordArtifact(file) {
  const m = validateManifest(JSON.parse(await readFile(manifest, "utf8")));
  if (!m.artifacts.includes(file)) m.artifacts.push(file);
  assert(m.artifacts.length <= 1000);
  await writeFile(manifest, JSON.stringify(m, null, 2) + "\n", { mode: 0o600 });
}
async function file(name, text) {
  const target = path.join(harness, name);
  await recordArtifact(target);
  await writeFile(target, text);
}
await mkdir(harness, { recursive: true });
await recordArtifact(harness);
await mkdir(output, { recursive: true });
for (const dir of ["profile", "cache", "tmp"]) {
  await mkdir(path.join(harness, dir), { recursive: true });
  await recordArtifact(path.join(harness, dir));
}
await file(
  "index.html",
  '<!doctype html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Synthetic agency summaries verification</title></head><body><div id="root"></div><script type="module" src="/entry.tsx"></script></body></html>',
);
await file(
  "auth.ts",
  'export function useHavenAuth(){return {loading:false,organizationId:"synthetic-org",appRole:"owner",user:{id:"synthetic-manager"}}}',
);
await file(
  "navigation.ts",
  "export function usePathname(){return location.pathname;}",
);
await file(
  "facility.ts",
  "export function useFacilityStore(selector:any){return selector({selectedFacilityId:null})}",
);
await file(
  "link.tsx",
  'import React from "react";export default function Link({children,...props}:any){return <a {...props}>{children}</a>}',
);
await file(
  "entry.tsx",
  'import React from "react";import {createRoot} from "react-dom/client";import "@/app/globals.css";import AgencySummaries from "@/components/insurance/agency-summaries";createRoot(document.getElementById("root")!).render(<><div role="note" className="border-b border-border bg-muted p-3 text-sm">Synthetic browser verification · Auth and API mocked · Live connection disabled</div><main className="mx-auto max-w-[1500px] p-4 md:p-8"><AgencySummaries/></main></>);',
);
const aliases = [
  ["@/contexts/haven-auth-context", path.join(harness, "auth.ts")],
  ["@/hooks/useFacilityStore", path.join(harness, "facility.ts")],
  ["next/navigation", path.join(harness, "navigation.ts")],
  ["next/link", path.join(harness, "link.tsx")],
  ["@", path.join(repo, "src")],
  ["react-dom", path.join(repo, "node_modules/react-dom")],
  ["react", path.join(repo, "node_modules/react")],
].map(([find, replacement]) => ({ find, replacement }));
const server = await createServer({
  configFile: false,
  root: harness,
  cacheDir: path.join(harness, "cache"),
  plugins: [react()],
  resolve: { alias: aliases, dedupe: ["react", "react-dom"] },
  css: { postcss: repo },
  optimizeDeps: { include: ["react", "react-dom/client", "react/jsx-runtime"] },
  server: {
    host: "127.0.0.1",
    port: 0,
    fs: { allow: [repo, harness] },
    watch: { ignored: ["**/profile/**", "**/tmp/**"] },
  },
});
const report = {
  run_id: runId,
  started_at: startedAt,
  synthetic_only: true,
  boundary:
    "Real unchanged source component and Haven CSS in Chromium; mocked auth/Next navigation/API. No provider, SQL, hosted permission or live connection verification.",
  checks: [],
  axe: [],
  screenshots: [],
  errors: [],
};
let context;
try {
  await server.listen();
  const base = server.resolvedUrls.local[0];
  const { agencySummaryFixture } = await server.ssrLoadModule(
    path.join(
      repo,
      "src/components/insurance/test-support/agency-summary-fixture.ts",
    ),
  );
  context = await chromium.launchPersistentContext(
    path.join(harness, "profile"),
    {
      headless: true,
      channel: "chromium",
      viewport: { width: 1512, height: 1100 },
      env: { ...process.env, TMPDIR: path.join(harness, "tmp") },
      args: ["--disable-crash-reporter"],
    },
  );
  const page = await context.newPage();
  page.on("pageerror", (error) => report.errors.push(String(error)));
  let scenario = "empty";
  await context.route("**/api/insurance/agency-summaries", async (route) => {
    assert.equal(route.request().method(), "GET");
    if (scenario === "failure") {
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ error: "PRIVATE-UNSAFE-ERROR" }),
      });
      return;
    }
    const data = agencySummaryFixture(scenario === "expiry" ? 1200 : 60_000);
    if (scenario === "empty") data.connections = [];
    if (scenario === "degraded") {
      data.connections[0].state = "degraded";
      data.connections[0].incomplete_summary_count = 1;
      data.connections[0].raw_quarantine = "PRIVATE-BODY";
    }
    await route.fulfill({
      contentType: "application/json",
      headers: { "Cache-Control": "private, no-store" },
      body: JSON.stringify(data),
    });
  });
  async function screenshot(name) {
    const target = path.join(output, name + ".png");
    await page.screenshot({ path: target, fullPage: true });
    report.screenshots.push(target);
  }
  async function audit(name) {
    const result = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
      .analyze();
    report.axe.push({
      name,
      violations: result.violations.map((v) => ({
        id: v.id,
        impact: v.impact,
        nodes: v.nodes.map((n) => n.target),
      })),
    });
  }
  const check = (name) => report.checks.push({ name, passed: true });
  await page.goto(base + "admin/insurance/agency-summaries");
  await page
    .getByRole("heading", { name: "No agency summaries available" })
    .waitFor();
  await screenshot("disabled-empty");
  await audit("disabled-empty");
  check("truthful disabled empty state");
  scenario = "healthy";
  await page.reload();
  await page.getByRole("heading", { name: "IF-SYN-42" }).waitFor();
  assert.equal(await page.getByText("90000.75", { exact: true }).count(), 1);
  assert.equal(await page.getByText("$90,000.75", { exact: true }).count(), 0);
  await page
    .locator("summary")
    .filter({ hasText: "Release provenance" })
    .click();
  await screenshot("source-stated-desktop");
  await audit("source-stated-desktop");
  check("source wording, unconverted premium and provenance");
  await page.setViewportSize({ width: 390, height: 844 });
  await screenshot("source-stated-mobile");
  const width = await page.evaluate(() => ({
    viewport: innerWidth,
    width: document.documentElement.scrollWidth,
  }));
  assert(width.width <= width.viewport + 1);
  await audit("source-stated-mobile");
  check("mobile layout has no horizontal overflow");
  await page.setViewportSize({ width: 1512, height: 1100 });
  scenario = "degraded";
  await page.reload();
  await page.getByText(/Degraded — some summaries unavailable/).waitFor();
  await page.getByRole("heading", { name: "IF-SYN-42" }).waitFor();
  assert.equal(await page.getByText(/PRIVATE/).count(), 0);
  await screenshot("degraded");
  await audit("degraded");
  check("degraded body completeness with only allowed current summary");
  scenario = "expiry";
  await page.reload();
  await page.getByRole("heading", { name: "IF-SYN-42" }).waitFor();
  await page
    .getByRole("heading", { name: "IF-SYN-42" })
    .waitFor({ state: "hidden", timeout: 5000 });
  await page.getByText(/Authorization unavailable or expired/).waitFor();
  await screenshot("expired-hidden");
  await audit("expired-hidden");
  check("authorization deadline hides source values");
  scenario = "healthy";
  await page.reload();
  await page.getByRole("heading", { name: "IF-SYN-42" }).waitFor();
  await context.setOffline(true);
  await page.getByText(/unavailable while offline/).waitFor();
  assert.equal(
    await page.getByRole("heading", { name: "IF-SYN-42" }).count(),
    0,
  );
  await screenshot("offline-hidden");
  check("offline event hides summaries without cached fallback");
  scenario = "failure";
  await context.setOffline(false);
  await page.getByRole("alert").waitFor();
  assert.equal(await page.getByText(/PRIVATE/).count(), 0);
  assert.equal(
    await page.getByRole("heading", { name: "IF-SYN-42" }).count(),
    0,
  );
  await screenshot("failure-hidden");
  check("failed recheck cannot restore old data or expose raw errors");
  report.browser = context.browser()?.version();
  report.passed =
    report.errors.length === 0 &&
    report.axe.every((a) => a.violations.length === 0);
  await writeReport();
  console.log(
    JSON.stringify(
      {
        passed: report.passed,
        checks: report.checks.length,
        axe: report.axe.map((a) => ({
          name: a.name,
          violations: a.violations.length,
        })),
        errors: report.errors,
        output,
      },
      null,
      2,
    ),
  );
  if (!report.passed) process.exitCode = 1;
} catch (error) {
  report.passed = false;
  report.failure = String(error);
  await writeReport();
  console.error(error);
  process.exitCode = 1;
} finally {
  await context?.close();
  await server.close();
}
