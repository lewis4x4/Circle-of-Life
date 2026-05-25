#!/usr/bin/env node
/**
 * Seed-UUID sentinel gate — fails when a migration uses the COL organization
 * UUID as a `created_by` value in INSERT rows.
 *
 * Background: 2026-05-25, deploying the phase1 migrations (281/282/283)
 * surfaced 23503 FK violations because seed rows used
 *   '00000000-0000-0000-0000-000000000001'  (the COL organization sentinel)
 * as `created_by`. That column is a FK to `users` (or `auth.users`), and
 * an org_id is not a user_id — so every seed INSERT was rejected by the
 * staff_created_by_fkey / vendors_created_by_fkey / fl_statutes_created_by_fkey
 * constraints. Migration 236 contains a written narrative of this bug and
 * the cleanup pattern.
 *
 * This gate prevents the regression by detecting the failing pattern:
 *   ..., '00000000-0000-0000-0000-000000000001')
 * where the UUID appears as the trailing column value of an INSERT row
 * (preceded by a comma, followed by a closing paren). Legitimate uses
 * — organization_id assignments, DECLARE blocks, RLS policy references,
 * doc comments — don't match this signature.
 *
 * Fixes accepted by this gate:
 *   1. created_by = NULL                       (system-seed convention)
 *   2. created_by = <a real auth.users id>     (deployer attribution)
 *   3. Use a DECLARE'd v_seed_user_id variable (recommended for ≥3 inserts)
 *
 * Env:
 *   SCAN_PATH                 (optional)  — root to scan, default supabase/migrations
 *   SKIP_SEED_UUID_GATE       (optional)  — any truthy value skips
 *
 * Exit codes:
 *   0  — PASS or SKIP
 *   1  — FAIL (violations found)
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const COL_ORG_SENTINEL = "00000000-0000-0000-0000-000000000001";

// Pattern: comma + optional whitespace + sentinel UUID in single quotes
// + optional whitespace + closing paren. Captures the trailing-column
// position in an INSERT row (where created_by conventionally lives).
const BAD_TRAILING = new RegExp(
  `,\\s*'${COL_ORG_SENTINEL}'\\s*\\)`,
);

// Line-level pattern (for reporting). After stripping the line comment,
// any remaining match is a violation.
const LINE_BAD = new RegExp(`,\\s*'${COL_ORG_SENTINEL}'\\s*\\)`);

const REPO_ROOT = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const scanRoot = process.env.SCAN_PATH
  ? resolve(REPO_ROOT, process.env.SCAN_PATH)
  : resolve(REPO_ROOT, "supabase/migrations");

if (process.env.SKIP_SEED_UUID_GATE) {
  console.log(
    `[seed-uuid-gate] SKIP: SKIP_SEED_UUID_GATE=${process.env.SKIP_SEED_UUID_GATE}`,
  );
  process.exit(0);
}

/**
 * Strip block (`/* ... *​/`) and line (`--`) comments from a SQL string,
 * line-by-line, so block-comment state persists across lines. Returns an
 * array of { lineNo, cleaned } where cleaned has comments blanked but
 * lengths preserved so column reports stay accurate.
 */
function stripSqlComments(source) {
  const lines = source.split("\n");
  const out = [];
  let inBlock = false;
  lines.forEach((raw, i) => {
    let cleaned = "";
    let j = 0;
    while (j < raw.length) {
      if (inBlock) {
        if (raw[j] === "*" && raw[j + 1] === "/") {
          cleaned += "  ";
          j += 2;
          inBlock = false;
        } else {
          cleaned += " ";
          j += 1;
        }
        continue;
      }
      if (raw[j] === "-" && raw[j + 1] === "-") {
        // line comment — blank rest of line
        cleaned += " ".repeat(raw.length - j);
        break;
      }
      if (raw[j] === "/" && raw[j + 1] === "*") {
        cleaned += "  ";
        j += 2;
        inBlock = true;
        continue;
      }
      cleaned += raw[j];
      j += 1;
    }
    out.push({ lineNo: i + 1, cleaned, raw });
  });
  return out;
}

function listSqlFiles(root) {
  const acc = [];
  function walk(dir) {
    for (const entry of readdirSync(dir)) {
      const p = join(dir, entry);
      const st = statSync(p);
      if (st.isDirectory()) {
        walk(p);
      } else if (entry.endsWith(".sql")) {
        acc.push(p);
      }
    }
  }
  walk(root);
  return acc.sort();
}

const violations = [];

for (const file of listSqlFiles(scanRoot)) {
  const text = readFileSync(file, "utf8");
  // Quick reject: file doesn't even mention the sentinel — skip
  if (!text.includes(COL_ORG_SENTINEL)) continue;
  const lines = stripSqlComments(text);
  for (const { lineNo, cleaned, raw } of lines) {
    if (LINE_BAD.test(cleaned)) {
      violations.push({
        file: relative(REPO_ROOT, file),
        line: lineNo,
        excerpt: raw.trim().slice(0, 200),
      });
    }
  }
}

if (violations.length === 0) {
  console.log(
    `[seed-uuid-gate] PASS — scanned ${scanRoot} (no INSERT rows using COL org sentinel as created_by).`,
  );
  process.exit(0);
}

console.error(
  `\n[seed-uuid-gate] FAIL — ${violations.length} violation(s) found.\n`,
);
console.error(
  "Detected pattern:  , '" + COL_ORG_SENTINEL + "')  at end of an INSERT row.",
);
console.error(
  "Risk:              FK violation (23503) on *_created_by_fkey when applied.",
);
console.error("Fix any of:");
console.error("  - Replace with NULL                        — system seed");
console.error("  - Replace with a real auth.users(id)       — deployer attribution");
console.error("  - DECLARE v_seed_user_id and reference it  — recommended for ≥3 rows");
console.error("\nViolations:");
for (const v of violations) {
  console.error(`  ${v.file}:${v.line}`);
  console.error(`    ${v.excerpt}`);
}
console.error("");
process.exit(1);
