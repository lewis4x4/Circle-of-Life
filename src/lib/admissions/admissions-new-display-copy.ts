/**
 * Quiet Operator copy for the new admission case page (`/admin/admissions/new`).
 * Missing dates, sources, facility facts, and intake fields name real gaps — never fabricate values.
 */

import { formatCents } from "@/lib/finance/format-cents";
import { formatBuildingTabLicensedBedCount } from "@/lib/facilities/building-tab-display-copy";
import { formatReferralsHubReferralSource } from "@/lib/referrals/referrals-hub-display-copy";

import {
  ADMISSIONS_HUB_MISSING_DATE_COPY,
  formatAdmissionsHubTargetMoveInDateValue,
} from "./admissions-hub-display-copy";
import { REFERRAL_DETAIL_NO_DATE_OF_BIRTH_COPY } from "./referral-detail-display-copy";

export { formatBuildingTabLicensedBedCount, formatReferralsHubReferralSource };

export const ADMISSIONS_NEW_NO_FACILITY_COPY = "No facility posted";
export const ADMISSIONS_NEW_NO_INQUIRY_DATE_COPY = "No inquiry date posted";
export const ADMISSIONS_NEW_NO_LAST_CONTACT_DATE_COPY = "No last contact date posted";
export const ADMISSIONS_NEW_NO_LEAD_STAGE_COPY = "No stage posted";
export const ADMISSIONS_NEW_NO_LEAD_CONTACT_COPY = "No lead contact posted";
export const ADMISSIONS_NEW_NO_INTAKE_SUBJECT_COPY = "No intake subject selected";
export const ADMISSIONS_NEW_NO_RESIDENT_MATCH_COPY = "Resident not found in list";
export const ADMISSIONS_NEW_NO_LEAD_MATCH_COPY = "Lead not found in list";
export const ADMISSIONS_NEW_NO_ROOM_NUMBER_COPY = "No room number posted";
export const ADMISSIONS_NEW_NO_MONTHLY_RATE_COPY = "No monthly rate posted";
export const ADMISSIONS_NEW_NO_GENDER_COPY = "No gender posted";
export const ADMISSIONS_NEW_NO_ADMISSION_SOURCE_COPY = "No admission source posted";

/** Calendar day already formatted by the page — names a gap when formatting returned null. */
export function formatAdmissionsNewPostedDate(formatted: string | null): string {
  return formatted ?? ADMISSIONS_HUB_MISSING_DATE_COPY;
}

/** Original inquiry date on the selected-lead panel. */
export function formatAdmissionsNewInquiryDate(formatted: string | null): string {
  return formatted ?? ADMISSIONS_NEW_NO_INQUIRY_DATE_COPY;
}

/** Facility name in the intake sidebar and confirm dialog. */
export function formatAdmissionsNewFacilityName(name: string | null | undefined): string {
  if (!name || !name.trim()) return ADMISSIONS_NEW_NO_FACILITY_COPY;
  return name;
}

/** Last-contact date on the selected-lead panel. */
export function formatAdmissionsNewLastContactDate(
  formatted: string | null,
  rawIsoDate?: string | null,
): string {
  if (formatted) return formatted;
  const raw = rawIsoDate?.trim();
  if (raw) return raw;
  return ADMISSIONS_NEW_NO_LAST_CONTACT_DATE_COPY;
}

/** CRM stage token on lead combobox rows. */
export function formatAdmissionsNewLeadStage(status: string): string {
  const t = status.trim().replace(/_/g, " ");
  if (!t) return ADMISSIONS_NEW_NO_LEAD_STAGE_COPY;
  return t.replace(/\b\w/g, (ch) => ch.toUpperCase());
}

/** Lead contact display name on the selected-lead panel. */
export function formatAdmissionsNewLeadContact(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return ADMISSIONS_NEW_NO_LEAD_CONTACT_COPY;
  return trimmed;
}

/** Monthly rent fragment inside bed picker lines. */
export function formatAdmissionsNewBedMonthlyRate(monthlyCents: number | null): string {
  if (monthlyCents == null) return `${ADMISSIONS_NEW_NO_MONTHLY_RATE_COPY}/mo`;
  return `${formatCents(monthlyCents)}/mo`;
}

/** Room number inside bed picker lines. */
export function formatAdmissionsNewRoomNumber(roomNumber: string | null | undefined): string {
  if (!roomNumber || !roomNumber.trim()) return ADMISSIONS_NEW_NO_ROOM_NUMBER_COPY;
  return roomNumber.trim();
}

/** Sticky footer subject line when no resident or lead is chosen yet. */
export function formatAdmissionsNewIntakeSummarySubject(
  origin: "inquiry" | "lead" | "direct",
  opts: {
    residentId: string;
    residentLabel: string | null;
    leadId: string;
    leadLabel: string | null;
    directName: string;
  },
): string {
  if (origin === "inquiry" && opts.residentId) {
    return opts.residentLabel ?? ADMISSIONS_NEW_NO_RESIDENT_MATCH_COPY;
  }
  if (origin === "lead" && opts.leadId) {
    return opts.leadLabel ?? ADMISSIONS_NEW_NO_LEAD_MATCH_COPY;
  }
  if (origin === "direct") {
    const n = opts.directName.trim();
    return n || "Direct admit";
  }
  return ADMISSIONS_NEW_NO_INTAKE_SUBJECT_COPY;
}

/** Sticky footer move-in line — reuses hub target move-in copy. */
export function formatAdmissionsNewTargetMoveIn(isoYmd: string): string {
  const t = isoYmd.trim();
  if (!t) return formatAdmissionsHubTargetMoveInDateValue(null);
  return formatAdmissionsHubTargetMoveInDateValue(t);
}

/** Direct-admit confirm dialog date of birth. */
export function formatAdmissionsNewDirectDob(display: string): string {
  const t = display.trim();
  if (!t) return REFERRAL_DETAIL_NO_DATE_OF_BIRTH_COPY;
  return t;
}

/** Direct-admit confirm dialog gender. */
export function formatAdmissionsNewDirectGender(label: string | null | undefined): string {
  if (!label || !label.trim()) return ADMISSIONS_NEW_NO_GENDER_COPY;
  return label;
}

/** Direct-admit confirm dialog admission source. */
export function formatAdmissionsNewAdmissionSource(label: string | null | undefined): string {
  if (!label || !label.trim()) return ADMISSIONS_NEW_NO_ADMISSION_SOURCE_COPY;
  return label;
}
