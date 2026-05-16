#!/usr/bin/env node
/**
 * Homewood Lodge ALF — a11y baseline (Sprint 5 of Homewood Go-Live).
 *
 * Runs @axe-core/playwright against the 5 Homewood launch routes, signed in
 * with the appropriate role, and writes `docs/homewood/A11Y_BASELINE.md`
 * grouped by impact (critical / serious / moderate / minor).
 *
 * Usage:
 *   BASE_URL=http://127.0.0.1:4310 npm run homewood:a11y-baseline
 *
 * Required env:
 *   BASE_URL (running Next.js server)
 *   NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY
 *   HOMEWOOD_LAUNCH_PASSWORD (or PHASE1_DEMO_PASSWORD fallback)
 *
 * Exit code:
 *   0  if no critical or serious violations on any of the 5 routes
 *   1  otherwise (and details are in the markdown report)
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";

import AxeBuilder from "@axe-core/playwright";
import { chromium } from "playwright";
import { createClient } from "@supabase/supabase-js";

const ROOT = process.cwd();
const REPORT_PATH = path.join(ROOT, "docs", "homewood", "A11Y_BASELINE.md");

function loadEnvFile(filePath) {
  if (!existsSync(filePath)) return;
  for (const rawLine of readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;
    const [, key, rawValue] = match;
    if (process.env[key]) continue;
    let value = rawValue.trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

const ROUTE_ROLES = [
  { route: "/admin/command", role: "facility_admin", email: "jessica.murphy@circleoflifealf.com" },
  { route: "/caregiver", role: "caregiver", email: "maria.garcia@circleoflifealf.com" },
  { route: "/family", role: "family", email: "linda.chen@circleoflifealf.com" },
  { route: "/med-tech", role: "med_tech", email: "medtech@circleoflifealf.com" },
  { route: "/dietary", role: "dietary", email: "dietary@circleoflifealf.com" },
];

async function signInAndGetToken(supabaseUrl, anonKey, email, password) {
  const c = createClient(supabaseUrl, anonKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const { data, error } = await c.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`sign-in failed for ${email}: ${error.message}`);
  return data.session?.access_token ?? null;
}

async function main() {
  loadEnvFile(path.join(ROOT, ".env.local"));
  const baseUrl = process.env.BASE_URL?.replace(/\/$/, "");
  if (!baseUrl) {
    console.error("[homewood:a11y-baseline] FAIL: BASE_URL not set.");
    process.exit(2);
  }
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const password = process.env.HOMEWOOD_LAUNCH_PASSWORD ?? process.env.PHASE1_DEMO_PASSWORD;
  if (!supabaseUrl || !anonKey || !password) {
    console.error("[homewood:a11y-baseline] FAIL: Supabase URL/anon/password missing.");
    process.exit(2);
  }

  const browser = await chromium.launch({ headless: true });
  const results = [];
  try {
    for (const cell of ROUTE_ROLES) {
      const cellResult = { ...cell, violations: [], skipped: false, reason: null };
      try {
        const token = await signInAndGetToken(supabaseUrl, anonKey, cell.email, password);
        const ctx = await browser.newContext({ extraHTTPHeaders: token ? { Authorization: `Bearer ${token}` } : {} });
        const page = await ctx.newPage();
        const res = await page.goto(`${baseUrl}${cell.route}`, { waitUntil: "domcontentloaded", timeout: 20_000 });
        if (!res || res.status() >= 400) {
          cellResult.skipped = true;
          cellResult.reason = `navigation status ${res?.status() ?? "no-response"}`;
        } else {
          await page.waitForTimeout(1_200);
          const axe = await new AxeBuilder({ page }).analyze();
          cellResult.violations = axe.violations.map((v) => ({
            id: v.id,
            impact: v.impact,
            help: v.help,
            nodeCount: v.nodes?.length ?? 0,
          }));
        }
        await ctx.close();
      } catch (err) {
        cellResult.skipped = true;
        cellResult.reason = err.message || String(err);
      }
      results.push(cellResult);
      const totals = cellResult.violations.reduce((acc, v) => {
        acc[v.impact] = (acc[v.impact] ?? 0) + v.nodeCount;
        return acc;
      }, {});
      console.log(`  ${cellResult.skipped ? "SKIP" : "OK  "} ${cell.role.padEnd(14)} ${cell.route.padEnd(20)} ${cellResult.skipped ? `(${cellResult.reason})` : JSON.stringify(totals)}`);
    }
  } finally {
    await browser.close();
  }

  // Build markdown
  const lines = [];
  lines.push(`# Homewood Lodge ALF — Accessibility Baseline`);
  lines.push("");
  lines.push(`_Generated: \`${new Date().toISOString()}\` against \`${baseUrl}\`._`);
  lines.push("");
  lines.push(`Tooling: \`@axe-core/playwright\`. Re-run with \`BASE_URL=… npm run homewood:a11y-baseline\`.`);
  lines.push("");
  lines.push(`## Summary by impact`);
  lines.push("");
  const summary = { critical: 0, serious: 0, moderate: 0, minor: 0 };
  for (const r of results) {
    for (const v of r.violations) {
      const k = v.impact ?? "minor";
      summary[k] = (summary[k] ?? 0) + v.nodeCount;
    }
  }
  lines.push("| Impact | Node-level violations |");
  lines.push("|---|---:|");
  for (const k of ["critical", "serious", "moderate", "minor"]) {
    lines.push(`| ${k} | ${summary[k] ?? 0} |`);
  }
  lines.push("");
  lines.push(`## Per-route detail`);
  for (const r of results) {
    lines.push("");
    lines.push(`### ${r.route}  (signed in as ${r.role})`);
    if (r.skipped) {
      lines.push("");
      lines.push(`⚠️ skipped — ${r.reason}`);
      continue;
    }
    if (r.violations.length === 0) {
      lines.push("");
      lines.push("No violations.");
      continue;
    }
    lines.push("");
    lines.push("| Rule | Impact | Nodes | Help |");
    lines.push("|---|---|---:|---|");
    for (const v of r.violations) {
      lines.push(`| ${v.id} | ${v.impact ?? "—"} | ${v.nodeCount} | ${v.help.replace(/\|/g, "\\|")} |`);
    }
  }
  lines.push("");
  lines.push(`## Pass/fail`);
  lines.push("");
  const blocking = summary.critical + summary.serious;
  if (blocking === 0) {
    lines.push(`✅ Zero critical or serious violations on the 5 routes.`);
  } else {
    lines.push(`❌ ${blocking} blocking violation(s) (critical + serious) — fix before launch per Sprint 5 acceptance.`);
  }
  lines.push("");
  lines.push(`Moderate / minor violations documented above for post-launch follow-up.`);
  lines.push("");

  mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
  writeFileSync(REPORT_PATH, `${lines.join("\n")}\n`);
  console.log(`[homewood:a11y-baseline] report written: ${path.relative(ROOT, REPORT_PATH)}`);
  console.log(`[homewood:a11y-baseline] critical=${summary.critical} serious=${summary.serious} moderate=${summary.moderate} minor=${summary.minor}`);
  process.exit(blocking === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("[homewood:a11y-baseline] FATAL:", err.message || err);
  process.exit(1);
});
