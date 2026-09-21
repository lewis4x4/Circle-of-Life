import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { bedMoveErrorMessage, classifyBedMoveOptions, loadBedMoveSnapshot, type BedMoveBed } from "./bed-move";

const bed = (overrides: Partial<BedMoveBed> = {}): BedMoveBed => ({ id: "b1", bed_label: "A", status: "available", current_resident_id: null, reserved_for_admission_case_id: null, is_temporarily_blocked: false, blocked_reason: null, rooms: { room_number: "101", deleted_at: null }, ...overrides });
const resident = { id: "r1", bed_id: "old", first_name: "Ada", last_name: "Test" };

describe("bed move conflicts", () => {
  it("blocks canonical occupants even if the bed says available", () => {
    expect(classifyBedMoveOptions([bed()], [resident, { id: "r2", bed_id: "b1", first_name: "Alex", last_name: "Test" }], "r1")[0].conflict).toBe("Occupied by Alex Test");
  });
  it.each([
    [{ current_resident_id: "r2" }, "Assignment conflict"],
    [{ id: "old" }, "Current bed"],
    [{ reserved_for_admission_case_id: "admission" }, "Reserved for an admission"],
    [{ status: "hold" }, "On hold"],
    [{ is_temporarily_blocked: true, blocked_reason: "Room repair" }, "Temporarily blocked — Room repair"],
    [{ is_temporarily_blocked: true }, "Temporarily blocked"],
    [{ status: "maintenance" }, "Maintenance"],
    [{ status: "offline" }, "Out of service"],
    [{ status: "occupied" }, "Occupied"],
    [{ status: "future-status" }, "Unavailable"],
    [{ rooms: null }, "Room unavailable"],
    [{ rooms: { room_number: "101", deleted_at: "2026-09-20" } }, "Room unavailable"],
  ] satisfies [Partial<BedMoveBed>, string][])("blocks %j", (overrides, conflict) => {
    expect(classifyBedMoveOptions([bed(overrides)], [resident], "r1")[0].conflict).toContain(conflict);
  });
  it("allows only an available bed without claims", () => {
    expect(classifyBedMoveOptions([bed()], [resident], "r1")[0].conflict).toBeNull();
  });
});

function client(beds: unknown, residents: unknown) {
  return { from: (table: string) => {
    if (table === "facilities") {
      const query = { select: () => query, eq: () => query, is: () => query, maybeSingle: () => Promise.resolve({ data: { name: "Test facility" }, error: null }) };
      return query;
    }
    const response = table === "beds" ? beds : residents;
    const query = { select: vi.fn(), eq: vi.fn(), is: vi.fn(), in: vi.fn(), then: (resolve: (value: unknown) => void) => Promise.resolve(response).then(resolve) };
    for (const key of ["select", "eq", "is", "in"] as const) query[key].mockReturnValue(query);
    return query;
  } } as unknown as SupabaseClient<Database>;
}
describe("availability loader", () => {
  it("uses the freshly read resident assignment", async () => {
    const result = await loadBedMoveSnapshot(client({ data: [bed()], count: 1 }, { data: [resident], count: 1 }), "facility", "r1");
    expect(result.currentBedId).toBe("old");
    expect(result.facilityName).toBe("Test facility");
    expect(result.options).toHaveLength(1);
  });
  it.each([
    { data: null, count: null, error: { message: "offline" } },
    { data: [], count: 2 },
    { data: [], count: null },
  ])("fails closed for failed or incomplete reads", async (response) => {
    await expect(loadBedMoveSnapshot(client({ data: [bed()], count: 1 }, response), "facility", "r1")).rejects.toThrow("could not be verified");
  });
  it("does not enable moving an unreadable or no longer current resident", async () => {
    await expect(loadBedMoveSnapshot(client({ data: [bed()], count: 1 }, { data: [], count: 0 }), "facility", "r1")).rejects.toThrow("no longer on the active");
  });
  it("translates plain PostgREST errors without leaking SQL internals", () => {
    expect(bedMoveErrorMessage({ message: "expected bed mismatch" })).toContain("assignment changed");
    expect(bedMoveErrorMessage({ message: "no longer available" })).toContain("choose another bed");
    expect(bedMoveErrorMessage({ message: "permission denied" })).toContain("permission");
    expect(bedMoveErrorMessage({ message: "Current bed assignment authority required" })).toContain("permission");
    expect(bedMoveErrorMessage({ message: "SQL secret internal" })).not.toContain("SQL");
  });
});
