import { describe, expect, it } from "vitest";

import {
  OBSERVATION_PLAN_NO_ACUITY_COPY,
  OBSERVATION_PLAN_NO_NAME_COPY,
  OBSERVATION_PLAN_NO_ROOM_COPY,
  OBSERVATION_PLAN_SELECT_FACILITY_FIRST_COPY,
  formatObservationPlanAcuityDisplay,
  formatObservationPlanAcuitySegment,
  formatObservationPlanResidentName,
  formatObservationPlanRoomLabel,
} from "./observation-plan-display-copy";

const EM_DASH = "—";

describe("observation plan facility scope copy", () => {
  it("names the unset-facility gap without legacy selected-facility interpolation", () => {
    expect(OBSERVATION_PLAN_SELECT_FACILITY_FIRST_COPY).toBe("Select a facility first.");
    expect(OBSERVATION_PLAN_SELECT_FACILITY_FIRST_COPY).not.toContain("selected facility");
  });
});

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

describe("formatObservationPlanRoomLabel", () => {
  it("names the gap when room and bed are missing or blank", () => {
    expect(formatObservationPlanRoomLabel(null, null)).toBe(OBSERVATION_PLAN_NO_ROOM_COPY);
    expect(formatObservationPlanRoomLabel(undefined, undefined)).toBe(OBSERVATION_PLAN_NO_ROOM_COPY);
    expect(formatObservationPlanRoomLabel("", "")).toBe(OBSERVATION_PLAN_NO_ROOM_COPY);
    expect(formatObservationPlanRoomLabel("   ", "  ")).toBe(OBSERVATION_PLAN_NO_ROOM_COPY);
  });

  it("names the gap for em dash and legacy generic room strings", () => {
    expect(formatObservationPlanRoomLabel("—", null)).toBe(OBSERVATION_PLAN_NO_ROOM_COPY);
    expect(formatObservationPlanRoomLabel("Unknown", null)).toBe(OBSERVATION_PLAN_NO_ROOM_COPY);
    expect(formatObservationPlanRoomLabel("Unassigned", null)).toBe(OBSERVATION_PLAN_NO_ROOM_COPY);
    expect(formatObservationPlanRoomLabel("Unnamed", null)).toBe(OBSERVATION_PLAN_NO_ROOM_COPY);
    expect(formatObservationPlanRoomLabel(null, "Unassigned")).toBe(OBSERVATION_PLAN_NO_ROOM_COPY);
    expect(formatObservationPlanRoomLabel(null, "—")).toBe(OBSERVATION_PLAN_NO_ROOM_COPY);
  });

  it("prefers posted room_number over bed_label", () => {
    expect(formatObservationPlanRoomLabel("Posted Room", "Posted Bed")).toBe("Posted Room");
    expect(formatObservationPlanRoomLabel("  Posted Room  ", "Posted Bed")).toBe("Posted Room");
  });

  it("falls back to bed_label when room_number is missing", () => {
    expect(formatObservationPlanRoomLabel(null, "Posted Bed")).toBe("Posted Bed");
    expect(formatObservationPlanRoomLabel("", "Posted Bed")).toBe("Posted Bed");
    expect(formatObservationPlanRoomLabel("Unassigned", "Posted Bed")).toBe("Posted Bed");
    expect(formatObservationPlanRoomLabel("  Posted Bed  ", null)).toBe("Posted Bed");
  });

  it("never surfaces Unassigned or a lone em dash", () => {
    expect(OBSERVATION_PLAN_NO_ROOM_COPY).toBe("No room posted");
    expect(formatObservationPlanRoomLabel(null, null)).not.toBe("Unassigned");
    expect(formatObservationPlanRoomLabel(null, null)).not.toBe("Unknown");
    expect(formatObservationPlanRoomLabel(null, null)).not.toBe("—");
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
