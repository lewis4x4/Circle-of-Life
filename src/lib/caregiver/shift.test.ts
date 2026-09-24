import { describe, expect, it } from "vitest";

import { formatCaregiverTasksShiftBucket } from "@/lib/caregiver/tasks-display-copy";
import { currentShiftFor, nextShiftFor, type FacilityShiftDefinition } from "@/lib/caregiver/shift";

const TZ = "America/New_York";
// Every Circle of Life building's configuration on 2026-09-23: 6a–6p day, 6p–6a night.
const TWELVE_HOUR: FacilityShiftDefinition[] = [
  { shiftKey: "day", label: "Day", startsAtLocal: "06:00:00", endsAtLocal: "18:00:00", sortOrder: 0, rosterShiftType: "day" },
  { shiftKey: "night", label: "Night", startsAtLocal: "18:00:00", endsAtLocal: "06:00:00", sortOrder: 1, rosterShiftType: "night" },
];

describe("currentShiftFor", () => {
  it("follows the facility's configured shifts, not fixed 8-hour buckets (COL-659)", () => {
    // The audit: header "Day shift" at 17:14 ET while the page said "EVENING SHIFT".
    const at1714 = new Date("2026-09-22T17:14:00-04:00");
    expect(currentShiftFor({ timeZone: TZ, shifts: TWELVE_HOUR }, at1714)).toMatchObject({
      shiftType: "day",
      label: "Day",
      serviceDate: "2026-09-22",
      configured: true,
    });
    expect(formatCaregiverTasksShiftBucket(TZ, TWELVE_HOUR)).not.toBe("evening");
    const at1837 = new Date("2026-09-22T18:37:00-04:00");
    expect(currentShiftFor({ timeZone: TZ, shifts: TWELVE_HOUR }, at1837)).toMatchObject({ shiftType: "night", label: "Night" });
  });

  it("keeps an overnight shift on the evening it started", () => {
    const at0300 = new Date("2026-09-23T03:00:00-04:00");
    const current = currentShiftFor({ timeZone: TZ, shifts: TWELVE_HOUR }, at0300);
    expect(current).toMatchObject({ shiftType: "night", serviceDate: "2026-09-22" });
    expect(current.endsAt?.toISOString()).toBe("2026-09-23T10:00:00.000Z");
  });

  it("uses the stored roster mapping rather than the key", () => {
    const renamed = TWELVE_HOUR.map((s) => ({ ...s, shiftKey: `${s.shiftKey}_crew`, label: `${s.label} crew` }));
    expect(currentShiftFor({ timeZone: TZ, shifts: renamed }, new Date("2026-09-22T12:00:00-04:00"))).toMatchObject({
      shiftType: "day",
      label: "Day crew",
    });
  });

  it("names the legacy fallback as unconfigured", () => {
    const current = currentShiftFor({ timeZone: TZ, shifts: [] }, new Date("2026-09-22T17:14:00-04:00"));
    expect(current).toMatchObject({
      shiftType: "evening",
      configured: false,
      startsAt: new Date("2026-09-22T15:00:00-04:00"),
      endsAt: new Date("2026-09-22T23:00:00-04:00"),
    });
    expect(currentShiftFor({ timeZone: TZ }, new Date("2026-09-23T03:00:00-04:00"))).toMatchObject({
      shiftType: "night",
      serviceDate: "2026-09-22",
    });
  });
});

describe("nextShiftFor", () => {
  it("hands day to night on a two-shift facility", () => {
    expect(nextShiftFor({ timeZone: TZ, shifts: TWELVE_HOUR }, new Date("2026-09-22T17:14:00-04:00"))).toMatchObject({
      shiftType: "night",
      serviceDate: "2026-09-22",
    });
    expect(nextShiftFor({ timeZone: TZ, shifts: [] })).toBeNull();
  });
});
