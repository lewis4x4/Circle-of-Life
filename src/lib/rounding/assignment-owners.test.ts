import { describe, expect, it, vi } from "vitest";
import { assignGeneratedTaskOwners } from "./assignment-owners";
import type { GeneratedTaskInput } from "./types";

const task = (residentId: string, dueAt: string) => ({ residentId, dueAt, graceEndsAt: dueAt, notes: null }) as GeneratedTaskInput;

describe("task owners follow each due instant", () => {
  it("deduplicates residents per instant and leaves a split gap unassigned", async () => {
    const morning = "2026-09-24T12:00:00Z"; const gap = "2026-09-24T18:00:00Z";
    const rpc = vi.fn((_name, args) => Promise.resolve({ data: args.p_resident_ids.map((resident_id: string) => ({ resident_id, staff_id: args.p_at === morning ? "eligible" : null, shift_assignment_id: args.p_at === morning ? "morning-block" : null })), error: null }));
    const tasks = [task("resident", morning), task("resident", morning), task("resident", gap)];
    await assignGeneratedTaskOwners({ rpc } as never, "facility", tasks);
    expect(rpc).toHaveBeenCalledTimes(2);
    expect(tasks.map((item) => item.shiftAssignmentId)).toEqual(["morning-block", "morning-block", null]);
    expect(tasks.map((item) => item.dueAt)).toEqual([morning, morning, gap]);
  });
  it("fails closed on incomplete owner resolution", async () => {
    const rpc = vi.fn(() => Promise.resolve({ data: [], error: null }));
    await expect(assignGeneratedTaskOwners({ rpc } as never, "facility", [task("resident", "2026-09-24T12:00:00Z")])).rejects.toThrow("Incomplete");
  });
});
