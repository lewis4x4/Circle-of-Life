import { describe, expect, it } from "vitest";

import {
  FACILITY_ACCESS_NO_FACILITY_COPY,
  formatFacilityAccessNameDisplay,
} from "./facility-access-display-copy";

describe("formatFacilityAccessNameDisplay", () => {
  it("names a missing facility instead of legacy Unknown facility copy", () => {
    expect(formatFacilityAccessNameDisplay(null)).toBe(FACILITY_ACCESS_NO_FACILITY_COPY);
    expect(formatFacilityAccessNameDisplay(undefined)).toBe(FACILITY_ACCESS_NO_FACILITY_COPY);
  });

  it("names a blank facility instead of legacy Unknown facility copy", () => {
    expect(formatFacilityAccessNameDisplay("")).toBe(FACILITY_ACCESS_NO_FACILITY_COPY);
    expect(formatFacilityAccessNameDisplay("   ")).toBe(FACILITY_ACCESS_NO_FACILITY_COPY);
  });

  it("returns a posted facility name trimmed", () => {
    expect(formatFacilityAccessNameDisplay("Oakridge ALF")).toBe("Oakridge ALF");
    expect(formatFacilityAccessNameDisplay("  Homewood Lodge  ")).toBe("Homewood Lodge");
  });

  it("replaces legacy Unknown facility copy with a named gap", () => {
    expect(formatFacilityAccessNameDisplay("Unknown facility")).toBe(FACILITY_ACCESS_NO_FACILITY_COPY);
    expect(formatFacilityAccessNameDisplay("  Unknown facility  ")).toBe(FACILITY_ACCESS_NO_FACILITY_COPY);
  });
});
