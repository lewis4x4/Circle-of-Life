/**
 * "Recent alerts" on the facility overview (COL-649).
 *
 * The section used to print a hard-coded "No active alerts" without reading
 * anything — while Homewood's AHCA licence was four days from expiring. It now
 * evaluates the facility's own configured thresholds (licence expiry,
 * occupancy) and claims "none firing" only through canClaimAllClear: the
 * thresholds were read and at least one relevant threshold is enabled.
 */
import type { ThresholdRow } from "@/hooks/useFacilityThresholds";
import { canClaimAllClear } from "@/lib/metrics/metric-state";
import type { FacilityDetailRow } from "@/types/facility";

import { buildOperationalThresholdPreview, type OperationalPreviewLine } from "./operational-threshold-preview";

/** Threshold types the overview can evaluate from the facility row alone. */
export const OVERVIEW_EVALUATED_THRESHOLD_TYPES = [
  "license_expiry_days",
  "occupancy_low_pct",
  "occupancy_high_pct",
] as const;

export type FacilityRecentAlertsView =
  | { status: "loading" }
  | { status: "unavailable"; message: string }
  | { status: "not_configured"; message: string }
  | { status: "firing"; lines: OperationalPreviewLine[] }
  | { status: "clear"; message: string };

export function facilityRecentAlertsView(input: {
  facility: FacilityDetailRow;
  thresholds: readonly ThresholdRow[];
  loading: boolean;
  error: string | null;
}): FacilityRecentAlertsView {
  if (input.loading) return { status: "loading" };
  if (input.error) {
    return {
      status: "unavailable",
      message: "Alert thresholds could not be read, so this is not an all-clear.",
    };
  }
  const lines = buildOperationalThresholdPreview(input.facility, input.thresholds);
  if (lines.length > 0) return { status: "firing", lines };

  // Count only thresholds that had something to compare against: an enabled
  // licence threshold with no expiry date on file checked nothing.
  const hasLicenceDate = Boolean(input.facility.ahca_license_expiration);
  const rawOccupancy = input.facility.occupancy_pct ?? input.facility.current_occupancy;
  const hasOccupancy = rawOccupancy != null && Number.isFinite(Number(rawOccupancy));
  const evaluated = input.thresholds.filter((t) => {
    if (!t.enabled || !(OVERVIEW_EVALUATED_THRESHOLD_TYPES as readonly string[]).includes(t.threshold_type)) return false;
    return t.threshold_type === "license_expiry_days" ? hasLicenceDate : hasOccupancy;
  }).length;
  if (canClaimAllClear({ scopeSize: evaluated, issueCount: lines.length })) {
    return {
      status: "clear",
      message: "No licence-expiry or occupancy threshold is firing.",
    };
  }
  return {
    status: "not_configured",
    message:
      "No licence-expiry or occupancy alert threshold is enabled for this facility, so nothing is being checked. Set them on the Thresholds tab.",
  };
}
