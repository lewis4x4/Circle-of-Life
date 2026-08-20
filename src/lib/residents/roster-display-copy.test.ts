import { describe, expect, it, vi } from "vitest";

import {
  averageAcuity,
  formatResidentRosterAcuityCell,
  formatResidentRosterAcuityExport,
  formatResidentRosterAdlCell,
  formatResidentRosterAdlExport,
  formatResidentRosterUpdatedAt,
} from "./roster-format";
import {
  RESIDENT_ROSTER_NO_ACUITY_COPY,
  RESIDENT_ROSTER_NO_ADL_COPY,
  RESIDENT_ROSTER_NO_DATE_COPY,
} from "./roster-display-copy";
import type { ResidentRow } from "./load-residents";

const EM_DASH = "—";
const PLACEHOLDER_ISO = "2026-01-15T18:30:00.000Z";

function anonymousResidentRow(overrides: Partial<ResidentRow> = {}): ResidentRow {
  return {
    id: "00000000-0000-4000-8000-000000000001",
    name: "Resident A",
    initials: "RA",
    room: "101",
    unit: "Unit A",
    acuity: 1,
    acuityLevel: "level_1",
    adlStatus: "independent",
    status: "active",
    careSummary: "",
    updatedAtIso: PLACEHOLDER_ISO,
    ...overrides,
  };
}

describe("formatResidentRosterAcuityCell", () => {
  it("names missing acuity instead of a silent em dash", () => {
    const cell = formatResidentRosterAcuityCell(null, 1);
    expect(cell.label).toBe(RESIDENT_ROSTER_NO_ACUITY_COPY);
    expect(cell.tone).toBe("gap");
    expect(cell.label).not.toBe(EM_DASH);
  });

  it("shows posted low acuity with muted tone", () => {
    expect(formatResidentRosterAcuityCell("level_1", 1)).toEqual({
      label: "Acuity 1",
      tone: "muted",
    });
    expect(formatResidentRosterAcuityCell("level_2", 2)).toEqual({
      label: "Acuity 2",
      tone: "warning",
    });
  });

  it("shows posted high acuity with danger tone", () => {
    expect(formatResidentRosterAcuityCell("level_3", 3)).toEqual({
      label: "Acuity 3",
      tone: "danger",
    });
  });
});

describe("formatResidentRosterAdlCell", () => {
  it("names missing ADL instead of a silent em dash", () => {
    const cell = formatResidentRosterAdlCell(null, "independent");
    expect(cell.label).toBe(RESIDENT_ROSTER_NO_ADL_COPY);
    expect(cell.tone).toBe("gap");
    expect(cell.label).not.toBe(EM_DASH);
  });

  it("shows posted independent ADL with muted tone", () => {
    expect(formatResidentRosterAdlCell("level_1", "independent")).toEqual({
      label: "Independent",
      tone: "muted",
    });
  });

  it("shows posted assist levels with semantic tones", () => {
    expect(formatResidentRosterAdlCell("level_2", "assisted")).toEqual({
      label: "Partial assist",
      tone: "warning",
    });
    expect(formatResidentRosterAdlCell("level_3", "dependent")).toEqual({
      label: "Total assist",
      tone: "danger",
    });
  });
});

describe("formatResidentRosterAcuityExport", () => {
  it("exports posted numeric acuity and named gaps for missing data", () => {
    expect(formatResidentRosterAcuityExport("level_2", 2)).toBe("2");
    expect(formatResidentRosterAcuityExport(null, 1)).toBe(RESIDENT_ROSTER_NO_ACUITY_COPY);
    expect(formatResidentRosterAcuityExport(null, 1)).not.toBe(EM_DASH);
  });
});

describe("formatResidentRosterAdlExport", () => {
  it("exports posted ADL status and named gaps for missing data", () => {
    expect(formatResidentRosterAdlExport("level_1", "independent")).toBe("independent");
    expect(formatResidentRosterAdlExport(null, "independent")).toBe(RESIDENT_ROSTER_NO_ADL_COPY);
    expect(formatResidentRosterAdlExport(null, "independent")).not.toBe(EM_DASH);
  });
});

describe("averageAcuity", () => {
  it("names empty roster groups instead of a silent em dash", () => {
    expect(averageAcuity([])).toBe(RESIDENT_ROSTER_NO_ACUITY_COPY);
    expect(averageAcuity([])).not.toBe(EM_DASH);
  });

  it("ignores unposted acuity when averaging a mixed group", () => {
    expect(
      averageAcuity([
        anonymousResidentRow({ acuity: 2, acuityLevel: "level_2", adlStatus: "assisted" }),
        anonymousResidentRow({ acuity: 1, acuityLevel: null, adlStatus: "independent" }),
        anonymousResidentRow({ acuity: 3, acuityLevel: "level_3", adlStatus: "dependent" }),
      ]),
    ).toBe("2.5");
  });

  it("names groups with no posted acuity instead of defaulting to level 1", () => {
    expect(
      averageAcuity([anonymousResidentRow({ acuity: 1, acuityLevel: null, adlStatus: "independent" })]),
    ).toBe(RESIDENT_ROSTER_NO_ACUITY_COPY);
  });

  it("formats posted group averages to one decimal place", () => {
    expect(
      averageAcuity([
        anonymousResidentRow({ acuity: 2, acuityLevel: "level_2", adlStatus: "assisted" }),
        anonymousResidentRow({ acuity: 3, acuityLevel: "level_3", adlStatus: "dependent" }),
      ]),
    ).toBe("2.5");
    expect(averageAcuity([anonymousResidentRow({ acuity: 1, acuityLevel: "level_1" })])).toBe("1.0");
  });

  it("uses the named gap copy constant", () => {
    expect(RESIDENT_ROSTER_NO_ACUITY_COPY).toBe("No acuity posted");
    expect(RESIDENT_ROSTER_NO_ADL_COPY).toBe("No ADL posted");
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
