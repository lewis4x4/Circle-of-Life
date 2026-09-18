/**
 * care-event-prefill/prefill — compose System One answers into highlighted chips.
 *
 * Pure function of the model's answers. No network, no database, no clock, so
 * the tests say what Haven puts on a caregiver's screen rather than what the
 * model said about a recording.
 *
 * The output is deliberately small: a map of question key to option value, and
 * a parallel record of why everything else was left alone. Nothing here returns
 * a level, a category, or a flag. The How bad screen renders these as
 * pre-selected chips; `care_event_derive` never sees this object.
 */

import { requireChoice, type SystemOneResponse } from "../_shared/typesafe-client.ts";
import {
  PREFILL_QUESTIONS,
  PREFILL_QUESTIONS_VERSION,
  PREFILL_THRESHOLDS,
  UNSTATED,
  type PrefillKind,
} from "../_shared/care-event-prefill-questions.ts";

/** Why a question was left for the caregiver to tap. */
export type PrefillSkipReason =
  /** The caregiver did not address it. */
  | "unstated"
  /** The winning option did not carry enough probability to highlight. */
  | "below_floor"
  /** The model answered with an option this tile does not offer. */
  | "unknown_option"
  /** The model returned no usable answer for this question. */
  | "no_answer";

export type CareEventPrefill = {
  /** Question key to option value. Only confident, tile-valid, stated answers. */
  prefill: Record<string, string>;
  /** Question key to why it was skipped. Every question appears in exactly one of the two. */
  skipped: Record<string, PrefillSkipReason>;
  /** The winning probability per question, for tuning the floor against real recordings. */
  probabilities: Record<string, number>;
  questions_version: string;
};

/**
 * The floor is applied to the winning option's own probability, not to
 * `confidence`. See the note on PREFILL_THRESHOLDS for why.
 */
function winningProbability(
  probabilities: Record<string, number>,
  choice: string,
): number {
  const value = probabilities[choice];
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

export function composePrefill(
  response: SystemOneResponse,
  kind: PrefillKind,
): CareEventPrefill {
  const questions = PREFILL_QUESTIONS[kind];
  const prefill: Record<string, string> = {};
  const skipped: Record<string, PrefillSkipReason> = {};
  const probabilities: Record<string, number> = {};

  for (const [key, question] of Object.entries(questions)) {
    let answer: { choice: string; probabilities: Record<string, number> };
    try {
      answer = requireChoice(response, key);
    } catch {
      // A missing answer is a question the caregiver still taps, not a failure
      // of the whole request. One unusable answer must not cost the other three.
      skipped[key] = "no_answer";
      continue;
    }

    const probability = winningProbability(answer.probabilities, answer.choice);
    probabilities[key] = probability;

    if (answer.choice === UNSTATED) {
      skipped[key] = "unstated";
      continue;
    }
    // The model is asked with the tile's own option keys, so an option the tile
    // does not offer means the question set has drifted from tiles.ts. Refusing
    // to prefill is the safe reading; the caregiver taps and nothing is wrong on
    // screen, while the skip reason names the drift for whoever looks.
    if (question.type !== "choice" || !(answer.choice in question.criteria)) {
      skipped[key] = "unknown_option";
      continue;
    }
    if (probability < PREFILL_THRESHOLDS.floor) {
      skipped[key] = "below_floor";
      continue;
    }

    prefill[key] = answer.choice;
  }

  return {
    prefill,
    skipped,
    probabilities,
    questions_version: PREFILL_QUESTIONS_VERSION,
  };
}
