/**
 * COL-649 ratchet: no new false all-clears.
 *
 * Every file may contain at most the findings recorded for it in
 * `false-all-clear-baseline.json` (the debt that existed when the guard
 * landed). A new `?? 0` on a rendered metric, `count ?? 0`, empty-list →
 * "current", or unguarded "All clear" copy fails here.
 *
 * Fix it with `@/lib/metrics/metric-state`: pass a `MetricState` to
 * StatCard / KpiCard / MetricCard / KPITile (`state={metricFromCount(...)}`),
 * and gate reassuring copy on `canClaimAllClear(...)`.
 *
 * If a finding is genuinely not a displayed metric (a pagination total, an
 * accumulator), put `false-all-clear-ok: <why>` on that line or the line
 * above instead of leaving it in the baseline.
 *
 * After removing debt, shrink the baseline:
 *   UPDATE_FALSE_ALL_CLEAR_BASELINE=1 npx vitest run src/lib/metrics/false-all-clear.source.test.ts
 * Never regenerate it to admit a new finding.
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { scanRepo, type FalseAllClearCounts, type FalseAllClearRule } from "./false-all-clear-scan";

const BASELINE_PATH = path.join(process.cwd(), "src/lib/metrics/false-all-clear-baseline.json");

function readBaseline(): FalseAllClearCounts {
  return JSON.parse(readFileSync(BASELINE_PATH, "utf8")) as FalseAllClearCounts;
}

describe("false all-clear ratchet (COL-649)", () => {
  const { findings, counts } = scanRepo(process.cwd());

  if (process.env.UPDATE_FALSE_ALL_CLEAR_BASELINE === "1") {
    const baseline = readBaseline();
    const shrunk: FalseAllClearCounts = {};
    for (const [file, rules] of Object.entries(counts).sort(([a], [b]) => a.localeCompare(b))) {
      const sortedRules = (Object.entries(rules) as Array<[FalseAllClearRule, number]>).sort(([a], [b]) =>
        a.localeCompare(b),
      );
      for (const [rule, n] of sortedRules) {
        // Only ever shrink: a file cannot gain allowance by regenerating.
        const allowed = Math.min(n, baseline[file]?.[rule] ?? 0);
        if (allowed > 0) (shrunk[file] ??= {})[rule] = allowed;
      }
    }
    writeFileSync(BASELINE_PATH, `${JSON.stringify(shrunk, null, 2)}\n`);
  }

  const baseline = readBaseline();

  it("adds no new silent zeros, count-or-zero, empty-is-ok or unguarded all-clear copy", () => {
    const over: string[] = [];
    for (const [file, rules] of Object.entries(counts)) {
      for (const [rule, n] of Object.entries(rules) as Array<[FalseAllClearRule, number]>) {
        const allowed = baseline[file]?.[rule] ?? 0;
        if (n > allowed) {
          const lines = findings
            .filter((f) => f.file === file && f.rule === rule)
            .map((f) => `    ${f.file}:${f.line}  ${f.snippet}`)
            .join("\n");
          over.push(`${file} — ${rule}: ${n} found, ${allowed} allowed\n${lines}`);
        }
      }
    }
    expect(
      over,
      "A value slot would show a confident 0 / 100% / all-clear when nothing was read. " +
        "Use MetricState (src/lib/metrics/metric-state.ts) and canClaimAllClear instead.",
    ).toEqual([]);
  });

  it("keeps the empty-list → green mapping at zero", () => {
    expect(findings.filter((f) => f.rule === "empty-is-ok")).toEqual([]);
  });
});
