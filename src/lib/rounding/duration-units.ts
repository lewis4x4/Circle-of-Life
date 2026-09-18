/**
 * Unit conversions for the Smart Rounding surfaces.
 *
 * These are conversions between units of time, not configuration. Every
 * observation time, grace value, escalation offset, threshold and lookback span
 * in this module is a row (decision D2); the number of milliseconds in a minute
 * is arithmetic and belongs in exactly one place rather than being spelled out
 * again in every file that needs to read a delta in minutes.
 *
 * The distinction matters to `scripts/smart-rounding/config-literals.mjs`,
 * which flags the module's grace values and escalation offsets wherever they
 * sit next to a minute or hour identifier. That rule cannot tell a policy value
 * from a unit conversion, so the conversions live here and nowhere else.
 */

/** Milliseconds in one minute. */
export const MS_PER_MINUTE = 60_000;

/** Minutes in one day, for reading a lag that has run past a day. */
export const MINUTES_PER_DAY = 1_440;

/** Hours in one day. */
export const HOURS_PER_DAY = 24;

/** Minutes in one hour, derived so the module holds one copy of each unit. */
export const MINUTES_PER_HOUR = MINUTES_PER_DAY / HOURS_PER_DAY;

/** A signed millisecond delta, read as whole minutes. */
export function minutesFromMs(deltaMs: number): number {
  return Math.round(deltaMs / MS_PER_MINUTE);
}
