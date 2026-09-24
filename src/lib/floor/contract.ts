/**
 * Floor tablet contract (COL-677 / COL-690, spec 40 §1, §4). Shared by the
 * floor pages, their route handlers and the device replay path. Client-safe:
 * no Node imports, no secrets, no copy that says which half of a credential
 * failed.
 *
 * The device token rides in `KIOSK_DEVICE_HEADER` (`x-timeclock-device`), the
 * same header the front-door kiosk uses; the database refuses a token of the
 * wrong kind as `device_unknown`.
 */

export { KIOSK_DEVICE_HEADER as FLOOR_DEVICE_HEADER } from "@/lib/timeclock/kiosk-contract";

export const FLOOR_ENROLL_ENDPOINT = "/api/floor/enroll";
export const FLOOR_ROSTER_ENDPOINT = "/api/floor/roster";
export const FLOOR_UNLOCK_ENDPOINT = "/api/floor/unlock";
export const FLOOR_LOCK_ENDPOINT = "/api/floor/lock";
export const FLOOR_HEARTBEAT_ENDPOINT = "/api/floor/heartbeat";
export const FLOOR_REPLAY_ENDPOINT = "/api/floor/replay";

/** Pages that work without a session; everything else under /floor needs one. */
export const FLOOR_LOCK_PATH = "/floor/lock";
export const FLOOR_SETUP_PATH = "/floor/setup";
export const FLOOR_HOME_PATH = "/floor";

/** The heartbeat cadence from spec 40 §1. */
export const FLOOR_HEARTBEAT_INTERVAL_MS = 60_000;

/** Error codes the floor API returns. */
export type FloorErrorCode =
  | "device_unknown"
  | "device_throttled"
  | "facility_off"
  | "not_recognized"
  | "locked"
  | "not_allowed"
  | "no_login"
  | "code_invalid"
  | "invalid_input"
  | "unavailable";

/** `tries_left` only on a roster PIN miss (`not_recognized`), never on the employee-number path. */
export type FloorErrorResponse = { error: FloorErrorCode; tries_left?: number };

/** HTTP status for each floor error code. */
export const FLOOR_ERROR_STATUS: Record<FloorErrorCode, number> = {
  device_unknown: 401,
  device_throttled: 429,
  facility_off: 403,
  not_recognized: 401,
  locked: 423,
  not_allowed: 403,
  no_login: 403,
  code_invalid: 401,
  invalid_input: 400,
  unavailable: 503,
};

/**
 * Database codes that may reach the tablet as themselves. Anything else (a
 * code this build does not know) reads as a wrong PIN.
 */
export function publicFloorErrorCode(dbCode: string): FloorErrorCode {
  switch (dbCode) {
    case "device_unknown":
    case "device_throttled":
    case "facility_off":
    case "locked":
    case "not_allowed":
    case "no_login":
    case "code_invalid":
    case "invalid_input":
    case "unavailable":
      return dbCode;
    default:
      return "not_recognized";
  }
}

/**
 * Operator copy for each error. The database does not return an attempts
 * count, so a wrong PIN never says how many tries are left.
 */
export const FLOOR_ERROR_COPY: Record<FloorErrorCode, string> = {
  not_recognized: "That PIN did not match.",
  locked: "Locked for 15 minutes. Ask the administrator.",
  device_unknown: "This tablet is not set up yet.",
  device_throttled: "Try again in a few minutes.",
  facility_off: "Floor tablets are off for this building.",
  no_login: "You do not have a Haven login yet. Ask the administrator.",
  not_allowed: "This tablet is not set up for your role.",
  code_invalid: "That code did not work. Ask for a new one.",
  invalid_input: "Something was missing. Try again.",
  unavailable: "Haven could not be reached. Try again.",
};

/**
 * "That PIN did not match. 3 tries left." when the count is known, else the
 * plain line. No tries left means the miss just locked the credential.
 */
export function floorPinMismatchCopy(triesLeft: number | null | undefined): string {
  if (typeof triesLeft !== "number" || !Number.isInteger(triesLeft) || triesLeft < 0) return FLOOR_ERROR_COPY.not_recognized;
  if (triesLeft === 0) return FLOOR_ERROR_COPY.locked;
  return `${FLOOR_ERROR_COPY.not_recognized} ${triesLeft} ${triesLeft === 1 ? "try" : "tries"} left.`;
}

export function floorErrorCopy(code: string): string {
  return FLOOR_ERROR_COPY[publicFloorErrorCode(code)];
}

// ---------------------------------------------------------------------------
// Enroll
// ---------------------------------------------------------------------------

export type FloorEnrollRequest = { code: string; label: string };

export type FloorEnrollResponse = {
  device_id: string;
  token: string;
  facility_id: string;
  facility_name: string;
  device_label: string;
};

// ---------------------------------------------------------------------------
// Roster
// ---------------------------------------------------------------------------

export type FloorRosterPerson = {
  staff_id: string;
  /** Their login user id: keys the lock screen's "n unsent" count (`countUnsentByOwner`). */
  user_id: string | null;
  /** First name plus last initial, e.g. "Ashley W." */
  display_name: string;
  initials: string;
  role_label: string;
  clocked_in_at: string | null;
  /** Last unlock on this tablet, or null. The roster is ordered by it. */
  last_on_this_device: string | null;
};

export type FloorRosterResponse = {
  facility_name: string;
  device_label: string;
  idle_lock_minutes: number;
  /** Set while PIN entry is throttled on this tablet; the roster still shows. */
  throttled_until: string | null;
  roster: FloorRosterPerson[];
};

// ---------------------------------------------------------------------------
// Unlock, lock, heartbeat
// ---------------------------------------------------------------------------

/** Exactly one of `staff_id` (roster tap) or `employee_number` ("Not listed?"). */
export type FloorUnlockRequest =
  | { staff_id: string; employee_number?: undefined; pin: string }
  | { employee_number: string; staff_id?: undefined; pin: string };

export type FloorUnlockResponse = {
  unlock_id: string;
  user_id: string;
  idle_lock_minutes: number;
  display_name: string;
  role_label: string;
  clocked_in_at: string | null;
  /** False for an employee-number unlock without a punch (timesheet exception). */
  on_clock: boolean;
};

/** Reasons the tablet may end its own unlock (`floor_end_unlock`). */
export const FLOOR_LOCK_REASONS = ["sleep", "idle", "switch"] as const;
export type FloorLockReason = (typeof FLOOR_LOCK_REASONS)[number];

export function isFloorLockReason(value: unknown): value is FloorLockReason {
  return typeof value === "string" && (FLOOR_LOCK_REASONS as readonly string[]).includes(value);
}

export type FloorLockRequest = { unlock_id: string; reason: FloorLockReason };

/** Why an unlock is no longer active. `unknown`: not this tablet's unlock. */
export type FloorInactiveReason =
  | FloorLockReason
  | "clocked_out"
  | "device_revoked"
  | "max_age"
  | "new_unlock"
  | "unknown";

export type FloorHeartbeatResponse =
  | { active: true; reason: null }
  | { active: false; reason: FloorInactiveReason };

/** Lock-screen line after the tablet locked on its own. */
export const FLOOR_LOCKED_COPY: Record<FloorInactiveReason, string> = {
  sleep: "Locked when the screen went dark.",
  idle: "Locked after no taps.",
  switch: "Locked for the next person.",
  clocked_out: "Locked because you clocked out.",
  device_revoked: "This tablet was removed from Haven. Ask the administrator.",
  max_age: "Locked after 12 hours. Unlock again.",
  new_unlock: "Someone else unlocked this tablet.",
  unknown: "Locked. Unlock again.",
};

// ---------------------------------------------------------------------------
// Replay
// ---------------------------------------------------------------------------

type FloorReplayItemBase = {
  /** Queue key: the rounding queue item id or the care event's client_event_id. */
  client_id: string;
  unlock_id: string;
  owner_user_id: string;
  /** Tablet clock when the item was queued, ISO. Must fall inside the unlock. */
  captured_at: string;
};

export type FloorReplayRoundingItem = FloorReplayItemBase & {
  kind: "rounding";
  task_id: string;
  /** The queued `CompletionPayload` (camelCase), as the signed-in route receives it. */
  payload: Record<string, unknown>;
};

export type FloorReplayCareEventItem = FloorReplayItemBase & {
  kind: "care_event";
  /** The `/api/care-events/submit` body. */
  payload: Record<string, unknown>;
};

export type FloorReplayItem = FloorReplayRoundingItem | FloorReplayCareEventItem;

export type FloorReplayRequest = { items: FloorReplayItem[] };

/**
 * sent: written as the owner, remove it. rejected: refused for good (wrong
 * unlock, outside the unlock, the owner may no longer write it), remove it.
 * retry: not written (network, database unavailable), keep it.
 */
export type FloorReplayStatus = "sent" | "rejected" | "retry";

export type FloorReplayResult = { client_id: string; status: FloorReplayStatus; error?: string };

export type FloorReplayResponse = { results: FloorReplayResult[] };

/** Items per replay request; the tablet sends larger queues in batches. */
export const FLOOR_REPLAY_MAX_ITEMS = 25;
