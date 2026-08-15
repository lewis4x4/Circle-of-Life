import { describe, expect, it } from "vitest";

import {
  TIME_RECORDS_NO_CLOCK_OUT_COPY,
  TIME_RECORDS_NO_HOURS_COPY,
  TIME_RECORDS_NO_STAFF_COPY,
  formatTimeRecordStaffName,
  formatTimeRecordsActualHours,
  formatTimeRecordsClockOut,
} from "./time-records-display-copy";

const EM_DASH = "—";

describe("formatTimeRecordsClockOut", () => {
  it("names a missing clock-out instead of an em dash", () => {
    expect(formatTimeRecordsClockOut(null)).toBe(TIME_RECORDS_NO_CLOCK_OUT_COPY);
    expect(formatTimeRecordsClockOut(undefined)).toBe(TIME_RECORDS_NO_CLOCK_OUT_COPY);
    expect(formatTimeRecordsClockOut("")).toBe(TIME_RECORDS_NO_CLOCK_OUT_COPY);
    expect(formatTimeRecordsClockOut("   ")).toBe(TIME_RECORDS_NO_CLOCK_OUT_COPY);
    expect(formatTimeRecordsClockOut(null)).not.toBe(EM_DASH);
  });

  it("formats a posted clock-out datetime", () => {
    const formatted = formatTimeRecordsClockOut("2026-08-15T14:30:00.000Z");
    expect(formatted).toMatch(/Aug/);
    expect(formatted).toMatch(/15/);
  });
});

describe("formatTimeRecordStaffName", () => {
  it("names a missing staff join instead of generic unknown copy", () => {
    expect(formatTimeRecordStaffName(null)).toBe(TIME_RECORDS_NO_STAFF_COPY);
    expect(formatTimeRecordStaffName(undefined)).toBe(TIME_RECORDS_NO_STAFF_COPY);
    expect(formatTimeRecordStaffName("")).toBe(TIME_RECORDS_NO_STAFF_COPY);
    expect(formatTimeRecordStaffName("   ")).toBe(TIME_RECORDS_NO_STAFF_COPY);
    expect(formatTimeRecordStaffName(null)).not.toBe("Unknown staff");
  });

  it("returns a trimmed posted staff name", () => {
    expect(formatTimeRecordStaffName("Jordan Lee")).toBe("Jordan Lee");
    expect(formatTimeRecordStaffName("  Jordan Lee  ")).toBe("Jordan Lee");
  });
});

describe("formatTimeRecordsActualHours", () => {
  it("names missing hours instead of an em dash", () => {
    expect(formatTimeRecordsActualHours(null)).toBe(TIME_RECORDS_NO_HOURS_COPY);
    expect(formatTimeRecordsActualHours(undefined)).toBe(TIME_RECORDS_NO_HOURS_COPY);
    expect(formatTimeRecordsActualHours(Number.NaN)).toBe(TIME_RECORDS_NO_HOURS_COPY);
    expect(formatTimeRecordsActualHours(null)).not.toBe(EM_DASH);
  });

  it("keeps a real zero as numeric hours", () => {
    expect(formatTimeRecordsActualHours(0)).toBe("0.00");
  });

  it("formats posted hours to two decimals", () => {
    expect(formatTimeRecordsActualHours(1.5)).toBe("1.50");
    expect(formatTimeRecordsActualHours(2)).toBe("2.00");
  });
});
