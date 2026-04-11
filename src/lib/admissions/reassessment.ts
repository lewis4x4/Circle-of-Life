/**
 * ADL / LOC reassessment triggers (handoff — significant change).
 * Pure predicates for scheduling reviews; not a substitute for licensed clinical judgment.
 */

export type ReassessmentSignal = {
  code: string;
  label: string;
};

export type ReassessmentContext = {
  /** Falls in the trailing 30-day window */
  fallsLast30Days: number;
  /** New diagnoses flagged since last assessment */
  hasNewDiagnosis: boolean;
  /** Returned from hospitalization since last review */
  returnedFromHospitalization: boolean;
  /** Behavioral change documented */
  behavioralChangeDocumented: boolean;
  /** Weight change percent over trailing 30 days (signed) */
  weightChangePct30d: number | null;
};

const FALL_THRESHOLD = 3;
const WEIGHT_THRESHOLD_PCT = 5;

export function reassessmentSignals(ctx: ReassessmentContext): ReassessmentSignal[] {
  const out: ReassessmentSignal[] = [];
  if (ctx.fallsLast30Days >= FALL_THRESHOLD) {
    out.push({
      code: "falls_30d",
      label: `${ctx.fallsLast30Days} falls in 30 days (threshold ${FALL_THRESHOLD}+)`,
    });
  }
  if (ctx.hasNewDiagnosis) {
    out.push({ code: "new_diagnosis", label: "New diagnosis since last assessment" });
  }
  if (ctx.returnedFromHospitalization) {
    out.push({ code: "hospital_return", label: "Return from hospitalization" });
  }
  if (ctx.behavioralChangeDocumented) {
    out.push({ code: "behavior_change", label: "Documented behavioral change" });
  }
  if (
    ctx.weightChangePct30d != null &&
    Math.abs(ctx.weightChangePct30d) > WEIGHT_THRESHOLD_PCT
  ) {
    out.push({
      code: "weight_change",
      label: `Weight change ${ctx.weightChangePct30d.toFixed(1)}% in 30 days (threshold ±${WEIGHT_THRESHOLD_PCT}%)`,
    });
  }
  return out;
}

export function shouldTriggerReassessment(ctx: ReassessmentContext): boolean {
  return reassessmentSignals(ctx).length > 0;
}

/** Form 1823 / physician exam windows (days). */
export const MEDICAL_EXAM_PRIOR_DAYS = 60;
export const MEDICAL_EXAM_POST_DAYS = 30;
