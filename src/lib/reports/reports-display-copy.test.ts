import { describe, expect, it } from "vitest";

import {
  REPORTS_NO_COMPLETE_TIME_COPY,
  REPORTS_NO_NEXT_RUN_COPY,
  formatReportRunCompletedAt,
  formatReportScheduleNextRunAt,
} from "./reports-display-copy";

const EM_DASH = "—";

describe("formatReportRunCompletedAt", () => {
  it("returns explicit copy when complete time is missing", () => {
    expect(formatReportRunCompletedAt(null)).toBe(REPORTS_NO_COMPLETE_TIME_COPY);
    expect(formatReportRunCompletedAt(undefined)).toBe(REPORTS_NO_COMPLETE_TIME_COPY);
    expect(formatReportRunCompletedAt("")).toBe(REPORTS_NO_COMPLETE_TIME_COPY);
    expect(formatReportRunCompletedAt("not-a-date")).toBe(REPORTS_NO_COMPLETE_TIME_COPY);
    expect(formatReportRunCompletedAt(null)).not.toBe(EM_DASH);
  });

  it("formats posted complete times unchanged", () => {
    const iso = "2026-04-08T15:30:00.000Z";
    expect(formatReportRunCompletedAt(iso)).toBe(new Date(iso).toLocaleString());
  });
});

describe("formatReportScheduleNextRunAt", () => {
  it("returns explicit copy when next run is missing", () => {
    expect(formatReportScheduleNextRunAt(null)).toBe(REPORTS_NO_NEXT_RUN_COPY);
    expect(formatReportScheduleNextRunAt(undefined)).toBe(REPORTS_NO_NEXT_RUN_COPY);
    expect(formatReportScheduleNextRunAt("")).toBe(REPORTS_NO_NEXT_RUN_COPY);
    expect(formatReportScheduleNextRunAt("not-a-date")).toBe(REPORTS_NO_NEXT_RUN_COPY);
    expect(formatReportScheduleNextRunAt(null)).not.toBe(EM_DASH);
  });

  it("formats posted next-run times unchanged", () => {
    const iso = "2026-04-08T15:30:00.000Z";
    expect(formatReportScheduleNextRunAt(iso)).toBe(new Date(iso).toLocaleString());
  });
});
