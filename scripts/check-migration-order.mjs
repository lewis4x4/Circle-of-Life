#!/usr/bin/env node
/**
 * Validates SQL migration filenames under MIGRATIONS_DIR (default: supabase/migrations).
 * Pattern: NNN_snake_case_name.sql — 3-digit prefix, contiguous from 001, no duplicates.
 */

import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const dir = process.env.MIGRATIONS_DIR
  ? path.resolve(process.env.MIGRATIONS_DIR)
  : path.resolve(process.cwd(), "supabase/migrations");

function fail(msg) {
  console.error(`[migrations:check] FAIL: ${msg}`);
  process.exit(1);
}

function ok(msg) {
  console.log(`[migrations:check] PASS: ${msg}`);
  process.exit(0);
}

if (!fs.existsSync(dir)) {
  ok(`no migrations directory at ${dir} (skipped)`);
}

const entries = fs.readdirSync(dir);
const sqlFiles = entries.filter((f) => f.endsWith(".sql"));

if (sqlFiles.length === 0) {
  ok(`no .sql files in ${dir}`);
}

const pattern = /^(\d{3})_[a-z0-9][a-z0-9_]*\.sql$/;
const nums = [];

for (const file of sqlFiles) {
  const m = file.match(pattern);
  if (!m) {
    fail(
      `invalid migration name "${file}" — expected NNN_snake_case.sql (lowercase snake after prefix)`,
    );
  }
  nums.push(Number(m[1], 10));
}

const sorted = [...nums].sort((a, b) => a - b);
const unique = new Set(sorted);
if (unique.size !== sorted.length) {
  fail("duplicate migration numeric prefix detected");
}

const min = sorted[0];
const max = sorted[sorted.length - 1];
if (min !== 1) {
  fail(`migrations must start at 001 (found minimum ${String(min).padStart(3, "0")})`);
}

for (let i = 0; i < sorted.length; i++) {
  const expected = i + 1;
  if (sorted[i] !== expected) {
    fail(
      `gap in migration sequence: expected ${String(expected).padStart(3, "0")}, found ${String(sorted[i]).padStart(3, "0")}`,
    );
  }
}

ok(`${sqlFiles.length} migration(s) in ${dir} — sequence 001..${String(max).padStart(3, "0")}`);
