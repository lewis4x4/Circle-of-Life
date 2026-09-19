/**
 * care-event-prefill-questions — what the model is asked about a caregiver's
 * spoken account of a fall, and nothing else.
 *
 * This is an accelerant for the "Something happened" flow (spec 07A section 2).
 * It decides which chip is *highlighted* on the How bad screen. It never
 * submits, never derives a level, and never reaches `care_event_derive`, which
 * stays the IMMUTABLE SQL function it is today and keeps deriving the level from
 * whatever the caregiver confirmed. Delete this whole directory and the flow is
 * exactly what it was, four taps instead of one.
 *
 * The option keys below are the contract codes from
 * `src/lib/care-events/tiles.ts`, not a parallel vocabulary. `hurt`, `head`,
 * `witnessed` and `going_out` are the Fall tile's four question keys and their
 * values are the exact `option.value` strings. A key that drifts from the tile
 * prefills nothing, silently, so `assertFallQuestionsMatchTile` in the test
 * pins them together.
 *
 * `unstated` exists on every question on purpose. "The caregiver did not say"
 * is a real and common answer, and it must be distinguishable from a confident
 * "no" — a fall the caregiver never described as witnessed is not an unwitnessed
 * fall. `unstated` is always dropped rather than prefilled.
 *
 * PHI, and why this function ships disarmed: a caregiver describing a resident's
 * fall is PHI by any reading. TypeSafe is an AI subprocessor with no BAA on
 * file, which `compliance-doc-questions.ts` already records as the reason that
 * function's state must stay PHI-free. This one cannot stay PHI-free and does
 * not pretend to. It refuses every request until an organization is named in
 * `CARE_EVENT_PREFILL_ORG_IDS`, which is empty until the BAA is signed.
 */

import type { SystemOneQuestion } from "./typesafe-client.ts";

/** Bump when any wording or threshold below changes. Returned on every answer. */
export const PREFILL_QUESTIONS_VERSION = "care-event-prefill-fall-v1";

/** The one tile this ships for. Any other kind is refused, not guessed at. */
export const PREFILL_SUPPORTED_KINDS = ["fall"] as const;
export type PrefillKind = (typeof PREFILL_SUPPORTED_KINDS)[number];

/**
 * The answer the model gives when the caregiver did not address the question.
 * Never prefilled; the caregiver taps it themselves.
 */
export const UNSTATED = "unstated";

const FALL_QUESTIONS: Record<string, SystemOneQuestion> = {
  hurt: {
    type: "choice",
    instructions:
      "From what the caregiver said about this fall, how hurt is the resident?",
    criteria: {
      not_hurt: "The caregiver described no injury at all",
      a_little: "A bruise, a scrape, a skin tear, soreness, or another minor injury",
      badly:
        "Bleeding that will not stop, cannot move or stand, a limb or joint that looks wrong, or the resident passed out",
      [UNSTATED]: "The caregiver did not say whether the resident was hurt",
    },
  },

  head: {
    type: "choice",
    instructions: "From what the caregiver said, did the resident hit their head?",
    criteria: {
      no: "The caregiver said the resident did not hit their head",
      yes: "The caregiver said the resident hit their head",
      not_sure:
        "The caregiver said they do not know, or described finding the resident afterward with no account of how they landed",
      [UNSTATED]: "The caregiver did not mention the resident's head either way",
    },
  },

  witnessed: {
    type: "choice",
    instructions: "From what the caregiver said, did anyone see the fall happen?",
    criteria: {
      yes: "The caregiver or another person saw the fall happen",
      no: "Nobody saw it; the resident was found after the fact",
      [UNSTATED]: "The caregiver did not say whether anyone saw it",
    },
  },

  going_out: {
    type: "choice",
    instructions:
      "From what the caregiver said, is the resident leaving the building for medical care?",
    criteria: {
      no: "The resident is staying in the building",
      yes: "911, EMS, an ambulance, the emergency room, or a hospital transfer was mentioned",
      [UNSTATED]: "The caregiver did not say whether the resident is going out",
    },
  },
};

export const PREFILL_QUESTIONS: Record<PrefillKind, Record<string, SystemOneQuestion>> = {
  fall: FALL_QUESTIONS,
};

export const PREFILL_THRESHOLDS = {
  /**
   * The winning option's own probability must reach this before its chip is
   * highlighted. Below it the chip renders unselected and the caregiver taps.
   *
   * Deliberately NOT `confidence`. The client documents `confidence` as how
   * concentrated the distribution is, "NOT how likely the answer is to be
   * correct, and not permission to act" — a two-option question answered 0.5/0.5
   * and a four-option question answered 0.4/0.2/0.2/0.2 can report similar
   * concentration while meaning very different things about the winner. The
   * probability mass actually sitting on the chip we are about to highlight is
   * the number that matches the decision being made.
   */
  floor: 0.75,
} as const;

export function isPrefillKind(value: unknown): value is PrefillKind {
  return typeof value === "string" && (PREFILL_SUPPORTED_KINDS as readonly string[]).includes(value);
}
