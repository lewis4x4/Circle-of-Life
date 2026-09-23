/**
 * Quiet Operator copy for compliance policy document surfaces.
 * Missing publish dates name real gaps — never fabricate policy dates.
 */

import { format, isValid, parseISO } from "date-fns";

export const COMPLIANCE_POLICY_NO_PUBLISHED_DATE_COPY = "No date posted";

/** Published-at column — posted date as MMM d, yyyy or explicit missing copy. */
export function formatCompliancePolicyPublishedDate(
  publishedAt: string | null | undefined,
): string {
  if (publishedAt == null) return COMPLIANCE_POLICY_NO_PUBLISHED_DATE_COPY;

  const trimmed = publishedAt.trim();
  if (!trimmed) return COMPLIANCE_POLICY_NO_PUBLISHED_DATE_COPY;

  const iso = trimmed.length <= 10 ? `${trimmed}T12:00:00.000Z` : trimmed;
  const date = parseISO(iso);
  if (!isValid(date)) return COMPLIANCE_POLICY_NO_PUBLISHED_DATE_COPY;

  return format(date, "MMM d, yyyy");
}

/**
 * Count beside "Active Policies". Nothing is shown until a facility's policies
 * have actually loaded: "0 shown" with no facility, or after a failed read
 * that the page used to render as "No policies", is not a count (COL-649).
 */
export function compliancePolicyListCountLabel(input: {
  facilityReady: boolean;
  loading: boolean;
  error: string | null;
  count: number;
}): string | null {
  if (!input.facilityReady || input.error) return null;
  if (input.loading) return "Loading…";
  return `${input.count} shown`;
}
