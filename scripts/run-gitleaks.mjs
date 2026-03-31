#!/usr/bin/env node
/**
 * Run gitleaks against the repo (binary or Docker). CI requires one of them.
 */

import { execSync, spawnSync } from "node:child_process";
import path from "node:path";
import process from "node:process";

const root = process.cwd();

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

function hasGitleaks() {
  const r = spawnSync("gitleaks", ["version"], { encoding: "utf8" });
  return !r.error && r.status === 0;
}

function dockerOk() {
  const r = spawnSync("docker", ["info"], { encoding: "utf8", stdio: "pipe" });
  return r.status === 0;
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
    console.log("[gitleaks] SKIP: SKIP_GITLEAKS=1");
    process.exit(0);
  }

  const bin = hasGitleaks();
  const dock = dockerOk();

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
