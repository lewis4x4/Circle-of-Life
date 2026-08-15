import { describe, expect, it } from "vitest";

import {
  STAFF_ROSTER_NO_SHIFT_COPY,
  formatStaffRosterNextShift,
} from "./staff-roster-display-copy";

const EM_DASH = "—";

describe("formatStaffRosterNextShift", () => {
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
