import type { BenefitsProgram, BenefitsScreening } from "./contracts";

/** Dated source for a review aid, never an eligibility decision or denial. */
export const STANDARD_HCBS_SCREEN = {
  effectiveFrom: "2026-01-01", effectiveThrough: "2026-12-31",
  incomeCents: 298_200, assetsCents: 200_000,
  source: "https://prod.myflfamilies.com/sites/default/files/2026-02/Appendix%20A-9%20SSI-Related%20Programs%20-%20Financial%20Eligibility%20Standards.pdf",
  label: "DCF 2026 standard individual ICP/HCBS financial limits",
} as const;

export function benefitsScreeningReview(program: BenefitsProgram, facts: BenefitsScreening, asOf: string) {
  const reasons: string[] = [];
  const applicable = program === "smmc_ltc" && facts.married === "no" && asOf >= STANDARD_HCBS_SCREEN.effectiveFrom && asOf <= STANDARD_HCBS_SCREEN.effectiveThrough;
  if (program !== "smmc_ltc") reasons.push("This program needs its own financial criteria.");
  if (asOf < STANDARD_HCBS_SCREEN.effectiveFrom || asOf > STANDARD_HCBS_SCREEN.effectiveThrough) reasons.push("The current financial standards need verification for this date.");
  if (facts.married !== "no") reasons.push(facts.married === "yes" ? "Married applicants need a review of the applicable spouse rules." : "Marital status is not yet known.");
  if (facts.income_cents == null) reasons.push("Income is not yet known.");
  if (facts.income_basis !== "gross") reasons.push("Confirm gross income and how the agency will count it.");
  if (facts.assets_cents == null) reasons.push("Assets are not yet known.");
  for (const [key, label] of [["property", "property"], ["life_insurance", "life insurance"], ["burial", "burial arrangements"]] as const) {
    if (facts[key] === "yes") reasons.push(`Review the ${label} evidence and its treatment before relying on the asset amount.`);
    else if (facts[key] !== "no") reasons.push(`Whether ${label} applies is not yet known.`);
  }
  if (applicable && facts.income_cents != null && facts.income_cents > STANDARD_HCBS_SCREEN.incomeCents) reasons.push("Reported income exceeds the standard individual screen; review possible applicable pathways with the benefits specialist.");
  if (applicable && facts.assets_cents != null && facts.assets_cents > STANDARD_HCBS_SCREEN.assetsCents) reasons.push("Reported assets exceed the standard individual screen; their countability needs specialist review.");
  return {
    status: reasons.length ? "review_needed" as const : "within_standard_screen" as const,
    title: reasons.length ? "Financial review needed" : "Reported amounts are within the standard individual screen",
    reasons,
    explanation: "This screening aid does not establish Medicaid eligibility, approval, funding or admission clearance. Continue collecting evidence while the responsible person reviews the case.",
    rule: STANDARD_HCBS_SCREEN,
  };
}
