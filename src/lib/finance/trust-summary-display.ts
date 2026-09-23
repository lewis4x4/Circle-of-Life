import { billingCurrency } from "@/lib/billing/currency";
import type { ResidentTrustRow } from "@/lib/finance/load-trust-data";
import { formatMetric, metricNoData, metricUnavailable, metricValue, type MetricState } from "@/lib/metrics/metric-state";

export const TRUST_NO_RECORDS_COPY = "No resident-money records";

export type TrustSummaryTiles = {
  recordedFunds: string;
  legacyReview: string;
  ledgerDifferences: string;
  /** Only a real count of differences may colour the tile. */
  ledgerDifferencesCount: number | null;
};

/**
 * The three trust tiles (COL-649). With no resident-money records in scope the
 * page has nothing to total, so it says so instead of "$0.00 / 0 / 0".
 */
export function describeTrustSummary(rows: readonly ResidentTrustRow[], error: string | null): TrustSummaryTiles {
  const noRecords = rows.length === 0;
  const state = <T,>(value: T): MetricState<T> =>
    error ? metricUnavailable() : noRecords ? metricNoData(TRUST_NO_RECORDS_COPY) : metricValue(value);

  const legacyReview = rows.filter((row) => row.legacyReviewRequired).length;
  const ledgerDifferences = rows.filter((row) => !row.ledgerMatchesBalance).length;
  const unknownBalance = rows.some((row) => row.currentBalanceCents === null);
  const totalCents = rows.reduce((sum, row) => sum + (row.currentBalanceCents ?? 0), 0);

  const fundsState: MetricState<string> =
    legacyReview > 0
      ? state("Incomplete — review legacy balances")
      : unknownBalance
        ? state("Incomplete — some balances not established")
        : state(billingCurrency.format(totalCents / 100));
  const differencesState = state(ledgerDifferences);

  return {
    recordedFunds: formatMetric(fundsState),
    legacyReview: formatMetric(state(legacyReview)),
    ledgerDifferences: formatMetric(differencesState),
    ledgerDifferencesCount: differencesState.status === "value" ? differencesState.value : null,
  };
}
