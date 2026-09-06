import { describe, expect, it } from "vitest";

import {
  canAttest,
  daysUntilCutoff,
  migrationComplete,
  rollupFromStatuses,
} from "./drive-cutover";

describe("canAttest", () => {
  it("allows senior admins only", () => {
    expect(canAttest("owner")).toBe(true);
    expect(canAttest("org_admin")).toBe(true);
    expect(canAttest("facility_admin")).toBe(true);
    expect(canAttest("manager")).toBe(false);
    expect(canAttest("caregiver")).toBe(false);
    expect(canAttest(null)).toBe(false);
  });
});

describe("daysUntilCutoff", () => {
  it("counts whole days to the cutoff", () => {
    expect(daysUntilCutoff("2026-07-01", new Date("2026-06-21T12:00:00Z"))).toBe(10);
    expect(daysUntilCutoff("2026-07-01", new Date("2026-07-01T08:00:00Z"))).toBe(0);
    expect(daysUntilCutoff("2026-07-01", new Date("2026-07-05T00:00:00Z"))).toBe(-4);
  });
});

describe("rollupFromStatuses / migrationComplete", () => {
  it("tallies statuses", () => {
    const r = rollupFromStatuses(["imported", "imported", "pending", "failed", "skipped", "mapped"]);
    expect(r).toMatchObject({ files: 6, imported: 2, pending: 1, failed: 1, skipped: 1, mapped: 1 });
  });

  it("requires verified content, not processed bookmarks", () => {
    expect(migrationComplete({ batches: 1, ...rollupFromStatuses(["imported", "skipped"]) })).toBe(false);
    expect(migrationComplete({ batches: 1, ...rollupFromStatuses(["imported", "pending"]) })).toBe(false);
    expect(migrationComplete({ batches: 0, ...rollupFromStatuses([]) })).toBe(false);
  });
});
