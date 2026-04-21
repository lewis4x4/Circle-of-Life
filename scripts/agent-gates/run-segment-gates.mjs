#!/usr/bin/env node
/**
 * Deterministic segment gate runner. Writes JSON to test-results/agent-gates/.
 *
 * Usage:
 *   node scripts/agent-gates/run-segment-gates.mjs --segment "<id>" [--ui] [--no-chaos] [--no-a11y] [--design-advisory] [--advisory-check "<id>"]
 *
 * npm:
 *   npm run segment:gates -- --segment "seg-001" --ui
 *
 * Env:
 *   FAIL_ON_NEXT_DEPRECATIONS=1 — fail if Next build stderr contains middleware→proxy deprecation
 *   REQUIRE_PG_VERIFY=1 — in CI, fail if Docker Postgres migration verify cannot run
 *   SKIP_GITLEAKS=1 — skip gitleaks (local only; CI still requires gitleaks or Docker)
 *   SEGMENT_GATES_USE_DEV_SERVER=1 — with --ui, use existing BASE_URL dev server instead of spawning `next start`
 *   SEGMENT_PREVIEW_PORT — port for auto-started preview server (default 4310)
 */

import { execSync, spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import process from "node:process";

const root = process.cwd();
const HEARTBEAT_MS = 30_000;

// Module-level reference so signal handlers can reach the preview child even
// if the `if (args.ui)` try/finally block never runs (SIGINT, SIGTERM, crash).
let activePreviewChild = null;

function cleanupPreviewChild() {
  if (activePreviewChild && !activePreviewChild.killed) {
    try {
      activePreviewChild.kill("SIGTERM");
    } catch {
      /* child already gone */
    }
    activePreviewChild = null;
  }
}

process.on("SIGINT", () => {
  cleanupPreviewChild();
  process.exit(130);
});
process.on("SIGTERM", () => {
  cleanupPreviewChild();
  process.exit(143);
});
process.on("exit", cleanupPreviewChild);
process.on("uncaughtException", (err) => {
  cleanupPreviewChild();
  console.error(err);
  process.exit(1);
});

/** Returns true if something is currently LISTENing on 127.0.0.1:<port>. */
function probePortInUse(port) {
  return new Promise((resolve) => {
    const sock = new net.Socket();
    let settled = false;
    const done = (val) => {
      if (settled) return;
      settled = true;
      sock.destroy();
      resolve(val);
    };
    sock.setTimeout(500);
    sock.once("connect", () => done(true));
    sock.once("error", () => done(false));
    sock.once("timeout", () => done(false));
    sock.connect(port, "127.0.0.1");
  });
}

/** Returns true if <url> responds with a 2xx/3xx/4xx inside 3s (i.e., HTTP is alive). */
async function isHttpAlive(url) {
  try {
    const res = await fetch(url, {
      redirect: "manual",
      signal: AbortSignal.timeout(3000),
    });
    return res.status >= 200 && res.status < 500;
  } catch {
    return false;
  }
}

/**
 * Kills any process holding a LISTEN socket on <port>. Returns the count of
 * pids signaled. Best-effort: swallows errors if lsof is missing or no holder.
 */
function killHolderOnPort(port) {
  try {
    const out = execSync(`lsof -ti :${port} -sTCP:LISTEN`, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    if (!out) return 0;
    const pids = out
      .split("\n")
      .map((s) => Number(s))
      .filter((n) => Number.isFinite(n));
    for (const pid of pids) {
      try {
        process.kill(pid, "SIGTERM");
      } catch {
        /* already gone */
      }
    }
    return pids.length;
  } catch {
    return 0;
  }
}

function parseArgs(argv) {
  const out = {
    segment: null,
    ui: false,
    noChaos: false,
    noA11y: false,
    designAdvisory: false,
    advisoryChecks: [],
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
    } else if (a === "--advisory-check" && argv[i + 1]) {
      out.advisoryChecks.push(argv[++i]);
    }
  }
  return out;
}

function nowIso() {
  return new Date().toISOString();
}

function logCheck(checkId, message) {
  console.log(`[segment:gates][${checkId}] ${message}`);
}

function createPrefixedLineForwarder(checkId, streamName, sink) {
  const prefix = `[segment:gates][${checkId}][${streamName}]`;
  let buffer = "";

  return {
    push(chunk) {
      buffer += chunk;
      let newlineIndex = buffer.indexOf("\n");
      while (newlineIndex !== -1) {
        const line = buffer.slice(0, newlineIndex);
        sink.write(`${prefix} ${line}\n`);
        buffer = buffer.slice(newlineIndex + 1);
        newlineIndex = buffer.indexOf("\n");
      }
    },
    flush() {
      if (buffer.length > 0) {
        sink.write(`${prefix} ${buffer}\n`);
        buffer = "";
      }
    },
  };
}

function run(cmd, args, opts = {}) {
  return new Promise((resolve) => {
    const start = Date.now();
    const label = opts.label ?? "command";
    const stream = opts.stream ?? true;
    const heartbeatMs = opts.heartbeatMs ?? HEARTBEAT_MS;
    const commandText = opts.commandText ?? [cmd, ...args].join(" ");
    const child = spawn(cmd, args, {
      cwd: opts.cwd ?? root,
      shell: false,
      env: { ...process.env, ...opts.env },
    });
    let stdout = "";
    let stderr = "";
    let lastOutputAt = start;
    let lastHeartbeatAt = start;
    let settled = false;

    const stdoutForwarder = createPrefixedLineForwarder(label, "stdout", process.stdout);
    const stderrForwarder = createPrefixedLineForwarder(label, "stderr", process.stderr);

    const heartbeat = setInterval(() => {
      if (!stream) return;
      const now = Date.now();
      if (
        now - lastOutputAt >= heartbeatMs &&
        now - lastHeartbeatAt >= heartbeatMs
      ) {
        logCheck(
          label,
          `still running elapsed_ms=${now - start} command="${commandText}"`,
        );
        lastHeartbeatAt = now;
      }
    }, 1_000);

    child.stdout?.on("data", (d) => {
      const text = d.toString();
      stdout += text;
      lastOutputAt = Date.now();
      if (stream) stdoutForwarder.push(text);
    });
    child.stderr?.on("data", (d) => {
      const text = d.toString();
      stderr += text;
      lastOutputAt = Date.now();
      if (stream) stderrForwarder.push(text);
    });

    const finalize = (payload) => {
      if (settled) return;
      settled = true;
      clearInterval(heartbeat);
      if (stream) {
        stdoutForwarder.flush();
        stderrForwarder.flush();
      }
      resolve(payload);
    };

    child.on("close", (code, signal) => {
      finalize({
        code: code ?? 1,
        signal: signal ?? null,
        duration_ms: Date.now() - start,
        stdout,
        stderr,
      });
    });
    child.on("error", (err) => {
      finalize({
        code: 1,
        signal: null,
        duration_ms: Date.now() - start,
        stdout,
        stderr: `${stderr}\n${err.message}`,
      });
    });
  });
}

async function npmRun(script, cwd = root, opts = {}) {
  const npmCmd = process.platform === "win32" ? "npm.cmd" : "npm";
  return run(npmCmd, ["run", script, "--silent"], {
    cwd,
    commandText: `npm run ${script}`,
    ...opts,
  });
}

async function waitForHttpOk(url, timeoutMs) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url, { redirect: "manual" });
      if (res.status >= 200 && res.status < 500) return;
    } catch {
      /* retry */
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`[segment:gates] preview server did not respond in time: ${url}`);
}

async function nodeRun(relScript, opts = {}) {
  return run(process.execPath, [path.join(root, relScript)], {
    cwd: root,
    commandText: `node ${relScript}`,
    ...opts,
  });
}

function webAppExists() {
  return fs.existsSync(path.join(root, "apps", "web", "package.json"));
}

function applyAdvisoryOverride(check, advisoryCheckIds) {
  if (check.status !== "failed" || !advisoryCheckIds.has(check.id)) {
    return check;
  }
  return {
    ...check,
    status: "advisory",
    advisory_override: true,
    advisory_reason: `Downgraded by --advisory-check ${check.id}`,
  };
}

function finishCheck(check) {
  const parts = [`status=${check.status}`, `required=${check.required}`];
  if (typeof check.duration_ms === "number") {
    parts.push(`duration_ms=${check.duration_ms}`);
  }
  if (check.advisory_override) {
    parts.push("advisory_override=true");
  }
  logCheck(check.id, `finish ${parts.join(" ")}`);
}

function recordCheck(checks, advisoryCheckIds, check) {
  const finalCheck = applyAdvisoryOverride(check, advisoryCheckIds);
  finishCheck(finalCheck);
  checks.push(finalCheck);
  return finalCheck;
}

async function executeCommandCheck(checks, advisoryCheckIds, options) {
  logCheck(options.id, `start ${options.command}`);
  const result = await options.invoke();
  const baseCheck = options.mapResult
    ? options.mapResult(result)
    : {
        status: result.code === 0 ? "passed" : "failed",
        duration_ms: result.duration_ms,
        stdout: result.stdout,
        stderr: result.stderr,
      };

  return recordCheck(checks, advisoryCheckIds, {
    id: options.id,
    required: options.required ?? true,
    command: options.command,
    ...baseCheck,
  });
}

function executeStaticCheck(checks, advisoryCheckIds, check) {
  logCheck(check.id, `start ${check.command}`);
  return recordCheck(checks, advisoryCheckIds, check);
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
  const advisoryCheckIds = new Set(args.advisoryChecks);

  // --- Hygiene & security (automated) ---
  await executeCommandCheck(checks, advisoryCheckIds, {
    id: "hygiene.env-example",
    command: "node scripts/check-env-example.mjs",
    invoke: () =>
      nodeRun("scripts/check-env-example.mjs", { label: "hygiene.env-example" }),
  });

  await executeCommandCheck(checks, advisoryCheckIds, {
    id: "hygiene.tracked-secrets-scan",
    command: "node scripts/check-tracked-secrets.mjs",
    invoke: () =>
      nodeRun("scripts/check-tracked-secrets.mjs", {
        label: "hygiene.tracked-secrets-scan",
      }),
  });

  await executeCommandCheck(checks, advisoryCheckIds, {
    id: "hygiene.npm-audit",
    command: "npm run audit:ci",
    invoke: () => npmRun("audit:ci", root, { label: "hygiene.npm-audit" }),
  });

  await executeCommandCheck(checks, advisoryCheckIds, {
    id: "security.gitleaks",
    command: "npm run secrets:gitleaks",
    invoke: () => npmRun("secrets:gitleaks", root, { label: "security.gitleaks" }),
    mapResult: (result) => {
      const combinedOutput = `${result.stdout}\n${result.stderr}`;
      const skipped = /^\[gitleaks\] SKIP:/m.test(combinedOutput);
      return {
        required: !skipped,
        status: skipped ? "skipped" : result.code === 0 ? "passed" : "failed",
        duration_ms: result.duration_ms,
        stdout: result.stdout,
        stderr: result.stderr,
      };
    },
  });

  await executeCommandCheck(checks, advisoryCheckIds, {
    id: "qa.eslint",
    command: "npm run lint",
    invoke: () => npmRun("lint", root, { label: "qa.eslint" }),
  });

  await executeCommandCheck(checks, advisoryCheckIds, {
    id: "qa.migration-sequence",
    command: "npm run migrations:check",
    invoke: () =>
      npmRun("migrations:check", root, { label: "qa.migration-sequence" }),
  });

  const requirePgVerify = process.env.REQUIRE_PG_VERIFY === "1";
  await executeCommandCheck(checks, advisoryCheckIds, {
    id: "qa.migrations-apply-postgres",
    required: requirePgVerify,
    command: "npm run migrations:verify:pg",
    invoke: () =>
      npmRun("migrations:verify:pg", root, {
        label: "qa.migrations-apply-postgres",
      }),
  });

  const build = await executeCommandCheck(checks, advisoryCheckIds, {
    id: "qa.root-build",
    command: "npm run build",
    invoke: () => npmRun("build", root, { label: "qa.root-build" }),
  });

  const failOnNext = process.env.FAIL_ON_NEXT_DEPRECATIONS === "1";
  const combinedBuildErr = `${build.stderr}\n${build.stdout}`;
  const nextSignal =
    /middleware-to-proxy|middleware file convention is deprecated/i.test(combinedBuildErr);
  executeStaticCheck(checks, advisoryCheckIds, {
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
    await executeCommandCheck(checks, advisoryCheckIds, {
      id: "qa.web-build",
      command: "npm run build (apps/web)",
      invoke: () => npmRun("build", webRoot, { label: "qa.web-build" }),
    });
  } else {
    executeStaticCheck(checks, advisoryCheckIds, {
      id: "qa.web-build",
      required: false,
      status: "skipped",
      command: "npm run build (apps/web)",
      stdout: "apps/web/package.json not found",
    });
  }

  if (args.noChaos) {
    executeStaticCheck(checks, advisoryCheckIds, {
      id: "chaos.stress-suite",
      required: false,
      status: "skipped",
      command: "npm run stress:test",
      stdout: "skipped (--no-chaos)",
    });
  } else {
    await executeCommandCheck(checks, advisoryCheckIds, {
      id: "chaos.stress-suite",
      command: "npm run stress:test",
      invoke: () => npmRun("stress:test", root, { label: "chaos.stress-suite" }),
    });
  }

  if (args.ui) {
    let previewChild = null;
    const useDevServer = process.env.SEGMENT_GATES_USE_DEV_SERVER === "1";

    try {
      if (!useDevServer) {
        const previewPort = process.env.SEGMENT_PREVIEW_PORT ?? "4310";
        const previewPortNum = Number(previewPort);
        const previewUrl = `http://127.0.0.1:${previewPort}/`;

        // Port pre-flight: if something is already bound, probe its health.
        // If it's responding, reuse it (don't spawn, don't kill). If it's a
        // dead squatter (bound but no HTTP response), kill it and spawn fresh.
        if (await probePortInUse(previewPortNum)) {
          if (await isHttpAlive(previewUrl)) {
            console.log(
              `[segment:gates] reusing existing preview server on :${previewPort}`,
            );
            process.env.BASE_URL = `http://127.0.0.1:${previewPort}`;
          } else {
            const killed = killHolderOnPort(previewPortNum);
            console.log(
              `[segment:gates] port :${previewPort} was held by ${killed} orphan pid(s); signaled SIGTERM`,
            );
            // Give the OS a moment to release the socket before we bind.
            await new Promise((r) => setTimeout(r, 1500));
          }
        }

        // Spawn fresh only if we didn't successfully reuse an existing server.
        if (process.env.BASE_URL !== `http://127.0.0.1:${previewPort}`) {
          const nextCli = path.join(root, "node_modules", "next", "dist", "bin", "next");
          previewChild = spawn(
            process.execPath,
            [nextCli, "start", "-p", previewPort],
            {
              cwd: root,
              env: { ...process.env, PORT: previewPort },
              stdio: "ignore",
            },
          );
          activePreviewChild = previewChild;
          await waitForHttpOk(previewUrl, 60_000);
          process.env.BASE_URL = `http://127.0.0.1:${previewPort}`;
        }
      }

      await executeCommandCheck(checks, advisoryCheckIds, {
        id: "cdo.design-review",
        command: "npm run design:review",
        required: !args.designAdvisory,
        invoke: () => npmRun("design:review", root, { label: "cdo.design-review" }),
        mapResult: (result) => ({
          status:
            result.code === 0
              ? "passed"
              : args.designAdvisory
                ? "advisory"
                : "failed",
          duration_ms: result.duration_ms,
          stdout: result.stdout,
          stderr: result.stderr,
          artifacts: [path.join(root, "test-results", "design-review", "report.json")],
        }),
      });

      if (!args.noA11y) {
        await executeCommandCheck(checks, advisoryCheckIds, {
          id: "cdo.a11y-axe",
          command: "npm run a11y:routes",
          required: true,
          invoke: () => npmRun("a11y:routes", root, { label: "cdo.a11y-axe" }),
        });
      } else {
        executeStaticCheck(checks, advisoryCheckIds, {
          id: "cdo.a11y-axe",
          required: false,
          status: "skipped",
          command: "npm run a11y:routes",
          stdout: "skipped (--no-a11y)",
        });
      }
    } finally {
      if (previewChild) {
        previewChild.kill("SIGTERM");
        activePreviewChild = null;
        await new Promise((r) => setTimeout(r, 400));
      }
    }
  } else {
    executeStaticCheck(checks, advisoryCheckIds, {
      id: "cdo.design-review",
      required: false,
      status: "skipped",
      command: "npm run design:review",
      stdout: "skipped (pass --ui to enable)",
    });
    executeStaticCheck(checks, advisoryCheckIds, {
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
