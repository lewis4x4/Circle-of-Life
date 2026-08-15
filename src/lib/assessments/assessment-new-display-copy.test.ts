import { describe, expect, it } from "vitest";

import {
  ASSESSMENT_NEW_NO_SCORE_COPY,
  formatAssessmentLiveScore,
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
