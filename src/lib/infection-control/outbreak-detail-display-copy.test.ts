import { describe, expect, it } from "vitest";

import {
  OUTBREAK_DETAIL_NO_CASE_COUNT_COPY,
  formatOutbreakDetailStatusLine,
  formatOutbreakDetailTotalCaseCount,
} from "./outbreak-detail-display-copy";

describe("formatOutbreakDetailTotalCaseCount", () => {
  it("returns explicit copy when count is missing", () => {
    expect(formatOutbreakDetailTotalCaseCount(null)).toBe(OUTBREAK_DETAIL_NO_CASE_COUNT_COPY);
    expect(formatOutbreakDetailTotalCaseCount(undefined)).toBe(OUTBREAK_DETAIL_NO_CASE_COUNT_COPY);
  });

  it("keeps real zero as numeric zero", () => {
    expect(formatOutbreakDetailTotalCaseCount(0)).toBe(0);
  });

  it("returns posted counts unchanged", () => {
    expect(formatOutbreakDetailTotalCaseCount(4)).toBe(4);
  });
});

describe("formatOutbreakDetailStatusLine", () => {
  it("names a missing case count instead of a silent em dash", () => {
    expect(formatOutbreakDetailStatusLine("active", null)).toBe(
      `Status: active · Cases: ${OUTBREAK_DETAIL_NO_CASE_COUNT_COPY}`,
    );
    expect(formatOutbreakDetailStatusLine("contained", undefined)).toBe(
      `Status: contained · Cases: ${OUTBREAK_DETAIL_NO_CASE_COUNT_COPY}`,
    );
  });

  it("keeps real zero and posted counts", () => {
    expect(formatOutbreakDetailStatusLine("active", 0)).toBe("Status: active · Cases: 0");
    expect(formatOutbreakDetailStatusLine("active", 7)).toBe("Status: active · Cases: 7");
  });
});
