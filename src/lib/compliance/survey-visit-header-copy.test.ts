import { describe, expect, it } from "vitest";

import {
  SURVEY_VISIT_CONTEXT_ARIA_LABEL,
  SURVEY_VISIT_CONTEXT_TOOLTIP,
  SURVEY_VISIT_FACILITY_HEADER_LABEL,
} from "./survey-visit-header-copy";

describe("survey visit header copy", () => {
  it("uses the idle accessible name — never a Loading… string", () => {
    expect(SURVEY_VISIT_CONTEXT_ARIA_LABEL).toBe("Survey visit context");
    expect(SURVEY_VISIT_CONTEXT_ARIA_LABEL.toLowerCase()).not.toContain("loading");
  });

  it("ships a finished tooltip sentence without a trailing ellipsis", () => {
    expect(SURVEY_VISIT_CONTEXT_TOOLTIP).toMatch(/survey trail\.$/);
    expect(SURVEY_VISIT_CONTEXT_TOOLTIP).not.toMatch(/…$/);
    expect(SURVEY_VISIT_CONTEXT_TOOLTIP.toLowerCase()).not.toContain("loading");
  });

  it("names the facility header label without loading copy", () => {
    expect(SURVEY_VISIT_FACILITY_HEADER_LABEL).toBe("Survey visit");
    expect(SURVEY_VISIT_FACILITY_HEADER_LABEL.toLowerCase()).not.toContain("loading");
  });
});
