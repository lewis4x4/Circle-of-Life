/**
 * care-event-dispatcher: message composition and channel rules.
 *
 * Pure functions, no IO, so the PHI boundary can be unit tested without
 * Deno.serve running. Spec 07A section 10: a push or SMS body carries no PHI
 * beyond first initial, last name, room, tile word, level word, and a deep
 * link. Nothing in this module accepts the sentence, answers, or any clinical
 * field, so nothing else can reach a body.
 */

/** Level words from 07A-level-engine-contract section 9. */
const LEVEL_WORDS: Readonly<Record<1 | 2 | 3 | 4, string>> = {
  1: "Note",
  2: "Heads-up",
  3: "Urgent",
  4: "Emergency",
};

/** Tile words from 07A-something-happened-capture section 2, tap 2, keyed by care_events.kind. */
const TILE_WORDS: Readonly<Record<string, string>> = {
  fall: "Fall",
  injury_found: "Hurt",
  condition_change: "Sick or not themselves",
  behavior: "Upset or behavior",
  wandering: "Wandering or left",
  medication: "Medicine",
  family_complaint: "Family or complaint",
  environment: "Building or other",
};

export const UNKNOWN_LEVEL_WORD = "No level posted";
export const UNKNOWN_TILE_WORD = "Event";
export const NO_RESIDENT_TAG = "No resident";

/** Accepts `level_1`..`level_4`, `"1"`..`"4"`, or 1..4. Anything else returns "No level posted". */
export function levelWord(level: string | number | null | undefined): string {
  const n = parseLevel(level);
  return n === null ? UNKNOWN_LEVEL_WORD : LEVEL_WORDS[n];
}

function parseLevel(level: string | number | null | undefined): 1 | 2 | 3 | 4 | null {
  if (level === null || level === undefined) return null;
  const raw = typeof level === "number" ? String(level) : level.trim().toLowerCase();
  const match = /^(?:level_)?([1-4])$/.exec(raw);
  if (!match) return null;
  return Number(match[1]) as 1 | 2 | 3 | 4;
}

/** Tile word for a care_events.kind. Unknown kinds return "Event". */
export function tileWord(kind: string | null | undefined): string {
  if (!kind) return UNKNOWN_TILE_WORD;
  return TILE_WORDS[kind.trim().toLowerCase()] ?? UNKNOWN_TILE_WORD;
}

/** "P. Brownell"; last name only when the first is missing; "No resident" when both are missing. */
export function residentTag(first: string | null | undefined, last: string | null | undefined): string {
  const firstTrimmed = (first ?? "").trim();
  const lastTrimmed = (last ?? "").trim();
  if (!firstTrimmed && !lastTrimmed) return NO_RESIDENT_TAG;
  if (!lastTrimmed) return `${firstTrimmed.charAt(0)}.`;
  if (!firstTrimmed) return lastTrimmed;
  return `${firstTrimmed.charAt(0)}. ${lastTrimmed}`;
}

export interface CareEventMessageInput {
  firstName: string | null | undefined;
  lastName: string | null | undefined;
  room: string | null | undefined;
  kind: string | null | undefined;
  level: string | number | null | undefined;
  careEventId: string;
  /** From env CARE_EVENT_APP_BASE_URL. Empty means the url is a bare path. */
  appBaseUrl: string | null | undefined;
}

export interface CareEventMessage {
  title: string;
  body: string;
  url: string;
}

export function careEventPath(careEventId: string): string {
  return `/admin/care-events/${careEventId}`;
}

export function careEventUrl(careEventId: string, appBaseUrl: string | null | undefined): string {
  const base = (appBaseUrl ?? "").trim().replace(/\/+$/, "");
  return `${base}${careEventPath(careEventId)}`;
}

/**
 * Title: "<level word>: <tile word>".
 * Body:  "<resident tag>[, room <room>]. <tile word>. <level word>. <url>".
 * The input type has no field for the sentence, answers, diagnosis, or date
 * of birth; extra properties on the object passed in are never read.
 */
export function buildCareEventMessage(input: CareEventMessageInput): CareEventMessage {
  const level = levelWord(input.level);
  const tile = tileWord(input.kind);
  const who = residentTag(input.firstName, input.lastName);
  const room = (input.room ?? "").trim();
  const url = careEventUrl(input.careEventId, input.appBaseUrl);
  return {
    title: `${level}: ${tile}`,
    body: `${who}${room ? `, room ${room}` : ""}. ${tile}. ${level}. ${url}`,
    url,
  };
}

export const TWILIO_ENV_KEYS = ["TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_FROM_NUMBER"] as const;

/**
 * SMS and voice are enabled only when all three Twilio values are set and
 * CARE_EVENT_SMS_ENABLED is exactly "true" (07A section 6.2, decision D5).
 */
export function twilioChannelEnabled(env: Record<string, string | undefined>): boolean {
  for (const key of TWILIO_ENV_KEYS) {
    if (!(env[key] ?? "").trim()) return false;
  }
  return (env.CARE_EVENT_SMS_ENABLED ?? "").trim() === "true";
}

export type DeliveryOutcomeStatus = "sent" | "skipped" | "failed";

export interface PushClassification {
  status: DeliveryOutcomeStatus;
  skipReason?: string;
  error?: string;
}

const MAX_ERROR_CHARS = 200;

function shortError(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return trimmed.length > MAX_ERROR_CHARS ? `${trimmed.slice(0, MAX_ERROR_CHARS)}...` : trimmed;
}

/**
 * dispatch-push answers `{ sent, failed, results }` on 2xx. A 2xx with no
 * subscription delivered means the target has no device registered, which is
 * a skip, not a failure. Any non-2xx is a failure recorded with the status
 * code and the gateway's short reason, never a resident name.
 */
export function classifyPushResponse(status: number, payload: unknown): PushClassification {
  const record = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
  if (status >= 200 && status < 300) {
    const sent = typeof record.sent === "number" ? record.sent : 0;
    if (sent > 0) return { status: "sent" };
    return { status: "skipped", skipReason: "no_subscription" };
  }
  const reason = shortError(record.error);
  return {
    status: "failed",
    error: reason ? `dispatch-push ${status}: ${reason}` : `dispatch-push ${status}`,
  };
}

export interface TwilioClassification {
  status: "sent" | "failed";
  providerMessageId?: string;
  error?: string;
}

/** Twilio answers `{ sid }` on success and `{ message, code }` on failure. */
export function classifyTwilioResponse(status: number, payload: unknown, channel: "sms" | "voice"): TwilioClassification {
  const record = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
  if (status >= 200 && status < 300) {
    const sid = typeof record.sid === "string" ? record.sid : undefined;
    return sid ? { status: "sent", providerMessageId: sid } : { status: "sent" };
  }
  const reason = shortError(record.message);
  return {
    status: "failed",
    error: reason ? `twilio ${channel} ${status}: ${reason}` : `twilio ${channel} ${status}`,
  };
}

/** Escape the five XML specials so the body is safe inside TwiML <Say>. */
export function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export function voiceTwiml(body: string): string {
  return `<Response><Say>${escapeXml(body)}</Say></Response>`;
}
