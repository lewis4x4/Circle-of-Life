import { describe, expect, it } from "vitest";

import {
  SURVEY_PACK_NO_FACILITY_NAME_COPY,
  formatSurveyPackBuildingName,
} from "./survey-pack-display-copy";

describe("formatSurveyPackBuildingName", () => {
  it("returns a posted facility name trimmed", () => {
    expect(formatSurveyPackBuildingName("Anon Facility A")).toBe("Anon Facility A");
    expect(formatSurveyPackBuildingName("  Anon Facility A  ")).toBe("Anon Facility A");
  });

  it("names the gap without the selected facility when the name is missing", () => {
    expect(formatSurveyPackBuildingName(null)).toBe(SURVEY_PACK_NO_FACILITY_NAME_COPY);
    expect(formatSurveyPackBuildingName(undefined)).toBe(SURVEY_PACK_NO_FACILITY_NAME_COPY);
    expect(formatSurveyPackBuildingName("")).toBe(SURVEY_PACK_NO_FACILITY_NAME_COPY);
    expect(formatSurveyPackBuildingName("   ")).toBe(SURVEY_PACK_NO_FACILITY_NAME_COPY);
    expect(formatSurveyPackBuildingName(null)).not.toMatch(/selected facility/i);
  });
});
