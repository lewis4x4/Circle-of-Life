/**
 * Quiet Operator copy for insurance claims list and detail surfaces.
 * Missing claim numbers, dates, and report timestamps name real gaps — never fabricate values.
 */

import { format, parseISO } from "date-fns";

export const INSURANCE_CLAIM_NO_CLAIM_NUMBER_COPY = "No claim number posted";
export const INSURANCE_CLAIM_NO_DATE_OF_LOSS_COPY = "No date of loss posted";
export const INSURANCE_CLAIM_NO_REPORTED_AT_COPY = "No reported date posted";

/** Carrier claim number when unset or blank. */
export function formatInsuranceClaimNumber(claimNumber: string | null | undefined): string {
  if (!claimNumber || !claimNumber.trim()) return INSURANCE_CLAIM_NO_CLAIM_NUMBER_COPY;
  return claimNumber;
}

/** Date of loss on a claim row or summary — never invents a calendar day. */
export function formatInsuranceClaimDateOfLoss(iso: string | null | undefined): string {
  if (!iso || !iso.trim()) return INSURANCE_CLAIM_NO_DATE_OF_LOSS_COPY;
  const parsed = parseISO(iso.length <= 10 ? `${iso}T12:00:00.000Z` : iso);
  if (Number.isNaN(parsed.getTime())) return INSURANCE_CLAIM_NO_DATE_OF_LOSS_COPY;
  return format(parsed, "MMM d, yyyy");
}

/** When the claim was reported to the carrier — never invents a timestamp. */
export function formatInsuranceClaimReportedAt(iso: string | null | undefined): string {
  if (!iso || !iso.trim()) return INSURANCE_CLAIM_NO_REPORTED_AT_COPY;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return INSURANCE_CLAIM_NO_REPORTED_AT_COPY;
  return d.toLocaleString();
}
