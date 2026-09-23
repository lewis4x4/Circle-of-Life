import {
  canClaimAllClear,
  formatMetric,
  metricNeedsFacility,
  metricNoData,
  metricUnavailable,
  metricValue,
  type MetricState,
} from "@/lib/metrics/metric-state";

/**
 * What an exception queue (overdue assessments, care-plan reviews, diet
 * orders) can honestly say about itself (COL-649).
 *
 * - `needs_facility`   no facility chosen, nothing was read
 * - `unavailable`      a read failed
 * - `nothing_on_file`  the read worked but there is nothing to check (no
 *                      assessments / no active care plans on file); an empty
 *                      queue here is a gap, not a clear
 * - `clear`            a successful read over real records found nothing due
 * - `items`            there are items in the queue
 */
export type ClinicalQueueState = "needs_facility" | "unavailable" | "nothing_on_file" | "clear" | "items";

export function describeClinicalQueue(input: {
  scopeReady: boolean;
  error?: unknown;
  /** How many records exist that the queue checks (null when not read). */
  scopeSize: number | null | undefined;
  itemCount: number;
}): ClinicalQueueState {
  if (!input.scopeReady) return "needs_facility";
  if (input.error) return "unavailable";
  if (input.itemCount > 0) return "items";
  if (canClaimAllClear({ scopeSize: input.scopeSize, issueCount: input.itemCount })) return "clear";
  if (typeof input.scopeSize !== "number") return "unavailable";
  return "nothing_on_file";
}

/** Count for a queue header chip: a number only when the queue state earned one. */
export function clinicalQueueCount(
  state: ClinicalQueueState,
  count: number,
  nothingOnFileReason: string,
): MetricState<number> {
  switch (state) {
    case "needs_facility":
      return metricNeedsFacility();
    case "unavailable":
      return metricUnavailable();
    case "nothing_on_file":
      return metricNoData(nothingOnFileReason);
    case "clear":
    case "items":
      return metricValue(count);
  }
}

/** "3 overdue" for a real count; "Overdue: Select a facility" otherwise. */
export function formatQueueChip(state: MetricState<number>, noun: string): string {
  if (state.status === "value") return `${state.value} ${noun}`;
  const label = noun.charAt(0).toUpperCase() + noun.slice(1);
  return `${label}: ${formatMetric(state)}`;
}
