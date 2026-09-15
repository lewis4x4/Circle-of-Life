import { describe, expect, it } from "vitest";

import { formatReviewsDueAlertReason, formatReviewsDueDateReason } from "./reviews-due-display-copy";

describe("formatReviewsDueDateReason", () => {
  it("counts days plainly and treats today or ahead as due today", () => {
    expect(formatReviewsDueDateReason(0)).toBe("Review due today");
    expect(formatReviewsDueDateReason(-2)).toBe("Review due today");
    expect(formatReviewsDueDateReason(1)).toBe("Review 1 day overdue");
    expect(formatReviewsDueDateReason(12)).toBe("Review 12 days overdue");
  });
});

describe("formatReviewsDueAlertReason", () => {
  it("names the trigger and keeps the detail the trigger wrote", () => {
    expect(formatReviewsDueAlertReason("hospital_return", "Returned from hospital Sep 09, 2026")).toBe(
      "Returned from hospital: Returned from hospital Sep 09, 2026",
    );
    expect(formatReviewsDueAlertReason("form_1823_renewed", null)).toBe("Form 1823 renewed");
  });

  it("does not invent a label for an unknown trigger", () => {
    expect(formatReviewsDueAlertReason("something_new", "  ")).toBe("Review requested");
    expect(formatReviewsDueAlertReason(null, "detail")).toBe("Review requested: detail");
  });
});
