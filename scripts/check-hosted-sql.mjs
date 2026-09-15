#!/usr/bin/env node
/**
 * Fails when a migration schema-qualifies an extension function with `public.`.
 *
 * On a hosted Supabase project pgcrypto and uuid-ossp live in `extensions`, not
 * `public`, so `public.gen_random_uuid()` is `42883: function does not exist` —
 * the exact way migration 380 failed hosted after replaying clean locally
 * (COL-345, COL-370). Static check: no database, no credentials, runs on every
 * push and pull request.
 *
 * Use the bare name (what the other ~128 migrations do). Inside
 * `SET search_path = ''` use `pg_catalog.` for built-ins, or resolve the schema
 * dynamically with `%I` the way 093 onward do for `crypt`/`gen_salt`.
 */

import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const migrationsDir = process.env.MIGRATIONS_DIR
  ? path.resolve(process.env.MIGRATIONS_DIR)
  : path.resolve(process.cwd(), "supabase/migrations");

// Functions that pgcrypto / uuid-ossp install into `extensions` on hosted
// Supabase. If Haven ever defines its own `public.<name>` with one of these
// names, drop it from this list rather than suppressing the whole rule.
const EXTENSION_FUNCTIONS = [
  "gen_random_uuid",
  "gen_random_bytes",
  "crypt",
  "gen_salt",
  "digest",
  "hmac",
  "encrypt",
  "decrypt",
  "pgp_sym_encrypt",
  "pgp_sym_decrypt",
  "pgp_pub_encrypt",
  "pgp_pub_decrypt",
  "armor",
  "dearmor",
  "uuid_generate_v1",
  "uuid_generate_v1mc",
  "uuid_generate_v3",
  "uuid_generate_v4",
  "uuid_generate_v5",
];

const offender = new RegExp(`\\bpublic\\s*\\.\\s*(${EXTENSION_FUNCTIONS.join("|")})\\b`, "gi");

/**
 * Blank out `--` line comments and block comments, preserving newlines and
 * column positions so reported line/column numbers still point at the source.
 * Dollar-quoted bodies and single-quoted strings are deliberately left intact:
 * a `public.gen_random_uuid()` inside a function body or an `EXECUTE` string
 * still fails at runtime on hosted.
 */
function blankComments(sql) {
  return sql
    .replace(/--[^\n]*/g, (m) => " ".repeat(m.length))
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "));
}

function fail(msg) {
  console.error(`[sql:hosted] FAIL: ${msg}`);
  process.exit(1);
}

if (!fs.existsSync(migrationsDir)) {
  console.log(`[sql:hosted] PASS: no migrations directory at ${migrationsDir} (skipped)`);
  process.exit(0);
}

const files = fs
  .readdirSync(migrationsDir)
  .filter((file) => file.endsWith(".sql"))
  .sort();

const findings = [];

for (const file of files) {
  const lines = blankComments(fs.readFileSync(path.join(migrationsDir, file), "utf8")).split("\n");
  lines.forEach((line, index) => {
    for (const match of line.matchAll(offender)) {
      findings.push({
        file,
        line: index + 1,
        column: match.index + 1,
        call: match[0],
        source: line.trim(),
      });
    }
  });
}

if (findings.length > 0) {
  console.error(
    `[sql:hosted] FAIL: ${findings.length} extension function(s) schema-qualified with \`public.\`\n`,
  );
  for (const finding of findings) {
    const bare = finding.call.replace(/^public\s*\.\s*/i, "");
    console.error(`  ${migrationsDir}/${finding.file}:${finding.line}:${finding.column}`);
    console.error(`    ${finding.source}`);
    console.error(`    pgcrypto/uuid-ossp live in \`extensions\` on hosted — use \`${bare}\`\n`);
  }
  fail("this migration cannot apply to a hosted Supabase project");
}

console.log(`[sql:hosted] PASS: ${files.length} migration file(s), no public-qualified extension calls`);
