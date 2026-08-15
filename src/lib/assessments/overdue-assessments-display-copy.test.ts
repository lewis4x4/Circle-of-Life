import { describe, expect, it } from "vitest";

import {
  OVERDUE_ASSESSMENTS_NO_NAME_POSTED_COPY,
  OVERDUE_ASSESSMENTS_NO_RESIDENT_POSTED_COPY,
  formatOverdueAssessmentsResidentLabel,
} from "./overdue-assessments-display-copy";

const EM_DASH = "—";

describe("formatOverdueAssessmentsResidentLabel", () => {
  it("names a missing resident instead of Unknown", () => {
    expect(formatOverdueAssessmentsResidentLabel(null)).toBe(
      OVERDUE_ASSESSMENTS_NO_RESIDENT_POSTED_COPY,
    );
    expect(formatOverdueAssessmentsResidentLabel(undefined)).toBe(
      OVERDUE_ASSESSMENTS_NO_RESIDENT_POSTED_COPY,
    );
    expect(formatOverdueAssessmentsResidentLabel(null)).not.toBe("Unknown");
  });

  it("names a blank resident name instead of inventing one", () => {
    expect(formatOverdueAssessmentsResidentLabel({ first_name: null, last_name: null })).toBe(
      OVERDUE_ASSESSMENTS_NO_NAME_POSTED_COPY,
    );
    expect(formatOverdueAssessmentsResidentLabel({ first_name: "", last_name: "" })).toBe(
      OVERDUE_ASSESSMENTS_NO_NAME_POSTED_COPY,
    );
    expect(formatOverdueAssessmentsResidentLabel({ first_name: "   ", last_name: "  " })).toBe(
      OVERDUE_ASSESSMENTS_NO_NAME_POSTED_COPY,
    );
  });

  it("names an em dash resident name instead of a silent dash", () => {
    expect(formatOverdueAssessmentsResidentLabel({ first_name: EM_DASH, last_name: null })).toBe(
      OVERDUE_ASSESSMENTS_NO_NAME_POSTED_COPY,
    );
    expect(
      formatOverdueAssessmentsResidentLabel({ first_name: `  ${EM_DASH}  `, last_name: "" }),
    ).toBe(OVERDUE_ASSESSMENTS_NO_NAME_POSTED_COPY);
    expect(formatOverdueAssessmentsResidentLabel({ first_name: EM_DASH, last_name: null })).not.toBe(
      EM_DASH,
    );
  });

  it("returns a posted first name only", () => {
    expect(formatOverdueAssessmentsResidentLabel({ first_name: "Jordan", last_name: "" })).toBe(
      "Jordan",
    );
    expect(formatOverdueAssessmentsResidentLabel({ first_name: "  Jordan  ", last_name: null })).toBe(
      "Jordan",
    );
  });

  it("returns a posted last name only", () => {
    expect(formatOverdueAssessmentsResidentLabel({ first_name: "", last_name: "Lee" })).toBe("Lee");
    expect(formatOverdueAssessmentsResidentLabel({ first_name: null, last_name: "  Lee  " })).toBe(
      "Lee",
    );
  });

  it("returns posted first and last names joined with a single space", () => {
    expect(formatOverdueAssessmentsResidentLabel({ first_name: "Jordan", last_name: "Lee" })).toBe(
      "Jordan Lee",
    );
    expect(
      formatOverdueAssessmentsResidentLabel({ first_name: "  Jordan  ", last_name: "  Lee  " }),
    ).toBe("Jordan Lee");
  });
});
