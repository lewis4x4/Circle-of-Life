import { describe, expect, it } from "vitest";

import {
  INCIDENT_DETAIL_NO_BODY_LOCATION_COPY,
  INCIDENT_DETAIL_NO_DATE_COPY,
  INCIDENT_DETAIL_NO_FALL_ACTIVITY_COPY,
  INCIDENT_DETAIL_NO_FALL_TYPE_COPY,
  INCIDENT_DETAIL_NO_FALL_WITNESSED_COPY,
  INCIDENT_DETAIL_NO_INJURY_DESCRIPTION_COPY,
  INCIDENT_DETAIL_NO_INJURY_SEVERITY_COPY,
  formatIncidentDetailFallActivity,
  formatIncidentDetailFallType,
  formatIncidentDetailFallWitnessed,
  formatIncidentDetailInjuryBodyLocation,
  formatIncidentDetailInjuryDescription,
  formatIncidentDetailInjurySeverity,
  formatIncidentDetailTimestamp,
} from "./incident-detail-display-copy";

describe("formatIncidentDetailInjuryDescription", () => {
  it("returns posted description trimmed", () => {
    expect(formatIncidentDetailInjuryDescription("bruise")).toBe("bruise");
    expect(formatIncidentDetailInjuryDescription("  bruise  ")).toBe("bruise");
  });

  it("names the gap when description is missing or blank", () => {
    expect(formatIncidentDetailInjuryDescription(null)).toBe(INCIDENT_DETAIL_NO_INJURY_DESCRIPTION_COPY);
    expect(formatIncidentDetailInjuryDescription(undefined)).toBe(INCIDENT_DETAIL_NO_INJURY_DESCRIPTION_COPY);
    expect(formatIncidentDetailInjuryDescription("")).toBe(INCIDENT_DETAIL_NO_INJURY_DESCRIPTION_COPY);
    expect(formatIncidentDetailInjuryDescription("   ")).toBe(INCIDENT_DETAIL_NO_INJURY_DESCRIPTION_COPY);
  });

  it("never invents clinical injury facts", () => {
    expect(INCIDENT_DETAIL_NO_INJURY_DESCRIPTION_COPY).toBe("No injury description posted");
    expect(formatIncidentDetailInjuryDescription(null)).not.toBe("—");
  });
});

describe("formatIncidentDetailInjuryBodyLocation", () => {
  it("returns posted body location trimmed", () => {
    expect(formatIncidentDetailInjuryBodyLocation("left forearm")).toBe("left forearm");
    expect(formatIncidentDetailInjuryBodyLocation("  left forearm  ")).toBe("left forearm");
  });

  it("names the gap when body location is missing or blank", () => {
    expect(formatIncidentDetailInjuryBodyLocation(null)).toBe(INCIDENT_DETAIL_NO_BODY_LOCATION_COPY);
    expect(formatIncidentDetailInjuryBodyLocation(undefined)).toBe(INCIDENT_DETAIL_NO_BODY_LOCATION_COPY);
    expect(formatIncidentDetailInjuryBodyLocation("")).toBe(INCIDENT_DETAIL_NO_BODY_LOCATION_COPY);
    expect(formatIncidentDetailInjuryBodyLocation("   ")).toBe(INCIDENT_DETAIL_NO_BODY_LOCATION_COPY);
  });

  it("never invents clinical injury facts", () => {
    expect(INCIDENT_DETAIL_NO_BODY_LOCATION_COPY).toBe("No body location posted");
    expect(formatIncidentDetailInjuryBodyLocation(null)).not.toBe("—");
  });
});

describe("formatIncidentDetailInjurySeverity", () => {
  it("returns posted severity with snake formatting", () => {
    expect(formatIncidentDetailInjurySeverity("minor")).toBe("minor");
    expect(formatIncidentDetailInjurySeverity("level_1")).toBe("level 1");
    expect(formatIncidentDetailInjurySeverity("  minor  ")).toBe("minor");
  });

  it("names the gap when severity is missing, blank, or a lone em dash", () => {
    expect(formatIncidentDetailInjurySeverity(null)).toBe(INCIDENT_DETAIL_NO_INJURY_SEVERITY_COPY);
    expect(formatIncidentDetailInjurySeverity(undefined)).toBe(INCIDENT_DETAIL_NO_INJURY_SEVERITY_COPY);
    expect(formatIncidentDetailInjurySeverity("")).toBe(INCIDENT_DETAIL_NO_INJURY_SEVERITY_COPY);
    expect(formatIncidentDetailInjurySeverity("   ")).toBe(INCIDENT_DETAIL_NO_INJURY_SEVERITY_COPY);
    expect(formatIncidentDetailInjurySeverity("—")).toBe(INCIDENT_DETAIL_NO_INJURY_SEVERITY_COPY);
    expect(formatIncidentDetailInjurySeverity("  —  ")).toBe(INCIDENT_DETAIL_NO_INJURY_SEVERITY_COPY);
  });

  it("never invents clinical injury facts", () => {
    expect(INCIDENT_DETAIL_NO_INJURY_SEVERITY_COPY).toBe("No severity posted");
    expect(formatIncidentDetailInjurySeverity(null)).not.toBe("—");
  });
});

describe("formatIncidentDetailFallWitnessed", () => {
  it("returns Yes/No when witnessed status is posted", () => {
    expect(formatIncidentDetailFallWitnessed(true)).toBe("Yes");
    expect(formatIncidentDetailFallWitnessed(false)).toBe("No");
  });

  it("names the gap when witnessed status is unset", () => {
    expect(formatIncidentDetailFallWitnessed(null)).toBe(INCIDENT_DETAIL_NO_FALL_WITNESSED_COPY);
    expect(formatIncidentDetailFallWitnessed(undefined)).toBe(INCIDENT_DETAIL_NO_FALL_WITNESSED_COPY);
  });

  it("never invents fall facts", () => {
    expect(INCIDENT_DETAIL_NO_FALL_WITNESSED_COPY).toBe("No witnessed status posted");
    expect(formatIncidentDetailFallWitnessed(null)).not.toBe("—");
  });
});

describe("formatIncidentDetailFallType", () => {
  it("returns posted fall type with snake formatting", () => {
    expect(formatIncidentDetailFallType("unwitnessed")).toBe("unwitnessed");
    expect(formatIncidentDetailFallType("same_level")).toBe("same level");
  });

  it("names the gap when fall type is missing or blank", () => {
    expect(formatIncidentDetailFallType(null)).toBe(INCIDENT_DETAIL_NO_FALL_TYPE_COPY);
    expect(formatIncidentDetailFallType(undefined)).toBe(INCIDENT_DETAIL_NO_FALL_TYPE_COPY);
    expect(formatIncidentDetailFallType("")).toBe(INCIDENT_DETAIL_NO_FALL_TYPE_COPY);
    expect(formatIncidentDetailFallType("   ")).toBe(INCIDENT_DETAIL_NO_FALL_TYPE_COPY);
  });

  it("never invents fall facts", () => {
    expect(INCIDENT_DETAIL_NO_FALL_TYPE_COPY).toBe("No fall type posted");
    expect(formatIncidentDetailFallType(null)).not.toBe("—");
  });
});

describe("formatIncidentDetailFallActivity", () => {
  it("returns posted activity with snake formatting", () => {
    expect(formatIncidentDetailFallActivity("ambulating")).toBe("ambulating");
    expect(formatIncidentDetailFallActivity("to_bathroom")).toBe("to bathroom");
  });

  it("names the gap when activity is missing or blank", () => {
    expect(formatIncidentDetailFallActivity(null)).toBe(INCIDENT_DETAIL_NO_FALL_ACTIVITY_COPY);
    expect(formatIncidentDetailFallActivity(undefined)).toBe(INCIDENT_DETAIL_NO_FALL_ACTIVITY_COPY);
    expect(formatIncidentDetailFallActivity("")).toBe(INCIDENT_DETAIL_NO_FALL_ACTIVITY_COPY);
    expect(formatIncidentDetailFallActivity("   ")).toBe(INCIDENT_DETAIL_NO_FALL_ACTIVITY_COPY);
  });

  it("never invents fall facts", () => {
    expect(INCIDENT_DETAIL_NO_FALL_ACTIVITY_COPY).toBe("No activity posted");
    expect(formatIncidentDetailFallActivity(null)).not.toBe("—");
  });
});

describe("formatIncidentDetailTimestamp", () => {
  it("formats a posted timestamp", () => {
    const formatted = formatIncidentDetailTimestamp("2026-01-15T18:30:00.000Z");
    expect(formatted).toMatch(/Jan/);
    expect(formatted).toMatch(/15/);
    expect(formatted).toMatch(/2026/);
  });

  it("names the gap when timestamp is missing, blank, or unparseable", () => {
    expect(formatIncidentDetailTimestamp(null)).toBe(INCIDENT_DETAIL_NO_DATE_COPY);
    expect(formatIncidentDetailTimestamp(undefined)).toBe(INCIDENT_DETAIL_NO_DATE_COPY);
    expect(formatIncidentDetailTimestamp("")).toBe(INCIDENT_DETAIL_NO_DATE_COPY);
    expect(formatIncidentDetailTimestamp("   ")).toBe(INCIDENT_DETAIL_NO_DATE_COPY);
    expect(formatIncidentDetailTimestamp("not-a-date")).toBe(INCIDENT_DETAIL_NO_DATE_COPY);
  });

  it("never invents dates", () => {
    expect(INCIDENT_DETAIL_NO_DATE_COPY).toBe("No date posted");
    expect(formatIncidentDetailTimestamp(null)).not.toBe("—");
  });
});
