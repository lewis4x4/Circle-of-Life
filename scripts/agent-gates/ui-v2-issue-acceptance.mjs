#!/usr/bin/env node
/**
 * UI-V2 GitHub issue acceptance gate.
 *
 * Fails if any closed GitHub issue labeled `ui-v2` with title prefix
 * `[UI-V2-W<N>-<PAGE>]` still contains unchecked acceptance boxes (`- [ ]`) in
 * its body. Used by scripts/agent-gates/run-segment-gates.mjs for UI-V2
 * segments.
 *
 * Requires `gh` CLI authenticated.
 *
 * Env:
 *   UI_V2_ISSUE_LABEL   — label to filter, default "ui-v2"
 *   UI_V2_ISSUE_LIMIT   — max issues to fetch, default 500
 *   SKIP_UI_V2_ISSUES   — any truthy value skips
 *
 * Exit codes:
 *   0 — PASS (or SKIP)
 *   1 — FAIL (closed issue missing checklist completion, or gh error)
 */

import { execSync } from "node:child_process";

const LABEL = process.env.UI_V2_ISSUE_LABEL ?? "ui-v2";
const LIMIT = Number(process.env.UI_V2_ISSUE_LIMIT ?? 500);

if (process.env.SKIP_UI_V2_ISSUES) {
  console.log(`[ui-v2-issues] SKIP: SKIP_UI_V2_ISSUES=${process.env.SKIP_UI_V2_ISSUES}`);
  process.exit(0);
}

function runGh(args) {
  try {
    return execSync(`gh ${args}`, { stdio: ["ignore", "pipe", "pipe"], encoding: "utf8" });
  } catch (err) {
    const msg = err?.stderr?.toString?.() ?? err?.message ?? String(err);
    console.error(`[ui-v2-issues] FAIL: gh command failed — ${msg}`);
    process.exit(1);
  }
}

// Confirm auth
runGh("auth status --hostname github.com");

const raw = runGh(
  `issue list --label "${LABEL}" --state all --limit ${LIMIT} --json number,title,state,body,closedAt`,
);

let issues;
try {
  issues = JSON.parse(raw);
} catch (err) {
  console.error(`[ui-v2-issues] FAIL: gh returned non-JSON — ${err?.message ?? err}`);
  process.exit(1);
}

if (!Array.isArray(issues)) {
  console.error("[ui-v2-issues] FAIL: unexpected response shape");
  process.exit(1);
}

const TITLE_RE = /^\[UI-V2-W\d+-[A-Z0-9_-]+\]/i;
const violations = [];

for (const issue of issues) {
  if (!TITLE_RE.test(issue.title ?? "")) continue;
  if (issue.state !== "CLOSED") continue;

  const body = issue.body ?? "";
  const unchecked = (body.match(/^- \[ \]/gm) ?? []).length;
  if (unchecked > 0) {
    violations.push({ number: issue.number, title: issue.title, unchecked, closedAt: issue.closedAt });
  }
}

if (violations.length > 0) {
  console.error(
    `[ui-v2-issues] FAIL: ${violations.length} closed UI-V2 issue(s) have unchecked acceptance boxes`,
  );
  for (const v of violations.slice(0, 10)) {
    console.error(`  - #${v.number} ${v.title} — ${v.unchecked} unchecked (closed ${v.closedAt})`);
  }
  process.exit(1);
}

console.log(
  `[ui-v2-issues] PASS: ${issues.length} UI-V2 issue(s) scanned; 0 closed issues with unchecked boxes`,
);
process.exit(0);
