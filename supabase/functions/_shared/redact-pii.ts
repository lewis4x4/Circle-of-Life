/**
 * Edge-side re-export shim. The PHI redaction patterns are now defined once
 * in `src/lib/observability/redact.ts` so the Node logger and the Deno edge
 * functions can never drift.
 *
 * Keep this file as a thin re-export — do not add patterns here. Add them to
 * the canonical module.
 */

export {
  redactString,
  redactStringWithCounts,
  redactValue,
  pickRedacted,
  type RedactResult,
  type RedactCounts,
} from "../../../src/lib/observability/redact.ts";
