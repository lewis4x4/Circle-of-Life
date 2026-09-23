/**
 * Quiet Operator copy for the survey-readiness binder evidence strip.
 * Missing survey history names a real gap — never a silent blank or fabricated visit.
 */

import { metricFromCount, type MetricState } from "@/lib/metrics/metric-state";

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
  const type = lastSurvey.type.replace(/_/g, " ");
  const result = lastSurvey.result.replace(/_/g, " ");
  return `${lastSurvey.date} · ${type} · ${result}`;
}

export type BinderEvidenceCounts = {
  documentCount: number | null;
  documentsExpired: number | null;
  expiringSoonCount: number | null;
  inservicesThisYear: number | null;
  drillsOverdue: number | null;
  drillsDueSoon: number | null;
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
 * invisible and "Drills due ≤60d 0" read as ready (COL-649).
 */
export function binderEvidenceTiles(evidence: BinderEvidenceCounts): BinderEvidenceTile[] {
  const state = (n: number | null) => metricFromCount({ count: n });
  return [
    { label: "Facility documents", state: state(evidence.documentCount) },
    { label: "Documents expired", state: state(evidence.documentsExpired), attentionTone: "danger" },
    { label: "Expiring ≤60d", state: state(evidence.expiringSoonCount), attentionTone: "warning" },
    { label: "In-services YTD", state: state(evidence.inservicesThisYear) },
    { label: "Drills overdue", state: state(evidence.drillsOverdue), attentionTone: "danger" },
    { label: "Drills due ≤60d", state: state(evidence.drillsDueSoon), attentionTone: "warning" },
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
