#!/usr/bin/env -S deno run --env-file=.env.local --allow-env --allow-net --allow-read
/// <reference lib="deno.ns" />
// ^ scripts/ sits outside supabase/functions/deno.json; without this the
//   imported Edge Function modules typecheck as browser code.
/**
 * eval-kb-rerank — measure the KB reranker against a labelled fixture.
 *
 * There was no existing measurement for this. `eval-rrf-hybrid.mjs` is often
 * mistaken for one: it exercises the SQL RRF fusion, mentions rerank zero
 * times, and needs a Docker container we do not run on this machine.
 *
 * This runs in-process against `tests/kb-rerank/rerank-fixture.json`, which is
 * synthetic and PHI-free (facility policy and Florida ALF regulation only).
 * Candidates are stored in simulated RRF order, so "none" below is the honest
 * no-rerank baseline rather than a shuffle.
 *
 * Usage:
 *   npm run eval:kb-rerank                    # every engine with a key
 *   npm run eval:kb-rerank -- --engine typesafe
 *
 * Exit code 0 when every engine that ran beat the no-rerank baseline on top-1.
 */

import { rerankWithTypeSafe } from "../supabase/functions/_shared/typesafe-rerank.ts";
import { rerankWithCohere } from "../supabase/functions/_shared/cohere-rerank.ts";

type Candidate = { id: string; source_title: string; excerpt: string };
type Case = { query: string; correct_id: string; candidates: Candidate[] };

const fixtureUrl = new URL("../tests/kb-rerank/rerank-fixture.json", import.meta.url);
const fixture = JSON.parse(await Deno.readTextFile(fixtureUrl)) as { cases: Case[] };

type Engine = "none" | "cohere" | "typesafe";

function parseEngines(): Engine[] {
  const idx = Deno.args.indexOf("--engine");
  if (idx !== -1 && Deno.args[idx + 1]) {
    const value = Deno.args[idx + 1] as Engine;
    if (!["none", "cohere", "typesafe"].includes(value)) {
      console.error(`Unknown engine '${value}'.`);
      Deno.exit(2);
    }
    return ["none", value];
  }
  const engines: Engine[] = ["none"];
  if (Deno.env.get("COHERE_API_KEY")) engines.push("cohere");
  else console.error("Skipping cohere: COHERE_API_KEY is not set.");
  if (Deno.env.get("TYPESAFE_API_KEY")) engines.push("typesafe");
  else console.error("Skipping typesafe: TYPESAFE_API_KEY is not set.");
  return engines;
}

async function rank(engine: Engine, testCase: Case): Promise<Candidate[]> {
  if (engine === "none") return testCase.candidates;
  if (engine === "cohere") return await rerankWithCohere(testCase.query, testCase.candidates);
  const result = await rerankWithTypeSafe(testCase.query, testCase.candidates, {});
  if (!result) throw new Error("typesafe reranker declined or failed");
  return result;
}

type Outcome = { query: string; rank: number; latencyMs: number };

async function runEngine(engine: Engine): Promise<Outcome[]> {
  const outcomes: Outcome[] = [];
  for (const testCase of fixture.cases) {
    const startedAt = performance.now();
    const ranked = await rank(engine, testCase);
    const position = ranked.findIndex((c) => c.id === testCase.correct_id);
    outcomes.push({
      query: testCase.query,
      rank: position === -1 ? Number.POSITIVE_INFINITY : position + 1,
      latencyMs: performance.now() - startedAt,
    });
  }
  return outcomes;
}

function topN(outcomes: Outcome[], n: number): number {
  return outcomes.filter((o) => o.rank <= n).length / outcomes.length;
}

/** Mean reciprocal rank — rewards moving the answer up even when not to #1. */
function mrr(outcomes: Outcome[]): number {
  const total = outcomes.reduce((sum, o) => sum + (Number.isFinite(o.rank) ? 1 / o.rank : 0), 0);
  return total / outcomes.length;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

const results = new Map<Engine, Outcome[]>();
for (const engine of parseEngines()) {
  console.log(`\nrunning ${engine}...`);
  results.set(engine, await runEngine(engine));
}

console.log("\n\n=== KB rerank ===");
console.log(`${fixture.cases.length} queries, ${fixture.cases[0].candidates.length} candidates each\n`);
console.log("engine      top-1    top-3     MRR    median latency");
console.log("------------------------------------------------------");
for (const [engine, outcomes] of results) {
  console.log(
    `${engine.padEnd(11)} ${(topN(outcomes, 1) * 100).toFixed(0).padStart(4)}%   ` +
      `${(topN(outcomes, 3) * 100).toFixed(0).padStart(4)}%   ` +
      `${mrr(outcomes).toFixed(3)}   ` +
      `${median(outcomes.map((o) => o.latencyMs)).toFixed(0).padStart(6)}ms`,
  );
}

const baseline = results.get("none")!;
console.log("\nper-query rank of the correct passage (lower is better)");
for (let i = 0; i < fixture.cases.length; i += 1) {
  const cells = [...results.entries()]
    .map(([engine, outcomes]) => `${engine}=${outcomes[i].rank}`)
    .join("  ");
  console.log(`  ${cells}   ${fixture.cases[i].query}`);
}

let pass = true;
for (const [engine, outcomes] of results) {
  if (engine === "none") continue;
  if (topN(outcomes, 1) <= topN(baseline, 1)) {
    console.log(`\nFAIL: ${engine} did not beat the no-rerank baseline on top-1.`);
    pass = false;
  }
}
console.log(`\nVerdict: ${pass ? "PASS" : "FAIL"}`);
Deno.exit(pass ? 0 : 1);
