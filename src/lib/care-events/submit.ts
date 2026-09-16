/**
 * Submit payload and receipt contract for `public.submit_care_event`
 * (spec 07A §6.2, migration 402). The server re-derives the level; the
 * client never sends one.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/types/database";

import type { CareEventAnswers, CareEventKind, CareEventLevel } from "./level-engine";
import { answersForEngine, occurredAtIso, type ReportState } from "./report-state";

export type CareEventSubmitPayload = {
  client_event_id: string;
  facility_id: string;
  resident_id: string | null;
  kind: CareEventKind;
  answers: CareEventAnswers & { worried: boolean };
  note: string | null;
  occurred_at: string;
  location_code: string | null;
  captured_offline: boolean;
};

export type CareEventDeliveryChannel = "in_app" | "push" | "sms" | "voice";
export type CareEventDeliveryStatus =
  | "queued"
  | "sent"
  | "delivered"
  | "failed"
  | "skipped"
  | "acknowledged";

export type CareEventReceiptDelivery = {
  target_name: string | null;
  target_role: string | null;
  channel: CareEventDeliveryChannel;
  status: CareEventDeliveryStatus;
};

export type CareEventReceipt = {
  care_event_id: string;
  level: CareEventLevel;
  incident_number: string | null;
  incident_id: string | null;
  deliveries: CareEventReceiptDelivery[];
  next_check_at: string | null;
  replayed: boolean;
};

export type SubmitContext = {
  facilityId: string;
  capturedOffline?: boolean;
  note?: string | null;
  now?: Date;
};

export function buildSubmitPayload(state: ReportState, ctx: SubmitContext): CareEventSubmitPayload {
  if (!state.kind) throw new Error("Pick what happened before sending.");
  return {
    client_event_id: state.clientEventId,
    facility_id: ctx.facilityId,
    resident_id: state.resident?.id ?? null,
    kind: state.kind,
    answers: answersForEngine(state),
    note: ctx.note?.trim() ? ctx.note.trim() : null,
    occurred_at: occurredAtIso(state, ctx.now),
    location_code: state.locationCode,
    captured_offline: ctx.capturedOffline === true,
  };
}

const CHANNELS: readonly CareEventDeliveryChannel[] = ["in_app", "push", "sms", "voice"];
const STATUSES: readonly CareEventDeliveryStatus[] = [
  "queued",
  "sent",
  "delivered",
  "failed",
  "skipped",
  "acknowledged",
];

function asLevel(value: unknown): CareEventLevel {
  const number = typeof value === "string" ? Number(value) : value;
  if (number === 1 || number === 2 || number === 3 || number === 4) return number;
  throw new Error("The receipt did not include a level.");
}

function asNullableString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

/** Validate the RPC's JSON into the receipt shape. Throws on a malformed receipt. */
export function parseCareEventReceipt(value: unknown): CareEventReceipt {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("The event was not acknowledged. Keep it and retry.");
  }
  const raw = value as Record<string, unknown>;
  const careEventId = asNullableString(raw.care_event_id);
  if (!careEventId) throw new Error("The event was not acknowledged. Keep it and retry.");
  const deliveries: CareEventReceiptDelivery[] = Array.isArray(raw.deliveries)
    ? raw.deliveries.flatMap((entry) => {
        if (!entry || typeof entry !== "object") return [];
        const row = entry as Record<string, unknown>;
        const channel = row.channel;
        const status = row.status;
        if (!CHANNELS.includes(channel as CareEventDeliveryChannel)) return [];
        if (!STATUSES.includes(status as CareEventDeliveryStatus)) return [];
        return [
          {
            target_name: asNullableString(row.target_name),
            target_role: asNullableString(row.target_role),
            channel: channel as CareEventDeliveryChannel,
            status: status as CareEventDeliveryStatus,
          },
        ];
      })
    : [];
  return {
    care_event_id: careEventId,
    level: asLevel(raw.level),
    incident_number: asNullableString(raw.incident_number),
    incident_id: asNullableString(raw.incident_id),
    deliveries,
    next_check_at: asNullableString(raw.next_check_at),
    replayed: raw.replayed === true,
  };
}

/** Call the RPC directly from the browser session. */
export async function submitCareEvent(
  supabase: SupabaseClient<Database>,
  payload: CareEventSubmitPayload,
): Promise<CareEventReceipt> {
  const { data, error } = await supabase.rpc(
    "submit_care_event" as never,
    { p_payload: payload } as never,
  );
  if (error) throw error;
  return parseCareEventReceipt(data);
}

/** Append the voice note text or a photo path to a saved event. */
export async function appendCareEventNote(
  supabase: SupabaseClient<Database>,
  input: { careEventId: string; note?: string | null; photoPath?: string | null },
): Promise<{ note: string | null; attachments: string[] }> {
  const { data, error } = await supabase.rpc(
    "append_care_event_note" as never,
    {
      p_care_event_id: input.careEventId,
      p_note: input.note ?? null,
      p_photo_path: input.photoPath ?? null,
    } as never,
  );
  if (error) throw error;
  const raw = (data ?? {}) as { note?: unknown; attachments?: unknown };
  return {
    note: asNullableString(raw.note),
    attachments: Array.isArray(raw.attachments)
      ? raw.attachments.filter((entry): entry is string => typeof entry === "string")
      : [],
  };
}

/** Fetch-level failures (no response from the server), never a server-side rejection. */
export function isLikelyNetworkError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { message?: unknown; name?: unknown; code?: unknown };
  if (candidate.name === "TypeError" && typeof candidate.message === "string") {
    return /fetch|network|load failed/i.test(candidate.message);
  }
  if (typeof candidate.message !== "string") return false;
  if (/^care_event:/i.test(candidate.message)) return false;
  return /failed to fetch|networkerror|network request failed|load failed|fetch\s+failed|abort|offline|timed out|ECONNREFUSED|ENOTFOUND/i.test(
    candidate.message,
  );
}

/** The user-facing sentence for a server rejection. Never the raw data-layer message. */
export function describeSubmitFailure(error: unknown): string {
  const message =
    error && typeof error === "object" && typeof (error as { message?: unknown }).message === "string"
      ? (error as { message: string }).message
      : "";
  if (/care_event: forbidden/i.test(message)) return "Your account cannot send events for this facility.";
  if (/care_event: resident/i.test(message)) return "Pick a resident at this facility, or choose the building.";
  if (/care_event:/i.test(message)) return "Something in this event could not be saved. Check the answers and try again.";
  return "The event was not sent. It is still on this screen. Try again.";
}
