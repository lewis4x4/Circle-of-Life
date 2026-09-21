import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { buildProof, validateProof, verifyProof } from "./release-tree-proof.mjs";

function repositoryFixture(t) {
  const cwd = mkdtempSync(path.join(os.tmpdir(), "haven-release-proof-"));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const git = (...args) => {
    const result = spawnSync("git", args, { cwd, encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
  };
  git("init", "-q");
  git("config", "user.name", "Test");
  git("config", "user.email", "test@example.invalid");
  mkdirSync(path.join(cwd, "src"), { recursive: true });
  writeFileSync(path.join(cwd, "src/Card.tsx"), "export const Card = 1;\n");
  git("add", ".");
  git("commit", "-qm", "tested tree");
  return { cwd, git };
}

function proofEnv(overrides = {}) {
  return {
    GITHUB_EVENT_NAME: "pull_request",
    GITHUB_REPOSITORY: "example/haven",
    GITHUB_WORKFLOW: "CI — segment gates",
    GITHUB_RUN_ID: "12345",
    GITHUB_RUN_ATTEMPT: "1",
    PR_NUMBER: "613",
    PR_BASE_SHA: "a".repeat(40),
    PR_HEAD_SHA: "b".repeat(40),
    CLASSIFICATION_SAFE: "true",
    DATABASE_SENSITIVE: "false",
    FINANCE_SENSITIVE: "false",
    UI_SENSITIVE: "true",
    RELEASE_SENSITIVE: "false",
    POLICY_ONLY: "false",
    ...overrides,
  };
}

test("records the exact checked-out merge tree and classification", (t) => {
  const fixture = repositoryFixture(t);
  const proof = buildProof({ cwd: fixture.cwd, env: proofEnv(), now: () => new Date("2026-09-21T12:00:00Z") });
  assert.equal(proof.tested_tree_sha, fixture.git("rev-parse", "HEAD^{tree}"));
  assert.equal(proof.classification.release_sensitive, false);
  assert.equal(validateProof(proof), proof);
});

test("an identical merged tree permits app-only closeout without waiting", (t) => {
  const fixture = repositoryFixture(t);
  const proof = buildProof({ cwd: fixture.cwd, env: proofEnv() });
  fixture.git("commit", "--allow-empty", "-qm", "merge commit with identical tree");
  const result = verifyProof({ proof, revision: "HEAD", cwd: fixture.cwd });
  assert.equal(result.tree_matches, true);
  assert.equal(result.app_only_eligible, true);
  assert.equal(result.post_merge_wait_required, false);
});

test("a different merged tree fails closed", (t) => {
  const fixture = repositoryFixture(t);
  const proof = buildProof({ cwd: fixture.cwd, env: proofEnv() });
  writeFileSync(path.join(fixture.cwd, "src/Card.tsx"), "export const Card = 2;\n");
  fixture.git("add", ".");
  fixture.git("commit", "-qm", "different merge tree");
  const result = verifyProof({ proof, revision: "HEAD", cwd: fixture.cwd });
  assert.equal(result.tree_matches, false);
  assert.equal(result.post_merge_wait_required, true);
});

test("release-sensitive and unsafe proofs require post-merge CI even when trees match", (t) => {
  const fixture = repositoryFixture(t);
  for (const env of [
    proofEnv({ RELEASE_SENSITIVE: "true" }),
    proofEnv({ CLASSIFICATION_SAFE: "false" }),
  ]) {
    const result = verifyProof({ proof: buildProof({ cwd: fixture.cwd, env }), revision: "HEAD", cwd: fixture.cwd });
    assert.equal(result.tree_matches, true);
    assert.equal(result.post_merge_wait_required, true);
  }
});

test("missing or non-literal classifier output cannot produce proof", (t) => {
  const fixture = repositoryFixture(t);
  assert.throws(() => buildProof({ cwd: fixture.cwd, env: proofEnv({ RELEASE_SENSITIVE: "" }) }), /literal true or false/);
  assert.throws(() => buildProof({ cwd: fixture.cwd, env: proofEnv({ CLASSIFICATION_SAFE: "unknown" }) }), /literal true or false/);
});
