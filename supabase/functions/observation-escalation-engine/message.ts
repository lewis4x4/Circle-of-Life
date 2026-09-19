/**
 * observation-escalation-engine: message composition and channel rules.
 *
 * Pure functions, no IO, so the protected health information boundary can be
 * unit tested without Deno.serve running.
 *
 * The boundary is structural rather than careful. `EscalationMessageInput` has
 * no field for a resident name, a date of birth, a diagnosis, an observation, a
 * note or a chip selection, so none of them can reach a body however a caller
 * is written. A body carries a room, the rung's own label, the rung's protocol
 * text when it has one, and a deep link.
 *
 * Nothing here carries an offset, a recipient, a channel list or a timer. Those
 * arrive as data from facility_escalation_rungs by way of the engine.
 */

export const NO_ROOM_TAG = "Room not recorded";

export type DeliveryChannel = "in_app" | "push" | "sms";

export interface EscalationMessageInput {
  /** `facility_escalation_rungs.label` for the rung that fired. */
  label: string;
  /** `facility_escalation_rungs.protocol_text`, when the rung carries one. */
  protocolText: string | null | undefined;
  /**
   * True when the rung is a staff reminder rather than an escalation, from
   * `facility_escalation_rungs.assigned_staff_only`. It changes the sentence,
   * not the routing.
   */
  isReminder: boolean;
  /** Room number, the only resident identifier a body is allowed to carry. */
  room: string | null | undefined;
  /** `resident_observation_tasks.id`, for the deep link. */
  taskId: string;
  /** From env OBSERVATION_ESCALATION_APP_BASE_URL. Empty means a bare path. */
  appBaseUrl: string | null | undefined;
}

export interface EscalationMessage {
  title: string;
  body: string;
  url: string;
}

export function roomTag(room: string | null | undefined): string {
  const trimmed = (room ?? "").trim();
  return trimmed ? `Room ${trimmed}` : NO_ROOM_TAG;
}

export function taskPath(taskId: string): string {
  return `/admin/rounding?task=${encodeURIComponent(taskId)}`;
}

export function taskUrl(taskId: string, appBaseUrl: string | null | undefined): string {
  const base = (appBaseUrl ?? "").trim().replace(/\/+$/, "");
  return `${base}${taskPath(taskId)}`;
}

/**
 * Title is the rung's own label, so renaming a rung renames what staff see and
 * no string in this file has to change. Body names the room, says what
 * happened, appends the rung's protocol text when it has one, and links.
 */
export function buildEscalationMessage(input: EscalationMessageInput): EscalationMessage {
  const url = taskUrl(input.taskId, input.appBaseUrl);
  const what = input.isReminder
    ? "An observation window is about to close without a check."
    : "An observation window closed without a check.";
  const protocol = (input.protocolText ?? "").trim();
  const body = [roomTag(input.room), what, protocol, url].filter((part) => part.length > 0).join(" ");
  return { title: input.label, body, url };
}

export const TWILIO_ENV_KEYS = ["TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_FROM_NUMBER"] as const;

/**
 * SMS is enabled only when all three Twilio values are set and
 * OBSERVATION_ESCALATION_SMS_ENABLED is exactly "true". A half configured
 * account sends nothing rather than failing every tier 3 delivery.
 */
export function smsChannelEnabled(env: Record<string, string | undefined>): boolean {
  for (const key of TWILIO_ENV_KEYS) {
    if (!(env[key] ?? "").trim()) return false;
  }
  return (env.OBSERVATION_ESCALATION_SMS_ENABLED ?? "").trim() === "true";
}

export type DeliveryOutcomeStatus = "sent" | "skipped" | "failed";

export interface PushClassification {
  retryable?: boolean;
  status: DeliveryOutcomeStatus;
  skipReason?: string;
  error?: string;
}

/**
 * dispatch-push answers `{ sent, failed, results }` on 2xx. A 2xx that
 * delivered to no subscription means the target has no device registered,
 * which is a skip rather than a failure. Any non-2xx is a failure recorded with
 * the status code and the gateway's short reason, never a resident detail.
 */
export function classifyPushResponse(status: number, payload: unknown): PushClassification {
  const record = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
  if (status >= 200 && status < 300) {
    const sent = typeof record.sent === "number" ? record.sent : 0;
    if (sent > 0) return { status: "sent" };
    if (typeof record.failed === "number" && record.failed > 0) {
      return { status: "failed", retryable: true, error: "dispatch-push delivery failed" };
    }
    return { status: "skipped", skipReason: "no_subscription" };
  }
  return {
    status: "failed",
    retryable: status === 408 || status === 429 || status >= 500,
    error: `dispatch-push ${status}`,
  };
}

export interface TwilioClassification {
  retryable?: boolean;
  status: "sent" | "failed";
  providerMessageId?: string;
  error?: string;
}

/** Twilio answers `{ sid }` on success and `{ message, code }` on failure. */
export function classifyTwilioResponse(status: number, payload: unknown): TwilioClassification {
  const record = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
  if (status >= 200 && status < 300) {
    const sid = typeof record.sid === "string" ? record.sid : undefined;
    return sid ? { status: "sent", providerMessageId: sid } : { status: "sent" };
  }
  return {
    status: "failed",
    retryable: status === 408 || status === 429 || status >= 500,
    // Provider free text may echo the recipient phone or message body.
    error: `twilio sms ${status}${typeof record.code === "number" ? ` code ${record.code}` : ""}`,
  };
}
