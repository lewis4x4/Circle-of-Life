import { describe, expect, it } from "vitest";

import {
  OBSERVATION_PLAN_NO_ACUITY_COPY,
  OBSERVATION_PLAN_NO_NAME_COPY,
  formatObservationPlanAcuityDisplay,
  formatObservationPlanAcuitySegment,
  formatObservationPlanResidentName,
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

describe("formatObservationPlanResidentName", () => {
  it("names the gap when name parts are blank or whitespace", () => {
    expect(formatObservationPlanResidentName(null)).toBe(OBSERVATION_PLAN_NO_NAME_COPY);
    expect(formatObservationPlanResidentName(undefined)).toBe(OBSERVATION_PLAN_NO_NAME_COPY);
    expect(formatObservationPlanResidentName({ first_name: null, last_name: null })).toBe(
      OBSERVATION_PLAN_NO_NAME_COPY,
    );
    expect(formatObservationPlanResidentName({ first_name: "", last_name: "" })).toBe(
      OBSERVATION_PLAN_NO_NAME_COPY,
    );
    expect(formatObservationPlanResidentName({ first_name: "   ", last_name: "  " })).toBe(
      OBSERVATION_PLAN_NO_NAME_COPY,
    );
    expect(formatObservationPlanResidentName("   ")).toBe(OBSERVATION_PLAN_NO_NAME_COPY);
  });

  it("names the gap for em dash and legacy generic resident strings", () => {
    expect(formatObservationPlanResidentName({ first_name: "—", last_name: null })).toBe(
      OBSERVATION_PLAN_NO_NAME_COPY,
    );
    expect(formatObservationPlanResidentName({ first_name: "Unknown", last_name: null })).toBe(
      OBSERVATION_PLAN_NO_NAME_COPY,
    );
    expect(formatObservationPlanResidentName({ first_name: "Unknown", last_name: "resident" })).toBe(
      OBSERVATION_PLAN_NO_NAME_COPY,
    );
    expect(formatObservationPlanResidentName({ first_name: "Unnamed", last_name: null })).toBe(
      OBSERVATION_PLAN_NO_NAME_COPY,
    );
    expect(formatObservationPlanResidentName({ first_name: "Unnamed", last_name: "resident" })).toBe(
      OBSERVATION_PLAN_NO_NAME_COPY,
    );
    expect(formatObservationPlanResidentName("Unnamed resident")).toBe(OBSERVATION_PLAN_NO_NAME_COPY);
  });

  it("keeps a posted resident name with preferred-then-first join", () => {
    expect(formatObservationPlanResidentName({ first_name: "Posted", last_name: "Resident" })).toBe(
      "Posted Resident",
    );
    expect(
      formatObservationPlanResidentName({
        preferred_name: "Posted",
        first_name: "Legacy",
        last_name: "Resident",
      }),
    ).toBe("Posted Resident");
    expect(formatObservationPlanResidentName({ first_name: "Posted", last_name: null })).toBe("Posted");
    expect(formatObservationPlanResidentName({ first_name: null, last_name: "Resident" })).toBe("Resident");
    expect(formatObservationPlanResidentName("  Posted Resident  ")).toBe("Posted Resident");
  });

  it("never surfaces Unnamed resident or a lone em dash", () => {
    expect(OBSERVATION_PLAN_NO_NAME_COPY).toBe("No name posted");
    expect(formatObservationPlanResidentName(null)).not.toBe("Unnamed resident");
    expect(formatObservationPlanResidentName(null)).not.toBe("Unknown");
    expect(formatObservationPlanResidentName(null)).not.toBe("—");
    expect(formatObservationPlanResidentName({ first_name: "Unnamed", last_name: "resident" })).not.toBe(
      "Unnamed resident",
    );
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
