#!/usr/bin/env node
/**
 * Fails a branch that claims a migration number someone else already claimed.
 *
 * Haven does not reserve migration numbers. Every session picks the next free
 * one by looking at `supabase/migrations/`, which answers a question about the
 * past while the actual contest is about the future: two branches cut an hour
 * apart both see 411 as the highest and both write 412.
 *
 * `migrations:check` catches that, but only once both have merged — it reads one
 * working tree. On 2026-09-16 COL-353 (#579) and COL-465 (#583) merged eight
 * minutes apart, and for the twenty minutes until someone renumbered, `main`
 * failed the sequence check on every branch cut from it. Nothing was applied to
 * a database, so it cost a rename; had either been applied first it would have
 * cost a ledger row pointing at a file that no longer exists.
 *
 * This looks sideways instead of backwards. For every migration this branch adds
 * that `main` does not have, it asks two questions:
 *
 *   1. Does `main` already use that number for a different file? Local, exact,
 *      and a hard failure — the branch is stale and must renumber.
 *   2. Does another OPEN pull request already claim it? This is the one that
 *      catches a same-evening collision, and it is the whole point: at the
 *      moment #583 opened, #579 had been sitting on 412 for hours.
 *
 * Question 2 needs the GitHub API. When `gh` is missing or unauthenticated the
 * check says so and passes — a developer offline should not be blocked — but in
 * CI `GITHUB_TOKEN` is always present, so the gate is real where it counts.
 *
 * Usage:
 *   npm run migrations:check:claims           # gate this branch
 *   npm run migrations:check:claims -- --next # print the next genuinely free number
 *   npm run migrations:check:claims -- --no-remote
 *
 * Only ever reads. It never renames a file for you: which branch should move is
 * a judgment about what has already been applied, not a coin flip.
 */

import { spawnSync } from "node:child_process";
import process from "node:process";

const MIGRATIONS_PREFIX = "supabase/migrations/";
const NAME_PATTERN = /^(\d{3})_([a-z0-9][a-z0-9_]*)\.sql$/;

const args = process.argv.slice(2);
const wantNext = args.includes("--next");
const noRemote = args.includes("--no-remote");

function log(msg) {
  console.log(`[migrations:claims] ${msg}`);
}

function fail(msg) {
  console.error(`[migrations:claims] FAIL: ${msg}`);
  process.exit(1);
}

function run(cmd, cmdArgs, options = {}) {
  const result = spawnSync(cmd, cmdArgs, { encoding: "utf8", ...options });
  if (result.error || result.status !== 0) {
    return { ok: false, stdout: result.stdout ?? "", stderr: result.stderr ?? String(result.error ?? "") };
  }
  return { ok: true, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

/** `NNN` → filename stem, for every migration on the base branch. */
function migrationsOnBase(baseRef) {
  const listed = run("git", ["ls-tree", "--name-only", baseRef, MIGRATIONS_PREFIX]);
  if (!listed.ok) fail(`could not read ${baseRef} — is it fetched? ${listed.stderr.trim()}`);

  const byNumber = new Map();
  for (const line of listed.stdout.split("\n")) {
    const file = line.trim().slice(MIGRATIONS_PREFIX.length);
    const match = file.match(NAME_PATTERN);
    if (!match) continue;
    byNumber.set(match[1], file);
  }
  return byNumber;
}

/** Migrations this branch adds that the base branch does not have. */
function migrationsAddedHere(baseRef) {
  const diff = run("git", [
    "diff",
    "--name-only",
    "--diff-filter=A",
    `${baseRef}...HEAD`,
    "--",
    MIGRATIONS_PREFIX,
  ]);
  if (!diff.ok) fail(`could not diff against ${baseRef}: ${diff.stderr.trim()}`);

  const added = [];
  for (const line of diff.stdout.split("\n")) {
    const file = line.trim().slice(MIGRATIONS_PREFIX.length);
    const match = file.match(NAME_PATTERN);
    if (match) added.push({ file, number: match[1] });
  }
  return added;
}

/**
 * Migration numbers claimed by open pull requests, excluding this one.
 * Returns null when the API could not be reached, so the caller can tell
 * "nobody else claims it" apart from "nobody could be asked".
 */
function claimsFromOpenPullRequests(selfPrNumber) {
  const listed = run("gh", [
    "pr",
    "list",
    "--state",
    "open",
    "--limit",
    "100",
    "--json",
    "number,title,files",
  ]);
  if (!listed.ok) return null;

  let pulls;
  try {
    pulls = JSON.parse(listed.stdout);
  } catch {
    return null;
  }

  const claims = new Map();
  for (const pull of pulls) {
    if (selfPrNumber && String(pull.number) === String(selfPrNumber)) continue;
    for (const entry of pull.files ?? []) {
      const filePath = entry.path ?? "";
      if (!filePath.startsWith(MIGRATIONS_PREFIX)) continue;
      const match = filePath.slice(MIGRATIONS_PREFIX.length).match(NAME_PATTERN);
      if (!match) continue;
      // One PR can legitimately add several; record each.
      const existing = claims.get(match[1]) ?? [];
      existing.push({ pr: pull.number, title: pull.title, file: match[0] });
      claims.set(match[1], existing);
    }
  }
  return claims;
}

function selfPullRequestNumber() {
  // GITHUB_REF on a pull_request event is refs/pull/<n>/merge.
  const ref = process.env.GITHUB_REF ?? "";
  const fromRef = ref.match(/^refs\/pull\/(\d+)\//);
  if (fromRef) return fromRef[1];

  const viewed = run("gh", ["pr", "view", "--json", "number"]);
  if (!viewed.ok) return null;
  try {
    return String(JSON.parse(viewed.stdout).number);
  } catch {
    return null;
  }
}

const baseRef = process.env.GITHUB_BASE_REF
  ? `origin/${process.env.GITHUB_BASE_REF}`
  : "origin/main";

const baseMigrations = migrationsOnBase(baseRef);
const selfPr = selfPullRequestNumber();
const openClaims = noRemote ? null : claimsFromOpenPullRequests(selfPr);

if (wantNext) {
  let candidate = 1;
  for (const key of baseMigrations.keys()) candidate = Math.max(candidate, Number(key) + 1);
  if (openClaims) {
    for (const key of openClaims.keys()) candidate = Math.max(candidate, Number(key) + 1);
  }
  const padded = String(candidate).padStart(3, "0");
  if (!openClaims) {
    log("could not reach the GitHub API — this number accounts for merged work only.");
  }
  log(`next free migration number: ${padded}`);
  console.log(padded);
  process.exit(0);
}

const added = migrationsAddedHere(baseRef);
if (added.length === 0) {
  log(`no new migrations against ${baseRef} — nothing to claim.`);
  process.exit(0);
}

const problems = [];

for (const { file, number } of added) {
  const onBase = baseMigrations.get(number);
  if (onBase && onBase !== file) {
    problems.push(
      `${file} — ${baseRef} already uses ${number} for ${onBase}. This branch is behind; rebase and renumber.`,
    );
    continue;
  }

  for (const claim of openClaims?.get(number) ?? []) {
    if (claim.file === file) continue;
    problems.push(
      `${file} — open PR #${claim.pr} already claims ${number} for ${claim.file} (${claim.title}). ` +
        `Whichever of you merges second has to renumber; do it now rather than on main.`,
    );
  }
}

if (problems.length > 0) {
  for (const problem of problems) console.error(`[migrations:claims]   ${problem}`);
  fail(
    `${problems.length} migration number collision(s). Run \`npm run migrations:next\` for a free number.`,
  );
}

if (!openClaims && !noRemote) {
  log("could not reach the GitHub API (gh missing or unauthenticated) — open PRs were NOT checked.");
}

const names = added.map((m) => m.file).join(", ");
log(`PASS: ${added.length} new migration(s) against ${baseRef} — ${names}`);
