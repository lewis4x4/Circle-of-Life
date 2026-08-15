import { describe, expect, it } from "vitest";

import {
  ADMIN_FACILITIES_NO_FACILITY_COPY,
  formatAdminFacilityOptionNameDisplay,
} from "./admin-facilities-display-copy";

const EM_DASH = "—";

describe("formatAdminFacilityOptionNameDisplay", () => {
  it("names a missing facility instead of legacy Unnamed facility copy", () => {
    expect(formatAdminFacilityOptionNameDisplay(null)).toBe(ADMIN_FACILITIES_NO_FACILITY_COPY);
    expect(formatAdminFacilityOptionNameDisplay(undefined)).toBe(ADMIN_FACILITIES_NO_FACILITY_COPY);
    expect(formatAdminFacilityOptionNameDisplay(null)).not.toBe("Unnamed facility");
  });

  it("names a blank facility instead of legacy Unnamed facility copy", () => {
    expect(formatAdminFacilityOptionNameDisplay("")).toBe(ADMIN_FACILITIES_NO_FACILITY_COPY);
    expect(formatAdminFacilityOptionNameDisplay("   ")).toBe(ADMIN_FACILITIES_NO_FACILITY_COPY);
    expect(formatAdminFacilityOptionNameDisplay("")).not.toBe("Unnamed facility");
  });

  it("names an em dash facility instead of showing a silent dash", () => {
    expect(formatAdminFacilityOptionNameDisplay(EM_DASH)).toBe(ADMIN_FACILITIES_NO_FACILITY_COPY);
    expect(formatAdminFacilityOptionNameDisplay(`  ${EM_DASH}  `)).toBe(ADMIN_FACILITIES_NO_FACILITY_COPY);
    expect(formatAdminFacilityOptionNameDisplay(EM_DASH)).not.toBe(EM_DASH);
  });

  it("replaces legacy Unnamed facility copy with a named gap", () => {
    expect(formatAdminFacilityOptionNameDisplay("Unnamed facility")).toBe(ADMIN_FACILITIES_NO_FACILITY_COPY);
    expect(formatAdminFacilityOptionNameDisplay("  Unnamed facility  ")).toBe(
      ADMIN_FACILITIES_NO_FACILITY_COPY,
    );
  });

  it("replaces legacy Unknown copy with a named gap", () => {
    expect(formatAdminFacilityOptionNameDisplay("Unknown")).toBe(ADMIN_FACILITIES_NO_FACILITY_COPY);
    expect(formatAdminFacilityOptionNameDisplay("  Unknown  ")).toBe(ADMIN_FACILITIES_NO_FACILITY_COPY);
  });

  it("returns a posted facility name trimmed", () => {
    expect(formatAdminFacilityOptionNameDisplay("Oakridge ALF")).toBe("Oakridge ALF");
    expect(formatAdminFacilityOptionNameDisplay("  Oakridge ALF  ")).toBe("Oakridge ALF");
  });
});
