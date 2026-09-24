import type { AdmissionGate, ScreeningCoverage, ScreeningQuestion, ScreeningResult } from "./contracts";

type Knowledge = "yes" | "no" | "unknown";
export type ScreeningAnswers = Partial<Record<ScreeningQuestion, Knowledge>>;

/** Printed wording of the New Admits Medicaid Pending Criteria sheet, A–F. The income line comes from the rule in force. */
export function screeningQuestionText(question: ScreeningQuestion, gate: AdmissionGate): string {
  switch (question) {
    case "q_property_non_primary": return "Do you own any property that is not considered your primary residence?";
    case "q_income_over_limit": return `Is your income over ${dollars(gate.income_limit_cents)} per month?`;
    case "q_life_insurance": return "Do you have a life insurance policy?";
    case "q_burial_contract": return "Do you have a burial contract?";
    case "q_assets": return "Do you have any assets (IRAs, CDs, stocks, bonds)?";
    case "q_power_of_attorney": return "Do you have a power of attorney?";
  }
}

export const COVERAGE_LABELS: Record<ScreeningCoverage, string> = {
  unknown: "Not yet known",
  none: "No coverage",
  private_pay: "Private pay",
  medicaid_mma: "Medicaid card (gold card / MMA only)",
  application_pending: "Medicaid application already pending",
  smmc_ltc_enrolled: "Enrolled in long-term-care Medicaid",
};

export const RESULT_LABELS: Record<ScreeningResult, string> = {
  candidate: "Candidate: consider applying",
  not_qualified_now: "Does not qualify now",
  needs_answers: "Needs answers",
  already_enrolled: "Already enrolled",
};

export function dollars(cents: number) {
  return `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

const YES_REASON: Record<ScreeningQuestion, string> = {
  q_property_non_primary: "Owns property that is not the primary residence.",
  q_income_over_limit: "Monthly income is over the admission limit.",
  q_assets: "Countable assets are over the admission limit.",
  q_life_insurance: "Has a life insurance policy.",
  q_burial_contract: "Has a burial contract.",
  q_power_of_attorney: "Has a power of attorney.",
};
const UNKNOWN_REASON: Record<ScreeningQuestion, string> = {
  q_property_non_primary: "Whether they own property other than their home is not yet known.",
  q_income_over_limit: "Whether monthly income is over the limit is not yet known.",
  q_assets: "Whether countable assets are over the limit is not yet known.",
  q_life_insurance: "Whether they have life insurance is not yet known.",
  q_burial_contract: "Whether they have a burial contract is not yet known.",
  q_power_of_attorney: "Whether they have a power of attorney is not yet known.",
};

/**
 * Mirror of haven.benefits_screening_classify (migration 507) for an on-screen preview only;
 * the database classification is the record. Circle of Life screening policy, never an eligibility decision.
 * A stated amount answers its question; when a yes/no answer contradicts the amount, the question
 * counts as unknown so a person resolves it.
 */
export function classifyAdmissionScreening(
  coverage: ScreeningCoverage,
  answers: ScreeningAnswers,
  incomeCents: number | null | undefined,
  assetsCents: number | null | undefined,
  gate: AdmissionGate,
): { result: ScreeningResult; reasons: string[] } {
  if (coverage === "smmc_ltc_enrolled") {
    return { result: "already_enrolled", reasons: ["Already enrolled in long-term-care Medicaid; track renewal instead of a new application."] };
  }
  const reasons: string[] = [];
  let anyYes = false;
  let anyUnknown = false;
  for (const question of gate.disqualify) {
    const answer = answers[question] ?? "unknown";
    let state: Knowledge = answer;
    if (question === "q_income_over_limit" && incomeCents != null) {
      const over = incomeCents > gate.income_limit_cents;
      if (answer === "unknown") state = over ? "yes" : "no";
      else if ((answer === "yes") !== over) {
        state = "unknown";
        reasons.push("The income answer and the monthly income amount disagree; confirm which is right.");
      }
    } else if (question === "q_assets") {
      if (answer === "yes" && assetsCents == null) {
        state = "unknown";
        reasons.push("Assets were reported; record the countable balance to compare with the limit.");
      } else if (answer === "yes" && assetsCents != null) state = assetsCents > gate.assets_limit_cents ? "yes" : "no";
      else if (answer === "no" && assetsCents != null && assetsCents > gate.assets_limit_cents) {
        state = "unknown";
        reasons.push("The assets answer and the balance disagree; confirm which is right.");
      } else if (answer === "unknown" && assetsCents != null) state = assetsCents > gate.assets_limit_cents ? "yes" : "no";
    }
    if (state === "yes") { anyYes = true; reasons.push(YES_REASON[question]); }
    else if (state === "unknown") { anyUnknown = true; reasons.push(UNKNOWN_REASON[question]); }
  }
  return { result: anyYes ? "not_qualified_now" : anyUnknown ? "needs_answers" : "candidate", reasons };
}

/** "$1,234.56" or "1234.5" → cents; blank → null; anything else → NaN so the form can say so. */
export function parseDollarsToCents(input: string): number | null {
  const trimmed = input.trim().replace(/[$,\s]/g, "");
  if (!trimmed) return null;
  if (!/^\d+(\.\d{1,2})?$/.test(trimmed)) return Number.NaN;
  const [whole, fraction = ""] = trimmed.split(".");
  return Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
}
