#!/usr/bin/env node
/**
 * Validates SQL migration filenames under MIGRATIONS_DIR (default: supabase/migrations).
 * Pattern: NNN_snake_case_name.sql — 3-digit prefix, contiguous from 001, no duplicates.
 * The only permitted gaps are the numbers in ALLOWED_GAPS, each with its reason.
 */

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

/**
 * Numbers that may be missing from the sequence. Every entry names why. Any other
 * gap still fails. When a listed number later gains a real file, the check passes
 * and prints a notice naming the entry to delete, so cleanup never breaks main.
 */
export const ALLOWED_GAPS = {
  // Temporary gaps: the stacked Medicaid chain (#896-#905) is applied on both hosts but not merged. Delete each entry when its file lands on main.
  526: "claimed by open PR #896 (COL-772, 526_benefits_admission_medicaid_status.sql); already applied to production and staging",
  527: "claimed by open PR #897 (COL-773, 527_benefits_medicaid_log_import.sql); already applied to production and staging",
  528: "claimed by open PR #898 (COL-575, 528_admission_medicaid_move_in_gate.sql); already applied to production and staging",
  529: "claimed by open PR #899 (COL-774, 529_benefits_board_first_payment_and_renewal.sql); already applied to production and staging",
  530: "claimed by open PR #900 (COL-768, 530_benefits_document_freshness.sql); already applied to production and staging",
  531: "claimed by open PR #903 (COL-775, 531_benefits_owner_summary.sql); already applied to production and staging",
  532: "claimed by open PR #904 (COL-769, 532_benefits_trust_and_lookback_prompts.sql); already applied to production and staging",
  533: "claimed by open PR #905 (COL-770, 533_benefits_701s_screening_sheet.sql); already applied to production and staging",
  // Temporary gaps: document intake (#913) is applied on both hosts but not merged. Delete each entry when its file lands on main.
  545: "claimed by open PR #913 (545_document_intake.sql); already applied to production and staging",
  546: "claimed by open PR #913 (546_document_intake_schedules.sql); already applied to production and staging",
  547: "claimed by open PR #913 (547_document_intake_facility_enablement.sql); already applied to production and staging",
  548: "claimed by open PR #913 (548_document_intake_facility_mailboxes.sql); already applied to production and staging",
};

const pattern = /^(\d{3})_[a-z0-9][a-z0-9_]*\.sql$/;
// Supabase CLI's default migration filename format is a 14-digit timestamp
// prefix. We don't enforce contiguous ordering on those — Supabase's own
// migration runner handles that — but we accept them so they don't fail
// the NNN-format gate.
const supabaseCliPattern = /^\d{14}_[a-z0-9][a-z0-9_]*\.sql$/;

const pad = (n) => String(n).padStart(3, "0");

/**
 * Pure check over a list of filenames. Returns { ok, message, notices }.
 * `allowedGaps` defaults to ALLOWED_GAPS; tests pass their own.
 */
export function checkMigrationSequence(fileNames, allowedGaps = ALLOWED_GAPS) {
  const sqlFiles = fileNames.filter((f) => f.endsWith(".sql"));
  if (sqlFiles.length === 0) {
    return { ok: true, message: "no .sql files", notices: [] };
  }

  const nums = [];
  for (const file of sqlFiles) {
    if (supabaseCliPattern.test(file)) continue;
    const m = file.match(pattern);
    if (!m) {
      return {
        ok: false,
        message: `invalid migration name "${file}" — expected NNN_snake_case.sql (lowercase snake after prefix)`,
        notices: [],
      };
    }
    nums.push(Number(m[1]));
  }

  const sorted = [...nums].sort((a, b) => a - b);
  const present = new Set(sorted);
  if (present.size !== sorted.length) {
    return { ok: false, message: "duplicate migration numeric prefix detected", notices: [] };
  }
  if (sorted.length === 0) {
    return { ok: true, message: `${sqlFiles.length} migration(s), none numbered`, notices: [] };
  }

  const min = sorted[0];
  const max = sorted[sorted.length - 1];
  if (min !== 1) {
    return { ok: false, message: `migrations must start at 001 (found minimum ${pad(min)})`, notices: [] };
  }

  const allowed = new Set(Object.keys(allowedGaps).map(Number));
  const skipped = [];
  for (let n = 1; n <= max; n++) {
    if (present.has(n)) continue;
    if (allowed.has(n)) {
      skipped.push(n);
      continue;
    }
    return { ok: false, message: `gap in migration sequence: ${pad(n)} is missing and is not on the allowed-gap list`, notices: [] };
  }

  const notices = [...allowed]
    .filter((n) => present.has(n))
    .sort((a, b) => a - b)
    .map((n) => `allowed gap ${pad(n)} now has a migration file; delete its entry from ALLOWED_GAPS in scripts/check-migration-order.mjs`);

  const gapNote = skipped.length ? ` (allowed gaps: ${skipped.map(pad).join(", ")})` : "";
  return {
    ok: true,
    message: `${sqlFiles.length} migration(s) — sequence 001..${pad(max)}${gapNote}`,
    notices,
  };
}

function main() {
  const dir = process.env.MIGRATIONS_DIR
    ? path.resolve(process.env.MIGRATIONS_DIR)
    : path.resolve(process.cwd(), "supabase/migrations");

  if (!fs.existsSync(dir)) {
    console.log(`[migrations:check] PASS: no migrations directory at ${dir} (skipped)`);
    return 0;
  }

  const result = checkMigrationSequence(fs.readdirSync(dir));
  for (const notice of result.notices) {
    console.log(`[migrations:check] NOTICE: ${notice}`);
  }
  if (!result.ok) {
    console.error(`[migrations:check] FAIL: ${result.message}`);
    return 1;
  }
  console.log(`[migrations:check] PASS: ${result.message} in ${dir}`);
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(main());
}
