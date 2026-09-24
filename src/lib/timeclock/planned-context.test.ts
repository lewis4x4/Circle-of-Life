import { afterEach, describe, expect, it, vi } from "vitest";
import { loadKioskPlannedContext } from "./planned-context";
import { fetchScheduleAssignmentIntervals, type ScheduleAssignmentInterval } from "@/lib/schedules/assignment-context";
import type { createServiceRoleClient } from "@/lib/supabase/service-role";
vi.mock("@/lib/schedules/assignment-context", () => ({ fetchScheduleAssignmentIntervals: vi.fn() }));
const fetch = vi.mocked(fetchScheduleAssignmentIntervals);
const STAFF = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", FACILITY = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const verified = { staff_id: STAFF, facility_id: FACILITY };
const client = {} as ReturnType<typeof createServiceRoleClient>;
const now = new Date("2026-09-24T18:00:00Z");
const block = (start: string, end: string, index: number): ScheduleAssignmentInterval => ({ assignment_id: `assignment-${index}`, schedule_id: "schedule", staff_id: STAFF, facility_id: FACILITY, service_date: "2026-09-24", starts_at: start, ends_at: end, time_zone: "America/New_York", preset_id: "preset", preset_version: 2, label: "Kitchen split", color: "#338866", staff_role: "cook", group_id: "group", block_index: index, block_count: 2, legacy_shift_type: "custom", status: "assigned", is_legacy: false });
afterEach(() => { vi.clearAllMocks(); vi.useRealTimers(); });
describe("verified kiosk planned context", () => {
  it("returns only this verified staff/facility's published blocks without internal identity fields", async () => {
    fetch.mockResolvedValue([block("2026-09-24T10:00:00Z", "2026-09-24T17:00:00Z", 0), block("2026-09-24T20:00:00Z", "2026-09-24T22:00:00Z", 1), { ...block("2026-09-24T10:00:00Z", "2026-09-24T17:00:00Z", 0), staff_id: "other" }]);
    const result = await loadKioskPlannedContext(client, verified, now);
    expect(fetch).toHaveBeenCalledWith(client, expect.objectContaining({ staffId: STAFF, facilityId: FACILITY }));
    expect(result.status).toBe("ready");
    if (result.status === "ready") { expect(result.blocks).toHaveLength(2); expect(result.blocks[0]).toMatchObject({ label: "Kitchen split", block_index: 0, block_count: 2 }); }
    expect(JSON.stringify(result)).not.toContain(STAFF); expect(JSON.stringify(result)).not.toContain("assignment-");
  });
  it("distinguishes unavailable from a successfully empty schedule", async () => {
    fetch.mockRejectedValueOnce(new Error("RLS or network"));
    expect(await loadKioskPlannedContext(client, verified, now)).toEqual({ status: "unavailable" });
    fetch.mockResolvedValueOnce([]);
    expect(await loadKioskPlannedContext(client, verified, now)).toEqual({ status: "ready", blocks: [] });
    expect(await loadKioskPlannedContext(client, {}, now)).toEqual({ status: "unavailable" });
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it("limits schedule lookup delay without changing clock actions", async () => {
    vi.useFakeTimers(); fetch.mockImplementationOnce(() => new Promise(() => {}));
    const result = loadKioskPlannedContext(client, verified, now);
    await vi.advanceTimersByTimeAsync(1500);
    expect(await result).toEqual({ status: "unavailable" });
  });
});
