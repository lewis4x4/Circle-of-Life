/**
 * Quiet Operator copy for `/admin/insurance/policies/[id]`.
 * Missing policy data and fetch failures name real gaps — never surface raw throw strings.
 */

import { format, parseISO } from "date-fns";

import { formatInsurancePolicyExpirationDate } from "./policies-display-copy";
import { formatInsuranceRenewalTargetDate } from "./renewals-display-copy";
import { formatInsuranceClaimDateOfLoss } from "./claims-display-copy";

export { formatInsurancePolicyExpirationDate, formatInsuranceRenewalTargetDate, formatInsuranceClaimDateOfLoss };

export const INSURANCE_POLICY_DETAIL_AUTH_LOADING_COPY = "Loading insurance profile…";
export const INSURANCE_POLICY_DETAIL_LOADING_COPY = "Loading policy…";

export const INSURANCE_POLICY_DETAIL_NOT_FOUND_COPY = "Policy not found.";
export const INSURANCE_POLICY_DETAIL_UNEXPECTED_FETCH_ERROR_COPY =
  "Could not load this policy. Try again, or contact support if this persists.";

/** One-line scope stamp — org context and Eastern calendar convention. */
export const INSURANCE_POLICY_DETAIL_SCOPE_ET_COPY =
  "This policy is scoped to your organization; dates follow Eastern (ET).";

export const INSURANCE_POLICY_NO_EFFECTIVE_DATE_COPY = "No effective date posted";
export const INSURANCE_POLICY_NO_PERIOD_DATE_COPY = "No date posted";

/** Policy effective date on detail — never invents a calendar day. */
export function formatInsurancePolicyDetailEffectiveDate(iso: string | null | undefined): string {
  if (!iso || !iso.trim()) return INSURANCE_POLICY_NO_EFFECTIVE_DATE_COPY;
  const parsed = parseISO(iso.length <= 10 ? `${iso}T12:00:00.000Z` : iso);
  if (Number.isNaN(parsed.getTime())) return INSURANCE_POLICY_NO_EFFECTIVE_DATE_COPY;
  return format(parsed, "MMM d, yyyy");
}

/** Allocation period boundary on policy detail — never invents a calendar day. */
export function formatInsurancePolicyDetailPeriodDate(iso: string | null | undefined): string {
  if (!iso || !iso.trim()) return INSURANCE_POLICY_NO_PERIOD_DATE_COPY;
  const parsed = parseISO(iso.length <= 10 ? `${iso}T12:00:00.000Z` : iso);
  if (Number.isNaN(parsed.getTime())) return INSURANCE_POLICY_NO_PERIOD_DATE_COPY;
  return format(parsed, "MMM d, yyyy");
}

export function resolveInsurancePolicyDetailLoadErrorMessage(options: {
  queryFailed: boolean;
  policyFound: boolean;
}): string | null {
  if (!options.queryFailed && options.policyFound) return null;
  if (options.queryFailed) return INSURANCE_POLICY_DETAIL_UNEXPECTED_FETCH_ERROR_COPY;
  if (!options.policyFound) return INSURANCE_POLICY_DETAIL_NOT_FOUND_COPY;
  return INSURANCE_POLICY_DETAIL_UNEXPECTED_FETCH_ERROR_COPY;
}
