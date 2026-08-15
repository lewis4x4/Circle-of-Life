import { describe, expect, it } from "vitest";

import {
  W2_LIST_NO_DETAIL_COPY,
  W2_LIST_NO_FACILITY_COPY,
  W2_LIST_NO_STATUS_COPY,
  W2_LIST_NO_TIME_COPY,
  formatW2ListDetail,
  formatW2ListFacilityName,
  formatW2ListOccurredAt,
  formatW2ListStatus,
} from "./w2-list-display-copy";

const EM_DASH = "—";

describe("formatW2ListFacilityName", () => {
  it("names a missing facility instead of an em dash", () => {
    expect(formatW2ListFacilityName(null)).toBe(W2_LIST_NO_FACILITY_COPY);
    expect(formatW2ListFacilityName(undefined)).toBe(W2_LIST_NO_FACILITY_COPY);
    expect(formatW2ListFacilityName("")).toBe(W2_LIST_NO_FACILITY_COPY);
    expect(formatW2ListFacilityName("   ")).toBe(W2_LIST_NO_FACILITY_COPY);
    expect(formatW2ListFacilityName(null)).not.toBe(EM_DASH);
  });

  it("returns a posted facility name trimmed", () => {
    expect(formatW2ListFacilityName("Oakridge ALF")).toBe("Oakridge ALF");
    expect(formatW2ListFacilityName("  Oakridge ALF  ")).toBe("Oakridge ALF");
  });
});

describe("formatW2ListStatus", () => {
  it("names a missing status instead of an em dash", () => {
    expect(formatW2ListStatus(null)).toBe(W2_LIST_NO_STATUS_COPY);
    expect(formatW2ListStatus(undefined)).toBe(W2_LIST_NO_STATUS_COPY);
    expect(formatW2ListStatus("")).toBe(W2_LIST_NO_STATUS_COPY);
    expect(formatW2ListStatus("   ")).toBe(W2_LIST_NO_STATUS_COPY);
    expect(formatW2ListStatus(null)).not.toBe(EM_DASH);
  });

  it("returns a posted status trimmed", () => {
    expect(formatW2ListStatus("Open")).toBe("Open");
    expect(formatW2ListStatus("  Active  ")).toBe("Active");
  });
});

describe("formatW2ListDetail", () => {
  it("names a missing detail instead of an em dash", () => {
    expect(formatW2ListDetail(null)).toBe(W2_LIST_NO_DETAIL_COPY);
    expect(formatW2ListDetail(undefined)).toBe(W2_LIST_NO_DETAIL_COPY);
    expect(formatW2ListDetail("")).toBe(W2_LIST_NO_DETAIL_COPY);
    expect(formatW2ListDetail("   ")).toBe(W2_LIST_NO_DETAIL_COPY);
    expect(formatW2ListDetail(null)).not.toBe(EM_DASH);
  });

  it("returns posted detail trimmed", () => {
    expect(formatW2ListDetail("Fall with injury")).toBe("Fall with injury");
    expect(formatW2ListDetail("  Pending review  ")).toBe("Pending review");
  });
});

describe("formatW2ListOccurredAt", () => {
  it("names a missing or invalid time instead of an em dash", () => {
    expect(formatW2ListOccurredAt(null)).toBe(W2_LIST_NO_TIME_COPY);
    expect(formatW2ListOccurredAt(undefined)).toBe(W2_LIST_NO_TIME_COPY);
    expect(formatW2ListOccurredAt("")).toBe(W2_LIST_NO_TIME_COPY);
    expect(formatW2ListOccurredAt("   ")).toBe(W2_LIST_NO_TIME_COPY);
    expect(formatW2ListOccurredAt("not-a-date")).toBe(W2_LIST_NO_TIME_COPY);
    expect(formatW2ListOccurredAt(null)).not.toBe(EM_DASH);
  });

  it("formats a posted valid ISO timestamp", () => {
    expect(formatW2ListOccurredAt("2026-08-15T14:30:00.000Z")).toBe("2026-08-15 14:30");
  });
});
