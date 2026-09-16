import { describe, expect, it } from "vitest";

import {
  INCIDENT_REPORTS_LOG_CHECK_MARK,
  INCIDENT_REPORTS_LOG_COLUMNS,
  INCIDENT_REPORTS_LOG_NO_RESIDENT_COPY,
  INCIDENT_REPORTS_LOG_NO_ROOM_COPY,
  buildIncidentReportsLogCsv,
  currentYearMonth,
  incidentReportsLogCells,
  incidentReportsLogFileName,
  isYearMonth,
  monthLabel,
  monthRange,
  reportsLogMark,
  shiftYearMonth,
  type IncidentReportsLogRow,
} from "./reports-log";

const TIME_ZONE = "America/New_York";

function row(overrides: Partial<IncidentReportsLogRow> = {}): IncidentReportsLogRow {
  return {
    bruise: false,
    care_event_id: null,
    category: "fall_witnessed",
    contributing_factors: null,
    cut_laceration_puncture: false,
    facility_id: "00000000-0000-4000-8000-0000000000f1",
    fall: true,
    incident_id: "00000000-0000-4000-8000-0000000000i1",
    incident_number: "INC-0001",
    log_date: "2026-09-14",
    non_apparent: false,
    occurred_at: "2026-09-15T02:05:00.000Z",
    organization_id: "00000000-0000-4000-8000-0000000000a1",
    other: false,
    resident: "Brownell, Placeholder",
    room: "12",
    scrapes_or_burn: false,
    severity: "level_3",
    shift: "evening",
    ...overrides,
  };
}

describe("buildIncidentReportsLogCsv", () => {
  it("writes the paper log columns in order with the level word last", () => {
    const csv = buildIncidentReportsLogCsv([]);
    expect(csv).toBe(
      "Date,Room,Resident,Fall,Bruise,Scrapes or burn,\"Cut, laceration, or puncture\",Non-apparent,Other,Contributing factors,Shift,Level",
    );
    expect(INCIDENT_REPORTS_LOG_COLUMNS).toHaveLength(12);
  });

  it("renders booleans as a check mark or nothing, never true or false", () => {
    const csv = buildIncidentReportsLogCsv([row({ bruise: true, other: null })]);
    const line = csv.split("\r\n")[1];
    expect(line).toBe(
      `"Sep 14, 2026",12,"Brownell, Placeholder",${INCIDENT_REPORTS_LOG_CHECK_MARK},${INCIDENT_REPORTS_LOG_CHECK_MARK},,,,,,Evening,Urgent`,
    );
    expect(csv).not.toMatch(/true|false/);
    expect(csv).not.toMatch(/level_/);
  });

  it("escapes commas, quotes, and formula prefixes", () => {
    const csv = buildIncidentReportsLogCsv([
      row({ contributing_factors: 'Wet floor; "no" footwear, rushing', resident: "=Doe, Jane" }),
    ]);
    const line = csv.split("\r\n")[1];
    expect(line).toContain('"\'=Doe, Jane"');
    expect(line).toContain('"Wet floor; ""no"" footwear, rushing"');
  });

  it("names missing room and resident", () => {
    const cells = incidentReportsLogCells(row({ room: null, resident: "  ", severity: null, shift: null }));
    expect(cells[1]).toBe(INCIDENT_REPORTS_LOG_NO_ROOM_COPY);
    expect(cells[2]).toBe(INCIDENT_REPORTS_LOG_NO_RESIDENT_COPY);
    expect(cells[10]).toBe("");
    expect(cells[11]).toBe("");
  });

  it("marks only true", () => {
    expect(reportsLogMark(true)).toBe(INCIDENT_REPORTS_LOG_CHECK_MARK);
    expect(reportsLogMark(false)).toBe("");
    expect(reportsLogMark(null)).toBe("");
  });
});

describe("monthRange", () => {
  it("bounds September 2026 in America/New_York", () => {
    const range = monthRange("2026-09", TIME_ZONE);
    expect(range.label).toBe("September 2026");
    expect(range.firstDate).toBe("2026-09-01");
    expect(range.lastDate).toBe("2026-09-30");
    expect(range.startIso).toBe("2026-09-01T04:00:00.000Z");
    expect(range.endIso).toBe("2026-10-01T04:00:00.000Z");
    expect(range.previousYearMonth).toBe("2026-08");
    expect(range.nextYearMonth).toBe("2026-10");
  });

  it("crosses the daylight saving boundary and a leap February", () => {
    const december = monthRange("2026-12", TIME_ZONE);
    expect(december.startIso).toBe("2026-12-01T05:00:00.000Z");
    expect(december.endIso).toBe("2027-01-01T05:00:00.000Z");
    expect(december.nextYearMonth).toBe("2027-01");

    const february = monthRange("2028-02", TIME_ZONE);
    expect(february.lastDate).toBe("2028-02-29");
  });

  it("shifts months across year ends", () => {
    expect(shiftYearMonth("2026-01", -1)).toBe("2025-12");
    expect(shiftYearMonth("2026-12", 1)).toBe("2027-01");
    expect(monthLabel("2026-01")).toBe("January 2026");
  });

  it("finds the current month in the facility zone", () => {
    expect(currentYearMonth(TIME_ZONE, new Date("2026-10-01T02:00:00.000Z"))).toBe("2026-09");
    expect(currentYearMonth("UTC", new Date("2026-10-01T02:00:00.000Z"))).toBe("2026-10");
  });

  it("validates year-month strings", () => {
    expect(isYearMonth("2026-09")).toBe(true);
    expect(isYearMonth("2026-13")).toBe(false);
    expect(isYearMonth("2026-9")).toBe(false);
    expect(isYearMonth(null)).toBe(false);
  });
});

describe("incidentReportsLogFileName", () => {
  it("uses the facility slug and month only", () => {
    expect(incidentReportsLogFileName("Homewood Lodge", "2026-09")).toBe("incident-reports-log-homewood-lodge-2026-09.csv");
    expect(incidentReportsLogFileName(null, "2026-09")).toBe("incident-reports-log-facility-2026-09.csv");
    expect(incidentReportsLogFileName("  Grande  Cypress ALF!! ", "2026-01")).toBe(
      "incident-reports-log-grande-cypress-alf-2026-01.csv",
    );
  });
});
