import { metricFromRead, type MetricState } from "@/lib/metrics/metric-state";

/**
 * Export-batch tile on /admin/payroll (COL-649). Before a facility is chosen,
 * while loading, or after a failed read there is no count to show — the tile
 * says which, instead of "0" beside the facility gate.
 */
export function payrollBatchCountState(input: {
  facilityReady: boolean;
  loading: boolean;
  error: string | null;
  shownCount: number;
}): MetricState<number> {
  return metricFromRead({
    scopeReady: input.facilityReady,
    loading: input.loading,
    error: input.error,
    value: input.shownCount,
  });
}
