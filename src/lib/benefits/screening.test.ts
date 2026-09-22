import { describe, expect, it } from "vitest";
import { benefitsScreeningReview } from "./screening";
import type { BenefitsScreening } from "./contracts";

const complete: BenefitsScreening = { married: "no", income_basis: "gross", income_cents: 298200, assets_cents: 200000, property: "no", life_insurance: "no", burial: "no" };
describe("dated benefits screening review", () => {
  it("does not turn missing facts into zero or eligibility", () => {
    expect(benefitsScreeningReview("smmc_ltc", {}, "2026-09-21").status).toBe("review_needed");
  });
  it("uses inclusive standard limits without claiming an agency decision", () => {
    const result = benefitsScreeningReview("smmc_ltc", complete, "2026-09-21");
    expect(result.status).toBe("within_standard_screen");
    expect(result.explanation).toContain("does not establish Medicaid eligibility");
  });
  it("routes over-limit facts to review, never denial", () => {
    const result = benefitsScreeningReview("smmc_ltc", { ...complete, income_cents: 298201 }, "2026-09-21");
    expect(result.status).toBe("review_needed"); expect(result.reasons.join(" ")).toContain("pathways");
  });
  it("does not reuse standards for another year, program or married household", () => {
    expect(benefitsScreeningReview("smmc_ltc", complete, "2027-01-01").status).toBe("review_needed");
    expect(benefitsScreeningReview("oss", complete, "2026-09-21").status).toBe("review_needed");
    expect(benefitsScreeningReview("smmc_ltc", { ...complete, married: "yes" }, "2026-09-21").status).toBe("review_needed");
  });
  it("preserves known zero and routes asset-treatment exceptions to review", () => {
    expect(benefitsScreeningReview("smmc_ltc", { ...complete, income_cents: 0, assets_cents: 0 }, "2026-09-21").status).toBe("within_standard_screen");
    expect(benefitsScreeningReview("smmc_ltc", { ...complete, life_insurance: "yes" }, "2026-09-21").status).toBe("review_needed");
  });
});
