/**
 * care-event-prefill — turn a caregiver's spoken account of a fall into
 * pre-selected chips on the How bad screen.
 * POST — Auth: the caregiver's own session, same as `grace-transcribe`.
 *
 * Body: { kind: "fall", transcript: string }
 * Returns: { prefill, skipped, probabilities, questions_version }
 *
 * What this is not, and the list is the point:
 *
 *   - It does not submit. The caregiver still taps the send button.
 *   - It does not derive a level. `care_event_derive` is an IMMUTABLE SQL
 *     function inside `submit_care_event` and it derives from the confirmed
 *     answers exactly as it does today. Nothing here is on that path.
 *   - It does not write. No row, anywhere, from this function.
 *   - It is not a dependency. Offline, or with the microphone refused, or with
 *     this function returning 503, the flow is precisely what it is today.
 *
 * PHI and the BAA gate. A caregiver describing a resident's fall is PHI on any
 * reading, and TypeSafe is an AI subprocessor with no BAA on file (COL-466) —
 * the same open item that keeps `compliance-doc-check` restricted to
 * facility-level insurance documents. So this function ships refusing: the
 * allowlist in `CARE_EVENT_PREFILL_ORG_IDS` is empty, every request gets a 503,
 * and nothing reaches the vendor. Put the demo organization's id in that
 * variable to exercise the path against demo data; put a real organization in
 * it only once the BAA is signed. The refusal is an explicit allowlist rather
 * than a feature flag so that turning it on names, on the record, exactly whose
 * residents are in scope.
 */

import { getCorsHeaders, jsonResponse } from "../_shared/cors.ts";
import {
  type CurrentActorAuthorization,
  currentActorErrorResponse,
  currentActorOrProviderErrorResponse,
  requireCurrentActor,
  withCurrentActorRevalidation,
} from "../_shared/current-actor.ts";
import { withTiming } from "../_shared/structured-log.ts";
import { evaluateSystemOne, TypeSafeError } from "../_shared/typesafe-client.ts";
import { isPrefillKind, PREFILL_QUESTIONS } from "../_shared/care-event-prefill-questions.ts";
import { composePrefill } from "./prefill.ts";

/**
 * The caregiver is standing over a resident on the floor. A prefill that has
 * not arrived by the time they have read the first question is worse than no
 * prefill, so this budget is short and there is no retry: a slow answer is
 * dropped and the chips render unselected.
 */
const TYPESAFE_TIMEOUT_MS = 4_000;
/** A spoken account of one event. Longer means something else was sent. */
const MAX_TRANSCRIPT_CHARS = 4_000;

/** Organizations whose transcripts may be sent to the vendor. Empty until the BAA is signed. */
function allowedOrganizationIds(): Set<string> {
  const raw = Deno.env.get("CARE_EVENT_PREFILL_ORG_IDS") ?? "";
  return new Set(
    raw.split(",").map((entry) => entry.trim().toLowerCase()).filter((entry) => entry.length > 0),
  );
}

type HandlerOptions = {
  authorizeActor?: (req: Request) => Promise<CurrentActorAuthorization>;
  fetcher?: typeof fetch;
};

export async function handleCareEventPrefill(
  req: Request,
  options: HandlerOptions = {},
): Promise<Response> {
  const t = withTiming("care-event-prefill");
  const origin = req.headers.get("origin");

  if (req.method === "OPTIONS") return new Response("ok", { headers: getCorsHeaders(origin) });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405, origin);

  let actorAuth: CurrentActorAuthorization;
  try {
    actorAuth = await (options.authorizeActor ?? requireCurrentActor)(req);
  } catch (error) {
    return currentActorErrorResponse(error, getCorsHeaders(origin));
  }

  // The gate runs before the body is read. A transcript that may not be sent is
  // not parsed, not measured, and not logged.
  const allowed = allowedOrganizationIds();
  if (!allowed.has(actorAuth.actor.organizationId.toLowerCase())) {
    t.log({ event: "prefill_not_permitted", outcome: "blocked" });
    return jsonResponse({ error: "Prefill is not enabled", kind: "not_permitted" }, 503, origin);
  }

  const apiKey = Deno.env.get("TYPESAFE_API_KEY");
  if (!apiKey) {
    t.log({ event: "not_configured", outcome: "error", error_message: "TYPESAFE_API_KEY unset" });
    return jsonResponse({ error: "Prefill is not enabled", kind: "not_configured" }, 503, origin);
  }

  let body: { kind?: unknown; transcript?: unknown };
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "Body must be JSON" }, 400, origin);
  }

  if (!isPrefillKind(body.kind)) {
    // Only the Fall tile has a question set. Guessing at another tile's chips
    // from a question set written for this one is how a wrong chip gets
    // highlighted on a medication event.
    t.log({ event: "kind_unsupported", outcome: "blocked" });
    return jsonResponse({ error: "No prefill for this kind", kind: "unsupported_kind" }, 422, origin);
  }
  const kind = body.kind;

  const transcript = typeof body.transcript === "string" ? body.transcript.trim() : "";
  if (!transcript) return jsonResponse({ error: "transcript is required" }, 400, origin);
  if (transcript.length > MAX_TRANSCRIPT_CHARS) {
    t.log({ event: "transcript_too_large", outcome: "blocked", chars: transcript.length });
    return jsonResponse({ error: "transcript too large" }, 413, origin);
  }

  let response;
  try {
    response = await withCurrentActorRevalidation(actorAuth, () =>
      evaluateSystemOne({
        apiKey,
        state: transcript,
        questions: PREFILL_QUESTIONS[kind],
        timeoutMs: TYPESAFE_TIMEOUT_MS,
        fetcher: options.fetcher,
      }));
  } catch (error) {
    // Never fatal to the caregiver: the screen renders with nothing selected and
    // they tap four times, which is today's flow. `kind` is the whole diagnostic
    // because the state is a resident's transcript and error bodies get logged.
    if (error instanceof TypeSafeError) {
      t.log({ event: "typesafe_failed", outcome: "error", error_code: error.kind });
      return jsonResponse({ error: "Prefill unavailable", kind: error.kind }, 502, origin);
    }
    return currentActorOrProviderErrorResponse(error, {
      status: 502,
      message: "Prefill unavailable",
      headers: getCorsHeaders(origin),
    });
  }

  const composed = composePrefill(response, kind);

  // Counts and reasons only. The transcript, the chosen options, and anything
  // that could reconstruct them stay out of the log.
  t.log({
    event: "prefilled",
    outcome: "success",
    prefilled_count: Object.keys(composed.prefill).length,
    skipped_count: Object.keys(composed.skipped).length,
    questions_version: composed.questions_version,
  });

  return jsonResponse({ ...composed, ok: true }, 200, origin);
}

if (import.meta.main) Deno.serve((req) => handleCareEventPrefill(req));
