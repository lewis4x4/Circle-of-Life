/**
 * Quiet Operator copy for the admin referral lead detail page (`/admin/referrals/[id]`).
 * Missing contact, conversion, and timestamp fields name real gaps — never fabricate values.
 */

import { ADMISSIONS_HUB_MISSING_DATE_COPY } from "./admissions-hub-display-copy";

export const REFERRAL_DETAIL_NO_DATE_OF_BIRTH_COPY = "No date of birth posted";
export const REFERRAL_DETAIL_NO_PHONE_COPY = "No phone posted";
export const REFERRAL_DETAIL_NO_EMAIL_COPY = "No email posted";
export const REFERRAL_DETAIL_NO_CONVERTED_RESIDENT_COPY = "No converted resident posted";

/** Timestamp on the referral detail page when unset or unparseable. */
export function formatReferralDetailTimestamp(iso: string | null | undefined): string {
  if (!iso || !iso.trim()) return ADMISSIONS_HUB_MISSING_DATE_COPY;
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return ADMISSIONS_HUB_MISSING_DATE_COPY;
  return parsed.toLocaleString();
}

/** Date of birth on the lead identity section when unset or blank. */
export function formatReferralDetailDateOfBirth(
  dateOfBirth: string | null | undefined,
): string {
  if (!dateOfBirth || !dateOfBirth.trim()) return REFERRAL_DETAIL_NO_DATE_OF_BIRTH_COPY;
  return dateOfBirth;
}

/** Phone on the lead identity section when unset or blank. */
export function formatReferralDetailPhone(phone: string | null | undefined): string {
  if (!phone || !phone.trim()) return REFERRAL_DETAIL_NO_PHONE_COPY;
  return phone;
}

/** Email on the lead identity section when unset or blank. */
export function formatReferralDetailEmail(email: string | null | undefined): string {
  if (!email || !email.trim()) return REFERRAL_DETAIL_NO_EMAIL_COPY;
  return email;
}

/** Converted resident id on the conversion section — never looks up or fabricates a name. */
export function formatReferralDetailConvertedResidentId(
  residentId: string | null | undefined,
): string {
  if (!residentId || !residentId.trim()) return REFERRAL_DETAIL_NO_CONVERTED_RESIDENT_COPY;
  return residentId;
}
