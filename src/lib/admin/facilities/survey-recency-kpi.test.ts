import { describe, expect, it } from "vitest";

import { SURVEY_RECENCY_NO_SURVEY_COPY } from "./survey-recency-display-copy";
import { surveyRecencyTileCopy } from "./survey-recency-kpi";

const EM_DASH = "—";
const FIXTURE_OVERDUE_DAYS = 451;

describe("surveyRecencyTileCopy", () => {
  it("names a missing survey recency gap instead of an em dash", () => {
    expect(surveyRecencyTileCopy(null).valueLine).toBe(SURVEY_RECENCY_NO_SURVEY_COPY);
    expect(surveyRecencyTileCopy(null).valueLine).toBe("No survey posted");
    expect(surveyRecencyTileCopy(null).valueLine).not.toBe(EM_DASH);
    expect(surveyRecencyTileCopy(null)).toMatchObject({
      title: "Days since last survey",
      valueClass: "text-muted-foreground",
      footnote: null,
    });
  });

  it("keeps posted overdue day counts unchanged", () => {
    expect(surveyRecencyTileCopy(FIXTURE_OVERDUE_DAYS).valueLine).toBe(`${FIXTURE_OVERDUE_DAYS} days`);
    expect(surveyRecencyTileCopy(FIXTURE_OVERDUE_DAYS).valueLine).not.toBe(SURVEY_RECENCY_NO_SURVEY_COPY);
  });
});
