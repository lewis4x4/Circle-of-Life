#!/usr/bin/env node
/**
 * Reports migrations that are merged but not applied to a hosted project.
 *
 * `main` has no deploy workflow for migrations — every one reaches production
 * because a person ran it by hand. 379, 380 and 386 sat merged and unapplied
 * while 381–385 and 387 went in ahead of them; production's schema corresponded
 * to no commit of `main` for roughly a day and an unrelated audit is the only
 * reason anyone noticed (COL-345, COL-370). This is the check that notices.
 *
 * Two rules it exists to honour:
 *
 *   1. **A version-only comparison is wrong.** Migrations applied outside the
 *      CLI land under a timestamp version — 384, 385 and 387 are recorded as
 *      `20260914203602`, `20260914203613`, `20260915182400`. Keying on version
 *      alone calls those pending and re-runs applied DDL, which is what
 *      `apply-pending-migrations.py` would do today. So versions are matched
 *      first and anything left over is matched by name.
 *   2. **Never `max(version)`.** Text ordering puts `2026…` below `383`, so the
 *      highest version tells you nothing about what is missing underneath it.
 *
 * Name alone is not a key either: 101/129, 102/133, 103/134 and 104/135 are
 * four pairs of same-named files. Those match on version and never reach the
 * name pass; if a name pass is ever ambiguous the script says so instead of
 * guessing which row it means.
 *
 * It only ever runs SELECT. Applying is still a deliberate human act.
 *
 * Usage:
 *   npm run migrations:verify:ledger                  # production
 *   npm run migrations:verify:ledger -- --staging     # Haven HFO Staging
 *   npm run migrations:verify:ledger -- --project <ref>
 *
 * Auth: SUPABASE_ACCESS_TOKEN, or the Supabase CLI login in the macOS keychain.
 */

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

// Resolved explicitly rather than from `supabase/.temp/project-ref`: the linked
// project follows whatever was last rehearsed (it is Haven HFO Staging right
// now), and a drift check that silently reports on the wrong database is worse
// than no drift check.
const PROJECTS = {
  production: "manfqmasfqppukpobpld",
  staging: "iwcnajanvjvynolltflw",
};

const migrationsDir = process.env.MIGRATIONS_DIR
  ? path.resolve(process.env.MIGRATIONS_DIR)
  : path.resolve(process.cwd(), "supabase/migrations");

function fail(msg, code = 1) {
  console.error(`[migrations:ledger] FAIL: ${msg}`);
  process.exit(code);
}

function resolveTarget(argv) {
  const explicit = argv.indexOf("--project");
  if (explicit !== -1) {
    const ref = argv[explicit + 1];
    if (!ref) fail("--project needs a project ref", 2);
    return { label: ref, ref };
  }
  if (argv.includes("--staging")) return { label: "staging", ref: PROJECTS.staging };
  if (process.env.SUPABASE_PROJECT_REF) {
    return { label: process.env.SUPABASE_PROJECT_REF, ref: process.env.SUPABASE_PROJECT_REF };
  }
  return { label: "production", ref: PROJECTS.production };
}

/** The CLI stores its login under the "Supabase CLI" service, go-keyring encoded. */
function tokenFromKeychain() {
  if (process.platform !== "darwin") return null;
  const found = spawnSync(
    "security",
    ["find-generic-password", "-s", "Supabase CLI", "-a", "access-token", "-w"],
    { encoding: "utf8" },
  );
  if (found.status !== 0) return null;
  const raw = found.stdout.trim();
  if (!raw) return null;
  return raw.startsWith("go-keyring-base64:")
    ? Buffer.from(raw.slice("go-keyring-base64:".length), "base64").toString("utf8").trim()
    : raw;
}

function resolveToken() {
  const token = process.env.SUPABASE_ACCESS_TOKEN?.trim() || tokenFromKeychain();
  if (!token) {
    fail(
      "no Supabase access token — set SUPABASE_ACCESS_TOKEN or run `supabase login`",
      2,
    );
  }
  return token;
}

async function ledgerRows(ref, token) {
  const response = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "User-Agent": "check-migration-ledger/1.0 (+circle-of-life)",
    },
    body: JSON.stringify({
      query: "select version, name from supabase_migrations.schema_migrations",
    }),
  });

  const body = await response.text();
  if (!response.ok) {
    fail(`ledger read returned HTTP ${response.status}: ${body.slice(0, 400)}`, 2);
  }

  let rows;
  try {
    rows = JSON.parse(body);
  } catch {
    fail(`ledger read returned non-JSON: ${body.slice(0, 200)}`, 2);
  }
  if (!Array.isArray(rows)) fail(`unexpected ledger payload: ${body.slice(0, 200)}`, 2);
  return rows;
}

function localMigrations() {
  if (!fs.existsSync(migrationsDir)) fail(`no migrations directory at ${migrationsDir}`, 2);
  const pattern = /^(\d+)_(.+)\.sql$/;
  const files = [];
  for (const file of fs.readdirSync(migrationsDir).filter((f) => f.endsWith(".sql")).sort()) {
    const match = file.match(pattern);
    if (!match) fail(`migration file does not parse as <version>_<name>.sql: ${file}`, 2);
    files.push({ version: match[1], name: match[2], file });
  }
  return files;
}

/**
 * Version first, then name over whatever is left. Returns the unapplied files,
 * the files applied under a different version, the ambiguous name matches, and
 * the ledger rows no file on this branch accounts for.
 */
export function reconcile(local, rows) {
  const unconsumed = new Map(rows.map((row) => [row.version, row]));
  const unapplied = [];
  const renumbered = [];
  const ambiguous = [];

  const byVersion = [];
  const needsNameMatch = [];
  for (const migration of local) {
    if (unconsumed.has(migration.version)) byVersion.push(migration);
    else needsNameMatch.push(migration);
  }
  for (const migration of byVersion) unconsumed.delete(migration.version);

  for (const migration of needsNameMatch) {
    const candidates = [...unconsumed.values()].filter((row) => row.name === migration.name);
    if (candidates.length === 1) {
      unconsumed.delete(candidates[0].version);
      renumbered.push({ ...migration, appliedAs: candidates[0].version });
    } else if (candidates.length > 1) {
      ambiguous.push({ ...migration, versions: candidates.map((row) => row.version) });
    } else {
      unapplied.push(migration);
    }
  }

  return { unapplied, renumbered, ambiguous, untracked: [...unconsumed.values()] };
}

/** Exit status the production deploy gate uses. Ambiguous matches are not guessed. */
export function ledgerExitCode({ unapplied, ambiguous }) {
  if (ambiguous.length > 0) return 2;
  if (unapplied.length > 0) return 1;
  return 0;
}

async function main() {
  const target = resolveTarget(process.argv.slice(2));
  const local = localMigrations();

  console.log(`[migrations:ledger] ${target.label} (${target.ref}) — ${local.length} local migration(s)`);

  const rows = await ledgerRows(target.ref, resolveToken());
  const { unapplied, renumbered, ambiguous, untracked } = reconcile(local, rows);
  const code = ledgerExitCode({ unapplied, ambiguous });

  if (renumbered.length > 0) {
    console.log(
      `\n[migrations:ledger] ${renumbered.length} applied under a timestamp version (expected — applied outside the CLI):`,
    );
    for (const m of renumbered) {
      console.log(`  ${m.file} → recorded as ${m.appliedAs}`);
    }
  }

  if (untracked.length > 0) {
    console.log(`\n[migrations:ledger] ${untracked.length} ledger row(s) with no file on this branch:`);
    for (const row of untracked) {
      console.log(`  ${row.version}_${row.name}`);
    }
    console.log("  (expected on a feature branch behind main; investigate on main)");
  }

  if (code === 2) {
    console.error(`\n[migrations:ledger] FAIL: ${ambiguous.length} file(s) match more than one ledger row by name:\n`);
    for (const m of ambiguous) {
      console.error(`  ${m.file} — candidates ${m.versions.join(", ")}`);
    }
    fail("cannot tell applied from unapplied; reconcile these rows by hand", code);
  }

  if (code === 0) {
    console.log(
      `\n[migrations:ledger] PASS: every migration on this branch is applied to ${target.label}`,
    );
    process.exit(0);
  }

  console.error(`\n[migrations:ledger] FAIL: ${unapplied.length} migration(s) merged but not applied to ${target.label}:\n`);
  for (const m of unapplied) {
    console.error(`  ${m.file}`);
  }
  console.error("\nApply each in order, then record it — `supabase db push` does not work on this");
  console.error("repo (see CLAUDE.md § Migrations).");
  if (target.ref !== PROJECTS.staging) {
    console.error("Rehearse on Haven HFO Staging first: this command with --staging.");
  }
  console.error("");
  for (const m of unapplied) {
    console.error(`  supabase db query --linked -f supabase/migrations/${m.file}`);
  }
  console.error(
    "\nThen `NOTIFY pgrst, 'reload schema';` if the API surface changed, and insert the ledger row.",
  );
  process.exit(code);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
