import { describe, expect, it } from "vitest";
import { assignmentSpan, attendanceState, type WorkforceAssignment } from "./model";
const row: WorkforceAssignment = { id: "1", staff_id: "1", schedule_id: "1", shift_date: "2026-09-23", shift_type: "night", status: "assigned", custom_start_time: "18:00:00", custom_end_time: "06:00:00" };
describe("Workforce schedule comparison", () => {
  it("keeps an overnight assignment on its service date and ends next morning", () => {
    const span = assignmentSpan(row, []);
    expect(span?.start.toISOString()).toBe("2026-09-23T22:00:00.000Z");
    expect(span?.end.toISOString()).toBe("2026-09-24T10:00:00.000Z");
  });
  it("uses configured times when actual custom times are absent", () => {
    const span = assignmentSpan({ ...row, custom_start_time: null, custom_end_time: null }, [{ shiftKey: "night", label: "Night", rosterShiftType: "night", startsAtLocal: "18:00:00", endsAtLocal: "06:00:00", sortOrder: 1 }]);
    expect(span?.label).toBe("Night 6:00PM–6:00AM");
  });
  it("does not invent default times when configuration is missing", () => expect(assignmentSpan({ ...row, custom_start_time: null, custom_end_time: null }, [])).toBeNull());
  it("does not count a normal assigned and present employee as a gap", () => expect(attendanceState(true, true, false)).toBe("expected"));
  it("separates missing, unscheduled, and called-out staff", () => {
    expect(attendanceState(true, false, false)).toBe("missing");
    expect(attendanceState(false, true, false)).toBe("extra");
    expect(attendanceState(true, false, true)).toBe("called_out");
  });
});
