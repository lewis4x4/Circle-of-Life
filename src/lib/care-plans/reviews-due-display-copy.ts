/**
 * Quiet Operator copy for care plan reviews-due roster resident labels and reasons.
 * Missing resident rows and blank names name real gaps — never fabricate labels.
 */

export const REVIEWS_DUE_NO_RESIDENT_POSTED_COPY = "No resident posted";
export const REVIEWS_DUE_NO_NAME_POSTED_COPY = "No name posted";

const EM_DASH = "—";

function isBlankOrEmDash(value: string | null | undefined): boolean {
  if (value == null) return true;
  const trimmed = String(value).trim();
  return trimmed === "" || trimmed === EM_DASH;
}

export type ReviewsDueResidentNameFields = {
  first_name: string | null;
  last_name: string | null;
};

function residentNameFromFields(r: ReviewsDueResidentNameFields): string {
  return `${r.first_name?.trim() ?? ""} ${r.last_name?.trim() ?? ""}`.trim();
}

/** Resident label on reviews-due rows when the join or name is unset, blank, or em dash. */
export function formatReviewsDueResidentLabel(
  resident: ReviewsDueResidentNameFields | null | undefined,
): string {
  if (!resident) return REVIEWS_DUE_NO_RESIDENT_POSTED_COPY;
  const name = residentNameFromFields(resident);
  if (isBlankOrEmDash(name)) return REVIEWS_DUE_NO_NAME_POSTED_COPY;
  return name;
}

/** Why a plan is in the queue because of its date. */
export function formatReviewsDueDateReason(daysOverdue: number): string {
  if (daysOverdue <= 0) return "Review due today";
  return daysOverdue === 1 ? "Review 1 day overdue" : `Review ${daysOverdue} days overdue`;
}

const ALERT_TRIGGER_LABELS: Record<string, string> = {
  fall_incident: "Fall",
  hospital_return: "Returned from hospital",
  condition_change: "Condition change",
  acuity_change: "Acuity changed",
  assessment_threshold: "Assessment threshold crossed",
  form_1823_renewed: "Form 1823 renewed",
  family_request: "Family requested a review",
  quarterly_due: "Review due",
  quarterly_overdue: "Review overdue",
};

/** Why a plan is in the queue because something happened; the trigger detail carries the date. */
export function formatReviewsDueAlertReason(
  triggerType: string | null | undefined,
  triggerDetail: string | null | undefined,
): string {
  const base = (triggerType && ALERT_TRIGGER_LABELS[triggerType]) || "Review requested";
  const detail = (triggerDetail ?? "").trim();
  return detail ? `${base}: ${detail}` : base;
}
