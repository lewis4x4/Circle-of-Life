/** Shape of each item in assessment_templates.items jsonb */
export interface AssessmentTemplateItem {
  key: string;
  label: string;
  options: { value: number; label: string }[];
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
}

/** Scores collected from the form — keys are item keys, values are numeric option values */
export type AssessmentScores = Record<string, number>;
