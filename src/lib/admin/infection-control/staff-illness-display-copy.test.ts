import { describe, expect, it } from "vitest";

import {
  STAFF_ILLNESS_NO_NAME_COPY,
  STAFF_ILLNESS_NO_STAFF_COPY,
  formatStaffIllnessStaffLabel,
} from "./staff-illness-display-copy";

describe("formatStaffIllnessStaffLabel", () => {
  it("names a missing staff record instead of generic unknown copy", () => {
    expect(formatStaffIllnessStaffLabel(null)).toBe(STAFF_ILLNESS_NO_STAFF_COPY);
    expect(formatStaffIllnessStaffLabel(undefined)).toBe(STAFF_ILLNESS_NO_STAFF_COPY);
  });

  it("names a posted staff record with blank first and last names", () => {
    expect(formatStaffIllnessStaffLabel({ first_name: "", last_name: "" })).toBe(
      STAFF_ILLNESS_NO_NAME_COPY,
    );
    expect(formatStaffIllnessStaffLabel({ first_name: "   ", last_name: "  " })).toBe(
      STAFF_ILLNESS_NO_NAME_COPY,
    );
  });

  it("returns a posted first name only", () => {
    expect(formatStaffIllnessStaffLabel({ first_name: "Jordan", last_name: "" })).toBe("Jordan");
    expect(formatStaffIllnessStaffLabel({ first_name: "  Jordan  ", last_name: "" })).toBe("Jordan");
  });

  it("returns a posted last name only", () => {
    expect(formatStaffIllnessStaffLabel({ first_name: "", last_name: "Lee" })).toBe("Lee");
    expect(formatStaffIllnessStaffLabel({ first_name: "", last_name: "  Lee  " })).toBe("Lee");
  });

  it("returns posted first and last names joined with a single space", () => {
    expect(formatStaffIllnessStaffLabel({ first_name: "Jordan", last_name: "Lee" })).toBe(
      "Jordan Lee",
    );
    expect(formatStaffIllnessStaffLabel({ first_name: "  Jordan  ", last_name: "  Lee  " })).toBe(
      "Jordan Lee",
    );
  });
});
