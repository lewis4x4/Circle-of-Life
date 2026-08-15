import { describe, expect, it } from "vitest";

import {
  RISK_NO_SCORE_POSTED_COPY,
  RISK_NO_TIMESTAMP_POSTED_COPY,
  formatRiskDateTime,
  formatRiskScore,
} from "./risk-display-copy";

const EM_DASH = "—";

describe("formatRiskScore", () => {
  it("names a missing score instead of an em dash", () => {
    expect(formatRiskScore(null)).toBe(RISK_NO_SCORE_POSTED_COPY);
    expect(formatRiskScore(undefined)).toBe(RISK_NO_SCORE_POSTED_COPY);
    expect(formatRiskScore(Number.NaN)).toBe(RISK_NO_SCORE_POSTED_COPY);
    expect(formatRiskScore(null)).not.toBe(EM_DASH);
  });

  it("keeps real zero as 0/100", () => {
    expect(formatRiskScore(0)).toBe("0/100");
  });

  it("formats posted scores with /100 suffix", () => {
    expect(formatRiskScore(72)).toBe("72/100");
    expect(formatRiskScore(100)).toBe("100/100");
  });
});

describe("formatRiskDateTime", () => {
  it("names a missing timestamp instead of an em dash", () => {
    expect(formatRiskDateTime(null)).toBe(RISK_NO_TIMESTAMP_POSTED_COPY);
    expect(formatRiskDateTime(undefined)).toBe(RISK_NO_TIMESTAMP_POSTED_COPY);
    expect(formatRiskDateTime("")).toBe(RISK_NO_TIMESTAMP_POSTED_COPY);
    expect(formatRiskDateTime("   ")).toBe(RISK_NO_TIMESTAMP_POSTED_COPY);
    expect(formatRiskDateTime(null)).not.toBe(EM_DASH);
  });

  it("formats posted ISO timestamps", () => {
    const formatted = formatRiskDateTime("2026-04-15T12:00:00.000Z");
    expect(formatted).not.toBe(RISK_NO_TIMESTAMP_POSTED_COPY);
    expect(formatted).not.toBe(EM_DASH);
  });
});
