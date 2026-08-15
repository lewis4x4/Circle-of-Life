import { describe, expect, it } from "vitest";

import {
  CARE_PLAN_NO_DATE_COPY,
  CARE_PLAN_NO_DESCRIPTION_COPY,
  CARE_PLAN_NO_NAME_COPY,
  CARE_PLAN_NO_TITLE_COPY,
  CARE_PLAN_NO_VERSION_COPY,
  formatCarePlanDateOnly,
  formatCarePlanItemDescription,
  formatCarePlanItemTitle,
  formatCarePlanResidentName,
  formatCarePlanVersion,
} from "./care-plan-display-copy";

const EM_DASH = "—";

describe("formatCarePlanItemTitle", () => {
  it("names a missing title instead of an em dash", () => {
    expect(formatCarePlanItemTitle(null)).toBe(CARE_PLAN_NO_TITLE_COPY);
    expect(formatCarePlanItemTitle("")).toBe(CARE_PLAN_NO_TITLE_COPY);
    expect(formatCarePlanItemTitle("   ")).toBe(CARE_PLAN_NO_TITLE_COPY);
    expect(formatCarePlanItemTitle(null)).not.toBe(EM_DASH);
  });

  it("returns a posted title", () => {
    expect(formatCarePlanItemTitle("Ambulation")).toBe("Ambulation");
  });
});

describe("formatCarePlanItemDescription", () => {
  it("names a missing description instead of an em dash", () => {
    expect(formatCarePlanItemDescription(null)).toBe(CARE_PLAN_NO_DESCRIPTION_COPY);
    expect(formatCarePlanItemDescription("")).toBe(CARE_PLAN_NO_DESCRIPTION_COPY);
    expect(formatCarePlanItemDescription(null)).not.toBe(EM_DASH);
  });

  it("returns a posted description", () => {
    expect(formatCarePlanItemDescription("Assist with walker in hallway.")).toBe(
      "Assist with walker in hallway.",
    );
  });
});

describe("formatCarePlanVersion", () => {
  it("names a missing version instead of an em dash", () => {
    expect(formatCarePlanVersion(null)).toBe(CARE_PLAN_NO_VERSION_COPY);
    expect(formatCarePlanVersion(undefined)).toBe(CARE_PLAN_NO_VERSION_COPY);
    expect(formatCarePlanVersion(null)).not.toBe(EM_DASH);
    expect(formatCarePlanVersion(null)).not.toBe(`v${CARE_PLAN_NO_VERSION_COPY}`);
  });

  it("returns v plus a posted version number", () => {
    expect(formatCarePlanVersion(3)).toBe("v3");
  });
});

describe("formatCarePlanDateOnly", () => {
  it("names a missing date instead of an em dash", () => {
    expect(formatCarePlanDateOnly(null)).toBe(CARE_PLAN_NO_DATE_COPY);
    expect(formatCarePlanDateOnly("")).toBe(CARE_PLAN_NO_DATE_COPY);
    expect(formatCarePlanDateOnly("   ")).toBe(CARE_PLAN_NO_DATE_COPY);
    expect(formatCarePlanDateOnly("not-a-date")).toBe(CARE_PLAN_NO_DATE_COPY);
    expect(formatCarePlanDateOnly(null)).not.toBe(EM_DASH);
  });

  it("formats a posted date with noon UTC en-US display", () => {
    expect(formatCarePlanDateOnly("2026-04-08")).toBe("Apr 8, 2026");
  });
});

describe("formatCarePlanResidentName", () => {
  it("names the gap when posted first and last are blank or whitespace", () => {
    expect(formatCarePlanResidentName({ first_name: null, last_name: null })).toBe(
      CARE_PLAN_NO_NAME_COPY,
    );
    expect(formatCarePlanResidentName({ first_name: "", last_name: "" })).toBe(CARE_PLAN_NO_NAME_COPY);
    expect(formatCarePlanResidentName({ first_name: "   ", last_name: "  " })).toBe(
      CARE_PLAN_NO_NAME_COPY,
    );
  });

  it("names the gap for em dash and legacy generic resident strings", () => {
    expect(formatCarePlanResidentName({ first_name: EM_DASH, last_name: null })).toBe(
      CARE_PLAN_NO_NAME_COPY,
    );
    expect(formatCarePlanResidentName({ first_name: "Unknown", last_name: null })).toBe(
      CARE_PLAN_NO_NAME_COPY,
    );
    expect(formatCarePlanResidentName({ first_name: "Unknown", last_name: "resident" })).toBe(
      CARE_PLAN_NO_NAME_COPY,
    );
    expect(formatCarePlanResidentName({ first_name: "Unknown", last_name: "Resident" })).toBe(
      CARE_PLAN_NO_NAME_COPY,
    );
    expect(formatCarePlanResidentName({ first_name: "Unnamed", last_name: null })).toBe(
      CARE_PLAN_NO_NAME_COPY,
    );
    expect(formatCarePlanResidentName({ first_name: "Unnamed", last_name: "resident" })).toBe(
      CARE_PLAN_NO_NAME_COPY,
    );
  });

  it("keeps a posted resident name", () => {
    expect(formatCarePlanResidentName({ first_name: "Resident", last_name: "Alpha" })).toBe(
      "Resident Alpha",
    );
    expect(formatCarePlanResidentName({ first_name: "Resident", last_name: null })).toBe("Resident");
    expect(formatCarePlanResidentName({ first_name: null, last_name: "Beta" })).toBe("Beta");
  });

  it("never surfaces Unknown, Unknown resident, or a lone em dash", () => {
    expect(formatCarePlanResidentName({ first_name: null, last_name: null })).not.toBe("Unknown");
    expect(formatCarePlanResidentName({ first_name: null, last_name: null })).not.toBe(
      "Unknown resident",
    );
    expect(formatCarePlanResidentName({ first_name: null, last_name: null })).not.toBe(
      "Unknown Resident",
    );
    expect(formatCarePlanResidentName({ first_name: "Unknown", last_name: null })).not.toBe("Unknown");
    expect(formatCarePlanResidentName({ first_name: EM_DASH, last_name: null })).not.toBe(EM_DASH);
  });
});
