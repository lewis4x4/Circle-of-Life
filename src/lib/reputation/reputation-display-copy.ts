/**
 * Quiet Operator copy for reputation reply lists and loaders.
 * Missing listing labels name real gaps — never fabricate labels or legacy generic copy.
 */

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
