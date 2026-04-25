#!/usr/bin/env node
/**
 * Sentry smoke gate — fails if Sentry recorded any unresolved issues in the
 * last N minutes for the current git SHA.
 *
 * Used by scripts/agent-gates/run-segment-gates.mjs (UI-V2 segments) and by
 * `npm run smoke:sentry` for local verification.
 *
 * Env:
 *   SENTRY_ORG              (required)    — e.g. "blackrockai"
 *   SENTRY_PROJECT          (required)    — e.g. "javascript-nextjs-col"
 *   SENTRY_AUTH_TOKEN       (required)    — user token with project:read + event:read
 *   SENTRY_SMOKE_WINDOW_MIN (optional)    — lookback minutes, default 10
 *   SENTRY_SMOKE_RELEASE    (optional)    — override release tag, default is git SHA (short)
 *   SKIP_SENTRY_SMOKE       (optional)    — any truthy value skips (exits 0 with SKIP marker)
 *
 * Exit codes:
 *   0  — PASS or SKIP
 *   1  — FAIL (unresolved issues found, or Sentry API error)
 */

import { execSync } from "node:child_process";

const WINDOW_MIN = Number(process.env.SENTRY_SMOKE_WINDOW_MIN ?? 10);

if (process.env.SKIP_SENTRY_SMOKE) {
  console.log(`[sentry-smoke] SKIP: SKIP_SENTRY_SMOKE=${process.env.SKIP_SENTRY_SMOKE}`);
  process.exit(0);
}

const org = process.env.SENTRY_ORG;
const project = process.env.SENTRY_PROJECT;
const token = process.env.SENTRY_AUTH_TOKEN;

if (!org || !project || !token) {
  console.log(
    "[sentry-smoke] SKIP: missing SENTRY_ORG / SENTRY_PROJECT / SENTRY_AUTH_TOKEN",
  );
  process.exit(0);
}

let release = process.env.SENTRY_SMOKE_RELEASE;
if (!release) {
  try {
    release = execSync("git rev-parse HEAD", { stdio: ["ignore", "pipe", "ignore"] })
      .toString()
      .trim()
      .slice(0, 12);
  } catch {
    console.error("[sentry-smoke] FAIL: cannot resolve git SHA and no SENTRY_SMOKE_RELEASE set");
    process.exit(1);
  }
}

const params = new URLSearchParams({
  statsPeriod: `${WINDOW_MIN}m`,
  query: `release:${release} is:unresolved`,
});
const url = `https://sentry.io/api/0/projects/${org}/${project}/issues/?${params}`;

let res;
try {
  res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
    signal: AbortSignal.timeout(15_000),
  });
} catch (err) {
  console.error(`[sentry-smoke] FAIL: network error ${err?.message ?? err}`);
  process.exit(1);
}

if (!res.ok) {
  const body = await res.text().catch(() => "");
  console.error(`[sentry-smoke] FAIL: Sentry API ${res.status} ${res.statusText}`);
  if (body) console.error(body.slice(0, 500));
  process.exit(1);
}

let issues;
try {
  issues = await res.json();
} catch (err) {
  console.error(`[sentry-smoke] FAIL: invalid JSON from Sentry API — ${err?.message ?? err}`);
  process.exit(1);
}

if (!Array.isArray(issues)) {
  console.error("[sentry-smoke] FAIL: unexpected Sentry response shape (not an array)");
  process.exit(1);
}

if (issues.length > 0) {
  console.error(
    `[sentry-smoke] FAIL: ${issues.length} unresolved Sentry issue(s) in last ${WINDOW_MIN}m for release ${release}`,
  );
  for (const i of issues.slice(0, 5)) {
    console.error(`  - ${i.shortId ?? i.id} ${i.title ?? ""} (events: ${i.count ?? "?"})`);
  }
  process.exit(1);
}

console.log(
  `[sentry-smoke] PASS: 0 unresolved issues in last ${WINDOW_MIN}m for release ${release}`,
);
process.exit(0);
