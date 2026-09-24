import { describe, expect, it } from "vitest";

import {
  STAFF_ROSTER_NO_SHIFT_COPY,
  formatStaffRosterNextShift,
} from "./staff-roster-display-copy";

const EM_DASH = "—";

describe("formatStaffRosterNextShift", () => {
  it("shows a named role option's recorded hours rather than the custom enum", () => {
    expect(formatStaffRosterNextShift({ shift_date: "2026-09-24", shift_type: "custom", schedule_preset_name: "Cook opening", custom_start_time: "06:00", custom_end_time: "13:00" })).toBe("Sep 24 · Cook opening · 6:00a–1:00p");
  });
  it("names a missing next shift instead of an em dash", () => {
    expect(formatStaffRosterNextShift(null)).toBe(STAFF_ROSTER_NO_SHIFT_COPY);
    expect(formatStaffRosterNextShift(undefined)).toBe(STAFF_ROSTER_NO_SHIFT_COPY);
    expect(formatStaffRosterNextShift(null)).not.toBe(EM_DASH);
  });

  it("formats a posted day shift", () => {
    expect(formatStaffRosterNextShift({ shift_date: "2026-04-08", shift_type: "day" })).toBe(
      "Apr 8 · Day",
    );
  });

  it("formats a posted evening shift", () => {
    expect(formatStaffRosterNextShift({ shift_date: "2026-04-09", shift_type: "evening" })).toBe(
      "Apr 9 · Evening",
    );
  });

  it("formats a posted night shift", () => {
    expect(formatStaffRosterNextShift({ shift_date: "2026-04-10", shift_type: "night" })).toBe(
      "Apr 10 · Night",
    );
  });
});
