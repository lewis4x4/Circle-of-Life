import { describe, expect, it } from "vitest";

import {
  buildDedupedStaffPickerOptions,
  countUniqueActiveStaffDirectoryRecords,
  dedupeStaffDirectoryRecords,
  isSameStaffDirectoryPerson,
  pickPreferredStaffDirectoryRecord,
  staffUpcomingShiftCutoffIso,
  type StaffDirectorySourceRow,
} from "./load-staff";

const FACILITY_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
const FACILITY_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2";
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
    staff_role: "resident_aide",
    employment_status: "active",
    photo_url: null,
    updated_at: "2026-08-01T12:00:00.000Z",
    deleted_at: null,
    ...overrides,
  };
}

describe("staffUpcomingShiftCutoffIso", () => {
  /** 8:05 PM Eastern on 2026-08-20 (EDT, UTC−4) — after the UTC date rolls to tomorrow. */
  const eightOhFivePmEt = new Date("2026-08-20T20:05:00-04:00");

  it("anchors upcoming-shift gte on Eastern calendar today, not UTC ISO slice", () => {
    expect(staffUpcomingShiftCutoffIso(eightOhFivePmEt)).toBe("2026-08-20");
    expect(staffUpcomingShiftCutoffIso(eightOhFivePmEt)).not.toBe("2026-08-21");
    expect(eightOhFivePmEt.toISOString().slice(0, 10)).toBe("2026-08-21");
  });
});

describe("isSameStaffDirectoryPerson", () => {
  it("preserves employment identities that share the same linked user id", () => {
    const left = row({ id: "dddddddd-dddd-4ddd-8ddd-dddddddddd01", user_id: USER_ONE });
    const right = row({
      id: "dddddddd-dddd-4ddd-8ddd-dddddddddd02",
      user_id: USER_ONE,
      facility_id: FACILITY_B,
    });

    expect(isSameStaffDirectoryPerson(left, right)).toBe(false);
  });

  it("does not infer employment identity from normalized email", () => {
    const left = row({
      id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1",
      email: "sample.worker@example.com",
    });
    const right = row({
      id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee2",
      email: " Sample.Worker@example.com ",
    });

    expect(isSameStaffDirectoryPerson(left, right)).toBe(false);
  });

  it("preserves same-name rows at the same facility when IDs differ", () => {
    const seedRow = row({
      id: "ffffffff-ffff-4fff-8fff-fffffffffff1",
      first_name: "Sample",
      last_name: "Admin",
      staff_role: "assistant_administrator",
    });
    const importRow = row({
      id: "ffffffff-ffff-4fff-8fff-fffffffffff2",
      first_name: "Sample",
      last_name: "Admin",
      email: "sample.admin@example.com",
      staff_role: "administrator",
      updated_at: "2026-08-10T12:00:00.000Z",
    });

    expect(isSameStaffDirectoryPerson(seedRow, importRow)).toBe(false);
  });

  it("does not merge different people who share a name across facilities", () => {
    const left = row({
      id: "11111111-1111-4111-8111-111111111101",
      first_name: "Shared",
      last_name: "Name",
      facility_id: FACILITY_A,
    });
    const right = row({
      id: "11111111-1111-4111-8111-111111111102",
      first_name: "Shared",
      last_name: "Name",
      facility_id: FACILITY_B,
    });

    expect(isSameStaffDirectoryPerson(left, right)).toBe(false);
  });
});

describe("dedupeStaffDirectoryRecords", () => {
  it("retains each employment when a user has two facility memberships", () => {
    const rows = dedupeStaffDirectoryRecords([
      row({
        id: "22222222-2222-4222-8222-222222222201",
        user_id: USER_ONE,
        facility_id: FACILITY_A,
      }),
      row({
        id: "22222222-2222-4222-8222-222222222202",
        user_id: USER_ONE,
        facility_id: FACILITY_B,
      }),
    ]);

    expect(rows).toHaveLength(2);
    expect(rows[0]?.user_id).toBe(USER_ONE);
  });

  it("preserves original and imported employment relationships for review", () => {
    const rows = dedupeStaffDirectoryRecords([
      row({
        id: "33333333-3333-4333-8333-333333333301",
        first_name: "Sample",
        last_name: "Admin",
        staff_role: "assistant_administrator",
        updated_at: "2026-05-01T12:00:00.000Z",
      }),
      row({
        id: "33333333-3333-4333-8333-333333333302",
        first_name: "Sample",
        last_name: "Admin",
        email: "sample.admin@example.com",
        user_id: USER_ONE,
        staff_role: "administrator",
        updated_at: "2026-08-10T12:00:00.000Z",
      }),
    ]);

    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.id)).toEqual(["33333333-3333-4333-8333-333333333301", "33333333-3333-4333-8333-333333333302"]);
  });

  it("keeps distinct people separate", () => {
    const rows = dedupeStaffDirectoryRecords([
      row({ id: "44444444-4444-4444-8444-444444444401", first_name: "Alpha", last_name: "One" }),
      row({ id: "44444444-4444-4444-8444-444444444402", first_name: "Beta", last_name: "Two" }),
    ]);

    expect(rows).toHaveLength(2);
  });
});

describe("pickPreferredStaffDirectoryRecord", () => {
  it("breaks ties on updated_at when retention scores match", () => {
    const older = row({
      id: "55555555-5555-4555-8555-555555555501",
      email: "sample.worker@example.com",
      updated_at: "2026-08-01T12:00:00.000Z",
    });
    const newer = row({
      id: "55555555-5555-4555-8555-555555555502",
      email: "sample.worker@example.com",
      updated_at: "2026-08-20T12:00:00.000Z",
    });

    expect(pickPreferredStaffDirectoryRecord(older, newer).id).toBe(newer.id);
  });
});

describe("countUniqueActiveStaffDirectoryRecords", () => {
  it("counts both active employment records sharing a user ID", () => {
    const count = countUniqueActiveStaffDirectoryRecords([
      row({
        id: "66666666-6666-4666-8666-666666666601",
        user_id: USER_ONE,
        employment_status: "active",
      }),
      row({
        id: "66666666-6666-4666-8666-666666666602",
        user_id: USER_ONE,
        employment_status: "active",
      }),
    ]);

    expect(count).toBe(2);
  });

  it("counts distinct active employment records with a shared name", () => {
    const count = countUniqueActiveStaffDirectoryRecords([
      row({
        id: "77777777-7777-4777-8777-777777777701",
        first_name: "Sample",
        last_name: "Admin",
        employment_status: "active",
      }),
      row({
        id: "77777777-7777-4777-8777-777777777702",
        first_name: "Sample",
        last_name: "Admin",
        email: "sample.admin@example.com",
        employment_status: "active",
      }),
    ]);

    expect(count).toBe(2);
  });

  it("keeps two distinct active people separate", () => {
    const count = countUniqueActiveStaffDirectoryRecords([
      row({ id: "88888888-8888-4888-8888-888888888801", first_name: "Alpha", last_name: "One" }),
      row({ id: "88888888-8888-4888-8888-888888888802", first_name: "Beta", last_name: "Two" }),
    ]);

    expect(count).toBe(2);
  });

  it("keeps a posted zero when no active people remain after dedupe", () => {
    const count = countUniqueActiveStaffDirectoryRecords([
      row({
        id: "99999999-9999-4999-8999-999999999901",
        user_id: USER_ONE,
        employment_status: "on_leave",
      }),
      row({
        id: "99999999-9999-4999-8999-999999999902",
        user_id: USER_ONE,
        employment_status: "terminated",
      }),
    ]);

    expect(count).toBe(0);
  });
});

describe("buildDedupedStaffPickerOptions", () => {
  it("retains picker options for each employment sharing a user ID", () => {
    const options = buildDedupedStaffPickerOptions([
      row({
        id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa01",
        user_id: USER_ONE,
        first_name: "Sample",
        last_name: "Picker",
      }),
      row({
        id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa02",
        user_id: USER_ONE,
        first_name: "Sample",
        last_name: "Picker",
      }),
    ]);

    expect(options).toHaveLength(2);
    expect(options[0]?.label).toBe("Sample Picker");
  });
});
