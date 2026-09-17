import { describe, expect, it } from "vitest";

import {
  SURVEY_PACK_SECTIONS,
  defaultSurveyPackRequest,
  formatSurveyPackRange,
  parseSurveyPackRequest,
  surveyPackPrintHref,
  surveyPackSectionLabel,
  validateSurveyPackRequest,
} from "@/lib/registers/survey-pack";

describe("the default pack", () => {
  it("is the prior six months ending today, with every section", () => {
    const request = defaultSurveyPackRequest(new Date("2026-09-16T16:00:00Z"));
    expect(request.from).toBe("2026-03-16");
    expect(request.to).toBe("2026-09-16");
    expect(request.sections).toEqual(["register", "census", "visitors"]);
    expect(request.includeHolds).toBe(true);
  });
});

describe("validation", () => {
  const base = defaultSurveyPackRequest(new Date("2026-09-16T16:00:00Z"));

  it("refuses an empty pack", () => {
    expect(validateSurveyPackRequest({ ...base, sections: [] })).toContain(
      "Choose at least one section to print.",
    );
  });

  it("refuses a range that runs backwards", () => {
    expect(
      validateSurveyPackRequest({ ...base, from: "2026-06-30", to: "2026-01-01" }),
    ).toContain("The end of the range is before the start.");
  });

  it("accepts a single section", () => {
    expect(validateSurveyPackRequest({ ...base, sections: ["visitors"] })).toEqual([]);
  });
});

describe("the print address", () => {
  it("round trips a request", () => {
    const request = { ...defaultSurveyPackRequest(new Date("2026-09-16T16:00:00Z")), includeHolds: false };
    const href = surveyPackPrintHref(request);
    const parsed = parseSurveyPackRequest(new URLSearchParams(href.split("?")[1]));
    expect(parsed).toEqual(request);
  });

  it("drops a section name it does not recognise rather than passing it through", () => {
    const parsed = parseSurveyPackRequest(
      new URLSearchParams("from=2026-01-01&to=2026-06-30&sections=register,medications"),
    );
    expect(parsed.sections).toEqual(["register"]);
  });

  it("keeps the sections in pack order however they arrive", () => {
    const parsed = parseSurveyPackRequest(
      new URLSearchParams("from=2026-01-01&to=2026-06-30&sections=visitors,register"),
    );
    expect(parsed.sections).toEqual(["register", "visitors"]);
  });
});

describe("section labels", () => {
  it("has operator wording for every section", () => {
    for (const section of SURVEY_PACK_SECTIONS) {
      expect(surveyPackSectionLabel(section.id)).toBe(section.label);
      expect(section.label).not.toContain("_");
    }
  });
});

describe("range wording", () => {
  it("reads as the dates chosen, not the day before", () => {
    expect(formatSurveyPackRange("2026-01-01", "2026-06-30")).toBe(
      "January 1, 2026 to June 30, 2026",
    );
  });
});
