import { describe, expect, it } from "vitest";

import {
  SURVEY_BINDER_NO_SURVEY_HISTORY_COPY,
  binderChecklistSummary,
  binderEvidenceTiles,
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

describe("binderEvidenceTiles (COL-649)", () => {
  const counts = {
    documentCount: 12,
    documentsExpired: 0,
    expiringSoonCount: 1,
    inservicesThisYear: 4,
    drillsOverdue: 3,
    drillsDueSoon: 0,
  };

  it("surfaces overdue drills instead of hiding them behind a due-soon zero", () => {
    const tile = binderEvidenceTiles(counts).find((t) => t.label === "Drills overdue");
    expect(tile?.state).toEqual({ status: "value", value: 3 });
    expect(tile?.attentionTone).toBe("danger");
  });

  it("shows a failed count as unavailable, not 0", () => {
    const tile = binderEvidenceTiles({ ...counts, drillsOverdue: null }).find((t) => t.label === "Drills overdue");
    expect(tile?.state.status).toBe("unavailable");
  });
});

describe("binderChecklistSummary (COL-649)", () => {
  it("says nothing before a facility's items have loaded", () => {
    const base = { loading: false, loadError: null, statuses: [] };
    expect(binderChecklistSummary({ ...base, facilityReady: false })).toBeNull();
    expect(binderChecklistSummary({ ...base, facilityReady: true, loading: true })).toBeNull();
    expect(binderChecklistSummary({ ...base, facilityReady: true, loadError: "boom" })).toBeNull();
  });

  it("counts the loaded checklist", () => {
    expect(
      binderChecklistSummary({
        facilityReady: true,
        loading: false,
        loadError: null,
        statuses: ["ready", "missing", "in_progress"],
      }),
    ).toBe("1 ready · 1 missing across 3 tracked items.");
  });
});
