import { afterEach, describe, expect, it } from "vitest";

import type { FacilityShiftDefinition } from "@/lib/caregiver/shift";

import {
  cacheOnCallPhone,
  fetchMyResidentIds,
  fetchOnCallPhone,
  filterMyResidents,
  onCallCacheKey,
  readCachedOnCallPhone,
  selectAssignedResidentIds,
  selectLocationChips,
  selectOnCallPhone,
  type LocationVocabRow,
} from "./report-data";

const FACILITY = "f-homewood";

function vocab(overrides: Partial<LocationVocabRow> & { value_code: string }): LocationVocabRow {
  return {
    display_label: overrides.value_code,
    display_order: 0,
    is_oof: false,
    facility_id: null,
    ...overrides,
  };
}

describe("selectLocationChips", () => {
  it("puts facility rows first, then org rows, by display order, and caps at six", () => {
    const rows = [
      vocab({ value_code: "dining", display_order: 2 }),
      vocab({ value_code: "hallway", display_order: 1 }),
      vocab({ value_code: "resident_room", display_order: 0 }),
      vocab({ value_code: "porch", display_order: 9, facility_id: FACILITY }),
      vocab({ value_code: "bathroom", display_order: 3 }),
      vocab({ value_code: "lobby", display_order: 4 }),
      vocab({ value_code: "kitchen", display_order: 5 }),
      vocab({ value_code: "outside", display_order: 6 }),
    ];
    const chips = selectLocationChips(rows, FACILITY);
    expect(chips.map((chip) => chip.code)).toEqual(["porch", "resident_room", "hallway", "dining", "bathroom", "lobby"]);
  });

  it("drops OOF rows, other facilities, and duplicate codes", () => {
    const rows = [
      vocab({ value_code: "oof_hospital", is_oof: true }),
      vocab({ value_code: "resident_room", facility_id: "f-other" }),
      vocab({ value_code: "resident_room", display_label: "Resident Room", facility_id: FACILITY }),
      vocab({ value_code: "resident_room", display_label: "Room (org)" }),
    ];
    const chips = selectLocationChips(rows, FACILITY);
    expect(chips).toEqual([{ code: "resident_room", label: "Resident Room" }]);
  });
});

describe("my residents", () => {
  it("combines only the assignments already selected by their work intervals", () => {
    const rows = [
      { shift_type: "day", assigned_resident_ids: ["a", "b"], status: "confirmed" },
      { shift_type: "evening", assigned_resident_ids: ["c"], status: "assigned" },
    ];
    expect(selectAssignedResidentIds(rows)).toEqual(["a", "b", "c"]);
  });

  it("ignores called-out and no-show rows and null lists", () => {
    const rows = [
      { shift_type: "day", assigned_resident_ids: ["a"], status: "called_out" },
      { shift_type: "day", assigned_resident_ids: null, status: "confirmed" },
    ];
    expect(selectAssignedResidentIds(rows)).toEqual([]);
  });

  it("filters the census by assigned ids and keeps census order", () => {
    const everyone = [{ id: "a" }, { id: "b" }, { id: "c" }];
    expect(filterMyResidents(everyone, ["c", "a"])).toEqual([{ id: "a" }, { id: "c" }]);
    expect(filterMyResidents(everyone, [])).toEqual([]);
  });
});

describe("selectOnCallPhone", () => {
  it("takes the current shift primary and honors phone_override", () => {
    const rows = [
      { shift_type: "night", is_primary: false, phone_override: null, staff_phone: "555-0003" },
      { shift_type: "night", is_primary: true, phone_override: "555-0999", staff_phone: "555-0001" },
      { shift_type: "day", is_primary: true, phone_override: null, staff_phone: "555-0002" },
    ];
    expect(selectOnCallPhone(rows, "night")).toBe("555-0999");
  });

  it("falls back to the staff phone, then to another shift, then null", () => {
    expect(
      selectOnCallPhone(
        [
          { shift_type: "night", is_primary: true, phone_override: "  ", staff_phone: "555-0001" },
          { shift_type: "night", is_primary: false, phone_override: null, staff_phone: "555-0003" },
        ],
        "night",
      ),
    ).toBe("555-0001");
    expect(selectOnCallPhone([{ shift_type: "day", is_primary: true, phone_override: null, staff_phone: "555-0002" }], "night")).toBe("555-0002");
    expect(selectOnCallPhone([{ shift_type: "night", is_primary: true, phone_override: null, staff_phone: null }], "night")).toBeNull();
    expect(selectOnCallPhone([], "night")).toBeNull();
  });
});

describe("on-call cache", () => {
  afterEach(() => {
    window.localStorage.clear();
  });

  it("stores only the phone under the facility key and clears on null", () => {
    cacheOnCallPhone(FACILITY, "555-0100");
    expect(window.localStorage.getItem(onCallCacheKey(FACILITY))).toBe("555-0100");
    expect(readCachedOnCallPhone(FACILITY)).toBe("555-0100");
    cacheOnCallPhone(FACILITY, null);
    expect(readCachedOnCallPhone(FACILITY)).toBeNull();
  });
});

describe("the three-tap report reads the facility's configured shift (COL-685)", () => {
  const TWELVE_HOUR: FacilityShiftDefinition[] = [
    { shiftKey: "day", label: "Day", startsAtLocal: "06:00:00", endsAtLocal: "18:00:00", sortOrder: 0, rosterShiftType: "day" },
    { shiftKey: "night", label: "Night", startsAtLocal: "18:00:00", endsAtLocal: "06:00:00", sortOrder: 1, rosterShiftType: "night" },
  ];

  function recordingClient(tables: Record<string, unknown[]>) {
    const eqs: Array<{ table: string; column: string; value: unknown }> = [];
    const rpcs: Array<{ name: string; args: Record<string, unknown> }> = [];
    const client = {
      rpc(name: string, args: Record<string, unknown>) {
        rpcs.push({ name, args });
        const q = { order: () => q, range: () => Promise.resolve({ data: [{ assignment_id: "night-block" }], count: 1, error: null }) };
        return q;
      },
      from(table: string) {
        const builder = {
          select: () => builder,
          maybeSingle: () => Promise.resolve({ data: tables[table]?.[0] ?? null, error: null }),
          eq: (column: string, value: unknown) => {
            eqs.push({ table, column, value });
            return builder;
          },
          in: () => builder,
          is: () => builder,
          then: (resolve: (value: { data: unknown[]; error: null }) => unknown) =>
            Promise.resolve({ data: tables[table] ?? [], error: null }).then(resolve),
        };
        return builder;
      },
    };
    return { client: client as unknown as Parameters<typeof fetchMyResidentIds>[0], eqs, rpcs };
  }

  it("at 1 AM reads the night shift's assignments dated the evening before", async () => {
    const { client, rpcs } = recordingClient({
      staff: [{ id: "staff-1" }],
      shift_assignments: [
        { shift_type: "night", assigned_resident_ids: ["r-night"], status: "assigned" },
      ],
    });
    const ids = await fetchMyResidentIds(client, {
      userId: "user-1",
      facilityId: "facility-1",
      timeZone: "America/New_York",
      shifts: TWELVE_HOUR,
      now: new Date("2026-09-15T05:00:00.000Z"),
    });
    expect(ids).toEqual(["r-night"]);
    expect(rpcs).toContainEqual({ name: "schedule_assignment_intervals", args: { p_facility_id: "facility-1", p_staff_id: "staff-1", p_from: "2026-09-15T05:00:00.000Z", p_to: "2026-09-15T05:00:00.001Z" } });
  });

  it("at 10 PM prefers the night on-call row over the day one", async () => {
    const { client, eqs } = recordingClient({
      on_call_schedules: [
        { staff_id: "s-day", shift_type: "day", is_primary: true, phone_override: "111" },
        { staff_id: "s-night", shift_type: "night", is_primary: true, phone_override: "222" },
      ],
      staff: [],
    });
    const phone = await fetchOnCallPhone(client, {
      facilityId: "facility-1",
      timeZone: "America/New_York",
      shifts: TWELVE_HOUR,
      now: new Date("2026-09-15T02:00:00.000Z"),
    });
    expect(phone).toBe("222");
    expect(eqs).toContainEqual({ table: "on_call_schedules", column: "shift_date", value: "2026-09-14" });
  });
});
