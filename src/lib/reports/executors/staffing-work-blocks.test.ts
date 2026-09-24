import { describe, expect, it } from "vitest";
import { executeReportTemplate } from "./index";

describe("staffing coverage uses saved work blocks", () => {
  it("retains a custom named split option and excludes its gap from scheduled hours", async () => {
    const base = { shift_type: "custom", shift_date: "2026-09-24", staff_id: "staff", facility_id: "facility", schedule_preset_id: "cook", schedule_preset_name: "Cook", schedule_preset_version: 1, schedule_role_snapshot: "dietary_staff", schedule_time_zone: "America/New_York", schedule_group_id: "group" };
    const rows = [
      { ...base, id: "am", custom_start_time: "06:00", custom_end_time: "13:00", schedule_starts_at: "2026-09-24T10:00:00Z", schedule_ends_at: "2026-09-24T17:00:00Z" },
      { ...base, id: "pm", custom_start_time: "16:00", custom_end_time: "18:00", schedule_starts_at: "2026-09-24T20:00:00Z", schedule_ends_at: "2026-09-24T22:00:00Z" },
    ];
    const filters: [string, unknown][] = [];
    const supabase = { from(table: string) { const query = {
      select: () => query, is: () => query, gte: () => query, lte: () => query, order: () => query, in: () => query,
      eq: (key: string, value: unknown) => { filters.push([key, value]); return query; },
      range: () => Promise.resolve({ data: rows, count: rows.length, error: null }),
      then: (resolve: (value: unknown) => unknown) => Promise.resolve({ data: table === "staff" ? [{ id: "staff", first_name: "Sample", last_name: "Cook" }] : [], error: null }).then(resolve),
    }; return query; } };
    const report = await executeReportTemplate("staffing-coverage-by-shift", { supabase: supabase as never, organizationId: "org", facilityId: null });
    expect(filters).toContainEqual(["schedules.status", "published"]);
    expect(report.summary).toEqual([
      { metricKey: "shiftAssignmentsScheduled14d", value: 1 },
      { metricKey: "scheduledWorkBlocks14d", value: 2 },
      { metricKey: "scheduledWorkHours14d", value: 9 },
    ]);
    expect(report.rows.map((row) => row.shift_name)).toEqual(["Cook", "Cook"]);
  });
});
