import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { classifyPaths, diffFiles, parseNameStatus } from "./classify-changes.mjs";

test("ordinary application code does not request database or finance replay", () => {
  const result = classifyPaths(["src/components/residents/ResidentCard.tsx"]);
  assert.equal(result.databaseSensitive, false);
  assert.equal(result.financeSensitive, false);
});

test("application routes retain the separate UI signal without requesting database replay", () => {
  const result = classifyPaths(["src/app/(admin)/residents/page.tsx"]);
  assert.equal(result.databaseSensitive, false);
  assert.equal(result.uiSensitive, true);
});

test("migration changes request one full database replay and the conservative finance suite", () => {
  const result = classifyPaths(["supabase/migrations/439_example.sql"]);
  assert.equal(result.databaseSensitive, true);
  assert.equal(result.financeSensitive, true);
});

test("database fixtures and care-event parity inputs request the database replay", () => {
  for (const file of [
    "supabase/tests/review_rls.sql",
    "scripts/smart-rounding/watchlist-acceptance.sql",
    "src/lib/care-events/level-cases.json",
  ]) {
    assert.equal(classifyPaths([file]).databaseSensitive, true, file);
  }
});

test("billing code requests finance tests but not a database replay", () => {
  const result = classifyPaths(["src/lib/billing/load-invoices.ts"]);
  assert.equal(result.databaseSensitive, false);
  assert.equal(result.financeSensitive, true);
});

test("every direct finance-suite source requests finance verification", () => {
  for (const file of [
    "src/lib/platform-audit/export-safety.test.ts",
    "src/app/(admin)/admin/cash/page.tsx",
    "src/lib/finance/post-to-gl.test.ts",
    "src/components/finance/FinanceReviewQueueClient.test.tsx",
  ]) {
    assert.equal(classifyPaths([file]).financeSensitive, true, file);
  }
});

test("CI policy changes exercise both risk-sensitive gates", () => {
  const result = classifyPaths([".github/workflows/ci-gates.yml"]);
  assert.equal(result.databaseSensitive, true);
  assert.equal(result.financeSensitive, true);
});

test("unsafe classification fails closed", () => {
  const result = classifyPaths([], { safe: false });
  assert.equal(result.databaseSensitive, true);
  assert.equal(result.financeSensitive, true);
  assert.equal(result.uiSensitive, true);
});

test("NUL-safe status parser preserves both sides of renames and copies", () => {
  assert.deepEqual(
    parseNameStatus("R100\0supabase/migrations/001.sql\0docs/001.sql\0C090\0docs/a.md\0docs/b.md\0D\0supabase/tests/review.sql\0"),
    [
      "supabase/migrations/001.sql",
      "docs/001.sql",
      "docs/a.md",
      "docs/b.md",
      "supabase/tests/review.sql",
    ],
  );
});

test("diff reader keeps migration rename sources during mixed application changes", (t) => {
  const cwd = mkdtempSync(path.join(os.tmpdir(), "haven-ci-classifier-"));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const git = (...args) => {
    const result = spawnSync("git", args, { cwd, encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
  };
  git("init", "-q");
  git("config", "user.name", "Test");
  git("config", "user.email", "test@example.invalid");
  mkdirSync(path.join(cwd, "supabase/migrations"), { recursive: true });
  mkdirSync(path.join(cwd, "supabase/tests"), { recursive: true });
  mkdirSync(path.join(cwd, "docs"), { recursive: true });
  mkdirSync(path.join(cwd, "src/components"), { recursive: true });
  writeFileSync(path.join(cwd, "supabase/migrations/001_base.sql"), "select 1;\n");
  writeFileSync(path.join(cwd, "supabase/tests/review_base.sql"), "select 1;\n");
  writeFileSync(path.join(cwd, "docs/guide.sql"), "select 2;\n");
  writeFileSync(path.join(cwd, "src/components/Card.tsx"), "export const Card = 1;\n");
  git("add", ".");
  git("commit", "-qm", "base");
  const base = git("rev-parse", "HEAD");
  git("mv", "supabase/migrations/001_base.sql", "docs/001_base.sql");
  writeFileSync(path.join(cwd, "src/components/Card.tsx"), "export const Card = 2;\n");
  git("add", ".");
  git("commit", "-qm", "rename migration out and change app");
  const renameOut = git("rev-parse", "HEAD");

  const outResult = diffFiles({ base, head: renameOut, cwd });
  assert.equal(outResult.safe, true);
  assert.ok(outResult.files.includes("supabase/migrations/001_base.sql"));
  assert.ok(outResult.files.includes("docs/001_base.sql"));
  assert.equal(classifyPaths(outResult.files).databaseSensitive, true);

  git("mv", "docs/guide.sql", "supabase/migrations/002_guide.sql");
  git("commit", "-qm", "rename documentation into migrations");
  const renameIn = git("rev-parse", "HEAD");
  const inResult = diffFiles({ base: renameOut, head: renameIn, cwd });
  assert.equal(inResult.safe, true);
  assert.ok(inResult.files.includes("docs/guide.sql"));
  assert.ok(inResult.files.includes("supabase/migrations/002_guide.sql"));
  assert.equal(classifyPaths(inResult.files).databaseSensitive, true);

  git("rm", "supabase/tests/review_base.sql");
  git("commit", "-qm", "delete database test");
  const deleted = git("rev-parse", "HEAD");
  const deleteResult = diffFiles({ base: renameIn, head: deleted, cwd });
  assert.equal(deleteResult.safe, true);
  assert.deepEqual(deleteResult.files, ["supabase/tests/review_base.sql"]);
  assert.equal(classifyPaths(deleteResult.files).databaseSensitive, true);
});

test("missing diff boundaries fail closed instead of reporting an empty safe diff", () => {
  const result = diffFiles({ base: "0000000000000000000000000000000000000000", head: "abc" });
  assert.equal(result.safe, false);
});
