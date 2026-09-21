import assert from "node:assert/strict";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { productionProject } from "./check-deploy-schema.mjs";
import { ledgerExitCode, reconcile } from "./check-migration-ledger.mjs";

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

test("segment CI installs the checksum-verified scanner instead of relying on Docker luck", () => {
  const workflow = readFileSync(path.join(root, ".github/workflows/ci-gates.yml"), "utf8");
  const install = workflow.split("      - name: Install verified Gitleaks binary")[1]?.split("      - name:")[0];
  assert.ok(install, "verified Gitleaks install exists");
  assert.match(install, /gitleaks\/releases\/download\/v8\.30\.1/);
  assert.match(install, /551f6fc83ea457d62a0d98237cbad105af8d557003051f41f3e7ca7b3f2470eb/);
  assert.match(install, /sha256sum --check --strict/);
  assert.match(install, /GITHUB_PATH/);
});

test("policy-only changes skip unrelated application, database, domain, stress, and browser suites", () => {
  const workflow = readFileSync(path.join(root, ".github/workflows/ci-gates.yml"), "utf8");
  assert.match(workflow, /policy_only: \$\{\{ steps\.risk\.outputs\.policy_only \}\}/);
  assert.match(workflow, /name: Policy hygiene and secret scan/);
  assert.match(workflow, /if: needs\.classify\.outputs\.policy_only == 'true'/);
  for (const name of [
    "TypeScript and application tests",
    "Smart Rounding Edge Function tests",
    "Stand Up regression contracts",
    "Migrations can apply to a hosted project",
    "Segment gates (security, lint, migrations, build, stress)",
    "Install Playwright Chromium",
    "Smart Rounding component browser regressions",
  ]) {
    const step = workflow.split(`      - name: ${name}`)[1]?.split("      - ")[0];
    assert.ok(step, `${name} exists`);
    assert.match(step, /if: needs\.classify\.outputs\.policy_only != 'true'/, name);
  }
});

test("segment CI has one path-sensitive database replay owner", () => {
  const workflow = readFileSync(path.join(root, ".github/workflows/ci-gates.yml"), "utf8");
  assert.doesNotMatch(workflow, /run: npm run migrations:verify:pg/);
  const segment = workflow.split("      - name: Segment gates ")[1]?.split("      - ")[0];
  assert.ok(segment, "core segment gate exists");
  assert.match(segment, /REQUIRE_PG_VERIFY:.*database_sensitive != 'false'/);
  assert.match(segment, /SKIP_PG_VERIFY:.*database_sensitive == 'false'/);
});

test("UI reruns cannot accidentally start another database replay", () => {
  const workflow = readFileSync(path.join(root, ".github/workflows/ci-gates.yml"), "utf8");
  const ui = workflow.split("      - name: UI gates (conditional)")[1]?.split("      - ")[0];
  assert.ok(ui, "conditional UI gate exists");
  assert.match(ui, /SKIP_PG_VERIFY: "1"/);
});

test("finance checks are conditional and no longer invoke the general segment suite", () => {
  const workflow = readFileSync(path.join(root, ".github/workflows/ci-gates.yml"), "utf8");
  const finance = workflow.split("  finance:\n")[1]?.split("  required:\n")[0];
  assert.ok(finance, "finance job exists");
  assert.match(finance, /finance_sensitive != 'false'/);
  assert.doesNotMatch(finance, /segment:gates|migrations:verify:pg|npm test|typecheck/);
  assert.equal(existsSync(path.join(root, ".github/workflows/finance-integration.yml")), false);
});

test("CI exposes an always-present required summary and retains nightly database replay", () => {
  const workflow = readFileSync(path.join(root, ".github/workflows/ci-gates.yml"), "utf8");
  assert.match(workflow, /name: Required CI summary/);
  assert.match(workflow, /if: always\(\)/);
  assert.match(workflow, /cancel-in-progress: true/);

  const nightly = readFileSync(path.join(root, ".github/workflows/ci-nightly.yml"), "utf8");
  assert.match(nightly, /REQUIRE_PG_VERIFY: "1"/);
  assert.doesNotMatch(nightly, /SKIP_PG_VERIFY: "1"/);
});

test("successful PR gates retain exact merge-tree proof for conditional closeout", () => {
  const workflow = readFileSync(path.join(root, ".github/workflows/ci-gates.yml"), "utf8");
  assert.match(workflow, /release_sensitive: \$\{\{ steps\.risk\.outputs\.release_sensitive \}\}/);
  assert.match(workflow, /name: Record tested merge tree/);
  assert.match(workflow, /node scripts\/ci\/release-tree-proof\.mjs record/);
  assert.match(workflow, /name: Upload tested merge tree proof/);
  assert.match(workflow, /name: release-tree-proof/);
  assert.match(workflow, /retention-days: 30/);
  assert.match(workflow, /RELEASE_SENSITIVE:.*release_sensitive/);
  assert.match(workflow, /POLICY_ONLY:.*policy_only/);
});

test("failed main CI opens one escalating human-visible alert and later success resolves it", () => {
  const workflow = readFileSync(path.join(root, ".github/workflows/main-ci-failure-alert.yml"), "utf8");
  assert.match(workflow, /workflow_run:/);
  assert.match(workflow, /CI — segment gates/);
  assert.match(workflow, /Netlify production failure alert/);
  assert.match(workflow, /issues: write/);
  assert.match(workflow, /actions: read/);
  assert.match(workflow, /netlify-production-failure-alert\.mjs/);
  assert.match(workflow, /main-ci/);
  assert.match(workflow, /observer/);
  // Routing behavior is tested through the shared module, not an inline script.
});

test("WF01/WF02: production observer has finite dispatch, five-minute cadence, and bounded push", () => {
  const workflow = readFileSync(path.join(root, ".github/workflows/netlify-production-failure-alert.yml"), "utf8");
  assert.match(workflow, /name: Netlify production failure alert/);
  assert.match(workflow, /cron: ["']2-57\/5 \* \* \* \*["']/);
  assert.match(workflow, /push:\s*\n\s+branches: (?:\[main\]|\n\s+- main)/);
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /type: choice/);
  assert.match(workflow, /options: (?:\[observe, replay\]|\n\s+- observe\n\s+- replay)/);
  assert.match(workflow, /github\.repository == 'lewis4x4\/Circle-of-Life'/);
  assert.match(workflow, /github\.ref == 'refs\/heads\/main'/);
  assert.match(workflow, /timeout-minutes:.*12/);
  assert.match(workflow, /timeout-minutes:.*5|\? 12 : 5|&& 12 \|\| 5/);
  assert.doesNotMatch(workflow, /while true|while :/);
});

test("WF03/WF04: live and replay jobs isolate credentials, serialization, and finalization", () => {
  const workflow = readFileSync(path.join(root, ".github/workflows/netlify-production-failure-alert.yml"), "utf8");
  assert.match(workflow, /contents: read/);
  assert.match(workflow, /issues: write/);
  assert.doesNotMatch(workflow, /write-all|contents: write|pull_request_target/);
  assert.match(workflow, /cancel-in-progress: false/);
  assert.match(workflow, /group:.*netlify.*production/);
  assert.match(workflow, /group:.*replay.*github\.run_id/);
  assert.match(workflow, /if:.*always\(\)/);
  assert.match(workflow, /finalize-replay/);
  const jobs = [...workflow.matchAll(/^  ([a-z][a-z0-9_-]*):\s*\n([\s\S]*?)(?=^  [a-z][a-z0-9_-]*:\s*\n|$(?![\s\S]))/gm)]
    .map((match) => ({ name: match[1], body: match[2] }));
  const replay = jobs.find((job) => job.name === "replay");
  assert.ok(replay, "replay has an independently bounded job");
  assert.doesNotMatch(replay.body, /NETLIFY_AUTH_TOKEN|secrets\.NETLIFY/);
  const live = jobs.filter((job) => /NETLIFY_AUTH_TOKEN/.test(job.body));
  assert.equal(live.length, 1, "only the live observer receives the provider credential");
  assert.match(live[0].body, /secrets\.NETLIFY_AUTH_TOKEN/);
  for (const step of workflow.split(/\n\s+- (?:name:|uses:)/)) {
    if (/run:\s*(?:\||>)/.test(step)) assert.doesNotMatch(step.split(/run:\s*(?:\||>)/)[1], /\$\{\{\s*(?:inputs\.|github\.event\.inputs\.)/);
  }
  assert.match(workflow, /ref: (?:main|\$\{\{ github\.sha \}\})/);
});

test("WF03/WF06: observer-health catch-up runs every five minutes with isolated source writers", () => {
  const workflow = readFileSync(path.join(root, ".github/workflows/main-ci-failure-alert.yml"), "utf8");
  assert.match(workflow, /schedule:/);
  assert.match(workflow, /cron: ["'][^"']*\/5 \* \* \* \*["']/);
  assert.match(workflow, /group:.*main-ci/);
  assert.match(workflow, /group:.*netlify-observer-health/);
  assert.equal([...workflow.matchAll(/cancel-in-progress: false/g)].length, 2);
  assert.match(workflow, /github\.repository == 'lewis4x4\/Circle-of-Life'/);
  assert.match(workflow, /ref: main/);
  assert.doesNotMatch(workflow, /NETLIFY_AUTH_TOKEN/);
});

test("WF05: always-run required gate invokes production observer behavior regressions", () => {
  const workflow = readFileSync(path.join(root, ".github/workflows/ci-gates.yml"), "utf8");
  const step = workflow.split("      - name: Gate failure regression tests")[1]?.split("      - ")[0];
  assert.ok(step);
  assert.match(step, /node --test/);
  assert.match(step, /scripts\/ci\/netlify-production-failure-alert\.test\.mjs/);
  assert.match(step, /scripts\/review-gates\.test\.mjs/);
  assert.doesNotMatch(step, /if:/);
});

test("missing or invalid classifier outputs cannot silently skip sensitive gates", () => {
  const workflow = readFileSync(path.join(root, ".github/workflows/ci-gates.yml"), "utf8");
  assert.match(workflow, /classification_safe: \$\{\{ steps\.risk\.outputs\.classification_safe \}\}/);
  assert.match(workflow, /REQUIRE_PG_VERIFY:.*database_sensitive != 'false'/);
  assert.match(workflow, /finance_sensitive != 'false'/);
  assert.match(workflow, /CLASSIFICATION_SAFE:.*classification_safe/);
  assert.match(workflow, /for value in "\$CLASSIFICATION_SAFE" "\$DATABASE_SENSITIVE" "\$FINANCE_SENSITIVE" "\$UI_SENSITIVE" "\$RELEASE_SENSITIVE" "\$POLICY_ONLY"/);
  assert.match(workflow, /test "\$value" = "true" \|\| test "\$value" = "false"/);
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

test("migration ledger mismatch blocks an edge deploy and does not guess ambiguous names", () => {
  const local = [
    { version: "401", name: "alpha", file: "401_alpha.sql" },
    { version: "402", name: "beta", file: "402_beta.sql" },
  ];
  const applied = reconcile(local, [
    { version: "401", name: "alpha" },
    { version: "20260921120000", name: "beta" },
  ]);
  assert.equal(ledgerExitCode(applied), 0);
  assert.deepEqual(applied.unapplied, []);
  assert.equal(applied.renumbered[0]?.file, "402_beta.sql");

  const missing = reconcile(local, [{ version: "401", name: "alpha" }]);
  assert.equal(ledgerExitCode(missing), 1);
  assert.deepEqual(missing.unapplied.map((row) => row.file), ["402_beta.sql"]);

  const ambiguous = reconcile(
    [{ version: "500", name: "same", file: "500_same.sql" }],
    [{ version: "1", name: "same" }, { version: "2", name: "same" }],
  );
  assert.equal(ledgerExitCode(ambiguous), 2);
  assert.equal(ambiguous.ambiguous.length, 1);
  assert.deepEqual(ambiguous.unapplied, []);
});

test("edge deploy runs the ledger gate before deploy and selects only _shared importers", (t) => {
  const workflow = readFileSync(path.join(root, ".github/workflows/edge-functions-deploy.yml"), "utf8");
  const ledgerAt = workflow.indexOf('node scripts/check-migration-ledger.mjs --project "$SUPABASE_PROJECT_REF"');
  const deployAt = workflow.indexOf("name: Deploy changed functions");
  const verifyAt = workflow.indexOf("name: Verify deployed function inventory");
  assert.ok(ledgerAt > 0 && deployAt > ledgerAt && verifyAt > deployAt);
  const ledgerStep = workflow.slice(workflow.lastIndexOf("- name:", ledgerAt), deployAt);
  assert.doesNotMatch(ledgerStep, /continue-on-error/);
  assert.match(workflow, /if \[\[ "\$failures" -gt 0 \]\]; then/);
  assert.match(workflow, /exit 1/);
  assert.match(workflow, /!contains\(github\.event\.head_commit\.message, '\[skip deploy\]'\)/);
  assert.match(workflow, /github\.event_name != 'pull_request'/);

  assert.match(workflow, /if \[\[ "\$shared_changed" == "true" \]\]; then/);
  const start = workflow.indexOf("find supabase/functions -mindepth 1 -maxdepth 1 -type d ! -name _shared");
  const sortAt = workflow.indexOf("| sort -u", start);
  assert.ok(start > 0 && sortAt > start);
  const pipeline = workflow.slice(start, sortAt + "| sort -u".length);
  assert.match(pipeline, /_shared/);

  const cwd = mkdtempSync(path.join(os.tmpdir(), "haven-edge-select-"));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const functions = path.join(cwd, "supabase/functions");
  mkdirSync(path.join(functions, "_shared"), { recursive: true });
  mkdirSync(path.join(functions, "imports-shared"), { recursive: true });
  mkdirSync(path.join(functions, "slash-shared"), { recursive: true });
  mkdirSync(path.join(functions, "standalone"), { recursive: true });
  writeFileSync(path.join(functions, "_shared/util.ts"), "export const n = 1;\n");
  writeFileSync(path.join(functions, "imports-shared/index.ts"), 'import { n } from "../_shared/util.ts";\n');
  writeFileSync(path.join(functions, "slash-shared/index.ts"), 'import { n } from "/_shared/util.ts";\n');
  writeFileSync(path.join(functions, "standalone/index.ts"), "export const local = true;\n");

  const run = spawnSync("bash", ["-c", pipeline], {
    cwd,
    encoding: "utf8",
  });
  assert.equal(run.status, 0, run.stderr);
  assert.deepEqual(
    run.stdout.split("\n").map((line) => line.trim()).filter(Boolean),
    ["imports-shared", "slash-shared"],
  );
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
