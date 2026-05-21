/**
 * Server-side logger for Haven Next.js API routes.
 *
 * Why this exists: raw `console.error(scope, err)` calls were spreading
 * Supabase error objects (which can carry row data) into stdout, and the
 * Sentry SDK was never being invoked from API handlers. Per `AGENTS.md`
 * non-negotiable #2 ("Audit everything") and the project rule "No PHI in
 * logs", every API-side error has to land here.
 *
 * Behaviour:
 *  - Pulls only `message` / `name` / `code` off the error. The full object is
 *    never serialised.
 *  - Runs the caller-supplied context through the shared PHI redactor before
 *    it reaches Sentry or stdout.
 *  - Forwards to Sentry via `@sentry/nextjs`; no DSN ⇒ silent no-op.
 *  - In development, prints a single-line redacted summary so the local dev
 *    server stays grep-friendly.
 *
 * Server-only. Do not import this from a client component.
 */

import * as Sentry from "@sentry/nextjs";

import { redactValue } from "@/lib/observability/redact";

type LogContext = Record<string, unknown>;

interface SafeError {
  name: string;
  message: string;
  code?: string;
}

function extractSafeError(err: unknown): SafeError {
  if (err instanceof Error) {
    const code = (err as { code?: unknown }).code;
    return {
      name: err.name || "Error",
      message: err.message || "",
      code: typeof code === "string" ? code : undefined,
    };
  }
  if (err && typeof err === "object") {
    const obj = err as Record<string, unknown>;
    const message = typeof obj.message === "string" ? obj.message : "";
    const name = typeof obj.name === "string" ? obj.name : "Object";
    const code = typeof obj.code === "string" ? obj.code : undefined;
    return { name, message, code };
  }
  return { name: "Unknown", message: String(err ?? "") };
}

function redactContext(context: LogContext | undefined): LogContext | undefined {
  if (!context) return undefined;
  return redactValue(context) as LogContext;
}

function devSummary(level: "error" | "warn", scope: string, parts: Record<string, unknown>): void {
  if (process.env.NODE_ENV === "production") return;
  const line = `[${level}] ${scope} ${JSON.stringify(parts)}`;
  if (level === "error") {
    console.error(line);
  } else {
    console.warn(line);
  }
}

/**
 * Log an error from an API route handler. Forwards to Sentry and (in dev)
 * prints a redacted one-line summary. Never serialises the full error object.
 *
 * @param scope  Dotted identifier, e.g. `"care-plans.approve"`.
 * @param err    The error caught from a Supabase call, fetch, etc.
 * @param context Optional structured metadata. Keep this to safe identifiers
 *               (ids, counts, status codes) — anything resembling PHI is
 *               regex-redacted, but the safer move is to not pass it.
 */
export function logError(scope: string, err: unknown, context?: LogContext): void {
  const safe = extractSafeError(err);
  const extra = redactContext(context);
  const sentryExtra: LogContext = {
    error_name: safe.name,
    error_message: safe.message,
    ...(safe.code ? { error_code: safe.code } : {}),
    ...(extra ?? {}),
  };

  try {
    Sentry.captureException(err instanceof Error ? err : new Error(safe.message || safe.name), {
      tags: { scope },
      extra: sentryExtra,
    });
  } catch {
    // Sentry should never throw, but if it does we still want the dev summary.
  }

  devSummary("error", scope, sentryExtra);
}

/**
 * Log a warning without an associated error. Use this for soft failures —
 * upstream returned an empty result, an alert evaluator skipped, etc.
 */
export function logWarn(scope: string, message: string, context?: LogContext): void {
  const extra = redactContext(context);
  const sentryExtra: LogContext = { message, ...(extra ?? {}) };

  try {
    Sentry.captureMessage(message, {
      level: "warning",
      tags: { scope },
      extra: sentryExtra,
    });
  } catch {
    // see logError
  }

  devSummary("warn", scope, sentryExtra);
}
