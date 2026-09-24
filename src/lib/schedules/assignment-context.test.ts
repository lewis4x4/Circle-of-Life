import { describe, expect, it, vi } from "vitest";
import { assignmentIntervalSpan, currentAssignmentInterval, fetchScheduleAssignmentIntervals, formatAssignmentInterval, type ScheduleAssignmentInterval } from "./assignment-context";

const block = (start: string, end: string): ScheduleAssignmentInterval => ({ assignment_id: start, schedule_id: "week", staff_id: "staff", facility_id: "facility", service_date: "2026-09-24", starts_at: start, ends_at: end, time_zone: "America/New_York", preset_id: "cook", preset_version: 1, label: "Cook", color: "#008000", staff_role: "dietary_staff", group_id: "group", block_index: 0, block_count: 2, legacy_shift_type: "custom", status: "assigned", is_legacy: false });

describe("published assignment intervals", () => {
  it("keeps a split gap off and observes half-open boundaries", () => {
    const rows = [block("2026-09-24T10:00:00Z", "2026-09-24T17:00:00Z"), block("2026-09-24T20:00:00Z", "2026-09-24T22:00:00Z")];
    expect(currentAssignmentInterval(rows, new Date("2026-09-24T17:00:00Z"))).toBeNull();
    expect(currentAssignmentInterval(rows, new Date("2026-09-24T20:00:00Z"))?.assignment_id).toBe(rows[1].assignment_id);
    expect(currentAssignmentInterval([rows[0], rows[0]], new Date("2026-09-24T12:00:00Z"))).toBeNull();
  });
  it("uses saved instants, label and zone rather than changed local fields", () => {
    const span = assignmentIntervalSpan({ shift_date: "2026-09-24", shift_type: "custom", custom_start_time: "09:00", custom_end_time: "10:00", schedule_preset_name: "Saved", schedule_time_zone: "America/Chicago", schedule_starts_at: "2026-09-24T11:00:00Z", schedule_ends_at: "2026-09-24T18:00:00Z" });
    expect(span?.label).toBe("Saved");
    expect((span!.end.getTime() - span!.start.getTime()) / 3600000).toBe(7);
    expect(span?.timeZone).toBe("America/Chicago");
  });
  it("does not repair incomplete snapshot evidence with local time guesses", () => {
    expect(assignmentIntervalSpan({ shift_date: "2026-09-24", custom_start_time: "06:00", custom_end_time: "13:00", schedule_starts_at: "2026-09-24T10:00:00Z" })).toBeNull();
  });
  it("formats overnight dates explicitly", () => {
    expect(formatAssignmentInterval(block("2026-09-24T22:00:00Z", "2026-09-25T10:00:00Z"))).toContain("ends 2026-09-25");
  });
  it("requires a staff scope when no facility is selected", async () => {
    const rpc = vi.fn();
    await expect(fetchScheduleAssignmentIntervals({ rpc } as never, { facilityId: null, from: "2026-09-24", to: "2026-09-25" })).rejects.toThrow("verified staff scope");
    expect(rpc).not.toHaveBeenCalled();
  });
  it("reconciles all RPC pages when the server cap is smaller than requested", async () => {
    const rows = [block("2026-09-24T10:00:00Z", "2026-09-24T17:00:00Z"), block("2026-09-24T20:00:00Z", "2026-09-24T22:00:00Z")];
    const rpc = vi.fn(() => { const query = { order: () => query, range: (from: number) => Promise.resolve({ data: rows.slice(from, from + 1), count: 2, error: null }) }; return query; });
    expect(await fetchScheduleAssignmentIntervals({ rpc } as never, { facilityId: null, staffId: "staff", from: "2026-09-24", to: "2026-09-25" })).toEqual(rows);
    expect(rpc).toHaveBeenCalledWith("schedule_assignment_intervals", expect.objectContaining({ p_facility_id: null, p_staff_id: "staff" }), { count: "exact" });
  });
});
