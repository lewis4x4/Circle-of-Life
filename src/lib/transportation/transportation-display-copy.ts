/**
 * Quiet Operator copy for transportation hub and calendar surfaces.
 * Missing appointment times name real gaps — never fabricate trip times or counts.
 */

import { format, parseISO } from "date-fns";

export const TRANSPORTATION_NO_TIME_COPY = "No time posted";

/** Appointment time column — posted time formatted or explicit missing copy. */
export function formatTransportationAppointmentTime(
  appointmentTime: string | null | undefined,
): string {
  if (!appointmentTime || !appointmentTime.trim()) return TRANSPORTATION_NO_TIME_COPY;
  try {
    return format(parseISO(`2000-01-01T${appointmentTime.slice(0, 8)}`), "h:mm a");
  } catch {
    return appointmentTime;
  }
}

/** Calendar day trip badge — real zero stays "0 trips"; never hides a counted zero. */
export function formatTransportationDayTripCount(count: number): string {
  const n = Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 0;
  return `${n} trip${n === 1 ? "" : "s"}`;
}
