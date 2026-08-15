import { describe, expect, it } from "vitest";

import {
  MEDICATION_ERRORS_NO_REVIEW_TIME_COPY,
  MEDICATION_ERRORS_NO_SEVERITY_IN_VIEW_COPY,
  formatMedicationErrorReviewedAt,
  formatMedicationErrorsSeverityInView,
} from "./medication-errors-display-copy";

const EM_DASH = "—";

describe("formatMedicationErrorReviewedAt", () => {
  it("returns explicit copy when review time is missing or invalid", () => {
    expect(formatMedicationErrorReviewedAt(null)).toBe(MEDICATION_ERRORS_NO_REVIEW_TIME_COPY);
    expect(formatMedicationErrorReviewedAt(undefined)).toBe(MEDICATION_ERRORS_NO_REVIEW_TIME_COPY);
    expect(formatMedicationErrorReviewedAt("")).toBe(MEDICATION_ERRORS_NO_REVIEW_TIME_COPY);
    expect(formatMedicationErrorReviewedAt("   ")).toBe(MEDICATION_ERRORS_NO_REVIEW_TIME_COPY);
    expect(formatMedicationErrorReviewedAt("not-a-date")).toBe(MEDICATION_ERRORS_NO_REVIEW_TIME_COPY);
    expect(formatMedicationErrorReviewedAt(null)).not.toBe(EM_DASH);
  });

  it("formats posted review times as a non-empty locale string", () => {
    const iso = "2026-04-08T15:30:00.000Z";
    const formatted = formatMedicationErrorReviewedAt(iso);
    expect(formatted).toBe(new Date(iso).toLocaleString());
    expect(formatted.length).toBeGreaterThan(0);
  });
});

describe("formatMedicationErrorsSeverityInView", () => {
  it("returns explicit copy when severity breakdown is empty", () => {
    expect(formatMedicationErrorsSeverityInView({})).toBe(MEDICATION_ERRORS_NO_SEVERITY_IN_VIEW_COPY);
    expect(formatMedicationErrorsSeverityInView({})).not.toBe(EM_DASH);
  });

  it("joins severity counts when present", () => {
    expect(formatMedicationErrorsSeverityInView({ high: 2, low: 1 })).toBe("high: 2 · low: 1");
  });
});
