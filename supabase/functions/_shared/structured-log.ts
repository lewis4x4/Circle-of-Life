/**
 * Structured JSON logging for Edge Functions (OBSERVABILITY-SPEC.md §2).
 *
 * Every log entry includes `fn`, `event`, and optional structured fields.
 * Errors go to console.error; everything else to console.log.
 *
 * PHI safety: every value in the entry (other than the fixed-shape control
 * fields `fn`, `event`, `outcome`, `elapsed_ms`, `error_code`,
 * `error_message`) is automatically passed through `redactValue` before it
 * is serialised. Callers should still whitelist keys for log size, but they
 * cannot accidentally leak PHI by spreading a Supabase error/payload.
 */

import { redactValue } from "./redact-pii.ts";

export interface LogEntry {
  fn: string;
  event: string;
  outcome?: "success" | "blocked" | "error";
  elapsed_ms?: number;
  error_message?: string;
  error_code?: string;
  [key: string]: unknown;
}

/** Keys that are part of the fixed log shape and bypass deep redaction. */
const RESERVED_KEYS: ReadonlySet<string> = new Set([
  "fn",
  "event",
  "outcome",
  "elapsed_ms",
  "error_code",
  "error_message",
]);

function redactEntry(entry: LogEntry): LogEntry {
  const out: LogEntry = {
    fn: entry.fn,
    event: entry.event,
  };
  for (const [key, value] of Object.entries(entry)) {
    if (RESERVED_KEYS.has(key)) {
      // Reserved fields keep their original (non-deep-redacted) value so
      // structured search on `event` / `outcome` / `error_code` stays exact.
      (out as Record<string, unknown>)[key] = value;
      continue;
    }
    (out as Record<string, unknown>)[key] = redactValue(value);
  }
  return out;
}

export function slog(entry: LogEntry): void {
  const safe = redactEntry(entry);
  if (safe.outcome === "error") {
    console.error(JSON.stringify(safe));
  } else {
    console.log(JSON.stringify(safe));
  }
}

export function withTiming(fn: string): {
  log: (entry: Omit<LogEntry, "fn" | "elapsed_ms">) => void;
  elapsed: () => number;
} {
  const start = Date.now();
  return {
    log(entry) {
      slog({ fn, elapsed_ms: Date.now() - start, ...entry } as LogEntry);
    },
    elapsed: () => Date.now() - start,
  };
}
