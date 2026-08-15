/**
 * Quiet Operator copy for the admin admission case detail page (`/admin/admissions/[id]`).
 * Missing dates, beds, and linked records name real gaps — never fabricate values.
 */

import { formatReferralDetailTimestamp } from "./referral-detail-display-copy";

export const ADMISSION_DETAIL_NO_BED_COPY = "No bed posted";
export const ADMISSION_DETAIL_NO_EFFECTIVE_DATE_COPY = "No effective date posted";
export const ADMISSION_DETAIL_NO_REFERRAL_LEAD_COPY = "No referral lead posted";
export const ADMISSION_DETAIL_NO_FORM1823_RECORD_COPY = "No record posted";
export const ADMISSION_DETAIL_NO_CHECKLIST_RECEIVED_COPY = "No received date posted";
export const ADMISSION_DETAIL_NO_AMOUNT_COPY = "No amount posted";

/** Bed label on the case overview when unset or blank. */
export function formatAdmissionDetailBedLabel(bedLabel: string | null | undefined): string {
  if (!bedLabel || !bedLabel.trim()) return ADMISSION_DETAIL_NO_BED_COPY;
  return bedLabel.trim();
}

/** Effective date on a rate term row when unset or blank. */
export function formatAdmissionDetailEffectiveDate(
  effectiveDate: string | null | undefined,
): string {
  if (!effectiveDate || !effectiveDate.trim()) return ADMISSION_DETAIL_NO_EFFECTIVE_DATE_COPY;
  return effectiveDate.trim();
}

/** Referral lead name on the case overview — never invents a person name. */
export function formatAdmissionDetailReferralLeadName(
  lead: { first_name: string; last_name: string } | null | undefined,
): string {
  if (!lead) return ADMISSION_DETAIL_NO_REFERRAL_LEAD_COPY;
  const name = `${lead.first_name ?? ""} ${lead.last_name ?? ""}`.trim();
  if (!name) return ADMISSION_DETAIL_NO_REFERRAL_LEAD_COPY;
  return name;
}

/** Timestamp on the admission case detail page when unset or unparseable. */
export function formatAdmissionDetailTimestamp(iso: string | null | undefined): string {
  return formatReferralDetailTimestamp(iso);
}

/** Latest Form 1823 record update timestamp when no record exists or updated_at is unset. */
export function formatAdmissionDetailForm1823LatestUpdated(
  record: { updated_at: string | null } | null | undefined,
): string {
  if (!record) return ADMISSION_DETAIL_NO_FORM1823_RECORD_COPY;
  return formatReferralDetailTimestamp(record.updated_at);
}

/** Checklist received timestamp on the Form 1823 section when unset or blank. */
export function formatAdmissionDetailChecklistReceivedAt(
  receivedAt: string | null | undefined,
): string {
  if (!receivedAt || !receivedAt.trim()) return ADMISSION_DETAIL_NO_CHECKLIST_RECEIVED_COPY;
  return formatReferralDetailTimestamp(receivedAt);
}

/** Quoted or schedule rate amounts in cents when unset, null, or unparseable. */
export function formatAdmissionDetailCents(value: number | null | undefined): string {
  if (typeof value !== "number" || Number.isNaN(value)) return ADMISSION_DETAIL_NO_AMOUNT_COPY;
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value / 100);
}
