#!/usr/bin/env node
/**
 * 07A level engine parity: every case in src/lib/care-events/level-cases.json
 * must produce byte-identical level, derived_level, category, flags and
 * sentence from public.care_event_derive (402) and the TypeScript engine.
 * The TypeScript side is covered by vitest; this script checks SQL against the
 * fixture's `expect` block. Binding contract: docs/specs/07A-level-engine-contract.md.
 *
 * Skips cleanly (exit 0) when the fixture is missing or CARE_EVENT_PARITY_DB_URL
 * is unset, so `npm run test` stays green on machines without the local stack.
 *
 *   CARE_EVENT_PARITY_DB_URL=postgresql://postgres@127.0.0.1:57432/haven \
 *     node scripts/care-events/verify-level-parity.mjs
 *
 * CARE_EVENT_PARITY_PSQL overrides the psql binary (default: `psql` on PATH).
 * Never point this at a hosted project: it only SELECTs, but the fixture is
 * test data and the local stack is the contract's stated target.
 */

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const TAG = "[care-events:parity]";
const root = process.cwd();
const fixturePath = path.join(root, "src", "lib", "care-events", "level-cases.json");
const dbUrl = process.env.CARE_EVENT_PARITY_DB_URL;
const psqlBin = process.env.CARE_EVENT_PARITY_PSQL || "psql";
const COMPARE_KEYS = ["level", "derived_level", "category", "flags", "sentence"];

if (!fs.existsSync(fixturePath)) {
  console.log(`${TAG} SKIP: no fixture file`);
  process.exit(0);
}
if (!dbUrl) {
  console.log(`${TAG} SKIP: CARE_EVENT_PARITY_DB_URL not set`);
  process.exit(0);
}

let cases;
try {
  cases = JSON.parse(fs.readFileSync(fixturePath, "utf8"));
} catch (error) {
  console.error(`${TAG} FAIL: could not parse ${fixturePath}: ${error.message}`);
  process.exit(1);
}
if (!Array.isArray(cases) || cases.length === 0) {
  console.error(`${TAG} FAIL: fixture is not a non-empty array`);
  process.exit(1);
}

const ids = new Set();
for (const c of cases) {
  if (!c || typeof c.id !== "string" || typeof c.kind !== "string" || typeof c.expect !== "object") {
    console.error(`${TAG} FAIL: malformed case ${JSON.stringify(c).slice(0, 200)}`);
    process.exit(1);
  }
  if (ids.has(c.id)) {
    console.error(`${TAG} FAIL: duplicate case id ${c.id}`);
    process.exit(1);
  }
  ids.add(c.id);
}

// One statement: the cases travel as a JSON literal, each row is
// "<id>\t<derive json>" (psql -At with the field separator set to a tab).
const payload = JSON.stringify(
  cases.map((c) => ({ id: c.id, kind: c.kind, answers: c.answers ?? {}, context: c.context ?? {} })),
);
const literal = payload.replace(/'/g, "''");
const sql = `
SELECT c.value ->> 'id',
       public.care_event_derive(c.value ->> 'kind', c.value -> 'answers', c.value -> 'context')::text
FROM jsonb_array_elements('${literal}'::jsonb) WITH ORDINALITY AS c(value, ordinality)
ORDER BY c.ordinality;
`;

const run = spawnSync(psqlBin, [dbUrl, "-X", "-At", "-F", "\t", "-v", "ON_ERROR_STOP=1", "-c", sql], {
  encoding: "utf8",
  maxBuffer: 64 * 1024 * 1024,
});
if (run.error) {
  console.error(`${TAG} FAIL: could not run ${psqlBin}: ${run.error.message}`);
  process.exit(1);
}
if (run.status !== 0) {
  console.error(`${TAG} FAIL: psql exited ${run.status}\n${run.stderr}`);
  process.exit(1);
}

const actualById = new Map();
for (const line of run.stdout.split("\n")) {
  if (!line.trim()) continue;
  const tab = line.indexOf("\t");
  if (tab < 0) {
    console.error(`${TAG} FAIL: unexpected output line: ${line}`);
    process.exit(1);
  }
  const id = line.slice(0, tab);
  const json = line.slice(tab + 1);
  try {
    actualById.set(id, JSON.parse(json));
  } catch (error) {
    console.error(`${TAG} FAIL: case ${id}: SQL returned non-JSON: ${json}`);
    process.exit(1);
  }
}

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

const mismatches = [];
for (const c of cases) {
  const actual = actualById.get(c.id);
  if (!actual) {
    mismatches.push({ id: c.id, key: "<row>", expected: "a result row", actual: "missing" });
    continue;
  }
  for (const key of COMPARE_KEYS) {
    const expected = c.expect[key];
    const got = actual[key];
    if (canonical(expected) !== canonical(got)) {
      mismatches.push({ id: c.id, key, expected: canonical(expected), actual: canonical(got) });
    }
  }
}

if (mismatches.length > 0) {
  console.error(`${TAG} FAIL: ${mismatches.length} mismatch(es) across ${cases.length} cases`);
  for (const m of mismatches) {
    console.error(`  ${m.id} :: ${m.key}\n    expected ${m.expected}\n    actual   ${m.actual}`);
  }
  process.exit(1);
}

console.log(`${TAG} PASS (${cases.length} cases)`);
