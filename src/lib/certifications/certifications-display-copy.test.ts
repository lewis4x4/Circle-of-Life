import { describe, expect, it } from "vitest";

import {
  CERTIFICATIONS_NO_STAFF_COPY,
  formatCertificationStaffName,
} from "./certifications-display-copy";

describe("formatCertificationStaffName", () => {
  it("names a missing staff join instead of generic unknown copy", () => {
    expect(formatCertificationStaffName(null)).toBe(CERTIFICATIONS_NO_STAFF_COPY);
    expect(formatCertificationStaffName(undefined)).toBe(CERTIFICATIONS_NO_STAFF_COPY);
    expect(formatCertificationStaffName("")).toBe(CERTIFICATIONS_NO_STAFF_COPY);
    expect(formatCertificationStaffName("   ")).toBe(CERTIFICATIONS_NO_STAFF_COPY);
  });

  it("returns a trimmed posted staff name", () => {
    expect(formatCertificationStaffName("Alex Rivera")).toBe("Alex Rivera");
    expect(formatCertificationStaffName("  Alex Rivera  ")).toBe("Alex Rivera");
  });
});
