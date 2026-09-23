import { metricFromCount, metricLoading, type MetricState } from "@/lib/metrics/metric-state";

type HeadCount = { count: number | null | undefined; error?: unknown };

export type VendorDetailCounts = {
  contracts: MetricState<number>;
  pos: MetricState<number>;
  invoices: MetricState<number>;
};

export const VENDOR_DETAIL_COUNTS_LOADING: VendorDetailCounts = {
  contracts: metricLoading(),
  pos: metricLoading(),
  invoices: metricLoading(),
};

/**
 * Vendor detail tiles. A failed or missing head count reads "Unavailable",
 * never 0 contracts / purchase orders / invoices (COL-708).
 */
export function vendorDetailCounts(ct: HeadCount, po: HeadCount, inv: HeadCount): VendorDetailCounts {
  return {
    contracts: metricFromCount(ct),
    pos: metricFromCount(po),
    invoices: metricFromCount(inv),
  };
}
