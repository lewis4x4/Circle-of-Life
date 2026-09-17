#!/usr/bin/env -S deno run --allow-env --allow-net --allow-read
/// <reference lib="deno.ns" />
// ^ scripts/ sits outside supabase/functions/deno.json, which is where the
//   Edge Function sources get their `deno.ns` lib from. Without this the
//   imported modules typecheck as browser code and every `Deno.env` fails.
/**
 * eval-router-intent — compare the router's two intent engines on the same
 * labelled set, in-process.
 *
 * The older `eval-intent-classifier.mjs` posts to a *deployed* router with
 * `?dry_run=intent_only`, so it needs the function shipped and a live operator
 * JWT. This one imports the classifier directly: nothing is deployed, no JWT,
 * and both engines see byte-identical inputs — which is the only way an
 * accuracy difference means anything.
 *
 * Usage:
 *   TYPESAFE_API_KEY=... ANTHROPIC_API_KEY=... \
 *     deno run --allow-env --allow-net --allow-read scripts/eval-router-intent.ts
 *
 *   # one engine only
 *   deno run ... scripts/eval-router-intent.ts --engine typesafe
 *
 * Exit code: 0 when every engine run clears ROUTER_EVAL_TARGET (default 0.85).
 *
 * Read the calibration table, not just the accuracy line. `index.ts` gates
 * speculative dispatch on `confidence < 0.7`, so a classifier that is right
 * 85% of the time but *certain* when it is wrong is worse in production than
 * one that is right 85% of the time and hedges on the misses.
 */

import {
  classifyIntent,
  type IntentEngine,
  type RouterIntent,
} from "../supabase/functions/_shared/router-intent.ts";

type TestCase = {
  question: string;
  expected_intent: RouterIntent;
  notes?: string;
};

type Row = {
  question: string;
  expected: RouterIntent;
  actual: RouterIntent;
  secondary: RouterIntent | null;
  confidence: number;
  latencyMs: number;
  match: boolean;
};

const TARGET = Number(Deno.env.get("ROUTER_EVAL_TARGET") ?? "0.85");
const SPECULATIVE_DISPATCH_THRESHOLD = 0.7; // mirrors haven-ai-router/index.ts

function parseEngines(): IntentEngine[] {
  const idx = Deno.args.indexOf("--engine");
  if (idx !== -1 && Deno.args[idx + 1]) {
    const value = Deno.args[idx + 1];
    if (value !== "typesafe" && value !== "anthropic") {
      console.error(`Unknown engine '${value}'. Use typesafe or anthropic.`);
      Deno.exit(2);
    }
    return [value];
  }
  return ["anthropic", "typesafe"];
}

function requireKeyFor(engine: IntentEngine): boolean {
  const name = engine === "typesafe" ? "TYPESAFE_API_KEY" : "ANTHROPIC_API_KEY";
  if (Deno.env.get(name)) return true;
  console.error(`Skipping ${engine}: ${name} is not set.`);
  return false;
}

async function runEngine(engine: IntentEngine, cases: TestCase[]): Promise<Row[]> {
  const rows: Row[] = [];
  // Sequential on purpose: 20 questions is not worth a 429, and the per-call
  // latency below is only meaningful without contention.
  for (const testCase of cases) {
    const startedAt = performance.now();
    let actual = "refuse" as RouterIntent;
    let secondary: RouterIntent | null = null;
    let confidence = 0;
    try {
      const result = await classifyIntent(testCase.question, {
        engine,
        userRole: "owner",
      });
      actual = result.intent;
      secondary = result.secondary ?? null;
      confidence = result.confidence;
    } catch (err) {
      console.error(`  ! ${engine} threw: ${String(err)}`);
    }
    rows.push({
      question: testCase.question,
      expected: testCase.expected_intent,
      actual,
      secondary,
      confidence,
      latencyMs: performance.now() - startedAt,
      match: actual === testCase.expected_intent,
    });
  }
  return rows;
}

function accuracy(rows: Row[]): number {
  return rows.length === 0 ? 0 : rows.filter((r) => r.match).length / rows.length;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

/**
 * Accuracy within each confidence band. A well-calibrated classifier is right
 * more often in the higher bands; a self-reported one is often flat.
 */
function calibration(rows: Row[]): string[] {
  const bands: Array<[string, (c: number) => boolean]> = [
    ["0.00-0.50", (c) => c < 0.5],
    ["0.50-0.70", (c) => c >= 0.5 && c < 0.7],
    ["0.70-0.90", (c) => c >= 0.7 && c < 0.9],
    ["0.90-1.00", (c) => c >= 0.9],
  ];
  return bands.map(([label, inBand]) => {
    const inside = rows.filter((r) => inBand(r.confidence));
    if (inside.length === 0) return `  ${label}   n=0`;
    const correct = inside.filter((r) => r.match).length;
    const pct = ((correct / inside.length) * 100).toFixed(0).padStart(3);
    return `  ${label}   n=${String(inside.length).padStart(2)}  correct=${pct}%`;
  });
}

function report(engine: IntentEngine, rows: Row[]): boolean {
  console.log(`\n\n=== ${engine} ===`);
  for (const row of rows) {
    const mark = row.match ? "PASS" : "FAIL";
    const sec = row.secondary ? ` secondary=${row.secondary}` : "";
    console.log(
      `[${mark}] expected=${row.expected.padEnd(15)} actual=${row.actual.padEnd(15)}` +
        ` conf=${row.confidence.toFixed(2)}${sec}`,
    );
    if (!row.match) console.log(`        Q: ${row.question}`);
  }

  const acc = accuracy(rows);
  const misses = rows.filter((r) => !r.match);
  // The misses that hurt most: wrong AND confident enough to suppress the
  // speculative fallback in index.ts.
  const confidentMisses = misses.filter(
    (r) => r.confidence >= SPECULATIVE_DISPATCH_THRESHOLD,
  ).length;

  console.log("");
  console.log(`Accuracy:          ${(acc * 100).toFixed(1)}%  (${rows.length} questions)`);
  console.log(`Median latency:    ${median(rows.map((r) => r.latencyMs)).toFixed(0)}ms`);
  console.log(`Confident misses:  ${confidentMisses}  (wrong at confidence >= ${SPECULATIVE_DISPATCH_THRESHOLD})`);
  console.log("Calibration:");
  for (const line of calibration(rows)) console.log(line);

  const pass = acc >= TARGET;
  console.log(`Verdict:           ${pass ? "PASS" : "FAIL"} (target ${(TARGET * 100).toFixed(1)}%)`);
  return pass;
}

const testSetPath = new URL("../tests/ai-router/intent-test-set.json", import.meta.url);
const testSet = JSON.parse(await Deno.readTextFile(testSetPath)) as { questions: TestCase[] };

const engines = parseEngines().filter(requireKeyFor);
if (engines.length === 0) {
  console.error("No engine could run. Set ANTHROPIC_API_KEY and/or TYPESAFE_API_KEY.");
  Deno.exit(2);
}

const results = new Map<IntentEngine, Row[]>();
let allPassed = true;
for (const engine of engines) {
  const rows = await runEngine(engine, testSet.questions);
  results.set(engine, rows);
  if (!report(engine, rows)) allPassed = false;
}

// Side-by-side disagreements: where the engines differ is where to look first.
if (results.size === 2) {
  const anthropic = results.get("anthropic")!;
  const typesafe = results.get("typesafe")!;
  console.log("\n\n=== disagreements ===");
  let printed = 0;
  for (let i = 0; i < anthropic.length; i += 1) {
    if (anthropic[i].actual === typesafe[i].actual) continue;
    printed += 1;
    console.log(`\nQ: ${anthropic[i].question}`);
    console.log(`   expected:  ${anthropic[i].expected}`);
    console.log(`   anthropic: ${anthropic[i].actual} (conf ${anthropic[i].confidence.toFixed(2)})`);
    console.log(`   typesafe:  ${typesafe[i].actual} (conf ${typesafe[i].confidence.toFixed(2)})`);
  }
  if (printed === 0) console.log("(none — the engines agreed on every question)");
}

Deno.exit(allPassed ? 0 : 1);
