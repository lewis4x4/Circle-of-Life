import { describe, expect, it } from "vitest";

import {
  SHIFT_SWAP_NO_NAME_COPY,
  SHIFT_SWAP_NO_STAFF_COPY,
  formatShiftSwapStaffLabel,
} from "./shift-swaps-display-copy";

describe("formatShiftSwapStaffLabel", () => {
  it("names a missing staff record instead of generic unknown copy", () => {
    expect(formatShiftSwapStaffLabel(null)).toBe(SHIFT_SWAP_NO_STAFF_COPY);
    expect(formatShiftSwapStaffLabel(undefined)).toBe(SHIFT_SWAP_NO_STAFF_COPY);
  });

  it("names a posted staff record with blank first and last names", () => {
    expect(formatShiftSwapStaffLabel({ first_name: "", last_name: "" })).toBe(
      SHIFT_SWAP_NO_NAME_COPY,
    );
    expect(formatShiftSwapStaffLabel({ first_name: "   ", last_name: "  " })).toBe(
      SHIFT_SWAP_NO_NAME_COPY,
    );
  });

  it("returns a posted first name only", () => {
    expect(formatShiftSwapStaffLabel({ first_name: "Jordan", last_name: "" })).toBe("Jordan");
    expect(formatShiftSwapStaffLabel({ first_name: "  Jordan  ", last_name: "" })).toBe("Jordan");
  });

  it("returns a posted last name only", () => {
    expect(formatShiftSwapStaffLabel({ first_name: "", last_name: "Lee" })).toBe("Lee");
    expect(formatShiftSwapStaffLabel({ first_name: "", last_name: "  Lee  " })).toBe("Lee");
  });

  it("returns posted first and last names joined with a single space", () => {
    expect(formatShiftSwapStaffLabel({ first_name: "Jordan", last_name: "Lee" })).toBe(
      "Jordan Lee",
    );
    expect(formatShiftSwapStaffLabel({ first_name: "  Jordan  ", last_name: "  Lee  " })).toBe(
      "Jordan Lee",
    );
  });
});
