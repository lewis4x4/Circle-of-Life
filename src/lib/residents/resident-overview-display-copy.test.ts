import { describe, expect, it } from "vitest";

import {
  RESIDENT_OVERVIEW_NO_DATE_COPY,
  RESIDENT_OVERVIEW_NO_GENDER_COPY,
  RESIDENT_OVERVIEW_NO_STAFF_COPY,
  formatResidentOverviewAdmissionLabel,
  formatResidentOverviewGenderLabel,
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

describe("formatResidentOverviewAdmissionLabel", () => {
  it("formats a parseable admission date", () => {
    expect(formatResidentOverviewAdmissionLabel("2026-01-15")).toBe("Jan 15, 2026");
    expect(formatResidentOverviewAdmissionLabel("  2026-01-15  ")).toBe("Jan 15, 2026");
  });

  it("names a missing admission date gap instead of a silent em dash", () => {
    expect(formatResidentOverviewAdmissionLabel(null)).toBe(RESIDENT_OVERVIEW_NO_DATE_COPY);
    expect(formatResidentOverviewAdmissionLabel(undefined)).toBe(RESIDENT_OVERVIEW_NO_DATE_COPY);
    expect(formatResidentOverviewAdmissionLabel("")).toBe(RESIDENT_OVERVIEW_NO_DATE_COPY);
    expect(formatResidentOverviewAdmissionLabel("   ")).toBe(RESIDENT_OVERVIEW_NO_DATE_COPY);
    expect(formatResidentOverviewAdmissionLabel("—")).toBe(RESIDENT_OVERVIEW_NO_DATE_COPY);
    expect(formatResidentOverviewAdmissionLabel("Unknown")).toBe(RESIDENT_OVERVIEW_NO_DATE_COPY);
    expect(formatResidentOverviewAdmissionLabel("unknown")).toBe(RESIDENT_OVERVIEW_NO_DATE_COPY);
    expect(formatResidentOverviewAdmissionLabel(null)).not.toBe("—");
  });

  it("names an unparseable admission date value", () => {
    expect(formatResidentOverviewAdmissionLabel("not-a-date")).toBe(RESIDENT_OVERVIEW_NO_DATE_COPY);
    expect(formatResidentOverviewAdmissionLabel("2026-13-40")).toBe(RESIDENT_OVERVIEW_NO_DATE_COPY);
  });
});

describe("formatResidentOverviewGenderLabel", () => {
  it("returns Male and Female for posted male/female codes", () => {
    expect(formatResidentOverviewGenderLabel("male")).toBe("Male");
    expect(formatResidentOverviewGenderLabel("female")).toBe("Female");
    expect(formatResidentOverviewGenderLabel("  male  ")).toBe("Male");
    expect(formatResidentOverviewGenderLabel("FEMALE")).toBe("Female");
  });

  it("names a missing gender gap instead of generic unknown copy", () => {
    expect(formatResidentOverviewGenderLabel(null)).toBe(RESIDENT_OVERVIEW_NO_GENDER_COPY);
    expect(formatResidentOverviewGenderLabel(undefined)).toBe(RESIDENT_OVERVIEW_NO_GENDER_COPY);
    expect(formatResidentOverviewGenderLabel("")).toBe(RESIDENT_OVERVIEW_NO_GENDER_COPY);
    expect(formatResidentOverviewGenderLabel("   ")).toBe(RESIDENT_OVERVIEW_NO_GENDER_COPY);
    expect(formatResidentOverviewGenderLabel("—")).toBe(RESIDENT_OVERVIEW_NO_GENDER_COPY);
    expect(formatResidentOverviewGenderLabel("Unknown")).toBe(RESIDENT_OVERVIEW_NO_GENDER_COPY);
    expect(formatResidentOverviewGenderLabel("unknown")).toBe(RESIDENT_OVERVIEW_NO_GENDER_COPY);
    expect(formatResidentOverviewGenderLabel("Unnamed")).toBe(RESIDENT_OVERVIEW_NO_GENDER_COPY);
    expect(formatResidentOverviewGenderLabel(null)).not.toBe("Unknown");
  });

  it("humanizes other posted gender codes without inventing values", () => {
    expect(formatResidentOverviewGenderLabel("non_binary")).toBe("non binary");
    expect(formatResidentOverviewGenderLabel("  other_gender  ")).toBe("other gender");
  });
});
