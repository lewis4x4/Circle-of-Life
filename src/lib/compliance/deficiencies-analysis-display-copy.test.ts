import { describe, expect, it } from "vitest";

import {
  DEFICIENCIES_ANALYSIS_NO_AVERAGE_GAP_DAYS_COPY,
  DEFICIENCIES_ANALYSIS_NO_AVERAGE_RESOLUTION_DAYS_COPY,
  formatDeficiencyAverageResolutionDays,
  formatRecurringTagAverageGapCell,
  formatRecurringTagAverageGapDays,
} from "./deficiencies-analysis-display-copy";

describe("formatDeficiencyAverageResolutionDays", () => {
  it("returns explicit copy when average resolution days are missing", () => {
    expect(formatDeficiencyAverageResolutionDays(null)).toBe(
      DEFICIENCIES_ANALYSIS_NO_AVERAGE_RESOLUTION_DAYS_COPY,
    );
    expect(formatDeficiencyAverageResolutionDays(undefined)).toBe(
      DEFICIENCIES_ANALYSIS_NO_AVERAGE_RESOLUTION_DAYS_COPY,
    );
  });

  it("keeps real zero as numeric zero", () => {
    expect(formatDeficiencyAverageResolutionDays(0)).toBe(0);
  });

  it("returns posted resolution days unchanged", () => {
    expect(formatDeficiencyAverageResolutionDays(14)).toBe(14);
  });
});

describe("formatRecurringTagAverageGapDays", () => {
  it("returns explicit copy when fewer than two occurrences prevent an average gap", () => {
    expect(formatRecurringTagAverageGapDays(1, 0)).toBe(
      DEFICIENCIES_ANALYSIS_NO_AVERAGE_GAP_DAYS_COPY,
    );
  });

  it("keeps real zero as numeric zero when two or more occurrences exist", () => {
    expect(formatRecurringTagAverageGapDays(2, 0)).toBe(0);
  });

  it("returns posted gap days unchanged", () => {
    expect(formatRecurringTagAverageGapDays(3, 30)).toBe(30);
  });
});

describe("formatRecurringTagAverageGapCell", () => {
  it("names the gap when average gap cannot be computed", () => {
    expect(formatRecurringTagAverageGapCell(1, 0)).toBe(
      DEFICIENCIES_ANALYSIS_NO_AVERAGE_GAP_DAYS_COPY,
    );
  });

  it("formats numeric gap days with suffix", () => {
    expect(formatRecurringTagAverageGapCell(2, 0)).toBe("~0 days");
    expect(formatRecurringTagAverageGapCell(4, 12)).toBe("~12 days");
  });
});
