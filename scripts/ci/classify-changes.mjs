#!/usr/bin/env node

import { appendFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import process from "node:process";
import { pathToFileURL } from "node:url";

const ZERO_SHA = /^0+$/;

const databaseRules = [
  (file) => file.startsWith("supabase/migrations/"),
  (file) => file.startsWith("supabase/tests/"),
  (file) => file === "supabase/config.toml",
  (file) => file === "scripts/pg-verify-migrations.mjs",
  (file) => file === "scripts/pg-verify-stub.sql",
  (file) => file.startsWith("scripts/care-events/"),
  (file) => file === "src/lib/care-events/level-cases.json",
  (file) => file.startsWith("scripts/smart-rounding/") && file.endsWith("-acceptance.sql"),
  (file) => file === "scripts/agent-gates/run-segment-gates.mjs",
  (file) => file === ".github/workflows/ci-nightly.yml",
  (file) => file === ".github/workflows/finance-integration.yml",
];

const financeRules = [
  (file) => file.startsWith("supabase/migrations/"),
  (file) => file.startsWith("scripts/finance-integration/"),
  (file) => file.startsWith("src/lib/finance-integration/"),
  (file) => file.startsWith("src/lib/platform-audit/"),
  (file) => file.startsWith("src/lib/billing/"),
  (file) => file.startsWith("src/components/billing/"),
  (file) => file.startsWith("src/app/(admin)/admin/cash/"),
  (file) => file.includes("/finance/"),
  (file) => file.includes("/billing/"),
  (file) => file.includes("/invoices/"),
  (file) => file.startsWith("supabase/functions/_shared/qbo-"),
  (file) => file.startsWith("supabase/functions/_shared/billing/"),
  (file) => file.startsWith("supabase/functions/generate-monthly-invoices/"),
  (file) => file.startsWith("supabase/functions/export-audit-log/"),
  (file) => file === ".github/workflows/finance-integration.yml",
  (file) => file === "package-lock.json",
];

const uiRules = [
  (file) => file.startsWith("src/app/"),
];

const releaseRules = [
  ...databaseRules,
  ...financeRules,
  (file) => file.startsWith("supabase/functions/"),
  (file) => file.startsWith(".github/"),
  (file) => ["AGENTS.md", "CLAUDE.md", "CODEX.md", "docs/agent-gates-runbook.md", "docs/LINEAR-WORKFLOW.md"].includes(file),
  (file) => file.startsWith("netlify/"),
  (file) => file === "netlify.toml",
  (file) => file.startsWith("scripts/scheduled-jobs/"),
  (file) => /^scripts\/(apply-pending|check-deploy|deploy|release|verify-remote)/.test(file),
  (file) => /(^|[/._-])(auth|authorization|permission|role|rls|current-actor)([/._-]|$)/i.test(file),
  (file) => /(^|\/)(proxy|middleware)\.[cm]?[jt]sx?$/.test(file),
  (file) => /(service-worker|workbox|(^|\/)sw\.[cm]?[jt]s$)/i.test(file),
  (file) => /^(next\.config|package(-lock)?\.json|tsconfig|eslint\.config)/.test(file),
  (file) => file === "scripts/ci/release-tree-proof.mjs",
  (file) => file === "scripts/ci/release-tree-proof.test.mjs",
];

const policyOnlyRules = [
  (file) => file.startsWith(".github/workflows/"),
  (file) => file.startsWith("scripts/ci/"),
  (file) => file === "scripts/review-gates.test.mjs",
  (file) => ["AGENTS.md", "CODEX.md", "docs/agent-gates-runbook.md"].includes(file),
];

function matching(files, rules) {
  return files.filter((file) => rules.some((rule) => rule(file)));
}

export function classifyPaths(files, { forceFull = false, safe = true } = {}) {
  const normalized = [...new Set(files.map((file) => file.trim()).filter(Boolean))].sort();
  const force = forceFull || !safe;
  const databasePaths = force ? normalized : matching(normalized, databaseRules);
  const financePaths = force ? normalized : matching(normalized, financeRules);
  const uiPaths = force ? normalized : matching(normalized, uiRules);
  const releasePaths = force ? normalized : matching(normalized, releaseRules);
  const policyPaths = force ? [] : matching(normalized, policyOnlyRules);
  const policyOnly = safe && !force && databasePaths.length === 0 && financePaths.length === 0 && normalized.length > 0 && policyPaths.length === normalized.length;

  return {
    safe,
    forced: force,
    files: normalized,
    databaseSensitive: force || databasePaths.length > 0,
    financeSensitive: force || financePaths.length > 0,
    uiSensitive: force || uiPaths.length > 0,
    releaseSensitive: force || releasePaths.length > 0,
    policyOnly,
    databasePaths,
    financePaths,
    uiPaths,
    releasePaths,
    policyPaths,
  };
}

export function parseNameStatus(output) {
  const tokens = output.split("\0");
  if (tokens.at(-1) === "") tokens.pop();
  const files = [];

  for (let index = 0; index < tokens.length;) {
    const status = tokens[index++];
    if (!/^[ACDMRTUXB][0-9]*$/.test(status)) {
      throw new Error(`unexpected git diff status ${JSON.stringify(status)}`);
    }

    const source = tokens[index++];
    if (!source) throw new Error(`missing path for git diff status ${status}`);
    files.push(source);

    if (status.startsWith("R") || status.startsWith("C")) {
      const destination = tokens[index++];
      if (!destination) throw new Error(`missing destination for git diff status ${status}`);
      files.push(destination);
    }
  }

  return files;
}

export function diffFiles({ base, head, mode = "range", cwd = process.cwd() }) {
  if (!base || !head || ZERO_SHA.test(base) || ZERO_SHA.test(head)) {
    return { safe: false, files: [], error: "missing or zero diff boundary" };
  }

  const separator = mode === "merge-base" ? "..." : "..";
  const result = spawnSync(
    "git",
    ["diff", "--name-status", "--find-renames", "--find-copies", "--diff-filter=ACDMRTUXB", "-z", `${base}${separator}${head}`],
    { cwd, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 },
  );
  if (result.status !== 0) {
    return {
      safe: false,
      files: [],
      error: result.stderr.trim() || result.error?.message || `git diff exited ${result.status}`,
    };
  }

  try {
    return { safe: true, files: parseNameStatus(result.stdout) };
  } catch (error) {
    return { safe: false, files: [], error: error.message };
  }
}

function writeOutput(name, value) {
  const rendered = typeof value === "boolean" ? String(value) : value;
  console.log(`${name}=${rendered}`);
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `${name}=${rendered}\n`);
}

function main() {
  const mode = process.env.CI_DIFF_MODE === "merge-base" ? "merge-base" : "range";
  const diff = diffFiles({
    base: process.env.CI_DIFF_BASE,
    head: process.env.CI_DIFF_HEAD,
    mode,
  });
  if (!diff.safe) {
    console.error(`::warning::Could not classify the change safely (${diff.error}); running every risk-sensitive gate.`);
  }

  const result = classifyPaths(diff.files, {
    forceFull: process.env.CI_FORCE_FULL === "true",
    safe: diff.safe,
  });

  writeOutput("classification_safe", result.safe);
  writeOutput("database_sensitive", result.databaseSensitive);
  writeOutput("finance_sensitive", result.financeSensitive);
  writeOutput("ui_sensitive", result.uiSensitive);
  writeOutput("release_sensitive", result.releaseSensitive);
  writeOutput("policy_only", result.policyOnly);
  writeOutput("changed_files", JSON.stringify(result.files));
  writeOutput("database_paths", JSON.stringify(result.databasePaths));
  writeOutput("finance_paths", JSON.stringify(result.financePaths));
  writeOutput("release_paths", JSON.stringify(result.releasePaths));

  const summary = process.env.GITHUB_STEP_SUMMARY;
  if (summary) {
    appendFileSync(
      summary,
      [
        "## CI change classification",
        "",
        `- Safe diff: ${result.safe}`,
        `- Full database replay: ${result.databaseSensitive}`,
        `- Finance-specific suite: ${result.financeSensitive}`,
        `- UI-sensitive: ${result.uiSensitive}`,
        `- Must await post-merge CI: ${result.releaseSensitive}`,
        `- Policy-only lane: ${result.policyOnly}`,
        `- Changed files: ${result.files.length}`,
        "",
      ].join("\n"),
    );
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
