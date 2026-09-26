/**
 * Timeclock kiosk contract (COL-352, spec 37 §5). Shared by the session-less
 * kiosk page, its route handlers and the offline queue. Client-safe: no Node
 * imports, no secrets, no copy that reveals which half of a credential failed.
 */

export const PUNCH_TYPES = ["in", "out", "meal_start", "meal_end"] as const;
export type PunchType = (typeof PUNCH_TYPES)[number];

export function isPunchType(value: unknown): value is PunchType {
  return typeof value === "string" && (PUNCH_TYPES as readonly string[]).includes(value);
}

export const KIOSK_DEVICE_HEADER = "x-timeclock-device";

export const KIOSK_ENROLL_ENDPOINT = "/api/kiosk/timeclock/enroll";
export const KIOSK_IDENTIFY_ENDPOINT = "/api/kiosk/timeclock/identify";
export const KIOSK_PUNCH_ENDPOINT = "/api/kiosk/timeclock/punch";
export const KIOSK_ROSTER_ENDPOINT = "/api/kiosk/timeclock/roster";

/** The kiosk refreshes its name list this often while Staff clock is open. */
export const KIOSK_ROSTER_REFRESH_MS = 5 * 60 * 1000;
/** The PIN (and next-action) screen goes back to the name list after this long without input. */
export const KIOSK_PIN_IDLE_MS = 30_000;

/**
 * Error codes the kiosk API returns. Staff-facing copy never distinguishes
 * badge from PIN. `not_set_up` is only ever returned on the name path, where
 * the person is already named on screen (spec 37 section 12a).
 */
export type KioskErrorCode =
  | "device_unknown"
  | "device_throttled"
  | "facility_off"
  | "not_recognized"
  | "locked"
  | "invalid_next_type"
  | "code_invalid"
  | "rejected_offline"
  | "invalid_input"
  | "not_set_up"
  | "unavailable";

export type KioskStaffState = "out" | "in" | "meal";

/** Optional fields the database adds for the front-door kiosk (COL-692). Absent from an older database. */
export type KioskStaffDisplay = {
  /** "Ashley W.": first name and last initial. */
  display_name?: string | null;
  /** The last effective clock out, ISO; null when there is none. */
  last_out_at?: string | null;
};

export type KioskPlannedBlock = {
  label: string; color: string | null; starts_at: string; ends_at: string; time_zone: string;
  block_index: number | null; block_count: number | null;
};
export type KioskPlannedContext = { status: "ready"; blocks: KioskPlannedBlock[] } | { status: "unavailable" };

export type KioskIdentifyResponse = KioskStaffDisplay & {
  planned_context?: KioskPlannedContext;
  first_name: string;
  state: KioskStaffState;
  next_actions: PunchType[];
  today_worked_minutes: number;
};

/**
 * One punch. The employee-number path sends `identifier`; the name path sends
 * `staff_id` (the tile that was tapped) and no identifier.
 */
export type KioskPunchRequest = {
  identifier?: string;
  staff_id?: string;
  pin: string;
  punch_type: PunchType;
  device_time: string;
  client_punch_id: string;
  captured_offline: boolean;
};

export type KioskPunchReceipt = KioskStaffDisplay & {
  punch_id: string;
  replayed: boolean;
  first_name: string;
  punch_type: PunchType;
  punched_at: string;
  flags: string[];
  state: KioskStaffState;
  next_actions: PunchType[];
  today_worked_minutes: number;
};

export type KioskEnrollResponse = {
  device_id: string;
  token: string;
  facility_id: string;
  facility_name: string;
};

export type KioskErrorResponse = { error: KioskErrorCode; tries_left?: number };

/** One name on the kiosk's Staff clock list: never an employee number. */
export type KioskRosterEntry = { staff_id: string; display_name: string };

export type KioskRosterResponse = {
  roster: KioskRosterEntry[];
  /** Set while too many wrong PINs have throttled this tablet; ISO. */
  throttled_until: string | null;
};

/** HTTP status for each database error code (spec 37 §4.1). */
export const KIOSK_ERROR_STATUS: Record<KioskErrorCode, number> = {
  device_unknown: 401,
  device_throttled: 429,
  facility_off: 403,
  not_recognized: 401,
  locked: 423,
  invalid_next_type: 409,
  code_invalid: 401,
  rejected_offline: 422,
  invalid_input: 400,
  not_set_up: 403,
  unavailable: 503,
};

/**
 * Database codes that must not reach the tablet as themselves: a terminated or
 * unassigned person gets the same words as a wrong PIN.
 */
export function publicKioskErrorCode(dbCode: string): KioskErrorCode {
  switch (dbCode) {
    case "device_unknown":
    case "device_throttled":
    case "facility_off":
    case "locked":
    case "invalid_next_type":
    case "code_invalid":
    case "invalid_input":
    case "rejected_offline":
    case "not_set_up":
    case "unavailable":
      return dbCode;
    default:
      return "not_recognized";
  }
}

/**
 * The name path (a tile was tapped): the person is already on screen, so an
 * inactive or unassigned person may be told so. Everything else is as above.
 */
export function publicKioskNameErrorCode(dbCode: string): KioskErrorCode {
  if (dbCode === "inactive_staff" || dbCode === "not_assigned") return "not_set_up";
  return publicKioskErrorCode(dbCode);
}

export const KIOSK_COPY = {
  enrollHeading: "Set up this tablet",
  enrollHint: "Ask an administrator for a one time enrollment code. It expires 15 minutes after it is created.",
  enrollCodeLabel: "Enrollment code",
  enrollButton: "Enroll",
  enrollLabelLabel: "Tablet name",
  identifierLabel: "Badge or timeclock ID",
  pinLabel: "PIN",
  continueButton: "Continue",
  actionLabels: {
    in: "Clock in",
    out: "Clock out",
    meal_start: "Start meal",
    meal_end: "End meal",
  } satisfies Record<PunchType, string>,
  confirmedLabels: {
    in: "Clocked in",
    out: "Clocked out",
    meal_start: "Meal started",
    meal_end: "Meal ended",
  } satisfies Record<PunchType, string>,
  offlineSaved: "Saved on this tablet. Will send when online.",
  offlineBanner: "Offline. Punches are saved on this tablet and sent when the network returns.",
  errors: {
    not_recognized: "Badge or PIN not recognized",
    locked: "Locked for 15 minutes. See your administrator.",
    device_unknown: "This tablet is not set up for timeclock.",
    facility_off: "Timeclock is off for this facility.",
    device_throttled: "Try again in a few minutes.",
    invalid_next_type: "That action is not available right now. Try again.",
    code_invalid: "That code did not work. Ask for a new one.",
    rejected_offline: "Badge or PIN not recognized",
    invalid_input: "Something was missing. Try again.",
    not_set_up: "You're not set up to clock in here. Ask your manager.",
    unavailable: "Timeclock is temporarily unavailable. Your punch will be saved on this tablet.",
  } satisfies Record<KioskErrorCode, string>,
  idleReset: "Cleared after 30 seconds without input.",
} as const;

/** Copies display_name and last_out_at from a database result when it carries them; an older result adds nothing. */
export function kioskStaffDisplay(result: Record<string, unknown>): KioskStaffDisplay {
  const display: KioskStaffDisplay = {};
  if ("display_name" in result) display.display_name = typeof result.display_name === "string" && result.display_name.trim() ? result.display_name.trim() : null;
  if ("last_out_at" in result) display.last_out_at = typeof result.last_out_at === "string" ? result.last_out_at : null;
  return display;
}

/** `4 h 12 min` for the receipt. Integer minutes in, no rounding. */
export function formatWorkedMinutes(minutes: number): string {
  const total = Math.max(0, Math.floor(minutes));
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h === 0) return `${m} min`;
  return `${h} h ${m} min`;
}

/** `7:02 a.m.` in the facility time zone. */
export function formatKioskTime(iso: string | Date, timeZone = "America/New_York"): string {
  const date = typeof iso === "string" ? new Date(iso) : iso;
  const parts = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", hour12: true, timeZone }).formatToParts(date);
  const hour = parts.find((p) => p.type === "hour")?.value ?? "";
  const minute = parts.find((p) => p.type === "minute")?.value ?? "";
  const period = (parts.find((p) => p.type === "dayPeriod")?.value ?? "").toLowerCase();
  const suffix = period === "pm" ? "p.m." : "a.m.";
  return `${hour}:${minute} ${suffix}`;
}
