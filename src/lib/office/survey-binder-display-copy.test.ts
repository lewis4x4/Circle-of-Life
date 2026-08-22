import { describe, expect, it } from "vitest";

import {
  SURVEY_BINDER_NO_SURVEY_HISTORY_COPY,
  formatBinderLastSurveyLine,
} from "./survey-binder-display-copy";

describe("formatBinderLastSurveyLine", () => {
  it("names a missing last survey instead of a silent blank", () => {
    expect(formatBinderLastSurveyLine(null)).toBe(SURVEY_BINDER_NO_SURVEY_HISTORY_COPY);
    expect(formatBinderLastSurveyLine(undefined)).toBe(SURVEY_BINDER_NO_SURVEY_HISTORY_COPY);
    expect(formatBinderLastSurveyLine(null)).not.toBe("");
  });

  it("formats posted survey fields with human-readable type and result", () => {
    expect(
      formatBinderLastSurveyLine({
        date: "2026-03-15",
        type: "annual_inspection",
        result: "no_deficiencies",
      }),
    ).toBe("2026-03-15 · annual inspection · no deficiencies");
  });
});
