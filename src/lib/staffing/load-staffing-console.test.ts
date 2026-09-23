import { describe, expect, it } from "vitest";

import { buildDedupedStaffPickerOptions, type StaffDirectorySourceRow } from "@/lib/staff/load-staff";

const FACILITY_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
const USER_ONE = "cccccccc-cccc-4ccc-8ccc-ccccccccccc1";

function row(
  overrides: Partial<StaffDirectorySourceRow> & Pick<StaffDirectorySourceRow, "id">,
): StaffDirectorySourceRow {
  return {
    facility_id: FACILITY_A,
    user_id: null,
    first_name: "Sample",
    last_name: "Worker",
    email: null,
    photo_url: null,
    staff_role: "resident_aide",
    employment_status: "active",
    updated_at: "2026-08-01T12:00:00.000Z",
    deleted_at: null,
    ...overrides,
  };
}

describe("fetchStaffOptions dedupe contract", () => {
  it("retains both employment records when names match", () => {
    const options = buildDedupedStaffPickerOptions([
      row({
        id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbb001",
        first_name: "Sample",
        last_name: "Admin",
      }),
      row({
        id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbb002",
        first_name: "Sample",
        last_name: "Admin",
        email: "sample.admin@example.com",
      }),
    ]);

    expect(options).toHaveLength(2);
  });

  it("lists two options for two distinct active people", () => {
    const options = buildDedupedStaffPickerOptions([
      row({ id: "cccccccc-cccc-4ccc-8ccc-cccccccccc01", first_name: "Alpha", last_name: "One" }),
      row({ id: "cccccccc-cccc-4ccc-8ccc-cccccccccc02", first_name: "Beta", last_name: "Two" }),
    ]);

    expect(options).toHaveLength(2);
  });

  it("sorts picker labels alphabetically", () => {
    const options = buildDedupedStaffPickerOptions([
      row({ id: "dddddddd-dddd-4ddd-8ddd-dddddddddd01", first_name: "Zed", last_name: "Last" }),
      row({ id: "dddddddd-dddd-4ddd-8ddd-dddddddddd02", first_name: "Alpha", last_name: "First" }),
    ]);

    expect(options.map((option) => option.label)).toEqual(["Alpha First", "Zed Last"]);
  });

  it("excludes inactive rows after dedupe", () => {
    const options = buildDedupedStaffPickerOptions([
      row({
        id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeee01",
        user_id: USER_ONE,
        employment_status: "on_leave",
      }),
      row({
        id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeee02",
        user_id: USER_ONE,
        employment_status: "active",
      }),
    ]);

    expect(options).toHaveLength(1);
    expect(options[0]?.id).toBe("eeeeeeee-eeee-4eee-8eee-eeeeeeeeee02");
  });
});

describe("fetchShiftAssignmentGaps (COL-710)", () => {
  it("does not count scheduled (assigned/confirmed) shifts as gaps", async () => {
    const { fakeSupabase } = await import("@/test-utils/fake-supabase");
    const { fetchShiftAssignmentGaps } = await import("./load-staffing-console");
    const shifts = [
      { id: "s1", staff_id: "p1", shift_date: "2026-09-24", shift_type: "day", status: "assigned" },
      { id: "s2", staff_id: "p1", shift_date: "2026-09-24", shift_type: "day", status: "confirmed" },
      { id: "s3", staff_id: "p2", shift_date: "2026-09-24", shift_type: "night", status: "called_out" },
      { id: "s4", staff_id: "p3", shift_date: "2026-09-25", shift_type: "evening", status: "swap_requested" },
    ];
    const { client, calls } = fakeSupabase((call) => {
      if (call.table === "shift_assignments") {
        const statusFilter = call.ops.find(([op, args]) => op === "in" && args[0] === "status");
        const allowed = (statusFilter?.[1][1] as string[] | undefined) ?? [];
        return { data: shifts.filter((s) => allowed.includes(s.status)) };
      }
      return {
        data: [
          { id: "p1", staff_role: "cna" },
          { id: "p2", staff_role: "cna" },
          { id: "p3", staff_role: "medication_tech" },
        ],
      };
    });
    const gaps = await fetchShiftAssignmentGaps(null, client);
    expect(gaps.map((g) => g.urgency)).toEqual(["critical", "warning"]);
    expect(gaps.reduce((n, g) => n + g.shortage, 0)).toBe(2);
    const statusFilter = calls[0]!.ops.find(([op, args]) => op === "in" && args[0] === "status");
    expect(statusFilter?.[1][1]).not.toContain("assigned");
  });
});
