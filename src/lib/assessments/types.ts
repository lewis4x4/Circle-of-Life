/**
 * One answer option inside an assessment item. `definition` is the
 * instrument's own supporting criteria for that option, when the seeded
 * template carries it. The UI renders it verbatim and never substitutes
 * wording of its own; templates without definitions show labels only.
 */
export interface AssessmentTemplateOption {
  value: number;
  label: string;
  definition?: string | null;
}

/** Shape of each item in assessment_templates.items jsonb */
export interface AssessmentTemplateItem {
  key: string;
  label: string;
  /** Instrument instructions for this item, when the seeded template carries them. */
  instructions?: string | null;
  options: AssessmentTemplateOption[];
}

/** Shape of assessment_templates.risk_thresholds jsonb — key is the risk level name, value is [min, max] inclusive */
export type RiskThresholds = Record<string, [number, number]>;

/** The full template row from Supabase (selected columns) */
export interface AssessmentTemplate {
  id: string;
  assessment_type: string;
  name: string;
  description: string | null;
  score_range_min: number | null;
  score_range_max: number | null;
  risk_thresholds: RiskThresholds;
  items: AssessmentTemplateItem[];
  default_frequency_days: number;
  required_role: string[];
  /**
   * COL-430. Set by migration 410 when an instrument is held. A held
   * instrument cannot be started or recorded: the database refuses the
   * insert, and the picker shows this text as a disabled line. NULL or
   * absent means available.
   */
  held_reason?: string | null;
}

/** Scores collected from the form — keys are item keys, values are numeric option values */
export type AssessmentScores = Record<string, number>;
