/**
 * Quiet Operator copy for reputation reply lists and loaders.
 * Missing listing labels name real gaps — never fabricate labels or legacy generic copy.
 */

import { canClaimAllClear, metricFromRead, type MetricState } from "@/lib/metrics/metric-state";

export const REPUTATION_NO_LISTING_COPY = "No listing posted";

const EM_DASH = "—";
const LEGACY_UNKNOWN = "Unknown";
const LEGACY_UNKNOWN_LISTING = "Unknown Listing";
const LEGACY_UNNAMED = "Unnamed";
const LEGACY_UNNAMED_LISTING = "Unnamed listing";

function isBlankEmDashOrLegacyListingLabel(value: string): boolean {
  return (
    value === "" ||
    value === EM_DASH ||
    value === LEGACY_UNKNOWN ||
    value === LEGACY_UNKNOWN_LISTING ||
    value === LEGACY_UNNAMED ||
    value === LEGACY_UNNAMED_LISTING
  );
}

/** Listing label on a reputation reply when the join is missing, blank, em dash, or legacy generic copy. */
export function formatReputationListingLabel(label: string | null | undefined): string {
  if (label == null) return REPUTATION_NO_LISTING_COPY;
  const trimmed = label.trim();
  if (isBlankEmDashOrLegacyListingLabel(trimmed)) {
    return REPUTATION_NO_LISTING_COPY;
  }
  return trimmed;
}

/** Hub action-card subtitle — names the facility when the map has it. */
export function formatReputationHubCardSubtitle(
  facilityName: string | null | undefined,
): string {
  const trimmed = facilityName?.trim();
  if (trimmed) return `Connected listings and reply workflow for ${trimmed}.`;
  return "Connected listings and reply workflow for this facility.";
}

/**
 * Hub tile state for a count of accounts or replies. With no facility, while
 * loading, or after a failed read the tile says so instead of 0 (COL-649).
 */
export function reputationHubCountState(input: {
  facilityReady: boolean;
  loading: boolean;
  error: unknown;
  count: number | null | undefined;
}): MetricState<number> {
  return metricFromRead({
    scopeReady: input.facilityReady,
    loading: input.loading,
    error: input.error,
    value: input.count,
  });
}

export const REPUTATION_DRAFT_QUEUE_CLEAR_TITLE = "Inbox Zero";
export const REPUTATION_DRAFT_QUEUE_CLEAR_BODY = "All reputation exceptions resolved.";
export const REPUTATION_NO_LISTINGS_TITLE = "No listings connected";
export const REPUTATION_NO_LISTINGS_BODY = "Connect a listing to review and answer its reviews here.";

/**
 * "Inbox Zero" only when the replies loaded for a facility that has at least
 * one tracked listing and none of them is waiting on a draft. With no listing
 * there is nothing to review, which is not the same as resolved.
 */
export function reputationDraftQueueEmptyKind(input: {
  facilityReady: boolean;
  loading: boolean;
  error: unknown;
  accountCount: number;
  draftCount: number;
}): "clear" | "no_listings" | null {
  if (!input.facilityReady || input.loading || input.error || input.draftCount > 0) return null;
  return canClaimAllClear({ scopeSize: input.accountCount, issueCount: input.draftCount }) ? "clear" : "no_listings";
}
