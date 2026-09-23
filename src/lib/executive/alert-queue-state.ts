import {
  metricLoading,
  metricNotConfigured,
  metricUnavailable,
  metricValue,
  type MetricState,
} from "@/lib/metrics/metric-state";

/**
 * What the Executive Alerts page can honestly say about its queue (COL-649).
 *
 * An empty `exec_alerts` read is not "Triage queue clear: all interventions
 * routed and resolved". The queue only holds thresholds the alert evaluator
 * raised; rounding escalations, incidents and survey items live elsewhere, and
 * a failed or unscoped read is not empty at all.
 */
export type AlertQueueStatus = "loading" | "unavailable" | "not_configured" | "empty" | "rows";

export function resolveAlertQueueStatus(input: {
  loading: boolean;
  error: string | null;
  organizationId: string | null | undefined;
  rowCount: number;
}): AlertQueueStatus {
  if (input.loading) return "loading";
  if (input.error) return "unavailable";
  if (!input.organizationId) return "not_configured";
  return input.rowCount > 0 ? "rows" : "empty";
}

/** Severity tile value: a count only after a successful read. */
export function alertSeverityTileState(status: AlertQueueStatus, count: number): MetricState<number> {
  switch (status) {
    case "loading":
      return metricLoading();
    case "unavailable":
      return metricUnavailable();
    case "not_configured":
      return metricNotConfigured("No organization");
    default:
      return metricValue(count);
  }
}

export const ALERT_QUEUE_EMPTY_COPY = {
  headline: "No open executive alerts",
  body:
    "This queue holds only the thresholds the executive alert evaluator raised. Rounding escalations, incidents and survey items are tracked on their own pages, so an empty queue is not an all-clear.",
} as const;

export const ALERT_QUEUE_UNAVAILABLE_COPY = {
  headline: "Alerts could not be loaded",
  body: "The queue did not load, so nothing here should be read as clear. Retry, or open Overview for the portfolio picture.",
} as const;
