/**
 * Quiet Operator copy for `/admin/insurance/claims/[id]`.
 * Missing claim data and fetch failures name real gaps — never surface raw throw strings.
 */

import { formatFacilityTimestampEt } from "@/lib/facility-wall-clock";

import {
  INSURANCE_CLAIM_NO_REPORTED_AT_COPY,
  formatInsuranceClaimDateOfLoss,
} from "./claims-display-copy";

export { formatInsuranceClaimDateOfLoss };

export const INSURANCE_CLAIM_DETAIL_AUTH_LOADING_COPY = "Loading insurance profile…";
export const INSURANCE_CLAIM_DETAIL_LOADING_COPY = "Loading claim…";

export const INSURANCE_CLAIM_DETAIL_NOT_FOUND_COPY = "Claim not found.";
export const INSURANCE_CLAIM_DETAIL_UNEXPECTED_FETCH_ERROR_COPY =
  "Could not load this claim. Try again, or contact support if this persists.";

/** One-line scope stamp — org context and Eastern calendar convention. */
export const INSURANCE_CLAIM_DETAIL_SCOPE_ET_COPY =
  "This claim is scoped to your organization; dates follow Eastern (ET).";

/** Reported timestamp on claim detail — Eastern wall clock, not browser locale. */
export function formatInsuranceClaimDetailReportedAt(iso: string | null | undefined): string {
  if (!iso || !iso.trim()) return INSURANCE_CLAIM_NO_REPORTED_AT_COPY;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return INSURANCE_CLAIM_NO_REPORTED_AT_COPY;
  return formatFacilityTimestampEt(iso);
}

export function resolveInsuranceClaimDetailLoadErrorMessage(options: {
  queryFailed: boolean;
  claimFound: boolean;
}): string | null {
  if (!options.queryFailed && options.claimFound) return null;
  if (options.queryFailed) return INSURANCE_CLAIM_DETAIL_UNEXPECTED_FETCH_ERROR_COPY;
  if (!options.claimFound) return INSURANCE_CLAIM_DETAIL_NOT_FOUND_COPY;
  return INSURANCE_CLAIM_DETAIL_UNEXPECTED_FETCH_ERROR_COPY;
}
