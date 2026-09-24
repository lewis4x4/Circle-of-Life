/**
 * Save a charted check from the floor tablet through the same path the
 * caregiver round page uses (`/caregiver/rounds/[residentId]`): the signed-in
 * completion route with the original operator as `retryOwner`, and the
 * rounding offline queue when the tablet is offline, the network drops, or
 * the save conflicts. Queued items carry the floor unlock id
 * (`queueRoundingCompletion` stamps it), so the device replay can still write
 * them as this person after the next person unlocks.
 */

import { queueRoundingCompletion, shouldQueueRoundingRequest } from "@/lib/pwa/rounding-sync";
import type { CompletionPayload } from "@/lib/rounding/types";
import { createClient } from "@/lib/supabase/client";

export type RetryOwner = NonNullable<CompletionPayload["retryOwner"]>;

export type CheckSaveResult =
  | { status: "saved" }
  | { status: "queued" }
  | { status: "reason_required"; message: string }
  | { status: "failed"; message: string };

const FAILED_COPY = "The check was not saved. Try again, or tell the administrator.";

/**
 * A failure message written for the operator. Anything else (a route's
 * validation text, a database message) is logged and replaced with copy by
 * status: the tablet never shows raw error text.
 */
export class FloorOperatorError extends Error {}

/** The operator's words for a completion or claim the route refused, by status. */
export function checkFailureCopy(status: number): string {
  if (status === 401) return "Your sign-in ended. Lock the tablet and unlock again.";
  if (status === 403) return "This check belongs to another sign-in. Lock the tablet and unlock again.";
  if (status === 404) return "This check is not on the list any more. Go back to Now.";
  if (status === 422) return "Your staff record is not set up for charting. Ask the administrator.";
  if (status === 400) return "This check could not be saved as charted. Check the answers, then try again.";
  return FAILED_COPY;
}

/** The verified operator for this session and facility; the server checks it again. */
export async function currentRetryOwner(organizationId: string, facilityId: string): Promise<RetryOwner> {
  const { data, error } = await createClient().rpc("haven_current_edge_actor" as never);
  const actor = data as { user_id?: string; session_id?: string; organization_id?: string } | null;
  if (error || !actor?.user_id || !actor.session_id || actor.organization_id !== organizationId) {
    throw new FloorOperatorError("Your sign-in could not be confirmed. Tap Switch and unlock again.");
  }
  return { userId: actor.user_id, sessionId: actor.session_id, organizationId, facilityId };
}

export async function claimFloorCheck(taskId: string, owner: RetryOwner): Promise<void> {
  const response = await fetch(`/api/rounding/tasks/${encodeURIComponent(taskId)}/claim`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ retryOwner: owner }),
  });
  const result = (await response.json().catch(() => ({}))) as { ok?: boolean; error?: string };
  if (!response.ok || result.ok !== true) {
    console.error("[floor] claim refused", response.status, result.error);
    throw new FloorOperatorError(response.ok ? "The check could not be taken. Try again." : checkFailureCopy(response.status));
  }
}

export async function saveFloorCheck(input: {
  taskId: string;
  residentId: string;
  draft: CompletionPayload;
  owner: RetryOwner;
  /** Stable across a retry of the same observation. */
  requestId: string;
  observedAt: string;
}): Promise<CheckSaveResult> {
  const payload: CompletionPayload = { ...input.draft, requestId: input.requestId, observedAt: input.observedAt, retryOwner: input.owner };
  const queue = async (): Promise<CheckSaveResult> => {
    await queueRoundingCompletion(input.taskId, input.residentId, payload, {
      ownerUserId: input.owner.userId,
      organizationId: input.owner.organizationId,
      facilityId: input.owner.facilityId,
    });
    return { status: "queued" };
  };
  try {
    if (typeof navigator !== "undefined" && !navigator.onLine) return await queue();
    const response = await fetch(`/api/rounding/tasks/${encodeURIComponent(input.taskId)}/complete`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const json = (await response.json().catch(() => ({}))) as { ok?: boolean; error?: string; reasonRequired?: boolean };
    // A conflicting completion is kept in the outbox for reconciliation, as on the caregiver app.
    if (response.status === 409) return await queue();
    if (!response.ok) {
      if (response.status === 400 && json.reasonRequired === true) {
        return { status: "reason_required", message: "This check is late. Say why, then save." };
      }
      console.error("[floor] completion refused", response.status, json.error);
      return { status: "failed", message: checkFailureCopy(response.status) };
    }
    if (json.ok !== true) {
      console.error("[floor] completion not acknowledged", json.error);
      return { status: "failed", message: FAILED_COPY };
    }
    return { status: "saved" };
  } catch (error) {
    if (shouldQueueRoundingRequest(error)) {
      try {
        return await queue();
      } catch {
        return { status: "failed", message: "The tablet could not keep this check offline. Tell the administrator now." };
      }
    }
    console.error("[floor] completion failed", error);
    return { status: "failed", message: error instanceof FloorOperatorError ? error.message : FAILED_COPY };
  }
}
