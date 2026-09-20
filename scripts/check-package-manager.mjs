#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const FORBIDDEN_LOCKFILE_NAMES = new Set([
  "bun.lock",
  "bun.lockb",
  "pnpm-lock.yaml",
  "yarn.lock",
]);

export function findForbiddenPackageManagerLockfiles(trackedFiles) {
  return trackedFiles
    .filter((file) => FORBIDDEN_LOCKFILE_NAMES.has(file.split("/").at(-1)))
    .sort();
}

export function formatFailure(forbiddenLockfiles) {
  return [
    "[check:package-manager] FAIL: Haven supports npm ci with package-lock.json only.",
    "Alternative JavaScript package-manager lockfiles can change Netlify's installer and repeat the COL-479 38-hour production publish outage.",
    "Remove these tracked files:",
    ...forbiddenLockfiles.map((file) => `  - ${file}`),
  ].join("\n");
}

function listTrackedFiles() {
  return execFileSync("git", ["ls-files"], { encoding: "utf8" })
    .split("\n")
    .map((file) => file.trim())
    .filter(Boolean);
}

export function main() {
  let trackedFiles;
  try {
    trackedFiles = listTrackedFiles();
  } catch (error) {
    console.error(
      `[check:package-manager] FAIL: unable to inspect tracked files: ${error instanceof Error ? error.message : String(error)}`,
    );
    return 1;
  }

  const forbiddenLockfiles = findForbiddenPackageManagerLockfiles(trackedFiles);
  if (forbiddenLockfiles.length > 0) {
    console.error(formatFailure(forbiddenLockfiles));
    return 1;
  }

  console.log("[check:package-manager] PASS: package-lock.json is the only JavaScript package-manager lockfile");
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(main());
}
