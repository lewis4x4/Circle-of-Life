import { describe, expect, it } from "vitest";

import { STAFF_POSITION_OPTIONS, staffPositionOptions } from "./staff-positions";

describe("staffPositionOptions", () => {
  it("offers the standard positions when the current one is listed", () => {
    expect(staffPositionOptions("resident_aide")).toEqual(STAFF_POSITION_OPTIONS);
  });

  it("keeps a current position that is no longer offered", () => {
    const options = staffPositionOptions("legacy_role");
    expect(options[0]).toEqual({ value: "legacy_role", label: "Legacy role" });
    expect(options).toHaveLength(STAFF_POSITION_OPTIONS.length + 1);
  });
});
