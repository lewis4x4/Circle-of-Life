import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { composePrefill } from "./care-event-prefill/prefill.ts";
import type { SystemOneResponse } from "./_shared/typesafe-client.ts";
import {
  PREFILL_QUESTIONS,
  PREFILL_QUESTIONS_VERSION,
  PREFILL_THRESHOLDS,
  UNSTATED,
} from "./_shared/care-event-prefill-questions.ts";

/**
 * Answers for "She slipped in the bathroom, I saw it, she scraped her elbow,
 * no head, she is staying here" — every question stated and confident.
 *
 * Each test overrides only the answer it is about, so a failure names the
 * answer that changed the chips rather than a whole fixture. No resident, room,
 * facility, or staff name appears in this file (acceptance item 14).
 */
function answers(overrides: Record<string, unknown> = {}): SystemOneResponse {
  const base: Record<string, unknown> = {
    hurt: {
      type: "choice",
      choice: "a_little",
      probabilities: { not_hurt: 0.04, a_little: 0.92, badly: 0.02, [UNSTATED]: 0.02 },
      confidence: 0.9,
    },
    head: {
      type: "choice",
      choice: "no",
      probabilities: { no: 0.88, yes: 0.03, not_sure: 0.05, [UNSTATED]: 0.04 },
      confidence: 0.86,
    },
    witnessed: {
      type: "choice",
      choice: "yes",
      probabilities: { yes: 0.94, no: 0.03, [UNSTATED]: 0.03 },
      confidence: 0.93,
    },
    going_out: {
      type: "choice",
      choice: "no",
      probabilities: { no: 0.91, yes: 0.04, [UNSTATED]: 0.05 },
      confidence: 0.89,
    },
  };
  return {
    model: "jev-latest",
    answers: { ...base, ...overrides } as SystemOneResponse["answers"],
    usage: { input_tokens: 180, output_tokens: 40 },
  };
}

Deno.test("a confident account prefills every question on the tile", () => {
  const result = composePrefill(answers(), "fall");
  assertEquals(result.prefill, {
    hurt: "a_little",
    head: "no",
    witnessed: "yes",
    going_out: "no",
  });
  assertEquals(result.skipped, {});
  assertEquals(result.questions_version, PREFILL_QUESTIONS_VERSION);
});

Deno.test("a question the caregiver did not address is left for them to tap", () => {
  const result = composePrefill(
    answers({
      head: {
        type: "choice",
        choice: UNSTATED,
        probabilities: { no: 0.11, yes: 0.04, not_sure: 0.06, [UNSTATED]: 0.79 },
        confidence: 0.77,
      },
    }),
    "fall",
  );
  assertEquals("head" in result.prefill, false);
  assertEquals(result.skipped.head, "unstated");
  // The other three are unaffected: one silence does not cost the rest.
  assertEquals(Object.keys(result.prefill).sort(), ["going_out", "hurt", "witnessed"]);
});

Deno.test("an unwitnessed fall is never read as 'nobody saw it' from silence alone", () => {
  // The distinction this asserts is clinical, not cosmetic. `witnessed: "no"`
  // is a statement that the fall was unwitnessed, which changes what the
  // administrator must chase. Silence must not become that statement.
  const result = composePrefill(
    answers({
      witnessed: {
        type: "choice",
        choice: UNSTATED,
        probabilities: { yes: 0.2, no: 0.22, [UNSTATED]: 0.58 },
        confidence: 0.5,
      },
    }),
    "fall",
  );
  assertEquals("witnessed" in result.prefill, false);
  assertEquals(result.skipped.witnessed, "unstated");
});

Deno.test("a winning option below the floor leaves the chip unselected", () => {
  const justUnder = PREFILL_THRESHOLDS.floor - 0.01;
  const result = composePrefill(
    answers({
      hurt: {
        type: "choice",
        choice: "a_little",
        probabilities: { not_hurt: 0.2, a_little: justUnder, badly: 0.02, [UNSTATED]: 0.02 },
        confidence: 0.99,
      },
    }),
    "fall",
  );
  assertEquals("hurt" in result.prefill, false);
  assertEquals(result.skipped.hurt, "below_floor");
  assertEquals(result.probabilities.hurt, justUnder);
});

Deno.test("the floor reads the winning option's probability, not `confidence`", () => {
  // `confidence` is how concentrated the distribution is, which the client
  // documents as "NOT how likely the answer is to be correct, and not
  // permission to act". A high confidence over a low winner must not highlight
  // a chip; that is the whole reason the floor is not read off `confidence`.
  const result = composePrefill(
    answers({
      going_out: {
        type: "choice",
        choice: "yes",
        probabilities: { no: 0.45, yes: 0.5, [UNSTATED]: 0.05 },
        confidence: 0.97,
      },
    }),
    "fall",
  );
  assertEquals("going_out" in result.prefill, false);
  assertEquals(result.skipped.going_out, "below_floor");
});

Deno.test("an option the tile does not offer is refused rather than passed through", () => {
  const result = composePrefill(
    answers({
      hurt: {
        type: "choice",
        choice: "moderately",
        probabilities: { moderately: 0.97, not_hurt: 0.03 },
        confidence: 0.96,
      },
    }),
    "fall",
  );
  assertEquals("hurt" in result.prefill, false);
  assertEquals(result.skipped.hurt, "unknown_option");
});

Deno.test("a missing answer costs only its own question", () => {
  const partial = answers();
  delete (partial.answers as Record<string, unknown>).witnessed;
  const result = composePrefill(partial, "fall");
  assertEquals(result.skipped.witnessed, "no_answer");
  assertEquals(Object.keys(result.prefill).sort(), ["going_out", "head", "hurt"]);
});

Deno.test("every question is accounted for exactly once", () => {
  const partial = answers({
    head: {
      type: "choice",
      choice: UNSTATED,
      probabilities: { [UNSTATED]: 0.9, no: 0.1 },
      confidence: 0.88,
    },
  });
  const result = composePrefill(partial, "fall");
  const asked = Object.keys(PREFILL_QUESTIONS.fall).sort();
  const accounted = [...Object.keys(result.prefill), ...Object.keys(result.skipped)].sort();
  assertEquals(accounted, asked);
});

Deno.test("every fall question offers `unstated` and keeps the tile's option codes", () => {
  // The server's option keys are the Fall tile's contract codes from
  // src/lib/care-events/tiles.ts. The browser re-validates against the tile
  // before applying anything, so drift here cannot put a wrong chip on screen,
  // but it would silently stop prefilling. This pins the codes in place.
  const expected: Record<string, string[]> = {
    hurt: ["not_hurt", "a_little", "badly", UNSTATED],
    head: ["no", "yes", "not_sure", UNSTATED],
    witnessed: ["yes", "no", UNSTATED],
    going_out: ["no", "yes", UNSTATED],
  };
  for (const [key, question] of Object.entries(PREFILL_QUESTIONS.fall)) {
    assertEquals(question.type, "choice");
    if (question.type !== "choice") continue;
    assertEquals(Object.keys(question.criteria).sort(), expected[key].sort(), key);
  }
  assertEquals(Object.keys(PREFILL_QUESTIONS.fall).sort(), Object.keys(expected).sort());
});
