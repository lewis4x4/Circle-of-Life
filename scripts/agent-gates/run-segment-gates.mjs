#!/usr/bin/env node
/**
 * Deterministic segment gate runner. Writes JSON to test-results/agent-gates/.
 *
 * Usage:
 *   node scripts/agent-gates/run-segment-gates.mjs --segment "<id>" [--ui] [--no-chaos] [--no-a11y] [--design-advisory]
 *
 * npm:
 *   npm run segment:gates -- --segment "seg-001" --ui
 *
 * Env:
 *   FAIL_ON_NEXT_DEPRECATIONS=1 — fail if Next build stderr contains middleware→proxy deprecation
 *   REQUIRE_PG_VERIFY=1 — in CI, fail if Docker Postgres migration verify cannot run
 *   SKIP_GITLEAKS=1 — skip gitleaks (local only; CI still requires gitleaks or Docker)
 */

import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const root = process.cwd();

function parseArgs(argv) {
  const out = {
    segment: null,
    ui: false,
    noChaos: false,
    noA11y: false,
    designAdvisory: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--segment" && argv[i + 1]) {
      out.segment = argv[++i];
    } else if (a === "--ui") {
      out.ui = true;
    } else if (a === "--no-chaos") {
      out.noChaos = true;
    } else if (a === "--no-a11y") {
      out.noA11y = true;
    } else if (a === "--design-advisory") {
      out.designAdvisory = true;
    }
  }
  return out;
}

function nowIso() {
  return new Date().toISOString();
}

function run(cmd, args, opts = {}) {
  return new Promise((resolve) => {
    const start = Date.now();
    const child = spawn(cmd, args, {
      cwd: opts.cwd ?? root,
      shell: false,
      env: { ...process.env, ...opts.env },
    });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (d) => {
      stdout += d.toString();
    });
    child.stderr?.on("data", (d) => {
      stderr += d.toString();
    });
    child.on("close", (code) => {
      resolve({
        code: code ?? 1,
        duration_ms: Date.now() - start,
        stdout,
        stderr,
      });
    });
    child.on("error", (err) => {
      resolve({
        code: 1,
        duration_ms: Date.now() - start,
        stdout,
        stderr: `${stderr}\n${err.message}`,
      });
    });
  });
}

async function npmRun(script, cwd = root) {
  const npmCmd = process.platform === "win32" ? "npm.cmd" : "npm";
  return run(npmCmd, ["run", script, "--silent"], { cwd });
}

async function nodeRun(relScript) {
  return run(process.execPath, [path.join(root, relScript)], { cwd: root });
}

function webAppExists() {
  return fs.existsSync(path.join(root, "apps", "web", "package.json"));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.segment) {
    console.error('Missing required --segment "<id>"');
    process.exit(1);
  }

  const outDir = path.join(root, "test-results", "agent-gates");
  fs.mkdirSync(outDir, { recursive: true });

  const report = {
    segment: args.segment,
    timestamp: nowIso(),
    verdict: "PASS",
    checks: [],
    summary: { passed: 0, failed: 0, skipped: 0, blocking_failures: [] },
    artifacts: [],
  };

  const checks = [];

  // --- Hygiene & security (automated) ---
  const envEx = await nodeRun("scripts/check-env-example.mjs");
  checks.push({
    id: "hygiene.env-example",
    required: true,
    status: envEx.code === 0 ? "passed" : "failed",
    command: "node scripts/check-env-example.mjs",
    duration_ms: envEx.duration_ms,
    stdout: envEx.stdout,
    stderr: envEx.stderr,
  });

  const sec = await nodeRun("scripts/check-tracked-secrets.mjs");
  checks.push({
    id: "hygiene.tracked-secrets-scan",
    required: true,
    status: sec.code === 0 ? "passed" : "failed",
    command: "node scripts/check-tracked-secrets.mjs",
    duration_ms: sec.duration_ms,
    stdout: sec.stdout,
    stderr: sec.stderr,
  });

  const audit = await npmRun("audit:ci");
  checks.push({
    id: "hygiene.npm-audit",
    required: true,
    status: audit.code === 0 ? "passed" : "failed",
    command: "npm run audit:ci",
    duration_ms: audit.duration_ms,
    stdout: audit.stdout,
    stderr: audit.stderr,
  });

  const gitleaks = await npmRun("secrets:gitleaks");
  checks.push({
    id: "security.gitleaks",
    required: true,
    status: gitleaks.code === 0 ? "passed" : "failed",
    command: "npm run secrets:gitleaks",
    duration_ms: gitleaks.duration_ms,
    stdout: gitleaks.stdout,
    stderr: gitleaks.stderr,
  });

  const lint = await npmRun("lint");
  checks.push({
    id: "qa.eslint",
    required: true,
    status: lint.code === 0 ? "passed" : "failed",
    command: "npm run lint",
    duration_ms: lint.duration_ms,
    stdout: lint.stdout,
    stderr: lint.stderr,
  });

  const mig = await npmRun("migrations:check");
  checks.push({
    id: "qa.migration-sequence",
    required: true,
    status: mig.code === 0 ? "passed" : "failed",
    command: "npm run migrations:check",
    duration_ms: mig.duration_ms,
    stdout: mig.stdout,
    stderr: mig.stderr,
  });

  const requirePgVerify = process.env.REQUIRE_PG_VERIFY === "1";
  const pgVerify = await npmRun("migrations:verify:pg");
  checks.push({
    id: "qa.migrations-apply-postgres",
    required: requirePgVerify,
    status: pgVerify.code === 0 ? "passed" : "failed",
    command: "npm run migrations:verify:pg",
    duration_ms: pgVerify.duration_ms,
    stdout: pgVerify.stdout,
    stderr: pgVerify.stderr,
  });

  const build = await npmRun("build");
  checks.push({
    id: "qa.root-build",
    required: true,
    status: build.code === 0 ? "passed" : "failed",
    command: "npm run build",
    duration_ms: build.duration_ms,
    stdout: build.stdout,
    stderr: build.stderr,
  });

  const failOnNext = process.env.FAIL_ON_NEXT_DEPRECATIONS === "1";
  const combinedBuildErr = `${build.stderr}\n${build.stdout}`;
  const nextSignal =
    /middleware-to-proxy|middleware file convention is deprecated/i.test(combinedBuildErr);
  checks.push({
    id: "hygiene.nextjs-deprecation-signal",
    required: failOnNext,
    status: nextSignal ? (failOnNext ? "failed" : "advisory") : "passed",
    command: "(derived from npm run build output)",
    stdout: nextSignal
      ? "Next.js middleware deprecation warning detected — plan migration to proxy API (set FAIL_ON_NEXT_DEPRECATIONS=1 to hard-fail)."
      : "No tracked Next.js middleware deprecation signal in build output.",
  });

  if (webAppExists()) {
    const webRoot = path.join(root, "apps", "web");
    const webBuild = await npmRun("build", webRoot);
    checks.push({
      id: "qa.web-build",
      required: true,
      status: webBuild.code === 0 ? "passed" : "failed",
      command: "npm run build (apps/web)",
      duration_ms: webBuild.duration_ms,
      stdout: webBuild.stdout,
      stderr: webBuild.stderr,
    });
  } else {
    checks.push({
      id: "qa.web-build",
      required: false,
      status: "skipped",
      command: "npm run build (apps/web)",
      stdout: "apps/web/package.json not found",
    });
  }

  if (args.noChaos) {
    checks.push({
      id: "chaos.stress-suite",
      required: false,
      status: "skipped",
      command: "npm run stress:test",
      stdout: "skipped (--no-chaos)",
    });
  } else {
    const stress = await npmRun("stress:test");
    checks.push({
      id: "chaos.stress-suite",
      required: true,
      status: stress.code === 0 ? "passed" : "failed",
      command: "npm run stress:test",
      duration_ms: stress.duration_ms,
      stdout: stress.stdout,
      stderr: stress.stderr,
    });
  }

  if (args.ui) {
    const design = await npmRun("design:review");
    const required = !args.designAdvisory;
    const ok = design.code === 0;
    let status = "passed";
    if (!ok) {
      status = args.designAdvisory ? "advisory" : "failed";
    }
    checks.push({
      id: "cdo.design-review",
      required,
      status,
      command: "npm run design:review",
      duration_ms: design.duration_ms,
      stdout: design.stdout,
      stderr: design.stderr,
      artifacts: [path.join(root, "test-results", "design-review", "report.json")],
    });

    if (!args.noA11y) {
      const a11y = await npmRun("a11y:routes");
      checks.push({
        id: "cdo.a11y-axe",
        required,
        status: a11y.code === 0 ? "passed" : "failed",
        command: "npm run a11y:routes",
        duration_ms: a11y.duration_ms,
        stdout: a11y.stdout,
        stderr: a11y.stderr,
      });
    } else {
      checks.push({
        id: "cdo.a11y-axe",
        required: false,
        status: "skipped",
        command: "npm run a11y:routes",
        stdout: "skipped (--no-a11y)",
      });
    }
  } else {
    checks.push({
      id: "cdo.design-review",
      required: false,
      status: "skipped",
      command: "npm run design:review",
      stdout: "skipped (pass --ui to enable)",
    });
    checks.push({
      id: "cdo.a11y-axe",
      required: false,
      status: "skipped",
      command: "npm run a11y:routes",
      stdout: "skipped (pass --ui to enable; omit --no-a11y)",
    });
  }

  report.checks = checks;

  for (const c of checks) {
    if (c.status === "passed") report.summary.passed += 1;
    else if (c.status === "failed") report.summary.failed += 1;
    else if (c.status === "skipped" || c.status === "advisory")
      report.summary.skipped += 1;
  }

  for (const c of checks) {
    if (c.required && c.status === "failed") {
      report.summary.blocking_failures.push(c.id);
    }
  }

  report.verdict = report.summary.blocking_failures.length > 0 ? "FAIL" : "PASS";

  const safeSeg = args.segment.replace(/[^a-zA-Z0-9._-]+/g, "-");
  const fileName = `${report.timestamp.replace(/[:.]/g, "-")}-${safeSeg}.json`;
  const outPath = path.join(outDir, fileName);
  report.artifacts = [outPath];
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2), "utf8");

  console.log(`\n[segment:gates] verdict=${report.verdict} artifact=${outPath}\n`);

  process.exit(report.verdict === "PASS" ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
