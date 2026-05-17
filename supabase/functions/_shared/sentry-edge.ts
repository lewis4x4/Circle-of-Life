/**
 * sentry-edge — minimal Sentry adapter for Deno Edge Functions (KB-NEXT-03).
 *
 * Why a stub-friendly wrapper instead of importing @sentry/deno directly?
 *   - The Sentry Deno SDK has historically had import-stability issues under
 *     Supabase Edge runtime (deno-cli divergence, top-level await). We need a
 *     surface that works *today* without breaking the router on cold start.
 *   - Behaviour: if SENTRY_DSN_EDGE is set AND the SDK loads successfully,
 *     real Sentry events fire. Otherwise this becomes a structured-console
 *     no-op so callers don't have to branch.
 *
 * Authors of new Edge Functions: import and call `captureException` /
 * `captureMessage` directly — no init step required.
 */

type SentryLevel = "info" | "warning" | "error";

type SentryContext = Record<string, unknown>;

function structuredLog(level: SentryLevel, payload: Record<string, unknown>): void {
  const line = JSON.stringify({ sentry_capture: true, level, ...payload });
  if (level === "error") {
    console.error(line);
  } else if (level === "warning") {
    console.warn(line);
  } else {
    console.log(line);
  }
}

function sanitizeContext(context?: SentryContext): SentryContext | undefined {
  if (!context) return undefined;
  const clean: SentryContext = {};
  for (const [k, v] of Object.entries(context)) {
    const lk = k.toLowerCase();
    if (lk === "authorization" || lk === "cookie" || lk === "set-cookie") continue;
    clean[k] = v;
  }
  return clean;
}

let sdkLoaded: { capture: (e: Error, c?: SentryContext) => void; message: (m: string, l: SentryLevel, c?: SentryContext) => void } | null = null;
let sdkAttempted = false;

async function tryLoadSdk(): Promise<void> {
  if (sdkAttempted) return;
  sdkAttempted = true;
  const dsn = (globalThis as { Deno?: { env?: { get(name: string): string | undefined } } }).Deno?.env?.get("SENTRY_DSN_EDGE");
  if (!dsn) return;
  try {
    // Dynamic import keeps this file safe to import even when SDK is unavailable.
    const mod: Record<string, unknown> = await import(
      // @ts-ignore — Deno-only ESM import
      "https://deno.land/x/sentry@7.115.0/index.mjs"
    );
    type SentrySDK = {
      init(opts: { dsn: string; sendDefaultPii: boolean }): void;
      captureException(err: Error, context?: { extra?: SentryContext }): void;
      captureMessage(msg: string, opts?: { level?: SentryLevel; extra?: SentryContext }): void;
    };
    const s = mod as unknown as SentrySDK;
    s.init({ dsn, sendDefaultPii: false });
    sdkLoaded = {
      capture: (err, ctx) => s.captureException(err, ctx ? { extra: sanitizeContext(ctx) } : undefined),
      message: (m, l, ctx) => s.captureMessage(m, { level: l, extra: ctx ? sanitizeContext(ctx) : undefined }),
    };
  } catch (loadErr) {
    structuredLog("warning", { event: "sentry_sdk_load_failed", error: String(loadErr) });
    sdkLoaded = null;
  }
}

export function captureException(err: unknown, context?: SentryContext): void {
  const ctx = sanitizeContext(context);
  // Fire-and-forget SDK init; logs always go out via console so we never lose signal.
  void tryLoadSdk().then(() => {
    if (sdkLoaded) {
      const errorObj = err instanceof Error ? err : new Error(String(err));
      try { sdkLoaded.capture(errorObj, ctx); } catch (_) { /* swallow */ }
    }
  });
  structuredLog("error", {
    event: "captured_exception",
    error_message: err instanceof Error ? err.message : String(err),
    error_stack: err instanceof Error ? err.stack?.split("\n").slice(0, 5).join("\n") : undefined,
    ...(ctx ?? {}),
  });
}

export function captureMessage(message: string, level: SentryLevel = "info", context?: SentryContext): void {
  const ctx = sanitizeContext(context);
  void tryLoadSdk().then(() => {
    if (sdkLoaded) {
      try { sdkLoaded.message(message, level, ctx); } catch (_) { /* swallow */ }
    }
  });
  structuredLog(level, { event: "captured_message", message, ...(ctx ?? {}) });
}
