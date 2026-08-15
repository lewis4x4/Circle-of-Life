import { describe, expect, it } from "vitest";

import {
  REVIEWS_DUE_NO_NAME_POSTED_COPY,
  REVIEWS_DUE_NO_RESIDENT_POSTED_COPY,
  formatReviewsDueResidentLabel,
} from "./reviews-due-display-copy";

const EM_DASH = "—";

describe("formatReviewsDueResidentLabel", () => {
  it("names a missing resident instead of Unknown", () => {
    expect(formatReviewsDueResidentLabel(null)).toBe(REVIEWS_DUE_NO_RESIDENT_POSTED_COPY);
    expect(formatReviewsDueResidentLabel(undefined)).toBe(REVIEWS_DUE_NO_RESIDENT_POSTED_COPY);
    expect(formatReviewsDueResidentLabel(null)).not.toBe("Unknown");
  });

  it("names a blank resident name instead of inventing one", () => {
    expect(formatReviewsDueResidentLabel({ first_name: null, last_name: null })).toBe(
      REVIEWS_DUE_NO_NAME_POSTED_COPY,
    );
    expect(formatReviewsDueResidentLabel({ first_name: "", last_name: "" })).toBe(
      REVIEWS_DUE_NO_NAME_POSTED_COPY,
    );
    expect(formatReviewsDueResidentLabel({ first_name: "   ", last_name: "  " })).toBe(
      REVIEWS_DUE_NO_NAME_POSTED_COPY,
    );
  });

  it("names an em dash resident name instead of a silent dash", () => {
    expect(formatReviewsDueResidentLabel({ first_name: EM_DASH, last_name: null })).toBe(
      REVIEWS_DUE_NO_NAME_POSTED_COPY,
    );
    expect(formatReviewsDueResidentLabel({ first_name: `  ${EM_DASH}  `, last_name: "" })).toBe(
      REVIEWS_DUE_NO_NAME_POSTED_COPY,
    );
  });

  it("returns first name only trimmed", () => {
    expect(formatReviewsDueResidentLabel({ first_name: "Jordan", last_name: null })).toBe("Jordan");
    expect(formatReviewsDueResidentLabel({ first_name: "  Jordan  ", last_name: null })).toBe("Jordan");
  });

  it("returns last name only trimmed", () => {
    expect(formatReviewsDueResidentLabel({ first_name: null, last_name: "Lee" })).toBe("Lee");
    expect(formatReviewsDueResidentLabel({ first_name: null, last_name: "  Lee  " })).toBe("Lee");
  });

  it("returns both names trimmed", () => {
    expect(formatReviewsDueResidentLabel({ first_name: "Jordan", last_name: "Lee" })).toBe("Jordan Lee");
    expect(formatReviewsDueResidentLabel({ first_name: "  Jordan  ", last_name: " Lee " })).toBe("Jordan Lee");
  });
});
