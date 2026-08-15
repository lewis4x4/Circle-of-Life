/**
 * Quiet Operator copy for the admin staff detail page (`/admin/staff/[id]`).
 * Missing contact, emergency, and employment fields name real gaps — never fabricate values.
 */

export const STAFF_DETAIL_NO_PHONE_COPY = "No phone posted";
export const STAFF_DETAIL_NO_ALT_PHONE_COPY = "No alt phone posted";
export const STAFF_DETAIL_NO_EMAIL_COPY = "No email posted";
export const STAFF_DETAIL_NO_EMERGENCY_NAME_COPY = "No emergency contact name posted";
export const STAFF_DETAIL_NO_EMERGENCY_RELATIONSHIP_COPY = "No relationship posted";
export const STAFF_DETAIL_NO_EMERGENCY_PHONE_COPY = "No emergency phone posted";
export const STAFF_DETAIL_NO_MAX_HOURS_COPY = "No max hours posted";
export const STAFF_DETAIL_NO_RATE_COPY = "No rate posted";
export const STAFF_DETAIL_NO_UPDATE_TIMESTAMP_COPY = "No update timestamp posted";
export const STAFF_DETAIL_NO_HIRE_DATE_COPY = "No hire date posted";
export const STAFF_DETAIL_NO_ISSUE_DATE_COPY = "No issue date posted";
export const STAFF_DETAIL_NO_EXPIRATION_DATE_COPY = "No expiration date posted";
export const STAFF_DETAIL_NO_TERMINATION_DATE_COPY = "No termination date posted";

const STAFF_DETAIL_DATE_ONLY_FORMAT: Intl.DateTimeFormatOptions = {
  month: "short",
  day: "numeric",
  year: "numeric",
};

/** Shared date-only formatter — noon UTC parse; missing / blank / unparseable → explicit empty copy. */
export function formatStaffDetailDateOnly(
  iso: string | null | undefined,
  emptyCopy: string,
): string {
  if (!iso || !iso.trim()) return emptyCopy;
  const parsed = new Date(`${iso.trim()}T12:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return emptyCopy;
  return new Intl.DateTimeFormat("en-US", STAFF_DETAIL_DATE_ONLY_FORMAT).format(parsed);
}

/** Hire date on the employment section when unset or unparseable. */
export function formatStaffDetailHireDate(iso: string | null | undefined): string {
  return formatStaffDetailDateOnly(iso, STAFF_DETAIL_NO_HIRE_DATE_COPY);
}

/** Certification issue date when unset or unparseable. */
export function formatStaffDetailCertIssueDate(iso: string | null | undefined): string {
  return formatStaffDetailDateOnly(iso, STAFF_DETAIL_NO_ISSUE_DATE_COPY);
}

/** Certification expiration date when unset or unparseable. */
export function formatStaffDetailCertExpirationDate(iso: string | null | undefined): string {
  return formatStaffDetailDateOnly(iso, STAFF_DETAIL_NO_EXPIRATION_DATE_COPY);
}

/** Termination date when present but blank or unparseable — never an em dash. */
export function formatStaffDetailTerminationDate(iso: string | null | undefined): string {
  return formatStaffDetailDateOnly(iso, STAFF_DETAIL_NO_TERMINATION_DATE_COPY);
}

/** Primary phone on the staff detail contact section when unset or blank. */
export function formatStaffDetailPhone(phone: string | null | undefined): string {
  if (!phone || !phone.trim()) return STAFF_DETAIL_NO_PHONE_COPY;
  return phone;
}

/** Alternate phone on the staff detail contact section when unset or blank. */
export function formatStaffDetailAltPhone(phone: string | null | undefined): string {
  if (!phone || !phone.trim()) return STAFF_DETAIL_NO_ALT_PHONE_COPY;
  return phone;
}

/** Email on the staff detail contact section when unset or blank. */
export function formatStaffDetailEmail(email: string | null | undefined): string {
  if (!email || !email.trim()) return STAFF_DETAIL_NO_EMAIL_COPY;
  return email;
}

/** Emergency contact name when unset or blank. */
export function formatStaffDetailEmergencyName(name: string | null | undefined): string {
  if (!name || !name.trim()) return STAFF_DETAIL_NO_EMERGENCY_NAME_COPY;
  return name;
}

/** Emergency contact relationship when unset or blank. */
export function formatStaffDetailEmergencyRelationship(
  relationship: string | null | undefined,
): string {
  if (!relationship || !relationship.trim()) return STAFF_DETAIL_NO_EMERGENCY_RELATIONSHIP_COPY;
  return relationship;
}

/** Emergency contact phone when unset or blank. */
export function formatStaffDetailEmergencyPhone(phone: string | null | undefined): string {
  if (!phone || !phone.trim()) return STAFF_DETAIL_NO_EMERGENCY_PHONE_COPY;
  return phone;
}

/** Max hours per week when unset — real zero stays numeric. */
export function formatStaffDetailMaxHours(hours: number | null | undefined): string {
  if (hours == null) return STAFF_DETAIL_NO_MAX_HOURS_COPY;
  const n = typeof hours === "number" ? hours : Number(hours);
  if (Number.isNaN(n)) return STAFF_DETAIL_NO_MAX_HOURS_COPY;
  return String(n);
}

/** Hourly or overtime rate in cents when unset — never invents a dollar amount. */
export function formatStaffDetailRateCents(cents: number | null | undefined): string {
  if (cents == null) return STAFF_DETAIL_NO_RATE_COPY;
  const n = typeof cents === "number" ? cents : Number(cents);
  if (Number.isNaN(n)) return STAFF_DETAIL_NO_RATE_COPY;
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n / 100);
}

/** Last-updated timestamp in the record header when unset or unparseable. */
export function formatStaffDetailUpdatedAt(iso: string | null | undefined): string {
  if (!iso || !iso.trim()) return STAFF_DETAIL_NO_UPDATE_TIMESTAMP_COPY;
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return STAFF_DETAIL_NO_UPDATE_TIMESTAMP_COPY;
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(parsed);
}
