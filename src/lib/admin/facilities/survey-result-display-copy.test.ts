import { describe, expect, it } from "vitest";

import { surveyResultDisplayLabel } from "./facility-constants";
import { SURVEY_RESULT_NO_RESULT_COPY } from "./survey-result-display-copy";

const EM_DASH = "—";
const FIXTURE_RESULT = "no_citations";

describe("surveyResultDisplayLabel", () => {
  it("names a missing or blank survey result instead of an em dash", () => {
    expect(surveyResultDisplayLabel(null)).toBe(SURVEY_RESULT_NO_RESULT_COPY);
    expect(surveyResultDisplayLabel(undefined)).toBe(SURVEY_RESULT_NO_RESULT_COPY);
    expect(surveyResultDisplayLabel("")).toBe(SURVEY_RESULT_NO_RESULT_COPY);
    expect(surveyResultDisplayLabel("   ")).toBe(SURVEY_RESULT_NO_RESULT_COPY);
    expect(surveyResultDisplayLabel(null)).not.toBe(EM_DASH);
  });

  it("keeps posted survey result alias labels unchanged", () => {
    expect(surveyResultDisplayLabel(FIXTURE_RESULT)).toBe("No citations");
    expect(surveyResultDisplayLabel(FIXTURE_RESULT)).not.toBe(SURVEY_RESULT_NO_RESULT_COPY);
  });
});
