import type { RiskThresholds } from "./types";

/** Sum all item scores to get the total assessment score */
export function computeTotalScore(scores: Record<string, number>): number {
  return Object.values(scores).reduce((sum, v) => sum + v, 0);
}

/**
 * Find the risk level name whose [min, max] range includes the total score.
 * Returns the first matching level, or "unknown" if no threshold matches.
 */
export function lookupRiskLevel(
  totalScore: number,
  riskThresholds: RiskThresholds,
): string {
  const entries = Object.entries(riskThresholds).sort((a, b) => a[1][0] - b[1][0]);
  for (const [level, [min, max]] of entries) {
    if (totalScore >= min && totalScore <= max) return level;
  }
  return "unknown";
}

/** Compute next_due_date = assessmentDate + defaultFrequencyDays */
export function computeNextDueDate(
  assessmentDate: string,
  defaultFrequencyDays: number,
): string {
  const d = new Date(assessmentDate + "T00:00:00");
  d.setDate(d.getDate() + defaultFrequencyDays);
  return d.toISOString().slice(0, 10);
}

// --- Morse Fall → fall_risk_level mapping ---

const MORSE_LOW_MAX = 24;
const MORSE_STANDARD_MAX = 44;

/** Map a Morse Fall total score to the residents.fall_risk_level value */
export function mapMorseToFallRisk(
  morseScore: number,
): "low" | "standard" | "high" {
  if (morseScore <= MORSE_LOW_MAX) return "low";
  if (morseScore <= MORSE_STANDARD_MAX) return "standard";
  return "high";
}

// --- Acuity composite scoring ---

/** Morse risk level → numeric modifier for acuity formula */
function morseModifier(riskLevel: string | undefined | null): number {
  if (!riskLevel) return 0;
  if (riskLevel === "low") return 0;
  if (riskLevel === "standard") return 3;
  return 6; // high
}

/** Braden risk level → numeric modifier for acuity formula */
function bradenModifier(riskLevel: string | undefined | null): number {
  if (!riskLevel) return 0;
  if (riskLevel === "none" || riskLevel === "mild") return 0;
  if (riskLevel === "moderate") return 2;
  if (riskLevel === "high") return 4;
  return 6; // very_high
}

/**
 * Compute the acuity composite score from latest assessment data.
 *
 * Formula: (katzScore × 10) + morseModifier + bradenModifier
 *
 * acuity_level:
 *   0–19  → level_1
 *   20–39 → level_2
 *   40–78 → level_3
 */
export function computeAcuityComposite(latest: {
  katzScore?: number | null;
  morseRiskLevel?: string | null;
  bradenRiskLevel?: string | null;
}): { acuityScore: number; acuityLevel: "level_1" | "level_2" | "level_3" } {
  const katz = latest.katzScore ?? 0;
  const score = katz * 10 + morseModifier(latest.morseRiskLevel) + bradenModifier(latest.bradenRiskLevel);

  let level: "level_1" | "level_2" | "level_3";
  if (score <= 19) level = "level_1";
  else if (score <= 39) level = "level_2";
  else level = "level_3";

  return { acuityScore: score, acuityLevel: level };
}

/**
 * Determine if a risk level worsened compared to the prior level.
 * Uses ordered severity scales per assessment type.
 */
export function didRiskWorsen(
  assessmentType: string,
  newLevel: string,
  priorLevel: string | null | undefined,
): boolean {
  if (!priorLevel) return false; // first assessment — no comparison
  if (newLevel === priorLevel) return false;

  const scales: Record<string, string[]> = {
    katz_adl: ["level_1", "level_2", "level_3"],
    morse_fall: ["low", "standard", "high"],
    braden: ["none", "mild", "moderate", "high", "very_high"],
    phq9: ["minimal", "mild", "moderate", "moderately_severe", "severe"],
  };

  const scale = scales[assessmentType];
  if (!scale) return false;

  const newIdx = scale.indexOf(newLevel);
  const priorIdx = scale.indexOf(priorLevel);
  if (newIdx < 0 || priorIdx < 0) return false;

  return newIdx > priorIdx;
}
