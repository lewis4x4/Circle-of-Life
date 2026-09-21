#!/usr/bin/env node

import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

const DEFAULT_PROOF = "test-results/ci-release-proof/release-tree-proof.json";
function git(args, cwd = process.cwd()) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
  if (result.status !== 0) throw new Error(result.stderr.trim() || result.error?.message || `git ${args.join(" ")} exited ${result.status}`);
  return result.stdout.trim();
}

function requiredBoolean(value, name) {
  if (value !== "true" && value !== "false") throw new Error(`${name} must be the literal true or false`);
  return value === "true";
}

function requiredString(value, name) {
  if (!value || !String(value).trim()) throw new Error(`${name} is required`);
  return String(value).trim();
}

export function buildProof({ cwd = process.cwd(), env = process.env, now = () => new Date() } = {}) {
  const classification = {
    safe: requiredBoolean(env.CLASSIFICATION_SAFE, "CLASSIFICATION_SAFE"),
    database_sensitive: requiredBoolean(env.DATABASE_SENSITIVE, "DATABASE_SENSITIVE"),
    finance_sensitive: requiredBoolean(env.FINANCE_SENSITIVE, "FINANCE_SENSITIVE"),
    ui_sensitive: requiredBoolean(env.UI_SENSITIVE, "UI_SENSITIVE"),
    release_sensitive: requiredBoolean(env.RELEASE_SENSITIVE, "RELEASE_SENSITIVE"),
    policy_only: requiredBoolean(env.POLICY_ONLY, "POLICY_ONLY"),
  };
  if (env.GITHUB_EVENT_NAME !== "pull_request") throw new Error("release tree proof may only be recorded for a pull_request run");

  const checkedOutCommit = git(["rev-parse", "HEAD^{commit}"], cwd);
  const testedTree = git(["rev-parse", "HEAD^{tree}"], cwd);

  return {
    schema_version: 1,
    kind: "haven-tested-merge-tree",
    created_at: now().toISOString(),
    repository: requiredString(env.GITHUB_REPOSITORY, "GITHUB_REPOSITORY"),
    workflow: requiredString(env.GITHUB_WORKFLOW, "GITHUB_WORKFLOW"),
    run_id: requiredString(env.GITHUB_RUN_ID, "GITHUB_RUN_ID"),
    run_attempt: requiredString(env.GITHUB_RUN_ATTEMPT || "1", "GITHUB_RUN_ATTEMPT"),
    event_name: env.GITHUB_EVENT_NAME,
    pull_request_number: requiredString(env.PR_NUMBER, "PR_NUMBER"),
    base_sha: requiredString(env.PR_BASE_SHA, "PR_BASE_SHA"),
    head_sha: requiredString(env.PR_HEAD_SHA, "PR_HEAD_SHA"),
    checked_out_commit_sha: checkedOutCommit,
    tested_tree_sha: testedTree,
    classification,
  };
}

export function validateProof(proof) {
  if (!proof || proof.schema_version !== 1 || proof.kind !== "haven-tested-merge-tree") throw new Error("unsupported release tree proof");
  for (const field of ["repository", "workflow", "run_id", "pull_request_number", "base_sha", "head_sha", "checked_out_commit_sha", "tested_tree_sha"]) {
    requiredString(proof[field], field);
  }
  if (proof.event_name !== "pull_request") throw new Error("proof was not produced by a pull_request run");
  for (const field of ["safe", "database_sensitive", "finance_sensitive", "ui_sensitive", "release_sensitive", "policy_only"]) {
    if (typeof proof.classification?.[field] !== "boolean") throw new Error(`classification.${field} must be boolean`);
  }
  return proof;
}

export function verifyProof({ proof, revision = "HEAD", cwd = process.cwd() }) {
  validateProof(proof);
  const mergedCommit = git(["rev-parse", `${revision}^{commit}`], cwd);
  const mergedTree = git(["rev-parse", `${revision}^{tree}`], cwd);
  const treeMatches = mergedTree === proof.tested_tree_sha;
  const appOnlyEligible = proof.classification.safe && !proof.classification.release_sensitive;
  const reasons = [];
  if (!treeMatches) reasons.push("merged tree differs from the tree tested by required PR CI");
  if (!proof.classification.safe) reasons.push("change classification was not safe");
  if (proof.classification.release_sensitive) reasons.push("release-sensitive paths require post-merge CI");

  return {
    schema_version: 1,
    proof_run_id: proof.run_id,
    tested_commit_sha: proof.checked_out_commit_sha,
    tested_tree_sha: proof.tested_tree_sha,
    merged_commit_sha: mergedCommit,
    merged_tree_sha: mergedTree,
    tree_matches: treeMatches,
    app_only_eligible: appOnlyEligible,
    post_merge_wait_required: !treeMatches || !appOnlyEligible,
    reasons,
  };
}

function argValue(args, name, fallback) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : fallback;
}

function writeOutput(name, value) {
  const rendered = String(value);
  console.log(`${name}=${rendered}`);
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `${name}=${rendered}\n`);
}

function record(args) {
  const output = path.resolve(argValue(args, "--output", DEFAULT_PROOF));
  const proof = buildProof();
  mkdirSync(path.dirname(output), { recursive: true });
  writeFileSync(output, `${JSON.stringify(proof, null, 2)}\n`);
  writeOutput("proof_path", output);
  writeOutput("tested_tree_sha", proof.tested_tree_sha);
  writeOutput("release_sensitive", proof.classification.release_sensitive);
}

function verify(args) {
  const proofPath = path.resolve(requiredString(argValue(args, "--proof"), "--proof"));
  const revision = argValue(args, "--revision", "HEAD");
  const result = verifyProof({ proof: JSON.parse(readFileSync(proofPath, "utf8")), revision });
  for (const [name, value] of Object.entries(result)) {
    if (!Array.isArray(value)) writeOutput(name, value);
  }
  if (result.reasons.length) console.log(`reasons=${JSON.stringify(result.reasons)}`);
  if (!result.tree_matches) process.exitCode = 1;
}

function main() {
  const [command, ...args] = process.argv.slice(2);
  if (command === "record") return record(args);
  if (command === "verify") return verify(args);
  throw new Error("usage: release-tree-proof.mjs <record|verify> [options]");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
