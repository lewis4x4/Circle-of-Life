#!/usr/bin/env node
/**
 * Run gitleaks against the repo (binary or Docker). CI requires one of them.
 */

import { execSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";

const root = process.cwd();
const GITLEAKS_PROBE_TIMEOUT_MS = 3_000;
const DOCKER_PROBE_TIMEOUT_MS = 5_000;
// Match the verified native CLI: 8.21.2 treats report-path "-" as a literal
// filename, so it detects the probe but cannot return its JSON on stdout.
const GITLEAKS_DOCKER_IMAGE = "zricethezav/gitleaks:v8.30.1";

function gitHasCommits() {
  try {
    execSync("git rev-parse --verify HEAD", { cwd: root, stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}
const isCi = process.env.CI === "true" || process.env.GITHUB_ACTIONS === "true";
const skip = process.env.SKIP_GITLEAKS === "1";

function probeCommand(cmd, args, timeout) {
  const result = spawnSync(cmd, args, {
    encoding: "utf8",
    stdio: "pipe",
    timeout,
  });
  return {
    ok: !result.error && result.status === 0,
    timedOut: result.error?.code === "ETIMEDOUT",
    error: result.error?.message ?? null,
  };
}

function hasGitleaks() {
  return probeCommand("gitleaks", ["version"], GITLEAKS_PROBE_TIMEOUT_MS).ok;
}

function dockerOk() {
  return probeCommand("docker", ["info"], DOCKER_PROBE_TIMEOUT_MS).ok;
}

function gitleaksArgs() {
  const base = [
    "detect",
    "--source",
    root,
    "--config",
    path.join(root, ".gitleaks.toml"),
    "--redact",
    "100",
    "--exit-code",
    "1",
    "--verbose",
  ];
  if (!gitHasCommits()) {
    base.push("--no-git");
  }
  return base;
}

const GENERIC_API_KEY_PROBE =
  'const apiKey = "zQ7mN2vR8xP4kT9sW6yC3dF5gH1jL0bA";\n';

function detectorProbeArgs(configPath) {
  return [
    "detect",
    "--pipe",
    "--config",
    configPath,
    "--enable-rule",
    "generic-api-key",
    "--report-format",
    "json",
    "--report-path",
    "-",
    "--exit-code",
    "73",
    "--no-banner",
    "--no-color",
  ];
}

function assertGenericApiKeyDetector(useBinary) {
  const result = useBinary
    ? spawnSync(
        "gitleaks",
        detectorProbeArgs(path.join(root, ".gitleaks.toml")),
        { cwd: root, encoding: "utf8", input: GENERIC_API_KEY_PROBE },
      )
    : spawnSync(
        "docker",
        [
          "run",
          "--rm",
          "-i",
          "-v",
          `${root}:/repo`,
          "-w",
          "/repo",
          GITLEAKS_DOCKER_IMAGE,
          ...detectorProbeArgs("/repo/.gitleaks.toml"),
        ],
        { cwd: root, encoding: "utf8", input: GENERIC_API_KEY_PROBE },
      );
  const report = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
  if (result.status !== 73 || !report.includes('"RuleID": "generic-api-key"')) {
    console.error("[gitleaks] FAIL: generic-api-key detector regression probe was not detected");
    process.exit(1);
  }
  console.log("[gitleaks] detector regression PASS: generic-api-key remains active");
}

// An allowlisted `paths` entry is skipped before gitleaks reads the file, so a
// path exemption written to silence one noisy line silently stops scanning
// everything else in that file — `condition = "AND"` does not change it. Scan a
// scratch copy that carries both an exempted slug and a real high-entropy key
// and require the key back.
const ALLOWLIST_PROBE_FILE = path.join("scripts", "insurance", "col497-seed-data.json");
// Reuse the one synthetic credential this file already carries. A second
// literal would be a second high-entropy string in this commit's patch, and
// every rebase would re-fingerprint it into .gitleaksignore — the per-commit
// churn that file's own header warns about. The slug is assembled for the same
// reason: spelled out next to the word "key" it is the very false positive
// this probe exists to characterise.
const ALLOWLIST_PROBE_SLUG = ["cgl", "nsc101045", "plantation"].join("-");
const ALLOWLIST_PROBE_SECRET = GENERIC_API_KEY_PROBE.match(/"([^"]+)"/)[1];
const ALLOWLIST_PROBE_JSON = [
  "{",
  `  "key": "${ALLOWLIST_PROBE_SLUG}",`,
  '  "metricKey": "shiftAssignmentsScheduled14d",',
  `  "api_key": "${ALLOWLIST_PROBE_SECRET}"`,
  "}",
  "",
].join("\n");

function assertAllowlistStillScansExemptedFiles(useBinary) {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "gitleaks-allowlist-"));
  try {
    const target = path.join(scratch, ALLOWLIST_PROBE_FILE);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, ALLOWLIST_PROBE_JSON);
    const report = path.join(scratch, "report.json");
    const args = (source, config, out) => [
      "detect", "--source", source, "--no-git", "--config", config,
      "--report-format", "json", "--report-path", out,
      "--redact", "100", "--no-banner", "--no-color", "--exit-code", "0",
    ];
    const result = useBinary
      ? spawnSync("gitleaks", args(scratch, path.join(root, ".gitleaks.toml"), report), { encoding: "utf8", cwd: scratch })
      : spawnSync("docker", [
          "run", "--rm",
          "-v", `${root}:/repo`, "-v", `${scratch}:/scratch`,
          GITLEAKS_DOCKER_IMAGE,
          ...args("/scratch", "/repo/.gitleaks.toml", "/scratch/report.json"),
        ], { encoding: "utf8" });
    let findings = [];
    try {
      findings = JSON.parse(fs.readFileSync(report, "utf8"));
    } catch {
      console.error(`[gitleaks] FAIL: allowlist probe produced no report (${result.stderr?.trim() ?? "no stderr"})`);
      process.exit(1);
    }
    const rules = findings.map((finding) => finding.RuleID);
    if (!rules.includes("generic-api-key")) {
      console.error(
        `[gitleaks] FAIL: .gitleaks.toml stops scanning ${ALLOWLIST_PROBE_FILE} — a real credential there would go unreported. Allowlist the line shape, not the path.`,
      );
      process.exit(1);
    }
    if (findings.length !== 1) {
      console.error(`[gitleaks] FAIL: allowlist probe expected only the planted key, got ${rules.join(", ")}`);
      process.exit(1);
    }
    console.log("[gitleaks] allowlist PASS: exempted files are still scanned for real credentials");
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
}

function runGitleaksBinary() {
  return spawnSync("gitleaks", gitleaksArgs(), {
    encoding: "utf8",
    stdio: "inherit",
    cwd: root,
  });
}

function runGitleaksDocker() {
  const detectArgs = [
    "detect",
    "--source",
    "/repo",
    "--config",
    "/repo/.gitleaks.toml",
    "--redact",
    "100",
    "--exit-code",
    "1",
    "--verbose",
  ];
  if (!gitHasCommits()) detectArgs.push("--no-git");
  return spawnSync(
    "docker",
    [
      "run",
      "--rm",
      "-v",
      `${root}:/repo`,
      "-w",
      "/repo",
      GITLEAKS_DOCKER_IMAGE,
      ...detectArgs,
    ],
    { encoding: "utf8", stdio: "inherit" },
  );
}

function main() {
  if (skip) {
    if (isCi) {
      console.error("[gitleaks] FAIL: SKIP_GITLEAKS=1 is local-only and may not be used in CI.");
      process.exit(1);
    }
    console.log("[gitleaks] SKIP: SKIP_GITLEAKS=1");
    process.exit(0);
  }

  const bin = hasGitleaks();
  const dock = bin ? false : dockerOk();

  if (!bin && !dock) {
    if (isCi) {
      console.error(
        "[gitleaks] FAIL: CI requires gitleaks (brew install gitleaks) or a working Docker daemon.",
      );
      process.exit(1);
    }
    console.log("[gitleaks] SKIP: install gitleaks or start Docker to enable secret scanning");
    process.exit(0);
  }

  assertGenericApiKeyDetector(bin);
  assertAllowlistStillScansExemptedFiles(bin);

  const r = bin ? runGitleaksBinary() : runGitleaksDocker();
  if (r.status !== 0) {
    console.error("[gitleaks] FAIL: leaks detected or gitleaks error");
    process.exit(r.status ?? 1);
  }
  console.log("[gitleaks] PASS");
  process.exit(0);
}

main();
