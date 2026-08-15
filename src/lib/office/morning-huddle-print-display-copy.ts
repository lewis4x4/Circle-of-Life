/**
 * Quiet Operator copy for the morning huddle print packet table cells.
 * Missing values name real gaps — never silent em dashes or fabricated names.
 */

export const MORNING_HUDDLE_PRINT_NO_RESIDENT_COPY = "No resident posted";
export const MORNING_HUDDLE_PRINT_NO_SHIFT_COPY = "No shift posted";
export const MORNING_HUDDLE_PRINT_NO_REASON_COPY = "No reason posted";

const EM_DASH = "—";

function isBlankOrEmDash(value: string | null | undefined): boolean {
  if (value == null) return true;
  const trimmed = String(value).trim();
  return trimmed === "" || trimmed === EM_DASH;
}

function humanizeShift(value: string): string {
  return value.replace(/_/g, " ");
}

/** Incident row resident cell when unset, blank, or em dash. */
export function formatMorningHuddlePrintResidentName(
  residentName: string | null | undefined,
): string {
  if (isBlankOrEmDash(residentName)) return MORNING_HUDDLE_PRINT_NO_RESIDENT_COPY;
  return String(residentName).trim();
}

/** Open operations task shift cell when unset or blank. */
export function formatMorningHuddlePrintAssignedShift(
  assignedShift: string | null | undefined,
): string {
  const trimmed = assignedShift?.trim();
  if (!trimmed || trimmed === EM_DASH) return MORNING_HUDDLE_PRINT_NO_SHIFT_COPY;
  return humanizeShift(trimmed);
}

/** Medication flag reason cell when unset, blank, or em dash. */
export function formatMorningHuddlePrintMissedMedReason(
  reason: string | null | undefined,
): string {
  if (isBlankOrEmDash(reason)) return MORNING_HUDDLE_PRINT_NO_REASON_COPY;
  return String(reason).trim();
}
