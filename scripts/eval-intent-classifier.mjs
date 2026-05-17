#!/usr/bin/env node
/**
 * Eval harness for the haven-ai-router intent classifier (KB-NEXT-01).
 *
 * Posts each question in `tests/ai-router/intent-test-set.json` to the
 * deployed router with `?dry_run=intent_only`, which short-circuits
 * dispatch + audit and returns only the classification.
 *
 * Required env:
 *   ROUTER_URL  — full URL to the deployed Edge Function
 *                 e.g. https://manfqmasfqppukpobpld.supabase.co/functions/v1/haven-ai-router
 *   ROUTER_JWT  — a valid Supabase user JWT (an operator with a profile in
 *                 user_profiles works fine). The router requires verify_jwt.
 *
 * Output: a per-question table and an aggregate accuracy line. Exit code 0 if
 * accuracy >= 0.85, else 1.
 *
 * This script is run manually after deployment (the router needs the live
 * Anthropic key). It is not part of the segment:gates bundle.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const testSetPath = resolve(__dirname, "..", "tests", "ai-router", "intent-test-set.json");

const ROUTER_URL = process.env.ROUTER_URL;
const ROUTER_JWT = process.env.ROUTER_JWT;
const TARGET_ACCURACY = Number(process.env.ROUTER_EVAL_TARGET ?? "0.85");

if (!ROUTER_URL || !ROUTER_JWT) {
  console.error("ROUTER_URL and ROUTER_JWT env vars are required.");
  console.error("Example:");
  console.error("  ROUTER_URL=https://<project>.supabase.co/functions/v1/haven-ai-router \\");
  console.error("  ROUTER_JWT=eyJhbGciOi... node scripts/eval-intent-classifier.mjs");
  process.exit(2);
}

const testSet = JSON.parse(readFileSync(testSetPath, "utf8"));
const dryUrl = `${ROUTER_URL.replace(/\/$/, "")}?dry_run=intent_only`;

let correct = 0;
let total = 0;
const rows = [];

for (const item of testSet.questions) {
  total += 1;
  let actual = "(error)";
  let confidence = 0;
  let secondary = null;
  let ok = false;
  try {
    const res = await fetch(dryUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${ROUTER_JWT}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ question: item.question }),
    });
    const json = await res.json();
    if (!res.ok || !json.ok) {
      actual = `(http ${res.status}: ${json.error ?? "no error"})`;
    } else {
      actual = json.intent;
      confidence = Number(json.confidence ?? 0);
      secondary = json.secondary ?? null;
      ok = true;
    }
  } catch (err) {
    actual = `(fetch failed: ${err instanceof Error ? err.message : String(err)})`;
  }

  const expected = item.expected_intent;
  const match = ok && actual === expected;
  if (match) correct += 1;
  rows.push({
    question: item.question,
    expected,
    actual,
    confidence,
    secondary,
    match,
  });
}

const accuracy = total > 0 ? correct / total : 0;
const acceptable = accuracy >= TARGET_ACCURACY;

console.log("\nIntent classifier eval");
console.log("======================");
for (const r of rows) {
  const mark = r.match ? "PASS" : "FAIL";
  const sec = r.secondary ? ` (secondary=${r.secondary})` : "";
  const conf = r.confidence ? ` conf=${r.confidence.toFixed(2)}` : "";
  console.log(`[${mark}] expected=${r.expected.padEnd(15)} actual=${String(r.actual).padEnd(15)}${conf}${sec}`);
  console.log(`        Q: ${r.question}`);
}
console.log("");
console.log(`Total: ${total}`);
console.log(`Correct: ${correct}`);
console.log(`Accuracy: ${(accuracy * 100).toFixed(1)}%`);
console.log(`Target: ${(TARGET_ACCURACY * 100).toFixed(1)}%`);
console.log(`Verdict: ${acceptable ? "PASS" : "FAIL"}`);

process.exit(acceptable ? 0 : 1);
