import { describe, expect, it } from "vitest";

import {
  OVERRIDE_ADMISSION_NO_FACILITY_COPY,
  OVERRIDE_ADMISSION_NO_FACILITY_NAME_COPY,
  formatOverrideAdmissionFacilityLabel,
} from "./override-admission-display-copy";

const FACILITY_ID = "11111111-1111-4111-8111-111111111111";

describe("formatOverrideAdmissionFacilityLabel", () => {
  it("names the gap when no facility is chosen", () => {
    expect(formatOverrideAdmissionFacilityLabel(null, "Anon Facility A")).toBe(
      OVERRIDE_ADMISSION_NO_FACILITY_COPY,
    );
    expect(formatOverrideAdmissionFacilityLabel(null, null)).not.toMatch(/selected facility/i);
  });

  it("names the facility when posted", () => {
    expect(formatOverrideAdmissionFacilityLabel(FACILITY_ID, "Anon Facility A")).toBe(
      "Anon Facility A",
    );
  });

  it("names the gap when scoped without a posted name", () => {
    expect(formatOverrideAdmissionFacilityLabel(FACILITY_ID, null)).toBe(
      OVERRIDE_ADMISSION_NO_FACILITY_NAME_COPY,
    );
    expect(formatOverrideAdmissionFacilityLabel(FACILITY_ID, "   ")).not.toMatch(
      /selected facility/i,
    );
  });
});
