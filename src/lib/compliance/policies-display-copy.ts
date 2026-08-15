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
