/**
 * Server side of the floor tablet's device replay (COL-690, spec 40 §4
 * "Replay"). Server-only: it calls the service-role replay wrappers, which
 * prove the owner through the unlock row the item was captured under and then
 * call the same writers the signed-in routes call.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { isCareEventKind } from "@/lib/care-events/level-engine";
import type { FloorReplayItem, FloorReplayResult } from "@/lib/floor/contract";
import { logError, logWarn } from "@/lib/observability/logger";
import { buildRoundingReviewPayload, chipSelectionsShapeError, completionChoiceError, completionFieldError } from "@/lib/rounding/review-payload";
import type { CompletionPayload } from "@/lib/rounding/types";
import { UUID_STRING_RE } from "@/lib/supabase/env";
import { isRecord } from "@/lib/timeclock/server";
import type { Database, Json } from "@/types/database";

type ServiceClient = SupabaseClient<Database>;

/**
 * A writer's own refusal is terminal: data exceptions (22), integrity (23),
 * privilege (42) and the writers' raised errors (P0001, P0002). Anything else
 * (connection, timeout, serialization, PostgREST transport) is worth a retry.
 */
export function isTerminalWriterError(code: string | null | undefined): boolean {
  if (!code) return false;
  return /^(22|23|42)/.test(code) || code === "P0001" || code === "P0002";
}

/** A replay wrapper's `{ok:false,error}`: only an unknown device may recover (re-enrolled tablet). */
export function isRetryableProofError(error: string): boolean {
  return error === "device_unknown";
}

/** Parse one request item. Returns a rejection reason when it can never be replayed. */
export function parseReplayItem(raw: unknown): { item: FloorReplayItem } | { clientId: string; reject: string } {
  const record = isRecord(raw) ? raw : {};
  const clientId = typeof record.client_id === "string" ? record.client_id : "";
  const fail = (reject: string) => ({ clientId, reject });
  if (!UUID_STRING_RE.test(clientId)) return fail("invalid_input");
  const unlockId = typeof record.unlock_id === "string" ? record.unlock_id : "";
  const ownerUserId = typeof record.owner_user_id === "string" ? record.owner_user_id : "";
  const capturedAt = typeof record.captured_at === "string" ? record.captured_at : "";
  if (!UUID_STRING_RE.test(unlockId) || !UUID_STRING_RE.test(ownerUserId)) return fail("invalid_input");
  if (!capturedAt || Number.isNaN(new Date(capturedAt).getTime())) return fail("invalid_input");
  if (!isRecord(record.payload)) return fail("invalid_input");
  const base = { client_id: clientId, unlock_id: unlockId, owner_user_id: ownerUserId, captured_at: new Date(capturedAt).toISOString(), payload: record.payload };
  if (record.kind === "rounding") {
    const taskId = typeof record.task_id === "string" ? record.task_id : "";
    if (!UUID_STRING_RE.test(taskId)) return fail("invalid_input");
    return { item: { ...base, kind: "rounding", task_id: taskId } };
  }
  if (record.kind === "care_event") return { item: { ...base, kind: "care_event" } };
  return fail("invalid_input");
}

function roundingReviewPayload(item: Extract<FloorReplayItem, { kind: "rounding" }>): { payload: Json } | { reject: string } {
  const body = item.payload as CompletionPayload;
  // The caregiver chip capture writes through submit_observation, which has no
  // device replay wrapper; the tablet keeps those for their owner's signed-in
  // sync. The floor's own chart carries its chips on the review payload.
  if (body.chipSelections !== undefined && body.captureSurface !== "floor") return { reject: "chip_capture_not_replayable" };
  const requestId = body.requestId ?? item.client_id;
  if (typeof requestId !== "string" || !UUID_STRING_RE.test(requestId)) return { reject: "invalid_input" };
  const observedAtRaw = typeof body.observedAt === "string" ? body.observedAt : item.captured_at;
  const observedAt = new Date(observedAtRaw);
  if (Number.isNaN(observedAt.getTime())) return { reject: "invalid_input" };
  if (completionFieldError(body) || completionChoiceError(body) || chipSelectionsShapeError(body)) return { reject: "invalid_input" };
  return { payload: buildRoundingReviewPayload(body, { requestId, observedAt, offline: true }) as unknown as Json };
}

function careEventPayload(item: Extract<FloorReplayItem, { kind: "care_event" }>): { payload: Json } | { reject: string } {
  const { queue_owner_user_id: _owner, ...payload } = item.payload;
  void _owner;
  if (typeof payload.client_event_id !== "string" || !UUID_STRING_RE.test(payload.client_event_id)) return { reject: "invalid_input" };
  if (typeof payload.facility_id !== "string" || !UUID_STRING_RE.test(payload.facility_id)) return { reject: "invalid_input" };
  if (!isCareEventKind(payload.kind)) return { reject: "invalid_input" };
  return { payload: { ...payload, captured_offline: true } as Json };
}

/** Replay one parsed item as its owner. Never throws. */
export async function replayOne(admin: ServiceClient, deviceToken: string, item: FloorReplayItem): Promise<FloorReplayResult> {
  const built = item.kind === "rounding" ? roundingReviewPayload(item) : careEventPayload(item);
  if ("reject" in built) return { client_id: item.client_id, status: "rejected", error: built.reject };

  const proof = { p_device_token: deviceToken, p_unlock_id: item.unlock_id, p_owner_user_id: item.owner_user_id, p_captured_at: item.captured_at };
  let data: unknown;
  let error: { code?: string | null; message?: string } | null;
  try {
    const response = item.kind === "rounding"
      ? await admin.rpc("floor_replay_complete_rounding_task", { ...proof, p_task_id: item.task_id, p_payload: built.payload })
      : await admin.rpc("floor_replay_submit_care_event", { ...proof, p_payload: built.payload });
    data = response.data;
    error = response.error;
  } catch (thrown) {
    logError("floor.replay", thrown, { action: "replay", kind: item.kind, clientId: item.client_id });
    return { client_id: item.client_id, status: "retry", error: "unavailable" };
  }

  if (error) {
    if (isTerminalWriterError(error.code)) {
      logWarn("floor.replay", "writer refused a replayed item", { kind: item.kind, clientId: item.client_id, code: error.code });
      return { client_id: item.client_id, status: "rejected", error: "refused" };
    }
    logError("floor.replay", error, { action: "replay", kind: item.kind, clientId: item.client_id });
    return { client_id: item.client_id, status: "retry", error: "unavailable" };
  }
  const result = isRecord(data) ? data : {};
  if (result.ok === true) return { client_id: item.client_id, status: "sent" };
  const code = String(result.error ?? "unknown");
  if (isRetryableProofError(code)) return { client_id: item.client_id, status: "retry", error: code };
  logWarn("floor.replay", "replay proof refused an item", { kind: item.kind, clientId: item.client_id, code });
  return { client_id: item.client_id, status: "rejected", error: code };
}
