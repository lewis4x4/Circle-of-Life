/**
 * Pure model for the new assessment entry page
 * (`/admin/residents/[id]/assessments/new`).
 *
 * Everything here derives from the selected `assessment_templates` row and
 * the answers entered so far. Nothing here reads the clock, the network, or
 * the DOM, so the page can be reasoned about (and tested) as a function of
 * (template, answers).
 *
 * Integrity rules this module enforces:
 *   - A total and an interpretation exist only when every section of the
 *     selected instrument is answered. Unanswered sections are never scored
 *     as zero and never produce a partial risk level.
 *   - Answers are pruned to the selected instrument's own items and option
 *     values before they are totalled or recorded, so nothing carried over
 *     from another instrument (or an edited payload) can reach the record.
 *   - Schedule intervals come from `default_frequency_days`, a Haven seed
 *     default. They are labelled as such; nothing here calls them a facility
 *     schedule or an instrument requirement.
 */

import { computeTotalScore, lookupRiskLevel } from "./scoring";
import type { AssessmentScores, AssessmentTemplate, AssessmentTemplateItem } from "./types";

export const ASSESSMENT_SCHEDULE_BASIS_COPY = "Haven default interval";
export const ASSESSMENT_PROVISIONAL_LABEL = "Provisional result";
export const ASSESSMENT_NOT_RECORDED_COPY = "Not yet recorded";
export const ASSESSMENT_RECORDED_LABEL = "Recorded";
export const ASSESSMENT_UNSAVED_COPY = "Unsaved assessment";
export const ASSESSMENT_COMPLETE_TO_CALCULATE_COPY =
  "Complete all required items to calculate the result.";
export const ASSESSMENT_SCORE_RANGE_UNSET_COPY = "Score range not set";

export interface SectionProgress {
  key: string;
  label: string;
  /** 1-based position inside the instrument. */
  position: number;
  answered: boolean;
  selectedValue: number | null;
  selectedLabel: string | null;
}

export interface EntryProgress {
  totalSections: number;
  answeredSections: number;
  remainingSections: number;
  complete: boolean;
  sections: SectionProgress[];
  firstUnansweredKey: string | null;
}

export type ProvisionalResult =
  | { state: "not_started"; totalSections: number }
  | { state: "in_progress"; answeredSections: number; totalSections: number }
  | {
      state: "complete";
      totalScore: number;
      riskLevel: string;
      scoreMax: number | null;
      scoreMin: number | null;
    };

export interface CompletedResult {
  totalScore: number;
  riskLevel: string;
  scores: AssessmentScores;
}

function optionForValue(item: AssessmentTemplateItem, value: unknown) {
  if (typeof value !== "number" || Number.isNaN(value)) return null;
  return item.options.find((opt) => opt.value === value) ?? null;
}

/**
 * Keep only answers that belong to the template's own items and match one of
 * that item's option values. Anything else (a stray key from a previous
 * instrument, a value no option offers) is dropped rather than summed.
 */
export function pruneScoresToTemplate(
  template: AssessmentTemplate,
  scores: Partial<Record<string, unknown>> | null | undefined,
): AssessmentScores {
  const pruned: AssessmentScores = {};
  if (!scores) return pruned;
  for (const item of template.items) {
    const opt = optionForValue(item, scores[item.key]);
    if (opt) pruned[item.key] = opt.value;
  }
  return pruned;
}

export function computeEntryProgress(
  template: AssessmentTemplate,
  scores: Partial<Record<string, unknown>> | null | undefined,
): EntryProgress {
  const pruned = pruneScoresToTemplate(template, scores);
  const sections: SectionProgress[] = template.items.map((item, index) => {
    const opt = optionForValue(item, pruned[item.key]);
    return {
      key: item.key,
      label: item.label,
      position: index + 1,
      answered: opt !== null,
      selectedValue: opt?.value ?? null,
      selectedLabel: opt?.label ?? null,
    };
  });
  const answeredSections = sections.filter((s) => s.answered).length;
  const totalSections = sections.length;
  return {
    totalSections,
    answeredSections,
    remainingSections: totalSections - answeredSections,
    complete: totalSections > 0 && answeredSections === totalSections,
    sections,
    firstUnansweredKey: sections.find((s) => !s.answered)?.key ?? null,
  };
}

/**
 * The completed result, or null while any section is unanswered. This is the
 * only path that may produce a total or a risk level for recording.
 */
export function computeCompletedResult(
  template: AssessmentTemplate,
  scores: Partial<Record<string, unknown>> | null | undefined,
): CompletedResult | null {
  const progress = computeEntryProgress(template, scores);
  if (!progress.complete) return null;
  const pruned = pruneScoresToTemplate(template, scores);
  const totalScore = computeTotalScore(pruned);
  return {
    totalScore,
    riskLevel: lookupRiskLevel(totalScore, template.risk_thresholds),
    scores: pruned,
  };
}

export function computeProvisionalResult(
  template: AssessmentTemplate,
  scores: Partial<Record<string, unknown>> | null | undefined,
): ProvisionalResult {
  const progress = computeEntryProgress(template, scores);
  if (progress.answeredSections === 0) {
    return { state: "not_started", totalSections: progress.totalSections };
  }
  if (!progress.complete) {
    return {
      state: "in_progress",
      answeredSections: progress.answeredSections,
      totalSections: progress.totalSections,
    };
  }
  const completed = computeCompletedResult(template, scores);
  if (!completed) {
    return {
      state: "in_progress",
      answeredSections: progress.answeredSections,
      totalSections: progress.totalSections,
    };
  }
  return {
    state: "complete",
    totalScore: completed.totalScore,
    riskLevel: completed.riskLevel,
    scoreMax: template.score_range_max,
    scoreMin: template.score_range_min,
  };
}

// --- Copy helpers -----------------------------------------------------------

function pluralSections(n: number): string {
  return n === 1 ? "section" : "sections";
}

export function formatSectionsCompleted(answered: number, total: number): string {
  return `${answered} of ${total} ${pluralSections(total)} completed`;
}

export function formatSectionsRemaining(remaining: number): string {
  if (remaining <= 0) return "All sections answered";
  return `${remaining} ${pluralSections(remaining)} remaining`;
}

export function formatScheduleInterval(days: number | null | undefined): string {
  if (days == null || Number.isNaN(days) || days <= 0) return "Interval not set";
  return days === 1 ? "Every day" : `Every ${days} days`;
}

export function formatScoreRange(
  min: number | null | undefined,
  max: number | null | undefined,
): string {
  if (min == null || max == null) return ASSESSMENT_SCORE_RANGE_UNSET_COPY;
  return `Score range ${min}–${max}`;
}

/** "14 of 23" when a maximum is known, otherwise just the total. */
export function formatScoreOfMax(total: number, max: number | null | undefined): string {
  if (max == null) return String(total);
  return `${total} of ${max}`;
}

export function formatRiskLevel(riskLevel: string): string {
  return riskLevel.replace(/_/g, " ");
}

export function formatPoints(value: number): string {
  return value === 1 ? "1 point" : `${value} points`;
}

export function sectionAnchorId(itemKey: string): string {
  return `assessment-section-${itemKey}`;
}

export function formatSwitchInstrumentWarning(
  instrumentName: string,
  answeredSections: number,
): string {
  const n = answeredSections;
  return `Changing the assessment discards the ${n} ${n === 1 ? "answer" : "answers"} entered for ${instrumentName}. Answers are never carried into another instrument.`;
}

export function formatDuplicateWarning(
  instrumentName: string,
  assessmentDateIso: string,
  residentName: string,
): string {
  const who = residentName ? ` for ${residentName}` : "";
  return `A ${instrumentName} dated ${assessmentDateIso} is already on record${who}. Recording again adds a second entry to the history; it does not replace the earlier one.`;
}
