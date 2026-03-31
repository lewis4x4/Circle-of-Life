#!/usr/bin/env node
/**
 * Scan git-tracked text files for accidental secret patterns (excluding lockfiles / binaries).
 */

import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const root = process.cwd();

const EXT_ALLOW = new Set([
  ".ts",
  ".tsx",
  ".mjs",
  ".js",
  ".jsx",
  ".json",
  ".md",
  ".sql",
  ".yaml",
  ".yml",
  ".toml",
  ".css",
  ".html",
  ".example",
]);

const PATH_DENY = [
  /^package-lock\.json$/i,
  /^pnpm-lock\.yaml$/i,
  /^yarn\.lock$/i,
  /^test-results\//,
  /^\.next\//,
  /^node_modules\//,
  /^\.git\//,
  /^\.sfdx\//,
  /agent-transcripts/i,
];

function isGitRepo() {
  try {
    execSync("git rev-parse --git-dir", { cwd: root, stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

function listTrackedFiles() {
  const out = execSync("git ls-files", { cwd: root, encoding: "utf8" });
  return out
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
}

function shouldScan(rel) {
  if (PATH_DENY.some((re) => re.test(rel))) return false;
  const ext = path.extname(rel).toLowerCase();
  const base = path.basename(rel);
  if (base.endsWith(".example")) return true;
  if (!EXT_ALLOW.has(ext) && ext !== "") return false;
  if (ext === "" && base === "Dockerfile") return true;
  return true;
}

// Same JWT heuristic as check-env-example; also Stripe-style live keys
const jwtLike =
  /eyJ[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}/;
const stripeLive = /sk_live_[0-9a-zA-Z]{20,}/;
const openaiSk = /sk-[a-zA-Z0-9]{20,}/;

function scanContent(rel, content) {
  const hits = [];
  const isMd = rel.toLowerCase().endsWith(".md");
  // Docs often show JWT-shaped examples; still flag obvious live keys everywhere.
  if (!isMd && jwtLike.test(content)) hits.push("JWT-shaped token (eyJ… … …)");
  if (stripeLive.test(content)) hits.push("Stripe sk_live_*");
  if (openaiSk.test(content)) hits.push("OpenAI-style sk-* key");
  if (hits.length) {
    console.error(`[check:secrets] ${rel}: ${hits.join("; ")}`);
    return false;
  }
  return true;
}

function main() {
  if (!isGitRepo()) {
    console.log("[check:secrets] SKIP: not a git repository");
    process.exit(0);
  }

  let ok = true;
  for (const rel of listTrackedFiles()) {
    if (!shouldScan(rel)) continue;
    const abs = path.join(root, rel);
    if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) continue;
    if (fs.statSync(abs).size > 2_000_000) continue;
    let buf;
    try {
      buf = fs.readFileSync(abs);
    } catch {
      continue;
    }
    if (buf.includes(0)) continue;
    const content = buf.toString("utf8");
    if (!scanContent(rel, content)) ok = false;
  }

  if (!ok) {
    console.error("[check:secrets] FAIL: remove or redact secrets; use env vars / placeholders.");
    process.exit(1);
  }
  console.log("[check:secrets] PASS");
  process.exit(0);
}

main();
