/**
 * Structured JSON logging for Edge Functions (OBSERVABILITY-SPEC.md §2).
 *
 * Every log entry includes `fn`, `event`, and optional structured fields.
 * Errors go to console.error; everything else to console.log.
 */

export interface LogEntry {
  fn: string;
  event: string;
  outcome?: "success" | "blocked" | "error";
  elapsed_ms?: number;
  error_message?: string;
  error_code?: string;
  [key: string]: unknown;
}

export function slog(entry: LogEntry): void {
  if (entry.outcome === "error") {
    console.error(JSON.stringify(entry));
  } else {
    console.log(JSON.stringify(entry));
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
