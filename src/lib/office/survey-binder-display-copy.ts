/**
 * Quiet Operator copy for the survey-readiness binder evidence strip.
 * Missing survey history names a real gap — never a silent blank or fabricated visit.
 */

import { metricFromCount, metricUnavailable, type MetricState } from "@/lib/metrics/metric-state";
import { enumLabel } from "@/lib/display/enum-label";

export const SURVEY_BINDER_NO_SURVEY_HISTORY_COPY = "No survey history recorded.";

export type BinderLastSurveyFields = {
  date: string;
  type: string;
  result: string;
};

/** Last survey KPI line — posted visit fields or a named gap when none on record. */
export function formatBinderLastSurveyLine(
  lastSurvey: BinderLastSurveyFields | null | undefined,
): string {
  if (!lastSurvey) return SURVEY_BINDER_NO_SURVEY_HISTORY_COPY;
  const type = enumLabel(lastSurvey.type, { case: "lower" });
  const result = enumLabel(lastSurvey.result, { case: "lower" });
  return `${lastSurvey.date} · ${type} · ${result}`;
}

export type BinderEvidenceCounts = {
  documentCount: number | null;
  documentsExpired: number | null;
  expiringSoonCount: number | null;
  inservicesThisYear: number | null;
  drillsOverdue: number | null;
  drillsDueSoon: number | null;
  /** `survey_binder.due_window_days` in force (COL-710); null when it could not be read. */
  dueWindowDays: number | null;
};

export type BinderEvidenceTile = {
  label: string;
  state: MetricState<number>;
  attentionTone?: "warning" | "danger";
};

/**
 * Evidence tiles for the binder. A null count is a failed read and shows
 * "Unavailable", never 0. Overdue drills and expired documents get their own
 * tiles: the due-soon windows start today, so anything already late was
 * invisible and a zero "Drills due" read as ready (COL-649). The look-ahead
 * window is the organization's setting (COL-710); when it could not be read,
 * the two window tiles say so instead of counting against a guessed window.
 */
export function binderEvidenceTiles(evidence: BinderEvidenceCounts): BinderEvidenceTile[] {
  const state = (n: number | null) => metricFromCount({ count: n });
  const days = evidence.dueWindowDays;
  const windowState = (n: number | null): MetricState<number> =>
    days === null ? metricUnavailable("Window setting unavailable") : state(n);
  const windowLabel = (what: string) => (days === null ? `${what} soon` : `${what} ≤${days}d`);
  return [
    { label: "Facility documents", state: state(evidence.documentCount) },
    { label: "Documents expired", state: state(evidence.documentsExpired), attentionTone: "danger" },
    { label: windowLabel("Expiring"), state: windowState(evidence.expiringSoonCount), attentionTone: "warning" },
    { label: "In-services YTD", state: state(evidence.inservicesThisYear) },
    { label: "Drills overdue", state: state(evidence.drillsOverdue), attentionTone: "danger" },
    { label: windowLabel("Drills due"), state: windowState(evidence.drillsDueSoon), attentionTone: "warning" },
  ];
}

/**
 * Header summary of the manual checklist. Null until a facility's items have
 * actually loaded: "0 ready · 0 missing across 0 tracked items" under All
 * facilities described a binder nobody had read (COL-649).
 */
export function binderChecklistSummary(input: {
  facilityReady: boolean;
  loading: boolean;
  loadError: string | null;
  statuses: readonly string[];
}): string | null {
  if (!input.facilityReady || input.loading || input.loadError) return null;
  const ready = input.statuses.filter((s) => s === "ready").length;
  const missing = input.statuses.filter((s) => s === "missing").length;
  const total = input.statuses.length;
  return `${ready} ready · ${missing} missing across ${total} tracked item${total === 1 ? "" : "s"}.`;
}
