#!/usr/bin/env node
/**
 * Homewood Lodge ALF — pre-flight checklist (Sprint 6 of Homewood Go-Live).
 *
 * Runs every gate from Sprints 1-5 in order, writes
 * `docs/homewood/GO_LIVE_REPORT.md` with a GO / NO-GO recommendation.
 * Halts on the first failure.
 *
 * Exit codes:
 *   0  all gates passed → GO
 *   1  at least one gate failed → NO-GO (details in the report)
 */
import { execSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";

const ROOT = process.cwd();
const REPORT_PATH = path.join(ROOT, "docs", "homewood", "GO_LIVE_REPORT.md");

const GATES = [
  { name: "typecheck", cmd: "npm run typecheck" },
  { name: "lint", cmd: "npm run lint" },
  { name: "build", cmd: "npm run build" },
  { name: "homewood:audit", cmd: "npm run homewood:audit", postCheck: "audit" },
  { name: "homewood:verify-auth", cmd: "npm run homewood:verify-auth", reasonIfMissing: "HOMEWOOD_LAUNCH_PASSWORD" },
  { name: "homewood:verify-rbac", cmd: "npm run homewood:verify-rbac", reasonIfMissing: "BASE_URL" },
  { name: "homewood:test-launch", cmd: "npm run homewood:test-launch", reasonIfMissing: "BASE_URL" },
  { name: "homewood:perf-baseline", cmd: "npm run homewood:perf-baseline" },
  { name: "homewood:a11y-baseline", cmd: "npm run homewood:a11y-baseline", reasonIfMissing: "BASE_URL" },
];

function runGate(gate) {
  const start = Date.now();
  try {
    const out = execSync(gate.cmd, { encoding: "utf8", stdio: "pipe", cwd: ROOT });
    return { ok: true, durationMs: Date.now() - start, stdoutTail: out.slice(-2000) };
  } catch (err) {
    return {
      ok: false,
      durationMs: Date.now() - start,
      exitCode: err.status ?? 1,
      stderr: (err.stderr?.toString() ?? "").slice(-2000),
      stdoutTail: (err.stdout?.toString() ?? "").slice(-2000),
    };
  }
}

function isPrereqMissing(gate) {
  if (!gate.reasonIfMissing) return false;
  if (gate.reasonIfMissing === "HOMEWOOD_LAUNCH_PASSWORD") return !process.env.HOMEWOOD_LAUNCH_PASSWORD;
  if (gate.reasonIfMissing === "BASE_URL") return !process.env.BASE_URL;
  return false;
}

function auditHasCritical() {
  const auditPath = path.join(ROOT, "docs", "homewood", "DATA_AUDIT.md");
  if (!existsSync(auditPath)) return { found: false, critical: 0 };
  const text = readFileSync(auditPath, "utf8");
  // Severity summary table: "| CRITICAL | <cats> | <rows> |"
  const m = text.match(/^\|\s*CRITICAL\s*\|\s*(\d+)\s*\|\s*(\d+)\s*\|/m);
  if (!m) return { found: false, critical: 0 };
  return { found: true, critical: parseInt(m[1], 10) };
}

function main() {
  const results = [];
  let failed = false;
  for (const gate of GATES) {
    if (isPrereqMissing(gate)) {
      results.push({ gate: gate.name, status: "blocked", detail: `prerequisite env not set: ${gate.reasonIfMissing}`, durationMs: 0 });
      console.log(`[preflight] BLOCKED ${gate.name} (missing ${gate.reasonIfMissing})`);
      continue;
    }
    process.stdout.write(`[preflight] RUN  ${gate.name}\n`);
    const r = runGate(gate);
    if (!r.ok) {
      results.push({ gate: gate.name, status: "fail", exitCode: r.exitCode, detail: (r.stderr || r.stdoutTail).split("\n").slice(-15).join("\n"), durationMs: r.durationMs });
      console.error(`[preflight] FAIL ${gate.name} (exit ${r.exitCode})`);
      failed = true;
      break;
    }
    // Post-check: audit gate explicitly fails on CRITICAL severity rows
    if (gate.postCheck === "audit") {
      const audit = auditHasCritical();
      if (!audit.found || audit.critical > 0) {
        results.push({ gate: gate.name, status: "fail", detail: !audit.found ? "DATA_AUDIT.md is missing or has no parseable severity summary" : `DATA_AUDIT.md surfaces ${audit.critical} CRITICAL anomaly categor${audit.critical === 1 ? "y" : "ies"}`, durationMs: r.durationMs });
        console.error(`[preflight] FAIL ${gate.name} (CRITICAL anomalies = ${audit.critical})`);
        failed = true;
        break;
      }
    }
    results.push({ gate: gate.name, status: "pass", durationMs: r.durationMs });
    console.log(`[preflight] PASS ${gate.name} (${(r.durationMs / 1000).toFixed(1)}s)`);
  }

  const blocked = results.some((result) => result.status === "blocked");
  const goNoGo = failed ? "NO-GO" : blocked ? "BLOCKED" : "GO";
  const lines = [];
  lines.push(`# Homewood Lodge ALF — Go-Live Report`);
  lines.push("");
  lines.push(`_Generated: \`${new Date().toISOString()}\`_`);
  lines.push("");
  lines.push(`## Top line: **${goNoGo}**`);
  lines.push("");
  lines.push(failed
    ? "One or more pre-flight gates failed. The detail below shows which gate, the exit code, and the tail of stderr/stdout. Resolve the failure and re-run \`npm run homewood:preflight\`."
    : blocked ? "Required operational checks could not run. Supply the missing prerequisites and rerun before a launch decision."
    : "Every pre-flight gate passed. The Homewood launch is technically green. See `GO_LIVE_RUNBOOK.md` for the on-the-day procedure.");
  lines.push("");
  lines.push(`## Gate summary`);
  lines.push("");
  lines.push("| Gate | Status | Detail | Last run |");
  lines.push("|---|---|---|---:|");
  for (const r of results) {
    const detail = (r.detail ?? "").split("\n").slice(0, 3).join(" / ").replace(/\|/g, "\\|").slice(0, 200);
    const dur = r.durationMs ? `${(r.durationMs / 1000).toFixed(1)}s` : "—";
    const statusEmoji = r.status === "pass" ? "✅" : r.status === "fail" ? "❌" : "⚠️";
    lines.push(`| ${r.gate} | ${statusEmoji} ${r.status} | ${detail} | ${dur} |`);
  }
  lines.push("");
  lines.push(`## Per-gate detail`);
  for (const r of results) {
    lines.push("");
    lines.push(`### ${r.gate}`);
    lines.push("");
    lines.push(`- **Status:** ${r.status}${r.exitCode !== undefined ? ` (exit ${r.exitCode})` : ""}`);
    if (r.detail) {
      lines.push("");
      lines.push("```");
      lines.push(r.detail);
      lines.push("```");
    }
  }
  lines.push("");
  lines.push(`---`);
  lines.push("");
  lines.push(`_Source: \`scripts/homewood/preflight.mjs\`. Re-run with \`npm run homewood:preflight\`._`);
  lines.push("");

  mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
  writeFileSync(REPORT_PATH, `${lines.join("\n")}\n`);
  console.log(`[preflight] report: ${path.relative(ROOT, REPORT_PATH)}`);
  console.log(`[preflight] ${goNoGo}`);
  process.exit(failed || blocked ? 1 : 0);
}

main();
