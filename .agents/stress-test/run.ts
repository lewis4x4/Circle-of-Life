/** Deterministic high-volume domain checks. This is not a hosted load test. */
import assert from "node:assert/strict";
import {
  summarizeObservationCompliance,
  complianceRate,
  type ComplianceRow,
} from "../../src/lib/rounding/observation-compliance-summary";
import { readAllPages } from "../../src/lib/supabase/read-all-pages";

async function main() {
  // A month at a 100-resident building: four workable checks and two gaps
  // each day. Configuration gaps cannot lower staff compliance at any cut.
  const rows: ComplianceRow[] = [];
  for (let resident = 0; resident < 100; resident++) {
    for (let day = 1; day <= 30; day++) {
      for (let window = 0; window < 6; window++) {
        rows.push({
          resident_id: `fixture-${resident}`,
          service_date: `2026-09-${String(day).padStart(2, "0")}`,
          window_key: `window-${window}`,
          shift_key: `shift-${window % 3}`,
          task_id: window < 4 ? `task-${resident}-${day}-${window}` : null,
          task_status: window < 3 ? "completed_on_time" : "missed",
          satisfied: window < 3,
          absorbed: false,
          expectation_source: window === 4 ? "no_cadence" : window === 5 ? "orphaned_shift" : "standard_task",
        });
      }
    }
  }
  // Simulate a hosted cap below the requested page size.
  let pages = 0;
  const loaded = await readAllPages(async (from) => {
    pages++;
    return { data: rows.slice(from, from + 137), count: rows.length, error: null };
  });
  assert.equal(loaded.data.length, 18000);
  assert.equal(pages, 132);
  assert.deepEqual(loaded.data, rows);
  const summary = summarizeObservationCompliance({
    from: "2026-09-01", to: "2026-09-30", rows: loaded.data,
    shiftLabels: new Map(), hallByResident: new Map(), staffByTask: new Map(),
  });
  assert.equal(summary.totals.expected, 12000);
  assert.equal(summary.totals.satisfied, 9000);
  assert.equal(summary.totals.unconfigured, 6000);
  assert.equal(complianceRate(summary.totals), 0.75);
  for (const cuts of [summary.byShift, summary.byHall, summary.byStaff]) {
    assert.equal(cuts.reduce((sum, cut) => sum + cut.expected, 0), 12000);
    assert.equal(cuts.reduce((sum, cut) => sum + cut.unconfigured, 0), 6000);
  }
  console.log("PASS\t18,000 compliance rows retained through 132 capped pages; every cut excludes configuration gaps");

  await assert.rejects(readAllPages(async (from) => ({
    data: rows.slice(from, from + 137), count: from === 0 ? rows.length : rows.length - 1, error: null,
  })), /Records changed/);
  await assert.rejects(readAllPages(async (from) => ({
    data: from === 0 ? rows.slice(0, 137) : [], count: rows.length, error: null,
  })), /Incomplete records/);
  console.log("PASS\tChanging or interrupted pagination fails instead of presenting partial compliance");
}

main().catch((error) => {
  console.error("FAIL\t", error);
  process.exitCode = 1;
});
