#!/usr/bin/env node
/**
 * Run gitleaks against the repo (binary or Docker). CI requires one of them.
 */

import { execSync, spawnSync } from "node:child_process";
import path from "node:path";
import process from "node:process";

const root = process.cwd();
const GITLEAKS_PROBE_TIMEOUT_MS = 3_000;
const DOCKER_PROBE_TIMEOUT_MS = 5_000;

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
      "zricethezav/gitleaks:v8.21.2",
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

  const r = bin ? runGitleaksBinary() : runGitleaksDocker();
  if (r.status !== 0) {
    console.error("[gitleaks] FAIL: leaks detected or gitleaks error");
    process.exit(r.status ?? 1);
  }
  console.log("[gitleaks] PASS");
  process.exit(0);
}

main();
