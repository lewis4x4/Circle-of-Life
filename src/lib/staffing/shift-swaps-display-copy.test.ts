import { describe, expect, it } from "vitest";

import {
  SHIFT_SWAP_NO_COVERING_STAFF_COPY,
  formatShiftSwapCoveringName,
} from "./shift-swaps-display-copy";

const EM_DASH = "—";

describe("formatShiftSwapCoveringName", () => {
  it("names missing covering staff instead of an em dash", () => {
    expect(formatShiftSwapCoveringName(null)).toBe(SHIFT_SWAP_NO_COVERING_STAFF_COPY);
    expect(formatShiftSwapCoveringName(undefined)).toBe(SHIFT_SWAP_NO_COVERING_STAFF_COPY);
    expect(formatShiftSwapCoveringName("")).toBe(SHIFT_SWAP_NO_COVERING_STAFF_COPY);
    expect(formatShiftSwapCoveringName("   ")).toBe(SHIFT_SWAP_NO_COVERING_STAFF_COPY);
    expect(formatShiftSwapCoveringName("—")).toBe(SHIFT_SWAP_NO_COVERING_STAFF_COPY);
    expect(formatShiftSwapCoveringName("  —  ")).toBe(SHIFT_SWAP_NO_COVERING_STAFF_COPY);
    expect(formatShiftSwapCoveringName(null)).not.toBe(EM_DASH);
  });

  it("returns a posted covering staff name (trim only)", () => {
    expect(formatShiftSwapCoveringName("Alex Rivera")).toBe("Alex Rivera");
    expect(formatShiftSwapCoveringName("  Alex Rivera  ")).toBe("Alex Rivera");
  });
});
