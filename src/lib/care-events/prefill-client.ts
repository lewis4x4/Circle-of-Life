/**
 * The one network call behind voice prefill, kept out of `prefill.ts` so the
 * reducer can import the pure half without pulling Supabase auth into it.
 *
 * Resolves to an empty prefill on every failure path, and there is no thrown
 * error to handle at the call site on purpose: a caregiver standing over a
 * resident on the floor must never be shown a prefill error. No microphone, no
 * network, a 503 from the BAA gate, a transcript the model could not read —
 * every one of those means chips render unselected and the caregiver taps four
 * times, which is the flow exactly as it shipped.
 */

import { authorizedEdgeFetch } from "@/lib/supabase/edge-auth";

import type { CareEventKind } from "./level-engine";
import { applyablePrefill, kindSupportsPrefill, type CareEventPrefillResponse } from "./prefill";

export type FetchedPrefill = {
  prefill: Record<string, string>;
  questionsVersion: string | null;
};

const EMPTY: FetchedPrefill = { prefill: {}, questionsVersion: null };

export async function fetchCareEventPrefill(
  kind: CareEventKind,
  transcript: string,
): Promise<FetchedPrefill> {
  if (!kindSupportsPrefill(kind)) return EMPTY;
  const text = transcript.trim();
  if (!text) return EMPTY;

  try {
    const res = await authorizedEdgeFetch(
      "care-event-prefill",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind, transcript: text }),
      },
      "Care Event Prefill Auth Debug",
    );
    if (!res.ok) return EMPTY;
    const payload = (await res.json()) as Partial<CareEventPrefillResponse>;
    return {
      // Re-checked against the tile in the browser: a drifted question set on
      // the deployed function can prefill less, never wrong.
      prefill: applyablePrefill(kind, payload?.prefill),
      questionsVersion:
        typeof payload?.questions_version === "string" ? payload.questions_version : null,
    };
  } catch {
    return EMPTY;
  }
}
