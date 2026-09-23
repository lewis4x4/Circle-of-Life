/**
 * Header count sentences for the front desk and shift handoff (COL-649).
 *
 * Both pages printed "0 on site · 0 packages" / "0 unacknowledged" with no
 * facility chosen, before anything loaded, and after a failed read. The count
 * sentence now renders only when every count it states was actually read.
 */
import { formatMetric, metricFromRead } from "@/lib/metrics/metric-state";

type ReadStatus = { facilityReady: boolean; loading: boolean; error: unknown };

function readCount(read: ReadStatus, count: number | null) {
  return metricFromRead({
    scopeReady: read.facilityReady,
    loading: read.loading,
    error: read.error,
    value: count,
  });
}

/** "2 on site · 1 package awaiting pickup." — or null when either count is not known. */
export function frontDeskSummaryLine(
  read: ReadStatus & { onSiteCount: number | null; pendingPackages: number },
): string | null {
  const onSite = readCount(read, read.onSiteCount);
  const packages = readCount(read, read.pendingPackages);
  if (onSite.status !== "value" || packages.status !== "value") return null;
  const pkg = packages.value === 1 ? "package" : "packages";
  return `${formatMetric(onSite)} on site · ${formatMetric(packages)} ${pkg} awaiting pickup.`;
}

/** "3 unacknowledged on this shift." — or null when the board was not read. */
export function handoffSummaryLine(read: ReadStatus & { openCount: number }): string | null {
  const open = readCount(read, read.openCount);
  if (open.status !== "value") return null;
  return `${formatMetric(open)} unacknowledged on this shift.`;
}
