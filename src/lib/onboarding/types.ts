/**
 * Client-side onboarding Q&A model (localStorage via Zustand).
 * Designed so imports merge by stable `id` and answers survive question updates.
 */

export const ANSWER_TYPES = [
  "short_text",
  "long_text",
  "single_select",
  "multi_select",
  "yes_no",
  "number",
  "date",
] as const;

export type AnswerType = (typeof ANSWER_TYPES)[number];

export const IMPORTANCE_LEVELS = ["critical", "high", "normal"] as const;
export type ImportanceLevel = (typeof IMPORTANCE_LEVELS)[number];

export const CONFIDENCE_LEVELS = ["confirmed", "best_known", "needs_review"] as const;
export type ConfidenceLevel = (typeof CONFIDENCE_LEVELS)[number];

export interface OnboardingQuestion {
  id: string;
  prompt: string;
  department: string;
  category?: string;
  importance: ImportanceLevel;
  answerType: AnswerType;
  required?: boolean;
  /** Required when answerType is single_select */
  options?: string[];
}

export interface OnboardingResponse {
  value: string;
  confidence: ConfidenceLevel;
  enteredByName: string;
  updatedAt: string;
}

export interface OnboardingImportFileV1 {
  version: 1;
  questions: OnboardingQuestion[];
}
