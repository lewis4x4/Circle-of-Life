import { describe, expect, it } from "vitest";

import {
  FORM_1823_ALIGNMENT_ALL_FACILITIES_COPY,
  FORM_1823_ALIGNMENT_NO_FACILITY_NAME_COPY,
  formatForm1823AlignmentEmptyRosterCopy,
  formatForm1823AlignmentFacilityTitle,
} from "./form-1823-alignment-display-copy";

const FACILITY_ID = "11111111-1111-4111-8111-111111111111";

describe("formatForm1823AlignmentFacilityTitle", () => {
  it("uses All facilities when unscoped", () => {
    expect(formatForm1823AlignmentFacilityTitle(null, "Anon Facility A")).toBe(
      FORM_1823_ALIGNMENT_ALL_FACILITIES_COPY,
    );
  });

  it("names the facility when scoped", () => {
    expect(formatForm1823AlignmentFacilityTitle(FACILITY_ID, "Anon Facility A")).toBe(
      "Anon Facility A",
    );
  });

  it("names the gap without Selected facility when the name is missing", () => {
    expect(formatForm1823AlignmentFacilityTitle(FACILITY_ID, null)).toBe(
      FORM_1823_ALIGNMENT_NO_FACILITY_NAME_COPY,
    );
    expect(formatForm1823AlignmentFacilityTitle(FACILITY_ID, "   ")).not.toMatch(
      /selected facility/i,
    );
  });
});

describe("formatForm1823AlignmentEmptyRosterCopy", () => {
  it("names the facility when posted", () => {
    expect(formatForm1823AlignmentEmptyRosterCopy("Anon Facility A")).toContain(
      "in Anon Facility A.",
    );
    expect(formatForm1823AlignmentEmptyRosterCopy("Anon Facility A")).not.toMatch(
      /selected facility/i,
    );
  });

  it("uses this facility when the name is missing", () => {
    expect(formatForm1823AlignmentEmptyRosterCopy(null)).toContain("in this facility.");
    expect(formatForm1823AlignmentEmptyRosterCopy(null)).not.toMatch(/selected facility/i);
  });
});
