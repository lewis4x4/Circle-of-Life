import { NextResponse } from "next/server";

import { requireCurrentApiActor } from "@/lib/auth/current-api-actor";
import { isCareEventKind } from "@/lib/care-events/level-engine";
import { parseCareEventReceipt } from "@/lib/care-events/submit";
import { logError } from "@/lib/observability/logger";
import { UUID_STRING_RE } from "@/lib/supabase/env";

/**
 * Replay endpoint for the offline "Something happened" queue (spec 07A §2).
 * The service worker and the in-page fallback POST the same payload the
 * browser would hand to `submit_care_event`; the RPC is idempotent on
 * `client_event_id`, so a lost response is safe to retry.
 */
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ error: "Invalid care event payload" }, { status: 400 });
  }
  const payload = body as Record<string, unknown>;
  if (typeof payload.client_event_id !== "string" || !UUID_STRING_RE.test(payload.client_event_id)) {
    return NextResponse.json({ error: "A valid client_event_id is required" }, { status: 400 });
  }
  if (typeof payload.facility_id !== "string" || !UUID_STRING_RE.test(payload.facility_id)) {
    return NextResponse.json({ error: "A valid facility_id is required" }, { status: 400 });
  }
  if (!isCareEventKind(payload.kind)) {
    return NextResponse.json({ error: "A valid kind is required" }, { status: 400 });
  }

  const auth = await requireCurrentApiActor({ scope: "care-events.submit" });
  if ("response" in auth) return auth.response;
  const { actor } = auth;

  const { data, error } = await actor.client.rpc(
    "submit_care_event" as never,
    { p_payload: { ...payload, captured_offline: payload.captured_offline === true } } as never,
  );

  if (error) {
    const message = typeof error.message === "string" ? error.message : "";
    if (/care_event: forbidden/i.test(message)) {
      return NextResponse.json({ error: "Not allowed to send events for this facility." }, { status: 409 });
    }
    if (/^care_event:/i.test(message)) {
      return NextResponse.json({ error: message }, { status: 422 });
    }
    logError("care-events.submit", error, { clientEventId: payload.client_event_id });
    return NextResponse.json({ error: "Could not save the event. Retry with the same request." }, { status: 500 });
  }

  try {
    return NextResponse.json(parseCareEventReceipt(data));
  } catch (parseError) {
    logError("care-events.submit", parseError, { clientEventId: payload.client_event_id });
    return NextResponse.json({ error: "The event was saved but the receipt was unreadable." }, { status: 500 });
  }
}
