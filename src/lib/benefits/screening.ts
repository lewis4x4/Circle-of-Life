import type { BenefitsProgram, BenefitsScreening, ScreeningStandard } from "./contracts";

/**
 * Review aid, never an eligibility decision or denial. The financial standard is an
 * effective-dated operating rule (`screening.standard_individual`) owned by the organization,
 * read from /api/admin/benefits/rules; nothing about eligibility is fixed in code.
 */
export function benefitsScreeningReview(program: BenefitsProgram, facts: BenefitsScreening, asOf: string, standard: ScreeningStandard | null) {
  const reasons: string[] = [];
  const standardInForce = Boolean(standard && (!standard.effective_from || asOf >= standard.effective_from));
  const applicable = program === "smmc_ltc" && facts.married === "no" && standardInForce;
  if (program !== "smmc_ltc") reasons.push("This program needs its own financial criteria.");
  if (!standard) reasons.push("No financial screening standard is recorded for this organization; an owner can record one under Benefits access.");
  else if (!standardInForce) reasons.push("The recorded financial standard is not yet in force for this date.");
  if (facts.married !== "no") reasons.push(facts.married === "yes" ? "Married applicants need a review of the applicable spouse rules." : "Marital status is not yet known.");
  if (facts.income_cents == null) reasons.push("Income is not yet known.");
  if (facts.income_basis !== "gross") reasons.push("Confirm gross income and how the agency will count it.");
  if (facts.assets_cents == null) reasons.push("Assets are not yet known.");
  for (const [key, label] of [["property", "property"], ["life_insurance", "life insurance"], ["burial", "burial arrangements"]] as const) {
    if (facts[key] === "yes") reasons.push(`Review the ${label} evidence and its treatment before relying on the asset amount.`);
    else if (facts[key] !== "no") reasons.push(`Whether ${label} applies is not yet known.`);
  }
  if (applicable && standard && facts.income_cents != null && facts.income_cents > standard.income_cents) reasons.push(`Reported income exceeds the recorded standard (${standard.label}); review possible applicable pathways with the benefits specialist.`);
  if (applicable && standard && facts.assets_cents != null && facts.assets_cents > standard.assets_cents) reasons.push(`Reported assets exceed the recorded standard (${standard.label}); their countability needs specialist review.`);
  return {
    status: reasons.length ? "review_needed" as const : "within_standard_screen" as const,
    title: reasons.length ? "Financial review needed" : `Reported amounts are within the recorded standard (${standard?.label ?? "standard"})`,
    reasons,
    explanation: "This screening aid does not establish Medicaid eligibility, approval, funding or admission clearance. Continue collecting evidence while the responsible person reviews the case.",
    rule: standard,
  };
}
