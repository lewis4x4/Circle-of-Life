import { describe, expect, it } from "vitest";

import {
  TRAINING_NO_NAME_COPY,
  TRAINING_NO_STAFF_COPY,
  formatTrainingStaffLabel,
} from "./training-display-copy";

describe("formatTrainingStaffLabel", () => {
  it("names a missing staff join", () => {
    expect(formatTrainingStaffLabel(null)).toBe(TRAINING_NO_STAFF_COPY);
    expect(formatTrainingStaffLabel(undefined)).toBe(TRAINING_NO_STAFF_COPY);
  });

  it("names a staff row with blank first and last names", () => {
    expect(formatTrainingStaffLabel({ first_name: "", last_name: "" })).toBe(
      TRAINING_NO_NAME_COPY,
    );
    expect(formatTrainingStaffLabel({ first_name: "  ", last_name: "  " })).toBe(
      TRAINING_NO_NAME_COPY,
    );
  });

  it("returns first name only when last is blank", () => {
    expect(formatTrainingStaffLabel({ first_name: "Jordan", last_name: "" })).toBe("Jordan");
    expect(formatTrainingStaffLabel({ first_name: "  Jordan  ", last_name: "" })).toBe("Jordan");
  });

  it("returns last name only when first is blank", () => {
    expect(formatTrainingStaffLabel({ first_name: "", last_name: "Lee" })).toBe("Lee");
    expect(formatTrainingStaffLabel({ first_name: "", last_name: "  Lee  " })).toBe("Lee");
  });

  it("returns both names trimmed when present", () => {
    expect(formatTrainingStaffLabel({ first_name: "Jordan", last_name: "Lee" })).toBe(
      "Jordan Lee",
    );
    expect(formatTrainingStaffLabel({ first_name: "  Jordan  ", last_name: "  Lee  " })).toBe(
      "Jordan Lee",
    );
  });
});
