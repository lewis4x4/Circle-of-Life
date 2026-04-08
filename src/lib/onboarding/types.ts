/**
 * Onboarding Q&A model — persisted in Supabase (`onboarding_questions`, `onboarding_responses`).
 * Imports merge by stable `id`; answers are keyed by `question_id` per organization.
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
  /** Plain-English explanation of what the question asks and why it matters */
  helpText?: string;
  /** e.g. CEO, CFO, COO, or "All leadership" */
  assignedTo?: string;
  department: string;
  category?: string;
  importance: ImportanceLevel;
  answerType: AnswerType;
  required?: boolean;
  /** Required when answerType is single_select */
  options?: string[];
  /** Display order (lower first); falls back to department + id when absent */
  sortOrder?: number;
}

export interface OnboardingResponse {
  value: string;
  confidence: ConfidenceLevel;
  enteredByName: string;
  updatedAt: string;
  enteredByUserId?: string | null;
}

export interface OnboardingImportFileV1 {
  version: 1;
  questions: OnboardingQuestion[];
}
