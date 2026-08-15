import { describe, expect, it } from "vitest";

import {
  DISCHARGE_DETAIL_NO_DATE_COPY,
  formatDischargeDetailTimestamp,
} from "./discharge-detail-display-copy";

const EM_DASH = "—";

describe("formatDischargeDetailTimestamp", () => {
  it("names a missing or blank posted timestamp", () => {
    expect(formatDischargeDetailTimestamp(null)).toBe(DISCHARGE_DETAIL_NO_DATE_COPY);
    expect(formatDischargeDetailTimestamp(undefined)).toBe(DISCHARGE_DETAIL_NO_DATE_COPY);
    expect(formatDischargeDetailTimestamp("")).toBe(DISCHARGE_DETAIL_NO_DATE_COPY);
    expect(formatDischargeDetailTimestamp("   ")).toBe(DISCHARGE_DETAIL_NO_DATE_COPY);
  });

  it("names em dash and Unknown placeholders", () => {
    expect(formatDischargeDetailTimestamp(EM_DASH)).toBe(DISCHARGE_DETAIL_NO_DATE_COPY);
    expect(formatDischargeDetailTimestamp("Unknown")).toBe(DISCHARGE_DETAIL_NO_DATE_COPY);
    expect(formatDischargeDetailTimestamp(" unknown ")).toBe(DISCHARGE_DETAIL_NO_DATE_COPY);
  });

  it("names unparseable values", () => {
    expect(formatDischargeDetailTimestamp("not-a-date")).toBe(DISCHARGE_DETAIL_NO_DATE_COPY);
  });

  it("formats a parseable ISO timestamp with toLocaleString", () => {
    const iso = "2026-08-24T12:00:00.000Z";
    expect(formatDischargeDetailTimestamp(iso)).toBe(new Date(iso).toLocaleString());
  });

  it("never surfaces a lone em dash for detail timestamps", () => {
    const samples = [null, undefined, "", EM_DASH, "Unknown", "not-a-date", "2026-08-24T12:00:00.000Z"] as const;
    for (const sample of samples) {
      expect(formatDischargeDetailTimestamp(sample)).not.toBe(EM_DASH);
    }
  });
});
