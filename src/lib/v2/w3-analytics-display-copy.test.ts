import { describe, expect, it } from "vitest";

import {
  W3_ANALYTICS_NO_INCIDENTS_POSTED_COPY,
  W3_ANALYTICS_NO_OCCUPANCY_POSTED_COPY,
  W3_ANALYTICS_NO_READINESS_POSTED_COPY,
  W3_ANALYTICS_NO_RISK_POSTED_COPY,
  formatW3AnalyticsAvgRisk,
  formatW3AnalyticsOccupancyPct,
  formatW3AnalyticsRiskScore,
  formatW3AnalyticsSurveyReadinessPct,
  formatW3AnalyticsTotalIncidents,
} from "./w3-analytics-display-copy";

describe("formatW3AnalyticsOccupancyPct", () => {
  it("names the gap when occupancy is missing", () => {
    expect(formatW3AnalyticsOccupancyPct(null)).toBe(W3_ANALYTICS_NO_OCCUPANCY_POSTED_COPY);
    expect(formatW3AnalyticsOccupancyPct(undefined)).toBe(W3_ANALYTICS_NO_OCCUPANCY_POSTED_COPY);
  });

  it("keeps real zero as zero", () => {
    expect(formatW3AnalyticsOccupancyPct(0)).toBe("0");
  });

  it("formats posted occupancy values", () => {
    expect(formatW3AnalyticsOccupancyPct(87.5)).toBe("87.5");
  });
});

describe("formatW3AnalyticsRiskScore", () => {
  it("names the gap when risk score is missing", () => {
    expect(formatW3AnalyticsRiskScore(null)).toBe(W3_ANALYTICS_NO_RISK_POSTED_COPY);
    expect(formatW3AnalyticsRiskScore(undefined)).toBe(W3_ANALYTICS_NO_RISK_POSTED_COPY);
  });

  it("keeps real zero as zero", () => {
    expect(formatW3AnalyticsRiskScore(0)).toBe("0");
  });

  it("formats posted risk scores", () => {
    expect(formatW3AnalyticsRiskScore(42)).toBe("42");
  });
});

describe("formatW3AnalyticsSurveyReadinessPct", () => {
  it("names the gap when readiness is missing", () => {
    expect(formatW3AnalyticsSurveyReadinessPct(null)).toBe(W3_ANALYTICS_NO_READINESS_POSTED_COPY);
    expect(formatW3AnalyticsSurveyReadinessPct(undefined)).toBe(W3_ANALYTICS_NO_READINESS_POSTED_COPY);
  });

  it("keeps real zero as zero", () => {
    expect(formatW3AnalyticsSurveyReadinessPct(0)).toBe("0");
  });

  it("formats posted readiness values", () => {
    expect(formatW3AnalyticsSurveyReadinessPct(91)).toBe("91");
  });
});

describe("formatW3AnalyticsTotalIncidents", () => {
  it("names the gap when incident total is missing", () => {
    expect(formatW3AnalyticsTotalIncidents(null)).toBe(W3_ANALYTICS_NO_INCIDENTS_POSTED_COPY);
    expect(formatW3AnalyticsTotalIncidents(undefined)).toBe(W3_ANALYTICS_NO_INCIDENTS_POSTED_COPY);
  });

  it("keeps real zero as numeric zero", () => {
    expect(formatW3AnalyticsTotalIncidents(0)).toBe(0);
  });

  it("formats posted incident totals", () => {
    expect(formatW3AnalyticsTotalIncidents(5)).toBe(5);
  });
});

describe("formatW3AnalyticsAvgRisk", () => {
  it("names the gap when average risk is missing", () => {
    expect(formatW3AnalyticsAvgRisk(null)).toBe(W3_ANALYTICS_NO_RISK_POSTED_COPY);
    expect(formatW3AnalyticsAvgRisk(undefined)).toBe(W3_ANALYTICS_NO_RISK_POSTED_COPY);
  });

  it("keeps real zero as numeric zero", () => {
    expect(formatW3AnalyticsAvgRisk(0)).toBe(0);
  });

  it("formats posted average risk values", () => {
    expect(formatW3AnalyticsAvgRisk(33)).toBe(33);
  });
});
