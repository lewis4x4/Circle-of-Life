import { describe, expect, it } from "vitest";

import {
  OBSERVATION_PLAN_NO_ACUITY_COPY,
  formatObservationPlanAcuityDisplay,
  formatObservationPlanAcuitySegment,
} from "./observation-plan-display-copy";

const EM_DASH = "—";

describe("formatObservationPlanAcuityDisplay", () => {
  it("names missing acuity instead of an em dash", () => {
    expect(formatObservationPlanAcuityDisplay(null, null)).toBe(OBSERVATION_PLAN_NO_ACUITY_COPY);
    expect(formatObservationPlanAcuityDisplay(undefined, undefined)).toBe(OBSERVATION_PLAN_NO_ACUITY_COPY);
    expect(formatObservationPlanAcuityDisplay(null, null)).not.toBe(EM_DASH);
  });

  it("keeps real zero as 0", () => {
    expect(formatObservationPlanAcuityDisplay(0, null)).toBe("0");
    expect(formatObservationPlanAcuityDisplay(0, "level_2")).toBe("0");
    expect(formatObservationPlanAcuityDisplay(0, null)).not.toBe(OBSERVATION_PLAN_NO_ACUITY_COPY);
  });

  it("formats posted scores with locale grouping", () => {
    expect(formatObservationPlanAcuityDisplay(3, null)).toBe("3");
    expect(formatObservationPlanAcuityDisplay(1200, null)).toBe("1,200");
  });

  it("strips level_ prefix from posted acuity level", () => {
    expect(formatObservationPlanAcuityDisplay(null, "level_2")).toBe("2");
    expect(formatObservationPlanAcuityDisplay(null, "level_4")).toBe("4");
  });
});

describe("formatObservationPlanAcuitySegment", () => {
  it("returns named gap without Acuity prefix when missing", () => {
    expect(formatObservationPlanAcuitySegment(null, null)).toBe(OBSERVATION_PLAN_NO_ACUITY_COPY);
    expect(formatObservationPlanAcuitySegment(null, null)).not.toMatch(/^Acuity /);
    expect(formatObservationPlanAcuitySegment(null, null)).not.toBe(`Acuity ${OBSERVATION_PLAN_NO_ACUITY_COPY}`);
  });

  it("prefixes posted scores with Acuity", () => {
    expect(formatObservationPlanAcuitySegment(0, null)).toBe("Acuity 0");
    expect(formatObservationPlanAcuitySegment(3, null)).toBe("Acuity 3");
    expect(formatObservationPlanAcuitySegment(1200, null)).toBe("Acuity 1,200");
  });

  it("prefixes posted levels with Acuity", () => {
    expect(formatObservationPlanAcuitySegment(null, "level_2")).toBe("Acuity 2");
  });
});
