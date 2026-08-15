import { describe, expect, it } from "vitest";

import { surveyTypeDisplayLabel } from "./facility-constants";
import { SURVEY_TYPE_NO_TYPE_COPY } from "./survey-type-display-copy";

const EM_DASH = "—";
const FIXTURE_TYPE = "annual";

describe("surveyTypeDisplayLabel", () => {
  it("names a missing or blank survey type instead of an em dash", () => {
    expect(surveyTypeDisplayLabel(null)).toBe(SURVEY_TYPE_NO_TYPE_COPY);
    expect(surveyTypeDisplayLabel(undefined)).toBe(SURVEY_TYPE_NO_TYPE_COPY);
    expect(surveyTypeDisplayLabel("")).toBe(SURVEY_TYPE_NO_TYPE_COPY);
    expect(surveyTypeDisplayLabel("   ")).toBe(SURVEY_TYPE_NO_TYPE_COPY);
    expect(surveyTypeDisplayLabel(null)).not.toBe(EM_DASH);
  });

  it("keeps posted survey type map labels unchanged", () => {
    expect(surveyTypeDisplayLabel(FIXTURE_TYPE)).toBe("Annual inspection");
    expect(surveyTypeDisplayLabel(FIXTURE_TYPE)).not.toBe(SURVEY_TYPE_NO_TYPE_COPY);
  });
});
