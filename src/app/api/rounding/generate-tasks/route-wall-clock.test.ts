import { describe, expect, it, vi } from "vitest";
import { assignGeneratedTaskOwners } from "@/lib/rounding/assignment-owners";
import type { GeneratedTaskInput } from "@/lib/rounding/types";

describe("rounding task generation ownership across local midnight", () => {
  it.each([
    ["eastern-facility", "2026-08-20T20:05:00-04:00", "2026-08-21T00:05:00.000Z"],
    ["tokyo-facility", "2026-08-21T00:05:00+09:00", "2026-08-20T15:05:00.000Z"],
  ])("keeps the exact due instant for %s instead of guessing a shift date", async (facilityId, localTime, expectedInstant) => {
    const dueAt = new Date(localTime).toISOString();
    const tasks = [{ residentId: "resident", dueAt, graceEndsAt: dueAt }] as GeneratedTaskInput[];
    const rpc = vi.fn().mockResolvedValue({
      data: [{ resident_id: "resident", staff_id: "eligible-person", shift_assignment_id: "saved-work-block" }],
      error: null,
    });

    await assignGeneratedTaskOwners({ rpc } as never, facilityId, tasks);

    expect(rpc).toHaveBeenCalledWith("resolve_observation_task_assignees_for_instant", {
      p_facility_id: facilityId,
      p_at: expectedInstant,
      p_resident_ids: ["resident"],
    });
    expect(tasks[0]).toMatchObject({ dueAt: expectedInstant, assignedStaffId: "eligible-person", shiftAssignmentId: "saved-work-block" });
  });
});
