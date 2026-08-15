/**
 * Quiet Operator copy for transportation hub and calendar surfaces.
 * Missing appointment times name real gaps — never fabricate trip times or counts.
 */

import { format, parseISO } from "date-fns";

export const TRANSPORTATION_NO_TIME_COPY = "No time posted";
export const TRANSPORTATION_NO_STAFF_COPY = "No staff posted";
export const TRANSPORTATION_NO_NAME_COPY = "No name posted";

export type TransportationDriverStaffMini = {
  first_name?: string | null;
  last_name?: string | null;
};

/** Driver staff label when the join is missing or posted names are blank. */
export function formatTransportationDriverStaffLabel(
  staff: TransportationDriverStaffMini | null | undefined,
): string {
  if (!staff) return TRANSPORTATION_NO_STAFF_COPY;
  const first = staff.first_name?.trim() ?? "";
  const last = staff.last_name?.trim() ?? "";
  const name = `${first} ${last}`.trim();
  if (!name) return TRANSPORTATION_NO_NAME_COPY;
  return name;
}

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
