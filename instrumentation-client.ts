import * as Sentry from "@sentry/nextjs";

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;

/**
 * Known-noise drop list. Errors in this list are produced by Next.js itself
 * (or its bundled React runtime) under benign teardown races and contain no
 * actionable signal for the app team. Keep this list narrow and specific.
 */
function isKnownBenignNoise(event: Sentry.ErrorEvent): boolean {
  // Next.js RSC streaming teardown race: react-server-dom-turbopack emits
  // `reportGlobalError(weakResponse, Error("Connection closed."))` at
  // react-server-dom-turbopack-client.browser.production.js:1833 when the
  // RSC payload's underlying stream closes microseconds before the server
  // signals completion. The server-side `instant-validation.js` has an
  // explicit `// but delay it to avoid "Connection closed." errors` comment
  // and a setImmediate workaround that closes most but not all of the race.
  // The rejection surfaces as `auto.browser.global_handlers.onunhandledrejection`
  // and is unactionable from app code. Drop here so it stops paging the team.
  // Next: revisit when upgrading past 16.2.6 — re-evaluate the filter.
  const exception = event.exception?.values?.[0];
  const value = exception?.value ?? "";
  const mechanism = exception?.mechanism?.type;

  if (value === "Connection closed." && mechanism === "onunhandledrejection") {
    return true;
  }

  // Supabase auth-token lock contention. When two concurrent operations
  // race for the auth-token lock during page init / auth refresh / parallel
  // data fetch, the second steals the lock and the first rejects with a
  // message like:
  //   Lock "lock:sb-<project>-auth-token" was released because another request stole it
  // Supabase's own helper `isSupabaseAuthLockStealError` (in
  // `src/lib/supabase/client.ts`) documents this as a transient race. The
  // SDK retries the call internally; the unhandled rejection here is just
  // outer-promise noise with no actionable signal. Drop it.
  if (
    mechanism === "onunhandledrejection" &&
    /Lock ".*auth-token" was released because another request stole it/.test(value)
  ) {
    return true;
  }

  return false;
}

if (dsn) {
  Sentry.init({
    dsn,
    enabled: true,
    tracesSampleRate: 0,
    sendDefaultPii: false,
    beforeSend(event) {
      if (isKnownBenignNoise(event)) {
        return null;
      }
      if (event.user) {
        event.user = { id: event.user.id };
      }
      if (event.request?.headers) {
        delete event.request.headers.authorization;
        delete event.request.headers.cookie;
      }
      return event;
    },
  });
}
