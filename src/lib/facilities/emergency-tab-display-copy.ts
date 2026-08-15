/**
 * Quiet Operator copy for the facility detail emergency tab.
 * Missing verify dates, phones, and hours name real gaps — never fabricate values.
 */

const NY_TZ = "America/New_York";

export const EMERGENCY_TAB_NO_VERIFY_DATE_COPY = "No verify date posted";
export const EMERGENCY_TAB_NO_PHONE_COPY = "No phone posted";
export const EMERGENCY_TAB_NO_HOURS_COPY = "No hours posted";

function isMissingDisplayValue(value: string | null | undefined): boolean {
  if (!value) return true;
  const trimmed = value.trim();
  return !trimmed || trimmed === "—";
}

/** Trailing verify phrase on immediate-emergency rows — whole line when missing. */
export function formatEmergencyTabVerifyLine(verifyDate: string | null | undefined): string {
  if (isMissingDisplayValue(verifyDate)) return EMERGENCY_TAB_NO_VERIFY_DATE_COPY;
  const trimmed = verifyDate!.trim();
  const d = new Date(trimmed.includes("T") ? trimmed : `${trimmed}T12:00:00`);
  if (!Number.isNaN(d.getTime())) {
    const formatted = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeZone: NY_TZ }).format(d);
    return `Last verified ${formatted}`;
  }
  return `Last verified ${trimmed}`;
}

/** Primary phone on immediate-emergency rows when unset, blank, or a lone em dash. */
export function formatEmergencyTabPhone(phone: string | null | undefined): string {
  if (isMissingDisplayValue(phone)) return EMERGENCY_TAB_NO_PHONE_COPY;
  return phone!.trim();
}

/** Hours line on directory contact rows — prefix only when hours are posted. */
export function formatEmergencyTabHoursLine(hours: string | null | undefined): string {
  if (isMissingDisplayValue(hours)) return EMERGENCY_TAB_NO_HOURS_COPY;
  return `Hours: ${hours!.trim()}`;
}
