import assert from "node:assert/strict";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { productionProject } from "./check-deploy-schema.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const claims = path.join(root, "scripts/check-migration-claims.mjs");

function fixture(t, { remoteFiles = [], apiFails = false } = {}) {
  const cwd = mkdtempSync(path.join(os.tmpdir(), "haven-gates-test-"));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const git = (...args) => {
    const run = spawnSync("git", args, { cwd, encoding: "utf8" });
    assert.equal(run.status, 0, run.stderr);
  };
  mkdirSync(path.join(cwd, "supabase/migrations"), { recursive: true });
  writeFileSync(path.join(cwd, "supabase/migrations/001_base.sql"), "select 1;\n");
  git("init", "-q");
  git("add", ".");
  git("-c", "user.name=Test", "-c", "user.email=test@example.invalid", "commit", "-qm", "fixture");
  git("update-ref", "refs/remotes/origin/main", "HEAD");
  mkdirSync(path.join(cwd, "bin"));
  writeFileSync(path.join(cwd, "bin/gh"), `#!/usr/bin/env node
const args = process.argv.slice(2);
if (${apiFails}) process.exit(1);
if (args[0] === 'pr' && args[1] === 'view') { console.log('{"number":595}'); }
else if (args[0] === 'pr' && args[1] === 'list') { console.log('[{"number":596,"title":"another migration"}]'); }
else if (args[0] === 'api') { console.log(args.includes('--paginate') ? ${JSON.stringify(remoteFiles.join("\n"))} : ''); }
else process.exit(1);
`, { mode: 0o755 });
  return {
    cwd,
    git,
    run: (...args) => spawnSync(process.execPath, [claims, ...args], {
      cwd, encoding: "utf8",
      env: { ...process.env, PATH: `${path.join(cwd, "bin")}${path.delimiter}${process.env.PATH}`, GITHUB_ACTIONS: "true", GITHUB_BASE_REF: "main", GITHUB_REF: "refs/pull/595/merge" },
    }),
  };
}

test("next migration includes an uncommitted local allocation", (t) => {
  const f = fixture(t);
  writeFileSync(path.join(f.cwd, "supabase/migrations/002_local.sql"), "select 2;\n");
  const result = f.run("--next", "--no-remote");
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /next free migration number: 003/);
});

test("next migration cannot silently ignore unavailable remote claims in CI", (t) => {
  const f = fixture(t, { apiFails: true });
  const result = f.run("--next");
  assert.equal(result.status, 1);
  assert.match(result.stderr, /open PRs were NOT checked/);
});

test("collision checks retrieve paginated PR files instead of a truncated embedded list", (t) => {
  const f = fixture(t, { remoteFiles: ["supabase/migrations/002_remote.sql"] });
  writeFileSync(path.join(f.cwd, "supabase/migrations/002_local.sql"), "select 2;\n");
  const result = f.run();
  assert.equal(result.status, 1);
  assert.match(result.stderr, /002_remote.sql/);
});

test("constitution lint fails when its required subject is absent", (t) => {
  const cwd = mkdtempSync(path.join(os.tmpdir(), "haven-constitution-test-"));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const result = spawnSync(process.execPath, [
    path.join(root, "node_modules/tsx/dist/cli.mjs"), path.join(root, "scripts/lint-constitution.ts"),
  ], { cwd, encoding: "utf8", env: { ...process.env, CONSTITUTION_LINT_SCOPE: "smart-rounding" } });
  assert.equal(result.status, 1, result.stdout);
  assert.match(result.stderr, /missing|required|absent/i);
});

test("segment CI runs core gates regardless of the hosted UI toggle", () => {
  const workflow = readFileSync(path.join(root, ".github/workflows/ci-gates.yml"), "utf8");
  const step = workflow.split("      - name: Segment gates ")[1]?.split("      - ")[0];
  assert.ok(step, "core gate step exists");
  assert.doesNotMatch(step, /if:.*HAVEN_UI_GATES_ENABLED/);
});

test("production publishing checks the actual build database, not an unrelated project", () => {
  assert.equal(productionProject({}), null);
  assert.equal(productionProject({ NETLIFY: "true", CONTEXT: "deploy-preview" }), null);
  const env = { NETLIFY: "true", CONTEXT: "production", NEXT_PUBLIC_SUPABASE_URL: "https://synthetic.supabase.co" };
  assert.equal(productionProject(env), "synthetic");
  assert.throws(() => productionProject({ ...env, SUPABASE_PROJECT_REF: "different" }), /do not match/);
  assert.throws(() => productionProject({ ...env, NEXT_PUBLIC_SUPABASE_URL: "http://localhost:54321" }), /explicit hosted/);
});

test("edge deployment can recover after a schema-gated push", () => {
  const workflow = readFileSync(path.join(root, ".github/workflows/edge-functions-deploy.yml"), "utf8");
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /cron: ["']15 13,23 \* \* \*["']/);
  assert.match(workflow, /full_reconciliation=true/);
  assert.match(workflow, /Verify deployed function inventory/);
  assert.match(workflow, /edge-functions-production-deploy/);
});

test("every deployable edge function declares its gateway JWT policy", () => {
  const functionsRoot = path.join(root, "supabase/functions");
  const source = new Set(
    readdirSync(functionsRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && entry.name !== "_shared")
      .filter((entry) => existsSync(path.join(functionsRoot, entry.name, "index.ts")))
      .map((entry) => entry.name),
  );
  const config = readFileSync(path.join(root, "supabase/config.toml"), "utf8");
  const configured = new Set(
    [...config.matchAll(/^\[functions\.(?:"([^"]+)"|([^\]]+))\]\s*$/gm)]
      .map((match) => (match[1] ?? match[2]).trim()),
  );
  assert.deepEqual([...source].filter((name) => !configured.has(name)).sort(), []);
  assert.deepEqual([...configured].filter((name) => !source.has(name)).sort(), []);
});
