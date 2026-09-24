import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { fetchShiftAssignmentGaps } from "./load-staffing-console";
import { todayFacilityDateIso } from "@/lib/facility-wall-clock";
const facility = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
function source() {
  const today = todayFacilityDateIso();
  const base = { facility_id: facility, schedule_id: "schedule", shift_date: today, shift_type: "day", custom_start_time: null, custom_end_time: null, deleted_at: null };
  const rows: Record<string, Record<string, unknown>[]> = {
    shift_assignments: [{ ...base, id: "normal", staff_id: "one", status: "assigned" }, { ...base, id: "gap", staff_id: "two", status: "called_out" }],
    staff: [{ id: "one", staff_role: "resident_aide", deleted_at: null }, { id: "two", staff_role: "resident_aide", deleted_at: null }],
    facility_shift_definitions: [{ facility_id: facility, shift_key: "day", label: "Day", starts_at_local: "06:00:00", ends_at_local: "18:00:00", sort_order: 0, roster_shift_type: "day", active: true, deleted_at: null }],
  };
  return { from(table: string) {
    let result = [...(rows[table] ?? [])];
    const query = {
      select: () => query, order: () => query,
      is: (key: string, value: unknown) => { result = result.filter((row) => row[key] === value); return query; },
      eq: (key: string, value: unknown) => { result = result.filter((row) => row[key] === value); return query; },
      in: (key: string, values: unknown[]) => { result = result.filter((row) => values.includes(row[key])); return query; },
      gte: (key: string, value: string) => { result = result.filter((row) => String(row[key]) >= value); return query; },
      lte: (key: string, value: string) => { result = result.filter((row) => String(row[key]) <= value); return query; },
      then: (resolve: (value: unknown) => unknown) => Promise.resolve(resolve({ data: result, error: null })),
    };
    return query;
  } } as unknown as SupabaseClient<Database>;
}
describe("staffing coverage gaps", () => {
  it("counts the called-out employee and leaves the normal assigned shift filled", async () => {
    const rows = await fetchShiftAssignmentGaps(facility, source());
    expect(rows).toHaveLength(1);
    expect(rows[0].shortage).toBe(1);
    expect(rows[0].urgency).toBe("critical");
  });
  it("shows the building's configured 12-hour shift instead of hardcoded 7–3", async () => {
    const rows = await fetchShiftAssignmentGaps(facility, source());
    expect(rows[0].shift).toBe("Day 6:00AM–6:00PM");
  });
});
