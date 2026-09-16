import { describe, expect, it } from "vitest";

import { buildComparisonCsv, hoursToMinutes, normalizeDate, normalizeName, parseCsv, reconcileUpunch, type HavenStaffWeeks } from "./reconcile";

const week = (workweekStart: string, workedMinutes: number) => ({ workweekStart, workedMinutes, mealMinutes: 30, regularMinutes: Math.min(workedMinutes, 2400), overtimeMinutes: Math.max(0, workedMinutes - 2400) });

const HAVEN: HavenStaffWeeks[] = [
  { staffId: "a", name: "Test Staff A", employeeNumber: "A-100", weeks: [week("2026-11-02", 2400)] },
  { staffId: "b", name: "Test Staff B", employeeNumber: null, weeks: [week("2026-11-02", 1800), week("2026-11-09", 600)] },
];

const DECIMAL_CSV = [
  "Employee #,Name,Date,Total Hours",
  "A-100,Test Staff A,11/02/2026,8.00",
  "a-100,Test Staff A,11/03/2026,8.00",
  "A-100,Test Staff A,11/04/2026,8.00",
  "A-100,Test Staff A,11/05/2026,8.00",
  "A-100,Test Staff A,11/06/2026,8.08",
  "Z-999,Someone Else,11/02/2026,4.00",
  "A-100,Test Staff A,bad date,8.00",
].join("\r\n");

const HMM_CSV = ['Name,Work Date,Hours', '"A, Test Staff",2026-11-02,20:00', '"A, Test Staff",2026-11-03,20:00', '"B, Test Staff",2026-11-03,30:05', '"B, Test Staff",2026-11-10,10:00'].join("\n");

describe("parseCsv and value normalisers", () => {
  it("parses quoted cells, doubled quotes and a BOM", () => {
    const parsed = parseCsv('﻿a,b\r\n"x, y","say ""hi"""\r\n');
    expect(parsed.headers).toEqual(["a", "b"]);
    expect(parsed.rows).toEqual([{ a: "x, y", b: 'say "hi"' }]);
  });

  it("converts decimal hours to the nearest minute and H:MM exactly", () => {
    expect(hoursToMinutes("8.00", "decimal")).toBe(480);
    expect(hoursToMinutes("8.08", "decimal")).toBe(485);
    expect(hoursToMinutes("7:30", "hmm")).toBe(450);
    expect(hoursToMinutes("30:05", "hmm")).toBe(1805);
    expect(hoursToMinutes("7.5", "hmm")).toBeNull();
    expect(hoursToMinutes("", "decimal")).toBeNull();
  });

  it("normalises dates and names", () => {
    expect(normalizeDate("11/03/2026")).toBe("2026-11-03");
    expect(normalizeDate("2026-11-03")).toBe("2026-11-03");
    expect(normalizeDate("3/4/26")).toBe("2026-03-04");
    expect(normalizeDate("yesterday")).toBeNull();
    expect(normalizeName("A, Test Staff")).toBe("test staff a");
    expect(normalizeName("  Test   Staff A ")).toBe("test staff a");
  });
});

describe("reconcileUpunch", () => {
  it("matches by employee number in decimal hours, honours the 5 minute tolerance boundary, and lists unmatched employees", () => {
    const result = reconcileUpunch({
      upload: parseCsv(DECIMAL_CSV),
      mapping: { identifier: "Employee #", date: "Date", hours: "Total Hours", identifierKind: "employee_number", hoursFormat: "decimal" },
      haven: HAVEN,
    });
    // A: 4 x 480 + 485 = 2405 uPunch vs 2400 Haven -> difference -5, still a match.
    const a = result.rows.find((r) => r.staffId === "a" && r.workweekStart === "2026-11-02")!;
    expect(a).toMatchObject({ havenMinutes: 2400, upunchMinutes: 2405, differenceMinutes: -5, match: true });
    // B has Haven minutes but no upload rows: shown as a difference.
    const b = result.rows.filter((r) => r.staffId === "b");
    expect(b.map((r) => [r.workweekStart, r.upunchMinutes, r.match])).toEqual([
      ["2026-11-02", 0, false],
      ["2026-11-09", 0, false],
    ]);
    expect(result.unmatched).toEqual([{ identifier: "Z-999", rows: 1, minutes: 240 }]);
    expect(result.skipped).toBe(1);
  });

  it("six minutes apart is not a match", () => {
    const result = reconcileUpunch({
      upload: parseCsv("Employee #,Date,Total Hours\nA-100,11/02/2026,40.10\n"),
      mapping: { identifier: "Employee #", date: "Date", hours: "Total Hours", identifierKind: "employee_number", hoursFormat: "decimal" },
      haven: [HAVEN[0]!],
    });
    expect(result.rows[0]).toMatchObject({ upunchMinutes: 2406, differenceMinutes: -6, match: false });
  });

  it("matches by name only when no employee number exists, in H:MM, grouping dates into the Monday workweek", () => {
    const result = reconcileUpunch({
      upload: parseCsv(HMM_CSV),
      mapping: { identifier: "Name", date: "Work Date", hours: "Hours", identifierKind: "name", hoursFormat: "hmm" },
      haven: HAVEN,
    });
    const a = result.rows.find((r) => r.staffId === "a")!;
    expect(a).toMatchObject({ havenMinutes: 2400, upunchMinutes: 2400, differenceMinutes: 0, match: true });
    const b1 = result.rows.find((r) => r.staffId === "b" && r.workweekStart === "2026-11-02")!;
    expect(b1).toMatchObject({ havenMinutes: 1800, upunchMinutes: 1805, match: true });
    const b2 = result.rows.find((r) => r.staffId === "b" && r.workweekStart === "2026-11-09")!;
    expect(b2).toMatchObject({ havenMinutes: 600, upunchMinutes: 600, match: true });
    expect(result.unmatched).toEqual([]);
  });

  it("writes a CSV with one row per staff week plus unmatched employees", () => {
    const result = reconcileUpunch({
      upload: parseCsv(DECIMAL_CSV),
      mapping: { identifier: "Employee #", date: "Date", hours: "Total Hours", identifierKind: "employee_number", hoursFormat: "decimal" },
      haven: [HAVEN[0]!],
    });
    const csv = buildComparisonCsv(result);
    expect(csv.split("\r\n")[0]).toBe("employee_number,staff_name,workweek_start,haven_minutes,upunch_minutes,difference_minutes,match");
    expect(csv).toContain("A-100,Test Staff A,2026-11-02,2400,2405,-5,Match");
    expect(csv).toContain(",Z-999,,,240,,Unmatched");
  });
});
