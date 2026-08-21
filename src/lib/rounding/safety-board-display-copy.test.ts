import { describe, expect, it } from "vitest";

import {
  SAFETY_BOARD_NO_FACILITY_COPY,
  SAFETY_BOARD_NO_INCIDENT_RECENCY_COPY,
  SAFETY_BOARD_NO_MEDICATION_ADHERENCE_COPY,
  SAFETY_BOARD_NO_OBSERVATION_COMPLIANCE_COPY,
  SAFETY_BOARD_NO_ROOM_COPY,
  SAFETY_BOARD_NO_SCORE_TREND_COPY,
  formatInsightsBoardNoInsightsEmptyTitle,
  formatSafetyBoardFacilityName,
  formatSafetyBoardIncidentRecency,
  formatSafetyBoardMedicationAdherence,
  formatSafetyBoardNoScoresEmptyTitle,
  formatSafetyBoardObservationCompliance,
  formatSafetyBoardRoomNumber,
  formatSafetyBoardScoreTrendEmpty,
  resolveSafetyBoardFacilityScope,
} from "./safety-board-display-copy";

const EM_DASH = "—";

describe("resolveSafetyBoardFacilityScope", () => {
  it("returns unscoped when no facility is selected", () => {
    expect(resolveSafetyBoardFacilityScope(null, null)).toEqual({ kind: "unscoped" });
  });

  it("returns missing_name when a facility id is selected without a resolved name", () => {
    expect(resolveSafetyBoardFacilityScope("fac-anon-1", undefined)).toEqual({
      kind: "missing_name",
    });
    expect(resolveSafetyBoardFacilityScope("fac-anon-1", "   ")).toEqual({
      kind: "missing_name",
    });
  });

  it("returns a named scope for the header subtitle", () => {
    expect(resolveSafetyBoardFacilityScope("fac-anon-1", "Anon Facility A")).toEqual({
      kind: "named",
      name: "Anon Facility A",
    });
  });
});

describe("formatSafetyBoardNoScoresEmptyTitle", () => {
  it("uses at-facility copy only when the facility name is resolved", () => {
    expect(formatSafetyBoardNoScoresEmptyTitle({ kind: "named", name: "Anon Facility A" })).toBe(
      "No safety scores at Anon Facility A",
    );
  });

  it("never interpolates the missing-name gap into an at-facility sentence", () => {
    expect(formatSafetyBoardNoScoresEmptyTitle({ kind: "missing_name" })).toBe(
      "No safety scores posted",
    );
    expect(formatSafetyBoardNoScoresEmptyTitle({ kind: "missing_name" })).not.toContain(" at ");
  });
});

describe("formatInsightsBoardNoInsightsEmptyTitle", () => {
  it("uses at-facility copy only when the facility name is resolved", () => {
    expect(
      formatInsightsBoardNoInsightsEmptyTitle({ kind: "named", name: "Anon Facility A" }),
    ).toBe("No rounding activity insights at Anon Facility A");
  });

  it("never interpolates the missing-name gap into an at-facility sentence", () => {
    expect(formatInsightsBoardNoInsightsEmptyTitle({ kind: "missing_name" })).toBe(
      "No rounding activity insights posted",
    );
    expect(formatInsightsBoardNoInsightsEmptyTitle({ kind: "missing_name" })).not.toContain(
      " at ",
    );
  });
});

describe("formatSafetyBoardFacilityName", () => {
  it("names a missing facility instead of an em dash", () => {
    expect(formatSafetyBoardFacilityName(null)).toBe(SAFETY_BOARD_NO_FACILITY_COPY);
    expect(formatSafetyBoardFacilityName("")).toBe(SAFETY_BOARD_NO_FACILITY_COPY);
    expect(formatSafetyBoardFacilityName("   ")).toBe(SAFETY_BOARD_NO_FACILITY_COPY);
  });

  it("returns a posted facility name", () => {
    expect(formatSafetyBoardFacilityName("Oakridge")).toBe("Oakridge");
  });
});

describe("formatSafetyBoardRoomNumber", () => {
  it("names a missing room instead of an em dash", () => {
    expect(formatSafetyBoardRoomNumber(null)).toBe(SAFETY_BOARD_NO_ROOM_COPY);
    expect(formatSafetyBoardRoomNumber("")).toBe(SAFETY_BOARD_NO_ROOM_COPY);
    expect(formatSafetyBoardRoomNumber("   ")).toBe(SAFETY_BOARD_NO_ROOM_COPY);
  });

  it("normalizes legacy dash room labels via caregiver copy", () => {
    expect(formatSafetyBoardRoomNumber(EM_DASH)).toBe("No room on file");
  });

  it("returns a posted room number", () => {
    expect(formatSafetyBoardRoomNumber("12")).toBe("12");
  });
});

describe("formatSafetyBoardObservationCompliance", () => {
  it("names a missing observation compliance value", () => {
    expect(formatSafetyBoardObservationCompliance(null)).toBe(
      SAFETY_BOARD_NO_OBSERVATION_COMPLIANCE_COPY,
    );
    expect(formatSafetyBoardObservationCompliance(undefined)).toBe(
      SAFETY_BOARD_NO_OBSERVATION_COMPLIANCE_COPY,
    );
  });

  it("keeps real zero as 0%", () => {
    expect(formatSafetyBoardObservationCompliance(0)).toBe("0%");
  });

  it("formats posted percents with no decimals", () => {
    expect(formatSafetyBoardObservationCompliance(80)).toBe("80%");
    expect(formatSafetyBoardObservationCompliance(80.4)).toBe("80%");
  });
});

describe("formatSafetyBoardIncidentRecency", () => {
  it("names a missing incident recency value", () => {
    expect(formatSafetyBoardIncidentRecency(null)).toBe(SAFETY_BOARD_NO_INCIDENT_RECENCY_COPY);
  });

  it("keeps real zero as 0", () => {
    expect(formatSafetyBoardIncidentRecency(0)).toBe("0");
  });

  it("formats posted recency with no decimals", () => {
    expect(formatSafetyBoardIncidentRecency(3)).toBe("3");
    expect(formatSafetyBoardIncidentRecency(3.7)).toBe("4");
  });
});

describe("formatSafetyBoardMedicationAdherence", () => {
  it("names a missing medication adherence value", () => {
    expect(formatSafetyBoardMedicationAdherence(null)).toBe(
      SAFETY_BOARD_NO_MEDICATION_ADHERENCE_COPY,
    );
  });

  it("keeps real zero as 0%", () => {
    expect(formatSafetyBoardMedicationAdherence(0)).toBe("0%");
  });

  it("formats posted percents with no decimals", () => {
    expect(formatSafetyBoardMedicationAdherence(92)).toBe("92%");
  });
});

describe("formatSafetyBoardScoreTrendEmpty", () => {
  it("names a missing score trend instead of an em dash", () => {
    expect(formatSafetyBoardScoreTrendEmpty()).toBe(SAFETY_BOARD_NO_SCORE_TREND_COPY);
    expect(formatSafetyBoardScoreTrendEmpty()).not.toBe(EM_DASH);
  });
});
