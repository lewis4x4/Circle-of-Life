import { describe, expect, it } from "vitest";

import {
  ASSESSMENT_NEW_NO_RISK_COPY,
  ASSESSMENT_NEW_NO_SCORE_COPY,
  formatAssessmentLiveScore,
  formatAssessmentRiskLevelLabel,
  isPostedAssessmentRiskLevel,
  isPostedAssessmentScore,
} from "./assessment-new-display-copy";

const EM_DASH = "—";

describe("isPostedAssessmentScore", () => {
  it("treats null and undefined as not posted", () => {
    expect(isPostedAssessmentScore(null)).toBe(false);
    expect(isPostedAssessmentScore(undefined)).toBe(false);
  });

  it("treats NaN as not posted", () => {
    expect(isPostedAssessmentScore(Number.NaN)).toBe(false);
  });

  it("keeps real zero as posted", () => {
    expect(isPostedAssessmentScore(0)).toBe(true);
  });
});

describe("formatAssessmentLiveScore", () => {
  it("names a missing live total", () => {
    expect(formatAssessmentLiveScore(null)).toBe(ASSESSMENT_NEW_NO_SCORE_COPY);
    expect(formatAssessmentLiveScore(undefined)).toBe(ASSESSMENT_NEW_NO_SCORE_COPY);
  });

  it("keeps real zero as 0", () => {
    expect(formatAssessmentLiveScore(0)).toBe("0");
  });

  it("formats a posted total", () => {
    expect(formatAssessmentLiveScore(12)).toBe("12");
  });

  it("never returns an em dash", () => {
    expect(formatAssessmentLiveScore(null)).not.toBe(EM_DASH);
    expect(formatAssessmentLiveScore(undefined)).not.toBe(EM_DASH);
  });
});

describe("isPostedAssessmentRiskLevel", () => {
  it("treats null, undefined, blank, and em dash as not posted", () => {
    expect(isPostedAssessmentRiskLevel(null)).toBe(false);
    expect(isPostedAssessmentRiskLevel(undefined)).toBe(false);
    expect(isPostedAssessmentRiskLevel("")).toBe(false);
    expect(isPostedAssessmentRiskLevel("   ")).toBe(false);
    expect(isPostedAssessmentRiskLevel(EM_DASH)).toBe(false);
  });

  it("keeps a posted risk level", () => {
    expect(isPostedAssessmentRiskLevel("high")).toBe(true);
    expect(isPostedAssessmentRiskLevel("very_high")).toBe(true);
  });
});

describe("formatAssessmentRiskLevelLabel", () => {
  it("names a missing risk level", () => {
    expect(formatAssessmentRiskLevelLabel(null)).toBe(ASSESSMENT_NEW_NO_RISK_COPY);
    expect(formatAssessmentRiskLevelLabel(undefined)).toBe(ASSESSMENT_NEW_NO_RISK_COPY);
    expect(formatAssessmentRiskLevelLabel("")).toBe(ASSESSMENT_NEW_NO_RISK_COPY);
    expect(formatAssessmentRiskLevelLabel(EM_DASH)).toBe(ASSESSMENT_NEW_NO_RISK_COPY);
  });

  it("formats a posted risk level", () => {
    expect(formatAssessmentRiskLevelLabel("very_high")).toBe("very high");
    expect(formatAssessmentRiskLevelLabel("level_1")).toBe("level 1");
  });

  it("never returns an em dash for a gap", () => {
    expect(formatAssessmentRiskLevelLabel(null)).not.toBe(EM_DASH);
    expect(formatAssessmentRiskLevelLabel(undefined)).not.toBe(EM_DASH);
  });
});
