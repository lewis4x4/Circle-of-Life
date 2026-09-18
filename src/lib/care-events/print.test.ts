import { describe, expect, it } from "vitest";

import {
  INCIDENT_REPORTS_LOG_COLUMNS,
  PRINT_BLANK,
  PRINT_NOT_RECORDED_LINE,
  describePrintError,
  printDate,
  printDateTime,
  printFooterLine,
  printShift,
  printTick,
  printValue,
  printYesNo,
} from "./print";

const TZ = "America/New_York";

describe("the Incident Reports Log column order", () => {
  it("is the paper log's order, not the view's", () => {
    expect(INCIDENT_REPORTS_LOG_COLUMNS.map((column) => column.key)).toEqual([
      "log_date",
      "room",
      "resident",
      "fall",
      "bruise",
      "scrapes_or_burn",
      "cut_laceration_puncture",
      "non_apparent",
      "other",
      "contributing_factors",
      "shift",
    ]);
  });

  it("gives every column the heading the paper log prints", () => {
    expect(INCIDENT_REPORTS_LOG_COLUMNS.map((column) => column.label)).toEqual([
      "Date",
      "Room",
      "Resident",
      "Fall",
      "Bruise",
      "Scrapes or burn",
      "Cut, laceration or puncture",
      "Non-apparent",
      "Other",
      "Contributing factors",
      "Shift",
    ]);
  });

  it("has no duplicate column", () => {
    const keys = INCIDENT_REPORTS_LOG_COLUMNS.map((column) => column.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe("printFooterLine", () => {
  const printedAt = new Date("2026-09-16T22:06:00Z");

  it("names who printed it, when, and which building", () => {
    expect(
      printFooterLine({ printedBy: "K. Sorensen", printedAt, facilityName: "Homewood Lodge", timeZone: TZ }),
    ).toBe("Printed from Haven by K. Sorensen on Sep 16, 2026, 6:06 PM Eastern · Homewood Lodge");
  });

  it("leaves a blank line when nobody typed a name, rather than guessing from the session", () => {
    const line = printFooterLine({ printedBy: "   ", printedAt, facilityName: "Homewood Lodge", timeZone: TZ });
    expect(line).toContain("Printed from Haven by ________________ on");
    expect(line).toContain("· Homewood Lodge");
  });

  it("never claims a page number it cannot know", () => {
    // A body string renders once and cannot know its page. Numbering is an
    // @page margin box in globals.css; the literal used to print on every sheet.
    const line = printFooterLine({ printedBy: "A", printedAt, facilityName: "Homewood Lodge", timeZone: TZ });
    expect(line).not.toContain("Page N of M");
    expect(line).not.toMatch(/Page \d+ of/);
  });

  it("stamps in the facility's clock, not the browser's", () => {
    const eastern = printFooterLine({ printedBy: "A", printedAt, facilityName: "F", timeZone: "America/New_York" });
    const pacific = printFooterLine({ printedBy: "A", printedAt, facilityName: "F", timeZone: "America/Los_Angeles" });
    expect(eastern).toContain("6:06 PM");
    expect(pacific).toContain("3:06 PM");
  });
});

describe("blank lines where the paper form left blanks", () => {
  it("prints a blank rather than an empty cell for a missing value", () => {
    expect(printValue(null)).toBe(PRINT_BLANK);
    expect(printValue("")).toBe(PRINT_BLANK);
    expect(printValue("   ")).toBe(PRINT_BLANK);
    expect(printValue("Dr Reyes")).toBe("Dr Reyes");
  });

  it("prints Yes, No, or a blank, never true or false", () => {
    expect(printYesNo(true)).toBe("Yes");
    expect(printYesNo(false)).toBe("No");
    expect(printYesNo(null)).toBe(PRINT_BLANK);
    expect(printYesNo(undefined)).toBe(PRINT_BLANK);
  });

  it("prints a blank for a missing or unparseable timestamp", () => {
    expect(printDateTime(null, TZ)).toBe(PRINT_BLANK);
    expect(printDateTime("not a date", TZ)).toBe(PRINT_BLANK);
    expect(printDateTime("2026-09-16T22:06:00Z", TZ)).toBe("Sep 16, 2026, 6:06 PM");
    expect(printDate("2026-09-16", TZ)).toBe("Sep 16, 2026");
    // A calendar date is a day, not an instant: parsing it as UTC midnight and
    // rendering it in Eastern would date every log row one day early.
    expect(printDate("2026-01-01", TZ)).toBe("Jan 1, 2026");
    expect(printDate("2026-01-01", "America/Los_Angeles")).toBe("Jan 1, 2026");
    expect(printDate(null, TZ)).toBe(PRINT_BLANK);
    expect(printDate("not a date", TZ)).toBe(PRINT_BLANK);
  });
});

describe("the log's ticks and shift words", () => {
  it("marks a tick with X and leaves the cell empty otherwise", () => {
    expect(printTick(true)).toBe("X");
    expect(printTick(false)).toBe("");
    expect(printTick(null)).toBe("");
  });

  it("never prints a raw shift token", () => {
    expect(printShift("day")).toBe("Day");
    expect(printShift("evening")).toBe("Evening");
    expect(printShift("night")).toBe("Night");
    expect(printShift("split_shift")).toBe("split shift");
    expect(printShift(null)).toBe("");
  });
});

describe("describePrintError", () => {
  it("says the print was not recorded, in the decision's words", () => {
    expect(describePrintError(new Error("boom"))).toBe(PRINT_NOT_RECORDED_LINE);
    expect(PRINT_NOT_RECORDED_LINE).toBe("Print could not be recorded. Try again.");
  });

  it("names the role problem when that is what it is", () => {
    expect(describePrintError(new Error("print: forbidden"))).toBe("This print is for the Administrator or Assistant.");
  });
});
