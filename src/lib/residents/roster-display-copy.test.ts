import { describe, expect, it, vi } from "vitest";

import { averageAcuity, formatResidentRosterUpdatedAt } from "./roster-format";
import { RESIDENT_ROSTER_NO_ACUITY_COPY, RESIDENT_ROSTER_NO_DATE_COPY } from "./roster-display-copy";
import type { ResidentRow } from "./load-residents";

const EM_DASH = "—";
const PLACEHOLDER_ISO = "2026-01-15T18:30:00.000Z";

function placeholderResidentRow(acuity: ResidentRow["acuity"]): ResidentRow {
  return {
    id: "resident-placeholder",
    name: "Placeholder Resident",
    initials: "PR",
    room: "101",
    unit: "East Wing",
    acuity,
    adlStatus: "independent",
    status: "active",
    careSummary: "",
    updatedAtIso: PLACEHOLDER_ISO,
  };
}

describe("averageAcuity", () => {
  it("names empty roster groups instead of a silent em dash", () => {
    expect(averageAcuity([])).toBe(RESIDENT_ROSTER_NO_ACUITY_COPY);
    expect(averageAcuity([])).not.toBe(EM_DASH);
  });

  it("formats posted group averages to one decimal place", () => {
    expect(averageAcuity([placeholderResidentRow(2), placeholderResidentRow(3)])).toBe("2.5");
    expect(averageAcuity([placeholderResidentRow(1)])).toBe("1.0");
  });

  it("uses the named gap copy constant", () => {
    expect(RESIDENT_ROSTER_NO_ACUITY_COPY).toBe("No acuity posted");
  });
});

describe("formatResidentRosterUpdatedAt", () => {
  it("names missing updated-at timestamps instead of a silent em dash", () => {
    expect(formatResidentRosterUpdatedAt(null)).toBe(RESIDENT_ROSTER_NO_DATE_COPY);
    expect(formatResidentRosterUpdatedAt(null)).not.toBe(EM_DASH);
  });

  it("names blank updated-at timestamps instead of a silent em dash", () => {
    expect(formatResidentRosterUpdatedAt("")).toBe(RESIDENT_ROSTER_NO_DATE_COPY);
    expect(formatResidentRosterUpdatedAt("   ")).toBe(RESIDENT_ROSTER_NO_DATE_COPY);
    expect(formatResidentRosterUpdatedAt("")).not.toBe(EM_DASH);
  });

  it("names unparseable updated-at timestamps with a named gap", () => {
    expect(formatResidentRosterUpdatedAt("not-a-date")).toBe(RESIDENT_ROSTER_NO_DATE_COPY);
    expect(formatResidentRosterUpdatedAt("not-a-date")).not.toBe(EM_DASH);
  });

  it("formats a posted ISO timestamp in America/New_York relative style", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-15T19:00:00.000Z"));

    const label = formatResidentRosterUpdatedAt(PLACEHOLDER_ISO);
    expect(label).toBe("Today 1:30p");
    expect(label).not.toBe(EM_DASH);
    expect(label).not.toBe(RESIDENT_ROSTER_NO_DATE_COPY);

    vi.useRealTimers();
  });

  it("uses the named gap copy constant", () => {
    expect(RESIDENT_ROSTER_NO_DATE_COPY).toBe("No date posted");
  });
});
