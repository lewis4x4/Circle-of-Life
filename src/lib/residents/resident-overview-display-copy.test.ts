import { describe, expect, it } from "vitest";

import {
  RESIDENT_OVERVIEW_NO_STAFF_COPY,
  formatResidentOverviewVerifiedByStaffLabel,
} from "./resident-overview-display-copy";

const VERIFIER_ID = "00000000-0000-4000-8000-000000000001";

describe("formatResidentOverviewVerifiedByStaffLabel", () => {
  it("returns null when no verifier id is posted", () => {
    expect(formatResidentOverviewVerifiedByStaffLabel(null, "Jordan Lee")).toBeNull();
    expect(formatResidentOverviewVerifiedByStaffLabel(undefined, "Jordan Lee")).toBeNull();
    expect(formatResidentOverviewVerifiedByStaffLabel("", "Jordan Lee")).toBeNull();
  });

  it("names a missing staff join instead of generic unknown copy", () => {
    expect(formatResidentOverviewVerifiedByStaffLabel(VERIFIER_ID, null)).toBe(
      RESIDENT_OVERVIEW_NO_STAFF_COPY,
    );
    expect(formatResidentOverviewVerifiedByStaffLabel(VERIFIER_ID, undefined)).toBe(
      RESIDENT_OVERVIEW_NO_STAFF_COPY,
    );
    expect(formatResidentOverviewVerifiedByStaffLabel(VERIFIER_ID, null)).not.toBe("Unknown staff");
  });

  it("names a blank posted staff name", () => {
    expect(formatResidentOverviewVerifiedByStaffLabel(VERIFIER_ID, "")).toBe(
      RESIDENT_OVERVIEW_NO_STAFF_COPY,
    );
    expect(formatResidentOverviewVerifiedByStaffLabel(VERIFIER_ID, "   ")).toBe(
      RESIDENT_OVERVIEW_NO_STAFF_COPY,
    );
  });

  it("returns a trimmed posted staff name", () => {
    expect(formatResidentOverviewVerifiedByStaffLabel(VERIFIER_ID, "Jordan Lee")).toBe("Jordan Lee");
    expect(formatResidentOverviewVerifiedByStaffLabel(VERIFIER_ID, "  Jordan Lee  ")).toBe(
      "Jordan Lee",
    );
  });
});
