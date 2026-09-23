import { describe, expect, it } from "vitest";

import { findLapsedWithoutSuccessor, type LapsePolicyInput } from "./coverage-lapse";

const base: LapsePolicyInput = {
  id: "p",
  entity_id: "e1",
  policy_type: "workers_comp",
  policy_number: "WC-1",
  carrier_name: "Carrier",
  status: "active",
  effective_date: "2025-07-19",
  expiration_date: "2026-07-19",
};

describe("findLapsedWithoutSuccessor (COL-649)", () => {
  it("reports a workers' comp term that ended with no successor", () => {
    const lapsed = findLapsedWithoutSuccessor([{ ...base, status: "expired" }], "2026-09-23", new Map([["e1", "Homewood LLC"]]));
    expect(lapsed).toHaveLength(1);
    expect(lapsed[0]!.entity_name).toBe("Homewood LLC");
  });

  it("treats a past expiration as ended even when the status still says active", () => {
    expect(findLapsedWithoutSuccessor([base], "2026-09-23")).toHaveLength(1);
  });

  it("is quiet when a successor of the same type is in force for the entity", () => {
    const successor = { ...base, id: "p2", effective_date: "2026-07-19", expiration_date: "2027-07-19" };
    expect(findLapsedWithoutSuccessor([{ ...base, status: "expired" }, successor], "2026-09-23")).toEqual([]);
  });

  it("does not let another entity's or another type's policy count as a successor", () => {
    const otherEntity = { ...base, id: "p2", entity_id: "e2", effective_date: "2026-07-19", expiration_date: "2027-07-19" };
    const otherType = { ...base, id: "p3", policy_type: "property" as const, effective_date: "2026-07-19", expiration_date: "2027-07-19" };
    expect(findLapsedWithoutSuccessor([base, otherEntity, otherType], "2026-09-23").map((p) => p.id)).toEqual(["p"]);
  });

  it("reports only the latest ended term per entity and type", () => {
    const older = { ...base, id: "old", effective_date: "2024-07-19", expiration_date: "2025-07-19", status: "expired" as const };
    expect(findLapsedWithoutSuccessor([older, base], "2026-09-23").map((p) => p.id)).toEqual(["p"]);
  });

  it("ignores drafts and policies still in force", () => {
    expect(findLapsedWithoutSuccessor([{ ...base, status: "draft" }], "2026-09-23")).toEqual([]);
    expect(findLapsedWithoutSuccessor([base], "2026-07-19")).toEqual([]);
  });
});
