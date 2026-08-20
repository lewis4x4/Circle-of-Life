import { describe, expect, it } from "vitest";

import {
  dedupeStaffDirectoryRecords,
  isSameStaffDirectoryPerson,
  pickPreferredStaffDirectoryRecord,
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

describe("isSameStaffDirectoryPerson", () => {
  it("matches rows that share the same linked user id", () => {
    const left = row({ id: "dddddddd-dddd-4ddd-8ddd-dddddddddd01", user_id: USER_ONE });
    const right = row({
      id: "dddddddd-dddd-4ddd-8ddd-dddddddddd02",
      user_id: USER_ONE,
      facility_id: FACILITY_B,
    });

    expect(isSameStaffDirectoryPerson(left, right)).toBe(true);
  });

  it("matches rows that share the same normalized email", () => {
    const left = row({
      id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1",
      email: "sample.worker@example.com",
    });
    const right = row({
      id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee2",
      email: " Sample.Worker@example.com ",
    });

    expect(isSameStaffDirectoryPerson(left, right)).toBe(true);
  });

  it("matches duplicate import rows at the same facility by name when ids differ", () => {
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

    expect(isSameStaffDirectoryPerson(seedRow, importRow)).toBe(true);
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
  it("returns one directory row when one user has two facility memberships", () => {
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

    expect(rows).toHaveLength(1);
    expect(rows[0]?.user_id).toBe(USER_ONE);
  });

  it("prefers the richer import row when seed and import rows overlap at one facility", () => {
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

    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toBe("33333333-3333-4333-8333-333333333302");
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
