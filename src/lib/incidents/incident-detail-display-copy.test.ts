import { describe, expect, it } from "vitest";

import {
  INCIDENT_DETAIL_NO_BODY_LOCATION_COPY,
  INCIDENT_DETAIL_NO_INJURY_DESCRIPTION_COPY,
  INCIDENT_DETAIL_NO_INJURY_SEVERITY_COPY,
  formatIncidentDetailInjuryBodyLocation,
  formatIncidentDetailInjuryDescription,
  formatIncidentDetailInjurySeverity,
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
