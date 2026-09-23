import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Database } from "@/types/database";
import type { TimeclockPeriodData } from "@/lib/timeclock/load";

import { loadWorkforce } from "./load";

const clock = vi.hoisted(() => ({ enabled: vi.fn(), period: vi.fn(), settings: vi.fn() }));
vi.mock("@/lib/timeclock/load", () => ({ loadFacilityTimeclockEnabled: clock.enabled, loadOrganizationPayPeriod: clock.settings, loadTimeclockPeriod: clock.period }));

type Row = Record<string, unknown>;
const FACILITY = { id: "facility", name: "Synthetic facility" };
const NOW = new Date("2026-09-23T16:00:00Z");
const staff = { id: "home", first_name: "Home", last_name: "Staff", staff_role: "medication_tech", hire_date: "2026-01-01", employment_status: "active", facility_id: FACILITY.id, user_id: null, deleted_at: null };
const assigned = (id: string, date: string, schedule = "last-week", custom = true) => ({ id, staff_id: staff.id, schedule_id: schedule, facility_id: FACILITY.id, shift_date: date, shift_type: "night", status: "assigned", custom_start_time: custom ? "18:00:00" : null, custom_end_time: custom ? "06:00:00" : null, deleted_at: null });
const schedule = (id: string, week: string) => ({ id, facility_id: FACILITY.id, week_start_date: week, status: "published", deleted_at: null });
const punch = (id: string, punch_type: "in" | "out", punched_at: string, staff_id = staff.id) => ({ id, staff_id, facility_id: FACILITY.id, punch_type, punched_at, flags: [] });
let ledger: TimeclockPeriodData;

/** Real query filters and exact page counts, without any production connection. */
function database(overrides: Record<string, Row[]> = {}) {
  const tables: Record<string, Row[]> = { staff: [staff], schedules: [schedule("last-week", "2026-09-14"), schedule("this-week", "2026-09-21")], ...overrides };
  return {
    from(table: string) {
      const filters: ((row: Row) => boolean)[] = [];
      const apply = (fn: (row: Row) => boolean) => { filters.push(fn); return query; };
      const rows = () => (tables[table] ?? []).filter((row) => filters.every((fn) => fn(row)));
      const query = {
        select: () => query,
        order: () => query,
        eq: (key: string, value: unknown) => apply((row) => row[key] === value),
        neq: (key: string, value: unknown) => apply((row) => row[key] !== value),
        is: (key: string, value: unknown) => apply((row) => row[key] === value),
        in: (key: string, values: unknown[]) => apply((row) => values.includes(row[key])),
        gte: (key: string, value: string) => apply((row) => typeof row[key] === "string" && row[key] >= value),
        lt: (key: string, value: string) => apply((row) => typeof row[key] === "string" && row[key] < value),
        range: async (from: number, to: number) => ({ data: rows().slice(from, to + 1), count: rows().length, error: null }),
        then: (resolve: (result: { data: Row[]; error: null }) => unknown) => Promise.resolve({ data: rows(), error: null }).then(resolve),
      };
      return query;
    },
  } as unknown as SupabaseClient<Database>;
}

beforeEach(() => {
  vi.clearAllMocks();
  ledger = { staff: [], punches: [], corrections: [], rejections: [] };
  clock.enabled.mockResolvedValue(true);
  clock.settings.mockResolvedValue(null);
  clock.period.mockImplementation(async () => ledger);
});

describe("Workforce source loading", () => {
  it("does not report zero expected hours when no schedule was published", async () => {
    const result = await loadWorkforce(database({ schedules: [] }), FACILITY, "org", NOW);
    expect(result.people[0]).toMatchObject({ scheduledMinutes: null, scheduleMissing: true });
  });

  it("keeps archived publication history in completed-week comparisons", async () => {
    const result = await loadWorkforce(database({ schedules: [{ ...schedule("last-week", "2026-09-14"), status: "archived", published_at: "2026-09-10T12:00:00Z" }], shift_assignments: [assigned("history", "2026-09-15")] }), FACILITY, "org", NOW);
    expect(result.people[0]).toMatchObject({ scheduledMinutes: 720, scheduleMissing: false });
  });

  it("retains recorded hours and unresolved punches when the kiosk is turned off", async () => {
    clock.enabled.mockResolvedValue(false);
    ledger.punches = [punch("in", "in", "2026-09-15T11:00:00Z"), punch("out", "out", "2026-09-15T19:00:00Z"), punch("missing-out", "in", "2026-09-16T11:00:00Z")];
    const result = await loadWorkforce(database(), FACILITY, "org", NOW);
    expect(result.timeclockEnabled).toBe(false);
    expect(result.people[0]).toMatchObject({ workedMinutes: 480, exceptions: 1, timeIncomplete: true });
    expect(clock.period).toHaveBeenCalledOnce();
  });

  it("compares scheduled and recorded minutes inside the same Monday boundaries, including Sunday carry-in", async () => {
    ledger.punches = [punch("before-in", "in", "2026-09-13T22:00:00Z"), punch("before-out", "out", "2026-09-14T10:00:00Z"), punch("after-in", "in", "2026-09-20T22:00:00Z"), punch("after-out", "out", "2026-09-21T10:00:00Z")];
    const result = await loadWorkforce(database({ schedules: [schedule("before-week", "2026-09-07"), schedule("last-week", "2026-09-14")], shift_assignments: [assigned("before", "2026-09-13", "before-week"), assigned("after", "2026-09-20")] }), FACILITY, "org", NOW);
    expect(result).toMatchObject({ weekStart: "2026-09-14", weekEnd: "2026-09-20" });
    expect(result.people[0]).toMatchObject({ scheduledMinutes: 720, workedMinutes: 720 });
  });

  it("keeps missing shift times unknown instead of zero hours or unscheduled attendance", async () => {
    ledger.punches = [punch("current", "in", "2026-09-23T11:00:00Z")];
    const result = await loadWorkforce(database({ shift_assignments: [assigned("past", "2026-09-15", "last-week", false), assigned("current", "2026-09-23", "this-week", false), assigned("next", "2026-09-24", "this-week", false)] }), FACILITY, "org", NOW);
    expect(result.people[0]).toMatchObject({ scheduledMinutes: null, attendance: "unknown", currentShift: "Shift times not configured", nextShift: "2026-09-24 · Shift times not configured" });
  });

  it("does not make personnel due dates from a visiting employee's synthetic hire date", async () => {
    ledger.staff = [{ id: "visitor", name: "Visiting Staff", firstName: "Visiting", lastName: "Staff", employmentStatus: "active", facilityId: "other-facility" }];
    const requirement = { id: "requirement", facility_id: FACILITY.id, code: "onboarding", title: "Orientation", version: 1, review_status: "approved", category: "orientation", due_days: 3, applies_to_staff_roles: ["*"], deleted_at: null };
    const result = await loadWorkforce(database({ employee_file_requirements: [requirement] }), FACILITY, "org", NOW);
    expect(result.people.find((person) => person.id === "visitor")).toMatchObject({ fileStatus: "Employee file unavailable here", due: [] });
    expect(result.people.find((person) => person.id === staff.id)?.due).toEqual([{ title: "Orientation", date: "2026-01-04" }]);
  });

  it("preserves true empty and zero values when data is configured and no shift was published", async () => {
    const result = await loadWorkforce(database(), FACILITY, "org", NOW);
    expect(result.people[0]).toMatchObject({ scheduledMinutes: 0, workedMinutes: null, exceptions: 0, fileStatus: "Requirements not configured" });
  });

  it("fails when historical ledger retrieval fails even if new kiosk punches are disabled", async () => {
    clock.enabled.mockResolvedValue(false);
    clock.period.mockRejectedValue(new Error("ledger unavailable"));
    await expect(loadWorkforce(database(), FACILITY, "org", NOW)).rejects.toThrow("ledger unavailable");
  });
});
