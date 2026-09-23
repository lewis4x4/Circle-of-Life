import { describe, expect, it } from "vitest";

import { ALLOWED_GAPS, checkMigrationSequence } from "./check-migration-order.mjs";

const files = (...nums) => nums.map((n) => `${String(n).padStart(3, "0")}_step_${n}.sql`);
const allowed = { 3: "retired for the test" };

describe("migration sequence allowed gaps", () => {
  it("passes when the only gap is on the allowed list", () => {
    const result = checkMigrationSequence(files(1, 2, 4, 5), allowed);
    expect(result.ok).toBe(true);
    expect(result.message).toContain("allowed gaps: 003");
    expect(result.notices).toEqual([]);
  });

  it("fails on a gap that is not on the allowed list", () => {
    const result = checkMigrationSequence(files(1, 2, 3, 5), allowed);
    expect(result.ok).toBe(false);
    expect(result.message).toContain("004 is missing");
  });

  it("passes with a cleanup notice once an allowed number has a real file", () => {
    const result = checkMigrationSequence(files(1, 2, 3, 4), allowed);
    expect(result.ok).toBe(true);
    expect(result.notices).toEqual([
      "allowed gap 003 now has a migration file; delete its entry from ALLOWED_GAPS in scripts/check-migration-order.mjs",
    ]);
  });

  it("still rejects duplicates and bad names", () => {
    expect(checkMigrationSequence(["001_a.sql", "001_b.sql"], allowed).ok).toBe(false);
    expect(checkMigrationSequence(["001_A.sql"], allowed).ok).toBe(false);
  });

  it("records a reason for every allowed gap", () => {
    for (const reason of Object.values(ALLOWED_GAPS)) {
      expect(reason.length).toBeGreaterThan(20);
    }
  });
});
