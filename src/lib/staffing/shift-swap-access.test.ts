import { describe, expect, it } from "vitest";
import { canApproveShiftSwaps } from "./shift-swap-access";

describe("swap approval authority", () => {
  it("allows scheduling managers and denies floor staff", () => {
    for (const role of ["owner", "org_admin", "facility_admin", "manager"]) expect(canApproveShiftSwaps(role)).toBe(true);
    for (const role of ["med_tech", "cook", "housekeeper", "coordinator", null]) expect(canApproveShiftSwaps(role)).toBe(false);
  });
});
