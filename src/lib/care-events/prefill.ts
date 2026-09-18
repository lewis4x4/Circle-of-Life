/**
 * Voice prefill for the "Something happened" flow (spec 07A §2).
 *
 * The caregiver says what happened, and the chips on the How bad screen come
 * back already highlighted. Everything else about the flow is unchanged: the
 * caregiver reads the chips, changes what is wrong, and taps send. The server
 * re-derives the level from the confirmed answers in `care_event_derive`, which
 * never sees anything in this file.
 *
 * Three properties this module is responsible for, in order of importance:
 *
 *  1. **Nothing the tile does not offer reaches the screen.** The Edge Function
 *     is asked with the tile's own option codes, but it is a separate
 *     deployable that can drift. `applyablePrefill` re-checks every key and
 *     every value against `tiles.ts` here, in the browser, so a drifted question
 *     set can only prefill *less*, never wrong.
 *  2. **It is never a dependency.** No microphone, no network, a 503 from the
 *     BAA gate, an empty transcript — every one of those returns no prefill and
 *     the caregiver taps four times, which is the flow as it shipped.
 *  3. **The record says who chose.** `prefilledByModel` carries only the keys
 *     the model set *and the caregiver did not touch afterward*, so a surveyor
 *     reading `answers->'prefill'` can tell a chip a person picked from a chip
 *     a person confirmed by pressing send.
 */

import type { CareEventKind } from "./level-engine";
import { careEventTileByKind } from "./tiles";

/** The one tile with a question set. Others fall through to today's flow. */
const PREFILL_KINDS: readonly CareEventKind[] = ["fall"];

export function kindSupportsPrefill(kind: CareEventKind | null): boolean {
  return kind !== null && PREFILL_KINDS.includes(kind);
}

export type CareEventPrefillResponse = {
  prefill: Record<string, string>;
  questions_version: string;
};

/**
 * Keep only what this tile actually offers, as a single-select question.
 *
 * Multi-select rows are excluded deliberately: "tap all that apply" is a
 * different act from confirming one highlighted chip, and a partially correct
 * multi-select reads as complete. The Fall tile has none, so this costs nothing
 * today and is the right default for the next tile.
 */
export function applyablePrefill(
  kind: CareEventKind,
  raw: unknown,
): Record<string, string> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const tile = careEventTileByKind(kind);
  const applied: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof value !== "string") continue;
    const question = tile.questions.find((candidate) => candidate.key === key);
    if (!question || question.multi) continue;
    if (!question.options.some((option) => option.value === value)) continue;
    applied[key] = value;
  }
  return applied;
}

/**
 * What gets written under `answers->'prefill'`, or null when the model set
 * nothing that survived to the send.
 *
 * `care_event_derive` reads named answer keys only and never looks at this
 * object, so it cannot influence the level. That is a property of the function,
 * not of this shape, and `prefill.test.ts` asserts it against every fall case in
 * `level-cases.json`.
 */
export type CareEventPrefillProvenance = {
  /** Keys the model set and the caregiver left alone. Confirmed by pressing send. */
  by_model: string[];
  questions_version: string;
};

export function prefillProvenance(
  prefilledByModel: readonly string[],
  questionsVersion: string | null,
): CareEventPrefillProvenance | null {
  if (prefilledByModel.length === 0 || !questionsVersion) return null;
  return { by_model: [...prefilledByModel].sort(), questions_version: questionsVersion };
}
