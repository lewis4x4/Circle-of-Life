import { describe, expect, it } from "vitest";

import {
  RISK_NO_SCORE_POSTED_COPY,
  RISK_NO_TIMESTAMP_POSTED_COPY,
  formatRiskDateTime,
  formatRiskScore,
  formatRiskBandsLine,
  riskPortfolioTone,
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

describe("riskPortfolioTone (COL-649)", () => {
  const bands = { critical_below: 50, high_below: 70, moderate_below: 85 };

  it("is neutral, not green, when no score was posted", () => {
    expect(riskPortfolioTone(null, bands)).toBe("indigo");
    expect(riskPortfolioTone(undefined, bands)).toBe("indigo");
  });

  it("colours a real score by the configured bands", () => {
    expect(riskPortfolioTone(40, bands)).toBe("red");
    expect(riskPortfolioTone(60, bands)).toBe("amber");
    expect(riskPortfolioTone(90, bands)).toBe("emerald");
  });

  it("follows a changed rule instead of fixed cut-offs (COL-710)", () => {
    const stricter = { critical_below: 65, high_below: 80, moderate_below: 90 };
    expect(riskPortfolioTone(60, stricter)).toBe("red");
    expect(riskPortfolioTone(75, stricter)).toBe("amber");
  });

  it("stays neutral when the bands could not be read", () => {
    expect(riskPortfolioTone(40, null)).toBe("indigo");
    expect(formatRiskBandsLine(null)).toMatch(/could not be read/);
  });
});
