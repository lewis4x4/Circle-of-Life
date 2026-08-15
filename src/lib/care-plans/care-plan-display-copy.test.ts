import { describe, expect, it } from "vitest";

import {
  CARE_PLAN_NO_DATE_COPY,
  CARE_PLAN_NO_DESCRIPTION_COPY,
  CARE_PLAN_NO_TITLE_COPY,
  CARE_PLAN_NO_VERSION_COPY,
  formatCarePlanDateOnly,
  formatCarePlanItemDescription,
  formatCarePlanItemTitle,
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
