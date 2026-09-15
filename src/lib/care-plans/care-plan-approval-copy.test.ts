import { describe, expect, it } from "vitest";

import { CARE_PLAN_NO_ACUITY_COPY, formatCarePlanAcuityLabel, isCarePlanAuthor } from "./care-plan-approval-copy";

describe("isCarePlanAuthor", () => {
  it("is true only when the signed-in user recorded the version", () => {
    expect(isCarePlanAuthor("user-1", "user-1")).toBe(true);
    expect(isCarePlanAuthor("user-1", "user-2")).toBe(false);
  });

  it("treats an unknown author or signed-out viewer as not the author", () => {
    expect(isCarePlanAuthor(null, "user-1")).toBe(false);
    expect(isCarePlanAuthor("user-1", null)).toBe(false);
    expect(isCarePlanAuthor(undefined, undefined)).toBe(false);
  });
});

describe("formatCarePlanAcuityLabel", () => {
  it("matches the invoice line label", () => {
    expect(formatCarePlanAcuityLabel("level_1")).toBe("Level 1");
    expect(formatCarePlanAcuityLabel("level_3")).toBe("Level 3");
  });

  it("names a missing or unrecognised level", () => {
    expect(formatCarePlanAcuityLabel(null)).toBe(CARE_PLAN_NO_ACUITY_COPY);
    expect(formatCarePlanAcuityLabel("high")).toBe(CARE_PLAN_NO_ACUITY_COPY);
  });
});
