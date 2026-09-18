/**
 * Every Smart Rounding read logs the underlying PostgREST code alongside the
 * sentence the operator reads. Spec 25A decision D23.
 *
 * Three tabs on the deployed module answered
 * "Could not load X. Confirm facility scope and retry." That sentence is a
 * generic catch, not a diagnosis, and it hid three unrelated query defects for
 * long enough that a spec was written attributing all of them to a fourth
 * cause: a `residents.room_number` column that does not exist (`42703`) on two
 * tabs, and an ambiguous `staff` embed (`PGRST201`) on a third.
 *
 * The operator sentence stays. What changes is that the code, the hint and the
 * message now reach the console, so the next time a tab cannot load, the
 * reason is one line away instead of a spec away.
 *
 * Runtime agnostic on purpose: these reads run in client components, so this
 * cannot reach for the server-only Sentry logger. Messages go through the
 * shared PHI redactor first.
 */

import { redactString } from "@/lib/observability/redact";

type PostgrestShapedError = {
  code?: unknown;
  details?: unknown;
  hint?: unknown;
  message?: unknown;
};

/** What a failure reads as when it carried no message of its own. */
export const ROUNDING_QUERY_NO_MESSAGE = "No message posted";

export type RoundingQueryFailure = {
  /** PostgREST or PostgreSQL SQLSTATE, when the error carried one. */
  code: string | null;
  hint: string | null;
  message: string;
};

function asText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? redactString(trimmed) : null;
}

/** Pulls the diagnosable fields off a PostgREST error without serializing it. */
export function describeRoundingQueryFailure(error: unknown): RoundingQueryFailure {
  if (error && typeof error === "object") {
    const shaped = error as PostgrestShapedError;
    return {
      code: asText(shaped.code),
      // `details` is deliberately not logged. On a read failure it repeats the
      // hint, and on a write failure it can carry a row value.
      hint: asText(shaped.hint),
      message: asText(shaped.message) ?? ROUNDING_QUERY_NO_MESSAGE,
    };
  }
  return {
    code: null,
    hint: null,
    message: asText(String(error ?? "")) ?? ROUNDING_QUERY_NO_MESSAGE,
  };
}

/**
 * The SQLSTATEs this module's commands raise deliberately, with a sentence
 * written for the floor behind each one.
 *
 * `create_monitoring_order` and `cancel_monitoring_order` raise things like
 * "Say why the Monitoring Order is being stood down" and "An open ended
 * Monitoring Order needs a review date", each with an explicit `ERRCODE`. Those
 * are worth showing verbatim: the command is the authority on why it refused,
 * and restating its rules in a form would give the same rule two places to
 * drift apart.
 *
 * Everything outside this set is infrastructure. `42703` is a column that does
 * not exist and `PGRST201` is an ambiguous embed; neither means anything to an
 * operator and both are defects for the console, not the screen.
 *
 * Note for anyone extending this: plpgsql's default for a bare `RAISE
 * EXCEPTION` is `P0001`, but every command in this module sets its own
 * `ERRCODE`, so gating on `P0001` alone would suppress all of them.
 */
const COMMAND_REFUSAL_CODES = new Set([
  "P0001", // a bare RAISE EXCEPTION
  "P0002", // no_data_found: the command looked and the row was not there
  "22023", // invalid_parameter_value: a stated rule about the input
  "23505", // unique_violation: already in force
  "42501", // insufficient_privilege: the caller's role or reach
]);

/**
 * The command's own sentence when the command is what refused, and the caller's
 * fallback when it was not.
 */
export function roundingCommandRefusal(
  error: unknown,
  fallback: string,
): string {
  const failure = describeRoundingQueryFailure(error);
  const refused = failure.code != null && COMMAND_REFUSAL_CODES.has(failure.code);
  // A refusal that carried no sentence is no more useful than a code, so the
  // caller's own copy wins.
  if (refused && failure.message !== ROUNDING_QUERY_NO_MESSAGE) {
    return failure.message;
  }
  return fallback;
}

/**
 * Logs the diagnosis and returns the operator sentence unchanged, so a caller
 * reads as one expression:
 *
 *   setError(logRoundingQueryFailure("rounding.live.tasks", error, MESSAGE));
 */
export function logRoundingQueryFailure(
  scope: string,
  error: unknown,
  operatorMessage: string,
): string {
  const failure = describeRoundingQueryFailure(error);
  console.error(
    `[Haven] ${scope} failed`,
    JSON.stringify({ code: failure.code, hint: failure.hint, message: failure.message }),
  );
  return operatorMessage;
}
